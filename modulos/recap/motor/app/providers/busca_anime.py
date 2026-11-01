"""[recap] ACHAR O ANIME quando o Jikan nao responde (A1, pedido do Levi 18/10).

O caso real: o Magic Repo Man. O nome que vem do arquivo e o titulo INTEIRO da
light novel sem a pontuacao ("Magic Repo Man Dumped by My Party Ill Cash In
With a Cute Support Fairy to Become the Strongest"). A AniList nao acha nada com
ele (o titulo oficial tem "I'll" e dois-pontos), o Jikan nao abre conexao da
rede do Levi, o motor desistia do MyAnimeList inteiro e o Reconhecer na mao
vinha SEM nenhuma sugestao de nome. Com "Magic Repo Man", a AniList acha na
hora (id 202250).

O que este arquivo faz:

- VARIANTES do nome (variantes_de_busca): inteiro -> sem o marcador de
  temporada (S2, Season 2, 2nd Season...) -> antes de ":"/" - "/"~" -> as 4 e
  as 3 primeiras palavras, mais as trocas de particula do romaji.
- TRES fontes, nesta ordem, cada uma so quando a anterior nao achou:
  1. AniList (pagina de resultados, com titulos alternativos e sinonimos);
  2. o PROPRIO site do MyAnimeList, sem o Jikan: a busca publica
     /search/prefix.json (JSON) e, se ela falhar, o anime.php?q= (HTML). Os
     titulos alternativos (English, Synonyms) saem da pagina do anime;
  3. a Kitsu (filter[text]), de reserva.
  O Jikan so entra se o site do MAL falhar (em outra rede ele responde).
- SIMILARIDADE (similaridade): de cada candidato vale o titulo mais parecido
  com o nome PEDIDO (romaji, ingles, nativo, sinonimos), por tres medidas
  (sequencia de letras, palavras em comum e "um e o comeco do outro"). Abaixo
  de LIMIAR ninguem e escolhido sozinho: melhor sem elenco do que com o elenco
  de outro anime.
- CACHE em anime_db/_busca/: cada pesquisa por 7 dias e a ESCOLHA da pessoa
  (o "Buscar elenco" da tela) para sempre. O busca_resolvida.json do provider
  continua guardando nome -> banco do anime depois que o elenco e montado.

Nada aqui levanta: fonte fora do ar vira lista vazia e a anotacao em `erros`.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Callable

#: Similaridade minima para escolher sozinho. Medido nos nomes reais: o nome
#: do arquivo do Magic Repo Man x o titulo ingles da 1,00; "Magic Repo Man" x
#: o mesmo titulo da 0,88 (comeco do outro); animes errados ficam abaixo de 0,6.
LIMIAR = 0.80
#: Validade de uma pesquisa guardada.
VALIDADE_DA_BUSCA_H = 7 * 24
#: Quantos resultados de cada fonte entram na lista da tela.
RESULTADOS_POR_FONTE = 8
#: Quantos resultados do MAL ganham a pagina lida (titulos alternativos) por pesquisa.
PAGINAS_DO_MAL_POR_BUSCA = 2

# Particulas de romaji que fansubs grudam/separam ("dewa" x "de wa").
_PARTICULAS = [("dewa", "de wa"), ("niwa", "ni wa"), ("ewa", "e wa")]

# Marcador de temporada em qualquer ponto do nome: "S2", "S02", "Season 2",
# "2nd Season", "Part 2", "Cour 2", "Final Season". Ordinais em palavra
# ("Second Season") tambem.
_TEMPORADA = re.compile(
    r"\b(?:s\d{1,2}(?:e\d{1,3})?"
    r"|(?:season|temporada|cour|part|parte)\s*\d{1,2}"
    r"|\d{1,2}(?:st|nd|rd|th)\s+(?:season|cour|part)"
    r"|(?:first|second|third|fourth|fifth|sixth|final)\s+(?:season|cour|part))\b",
    re.IGNORECASE,
)
# Separadores de subtitulo: o titulo principal vem antes deles.
_SEPARADORES = (":", " - ", " – ", " — ", "~", "|", "(", "[", "!", "?")


def normalizar(texto: str) -> str:
    """Minusculo, sem acento, sem apostrofo (I'll -> ill), so letras e numeros
    separados por um espaco. E a forma em que os titulos sao comparados."""
    if not texto:
        return ""
    s = unicodedata.normalize("NFKD", str(texto))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower()
    s = re.sub(r"['’`´]", "", s)
    s = re.sub(r"[^0-9a-z぀-ヿ一-鿿]+", " ", s)
    return " ".join(s.split())


def sem_temporada(nome: str) -> str:
    """O nome sem os marcadores de temporada ("Dr STONE S04" -> "Dr STONE")."""
    return " ".join(_TEMPORADA.sub(" ", nome or "").split())


def variantes_de_busca(nome: str, temporada: int = 1) -> list[str]:
    """As consultas, da mais especifica para a mais curta, sem repetir.

    inteiro (com "Season N" na frente quando a temporada e > 1) -> sem o
    marcador de temporada -> trocas de particula -> antes do 1o separador de
    subtitulo -> as 4 e as 3 primeiras palavras.
    """
    saida: list[str] = []

    def por(q: str) -> None:
        q = " ".join((q or "").split()).strip(" -:~|")
        if len(normalizar(q)) >= 2 and q.lower() not in (s.lower() for s in saida):
            saida.append(q)

    inteiro = " ".join((nome or "").split())
    base = sem_temporada(inteiro) or inteiro
    if temporada and temporada > 1:
        por(f"{base} Season {temporada}")
    por(inteiro)
    por(base)
    baixo = f" {base.lower()} "
    for a, b in _PARTICULAS:
        for de, para in ((a, b), (b, a)):
            if f" {de} " in baixo:
                por(re.sub(rf"(?i)\b{de}\b", para, base))
    for sep in _SEPARADORES:
        if sep in base:
            antes = base.split(sep, 1)[0]
            if len(antes.split()) >= 1:
                por(antes)
    palavras = base.split()
    for n in (4, 3):
        if len(palavras) > n:
            por(" ".join(palavras[:n]))
    return saida


def similaridade(pedido: str, titulo: str) -> float:
    """0..1: o quanto `titulo` e o anime de `pedido`.

    O maior de tres: a sequencia de letras (pega erro de digitacao), as
    palavras em comum (F1, pega ordem trocada e pontuacao perdida) e o
    "comeco do outro" em palavra inteira ("magic repo man" no comeco do
    titulo de 19 palavras), que so vale com 2+ palavras e 8+ letras, para um
    prefixo generico ("one", "re") nao sequestrar titulo alheio.
    """
    q, t = normalizar(pedido), normalizar(titulo)
    if not q or not t:
        return 0.0
    if q == t:
        return 1.0
    seq = SequenceMatcher(None, q, t).ratio()
    pq, pt = q.split(), t.split()
    comum = len(set(pq) & set(pt))
    f1 = 0.0
    if comum:
        precisao = comum / len(set(pt))
        cobertura = comum / len(set(pq))
        f1 = 2 * precisao * cobertura / (precisao + cobertura)
    prefixo = 0.0
    curto, longo = (pq, pt) if len(pq) <= len(pt) else (pt, pq)
    if len(curto) >= 2 and len(" ".join(curto)) >= 8 and longo[: len(curto)] == curto:
        prefixo = 0.86 + 0.14 * len(curto) / len(longo)
    return round(max(seq, f1, prefixo), 4)


def relevancia(termo: str, titulos: list[str]) -> float:
    """0..1 para ORDENAR a lista do "Buscar elenco": o termo digitado e curto
    ("repo man") e o titulo longo, entao conta mais o termo estar DENTRO do
    titulo (em palavra inteira) do que os dois serem parecidos."""
    q = normalizar(termo)
    if not q:
        return 0.0
    pq = set(q.split())
    melhor = 0.0
    for t in titulos:
        nt = normalizar(t)
        if not nt:
            continue
        nota = similaridade(termo, t)
        if f" {q} " in f" {nt} ":
            nota = max(nota, 0.95)
        comum = len(pq & set(nt.split())) / len(pq)
        nota = max(nota, 0.85 * comum if comum == 1 else 0.6 * comum)
        melhor = max(melhor, nota)
    return round(melhor, 4)


def melhor_similaridade(pedido: str, titulos: list[str]) -> float:
    """A similaridade do titulo mais parecido; o pedido sem temporada tambem conta."""
    base = sem_temporada(pedido)
    melhor = 0.0
    for t in titulos:
        if not t:
            continue
        melhor = max(melhor, similaridade(pedido, t))
        if base and base != pedido:
            melhor = max(melhor, similaridade(base, t))
    return melhor


@dataclass
class Candidato:
    """Um anime achado numa fonte. Os ids que a fonte deu (os outros, None)."""

    fonte: str  # 'anilist' | 'mal' | 'kitsu' | 'jikan' | 'escolha'
    titulo: str
    titulo_ingles: str | None = None
    anilist_id: int | None = None
    mal_id: int | None = None
    kitsu_id: int | None = None
    titulos: list[str] = field(default_factory=list)
    ano: int | None = None
    formato: str | None = None
    capa: str | None = None
    nota: float = 0.0

    def todos_os_titulos(self) -> list[str]:
        vistos: list[str] = []
        for t in [self.titulo, self.titulo_ingles, *self.titulos]:
            if t and t not in vistos:
                vistos.append(t)
        return vistos

    def chave(self) -> str:
        if self.mal_id:
            return f"mal{self.mal_id}"
        if self.anilist_id:
            return f"al{self.anilist_id}"
        if self.kitsu_id:
            return f"kitsu{self.kitsu_id}"
        return f"t:{normalizar(self.titulo)}"

    def para_json(self) -> dict:
        return asdict(self)

    @staticmethod
    def de_json(d: dict) -> "Candidato":
        campos = {k: d.get(k) for k in Candidato.__dataclass_fields__ if k in d}
        c = Candidato(**campos)  # type: ignore[arg-type]
        c.titulos = list(c.titulos or [])
        return c


def _agora() -> datetime:
    return datetime.now(timezone.utc)


def _chave_do_nome(nome: str, temporada: int) -> str:
    return f"{normalizar(nome)}|s{int(temporada or 1)}"


class BuscaDeAnime:
    """As tres fontes, a escolha pelo titulo mais parecido e o cache.

    `anilist`, `mal` e `kitsu` sao os clientes do provider (anilist.py,
    mal_direto.py, kitsu.py). Nos testes entram falsos com a mesma interface.
    """

    def __init__(self, pasta_cache: Path | None, anilist, mal, kitsu) -> None:
        self.pasta = Path(pasta_cache) if pasta_cache else None
        self.anilist = anilist
        self.mal = mal
        self.kitsu = kitsu
        #: O que falhou na ultima busca, por fonte (para a frase da tela).
        self.erros: dict[str, str] = {}

    # ------------------------------------------------------------- cache
    def _arquivo(self, nome: str) -> Path | None:
        return self.pasta / nome if self.pasta else None

    def _ler_json(self, nome: str):
        arq = self._arquivo(nome)
        if arq is None:
            return None
        try:
            return json.loads(arq.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _gravar_json(self, nome: str, dados) -> None:
        arq = self._arquivo(nome)
        if arq is None:
            return
        try:
            arq.parent.mkdir(parents=True, exist_ok=True)
            tmp = arq.with_suffix(".tmp")
            tmp.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(arq)
        except OSError:
            pass  # cache e conveniencia

    def _pesquisa_guardada(self, fonte: str, consulta: str) -> list[Candidato] | None:
        h = hashlib.sha1(f"{fonte}|{normalizar(consulta)}".encode("utf-8")).hexdigest()[:20]
        d = self._ler_json(f"{fonte}-{h}.json")
        if not isinstance(d, dict):
            return None
        try:
            quando = datetime.fromisoformat(d["quando"])
            if quando.tzinfo is None:
                quando = quando.replace(tzinfo=timezone.utc)
            if _agora() - quando > timedelta(hours=VALIDADE_DA_BUSCA_H):
                return None
            return [Candidato.de_json(x) for x in d["candidatos"]]
        except (KeyError, TypeError, ValueError):
            return None

    def _guardar_pesquisa(self, fonte: str, consulta: str, cands: list[Candidato]) -> None:
        h = hashlib.sha1(f"{fonte}|{normalizar(consulta)}".encode("utf-8")).hexdigest()[:20]
        self._gravar_json(
            f"{fonte}-{h}.json",
            {"quando": _agora().isoformat(timespec="seconds"), "consulta": consulta,
             "candidatos": [c.para_json() for c in cands]},
        )

    # --------------------------------------------------- escolha da pessoa
    def escolha_guardada(self, nome: str, temporada: int) -> Candidato | None:
        """O anime que a pessoa escolheu no "Buscar elenco" para este nome."""
        d = self._ler_json("escolhas.json")
        if not isinstance(d, dict):
            return None
        e = d.get(_chave_do_nome(nome, temporada)) or d.get(_chave_do_nome(sem_temporada(nome), 1))
        if not isinstance(e, dict):
            return None
        try:
            c = Candidato.de_json(e)
        except TypeError:
            return None
        c.fonte = "escolha"
        c.nota = 1.0
        return c

    def gravar_escolha(self, nome: str, temporada: int, cand: Candidato) -> None:
        d = self._ler_json("escolhas.json")
        if not isinstance(d, dict):
            d = {}
        d[_chave_do_nome(nome, temporada)] = cand.para_json()
        self._gravar_json("escolhas.json", d)

    # -------------------------------------------------------- as fontes
    def _anilist(self, consulta: str) -> list[Candidato]:
        guardada = self._pesquisa_guardada("anilist", consulta)
        if guardada is not None:
            return guardada
        try:
            cands = self.anilist.search_page(consulta, per_page=RESULTADOS_POR_FONTE)
        except Exception as e:  # noqa: BLE001 -- fonte fora do ar nao derruba a busca
            self.erros["anilist"] = str(e) or type(e).__name__
            return []
        self._guardar_pesquisa("anilist", consulta, cands)
        return cands

    def _mal(self, consulta: str) -> list[Candidato]:
        guardada = self._pesquisa_guardada("mal", consulta)
        if guardada is not None:
            return guardada
        cands = None
        try:
            cands = self.mal.buscar_anime(consulta)
        except Exception as e:  # noqa: BLE001
            self.erros["mal"] = str(e) or type(e).__name__
        if cands is None:
            self.erros.setdefault("mal", "o site do MyAnimeList nao respondeu")
            return []
        self._guardar_pesquisa("mal", consulta, cands)
        return cands

    def _kitsu(self, consulta: str) -> list[Candidato]:
        guardada = self._pesquisa_guardada("kitsu", consulta)
        if guardada is not None:
            return guardada
        try:
            cands = self.kitsu.buscar_anime(consulta, limite=RESULTADOS_POR_FONTE)
        except Exception as e:  # noqa: BLE001
            self.erros["kitsu"] = str(e) or type(e).__name__
            return []
        if cands is None:
            self.erros.setdefault("kitsu", "a Kitsu nao respondeu")
            return []
        self._guardar_pesquisa("kitsu", consulta, cands)
        return cands

    def _completar_titulos_do_mal(self, cands: list[Candidato], pedido: str) -> None:
        """Os titulos alternativos (ingles, sinonimos) dos primeiros resultados do
        MAL: a busca dele so devolve o romaji, e o pedido costuma ser o ingles."""
        lidos = 0
        for c in cands:
            if lidos >= PAGINAS_DO_MAL_POR_BUSCA:
                break
            if c.mal_id is None or c.titulo_ingles or melhor_similaridade(pedido, c.todos_os_titulos()) >= LIMIAR:
                continue
            try:
                extra = self.mal.titulos_do_anime(c.mal_id)
            except Exception:  # noqa: BLE001
                extra = None
            lidos += 1
            if not extra:
                continue
            c.titulo_ingles = extra.get("ingles") or c.titulo_ingles
            for t in extra.get("outros") or []:
                if t and t not in c.titulos:
                    c.titulos.append(t)

    # --------------------------------------------------------- escolher
    @staticmethod
    def _pontuar(pedido: str, cands: list[Candidato]) -> list[Candidato]:
        for c in cands:
            c.nota = melhor_similaridade(pedido, c.todos_os_titulos())
        return sorted(cands, key=lambda c: -c.nota)

    def resolver(
        self,
        nome: str,
        temporada: int = 1,
        status: Callable[[str], None] | None = None,
    ) -> Candidato | None:
        """O anime deste nome, ou None. A escolha da pessoa vem antes de tudo."""

        def dizer(msg: str) -> None:
            if status:
                status(msg)

        self.erros = {}
        escolhido = self.escolha_guardada(nome, temporada)
        if escolhido is not None:
            dizer(f"Anime escolhido antes: {escolhido.titulo}")
            return escolhido

        consultas = variantes_de_busca(nome, temporada)
        fontes: list[tuple[str, Callable[[str], list[Candidato]]]] = [
            ("AniList", self._anilist),
            ("MyAnimeList", self._mal),
            ("Kitsu", self._kitsu),
        ]
        melhor: Candidato | None = None
        for rotulo, buscar in fontes:
            for q in consultas:
                dizer(f"Buscando '{q}' na {rotulo}...")
                cands = buscar(q)
                if rotulo == "MyAnimeList" and cands:
                    self._completar_titulos_do_mal(cands, nome)
                for c in self._pontuar(nome, cands):
                    if melhor is None or c.nota > melhor.nota:
                        melhor = c
                if melhor is not None and melhor.nota >= LIMIAR:
                    dizer(f"Achado na {rotulo}: {melhor.titulo} ({int(melhor.nota * 100)}%)")
                    return melhor
                chave_da_fonte = {"AniList": "anilist", "MyAnimeList": "mal", "Kitsu": "kitsu"}[rotulo]
                if chave_da_fonte in self.erros and not cands:
                    break  # a fonte caiu: nao adianta as outras consultas
        if melhor is not None:
            dizer(f"Nenhum anime parecido o bastante (o melhor: {melhor.titulo}, {int(melhor.nota * 100)}%).")
        return None

    def buscar(self, termo: str, temporada: int = 1) -> list[Candidato]:
        """A lista da tela ("Buscar elenco"): as tres fontes, sem repetir o mesmo
        anime (pelo id do MAL), do mais parecido com o termo ao menos."""
        self.erros = {}
        termo = " ".join((termo or "").split())
        if len(normalizar(termo)) < 2:
            return []
        juntos: dict[str, Candidato] = {}

        por_titulo: dict[str, str] = {}

        def somar(cands: list[Candidato]) -> None:
            for c in cands:
                k = c.chave()
                # O mesmo anime sem id em comum (a Kitsu sem o mapeamento do
                # MAL): o titulo principal igual junta os dois.
                for t in c.todos_os_titulos()[:2]:
                    if normalizar(t) in por_titulo:
                        k = por_titulo[normalizar(t)]
                        break
                for t in c.todos_os_titulos()[:2]:
                    por_titulo.setdefault(normalizar(t), k)
                velho = juntos.get(k)
                if velho is None:
                    juntos[k] = c
                    continue
                # Mesmo anime em duas fontes: completa o que faltava.
                velho.anilist_id = velho.anilist_id or c.anilist_id
                velho.mal_id = velho.mal_id or c.mal_id
                velho.kitsu_id = velho.kitsu_id or c.kitsu_id
                velho.titulo_ingles = velho.titulo_ingles or c.titulo_ingles
                velho.capa = velho.capa or c.capa
                velho.ano = velho.ano or c.ano
                velho.formato = velho.formato or c.formato
                for t in c.todos_os_titulos():
                    if t not in velho.todos_os_titulos():
                        velho.titulos.append(t)

        al = self._anilist(termo)
        if not al and "anilist" not in self.erros:
            # O nome inteiro do arquivo (titulo de light novel sem a pontuacao)
            # nao acha nada: as versoes encurtadas, como na analise.
            for q in variantes_de_busca(termo, temporada)[1:4]:
                al = self._anilist(q)
                if al or "anilist" in self.erros:
                    break
        somar(al)
        mal = self._mal(termo)
        if mal:
            self._completar_titulos_do_mal(mal, termo)
        somar(mal)
        somar(self._kitsu(termo))
        lista = list(juntos.values())
        for c in lista:
            c.nota = relevancia(termo, c.todos_os_titulos())
        ordem = {"anilist": 0, "mal": 1, "kitsu": 2, "jikan": 3}
        lista.sort(key=lambda c: (-c.nota, ordem.get(c.fonte, 9)))
        return lista[: RESULTADOS_POR_FONTE * 2]
