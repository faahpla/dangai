"""[recap] 01/11: sem o Jikan, e o retrato da AniList de toda a franquia.

- ElencoDoMal: o elenco e as galerias so pelo site do MAL; falha conta.
- _elenco_anilist: junta o elenco de todos os ids da franquia sem repetir; no
  429 espera e tenta de novo; outro erro deixa `completo` falso.
- _completar_retratos_anilist: o banco guardado ganha o retrato de quem casa
  pelo nome (ordem trocada vale), uma vez so; incompleto tenta de novo.
- _completar_galerias_de_todos: a galeria do MAL de quem tem menos de 4
  fotos, na frente, uma vez; quem o site nao atendeu vai para o
  missing_gallery.
- is_monochrome: arte colorida em fundo branco passa; manga nao.

Rodar: python -m unittest tests.test_retratos_anilist (da pasta motor/).
"""
from __future__ import annotations

import tempfile
import unittest

import numpy as np
from dataclasses import dataclass
from pathlib import Path

from app.providers import anime_provider as ap
from app.providers.anime_provider import AnimeBundle, AnimeProvider, CharacterRef
from app.providers.mal_direto import ElencoDoMal
from app.references.image_filters import is_monochrome


@dataclass
class _Ac:
    id: int
    name: str
    image: str | None
    role: str = "SUPPORTING"


class _AniListFalsa:
    def __init__(self, elencos: dict[int, list[_Ac]], falhas: dict[int, list[str]] | None = None) -> None:
        self.elencos = elencos
        self.falhas = {k: list(v) for k, v in (falhas or {}).items()}
        self.pedidos: list[int] = []

    def get_characters(self, anilist_id: int, max_pages: int = 2):
        self.pedidos.append(anilist_id)
        fila = self.falhas.get(anilist_id)
        if fila:
            raise RuntimeError(f"AniList indisponível (HTTP {fila.pop(0)})")
        return list(self.elencos.get(anilist_id, []))

    def close(self) -> None:
        pass


class _MalFalso:
    def __init__(self, galerias: dict[int, list[str] | None]) -> None:
        self.galerias = galerias

    def anime_characters(self, mal_id: int):
        return None

    def character_pictures(self, mal_id: int):
        return self.galerias.get(mal_id)

    def close(self) -> None:
        pass


def _banco(**extra) -> AnimeBundle:
    return AnimeBundle(
        anilist_id=195604,
        mal_id=61967,
        title="Black Clover 2nd Season",
        title_english=None,
        characters=[
            CharacterRef(mal_id=1, anilist_id=None, name="Swing, Magna", role="Supporting", image_urls=["mal/magna.jpg"]),
            CharacterRef(mal_id=2, anilist_id=None, name="Ideale, Zora", role="Supporting", image_urls=["mal/zora.jpg"]),
            CharacterRef(mal_id=3, anilist_id=None, name="Asta", role="Main", image_urls=["mal/asta.jpg", "al/asta.jpg"]),
        ],
        franchise_ids=[87528, 97940, 195604],
        franchise_root_id=87528,
        **extra,
    )


ELENCOS = {
    87528: [_Ac(10, "Asta", "al/asta.jpg")],
    97940: [_Ac(10, "Asta", "al/asta.jpg"), _Ac(11, "Magna Swing", "al/magna.jpg"), _Ac(12, "Zora Ideale", "al/zora.jpg")],
    195604: [_Ac(11, "Magna Swing", "al/magna.jpg")],
}


class TesteElencoDoMal(unittest.TestCase):
    def test_so_o_site_e_a_falha_conta(self) -> None:
        e = ElencoDoMal(_MalFalso({1: ["a.jpg", "b.jpg"], 2: None}))
        self.assertEqual(e.character_pictures(1), ["a.jpg", "b.jpg"])
        self.assertEqual(e.character_pictures(2), [])
        self.assertEqual((e.failures, e.pelo_mal), (1, 1))


class TesteRetratosAniList(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.p = AnimeProvider(Path(self.tmp.name))
        self.espera = ap.ESPERA_DO_LIMITE_S
        ap.ESPERA_DO_LIMITE_S = 0.0

    def tearDown(self) -> None:
        ap.ESPERA_DO_LIMITE_S = self.espera
        self.p.close()
        self.tmp.cleanup()

    def test_franquia_inteira_sem_repetir(self) -> None:
        self.p.anilist = _AniListFalsa(ELENCOS)
        elenco, completo = self.p._elenco_anilist([87528, 97940, 195604])
        self.assertTrue(completo)
        self.assertEqual(sorted(a.id for a in elenco), [10, 11, 12])

    def test_429_espera_e_tenta_de_novo(self) -> None:
        self.p.anilist = _AniListFalsa(ELENCOS, {97940: ["429"]})
        elenco, completo = self.p._elenco_anilist([97940])
        self.assertTrue(completo)
        self.assertEqual(len(elenco), 3)
        self.assertEqual(self.p.anilist.pedidos, [97940, 97940])

    def test_fora_do_ar_fica_incompleto(self) -> None:
        self.p.anilist = _AniListFalsa(ELENCOS, {97940: ["503"]})
        elenco, completo = self.p._elenco_anilist([87528, 97940])
        self.assertFalse(completo)
        self.assertEqual([a.id for a in elenco], [10])

    def test_banco_guardado_ganha_o_retrato_uma_vez(self) -> None:
        self.p.anilist = _AniListFalsa(ELENCOS)
        b = self.p._completar_retratos_anilist("al87528", _banco(), lambda _m: None)
        urls = {c.name: c.image_urls for c in b.characters}
        self.assertEqual(urls["Swing, Magna"], ["mal/magna.jpg", "al/magna.jpg"])
        self.assertEqual(urls["Ideale, Zora"], ["mal/zora.jpg", "al/zora.jpg"])
        self.assertEqual(urls["Asta"], ["mal/asta.jpg", "al/asta.jpg"])
        guardado = self.p.load_cached("al87528")
        self.assertTrue(guardado.retratos_anilist)
        antes = list(self.p.anilist.pedidos)
        self.p._completar_retratos_anilist("al87528", guardado, lambda _m: None)
        self.assertEqual(self.p.anilist.pedidos, antes, "banco marcado nao pede de novo")

    def test_incompleto_tenta_na_proxima(self) -> None:
        self.p.anilist = _AniListFalsa(ELENCOS, {195604: ["503"]})
        b = self.p._completar_retratos_anilist("al87528", _banco(), lambda _m: None)
        self.assertFalse(b.retratos_anilist)
        self.assertIn("al/magna.jpg", b.characters[0].image_urls)
        self.p.anilist = _AniListFalsa(ELENCOS)
        b = self.p._completar_retratos_anilist("al87528", b, lambda _m: None)
        self.assertTrue(b.retratos_anilist)
        self.assertEqual(b.characters[0].image_urls.count("al/magna.jpg"), 1)


class TesteGaleriasDeTodos(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.p = AnimeProvider(Path(self.tmp.name))

    def tearDown(self) -> None:
        self.p.close()
        self.tmp.cleanup()

    def test_galeria_na_frente_uma_vez(self) -> None:
        self.p.mal_site = ElencoDoMal(_MalFalso({1: ["mal/g1.jpg", "mal/magna.jpg", "mal/g2.jpg"], 2: None}))
        b = _banco()
        b.characters[2].image_urls = ["a", "b", "c", "d"]  # 4 fotos: nao pede
        b = self.p._completar_galerias_de_todos("al87528", b, lambda _m: None)
        self.assertEqual(b.characters[0].image_urls, ["mal/g1.jpg", "mal/g2.jpg", "mal/magna.jpg"])
        self.assertEqual(b.missing_gallery, [2])
        self.assertTrue(b.partial)
        self.assertEqual(b.characters[2].image_urls, ["a", "b", "c", "d"])
        guardado = self.p.load_cached("al87528")
        self.assertTrue(guardado.galerias_de_todos)
        self.p.mal_site = ElencoDoMal(_MalFalso({}))
        self.p._completar_galerias_de_todos("al87528", guardado, lambda _m: None)
        self.assertEqual(self.p.mal_site.failures + self.p.mal_site.pelo_mal, 0, "marcado nao pede de novo")


class TesteMonocromatico(unittest.TestCase):
    def test_colorida_em_fundo_branco_passa(self) -> None:
        img = np.full((200, 100, 3), 255, np.uint8)
        img[60:140, 35:65] = (120, 60, 40)  # o desenho: azul escuro, 12% da imagem
        self.assertFalse(is_monochrome(img))

    def test_manga_continua_fora(self) -> None:
        img = np.full((200, 100, 3), 235, np.uint8)
        img[40:160, 20:80] = 90
        img[90:110, 30:70] = 160
        self.assertTrue(is_monochrome(img))


if __name__ == "__main__":
    unittest.main()
