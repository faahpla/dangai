from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

from ..pipeline_types import AnimeNotFoundError
from ..storage.anime_folders import resolver_franquia
from .anilist import AniListAnime, AniListClient, AniListRelation
from .busca_anime import BuscaDeAnime, Candidato
from .danbooru import DanbooruClient, character_tag_candidates
from .jikan import JikanClient
from .kitsu import KitsuClient
from .mal_direto import JikanOuMal, MalDireto

_ROLE_WEIGHT = {"Main": 0, "MAIN": 0, "Supporting": 1, "SUPPORTING": 1, "Background": 2, "BACKGROUND": 2}

# Relation types treated as "same franchise" — we pool characters/refs across
# these to give seasons like Dr. Stone S4 access to refs from S1-S3.
_FRANCHISE_RELATIONS = {
    "SEQUEL", "PREQUEL", "SIDE_STORY", "PARENT",
    "ALTERNATIVE", "SPIN_OFF", "SUMMARY",
}

# Bump when the cached metadata schema changes so old caches are rebuilt.
# v4: characters/refs pooled across the whole franchise graph.
METADATA_VERSION = 4

@dataclass
class CharacterRef:
    mal_id: int | None
    anilist_id: int | None
    name: str
    role: str
    image_urls: list[str]


@dataclass
class AnimeBundle:
    anilist_id: int | None
    mal_id: int | None
    title: str
    title_english: str | None
    characters: list[CharacterRef]
    franchise_ids: list[int] | None = None   # All AniList IDs pooled into this bundle
    franchise_root_id: int | None = None     # The id used as cache key for this franchise
    # Banco criado pelo Modo Descoberta (sem ids online): força a pasta de
    # cache/refs pra "local-<slug>" em vez de al<id>/mal<id>.
    cache_id_override: str | None = None
    #: Montado com a fonte caindo: falta galeria de alguém. É guardado assim
    #: MESMO — jogar fora custava 140s em toda análise seguinte — mas fica
    #: marcado, e a próxima rodada tenta só o que falta.
    partial: bool = False
    #: MAL ids que ficaram sem galeria. Vazio num banco completo.
    missing_gallery: list[int] | None = None
    #: Quando foi montado (ISO). Serve pra saber a idade de um banco parcial.
    fetched_at: str | None = None


def _mais_velho_que(quando_iso: str | None, horas: float) -> bool:
    """O carimbo é mais antigo que N horas? Sem carimbo = sim (banco velho,
    de antes deste campo existir — vale tentar)."""
    from datetime import datetime, timedelta, timezone

    if not quando_iso:
        return True
    try:
        quando = datetime.fromisoformat(quando_iso)
    except ValueError:
        return True
    if quando.tzinfo is None:
        quando = quando.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - quando > timedelta(hours=horas)


def _agora() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def local_cache_id(anime_name: str) -> str:
    """Cache id de um anime SEM ids online (Modo Descoberta)."""
    slug = re.sub(r"[^a-z0-9]+", "-", anime_name.lower()).strip("-") or "anime"
    return f"local-{slug}"


def _name_tokens(name: str) -> frozenset[str]:
    """Nome como conjunto de palavras, pra casar formatos diferentes entre as
    fontes: Jikan usa "Tempest, Rimuru", AniList usa "Rimuru Tempest"."""
    return frozenset(re.sub(r"[^a-z0-9 ]+", " ", name.lower()).split())


def _bate_com_escolha(bundle: AnimeBundle, esc: Candidato) -> bool:
    """[recap] O banco guardado e do anime que a pessoa escolheu?"""
    if esc.anilist_id and (esc.anilist_id == bundle.anilist_id or esc.anilist_id in (bundle.franchise_ids or [])):
        return True
    if esc.mal_id and esc.mal_id == bundle.mal_id:
        return True
    return bool(esc.kitsu_id) and bundle.cache_id_override == f"kitsu{esc.kitsu_id}"


class AnimeProvider:
    """Resolves an anime name into a character list with multiple reference URLs.

    Caches results under `<cache>/anime_db/<anilist_id_or_mal>/metadata.json`
    so re-running on another episode of the same anime reuses the bank.
    """

    def __init__(self, cache_root: Path) -> None:
        self.cache_root = Path(cache_root) / "anime_db"
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self.anilist = AniListClient()
        # [Studio] O Jikan com o MyAnimeList DIRETO de reserva (mal_direto.py):
        # quando o api.jikan.moe falha, o elenco e as galerias saem das paginas
        # do proprio myanimelist.net, com cache em anime_db/_mal_direto.
        self.jikan = JikanOuMal(
            JikanClient(marca_fora=self.cache_root / "_mal_direto" / "jikan-fora.json"),
            MalDireto(self.cache_root / "_mal_direto"),
        )
        self.kitsu = KitsuClient()
        self.danbooru = DanbooruClient()
        # [recap] A1: achar o anime em tres fontes sem o Jikan (busca_anime.py).
        self.busca = BuscaDeAnime(
            self.cache_root / "_busca", self.anilist, self.jikan.mal, self.kitsu, jikan=self.jikan
        )
        # Problemas de fonte na ÚLTIMA resolve() (ex.: MyAnimeList fora do
        # ar). O pipeline lê isto pra avisar o usuário — "tenta de novo mais
        # tarde" só é um bom conselho quando a gente CONFIRMA que foi a fonte.
        self.source_warnings: list[str] = []
        #: [recap] {nome local: nome online} do ultimo juntar_banco_local.
        self.ultimo_juntado: dict[str, str] = {}

    def close(self) -> None:
        self.anilist.close()
        self.jikan.close()
        self.kitsu.close()
        self.danbooru.close()

    def _cache_id(self, anilist_id: int | None, mal_id: int | None) -> str:
        if anilist_id:
            return f"al{anilist_id}"
        if mal_id:
            return f"mal{mal_id}"
        return "unknown"

    def _collect_franchise(
        self,
        primary_anilist_id: int,
        on_status: Callable[[str], None] | None,
        max_nodes: int = 25,
    ) -> list[AniListRelation]:
        """Full BFS of the AniList relation graph, following franchise edges
        in both directions (sequels + prequels). Returns all related anime.
        Capped at `max_nodes` to protect against pathological graphs.
        """
        seen: set[int] = {primary_anilist_id}
        collected: list[AniListRelation] = []

        frontier: list[int] = [primary_anilist_id]
        while frontier and len(seen) < max_nodes:
            next_frontier: list[int] = []
            for node_id in frontier:
                try:
                    rels = self.anilist.get_relations(node_id)
                except Exception:
                    continue
                for r in rels:
                    if r.relation_type not in _FRANCHISE_RELATIONS:
                        continue
                    if r.anilist_id in seen:
                        continue
                    seen.add(r.anilist_id)
                    collected.append(r)
                    next_frontier.append(r.anilist_id)
                    if len(seen) >= max_nodes:
                        break
                if len(seen) >= max_nodes:
                    break
            frontier = next_frontier

        if on_status and collected:
            on_status(f"Franquia: {len(collected) + 1} temporadas/entradas relacionadas.")
        return collected

    def _meta_path(self, cache_id: str) -> Path:
        # Resolve '<title> [al<id>]' folder if it already exists, else new path
        suffix = f"[{cache_id}]"
        if self.cache_root.exists():
            for p in self.cache_root.iterdir():
                if p.is_dir() and p.name.endswith(suffix):
                    return p / "metadata.json"
        return self.cache_root / cache_id / "metadata.json"

    def load_cached(self, cache_id: str) -> AnimeBundle | None:
        p = self._meta_path(cache_id)
        if not p.exists():
            return None
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if int(data.get("version", 1)) < METADATA_VERSION:
                return None  # schema changed, force rebuild
            chars = [CharacterRef(**c) for c in data["characters"]]
            return AnimeBundle(
                anilist_id=data.get("anilist_id"),
                mal_id=data.get("mal_id"),
                title=data["title"],
                title_english=data.get("title_english"),
                characters=chars,
                franchise_ids=data.get("franchise_ids"),
                franchise_root_id=data.get("franchise_root_id"),
                partial=bool(data.get("partial", False)),
                missing_gallery=data.get("missing_gallery") or [],
                fetched_at=data.get("fetched_at"),
                # [recap] A1: banco sem id da AniList nem do MAL (Kitsu, local):
                # a pasta e a do proprio cache_id.
                cache_id_override=(
                    cache_id if not (data.get("anilist_id") or data.get("mal_id") or data.get("franchise_root_id")) else None
                ),
            )
        except Exception:
            return None

    def save_cache(self, cache_id: str, bundle: AnimeBundle) -> None:
        # Prefer the '<title> [al<id>]' folder name so users can browse
        # cache/anime_db/ and actually tell which anime is which.
        p = self._meta_path(cache_id)
        if not p.parent.exists():
            from ..storage.organizer import sanitize
            safe_title = sanitize(bundle.title or cache_id)
            p = self.cache_root / f"{safe_title} [{cache_id}]" / "metadata.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": METADATA_VERSION,
            "anilist_id": bundle.anilist_id,
            "mal_id": bundle.mal_id,
            "title": bundle.title,
            "title_english": bundle.title_english,
            "franchise_ids": bundle.franchise_ids,
            "franchise_root_id": bundle.franchise_root_id,
            "partial": bundle.partial,
            "missing_gallery": bundle.missing_gallery or [],
            "fetched_at": bundle.fetched_at or _agora(),
            "characters": [asdict(c) for c in bundle.characters],
        }
        p.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    # ------------------------------------------------------------------
    # Atalho nome -> cache_id
    #
    # O cache do elenco é chaveado pelo id da FRANQUIA, que só se descobre
    # depois de consultar a AniList. Isso tinha duas consequências ruins:
    # toda análise pagava a busca online mesmo com o banco pronto no disco, e
    # com a AniList fora do ar o app não achava nem o próprio cache — dizia
    # "anime não encontrado" tendo 80 personagens guardados aqui do lado.
    #
    # Este índice guarda o que a busca já respondeu uma vez. É só um atalho:
    # se apontar pra um banco que não existe mais, o caminho normal roda.
    # ------------------------------------------------------------------
    def _atalho_path(self) -> Path:
        return self.cache_root / "busca_resolvida.json"

    @staticmethod
    def _atalho_chave(anime_name: str, season: int) -> str:
        return f"{re.sub(r'[^a-z0-9]+', ' ', anime_name.lower()).strip()}|s{season}"

    def _atalho_ler(self, anime_name: str, season: int) -> str | None:
        """O banco já baixado deste nome, quando ele existe no disco.

        A chave exata primeiro; depois o mesmo casamento tolerante que decide
        a pasta (`resolver_franquia`), porque as duas memórias saem do MESMO
        arquivo e discordar entre elas é como o episódio ia parar numa pasta
        e o banco de personagens em outra. É o que faz "Mushoku Tensei
        Jobless Reincarnation" reaproveitar o banco de "Mushoku Tensei" — e
        o que mantém a análise de pé com a fonte fora do ar.
        """
        try:
            dados = json.loads(self._atalho_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        valor = dados.get(self._atalho_chave(anime_name, season))
        if isinstance(valor, str) and valor:
            return valor
        return resolver_franquia(dados, anime_name, season) or None

    def _atalho_gravar(self, anime_name: str, season: int, cache_id: str) -> None:
        caminho = self._atalho_path()
        try:
            dados = json.loads(caminho.read_text(encoding="utf-8"))
            if not isinstance(dados, dict):
                dados = {}
        except (OSError, ValueError):
            dados = {}
        dados[self._atalho_chave(anime_name, season)] = cache_id
        try:
            caminho.write_text(
                json.dumps(dados, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except OSError:
            pass  # atalho é conveniência: falhar aqui não pode parar a análise

    def esquecer_atalho(self, anime_name: str, season: int) -> None:
        """[recap] A1: tira nome -> banco do atalho (a pessoa escolheu outro anime
        no "Buscar elenco"). A proxima resolucao passa pela escolha."""
        caminho = self._atalho_path()
        try:
            dados = json.loads(caminho.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if not isinstance(dados, dict) or self._atalho_chave(anime_name, season) not in dados:
            return
        dados.pop(self._atalho_chave(anime_name, season), None)
        try:
            caminho.write_text(json.dumps(dados, indent=2, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

    def _completar_galerias(
        self,
        cache_id: str,
        bundle: AnimeBundle,
        status: Callable[[str], None],
    ) -> AnimeBundle:
        """Tenta buscar SÓ as galerias que faltaram numa rodada anterior.

        É o que torna o cache parcial honesto: em vez de congelar um banco
        capenga, cada análise seguinte cobra o troco da fonte — mas pagando
        por 3 personagens, não pelos 80. Se o MyAnimeList continuar fora, o
        disjuntor corta na quinta falha e a rodada custa segundos.
        """
        faltando = list(bundle.missing_gallery or [])
        if not faltando:
            return bundle

        # Trégua. Sem ela, com a fonte fora do ar o dia inteiro, TODA análise
        # gastava ~30s tentando os mesmos personagens até o disjuntor cortar.
        # Uma tentativa a cada 6h é o suficiente pra se curar sozinho sem
        # cobrar pedágio de quem está analisando uma temporada em sequência.
        if not _mais_velho_que(bundle.fetched_at, horas=6):
            status(
                f"{len(faltando)} galerias ainda faltam, mas a fonte foi "
                "testada há pouco — tentando de novo mais tarde."
            )
            return bundle

        status(f"Completando {len(faltando)} galerias que faltaram antes...")
        por_mal = {c.mal_id: c for c in bundle.characters if c.mal_id is not None}
        ainda_faltam: list[int] = []
        recuperados = 0
        for mal_id in faltando:
            ch = por_mal.get(mal_id)
            if ch is None:
                continue  # sumiu do elenco: não é mais dívida
            antes = self.jikan.failures
            pics = self.jikan.character_pictures(mal_id)
            if self.jikan.failures > antes:
                ainda_faltam.append(mal_id)
                continue
            novas = [u for u in pics if u not in ch.image_urls]
            if novas:
                # Galeria na FRENTE dos retratos oficiais: é a ordem que o
                # resto do pipeline já espera.
                ch.image_urls[:0] = novas
                recuperados += 1

        bundle.missing_gallery = ainda_faltam
        bundle.partial = bool(ainda_faltam)
        # Renova o carimbo mesmo quando não recuperou nada: é ele que marca
        # o início da trégua. Sem isso a próxima análise tentaria na hora.
        bundle.fetched_at = _agora()
        self.save_cache(cache_id, bundle)
        status(
            f"Completado: +{recuperados} galerias"
            + (f", {len(ainda_faltam)} ainda faltando." if ainda_faltam else ", banco completo.")
        )
        return bundle

    # ------------------------------------------------------------------
    # [recap] A1: o candidato da busca vira o anime do resto do fluxo, e os
    # nomes batizados num banco LOCAL entram no banco online.
    # ------------------------------------------------------------------
    def _anime_do_candidato(
        self, cand: Candidato, status: Callable[[str], None]
    ) -> tuple[AniListAnime | None, int | None]:
        """(anime, kitsu_id quando SO a Kitsu conhece o anime).

        Achado no MAL ou na Kitsu: o id da AniList vem pelo id do MAL (um
        pedido, sem ambiguidade) -- e com ele o agrupamento de temporadas."""
        al_id, mal_id, kitsu_id = cand.anilist_id, cand.mal_id, cand.kitsu_id
        titulo, ingles, capa = cand.titulo, cand.titulo_ingles, cand.capa
        if al_id is None and mal_id is None and kitsu_id:
            try:
                mal_id = self.kitsu.mal_id_do_anime(kitsu_id)
            except Exception:  # noqa: BLE001 -- a Kitsu e reserva
                mal_id = None
        if al_id is None and mal_id is not None:
            try:
                al = self.anilist.get_by_mal_id(mal_id)
            except Exception:  # noqa: BLE001 -- AniList fora: segue so com o MAL
                al = None
            if al is not None:
                al_id = al.anilist_id
                titulo = al.titulo or titulo
                ingles = al.titulo_ingles or ingles
                capa = capa or al.capa
                status(f"AniList pelo id do MyAnimeList: {titulo}")
        if al_id is None and mal_id is None and not kitsu_id:
            return None, None
        anime = AniListAnime(id=al_id or 0, mal_id=mal_id, title=titulo, title_english=ingles, cover=capa)
        return anime, (kitsu_id if (al_id is None and mal_id is None) else None)

    def _bundle_da_kitsu(
        self, kitsu_id: int | None, title: str, title_en: str | None, max_characters: int
    ) -> AnimeBundle:
        chars: list[tuple[str, str | None]] = []
        if kitsu_id:
            try:
                chars = self.kitsu.characters_by_kitsu_id(int(kitsu_id))
            except Exception:  # noqa: BLE001
                chars = []
        vistos: set[str] = set()
        resolved: list[CharacterRef] = []
        for nome, img in chars:
            if not nome or nome.lower() in vistos:
                continue
            vistos.add(nome.lower())
            resolved.append(CharacterRef(mal_id=None, anilist_id=None, name=nome, role="Supporting",
                                         image_urls=[img] if img else []))
            if len(resolved) >= max_characters:
                break
        return AnimeBundle(
            anilist_id=None, mal_id=None, title=title, title_english=title_en,
            characters=resolved, cache_id_override=f"kitsu{kitsu_id}",
        )

    def _pasta_do_banco(self, cache_id: str) -> Path:
        return self._meta_path(cache_id).parent

    def juntar_banco_local(
        self,
        anime_name: str,
        cache_id: str,
        bundle: AnimeBundle,
        status: Callable[[str], None] | None = None,
    ) -> dict[str, str]:
        """Os nomes que ele batizou no banco LOCAL deste nome (o Reconhecer na mao
        com o anime nao achado online: anime_db/local-<nome>/characters/<nome>/)
        entram no banco ONLINE do anime, com as fotos dele.

        - nome que e o mesmo de um personagem oficial (mesmas palavras, ou
          contido em UM nome so: naming.find_token_match) -> as fotos vao para a
          pasta do oficial, como batismo_<arquivo> (a grafia oficial vence);
        - nome que nao bate -> uma pasta com o nome dele no banco online (a
          analise ja le pastas locais fora do elenco: _local_only_characters).

        NUNCA apaga nem move: o banco local fica como esta. Copia so o que falta
        (pode rodar em toda analise). Devolve {nome local: nome no banco online}.
        """
        self.ultimo_juntado = {}
        if not cache_id or cache_id.startswith("local-"):
            return {}
        origem = self._pasta_do_banco(local_cache_id(anime_name)) / "characters"
        if not origem.is_dir():
            return {}
        import shutil

        from ..naming import find_token_match
        from ..references.reference_store import ReferenceStore

        store = ReferenceStore(self.cache_root.parent)
        oficiais = [c.name for c in bundle.characters]
        mapa: dict[str, str] = {}
        copiadas = 0
        try:
            pastas = sorted(origem.iterdir())
        except OSError:
            return {}
        for d in pastas:
            if not d.is_dir() or d.name.startswith("_"):
                continue
            alvo = find_token_match(d.name, oficiais) or d.name
            destino = store.character_dir(cache_id, alvo)
            for f in sorted(d.iterdir()):
                if not f.is_file() or f.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                    continue
                novo = destino / f"batismo_{f.name}"
                if novo.exists():
                    continue
                try:
                    destino.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, novo)
                    copiadas += 1
                except OSError:
                    continue
            mapa[d.name] = alvo
        if mapa:
            marca = self._pasta_do_banco(cache_id) / "juntado_do_local.json"
            try:
                marca.parent.mkdir(parents=True, exist_ok=True)
                marca.write_text(
                    json.dumps({"de": local_cache_id(anime_name), "nomes": mapa, "quando": _agora()},
                               indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
            except OSError:
                pass
            if status and copiadas:
                status(f"Nomes batizados juntados ao elenco: {', '.join(sorted(set(mapa.values())))}")
        self.ultimo_juntado = mapa
        return mapa

    def resolve(
        self,
        anime_name: str,
        max_characters: int,
        images_per_character: int,
        on_status: Callable[[str], None] | None = None,
        use_danbooru: bool = False,
        season: int = 1,
        gallery_for_top: int | None = None,
    ) -> AnimeBundle:
        """`gallery_for_top`: quantos personagens (os primeiros da ordem por
        papel, ou seja, os principais) recebem a galeria de fotos do MAL.
        None = todos, o comportamento antigo."""
        def status(msg: str) -> None:
            if on_status:
                on_status(msg)

        # Atalho: este nome + temporada já foi resolvido antes? Então o banco
        # está no disco e não há por que consultar ninguém.
        atalho = self._atalho_ler(anime_name, season)
        # [recap] A1: o anime ESCOLHIDO no "Buscar elenco" ganha do atalho
        # quando os dois discordam (o atalho e um palpite pelo nome).
        escolha = self.busca.escolha_guardada(anime_name, season)
        if atalho:
            guardado = self.load_cached(atalho)
            if guardado is not None and guardado.characters and (
                escolha is None or _bate_com_escolha(guardado, escolha)
            ):
                status(
                    f"Banco já conhecido deste anime "
                    f"({len(guardado.characters)} personagens)."
                )
                self.juntar_banco_local(anime_name, atalho, guardado, status)
                return self._completar_galerias(atalho, guardado, status)

        # [recap] A1: a busca nas TRES fontes (AniList, o site do MyAnimeList
        # sem o Jikan, Kitsu), encurtando o nome e ficando com o titulo mais
        # parecido (busca_anime.py). Antes: so a AniList com o nome inteiro (e
        # 3 cortes do fim) e o Jikan de reserva -- o Magic Repo Man nao era
        # achado em nenhuma e o Reconhecer na mao vinha sem nome nenhum.
        anime: AniListAnime | None = None
        used_query: str | None = None
        anilist_error: Exception | None = None
        candidato = self.busca.resolver(anime_name, season, status)
        if self.busca.erros.get("anilist"):
            anilist_error = RuntimeError(self.busca.erros["anilist"])
        kitsu_id_so: int | None = None
        if candidato is not None:
            anime, kitsu_id_so = self._anime_do_candidato(candidato, status)
            used_query = candidato.titulo

        if anime is None:
            # Última cartada: banco LOCAL criado pelo Modo Descoberta
            # numa análise anterior deste mesmo anime.
            local = self.load_cached(local_cache_id(anime_name))
            if local is not None and local.characters:
                status(
                    f"Usando banco local descoberto "
                    f"({len(local.characters)} personagens batizados)."
                )
                local.cache_id_override = local_cache_id(anime_name)
                return local
            # "Confira o nome que você digitou" é conselho ruim quando
            # o problema é a fonte estar fora do ar — e as duas caem
            # juntas mais do que parece (set/2026: a AniList desligou a
            # API e o MyAnimeList devolvia 504). Dizer QUAL delas falhou
            # é o que separa "erro meu" de "espera passar".
            fora = []
            if anilist_error is not None:
                fora.append(str(anilist_error).rstrip("."))
            if self.busca.erros.get("mal"):
                fora.append("MyAnimeList não respondeu")
            fonte_fora = (
                "\n\n⚠️ Detalhe importante: "
                + "; ".join(fora)
                + ". Pode ser instabilidade da fonte, não o nome que "
                "você digitou — vale tentar de novo mais tarde."
                if fora
                else ""
            )
            raise AnimeNotFoundError(
                f"Anime '{anime_name}' não foi encontrado na AniList, no "
                "MyAnimeList nem na Kitsu. Use o 'Buscar elenco' para escolher "
                "o anime — ou o Modo Descoberta pra identificar os "
                "personagens pelo próprio episódio." + fonte_fora
            )
        if used_query and used_query != anime_name:
            status(f"Resolvido: '{anime_name}' -> {anime.title}")
        anilist_id = anime.id if anime.id else None
        mal_id = anime.mal_id
        title = anime.title
        title_en = anime.title_english

        cache_id = self._cache_id(anilist_id, mal_id) if (anilist_id or mal_id) else f"kitsu{kitsu_id_so}"
        cached = self.load_cached(cache_id)
        if cached is not None and cached.characters:
            status(f"Reusando banco cacheado ({len(cached.characters)} personagens).")
            self._atalho_gravar(anime_name, season, cache_id)
            self.juntar_banco_local(anime_name, cache_id, cached, status)
            return self._completar_galerias(cache_id, cached, status)

        if mal_id is None and anilist_id is None:
            # [recap] A1: so a Kitsu conhece este anime. O elenco vem dela.
            bundle = self._bundle_da_kitsu(kitsu_id_so, title, title_en, max_characters)
            if not bundle.characters:
                raise AnimeNotFoundError(
                    f"'{title}' foi achado na Kitsu, mas sem elenco cadastrado. "
                    "Use o Modo Descoberta pra identificar os personagens."
                )
            bundle.fetched_at = _agora()
            self.save_cache(cache_id, bundle)
            self._atalho_gravar(anime_name, season, cache_id)
            self.juntar_banco_local(anime_name, cache_id, bundle, status)
            return bundle

        # 1) Traverse the franchise graph so we pool characters from all
        # related seasons (Dr. Stone S4 alone has almost no refs on MAL;
        # S1/S2 have tons). Requires an AniList id — Jikan doesn't expose
        # relations in the search endpoint, so a Jikan-only fallback stays
        # single-season.
        if anilist_id is not None:
            status("Mapeando temporadas relacionadas...")
            relations = self._collect_franchise(anilist_id, on_status=status)
            # [recap] A1: anime so da AniList (sem id do MAL) entra sem o MAL.
            franchise_mal_ids = [m for m in [mal_id, *(r.mal_id for r in relations)] if m]
            franchise_anilist_ids = sorted({anilist_id, *(r.anilist_id for r in relations)})
            # Use the smallest AniList id as the franchise root — for long-running
            # series that's usually the earliest aired / canonical root.
            root_id = min(franchise_anilist_ids) if franchise_anilist_ids else anilist_id
            cache_id = f"al{root_id}"
        else:
            # Jikan-only fallback: no franchise pooling, just this MAL id.
            status("Modo MyAnimeList — sem agrupamento de temporadas.")
            relations = []
            franchise_mal_ids = [mal_id]
            franchise_anilist_ids: list[int] = []
            root_id = None
            cache_id = f"mal{mal_id}"
        # [Studio] O MAL id da RAIZ da franquia, para a reserva da Kitsu (2c).
        root_mal_id = mal_id if root_id in (None, anilist_id) else next(
            (r.mal_id for r in relations if r.anilist_id == root_id), None
        )

        cached = self.load_cached(cache_id)
        if cached is not None and cached.characters:
            status(f"Reusando banco cacheado ({len(cached.characters)} personagens).")
            self._atalho_gravar(anime_name, season, cache_id)
            self.juntar_banco_local(anime_name, cache_id, cached, status)
            return self._completar_galerias(cache_id, cached, status)

        status(f"Baixando personagens de {max(1, len(franchise_mal_ids))} temporada(s)...")
        self.source_warnings = []
        fails_start = self.jikan.failures

        # 2) Collect characters from every season, merge by name.
        merged: dict[str, dict] = {}     # key = lowercase name
        for m_id in franchise_mal_ids:
            try:
                season_chars = self.jikan.anime_characters(m_id)
            except Exception:
                continue
            for jc in season_chars:
                key = jc.name.lower().strip()
                if key not in merged:
                    merged[key] = {
                        "mal_id": jc.mal_id,
                        "name": jc.name,
                        "role": jc.role,
                        "image": jc.image,
                        "source_mal_ids": {m_id},
                    }
                else:
                    merged[key]["source_mal_ids"].add(m_id)
                    # Prefer a "Main" role if any season says so.
                    if _ROLE_WEIGHT.get(jc.role, 3) < _ROLE_WEIGHT.get(merged[key]["role"], 3):
                        merged[key]["role"] = jc.role

        cast_fails = self.jikan.failures - fails_start
        if cast_fails:
            self.source_warnings.append(
                f"O MyAnimeList não respondeu em {cast_fails} de "
                f"{len(franchise_mal_ids)} consulta(s) de elenco (erro de servidor)."
            )
        elif merged:
            # Confirmação explícita de fonte: dá pra ver no log/status que o
            # elenco veio MESMO do MyAnimeList (e não só das reservas).
            status(f"MyAnimeList OK: {len(merged)} personagens da franquia.")

        # 2b) AniList também tem o elenco com foto — reserva completa quando o
        # MyAnimeList está fora do ar (dias inteiros de 504 em jul/2026) e
        # fonte EXTRA de fotos quando não está.
        al_chars: list = []
        if anilist_id is not None:
            try:
                al_chars = self.anilist.get_characters(root_id or anilist_id)
            except Exception:
                pass
        if al_chars and merged:
            # Enriquecer: casa por tokens do nome (formatos diferem entre as
            # fontes) e anexa a foto da AniList como referência extra.
            by_tokens = {_name_tokens(c["name"]): k for k, c in merged.items()}
            enriched = 0
            for ac in al_chars:
                k = by_tokens.get(_name_tokens(ac.name))
                if k is not None and ac.image:
                    merged[k]["anilist_image"] = ac.image
                    enriched += 1
            if enriched:
                status(f"AniList: +1 foto pra {enriched} personagens.")
        elif al_chars and not merged:
            # Reserva total: o elenco inteiro vem da AniList (1 foto por
            # personagem). Somado ao retrato da Kitsu logo abaixo, chega nas
            # 2 fotos mínimas — a análise roda mesmo com o MAL fora do ar.
            for ac in al_chars[:max_characters]:
                merged[ac.name.lower().strip()] = {
                    "mal_id": None,
                    "name": ac.name,
                    "role": ac.role,
                    "image": ac.image,
                    "anilist_image": ac.image,
                    "source_mal_ids": set(),
                }
            status(
                f"⚠️ Elenco veio da reserva (AniList, {len(merged)} personagens) — "
                "o MyAnimeList está fora do ar."
            )

        # 2c) Kitsu — retrato extra por personagem, achado direto pelo id do
        # MAL (endpoint de mapeamento — sem busca por nome, sem ambiguidade).
        kitsu_chars: list[tuple[str, str | None]] = []
        if mal_id is not None:
            try:
                kitsu_chars = self.kitsu.characters_by_mal_id(mal_id)
            except Exception:
                kitsu_chars = []
        # [Studio] A Kitsu parou de cadastrar elenco por volta de 2020: a
        # temporada nova de franquia velha volta vazia (medido em out/2026:
        # Re:Zero 3a e Slime 3a = 0; as 1as temporadas = 50 e 11). O elenco
        # da AniList (2b) ja vem da RAIZ, entao a raiz e o par certo dele.
        if not kitsu_chars and root_mal_id and root_mal_id != mal_id:
            try:
                kitsu_chars = self.kitsu.characters_by_mal_id(root_mal_id)
            except Exception:
                kitsu_chars = []
        if kitsu_chars and merged:
            by_tokens_k = {_name_tokens(c["name"]): k for k, c in merged.items()}
            enriched_k = 0
            for kname, kimg in kitsu_chars:
                if not kimg:
                    continue
                k = by_tokens_k.get(_name_tokens(kname))
                if k is not None and not merged[k].get("kitsu_image"):
                    merged[k]["kitsu_image"] = kimg
                    enriched_k += 1
            if enriched_k:
                status(f"Kitsu: +1 foto pra {enriched_k} personagens.")
        elif kitsu_chars and not merged:
            # AniList e MAL fora do ar ao mesmo tempo: última reserva.
            for kname, kimg in kitsu_chars[:max_characters]:
                merged[kname.lower().strip()] = {
                    "mal_id": None,
                    "name": kname,
                    "role": "Supporting",
                    "image": kimg,
                    "kitsu_image": kimg,
                    "source_mal_ids": set(),
                }
            if merged:
                status(
                    f"⚠️ Elenco veio da Kitsu ({len(merged)} personagens) — "
                    "MyAnimeList e AniList indisponíveis."
                )

        # Sort main first then supporting, cap at max_characters.
        sorted_chars = sorted(
            merged.values(), key=lambda c: (_ROLE_WEIGHT.get(c["role"], 3), c["name"])
        )[:max_characters]

        # Só os N primeiros (= principais, pela ordenação por papel) ganham a
        # galeria do MAL. É UMA chamada de API por personagem, com rate-limit
        # entre elas: num elenco de 80 isso sozinho custava ~10 minutos, 44%
        # da análise inteira. Os demais seguem com os retratos oficiais
        # (MAL + AniList + Kitsu, até 3 imagens), que são adicionados abaixo
        # pra todo mundo.
        gallery_limit = len(sorted_chars) if gallery_for_top is None else max(0, gallery_for_top)
        if gallery_limit < len(sorted_chars):
            status(
                f"Galeria completa para os {gallery_limit} principais; "
                f"os outros {len(sorted_chars) - gallery_limit} usam os "
                "retratos oficiais."
            )

        resolved: list[CharacterRef] = []
        sem_galeria: list[int] = []
        kitsu_por_nome = 0  # [Studio]
        for i, ch in enumerate(sorted_chars, 1):
            status(f"Coletando imagens ({i}/{len(sorted_chars)}): {ch['name']}")

            # 1. Jikan — pictures for this character's MAL id. A character has
            # one canonical MAL id even if they appear in many seasons, so one
            # call is enough. (mal_id é None quando o personagem veio da
            # reserva AniList — sem galeria do MAL pra buscar.)
            jikan_urls: list[str] = []
            if ch["mal_id"] is not None and i <= gallery_limit:
                antes = self.jikan.failures
                pics = self.jikan.character_pictures(ch["mal_id"])
                if self.jikan.failures > antes:
                    # Falhou (não é "esse personagem não tem foto"): anota pra
                    # próxima rodada tentar SÓ estes, em vez de tudo de novo.
                    sem_galeria.append(ch["mal_id"])
                for u in pics:
                    if u not in jikan_urls:
                        jikan_urls.append(u)

            # 2. Danbooru (optional, collages can contaminate centroids).
            dbooru_urls: list[str] = []
            if use_danbooru:
                series_variants = [t for t in (title, title_en) if t]
                tag_candidates = character_tag_candidates(ch["name"], *series_variants)
                dbooru_urls, matched_tag = self.danbooru.fetch_image_urls(
                    tag_candidates, limit=images_per_character
                )
                if matched_tag:
                    status(f"  Danbooru ✓ ({ch['name']} -> {matched_tag}, {len(dbooru_urls)} imgs)")

            urls: list[str] = []
            for u in jikan_urls + dbooru_urls:
                if u not in urls:
                    urls.append(u)
            # Retratos oficiais sempre entram (MAL, AniList, Kitsu): são 3
            # fotos garantidas por personagem mesmo com as galerias do MAL
            # fora do ar — acima do mínimo da análise. O dedup por URL evita
            # repetição quando a galeria já contém o retrato.
            for extra_img in (
                ch.get("image"),
                ch.get("anilist_image"),
                ch.get("kitsu_image"),
            ):
                if extra_img and extra_img not in urls:
                    urls.append(extra_img)
            # [Studio] Kitsu por NOME, reserva do 2o retrato: o MAL nao deu
            # galeria (anime novo, personagem fora dos principais) e a Kitsu
            # nao tem o elenco deste anime. So o personagem com o mesmo MAL id.
            if len(urls) < 2 and not ch.get("kitsu_image"):
                kimg = self.kitsu.retrato_por_nome(ch["name"], ch["mal_id"])
                if kimg and kimg not in urls:
                    urls.append(kimg)
                    kitsu_por_nome += 1

            resolved.append(
                CharacterRef(
                    mal_id=ch["mal_id"],
                    anilist_id=None,
                    name=ch["name"],
                    role=ch["role"],
                    image_urls=urls,
                )
            )

        if kitsu_por_nome:  # [Studio]
            status(f"Kitsu (por nome): +1 foto pra {kitsu_por_nome} personagens.")
        if self.jikan.pelo_mal:  # [Studio]
            status(f"MyAnimeList direto: {self.jikan.pelo_mal} leituras (Jikan fora do ar).")

        # O denominador é quantos personagens REALMENTE pediram galeria — com
        # o limite dos principais, comparar com o elenco inteiro nunca
        # dispararia o aviso (metade de 80 nunca é atingida pedindo só 18).
        attempted = min(gallery_limit, len(sorted_chars))
        pic_fails = self.jikan.failures - fails_start - cast_fails
        if pic_fails and attempted and pic_fails >= max(1, attempted // 2):
            self.source_warnings.append(
                f"As galerias de fotos do MyAnimeList falharam em {pic_fails} de "
                f"{attempted} personagens (erro de servidor)."
            )

        bundle = AnimeBundle(
            anilist_id=anilist_id,
            mal_id=mal_id,
            title=title,
            title_english=title_en,
            characters=resolved,
            franchise_ids=franchise_anilist_ids,
            franchise_root_id=root_id,
        )
        # Banco montado com a fonte fora do ar é DEGRADADO. Antes ele era
        # simplesmente DESCARTADO, pra não congelar o estrago — mas isso
        # cobrava a busca inteira (140s medidos) em TODA análise seguinte
        # enquanto o MyAnimeList estivesse instável, que é justamente quando
        # ele mais cai. Agora é guardado marcado como parcial, com a lista de
        # quem ficou sem galeria: a próxima rodada reusa o que já tem e tenta
        # SÓ o que falta.
        bundle.partial = bool(sem_galeria) or self.jikan.failures != fails_start
        bundle.missing_gallery = sem_galeria
        bundle.fetched_at = _agora()
        self.save_cache(cache_id, bundle)
        self._atalho_gravar(anime_name, season, cache_id)
        self.juntar_banco_local(anime_name, cache_id, bundle, status)
        if bundle.partial:
            status(
                f"Banco salvo PARCIAL: {len(sem_galeria)} personagens sem "
                "galeria (fonte instável). A próxima análise reusa o resto e "
                "tenta só esses."
            )
        return bundle
