"""Resgatar favoritos apagados por reanálise.

Até o motor 0.24.0, refazer a análise (ou o corte) de um episódio apagava
as cenas e criava outras com ids novos — e os favoritos, presos ao id, iam
junto. Na 1.38.0 a "Análise rápida" fez isso em massa e o Ajk perdeu todos
os dele. O motor 0.24.1 não perde mais (ver `favorito_guardado` no db.py);
isto traz de volta o que já tinha sumido.

**De onde vêm.** Apagar uma linha no SQLite só marca o espaço como livre: os
bytes ficam no arquivo até alguém gravar por cima. Um favorito é pequeno e
reconhecível — id da cena, personagem e a data "AAAA-MM-DD HH:MM:SS" — e dá
pra achá-lo lendo o arquivo cru.

**Pra que cena volta.** O id achado é o da cena ANTIGA. As cenas de um
episódio foram gravadas em sequência, então as de um episódio refeito
deixaram um "buraco" contínuo na numeração; episódios vizinhos refeitos
juntos deixam um buraco só, do tamanho da soma. O buraco é repartido entre
os episódios refeitos (na ordem em que foram analisados da primeira vez) cujo
número de cenas soma exatamente o tamanho dele, e a posição do id dentro da
parte de cada um é o número da cena. O favorito volta pra cena atual com o
mesmo episódio e número. O que não fecha com certeza fica de fora.

Medido numa cópia do banco do FAAH com o estrago simulado (60 favoritos em
4 episódios vizinhos refeitos): 60 de 60 de volta, todos na cena certa.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .db import Database

_DATA = re.compile(rb"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d")
# Tipo do inteiro no registro do SQLite -> quantos bytes ele ocupa. 8 e 9 são
# os valores 0 e 1 sem byte nenhum.
_TAM = {1: 1, 2: 2, 3: 3, 4: 4, 8: 0, 9: 0}


@dataclass
class Resgate:
    achados: int = 0
    devolviveis: list[tuple[int, int, str]] = field(default_factory=list)  # (cena nova, personagem, data)
    sem_cena: int = 0
    episodios: int = 0
    aplicado: bool = False

    def payload(self) -> dict:
        return {
            "achados": self.achados,
            "devolver": len(self.devolviveis),
            "semCena": self.sem_cena,
            "episodios": self.episodios,
            "aplicado": self.aplicado,
        }


def _registros(dados: bytes) -> dict[tuple[int, int], str]:
    """(id da cena, personagem) -> data, de todo favorito escrito no arquivo."""
    achados: dict[tuple[int, int], str] = {}
    for m in _DATA.finditer(dados):
        t = m.start()
        for tc, kc in _TAM.items():
            for ks in (1, 2, 3, 4):
                h = t - kc - ks  # onde começam os valores do registro
                # Cabeçalho: [.. tipo do id][tipo do personagem][0x33 = texto de 19]
                if h < 3 or dados[h - 1] != 0x33 or dados[h - 2] != tc:
                    continue
                ts = dados[h - 3]
                # O tipo do id pode ter sido sobrescrito pelo cabeçalho do
                # bloco livre; quando não foi, tem que bater com o tamanho.
                if ts in (1, 2, 3, 4) and ts != ks:
                    continue
                sid = int.from_bytes(dados[h:h + ks], "big")
                if kc:
                    cid = int.from_bytes(dados[h + ks:h + ks + kc], "big")
                else:
                    cid = 1 if tc == 9 else 0
                if sid > 0:
                    achados.setdefault((sid, cid), m.group().decode())
    return achados


def procurar(db: Database, aplicar: bool = False) -> Resgate:
    r = Resgate()
    dados = Path(db.path).read_bytes()
    with db.connect() as c:
        vivas = {row[0] for row in c.execute("SELECT id FROM shot")}
        if not vivas:
            return r
        vivos = {(row[0], row[1]) for row in c.execute("SELECT shot_id, character_id FROM favorite")}
        perdidos = {
            k: v for k, v in _registros(dados).items() if k[0] not in vivas and k not in vivos
        }
        r.achados = len(perdidos)
        if not perdidos:
            return r

        seq = c.execute("SELECT seq FROM sqlite_sequence WHERE name='shot'").fetchone()
        maior = max(seq[0] if seq else 0, max(vivas))
        buracos: list[tuple[int, int]] = []
        inicio = None
        for i in range(1, maior + 1):
            if i not in vivas:
                if inicio is None:
                    inicio = i
            elif inicio is not None:
                buracos.append((inicio, i - 1))
                inicio = None
        if inicio is not None:
            buracos.append((inicio, maior))

        por_ep = {
            row[0]: (row[1], row[2])
            for row in c.execute("SELECT episode_id, count(*), min(id) FROM shot GROUP BY episode_id")
        }
        # Só interessa buraco com favorito dentro: repartir os outros é
        # trabalho à toa e poderia "gastar" um episódio que é de outro buraco.
        alvos = sorted({sid for sid, _ in perdidos})
        dono: dict[tuple[int, int], int] = {}
        usados: set[int] = set()
        for a, b in buracos:
            if not any(a <= s <= b for s in alvos):
                continue
            tam = b - a + 1
            fila = sorted(e for e, (_, menor) in por_ep.items() if menor > b and e not in usados)
            for i in range(len(fila)):
                soma, j = 0, i
                while j < len(fila) and soma < tam:
                    soma += por_ep[fila[j]][0]
                    j += 1
                if soma == tam:
                    pos = a
                    for e in fila[i:j]:
                        n = por_ep[e][0]
                        dono[(pos, pos + n - 1)] = e
                        usados.add(e)
                        pos += n
                    break

        eps: set[int] = set()
        for (sid, cid), quando in sorted(perdidos.items()):
            parte = next(((a, b) for a, b in dono if a <= sid <= b), None)
            if parte is None:
                r.sem_cena += 1
                continue
            e = dono[parte]
            nova = c.execute(
                "SELECT id FROM shot WHERE episode_id=? AND idx=?", (e, sid - parte[0])
            ).fetchone()
            if nova is None:
                r.sem_cena += 1
                continue
            r.devolviveis.append((nova[0], cid, quando))
            eps.add(e)
        r.episodios = len(eps)

        if aplicar and r.devolviveis:
            for nova, cid, quando in r.devolviveis:
                c.execute(
                    "INSERT OR IGNORE INTO favorite(shot_id, character_id, created_at) VALUES(?,?,?)",
                    (nova, cid, quando),
                )
            r.aplicado = True
    return r
