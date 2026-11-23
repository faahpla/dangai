"""Busca de cena por descrição e "as mais bonitas" — ideia do "Gerar recap" do Dangai.

Pra cada cena, o quadro do meio (`NNNN_1.jpg`) vira três números guardados
na pasta do episódio (`metadata/cenas_visao.npz`):

- o vetor do CLIP da imagem INTEIRA (o mesmo ViT-L/14 do reconhecimento, que
  ali olha só o rosto). Texto e imagem caem no mesmo espaço: "fight in the
  rain" fica perto das cenas de luta na chuva;
- a BELEZA pelo LAION aesthetic predictor v1 (uma camada linear 768 -> 1
  sobre esse mesmo vetor, MIT, `assets/laion_estetica_l14.json`, a mesma
  conta do Dangai) — custa um produto escalar por cena;
- a NITIDEZ pela variância do Laplaciano do quadro reduzido a 640 px: a
  "mais bonita" borrada no meio de um movimento não é a mais bonita.

Indexar um episódio é ~10-20 s com a placa de vídeo (o CLIP abre as ~550
imagens em lote); a análise faz isso no fim, e a busca completa sozinha o
que faltar no acervo antigo.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Callable

import numpy as np

ARQUIVO = "cenas_visao.npz"
NITIDEZ_LARGURA = 640
LOTE = 32
LEITORES = 6
#: O quadro que representa a cena (o do meio, como a miniatura do app).
QUADRO = 1
#: Moldes da frase pro CLIP: a média dos vetores dos moldes descreve melhor
#: do que um molde só (o truque do "prompt ensembling" do próprio CLIP).
MOLDES = (
    "an anime screenshot of {}.",
    "a scene from an anime: {}.",
    "{}, anime still frame.",
)


def _estetica() -> tuple[np.ndarray, float]:
    cru = json.loads((Path(__file__).parent / "assets" / "laion_estetica_l14.json").read_text(encoding="utf-8"))
    return np.asarray(cru["peso"], dtype=np.float32), float(cru["vies"])


def _nitidez(arquivo: Path) -> float:
    import cv2

    try:
        img = cv2.imread(str(arquivo), cv2.IMREAD_GRAYSCALE)
        if img is None:
            return 0.0
        h, w = img.shape[:2]
        if w > NITIDEZ_LARGURA:
            img = cv2.resize(img, (NITIDEZ_LARGURA, max(1, round(h * NITIDEZ_LARGURA / w))),
                             interpolation=cv2.INTER_AREA)
        return float(cv2.Laplacian(img, cv2.CV_64F).var())
    except Exception:  # noqa: BLE001 -- quadro torto não derruba o lote
        return 0.0


def _carimbo(p: Path) -> str:
    try:
        st = p.stat()
        return f"{st.st_mtime_ns}:{st.st_size}"
    except OSError:
        return ""


def ler(raiz: Path) -> dict[int, tuple[np.ndarray, float, float, str]]:
    """{idx da cena: (vetor, beleza, nitidez, carimbo do quadro)}."""
    try:
        with np.load(Path(raiz) / "metadata" / ARQUIVO, allow_pickle=False) as z:
            carimbos = json.loads(str(z["carimbos"]))
            return {
                int(i): (v.astype(np.float32), float(b), float(n), c)
                for i, v, b, n, c in zip(z["idx"], z["vetor"], z["beleza"], z["nitidez"], carimbos)
            }
    except Exception:
        return {}


def _gravar(raiz: Path, dados: dict[int, tuple[np.ndarray, float, float, str]]) -> None:
    arq = Path(raiz) / "metadata" / ARQUIVO
    arq.parent.mkdir(parents=True, exist_ok=True)
    ordem = sorted(dados)
    tmp = arq.with_name("cenas_visao.tmp.npz")
    np.savez(
        tmp,
        idx=np.asarray(ordem, dtype=np.int32),
        vetor=np.stack([dados[i][0] for i in ordem]).astype(np.float16) if ordem else np.zeros((0, 768), np.float16),
        beleza=np.asarray([dados[i][1] for i in ordem], dtype=np.float32),
        nitidez=np.asarray([dados[i][2] for i in ordem], dtype=np.float32),
        carimbos=np.array(json.dumps([dados[i][3] for i in ordem])),
    )
    tmp.replace(arq)


def faltando(raiz: Path, idxs: list[int]) -> list[int]:
    """As cenas sem índice (ou com o quadro trocado depois, como na junção)."""
    feitos = ler(raiz)
    kfs = Path(raiz) / "keyframes"
    out = []
    for i in idxs:
        q = kfs / f"{i:04d}_{QUADRO}.jpg"
        if not q.is_file():
            continue
        if i not in feitos or feitos[i][3] != _carimbo(q):
            out.append(i)
    return out


def indexar(raiz: Path, idxs: list[int], engine, parar: Callable[[], bool] | None = None) -> int:
    """Indexa as cenas que faltam deste episódio. Devolve quantas fez."""
    from concurrent.futures import ThreadPoolExecutor

    from PIL import Image

    raiz = Path(raiz)
    alvo = faltando(raiz, idxs)
    if not alvo:
        return 0
    dados = ler(raiz)
    peso, vies = _estetica()
    kfs = raiz / "keyframes"

    def preparar(i: int):
        q = kfs / f"{i:04d}_{QUADRO}.jpg"
        try:
            with Image.open(q) as im:
                t = engine.preprocess(im.convert("RGB"))
        except Exception:  # noqa: BLE001 -- quadro sumido fica de fora
            return i, None, 0.0, ""
        return i, t, _nitidez(q), _carimbo(q)

    feitas = 0
    with ThreadPoolExecutor(max_workers=LEITORES) as pool:
        for k in range(0, len(alvo), LOTE):
            if parar and parar():
                break
            prontos = [p for p in pool.map(preparar, alvo[k:k + LOTE]) if p[1] is not None]
            if not prontos:
                continue
            vetores = engine.embed_prontos([t for _, t, _, _ in prontos])
            for (i, _t, nit, car), v in zip(prontos, vetores):
                dados[i] = (v.astype(np.float32), round(float(v @ peso + vies), 4), round(nit, 2), car)
                feitas += 1
    _gravar(raiz, dados)
    return feitas


# ---------------------------------------------------------------------------
# A frase
# ---------------------------------------------------------------------------


def _normalizar(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto.lower())
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9 ]+", " ", t).strip()


def para_ingles(texto: str) -> str:
    """A descrição em inglês pro CLIP: frases do glossário primeiro, depois
    palavra por palavra (plural simples incluído); o resto passa como veio."""
    from .visao_glossario import FRASES, PALAVRAS

    t = " " + " ".join(_normalizar(texto).split()) + " "
    for frase in sorted(FRASES, key=len, reverse=True):
        t = t.replace(f" {frase} ", f" \x00{FRASES[frase]}\x00 ")
    saida: list[str] = []
    for pedaco in re.split(r"\x00", t):
        if not pedaco.strip():
            continue
        if pedaco in FRASES.values():
            saida.append(pedaco)
            continue
        for p in pedaco.split():
            if p in PALAVRAS:
                saida.append(PALAVRAS[p])
            elif p.endswith("s") and p[:-1] in PALAVRAS:
                saida.append(PALAVRAS[p[:-1]])
            else:
                saida.append(p)
    return " ".join(saida).strip()


def vetor_da_frase(engine, texto_en: str) -> np.ndarray:
    v = engine.embed_texts([m.format(texto_en) for m in MOLDES]).mean(axis=0)
    return (v / max(float(np.linalg.norm(v)), 1e-8)).astype(np.float32)


def separar_nomes(texto: str, nomes: list[str]) -> tuple[list[str], str]:
    """Os personagens citados na busca ("Lucy chorando" -> Lucy) e o resto,
    que é a descrição da cena. Nome de duas palavras ("Rudeus Greyrat") vale
    junto; palavra do glossário nunca é tomada por nome (uma "Rosa" não pode
    roubar o "rosa" da cor)."""
    from .naming import find_token_match
    from .visao_glossario import PALAVRAS

    palavras = texto.split()
    citados: list[str] = []
    resto: list[str] = []
    i = 0
    while i < len(palavras):
        achou = None
        for n in (2, 1):
            pedaco = " ".join(palavras[i:i + n])
            if n > len(palavras) - i or len(pedaco) < 3:
                continue
            if n == 1 and _normalizar(pedaco) in PALAVRAS:
                continue
            nome = find_token_match(pedaco, nomes)
            # Duas palavras só contam juntas se as DUAS são do nome: senão
            # "Lucy chorando" levava o "chorando" junto com a Lucy.
            if nome and n == 2 and not set(_normalizar(pedaco).split()) <= set(_normalizar(nome).split()):
                nome = None
            if nome:
                achou = (nome, n)
                break
        if achou:
            if achou[0] not in citados:
                citados.append(achou[0])
            i += achou[1]
        else:
            resto.append(palavras[i])
            i += 1
    return citados, " ".join(resto)


def buscar(db, output_dir: Path | str, episode_ids: list[int], consulta: str, ordem: str,
           limite: int, engine_de: Callable[[], object],
           progresso: Callable[[int, int], None] | None = None) -> dict:
    """As cenas destes episódios que mais parecem com a `consulta` (ou as
    mais bonitas, com `ordem` "beleza" ou sem consulta).

    `engine_de()` devolve o CLIP: só sobe se houver cena pra indexar ou
    frase pra entender — "as mais bonitas" de um acervo já indexado não
    carrega modelo nenhum.
    """
    from .storage.personagens import _rel

    base = Path(output_dir).resolve()
    with db.connect() as c:
        eps = [dict(r) for r in c.execute(
            f"SELECT e.id, e.output_root, e.anime_id, e.season, e.episode, e.kind "
            f"FROM episode e WHERE e.id IN ({','.join('?' * len(episode_ids))}) "
            f"AND e.output_root IS NOT NULL",
            [int(i) for i in episode_ids],
        )] if episode_ids else []
        anime_ids = sorted({int(e["anime_id"]) for e in eps})
        elenco = [dict(r) for r in c.execute(
            f"SELECT id, name FROM character WHERE anime_id IN ({','.join('?' * len(anime_ids))})",
            anime_ids,
        )] if anime_ids else []

    citados, descricao = separar_nomes(consulta.strip(), [str(x["name"]) for x in elenco])
    ids_citados = [[int(x["id"]) for x in elenco if x["name"] == n] for n in citados]

    # 1) o que falta indexar
    pendentes: list[tuple[dict, list[int]]] = []
    for e in eps:
        raiz = Path(e["output_root"])
        if not raiz.is_dir():
            continue
        with db.connect() as c:
            idxs = [int(r["idx"]) for r in c.execute("SELECT idx FROM shot WHERE episode_id=?", (e["id"],))]
        f = faltando(raiz, idxs)
        if f:
            pendentes.append((e, f))
    if pendentes:
        engine = engine_de()
        for n, (e, f) in enumerate(pendentes):
            if progresso:
                progresso(n, len(pendentes))
            indexar(Path(e["output_root"]), f, engine)
        if progresso:
            progresso(len(pendentes), len(pendentes))

    # 2) a frase
    texto_en = para_ingles(descricao) if descricao.strip() else ""
    alvo = vetor_da_frase(engine_de(), texto_en) if texto_en else None

    # 3) as cenas
    candidatas = []
    for e in eps:
        raiz = Path(e["output_root"])
        dados = ler(raiz)
        if not dados:
            continue
        with db.connect() as c:
            linhas = [dict(r) for r in c.execute(
                "SELECT id, idx, file, keyframe, start, end FROM shot WHERE episode_id=?", (e["id"],))]
            quem: dict[int, set[int]] = {}
            for r in c.execute(
                "SELECT sc.shot_id, sc.character_id FROM shot_character sc "
                "JOIN shot s ON s.id = sc.shot_id WHERE s.episode_id=?", (e["id"],)
            ):
                quem.setdefault(int(r["shot_id"]), set()).add(int(r["character_id"]))
        for r in linhas:
            d = dados.get(int(r["idx"]))
            if d is None:
                continue
            if ids_citados and not all(quem.get(int(r["id"]), set()) & set(ids) for ids in ids_citados):
                continue
            candidatas.append((e, r, d))
    if not candidatas:
        return {"shots": [], "consultaEn": texto_en, "personagens": citados, "total": 0}

    beleza = np.asarray([d[1] for _, _, d in candidatas], dtype=np.float32)
    nit = np.log1p(np.asarray([d[2] for _, _, d in candidatas], dtype=np.float32))
    # A nitidez só desempata pra baixo: quadro borrado (o quarto mais
    # borrado do conjunto) perde meio ponto de beleza.
    corte = float(np.percentile(nit, 25)) if len(nit) > 3 else 0.0
    bonita = beleza - np.where(nit < corte, 0.5, 0.0)
    if alvo is not None:
        sim = np.stack([d[0] for _, _, d in candidatas]) @ alvo
        nota = sim if ordem != "beleza" else bonita
        if ordem == "beleza":
            # "as mais bonitas DESTA descrição": só o terço mais parecido entra
            limiar = float(np.percentile(sim, 67))
            nota = np.where(sim >= limiar, bonita, -1e9)
    else:
        sim = np.zeros(len(candidatas), dtype=np.float32)
        nota = bonita
    ordem_idx = np.argsort(-nota)[: max(1, int(limite))]

    shots = []
    for k in ordem_idx:
        if nota[k] <= -1e8:
            break
        e, r, d = candidatas[int(k)]
        raiz = Path(e["output_root"])
        arquivo = raiz / str(r["file"] or "")
        kf = raiz / str(r["keyframe"] or "") if r["keyframe"] else None
        shots.append({
            "id": r["id"],
            "idx": r["idx"],
            "file": _rel(str(arquivo), base),
            "keyframe": _rel(str(kf), base) if kf else "",
            "absolute": str(arquivo),
            "duration": round(float(r["end"]) - float(r["start"]), 3),
            "confidence": None,
            "anime": raiz.parent.name,
            "season": e["season"],
            "episode": e["episode"],
            "kind": e["kind"] or "",
            "episodeId": e["id"],
            "relevancia": round(float(sim[k]), 4),
            "beleza": round(float(d[1]), 2),
        })
    return {"shots": shots, "consultaEn": texto_en, "personagens": citados, "total": len(candidatas)}
