"""Marcar uma cena como sendo de um personagem — correção manual.

O reconhecimento erra e cala: a cena da Roxy em S01E01 veio sem ninguém, e o
FAAH só descobriu ao favoritá-la e ver o clipe cair em "Sem personagem". Não
havia como consertar de dentro do app.

Marcar mexe em **três lugares**, e deixar um de fora quebra o resto:

1. `shot_character` — é o que a Biblioteca, a busca por personagem e os
   Favoritos leem.
2. `by_character/<Nome>/` no disco — é onde ele trabalha. Sem o hardlink, o
   app diz uma coisa e o Explorer diz outra.
3. `manual_override('add')` — é o que sobrevive a uma reanálise. Sem isso, a
   correção duraria até o próximo processamento do episódio e sumiria sem
   avisar.

## O personagem certo é o do MESMO anime

Cada `character` pertence a um `anime_id`, e a mesma pessoa tem uma linha por
temporada quando as temporadas são animes diferentes. Marcar a cena de
S01E01 com a linha da Roxy da 3ª temporada gravaria uma atribuição que nenhum
outro caminho do app espera encontrar ali.

Então o id que a tela manda é só o PONTO DE PARTIDA: daqui vale o nome, e o
nome é reencontrado dentro do anime da cena por `naming.find_token_match` —
a mesma regra que une "Greyrat, Rudeus" e "Rudeus" em todo o resto. Se o
anime da cena não conhecer ninguém com aquele nome, aí sim fica o id que
veio.
"""

from __future__ import annotations

from pathlib import Path

from ..naming import find_token_match
from .db import Database
from .organizer import organize_by_character, organize_by_pair, sanitize


class ErroDeMarcacao(Exception):
    """Falta de dado que impede marcar — some com uma mensagem, não com um
    traceback na cara do usuário."""


def _resolver(db: Database, anime_id: int, nome: str, id_original: int) -> tuple[int, str]:
    """Acha a linha deste personagem DENTRO do anime da cena."""
    elenco = db.get_characters_for_anime(anime_id)
    exato = next((c for c in elenco if str(c["name"]).strip().lower() == nome.lower()), None)
    if exato:
        return int(exato["id"]), str(exato["name"])

    alvo = find_token_match(nome, [str(c["name"]) for c in elenco])
    if alvo:
        achado = next(c for c in elenco if str(c["name"]) == alvo)
        return int(achado["id"]), str(achado["name"])

    return id_original, nome


def marcar_varias(
    db: Database, shot_ids: list[int], character_id: int, remover: bool = False
) -> dict:
    """O mesmo que `marcar`, para um punhado de cenas de uma vez.

    Uma chamada só porque cada ida ao motor abre um processo congelado, e o
    primeiro atendimento dele custa segundos. Marcar 40 cenas uma a uma seria
    esperar minutos por um trabalho de milissegundos.
    """
    ultimo: dict = {}
    feitas = 0
    for sid in shot_ids:
        try:
            ultimo = marcar(db, sid, character_id, remover)
            feitas += 1
        except ErroDeMarcacao:
            # Uma cena que sumiu no meio do caminho não derruba as outras.
            continue
    if not ultimo:
        raise ErroDeMarcacao("nenhuma das cenas existe mais")
    return {**ultimo, "count": feitas}


def marcar(db: Database, shot_id: int, character_id: int, remover: bool = False) -> dict:
    """Liga (ou desliga) o personagem nesta cena. Devolve o estado novo."""
    cena = db.shot_context(shot_id)
    if not cena:
        raise ErroDeMarcacao(f"cena {shot_id} não existe mais")
    quem = db.character_row(character_id)
    if not quem:
        raise ErroDeMarcacao(f"personagem {character_id} não existe mais")

    cid, nome = _resolver(db, int(cena["anime_id"]), str(quem["name"]), character_id)
    raiz = Path(str(cena["output_root"] or ""))
    arquivo = raiz / str(cena["file"] or "")

    if remover:
        db.remove_shot_character(shot_id, cid)
        db.record_manual(int(cena["episode_id"]), int(cena["idx"]), cid, "block")
        _desfazer_pasta(raiz, nome, arquivo.name)
    else:
        db.assign_character_manual(shot_id, cid, 1.0)
        db.record_manual(int(cena["episode_id"]), int(cena["idx"]), cid, "add", 1.0)
        if arquivo.is_file():
            nomes = [str(c["name"]) for c in db.characters_in_shot(shot_id)]
            organize_by_character(arquivo, raiz, [nome])
            # O par também: `by_pair/` sai da mesma verdade, e uma cena que
            # passou a ter dois personagens ganhou um par que não existia.
            if len(nomes) > 1:
                organize_by_pair(arquivo, raiz, nomes)

    return {
        "shotId": shot_id,
        "characterId": cid,
        "character": nome,
        "tagged": not remover,
        "characters": [
            {"id": int(c["id"]), "name": str(c["name"]), "confidence": c["confidence"]}
            for c in db.characters_in_shot(shot_id)
        ],
    }


def _desfazer_pasta(raiz: Path, nome: str, arquivo: str) -> None:
    """Tira o hardlink da pasta do personagem.

    Só o hardlink: o clipe de verdade mora em `shots/` e continua lá. Ver
    `storage/lixeira.py` — é o mesmo desenho, e é por isso que apagar daqui
    não perde nada.
    """
    alvo = raiz / "by_character" / sanitize(nome) / arquivo
    try:
        if alvo.is_file():
            alvo.unlink()
        pasta = alvo.parent
        if pasta.is_dir() and not any(pasta.iterdir()):
            pasta.rmdir()
    except OSError:
        # Arquivo aberto no Explorer, pasta em uso: o banco já foi corrigido e
        # é ele que manda na tela. Não vale derrubar a marcação por isso.
        pass


def remover_personagem(db: Database, episode_id: int, character_id: int) -> dict:
    """Tira um personagem inteiro de um episódio.

    Para quando o reconhecimento inventa alguém: 21 cenas atribuídas a uma
    "Kamado, Hanako" que não está em nenhuma delas. Sem isto, a única saída
    era reanalisar o episódio e torcer.

    **As cenas NÃO são apagadas.** O que sai é o vínculo: os clipes continuam
    em `shots/` e continuam aparecendo em "Todas as cenas". Some a pasta
    `by_character/<Nome>/` (que é só hardlink) e some o nome da lista.

    O `block` em `manual_override` é o que faz a correção durar: sem ele a
    próxima análise do episódio traria o mesmo engano de volta, e o usuário
    apagaria de novo achando que o app não obedece.
    """
    quem = db.character_row(character_id)
    if not quem:
        raise ErroDeMarcacao(f"personagem {character_id} não existe mais")
    nome = str(quem["name"])

    cenas = db.shots_for_character(character_id, episode_id=episode_id)
    raiz: Path | None = None
    for c in cenas:
        cena = db.shot_context(int(c["id"]))
        if not cena:
            continue
        raiz = Path(str(cena["output_root"] or "")) or None
        db.remove_shot_character(int(c["id"]), character_id)
        db.record_manual(episode_id, int(cena["idx"]), character_id, "block")
        if raiz and raiz.name:
            _desfazer_pasta(raiz, nome, Path(str(cena["file"] or "")).name)

    return {"episodeId": episode_id, "characterId": character_id,
            "character": nome, "removed": len(cenas)}
