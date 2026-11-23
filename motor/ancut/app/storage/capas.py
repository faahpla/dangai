"""As imagens da interface: a capa de cada episódio e o rosto de cada personagem.

A interface nova (11/2026) mostra o acervo por imagem — a Biblioteca era uma
lista de texto ("S01E01 · 444 cenas"), e em app de vídeo a imagem é o jeito
mais rápido de achar a coisa. Nada aqui é obrigatório: sem imagem, a tela
mostra um quadro neutro.

**Capa do episódio** (`metadata/capa.json`, escolhida uma vez): a cena mais
bonita do miolo do episódio, se a busca por cena já indexou (visao.py); senão
a cena do miolo em que o reconhecimento teve mais certeza de alguém (quase
sempre um rosto de perto); senão uma cena a um terço do episódio. O miolo
(15% a 85%) fica longe da abertura, dos créditos e do logo do estúdio, e o
quadro escuro demais (cena noturna, transição) é pulado.

**Rosto do personagem** (`<cache>/avatares/<id>.jpg`, 160 px): o rosto, nas
cenas de mais certeza, que mais parece com o próprio personagem — a cena de
mais certeza às vezes tem outro rosto maior na frente.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np

MIOLO = (0.15, 0.85)
QUADRO = 1
LUZ_MINIMA = 40


def _luz(arquivo: Path) -> float:
    import cv2

    img = cv2.imread(str(arquivo), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return 0.0
    return float(cv2.resize(img, (160, 90), interpolation=cv2.INTER_AREA).mean())


def capa_do_episodio(db, episode_id: int, raiz: Path) -> str:
    """O keyframe que representa o episódio, relativo à pasta dele ("" = nenhum)."""
    raiz = Path(raiz)
    memo = raiz / "metadata" / "capa.json"
    try:
        kf = json.loads(memo.read_text(encoding="utf-8")).get("keyframe", "")
        if kf and (raiz / kf).is_file():
            return kf
    except (OSError, ValueError, AttributeError):
        pass

    with db.connect() as c:
        idxs = sorted(int(r["idx"]) for r in c.execute(
            "SELECT idx FROM shot WHERE episode_id=?", (episode_id,)))
        if not idxs:
            return ""
        lo, hi = idxs[int(len(idxs) * MIOLO[0])], idxs[min(len(idxs) - 1, int(len(idxs) * MIOLO[1]))]
        certeza = [int(r["idx"]) for r in c.execute(
            "SELECT s.idx, MAX(sc.confidence) AS conf FROM shot s "
            "JOIN shot_character sc ON sc.shot_id = s.id "
            "WHERE s.episode_id=? AND s.idx BETWEEN ? AND ? "
            "GROUP BY s.id ORDER BY conf DESC LIMIT 12",
            (episode_id, lo, hi),
        )]

    candidatos: list[int] = []
    try:
        from ..visao import ler

        dados = ler(raiz)
        if dados:
            nit = np.median([d[2] for d in dados.values()])
            bons = sorted(
                (i for i, d in dados.items() if lo <= i <= hi and d[2] >= nit),
                key=lambda i: -dados[i][1],
            )
            candidatos += bons[:8]
    except Exception:
        pass
    candidatos += certeza
    candidatos.append(idxs[len(idxs) // 3])

    escolhido = ""
    for i in candidatos:
        q = raiz / "keyframes" / f"{i:04d}_{QUADRO}.jpg"
        if q.is_file() and _luz(q) >= LUZ_MINIMA:
            escolhido = f"keyframes/{q.name}"
            break
    if not escolhido:
        q = raiz / "keyframes" / f"{idxs[len(idxs) // 3]:04d}_{QUADRO}.jpg"
        escolhido = f"keyframes/{q.name}" if q.is_file() else ""
    if escolhido:
        try:
            memo.parent.mkdir(parents=True, exist_ok=True)
            memo.write_text(json.dumps({"keyframe": escolhido}), encoding="utf-8")
        except OSError:
            pass
    return escolhido


def marcadas_por_episodio(db) -> dict[int, int]:
    """{episódio: cenas com pelo menos um personagem} — a barrinha de quanto
    de cada anime já tem gente marcada."""
    with db.connect() as c:
        return {
            int(r["episode_id"]): int(r["n"])
            for r in c.execute(
                "SELECT s.episode_id, COUNT(DISTINCT s.id) AS n FROM shot s "
                "JOIN shot_character sc ON sc.shot_id = s.id GROUP BY s.episode_id"
            )
        }


def avatares(db, grupos: list, pasta: Path, orcamento_s: float = 4.0) -> dict[int, str]:
    """{primeiro id do grupo: caminho do rosto} pros grupos de personagem.

    O que já existe volta na hora; o que falta é recortado até acabar o
    `orcamento_s` (a primeira abertura de um acervo grande não pode estourar o
    tempo da chamada) — as próximas aberturas completam o resto.
    """
    import cv2

    from ..matching.embedding_engine import from_bytes
    from ..matching.face_detector import crops_from_boxes

    pasta = Path(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    saida: dict[int, str] = {}
    faltam = []
    for g in grupos:
        if not g.ids:
            continue
        arq = pasta / f"{min(g.ids)}.jpg"
        if arq.is_file():
            saida[min(g.ids)] = str(arq)
        else:
            faltam.append((g, arq))
    if not faltam:
        return saida

    inicio = time.monotonic()
    # Só o índice do face_cache de cada episódio (nome do quadro -> id); os
    # vetores são lidos quadro a quadro. Ler o arquivo inteiro custava ~1 s
    # por episódio, e cada personagem passa por vários.
    indices: dict[str, dict] = {}
    abertos: dict[str, object] = {}

    def rostos_do_quadro(raiz: str, nome: str):
        try:
            if raiz not in abertos:
                abertos[raiz] = None
                z = np.load(Path(raiz) / "metadata" / "face_cache.npz", allow_pickle=False)
                abertos[raiz] = z
                idx = json.loads(str(z["__meta__"]))["index"]
                indices[raiz] = {Path(k).name: ent["id"] for k, ent in idx.items()}
            z = abertos[raiz]
            i = indices.get(raiz, {}).get(nome)
            if z is None or i is None:
                return None
            kb, ke = f"a{i}:boxes", f"a{i}:embs"
            if kb not in z.files or ke not in z.files:
                return None
            b, e = z[kb], z[ke]
            return (b, e.astype(np.float32)) if len(b) and len(b) == len(e) else None
        except Exception:
            return None

    for g, arq in faltam:
        if time.monotonic() - inicio > orcamento_s:
            break
        with db.connect() as c:
            marca = ",".join("?" * len(g.ids))
            cent = None
            for r in c.execute(f"SELECT embedding FROM character WHERE id IN ({marca}) AND embedding IS NOT NULL", g.ids):
                try:
                    cent = from_bytes(r["embedding"]).astype(np.float32)
                    break
                except Exception:
                    continue
            linhas = c.execute(
                f"SELECT s.idx, e.output_root FROM shot_character sc JOIN shot s ON s.id = sc.shot_id "
                f"JOIN episode e ON e.id = s.episode_id WHERE sc.character_id IN ({marca}) "
                f"AND e.output_root IS NOT NULL ORDER BY sc.confidence DESC LIMIT 24",
                g.ids,
            ).fetchall()
        melhor = None
        for r in linhas:
            nome = f"{int(r['idx']):04d}_{QUADRO}.jpg"
            par = rostos_do_quadro(str(r["output_root"]), nome)
            if not par:
                continue
            for b, e in zip(*par):
                if b[2] < 72:
                    continue
                s = float(e @ cent) if cent is not None and cent.size == e.size else float(b[2]) / 1000
                if melhor is None or s > melhor[0]:
                    melhor = (s, r["output_root"], nome, b)
        if melhor is None:
            continue
        img = cv2.imread(str(Path(melhor[1]) / "keyframes" / melhor[2]))
        if img is None:
            continue
        cr, _ = crops_from_boxes(img, [tuple(int(v) for v in melhor[3])], 0.45)
        if cr and cv2.imwrite(str(arq), cv2.resize(cr[0], (160, 160), interpolation=cv2.INTER_AREA),
                              [cv2.IMWRITE_JPEG_QUALITY, 86]):
            saida[min(g.ids)] = str(arq)
    for z in abertos.values():
        try:
            z.close()  # type: ignore[union-attr]
        except Exception:
            pass
    return saida
