from __future__ import annotations

import hashlib
from pathlib import Path

import httpx

_HEADERS = {
    "User-Agent": "CorteCenas/0.1 (+https://example.local)",
    "Accept": "image/*",
}


def _name_for(url: str) -> str:
    ext = Path(url.split("?")[0]).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        ext = ".jpg"
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    return f"{h}{ext}"


def download_to(url: str, dest_dir: Path, client: httpx.Client | None = None) -> Path | None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    name = _name_for(url)
    dest = dest_dir / name
    if dest.exists() and dest.stat().st_size > 0:
        return dest

    owns = client is None
    c = client or httpx.Client(timeout=20.0, headers=_HEADERS, follow_redirects=True)
    try:
        r = c.get(url)
        if r.status_code != 200 or not r.content:
            return None
        dest.write_bytes(r.content)
        return dest
    except Exception:
        return None
    finally:
        if owns:
            c.close()
