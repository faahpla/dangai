"""[Studio] cv2.imread / cv2.imwrite que aceitam acento no caminho (Windows).

Por que: o OpenCV 5 do lock (opencv-python 5.0.0.93) abre o arquivo pela API
ANSI do Windows. Com acento no caminho (um usuario do Windows com acento no
nome, ou um anime com acento no nome da pasta), o cv2.imwrite devolve False e
o cv2.imread devolve None, SEM erro: os keyframes nao sao gravados, as fotos
do elenco nao sao lidas, e o episodio termina sem nenhum personagem e sem
aviso. O ffmpeg e o cv2.VideoCapture aceitam o acento, entao o corte sai
normal e esconde o problema. Medido no venv do motor: com a pasta "Usuario"
os 3 keyframes existem; com o mesmo nome acentuado voltam 3 caminhos e nenhum
arquivo.

O jeito e o mesmo do app/rostos.py: np.fromfile + cv2.imdecode para ler e
cv2.imencode + tofile para gravar (o Python abre o arquivo pela API larga).
Caminho so ASCII continua no cv2 de sempre: o resultado nas pastas do Levi e
byte a byte o do upstream.

Instalado UMA vez no inicio do `app.headless` (main), antes de qualquer modo:
os modulos do motor chamam `cv2.imread(...)` pelo atributo do modulo, entao a
troca vale para todos (pipeline, keyframe_extractor, references, matching).
Levar ao ancut-hub-engine (o Corte Cenas tem o mesmo limite).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

_instalado = False


def _ascii(caminho: Any) -> bool:
    try:
        str(caminho).encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def instalar() -> None:
    """Troca cv2.imread/cv2.imwrite pelas versoes que aceitam acento. Idempotente."""
    global _instalado
    if _instalado:
        return
    import cv2
    import numpy as np

    imread_original = cv2.imread
    imwrite_original = cv2.imwrite

    def imread(caminho: Any, flags: int = cv2.IMREAD_COLOR, *args: Any, **kwargs: Any):  # type: ignore[no-untyped-def]
        if _ascii(caminho):
            return imread_original(caminho, flags, *args, **kwargs)
        try:
            dados = np.fromfile(str(caminho), dtype=np.uint8)
        except OSError:
            # O mesmo contrato do cv2: arquivo que nao abre = None, sem excecao.
            return None
        if dados.size == 0:
            return None
        return cv2.imdecode(dados, flags)

    def imwrite(caminho: Any, img: Any, params: Any = None, *args: Any, **kwargs: Any) -> bool:  # type: ignore[no-untyped-def]
        if _ascii(caminho):
            if params is None:
                return imwrite_original(caminho, img, *args, **kwargs)
            return imwrite_original(caminho, img, params, *args, **kwargs)
        ext = Path(str(caminho)).suffix or ".png"
        ok, buf = cv2.imencode(ext, img, [] if params is None else list(params))
        if not ok:
            return False
        try:
            buf.tofile(str(caminho))
        except OSError:
            return False
        return True

    cv2.imread = imread  # type: ignore[assignment]
    cv2.imwrite = imwrite  # type: ignore[assignment]
    _instalado = True
