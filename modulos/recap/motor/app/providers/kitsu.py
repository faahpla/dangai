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

import time

import httpx

KITSU_BASE = "https://kitsu.app/api/edge"

# [Studio] Busca por nome (retrato_por_nome): e um pedido por personagem com
# menos de 2 fotos, ate dezenas numa franquia grande (Dr. Stone: ~32 seguidos).
#: Intervalo minimo entre o fim de uma busca por nome e o inicio da proxima.
INTERVALO_NOME_S = 0.5
#: Teto de buscas por nome numa rodada. O laco do anime_provider vai na ordem
#: por papel, entao o teto corta os figurantes, nunca os principais; e o mesmo
#: numero de `gallery_for_top_characters` (18).
TETO_NOME = 18


class KitsuClient:
    def __init__(self, timeout: float = 20.0) -> None:
        self.client = httpx.Client(
            timeout=timeout,
            headers={"Accept": "application/vnd.api+json"},
            follow_redirects=True,
        )
        # [Studio] A busca por nome (retrato_por_nome) caiu (rede, limite de
        # taxa, bloqueio, servidor): nao tenta mais nesta rodada.
        self._nome_fora = False
        self._nome_pedidos = 0  # [Studio] buscas por nome feitas na rodada
        self._nome_ultimo = 0.0  # [Studio] monotonic do fim da ultima

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

    def retrato_por_nome(self, nome: str, mal_id: int | None) -> str | None:
        """[Studio] Um retrato do personagem achado pelo NOME (filter[name]).

        Reserva do 2o retrato quando o MAL nao deu galeria. O
        `characters_by_mal_id` acima chega no elenco pelo anime, e a Kitsu
        parou de cadastrar elenco de anime por volta de 2020; o personagem,
        porem, as vezes existe solto (de outra temporada, do manga).

        A busca por nome da Kitsu e aproximada ("Nia Liston" devolve Nia
        Teppelin, Nia Honjou...), entao so vale o personagem com o MESMO MAL
        id (`malId`). Sem MAL id (elenco da reserva da AniList), so o nome
        identico de 2+ palavras e sem ambiguidade. Nunca levanta.

        Educado: um pedido a cada `INTERVALO_NOME_S`, no maximo `TETO_NOME`
        por rodada, e erro de rede, 429 (limite de taxa), 403 (bloqueio) ou
        5xx desligam a busca por nome ate o fim da rodada.
        """
        if self._nome_fora or not nome:
            return None
        if self._nome_pedidos >= TETO_NOME:
            return None
        # "Sobrenome, Nome" (formato do MAL) -> "Nome Sobrenome" para a busca.
        partes = [p.strip() for p in nome.split(",", 1)]
        busca = " ".join(reversed(partes)) if len(partes) == 2 and partes[1] else nome
        falta = INTERVALO_NOME_S - (time.monotonic() - self._nome_ultimo)
        if falta > 0:
            time.sleep(falta)
        self._nome_pedidos += 1
        try:
            r = self.client.get(
                f"{KITSU_BASE}/characters",
                params={"filter[name]": busca, "page[limit]": 20},
                timeout=httpx.Timeout(10.0, connect=5.0),
            )
        except httpx.HTTPError:
            self._nome_fora = True
            return None
        finally:
            self._nome_ultimo = time.monotonic()
        if r.status_code == 429 or r.status_code == 403 or r.status_code >= 500:
            # Carga ou bloqueio: o personagem seguinte levaria a mesma
            # resposta. Insistir so piora o limite de taxa.
            self._nome_fora = True
            print(
                f"[Kitsu] busca por nome -> HTTP {r.status_code}: desligada nesta rodada.",
                flush=True,
            )
            return None
        if r.status_code != 200:
            return None
        try:
            nos = r.json().get("data") or []
        except ValueError:
            return None

        def retrato(no: dict) -> str | None:
            img = (no.get("attributes") or {}).get("image") or {}
            return img.get("original") or img.get("large") or img.get("medium")

        if mal_id is not None:
            for no in nos:
                if str((no.get("attributes") or {}).get("malId")) == str(mal_id):
                    return retrato(no)
            return None
        alvo = frozenset(busca.lower().split())
        if len(alvo) < 2:
            return None
        iguais = [
            no for no in nos
            if frozenset(str((no.get("attributes") or {}).get("canonicalName") or "").lower().split()) == alvo
        ]
        return retrato(iguais[0]) if len(iguais) == 1 else None
