"""Mudar a temporada de episódios já analisados.

O número da temporada não é só um rótulo: ele forma o nome da pasta
(`S04E17`, `S03-OP1`). Então mudar a temporada é renomear a pasta no disco e
reapontar o banco — a mesma mecânica de `juntar_animes.py`, com as mesmas
travas.

**Por que isto é necessário.** A numeração vem do nome do arquivo, e ela
discorda do mundo o tempo todo: o Bleach: Thousand-Year Blood War é a 17ª
temporada do Bleach, mas os arquivos vêm como S01. O usuário só descobre
depois de analisar, e até agora não tinha como corrigir sem reanalisar.

**Nada é sobrescrito.** Se o destino já existe (outro episódio ocupa
`S17E44`, ou o banco já tem uma linha nessa temporada), a operação para. Duas
linhas com a mesma (anime, temporada, episódio, tipo) quebrariam a chave que
o resto do app usa pra reconhecer "é o mesmo episódio".
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from .db import Database


def slug(season: int, episode: int, kind: str = "") -> str:
    """Nome da pasta do episódio. Espelha `EpisodeInfo.slug` do motor."""
    s = f"S{season:02d}"
    if kind:
        return f"{s}-{kind}{episode}"
    return f"{s}E{episode:02d}"


@dataclass
class MudancaTemporada:
    """Uma renomeação planejada."""

    episode_id: int
    de_pasta: str
    para_pasta: str
    de_temporada: int
    para_temporada: int
    episodio: int
    kind: str

    def payload(self) -> dict:
        return {
            "episodeId": self.episode_id,
            "de": Path(self.de_pasta).name,
            "para": Path(self.para_pasta).name,
            "deTemporada": self.de_temporada,
            "paraTemporada": self.para_temporada,
            "episodio": self.episodio,
            "kind": self.kind,
        }


@dataclass
class PlanoTemporada:
    mudancas: list[MudancaTemporada] = field(default_factory=list)
    conflitos: list[str] = field(default_factory=list)
    erro: str = ""

    @property
    def pode(self) -> bool:
        return not self.erro and not self.conflitos and bool(self.mudancas)

    def payload(self) -> dict:
        return {
            "mudancas": [m.payload() for m in self.mudancas],
            "conflitos": self.conflitos,
            "erro": self.erro,
            "pode": self.pode,
        }


def planejar(episode_ids: list[int], nova_temporada: int, db: Database) -> PlanoTemporada:
    """Simula. Não escreve nada."""
    plano = PlanoTemporada()
    if not (1 <= nova_temporada <= 99):
        plano.erro = "a temporada tem que estar entre 1 e 99"
        return plano
    if not episode_ids:
        plano.erro = "nenhum episódio escolhido"
        return plano

    linhas = db.episodes_by_ids(episode_ids)
    achados = {r["id"] for r in linhas}
    faltando = [i for i in episode_ids if i not in achados]
    if faltando:
        plano.erro = f"episódio não encontrado: {faltando}"
        return plano

    # Os destinos que ESTA operação vai criar contam como ocupados: mandar dois
    # episódios diferentes pro mesmo lugar é conflito, mesmo que o disco ainda
    # esteja livre.
    reservados: set[str] = set()
    for r in linhas:
        raiz = Path(r["output_root"] or "")
        if not raiz.name:
            plano.conflitos.append(f"episódio {r['id']} sem pasta gravada")
            continue
        kind = r["kind"] or ""
        alvo = raiz.parent / slug(nova_temporada, r["episode"], kind)

        if int(r["season"]) == nova_temporada:
            continue  # já está lá; não é erro, só não há o que fazer

        if str(alvo).lower() in reservados or alvo.exists():
            plano.conflitos.append(f"{raiz.name} -> {alvo.name} (destino já existe)")
            continue
        # A chave (anime, temporada, episódio, tipo) é única no banco.
        if db.episode_at(r["anime_id"], nova_temporada, r["episode"], kind):
            plano.conflitos.append(
                f"{raiz.name} -> {alvo.name} (o histórico já tem esse episódio)"
            )
            continue

        reservados.add(str(alvo).lower())
        plano.mudancas.append(
            MudancaTemporada(
                episode_id=r["id"],
                de_pasta=str(raiz),
                para_pasta=str(alvo),
                de_temporada=int(r["season"]),
                para_temporada=nova_temporada,
                episodio=int(r["episode"]),
                kind=kind,
            )
        )

    if not plano.mudancas and not plano.conflitos and not plano.erro:
        plano.erro = f"todos já estão na temporada {nova_temporada}"
    return plano


def aplicar(episode_ids: list[int], nova_temporada: int, db: Database) -> PlanoTemporada:
    """Renomeia as pastas e reaponta o banco. Só se o plano permitir."""
    plano = planejar(episode_ids, nova_temporada, db)
    if not plano.pode:
        return plano

    for m in plano.mudancas:
        de, para = Path(m.de_pasta), Path(m.para_pasta)
        if para.exists():
            plano.erro = f"'{para.name}' apareceu durante a operação"
            return plano
        if de.is_dir():
            os.rename(de, para)

    # Banco depois dos arquivos, como na junção: um caminho apontando pra
    # pasta que ainda não chegou é um episódio que não abre.
    for m in plano.mudancas:
        db.set_episode_season(m.episode_id, m.para_temporada)
        db.set_episode_root(m.episode_id, m.para_pasta)

    return plano
