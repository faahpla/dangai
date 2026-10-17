"""Pack a delta update zip from the current PyInstaller build.

The full installer (~2 GB) ships torch, PySide6, FFmpeg, CUDA DLLs — all of
which rarely change between minor versions. The delta zip contains ONLY the
files that typically move version-to-version:

  - CorteCenas.exe          (bootstrap + our Python code, ~56 MB)
  - _internal/app/          (icons, assets, apply_update.ps1)

Everything else stays as-is from the previous install, so the update download
is ~60 MB instead of ~2 GB. If the user is on a much older version and needs
a runtime bump too, the updater falls back to the full setup.exe.

Called by _build_all.bat after PyInstaller finishes, before Inno Setup runs.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist" / "CorteCenas"
RELEASES = ROOT / "releases"

# Whitelist of paths (relative to DIST) that go into the delta zip.
# Everything else stays untouched on the target machine.
DELTA_ROOTS = [
    "CorteCenas.exe",
    "_internal/app",
    "_internal/apply_update.ps1",
]


def _load_version() -> str:
    text = (ROOT / "app" / "__init__.py").read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.strip().startswith("__version__"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("version string not found in app/__init__.py")


def _iter_files(base: Path) -> list[Path]:
    if base.is_file():
        return [base]
    return [p for p in base.rglob("*") if p.is_file()]


def main() -> int:
    if not DIST.exists():
        print(f"[pack_delta] {DIST} missing — run PyInstaller first.", file=sys.stderr)
        return 1
    RELEASES.mkdir(parents=True, exist_ok=True)

    version = _load_version()
    zip_path = RELEASES / f"CorteCenas-Update-{version}.zip"
    if zip_path.exists():
        zip_path.unlink()

    total_bytes = 0
    file_count = 0
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in DELTA_ROOTS:
            src = DIST / rel
            if not src.exists():
                print(f"[pack_delta] WARNING: {rel} not in dist, skipping")
                continue
            for f in _iter_files(src):
                arcname = f.relative_to(DIST).as_posix()
                zf.write(f, arcname)
                total_bytes += f.stat().st_size
                file_count += 1

    zip_size_mb = zip_path.stat().st_size / 1e6
    raw_size_mb = total_bytes / 1e6
    print(f"[pack_delta] {zip_path.name}")
    print(f"[pack_delta] {file_count} files, {raw_size_mb:.1f} MB raw -> {zip_size_mb:.1f} MB zipped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
