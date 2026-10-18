"""[recap] O "BUSCAR ELENCO" do Reconhecer na mao e do passo 1 (A1, 18/10).

Arquivo NOVO do modulo recap do Dangai. Dois modos curtos do headless:

    python -m app.headless buscar-anime "<termo>"
        -> {"type": "anime-busca", "candidatos": [...], "erros": {...}}
    python -m app.headless escolher-anime '<pedido JSON>'
        -> {"type": "anime-escolhido", "titulo", "cacheId", "elenco", "sugestoes", ...}

buscar-anime: as tres fontes de busca_anime.py (AniList, o site do MAL, Kitsu)
para o que a pessoa digitou, com as capas baixadas (a tela do app so mostra
imagem local: o CSP so libera o servidor de midia).

escolher-anime: a pessoa escolheu um anime da lista. A escolha fica guardada
para este nome (busca_anime.escolhas.json, ganha de qualquer busca), o elenco
e montado como numa analise (provider.resolve, que tambem junta os nomes
batizados num banco local), 1+ foto por personagem e baixada e, com a pasta do
episodio, os grupos de rostos da descoberta (metadata/discovery/grupos.npz)
ganham as SUGESTOES de nome: os 9 personagens mais parecidos com cada grupo.

So le e grava no banco do motor (anime_db) e na pasta do episodio do recap.
"""
from __future__ import annotations

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

#: Quantas sugestoes por grupo vao para a tela (as teclas 1-9).
SUGESTOES_POR_GRUPO = 9
#: Fotos por personagem para o centroide da sugestao (as primeiras: catalogo, depois batismo).
FOTOS_POR_PERSONAGEM = 4
#: O arquivo dos centroides dos grupos (gravado pelo headless na descoberta).
ARQUIVO_DOS_GRUPOS = "grupos.npz"


def pasta_da_descoberta(episode_root: str | Path) -> Path:
    return Path(episode_root) / "metadata" / "discovery"


def gravar_grupos(episode_root: str | Path, chaves: list[int], centroides: list[bytes]) -> None:
    """Os centroides dos grupos (os mesmos bytes do DiscoveredGroup), para as
    sugestoes depois que o anime for escolhido. Nunca levanta."""
    import numpy as np

    from .descoberta_salva import de_bytes

    try:
        if not chaves:
            return
        m = np.stack([de_bytes(b) for b in centroides]).astype(np.float32)
        destino = pasta_da_descoberta(episode_root)
        destino.mkdir(parents=True, exist_ok=True)
        tmp = destino / "grupos.tmp.npz"
        np.savez(tmp, chaves=np.asarray(chaves, dtype=np.int64), centroides=m)
        tmp.replace(destino / ARQUIVO_DOS_GRUPOS)
    except Exception as e:  # noqa: BLE001 -- sem isto so faltam as sugestoes
        print(f"[recap] grupos.npz nao gravado: {e}", flush=True)


def ler_grupos(episode_root: str | Path):
    """(chaves, centroides) ou None."""
    import numpy as np

    arq = pasta_da_descoberta(episode_root) / ARQUIVO_DOS_GRUPOS
    if not arq.exists():
        return None
    try:
        d = np.load(arq)
        return [int(k) for k in d["chaves"]], d["centroides"].astype(np.float32)
    except Exception:  # noqa: BLE001
        return None


# --------------------------------------------------------------- buscar
def _baixar_capas(cands: list, pasta: Path) -> dict[str, str]:
    """chave do candidato -> caminho local da capa (as que baixaram)."""
    import httpx

    pasta.mkdir(parents=True, exist_ok=True)
    pedidos: list[tuple[str, str, Path]] = []
    for c in cands:
        if not c.capa:
            continue
        nome = hashlib.sha1(c.capa.encode("utf-8")).hexdigest()[:20] + ".jpg"
        pedidos.append((c.chave(), c.capa, pasta / nome))
    saida: dict[str, str] = {}

    def baixar(item: tuple[str, str, Path]) -> tuple[str, str | None]:
        chave, url, destino = item
        if destino.exists() and destino.stat().st_size > 0:
            return chave, str(destino)
        try:
            r = httpx.get(url, timeout=httpx.Timeout(8.0, connect=4.0), follow_redirects=True,
                          headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code != 200 or len(r.content) < 200:
                return chave, None
            tmp = destino.with_suffix(".tmp")
            tmp.write_bytes(r.content)
            tmp.replace(destino)
            return chave, str(destino)
        except Exception:  # noqa: BLE001 -- capa e enfeite
            return chave, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        for chave, caminho in pool.map(baixar, pedidos):
            if caminho:
                saida[chave] = caminho
    return saida


def buscar(termo: str, emit: Callable[[dict[str, Any]], None]) -> int:
    from .config import Config
    from .providers.anime_provider import AnimeProvider

    cfg = Config.load()
    cfg.ensure_dirs()
    provider = AnimeProvider(cfg.cache_path)
    try:
        lista = provider.busca.buscar(termo)
        # Fora a cauda que nao tem nada a ver (a busca do MAL devolve parecidos
        # de letra): fica o que passa de 0,4, e sempre pelo menos os 5 primeiros.
        lista = [c for i, c in enumerate(lista) if c.nota >= 0.4 or i < 5]
        capas = _baixar_capas(lista, provider.cache_root / "_busca" / "capas")
        emit({
            "type": "anime-busca",
            "termo": termo,
            "candidatos": [{**c.para_json(), "capaLocal": capas.get(c.chave())} for c in lista],
            "erros": provider.busca.erros,
        })
    finally:
        provider.close()
    return 0


# -------------------------------------------------------------- escolher
def _primeira_foto(fotos: list[Path]) -> Path | None:
    """A do catalogo antes da do batismo (a do batismo e um recorte pequeno)."""
    ordem = sorted(fotos, key=lambda p: (p.name.startswith(("batismo_", "auto_disc_")), p.name))
    return ordem[0] if ordem else None


def _sugestoes(cfg, chaves: list[int], centroides, refs: dict[str, list[Path]],
               extras: list[tuple[str, Any]], status: Callable[[str], None]) -> dict[str, list[dict]]:
    """Os 9 nomes mais parecidos com cada grupo: o centroide do grupo contra o
    das fotos de cada personagem (o mesmo recorte de rosto e o mesmo CLIP da
    analise) e os centroides ja batizados (`extras`)."""
    import cv2
    import numpy as np

    from .matching.character_matcher import build_centroid
    from .matching.embedding_engine import EmbeddingEngine
    from .matching.face_detector import AnimeFaceDetector, ensure_cascade, smart_portrait_crop

    status("Carregando os modelos para sugerir os nomes...")
    engine = EmbeddingEngine(model_name=cfg.clip_model, pretrained=cfg.clip_pretrained, use_cuda=cfg.use_cuda)
    det = AnimeFaceDetector(ensure_cascade(cfg.models_path))
    nomes: list[str] = []
    cents: list[np.ndarray] = []
    for nome, fotos in refs.items():
        imgs = []
        for p in fotos[:FOTOS_POR_PERSONAGEM]:
            img = cv2.imread(str(p))
            if img is None:
                continue
            crops = det.crop_faces(img, pad=cfg.face_crop_padding)
            imgs.extend(crops if crops else [smart_portrait_crop(img)])
        if not imgs:
            continue
        c = build_centroid(engine.embed_images(imgs))
        if c is not None:
            nomes.append(nome)
            cents.append(np.asarray(c, dtype=np.float32))
    for nome, c in extras:
        nomes.append(nome)
        cents.append(np.asarray(c, dtype=np.float32))
    if not cents:
        return {}
    banco = np.stack(cents)
    sims = centroides @ banco.T  # (grupos, nomes)
    saida: dict[str, list[dict]] = {}
    for i, k in enumerate(chaves):
        melhor: dict[str, float] = {}
        for j, nome in enumerate(nomes):
            s = float(sims[i, j])
            if s > melhor.get(nome, -1.0):
                melhor[nome] = s
        ordem = sorted(melhor.items(), key=lambda x: -x[1])[:SUGESTOES_POR_GRUPO]
        saida[str(k)] = [{"nome": n, "sim": round(s, 4)} for n, s in ordem]
    return saida


def _gravar_na_descoberta(episode_root: Path, sugestoes: dict[str, list[dict]], roster: list[str]) -> None:
    """[recap] O1/A1: a descoberta gravada (descoberta_salva.py) guarda as
    sugestoes e o elenco do anime escolhido: reabrindo o Reconhecer na mao (o
    app fechou), as teclas 1-9 continuam as deste anime. O resto (o corte, os
    grupos, online/cacheId do commit) fica como estava."""
    from . import descoberta_salva

    dados = descoberta_salva.ler(episode_root)
    if dados is None:
        return
    for g in dados.get("groups") or []:
        lista = sugestoes.get(str(g.get("key")))
        if lista is not None:
            g["suggestions"] = [{"name": s["nome"], "sim": float(s["sim"])} for s in lista]
    if roster:
        dados["roster"] = roster
    arquivo = descoberta_salva.pasta(episode_root) / descoberta_salva.ARQUIVO
    tmp = arquivo.with_name(arquivo.name + ".tmp")
    try:
        tmp.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
        tmp.replace(arquivo)
    except OSError as e:
        print(f"[recap] descoberta gravada sem as sugestoes novas: {e}", flush=True)


def escolher(req: dict[str, Any], emit: Callable[[dict[str, Any]], None]) -> int:
    from .config import Config
    from .providers.anime_provider import AnimeProvider
    from .providers.busca_anime import Candidato
    from .references.reference_store import ReferenceStore
    from .storage.db import Database

    anime = str(req.get("anime") or "").strip()
    temporada = int(req.get("season") or 1)
    escolha = Candidato.de_json(req.get("escolha") or {})
    if not anime or not (escolha.anilist_id or escolha.mal_id or escolha.kitsu_id):
        emit({"type": "failed", "message": "pedido sem anime ou sem a escolha"})
        return 2
    episode_root = req.get("episodeRoot") or None

    def status(msg: str) -> None:
        emit({"type": "stage", "stage": "fetch_characters", "fraction": -1.0, "message": msg})

    cfg = Config.load()
    cfg.ensure_dirs()
    provider = AnimeProvider(cfg.cache_path)
    try:
        provider.busca.gravar_escolha(anime, temporada, escolha)
        provider.esquecer_atalho(anime, temporada)
        bundle = provider.resolve(
            anime,
            max_characters=cfg.max_characters_per_anime,
            images_per_character=cfg.references_per_character,
            on_status=status,
            use_danbooru=False,
            gallery_for_top=cfg.gallery_for_top_characters,
            season=temporada,
        )
        juntados = dict(provider.ultimo_juntado)
    finally:
        provider.close()

    from .pipeline_types import cache_id_do_bundle

    cache_id = cache_id_do_bundle(bundle)
    store = ReferenceStore(cfg.cache_path)
    status("Baixando as fotos do elenco...")
    refs = store.ensure_references(cache_id, bundle, on_status=status)
    # Os batizados que nao sao do elenco oficial (pasta com o nome dele).
    oficiais = {c.name for c in bundle.characters}
    chars_dir = store.anime_dir(cache_id) / "characters"
    if chars_dir.is_dir():
        for d in sorted(chars_dir.iterdir()):
            if d.is_dir() and not d.name.startswith("_") and d.name not in oficiais and d.name not in refs:
                fotos = [p for p in d.iterdir() if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
                if fotos:
                    refs[d.name] = fotos

    elenco = []
    for nome, fotos in refs.items():
        foto = _primeira_foto(list(fotos))
        elenco.append({"nome": nome, "foto": str(foto) if foto else None})

    sugestoes: dict[str, list[dict]] = {}
    grupos = ler_grupos(episode_root) if episode_root else None
    if grupos is not None and refs:
        chaves, centroides = grupos
        # Os centroides do banco local (os nomes que ele batizou antes), na
        # grafia do elenco oficial: eles conhecem os rostos DESTE anime.
        extras: list[tuple[str, Any]] = []
        try:
            from .descoberta_salva import de_bytes as from_bytes

            db = Database(cfg.cache_path / "index.db")
            local_id = db.anime_local_por_titulo(anime)
            if local_id is not None:
                for row in db.get_characters_for_anime(local_id):
                    if row.get("embedding"):
                        extras.append((juntados.get(row["name"], row["name"]), from_bytes(row["embedding"])))
        except Exception as e:  # noqa: BLE001
            print(f"[recap] centroides locais: {e}", flush=True)
        try:
            sugestoes = _sugestoes(cfg, chaves, centroides, refs, extras, status)
        except Exception as e:  # noqa: BLE001 -- sem sugestao a tela ainda tem o elenco
            print(f"[recap] sugestoes falharam: {e}", flush=True)
        if sugestoes:
            _gravar_na_descoberta(episode_root, sugestoes, [e["nome"] for e in elenco])

    emit({
        "type": "anime-escolhido",
        "titulo": bundle.title,
        "tituloIngles": bundle.title_english,
        "cacheId": cache_id,
        "online": True,
        "elenco": elenco,
        "sugestoes": sugestoes,
        "juntados": juntados,
    })
    return 0


def json_do_argumento(texto: str) -> dict[str, Any]:
    dados = json.loads(texto)
    if not isinstance(dados, dict):
        raise ValueError("pedido deve ser um objeto JSON")
    return dados
