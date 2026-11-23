"""Marcações de capítulo do arquivo: abertura e encerramento sem digitar tempo.

Vários grupos de release já marcam no MKV onde ficam a abertura e o
encerramento — o DaVinci e o Premiere importam essas marcações. O FAAH corta
episódios desses grupos, e o AnCut ignorava a informação: a abertura entrava
no corte como cena, e o "Ignorar abertura" só sabia pular X segundos do
COMEÇO — que não serve quando a abertura vem depois da cena fria (no Black
Clover da VARYG ela vai de 03:35 a 04:56).

Nomes vistos no acervo dele (VARYG, CR/BILI/NF WEB-DL): "Scene 1", "Intro",
"Scene 3", "Credits", "Recap". Os padrões abaixo cobrem também os nomes
comuns de outros grupos (Opening, OP, Ending, ED, Preview, Next Episode).
Capítulo que não casa com nada é conteúdo e fica.
"""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .ffmpeg_locate import ffprobe_binary

#: (tipo, padrão no título). A ordem importa: "Opening Credits" é abertura.
_TIPOS = [
    ("OP", re.compile(r"\b(?:intro|opening|op(?:\s*\d+)?|nc\s*op|abertura|theme\s*song)\b", re.I)),
    ("ED", re.compile(r"\b(?:credits?|ending|ed(?:\s*\d+)?|nc\s*ed|outro|encerramento|cr[eé]ditos)\b", re.I)),
    ("RECAP", re.compile(r"\b(?:recap|previously|resumo|recapitula[cç][aã]o)\b", re.I)),
    ("PREVIEW", re.compile(r"\b(?:preview|next\s*episode|next\s*time|yokoku|pr[oó]ximo\s*epis[oó]dio|pr[eé]via)\b", re.I)),
]

#: O que é pulado por padrão. Recapitulação e prévia também: são cenas de
#: OUTRO episódio, e cortadas aqui virariam clipe repetido no acervo.
PULADOS = frozenset({"OP", "ED", "RECAP", "PREVIEW"})


@dataclass
class Capitulo:
    titulo: str
    inicio: float
    fim: float
    tipo: str  # "OP", "ED", "RECAP", "PREVIEW" ou "" (conteúdo)

    def payload(self) -> dict:
        return {"title": self.titulo, "start": round(self.inicio, 3),
                "end": round(self.fim, 3), "kind": self.tipo}


def tipo_do_titulo(titulo: str) -> str:
    for tipo, padrao in _TIPOS:
        if padrao.search(titulo or ""):
            return tipo
    return ""


def ler_capitulos(video: str | Path) -> list[Capitulo]:
    """Os capítulos do arquivo, em ordem. Vazio se não tiver ou o ffprobe falhar."""
    try:
        r = subprocess.run(
            [ffprobe_binary(), "-v", "error", "-show_chapters", "-of", "json", str(video)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        dados = json.loads(r.stdout or "{}")
    except Exception:
        return []
    out: list[Capitulo] = []
    for ch in dados.get("chapters") or []:
        try:
            inicio, fim = float(ch["start_time"]), float(ch["end_time"])
        except (KeyError, TypeError, ValueError):
            continue
        if fim <= inicio:
            continue
        titulo = str((ch.get("tags") or {}).get("title") or "")
        out.append(Capitulo(titulo, inicio, fim, tipo_do_titulo(titulo)))
    out.sort(key=lambda c: c.inicio)
    return out


def trechos_pulados(capitulos: list[Capitulo]) -> list[tuple[float, float, str]]:
    """(início, fim, tipo) de cada capítulo que sai do corte.

    Arquivo que é TODO abertura (ou todo encerramento) não pula nada: ali a
    abertura é o conteúdo — é o caso de quem analisa uma OP avulsa.
    """
    pulados = [(c.inicio, c.fim, c.tipo) for c in capitulos if c.tipo in PULADOS]
    if pulados and len(pulados) == len(capitulos):
        return []
    return pulados


def fora_dos_trechos(inicio: float, fim: float, trechos: list[tuple[float, float, str]]) -> bool:
    """A cena fica? Sai quando mais da metade dela cai num trecho pulado.

    Metade, e não "encostou": a marcação vem em segundos inteiros e o corte de
    cena raramente cai no mesmo quadro — a cena que começa meio segundo antes
    do fim da abertura é do episódio, não dela.
    """
    dur = max(fim - inicio, 1e-6)
    dentro = sum(max(0.0, min(fim, b) - max(inicio, a)) for a, b, _ in trechos)
    return dentro / dur <= 0.5
