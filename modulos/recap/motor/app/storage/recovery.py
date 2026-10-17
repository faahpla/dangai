"""Pasta esquecida volta pro acervo, sem reanalisar.

Uma pasta de episódio guarda tudo que o histórico precisa: `shots.json` tem
cada cena com início, fim, arquivo, keyframe e quem foi identificado nela.
Quando o banco perde essa entrada — banco recriado, análise interrompida
antes de gravar, pasta vinda de outra instalação — a pasta continua no disco,
completa, e some do app. No acervo do usuário isso aparece como pastas soltas
do tipo `S01E01-Jobless Reincarnation V2`.

Reanalisar pra recuperar seria pagar minutos de GPU por informação que já
está escrita ali. Restaurar é leitura de arquivo: milissegundos.

**O que NÃO é feito.** Personagem que não está no `characters.json` não é
inventado. Se uma cena cita um nome que não veio junto, ela volta sem dono —
melhor uma cena órfã visível do que um personagem fantasma no banco, que
depois vira pasta e contamina a próxima análise.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from .db import Database

_SLUG = re.compile(r"^S(\d{1,2})(?:E(\d{1,3})|-(OP|ED)(\d{1,3}))$", re.IGNORECASE)


@dataclass
class Orphan:
    """Uma pasta de episódio completa que o banco não conhece."""

    root: Path
    anime: str
    season: int
    episode: int
    kind: str
    shots: int
    characters: list[str] = field(default_factory=list)

    def payload(self) -> dict:
        return {
            "root": str(self.root),
            "anime": self.anime,
            "season": self.season,
            "episode": self.episode,
            "kind": self.kind,
            "shots": self.shots,
            "characters": self.characters,
        }


def _slug_parts(nome: str) -> tuple[int, int, str] | None:
    m = _SLUG.match(nome)
    if not m:
        return None
    season = int(m.group(1))
    if m.group(2) is not None:
        return season, int(m.group(2)), ""
    return season, int(m.group(4)), m.group(3).upper()


def _read_shots(root: Path) -> list[dict]:
    try:
        data = json.loads((root / "metadata" / "shots.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def _known_characters(root: Path) -> set[str]:
    """Elenco que a análise realmente usou, segundo o `characters.json`.

    Vazio (arquivo ausente, de uma versão antiga) significa "não sei" e não
    "ninguém": nesse caso o elenco sai dos próprios shots. Tratar ausência
    como lista vazia devolveria o episódio inteiro sem dono.
    """
    try:
        data = json.loads(
            (root / "metadata" / "characters.json").read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError):
        return set()
    if not isinstance(data, list):
        return set()
    return {str(c.get("name")) for c in data if isinstance(c, dict) and c.get("name")}


def scan(output_dir: Path | str, db: Database) -> list[Orphan]:
    """Pastas de episódio na saída que o banco não tem, ou tem sem cenas."""
    raiz = Path(output_dir)
    if not raiz.is_dir():
        return []

    with db.connect() as c:
        conhecidas = {
            str(r["output_root"]).rstrip("\\/").lower()
            for r in c.execute(
                "SELECT output_root FROM episode WHERE output_root IS NOT NULL "
                "AND EXISTS (SELECT 1 FROM shot s WHERE s.episode_id = episode.id)"
            )
        }

    achadas: list[Orphan] = []
    try:
        pastas_anime = [p for p in raiz.iterdir() if p.is_dir()]
    except OSError:
        return []

    for pasta_anime in pastas_anime:
        try:
            episodios = [p for p in pasta_anime.iterdir() if p.is_dir()]
        except OSError:
            continue
        for ep_dir in episodios:
            if str(ep_dir).rstrip("\\/").lower() in conhecidas:
                continue
            partes = _slug_parts(ep_dir.name)
            if partes is None:
                continue
            shots = _read_shots(ep_dir)
            if not shots:
                continue  # sem metadata não há o que restaurar
            season, episode, kind = partes
            nomes = sorted(
                {
                    str(ch.get("name"))
                    for s in shots
                    for ch in (s.get("characters") or [])
                    if isinstance(ch, dict) and ch.get("name")
                }
            )
            achadas.append(
                Orphan(
                    root=ep_dir,
                    # O `anime` do shots.json é o título resolvido na época;
                    # o nome da pasta é o que o usuário digitou. O título
                    # ganha quando existe, porque é ele que casa com o banco.
                    anime=str(shots[0].get("anime") or pasta_anime.name),
                    season=int(shots[0].get("season") or season),
                    episode=int(shots[0].get("episode") or episode),
                    kind=kind,
                    shots=len(shots),
                    characters=nomes,
                )
            )
    achadas.sort(key=lambda o: (o.anime.lower(), o.season, o.episode))
    return achadas


@dataclass
class RestoreResult:
    episode_id: int
    shots: int
    assignments: int
    ignored: list[str] = field(default_factory=list)


def restore(root: Path | str, db: Database) -> RestoreResult:
    """Reconstrói o episódio no banco a partir do que está na pasta."""
    root = Path(root)
    shots = _read_shots(root)
    if not shots:
        raise ValueError(f"sem metadata/shots.json em {root}")

    partes = _slug_parts(root.name)
    season, episode, kind = partes or (1, 1, "")
    anime_title = str(shots[0].get("anime") or root.parent.name)
    season = int(shots[0].get("season") or season)
    episode = int(shots[0].get("episode") or episode)

    elenco = _known_characters(root)

    anime_id = db.upsert_anime(anilist_id=None, title=anime_title)
    episode_id = db.upsert_episode(
        anime_id, season, episode, _bounds_source(root) or "", kind
    )
    db.set_episode_root(episode_id, str(root))
    # Reconstruir é substituir: se sobrou meia entrada de uma tentativa
    # anterior, ela sai antes pra não virar cena duplicada.
    db.clear_episode_shots(episode_id)

    ids: dict[str, int] = {}
    ignorados: set[str] = set()
    n_atrib = 0
    for s in shots:
        try:
            idx = int(str(s.get("shot_id", "")).lstrip("0") or 0)
        except ValueError:
            continue
        shot_id = db.insert_shot(
            episode_id=episode_id,
            idx=idx,
            file=str(s.get("file") or ""),
            keyframe=str(s["keyframe"]) if s.get("keyframe") else None,
            start=float(s.get("start") or 0.0),
            end=float(s.get("end") or 0.0),
        )
        for ch in s.get("characters") or []:
            nome = str(ch.get("name") or "")
            if not nome:
                continue
            # `elenco` vazio = characters.json não existe (análise antiga):
            # aí não há o que conferir e todo mundo passa.
            if elenco and nome not in elenco:
                ignorados.add(nome)
                continue
            if nome not in ids:
                ids[nome] = db.upsert_character(
                    anime_id=anime_id, name=nome, anilist_id=None
                )
            db.assign_character(shot_id, ids[nome], float(ch.get("confidence") or 0.0))
            n_atrib += 1

    return RestoreResult(
        episode_id=episode_id,
        shots=len(shots),
        assignments=n_atrib,
        ignored=sorted(ignorados),
    )


def _bounds_source(root: Path) -> str | None:
    """De qual vídeo esta pasta saiu, segundo o cache de detecção de cenas."""
    try:
        data = json.loads(
            (root / "metadata" / "shot_bounds.json").read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError):
        return None
    return data.get("source") if isinstance(data, dict) else None
