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
    s, v = hsv[:, :, 1], hsv[:, :, 2]
    # [recap] 01/11: so o desenho conta, sem o fundo branco (ou preto). A
    # media da imagem inteira jogava fora a arte oficial colorida em fundo
    # branco: o perfil do Magna (Black Clover) dava 13,7 inteiro e 35,5 sem o
    # fundo. Pagina de manga continua perto de 0 dos dois jeitos.
    desenho = ~(((v > 225) & (s < 30)) | (v < 30))
    if desenho.mean() < 0.05:
        return True  # quase so fundo: nada colorido para contar
    return float(s[desenho].mean()) < saturation_threshold
