"""[recap] Corte v1/v2/v3 nos episodios dos estudos de 19 e 20/10: os numeros de referencia.

Precisa dos .mkv e leva uns 12 min, entao so roda com RECAP_CORTE_REFERENCIA=1.
A pasta dos episodios vem de RECAP_EPISODIOS_REAIS (padrao: ~/Downloads); o
episodio que nao estiver la pula.

    set RECAP_CORTE_REFERENCIA=1
    python -m unittest discover -s tests -p "test_corte_v2_referencia.py"

Conferido no estudo, quadro a quadro, nas folhas de G:\\ClaudeEditor\\_capturas\\corte-aniflow
(v2) e G:\\ClaudeEditor\\_capturas\\corte-v3 (v3).
"""
from __future__ import annotations

import os
import unittest
from pathlib import Path

from app.shot_detection import DETECTOR_ID_V1, DETECTOR_ID_V2, DETECTOR_ID_V3, detect_shots

#: arquivo: (shots no corte v1, no v2, no v3); None = nao confere aquele
EPISODIOS = {
    "Black.Clover.S02E03.1080p.BILI.WEB-DL.AAC2.0.H.264-VARYG.mkv": (709, 652, 626),
    "Magic.Repo.Man.Dumped.by.My.Party.Ill.Cash.In.With.a.Cute.Support.Fairy.to.Become.the.Strongest"
    ".S01E02.1080p.CR.WEB-DL.AAC2.0.H.264-VARYG.mkv": (375, 308, 297),
    "Nia.Liston.The.Merciless.Maiden.S01E01.Rising.From.the.Darkness.1080p.ADN.WEB-DL.AAC2.0.H.264-VARYG.mkv": (432, 402, 393),
    # dois quadros com o frame_num 8098: antes o v2 voltava ao v1 (623)
    "Cyberpunk.Edgerunners.S02E01.1080p.TWITCH.WEB-DL.ENG.AAC2.0.H.264-ToonsHub.mkv": (None, 550, 514),
}


@unittest.skipUnless(os.environ.get("RECAP_CORTE_REFERENCIA") == "1", "so com RECAP_CORTE_REFERENCIA=1 (e os .mkv)")
class TestReferencia(unittest.TestCase):
    def test_os_episodios(self):
        pasta = Path(os.environ.get("RECAP_EPISODIOS_REAIS") or Path.home() / "Downloads")
        rodou = 0
        for nome, esperado in EPISODIOS.items():
            video = pasta / nome
            if not video.exists():
                continue
            with self.subTest(episodio=nome[:30]):
                for versao, identidade, n in zip((1, 2, 3), (DETECTOR_ID_V1, DETECTOR_ID_V2, DETECTOR_ID_V3), esperado):
                    if n is None:
                        continue
                    cortes = detect_shots(video, versao=versao)
                    self.assertEqual((cortes.detector, len(cortes)), (identidade, n))
                rodou += 1
        if not rodou:
            self.skipTest(f"nenhum dos episodios em {pasta}")


if __name__ == "__main__":
    unittest.main()
