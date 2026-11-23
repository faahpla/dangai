from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def write_shots_json(out_path: Path, payload: list[dict[str, Any]]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Arquivo temporário + troca: o Dangai lê este json enquanto o AnCut
    # roda, e um json pela metade some da biblioteca dele.
    tmp = out_path.with_name(out_path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, out_path)


def _pares(names: list[str]) -> list[str]:
    pairs: list[str] = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = sorted([names[i], names[j]])
            pairs.append(f"{a}+{b}")
    return pairs


def atualizar_personagens_do_json(db, episode_id: int) -> bool:
    """Põe no `shots.json` os personagens que o banco diz AGORA.

    O `shots.json` era escrito só no fim da análise — e é dele, não do banco,
    que o Dangai tira quem está em cada cena. Toda marcação feita à mão
    depois (marcar, tirar personagem, repescagem) ficava só no AnCut: o FAAH
    marcava a cena e o Dangai continuava mostrando ela sem ninguém.

    Mexe só em `characters` e `pairs` das cenas que o banco conhece; o resto
    da linha (arquivo, tempos) é o retrato do corte e fica como está.
    """
    with db.connect() as c:
        r = c.execute(
            "SELECT output_root FROM episode WHERE id=?", (episode_id,)
        ).fetchone()
        if not r or not r["output_root"]:
            return False
        idx_por_id = {
            int(s["id"]): int(s["idx"])
            for s in c.execute("SELECT id, idx FROM shot WHERE episode_id=?", (episode_id,))
        }
    arq = Path(str(r["output_root"])) / "metadata" / "shots.json"
    try:
        linhas = json.loads(arq.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if not isinstance(linhas, list):
        return False

    por_idx: dict[int, list[dict]] = {i: [] for i in idx_por_id.values()}
    for sid, assigns in db.assignments_for_episode(episode_id).items():
        if sid in idx_por_id:
            por_idx[idx_por_id[sid]] = assigns
    mudou = False
    for linha in linhas:
        try:
            idx = int(str(linha.get("shot_id")))
        except (TypeError, ValueError, AttributeError):
            continue
        if idx not in por_idx:
            continue
        assigns = por_idx[idx]
        chars = [
            {"name": a["name"], "confidence": round(float(a["confidence"] or 0.0), 3)}
            for a in assigns
        ]
        if chars != linha.get("characters"):
            linha["characters"] = chars
            linha["pairs"] = _pares([a["name"] for a in assigns])
            mudou = True
    if mudou:
        try:
            write_shots_json(arq, linhas)
        except OSError:
            return False
    return mudou


def write_characters_json(out_path: Path, characters: list[dict[str, Any]]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(characters, indent=2, ensure_ascii=False), encoding="utf-8")


def build_shot_payload(
    shot: dict,
    anime: str,
    season: int,
    episode: int,
    characters: list[dict],
    kind: str = "",
    titulo: str = "",
) -> dict:
    pairs = _pares([c["name"] for c in characters])
    payload = {
        "shot_id": f"{shot['idx']:04d}",
        "file": shot["file"],
        "keyframe": shot.get("keyframe"),
        "start": round(shot["start"], 3),
        "end": round(shot["end"], 3),
        "duration": round(shot["end"] - shot["start"], 3),
        "characters": [
            {"name": c["name"], "confidence": round(c["confidence"], 3)} for c in characters
        ],
        "pairs": pairs,
        "anime": anime,
        "season": season,
        "episode": episode,
    }
    if kind == "BROLL":
        # O Dangai lê este arquivo, não o banco: sem a marca, o "B-roll 01"
        # chegava lá como S01E01 e o recap usava cena de trailer como se
        # fosse do episódio 1. Ver `marcar_broll_no_json`.
        payload["kind"] = "BROLL"
        payload["titulo"] = titulo
    return payload


def marcar_broll_no_json(shots_json: Path, titulo: str) -> bool:
    """Põe a marca de B-roll num shots.json que já existe.

    Pra B-roll feito antes da marca existir (motor 0.24.0/0.24.1) e pra
    episódio que virou B-roll pelo "Passar pra B-roll". Devolve True se
    mudou alguma coisa. Só acrescenta campos: o resto (personagens marcados
    à mão, cenas juntadas) fica como está.
    """
    try:
        cenas = json.loads(shots_json.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if not isinstance(cenas, list):
        return False
    mudou = False
    for c in cenas:
        if isinstance(c, dict) and (c.get("kind") != "BROLL" or c.get("titulo") != titulo):
            c["kind"] = "BROLL"
            c["titulo"] = titulo
            mudou = True
    if mudou:
        write_shots_json(shots_json, cenas)
    return mudou
