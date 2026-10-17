"""Executa o pipeline sem interface, falando JSON-lines no stdout.

É o backend do AnCut HUB em Electron: o processo Electron sobe este módulo
como processo filho, manda a requisição e lê os eventos conforme saem.

Protocolo
---------
stdout  → um objeto JSON por linha (ver `_emit`). NADA além disso.
stderr  → log humano (os prints do pipeline são redirecionados pra cá).
stdin   → comandos JSON-line do host; hoje só ``{"cmd": "cancel"}``.

Uso:
    python -m app.headless run        (requisição JSON pelo stdin, 1ª linha)
    python -m app.headless probe      (info de ambiente: versão, GPU)
    python -m app.headless rostos     ([Studio] rostos em lote, ver app/rostos.py)

Por que stdout é sagrado: o pipeline inteiro usa `print()` pra log. Se um
print vazar no canal de eventos, o JSON quebra no meio e o host perde o
stream. Por isso a primeira coisa que `main()` faz é sequestrar o stdout.
"""
from __future__ import annotations

import json
import queue
import sys
import threading
import traceback
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Canal de eventos. Capturado ANTES de qualquer import pesado, porque alguns
# módulos imprimem já no import.
#
# No build do PyInstaller com `console=False` o Python pode entregar
# sys.stdout/sys.stderr como None — não há console. Como o host nos dá pipes
# de verdade, abrimos os descritores 1 e 2 na mão nesse caso. Sem isto o
# backend funcionaria em dev e morreria calado no app empacotado.
# ---------------------------------------------------------------------------
def _fd_stream(fd: int, fallback_devnull: bool = True):
    import io
    import os

    try:
        return io.TextIOWrapper(
            io.FileIO(fd, "w", closefd=False), encoding="utf-8", errors="replace"
        )
    except Exception:
        if not fallback_devnull:
            raise
        return open(os.devnull, "w", encoding="utf-8")


_CHANNEL = sys.stdout if sys.stdout is not None else _fd_stream(1)
# Todo print() do pipeline vira log (stderr), nunca evento.
sys.stdout = sys.stderr if sys.stderr is not None else _fd_stream(2)

# Os eventos já vão em ASCII puro (ver _emit), mas os LOGS não passam pelo
# json — um print com acento sairia em cp1252 no log do host. Aqui não dá
# pra confiar em PYTHONIOENCODING: o executável do PyInstaller nem sempre
# lê essa variável.
for _stream in (_CHANNEL, sys.stdout):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError, ValueError):
        pass

_write_lock = threading.Lock()


def _emit(payload: dict[str, Any]) -> None:
    """Escreve um evento no canal. Thread-safe e sempre com flush — o host
    lê linha a linha e um buffer preso faria a barra de progresso travar."""
    # ensure_ascii=True (o padrão) NÃO é preguiça: com ele o acento vai como
    # á e o canal inteiro vira ASCII puro, imune à codificação com que o
    # Python abriu a saída. Com ensure_ascii=False, "análise" saía em cp1252
    # (`61 6E E1`) enquanto o host lia UTF-8, e todo acento chegava na tela
    # como losango. O JSON.parse do outro lado devolve o "á" intacto.
    line = json.dumps(payload, default=str)
    with _write_lock:
        _CHANNEL.write(line + "\n")
        _CHANNEL.flush()


class _Cancelled(Exception):
    """Cancelamento pedido pelo host."""


class _CancelFlag:
    """Sinalizador setado pela thread que lê o stdin."""

    def __init__(self) -> None:
        self._flag = threading.Event()

    def set(self) -> None:
        self._flag.set()

    @property
    def requested(self) -> bool:
        return self._flag.is_set()


def _stdin_is_pipe() -> bool:
    """True quando o stdin é um pipe (o caso do host Electron), False quando
    é arquivo redirecionado ou terminal.

    Isto decide se o fim do stdin significa "o host morreu". Num pipe, sim:
    a ponta de escrita sumiu junto com o processo pai. Num arquivo, EOF é só
    o fim do arquivo — tratar isso como cancelamento fazia toda execução de
    teste morrer na largada.
    """
    import os
    import stat

    try:
        return stat.S_ISFIFO(os.fstat(_STDIN_FD).st_mode)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Leitura de stdin pelo descritor cru.
#
# NUNCA use sys.stdin aqui. Uma thread bloqueada em `sys.stdin.readline()`
# segura o lock interno do TextIOWrapper, e algo na cadeia de import de
# app.pipeline toca sys.stdin — o import trava pra sempre. O sintoma é
# cruel: o processo emite o primeiro evento e simplesmente congela, sem erro
# e sem log. Medido: com a thread, o import não termina nem em 45s; sem ela,
# 4,6s. `os.read` não passa pelo wrapper, então não há lock a disputar.
# ---------------------------------------------------------------------------
_STDIN_FD = 0
_stdin_buffer = b""


def _read_line_raw() -> str | None:
    """Uma linha do fd 0, BLOQUEANTE. None em EOF ou erro.

    Só pode ser usado antes dos imports pesados, com o processo ainda
    single-thread (é o caso da leitura da requisição). Depois disso, use o
    caminho por sondagem — ver `_stdin_available`.
    """
    global _stdin_buffer
    import os

    while True:
        nl = _stdin_buffer.find(b"\n")
        if nl >= 0:
            line = _stdin_buffer[:nl]
            _stdin_buffer = _stdin_buffer[nl + 1 :]
            return line.decode("utf-8", errors="replace")
        try:
            chunk = os.read(_STDIN_FD, 65536)
        except (OSError, ValueError):
            return None
        if not chunk:  # EOF
            if _stdin_buffer:
                rest = _stdin_buffer.decode("utf-8", errors="replace")
                _stdin_buffer = b""
                return rest
            return None
        _stdin_buffer += chunk


def _stdin_available() -> int:
    """Quantos bytes dá pra ler do stdin AGORA, sem bloquear. -1 = fechado.

    Existe por causa de um deadlock do Windows: uma thread parada dentro de
    uma leitura no fd 0 trava o carregamento de DLLs nativas no processo
    inteiro. E o pipeline carrega DLL sob demanda o tempo todo (codecs, NVENC,
    kernels de CUDA), então o travamento aparecia no meio da análise, sem erro
    nem log. Medido: cortar 6 shots leva 3,2s sem a thread e NÃO TERMINA com
    ela. Sondar e só ler quando há dado mantém a thread fora do kernel.
    """
    import ctypes
    import msvcrt
    from ctypes import wintypes

    try:
        handle = msvcrt.get_osfhandle(_STDIN_FD)
    except OSError:
        return -1
    avail = wintypes.DWORD(0)
    ok = ctypes.windll.kernel32.PeekNamedPipe(
        wintypes.HANDLE(handle), None, 0, None, ctypes.byref(avail), None
    )
    if not ok:
        return -1  # pipe fechado (o host morreu)
    return int(avail.value)


def _drain_stdin_lines() -> list[str] | None:
    """Linhas completas disponíveis agora. None quando o pipe fecha."""
    global _stdin_buffer
    import os

    avail = _stdin_available()
    if avail < 0:
        return None
    if avail:
        try:
            _stdin_buffer += os.read(_STDIN_FD, avail)
        except (OSError, ValueError):
            return None

    lines: list[str] = []
    while True:
        nl = _stdin_buffer.find(b"\n")
        if nl < 0:
            break
        line = _stdin_buffer[:nl]
        _stdin_buffer = _stdin_buffer[nl + 1 :]
        lines.append(line.decode("utf-8", errors="replace"))
    return lines


def _detach_stdin() -> None:
    """Aponta sys.stdin pro devnull depois de lermos a requisição.

    Duas garantias: nada do pipeline consegue consumir bytes do nosso canal
    de comandos, e qualquer biblioteca que resolva checar ou ler stdin recebe
    um EOF imediato em vez de bloquear esperando digitação. O fd 0 continua
    sendo o pipe — quem lê dele é só o `_read_line_raw`.
    """
    import os

    try:
        sys.stdin = open(os.devnull, "r", encoding="utf-8")
    except Exception:
        pass


# Comandos que não são "cancel" vão pra esta fila. Quem lê o stdin é SÓ a
# thread `_watch_stdin` — se o fluxo do batismo lesse o descritor em paralelo,
# os dois roubariam linhas um do outro e o comando se perderia.
_commands: "queue.Queue[dict[str, Any]]" = queue.Queue()


def _watch_stdin(cancel: _CancelFlag) -> None:
    """Thread daemon: única leitora do stdin, por SONDAGEM.

    Nunca bloqueia dentro de uma leitura — ver `_stdin_available` pro porquê
    (deadlock com o carregador de DLL do Windows). Um cancelamento demora no
    máximo o intervalo da sondagem pra ser notado, o que é irrelevante perto
    dos minutos que uma análise leva.

    `cancel` é tratado na hora (precisa interromper o pipeline em voo); o
    resto vira item na fila pra quem estiver esperando.
    """
    import time

    orphan_means_cancel = _stdin_is_pipe()
    while True:
        try:
            lines = _drain_stdin_lines()
        except Exception:
            break
        if lines is None:  # pipe fechado
            break
        for raw in lines:
            raw = raw.strip()
            if not raw:
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("cmd") == "cancel":
                cancel.set()
                _commands.put({"cmd": "cancel"})
                return
            _commands.put(msg)
        time.sleep(0.15)

    # Pipe fechado = host sumiu. Não faz sentido seguir queimando GPU por uma
    # janela que não existe mais.
    if orphan_means_cancel:
        cancel.set()
        _commands.put({"cmd": "cancel"})


# ---------------------------------------------------------------------------
# probe: o que o host precisa saber antes de rodar qualquer coisa
# ---------------------------------------------------------------------------
def _probe() -> None:
    from . import __version__
    from .deps_check import cuda_available, ffmpeg_available, gpu_name

    _emit(
        {
            "type": "probe",
            "version": __version__,
            "gpuName": gpu_name() if cuda_available() else None,
            "ffmpeg": ffmpeg_available(),
            # Se a segunda opinião está de pé. Vale reportar porque ela falha
            # em SILÊNCIO de propósito (a análise segue com o CLIP sozinho), e
            # sem isto ninguém teria como saber que ela nunca entrou.
            "ccip": _ccip_pronto(),
        }
    )


def _ccip_pronto() -> bool:
    """onnxruntime carrega? (não baixa o modelo — só confere a biblioteca)"""
    try:
        import onnxruntime  # noqa: F401
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Consultas leves (sem torch) — respondem em ~0,15s, então o host pode chamar
# a cada arquivo solto na janela sem travar a interface.
# ---------------------------------------------------------------------------
def _parse(path: str) -> None:
    """Deduz anime/temporada/episódio do nome do arquivo, e devolve junto o
    OP/ED salvo pra esse anime.

    Fica aqui, e não reimplementado em TypeScript, porque a heurística tem
    dezenas de padrões e fallback pelo nome da pasta — duas cópias divergiriam
    na primeira vez que alguém corrigisse um caso e esquecesse a outra.
    """
    from .config import Config
    from .storage.skip_ranges import SkipRangesStore
    from .video_ingest import parse_filename

    info = parse_filename(path)
    head, tail = 0.0, 0.0
    try:
        store = SkipRangesStore(Config.load().cache_path)
        head, tail = store.get(info.anime)
    except Exception:
        pass

    _emit(
        {
            "type": "parsed",
            "anime": info.anime,
            "season": info.season,
            "episode": info.episode,
            "kind": info.kind,
            "skipHeadSeconds": head,
            "skipTailSeconds": tail,
        }
    )


def _backfill_episode_roots(db: Any, output_dir: Path) -> None:
    """Descobre a pasta de saída de episódios analisados ANTES da coluna
    `output_root` existir.

    Não dá pra reconstruir o caminho pelo título do banco: a pasta usa o nome
    que o usuário DIGITOU, e o banco guarda o título resolvido pela AniList
    (que costuma ser diferente — "Mushoku Tensei" vira "Mushoku Tensei III:
    Isekai Ittara Honki Dasu"). Então procuramos no disco: qualquer
    `<saída>/*/S01E41` serve, e só aceitamos quando há UMA candidata — com
    duas, adivinhar erraria em silêncio.
    """
    if not output_dir.is_dir():
        return
    with db.connect() as c:
        rows = c.execute(
            "SELECT id, season, episode, source_file FROM episode "
            "WHERE output_root IS NULL"
        ).fetchall()
        for row in rows:
            slug = f"S{int(row['season']):02d}E{int(row['episode']):02d}"
            matches = [p for p in output_dir.glob(f"*/{slug}") if (p / "metadata").is_dir()]
            if len(matches) > 1 and row["source_file"]:
                # Dois animes diferentes com o mesmo S03E01 é comum. O
                # desempate não é chute: cada pasta guarda em shot_bounds.json
                # o vídeo de onde saiu, e o banco guarda o mesmo caminho.
                exatas = [p for p in matches if _bounds_source(p) == row["source_file"]]
                if exatas:
                    matches = exatas
            if len(matches) == 1:
                c.execute(
                    "UPDATE episode SET output_root=? WHERE id=?",
                    (str(matches[0]), row["id"]),
                )


def _bounds_source(episode_root: Path) -> str | None:
    """De qual vídeo esta pasta saiu, segundo o cache de detecção de cenas."""
    import json as _json

    try:
        data = _json.loads(
            (episode_root / "metadata" / "shot_bounds.json").read_text(encoding="utf-8")
        )
    except (OSError, ValueError):
        return None
    return data.get("source") if isinstance(data, dict) else None


def _recent() -> None:
    """Episódios já analisados, pro usuário reabrir sem reprocessar."""
    from .config import Config
    from .storage.db import Database

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    try:
        _backfill_episode_roots(db, cfg.output_path)
    except Exception:
        pass  # backfill é oportunista: falhar aqui não pode derrubar a lista

    episodes = []
    # Sem limite: isto alimenta a Biblioteca, que é o acervo inteiro. Com o
    # corte de 30 que havia aqui, cada análise nova empurrava a mais antiga
    # pra fora e o episódio desaparecia da tela — intacto no disco e no banco,
    # e sem uma linha explicando. Ele tinha 41 e via 30.
    sumidas = 0
    for e in db.recent_episodes():
        root = Path(e["output_root"])
        if not root.is_dir():
            # Pasta apagada por fora: não oferece o que não abre. Mas CONTA,
            # pra a tela poder dizer que existem — desaparecer calado é o que
            # faz isto parecer perda de dado.
            sumidas += 1
            continue
        episodes.append(
            {
                "episodeId": e["id"],
                "animeTitle": e["anime_title"],
                "season": e["season"],
                "episode": e["episode"],
                "kind": e["kind"],
                "episodeRoot": str(root),
                "shotCount": e["shot_count"],
                "processedAt": e["processed_at"],
            }
        )
    _emit({"type": "recent", "episodes": episodes, "missingFolders": sumidas})


def _cut_export_mode(episode_root: str | None) -> str:
    """Modo de export gravado ao lado dos clipes. "off" quando não há marca.

    Sem marcador é análise antiga, anterior à opção — e aí "off" é a suposição
    correta, a mesma que o cortador faz.
    """
    if not episode_root:
        return "off"
    try:
        marca = (Path(episode_root) / "shots" / ".export_mode").read_text(
            encoding="utf-8"
        ).strip()
    except OSError:
        return "off"
    return marca if marca in ("off", "compat", "intra") else "off"


def _results(episode_id: int) -> None:
    """Personagens do episódio, com a contagem de cenas de cada um."""
    from .config import Config
    from .storage.db import Database

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    # Mesmo remendo do histórico: episódio sem pasta gravada não abre, e quem
    # chega aqui vindo do fim de uma análise não tem como escolher outro.
    try:
        _backfill_episode_roots(db, cfg.output_path)
    except Exception:
        pass

    with db.connect() as c:
        ep = c.execute(
            "SELECT e.id, e.season, e.episode, e.kind, e.output_root, e.anime_id, "
            "       e.source_file, "
            "       a.title AS anime_title, a.anilist_id, a.mal_id "
            "FROM episode e JOIN anime a ON a.id = e.anime_id WHERE e.id=?",
            (episode_id,),
        ).fetchone()
    if ep is None:
        _emit({"type": "failed", "message": f"episódio {episode_id} não encontrado"})
        return

    characters = []
    for ch in db.get_characters_for_anime(ep["anime_id"]):
        shots = db.shots_for_character(ch["id"], episode_id=episode_id)
        if not shots:
            continue
        characters.append(
            {"id": ch["id"], "name": ch["name"], "shotCount": len(shots)}
        )
    characters.sort(key=lambda c: -c["shotCount"])

    _emit(
        {
            "type": "results",
            "episodeId": ep["id"],
            "animeTitle": ep["anime_title"],
            "season": ep["season"],
            "episode": ep["episode"],
            "kind": ep["kind"],
            "episodeRoot": ep["output_root"],
            "totalShots": len(db.shots_for_episode(episode_id)),
            # Quantas cenas ficaram sem ninguém. Vai junto pra a lista poder
            # mostrar o número sem uma segunda ida ao motor — que custa uma
            # abertura de processo inteira.
            "untaggedShots": db.count_shots_without_character(episode_id),
            "characters": characters,
            "refsDir": _refs_dir_for(cfg, ep["anilist_id"], ep["mal_id"]),
            # Pro "identificar depois": a tela precisa do vídeo de origem e da
            # pasta EXATA em que o episódio já mora.
            #
            # A pasta vai explícita de propósito. Decidir de novo poderia
            # escolher outra (a memória de pastas mudou desde então) e o
            # episódio seria recortado num lugar novo, deixando o antigo pra
            # trás — reidentificar não é hora de reorganizar nada.
            "sourceFile": ep["source_file"] or "",
            "sourceExists": bool(
                ep["source_file"] and Path(ep["source_file"]).is_file()
            ),
            "animeFolder": (
                Path(ep["output_root"]).parent.name if ep["output_root"] else ""
            ),
            # O formato em que os clipes FORAM cortados, lido do marcador que
            # o cortador deixa ao lado deles.
            #
            # Isto é o que faz "identificar depois" ser rápido. O cortador
            # recorta TUDO quando o modo de export muda — e com razão, senão
            # ligar a opção não mudaria nada. Mas se a reidentificação mandasse
            # o modo que está na tela em vez do modo do disco, ela recortaria
            # os 360 clipes de novo e demoraria igual à análise inteira, sem
            # ninguém entender por quê.
            "cutExportMode": _cut_export_mode(ep["output_root"]),
        }
    )


def _franchise_cache_id(cfg: Any, anilist_id: int | None, mal_id: int | None) -> str | None:
    """Pasta de refs da FRANQUIA, não da temporada.

    As refs de todas as temporadas moram juntas sob o id raiz da franquia, e o
    episódio só conhece o id da própria temporada. Por isso varre os
    metadata.json procurando quem lista este anilist_id entre os da franquia —
    é o único jeito de achar a raiz partindo de uma temporada irmã.

    Portado do app Qt (results_tab._resolve_franchise_cache_id), onde já estava
    provado contra as duas convenções de nome de pasta: `al<id>` antiga e
    `<título> [al<id>]` atual.
    """
    import json as _json

    root_dir = cfg.cache_path / "anime_db"
    if not root_dir.exists():
        return None
    if anilist_id:
        for p in root_dir.glob("*/metadata.json"):
            try:
                d = _json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if anilist_id == d.get("anilist_id") or anilist_id in (d.get("franchise_ids") or []):
                root = d.get("franchise_root_id") or d.get("anilist_id")
                if root:
                    return f"al{root}"
        return f"al{anilist_id}"
    if mal_id:
        return f"mal{mal_id}"
    return None


def _refs_dir_for(cfg: Any, anilist_id: int | None, mal_id: int | None) -> str | None:
    cache_id = _franchise_cache_id(cfg, anilist_id, mal_id)
    if not cache_id:
        return None
    from .references.reference_store import resolve_anime_dir

    return str(resolve_anime_dir(cfg.cache_path, cache_id) / "characters")


#: `character_id` da lista "Sem personagem" — as cenas sem ninguém reconhecido.
#: Negativo pra não colidir com id de personagem nem com o 0 de "todas".
SEM_PERSONAGEM_ID = -2


def _shots(episode_id: int, character_id: int) -> None:
    """Cenas de um personagem, TODAS do episódio (0), ou as SEM ninguém (-2).

    A visão de todas existe pra mesclar: um corte partido no meio de uma cena
    só aparece inteiro olhando a linha do tempo, não a pasta de um personagem.
    A visão sem ninguém existe pra limpar: é onde mora o cenário — e o
    personagem que o reconhecimento deixou passar.
    """
    from .config import Config
    from .storage.db import Database

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    if character_id == SEM_PERSONAGEM_ID:
        rows = [
            {**r, "confidence": None, "approved": None}
            for r in db.shots_without_character(episode_id)
        ]
    elif character_id <= 0:
        # shots_for_episode não traz confiança nem revisão: elas pertencem ao
        # par (shot, personagem), e aqui um shot pode ter vários ou nenhum.
        rows = [
            {**r, "confidence": None, "approved": None}
            for r in db.shots_for_episode(episode_id)
        ]
    else:
        rows = db.shots_for_character(character_id, episode_id=episode_id)

    # Favorito é da CENA: a estrela enche em qualquer pasta se o clipe já foi
    # favoritado em alguma. Olhar só a chave deste personagem faria a mesma
    # cena aparecer favoritada numa tela e não na outra.
    favoritas = db.favorite_shot_ids()
    rows = [{**r, "favorite": r["id"] in favoritas} for r in rows]
    _emit(
        {
            "type": "shots",
            "shots": [
                {
                    "id": r["id"],
                    "idx": r["idx"],
                    "file": r["file"],
                    "keyframe": r["keyframe"],
                    "start": r["start"],
                    "end": r["end"],
                    "duration": r["duration"],
                    "confidence": r["confidence"],
                    "approved": r["approved"],
                    "favorite": r["favorite"],
                }
                for r in rows
            ],
        }
    )


def _merge_shots(episode_id: int, shot_ids: list[int]) -> None:
    """Junta vários clipes num só, em ordem cronológica.

    Concatena SEM reencodar (`-c copy`): os cortes de um episódio saem todos do
    mesmo encoder com os mesmos parâmetros, então dá pra emendar os pacotes
    direto. Medido: 3 clipes em 542 ms, sem perda de qualidade.

    Os pedaços saem de `shots/`, mas NÃO de `by_character/`. Aquelas entradas
    são hardlinks pro mesmo arquivo, então o conteúdo sobrevive lá e a pasta
    do personagem continua sendo o registro fiel do que a análise achou.
    """
    import subprocess
    import tempfile

    from .config import Config
    from .ffmpeg_locate import ffmpeg_binary
    from .storage.db import Database

    if len(shot_ids) < 2:
        _emit({"type": "failed", "message": "selecione pelo menos duas cenas"})
        return

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")

    with db.connect() as c:
        root = c.execute(
            "SELECT output_root FROM episode WHERE id=?", (episode_id,)
        ).fetchone()
    if root is None or not root["output_root"]:
        _emit({"type": "failed", "message": "pasta do episódio desconhecida"})
        return
    episode_root = Path(root["output_root"])

    todos = {r["id"]: r for r in db.shots_for_episode(episode_id)}
    faltando = [i for i in shot_ids if i not in todos]
    if faltando:
        _emit({"type": "failed", "message": f"cenas não encontradas: {faltando}"})
        return

    escolhidos = sorted((todos[i] for i in shot_ids), key=lambda r: r["idx"])
    origens = [episode_root / r["file"] for r in escolhidos]
    sumidos = [p.name for p in origens if not p.exists()]
    if sumidos:
        _emit({"type": "failed", "message": f"clipe não está no disco: {sumidos[0]}"})
        return

    primeiro, ultimo = escolhidos[0], escolhidos[-1]
    destino = episode_root / "shots" / f"{primeiro['idx']:04d}-{ultimo['idx']:04d}.mp4"

    # O modo com que o episódio foi cortado decide como mesclar.
    #
    # Emendar sem reencodar é rápido (0,54s contra 1,26s em 12s de vídeo) mas
    # QUEBRA a cadência constante: medi um salto de 0,062s na junção, contra
    # os 0,042s de um frame, e o r_frame_rate foi pra 47,95. Num episódio
    # cortado pra render isso desfaz exatamente a garantia que o modo dá — e
    # reencodando o arquivo ainda saiu MENOR. Em "off" não há CFR a preservar,
    # então vale a velocidade.
    try:
        modo = (episode_root / "shots" / ".export_mode").read_text(
            encoding="utf-8"
        ).strip()
    except OSError:
        modo = "off"

    if modo in ("compat", "intra"):
        from .ffmpeg_locate import nvenc_available
        from .keyframe_extractor import render_output_params

        saida: list[str] = []
        for chave, valor in render_output_params(modo, nvenc_available()).items():
            saida += ["-f" if chave == "format" else f"-{chave}", str(valor)]
    else:
        saida = ["-c", "copy"]

    # A lista vai num arquivo temporário: o demuxer concat lê caminhos de lá, e
    # aspas simples dentro do caminho se escapam dobrando pra fora da string.
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False,
                                     encoding="utf-8") as lista:
        for p in origens:
            lista.write("file '%s'\n" % str(p).replace("'", "'\\''"))
        lista_path = lista.name

    try:
        proc = subprocess.run(
            [ffmpeg_binary(), "-y", "-hide_banner", "-loglevel", "error",
             "-f", "concat", "-safe", "0", "-i", lista_path,
             *saida, str(destino)],
            capture_output=True, text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
    finally:
        Path(lista_path).unlink(missing_ok=True)

    # Só apaga DEPOIS de confirmar que o mesclado existe e tem conteúdo. Se o
    # ffmpeg falhar, nada é perdido.
    if proc.returncode != 0 or not destino.exists() or destino.stat().st_size == 0:
        erro = (proc.stderr or "").strip().splitlines()
        _emit({
            "type": "failed",
            "message": "não deu pra mesclar os clipes",
            "detail": erro[-1] if erro else f"ffmpeg saiu com {proc.returncode}",
        })
        return

    removidos = 0
    for p in origens:
        try:
            p.unlink()
            removidos += 1
        except OSError:
            pass

    db.delete_shots([r["id"] for r in escolhidos])
    novo_id = db.insert_shot(
        episode_id,
        idx=primeiro["idx"],
        file=str(destino.relative_to(episode_root)),
        keyframe=primeiro["keyframe"],
        start=primeiro["start"],
        end=primeiro["start"] + sum(r["duration"] for r in escolhidos),
    )

    _emit({
        "type": "merged",
        "shotId": novo_id,
        "file": str(destino.relative_to(episode_root)),
        "mergedCount": len(escolhidos),
        "removed": removidos,
        "seconds": sum(r["duration"] for r in escolhidos),
    })


def _delete_shots(episode_id: int, shot_ids: list[int]) -> None:
    """Tira cenas do episódio: o clipe, os hardlinks e o keyframe.

    Diferente do merge, que só tira de `shots/`. Aqui o usuário está dizendo
    que a cena não presta, então ela some também de `by_character/` e
    `by_pair/` — senão continuaria aparecendo nos resultados e nas pastas.

    Como aquelas entradas são hardlinks pro MESMO arquivo, o conteúdo só some
    quando o último link cai. Por isso todos saem: deixar um pra trás faria o
    arquivo sobreviver escondido, ocupando espaço sem aparecer.

    O clipe em si NÃO é destruído — vai pra `_lixeira/<data-hora>` dentro da
    pasta do episódio (ver `storage/lixeira.py`).
    """
    from .config import Config
    from .storage.db import Database

    if not shot_ids:
        _emit({"type": "failed", "message": "nenhuma cena selecionada"})
        return

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")

    with db.connect() as c:
        row = c.execute(
            "SELECT output_root FROM episode WHERE id=?", (episode_id,)
        ).fetchone()
    if row is None or not row["output_root"]:
        _emit({"type": "failed", "message": "pasta do episódio desconhecida"})
        return
    episode_root = Path(row["output_root"])

    todos = {r["id"]: r for r in db.shots_for_episode(episode_id)}
    alvos = [todos[i] for i in shot_ids if i in todos]
    if not alvos:
        _emit({"type": "failed", "message": "cenas não encontradas"})
        return

    # Lixeira em vez de destruir. Mover dentro do mesmo volume é instantâneo
    # e não custa espaço nenhum a mais — e um clique errado numa seleção de
    # 40 cenas deixa de significar reanalisar o episódio inteiro.
    from .storage.lixeira import recolher

    recolhido = recolher(
        episode_root,
        [
            {"idx": s["idx"], "file": s["file"], "keyframe": s["keyframe"]}
            for s in alvos
        ],
    )
    for falha in recolhido.falhas:
        print(f"[CorteCenas] lixeira: {falha}", flush=True)

    db.delete_shots([s["id"] for s in alvos])

    _emit({
        "type": "deleted",
        "deletedCount": len(alvos),
        "files": recolhido.movidos,
        "trashDir": str(recolhido.destino),
    })


def _harvest(episode_id: int) -> None:
    """Reforça as refs do anime com os rostos deste episódio.

    Colhe recortes de alta confiança das cenas já identificadas e guarda como
    referência do personagem. Vale mais que arte promocional porque casa com o
    traço e a luz do próprio anime — cada episódio conferido deixa a próxima
    análise mais fiel.

    Emite progresso porque carrega CLIP e YOLO (~5s) e depois varre as cenas:
    sem isso a interface ficaria parada sem explicação.
    """
    from .config import Config
    from .storage.db import Database

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")

    with db.connect() as c:
        ep = c.execute(
            "SELECT e.output_root, a.anilist_id, a.mal_id "
            "FROM episode e JOIN anime a ON a.id = e.anime_id WHERE e.id=?",
            (episode_id,),
        ).fetchone()
    if ep is None or not ep["output_root"]:
        _emit({"type": "failed", "message": "pasta do episódio desconhecida"})
        return

    cache_id = _franchise_cache_id(cfg, ep["anilist_id"], ep["mal_id"])
    if not cache_id:
        _emit({
            "type": "failed",
            "message": "este anime não tem banco de referências pra reforçar",
        })
        return

    _emit({"type": "harvest-progress", "name": "carregando os modelos",
           "done": 0, "total": 0})

    from .harvest import harvest_all_characters
    from .matching.embedding_engine import EmbeddingEngine
    from .matching.face_detector import AnimeFaceDetector
    from .references.reference_store import ReferenceStore

    face_det = AnimeFaceDetector()
    engine = EmbeddingEngine(
        model_name=cfg.clip_model,
        pretrained=cfg.clip_pretrained,
        use_cuda=cfg.use_cuda,
    )
    store = ReferenceStore(cfg.cache_path)

    adicionadas = harvest_all_characters(
        Path(ep["output_root"]),
        episode_id,
        cache_id,
        db,
        store,
        face_det,
        engine,
        on_progress=lambda nome, feito, total: _emit({
            "type": "harvest-progress", "name": nome,
            "done": feito, "total": total,
        }),
    )

    _emit({
        "type": "harvest-done",
        "added": adicionadas,
        "total": sum(adicionadas.values()),
        "characters": len(adicionadas),
        "refsDir": _refs_dir_for(cfg, ep["anilist_id"], ep["mal_id"]),
    })


def _has_analysis(
    source: str, anime: str, season: int, episode: int, kind: str = ""
) -> None:
    """Este episódio já tem resultado salvo?

    A interface usa isso pra perguntar "substituir ou somar" ANTES de rodar —
    sem a pergunta, uma reanálise apagaria em silêncio a curadoria manual do
    usuário (remoções e movimentações feitas na mão).
    """
    from .config import Config
    from .storage.db import Database

    exists = False
    try:
        db = Database(Config.load().cache_path / "index.db")
        exists = db.has_analysis(source, anime, season, episode, kind)
    except Exception:
        pass
    _emit({"type": "has-analysis", "exists": exists})


def _explorer_scan(episode_id: int) -> None:
    """O que o usuário mexeu no Explorer desde a última vez."""
    from .config import Config
    from .storage.db import Database
    from .storage.explorer_sync import ler

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    with db.connect() as c:
        row = c.execute(
            "SELECT output_root FROM episode WHERE id=?", (episode_id,)
        ).fetchone()
    if row is None or not row["output_root"]:
        _emit({"type": "explorer-changes", "safe": False,
               "reason": "pasta do episódio desconhecida",
               "missingClips": 0, "unlinkedPairs": [], "missingFolders": []})
        return
    _emit({"type": "explorer-changes", **ler(row["output_root"], db, episode_id).payload()})


def _explorer_apply(episode_id: int, character_ids: list[int]) -> None:
    """Aplica a faxina do Explorer. As pastas só entram se confirmadas."""
    from .config import Config
    from .storage.db import Database
    from .storage.explorer_sync import aplicar, ler

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    with db.connect() as c:
        row = c.execute(
            "SELECT output_root FROM episode WHERE id=?", (episode_id,)
        ).fetchone()
    if row is None or not row["output_root"]:
        _emit({"type": "failed", "message": "pasta do episódio desconhecida"})
        return
    # Relê agora em vez de confiar no que a interface mandou: entre a
    # pergunta e o "sim" o disco pode ter mudado de novo.
    mudancas = ler(row["output_root"], db, episode_id)
    _emit({"type": "explorer-applied", **aplicar(db, episode_id, mudancas, character_ids)})


def _orphans() -> None:
    """Pastas de episódio na saída que o histórico não conhece."""
    from .config import Config
    from .storage.db import Database
    from .storage.recovery import scan

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    try:
        _backfill_episode_roots(db, cfg.output_path)
    except Exception:
        pass  # o backfill é oportunista; a varredura vale de qualquer jeito
    achadas = scan(cfg.output_path, db)
    _emit({"type": "orphans", "episodes": [o.payload() for o in achadas]})


def _restore(root: str) -> None:
    """Devolve uma pasta esquecida pro histórico, sem reanalisar."""
    from .config import Config
    from .storage.db import Database
    from .storage.recovery import restore

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    r = restore(root, db)
    _emit({
        "type": "restored",
        "episodeId": r.episode_id,
        "shots": r.shots,
        "assignments": r.assignments,
        "ignored": r.ignored,
    })


def _anime_folder(anime: str) -> None:
    """Em que pasta este nome vai cair — e quais pastas já existem.

    Consulta só o que é local: a memória de pastas e a listagem da saída.
    Nada de rede, porque isto responde enquanto o usuário digita.
    """
    from .config import Config
    from .storage.anime_folders import AnimeFolderStore, existing_folders
    from .storage.organizer import sanitize

    cfg = Config.load()
    store = AnimeFolderStore(cfg.cache_dir)
    store.seed_from_history(cfg.cache_dir, cfg.output_dir)

    # A MESMA decisão que a análise vai tomar, franquia inclusive.
    #
    # Antes isto olhava só o apelido, e então a dica mentia exatamente nos
    # casos que importam: com "Re:Zero ... 4th Season" a tela prometia uma
    # pasta nova enquanto a análise, que conhece a franquia, mandaria pra
    # pasta certa. Dica que mente é pior do que dica nenhuma.
    #
    # `season=0` de propósito: a franquia é a mesma em qualquer temporada, e
    # a busca cai no casamento por nome quando não acha a temporada exata.
    cache_id = store.franchise_for_name(anime, 0, cfg.cache_dir) if anime else ""
    escolhida = store.decide(typed=anime, franchise_key=cache_id) if anime else ""
    _emit({
        "type": "anime-folder",
        "folder": escolhida,
        "remembered": bool(anime) and escolhida != sanitize(anime),
        "existing": existing_folders(cfg.output_dir),
    })


def _fav_toggle(shot_id: int, character_id: int = 0) -> None:
    """Liga/desliga o favorito e devolve o estado NOVO.

    Devolver o estado (e não só "ok") é o que deixa a tela acertar a estrela
    sem uma segunda ida ao motor.
    """
    from .config import Config
    from .storage.db import Database

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    _emit({
        "type": "fav-toggle",
        "shotId": shot_id,
        "characterId": character_id,
        "favorite": db.toggle_favorite(shot_id, character_id),
    })


def _tag_shot(shot_ids: list[int], character_id: int, remover: bool) -> None:
    """Marca (ou desmarca) o personagem numa cena.

    Correção manual: o reconhecimento erra e cala, e sem isto a cena ficava
    presa em "Sem personagem" pra sempre. Ver `storage/marcar.py` — mexe no
    banco, no disco e na decisão que sobrevive à reanálise.
    """
    from .config import Config
    from .storage.db import Database
    from .storage.marcar import ErroDeMarcacao, marcar_varias

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    try:
        payload = marcar_varias(db, shot_ids, character_id, remover)
    except ErroDeMarcacao as e:
        _emit({"type": "tag-shot", "error": str(e)})
        return
    _emit({"type": "tag-shot", **payload})


def _remove_character(episode_id: int, character_id: int) -> None:
    """Tira um personagem inteiro de um episódio (reconhecimento errado).

    As cenas ficam: o que sai é o vínculo. Ver `storage/marcar.py`.
    """
    from .config import Config
    from .storage.db import Database
    from .storage.marcar import ErroDeMarcacao, remover_personagem

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    try:
        payload = remover_personagem(db, episode_id, character_id)
    except ErroDeMarcacao as e:
        _emit({"type": "remove-character", "error": str(e)})
        return
    _emit({"type": "remove-character", **payload})


def _favorites() -> None:
    """Favoritos do acervo, em anime → personagem → cenas."""
    from .config import Config
    from .storage.db import Database
    from .storage.favoritos import listar

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    _emit({
        "type": "favorites",
        "outputDir": str(cfg.output_dir),
        "animes": [a.payload() for a in listar(db, cfg.output_dir)],
    })


def _characters(termo: str = "") -> None:
    """Todos os personagens do acervo, com quantas cenas cada um tem.

    A Biblioteca organiza por anime; isto atravessa o acervo inteiro. Devolve
    `outputDir` junto porque os caminhos vêm relativos a ela — a grade de um
    personagem mistura episódios de vários animes, e um prefixo `media://` por
    episódio não daria conta.
    """
    from .config import Config
    from .storage.db import Database
    from .storage.personagens import listar

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    grupos = listar(db, cfg.output_dir, termo)
    _emit({
        "type": "characters",
        "outputDir": str(cfg.output_dir),
        "characters": [g.payload() for g in grupos],
    })


def _character_shots(ids: list[int]) -> None:
    """Todas as cenas desses personagens, no acervo inteiro."""
    from .config import Config
    from .storage.db import Database
    from .storage.personagens import cenas_de

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    cenas = cenas_de(db, cfg.output_dir, ids)
    favoritas = db.favorite_shot_ids()
    _emit({
        "type": "character-shots",
        "outputDir": str(cfg.output_dir),
        "shots": [{**c, "favorite": c["id"] in favoritas} for c in cenas],
    })


def _delete_episode(episode_id: int, aplicar_agora: bool) -> None:
    """Apaga um episódio: a pasta do disco e a entrada do histórico.

    **Apaga DE VEZ, sem lixeira** — decisão do FAAH, com o tamanho na frente.
    A primeira versão mandava pra Lixeira do Windows; ele preferiu direto.

    Sem `apply`, só informa: o que é, quanto pesa e se a pasta está DENTRO da
    saída configurada. Esse último ponto é a trava, e sem lixeira ela deixou de
    ser precaução e virou a única rede: uma linha com caminho estranho (banco
    velho, saída trocada) não autoriza apagar pasta nenhuma.

    Ordem no `apply`: a pasta primeiro, o banco depois. Se a remoção falhar
    (arquivo aberto no player, permissão), o histórico fica intacto e o
    episódio continua abrindo — melhor do que perder a entrada e sobrar uma
    pasta que ninguém sabe que existe.
    """
    import shutil

    from .config import Config
    from .storage.db import Database

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    linhas = db.episodes_by_ids([episode_id])
    if not linhas:
        _emit({"type": "delete-episode", "erro": f"episódio {episode_id} não existe"})
        return
    r = linhas[0]
    raiz = Path(r["output_root"] or "")
    saida = Path(cfg.output_dir).resolve()

    dentro = False
    if raiz.name:
        try:
            dentro = raiz.resolve().is_relative_to(saida)
        except (OSError, ValueError):
            dentro = False

    cenas = len(db.shots_for_episode(episode_id))
    bytes_ = 0
    if raiz.is_dir():
        for f in raiz.rglob("*"):
            try:
                if f.is_file():
                    bytes_ += f.stat().st_size
            except OSError:
                pass

    erro = ""
    if raiz.name and not dentro:
        erro = "a pasta do episódio está fora da pasta de saída configurada"

    apagou = False
    if aplicar_agora and not erro:
        if raiz.is_dir():
            try:
                shutil.rmtree(raiz)
                apagou = True
            except OSError as e:
                # Não encosta no banco: com a pasta ainda lá, o episódio
                # continua abrindo e ele pode tentar de novo.
                _emit({
                    "type": "delete-episode",
                    "aplicado": False,
                    "episodeId": episode_id,
                    "root": str(raiz),
                    "rootExists": True,
                    "insideOutput": dentro,
                    "shots": cenas,
                    "bytes": bytes_,
                    "erro": f"não consegui apagar a pasta: {e}",
                })
                return
        db.delete_episode(episode_id)

    _emit({
        "type": "delete-episode",
        "aplicado": bool(aplicar_agora and not erro),
        "episodeId": episode_id,
        "root": str(raiz),
        "rootExists": raiz.is_dir(),
        "insideOutput": dentro,
        "shots": cenas,
        "bytes": bytes_,
        "folderDeleted": apagou,
        "erro": erro,
    })


def _set_season(episode_ids: list[int], season: int, aplicar_agora: bool) -> None:
    """Muda a temporada de um ou vários episódios.

    Em dois tempos, como a junção: a tela pede o plano, mostra o que vai
    virar o que, e só então manda aplicar. Aqui isso importa mais ainda —
    renomear pasta de episódio é irreversível pelo app.
    """
    from .config import Config
    from .storage.db import Database
    from .storage.temporadas import aplicar, planejar

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    plano = (aplicar if aplicar_agora else planejar)(episode_ids, season, db)
    _emit({
        "type": "set-season",
        "aplicado": bool(aplicar_agora and plano.pode),
        **plano.payload(),
    })


def _reclassify(destino: str, season: int, itens_txt: str, aplicar_agora: bool) -> None:
    """Muda tipo, número e pasta de anime de vários episódios de uma vez.

    O caso que trouxe isto: aberturas analisadas sem marcar "Abertura", cada
    uma virando um anime próprio com um S01E01. Ver `storage/reclassificar.py`.
    """
    from .config import Config
    from .storage.anime_folders import AnimeFolderStore
    from .storage.db import Database
    from .storage.reclassificar import aplicar, ler_itens, planejar

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    itens = ler_itens(itens_txt)
    plano = (aplicar if aplicar_agora else planejar)(cfg.output_dir, itens, destino, season, db)

    feito = bool(aplicar_agora and plano.pode and not plano.erro)
    if feito and destino:
        # A memória de nomes que mandava pra pasta esvaziada passa a mandar
        # pro destino — senão a próxima análise recria a pasta.
        store = AnimeFolderStore(cfg.cache_path)
        for o in plano.esvaziadas:
            store.repoint(Path(o).name, destino)

    _emit({"type": "reclassify", "aplicado": feito, **plano.payload()})


def _merge_anime(origem: str, destino: str, aplicar: bool) -> None:
    """Junta duas pastas de anime numa só.

    Sempre em dois tempos: a tela pede o PLANO, mostra o que vai acontecer, e
    só então pede a execução. Mover 400 clipes sem o usuário ter visto a lista
    seria a mesma imprudência que apagar sem perguntar.
    """
    from .config import Config
    from .storage.anime_folders import AnimeFolderStore
    from .storage.db import Database
    from .storage.juntar_animes import juntar, planejar

    cfg = Config.load()
    db = Database(cfg.cache_path / "index.db")
    plano = (juntar if aplicar else planejar)(cfg.output_dir, origem, destino, db)

    repontadas = 0
    if aplicar and plano.pode:
        # Depois dos arquivos: a memória de pastas tem que seguir a mudança,
        # senão a próxima análise recria a pasta que acabou de sumir.
        repontadas = AnimeFolderStore(cfg.cache_path).repoint(origem, destino)

    _emit({"type": "merge-anime", "aplicado": bool(aplicar and plano.pode),
           "repontadas": repontadas, **plano.payload()})


def _bench_add(episode_id: int, label: str = "") -> None:
    """Congela este episódio como gabarito do benchmark.

    Chamado quando o usuário diz "este aqui está certo". O que vira régua é
    exatamente o que ele está vendo na tela — inclusive a curadoria que ele
    acabou de fazer.
    """
    from .benchmark import BenchmarkStore
    from .config import Config

    cfg = Config.load()
    store = BenchmarkStore(cfg.cache_dir)
    case = store.snapshot(Path(cfg.cache_dir) / "index.db", episode_id, label=label)
    _emit({
        "type": "benchmark-case",
        "label": case.label,
        "shots": case.shot_count,
        "truth": case.truth_count,
        "total": len(store.cases()),
    })


def _skip_ranges(anime: str) -> None:
    """OP/ED salvos pra um anime (o usuário digitou o nome na mão)."""
    from .config import Config
    from .storage.skip_ranges import SkipRangesStore

    head, tail = 0.0, 0.0
    try:
        head, tail = SkipRangesStore(Config.load().cache_path).get(anime)
    except Exception:
        pass
    _emit({"type": "skip-ranges", "skipHeadSeconds": head, "skipTailSeconds": tail})


# ---------------------------------------------------------------------------
# run: a análise em si
# ---------------------------------------------------------------------------
def _read_request() -> dict[str, Any]:
    line = _read_line_raw()
    if line is None or not line.strip():
        raise ValueError("requisição vazia no stdin")
    req = json.loads(line)
    if not isinstance(req, dict):
        raise ValueError("requisição deve ser um objeto JSON")
    return req


def _rostos() -> int:
    """[Studio] Os rostos dos blocos do Studio, em lote (app/rostos.py).

    Mesmo cuidado do _run com o stdin: le a requisicao, solta o pipe e deixa
    a thread de sondagem cuidar do cancelamento (e do host que morreu)."""
    req = _read_request()
    _detach_stdin()
    cancel = _CancelFlag()
    threading.Thread(target=_watch_stdin, args=(cancel,), daemon=True).start()
    from .rostos import rodar

    return rodar(req, _emit, lambda: cancel.requested)


def _apply_request_to_config(cfg: Any, req: dict[str, Any]) -> None:
    """Passa os parâmetros da requisição pra Config.

    Não salvamos no disco aqui: quem manda no config.json é o host (o Electron
    grava direto no mesmo arquivo). Se salvássemos dos dois lados, um
    sobrescreveria o outro dependendo de quem terminasse por último.
    """
    params = req.get("params") or {}
    cfg.output_dir = req["outputDir"]
    cfg.last_anime = req["anime"]
    cfg.last_season = int(req["season"])
    cfg.last_episode = int(req["episode"])
    if "threshold" in params:
        cfg.default_threshold = float(params["threshold"])
    if "margin" in params:
        cfg.argmax_margin = float(params["margin"])
    if "minShots" in params:
        cfg.min_shots_per_character = int(params["minShots"])
    if "padding" in params:
        cfg.face_crop_padding = float(params["padding"])
    if "credit" in params:
        cfg.credit_edge_threshold = float(params["credit"])
    cfg.skip_credit_shots = bool(req.get("skipCreditShots", False))
    cfg.use_danbooru = bool(req.get("useDanbooru", False))
    # Tipo de mídia: escolhe o par de modelos que olha o rosto. Valor
    # desconhecido cai em "anime" — o app nasceu assim e é o que não surpreende
    # quem nunca mexeu nisso.
    tipo = str(req.get("mediaKind", cfg.media_kind))
    cfg.media_kind = tipo if tipo in ("anime", "live") else "anime"
    mode = str(req.get("renderExportMode", "off"))
    # Valor desconhecido cai em "off" de propósito: um modo inventado não pode
    # virar formato de saída silencioso.
    cfg.render_export_mode = mode if mode in ("off", "compat", "intra") else "off"


def _result_payload(result: Any) -> dict[str, Any]:
    return {
        "episodeRoot": str(result.episode_root),
        "totalShots": result.total_shots,
        "totalCharacters": result.total_characters,
        "identifiedCharacters": list(result.identified_characters),
        "lowRefsWarning": result.low_refs_warning,
        "refsDir": result.refs_dir,
        "animeTitle": result.anime_title,
        "season": result.season,
        "episode": result.episode,
        "kind": getattr(result, "kind", ""),
        "episodeId": result.episode_id,
    }


def _run() -> int:
    req = _read_request()
    # Depois de ter a requisição, ninguém mais deve enxergar o pipe como
    # stdin (ver _detach_stdin).
    _detach_stdin()
    cancel = _CancelFlag()
    # Pode subir ANTES dos imports pesados porque agora ela sonda em vez de
    # bloquear — assim o cancelamento já vale durante os ~5s de carga do
    # torch. Com leitura bloqueante isto travava o processo (ver
    # `_stdin_available`).
    threading.Thread(target=_watch_stdin, args=(cancel,), daemon=True).start()

    from .config import Config
    from .pipeline_types import AIMode, AnimeNotFoundError, InsufficientRefsError
    from .video_ingest import EpisodeInfo

    cfg = Config.load()
    _apply_request_to_config(cfg, req)
    cfg.ensure_dirs()

    info = EpisodeInfo(
        anime=req["anime"],
        season=int(req["season"]),
        episode=int(req["episode"]),
        source=Path(req["videoPath"]),
        skip_head_seconds=float(req.get("skipHeadSeconds", 0)),
        skip_tail_seconds=float(req.get("skipTailSeconds", 0)),
        # Tipo inventado vira episódio, pela mesma razão do render_export_mode:
        # um valor desconhecido não pode virar identidade em silêncio.
        kind=(
            str(req.get("kind", "")).upper()
            if req.get("kind") in ("OP", "ED", "MOVIE")
            else ""
        ),
        output_folder=str(req.get("outputFolder", "") or ""),
    )

    import time

    t0 = time.perf_counter()

    def on_progress(stage: str, frac: float, msg: str) -> None:
        if cancel.requested:
            raise _Cancelled()
        _emit(
            {
                "type": "stage",
                "stage": stage,
                "fraction": float(frac),
                "message": str(msg),
                "elapsed": round(time.perf_counter() - t0, 2),
            }
        )

    try:
        # Avisa antes do import pesado: o primeiro run da sessão paga ~5s de
        # torch e sem isto a interface parece travada. Fica DENTRO do try —
        # um cancelamento aqui é cancelamento, não falha.
        on_progress(
            "parse", -1.0, "Preparando ambiente de análise (só na primeira vez)..."
        )

        from .pipeline import Pipeline  # noqa: WPS433 — pesado de propósito

        pipeline = Pipeline(cfg)

        if req.get("cutOnly"):
            result = pipeline.run_cut_only(info, on_progress=on_progress)
            _emit({"type": "done", "result": _result_payload(result)})
            return 0

        if req.get("discovery"):
            disc = pipeline.run_discovery(info, on_progress=on_progress)
            return _discovery_naming_round(pipeline, disc, on_progress, cancel)

        result = pipeline.run(
            info,
            on_progress=on_progress,
            use_ai_recognition=False,
            ai_mode=AIMode.FULL,
            ai_review_ambiguous=bool(req.get("aiReview", False)),
            merge_previous=bool(req.get("mergePrevious", False)),
        )
    except _Cancelled:
        _emit({"type": "cancelled"})
        return 0
    except AnimeNotFoundError as e:
        _emit({"type": "needs-input", "kind": "anime-not-found", "message": str(e)})
        return 0
    except InsufficientRefsError as e:
        _emit(
            {
                "type": "needs-input",
                "kind": "refs-missing",
                "message": str(e),
                "refsDir": e.refs_dir,
            }
        )
        return 0

    # Telemetria por etapa: o pipeline já grava timings.json na pasta do
    # episódio (StageTimer). Lemos de volta em vez de recalcular, pra ser
    # exatamente o mesmo número que vai pro log.
    timings = _read_timings(Path(result.episode_root))
    if timings:
        _emit({"type": "timings", **timings})

    _emit({"type": "done", "result": _result_payload(result)})
    return 0


def _discovery_naming_round(
    pipeline: Any, disc: Any, on_progress: Any, cancel: _CancelFlag
) -> int:
    """Descoberta: publica os grupos, ESPERA os nomes e faz o commit.

    O `DiscoveryResult` carrega bytes de JPEG e o embedding do centroide em
    memória — não dá pra serializar e recriar depois. Então o processo fica
    vivo entre a descoberta e o batismo, exatamente como o app Qt fazia
    dentro de uma thread. Os recortes vão pro disco e o host os exibe por
    `media://`; mandar base64 no canal de eventos inflaria o JSON em dezenas
    de megabytes.
    """
    # 1) Grava os recortes que a tela de batismo vai mostrar.
    crops_dir = Path(disc.episode_root) / "metadata" / "discovery"
    crops_dir.mkdir(parents=True, exist_ok=True)
    for old in crops_dir.glob("*.jpg"):
        old.unlink(missing_ok=True)  # sobras de uma descoberta anterior

    groups_payload = []
    for g in disc.groups:
        crop_files = []
        for i, jpg in enumerate(g.ref_crops_jpg):
            name = f"g{g.key:03d}_{i:03d}.jpg"
            (crops_dir / name).write_bytes(jpg)
            crop_files.append(f"metadata/discovery/{name}")
        groups_payload.append(
            {
                "key": g.key,
                "faces": g.n_faces,
                "shots": g.n_shots,
                # Figurante: aparece em menos cenas do que o piso. A tela
                # esconde estes atrás de um botão em vez de perguntar o nome
                # de duzentos NPCs de fundo. Decidido no pipeline, que também
                # manda pra cá o grupo que é mais nuca do que rosto.
                "minor": g.minor,
                # Índice em ref_crops_jpg == índice nesta lista: é o que o
                # host devolve em `removed`.
                "crops": crop_files,
                "suggestedName": g.suggested_name,
                "suggestedSim": round(g.suggested_sim, 3),
                # Batizado em outro episódio: o nome vem preenchido. Sem
                # isto, `suggestedName` é só a dica "parece X".
                "known": g.known,
            }
        )

    _emit(
        {
            "type": "discovery-ready",
            "episodeRoot": str(disc.episode_root),
            "animeTitle": disc.anime_title,
            "season": disc.season,
            "episode": disc.episode,
            "totalFaces": disc.total_faces,
            "online": disc.online,
            "roster": list(disc.roster),
            "groups": groups_payload,
        }
    )

    # 2) Espera o batismo, pela fila alimentada pela thread de stdin. O host
    #    manda:
    #      {"cmd":"commit-discovery","names":{"0":"Rimuru"},"removed":{"0":[2]}}
    #    ou {"cmd":"cancel"} pra desistir.
    #
    #    Sem timeout de propósito: o usuário pode levar o tempo que quiser
    #    batizando dezenas de grupos. Se a janela fechar, o pipe quebra, a
    #    thread põe "cancel" na fila e saímos.
    while True:
        msg = _commands.get()
        cmd = msg.get("cmd")
        if cmd == "cancel" or cancel.requested:
            _emit({"type": "cancelled"})
            return 0
        if cmd == "commit-discovery":
            names = {int(k): str(v) for k, v in (msg.get("names") or {}).items()}
            removed = {
                int(k): [int(i) for i in v]
                for k, v in (msg.get("removed") or {}).items()
            }
            break

    # 3) Commit: cria personagens, atribui shots e salva as refs.
    result = pipeline.commit_discovery(
        disc, names, on_progress=on_progress, removed=removed
    )
    timings = _read_timings(Path(result.episode_root))
    if timings:
        _emit({"type": "timings", **timings})
    _emit({"type": "done", "result": _result_payload(result)})
    return 0


def _read_timings(episode_root: Path) -> dict[str, Any] | None:
    path = episode_root / "metadata" / "timings.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return {
        "totalSeconds": data.get("total_seconds", 0),
        "stages": data.get("stages", {}),
    }


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    mode = args[0] if args else "run"
    # [Studio] app/cv2_unicode.py: imread/imwrite com acento no caminho (um
    # usuario do Windows com acento no nome). Antes de qualquer modo; o probe
    # nao le nem grava imagem.
    if mode != "probe":
        try:
            from .cv2_unicode import instalar as _cv2_unicode

            _cv2_unicode()
        except Exception as e:  # noqa: BLE001 -- sem isto o motor roda como o upstream
            print(f"[studio] cv2_unicode: {e}", file=sys.stderr)
    try:
        if mode == "probe":
            _probe()
            return 0
        if mode == "parse":
            _parse(args[1])
            return 0
        if mode == "skip-ranges":
            _skip_ranges(args[1])
            return 0
        if mode == "has-analysis":
            _has_analysis(
                args[1], args[2], int(args[3]), int(args[4]),
                args[5] if len(args) > 5 else "",
            )
            return 0
        if mode == "recent":
            _recent()
            return 0
        if mode == "results":
            _results(int(args[1]))
            return 0
        if mode == "shots":
            _shots(int(args[1]), int(args[2]))
            return 0
        if mode == "merge":
            _merge_shots(int(args[1]), [int(a) for a in args[2:]])
            return 0
        if mode == "delete":
            _delete_shots(int(args[1]), [int(a) for a in args[2:]])
            return 0
        if mode == "explorer-scan":
            _explorer_scan(int(args[1]))
            return 0
        if mode == "explorer-apply":
            _explorer_apply(int(args[1]), [int(a) for a in args[2:]])
            return 0
        if mode == "orphans":
            _orphans()
            return 0
        if mode == "restore":
            _restore(args[1])
            return 0
        if mode == "anime-folder":
            _anime_folder(args[1] if len(args) > 1 else "")
            return 0
        if mode == "fav-toggle":
            _fav_toggle(int(args[1]), int(args[2]) if len(args) > 2 else 0)
            return 0
        if mode == "favorites":
            _favorites()
            return 0
        if mode == "remove-character":
            _remove_character(int(args[1]), int(args[2]))
            return 0
        if mode == "tag-shot":
            _tag_shot(
                [int(x) for x in args[1].split(",") if x.strip()],
                int(args[2]),
                remover=(len(args) > 3 and args[3] == "remove"),
            )
            return 0
        if mode == "characters":
            _characters(args[1] if len(args) > 1 else "")
            return 0
        if mode == "character-shots":
            _character_shots([int(x) for x in args[1].split(",") if x.strip()])
            return 0
        if mode == "delete-episode":
            _delete_episode(int(args[1]), aplicar_agora=(len(args) > 2 and args[2] == "apply"))
            return 0
        if mode == "set-season":
            # set-season <temporada> <id,id,...> [apply]
            _set_season(
                [int(x) for x in args[2].split(",") if x.strip()],
                int(args[1]),
                aplicar_agora=(len(args) > 3 and args[3] == "apply"),
            )
            return 0
        if mode == "reclassify":
            # reclassify <pasta-destino|""> <temporada> <id:TIPO:n,...> [apply]
            _reclassify(
                args[1],
                int(args[2]),
                args[3],
                aplicar_agora=(len(args) > 4 and args[4] == "apply"),
            )
            return 0
        if mode == "merge-anime":
            _merge_anime(args[1], args[2], aplicar=(len(args) > 3 and args[3] == "apply"))
            return 0
        if mode == "bench-add":
            _bench_add(int(args[1]), args[2] if len(args) > 2 else "")
            return 0
        if mode == "harvest":
            _harvest(int(args[1]))
            return 0
        if mode == "run":
            return _run()
        if mode == "rostos":  # [Studio] app/rostos.py
            return _rostos()
        _emit({"type": "failed", "message": f"modo desconhecido: {mode}"})
        return 2
    except Exception as e:  # noqa: BLE001 — a fronteira do processo
        _emit(
            {
                "type": "failed",
                "message": str(e) or type(e).__name__,
                "detail": traceback.format_exc(),
            }
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
