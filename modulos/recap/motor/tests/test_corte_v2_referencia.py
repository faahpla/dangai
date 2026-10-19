"""[recap] Corte v2 nos 3 episodios do estudo de 19/10: os numeros de referencia.

Precisa dos .mkv e leva uns 6 min, entao so roda com RECAP_CORTE_REFERENCIA=1.
A pasta dos episodios vem de RECAP_EPISODIOS_REAIS (padrao: ~/Downloads); o
episodio que nao estiver la pula.

    set RECAP_CORTE_REFERENCIA=1
    python -m unittest discover -s tests -p "test_corte_v2_referencia.py"

Conferido no estudo, quadro a quadro, nas folhas de G:\\ClaudeEditor\\_capturas\\corte-aniflow.
"""
from __future__ import annotations

import os
import unittest
from pathlib import Path

from app.shot_detection import DETECTOR_ID_V1, DETECTOR_ID_V2, detect_shots

#: arquivo: (shots no corte v1, shots no corte v2)
EPISODIOS = {
    "Black.Clover.S02E03.1080p.BILI.WEB-DL.AAC2.0.H.264-VARYG.mkv": (709, 652),
    "Magic.Repo.Man.Dumped.by.My.Party.Ill.Cash.In.With.a.Cute.Support.Fairy.to.Become.the.Strongest"
    ".S01E02.1080p.CR.WEB-DL.AAC2.0.H.264-VARYG.mkv": (375, 308),
    "Nia.Liston.The.Merciless.Maiden.S01E01.Rising.From.the.Darkness.1080p.ADN.WEB-DL.AAC2.0.H.264-VARYG.mkv": (432, 402),
}


@unittest.skipUnless(os.environ.get("RECAP_CORTE_REFERENCIA") == "1", "so com RECAP_CORTE_REFERENCIA=1 (e os .mkv)")
class TestReferencia(unittest.TestCase):
    def test_os_tres_episodios(self):
        pasta = Path(os.environ.get("RECAP_EPISODIOS_REAIS") or Path.home() / "Downloads")
        rodou = 0
        for nome, (v1, v2) in EPISODIOS.items():
            video = pasta / nome
            if not video.exists():
                continue
            with self.subTest(episodio=nome[:30]):
                novo = detect_shots(video)
                self.assertEqual((novo.detector, len(novo)), (DETECTOR_ID_V2, v2))
                velho = detect_shots(video, versao=1)
                self.assertEqual((velho.detector, len(velho)), (DETECTOR_ID_V1, v1))
                rodou += 1
        if not rodou:
            self.skipTest(f"nenhum dos episodios em {pasta}")


if __name__ == "__main__":
    unittest.main()
