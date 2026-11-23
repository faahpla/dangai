"""Cópia diária do banco, guardando a última semana.

O banco (`index.db`) é o único lugar onde moram os favoritos, as marcações
feitas à mão e quem é quem. Na 1.38.0 a "Análise rápida" apagou os
favoritos do Ajk, e não havia de onde trazê-los de volta: as cópias que
existiam eram as das migrações, de meses antes.

Uma cópia por dia, na primeira vez que a Biblioteca abre — antes do trabalho
do dia —, e as 7 mais novas ficam. São ~7 MB cada.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import date
from pathlib import Path

PASTA = "copias-do-banco"
MANTER = 7


def copia_do_dia(db_path: Path | str, manter: int = MANTER) -> Path | None:
    """Faz a cópia de hoje se ainda não existe. Devolve o caminho, ou None."""
    db_path = Path(db_path)
    if not db_path.is_file():
        return None
    pasta = db_path.parent / PASTA
    destino = pasta / f"index-{date.today().isoformat()}.db"
    if destino.exists():
        return None
    pasta.mkdir(parents=True, exist_ok=True)
    temporario = destino.with_suffix(".parcial")
    # A API de backup do SQLite, e não copiar o arquivo: com outra análise
    # escrevendo ao mesmo tempo, a cópia crua poderia sair pela metade.
    origem = sqlite3.connect(db_path)
    try:
        alvo = sqlite3.connect(temporario)
        try:
            origem.backup(alvo)
        finally:
            alvo.close()
    finally:
        origem.close()
    os.replace(temporario, destino)
    for velha in sorted(pasta.glob("index-*.db"))[:-manter]:
        try:
            velha.unlink()
        except OSError:
            pass
    return destino
