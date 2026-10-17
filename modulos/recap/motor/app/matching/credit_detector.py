from __future__ import annotations

import cv2
import numpy as np


def _text_like_stats(img_bgr: np.ndarray) -> tuple[float, int]:
    """Returns (text_area_fraction, text_component_count).

    Uses adaptive threshold + horizontal morphological close to merge text
    strokes into lines, then filters connected components by size/aspect
    so non-text detail (e.g. big contours) doesn't dominate.
    """
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    bw = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 5
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (8, 1))
    lines = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, kernel)
    n, _, stats, _ = cv2.connectedComponentsWithStats(lines, 8)
    area_total = 0
    count = 0
    img_area = float(h * w)
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        cw = stats[i, cv2.CC_STAT_WIDTH]
        ch = stats[i, cv2.CC_STAT_HEIGHT]
        if area < 25 or area > img_area * 0.08:
            continue
        if ch < 5 or ch > h * 0.08:
            continue
        if cw / max(ch, 1) < 1.5:
            continue
        area_total += area
        count += 1
    return area_total / img_area, count


def credit_score(img_bgr: np.ndarray) -> float:
    """Combined score: text_area_fraction * text_component_count.

    Credit-heavy frames (long vertical/horizontal text blocks) score ~0.25+.
    Normal anime scenes sit under ~0.17 on the validation set.
    """
    area_frac, count = _text_like_stats(img_bgr)
    return float(area_frac * count)


def is_credits_frame(img_bgr: np.ndarray, threshold: float) -> bool:
    return credit_score(img_bgr) >= threshold
