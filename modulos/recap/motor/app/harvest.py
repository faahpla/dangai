"""Reinforce character refs by harvesting face crops from the shots the
pipeline classified with very high confidence. The current episode's best
matches become additional reference images for the next run.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from .matching.embedding_engine import EmbeddingEngine, from_bytes
from .matching.face_detector import AnimeFaceDetector
from .references.reference_store import ReferenceStore
from .storage.db import Database


def harvest_best_crops_for_character(
    episode_root: Path,
    episode_id: int,
    character_id: int,
    character_name: str,
    ref_dir: Path,
    db: Database,
    face_det: AnimeFaceDetector,
    engine: EmbeddingEngine,
    conf_threshold: float = 0.90,
    max_new_refs: int = 3,
    dedup_cosine: float = 0.95,
) -> int:
    """For one character, pick up to `max_new_refs` face crops from the
    highest-confidence shots of THIS episode and save them as new refs.

    Duplicates (very similar face crops) are skipped so we don't just add
    three near-identical crops of the same scene.
    """
    with db.connect() as c:
        rows = c.execute(
            """SELECT s.id, s.idx, s.file, s.keyframe, s.start, s.end,
                      sc.confidence
               FROM shot s
               JOIN shot_character sc ON sc.shot_id = s.id
               WHERE sc.character_id = ?
                 AND s.episode_id = ?
                 AND sc.confidence >= ?
               ORDER BY sc.confidence DESC""",
            (character_id, episode_id, conf_threshold),
        ).fetchall()
    shots = [dict(r) for r in rows]
    if not shots:
        return 0

    # load centroid
    with db.connect() as c:
        row = c.execute(
            "SELECT embedding FROM character WHERE id = ?", (character_id,)
        ).fetchone()
        if not row or not row["embedding"]:
            return 0
        centroid = from_bytes(row["embedding"]).astype(np.float32)

    candidates: list[tuple[float, np.ndarray, int]] = []  # (score, crop, shot_idx)
    for s in shots[: max_new_refs * 5]:  # pool for scoring
        kf_rel = s.get("keyframe")
        if not kf_rel:
            continue
        kf = episode_root / kf_rel
        if not kf.exists():
            continue
        img = cv2.imread(str(kf))
        if img is None:
            continue
        crops = face_det.crop_faces(img)
        if not crops:
            continue
        embs = engine.embed_images(crops)
        if embs.size == 0:
            continue
        sims = embs @ centroid
        best_idx = int(np.argmax(sims))
        score = float(sims[best_idx])
        if score < conf_threshold:
            continue
        candidates.append((score, crops[best_idx], int(s["idx"])))

    candidates.sort(key=lambda x: x[0], reverse=True)

    # Dedup: don't save two near-identical new refs
    kept_embs: list[np.ndarray] = []
    added = 0
    ref_dir.mkdir(parents=True, exist_ok=True)
    for score, crop, shot_idx in candidates:
        if added >= max_new_refs:
            break
        new_emb = engine.embed_images([crop])
        if new_emb.size == 0:
            continue
        ne = new_emb[0]
        if kept_embs:
            kept = np.stack(kept_embs, axis=0)
            sims = kept @ ne
            if float(sims.max()) >= dedup_cosine:
                continue
        fname = f"auto_{shot_idx:04d}_{int(score*100):02d}.jpg"
        out = ref_dir / fname
        if out.exists():
            continue
        if cv2.imwrite(str(out), crop):
            kept_embs.append(ne)
            added += 1
    return added


def harvest_all_characters(
    episode_root: Path,
    episode_id: int,
    anime_cache_id: str,
    db: Database,
    ref_store: ReferenceStore,
    face_det: AnimeFaceDetector,
    engine: EmbeddingEngine,
    conf_threshold: float = 0.90,
    max_new_refs_per_char: int = 3,
    on_progress: Callable[[str, int, int], None] | None = None,
) -> dict[str, int]:
    """Run harvest for every character that has high-confidence shots in
    THIS episode. Returns {character_name: refs_added}.
    """
    with db.connect() as c:
        rows = c.execute(
            """SELECT DISTINCT c.id, c.name
               FROM character c
               JOIN shot_character sc ON sc.character_id = c.id
               JOIN shot s ON s.id = sc.shot_id
               WHERE s.episode_id = ? AND sc.confidence >= ?
               ORDER BY c.name""",
            (episode_id, conf_threshold),
        ).fetchall()
    chars = [dict(r) for r in rows]
    print(
        f"[harvest] Episode {episode_id}: {len(chars)} personagens com "
        f"shots ≥{conf_threshold:.2f}",
        flush=True,
    )

    results: dict[str, int] = {}
    total = len(chars)
    for i, ch in enumerate(chars, 1):
        if on_progress:
            on_progress(ch["name"], i, total)
        ref_dir = ref_store.character_dir(anime_cache_id, ch["name"])
        try:
            added = harvest_best_crops_for_character(
                episode_root,
                episode_id,
                ch["id"],
                ch["name"],
                ref_dir,
                db,
                face_det,
                engine,
                conf_threshold=conf_threshold,
                max_new_refs=max_new_refs_per_char,
            )
        except Exception as e:
            print(f"[harvest] {ch['name']}: erro — {e}", flush=True)
            continue
        if added > 0:
            results[ch["name"]] = added
            print(f"[harvest] {ch['name']}: +{added} refs", flush=True)
        else:
            print(f"[harvest] {ch['name']}: +0 (nenhum shot ≥{conf_threshold:.2f} com rosto)", flush=True)
    return results
