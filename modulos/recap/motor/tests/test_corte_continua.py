"""[recap] A continuidade (app/corte_continua.py): o corte no meio de um plano que continua sai."""
from __future__ import annotations

import unittest

import numpy as np

from app import corte_continua as C


def _textura(semente: int, w: int = 400, h: int = 200) -> np.ndarray:
    """Uma imagem com textura (blocos e listras de cor), maior que o quadro para dar panoramica."""
    import cv2

    r = np.random.default_rng(semente)
    img = np.zeros((h, w, 3), np.uint8)
    for _ in range(140):
        x, y = int(r.integers(0, w)), int(r.integers(0, h))
        cor = tuple(int(v) for v in r.integers(30, 230, 3))
        cv2.rectangle(img, (x, y), (x + int(r.integers(6, 40)), y + int(r.integers(6, 30))), cor, -1)
    return cv2.GaussianBlur(img, (3, 3), 0)


def _quadro(fonte: np.ndarray, x: int) -> np.ndarray:
    import cv2

    return cv2.resize(fonte[20:20 + 126, x:x + 224], (C.LARG, C.ALT))


class TestContinua(unittest.TestCase):
    def test_panoramica_continua(self):
        # A camera anda 2 px por quadro sobre o MESMO cenario: o "corte" no meio nao e corte.
        f = _textura(1)
        quadros = {q: _quadro(f, 40 + 2 * q) for q in range(0, 30)}
        self.assertTrue(C.continua(quadros, 12))

    def test_troca_de_plano_nao_continua(self):
        a, b = _textura(1), _textura(2)
        quadros = {q: _quadro(a if q < 12 else b, 40 + 2 * q) for q in range(0, 30)}
        self.assertFalse(C.continua(quadros, 12))

    def test_escuro_liso_nao_conta(self):
        # Quadro sem contraste (preto liso) nunca tira corte: o fluxo "explicaria" qualquer coisa.
        preto = np.full((C.ALT, C.LARG, 3), 8, np.uint8)
        quadros = {q: preto for q in range(0, 30)}
        self.assertFalse(C.continua(quadros, 12))

    def test_quadro_faltando_o_corte_fica(self):
        f = _textura(1)
        quadros = {q: _quadro(f, 40 + 2 * q) for q in range(0, 12)}
        self.assertFalse(C.continua(quadros, 12))

    def test_sem_fracos_nao_le_nada(self):
        self.assertEqual(C.tirar_continuos("nao-existe.mkv", [10, 50], [0.0] * 100, [], np.zeros((100, 18, 32))), [10, 50])

    def test_video_que_nao_abre_o_corte_fica(self):
        mini = np.zeros((100, 18, 32), np.float32)
        self.assertEqual(C.tirar_continuos("nao-existe.mkv", [30, 60], [i / 24 for i in range(100)], [30, 60], mini), [30, 60])


if __name__ == "__main__":
    unittest.main()
