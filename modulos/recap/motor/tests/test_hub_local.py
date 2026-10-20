"""[recap] Os pesos do HuggingFace saem do cache sem perguntar a rede (app/hub_local.py).

- `baixar` tenta so o cache primeiro; a rede so entra se o arquivo faltar;
- `so_cache` liga o modo offline do huggingface_hub so dentro do bloco e
  devolve o valor de antes, mesmo com erro.

Rodar da pasta do motor:
    python -m unittest discover -s tests -p "test_hub_local.py"
"""
from __future__ import annotations

import unittest
from unittest import mock

from app import hub_local


class TestBaixar(unittest.TestCase):
    def test_no_cache_nao_vai_a_rede(self) -> None:
        with mock.patch("huggingface_hub.hf_hub_download", return_value="C:/cache/modelo.onnx") as hf:
            self.assertEqual(hub_local.baixar("repo/x", "modelo.onnx"), "C:/cache/modelo.onnx")
        hf.assert_called_once_with(repo_id="repo/x", filename="modelo.onnx", revision=None, local_files_only=True)

    def test_sem_cache_baixa(self) -> None:
        chamadas = []

        def falso(**kw):
            chamadas.append(kw)
            if kw.get("local_files_only"):
                raise FileNotFoundError("nao esta no cache")
            return "C:/cache/baixado.onnx"

        with mock.patch("huggingface_hub.hf_hub_download", side_effect=falso):
            self.assertEqual(hub_local.baixar("repo/x", "modelo.onnx", revision="abc"), "C:/cache/baixado.onnx")
        self.assertEqual(len(chamadas), 2)
        self.assertTrue(chamadas[0]["local_files_only"])
        self.assertNotIn("local_files_only", chamadas[1])
        self.assertEqual(chamadas[1]["revision"], "abc")


class TestSoCache(unittest.TestCase):
    def test_liga_e_devolve(self) -> None:
        from huggingface_hub import constants

        antes = constants.HF_HUB_OFFLINE
        with hub_local.so_cache():
            self.assertTrue(constants.HF_HUB_OFFLINE)
        self.assertEqual(constants.HF_HUB_OFFLINE, antes)

    def test_devolve_mesmo_com_erro(self) -> None:
        from huggingface_hub import constants

        antes = constants.HF_HUB_OFFLINE
        with self.assertRaises(RuntimeError):
            with hub_local.so_cache():
                raise RuntimeError("falhou dentro")
        self.assertEqual(constants.HF_HUB_OFFLINE, antes)


if __name__ == "__main__":
    unittest.main()
