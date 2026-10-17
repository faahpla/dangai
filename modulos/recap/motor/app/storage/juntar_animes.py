"""Duas pastas de anime viram uma.

Isto era um script meu, rodado à mão três vezes no acervo do usuário (Tensura,
Mushoku, Bleach). Virou código do app porque o problema não acabou: nenhuma
regra automática junta "Re Zero" com "Re Zero kara Hajimeru Isekai Seikatsu"
antes de a identidade ser conhecida, e quando escapa é ele quem tem que poder
consertar.

**Mover no mesmo volume preserva hardlink; copiar-e-apagar não.** Os clipes
existem uma vez com vários nomes (`shots/`, `by_character/`, `by_pair/`). Um
`os.rename` é rename de diretório: instantâneo e sem tocar no conteúdo. Uma
cópia transformaria milhares de hardlinks em arquivos de verdade e
multiplicaria o acervo em silêncio — no caso do Tensura seriam +13,5 GB.

**Nada é sobrescrito.** Episódio com o mesmo nome dos dois lados é conflito
real (dois S01E01 diferentes), e conflito para a operação em vez de escolher
sozinho qual sobrevive.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from .db import Database


@dataclass
class PlanoJuncao:
    """O que aconteceria. Devolvido antes de qualquer coisa ser movida."""

    origem: str
    destino: str
    mover: list[str] = field(default_factory=list)
    conflitos: list[str] = field(default_factory=list)
    linhas: int = 0
    erro: str = ""

    @property
    def pode(self) -> bool:
        return not self.erro and not self.conflitos and bool(self.mover)

    def payload(self) -> dict:
        return {
            "origem": self.origem,
            "destino": self.destino,
            "mover": self.mover,
            "conflitos": self.conflitos,
            "linhas": self.linhas,
            "erro": self.erro,
            "pode": self.pode,
        }


def _episodios(pasta: Path) -> list[Path]:
    if not pasta.is_dir():
        return []
    return sorted((x for x in pasta.iterdir() if x.is_dir()), key=lambda p: p.name)


def planejar(output_dir: Path | str, origem: str, destino: str, db: Database) -> PlanoJuncao:
    """Simula a junção. Não escreve nada."""
    raiz = Path(output_dir)
    po, pd = raiz / origem, raiz / destino
    plano = PlanoJuncao(origem=origem, destino=destino)

    if origem == destino:
        plano.erro = "origem e destino são a mesma pasta"
        return plano
    if not po.is_dir():
        plano.erro = f"não achei a pasta '{origem}'"
        return plano
    if not pd.is_dir():
        plano.erro = f"não achei a pasta '{destino}'"
        return plano

    for ep in _episodios(po):
        if (pd / ep.name).exists():
            plano.conflitos.append(ep.name)
        else:
            plano.mover.append(ep.name)

    if not plano.mover and not plano.conflitos:
        plano.erro = f"'{origem}' não tem episódio nenhum dentro"
        return plano

    prefixo = str(po) + os.sep
    plano.linhas = sum(
        1
        for r in db.all_episode_roots()
        if str(r["output_root"] or "").startswith(prefixo)
    )
    return plano


def juntar(output_dir: Path | str, origem: str, destino: str, db: Database) -> PlanoJuncao:
    """Executa. Só depois de o plano dizer que dá.

    Ordem importa: os arquivos primeiro, o banco depois. Um banco apontando
    pra pasta que ainda não chegou é um episódio que não abre; o contrário
    (arquivo movido, banco velho por um instante) é reparável relendo.
    """
    raiz = Path(output_dir)
    plano = planejar(raiz, origem, destino, db)
    if not plano.pode:
        return plano

    po, pd = raiz / origem, raiz / destino
    for nome in plano.mover:
        alvo = pd / nome
        if alvo.exists():
            # Alguém mexeu entre o plano e agora. Para no meio é melhor do que
            # sobrescrever um episódio de verdade.
            plano.erro = f"'{nome}' apareceu no destino durante a junção"
            return plano
        os.rename(po / nome, alvo)

    prefixo = str(po) + os.sep
    for r in db.all_episode_roots():
        antigo = str(r["output_root"] or "")
        if antigo.startswith(prefixo):
            db.set_episode_root(r["id"], str(pd / Path(antigo).name))

    # Só remove a origem se ela ficou realmente vazia: sobra ali é coisa que
    # não era episódio (refs soltas, uma pasta de lixeira) e não é minha pra
    # apagar.
    if po.is_dir() and not any(po.iterdir()):
        po.rmdir()

    return plano
