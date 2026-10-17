from __future__ import annotations

import re
from pathlib import Path

import shutil

import cv2
import httpx

from ..providers.anime_provider import AnimeBundle, CharacterRef
from .image_downloader import _HEADERS, _name_for, download_to
from .image_filters import HASH_FILENAME, is_monochrome


_SAFE = re.compile(r'[<>:"/\\|?*]')


def _slug(name: str) -> str:
    return _SAFE.sub("_", name).strip() or "unknown"


def slug_for(name: str) -> str:
    """Nome de pasta de um personagem (público — o pipeline usa pra casar
    pastas locais com o elenco online)."""
    return _slug(name)


def resolve_anime_dir(cache_root: Path, cache_id: str) -> Path:
    """Return the on-disk folder for this cache_id.

    Folders use the format ``<title> [al<id>]`` (or legacy ``al<id>``).
    We scan and match by the ``[al<id>]`` suffix so any title is fine.
    """
    root = Path(cache_root) / "anime_db"
    suffix = f"[{cache_id}]"
    if root.exists():
        for p in root.iterdir():
            if p.is_dir() and p.name.endswith(suffix):
                return p
    return root / cache_id


class ReferenceStore:
    """Downloads and caches reference images per character for an anime.

    Layout:
        <cache>/anime_db/<title> [al<id>]/characters/<slug>/<hash>.jpg
    """

    def __init__(self, cache_root: Path) -> None:
        self.root = Path(cache_root) / "anime_db"

    def anime_dir(self, cache_id: str) -> Path:
        return resolve_anime_dir(self.root.parent, cache_id)

    def character_dir(self, cache_id: str, character_name: str) -> Path:
        """Pasta do personagem — REUSANDO uma existente que seja a mesma
        pessoa escrita de outro jeito ("Tempest, Rimuru" ≡ "Rimuru Tempest",
        "Rimuru" batizado ⊂ "Rimuru Tempest" quando inambíguo). Sem isso,
        cada fonte que 'vencia' num dia criava a própria pasta e o banco de
        refs se fragmentava."""
        chars_root = self.anime_dir(cache_id) / "characters"
        exact = chars_root / _slug(character_name)
        if exact.exists():
            return exact
        if chars_root.exists():
            from ..naming import find_token_match
            existing = [
                d.name for d in chars_root.iterdir()
                if d.is_dir() and not d.name.startswith("_")
            ]
            match = find_token_match(character_name, existing)
            if match is not None:
                return chars_root / match
        return exact

    def ensure_references(
        self,
        cache_id: str,
        bundle: AnimeBundle,
        on_status: callable | None = None,
    ) -> dict[str, list[Path]]:
        """Download any URL that isn't already on disk. Never short-circuits
        on "folder has files" — that was masking newly-added sources like
        Danbooru when a Jikan-only version was cached.
        """
        out: dict[str, list[Path]] = {}
        with httpx.Client(timeout=20.0, follow_redirects=True, headers=_HEADERS) as client:
            for i, ch in enumerate(bundle.characters, 1):
                d = self.character_dir(cache_id, ch.name)
                filtered_dir = d / "_filtered"

                # Migrate any pre-existing monochrome files in the main folder
                # into the _filtered subfolder. One-time cleanup per run.
                if d.exists():
                    for existing in list(d.iterdir()):
                        if not existing.is_file():
                            continue
                        if existing.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                            continue
                        if not HASH_FILENAME.match(existing.name):
                            continue  # user-added, don't touch
                        img = cv2.imread(str(existing))
                        if img is not None and is_monochrome(img):
                            filtered_dir.mkdir(exist_ok=True)
                            try:
                                shutil.move(str(existing), str(filtered_dir / existing.name))
                            except OSError:
                                pass

                paths: list[Path] = []
                downloaded = 0
                filtered_mono = 0
                for url in ch.image_urls:
                    # Skip if we previously filtered this URL as monochrome.
                    name = _name_for(url)
                    if (filtered_dir / name).exists():
                        continue
                    p = download_to(url, d, client=client)
                    if p is None:
                        continue
                    downloaded += 1
                    img = cv2.imread(str(p))
                    if img is not None and is_monochrome(img):
                        filtered_mono += 1
                        filtered_dir.mkdir(exist_ok=True)
                        try:
                            shutil.move(str(p), str(filtered_dir / name))
                        except OSError:
                            pass
                        continue
                    if p not in paths:
                        paths.append(p)
                # Include any user-added local files (not matching the
                # downloader's hash filename pattern, not inside _filtered).
                if d.exists():
                    for local in d.iterdir():
                        if not local.is_file():
                            continue
                        if local.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                            continue
                        if HASH_FILENAME.match(local.name):
                            continue  # downloader's hash-named file
                        if local not in paths:
                            paths.append(local)
                out[ch.name] = paths
                if on_status:
                    suffix = f", {filtered_mono} monochrome movidos pra _filtered" if filtered_mono else ""
                    on_status(
                        f"Refs ({i}/{len(bundle.characters)}): {ch.name} "
                        f"= {len(paths)} ({downloaded} do catálogo{suffix})"
                    )
        return out

    def list_references(self, cache_id: str, character_name: str) -> list[Path]:
        d = self.character_dir(cache_id, character_name)
        if not d.exists():
            return []
        return [p for p in d.iterdir() if p.is_file()]
