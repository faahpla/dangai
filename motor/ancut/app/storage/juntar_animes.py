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
    # `origem`/`destino` podem ser o NOME (dentro da saída) ou o caminho
    # completo -- é o caso de duas pastas com o mesmo nome em lugares
    # diferentes ("D:\Animes\Black Clover" e "D:\Filmes\...\Black Clover",
    # depois de a saída ter sido trocada pra cortar um filme). Pelo nome só,
    # as duas eram a mesma e juntar era impossível.
    raiz = Path(output_dir)
    po, pd = raiz / origem, raiz / destino
    plano = PlanoJuncao(origem=origem, destino=destino)

    if str(po).lower() == str(pd).lower():
        plano.erro = "origem e destino são a mesma pasta"
        return plano
    if po.drive.lower() != pd.drive.lower():
        # Mover entre discos é copiar e apagar: os clipes, que existem uma vez
        # com vários nomes (hardlinks), virariam cópias de verdade.
        plano.erro = (f"as pastas estão em discos diferentes ({po.drive} e {pd.drive}): "
                      "mova uma delas pro outro disco pelo Explorer e tente de novo")
        return plano
    if not po.is_dir():
        plano.erro = f"não achei a pasta '{po}'"
        return plano
    if not pd.is_dir():
        plano.erro = f"não achei a pasta '{pd}'"
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


def fundir_animes_locais(db: Database, pasta_destino: Path) -> dict:
    """Depois de juntar as pastas: os animes SEM identidade online que agora
    moram nesta pasta viram um só, e personagem de mesmo nome vira um só.

    A junção de pastas deixava cada episódio no anime em que foi analisado
    (de propósito: animes do AniList têm elencos diferentes por temporada).
    Mas dois animes LOCAIS na mesma pasta são o mesmo anime com dois nomes de
    arquivo -- o caso do Levi, "Avatar - Os Sete Refúgios" e "Avatar Seven
    Havens", com os mesmos 8 personagens duplicados e o reconhecimento de um
    lado sem aproveitar o outro.

    Fica o anime com mais episódios. Personagem do outro com o mesmo nome (em
    qualquer formato, ver naming.name_tokens) tem as marcações, a curadoria,
    os palpites e os favoritos passados pro de cá; os demais só mudam de
    anime. Episódio que já existe no anime que fica (mesma temporada, número
    e tipo) não é mexido: a chave do banco não deixa dois iguais.
    """
    from ..naming import name_tokens

    alvo = str(pasta_destino).lower()
    with db.connect() as c:
        linhas = c.execute(
            "SELECT a.id, count(e.id) n, e.output_root FROM anime a JOIN episode e ON e.anime_id = a.id "
            "WHERE a.anilist_id IS NULL AND a.mal_id IS NULL AND e.output_root IS NOT NULL "
            "GROUP BY a.id, e.output_root"
        ).fetchall()
        por_anime: dict[int, int] = {}
        for r in linhas:
            if str(Path(str(r["output_root"])).parent).lower() == alvo:
                por_anime[int(r["id"])] = por_anime.get(int(r["id"]), 0) + int(r["n"])
        if len(por_anime) < 2:
            return {"fundidos": 0, "personagens": 0}
        fica = max(por_anime, key=lambda a: (por_anime[a], -a))
        dela = {
            name_tokens(str(r["name"])): int(r["id"])
            for r in c.execute("SELECT id, name FROM character WHERE anime_id=?", (fica,))
        }
        fundidos = juntados = 0
        for sai in (a for a in por_anime if a != fica):
            for r in c.execute("SELECT id, name FROM character WHERE anime_id=?", (sai,)).fetchall():
                velho, novo = int(r["id"]), dela.get(name_tokens(str(r["name"])))
                if novo is None:
                    c.execute("UPDATE character SET anime_id=? WHERE id=?", (fica, velho))
                    dela[name_tokens(str(r["name"]))] = velho
                    continue
                c.execute(
                    "INSERT OR IGNORE INTO shot_character(shot_id, character_id, confidence, reviewed, approved) "
                    "SELECT shot_id, ?, confidence, reviewed, approved FROM shot_character WHERE character_id=?",
                    (novo, velho),
                )
                for tabela in ("manual_override", "sugestao", "favorite"):
                    try:
                        c.execute(f"UPDATE OR IGNORE {tabela} SET character_id=? WHERE character_id=?", (novo, velho))
                    except Exception:  # noqa: BLE001 -- tabela de banco antigo
                        pass
                c.execute("DELETE FROM character WHERE id=?", (velho,))
                juntados += 1
            # Os episódios desta pasta passam pro anime que fica (os que não
            # colidem com um igual que já está lá).
            for e in c.execute(
                "SELECT id, season, episode, kind, output_root FROM episode WHERE anime_id=?", (sai,)
            ).fetchall():
                if str(Path(str(e["output_root"] or "")).parent).lower() != alvo:
                    continue
                igual = c.execute(
                    "SELECT 1 FROM episode WHERE anime_id=? AND season=? AND episode=? AND kind=?",
                    (fica, e["season"], e["episode"], e["kind"]),
                ).fetchone()
                if not igual:
                    c.execute("UPDATE episode SET anime_id=? WHERE id=?", (fica, e["id"]))
            if not c.execute("SELECT 1 FROM episode WHERE anime_id=?", (sai,)).fetchone():
                c.execute("DELETE FROM anime WHERE id=?", (sai,))
            fundidos += 1
    return {"fundidos": fundidos, "personagens": juntados}
