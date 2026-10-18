"""[recap] A DESCOBERTA GRAVADA NO DISCO (O1 e O2, pedidos do Levi em 18/10).

Arquivo NOVO do modulo recap do Dangai. Antes, a descoberta (Modo Descoberta)
morava SO na memoria do processo do motor: os recortes em JPEG e os
centroides dos grupos. O processo ficava vivo segurando a GPU ate os nomes
chegarem (ate 60 min), o Reconhecer na mao levava ~15 s para abrir (o motor
recalculava tudo) e, com o app fechado no meio, os grupos se perdiam.

Agora tudo que o commit precisa fica em <pasta do episodio>/metadata/discovery/:

    gNNN_MMM.jpg       os recortes (ja eram gravados para a tela)
    centroides.npy     o centroide de cada grupo (a ordem de `groups`)
    grupos.npz         chaves + centroides (o "Buscar elenco" recalcula as sugestoes)
    descoberta.json    o resto: as cenas, os grupos, o elenco, a assinatura do corte

- o fim do corte grava a descoberta PRONTA (headless `precomputeDiscovery`)
  quando ha rostos sem nome: o Reconhecer na mao abre na hora, sem motor;
- a descoberta de agora (`discovery`) grava e SAI (`discoverySaveOnly`): o
  motor nao segura mais a vaga esperando os nomes;
- o commit le daqui (`discoveryCommit`), num processo curto.

Vale enquanto (o host confere): o shot_bounds.json for o mesmo
(`assinaturaDoCorte`, sha1 do arquivo) e ninguem tiver batizado personagem
depois (`batismos`, o contador de <cache>/batismos.json: um batismo novo pode
virar "conhecido" nesta descoberta). Depois do commit ela sai de cena
(descoberta.usada.json).
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

VERSAO = 1
ARQUIVO = "descoberta.json"
CENTROIDES = "centroides.npy"


def para_bytes(arr: np.ndarray) -> bytes:
    """O mesmo formato do embedding_engine.to_bytes (np.save), sem o torch."""
    import io

    buf = io.BytesIO()
    np.save(buf, np.asarray(arr, dtype=np.float32), allow_pickle=False)
    return buf.getvalue()


def de_bytes(b: bytes) -> np.ndarray:
    """O mesmo do embedding_engine.from_bytes, sem o torch."""
    import io

    if not b:
        return np.zeros((0,), dtype=np.float32)
    return np.load(io.BytesIO(b), allow_pickle=False).astype(np.float32)


def pasta(episode_root: str | Path) -> Path:
    return Path(episode_root) / "metadata" / "discovery"


def assinatura_do_corte(episode_root: str | Path) -> str | None:
    """sha1 do shot_bounds.json (o host calcula igual)."""
    try:
        return hashlib.sha1((Path(episode_root) / "metadata" / "shot_bounds.json").read_bytes()).hexdigest()
    except OSError:
        return None


def _arquivo_de_batismos(cache_path: str | Path) -> Path:
    return Path(cache_path) / "batismos.json"


def contador_de_batismos(cache_path: str | Path) -> int:
    try:
        return int(json.loads(_arquivo_de_batismos(cache_path).read_text(encoding="utf-8")).get("total", 0))
    except (OSError, ValueError, TypeError, AttributeError):
        return 0


def somar_batismo(cache_path: str | Path) -> None:
    """Um commit de descoberta (nomes novos no banco): as outras descobertas
    gravadas antes ficam velhas (o host compara o numero)."""
    arq = _arquivo_de_batismos(cache_path)
    try:
        arq.parent.mkdir(parents=True, exist_ok=True)
        tmp = arq.with_suffix(".tmp")
        tmp.write_text(json.dumps({"total": contador_de_batismos(cache_path) + 1}), encoding="utf-8")
        tmp.replace(arq)
    except OSError:
        pass


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def gravar(disc, cache_path: str | Path, fonte: str | Path, kind: str = "", anime_digitado: str = "") -> Path:
    """Grava a descoberta (o DiscoveryResult do pipeline) na pasta do episodio:
    os recortes, os centroides e o descoberta.json. Devolve o caminho do json.
    Os recortes de uma rodada anterior saem antes (os nomes se repetem)."""
    from .elenco_escolhido import gravar_grupos

    destino = pasta(disc.episode_root)
    destino.mkdir(parents=True, exist_ok=True)
    for velho in destino.glob("*.jpg"):
        velho.unlink(missing_ok=True)

    grupos = []
    centroides = []
    for i, g in enumerate(disc.groups):
        crops = []
        for j, jpg in enumerate(g.ref_crops_jpg):
            nome = f"g{g.key:03d}_{j:03d}.jpg"
            (destino / nome).write_bytes(jpg)
            crops.append(f"metadata/discovery/{nome}")
        centroides.append(de_bytes(g.centroid_bytes))
        grupos.append({
            "key": g.key,
            "faces": g.n_faces,
            "shots": g.n_shots,
            "minor": g.minor,
            "crops": crops,
            "suggestedName": g.suggested_name,
            "suggestedSim": round(float(g.suggested_sim), 3),
            "known": g.known,
            "suggestions": [{"name": n, "sim": float(s)} for n, s in g.suggestions],
            "shotPositions": list(g.shot_positions),
            "shotConf": {str(k): float(v) for k, v in g.shot_conf.items()},
            "centroide": i,
        })
    if centroides:
        np.save(destino / CENTROIDES, np.stack(centroides).astype(np.float32))
    gravar_grupos(disc.episode_root, [g.key for g in disc.groups], [g.centroid_bytes for g in disc.groups])
    dados = {
        "versao": VERSAO,
        "criadoEm": _agora(),
        "batismos": contador_de_batismos(cache_path),
        "assinaturaDoCorte": assinatura_do_corte(disc.episode_root),
        "episodeRoot": str(disc.episode_root),
        "fonte": str(fonte),
        "kind": kind,
        "animeTitle": disc.anime_title,
        "animeDigitado": anime_digitado or disc.anime_title,
        "season": disc.season,
        "episode": disc.episode,
        "animeId": disc.anime_id,
        "cacheId": disc.cache_id,
        "online": bool(disc.online),
        "roster": list(disc.roster),
        "totalFaces": disc.total_faces,
        "shots": [
            {"pos": s.pos, "idx": s.idx, "file": s.file, "keyframes": list(s.keyframes),
             "start": s.start, "end": s.end}
            for s in disc.shots
        ],
        "groups": grupos,
    }
    final = destino / ARQUIVO
    tmp = destino / (ARQUIVO + ".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    tmp.replace(final)
    return final


def ler(episode_root: str | Path) -> dict[str, Any] | None:
    try:
        dados = json.loads((pasta(episode_root) / ARQUIVO).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(dados, dict) or dados.get("versao") != VERSAO:
        return None
    return dados


def evento(dados: dict[str, Any]) -> dict[str, Any]:
    """O discovery-ready (o formato de sempre) da descoberta gravada."""
    return {
        "type": "discovery-ready",
        "episodeRoot": dados["episodeRoot"],
        "animeTitle": dados["animeTitle"],
        "season": dados["season"],
        "episode": dados["episode"],
        "totalFaces": dados["totalFaces"],
        "online": dados["online"],
        "roster": dados["roster"],
        "groups": [
            {k: g[k] for k in ("key", "faces", "shots", "minor", "crops", "suggestedName", "suggestedSim", "known", "suggestions")}
            for g in dados["groups"]
        ],
        "saved": str(pasta(dados["episodeRoot"]) / ARQUIVO),
    }


def usada(episode_root: str | Path) -> None:
    """Depois do commit: a descoberta nao vale mais (os nomes mudaram)."""
    arq = pasta(episode_root) / ARQUIVO
    try:
        if arq.exists():
            arq.replace(arq.with_name("descoberta.usada.json"))
    except OSError:
        pass


def para_resultado(dados: dict[str, Any], db, cache_id: str, anime_id: int, online: bool, roster: list[str]):
    """O DiscoveryResult do commit: as cenas entram no banco de novo (ids
    novos), os recortes voltam do disco e os centroides do npy."""
    from .pipeline_types import DiscoveredGroup, DiscoveryResult, DiscoveryShot

    root = Path(dados["episodeRoot"])
    episode_id = db.upsert_episode(
        anime_id, int(dados["season"]), int(dados["episode"]), str(dados.get("fonte") or ""),
        str(dados.get("kind") or ""), root=str(root),
    )
    db.set_episode_root(episode_id, str(root))
    db.clear_episode_shots(episode_id)
    shots = []
    for s in dados["shots"]:
        arquivo = Path(s["file"])
        kfs = [Path(k) for k in s["keyframes"]]
        main_kf = kfs[len(kfs) // 2] if kfs else None
        sid = db.insert_shot(
            episode_id=episode_id,
            idx=int(s["idx"]),
            file=str(arquivo.relative_to(root)) if arquivo.is_absolute() else str(arquivo),
            keyframe=str(main_kf.relative_to(root)) if main_kf and main_kf.is_absolute() else (str(main_kf) if main_kf else None),
            start=float(s["start"]),
            end=float(s["end"]),
        )
        shots.append(DiscoveryShot(pos=int(s["pos"]), shot_id=sid, idx=int(s["idx"]), file=str(arquivo),
                                   keyframes=[str(k) for k in kfs], start=float(s["start"]), end=float(s["end"])))
    cents = np.load(pasta(root) / CENTROIDES) if dados["groups"] else np.zeros((0, 1), np.float32)
    grupos = []
    for g in dados["groups"]:
        crops = []
        for rel in g["crops"]:
            try:
                crops.append((root / rel).read_bytes())
            except OSError:
                continue
        posicoes = [int(p) for p in g["shotPositions"]]
        grupos.append(DiscoveredGroup(
            key=int(g["key"]),
            n_faces=int(g["faces"]),
            n_shots=int(g["shots"]),
            thumbs_jpg=crops[:6],
            ref_crops_jpg=crops,
            shot_ids=sorted({shots[p].shot_id for p in posicoes if 0 <= p < len(shots)}),
            shot_positions=posicoes,
            shot_conf={int(k): float(v) for k, v in g["shotConf"].items()},
            centroid_bytes=para_bytes(np.asarray(cents[int(g["centroide"])], dtype=np.float32)),
            suggested_name=g.get("suggestedName") or "",
            suggested_sim=float(g.get("suggestedSim") or 0.0),
            known=bool(g.get("known")),
            minor=bool(g.get("minor")),
        ))
    return DiscoveryResult(
        anime_title=dados["animeTitle"],
        season=int(dados["season"]),
        episode=int(dados["episode"]),
        anime_id=anime_id,
        episode_id=episode_id,
        episode_root=root,
        cache_id=cache_id,
        shots=shots,
        groups=grupos,
        total_faces=int(dados["totalFaces"]),
        online=online,
        roster=roster,
    )
