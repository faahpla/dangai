"""Uma foto por personagem, pra tela de batismo da Descoberta.

Quem batiza nem sempre sabe o nome de cabeça. A tela mostrava "parece
Maomao" em texto, e o elenco era um autocompletar de nomes — pra quem não
lembra quem é a Xiaolan, nenhum dos dois ajuda. Com o rosto do lado, é bater
o olho e clicar.

**Qual foto.** Primeiro um recorte tirado do próprio anime (`auto_*`, que o
"Reforçar refs" e a Descoberta gravam): é o mesmo traço dos recortes do
grupo, comparar é imediato. Sem ele, o retrato do catálogo (AniList/MAL, o
arquivo com nome de hash). Sem nenhum dos dois e com o anime resolvido
online, baixa a primeira imagem do catálogo — uma por personagem, uma vez:
fica na pasta de refs e serve pra sempre.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .image_downloader import download_to
from .image_filters import HASH_FILENAME, PLACEHOLDERS
from .reference_store import ReferenceStore

_IMAGENS = {".jpg", ".jpeg", ".png", ".webp"}


def foto_do_personagem(store: ReferenceStore, cache_id: str, nome: str) -> Path | None:
    d = store.character_dir(cache_id, nome)
    if not d.is_dir():
        return None
    arquivos = sorted(
        p for p in d.iterdir()
        if p.is_file() and p.suffix.lower() in _IMAGENS and p.name.lower() not in PLACEHOLDERS
    )
    do_anime = [p for p in arquivos if p.name.lower().startswith("auto")]
    catalogo = [p for p in arquivos if HASH_FILENAME.match(p.name)]
    for lista in (do_anime, catalogo, arquivos):
        if lista:
            return lista[0]
    return None


def preparar_elenco(
    store: ReferenceStore,
    cache_id: str,
    nomes: list[str],
    urls: dict[str, str],
    destino: Path,
    base: Path,
) -> list[dict]:
    """[{name, photo}] com `photo` relativo a `base` ("" sem foto).

    As fotos são copiadas (reduzidas) pra `destino`, dentro da pasta do
    episódio: a tela já tem permissão de mostrar o que está lá, e a pasta de
    refs fica no AppData, fora do que o app serve.
    """
    destino.mkdir(parents=True, exist_ok=True)
    for velho in destino.glob("*.jpg"):
        velho.unlink(missing_ok=True)
    saida: list[dict] = []
    vistos: set[str] = set()
    for i, nome in enumerate(nomes):
        if not nome or nome.lower() in vistos:
            continue
        vistos.add(nome.lower())
        foto = foto_do_personagem(store, cache_id, nome)
        if foto is None and urls.get(nome) and "/default." not in urls[nome]:
            try:
                foto = download_to(urls[nome], store.character_dir(cache_id, nome))
            except Exception:
                foto = None
        rel = ""
        if foto is not None:
            # fromfile/imdecode e não imread: o OpenCV no Windows não abre
            # caminho com acento ("Diários de uma Apotecária"), e devolve
            # None calado.
            try:
                img = cv2.imdecode(np.fromfile(str(foto), dtype=np.uint8), cv2.IMREAD_COLOR)
            except OSError:
                img = None
            if img is not None:
                h, w = img.shape[:2]
                esc = 160 / max(h, w)
                if esc < 1:
                    img = cv2.resize(img, (int(w * esc), int(h * esc)), interpolation=cv2.INTER_AREA)
                alvo = destino / f"p{i:03d}.jpg"
                ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])
                if ok:
                    buf.tofile(str(alvo))
                    rel = alvo.relative_to(base).as_posix()
        saida.append({"name": nome, "photo": rel})
    return saida
