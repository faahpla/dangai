"""B-roll: trailer, gameplay, teaser — vídeo avulso que vira material de edição.

Não tem temporada nem episódio que signifique alguma coisa. Mora na pasta do
título a que pertence ("Cyberpunk 2077"), ao lado das temporadas, numa pasta
própria por vídeo: `B-roll 03 - Official Launch Trailer`.

**Identidade.** O banco continua com a chave (anime, temporada, número, tipo):
o B-roll entra como temporada 1, tipo `BROLL` e um número sequencial por
pasta de anime. O número é o que impede dois trailers de ocuparem a mesma
vaga; o título é só o nome que a pessoa lê. E `origem` (o link) faz baixar o
MESMO vídeo de novo cair na mesma vaga, em vez de criar um B-roll repetido.

**Converter o que já existe.** Antes disto, o jeito era cortar o trailer como
se fosse episódio — os trailers do Cyberpunk 2077 viraram S01E01…S01E05, e
não dava pra saber qual era qual. `planejar_conversao`/`converter` fazem com
eles o mesmo que `reclassificar.py` faz com aberturas: renomeiam a pasta no
disco (instantâneo, preserva os hardlinks) e reapontam o banco. O título sai
do nome do arquivo de origem, que o yt-dlp grava como "Título [id].mp4".
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from ..video_ingest import pasta_do_broll
from .db import Database
from .metadata_writer import marcar_broll_no_json

# "Nome do vídeo [dQw4w9WgXcQ]" — o id de 11 caracteres que o yt-dlp põe no
# nome do arquivo quando baixa do YouTube.
_ID_YOUTUBE = re.compile(r"\[([A-Za-z0-9_-]{11})\]")
_PASTA_BROLL = re.compile(r"^B-roll (\d{1,4})\b", re.IGNORECASE)


def link_do_youtube(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def titulo_do_arquivo(arquivo: str, anime: str = "") -> tuple[str, str]:
    """(título, link) a partir do nome do arquivo de origem.

    "Cyberpunk_2077_-_Phantom_Liberty_Official_Trailer [reABCMNGM3w].h264nv.mp4"
    com anime "Cyberpunk 2077" → ("Phantom Liberty Official Trailer",
    "https://www.youtube.com/watch?v=reABCMNGM3w"). O nome do anime sai do
    começo: dentro da pasta dele, repeti-lo em todo B-roll só empurra o que
    importa pra fora da tela.
    """
    nome = Path(arquivo).name
    origem = ""
    m = _ID_YOUTUBE.search(nome)
    if m:
        origem = link_do_youtube(m.group(1))
        nome = nome[: m.start()]
    else:
        nome = Path(nome).stem
    titulo = re.sub(r"[_]+", " ", nome)
    titulo = re.sub(r"\s+", " ", titulo).strip(" -_.")
    if anime:
        a = re.sub(r"[_]+", " ", anime).strip()
        if titulo.lower().startswith(a.lower()):
            resto = titulo[len(a):].strip(" -_.:–—")
            if resto:
                titulo = resto
    return titulo, origem


def numero_para(db: Database, pasta_anime: Path, origem: str = "") -> int:
    """O número do B-roll que vai entrar nesta pasta de anime.

    O mesmo link já baixado antes devolve a vaga dele (recortar substitui).
    Senão, o próximo depois do maior que existe — no banco OU no disco: uma
    pasta "B-roll 04" deixada por fora também ocupa o 4.
    """
    existentes = db.brolls_na_pasta(str(pasta_anime))
    if origem:
        for r in existentes:
            if (r.get("origem") or "") == origem:
                return int(r["episode"])
    maior = max((int(r["episode"]) for r in existentes), default=0)
    try:
        for p in Path(pasta_anime).iterdir():
            m = _PASTA_BROLL.match(p.name)
            if p.is_dir() and m:
                maior = max(maior, int(m.group(1)))
    except OSError:
        pass
    return maior + 1


@dataclass
class Conversao:
    episode_id: int
    de_pasta: str
    para_pasta: str
    numero: int
    titulo: str
    origem: str

    def payload(self) -> dict:
        return {
            "episodeId": self.episode_id,
            "de": Path(self.de_pasta).name,
            "para": Path(self.para_pasta).name,
            "titulo": self.titulo,
        }


@dataclass
class PlanoConversao:
    mudancas: list[Conversao] = field(default_factory=list)
    conflitos: list[str] = field(default_factory=list)
    erro: str = ""

    @property
    def pode(self) -> bool:
        return not self.erro and not self.conflitos and bool(self.mudancas)

    def payload(self) -> dict:
        return {
            "mudancas": [m.payload() for m in self.mudancas],
            "conflitos": self.conflitos,
            "erro": self.erro,
            "pode": self.pode,
        }


def planejar_conversao(
    db: Database, ids: list[int], titulos: dict[int, str] | None = None
) -> PlanoConversao:
    """Simula passar estes episódios pra B-roll. Não escreve nada."""
    plano = PlanoConversao()
    if not ids:
        plano.erro = "nenhum episódio escolhido"
        return plano
    linhas = {r["id"]: r for r in db.episodes_by_ids(ids)}
    faltando = [i for i in ids if i not in linhas]
    if faltando:
        plano.erro = f"episódio não encontrado: {faltando}"
        return plano

    with db.connect() as c:
        animes = {
            r["id"]: r["title"]
            for r in c.execute("SELECT id, title FROM anime").fetchall()
        }

    # Na ordem em que estavam (S01E01 primeiro): é a ordem em que a pessoa
    # cortou, e vira a ordem dos B-rolls.
    ordem = sorted(
        (linhas[i] for i in ids),
        key=lambda r: (str(r["output_root"] or ""), int(r["season"]), int(r["episode"])),
    )
    proximo: dict[str, int] = {}
    reservadas: set[str] = set()
    for r in ordem:
        raiz = Path(r["output_root"] or "")
        if not raiz.name:
            plano.conflitos.append(f"episódio {r['id']} sem pasta gravada")
            continue
        if (r["kind"] or "") == "BROLL":
            continue  # já é
        mae = raiz.parent
        chave = str(mae).lower()
        if chave not in proximo:
            proximo[chave] = numero_para(db, mae)
        numero = proximo[chave]
        proximo[chave] += 1

        titulo, origem = titulo_do_arquivo(
            r.get("source_file") or "", animes.get(r["anime_id"], "")
        )
        if titulos and titulos.get(int(r["id"])):
            titulo = titulos[int(r["id"])]
        alvo = mae / pasta_do_broll(numero, titulo)
        if str(alvo).lower() in reservadas or alvo.exists():
            plano.conflitos.append(f"{raiz.name} -> {alvo.name} (a pasta já existe)")
            continue
        reservadas.add(str(alvo).lower())
        plano.mudancas.append(
            Conversao(
                episode_id=int(r["id"]),
                de_pasta=str(raiz),
                para_pasta=str(alvo),
                numero=numero,
                titulo=titulo,
                origem=origem,
            )
        )
    if not plano.mudancas and not plano.conflitos and not plano.erro:
        plano.erro = "todos já são B-roll"
    return plano


def converter(
    db: Database, ids: list[int], titulos: dict[int, str] | None = None
) -> PlanoConversao:
    """Renomeia as pastas e reaponta o banco. Só se o plano permitir."""
    plano = planejar_conversao(db, ids, titulos)
    if not plano.pode:
        return plano
    feitas: list[Conversao] = []
    for m in plano.mudancas:
        de, para = Path(m.de_pasta), Path(m.para_pasta)
        if para.exists():
            plano.erro = f"'{para.name}' apareceu durante a operação"
            break
        if de.is_dir():
            os.rename(de, para)
        feitas.append(m)
    # Arquivos primeiro, banco depois (ver reclassificar.py): só o que saiu
    # do lugar é reapontado.
    db.reclassify_episodes(
        [(m.episode_id, 1, m.numero, "BROLL", m.para_pasta) for m in feitas]
    )
    for m in feitas:
        db.set_episode_broll(m.episode_id, m.titulo, m.origem)
        # A ficha que o Dangai lê também passa a dizer que é B-roll.
        marcar_broll_no_json(Path(m.para_pasta) / "metadata" / "shots.json", m.titulo)
    return plano
