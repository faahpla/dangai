"""[recap] O1: o corte mais rapido sem mudar o resultado.

- a deteccao em pedacos paralelos da EXATAMENTE as mesmas cenas da sequencial
  (um video sintetico de 75 s com cortes secos, feito pelo ffmpeg), no corte v1
  e no v2, com a luz e o histograma do v2 iguais quadro a quadro; tambem com
  salto de PTS (3 quadros a menos na conta do tempo);
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


def _video_com_salto_de_pts(destino: Path, base: Path) -> Path:
    """O video de teste sem 3 quadros e SEM refazer o tempo dos outros: buraco no
    PTS, como o Black Clover S02E03 (8640->8642, 25906->25908). Um no meio de um
    pedaco (600), um dentro da sobra da borda 900 (895) e um na propria borda
    1350 (os 4 pedacos de 1800 quadros comecam em 450, 900 e 1350)."""
    sel = "select='not(eq(n\\,600)+eq(n\\,895)+eq(n\\,1350))'"
    subprocess.run(
        [ffmpeg_binary(), "-v", "error", "-y", "-i", str(base), "-vf", sel, "-fps_mode", "passthrough",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "48", str(destino)],
        check=True, capture_output=True, creationflags=SEM_JANELA,
    )
    return destino


def _video_com_frame_num_repetido(destino: Path, base: Path) -> Path:
    """[recap] O video de teste com DOIS quadros do mesmo frame_num, como o
    Cyberpunk Edgerunners S02E01 (dois 8098): o quadro 700 vai 0,6 quadro para
    tras e o 1500 tambem (dentro do ultimo pedaco); o muxer arredonda e cada um
    fica com o tempo do anterior. O frame_num e o tempo arredondado."""
    sel = "setpts='if(eq(N\\,700)+eq(N\\,1500)\\,PTS-0.6/(24*TB)\\,PTS)'"
    subprocess.run(
        [ffmpeg_binary(), "-v", "error", "-y", "-i", str(base), "-vf", sel, "-fps_mode", "passthrough",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "48", str(destino)],
        check=True, capture_output=True, creationflags=SEM_JANELA,
    )
    return destino


def _sinais_dos_dois_caminhos(caso: unittest.TestCase, video: Path) -> None:
    """[recap] Corte v2: a luz e o histograma de cada quadro saem iguais no caminho
    paralelo (no mesmo passe da nota) e no sequencial (no detector do SceneManager)."""
    from scenedetect import SceneManager, open_video

    from app.shot_detection import _AdaptiveComSinais

    par: list = []
    _cenas_em_paralelo(video, open_video(str(video)), 2.0, 15.0, 4, None, sinais=par)
    sm = SceneManager()
    det = _AdaptiveComSinais(adaptive_threshold=2.0, min_content_val=15.0)
    sm.add_detector(det)
    sm.detect_scenes(open_video(str(video)), show_progress=False)
    seq = det.sinais
    caso.assertEqual(len(par), len(seq))
    for a, b in zip(par, seq):
        caso.assertEqual((a[0], a[1], a[2]), (b[0], b[1], b[2]))
        caso.assertTrue(np.array_equal(a[3], b[3]))
    caso.assertGreater(len({round(x[2], 3) for x in par}), 5, "a luz muda ao longo do video")


def _v1_e_v2_iguais_na_sequencial(caso: unittest.TestCase, video: Path) -> None:
    from app.shot_detection import DETECTOR_ID_V1, DETECTOR_ID_V2

    for versao, identidade in ((1, DETECTOR_ID_V1), (2, DETECTOR_ID_V2)):
        seq = detect_shots(video, paralelo=1, versao=versao)
        par = detect_shots(video, paralelo=4, versao=versao)
        caso.assertEqual((seq.detector, par.detector), (identidade, identidade))
        caso.assertEqual([(s.idx, s.start, s.end) for s in seq], [(s.idx, s.start, s.end) for s in par])


class TestSaltoDePts(unittest.TestCase):
    """[recap] O1 com salto de PTS: antes caia inteiro na sequencial ("quadro fora
    de ordem"); agora o caminho rapido roda e da as MESMAS cenas."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = Path(tempfile.mkdtemp(prefix="salto-"))
        cls.video = _video_com_salto_de_pts(cls.dir / "salto.mkv", _video_de_teste(cls.dir / "base.mkv"))

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_o_video_tem_os_saltos(self):
        from scenedetect import open_video

        v = open_video(str(self.video))
        pos = []
        while v.read(decode=False) is not False:
            pos.append(v.position.frame_num)
        self.assertEqual([(a, b) for a, b in zip(pos, pos[1:]) if b != a + 1], [(599, 601), (894, 896), (1349, 1351)])

    def test_mesmas_cenas_da_sequencial(self):
        from scenedetect import open_video

        seq = detect_shots(self.video, paralelo=1)
        par = detect_shots(self.video, paralelo=4)
        self.assertGreaterEqual(len(seq), 7)
        self.assertEqual([(s.idx, s.start, s.end) for s in seq], [(s.idx, s.start, s.end) for s in par])
        # O caminho paralelo rodou de verdade: nao levanta _NaoDaEmParalelo.
        cenas = _cenas_em_paralelo(self.video, open_video(str(self.video)), 2.0, 15.0, 4, None)
        self.assertEqual(len(cenas), len(seq))

    def test_sinais_iguais_nos_dois_caminhos(self):
        _sinais_dos_dois_caminhos(self, self.video)

    def test_v1_e_v2_iguais_na_sequencial(self):
        _v1_e_v2_iguais_na_sequencial(self, self.video)


class TestFrameNumRepetido(unittest.TestCase):
    """[recap] Dois quadros com o mesmo frame_num: antes o O1 dizia "quadro fora
    de ordem" (caia na sequencial) e o v2 dizia "quadros com o mesmo frame_num"
    (VOLTAVA AO V1). Agora os cortes casam pela ordem dos quadros: o caminho
    rapido roda, o v2 vale e as cenas sao as mesmas da sequencial."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = Path(tempfile.mkdtemp(prefix="repetido-"))
        cls.video = _video_com_frame_num_repetido(cls.dir / "repetido.mkv", _video_de_teste(cls.dir / "base.mkv"))

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_o_video_tem_o_frame_num_repetido(self):
        from scenedetect import open_video

        v = open_video(str(self.video))
        pos = []
        while v.read(decode=False) is not False:
            pos.append(v.position)
        nums = [p.frame_num for p in pos]
        self.assertEqual([a for a, b in zip(nums, nums[1:]) if b == a], [699, 1499])
        # O muxer arredonda o tempo do 700 para o do 699: posicao repetida, nunca para tras.
        self.assertFalse(any(b < a for a, b in zip(pos, pos[1:])))

    def test_mesmas_cenas_da_sequencial_e_v2_vale(self):
        from scenedetect import open_video

        from app.shot_detection import DETECTOR_ID_V2

        seq = detect_shots(self.video, paralelo=1)
        par = detect_shots(self.video, paralelo=4)
        self.assertEqual((seq.detector, par.detector), (DETECTOR_ID_V2, DETECTOR_ID_V2))
        self.assertGreaterEqual(len(seq), 7)
        self.assertEqual([(s.idx, s.start, s.end) for s in seq], [(s.idx, s.start, s.end) for s in par])
        # O caminho paralelo rodou de verdade (nao levanta _NaoDaEmParalelo).
        cenas = _cenas_em_paralelo(self.video, open_video(str(self.video)), 2.0, 15.0, 4, None)
        self.assertEqual(len(cenas), len(seq))

    def test_sinais_iguais_nos_dois_caminhos(self):
        _sinais_dos_dois_caminhos(self, self.video)


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

    def test_sinais_iguais_nos_dois_caminhos(self):
        _sinais_dos_dois_caminhos(self, self.video)

    def test_v1_e_v2_iguais_na_sequencial(self):
        _v1_e_v2_iguais_na_sequencial(self, self.video)

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
