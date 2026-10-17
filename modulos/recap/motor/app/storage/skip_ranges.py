from __future__ import annotations

import json
from pathlib import Path


class SkipRangesStore:
    """Persists OP/ED skip seconds keyed by anime name.

    File layout:
        <cache>/skip_ranges.json = {"Anime Name": {"head": 90, "tail": 90}}
    """

    def __init__(self, cache_root: Path) -> None:
        self.path = Path(cache_root) / "skip_ranges.json"

    def _load(self) -> dict:
        if not self.path.exists():
            return {}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def get(self, anime_name: str) -> tuple[float, float]:
        data = self._load()
        entry = data.get(anime_name, {})
        return float(entry.get("head", 0.0)), float(entry.get("tail", 0.0))

    def set(self, anime_name: str, head_seconds: float, tail_seconds: float) -> None:
        data = self._load()
        if head_seconds <= 0 and tail_seconds <= 0:
            data.pop(anime_name, None)
        else:
            data[anime_name] = {"head": float(head_seconds), "tail": float(tail_seconds)}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
