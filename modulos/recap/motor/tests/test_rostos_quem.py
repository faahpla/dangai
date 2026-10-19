"""[recap] Os rostos (19/10, o teste real do Magic Repo Man E02): QUEM e cada
rosto e cada janela do recorte, sem modelo nenhum (os numeros sao os medidos).

- a Misa grande (Misa 0,87 / Lent 0,83) nao tira mais o Lent do rosto pequeno
  dele (Lent 0,83 / Misa 0,74): cada rosto disputa so a pessoa que ele quer;
- dois rostos querendo a mesma pessoa quase empatados: nenhum;
- uma pessoa so no conjunto: so acima de LIMIAR_SOZINHO;
- a janela da fadinha (Empee 0,85, a 2a 0,80) e dela; a dividida (0,83 / 0,82)
  nao e de ninguem;
- a cabeca que cobre um rosto achado e a mesma pessoa.

Rodar da pasta do motor:
    python -m unittest discover -s tests -p "test_rostos_quem.py"
"""
from __future__ import annotations

import unittest

import numpy as np

from app.rostos import LIMIAR_SOZINHO, _cobre, atribuir, quem_na_janela


class TestQuem(unittest.TestCase):
    def test_misa_grande_nao_tira_o_lent(self) -> None:
        # pessoas: Lent, Empee, Guy, Misa, Elle (o quadro 0003 do MRM E02, t=6,54)
        sims = np.array([
            [0.830, 0.769, 0.752, 0.869, 0.809],  # a Misa grande na esquerda
            [0.827, 0.721, 0.729, 0.743, 0.713],  # o Lent pequeno no meio
            [0.805, 0.750, 0.849, 0.763, 0.753],  # o Guy na direita
        ], dtype=np.float32)
        self.assertEqual(atribuir(sims), [3, 0, 2])

    def test_dois_rostos_quase_iguais_nenhum(self) -> None:
        sims = np.array([[0.90, 0.75], [0.895, 0.74]], dtype=np.float32)
        self.assertEqual(atribuir(sims), [None, None])
        sims = np.array([[0.90, 0.75], [0.85, 0.74]], dtype=np.float32)
        self.assertEqual(atribuir(sims), [0, None])

    def test_sem_folga_do_segundo_candidato(self) -> None:
        sims = np.array([[0.81, 0.80, 0.70]], dtype=np.float32)
        self.assertEqual(atribuir(sims), [None])

    def test_uma_pessoa_so(self) -> None:
        self.assertEqual(atribuir(np.array([[0.83]], dtype=np.float32)), [None])
        self.assertEqual(atribuir(np.array([[LIMIAR_SOZINHO + 0.02]], dtype=np.float32)), [0])

    def test_janela_da_fadinha(self) -> None:
        # janelas 0, 328, 656, 985, 1313 do quadro 0264 (t=4,0): Lent, Empee, Guy, Misa, Elle
        sims = np.array([
            [0.783, 0.837, 0.732, 0.815, 0.786],
            [0.779, 0.856, 0.752, 0.792, 0.803],
            [0.814, 0.812, 0.783, 0.808, 0.786],
            [0.907, 0.766, 0.804, 0.835, 0.770],
            [0.934, 0.776, 0.815, 0.848, 0.781],
        ], dtype=np.float32)
        self.assertEqual(quem_na_janela(sims), [1, 1, None, 0, 0])

    def test_cabeca_do_rosto(self) -> None:
        rosto = {"x": 100.0, "y": 100.0, "w": 50.0, "h": 50.0}
        self.assertTrue(_cobre({"x": 80.0, "y": 70.0, "w": 100.0, "h": 110.0}, rosto))
        self.assertFalse(_cobre({"x": 400.0, "y": 70.0, "w": 100.0, "h": 110.0}, rosto))


if __name__ == "__main__":
    unittest.main()
