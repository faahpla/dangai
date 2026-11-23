"""Lixeira: apagar deixa de ser destruir.

A exclusão de clipes na aba Resultados era definitiva — sumia de `shots/`,
dos hardlinks em `by_character/` e `by_pair/`, e do keyframe. Um clique
errado numa seleção de 40 cenas não tinha volta, e recuperar significava
reanalisar o episódio inteiro.

Aqui os arquivos vão pra `<pasta do episódio>/_lixeira/<data-hora>/` com um
`manifest.json` do lado. Ocupam o mesmo espaço de antes (é movimentação
dentro do mesmo volume, instantânea), aparecem no Explorer e podem ser
arrastados de volta na mão.

**Sobre os hardlinks.** O clipe é um arquivo só com vários nomes: `shots/x`,
`by_character/Rimuru/x`, `by_pair/Rimuru+Shion/x` apontam todos pros mesmos
bytes. Então só o nome canônico (`shots/x`) é MOVIDO pra lixeira; os outros
nomes são desfeitos. Mover todos criaria três cópias do mesmo conteúdo na
lixeira sem preservar nada a mais.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

PASTA = "_lixeira"


@dataclass
class Recolhido:
    """Resultado de uma ida à lixeira."""

    destino: Path
    movidos: int = 0
    links_desfeitos: int = 0
    falhas: list[str] = field(default_factory=list)


def nova_pasta(episode_root: Path | str) -> Path:
    """`<episódio>/_lixeira/2026-08-03_14-22-09`. Uma por exclusão.

    Datada pra as exclusões não se misturarem: saber que um clipe saiu na
    mesma leva de outros é metade do caminho pra desfazer a coisa certa.
    """
    carimbo = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    base = Path(episode_root) / PASTA / carimbo
    n = 1
    destino = base
    while destino.exists():
        n += 1
        destino = base.with_name(f"{carimbo}_{n}")
    destino.mkdir(parents=True, exist_ok=True)
    return destino


def recolher(
    episode_root: Path | str,
    itens: list[dict],
    destino: Path | None = None,
) -> Recolhido:
    """Manda pra lixeira os arquivos destes shots.

    Cada item precisa de `file` (caminho relativo ao episódio) e pode ter
    `keyframe` e `idx`. Os hardlinks em `by_character`/`by_pair` são achados
    pelo nome do arquivo, que é o mesmo em todas as pastas.
    """
    raiz = Path(episode_root)
    destino = destino or nova_pasta(raiz)
    out = Recolhido(destino=destino)
    manifesto: list[dict] = []

    for item in itens:
        rel = str(item.get("file") or "")
        if not rel:
            continue
        nome = Path(rel).name
        registro = {"idx": item.get("idx"), "file": rel, "links": []}

        # 1) os apelidos primeiro: desfazer o link não toca nos bytes, que
        #    seguem vivos no nome canônico até o passo 2.
        for pasta in ("by_character", "by_pair"):
            for link in (raiz / pasta).glob(f"*/{nome}"):
                try:
                    rel_link = str(link.relative_to(raiz))
                    link.unlink()
                    out.links_desfeitos += 1
                    registro["links"].append(rel_link)
                except OSError as e:
                    out.falhas.append(f"{link}: {e}")

        # 2) o arquivo de verdade, e o keyframe junto.
        for chave in ("file", "keyframe"):
            sub = str(item.get(chave) or "")
            if not sub:
                continue
            origem = raiz / sub
            if not origem.exists():
                continue
            alvo = destino / sub
            alvo.parent.mkdir(parents=True, exist_ok=True)
            try:
                shutil.move(str(origem), str(alvo))
                out.movidos += 1
                if chave == "keyframe":
                    registro["keyframe"] = sub
            except OSError as e:
                out.falhas.append(f"{origem}: {e}")

        manifesto.append(registro)

    try:
        (destino / "manifest.json").write_text(
            json.dumps(
                {
                    "episode_root": str(raiz),
                    "quando": datetime.now().isoformat(timespec="seconds"),
                    "itens": manifesto,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    except OSError as e:
        out.falhas.append(f"manifest.json: {e}")

    return out


def tamanho(episode_root: Path | str) -> tuple[int, int]:
    """(quantos arquivos, quantos bytes) parados na lixeira do episódio."""
    raiz = Path(episode_root) / PASTA
    if not raiz.is_dir():
        return 0, 0
    n = total = 0
    for p in raiz.rglob("*"):
        if p.is_file() and p.name != "manifest.json":
            n += 1
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return n, total


def esvaziar(episode_root: Path | str) -> int:
    """Apaga a lixeira DE VEZ. Só por pedido explícito do usuário."""
    raiz = Path(episode_root) / PASTA
    if not raiz.is_dir():
        return 0
    n, _ = tamanho(raiz.parent)
    shutil.rmtree(raiz, ignore_errors=True)
    return n
