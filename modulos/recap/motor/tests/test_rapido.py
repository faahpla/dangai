"""[recap] O1: o corte mais rapido sem mudar o resultado.

- a deteccao em pedacos paralelos da EXATAMENTE as mesmas cenas da sequencial
  (um video sintetico de 75 s com cortes secos, feito pelo ffmpeg);
- a deteccao por tras (_Deteccao) devolve o mesmo e para quando pedem;
- os vetores do CCIP em varias sessoes saem iguais aos de uma sessao so;
- o corte decodificando na GPU so entra para H.264/HEVC de 8 bits 4:2:0 e,
  com NVENC na maquina, sai com os MESMOS quadros (framemd5) da CPU.

Rodar da pasta do motor:
    python -m unittest discover -s tests -p "test_rapido.py"
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

import numpy as np

from app.ffmpeg_locate import ffmpeg_binary, nvenc_available
from app.shot_detection import _cenas_em_paralelo, detect_shots

SEM_JANELA = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _video_de_teste(destino: Path, codec: str = "libx264", pix: str = "yuv420p") -> Path:
    """75 s a 24 fps: 8 trechos de fontes diferentes (cortes secos) com ruido."""
    fontes = [
        "testsrc2=s=320x180:r=24:d=9", "smptebars=s=320x180:r=24:d=9", "rgbtestsrc=s=320x180:r=24:d=10",
        "color=c=navy:s=320x180:r=24:d=8", "testsrc=s=320x180:r=24:d=10", "color=c=olive:s=320x180:r=24:d=9",
        "smptehdbars=s=320x180:r=24:d=10", "color=c=maroon:s=320x180:r=24:d=10",
    ]
    args = [ffmpeg_binary(), "-v", "error", "-y"]
    for f in fontes:
        args += ["-f", "lavfi", "-i", f]
    rotulos = "".join(f"[{i}:v]noise=alls=12:allf=t,format=yuv420p[v{i}];" for i in range(len(fontes)))
    concat = "".join(f"[v{i}]" for i in range(len(fontes))) + f"concat=n={len(fontes)}:v=1:a=0[out]"
    args += ["-filter_complex", rotulos + concat, "-map", "[out]", "-c:v", codec, "-pix_fmt", pix, "-g", "48", str(destino)]
    subprocess.run(args, check=True, capture_output=True, creationflags=SEM_JANELA)
    return destino


class TestDeteccaoParalela(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = Path(tempfile.mkdtemp(prefix="rapido-"))
        cls.video = _video_de_teste(cls.dir / "teste.mkv")

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_mesmas_cenas_da_sequencial(self):
        from scenedetect import open_video

        seq = detect_shots(self.video, paralelo=1)
        par = detect_shots(self.video, paralelo=4)
        self.assertGreaterEqual(len(seq), 7)
        self.assertEqual([(s.idx, s.start, s.end) for s in seq], [(s.idx, s.start, s.end) for s in par])
        # E o caminho paralelo rodou de verdade (nao caiu na sequencial calado).
        cenas = _cenas_em_paralelo(self.video, open_video(str(self.video)), 2.0, 15.0, 4, None)
        self.assertEqual(len(cenas) + 0, len(seq))

    def test_deteccao_por_tras(self):
        from app.config import Config
        from app.pipeline import _Deteccao

        cfg = Config()
        d = _Deteccao.comecar(self.video, cfg)
        andamento: list[float] = []
        shots = d.esperar(lambda st, f, m: andamento.append(f))
        self.assertIsNotNone(shots)
        self.assertEqual([(s.start, s.end) for s in shots], [(s.start, s.end) for s in detect_shots(self.video, paralelo=1)])
        # Parar: a thread sai sem segurar ninguem.
        d2 = _Deteccao.comecar(self.video, cfg)
        d2.parar.set()
        self.assertTrue(d2.feito.wait(60))


class TestCcipParalelo(unittest.TestCase):
    def test_vetores_iguais_em_varias_sessoes(self):
        from app.pipeline import _embed_em_paralelo

        class MotorFalso:
            def embed(self, rostos, batch=8):
                return np.stack([np.full(4, float(r.sum()) % 97, dtype=np.float32) for r in rostos])

        rng = np.random.default_rng(1)
        rostos = {pos: [rng.integers(0, 255, (20, 20, 3), dtype=np.uint8) for _ in range(pos % 3 + 1)] for pos in range(40)}
        um = _embed_em_paralelo([MotorFalso()], rostos)
        tres = _embed_em_paralelo([MotorFalso(), MotorFalso(), MotorFalso()], rostos)
        self.assertEqual(um.keys(), tres.keys())
        for k in um:
            self.assertTrue(np.array_equal(um[k], tres[k]))


class TestCorteNaGpu(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = Path(tempfile.mkdtemp(prefix="gpu-"))

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_so_8_bits(self):
        from app.keyframe_extractor import fonte_na_gpu

        h264 = _video_de_teste(self.dir / "h264.mkv")
        self.assertTrue(fonte_na_gpu(h264))
        dez = _video_de_teste(self.dir / "dez.mkv", codec="libx265", pix="yuv420p10le")
        self.assertFalse(fonte_na_gpu(dez))

    def test_quadros_iguais_aos_da_cpu(self):
        if not nvenc_available():
            self.skipTest("sem NVENC nesta maquina")
        from app.keyframe_extractor import cut_shot
        from app.shot_detection import ShotBounds

        video = _video_de_teste(self.dir / "fonte.mkv")
        shot = ShotBounds(idx=0, start=9.0, end=19.0)
        cpu, gpu = self.dir / "cpu.mp4", self.dir / "gpu.mp4"
        cut_shot(video, shot, cpu, use_nvenc=True, fps=24.0, render_mode="compat")
        cut_shot(video, shot, gpu, use_nvenc=True, fps=24.0, render_mode="compat", gpu_decode=True)

        def md5(p: Path) -> list[str]:
            r = subprocess.run([ffmpeg_binary(), "-v", "error", "-i", str(p), "-map", "0:v", "-f", "framemd5", "-"],
                               capture_output=True, text=True, creationflags=SEM_JANELA)
            return [ln.split(",")[-1].strip() for ln in r.stdout.splitlines() if ln and not ln.startswith("#")]

        a, b = md5(cpu), md5(gpu)
        self.assertGreater(len(a), 200)
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
