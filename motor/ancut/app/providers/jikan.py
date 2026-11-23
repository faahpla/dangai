from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

JIKAN_BASE = "https://api.jikan.moe/v4"


@dataclass
class JikanCharacter:
    mal_id: int
    name: str
    role: str
    image: str | None


@dataclass
class JikanAnime:
    mal_id: int
    title: str
    title_english: str | None
    cover: str | None


class JikanClient:
    """Thin wrapper around Jikan v4. Rate-limit respectful (~3 req/s)."""

    def __init__(self, timeout: float = 30.0, min_interval: float = 0.4) -> None:
        # Accept-Encoding: gzip EXATO — descoberta de produção (jul/2026): o
        # cache nginx do api.jikan.moe guarda variantes por Accept-Encoding.
        # Com "gzip" a resposta vem do cache (até STALE, servida mesmo com o
        # backend morto -> 200); com a lista padrão do httpx ("gzip, deflate,
        # br, zstd") o pedido FURA o cache e cai no backend saturado -> 504.
        # Era por isso que o app "sempre falhava" enquanto o site funcionava.
        self.client = httpx.Client(
            timeout=timeout,
            headers={"Accept": "application/json", "Accept-Encoding": "gzip"},
        )
        self.min_interval = min_interval
        self._last = 0.0
        # Chamadas que morreram mesmo após retries — o provider compara
        # antes/depois pra saber se o MyAnimeList estava fora do ar (e avisar
        # o usuário em vez de entregar um "0 personagens" mudo).
        self.failures = 0
        #: Falhas em SEQUÊNCIA. Zera a cada resposta boa.
        self.streak = 0
        #: Disjuntor: quando a fonte cai de vez, parar de bater nela.
        #:
        #: Medido em 2026-07-29 com o MyAnimeList devolvendo 504: 19
        #: personagens seguidos falharam, cada um com 3 tentativas e espera
        #: crescente — 114 dos 138 segundos da etapa foram gastos insistindo
        #: em quem não ia responder. Cinco em sequência já é resposta
        #: suficiente sobre o estado da fonte.
        self.give_up_after = 5
        self.gave_up = False

    def close(self) -> None:
        self.client.close()

    def _throttle(self) -> None:
        delta = time.monotonic() - self._last
        if delta < self.min_interval:
            time.sleep(self.min_interval - delta)
        self._last = time.monotonic()

    def _get(self, path: str, essencial: bool = False) -> dict | None:
        """`essencial`: ignora o disjuntor e tenta de qualquer jeito.

        A diferença importa. Desistir de uma galeria de fotos degrada o
        resultado; desistir da BUSCA do anime aborta a análise com "anime não
        encontrado", que é mentira quando o que houve foi instabilidade. Só o
        que dá pra perder sem quebrar nada respeita o disjuntor.
        """
        if self.gave_up and not essencial:
            # Nem tenta: sem rede, sem espera, sem retry. Quem chama trata o
            # None como "sem galeria", que é o mesmo caminho de um personagem
            # sem fotos — e os retratos oficiais continuam entrando.
            self.failures += 1
            return None

        last_status: int | str = "?"
        for attempt in range(3):
            self._throttle()
            try:
                r = self.client.get(f"{JIKAN_BASE}{path}")
            except httpx.HTTPError as e:
                last_status = type(e).__name__
                time.sleep(1.0 + attempt)
                continue
            if r.status_code == 200:
                self.streak = 0
                return r.json()
            last_status = r.status_code
            # Jikan runs on shared infra and throws transient 429/5xx under
            # load (July 2026: whole days of 504s). Retry both — giving up on
            # the first 504 was silently gutting the reference bank.
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(1.0 + attempt)
                continue
            break
        print(f"[Jikan] {path} falhou apos retries (HTTP {last_status})", flush=True)
        self.failures += 1
        self.streak += 1
        if self.streak >= self.give_up_after and not self.gave_up:
            self.gave_up = True
            print(
                f"[Jikan] {self.streak} falhas seguidas — desistindo do "
                "MyAnimeList nesta rodada.",
                flush=True,
            )
        return None

    def search_anime(self, name: str) -> JikanAnime | None:
        """Fallback for when the AniList API is down. Returns the first
        TV/movie hit, ranked by MAL popularity — which is a strong enough
        signal for well-known series."""
        # sfw=true drops H-tag results; type=... keeps it to actual anime.
        # We URL-encode `name` manually since httpx is passing it via path.
        from urllib.parse import quote
        path = f"/anime?q={quote(name)}&limit=5&sfw=true&order_by=popularity&sort=asc"
        data = self._get(path, essencial=True)
        if not data:
            return None
        for entry in data.get("data") or []:
            mal_id = entry.get("mal_id")
            if mal_id is None:
                continue
            # Prefer TV / movie / ONA / OVA; skip music videos, promos, etc.
            type_ = (entry.get("type") or "").lower()
            if type_ and type_ in ("music", "cm", "pv"):
                continue
            title_en = entry.get("title_english")
            title = entry.get("title") or title_en or f"MAL {mal_id}"
            cover = (entry.get("images") or {}).get("jpg", {}).get("large_image_url")
            return JikanAnime(
                mal_id=mal_id, title=title, title_english=title_en, cover=cover
            )
        return None

    def anime_characters(self, mal_id: int) -> list[JikanCharacter]:
        data = self._get(f"/anime/{mal_id}/characters")
        if not data:
            return []
        out: list[JikanCharacter] = []
        for entry in data.get("data") or []:
            ch = entry.get("character") or {}
            cid = ch.get("mal_id")
            if cid is None:
                continue
            name = ch.get("name") or f"Character {cid}"
            img = (ch.get("images") or {}).get("jpg", {}).get("image_url")
            role = entry.get("role") or "Supporting"
            out.append(JikanCharacter(mal_id=cid, name=name, role=role, image=img))
        return out

    def character_pictures(self, mal_id: int) -> list[str]:
        data = self._get(f"/characters/{mal_id}/pictures")
        if not data:
            return []
        urls: list[str] = []
        for entry in data.get("data") or []:
            img = entry.get("jpg") or entry.get("webp") or {}
            url = img.get("image_url") or img.get("large_image_url")
            if url:
                urls.append(url)
        return urls
