"""[recap] Corte v3 (app/corte_v3.py): as regras com sinais sinteticos.

Um "plano" aqui e um trecho de quadros com a mesma luz, o mesmo histograma, a
mesma cor (hs) e a mesma mini (uma textura sorteada); a nota e baixa dentro dele
e alta onde ele troca.

Rodar da pasta do motor:
    python -m unittest discover -s tests -p "test_corte_v3.py"
"""
from __future__ import annotations

import unittest

import numpy as np

from app.corte_v2 import refinar_cortes
from app.corte_v3 import _brancos, _desvio, refinar_v3, sinais_v3


def _hist(*faixas: float, de: int = 4) -> np.ndarray:
    h = np.zeros(16, dtype=np.float32)
    for i, v in enumerate(faixas):
        h[de + i] = v
    return h


def _hs(matiz: int) -> np.ndarray:
    h = np.zeros(32, dtype=np.float32)
    h[matiz * 4 + 2] = 1.0
    return h


def _textura(semente: int, media: float = 110.0, desvio: float = 45.0) -> np.ndarray:
    rng = np.random.default_rng(semente)
    return np.clip(rng.normal(media, desvio, (18, 32)), 0, 255).astype(np.uint8)


class Plano:
    def __init__(self, luz: float, hist: np.ndarray, hs: np.ndarray, mini: np.ndarray) -> None:
        self.luz, self.hist, self.hs, self.mini = luz, hist, hs, mini


A = Plano(0.40, _hist(0.3, 0.3, 0.2, 0.2), _hs(1), _textura(1))
B = Plano(0.55, _hist(0.2, 0.2, 0.3, 0.3, de=8), _hs(5), _textura(2))
#: o mesmo desenho do A com a luz e o histograma um pouco diferentes (um efeito, nao um corte)
A_OUTRA_LUZ = Plano(0.42, _hist(0.22, 0.38, 0.2, 0.2), _hs(1), A.mini)
#: o mesmo desenho do A com o histograma muito diferente (hd3 >= 0,45)
A_HIST_LONGE = Plano(0.42, _hist(0.25, 0.25, 0.25, 0.25, de=10), _hs(1), A.mini)
#: o mesmo desenho do A com outra cor (matiz) e o mesmo histograma
A_OUTRA_COR = Plano(0.40, A.hist, _hs(6), A.mini)
ESCURO_1 = Plano(0.06, _hist(0.3, 0.3, 0.2, 0.2, de=0), _hs(1), _textura(1, 15, 6))
ESCURO_2 = Plano(0.07, _hist(0.22, 0.38, 0.2, 0.2, de=0), _hs(1), ESCURO_1.mini)
PRETO = Plano(0.01, _hist(1.0, de=0), _hs(0), np.full((18, 32), 2, np.uint8))
BRANCO = Plano(0.96, _hist(1.0, de=15), _hs(0), np.full((18, 32), 250, np.uint8))
FLASH = Plano(0.95, _hist(1.0, de=15), _hs(7), np.full((18, 32), 240, np.uint8))


class Video:
    """nota/luz/hist/hs/mini de um video sintetico montado trecho a trecho."""

    def __init__(self) -> None:
        self.q: list[Plano] = []
        self.nota: list[float] = []

    def trecho(self, p: Plano, n: int, nota_dentro: float = 0.5) -> "Video":
        for i in range(n):
            mudou = bool(self.q) and i == 0 and self.q[-1] is not p
            self.nota.append(90.0 if mudou else (0.0 if not self.q else nota_dentro))
            self.q.append(p)
        return self

    def nota_em(self, i: int, v: float) -> "Video":
        self.nota[i] = v
        return self

    def arrays(self):
        return (np.array(self.nota), np.array([p.luz for p in self.q]), np.stack([p.hist for p in self.q]),
                np.stack([p.hs for p in self.q]), np.stack([p.mini for p in self.q]))

    def v3(self, cortes, fps: float = 24.0, motivos=None):
        nota, luz, hist, hs, mini = self.arrays()
        return refinar_v3(nota, luz, hist, hs, mini, cortes, fps, motivos=motivos)

    def v2(self, cortes, fps: float = 24.0):
        nota, luz, hist, _, _ = self.arrays()
        return refinar_cortes(nota, luz, hist, cortes, fps)


class TestSinais(unittest.TestCase):
    def test_luz_e_hist_iguais_aos_do_v2(self):
        from app.shot_detection import _luz_e_hist

        rng = np.random.default_rng(7)
        q = rng.integers(0, 256, (144, 256, 3), dtype=np.uint8)
        luz, hist, hs, mini = sinais_v3(q)
        l2, h2 = _luz_e_hist(q)
        self.assertEqual(luz, l2)
        self.assertTrue(np.array_equal(hist, h2))
        self.assertEqual((hs.shape, hs.dtype, mini.shape, mini.dtype), ((32,), np.float32, (18, 32), np.uint8))
        self.assertAlmostEqual(float(hs.sum()), 1.0, places=5)


class TestNotaAprendida(unittest.TestCase):
    def test_corte_no_mesmo_desenho_sai(self):
        # O v2 fica com o corte (o histograma muda), mas o desenho e a cor sao os mesmos.
        v = Video().trecho(A, 100).trecho(A_OUTRA_LUZ, 100)
        self.assertEqual(v.v2([100]), [100])
        mot = {}
        self.assertEqual(v.v3([100], motivos=mot), [])
        self.assertTrue(mot[100].startswith("tirado (z"))

    def test_troca_de_verdade_fica(self):
        v = Video().trecho(A, 100).trecho(B, 100)
        self.assertEqual(v.v3([100]), [100])

    def test_candidato_forte_sem_corte_entra(self):
        v = Video().trecho(A, 100).trecho(B, 100)
        mot = {}
        self.assertEqual(v.v3([], motivos=mot), [100])
        self.assertTrue(mot[100].startswith("entrou"))

    def test_corte_fraco_troca_pelo_candidato_vizinho(self):
        # O detector cortou 6 q antes da troca (dentro do A): o corte vai para a troca.
        v = Video().trecho(A, 100).trecho(B, 100).nota_em(94, 40.0)
        self.assertEqual(v.v3([94]), [100])


class TestPiso(unittest.TestCase):
    def test_hd3_alto_nao_sai(self):
        v = Video().trecho(A, 100).trecho(A_HIST_LONGE, 100)
        mot = {}
        self.assertEqual(v.v3([100], motivos=mot), [100])
        self.assertTrue(mot[100].startswith("piso: fica"))

    def test_escuro_dos_dois_lados_nao_sai(self):
        v = Video().trecho(ESCURO_1, 100).trecho(ESCURO_2, 100)
        mot = {}
        self.assertEqual(v.v3([100], motivos=mot), [100])
        self.assertTrue(mot[100].startswith("piso: fica"))

    def test_cartela_nao_sai(self):
        # O mesmo fundo chapado (a mesma faixa com >= 65% da luz) dos dois lados.
        c1 = Plano(0.30, _hist(0.8, 0.1, 0.1), _hs(2), _textura(3))
        c2 = Plano(0.31, _hist(0.7, 0.2, 0.1), _hs(2), c1.mini)
        v = Video().trecho(c1, 100).trecho(c2, 100)
        mot = {}
        self.assertEqual(v.v3([100], motivos=mot), [100])
        self.assertTrue(mot[100].startswith("piso: fica"))


class TestDeslocado(unittest.TestCase):
    def test_corte_deslocado_vai_para_a_troca(self):
        # O detector cortou 5 q DEPOIS da troca (dentro do B, com o hist mudando por luz):
        # a nota tiraria o corte, e a troca de verdade (100) ficaria sem corte.
        b2 = Plano(0.57, _hist(0.25, 0.15, 0.3, 0.3, de=8), B.hs, B.mini)
        v = Video().trecho(A, 100).trecho(B, 5).trecho(b2, 95)
        mot = {}
        self.assertEqual(v.v3([105], motivos=mot), [100])
        self.assertIn("vai para a troca 100", mot[105])


class TestFlashEBorda(unittest.TestCase):
    def test_candidato_dentro_de_flash_nao_entra(self):
        # Clarao de 2 q no mesmo plano: nem a nota aprendida poe corte nele.
        v = Video().trecho(A, 100).trecho(FLASH, 2).trecho(A, 100)
        self.assertEqual(v.v3([]), [])

    def test_flash_de_1_quadro_no_preto_nao_vira_corte(self):
        v = Video().trecho(PRETO, 300).trecho(BRANCO, 1).trecho(PRETO, 300)
        self.assertEqual(v.v3([]), [])

    def test_candidato_perto_do_comeco_nao_entra(self):
        # Video curto que abre com um plano de 6 q: o corte nao entra (minimo do quadro 0).
        v = Video().trecho(A, 6).trecho(B, 60)
        self.assertEqual(v.v3([]), [])

    def test_candidato_perto_do_fim_nao_entra(self):
        v = Video().trecho(A, 60).trecho(B, 6)
        self.assertEqual(v.v3([]), [])

    def test_a_borda_escala_com_o_fps(self):
        # A 48 fps o minimo e 30 q: 20 q do comeco ainda e borda.
        v = Video().trecho(A, 20).trecho(B, 120)
        self.assertEqual(v.v3([], fps=48.0), [])
        self.assertEqual(v.v3([], fps=24.0), [20])


class TestCor(unittest.TestCase):
    def test_2a_chance_pela_cor(self):
        # O corte do detector (100) cai na luz; 6 q depois a cor troca (o hist nao):
        # a 2a chance aceita pela cor.
        v = Video().trecho(A, 106).trecho(A_OUTRA_COR, 100).nota_em(100, 20.0)
        self.assertEqual(v.v2([100]), [])
        mot = {}
        self.assertEqual(v.v3([100], motivos=mot), [106])
        self.assertTrue(mot[106].startswith("2a chance"))


class TestFadeEBranco(unittest.TestCase):
    def test_fade_para_a_mesma_imagem_nao_leva_o_corte_para_a_saida(self):
        # Preto de 10 q (menos que o minimo) e a MESMA imagem dos dois lados: o v2 leva o
        # corte da entrada para a saida do escuro; o v3 nao (nao e fade entre dois planos).
        v = Video().trecho(A, 100).trecho(PRETO, 10).trecho(A, 100)
        self.assertEqual(v.v2([100]), [110])
        self.assertEqual(v.v3([100]), [100])

    def test_fade_entre_duas_imagens_corta_na_saida(self):
        v = Video().trecho(A, 100).trecho(PRETO, 10).trecho(B, 100)
        mot = {}
        self.assertEqual(v.v3([100], motivos=mot), [110])
        self.assertEqual(mot[110], "fade-saida")

    def test_branco_entre_duas_imagens(self):
        v = Video().trecho(A, 100).trecho(BRANCO, 10).trecho(B, 100)
        nota, luz, hist, hs, mini = v.arrays()
        self.assertEqual(_brancos(mini, luz, _desvio(mini), 24.0), [(100, 110)])
        w = Video().trecho(A, 100).trecho(BRANCO, 10).trecho(A, 100)
        nota, luz, hist, hs, mini = w.arrays()
        self.assertEqual(_brancos(mini, luz, _desvio(mini), 24.0), [])


class TestPura(unittest.TestCase):
    def test_mesmos_numeros_mesmos_cortes(self):
        v = Video().trecho(A, 100).trecho(B, 80).trecho(A_OUTRA_LUZ, 90).trecho(PRETO, 20).trecho(B, 100)
        self.assertEqual(v.v3([100, 180, 270]), v.v3([100, 180, 270]))

    def test_tamanhos_diferentes_falham(self):
        nota, luz, hist, hs, mini = Video().trecho(A, 50).trecho(B, 50).arrays()
        with self.assertRaises(ValueError):
            refinar_v3(nota, luz, hist, hs[:-1], mini, [50], 24.0)


if __name__ == "__main__":
    unittest.main()
