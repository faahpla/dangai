"""Buscar clipes por PERSONAGEM, no acervo inteiro.

A Biblioteca organiza por anime → temporada → episódio, que é como o material
entra. Mas o uso é outro: "me dá tudo que eu já tenho do Rimuru". Isso
atravessa episódios, temporadas e até títulos diferentes, e não havia como
pedir.

**O nome não é uma chave confiável.** No acervo do FAAH o mesmo personagem
existe escrito de mais de um jeito, porque cada temporada resolve o elenco por
conta e a fonte alterna o formato:

    Tempest, Rimuru   317 cenas
    Rimuru Tempest    204 cenas   <- a mesma pessoa
    Greyrat, Rudeus   176 cenas
    Rudeus            256 cenas   <- idem

Agrupar por texto devolveria duas listas pra uma pessoa só. Quem decide é
`naming.find_token_match`, a mesma regra que o resto do app usa: igualdade de
tokens, ou subconjunto próprio quando ele é ÚNICO — dois candidatos casando
("Greyrat, Rudeus" e "Greyrat, Eris") é ambíguo, e aí ninguém é fundido.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..naming import find_token_match
from .db import Database


@dataclass
class GrupoPersonagem:
    """Um personagem, com todas as grafias que o banco conhece dele."""

    nome: str
    ids: list[int] = field(default_factory=list)
    grafias: list[str] = field(default_factory=list)
    cenas: int = 0
    episodios: int = 0
    animes: list[str] = field(default_factory=list)
    # Quanto ele tem em CADA anime. A lista de nomes não bastava: a aba
    # Personagem passou a separar por anime, e o Ichigo está em duas pastas
    # de Bleach — mostrar as 211 cenas dele nas duas seções seria mentira nas
    # duas.
    por_anime: list[dict] = field(default_factory=list)
    amostra: str = ""

    def payload(self) -> dict:
        return {
            "name": self.nome,
            "ids": self.ids,
            "aliases": [g for g in self.grafias if g != self.nome],
            "shots": self.cenas,
            "episodes": self.episodios,
            "animes": self.animes,
            "byAnime": self.por_anime,
            "sample": self.amostra,
        }


def _rel(caminho: str, base: Path) -> str:
    """Caminho relativo à pasta de saída, pro `media://` cobrir tudo com um
    prefixo só — a grade de um personagem mistura episódios de vários animes,
    e um prefixo por episódio não daria conta."""
    try:
        return str(Path(caminho).resolve().relative_to(base))
    except (ValueError, OSError):
        return ""


def listar(db: Database, output_dir: Path | str, termo: str = "") -> list[GrupoPersonagem]:
    """Todos os personagens com pelo menos uma cena, do mais presente pro menos.

    A ordem por número de cenas não é só apresentação: ela decide QUAL grafia
    vira o nome do grupo. Processando do maior pro menor, o nome que ele mais
    vê é o que fica; as outras grafias viram apelidos.
    """
    base = Path(output_dir).resolve()
    linhas = db.characters_with_shots()

    grupos: list[GrupoPersonagem] = []
    for r in linhas:
        nome = str(r["name"] or "").strip()
        if not nome:
            continue
        alvo = find_token_match(nome, [g.nome for g in grupos])
        g = next((x for x in grupos if x.nome == alvo), None) if alvo else None
        # O caminho e montado AQUI, com pathlib. O banco devolve as duas
        # metades e nunca as junta.
        amostra = ""
        if r["sample_root"] and r["sample_kf"]:
            amostra = _rel(str(Path(r["sample_root"]) / str(r["sample_kf"])), base)
        if g is None:
            g = GrupoPersonagem(nome=nome, amostra=amostra)
            grupos.append(g)
        g.ids.append(int(r["id"]))
        if nome not in g.grafias:
            g.grafias.append(nome)
        if not g.amostra and amostra:
            g.amostra = amostra

    # Cenas e episódios são contados DEPOIS do agrupamento: somar por linha
    # contaria duas vezes a cena em que duas grafias do mesmo personagem
    # aparecem.
    for g in grupos:
        cenas, episodios, animes = db.shot_stats_for_characters(g.ids)
        g.cenas = cenas
        g.episodios = episodios
        g.animes = [Path(a).parent.name for a in animes if a]
        g.animes = sorted(set(g.animes))
        g.por_anime = _por_anime(db, g.ids)

    grupos = [g for g in grupos if g.cenas > 0]
    if termo:
        alvo = termo.strip().lower()
        grupos = [
            g for g in grupos
            if alvo in g.nome.lower() or any(alvo in x.lower() for x in g.grafias)
        ]
    grupos.sort(key=lambda g: (-g.cenas, g.nome.lower()))
    return grupos


def cenas_de(db: Database, output_dir: Path | str, ids: list[int]) -> list[dict]:
    """Todas as cenas desses personagens, no acervo inteiro."""
    base = Path(output_dir).resolve()
    saida = []
    for r in db.shots_for_characters(ids):
        raiz = str(r["output_root"] or "")
        if not raiz:
            continue
        arquivo = Path(raiz) / str(r["file"] or "")
        kf = Path(raiz) / str(r["keyframe"] or "") if r["keyframe"] else None
        saida.append({
            "id": r["id"],
            "idx": r["idx"],
            "file": _rel(str(arquivo), base),
            "keyframe": _rel(str(kf), base) if kf else "",
            "absolute": str(arquivo),
            "duration": r["duration"],
            "confidence": r["confidence"],
            "anime": Path(raiz).parent.name,
            "season": r["season"],
            "episode": r["episode"],
            "kind": r["kind"] or "",
            "episodeId": r["episode_id"],
        })
    return saida


def _por_anime(db: Database, ids: list[int]) -> list[dict]:
    """Dobra as pastas de episódio na pasta do ANIME, somando.

    As contagens vêm por episódio e são somadas aqui: uma cena pertence a um
    episódio só, então somar não conta ninguém duas vezes — diferente do
    total do grupo, onde duas grafias podem apontar pra mesma cena e o
    DISTINCT é obrigatório.
    """
    caixas: dict[str, dict] = {}
    for r in db.shot_stats_by_root(ids):
        pasta = Path(str(r["output_root"])).parent.name
        if not pasta:
            continue
        caixa = caixas.setdefault(pasta, {"anime": pasta, "shots": 0, "episodes": 0})
        caixa["shots"] += int(r["n"] or 0)
        caixa["episodes"] += int(r["eps"] or 0)
    return sorted(caixas.values(), key=lambda x: (-x["shots"], x["anime"].lower()))
