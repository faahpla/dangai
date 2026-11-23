"""Elencos importados: personagens que vieram de um pacote de outro AnCut.

A 1.34 importava direto pro banco, como uma linha de anime nova — e o Levi
achou o furo no primeiro teste (31/10): o pacote do Black Clover era de um
anime "local" (batizado sem internet), a importação criou um "Black Clover"
solto no banco, a análise dele resolveu o arquivo online pra outra linha
("Black Clover 2nd Season") e nunca olhou os 44 personagens importados.

Agora a importação NÃO mexe no banco. O pacote fica guardado aqui, com as
chaves que o identificam — os ids do AniList (do anime e da franquia) e o
TÍTULO-BASE ("black clover", sem "2nd Season", "Season 2", "S2"). Na hora da
análise, normal ou Descoberta, quando o anime resolvido bate por uma dessas
chaves, `aplicar` copia as fotos pra pasta de refs que a análise está usando
e põe o centroide nos personagens da linha de anime que ela está usando. Daí
pra frente é o caminho de sempre: a análise normal acha as fotos como acha
as do catálogo, e a Descoberta acha o centroide como acha o de quem foi
batizado aqui.

Layout: <cache>/elencos_importados/<chave>/elenco.json + fotos/<n>/<arquivo>.
"""

from __future__ import annotations

import base64
import json
import re
import shutil
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

PASTA = "elencos_importados"

# "2nd Season", "Season 2", "S2", "Part 2", "Final Season", "Cour 2", "II"…
_TEMPORADA = re.compile(
    r"\b(?:\d+(?:st|nd|rd|th)\s+season|season\s*\d+|s\d{1,2}|part\s*\d+|cour\s*\d+|"
    r"final\s+season|the\s+final|\d+(?:st|nd|rd|th)\s+part|ii|iii|iv)\b",
    re.I,
)


def titulo_base(titulo: str) -> str:
    """"Black Clover 2nd Season" e "Black Clover" viram "black clover".

    Sem acento, sem pontuação, sem a marca de temporada. É a chave que liga
    o pacote às análises de QUALQUER temporada do mesmo anime — o AniList
    dá um registro por temporada, e o arquivo nem sempre cai no que o
    pacote exportou.
    """
    t = unicodedata.normalize("NFKD", titulo or "")
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    t = _TEMPORADA.sub(" ", t)
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return " ".join(t.split())


@dataclass
class ElencoImportado:
    pasta: Path
    titulo: str
    chaves_titulo: set[str] = field(default_factory=set)
    anilist_ids: set[int] = field(default_factory=set)
    personagens: list[dict] = field(default_factory=list)  # nome, aliases, papel, centroide, fotos

    def bate(self, ids: list[int], titulos: list[str]) -> bool:
        if self.anilist_ids & {int(i) for i in ids if i}:
            return True
        bases = {titulo_base(t) for t in titulos if t}
        bases.discard("")
        return bool(self.chaves_titulo & bases)


def _raiz(cache_path: Path) -> Path:
    return Path(cache_path) / PASTA


def listar(cache_path: Path) -> list[ElencoImportado]:
    out: list[ElencoImportado] = []
    raiz = _raiz(cache_path)
    if not raiz.is_dir():
        return out
    for d in sorted(raiz.iterdir()):
        arq = d / "elenco.json"
        if not arq.is_file():
            continue
        try:
            dados = json.loads(arq.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        out.append(ElencoImportado(
            pasta=d,
            titulo=dados.get("titulo") or d.name,
            chaves_titulo=set(dados.get("chaves_titulo") or []),
            anilist_ids={int(i) for i in dados.get("anilist_ids") or [] if i},
            personagens=list(dados.get("personagens") or []),
        ))
    return out


def pacote_do_nome(cache_path: Path, nomes: list[str]) -> "ElencoImportado | None":
    """O pacote importado que responde por algum destes nomes."""
    for el in listar(cache_path):
        if el.bate([], nomes):
            return el
    return None


def animes_do_pacote(db, el: "ElencoImportado") -> dict[tuple[str, str], int]:
    """Animes da Biblioteca SEM identidade online que respondem por uma
    das chaves do pacote -- pelo título ou pelo nome da pasta --, com o
    número de episódios de cada: {(título, pasta): episódios}."""
    with db.connect() as c:
        linhas = c.execute(
            "SELECT a.title, e.output_root FROM anime a JOIN episode e ON e.anime_id = a.id "
            "WHERE a.anilist_id IS NULL AND a.mal_id IS NULL AND e.output_root IS NOT NULL"
        ).fetchall()
    conta: dict[tuple[str, str], int] = {}
    for r in linhas:
        pasta = Path(str(r["output_root"])).parent.name
        if titulo_base(r["title"]) in el.chaves_titulo or titulo_base(pasta) in el.chaves_titulo:
            k = (str(r["title"]), pasta)
            conta[k] = conta.get(k, 0) + 1
    return conta


def anime_ligado(db, el: "ElencoImportado | None") -> tuple[str, str] | None:
    """(título, pasta) do anime da Biblioteca a que este pacote já está
    ligado -- o de mais episódios, se houver mais de um.

    É o que impede o mesmo anime de virar duas pastas quando o arquivo
    chega com outro nome: "Avatar.Seven.Havens.S01E07" e "Avatar - Os Sete
    Refúgios S01E10" respondem pelo mesmo pacote, e sem isto o primeiro
    abria um anime novo ao lado do segundo (Levi, 11/2026).
    """
    if el is None:
        return None
    conta = animes_do_pacote(db, el)
    return max(conta, key=lambda k: conta[k]) if conta else None


def gravar(destino: Path, titulo: str, chaves: set[str], ids: set[int], personagens: list[dict]) -> None:
    destino.mkdir(parents=True, exist_ok=True)
    (destino / "elenco.json").write_text(
        json.dumps({
            "titulo": titulo,
            "chaves_titulo": sorted(c for c in chaves if c),
            "anilist_ids": sorted(ids),
            "personagens": personagens,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def aplicar(
    cache_path: Path,
    db,
    ref_store,
    cache_id: str,
    anime_id: int,
    ids: list[int],
    titulos: list[str],
    modelo: dict,
) -> tuple[list[str], set[str]]:
    """Liga os elencos importados que batem com este anime à análise atual.

    Copia as fotos que faltam pra pasta de refs `cache_id` (a pasta do
    personagem é a do mesmo nome em qualquer formato — "Swing, Magna" cai na
    de "Magna Swing") e grava o centroide no personagem desta linha de anime
    quando ele ainda não tem um. Devolve (nomes ligados, nomes que só têm
    centroide, sem foto nenhuma).

    Só SOMA e é idempotente: foto que já está lá não é copiada de novo,
    centroide que já existe aqui ganha do importado.
    """
    ligados: list[str] = []
    so_centroide: set[str] = set()
    for el in listar(cache_path):
        if not el.bate(ids, titulos):
            continue
        for p in el.personagens:
            nome = (p.get("nome") or "").strip()
            if not nome:
                continue
            fotos = [el.pasta / f for f in p.get("fotos") or []]
            fotos = [f for f in fotos if f.is_file()]
            if fotos:
                d = ref_store.character_dir(cache_id, nome)
                d.mkdir(parents=True, exist_ok=True)
                for f in fotos:
                    alvo = d / f"imp_{f.name}"
                    if not alvo.exists():
                        shutil.copyfile(f, alvo)
            cid = db.upsert_character(
                anime_id=anime_id, name=nome, anilist_id=None, mal_id=None,
                role=p.get("papel") or "Main",
            )
            # O nome que ficou no banco: o upsert reusa o personagem que já
            # existe em outro formato ("Swing, Magna" do catálogo).
            with db.connect() as c:
                linha = c.execute("SELECT name FROM character WHERE id=?", (cid,)).fetchone()
            nome = (linha[0] if linha else None) or nome
            if p.get("centroide") and p.get("modelo", modelo) == modelo:
                with db.connect() as c:
                    tem = c.execute(
                        "SELECT embedding IS NOT NULL FROM character WHERE id=?", (cid,)
                    ).fetchone()
                if not (tem and tem[0]):
                    db.set_character_embedding(cid, base64.b64decode(p["centroide"]), reference_count=0)
            if not fotos and p.get("centroide"):
                so_centroide.add(nome)
            ligados.append(nome)
        print(f"[Elenco] '{el.titulo}' importado: {len(el.personagens)} personagens "
              f"ligados a esta análise.", flush=True)
    return ligados, so_centroide
