from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def write_shots_json(out_path: Path, payload: list[dict[str, Any]]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def write_characters_json(out_path: Path, characters: list[dict[str, Any]]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(characters, indent=2, ensure_ascii=False), encoding="utf-8")


def build_shot_payload(
    shot: dict,
    anime: str,
    season: int,
    episode: int,
    characters: list[dict],
) -> dict:
    pairs: list[str] = []
    names = [c["name"] for c in characters]
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = sorted([names[i], names[j]])
            pairs.append(f"{a}+{b}")
    return {
        "shot_id": f"{shot['idx']:04d}",
        "file": shot["file"],
        "keyframe": shot.get("keyframe"),
        "start": round(shot["start"], 3),
        "end": round(shot["end"], 3),
        "duration": round(shot["end"] - shot["start"], 3),
        "characters": [
            {"name": c["name"], "confidence": round(c["confidence"], 3)} for c in characters
        ],
        "pairs": pairs,
        "anime": anime,
        "season": season,
        "episode": episode,
    }
