"""Reclassificar episódios: mudar o tipo, o número e a pasta de anime de vários
de uma vez.

**Por que existe.** Quem analisa uma abertura sem marcar "Abertura" no
formulário recebe um anime NOVO por arquivo: "Black Clover - OP Opening 2 v1
PAiNT it BLACK" vira uma pasta de anime com um S01E01 dentro, e a próxima
abertura outra pasta com outro S01E01. Juntar uma por uma com o "juntar
pastas" não funciona — todas se chamam S01E01 e a segunda já dá conflito.
Mudar a temporada também não resolve: o que está errado é o TIPO.

Aqui cada episódio escolhido ganha tipo e número próprios (`S01-OP2`,
`S01-OP3`…) e vai pra uma pasta de anime só, numa operação.

É a mesma mecânica de `temporadas.py` e `juntar_animes.py`: renomear pasta no
disco (instantâneo e preserva os hardlinks de `by_character/`) e reapontar o
banco. E as mesmas travas: plano antes, e destino ocupado para tudo em vez de
sobrescrever.

**O anime do banco não muda.** O episódio continua preso ao `anime_id` em que
foi analisado, como na junção de pastas: os personagens são por anime, e
trocar o `anime_id` deixaria as cenas apontando pra personagens de outro
elenco. A Biblioteca agrupa pela pasta, então pra quem olha é um anime só.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from .db import Database
from .temporadas import slug

TIPOS = ("", "OP", "ED", "MOVIE")


@dataclass
class Item:
    """O que o usuário pediu pra um episódio."""

    episode_id: int
    kind: str
    numero: int


@dataclass
class Mudanca:
    episode_id: int
    de_pasta: str
    para_pasta: str
    anime_id: int
    season: int
    numero: int
    kind: str

    def payload(self) -> dict:
        de, para = Path(self.de_pasta), Path(self.para_pasta)
        return {
            "episodeId": self.episode_id,
            "de": f"{de.parent.name}/{de.name}",
            "para": f"{para.parent.name}/{para.name}",
            "season": self.season,
            "episode": self.numero,
            "kind": self.kind,
        }


@dataclass
class Plano:
    destino: str
    mudancas: list[Mudanca] = field(default_factory=list)
    conflitos: list[str] = field(default_factory=list)
    erro: str = ""
    # Pastas de anime que ficam sem episódio nenhum depois da operação.
    esvaziadas: list[str] = field(default_factory=list)

    @property
    def pode(self) -> bool:
        return not self.erro and not self.conflitos and bool(self.mudancas)

    def payload(self) -> dict:
        return {
            "destino": self.destino,
            "mudancas": [m.payload() for m in self.mudancas],
            "conflitos": self.conflitos,
            "erro": self.erro,
            "pode": self.pode,
        }


def ler_itens(texto: str) -> list[Item]:
    """`id:TIPO:numero,id:TIPO:numero` — `E` é episódio (tipo vazio).

    Texto e não JSON porque vai como argumento de linha de comando no
    Windows, onde aspas dentro de argumento são uma loteria.
    """
    itens: list[Item] = []
    for parte in texto.split(","):
        parte = parte.strip()
        if not parte:
            continue
        i, k, n = parte.split(":")
        itens.append(Item(int(i), "" if k == "E" else k, int(n)))
    return itens


def planejar(
    output_dir: Path | str,
    itens: list[Item],
    destino: str,
    temporada: int,
    db: Database,
) -> Plano:
    """Simula. Não escreve nada.

    `destino` é o nome da pasta de anime dentro da saída; vazio = cada
    episódio fica na pasta em que já está (só muda tipo e número).
    """
    plano = Plano(destino=destino)
    if not itens:
        plano.erro = "nenhum episódio escolhido"
        return plano
    if not (1 <= temporada <= 99):
        plano.erro = "a temporada tem que estar entre 1 e 99"
        return plano
    if destino and (destino != Path(destino).name or destino in (".", "..")):
        plano.erro = f"nome de pasta inválido: '{destino}'"
        return plano
    for it in itens:
        if it.kind not in TIPOS:
            plano.erro = f"tipo desconhecido: '{it.kind}'"
            return plano
        if not (1 <= it.numero <= 9999):
            plano.erro = f"número inválido: {it.numero}"
            return plano

    ids = [it.episode_id for it in itens]
    if len(set(ids)) != len(ids):
        plano.erro = "o mesmo episódio apareceu duas vezes"
        return plano
    linhas = {r["id"]: r for r in db.episodes_by_ids(ids)}
    faltando = [i for i in ids if i not in linhas]
    if faltando:
        plano.erro = f"episódio não encontrado: {faltando}"
        return plano

    pasta_destino = Path(output_dir) / destino if destino else None
    if pasta_destino is not None and pasta_destino.exists() and not pasta_destino.is_dir():
        plano.erro = f"'{destino}' existe e não é uma pasta"
        return plano

    # Destinos que ESTA operação cria contam como ocupados: duas aberturas
    # numeradas 2 iriam pro mesmo `S01-OP2`, mesmo com o disco livre.
    pastas_reservadas: set[str] = set()
    chaves_reservadas: set[tuple] = set()
    for it in itens:
        r = linhas[it.episode_id]
        raiz = Path(r["output_root"] or "")
        if not raiz.name:
            plano.conflitos.append(f"episódio {r['id']} sem pasta gravada")
            continue
        mae = pasta_destino if pasta_destino is not None else raiz.parent
        alvo = mae / slug(temporada, it.numero, it.kind)
        rotulo = f"{raiz.parent.name}/{raiz.name} -> {mae.name}/{alvo.name}"

        mesmo_lugar = str(alvo).lower() == str(raiz).lower()
        if str(alvo).lower() in pastas_reservadas:
            plano.conflitos.append(f"{rotulo} (dois episódios com o mesmo número)")
            continue
        if alvo.exists() and not mesmo_lugar:
            plano.conflitos.append(f"{rotulo} (a pasta já existe)")
            continue
        # A chave (anime, temporada, número, tipo) é única no banco. Quem a
        # ocupa hoje só não é conflito se for um dos que estão saindo dali.
        chave = (r["anime_id"], temporada, it.numero, it.kind)
        if chave in chaves_reservadas:
            plano.conflitos.append(f"{rotulo} (dois episódios com o mesmo número)")
            continue
        dono = db.episode_at(r["anime_id"], temporada, it.numero, it.kind)
        if dono is not None and dono not in linhas:
            plano.conflitos.append(f"{rotulo} (o histórico já tem esse episódio)")
            continue

        pastas_reservadas.add(str(alvo).lower())
        chaves_reservadas.add(chave)
        if (
            mesmo_lugar
            and int(r["season"]) == temporada
            and int(r["episode"]) == it.numero
            and (r["kind"] or "") == it.kind
        ):
            continue  # já está exatamente assim
        plano.mudancas.append(
            Mudanca(
                episode_id=r["id"],
                de_pasta=str(raiz),
                para_pasta=str(alvo),
                anime_id=int(r["anime_id"]),
                season=temporada,
                numero=it.numero,
                kind=it.kind,
            )
        )

    if not plano.mudancas and not plano.conflitos and not plano.erro:
        plano.erro = "todos já estão assim"
        return plano

    # Quais pastas de anime ficam vazias: a memória de nomes que apontava pra
    # elas passa a apontar pro destino, senão a próxima análise recria a
    # pasta que acabou de sumir.
    if pasta_destino is not None:
        movidos = {m.episode_id for m in plano.mudancas}
        origens = {str(Path(m.de_pasta).parent) for m in plano.mudancas}
        resto: dict[str, int] = {o.lower(): 0 for o in origens}
        for r in db.all_episode_roots():
            mae = str(Path(r["output_root"] or "").parent).lower()
            if mae in resto and r["id"] not in movidos:
                resto[mae] += 1
        plano.esvaziadas = sorted(
            o for o in origens
            if resto[o.lower()] == 0 and o.lower() != str(pasta_destino).lower()
        )
    return plano


def aplicar(
    output_dir: Path | str,
    itens: list[Item],
    destino: str,
    temporada: int,
    db: Database,
) -> Plano:
    """Renomeia as pastas e reaponta o banco. Só se o plano permitir."""
    plano = planejar(output_dir, itens, destino, temporada, db)
    if not plano.pode:
        return plano

    if destino:
        (Path(output_dir) / destino).mkdir(parents=True, exist_ok=True)

    # Arquivos primeiro, banco depois — como na junção. Um banco apontando
    # pra pasta que ainda não chegou é um episódio que não abre.
    feitas: list[Mudanca] = []
    for m in plano.mudancas:
        de, para = Path(m.de_pasta), Path(m.para_pasta)
        if str(de).lower() != str(para).lower():
            if para.exists():
                plano.erro = f"'{para.name}' apareceu durante a operação"
                break
            if de.is_dir():
                os.rename(de, para)
        feitas.append(m)

    # Só o que de fato saiu do lugar vai pro banco: se parou no meio, o resto
    # continua apontando pra onde ainda está.
    db.reclassify_episodes(
        [(m.episode_id, m.season, m.numero, m.kind, m.para_pasta) for m in feitas]
    )

    if not plano.erro:
        for o in plano.esvaziadas:
            p = Path(o)
            # Só remove se ficou vazia de verdade: sobra ali é coisa que não
            # era episódio, e não é minha pra apagar.
            if p.is_dir() and not any(p.iterdir()):
                p.rmdir()
    return plano
