"""Kitsu (kitsu.app) — terceira fonte de elenco/retratos, sem chave.

O pulo do gato: a Kitsu tem um endpoint de MAPEAMENTO por id do MyAnimeList,
então a gente chega no anime certo sem busca por nome (zero ambiguidade):

    /mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=<mal>
      -> /mappings/<id>/item                (anime na Kitsu)
      -> /anime/<kid>/characters?include=character   (elenco com retrato)

Um retrato por personagem. Somado ao da AniList, dá 2 fotos — o mínimo da
análise — mesmo com o Jikan (galerias do MAL) completamente fora do ar.
"""
from __future__ import annotations

import httpx

KITSU_BASE = "https://kitsu.app/api/edge"


class KitsuClient:
    def __init__(self, timeout: float = 20.0) -> None:
        self.client = httpx.Client(
            timeout=timeout,
            headers={"Accept": "application/vnd.api+json"},
            follow_redirects=True,
        )

    def close(self) -> None:
        self.client.close()

    def _get(self, path: str) -> dict | None:
        try:
            r = self.client.get(f"{KITSU_BASE}{path}")
            if r.status_code != 200:
                return None
            return r.json()
        except (httpx.HTTPError, ValueError):
            return None

    def characters_by_mal_id(
        self, mal_id: int, max_pages: int = 3
    ) -> list[tuple[str, str | None]]:
        """[(nome, url_do_retrato_ou_None), ...] pro anime com esse MAL id.
        Lista vazia em qualquer falha — a Kitsu é fonte extra, nunca bloqueia."""
        data = self._get(
            "/mappings?filter[externalSite]=myanimelist/anime"
            f"&filter[externalId]={mal_id}"
        )
        if not data or not data.get("data"):
            return []
        mapping_id = data["data"][0].get("id")
        if not mapping_id:
            return []

        item = self._get(f"/mappings/{mapping_id}/item")
        if not item or not item.get("data"):
            return []
        kitsu_id = item["data"].get("id")
        if not kitsu_id:
            return []

        out: list[tuple[str, str | None]] = []
        offset = 0
        for _ in range(max_pages):
            page = self._get(
                f"/anime/{kitsu_id}/characters?include=character"
                f"&page[limit]=20&page[offset]={offset}"
            )
            if not page:
                break
            for node in page.get("included") or []:
                attrs = node.get("attributes") or {}
                name = attrs.get("canonicalName")
                if not name:
                    continue
                img = (attrs.get("image") or {}).get("original")
                out.append((name, img))
            if not (page.get("data") or []):
                break
            offset += 20
            if len(page.get("data") or []) < 20:
                break
        return out
