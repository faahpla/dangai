from __future__ import annotations

import re

import cv2
import numpy as np


# Files saved by image_downloader are named <sha1[:16]>.<ext>. Anything else
# in a character folder is user-added and should be preserved as-is.
HASH_FILENAME = re.compile(r"^[0-9a-f]{16}\.(?:jpg|jpeg|png|webp)$", re.IGNORECASE)


def is_monochrome(img_bgr: np.ndarray, saturation_threshold: float = 18.0) -> bool:
    """Heuristic: HSV saturation mean below threshold → monochrome/manga panel.

    Color anime screenshots typically have mean saturation 60-150. Manga
    scans sit near 0-10 even when not perfectly grayscale (paper tone).
    """
    if img_bgr is None or img_bgr.size == 0:
        return False
    if img_bgr.ndim == 2:
        return True
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    return float(hsv[:, :, 1].mean()) < saturation_threshold
