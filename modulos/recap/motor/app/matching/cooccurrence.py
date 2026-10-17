from __future__ import annotations

from collections import Counter


def pair_key(a: str, b: str) -> str:
    x, y = sorted([a, b])
    return f"{x}+{y}"


def count_pairs(shots: list[list[str]]) -> Counter:
    """Given a list of shots (each shot = list of character names present),
    return a Counter of "A+B" -> occurrence count across shots.
    """
    c: Counter = Counter()
    for names in shots:
        unique = sorted(set(names))
        for i in range(len(unique)):
            for j in range(i + 1, len(unique)):
                c[pair_key(unique[i], unique[j])] += 1
    return c
