"""[recap] Corte v2 (app/corte_v2.py): cada regra com sinais sinteticos.

Um "plano" aqui e um trecho de quadros com a mesma luz e o mesmo histograma;
a nota (diferenca HSV para o quadro anterior) e baixa dentro dele e alta onde
a imagem muda.

Rodar da pasta do motor:
    python -m unittest discover -s tests -p "test_corte_v2.py"
"""
from __future__ import annotations

import unittest

import numpy as np

from app.corte_v2 import _Cadeia, candidatos, quadros, refinar_cortes


def _hist(**faixas: float) -> np.ndarray:
    h = np.zeros(16, dtype=np.float32)
    for k, v in faixas.items():
        h[int(k[1:])] = v
    return h


A = (0.30, _hist(f4=1.0))
B_PARECIDO = (0.31, _hist(f4=0.88, f6=0.12))  # outro plano com a luz quase igual a do A
C = (0.65, _hist(f10=1.0))
FLASH = (0.95, _hist(f15=1.0))
PRETO = (0.01, _hist(f0=1.0))


class Sinais:
    """nota/luz/hist de um video sintetico montado trecho a trecho."""

    def __init__(self) -> None:
        self.luz: list[float] = []
        self.hist: list[np.ndarray] = []
        self.nota: list[float] = []

    def trecho(self, plano, n: int, nota_dentro: float = 0.5) -> "Sinais":
        luz, hist = plano
        for i in range(n):
            mudou = bool(self.luz) and i == 0 and (self.luz[-1] != luz or not np.array_equal(self.hist[-1], hist))
            self.nota.append(90.0 if mudou else (0.0 if not self.luz else nota_dentro))
            self.luz.append(luz)
            self.hist.append(hist)
        return self

    def nota_em(self, i: int, v: float) -> "Sinais":
        self.nota[i] = v
        return self

    def refinar(self, cortes, fps: float = 24.0, motivos=None):
        return refinar_cortes(np.array(self.nota), np.array(self.luz), np.stack(self.hist), cortes, fps, motivos=motivos)


class TestFlash(unittest.TestCase):
    def test_flash_no_mesmo_plano_sai(self):
        # A, 4 quadros de clarao, A de novo: o detector cortou na entrada do flash.
        s = Sinais().trecho(A, 50).trecho(FLASH, 4).trecho(A, 60)
        motivos: dict[int, str] = {}
        self.assertEqual(s.refinar([50], motivos=motivos), [])
        self.assertTrue(motivos[50].startswith("flash"))

    def test_volta_antes_do_pico_nao_e_flash(self):
        # Troca real em 50 (B tem a luz do A), clarao de 3 quadros em 54 e o plano C.
        # A regra do documento achava a "volta" em 51 (a luz ainda nem tinha mudado)
        # e tirava a troca; a volta tem que vir DEPOIS do pico.
        s = Sinais().trecho(A, 50).trecho(B_PARECIDO, 4).trecho(FLASH, 3).trecho(C, 60)
        self.assertEqual(s.refinar([50]), [50])

    def test_flash_mais_longo_que_a_janela_fica(self):
        s = Sinais().trecho(A, 50).trecho(FLASH, 9).trecho(A, 60)
        self.assertEqual(s.refinar([50]), [50])


class TestLuz(unittest.TestCase):
    def test_mesmo_histograma_e_nota_baixa_sai(self):
        s = Sinais().trecho(A, 120).nota_em(60, 20.0)
        self.assertEqual(s.refinar([60]), [])

    def test_salto_enorme_fica(self):
        s = Sinais().trecho(A, 120).nota_em(60, 40.0)
        self.assertEqual(s.refinar([60]), [60])

    def test_histograma_que_muda_fica(self):
        s = Sinais().trecho(A, 60).trecho(B_PARECIDO, 60)
        s.nota_em(60, 20.0)
        self.assertEqual(s.refinar([60]), [60])


class TestSegundaChance(unittest.TestCase):
    def test_corte_adiantado_vai_para_a_troca(self):
        # Corte falso em 50 (mesmo plano), a troca de verdade em 56 (bloqueada pelo minimo).
        s = Sinais().trecho(A, 56).trecho(C, 60).nota_em(50, 20.0)
        motivos: dict[int, str] = {}
        self.assertEqual(s.refinar([50], motivos=motivos), [56])
        self.assertEqual(motivos[50], "luz")
        self.assertTrue(motivos[56].startswith("2a chance de 50"))

    def test_candidato_fraco_nao_entra(self):
        s = Sinais().trecho(A, 56).trecho(B_PARECIDO, 60).nota_em(50, 20.0)
        self.assertEqual(s.refinar([50]), [])

    def test_candidato_dentro_de_flash_nao_entra(self):
        s = Sinais().trecho(A, 50).trecho(A, 6).trecho(FLASH, 3).trecho(A, 60).nota_em(50, 20.0)
        self.assertEqual(s.refinar([50]), [])

    def test_troca_o_corte_seguinte_mais_fraco(self):
        # 50 falso; 56 troca forte; 66 (a 10 de 56) troca fraca: o 56 fica no lugar dele.
        s = Sinais().trecho(A, 56).trecho(C, 10).trecho((0.66, _hist(f10=0.7, f11=0.3)), 60).nota_em(50, 20.0)
        self.assertEqual(s.refinar([50, 66]), [56])

    def test_nao_troca_o_seguinte_forte(self):
        s = Sinais().trecho(A, 56).trecho(C, 10).trecho(A, 60).nota_em(50, 20.0)
        self.assertEqual(s.refinar([50, 66]), [66])


class TestFade(unittest.TestCase):
    def test_corte_da_entrada_vai_para_a_saida(self):
        s = Sinais().trecho(A, 60).trecho(PRETO, 8).trecho(C, 60)
        motivos: dict[int, str] = {}
        self.assertEqual(s.refinar([60], motivos=motivos), [68])
        self.assertEqual(motivos[68], "fade-saida")

    def test_escuro_sem_corte_ganha_um(self):
        # Fade de verdade: nenhum quadro passou do limiar, a nota e baixa o tempo todo.
        s = Sinais().trecho(A, 60).trecho(PRETO, 8).trecho(C, 60)
        s.nota = [0.5] * len(s.nota)
        self.assertEqual(s.refinar([]), [68])

    def test_meio_do_preto_longo_nao_some(self):
        # O documento punha o corte no MEIO do preto e a confirmacao pela luz o desfazia
        # (os dois lados do meio sao pretos); na saida ele fica.
        s = Sinais().trecho(A, 60).trecho(PRETO, 40).trecho(C, 60)
        s.nota = [0.5] * len(s.nota)
        self.assertEqual(s.refinar([]), [100])

    def test_lado_curto_nao_ganha_corte(self):
        s = Sinais().trecho(A, 60).trecho(PRETO, 8).trecho(C, 10).trecho(A, 60)
        s.nota = [0.5] * len(s.nota)
        s.nota_em(78, 90.0)
        self.assertEqual(s.refinar([78]), [78])


class TestColarEDissolve(unittest.TestCase):
    def test_trecho_curto_cola_no_anterior(self):
        cad = _Cadeia(np.zeros(200), np.zeros(200), np.zeros((200, 16)), 24.0, 2.0, 15.0)
        self.assertEqual(cad.colar([20, 25, 100]), [25, 100])
        # o 1o trecho nao tem anterior: fica, mesmo curto
        self.assertEqual(cad.colar([5, 100]), [5, 100])

    def test_sem_dissolve(self):
        # A vira C devagar (20 quadros de mistura, nota baixa): nenhum corte inventado.
        s = Sinais().trecho(A, 60)
        for t in range(1, 21):
            a = t / 21
            s.luz.append(A[0] * (1 - a) + C[0] * a)
            s.hist.append((A[1] * (1 - a) + C[1] * a).astype(np.float32))
            s.nota.append(3.0)
        s.trecho(C, 60)
        s.nota = [min(v, 3.0) for v in s.nota]
        self.assertEqual(s.refinar([]), [])


class TestFps(unittest.TestCase):
    def test_limiares_escalam(self):
        self.assertEqual(quadros(15, 24000 / 1001), 15)
        self.assertEqual(quadros(15, 48), 30)
        self.assertEqual(quadros(7, 60), 18)
        self.assertEqual(quadros(3, 30), 4)
        self.assertEqual(quadros(1, 10), 1)

    def test_flash_de_10_quadros_a_48_fps_sai(self):
        # A 48 fps um flash de 10 quadros dura o mesmo que um de 5 a 24 fps.
        s = Sinais().trecho(A, 100).trecho(FLASH, 10).trecho(A, 120)
        self.assertEqual(s.refinar([100], fps=48.0), [])
        self.assertEqual(s.refinar([100], fps=24.0), [100])


class TestCandidatos(unittest.TestCase):
    def test_mesma_conta_do_adaptive_detector(self):
        from scenedetect import AdaptiveDetector

        rng = np.random.default_rng(3)
        nota = np.abs(rng.normal(4, 3, 600))
        nota[[50, 51, 120, 300, 301, 302, 450]] = [40, 35, 90, 25, 60, 18, 200]
        nota[200:205] = 0.0
        nota[202] = 16.0
        cand = set(candidatos(nota))
        # O AdaptiveDetector sem minimo (min_scene_len=0), nota por nota.
        det = AdaptiveDetector(adaptive_threshold=2.0, min_content_val=15.0, min_scene_len=0)
        notas = iter(nota)
        det._calculate_frame_score = lambda tc, img: next(notas)
        from scenedetect.common import FrameTimecode

        cortes = []
        vazio = np.zeros((1, 1, 3), dtype=np.uint8)
        for i in range(len(nota)):
            cortes += [c.frame_num for c in det.process_frame(FrameTimecode(i, fps=24.0), vazio)]
        self.assertEqual(cand, set(cortes))


if __name__ == "__main__":
    unittest.main()
