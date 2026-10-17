from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

ANILIST_URL = "https://graphql.anilist.co"

_SEARCH_QUERY = """
query ($search: String) {
  Media(search: $search, type: ANIME) {
    id
    idMal
    title { romaji english native }
    coverImage { large }
  }
}
"""

_CHARACTERS_QUERY = """
query ($id: Int, $page: Int) {
  Media(id: $id) {
    characters(page: $page, perPage: 25, sort: [ROLE, FAVOURITES_DESC]) {
      pageInfo { hasNextPage }
      edges {
        role
        node {
          id
          name { full native }
          image { large medium }
        }
      }
    }
  }
}
"""

_RELATIONS_QUERY = """
query ($id: Int) {
  Media(id: $id) {
    relations {
      edges {
        relationType
        node {
          id
          idMal
          type
          format
          title { romaji english }
        }
      }
    }
  }
}
"""


@dataclass
class AniListAnime:
    id: int
    mal_id: int | None
    title: str
    title_english: str | None
    cover: str | None


@dataclass
class AniListCharacter:
    id: int
    name: str
    role: str
    image: str | None


@dataclass
class AniListRelation:
    anilist_id: int
    mal_id: int | None
    title: str
    relation_type: str
    format: str | None  # TV, MOVIE, OVA, ONA, SPECIAL, ...


class AniListClient:
    def __init__(self, timeout: float = 20.0) -> None:
        self.client = httpx.Client(timeout=timeout, headers={"Accept": "application/json"})

    def close(self) -> None:
        self.client.close()

    def _post(self, query: str, variables: dict[str, Any]) -> dict[str, Any] | None:
        r = self.client.post(ANILIST_URL, json={"query": query, "variables": variables})
        if r.status_code == 404:
            return None
        # Fonte FORA DO AR é diferente de "não achei esse anime" — e só uma
        # das duas merece "confira o nome que você digitou".
        #
        # Em setembro de 2026 a AniList desligou a API e passou a responder
        # **403 com `errors` e `data: null`** ("temporarily disabled"). Isso
        # caía no `return None` lá embaixo e virava "AniList sem resultado":
        # o app dizia que o anime não existe enquanto a fonte inteira estava
        # desligada, e o Modo Descoberta seguia sem sugerir nome nenhum sem
        # explicar por quê. 401/429 têm a mesma natureza (chave/limite), não
        # a de "não encontrado".
        if r.status_code >= 500 or r.status_code in (401, 403, 429):
            raise RuntimeError(
                f"AniList indisponível (HTTP {r.status_code})"
                f"{_detalhe_do_erro(r)}."
            )
        try:
            data = r.json()
        except Exception as e:
            raise RuntimeError(f"Resposta inválida da AniList: {e}") from e
        if "errors" in data and not data.get("data"):
            return None
        return data.get("data")

    def search_anime(self, name: str) -> AniListAnime | None:
        data = self._post(_SEARCH_QUERY, {"search": name})
        if not data:
            return None
        m = data.get("Media")
        if not m:
            return None
        title = m["title"].get("romaji") or m["title"].get("english") or m["title"].get("native") or name
        return AniListAnime(
            id=m["id"],
            mal_id=m.get("idMal"),
            title=title,
            title_english=m["title"].get("english"),
            cover=(m.get("coverImage") or {}).get("large"),
        )

    def get_relations(self, anilist_id: int) -> list[AniListRelation]:
        """Return anime-type relations (sequels, prequels, side stories, etc.)."""
        data = self._post(_RELATIONS_QUERY, {"id": anilist_id})
        if not data or not data.get("Media"):
            return []
        out: list[AniListRelation] = []
        for edge in data["Media"]["relations"]["edges"]:
            node = edge.get("node") or {}
            if node.get("type") != "ANIME":
                continue
            title = (node.get("title") or {}).get("romaji") or \
                    (node.get("title") or {}).get("english") or f"id={node.get('id')}"
            out.append(
                AniListRelation(
                    anilist_id=node["id"],
                    mal_id=node.get("idMal"),
                    title=title,
                    relation_type=edge.get("relationType") or "",
                    format=node.get("format"),
                )
            )
        return out

    def get_characters(self, anilist_id: int, max_pages: int = 2) -> list[AniListCharacter]:
        chars: list[AniListCharacter] = []
        page = 1
        while page <= max_pages:
            data = self._post(_CHARACTERS_QUERY, {"id": anilist_id, "page": page})
            if not data or not data.get("Media"):
                break
            edges = data["Media"]["characters"]["edges"]
            for e in edges:
                node = e["node"]
                name = node["name"].get("full") or node["name"].get("native") or f"Character {node['id']}"
                img = (node.get("image") or {}).get("large") or (node.get("image") or {}).get("medium")
                chars.append(
                    AniListCharacter(id=node["id"], name=name, role=e.get("role") or "SUPPORTING", image=img)
                )
            if not data["Media"]["characters"]["pageInfo"]["hasNextPage"]:
                break
            page += 1
        return chars


def _detalhe_do_erro(r: "httpx.Response") -> str:
    """A frase que a própria AniList mandou, quando ela mandou uma.

    Vale repetir no lugar de inventar: foi assim que o "temporarily disabled
    due to severe stability issues" chegou até o usuário em vez de um número
    de HTTP solto.
    """
    try:
        erros = r.json().get("errors") or []
        msg = str(erros[0].get("message") or "").strip()
    except Exception:
        return ""
    return f": {msg}" if msg else ""
