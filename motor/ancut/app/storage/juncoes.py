"""Cenas juntadas à mão continuam juntas depois da reanálise.

O detector às vezes parte uma cena em duas (um flash, uma tremida, um fade),
e o "Juntar" emenda os clipes. Mas a reanálise lê os cortes do cache
(`shot_bounds.json`), que não sabe de junção nenhuma: os pedaços voltavam
separados e o clipe juntado ficava sobrando na pasta.

Ideia do Corte Cenas do Levi: a junção é guardada por TEMPO, não por número
de cena, em `metadata/juncoes.json` do próprio episódio. Depois que os
cortes são lidos, toda cena cujo meio cai numa janela juntada vira uma só,
com o número da PRIMEIRA — ninguém é renumerado, porque a curadoria é
guardada por número e juntar duas cenas não pode mudar a identidade das
outras trezentas.
"""

from __future__ import annotations

import json
from pathlib import Path

#: Folga pra uma fronteira que andou um nadinha (arredondamento de tempo).
FOLGA = 0.05


def _arquivo(raiz: Path) -> Path:
    return raiz / "metadata" / "juncoes.json"


def ler(raiz: Path) -> list[dict]:
    try:
        dados = json.loads(_arquivo(raiz).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [j for j in dados if isinstance(j, dict) and "inicio" in j and "fim" in j] if isinstance(dados, list) else []


def registrar(raiz: Path, inicio: float, fim: float, de: int, ate: int, arquivo: str) -> None:
    """Anota a junção. Janelas que se encostam viram uma (juntar A+B e depois
    o resultado com C dá A+B+C), com o arquivo da junção mais nova."""
    janelas = ler(raiz)
    nova = {"inicio": float(inicio), "fim": float(fim), "de": int(de), "ate": int(ate), "arquivo": arquivo}
    fica = []
    for j in janelas:
        if j["fim"] + FOLGA >= nova["inicio"] and nova["fim"] + FOLGA >= j["inicio"]:
            nova["inicio"] = min(nova["inicio"], float(j["inicio"]))
            nova["fim"] = max(nova["fim"], float(j["fim"]))
            nova["de"] = min(nova["de"], int(j.get("de", nova["de"])))
            nova["ate"] = max(nova["ate"], int(j.get("ate", nova["ate"])))
        else:
            fica.append(j)
    fica.append(nova)
    fica.sort(key=lambda j: j["inicio"])
    arq = _arquivo(raiz)
    arq.parent.mkdir(parents=True, exist_ok=True)
    tmp = arq.with_name(arq.name + ".tmp")
    tmp.write_text(json.dumps(fica, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(arq)


def aplicar(shots: list, janelas: list[dict]) -> list:
    """Colapsa em UMA cena cada grupo de cenas cujo meio cai numa janela."""
    if not shots or not janelas:
        return shots
    from ..shot_detection import ShotBounds

    def janela_de(s) -> int | None:
        meio = (s.start + s.end) / 2
        for i, j in enumerate(janelas):
            if j["inicio"] - FOLGA <= meio <= j["fim"] + FOLGA:
                return i
        return None

    saida: list = []
    atual: tuple[int, object] | None = None   # (janela, ShotBounds em montagem)
    for s in shots:
        w = janela_de(s)
        if w is not None and atual is not None and atual[0] == w:
            atual[1].end = max(atual[1].end, s.end)
            continue
        novo = ShotBounds(idx=s.idx, start=s.start, end=s.end)
        saida.append(novo)
        atual = (w, novo) if w is not None else None
    return saida


def preparar_arquivos(shots_dir: Path, janelas: list[dict]) -> None:
    """O clipe juntado ("0012-0014.mp4") vira o clipe da cena ("0012.mp4")
    antes do corte: aí a reanálise o reaproveita em vez de cortar de novo, e
    não sobra arquivo duplicado na pasta."""
    for j in janelas:
        origem = shots_dir / str(j.get("arquivo") or "")
        destino = shots_dir / f"{int(j.get('de', -1)):04d}.mp4"
        if origem.name and origem.is_file() and not destino.exists():
            try:
                origem.replace(destino)
            except OSError:
                pass
