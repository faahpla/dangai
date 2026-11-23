"""Quem fala em cada cena, pela legenda do próprio arquivo — ideia do Dangai.

A legenda da Crunchyroll traz o nome de quem fala em TODA fala (no acervo do
FAAH: Black Clover 267 de 267, "The Apothecary Diaries" 347 de 347). A da
Netflix e a da Disney+ não trazem — aí não há pista, e nada muda.

É pista, não prova: quem fala pode estar fora do quadro (narração, voz do
outro lado da porta, o plano do rosto de quem ESCUTA). Por isso ela nunca
marca ninguém sozinha. Ver `matching/repescagem.py`: ela só pesa quando o
ROSTO na cena já aponta pra mesma pessoa.

A faixa é lida uma vez (o ffmpeg atravessa o arquivo inteiro, alguns
segundos) e guardada em `metadata/falas.json` do episódio.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

#: Fração mínima das falas com nome pra faixa valer (fansub costuma pôr nome
#: em placa e letreiro, não em fala).
MIN_COM_NOME = 0.5
#: Quanto de fala precisa cair dentro da cena (o menor dos dois).
SOBRA_S = 1.0
SOBRA_FRACAO = 0.4

_SEM_JANELA = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
_TEMPO = re.compile(r"(\d+):(\d+):(\d+)[.,](\d+)")


def _segundos(t: str) -> float:
    m = _TEMPO.search(t)
    if not m:
        return -1.0
    h, mi, s, frac = m.groups()
    return int(h) * 3600 + int(mi) * 60 + int(s) + int(frac) / (10 ** len(frac))


def ler_ass(texto: str) -> list[dict]:
    """[{inicio, fim, quem}] das falas COM nome de uma legenda ASS."""
    cols: list[str] | None = None
    falas = []
    for linha in texto.splitlines():
        if linha.startswith("Format:") and cols is None and "Text" in linha:
            cols = [c.strip().lower() for c in linha[7:].split(",")]
        elif linha.startswith("Dialogue:") and cols:
            partes = linha[9:].split(",", len(cols) - 1)
            if len(partes) < len(cols):
                continue
            reg = dict(zip(cols, partes))
            quem = (reg.get("name") or reg.get("actor") or "").strip()
            ini, fim = _segundos(reg.get("start", "")), _segundos(reg.get("end", ""))
            if ini >= 0 and fim > ini:
                falas.append({"inicio": ini, "fim": fim, "quem": quem})
    return falas


def _faixas(video: Path) -> list[dict]:
    from .ffmpeg_locate import ffprobe_binary

    try:
        r = subprocess.run(
            [str(ffprobe_binary()), "-v", "error", "-select_streams", "s",
             "-show_entries", "stream=index,codec_name:stream_tags=language,title",
             "-of", "json", str(video)],
            capture_output=True, timeout=60, creationflags=_SEM_JANELA,
        )
        return json.loads(r.stdout.decode("utf-8", "replace") or "{}").get("streams", [])
    except Exception:
        return []


def _extrair(video: Path, indice: int) -> str:
    from .ffmpeg_locate import ffmpeg_binary

    try:
        r = subprocess.run(
            [str(ffmpeg_binary()), "-v", "error", "-i", str(video), "-map", f"0:{indice}",
             "-c:s", "ass", "-f", "ass", "-"],
            capture_output=True, timeout=300, creationflags=_SEM_JANELA,
        )
        return r.stdout.decode("utf-8", "replace") if r.returncode == 0 else ""
    except Exception:
        return ""


def _carimbo(video: Path) -> str:
    try:
        st = video.stat()
        return f"{video}|{st.st_size}|{st.st_mtime_ns}"
    except OSError:
        return ""


def falas_do_episodio(video: Path | str, raiz: Path | str) -> list[dict]:
    """As falas com nome do episódio (do cache, ou lidas agora). Vazio = o
    arquivo não tem legenda com nome (ou nem está mais no disco)."""
    video, raiz = Path(video), Path(raiz)
    cache = raiz / "metadata" / "falas.json"
    carimbo = _carimbo(video)
    try:
        dado = json.loads(cache.read_text(encoding="utf-8"))
        if dado.get("carimbo") == carimbo or not carimbo:
            return dado.get("falas", [])
    except (OSError, ValueError, AttributeError):
        pass
    if not carimbo:
        return []

    melhor: list[dict] = []
    # ASS primeiro (é onde mora o nome), inglês na frente: a faixa principal.
    faixas = sorted(
        (f for f in _faixas(video) if f.get("codec_name") == "ass"),
        key=lambda f: (f.get("tags", {}).get("language") != "eng", f.get("index", 0)),
    )
    for f in faixas[:4]:
        titulo = (f.get("tags", {}).get("title") or "").lower()
        if "sign" in titulo or "forced" in titulo:
            continue
        falas = ler_ass(_extrair(video, int(f["index"])))
        com = [x for x in falas if x["quem"]]
        if falas and len(com) / len(falas) >= MIN_COM_NOME:
            melhor = com
            break
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"carimbo": carimbo, "falas": melhor}, ensure_ascii=False),
                         encoding="utf-8")
    except OSError:
        pass
    return melhor


def falantes_por_cena(falas: list[dict], cenas: list[tuple[int, float, float]],
                      elenco: dict[int, str]) -> dict[int, dict[int, float]]:
    """{id da cena: {character_id de quem fala nela: segundos de fala}}.

    `cenas` = [(id, início, fim)]; `elenco` = {character_id: nome}. O nome da
    legenda ("MAGNA", "Maomao") casa com o do elenco pela mesma regra de
    nomes do resto do app; quem não está no elenco ("Owner", "Text") fica de
    fora. Conta a fala que ocupa pelo menos 1 s ou 40% da cena (o que for
    menor): o resto de uma frase que vaza pro plano seguinte é, quase sempre,
    o plano de quem ESCUTA.
    """
    from .naming import find_token_match

    nomes = list(elenco.values())
    por_nome = {v: k for k, v in elenco.items()}
    quem_e: dict[str, int | None] = {}
    for f in falas:
        q = f["quem"]
        if q not in quem_e:
            # "MAGNA; ZORA" (os dois falam junto) vira dois
            achados = [find_token_match(p.strip(), nomes) for p in re.split(r"[;&/]", q) if p.strip()]
            quem_e[q] = [por_nome[a] for a in achados if a] or None
    saida: dict[int, dict[int, float]] = {}
    for sid, ini, fim in cenas:
        dur = max(fim - ini, 1e-3)
        for f in falas:
            if f["fim"] <= ini or f["inicio"] >= fim:
                continue
            junto = min(fim, f["fim"]) - max(ini, f["inicio"])
            if junto >= min(SOBRA_S, SOBRA_FRACAO * dur) and quem_e.get(f["quem"]):
                d = saida.setdefault(sid, {})
                for cid in quem_e[f["quem"]]:
                    d[cid] = d.get(cid, 0.0) + junto
    return saida
