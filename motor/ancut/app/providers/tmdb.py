"""TMDB — o "AniList do cinema".

O que o AniList dá pra anime (elenco + galeria de fotos de cada personagem),
o TMDB dá pra filme e série: **cast com foto de perfil de cada ator**. É
exatamente o formato que o pipeline de referências consome, então nada abaixo
daqui muda — o `AnimeBundle` sai igual, com `CharacterRef` dentro.

## Foto de elenco é melhor referência que fan art

No anime as refs vêm de galeria e do Danbooru: estilização variada,
enquadramento imprevisível, e às vezes nem é a mesma pessoa. Foto de perfil de
ator é o oposto — rosto centralizado, luz boa, cara limpa. É o material que o
ArcFace foi treinado a ver.

## Nome do personagem, foto do ator

A pasta se chama **John Wick** porque é assim que a pessoa procura. As fotos
são do **Keanu Reeves**, porque é o rosto que aparece na tela. Sem personagem
declarado (documentário, participação como si mesmo), o nome do ator serve de
nome.

## Precisa de chave

A API do TMDB é gratuita mas pede cadastro. Sem chave, live action continua
funcionando pelo **Modo Descoberta** — que agrupa os rostos e pede os nomes, e
não depende de fonte nenhuma.
"""

from __future__ import annotations

from typing import Callable

import httpx

from ..pipeline_types import AnimeNotFoundError
from .anime_provider import AnimeBundle, CharacterRef

BASE = "https://api.themoviedb.org/3"
IMG = "https://image.tmdb.org/t/p/w500"


class TmdbSemChaveError(AnimeNotFoundError):
    """Sem chave configurada — mensagem que diz o que fazer, não um 401."""


class TmdbProvider:
    """Mesma cara do `AnimeProvider`: `resolve()` devolve um `AnimeBundle`."""

    def __init__(self, api_key: str, timeout: float = 20.0) -> None:
        self.api_key = (api_key or "").strip()
        self._cli = httpx.Client(
            timeout=timeout, headers={"User-Agent": "AnCutHUB/1.0"}
        )

    def close(self) -> None:
        self._cli.close()

    # --- HTTP ---

    def _get(self, caminho: str, **params) -> dict:
        params["api_key"] = self.api_key
        params.setdefault("language", "pt-BR")
        r = self._cli.get(f"{BASE}{caminho}", params=params)
        r.raise_for_status()
        return r.json()

    # --- busca ---

    def _buscar(self, titulo: str, ano: int | None, serie: bool) -> dict | None:
        """Acha o título. Filme e série são endpoints diferentes no TMDB."""
        params: dict = {"query": titulo}
        if ano:
            params["year" if not serie else "first_air_date_year"] = ano
        dados = self._get("/search/tv" if serie else "/search/movie", **params)
        res = dados.get("results") or []
        if not res and ano:
            # O ano do nome do arquivo mente com frequência (data de lançamento
            # em outro país, relançamento). Melhor achar sem ele do que não
            # achar nada.
            dados = self._get("/search/tv" if serie else "/search/movie", query=titulo)
            res = dados.get("results") or []
        return res[0] if res else None

    def _elenco(self, tmdb_id: int, serie: bool) -> list[dict]:
        """Elenco. Em série vale o `aggregate_credits`: ele junta o elenco de
        TODAS as temporadas, e é isso que a busca por personagem espera —
        alguém que aparece só na 3ª temporada não pode sumir."""
        if serie:
            dados = self._get(f"/tv/{tmdb_id}/aggregate_credits")
        else:
            dados = self._get(f"/movie/{tmdb_id}/credits")
        return dados.get("cast") or []

    def _fotos_da_pessoa(self, pessoa_id: int, limite: int) -> list[str]:
        try:
            dados = self._get(f"/person/{pessoa_id}/images")
        except httpx.HTTPError:
            return []
        perfis = dados.get("profiles") or []
        return [IMG + p["file_path"] for p in perfis[:limite] if p.get("file_path")]

    # --- o que o pipeline chama ---

    def resolve(
        self,
        anime_name: str,
        max_characters: int,
        images_per_character: int,
        on_status: Callable[[str], None] | None = None,
        use_danbooru: bool = False,  # noqa: ARG002 — não existe aqui; assinatura comum
        season: int = 1,
        gallery_for_top: int | None = None,
        ano: int | None = None,
        serie: bool | None = None,
    ) -> AnimeBundle:
        def status(msg: str) -> None:
            if on_status:
                on_status(msg)

        if not self.api_key:
            raise TmdbSemChaveError(
                "Sem chave do TMDB. Ponha uma em Configurações (é gratuita, em "
                "themoviedb.org), ou use o Modo Descoberta — ele agrupa os "
                "rostos e você dá os nomes, sem depender de fonte nenhuma."
            )

        # Sem dica explícita, temporada > 1 já denuncia série.
        eh_serie = serie if serie is not None else season > 1
        status(f"Procurando no TMDB: {anime_name}")
        achado = self._buscar(anime_name, ano, eh_serie)
        if achado is None and serie is None:
            # Palpite errado: tenta o outro tipo antes de desistir.
            eh_serie = not eh_serie
            achado = self._buscar(anime_name, ano, eh_serie)
        if achado is None:
            raise AnimeNotFoundError(
                f'O TMDB não achou "{anime_name}". Confira o título, ou use o '
                "Modo Descoberta."
            )

        tmdb_id = int(achado["id"])
        titulo = achado.get("title") or achado.get("name") or anime_name
        original = achado.get("original_title") or achado.get("original_name")
        status(f"{titulo} — buscando o elenco")

        elenco = self._elenco(tmdb_id, eh_serie)[:max_characters]
        # Quem recebe galeria: os primeiros da ordem do TMDB, que já vem por
        # relevância (`order`). O resto fica com a foto única do crédito — e
        # normalmente é figurante que não alcança o mínimo de referências.
        top = gallery_for_top if gallery_for_top is not None else len(elenco)

        personagens: list[CharacterRef] = []
        for i, c in enumerate(elenco):
            ator = (c.get("name") or "").strip()
            papel = _nome_do_papel(c) or ator
            if not papel:
                continue
            urls: list[str] = []
            if i < top and c.get("id"):
                urls = self._fotos_da_pessoa(int(c["id"]), images_per_character)
            if not urls and c.get("profile_path"):
                urls = [IMG + c["profile_path"]]
            if not urls:
                continue
            personagens.append(
                CharacterRef(
                    mal_id=None,
                    anilist_id=None,
                    name=papel,
                    role="Main" if i < 10 else "Supporting",
                    image_urls=urls,
                )
            )
            if (i + 1) % 10 == 0:
                status(f"{i + 1}/{len(elenco)} do elenco")

        if not personagens:
            raise AnimeNotFoundError(
                f'"{titulo}" foi achado no TMDB, mas sem elenco com foto. '
                "Use o Modo Descoberta."
            )

        status(f"{len(personagens)} do elenco com foto")
        return AnimeBundle(
            anilist_id=None,
            mal_id=None,
            title=titulo,
            title_english=original,
            characters=personagens,
            # As refs e o cache moram numa pasta própria do TMDB. Sem isto
            # elas cairiam no mesmo balaio dos animes sem id, e um filme
            # herdaria as fotos de outro.
            cache_id_override=f"tmdb{'tv' if eh_serie else 'mv'}{tmdb_id}",
        )


def _nome_do_papel(c: dict) -> str:
    """O nome do personagem, nos dois formatos que o TMDB usa.

    Em `aggregate_credits` (série) o papel vem numa lista de `roles`, porque o
    ator pode ter feito mais de um. Em filme é um campo só.
    """
    papeis = c.get("roles")
    if isinstance(papeis, list) and papeis:
        nomes = [str(p.get("character") or "").strip() for p in papeis]
        nomes = [n for n in nomes if n]
        if nomes:
            return nomes[0]
    return str(c.get("character") or "").strip()
