"""[recap] O2: o corte interrompido (app fechado ou morto no meio) retoma SEM
clipe estragado.

Antes, o ffmpeg morto no meio deixava o clipe pela metade com o nome final
(tamanho > 0) e o corte retomado o reaproveitava como pronto: MP4 sem o moov,
que nao abre (achado no teste de fechar o app no meio do corte do Nia E01:
5 de 432 clipes). Agora:

- o ffmpeg escreve em <clipe>.mp4.parcial e so no fim vira o clipe;
- clipe sem o moov (ou cortado no meio) e keyframe sem o FFD9 nao contam
  como prontos: sao refeitos; o que estava inteiro e reaproveitado;
- as sobras .parcial saem.

Rodar da pasta do motor:
    python -m unittest discover -s tests -p "test_corte_interrompido.py"
"""
from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from app.keyframe_extractor import clipe_inteiro, cut_all_shots, cut_shot, jpg_inteiro, parcial_do_clipe
from app.shot_detection import ShotBounds

from tests.test_rapido import _video_de_teste


class TestCorteInterrompido(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = Path(tempfile.mkdtemp(prefix="interrompido-"))
        cls.video = _video_de_teste(cls.dir / "fonte.mkv")

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_clipe_escrito_no_parcial(self):
        destino = self.dir / "um" / "0000.mp4"
        cut_shot(self.video, ShotBounds(idx=0, start=9.0, end=12.0), destino, fps=24.0, render_mode="compat")
        self.assertTrue(clipe_inteiro(destino))
        self.assertFalse(parcial_do_clipe(destino).exists(), "o parcial vira o clipe")
        self.assertEqual(parcial_do_clipe(destino).name, "0000.mp4.parcial")

    def test_inteiro_ou_pela_metade(self):
        bom = self.dir / "dois" / "0001.mp4"
        cut_shot(self.video, ShotBounds(idx=1, start=19.0, end=22.0), bom, fps=24.0, render_mode="compat")
        dados = bom.read_bytes()
        self.assertTrue(clipe_inteiro(bom))
        metade = bom.with_name("metade.mp4")
        metade.write_bytes(dados[: len(dados) // 2])
        self.assertFalse(clipe_inteiro(metade))
        # O ffmpeg morto antes de fechar o arquivo: ftyp + mdat ainda sem tamanho, sem moov.
        morto = bom.with_name("morto.mp4")
        morto.write_bytes(dados[:32] + (0).to_bytes(4, "big") + b"mdat" + os.urandom(4000))
        self.assertFalse(clipe_inteiro(morto))
        self.assertFalse(clipe_inteiro(bom.with_name("nao-existe.mp4")))

        import cv2
        import numpy as np

        jpg = self.dir / "dois" / "k.jpg"
        cv2.imwrite(str(jpg), np.full((32, 32, 3), 128, np.uint8))
        self.assertTrue(jpg_inteiro(jpg))
        cortado = jpg.with_name("k2.jpg")
        cortado.write_bytes(jpg.read_bytes()[:-40])
        self.assertFalse(jpg_inteiro(cortado))

    def test_retomar_refaz_so_o_estragado(self):
        shots = [ShotBounds(idx=0, start=0.0, end=9.0), ShotBounds(idx=1, start=9.0, end=18.0), ShotBounds(idx=2, start=18.0, end=28.0)]
        pasta, kfs = self.dir / "tres" / "shots", self.dir / "tres" / "keyframes"
        cut_all_shots(self.video, shots, pasta, kfs, 3, True, render_mode="compat")
        clipes = {s.idx: pasta / f"{s.idx:04d}.mp4" for s in shots}
        self.assertTrue(all(clipe_inteiro(c) for c in clipes.values()))
        # O app fechou no meio do clipe 1: ficou pela metade, com o nome final (o jeito de antes).
        clipes[1].write_bytes(clipes[1].read_bytes()[:3000])
        # E um keyframe pela metade, e uma sobra .parcial.
        kf = kfs / "0002_1.jpg"
        kf.write_bytes(kf.read_bytes()[:500])
        sobra = parcial_do_clipe(clipes[2])
        sobra.write_bytes(b"lixo")
        antes = {i: c.stat().st_mtime_ns for i, c in clipes.items()}

        cut_all_shots(self.video, shots, pasta, kfs, 3, True, render_mode="compat")
        self.assertTrue(clipe_inteiro(clipes[1]), "o clipe pela metade foi refeito")
        self.assertEqual(clipes[0].stat().st_mtime_ns, antes[0], "o inteiro foi reaproveitado")
        self.assertEqual(clipes[2].stat().st_mtime_ns, antes[2])
        self.assertTrue(jpg_inteiro(kf), "o keyframe pela metade foi refeito")
        self.assertFalse(sobra.exists())


if __name__ == "__main__":
    unittest.main()
