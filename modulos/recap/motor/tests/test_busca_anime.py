"""[recap] A1: achar o anime sem o Jikan e juntar os nomes batizados.

Sem rede: AniList, o site do MAL e a Kitsu sao FALSOS (mesma interface dos
clientes de verdade). Rodar da pasta do motor:
    python -m unittest discover -s tests -p "test_*.py"
"""
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from app.providers.anime_provider import AnimeBundle, AnimeProvider, CharacterRef, local_cache_id
from app.providers.busca_anime import (
    LIMIAR,
    BuscaDeAnime,
    Candidato,
    relevancia,
    similaridade,
    variantes_de_busca,
)

NOME_DO_ARQUIVO = (
    "Magic Repo Man Dumped by My Party Ill Cash In With a Cute Support Fairy to Become the Strongest"
)
INGLES = "Magic Repo Man: Dumped by My Party, I'll Cash In With a Cute Support Fairy to Become the Strongest!"
ROMAJI = "Kashita Maryoku wa [Revo Barai] de Kyousei Choushuu"


def magic_repo_man(fonte: str = "anilist") -> Candidato:
    return Candidato(fonte=fonte, titulo=ROMAJI, titulo_ingles=INGLES, anilist_id=202250, mal_id=62922,
                     titulos=["Maryoku Revo"])


class AniListFalsa:
    """Acha so com o nome encurtado (a AniList de verdade nao acha o nome do arquivo)."""

    def __init__(self, fora: bool = False) -> None:
        self.fora = fora
        self.pedidos: list[str] = []

    def search_page(self, q: str, per_page: int = 8):
        self.pedidos.append(q)
        if self.fora:
            raise RuntimeError("AniList indisponivel (HTTP 403)")
        if q.lower().startswith("magic repo man") and len(q.split()) <= 6:
            return [magic_repo_man()]
        if q.lower().startswith("magic"):
            return [Candidato(fonte="anilist", titulo="Mahou Shoujo Magical Destroyers", anilist_id=1, mal_id=2)]
        return []

    def get_by_mal_id(self, mal_id: int):
        return magic_repo_man() if mal_id == 62922 else None


class MalFalso:
    """A busca do site so devolve o romaji; a pagina do anime tem o ingles."""

    def __init__(self, fora: bool = False) -> None:
        self.fora = fora
        self.buscas: list[str] = []
        self.paginas: list[int] = []

    def buscar_anime(self, termo: str):
        self.buscas.append(termo)
        if self.fora:
            return None
        if "magic repo" in termo.lower():
            return [Candidato(fonte="mal", titulo='Kashita Maryoku wa "Revo Barai" de Kyousei Choushuu', mal_id=62922)]
        return []

    def titulos_do_anime(self, mal_id: int):
        self.paginas.append(mal_id)
        return {"titulo": ROMAJI, "ingles": INGLES, "outros": ["Unlimited Vault"]} if mal_id == 62922 else None


class KitsuFalsa:
    def __init__(self) -> None:
        self.buscas: list[str] = []

    def buscar_anime(self, termo: str, limite: int = 8):
        self.buscas.append(termo)
        return [Candidato(fonte="kitsu", titulo=ROMAJI, kitsu_id=50993, titulos=[INGLES])]

    def mal_id_do_anime(self, kitsu_id: int):
        return None


class TestVariantesESimilaridade(unittest.TestCase):
    def test_variantes_encurtam_o_nome_do_arquivo(self):
        v = variantes_de_busca(NOME_DO_ARQUIVO)
        self.assertEqual(v[0], NOME_DO_ARQUIVO)
        self.assertIn("Magic Repo Man Dumped", v)
        self.assertIn("Magic Repo Man", v)
        self.assertLess(v.index("Magic Repo Man Dumped"), v.index("Magic Repo Man"))

    def test_variantes_antes_do_separador_e_sem_temporada(self):
        v = variantes_de_busca("Re:Zero kara Hajimeru Isekai Seikatsu 4th Season")
        self.assertIn("Re:Zero kara Hajimeru Isekai Seikatsu", v)
        self.assertIn("Re", v)  # antes do ':' (a AniList devolve o mais parecido; a nota decide)
        v = variantes_de_busca("Dr STONE S04", temporada=4)
        self.assertEqual(v[0], "Dr STONE Season 4")
        self.assertIn("Dr STONE", v)

    def test_similaridade(self):
        self.assertEqual(similaridade(NOME_DO_ARQUIVO, INGLES), 1.0)
        self.assertGreaterEqual(similaridade("Magic Repo Man", INGLES), LIMIAR)
        self.assertEqual(similaridade("Nia Liston The Merciless Maiden", "Nia Liston: The Merciless Maiden"), 1.0)
        self.assertLess(similaridade(NOME_DO_ARQUIVO, "Mahou Shoujo Magical Destroyers"), 0.6)
        self.assertLess(similaridade("re", "Re:Zero kara Hajimeru Isekai Seikatsu"), LIMIAR)

    def test_relevancia_da_lista(self):
        self.assertGreaterEqual(relevancia("repo man", [ROMAJI, INGLES]), 0.95)
        self.assertLess(relevancia("repo man", ["Evangelion Movie 3: Q"]), 0.5)


class TestBusca(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="busca-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_anilist_com_o_nome_encurtado(self):
        al, mal, kit = AniListFalsa(), MalFalso(), KitsuFalsa()
        b = BuscaDeAnime(self.dir, al, mal, kit)
        c = b.resolver(NOME_DO_ARQUIVO)
        self.assertIsNotNone(c)
        self.assertEqual((c.fonte, c.anilist_id, c.mal_id), ("anilist", 202250, 62922))
        self.assertEqual(c.nota, 1.0)
        self.assertEqual(al.pedidos[:2], [NOME_DO_ARQUIVO, "Magic Repo Man Dumped"])
        self.assertEqual(mal.buscas, [])  # achou na 1a fonte: as outras nem sao chamadas
        # Cache: a mesma busca de novo nao pede nada.
        antes = len(al.pedidos)
        b.resolver(NOME_DO_ARQUIVO)
        self.assertEqual(len(al.pedidos), antes)

    def test_sem_anilist_o_site_do_mal(self):
        al, mal, kit = AniListFalsa(fora=True), MalFalso(), KitsuFalsa()
        b = BuscaDeAnime(self.dir, al, mal, kit)
        c = b.resolver(NOME_DO_ARQUIVO)
        self.assertIsNotNone(c)
        self.assertEqual((c.fonte, c.mal_id), ("mal", 62922))
        self.assertEqual(c.titulo_ingles, INGLES)  # veio da pagina do anime
        self.assertIn("anilist", b.erros)
        self.assertEqual(len(al.pedidos), 1)  # caiu: nao tenta as outras consultas
        self.assertEqual(kit.buscas, [])

    def test_sem_anilist_e_sem_mal_a_kitsu(self):
        b = BuscaDeAnime(self.dir, AniListFalsa(fora=True), MalFalso(fora=True), KitsuFalsa())
        c = b.resolver(NOME_DO_ARQUIVO)
        self.assertIsNotNone(c)
        self.assertEqual((c.fonte, c.kitsu_id), ("kitsu", 50993))

    def test_parecido_demais_nao_e_escolhido(self):
        class SoErrado(AniListFalsa):
            def search_page(self, q, per_page=8):
                return [Candidato(fonte="anilist", titulo="Mahou Shoujo Magical Destroyers", anilist_id=1)]

        class KitsuVazia(KitsuFalsa):
            def buscar_anime(self, termo, limite=8):
                return []

        b = BuscaDeAnime(self.dir, SoErrado(), MalFalso(fora=True), KitsuVazia())
        self.assertIsNone(b.resolver(NOME_DO_ARQUIVO))

    def test_a_escolha_da_pessoa_ganha(self):
        al = AniListFalsa()
        b = BuscaDeAnime(self.dir, al, MalFalso(), KitsuFalsa())
        b.gravar_escolha("Repo", 1, Candidato(fonte="anilist", titulo=ROMAJI, anilist_id=202250, mal_id=62922))
        c = b.resolver("Repo", 1)
        self.assertEqual((c.fonte, c.anilist_id), ("escolha", 202250))
        self.assertEqual(al.pedidos, [])

    def test_lista_da_tela_junta_o_mesmo_anime(self):
        b = BuscaDeAnime(self.dir, AniListFalsa(), MalFalso(), KitsuFalsa())
        lista = b.buscar("magic repo man")
        self.assertEqual(lista[0].anilist_id, 202250)
        self.assertEqual(lista[0].kitsu_id, 50993)  # a Kitsu (sem id do MAL) juntou pelo titulo
        self.assertEqual(sum(1 for c in lista if c.titulo == ROMAJI), 1)


class TestJuntarBancoLocal(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="juntar-"))
        self.cache = self.dir / "cache"
        self.local = self.cache / "anime_db" / local_cache_id(NOME_DO_ARQUIVO) / "characters"
        for nome, n in (("Elle", 3), ("Lent", 2), ("Zed", 1)):
            d = self.local / nome
            d.mkdir(parents=True)
            for i in range(n):
                (d / f"auto_disc_{i:02d}.jpg").write_bytes(b"jpg" + bytes([i]))

    def tearDown(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_nomes_batizados_entram_no_elenco_online(self):
        p = AnimeProvider(self.cache)
        try:
            bundle = AnimeBundle(
                anilist_id=202250, mal_id=62922, title=ROMAJI, title_english=INGLES,
                characters=[CharacterRef(None, None, n, "Main", []) for n in ("Elle", "Lent Morgana", "Misa")],
                franchise_root_id=202250,
            )
            p.save_cache("al202250", bundle)
            mapa = p.juntar_banco_local(NOME_DO_ARQUIVO, "al202250", bundle)
            self.assertEqual(mapa, {"Elle": "Elle", "Lent": "Lent Morgana", "Zed": "Zed"})
            online = next(d for d in (self.cache / "anime_db").iterdir() if d.name.endswith("[al202250]"))
            elle = sorted(x.name for x in (online / "characters" / "Elle").iterdir())
            self.assertEqual(elle, [f"batismo_auto_disc_{i:02d}.jpg" for i in range(3)])
            self.assertEqual(len(list((online / "characters" / "Lent Morgana").iterdir())), 2)
            self.assertTrue((online / "characters" / "Zed" / "batismo_auto_disc_00.jpg").exists())
            marca = json.loads((online / "juntado_do_local.json").read_text(encoding="utf-8"))
            self.assertEqual(marca["nomes"]["Lent"], "Lent Morgana")
            # Nunca perde: o banco local fica inteiro.
            self.assertEqual(len(list((self.local / "Elle").iterdir())), 3)
            # De novo: nada duplicado.
            p.juntar_banco_local(NOME_DO_ARQUIVO, "al202250", bundle)
            self.assertEqual(len(list((online / "characters" / "Elle").iterdir())), 3)
            # Banco que ja e local nao junta nada.
            self.assertEqual(p.juntar_banco_local(NOME_DO_ARQUIVO, local_cache_id(NOME_DO_ARQUIVO), bundle), {})
        finally:
            p.close()


if __name__ == "__main__":
    unittest.main()
