"""[recap] Os pesos do HuggingFace: o cache local primeiro, a rede so se faltar.

Com o peso ja baixado (a 1a analise baixa tudo), o `hf_hub_download` ainda
pergunta ao Hub, toda vez que o motor sobe, se ha uma versao nova do arquivo.
Com internet isso custa uma ida e volta por modelo; sem internet (ou com a rede
que nao responde) cada modelo espera o tempo limite antes de cair no cache.
Aqui o cache vem primeiro e a rede so e usada para o que ainda nao foi baixado.

- `baixar`: um arquivo do Hub (o que o motor pede direto);
- `so_cache`: um bloco em que o huggingface_hub nao vai a rede, para quem
  baixa por conta propria (o open_clip). Quem chama tenta de novo fora do bloco
  se o peso ainda nao estiver no cache.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator


def baixar(repo_id: str, filename: str, revision: str | None = None) -> str:
    """O caminho local do arquivo: do cache sem rede; se faltar, baixa."""
    from huggingface_hub import hf_hub_download

    try:
        return hf_hub_download(repo_id=repo_id, filename=filename, revision=revision, local_files_only=True)
    except Exception:
        return hf_hub_download(repo_id=repo_id, filename=filename, revision=revision)


@contextmanager
def so_cache() -> Iterator[None]:
    """Dentro do bloco, o huggingface_hub fica em modo offline (so o cache).

    O `_http` do huggingface_hub le `constants.HF_HUB_OFFLINE` a cada pedido,
    entao mudar a constante vale na hora; o valor de antes volta no fim.
    """
    from huggingface_hub import constants

    antes = constants.HF_HUB_OFFLINE
    constants.HF_HUB_OFFLINE = True
    try:
        yield
    finally:
        constants.HF_HUB_OFFLINE = antes
