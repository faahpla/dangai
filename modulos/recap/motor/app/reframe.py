from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import ffmpeg
import numpy as np

from .ffmpeg_locate import run_ffmpeg_hidden
from .matching.face_detector import AnimeFaceDetector


@dataclass
class ReframeTarget:
    width: int = 1080
    height: int = 1920

    @property
    def aspect(self) -> float:
        return self.width / self.height


def compute_crop_window(
    face_center_x: float,
    source_w: int,
    source_h: int,
    target: ReframeTarget,
) -> tuple[int, int, int, int]:
    """Return (x_start, y_start, crop_w, crop_h) for a vertical slice of the
    source that keeps full source height and centers horizontally on the face.
    """
    crop_h = source_h
    crop_w = int(round(source_h * target.aspect))
    if crop_w > source_w:
        # Source is narrower than the target aspect; fall back to full width.
        crop_w = source_w
    x_start = int(round(face_center_x - crop_w / 2))
    x_start = max(0, min(source_w - crop_w, x_start))
    return x_start, 0, crop_w, crop_h


def _face_from_image(
    img, detector: AnimeFaceDetector, min_size_ratio: float = 0.05
) -> tuple[float, int, int] | None:
    """Return (face_cx, w, h) if a face is found whose height is at least
    `min_size_ratio` of the image height. Filters out small false positives
    that plague lbpcascade_animeface (stone statues, rocks, anime eyes on
    objects, etc.).
    """
    if img is None or img.size == 0:
        return None
    h, w = img.shape[:2]
    min_face_h = max(24, int(h * min_size_ratio))
    faces = [f for f in detector.detect(img) if f[3] >= min_face_h]
    if not faces:
        return None
    x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
    return (x + fw / 2.0, w, h)


def _motion_center(shot_file: Path, samples: int = 6) -> tuple[float, int, int] | None:
    """Fallback for shots without a detectable face: find the horizontal
    center of motion by differencing frames. The region that changes most
    across the shot is almost always where the main subject is.
    """
    if not shot_file.exists():
        return None
    cap = cv2.VideoCapture(str(shot_file))
    try:
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if n < 2:
            return None
        step = max(1, n // (samples + 1))
        prev = None
        accum = None
        src_w = src_h = 0
        for i in range(1, samples + 1):
            cap.set(cv2.CAP_PROP_POS_FRAMES, min(n - 1, i * step))
            ok, frame = cap.read()
            if not ok:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            if src_w == 0:
                src_h, src_w = gray.shape[:2]
            if prev is not None:
                diff = cv2.absdiff(gray, prev)
                accum = diff if accum is None else cv2.add(accum, diff)
            prev = gray
        if accum is None or accum.sum() < 1e-3:
            return None
        col_energy = accum.sum(axis=0).astype("float32")
        if col_energy.sum() < 1e-3:
            return None
        xs = np.arange(col_energy.shape[0], dtype="float32")
        center_x = float((xs * col_energy).sum() / col_energy.sum())
        return (center_x, src_w, src_h)
    finally:
        cap.release()


def pick_face_center_multi(
    shot_file: Path,
    keyframe_paths: list[Path],
    detector: AnimeFaceDetector,
    extra_frame_samples: int = 6,
) -> tuple[float, int, int] | None:
    """Layered subject-centering:

      1. Face detection across keyframes (fastest, most precise when the
         character's face is visible)
      2. Face detection sampled from the shot's mp4
      3. Motion-energy center (col-energy of inter-frame differences) — a
         reasonable fallback when the character faces away or the face
         detector simply misses
      4. Image center (last resort)
    """
    # 1) face on keyframes
    fallback: tuple[float, int, int] | None = None
    for kf in keyframe_paths:
        img = cv2.imread(str(kf))
        if img is None:
            continue
        if fallback is None:
            h, w = img.shape[:2]
            fallback = (w / 2.0, w, h)
        found = _face_from_image(img, detector)
        if found is not None:
            return found

    # 2) face on sampled frames from the shot
    if extra_frame_samples > 0 and shot_file.exists():
        cap = cv2.VideoCapture(str(shot_file))
        try:
            n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if n_frames > 1:
                step = max(1, n_frames // (extra_frame_samples + 1))
                for i in range(1, extra_frame_samples + 1):
                    cap.set(cv2.CAP_PROP_POS_FRAMES, min(n_frames - 1, i * step))
                    ok, img = cap.read()
                    if not ok or img is None:
                        continue
                    if fallback is None:
                        h, w = img.shape[:2]
                        fallback = (w / 2.0, w, h)
                    found = _face_from_image(img, detector)
                    if found is not None:
                        return found
        finally:
            cap.release()

    # 3) motion-energy center
    motion = _motion_center(shot_file)
    if motion is not None:
        return motion

    # 4) last resort — image center
    return fallback


def reframe_one(
    shot_file: Path,
    keyframe_paths: list[Path] | Path,
    out_file: Path,
    detector: AnimeFaceDetector,
    target: ReframeTarget,
) -> bool:
    """Reframe a single shot mp4 to vertical, centered on the subject.

    Uses the layered fallback in `pick_face_center_multi`:
    face -> motion -> center.
    """
    if isinstance(keyframe_paths, Path):
        keyframe_paths = [keyframe_paths]
    info = pick_face_center_multi(shot_file, list(keyframe_paths), detector)
    if info is None:
        return False
    face_x, src_w, src_h = info
    x_start, _, crop_w, crop_h = compute_crop_window(face_x, src_w, src_h, target)

    out_file.parent.mkdir(parents=True, exist_ok=True)
    if out_file.exists():
        try:
            out_file.unlink()
        except OSError:
            pass

    vf = f"crop={crop_w}:{crop_h}:{x_start}:0,scale={target.width}:{target.height}"
    try:
        stream = (
            ffmpeg
            .input(str(shot_file))
            .output(
                str(out_file),
                vf=vf,
                vcodec="libx264",
                preset="ultrafast",
                crf=20,
                acodec="copy",
                format="mp4",
                movflags="+faststart",
                loglevel="error",
            )
        )
        run_ffmpeg_hidden(stream)
        return True
    except ffmpeg.Error:
        # Some shots might not have an audio stream — retry without acodec copy.
        try:
            stream = (
                ffmpeg
                .input(str(shot_file))
                .output(
                    str(out_file),
                    vf=vf,
                    vcodec="libx264",
                    preset="ultrafast",
                    crf=20,
                    an=None,
                    format="mp4",
                    movflags="+faststart",
                    loglevel="error",
                )
            )
            run_ffmpeg_hidden(stream)
            return True
        except ffmpeg.Error:
            return False


def reframe_character(
    episode_root: Path,
    character_name: str,
    shot_rows: list[dict],
    detector: AnimeFaceDetector,
    target: ReframeTarget,
    on_progress: Callable[[int, int], None] | None = None,
) -> tuple[Path, int, int]:
    """Reframe all shots for one character. Returns (output_folder, ok, total)."""
    from .storage.organizer import sanitize
    out_dir = episode_root / "vertical" / sanitize(character_name)
    out_dir.mkdir(parents=True, exist_ok=True)

    total = len(shot_rows)
    ok = 0
    for i, row in enumerate(shot_rows, 1):
        shot_file = episode_root / row["file"]
        if not shot_file.exists():
            continue
        # Collect keyframes, middle first so the crop matches the central
        # framing when a face is visible there.
        kf_candidates: list[Path] = []
        kf_rel = row.get("keyframe")
        if kf_rel:
            kf_main = episode_root / kf_rel
            kf_dir = kf_main.parent
            stem = kf_main.stem  # e.g. "0042_1"
            base = stem.rsplit("_", 1)[0] if "_" in stem else stem
            siblings = sorted(kf_dir.glob(f"{base}_*.jpg"))
            if kf_main in siblings:
                kf_candidates.append(kf_main)
            for p in siblings:
                if p not in kf_candidates:
                    kf_candidates.append(p)
            if not kf_candidates and kf_main.exists():
                kf_candidates = [kf_main]
        if not kf_candidates:
            continue
        out_file = out_dir / shot_file.name
        if out_file.exists() and out_file.stat().st_size > 0:
            ok += 1
        else:
            if reframe_one(shot_file, kf_candidates, out_file, detector, target):
                ok += 1
        if on_progress:
            on_progress(i, total)
    return out_dir, ok, total
