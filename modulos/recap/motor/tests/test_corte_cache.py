"""[recap] Corte v2 so para episodio NOVO: o cache de cortes (shot_bounds.json).

- shot_bounds.json com o detector v1 ou o v2 e reaproveitado: a reanalise nao
  recorta (os ids de plano dos rascunhos, do indice e do index.db ficam);
- cache sem o detector (anterior a deteccao adaptativa) ou com outro e refeito;
- episodio novo grava a identidade do corte que saiu (V2; V1 se o v2 falhou).

Rodar da pasta do motor:
    python -m unittest discover -s tests -p "test_corte_cache.py"
"""
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from app.config import Config
from app.pipeline import Pipeline
from app.shot_detection import DETECTOR_ID, DETECTOR_ID_V1, DETECTOR_ID_V2, DETECTORES_ACEITOS, Cortes, ShotBounds

CORTES = [{"idx": 0, "start": 0.0, "end": 3.17}, {"idx": 1, "start": 3.17, "end": 9.009}]


class TestCacheDoCorte(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="cache-corte-"))
        self.fonte = self.dir / "episodio.mkv"
        self.info = SimpleNamespace(source=self.fonte, anime="Anime", slug="S01E01",
                                    skip_head_seconds=0, skip_tail_seconds=0)
        self.pipe = Pipeline.__new__(Pipeline)  # sem criar pasta nem banco
        self.pipe.cfg = Config(output_dir=str(self.dir / "saida"))
        self.bounds = self.dir / "saida" / "Anime" / "S01E01" / "metadata" / "shot_bounds.json"

    def tearDown(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def _grava(self, **campos) -> None:
        dados = {"source": str(self.fonte), "min_seconds": 0.6, "shots": CORTES} | campos
        self.bounds.parent.mkdir(parents=True, exist_ok=True)
        self.bounds.write_text(json.dumps(dados), encoding="utf-8")

    def _do_cache(self):
        return self.pipe._bounds_do_cache(self.bounds, self.info)

    def test_identidades(self):
        self.assertEqual(DETECTOR_ID_V1, "adaptive/ratio=2.0/floor=15.0/curta-cola")
        self.assertEqual(DETECTOR_ID_V2, "adaptive/ratio=2.0/floor=15.0/curta-cola/v2-flash-luz-fade")
        self.assertEqual(DETECTOR_ID, DETECTOR_ID_V2)
        self.assertEqual(DETECTORES_ACEITOS, {DETECTOR_ID_V1, DETECTOR_ID_V2})

    def test_v1_e_v2_sao_reaproveitados(self):
        for detector in (DETECTOR_ID_V1, DETECTOR_ID_V2):
            self._grava(detector=detector)
            shots = self._do_cache()
            self.assertEqual([(s.idx, s.start, s.end) for s in shots], [(c["idx"], c["start"], c["end"]) for c in CORTES])

    def test_sem_detector_ou_outro_detector_e_refeito(self):
        self._grava()
        self.assertIsNone(self._do_cache())
        self._grava(detector="content/27")
        self.assertIsNone(self._do_cache())
        self._grava(detector=DETECTOR_ID_V1, source=str(self.dir / "outro.mkv"))
        self.assertIsNone(self._do_cache())

    def _preparar(self, detect):
        with mock.patch("app.pipeline.detect_shots", detect), \
             mock.patch("app.pipeline.cut_all_shots", return_value=[]) as cortar:
            self.pipe._prepare_shots(self.info, lambda *a: None, pasta_anime="Anime")
        return cortar.call_args.args[1]

    def test_reanalise_nao_recorta_o_episodio_v1(self):
        self._grava(detector=DETECTOR_ID_V1)
        antes = self.bounds.read_bytes()

        def nao_pode(*a, **k):
            raise AssertionError("episodio ja cortado nao pode ser detectado de novo")

        shots = self._preparar(nao_pode)
        self.assertEqual(len(shots), 2)
        self.assertEqual(self.bounds.read_bytes(), antes)

    def test_episodio_novo_grava_v2(self):
        novos = Cortes([ShotBounds(0, 0.0, 2.0), ShotBounds(1, 2.0, 5.0)], DETECTOR_ID_V2)
        self._preparar(lambda *a, **k: novos)
        self.assertEqual(json.loads(self.bounds.read_text(encoding="utf-8"))["detector"], DETECTOR_ID_V2)

    def test_v2_que_falhou_grava_v1(self):
        velhos = Cortes([ShotBounds(0, 0.0, 5.0)], DETECTOR_ID_V1)
        self._preparar(lambda *a, **k: velhos)
        self.assertEqual(json.loads(self.bounds.read_text(encoding="utf-8"))["detector"], DETECTOR_ID_V1)


if __name__ == "__main__":
    unittest.main()
