"""Favoritos, agrupados por anime → personagem.

O pedido do FAAH: "Favs → Mushoku Tensei → Rudeus, e lá estariam todos os
clipes favoritados dele".

Por que o favorito guarda o PERSONAGEM junto: sem isso não há como montar o
segundo nível. Uma cena costuma ter mais de um personagem, então "os favoritos
do Rudeus" não é dedutível de "as cenas favoritas" — a informação de qual
deles motivou o favorito só existe no momento do clique, e é ali que ela é
gravada.

O anime sai da PASTA, não do título, pelo mesmo motivo da Biblioteca: o título
varia com a fonte e a mesma franquia responde nomes diferentes. Ver
`storage/anime_folders.py`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..naming import find_token_match
from .db import Database

SEM_PERSONAGEM = "Sem personagem"


@dataclass
class GrupoFavorito:
    """Um personagem dentro de um anime, com os favoritos dele."""

    personagem: str
    cenas: list[dict] = field(default_factory=list)
    # As linhas de `character` que caíram neste grupo. Vão pra tela porque
    # NOME NÃO É CHAVE: aqui o grupo se chama "Rudeus" (o nome da primeira
    # cena) e no índice de personagens ele é "Greyrat, Rudeus". Casar os dois
    # por texto falha em silêncio — a tela some com a opção de corrigir e
    # ninguém entende por quê. Com o id, não há o que casar.
    ids: list[int] = field(default_factory=list)

    def payload(self) -> dict:
        return {"character": self.personagem, "characterIds": self.ids, "shots": self.cenas}


@dataclass
class AnimeFavorito:
    pasta: str
    personagens: list[GrupoFavorito] = field(default_factory=list)

    @property
    def total(self) -> int:
        # CENAS distintas, não entradas. Um clipe com Rudeus e Eris aparece
        # nas duas pastas — continua sendo um clipe favoritado.
        return len({c["id"] for g in self.personagens for c in g.cenas})

    def payload(self) -> dict:
        return {
            "anime": self.pasta,
            "total": self.total,
            "characters": [g.payload() for g in self.personagens],
        }


def _rel(caminho: Path, base: Path) -> str:
    try:
        return str(caminho.resolve().relative_to(base))
    except (ValueError, OSError):
        return ""


def listar(db: Database, output_dir: Path | str) -> list[AnimeFavorito]:
    """Favoritos do acervo inteiro, em anime → personagem → cenas."""
    base = Path(output_dir).resolve()
    animes: dict[str, AnimeFavorito] = {}
    elenco = db.characters_of_favorites()

    for r in db.favorites():
        raiz = Path(str(r["output_root"] or ""))
        if not raiz.name:
            continue
        arquivo = raiz / str(r["file"] or "")
        kf = raiz / str(r["keyframe"]) if r["keyframe"] else None
        pasta = raiz.parent.name

        anime = animes.get(pasta.lower())
        if anime is None:
            anime = AnimeFavorito(pasta=pasta)
            animes[pasta.lower()] = anime

        cena = {
            "id": r["shot_id"],
            # O id gravado, SEMPRE — é a chave do favorito. A estrela da
            # Biblioteca desfavorita com este par; mandar o personagem
            # deduzido faria o clique CRIAR um favorito novo em vez de tirar.
            "characterId": r["character_id"],
            "idx": r["idx"],
            "file": _rel(arquivo, base),
            "keyframe": _rel(kf, base) if kf else "",
            "absolute": str(arquivo),
            "duration": r["duration"],
            "confidence": r["confidence"],
            "season": r["season"],
            "episode": r["episode"],
            "kind": r["kind"] or "",
            "episodeId": r["episode_id"],
            "favoritedAt": r["created_at"],
        }

        for nome, conf, cid in _atribuicoes(r, elenco):
            _arquivar(anime, nome, cid, {**cena, "confidence": conf})

    saida = list(animes.values())
    for a in saida:
        # "Sem personagem" por último: é o balaio, não um personagem.
        a.personagens.sort(
            key=lambda g: (g.personagem == SEM_PERSONAGEM, -len(g.cenas), g.personagem.lower())
        )
        for g in a.personagens:
            g.cenas.sort(key=lambda c: (c["season"] or 0, c["episode"] or 0, c["idx"] or 0))
    saida.sort(key=lambda a: (-a.total, a.pasta.lower()))
    return saida


def _atribuicoes(
    r: dict, elenco: dict[int, list[dict]]
) -> list[tuple[str, float | None, int]]:
    """De quem é este favorito — uma pasta, ou várias.

    Favoritar dentro da pasta de um personagem grava de quem é. Favoritar em
    "Todas as cenas" grava `character_id = 0`: o clique não disse. Aí vale
    quem o reconhecimento achou na cena — a MESMA verdade que montou
    `by_character/` no disco, onde um clipe de dois personagens mora nas duas
    pastas. Só cena sem ninguém identificado é que vai pro balaio.
    """
    escolhido = str(r["character_name"] or "").strip()
    if int(r["character_id"] or 0) and escolhido:
        return [(escolhido, r["confidence"], int(r["character_id"]))]

    achados = [
        (d["name"], d["confidence"], d["character_id"])
        for d in elenco.get(int(r["shot_id"]), [])
        if d["name"]
    ]
    return achados or [(SEM_PERSONAGEM, r["confidence"], 0)]


def _arquivar(anime: AnimeFavorito, nome: str, cid: int, cena: dict) -> None:
    """Põe a cena no grupo do personagem, unindo as grafias dele.

    "Greyrat, Rudeus" e "Rudeus" são um só, pela mesma regra da busca por
    personagem: favoritos feitos em temporadas diferentes têm que cair juntos.
    """
    if nome == SEM_PERSONAGEM:
        alvo = SEM_PERSONAGEM if any(g.personagem == SEM_PERSONAGEM for g in anime.personagens) else None
    else:
        alvo = find_token_match(nome, [g.personagem for g in anime.personagens if g.personagem != SEM_PERSONAGEM])

    grupo = next((g for g in anime.personagens if g.personagem == alvo), None)
    if grupo is None:
        grupo = GrupoFavorito(personagem=nome)
        anime.personagens.append(grupo)
    if cid and cid not in grupo.ids:
        grupo.ids.append(cid)
    # Banco antigo pode ter a MESMA cena favoritada duas vezes (solta e dentro
    # da pasta do personagem) — hoje isso não acontece mais, mas é um clipe só
    # na tela de qualquer jeito. O clique explícito manda na confiança: foi um
    # clique de verdade naquele personagem, não dedução.
    ja = next((c for c in grupo.cenas if c["id"] == cena["id"]), None)
    if ja is None:
        grupo.cenas.append(cena)
    elif cena["characterId"]:
        ja["characterId"] = cena["characterId"]
        ja["confidence"] = cena["confidence"]
