"""[Studio] MyAnimeList DIRETO: elenco e galerias lidos das paginas do site.

Por que existe: o Jikan (api.jikan.moe) so le o MyAnimeList e repassa, e na
rede do Levi ele nao abre conexao (out/2026, IPv4 e IPv6 em timeout), enquanto
o myanimelist.net responde normal. Sem as galerias, cada personagem ficava com
1 retrato (o da AniList), abaixo de `min_references_per_character = 2`, e
anime novo terminava em "sem-referencias".

Este arquivo e a reserva do Jikan, e so dele:

- `MalDireto` le duas paginas do site, as mesmas que o Jikan le:
    /anime/<id>/<slug>/characters   -> elenco (id, nome, papel, retrato)
    /character/<id>/<slug>/pics     -> galeria de fotos do personagem
  e devolve os MESMOS tipos do JikanClient (`JikanCharacter`, lista de URLs),
  com o nome no formato do MAL ("Sobrenome, Nome"), que e o do Jikan.
- `JikanOuMal` tem a interface do JikanClient que o anime_provider usa: tenta
  o Jikan e, so quando ELE falha (o `failures` dele sobe), cai no MAL direto.
  O `failures` daqui so conta quando os DOIS falharam, entao o banco parcial,
  o `missing_gallery` e os avisos de fonte continuam certos.

Educado com o MAL: User-Agent de navegador comum, um pedido por vez com 1 s de
intervalo, prazo curto para abrir a conexao, cache em disco
(`anime_db/_mal_direto/`) e desistencia limpa: sem resposta no 1o pedido, 3
falhas HTTP seguidas ou UMA pagina que volta 200 sem a cara da pagina pedida
(desafio anti-bot, layout novo, redirect para outra pagina), nao bate mais nele
na rodada.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path

import httpx

from .jikan import JikanCharacter, JikanClient

MAL_BASE = "https://myanimelist.net"

# Navegador comum (Chrome no Windows). O site serve a pagina normal para ele;
# um User-Agent de robo arrisca o desafio anti-bot.
NAVEGADOR = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)

#: Intervalo minimo entre o fim de um pedido e o inicio do proximo.
INTERVALO_S = 1.0
#: So para ABRIR a conexao (o site abre em < 0,5 s quando esta no ar).
CONEXAO_S = 6.0
#: Leitura da pagina (a do elenco de Dr. Stone tem ~650 KB).
LEITURA_S = 15.0
#: Falhas HTTP seguidas (com o site respondendo) ate desistir dele na rodada.
#: A pagina estranha (200 que o parser nao le) desiste ja na 1a: ver
#: `MalDireto._pagina_estranha`.
DESISTIR_APOS = 3
#: Validade do cache em disco. O banco do anime (metadata.json) ja guarda o
#: resultado para sempre; este cache so poupa o site quando o banco e refeito
#: (banco parcial completando galerias, versao nova do metadata, outra
#: temporada da mesma franquia).
VALIDADE_H = 7 * 24

_RE_ID_PERSONAGEM = re.compile(r"/character/(\d+)(?:/([^/?#\"]*))?")
_RE_TAMANHO = re.compile(r"/r/\d+x\d+/")
_PAPEIS = {"main": "Main", "supporting": "Supporting", "background": "Background"}
_PREFIXO_PAPEL = {"m": "Main", "s": "Supporting"}


def foto_inteira(url: str | None) -> str | None:
    """A foto em tamanho cheio, sem o redimensionamento do CDN.

    O elenco traz a miniatura 42x62 assinada
    (`cdn.myanimelist.net/r/42x62/images/characters/14/620706.jpg?s=...`).
    Tirando o `/r/WxH` e a assinatura sobra a original
    (`.../images/characters/14/620706.jpg`), que e a MESMA URL da galeria:
    o retrato e a foto igual da galeria viram um arquivo so.
    O ponto de interrogacao de quem nao tem foto vira None.
    """
    if not url:
        return None
    url = url.strip()
    if url.startswith("//"):
        url = "https:" + url
    if "/images/characters/" not in url or "questionmark" in url:
        return None
    url = url.split("?", 1)[0]
    return _RE_TAMANHO.sub("/", url)


def _texto(s: str) -> str:
    # &nbsp; vira \xa0 no parser; "Main\xa0" tem que virar "Main".
    return " ".join(s.replace("\xa0", " ").split())


class _ElencoParser(HTMLParser):
    """Os blocos `table.js-anime-character-table` da pagina de elenco.

    Cada bloco e uma tabela com o personagem nas celulas de fora e os
    dubladores numa tabela de DENTRO. So o nivel de fora conta: link, foto,
    nome e papel do personagem vem antes e fora da tabela dos dubladores.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.itens: list[dict] = []
        self._bloco: dict | None = None
        self._nivel = 0  # tabelas abertas dentro do bloco (1 = a de fora)
        self._no_h3 = False
        self._no_rotulo = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: (v or "") for k, v in attrs}
        classes = a.get("class", "").split()
        if tag == "table":
            if self._bloco is not None:
                self._nivel += 1
            elif "js-anime-character-table" in classes:
                self._bloco = {
                    "id": None, "slug": "", "nome": "", "alt": "", "imagem": None,
                    "textos": [], "rotulo": "",
                }
                self._nivel = 1
            return
        b = self._bloco
        if b is None or self._nivel != 1:
            return
        if tag == "a" and b["id"] is None:
            m = _RE_ID_PERSONAGEM.search(a.get("href", ""))
            if m:
                b["id"] = int(m.group(1))
                b["slug"] = m.group(2) or ""
        elif tag == "img" and b["imagem"] is None:
            src = a.get("data-src") or a.get("src") or ""
            if "/images/" in src:
                b["imagem"] = src
                b["alt"] = a.get("alt", "")
        elif tag == "h3" and "h3_character_name" in classes:
            self._no_h3 = True
        elif tag == "div" and "js-chara-roll-and-name" in classes:
            self._no_rotulo = True

    def handle_endtag(self, tag: str) -> None:
        if self._bloco is None:
            return
        if tag == "table":
            self._nivel -= 1
            if self._nivel <= 0:
                self._fechar()
            return
        if tag == "h3":
            self._no_h3 = False
        elif tag == "div":
            self._no_rotulo = False

    def handle_data(self, data: str) -> None:
        b = self._bloco
        if b is None or self._nivel != 1:
            return
        if self._no_h3:
            b["nome"] += data
        elif self._no_rotulo:
            b["rotulo"] += data
        else:
            t = _texto(data)
            if t:
                b["textos"].append(t)

    def _fechar(self) -> None:
        b, self._bloco, self._nivel = self._bloco, None, 0
        self._no_h3 = self._no_rotulo = False
        if not b or b["id"] is None:
            return
        rotulo = _texto(b["rotulo"])
        nome = _texto(b["nome"]) or _texto(b["alt"])
        if not nome and len(rotulo) > 2 and rotulo[1] == "_":
            nome = rotulo[2:]
        if not nome:
            return
        # Papel: a linha "Main"/"Supporting" debaixo do nome; na falta, o
        # prefixo do rotulo escondido de ordenacao ("m_Liston, Nia").
        papel = next((_PAPEIS[t.lower()] for t in b["textos"] if t.lower() in _PAPEIS), None)
        if papel is None and len(rotulo) > 2 and rotulo[1] == "_":
            papel = _PREFIXO_PAPEL.get(rotulo[0].lower())
        self.itens.append(
            {
                "id": b["id"],
                "slug": b["slug"],
                "nome": nome,
                "papel": papel or "Supporting",
                "imagem": foto_inteira(b["imagem"]),
            }
        )


class _GaleriaParser(HTMLParser):
    """Os links `a.js-picture-gallery` (rel="gallery-character") da pagina
    de fotos do personagem, na ordem da pagina."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.fotos: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        a = {k: (v or "") for k, v in attrs}
        if "js-picture-gallery" not in a.get("class", "").split() and a.get("rel") != "gallery-character":
            return
        url = foto_inteira(a.get("href"))
        if url and url not in self.fotos:
            self.fotos.append(url)


def ler_elenco(html: str) -> list[dict] | None:
    """[{id, slug, nome, papel, imagem}] da pagina de elenco. Lista vazia =
    o anime nao tem elenco cadastrado; None = a pagina nao tem a cara da
    pagina de elenco (layout mudou, desafio anti-bot): falha, nao "vazio"."""
    p = _ElencoParser()
    p.feed(html)
    p.close()
    vistos: set[int] = set()
    itens = []
    for it in p.itens:
        if it["id"] in vistos:
            continue
        vistos.add(it["id"])
        itens.append(it)
    if itens:
        return itens
    if re.search(r"No characters[^<]{0,80}added", html, re.IGNORECASE):
        return []
    return None


def ler_galeria(html: str) -> list[str] | None:
    """URLs da galeria. Lista vazia = "No pictures have been added yet";
    None = nem galeria nem o aviso de vazia (pagina estranha): falha."""
    p = _GaleriaParser()
    p.feed(html)
    p.close()
    if p.fotos:
        return p.fotos
    if re.search(r"No pictures have been added", html, re.IGNORECASE):
        return []
    return None


def _agora() -> datetime:
    return datetime.now(timezone.utc)


class MalDireto:
    """Le o elenco e as galerias direto do myanimelist.net.

    Os metodos devolvem None quando NAO deu para ler (rede, bloqueio, pagina
    estranha) e lista (talvez vazia) quando leu. Quem conta falha e decide a
    reserva e o `JikanOuMal`.
    """

    def __init__(self, pasta_cache: Path | None = None) -> None:
        self.client = httpx.Client(
            timeout=httpx.Timeout(LEITURA_S, connect=CONEXAO_S),
            headers={
                "User-Agent": NAVEGADOR,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            follow_redirects=True,
        )
        self.pasta_cache = Path(pasta_cache) if pasta_cache else None
        self._ultimo = 0.0
        self.respondeu = False
        self.fora_do_ar = False
        self.desistiu = False
        self.seguidas = 0
        #: Pedidos feitos ao site nesta rodada (o cache em disco nao conta).
        self.pedidos = 0
        # slug do personagem achado no elenco: a URL da galeria fica igual a
        # do site (com "_" no lugar tambem abre, mas e melhor nao depender).
        self._slugs: dict[int, str] = {}
        #: [recap] A URL final do ultimo pedido (depois dos redirecionamentos).
        self.ultima_url = ""

    def close(self) -> None:
        self.client.close()

    # -- cache em disco ------------------------------------------------------
    def _cache_ler(self, chave: str):
        if self.pasta_cache is None:
            return None
        try:
            dados = json.loads((self.pasta_cache / f"{chave}.json").read_text(encoding="utf-8"))
            quando = datetime.fromisoformat(dados["fetched_at"])
            if quando.tzinfo is None:
                quando = quando.replace(tzinfo=timezone.utc)
            if _agora() - quando > timedelta(hours=VALIDADE_H):
                return None
            return dados["data"]
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def _cache_gravar(self, chave: str, data) -> None:
        if self.pasta_cache is None:
            return
        try:
            self.pasta_cache.mkdir(parents=True, exist_ok=True)
            final = self.pasta_cache / f"{chave}.json"
            tmp = final.with_suffix(".tmp")
            tmp.write_text(
                json.dumps(
                    {"fetched_at": _agora().isoformat(timespec="seconds"), "data": data},
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            tmp.replace(final)
        except OSError:
            pass  # cache e conveniencia: falhar aqui nao para a analise

    # -- rede ------------------------------------------------------------------
    def _esperar_vez(self) -> None:
        falta = INTERVALO_S - (time.monotonic() - self._ultimo)
        if falta > 0:
            time.sleep(falta)

    def _pagina(self, caminho: str) -> tuple[int, str] | None:
        """(status, html) com 200 ou 404; None = falhou."""
        if self.fora_do_ar or self.desistiu:
            return None
        for tentativa in range(2):
            self._esperar_vez()
            self.pedidos += 1
            try:
                r = self.client.get(f"{MAL_BASE}{caminho}")
            except httpx.HTTPError as e:
                self._ultimo = time.monotonic()
                if not self.respondeu:
                    self.fora_do_ar = True
                    print(
                        f"[MAL direto] sem resposta no primeiro pedido "
                        f"({type(e).__name__}) — desistindo dele nesta analise.",
                        flush=True,
                    )
                    return None
                if tentativa == 0:
                    time.sleep(2.0)
                    continue
                break
            self._ultimo = time.monotonic()
            self.respondeu = True
            # [recap] A1: o anime.php?q= com um resultado so redireciona para a
            # pagina do anime; quem chama olha a URL final.
            self.ultima_url = str(r.url)
            if r.status_code in (200, 404):
                self.seguidas = 0
                return r.status_code, r.text
            print(f"[MAL direto] {caminho} -> HTTP {r.status_code}", flush=True)
            # 429/5xx = carga: uma segunda tentativa com folga. 403/405 e afins
            # = bloqueio: insistir so piora.
            if (r.status_code == 429 or r.status_code >= 500) and tentativa == 0:
                time.sleep(3.0)
                continue
            break
        self.seguidas += 1
        if self.seguidas >= DESISTIR_APOS and not self.desistiu:
            self.desistiu = True
            print(
                f"[MAL direto] {self.seguidas} falhas seguidas — desistindo "
                "do MyAnimeList nesta rodada.",
                flush=True,
            )
        return None

    def _pagina_estranha(self, o_que: str) -> None:
        """Uma resposta 200 que nao tem a cara da pagina pedida: desafio
        anti-bot servido com 200, layout novo, redirect para outra pagina.
        Desiste do MAL na rodada JA na 1a: as tres causas valem para todas as
        paginas, e insistir so manda mais pedidos a um site que esta mandando
        desafio. O `_pagina` zerou o `seguidas` ao ver o 200; sem isto a
        falha nunca contaria e as 18 galerias seriam pedidas uma a uma."""
        self.seguidas += 1
        if not self.desistiu:
            self.desistiu = True
            print(
                f"[MAL direto] {o_que}: pagina sem o conteudo esperado "
                "(desafio anti-bot ou layout novo) — desistindo do "
                "MyAnimeList nesta rodada.",
                flush=True,
            )

    # -- leitura -------------------------------------------------------------
    def anime_characters(self, mal_id: int) -> list[JikanCharacter] | None:
        chave = f"anime-{int(mal_id)}-personagens"
        itens = self._cache_ler(chave)
        if itens is None:
            resp = self._pagina(f"/anime/{int(mal_id)}/_/characters")
            if resp is None:
                return None
            status, html = resp
            itens = [] if status == 404 else ler_elenco(html)
            if itens is None:
                self._pagina_estranha(f"elenco do anime {mal_id}")
                return None
            self._cache_gravar(chave, itens)
        out: list[JikanCharacter] = []
        for it in itens:
            if it.get("slug"):
                self._slugs[int(it["id"])] = it["slug"]
            out.append(
                JikanCharacter(
                    mal_id=int(it["id"]),
                    name=it["nome"],
                    role=it.get("papel") or "Supporting",
                    image=it.get("imagem"),
                )
            )
        return out

    def character_pictures(self, mal_id: int) -> list[str] | None:
        chave = f"personagem-{int(mal_id)}-fotos"
        fotos = self._cache_ler(chave)
        if fotos is not None:
            return list(fotos)
        slug = self._slugs.get(int(mal_id)) or "_"
        resp = self._pagina(f"/character/{int(mal_id)}/{slug}/pics")
        if resp is None:
            return None
        status, html = resp
        fotos = [] if status == 404 else ler_galeria(html)
        if fotos is None:
            self._pagina_estranha(f"galeria do personagem {mal_id}")
            return None
        self._cache_gravar(chave, fotos)
        return fotos


    # -- [recap] A1: achar o ANIME no site, sem o Jikan ---------------------
    def buscar_anime(self, termo: str) -> list | None:
        """Os animes que a busca publica do site acha para `termo` (Candidato).

        1o a busca do campo do site (/search/prefix.json, JSON, so o romaji e a
        capa); se ela nao responder com JSON, o anime.php?q= (HTML), que com um
        resultado so redireciona para a pagina do anime. None = o site nao
        respondeu (quem chama anota a falha); lista vazia = nada achado.
        """
        from urllib.parse import quote

        from .busca_anime import Candidato

        termo = " ".join((termo or "").split())
        if not termo:
            return []
        chave = "busca-" + re.sub(r"[^a-z0-9]+", "-", termo.lower()).strip("-")[:80]
        guardado = self._cache_ler(chave)
        if isinstance(guardado, list):
            return [Candidato.de_json(x) for x in guardado]

        cands: list | None = None
        resp = self._pagina(f"/search/prefix.json?type=anime&keyword={quote(termo)}&v=1")
        if resp is not None and resp[0] == 200:
            cands = ler_busca_json(resp[1])
        if cands is None:
            resp = self._pagina(f"/anime.php?q={quote(termo)}&cat=anime")
            if resp is None:
                return None
            status, html = resp
            m = re.search(r"/anime/(\d+)(?:/|$)", self.ultima_url or "")
            if status == 200 and m and "anime.php" not in (self.ultima_url or ""):
                # Um resultado so: o site ja abriu a pagina do anime.
                titulos = ler_titulos_do_anime(html)
                cands = [
                    Candidato(fonte="mal", titulo=titulos.get("titulo") or termo, mal_id=int(m.group(1)),
                              titulo_ingles=titulos.get("ingles"), titulos=titulos.get("outros") or [],
                              capa=titulos.get("capa"))
                ] if titulos else []
            else:
                cands = ler_busca_html(html) if status == 200 else []
            if cands is None:
                self._pagina_estranha(f"busca do anime '{termo}'")
                return None
        self._cache_gravar(chave, [c.para_json() for c in cands])
        return cands

    def titulos_do_anime(self, mal_id: int) -> dict | None:
        """{titulo, ingles, outros, capa} da pagina do anime (o romaji, o ingles,
        os sinonimos e o japones). None = nao deu para ler."""
        chave = f"anime-{int(mal_id)}-titulos"
        guardado = self._cache_ler(chave)
        if isinstance(guardado, dict):
            return guardado
        resp = self._pagina(f"/anime/{int(mal_id)}")
        if resp is None:
            return None
        status, html = resp
        if status == 404:
            return None
        titulos = ler_titulos_do_anime(html)
        if not titulos:
            self._pagina_estranha(f"pagina do anime {mal_id}")
            return None
        self._cache_gravar(chave, titulos)
        return titulos


def capa_inteira(url: str | None) -> str | None:
    """[recap] A capa do anime sem o redimensionamento do CDN (/r/116x180/...)."""
    if not url:
        return None
    url = url.strip().replace("\\/", "/")
    if url.startswith("//"):
        url = "https:" + url
    if "/images/anime/" not in url:
        return None
    return _RE_TAMANHO.sub("/", url.split("?", 1)[0])


def ler_busca_json(texto: str) -> list | None:
    """[recap] Os animes do /search/prefix.json. None = nao e o JSON esperado."""
    from .busca_anime import Candidato

    try:
        dados = json.loads(texto)
    except ValueError:
        return None
    if not isinstance(dados, dict) or "categories" not in dados:
        return None
    saida = []
    for cat in dados.get("categories") or []:
        if not isinstance(cat, dict) or cat.get("type") != "anime":
            continue
        for it in cat.get("items") or []:
            try:
                mid = int(it.get("id"))
            except (TypeError, ValueError):
                continue
            nome = html_unescape(str(it.get("name") or "")).strip()
            if not nome:
                continue
            carga = it.get("payload") or {}
            ano = carga.get("start_year")
            saida.append(Candidato(
                fonte="mal", titulo=nome, mal_id=mid,
                capa=capa_inteira(it.get("image_url")),
                ano=int(ano) if isinstance(ano, (int, float)) or (isinstance(ano, str) and ano.isdigit()) else None,
                formato=(carga.get("media_type") or None),
            ))
    return saida


_RE_RESULTADO = re.compile(
    r'href="https://myanimelist\.net/anime/(\d+)/[^"]*"[^>]*>\s*<strong>([^<]+)</strong>', re.IGNORECASE
)


def ler_busca_html(html: str) -> list | None:
    """[recap] Os resultados da pagina anime.php?q= (lista). None = nao e a pagina."""
    from .busca_anime import Candidato

    vistos: set[int] = set()
    saida = []
    for m in _RE_RESULTADO.finditer(html):
        mid = int(m.group(1))
        if mid in vistos:
            continue
        vistos.add(mid)
        saida.append(Candidato(fonte="mal", titulo=html_unescape(m.group(2)).strip(), mal_id=mid))
    if saida:
        return saida
    if re.search(r"No titles that matched your query were found", html, re.IGNORECASE):
        return []
    return None


def html_unescape(s: str) -> str:
    import html as _html

    return _html.unescape(s or "")


def ler_titulos_do_anime(html: str) -> dict:
    """[recap] {titulo, ingles, outros, capa} da pagina do anime. {} = nao achou."""
    out: dict = {}
    m = re.search(r'<h1 class="title-name[^"]*"[^>]*>\s*<strong>([^<]+)</strong>', html)
    if m:
        out["titulo"] = html_unescape(m.group(1)).strip()
    outros: list[str] = []
    for rotulo, texto in re.findall(r'<span class="dark_text">\s*([A-Za-z]+):\s*</span>\s*([^<]*)', html):
        valor = html_unescape(texto).strip()
        if not valor:
            continue
        if rotulo == "English":
            out["ingles"] = valor
        elif rotulo == "Synonyms":
            outros.extend(s.strip() for s in valor.split(",") if s.strip())
        elif rotulo in ("Japanese", "German", "Spanish", "French"):
            outros.append(valor)
    if outros:
        out["outros"] = outros
    c = re.search(r'<img[^>]+(?:data-src|src)="(https://cdn\.myanimelist\.net/images/anime/[^"]+)"', html)
    if c:
        out["capa"] = capa_inteira(c.group(1))
    return out if out.get("titulo") or out.get("ingles") else {}


class JikanOuMal:
    """O JikanClient com o MyAnimeList direto de reserva.

    Mesma interface que o anime_provider usa do JikanClient (`search_anime`,
    `anime_characters`, `character_pictures`, `failures`, `close`). Com o
    Jikan no ar, o resultado e o dele, byte a byte. A busca do anime (so usada
    com a AniList fora) continua so no Jikan.
    """

    def __init__(self, jikan: JikanClient, mal: MalDireto) -> None:
        self.jikan = jikan
        self.mal = mal
        #: Pedidos em que o Jikan E o MAL direto falharam.
        self.failures = 0
        #: Pedidos atendidos pelo MAL direto (para o log).
        self.pelo_mal = 0
        self._avisou = False

    def close(self) -> None:
        self.jikan.close()
        self.mal.close()

    def search_anime(self, name: str):
        antes = self.jikan.failures
        r = self.jikan.search_anime(name)
        if self.jikan.failures > antes:
            self.failures += 1
        return r

    def _reserva(self, chamar):
        if not self._avisou:
            self._avisou = True
            print("[MAL direto] Jikan falhou — lendo o MyAnimeList direto.", flush=True)
        r = chamar()
        if r is None:
            self.failures += 1
            return []
        self.pelo_mal += 1
        return r

    def anime_characters(self, mal_id: int) -> list[JikanCharacter]:
        antes = self.jikan.failures
        r = self.jikan.anime_characters(mal_id)
        if self.jikan.failures == antes:
            return r
        return self._reserva(lambda: self.mal.anime_characters(mal_id))

    def character_pictures(self, mal_id: int) -> list[str]:
        antes = self.jikan.failures
        r = self.jikan.character_pictures(mal_id)
        if self.jikan.failures == antes:
            return r
        return self._reserva(lambda: self.mal.character_pictures(mal_id))
