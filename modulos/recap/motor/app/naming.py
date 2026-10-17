"""Casamento de nomes de personagem entre formatos de fonte.

O mesmo personagem chega com três caras: "Tempest, Rimuru" (MAL/Jikan,
sobrenome primeiro), "Rimuru Tempest" (AniList) e "Rimuru" (Kitsu ou o
usuário no batismo). Tratar o nome como CONJUNTO de palavras resolve os
dois primeiros; o terceiro só é seguro quando é inambíguo — "Rimuru" cabe
num personagem só, mas "Greyrat" cabe na família inteira.

Este módulo é a fonte única dessa regra: pasta de refs, upsert no banco e
o fundidor de duplicatas usam TODOS o mesmo casamento — é o que garante
que a duplicação não volta."""
from __future__ import annotations

import re


def name_tokens(name: str) -> frozenset[str]:
    """Nome como conjunto de palavras minúsculas sem pontuação —
    "Tempest, Rimuru" e "Rimuru Tempest" viram o mesmo conjunto."""
    return frozenset(re.sub(r"[^a-z0-9 ]+", " ", name.lower()).split())


def same_person(a: str, b: str) -> bool:
    """Mesmos tokens = mesmo personagem escrito em outra ordem/formato."""
    ta, tb = name_tokens(a), name_tokens(b)
    return bool(ta) and ta == tb


def find_token_match(name: str, candidates: list[str]) -> str | None:
    """O candidato que é a MESMA pessoa que `name`, ou None.

    1º: igualdade de tokens (sempre segura).
    2º: subconjunto próprio ("Rimuru" ⊂ "Rimuru Tempest") — aceito só
        quando exatamente UM candidato casa assim; dois ou mais casando
        (irmãos Greyrat...) é ambíguo e ninguém é fundido por engano.
    """
    tn = name_tokens(name)
    if not tn:
        return None
    subset_hits: list[str] = []
    for cand in candidates:
        tc = name_tokens(cand)
        if not tc:
            continue
        if tc == tn:
            return cand
        if tc < tn or tn < tc:
            subset_hits.append(cand)
    if len(subset_hits) == 1:
        return subset_hits[0]
    return None
