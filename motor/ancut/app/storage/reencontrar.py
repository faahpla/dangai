"""Reencontrar episódios cuja pasta mudou de lugar.

O banco guarda o caminho de cada episódio (`output_root`). Quando a pessoa
move a pasta do anime pelo Explorer — o Ajk reorganiza o acervo em
`E:\\work\\avatar cuts\\…` —, o caminho gravado passa a apontar pro nada, e a
Biblioteca esconde o episódio (só conta "N sem pasta"). Os clipes, os
personagens, a curadoria: tudo intacto, no banco e no disco, só desligados.

Aqui as pastas de episódio são procuradas onde a biblioteca mora e o caminho
é religado. Nada é movido nem apagado; só o caminho no banco muda.

**Como uma pasta é reconhecida.** Primeiro pelo vídeo de origem: cada pasta
guarda em `metadata/shot_bounds.json` o caminho do vídeo de onde saiu, e o
banco guarda o mesmo — é a identidade mais forte que existe. Sem ele (pasta
antiga), pelo par nome da pasta do anime + nome do episódio (`S01E05`), e só
quando há UMA candidata: com duas, adivinhar erraria em silêncio.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .db import Database
from .recovery import _bounds_source, _slug_parts


@dataclass
class Religacao:
    religados: list[dict] = field(default_factory=list)
    sem_pasta: int = 0
    raizes: list[str] = field(default_factory=list)

    def payload(self) -> dict:
        return {
            "religados": self.religados,
            "semPasta": self.sem_pasta,
            "raizes": self.raizes,
        }


def _eh_episodio(p: Path) -> bool:
    if _slug_parts(p.name) is None:
        return False
    m = p / "metadata"
    return (m / "shots.json").is_file() or (m / "shot_bounds.json").is_file()


def pastas_de_episodio(raizes: list[Path]) -> list[Path]:
    """Toda pasta de episódio em `raiz/anime/S01E01` — ou `raiz/S01E01`,
    quando a pessoa aponta a pasta do próprio anime."""
    achadas: dict[str, Path] = {}
    for raiz in raizes:
        try:
            filhos = [p for p in raiz.iterdir() if p.is_dir()]
        except OSError:
            continue
        for filho in filhos:
            if _eh_episodio(filho):
                achadas[str(filho).lower()] = filho
                continue
            try:
                netos = [p for p in filho.iterdir() if p.is_dir()]
            except OSError:
                continue
            for neto in netos:
                if _eh_episodio(neto):
                    achadas[str(neto).lower()] = neto
    return list(achadas.values())


def raizes_da_biblioteca(db: Database, saida: Path, extras: list[Path]) -> list[Path]:
    """Onde a biblioteca mora: a pasta de saída, as pastas escolhidas, e a
    "avó" de cada episódio que ainda está no lugar — a pasta que contém as
    pastas de anime. É ela que pega o caso comum: a pessoa leva parte do
    acervo pra uma pasta nova onde outros episódios já estão."""
    vistas: dict[str, Path] = {}

    def add(p: Path) -> None:
        if p.is_dir():
            vistas.setdefault(str(p.resolve()).lower(), p)

    add(saida)
    for e in extras:
        add(e)
        add(e.parent)  # apontou a pasta do anime: a raiz é a de cima
    for r in db.all_episode_roots():
        root = Path(str(r["output_root"] or ""))
        if root.name and root.is_dir():
            add(root.parent.parent)
    return list(vistas.values())


def religar(db: Database, saida: Path, extras: list[Path]) -> Religacao:
    out = Religacao()
    raizes = raizes_da_biblioteca(db, saida, extras)
    out.raizes = [str(r) for r in raizes]

    with db.connect() as c:
        linhas = [
            dict(r) for r in c.execute(
                "SELECT e.id, e.season, e.episode, e.kind, e.source_file, e.output_root "
                "FROM episode e WHERE e.output_root IS NOT NULL"
            )
        ]
    perdidos = [r for r in linhas if not Path(str(r["output_root"])).is_dir()]
    if not perdidos:
        return out

    # Pastas que já pertencem a um episódio no lugar não podem ser
    # "reencontradas" por outro.
    ocupadas = {
        str(r["output_root"]).rstrip("\\/").lower()
        for r in linhas if Path(str(r["output_root"])).is_dir()
    }
    candidatas = [
        p for p in pastas_de_episodio(raizes) if str(p).lower() not in ocupadas
    ]

    por_fonte: dict[str, list[Path]] = {}
    por_nome: dict[tuple[str, str], list[Path]] = {}
    for p in candidatas:
        fonte = _bounds_source(p)
        if fonte:
            por_fonte.setdefault(fonte.lower(), []).append(p)
        por_nome.setdefault((p.parent.name.lower(), p.name.lower()), []).append(p)

    usadas: set[str] = set()
    for r in perdidos:
        antigo = Path(str(r["output_root"]))
        achou: Path | None = None
        fonte = str(r["source_file"] or "").lower()
        if fonte and len(por_fonte.get(fonte, [])) == 1:
            achou = por_fonte[fonte][0]
        else:
            nomes = por_nome.get((antigo.parent.name.lower(), antigo.name.lower()), [])
            # Duas pastas com o mesmo anime/S01E05 e sem vídeo de origem pra
            # desempatar: não chuta.
            if len(nomes) == 1 and not (fonte and _bounds_source(nomes[0])
                                        and _bounds_source(nomes[0]).lower() != fonte):
                achou = nomes[0]
        if achou is None or str(achou).lower() in usadas:
            out.sem_pasta += 1
            continue
        usadas.add(str(achou).lower())
        db.set_episode_root(int(r["id"]), str(achou))
        out.religados.append({"episodeId": int(r["id"]), "de": str(antigo), "para": str(achou)})
    return out
