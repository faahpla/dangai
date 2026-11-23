"""Pacote de personagens: levar o "quem é quem" de um anime pra outro AnCut.

Ideia do Levi. A análise em si não viaja (os clipes de cada um saem de
arquivos e cortes diferentes); o conhecimento sim: os personagens com nome,
os rostos aprovados e o centroide de cada um.

**Versão 2 (01/11/2026), depois do teste do Levi com o Black Clover.** A 1ª
saiu com três furos, todos apontados pelo Claude dele com prova:

1. Anime batizado sem internet ("local") exportava SEM FOTO NENHUMA, calado
   — as fotos eram procuradas numa pasta só, e ela não existia.
2. Importar criava uma linha de anime solta no banco, que a análise (que
   resolve o anime online) nunca olhava.
3. "Swing, Magna" (AniList) e "magna swing" (digitado no batismo) iam como
   dois personagens disputando o mesmo rosto.

Agora: as fotos vêm de toda pasta de refs que pode ser deste anime e, se
faltar, dos PRÓPRIOS episódios (o rosto das cenas em que o personagem foi
batizado); o resumo diz quem saiu sem foto; o mesmo personagem em formatos
diferentes vira um; e importar guarda o pacote como elenco importado
(`elencos_importados.py`), que se liga à análise na hora, pelo id ou pelo
título-base — sem criar nada no banco.

Formato v2 (um .zip):

    elenco.json        a identidade do anime e os personagens
    fotos/<n>/<arq>    as fotos do personagem n (a ordem do elenco.json)

O pacote da 1.34 (v1) ainda é lido.
"""

from __future__ import annotations

import base64
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from ..naming import find_token_match, name_tokens
from ..references.image_filters import PLACEHOLDERS
from ..references.reference_store import resolve_anime_dir
from . import elencos_importados as reg
from .db import Database

FORMATO = "ancut-elenco"
VERSAO = 2
_IMAGENS = {".jpg", ".jpeg", ".png", ".webp"}
#: Teto de fotos por personagem: o bastante pros vários jeitos de desenhar
#: o rosto, sem o arquivo crescer à toa.
TETO_FOTOS = 20
#: Abaixo disto, completa com rostos tirados dos próprios episódios. A
#: análise exige 2; 6 dá margem pra perfil, close e plano aberto.
MINIMO_FOTOS = 6


@dataclass
class Resumo:
    personagens: int = 0
    com_fotos: int = 0
    sem_fotos: list[str] = field(default_factory=list)
    fotos: int = 0
    centroides: int = 0
    juntados: int = 0
    titulo: str = ""
    titulos: list[str] = field(default_factory=list)
    erro: str = ""

    def payload(self) -> dict:
        return {
            "characters": self.personagens,
            "withPhotos": self.com_fotos,
            "withoutPhotos": self.sem_fotos,
            "photos": self.fotos,
            "centroids": self.centroides,
            "merged": self.juntados,
            "title": self.titulo,
            "titles": self.titulos,
            "erro": self.erro,
            # a tela da 1.34 lia isto
            "animes": 1 if self.personagens else 0,
        }


# ---------------------------------------------------------------- utilidades

def _ler_img(p: Path):
    try:
        return cv2.imdecode(np.fromfile(str(p), dtype=np.uint8), cv2.IMREAD_COLOR)
    except OSError:
        return None


def _vetor(blob: bytes) -> np.ndarray | None:
    """O centroide guardado no banco. É um .npy inteiro (com cabeçalho), o
    formato do `to_bytes` do motor — ler os bytes crus dava 800 números em
    vez de 768 e toda comparação saía errada. Lido aqui sem importar o
    embedding_engine, que puxaria o torch inteiro só pra exportar."""
    try:
        v = np.load(io.BytesIO(blob), allow_pickle=False)
    except Exception:
        return None
    return np.asarray(v, dtype=np.float32).reshape(-1)


def _bytes(v: np.ndarray) -> bytes:
    buf = io.BytesIO()
    np.save(buf, v.astype(np.float32), allow_pickle=False)
    return buf.getvalue()


def _juntar_centroides(blobs: list[bytes]) -> bytes | None:
    """Média dos centroides do mesmo personagem (renormalizada)."""
    vs = [v for v in (_vetor(b) for b in blobs if b) if v is not None and v.size]
    if not vs:
        return None
    vs = [v for v in vs if v.size == vs[0].size]
    m = np.mean(np.stack(vs), axis=0)
    m = m / max(float(np.linalg.norm(m)), 1e-8)
    return _bytes(m)


def _agrupar_por_pessoa(nomes: list[str]) -> list[list[str]]:
    """Grupos de nomes que são a mesma pessoa ("Swing, Magna" ≡ "magna swing").

    Só igualdade de palavras: o caso "Rimuru" ⊂ "Rimuru Tempest" fica de fora
    aqui, porque num elenco inteiro o subconjunto é ambíguo demais (a família
    Silva toda é "Silva").
    """
    grupos: list[list[str]] = []
    for n in nomes:
        tn = name_tokens(n)
        for g in grupos:
            if tn and name_tokens(g[0]) == tn:
                g.append(n)
                break
        else:
            grupos.append([n])
    return grupos


def _nome_preferido(grupo: list[str], com_catalogo: set[str]) -> str:
    """O nome que fica: o do catálogo, se houver; senão o escrito com
    maiúscula; senão o primeiro."""
    for n in grupo:
        if n in com_catalogo:
            return n
    for n in grupo:
        if n != n.lower():
            return n
    return grupo[0]


# ---------------------------------------------------------------- exportar

def _pastas_de_refs(cache_path: Path, animes: list[dict], titulos: list[str]) -> list[Path]:
    """Toda pasta de refs que pode ser deste anime.

    A da franquia (al<raiz>), a de cada temporada, e as "local-…" do título e
    do nome da pasta — o anime batizado sem internet guarda as fotos numa
    destas, e a 1ª versão só olhava a primeira.
    """
    from ..providers.anime_provider import local_cache_id

    root = cache_path / "anime_db"
    ids: set[int] = {int(a["anilist_id"]) for a in animes if a.get("anilist_id")}
    cands: list[Path] = []
    if root.is_dir() and ids:
        for p in root.glob("*/metadata.json"):
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if ids & ({d.get("anilist_id")} | set(d.get("franchise_ids") or [])):
                cands.append(p.parent)
    for a in animes:
        if a.get("anilist_id"):
            cands.append(resolve_anime_dir(cache_path, f"al{a['anilist_id']}"))
        if a.get("mal_id"):
            cands.append(resolve_anime_dir(cache_path, f"mal{a['mal_id']}"))
    for t in titulos:
        if t:
            cands.append(resolve_anime_dir(cache_path, local_cache_id(t)))
    vistos: set[str] = set()
    out = []
    for c in cands:
        k = str(c).lower()
        if k not in vistos and (c / "characters").is_dir():
            vistos.add(k)
            out.append(c)
    return out


def _fotos_das_pastas(pastas: list[Path], nomes: list[str]) -> list[Path]:
    fotos: list[Path] = []
    for pasta in pastas:
        chars = pasta / "characters"
        dirs = [d.name for d in chars.iterdir() if d.is_dir() and not d.name.startswith("_")]
        achados = set()
        for n in nomes:
            m = find_token_match(n, dirs)
            if m:
                achados.add(m)
        for m in achados:
            for f in sorted((chars / m).iterdir()):
                if (f.is_file() and f.suffix.lower() in _IMAGENS
                        and f.name.lower() not in PLACEHOLDERS):
                    fotos.append(f)
    # Rostos do próprio anime primeiro (auto_*, imp_*), catálogo depois.
    fotos.sort(key=lambda f: (0 if f.name.lower().startswith(("auto", "imp_")) else 1, f.name))
    return fotos


def _rostos_dos_episodios(db: Database, char_ids: list[int], ep_ids: list[int],
                          centroide: bytes | None, quantos: int) -> list[bytes]:
    """Rostos tirados das cenas em que o personagem foi batizado.

    O cache de rostos de cada episódio (metadata/face_cache.npz) já tem as
    caixas e os embeddings de cada keyframe: aqui só se escolhe, em cada cena
    do personagem, o rosto mais parecido com o centroide dele, e recorta.
    """
    from ..matching.face_detector import crops_from_boxes

    if not char_ids or not ep_ids or quantos <= 0:
        return []
    cent = _vetor(centroide) if centroide else None
    m1, m2 = ",".join("?" * len(char_ids)), ",".join("?" * len(ep_ids))
    with db.connect() as c:
        cenas = [dict(r) for r in c.execute(
            "SELECT s.idx, e.output_root, sc.confidence FROM shot_character sc "
            "JOIN shot s ON s.id = sc.shot_id JOIN episode e ON e.id = s.episode_id "
            f"WHERE sc.character_id IN ({m1}) AND s.episode_id IN ({m2}) "
            "ORDER BY sc.confidence DESC LIMIT 80",
            (*char_ids, *ep_ids),
        )]
    caches: dict[str, dict] = {}
    achados: list[tuple[float, str, bytes]] = []
    for cena in cenas:
        root = Path(str(cena["output_root"] or ""))
        if not root.is_dir():
            continue
        chave = str(root).lower()
        if chave not in caches:
            caches[chave] = {}
            arq = root / "metadata" / "face_cache.npz"
            if arq.is_file():
                try:
                    with np.load(arq, allow_pickle=False) as z:
                        idx = json.loads(str(z["__meta__"]))["index"]
                        for k, ent in idx.items():
                            kb, ke = f"a{ent['id']}:boxes", f"a{ent['id']}:embs"
                            if kb in z.files and ke in z.files:
                                caches[chave][Path(k).name] = (z[kb], z[ke])
                except Exception:
                    pass
        feats = caches[chave]
        melhor = None
        for k in range(3):
            nome = f"{int(cena['idx']):04d}_{k}.jpg"
            if nome not in feats:
                continue
            boxes, embs = feats[nome]
            if len(boxes) == 0 or embs.size == 0 or len(boxes) != len(embs):
                continue
            if cent is not None and embs.shape[1] == cent.size:
                sims = embs @ cent
                j = int(np.argmax(sims))
                s = float(sims[j])
            else:
                j = int(np.argmax([b[2] * b[3] for b in boxes]))
                s = 0.0
            if melhor is None or s > melhor[0]:
                melhor = (s, nome, boxes[j])
        if melhor is None or (cent is not None and melhor[0] < 0.80):
            continue
        img = _ler_img(root / "keyframes" / melhor[1])
        if img is None:
            continue
        crops, _ = crops_from_boxes(img, [tuple(int(v) for v in melhor[2])], 0.25)
        if not crops:
            continue
        crop = crops[0]
        h, w = crop.shape[:2]
        esc = 256 / max(h, w)
        if esc < 1:
            crop = cv2.resize(crop, (int(w * esc), int(h * esc)), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if ok:
            achados.append((melhor[0], f"{chave}|{cena['idx']}", buf.tobytes()))
    achados.sort(key=lambda t: -t[0])
    vistos, out = set(), []
    for _s, k, b in achados:
        if k in vistos:
            continue
        vistos.add(k)
        out.append(b)
        if len(out) >= quantos:
            break
    return out


def exportar(db: Database, cache_path: Path, episode_ids: list[int], destino: Path,
             modelo: dict, nome_pasta: str = "") -> Resumo:
    resumo = Resumo()
    marcas = ",".join("?" * len(episode_ids)) or "NULL"
    with db.connect() as c:
        animes = [dict(r) for r in c.execute(
            "SELECT DISTINCT a.id, a.title, a.title_english, a.anilist_id, a.mal_id "
            f"FROM anime a JOIN episode e ON e.anime_id = a.id WHERE e.id IN ({marcas})",
            tuple(episode_ids),
        )]
        exemplo = c.execute(
            f"SELECT source_file FROM episode WHERE id IN ({marcas}) "
            "AND source_file IS NOT NULL LIMIT 1",
            tuple(episode_ids),
        ).fetchone()
    if not animes:
        resumo.erro = "nenhum anime nesses episódios"
        return resumo

    titulos = [t for a in animes for t in (a["title"], a.get("title_english")) if t]
    if nome_pasta:
        titulos.append(nome_pasta)
    titulos = list(dict.fromkeys(titulos))

    # Identidade: ids de todas as linhas e a franquia do cache do catálogo.
    anilist_ids = {int(a["anilist_id"]) for a in animes if a.get("anilist_id")}
    mal_ids = {int(a["mal_id"]) for a in animes if a.get("mal_id")}
    raiz_franquia = None
    pastas = _pastas_de_refs(cache_path, animes, titulos)
    for pasta in pastas:
        try:
            d = json.loads((pasta / "metadata.json").read_text(encoding="utf-8"))
        except Exception:
            continue
        anilist_ids |= {int(i) for i in d.get("franchise_ids") or [] if i}
        raiz_franquia = raiz_franquia or d.get("franchise_root_id")
        for t in (d.get("title"), d.get("title_english")):
            if t and t not in titulos:
                titulos.append(t)

    # Personagens de todas as linhas, juntando quem é a mesma pessoa.
    linhas: dict[str, list[dict]] = {}
    for a in animes:
        for ch in db.get_characters_for_anime(a["id"]):
            nome = (ch.get("name") or "").strip()
            if nome:
                linhas.setdefault(nome, []).append(ch)
    com_catalogo = {
        n for n, rs in linhas.items() if any(r.get("anilist_id") or r.get("mal_id") for r in rs)
    }

    personagens: list[dict] = []
    blobs_fotos: list[list[tuple[str, bytes]]] = []
    for g in _agrupar_por_pessoa(list(linhas)):
        rows = [r for n in g for r in linhas[n]]
        nome = _nome_preferido(g, com_catalogo)
        cent = _juntar_centroides([r["embedding"] for r in rows if r.get("embedding")])
        fotos: list[tuple[str, bytes]] = []
        for f in _fotos_das_pastas(pastas, g)[:TETO_FOTOS]:
            try:
                fotos.append((f.name, f.read_bytes()))
            except OSError:
                pass
        if len(fotos) < MINIMO_FOTOS:
            extra = _rostos_dos_episodios(
                db, [int(r["id"]) for r in rows], episode_ids, cent,
                min(TETO_FOTOS - len(fotos), MINIMO_FOTOS * 2),
            )
            fotos += [(f"auto_ep_{i:02d}.jpg", b) for i, b in enumerate(extra)]
        personagens.append({
            "nome": nome,
            "aliases": [n for n in g if n != nome],
            "papel": next((r.get("role") for r in rows if r.get("role")), "Main"),
            "anilist_id": next((r.get("anilist_id") for r in rows if r.get("anilist_id")), None),
            "centroide": base64.b64encode(cent).decode("ascii") if cent else None,
        })
        blobs_fotos.append(fotos)
        resumo.personagens += 1
        resumo.juntados += len(g) - 1
        resumo.centroides += 1 if cent else 0
        if fotos:
            resumo.com_fotos += 1
            resumo.fotos += len(fotos)
        else:
            resumo.sem_fotos.append(nome)

    if not personagens:
        resumo.erro = "este anime ainda não tem nenhum personagem batizado pra exportar"
        return resumo

    resumo.titulo = nome_pasta or animes[0]["title"]
    resumo.titulos = titulos
    manifesto = {
        "formato": FORMATO,
        "versao": VERSAO,
        "criado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "modelo": modelo,
        "anime": {
            "titulo": resumo.titulo,
            "titulos": titulos,
            "anilist_ids": sorted(anilist_ids),
            "mal_ids": sorted(mal_ids),
            "franchise_root_id": raiz_franquia,
            "exemplo_arquivo": Path(exemplo[0]).name if exemplo and exemplo[0] else None,
        },
        "personagens": [],
    }
    destino.parent.mkdir(parents=True, exist_ok=True)
    parcial = destino.with_suffix(destino.suffix + ".part")
    with zipfile.ZipFile(parcial, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for i, (p, fotos) in enumerate(zip(personagens, blobs_fotos)):
            rels = []
            for nome_arq, b in fotos:
                rel = f"fotos/{i:03d}/{nome_arq}"
                z.writestr(rel, b)
                rels.append(rel)
            manifesto["personagens"].append({**p, "fotos": rels})
        z.writestr("elenco.json", json.dumps(manifesto, ensure_ascii=False, indent=2))
    parcial.replace(destino)
    return resumo


# ---------------------------------------------------------------- importar

def _ler_manifesto(z: zipfile.ZipFile) -> tuple[dict | None, str]:
    try:
        m = json.loads(z.read("elenco.json").decode("utf-8"))
    except (KeyError, ValueError):
        return None, "o arquivo não tem o elenco.json — não é um pacote de personagens do AnCut"
    if m.get("formato") != FORMATO:
        return None, "o arquivo não é um pacote de personagens do AnCut"
    if int(m.get("versao") or 0) > VERSAO:
        return None, "pacote feito por um AnCut mais novo — atualize o app"
    return m, ""


def _normalizar(m: dict, z: zipfile.ZipFile) -> dict:
    """O manifesto em formato v2 — o da 1.34 (v1) é convertido aqui."""
    if int(m.get("versao") or 1) >= 2:
        return m
    titulos, ids, pessoas = [], set(), []
    nomes_zip = z.namelist()
    for a in m.get("animes") or []:
        for t in (a.get("titulo"), a.get("titulo_ingles")):
            if t and t not in titulos:
                titulos.append(t)
        if a.get("anilist_id"):
            ids.add(int(a["anilist_id"]))
        prefixo = f"animes/{a.get('cache_id')}/characters/"
        pastas: dict[str, list[str]] = {}
        for n in nomes_zip:
            if n.startswith(prefixo) and not n.endswith("/"):
                partes = n[len(prefixo):].split("/")
                if len(partes) == 2:
                    pastas.setdefault(partes[0], []).append(n)
        for p in a.get("personagens") or []:
            alvo = find_token_match(p.get("nome") or "", list(pastas))
            pessoas.append({**p, "fotos": pastas.get(alvo, []) if alvo else []})
    return {
        **m,
        "anime": {"titulo": titulos[0] if titulos else "Anime", "titulos": titulos,
                  "anilist_ids": sorted(ids)},
        "personagens": pessoas,
    }


def inspecionar(pacote: Path) -> dict:
    """O que o pacote traz, pra tela perguntar a qual anime ligar."""
    try:
        with zipfile.ZipFile(pacote) as z:
            m, erro = _ler_manifesto(z)
            if m is None:
                return {"erro": erro}
            m = _normalizar(m, z)
    except (OSError, zipfile.BadZipFile) as e:
        return {"erro": f"não é um pacote de personagens ({e})"}
    pessoas = m.get("personagens") or []
    nomes = [p.get("nome") or "" for p in pessoas]
    a = m.get("anime") or {}
    return {
        "erro": "",
        "title": a.get("titulo") or "",
        "titles": a.get("titulos") or [],
        "hasIds": bool(a.get("anilist_ids")),
        "characters": len(_agrupar_por_pessoa([n for n in nomes if n])),
        "withPhotos": sum(1 for p in pessoas if p.get("fotos")),
        "photos": sum(len(p.get("fotos") or []) for p in pessoas),
        "centroids": sum(1 for p in pessoas if p.get("centroide")),
        "sampleFile": a.get("exemplo_arquivo"),
    }


def importar(cache_path: Path, pacote: Path, modelo: dict, titulo_escolhido: str = "") -> Resumo:
    """Guarda o pacote como elenco importado. Não mexe no banco: quem liga os
    personagens a um anime é a análise, na hora (`elencos_importados.aplicar`).

    Reimportar o mesmo anime soma ao que já está guardado: personagem igual
    (em qualquer formato de nome) junta, foto repetida não entra de novo.
    """
    resumo = Resumo()
    try:
        z = zipfile.ZipFile(pacote)
    except (OSError, zipfile.BadZipFile) as e:
        resumo.erro = f"não é um pacote de personagens ({e})"
        return resumo
    with z:
        m, erro = _ler_manifesto(z)
        if m is None:
            resumo.erro = erro
            return resumo
        m = _normalizar(m, z)
        a = m.get("anime") or {}
        mesmo_modelo = m.get("modelo") == modelo
        titulo = (titulo_escolhido or a.get("titulo") or "Anime").strip()
        chave = re.sub(r"[^a-z0-9]+", "-", reg.titulo_base(titulo)).strip("-") or "anime"
        destino = cache_path / reg.PASTA / chave

        # O que já estava guardado pra este anime (reimportação soma).
        existente = next((e for e in reg.listar(cache_path) if e.pasta == destino), None)
        pessoas: list[dict] = list(existente.personagens) if existente else []
        chaves = set(existente.chaves_titulo) if existente else set()
        ids = set(existente.anilist_ids) if existente else set()
        chaves |= {reg.titulo_base(t) for t in [titulo, *(a.get("titulos") or [])] if t}
        chaves.discard("")
        ids |= {int(i) for i in a.get("anilist_ids") or [] if i}

        for p in m.get("personagens") or []:
            nome = (p.get("nome") or "").strip()
            if not nome:
                continue
            todos = [nome, *(p.get("aliases") or [])]
            n = next(
                (i for i, q in enumerate(pessoas)
                 if any(name_tokens(x) and name_tokens(x) == name_tokens(y)
                        for x in todos for y in [q["nome"], *(q.get("aliases") or [])])),
                None,
            )
            if n is None:
                pessoas.append({"nome": nome, "aliases": [], "papel": p.get("papel") or "Main",
                                "centroide": None, "modelo": modelo, "fotos": []})
                n = len(pessoas) - 1
            else:
                resumo.juntados += 1
            alvo = pessoas[n]
            # O nome do catálogo ganha do digitado ("Swing, Magna" > "magna swing").
            if p.get("anilist_id") and alvo["nome"] == alvo["nome"].lower() and nome != alvo["nome"]:
                alvo["aliases"].append(alvo["nome"])
                alvo["nome"] = nome
            for x in todos:
                if x != alvo["nome"] and x not in alvo["aliases"]:
                    alvo["aliases"].append(x)
            if mesmo_modelo and p.get("centroide"):
                if alvo.get("centroide"):
                    junto = _juntar_centroides([base64.b64decode(alvo["centroide"]),
                                                base64.b64decode(p["centroide"])])
                    if junto:
                        alvo["centroide"] = base64.b64encode(junto).decode("ascii")
                else:
                    alvo["centroide"] = p["centroide"]
            for rel in p.get("fotos") or []:
                nome_arq = Path(rel).name
                if Path(nome_arq).suffix.lower() not in _IMAGENS or ".." in rel:
                    continue
                rel_local = f"fotos/{n:03d}/{nome_arq}"
                arq = destino / rel_local
                if rel_local in alvo["fotos"] or arq.exists():
                    continue
                arq.parent.mkdir(parents=True, exist_ok=True)
                arq.write_bytes(z.read(rel))
                alvo["fotos"].append(rel_local)
                resumo.fotos += 1

        reg.gravar(destino, titulo, chaves, ids, pessoas)
        resumo.titulo = titulo
        resumo.titulos = sorted(chaves)
        resumo.personagens = len(pessoas)
        resumo.com_fotos = sum(1 for p in pessoas if p["fotos"])
        resumo.sem_fotos = [p["nome"] for p in pessoas if not p["fotos"]]
        resumo.centroides = sum(1 for p in pessoas if p.get("centroide"))
    return resumo
