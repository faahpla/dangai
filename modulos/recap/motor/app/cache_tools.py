"""Faxina do cache — as operações por trás dos botões de limpeza das
Configurações. Sem Qt aqui: tudo testável e chamável de qualquer lugar.

O problema que isso resolve: as galerias online trazem lixo (fanart com
outro personagem, retrato de outra temporada) que envenena os protótipos —
e até hoje limpar exigia caçar as pastas na mão. As refs têm três origens
distinguíveis pelo NOME do arquivo:

  • catálogo (baixadas): nome = hash hex de 16 dígitos ("0805708d….jpg")
  • batismo (Descoberta):  "auto_disc_NN.jpg"
  • manuais (o usuário):   qualquer outro nome

Limpar "o que veio da internet" = apagar só os hashes — o trabalho manual
e os batismos ficam."""
from __future__ import annotations

import re
import shutil
from pathlib import Path

# hash de 16 hex + extensão de imagem = download de catálogo
_CATALOG_RE = re.compile(r"[0-9a-f]{16}\.(jpg|jpeg|png|webp)$", re.IGNORECASE)

_IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def refs_root(cache_path: Path) -> Path:
    """Raiz das referências: um subdiretório por anime, cada um com
    characters/<Nome>/*.jpg."""
    return Path(cache_path) / "anime_db"


def clean_catalog_refs(cache_path: Path) -> tuple[int, int]:
    """Apaga SÓ as imagens baixadas do catálogo (nome-hash) em todos os
    animes, junto com as pastas _filtered e os caches de embedding de refs
    (que ficariam órfãos). Batismos (auto_disc_*) e arquivos manuais ficam.

    Retorna (arquivos_apagados, animes_afetados)."""
    root = refs_root(cache_path)
    if not root.exists():
        return 0, 0
    removed = 0
    animes = 0
    for anime_dir in root.iterdir():
        if not anime_dir.is_dir():
            continue
        touched = False
        chars_dir = anime_dir / "characters"
        if chars_dir.exists():
            for char_dir in chars_dir.iterdir():
                if not char_dir.is_dir():
                    continue
                filtered = char_dir / "_filtered"
                if filtered.exists():
                    shutil.rmtree(filtered, ignore_errors=True)
                    touched = True
                for f in char_dir.iterdir():
                    if f.is_file() and _CATALOG_RE.fullmatch(f.name):
                        try:
                            f.unlink()
                            removed += 1
                            touched = True
                        except OSError:
                            pass
        # cache de embeddings das refs: metade dos arquivos sumiu — recomeça
        npz = anime_dir / "ref_features.npz"
        if touched and npz.exists():
            try:
                npz.unlink()
            except OSError:
                pass
        if touched:
            animes += 1
    return removed, animes


def wipe_cache(cache_path: Path) -> None:
    """Apagão: TODO o conteúdo do cache — refs (inclusive batismos e
    manuais!), banco de resultados/curadoria (index.db) e caches de elenco.
    Modelos e a pasta Output não são tocados. As pastas base são recriadas."""
    root = Path(cache_path)
    if not root.exists():
        return
    for child in root.iterdir():
        try:
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink()
        except OSError:
            pass


def _image_count(d: Path) -> int:
    try:
        return sum(
            1 for f in d.iterdir()
            if f.is_file() and f.suffix.lower() in _IMG_EXTS
        )
    except OSError:
        return 0


def _free_name(dst_dir: Path, name: str) -> str:
    """Nome livre em dst_dir: colisão ganha sufixo _2, _3..."""
    if not (dst_dir / name).exists():
        return name
    stem = Path(name).stem
    ext = Path(name).suffix
    n = 2
    while (dst_dir / f"{stem}_{n}{ext}").exists():
        n += 1
    return f"{stem}_{n}{ext}"


def _merge_char_folder(src: Path, dst: Path) -> int:
    """Move o conteúdo de src pra dst e apaga src. Arquivo de catálogo com
    o MESMO nome-hash é a mesma imagem (hash da URL) — descartado; o resto
    colide pra um nome livre. Retorna quantos arquivos foram movidos."""
    moved = 0
    dst.mkdir(parents=True, exist_ok=True)
    for f in list(src.iterdir()):
        if f.is_dir():
            if f.name == "_filtered":
                shutil.rmtree(f, ignore_errors=True)
            else:
                shutil.move(str(f), str(dst / _free_name(dst, f.name)))
                moved += 1
            continue
        if (dst / f.name).exists() and _CATALOG_RE.fullmatch(f.name):
            f.unlink()  # mesma URL, mesma imagem
            continue
        shutil.move(str(f), str(dst / _free_name(dst, f.name)))
        moved += 1
    shutil.rmtree(src, ignore_errors=True)
    return moved


def _group_same_person(names: list[str]) -> list[list[str]]:
    """Agrupa nomes de pasta que são a MESMA pessoa (união via
    find_token_match — igualdade de tokens ou subset inambíguo)."""
    from .naming import find_token_match
    parent: dict[str, str] = {n: n for n in names}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for n in names:
        m = find_token_match(n, [o for o in names if o != n])
        if m is not None:
            parent[find(n)] = find(m)
    groups: dict[str, list[str]] = {}
    for n in names:
        groups.setdefault(find(n), []).append(n)
    return [sorted(g) for g in groups.values() if len(g) > 1]


def _pick_char_canonical(chars_dir: Path, group: list[str]) -> str:
    """Canônico do grupo: nome mais completo (mais tokens); empate decide
    por quem tem mais fotos."""
    from .naming import name_tokens
    return max(
        group,
        key=lambda n: (len(name_tokens(n)), _image_count(chars_dir / n), n),
    )


_ANIME_SUFFIX = re.compile(r"^(.*?)\s*\[(?:al|mal)\d+\]$")


def _anime_key(dirname: str) -> str:
    """Título normalizado da pasta de anime (sem o sufixo [alN]/[malN] e sem
    pontuação) — a chave de agrupamento de duplicatas."""
    m = _ANIME_SUFFIX.match(dirname)
    if m:
        title = m.group(1)
    elif dirname.startswith("local-"):
        title = dirname[6:].replace("-", " ")
    elif re.fullmatch(r"(?:al|mal)\d+", dirname):
        return ""  # pasta legada só com id — sem título, não agrupa
    else:
        title = dirname
    return re.sub(r"[^a-z0-9]+", "", title.lower())


def _pick_anime_canonical(dirs: list[Path]) -> Path:
    """[al...] > [mal...] > resto (o al é o id de franquia que as análises
    normais resolvem)."""
    def rank(d: Path) -> tuple:
        n = d.name
        return (
            0 if re.search(r"\[al\d+\]$", n) else 1 if re.search(r"\[mal\d+\]$", n) else 2,
            -_image_count_deep(d),
        )
    return min(dirs, key=rank)


def _image_count_deep(anime_dir: Path) -> int:
    chars = anime_dir / "characters"
    if not chars.exists():
        return 0
    return sum(_image_count(c) for c in chars.iterdir() if c.is_dir())


def merge_duplicates(cache_path: Path, apply: bool = False) -> dict:
    """Encontra (e com apply=True FUNDE) duplicatas no banco de refs.

    Personagens: pastas que são a mesma pessoa por tokens fundem na de nome
    mais completo. Animes: pastas cujo título normalizado é igual — ou
    prefixo uma da outra (títulos de temporada vs franquia), com mínimo de
    8 caracteres pra não juntar coincidência — fundem na [al...]; os
    personagens de dentro fundem com a mesma regra de tokens.

    Retorna {"anime": [(fontes, canônico)], "chars": [(anime, fontes,
    canônico)], "moved": N}."""
    root = refs_root(cache_path)
    report: dict = {"anime": [], "chars": [], "moved": 0}
    if not root.exists():
        return report

    # --- pastas de anime duplicadas
    dirs = [d for d in root.iterdir() if d.is_dir()]
    keys = {d: _anime_key(d.name) for d in dirs}
    used: set[Path] = set()
    anime_groups: list[list[Path]] = []
    for d in dirs:
        if d in used or not keys[d]:
            continue
        group = [d]
        for o in dirs:
            if o is d or o in used or not keys[o]:
                continue
            ka, kb = keys[d], keys[o]
            same = ka == kb or (
                min(len(ka), len(kb)) >= 8
                and (ka.startswith(kb) or kb.startswith(ka))
            )
            if same:
                group.append(o)
        if len(group) > 1:
            used.update(group)
            anime_groups.append(group)
    for group in anime_groups:
        canonical = _pick_anime_canonical(group)
        srcs = [d for d in group if d != canonical]
        report["anime"].append(([d.name for d in srcs], canonical.name))
        if apply:
            from .naming import find_token_match
            dst_chars = canonical / "characters"
            for s in srcs:
                s_chars = s / "characters"
                if s_chars.exists():
                    dst_chars.mkdir(parents=True, exist_ok=True)
                    existing = [
                        c.name for c in dst_chars.iterdir() if c.is_dir()
                    ]
                    for c in list(s_chars.iterdir()):
                        if not c.is_dir():
                            continue
                        target = find_token_match(c.name, existing) or c.name
                        report["moved"] += _merge_char_folder(
                            c, dst_chars / target
                        )
                shutil.rmtree(s, ignore_errors=True)
            npz = canonical / "ref_features.npz"
            if npz.exists():
                npz.unlink()

    # --- personagens duplicados dentro de cada anime
    dirs = [d for d in root.iterdir() if d.is_dir()] if apply else dirs
    for d in dirs:
        chars = d / "characters"
        if not chars.exists():
            continue
        names = [
            c.name for c in chars.iterdir()
            if c.is_dir() and not c.name.startswith("_")
        ]
        for group in _group_same_person(names):
            canonical = _pick_char_canonical(chars, group)
            srcs = [n for n in group if n != canonical]
            if not srcs:
                continue
            report["chars"].append((d.name, srcs, canonical))
            if apply:
                for s in srcs:
                    report["moved"] += _merge_char_folder(
                        chars / s, chars / canonical
                    )
                npz = d / "ref_features.npz"
                if npz.exists():
                    npz.unlink()
    return report


def refs_summary(cache_path: Path) -> tuple[int, int, int]:
    """(catálogo, batismo, manuais) — contagem de imagens por origem, pra
    mostrar no diálogo antes de limpar."""
    root = refs_root(cache_path)
    catalog = disc = manual = 0
    if not root.exists():
        return 0, 0, 0
    for f in root.glob("*/characters/*/*"):
        if not f.is_file() or f.suffix.lower() not in _IMG_EXTS:
            continue
        if f.parent.name == "_filtered":
            continue
        if _CATALOG_RE.fullmatch(f.name):
            catalog += 1
        elif f.name.startswith("auto_disc_"):
            disc += 1
        else:
            manual += 1
    return catalog, disc, manual
