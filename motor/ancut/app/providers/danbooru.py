from __future__ import annotations

import re
import time

import httpx


DANBOORU_BASE = "https://danbooru.donmai.us"

# Danbooru's anonymous/free tier caps queries at 2 tags total. So we query
# with only the character tag and post-filter the response by each post's
# `tag_string` and `rating` fields (unlimited, since it's client-side).
_BAD_TAGS = {
    "monochrome",
    "greyscale",
    "comic",
    "4koma",
    "manga_cover",
    "text_focus",
    "sketch",
}
_GOOD_RATINGS = {"g", "general"}  # Danbooru returns short or long form


def _slug(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9 ]", "", s)
    return "_".join(s.split())


def character_tag_candidates(character_name: str, *series_titles: str) -> list[str]:
    """Build a priority-ordered list of Danbooru tag candidates for a character.

    MAL gives names as "Last, First" (e.g., "Ijichi, Kotoko") or just a single
    name ("Coco"). Danbooru keeps Japanese name order (Last_First).

    Danbooru tags use the Japanese romaji series title (e.g., Witch Hat Atelier
    is `tongari_boushi_no_atelier`). We accept multiple series titles to try
    (usually romaji first, english as fallback).
    """
    parts = [p.strip() for p in character_name.split(",") if p.strip()]
    if len(parts) == 2:
        last, first = parts
        names = [
            f"{_slug(last)}_{_slug(first)}",
            f"{_slug(first)}_{_slug(last)}",
        ]
    elif len(parts) == 1:
        names = [_slug(parts[0])]
    else:
        names = [_slug(character_name)]

    series_tags = [_slug(s) for s in series_titles if s]
    tags: list[str] = []
    for s in series_tags:
        for n in names:
            tags.append(f"{n}_({s})")
    tags.extend(names)
    # dedup while preserving order
    seen: set[str] = set()
    out: list[str] = []
    for t in tags:
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


class DanbooruClient:
    """Thin wrapper around Danbooru posts.json. Respects a small rate limit.

    No auth required for basic queries. We always filter out manga/monochrome
    so the embeddings learn the anime's visual style, not the manga's.
    """

    def __init__(self, timeout: float = 20.0, min_interval: float = 0.2) -> None:
        self.client = httpx.Client(
            timeout=timeout,
            headers={
                "User-Agent": "CorteCenas/0.1 (+https://example.local)",
                "Accept": "application/json",
            },
            follow_redirects=True,
        )
        self.min_interval = min_interval
        self._last = 0.0

    def close(self) -> None:
        self.client.close()

    def _throttle(self) -> None:
        delta = time.monotonic() - self._last
        if delta < self.min_interval:
            time.sleep(self.min_interval - delta)
        self._last = time.monotonic()

    def _search(self, tag: str, limit: int) -> list[dict]:
        # Query with only the character tag; pull extra posts to compensate
        # for client-side filtering.
        for attempt in range(3):
            self._throttle()
            try:
                r = self.client.get(
                    f"{DANBOORU_BASE}/posts.json",
                    params={"tags": tag, "limit": max(1, min(limit * 3, 100))},
                )
            except Exception:
                return []
            if r.status_code == 200:
                try:
                    return r.json()
                except Exception:
                    return []
            if r.status_code == 429:
                time.sleep(1.0 + attempt)
                continue
            return []
        return []

    @staticmethod
    def _is_acceptable(post: dict) -> bool:
        rating = str(post.get("rating") or "").lower()
        if rating and rating not in _GOOD_RATINGS:
            return False
        tag_string = set((post.get("tag_string") or "").split())
        if tag_string & _BAD_TAGS:
            return False
        return True

    def fetch_image_urls(
        self, candidate_tags: list[str], limit: int
    ) -> tuple[list[str], str | None]:
        """Try candidate tags in order. Returns (urls, matched_tag) or ([], None).

        Each response is post-filtered to drop manga/monochrome/NSFW entries.
        """
        for tag in candidate_tags:
            posts = self._search(tag, limit)
            if not posts:
                continue
            urls: list[str] = []
            for p in posts:
                if not self._is_acceptable(p):
                    continue
                url = (
                    p.get("file_url")
                    or p.get("large_file_url")
                    or p.get("preview_file_url")
                )
                if not url:
                    continue
                ext = url.split("?")[0].rsplit(".", 1)[-1].lower()
                if ext not in {"jpg", "jpeg", "png", "webp"}:
                    continue
                if url not in urls:
                    urls.append(url)
                if len(urls) >= limit:
                    break
            if urls:
                return urls, tag
        return [], None
