"""Download FFmpeg release-essentials, extract ffmpeg.exe + ffprobe.exe
into ./bin/. Idempotent — re-runs skip when the two exes already exist.

Called by _build_all.bat before PyInstaller runs, so that the .exe files
get picked up as data files and land in dist/CorteCenas/bin/.

Uses gyan.dev's "release essentials" build (~80 MB zip, ~200 MB extracted
but we only keep the two binaries — final footprint ~150 MB).
"""
from __future__ import annotations

import io
import sys
import urllib.request
import zipfile
from pathlib import Path

URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

ROOT = Path(__file__).resolve().parent
BIN = ROOT / "bin"

TARGETS = ("ffmpeg.exe", "ffprobe.exe")


def already_have() -> bool:
    return all((BIN / name).exists() for name in TARGETS)


def download_and_extract() -> None:
    BIN.mkdir(parents=True, exist_ok=True)
    print(f"[fetch_ffmpeg] Downloading {URL} ...")
    with urllib.request.urlopen(URL, timeout=120) as r:
        raw = r.read()
    print(f"[fetch_ffmpeg] Downloaded {len(raw) / 1e6:.1f} MB")
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        wanted: dict[str, zipfile.ZipInfo] = {}
        for zi in zf.infolist():
            base = zi.filename.rsplit("/", 1)[-1].lower()
            if base in TARGETS and base not in wanted:
                wanted[base] = zi
        if len(wanted) != len(TARGETS):
            missing = set(TARGETS) - set(wanted)
            raise RuntimeError(f"FFmpeg zip missing expected binaries: {missing}")
        for name, zi in wanted.items():
            dest = BIN / name
            with zf.open(zi) as src, open(dest, "wb") as out:
                out.write(src.read())
            print(f"[fetch_ffmpeg] Extracted {name} -> {dest} ({dest.stat().st_size / 1e6:.1f} MB)")


def main() -> int:
    if already_have():
        print(f"[fetch_ffmpeg] Already present in {BIN}, skipping.")
        return 0
    try:
        download_and_extract()
    except Exception as e:
        print(f"[fetch_ffmpeg] FAILED: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
