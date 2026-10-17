from __future__ import annotations

import os
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

import cv2
import ffmpeg

from .ffmpeg_locate import nvenc_available, run_ffmpeg_hidden
from .shot_detection import ShotBounds

# Consumer GeForce cards cap concurrent NVENC sessions (3-8 depending on the
# driver generation). 3 parallel encodes is safe everywhere and already keeps
# the encode chip saturated for 1-4s clips.
_NVENC_WORKERS = 3
# libx264 path: each ffmpeg spawns its own encoder threads, so a modest pool
# is enough to keep every core busy without thrashing.
_CPU_WORKERS = 4


#: HDR (PQ ou HLG, BT.2020) pra SDR BT.709, no ffmpeg.
#:
#: Sem isto, vídeo HDR saía DESBOTADO e puxado pro roxo — nos keyframes (o
#: OpenCV converte os números de 10 bits pra 8 sem saber que são PQ) e nos
#: clipes (8 bits, mas ainda marcados como BT.2020/PQ, que editor e player
#: interpretam cada um de um jeito). Visto no Cyberpunk Edgerunners da
#: Netflix (HEVC 10 bits, DV + HDR10). E o reconhecimento comparava esses
#: rostos lavados com as referências em cor normal.
#:
#: `mobius` e não `hable`: comparado no mesmo quadro, o hable escurece o anime
#: inteiro; o mobius preserva o que já cabia em SDR e só comprime o brilho
#: alto. O zscale converte pra luz linear, troca as primárias, e o tonemap
#: trabalha em float — por isso o `gbrpf32le` no meio. Custa: o clipe de 10s
#: sai em 3,8s em vez de 1,3s (só em fonte HDR).
_TONEMAP_VF = (
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
    "tonemap=tonemap=mobius:desat=0,zscale=t=bt709:m=bt709:r=tv"
)

#: Gravado ao lado dos clipes (`.cor`). Corte de fonte HDR sem esta marca foi
#: feito antes da conversão, e é refeito — clipes e keyframes.
COR_VERSAO = "sdr-mobius-1"


def fonte_hdr(video_path: str | Path) -> bool:
    """O vídeo é HDR (PQ/HDR10/Dolby Vision com base HDR10, ou HLG)?"""
    from .ffmpeg_locate import ffprobe_binary

    try:
        r = subprocess.run(
            [
                ffprobe_binary(), "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=color_transfer",
                "-of", "default=nw=1:nk=1", str(video_path),
            ],
            capture_output=True, text=True, timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return r.stdout.strip() in ("smpte2084", "arib-std-b67")
    except Exception:
        return False


def render_output_params(
    render_mode: str, use_nvenc: bool, hdr: bool = False
) -> dict[str, object]:
    """Parâmetros de saída do ffmpeg para um modo de export.

    FONTE ÚNICA de propósito: o corte e o merge precisam produzir exatamente o
    mesmo formato. Mesclar com outros parâmetros desfaz a garantia que o modo
    dá — medido: emendar sem reencodar quebra o CFR (salto de 0,062s na
    junção, contra os 0,042s de um frame) e o r_frame_rate vai pra 47,95.
    """
    render = render_mode in ("compat", "intra")
    p: dict[str, object] = {
        # OBRIGATÓRIO nos dois encoders: o NVENC de H.264 não codifica 10 bits
        # e o libx264 HERDA o formato da fonte se ninguém disser nada.
        "pix_fmt": "yuv420p",
        "acodec": "aac",
        "format": "mp4",
        "movflags": "+faststart",
    }
    if render:
        p |= {"vf": "fps=24000/1001", "fps_mode": "cfr", "profile:v": "high"}
    if hdr:
        # A conversão vem ANTES do fps, e o clipe sai marcado como o que ele é
        # agora: BT.709. Sem as marcas o ffmpeg copiava as da fonte, e o
        # clipe dizia ser HDR sem ser.
        p["vf"] = f"{_TONEMAP_VF},format=yuv420p" + (f",{p['vf']}" if "vf" in p else "")
        p |= {"color_primaries": "bt709", "color_trc": "bt709", "colorspace": "bt709"}

    if use_nvenc:
        p |= {"vcodec": "h264_nvenc", "preset": "p4"}
        # constqp é o "CRF" do NVENC; vbr+cq era o modo antigo.
        p |= {"rc": "constqp", "qp": 20} if render else {"rc": "vbr", "cq": 23, "b:v": "0"}
        if render_mode == "intra":
            # ATENÇÃO: -g 0 aqui e -g 1 no libx264 abaixo. NÃO é erro de
            # digitação, não "conserte" pra ficarem iguais. O NVENC rejeita
            # -g 1 com "Gop Length should be greater than number of B frames
            # + 1" — mesmo com -bf 0 exige GOP >= 2. Medido na RTX 3060, 72
            # frames: -g 1 falha, -g 2 dá 36/72, -g 0 dá 72/72.
            p |= {"g": 0, "bf": 0}
    else:
        p |= {"vcodec": "libx264", "crf": 20}
        # ultrafast NÃO entrega High: desliga CABAC e 8x8dct e o x264 rebaixa
        # pra Constrained Baseline. superfast custa 8% de tempo e sai 33% menor.
        p["preset"] = "superfast" if render else "ultrafast"
        if render_mode == "intra":
            p |= {"g": 1, "bf": 0}
    return p


def cut_shot(
    video_path: str | Path,
    shot: ShotBounds,
    out_file: Path,
    reencode: bool = True,
    use_nvenc: bool = False,
    fps: float = 24.0,
    render_mode: str = "off",
    hdr: bool = False,
) -> None:
    """Extract a shot to an mp4 file. Re-encode for frame accuracy, or stream-copy for speed.

    `render_mode` controla o formato de saída (ver config.render_export_mode):
    "off" mantém o comportamento antigo, "compat" força 8 bits e 23,976 CFR,
    "intra" acrescenta all-intra pra seek quadro a quadro sair barato.

    Overwrites any existing file at `out_file`.
    """
    out_file.parent.mkdir(parents=True, exist_ok=True)
    if out_file.exists():
        try:
            out_file.unlink()
        except OSError:
            pass

    # O "fim" do shot é o timestamp do PRIMEIRO frame do shot seguinte (fim
    # exclusivo, convenção do PySceneDetect). Cortar com "-to fim" na ENTRADA
    # deixava exatamente esse frame invadir o clipe quando o arredondamento de
    # timestamp caía pro lado errado (MKV marca em milissegundos) — o clássico
    # "frame de outra cena no final". A correção: duração na SAÍDA (-t, exata
    # pós-decodificação) com margem de MEIO frame — o intruso nunca entra e o
    # último frame legítimo nunca sai (ele termina 1 frame inteiro antes).
    duration = max(0.05, shot.duration - 0.5 / max(fps, 1.0))

    if reencode:
        # Os parâmetros do encoder vêm de render_output_params (fonte única):
        # o merge de clipes usa a MESMA função, senão mesclar produziria um
        # formato diferente do corte e desfaria a garantia do modo.
        stream = ffmpeg.input(str(video_path), ss=shot.start).output(
            str(out_file),
            t=duration,
            loglevel="error",
            **render_output_params(render_mode, use_nvenc, hdr=hdr),
        )
    else:
        stream = ffmpeg.input(str(video_path), ss=shot.start, to=shot.end).output(
            str(out_file),
            c="copy",
            format="mp4",
            avoid_negative_ts="make_zero",
            loglevel="error",
        )
    run_ffmpeg_hidden(stream)


def extract_keyframes(
    video_path: str | Path,
    shot: ShotBounds,
    out_dir: Path,
    n_frames: int = 3,
) -> list[Path]:
    """Sample N frames uniformly across the shot and save as JPGs."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return []

    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    paths: list[Path] = []

    if n_frames <= 1:
        offsets = [0.5]
    else:
        offsets = [(i + 1) / (n_frames + 1) for i in range(n_frames)]

    for k, off in enumerate(offsets):
        t = shot.start + shot.duration * off
        frame_idx = int(t * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ok, frame = cap.read()
        if not ok:
            continue
        out = out_dir / f"{shot.idx:04d}_{k}.jpg"
        cv2.imwrite(str(out), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
        paths.append(out)

    cap.release()
    return paths


#: Até quantos quadros vale a pena AVANÇAR em vez de pedir um seek.
#:
#: Buscar posição num HEVC 10-bit não é barato: o decodificador volta pro
#: keyframe anterior e decodifica tudo de novo até o alvo. Avançar já
#: decodificado com `grab()` (sem converter em imagem) é muito mais barato
#: por quadro — mas só até certo ponto. 250 quadros ≈ 10s de vídeo, que é
#: cerca do intervalo entre keyframes de um encode típico: acima disso o
#: seek volta a compensar.
_AVANCO_MAXIMO = 250


def extract_keyframes_batch(
    video_path: str | Path,
    pedidos: list[tuple[int, list[int]]],
    out_dir: Path,
    quality: int = 90,
) -> dict[int, list[Path]]:
    """Extrai keyframes de VÁRIAS cenas numa passada só pelo vídeo.

    Medido em episódio real (404 cenas, HEVC 10-bit 1080p): a extração cena
    a cena custava 504ms por cena, **43% da etapa de corte inteira**. Não é
    a decodificação: é abrir o arquivo e buscar posição 3x por cena, 1212
    vezes no episódio, cada uma obrigando o decodificador a voltar pro
    keyframe anterior.

    Aqui é um `VideoCapture` só, com os quadros pedidos em ORDEM. Quando o
    próximo alvo está perto, avança com `grab()`; quando está longe, aí sim
    busca. Os quadros são os MESMOS de antes, do mesmo arquivo — isto é
    ordem de leitura, não mudança de fonte. (Extrair do clipe já cortado
    seria mais rápido ainda, mas passaria os pixels por mais uma geração de
    compressão, e são esses pixels que alimentam o reconhecimento.)

    `pedidos`: [(idx da cena, [números de quadro])]. Devolve {idx: [jpgs]}.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    saida: dict[int, list[Path]] = {}
    if not pedidos:
        return saida

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return saida

    # (quadro, idx da cena, k) ordenado — é a ordem que torna a leitura linear.
    alvos = sorted(
        (frame, idx, k)
        for idx, frames in pedidos
        for k, frame in enumerate(frames)
    )

    pos = -1
    try:
        for frame_no, idx, k in alvos:
            if pos < 0 or frame_no < pos or frame_no - pos > _AVANCO_MAXIMO:
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
                pos = frame_no
            else:
                while pos < frame_no:
                    if not cap.grab():
                        break
                    pos += 1
            ok, frame = cap.read()
            if not ok:
                continue
            pos += 1
            destino = out_dir / f"{idx:04d}_{k}.jpg"
            cv2.imwrite(str(destino), frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
            saida.setdefault(idx, []).append(destino)
    finally:
        cap.release()

    for lista in saida.values():
        lista.sort()
    return saida


def _soma_balanceada(quadros: list[int]) -> str:
    """`eq(n,a)+eq(n,b)+…` em árvore: ((a+b)+(c+d)), não a+b+c+d.

    O parser de expressão do ffmpeg aninha uma soma corrida em profundidade
    linear, e com os 1443 quadros de um episódio ele desiste com "Cannot
    allocate memory" — os keyframes saíam zerados, calados. Em árvore a
    profundidade é log2(N), ~11.
    """
    if len(quadros) == 1:
        return f"eq(n,{quadros[0]})"
    m = len(quadros) // 2
    return f"({_soma_balanceada(quadros[:m])}+{_soma_balanceada(quadros[m:])})"


def extract_keyframes_hdr(
    video_path: str | Path,
    pedidos: list[tuple[int, list[int]]],
    out_dir: Path,
) -> dict[int, list[Path]]:
    """`extract_keyframes_batch` pra fonte HDR: os MESMOS quadros, com cor.

    O OpenCV entrega o HDR desbotado e não tem como converter direito — ele
    já perdeu a informação quando reduziu pra 8 bits. Aqui o ffmpeg lê o
    vídeo uma vez, o `select` deixa passar só os quadros pedidos, e só esses
    passam pela conversão (cara) de cor. Medido: o número do quadro bate com
    o do OpenCV (`n` do select = CAP_PROP_POS_FRAMES).

    A lista de quadros vai num arquivo (`-/vf`): com 1500 quadros o filtro
    passa de 18 mil caracteres, perto do limite da linha de comando do
    Windows.
    """
    import shutil
    import tempfile

    from .ffmpeg_locate import ffmpeg_binary

    out_dir.mkdir(parents=True, exist_ok=True)
    saida: dict[int, list[Path]] = {}
    alvos = sorted({f for _, frames in pedidos for f in frames})
    if not alvos:
        return saida

    with tempfile.TemporaryDirectory(prefix="ancut-kf-") as tmp:
        tmpd = Path(tmp)
        script = tmpd / "vf.txt"
        select = _soma_balanceada(alvos)
        script.write_text(
            f"select='{select}',{_TONEMAP_VF},format=yuvj420p", encoding="ascii"
        )
        base = [ffmpeg_binary(), "-v", "error", "-y"]
        resto = [
            "-i", str(video_path), "-an", "-sn", "-dn",
            "-/vf", str(script), "-fps_mode", "passthrough",
            "-q:v", "2", "-f", "image2", str(tmpd / "q_%06d.jpg"),
        ]
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        # A GPU decodifica o HEVC de 10 bits mais rápido (19s → 14s em 5 min
        # de vídeo); sem ela, ou se falhar, a CPU faz o mesmo trabalho.
        r = subprocess.run(base + ["-hwaccel", "cuda"] + resto,
                           capture_output=True, creationflags=flags)
        saidos = sorted(tmpd.glob("q_*.jpg"))
        if r.returncode != 0 or len(saidos) != len(alvos):
            for f in saidos:
                f.unlink(missing_ok=True)
            r = subprocess.run(base + resto, capture_output=True, creationflags=flags)
            saidos = sorted(tmpd.glob("q_*.jpg"))
        if not saidos:
            # Sem isto a falha era calada: episódio sem keyframe nenhum, e a
            # descoberta respondendo "0 rostos" sem dizer por quê.
            print(
                "[CorteCenas] keyframes HDR falharam: "
                + r.stderr.decode("utf-8", "replace").strip()[-300:],
                flush=True,
            )
        # O select solta os quadros em ordem: o i-ésimo arquivo é o i-ésimo
        # quadro pedido. Se veio um número diferente (fim de arquivo antes do
        # último), casa até onde dá.
        por_quadro = dict(zip(alvos, saidos))
        for idx, frames in pedidos:
            for k, f in enumerate(frames):
                origem = por_quadro.get(f)
                if origem is None:
                    continue
                destino = out_dir / f"{idx:04d}_{k}.jpg"
                shutil.copyfile(origem, destino)
                saida.setdefault(idx, []).append(destino)

    for lista in saida.values():
        lista.sort()
    return saida


def frame_numbers_for(shot: ShotBounds, fps: float, n_frames: int) -> list[int]:
    """Quais quadros do vídeo representam esta cena. Mesma regra de sempre."""
    offsets = [0.5] if n_frames <= 1 else [
        (i + 1) / (n_frames + 1) for i in range(n_frames)
    ]
    return [int((shot.start + shot.duration * o) * fps) for o in offsets]


def cut_all_shots(
    video_path: str | Path,
    shots: list[ShotBounds],
    shots_dir: Path,
    keyframes_dir: Path,
    keyframes_per_shot: int,
    reencode: bool,
    on_progress: Callable[[int, int, int], None] | None = None,
    skip_existing: bool = True,
    render_mode: str = "off",
) -> list[tuple[ShotBounds, Path, list[Path]]]:
    """Cut shots and extract keyframes, several shots at a time.

    Each shot is an independent (ffmpeg cut + cv2 keyframes) work unit, so
    they run in a thread pool: NVENC when the GPU has it (3 workers, safe for
    every session-limited GeForce), libx264 otherwise (4 workers). One shot
    at a time on CPU was ~86% of the whole pipeline's wall clock.

    If `skip_existing` is True, shots whose .mp4 is already on disk (non-empty)
    are not re-encoded, and keyframes already present are not re-extracted.
    Trocar `render_mode` invalida só os clipes: os keyframes vêm do vídeo
    original e não mudam de formato junto.

    `on_progress` is called from THIS thread as results complete (completion
    order, monotonic count) — raising from it (PipelineCancelled) cancels all
    queued shots; in-flight ffmpeg calls finish into the cache.
    """
    shots_dir.mkdir(parents=True, exist_ok=True)
    keyframes_dir.mkdir(parents=True, exist_ok=True)

    # Clipe cortado noutro modo tem OUTRO formato, então reaproveitá-lo do
    # cache faria ligar a opção não mudar nada — o pior tipo de falha, a
    # silenciosa. O modo usado fica gravado ao lado dos clipes; se mudou,
    # todos são recortados.
    stamp = shots_dir / ".export_mode"
    try:
        previous = stamp.read_text(encoding="utf-8").strip()
    except OSError:
        # Sem marcador: ou é a primeira análise, ou os clipes vêm de uma versão
        # anterior a esta opção. Nos dois casos "off" é a suposição correta.
        previous = "off"
    # Só os CLIPES perdem a validade. Os keyframes são extraídos do vídeo
    # original, não do clipe, então o formato de export não os afeta — jogá-los
    # fora junto custaria milhares de decodificações à toa.
    reuse_cuts = skip_existing
    if previous != render_mode:
        reuse_cuts = False
        if any(shots_dir.glob("*.mp4")):
            print(
                # Sem "→" nem travessão: o console do Windows é cp1252 e
                # estoura com UnicodeEncodeError em caractere fora dela,
                # derrubando a análise inteira por causa de um log.
                f"[CorteCenas] Formato de export mudou ({previous} -> {render_mode})"
                " - recortando os clipes",
                flush=True,
            )
    try:
        stamp.write_text(render_mode, encoding="utf-8")
    except OSError:
        pass  # marcador é otimização, não pode derrubar a análise

    # Fonte HDR: clipes E keyframes saem convertidos pra SDR. Corte HDR feito
    # antes da conversão não tem a marca `.cor` e é refeito inteiro — senão o
    # episódio já cortado continuaria desbotado pra sempre, e é justamente
    # ele que a pessoa vai identificar depois. Fonte SDR não muda nada.
    hdr = fonte_hdr(video_path)
    cor_stamp = shots_dir / ".cor"
    cor_atual = COR_VERSAO if hdr else "original"
    try:
        cor_antes = cor_stamp.read_text(encoding="utf-8").strip()
    except OSError:
        cor_antes = "original"
    refazer_kfs = cor_antes != cor_atual
    if refazer_kfs:
        reuse_cuts = False
        if any(shots_dir.glob("*.mp4")):
            print(
                f"[CorteCenas] Cor mudou ({cor_antes} -> {cor_atual})"
                " - recortando clipes e keyframes",
                flush=True,
            )
    try:
        cor_stamp.write_text(cor_atual, encoding="utf-8")
    except OSError:
        pass

    # fps do vídeo, sondado uma vez: o corte usa meia duração de frame como
    # margem pra não deixar o primeiro frame do shot seguinte vazar pro clipe.
    probe = cv2.VideoCapture(str(video_path))
    video_fps = probe.get(cv2.CAP_PROP_FPS) if probe.isOpened() else 0.0
    probe.release()
    if not video_fps or video_fps <= 0 or video_fps != video_fps:
        video_fps = 24.0

    total = len(shots)
    # Shared, mutated on NVENC runtime failure (driver/session hiccup): the
    # remaining shots silently switch to libx264. Benign race — worst case a
    # couple extra NVENC attempts before every worker sees the flag.
    enc_state = {"nvenc": reencode and nvenc_available()}
    workers = _NVENC_WORKERS if enc_state["nvenc"] else _CPU_WORKERS
    workers = max(1, min(workers, os.cpu_count() or 4, total or 1))

    # --- keyframes: uma passada só, ANTES do corte ---
    #
    # Fica fora do pool de propósito. As três leituras de uma cena são
    # aleatórias no arquivo, e três threads pedindo posições diferentes no
    # mesmo vídeo brigam pelo mesmo decodificador. Em ordem, sequencial, uma
    # `VideoCapture` só, sai mais barato do que paralelo mal feito.
    esperados = {
        s.idx: [keyframes_dir / f"{s.idx:04d}_{k}.jpg" for k in range(keyframes_per_shot)]
        for s in shots
    }
    faltando = [
        s for s in shots
        if refazer_kfs or not (skip_existing and all(
            p.exists() and p.stat().st_size > 0 for p in esperados[s.idx]
        ))
    ]
    if refazer_kfs:
        # Os de cor velha não podem ficar: `process` lá embaixo usa o que
        # existir no disco quando a extração nova ainda não terminou.
        for lista in esperados.values():
            for p in lista:
                p.unlink(missing_ok=True)
    # E roda EM PARALELO com os cortes, não antes deles: extrair keyframe é
    # decodificação na CPU, cortar clipe é codificação na GPU (NVENC). São
    # recursos diferentes, então uma espera não precisa custar a outra.
    extraidos: dict[int, list[Path]] = {}
    kf_pool = ThreadPoolExecutor(max_workers=1) if faltando else None
    kf_future = (
        kf_pool.submit(
            extract_keyframes_hdr if hdr else extract_keyframes_batch,
            video_path,
            [(s.idx, frame_numbers_for(s, video_fps, keyframes_per_shot))
             for s in faltando],
            keyframes_dir,
        )
        if kf_pool
        else None
    )

    def process(shot: ShotBounds) -> tuple[ShotBounds, Path, list[Path], bool] | None:
        out_file = shots_dir / f"{shot.idx:04d}.mp4"
        expected_kfs = esperados[shot.idx]

        have_cut = out_file.exists() and out_file.stat().st_size > 0
        have_kfs = all(p.exists() and p.stat().st_size > 0 for p in expected_kfs)

        if not (reuse_cuts and have_cut):
            try:
                cut_shot(video_path, shot, out_file, reencode=reencode,
                         use_nvenc=enc_state["nvenc"], fps=video_fps,
                         render_mode=render_mode, hdr=hdr)
            except ffmpeg.Error:
                if enc_state["nvenc"]:
                    enc_state["nvenc"] = False
                    print(
                        f"[CorteCenas] NVENC falhou no shot {shot.idx} — "
                        "continuando na CPU (libx264)",
                        flush=True,
                    )
                    try:
                        cut_shot(video_path, shot, out_file, reencode=reencode,
                                 use_nvenc=False, fps=video_fps,
                                 render_mode=render_mode, hdr=hdr)
                    except ffmpeg.Error:
                        return None
                else:
                    return None

        # Os keyframes desta cena talvez ainda estejam sendo extraídos na
        # outra thread — a lista definitiva é preenchida depois do join.
        # Ler `extraidos` aqui seria corrida: o dicionário está sendo escrito.
        kfs = expected_kfs if have_kfs else []

        # "Pulado" no contador de progresso significa que NADA foi refeito —
        # com o formato trocado o clipe é recortado, então não conta.
        return shot, out_file, kfs, (reuse_cuts and have_cut and skip_existing and have_kfs)

    indexed: list[tuple[ShotBounds, Path, list[Path]] | None] = [None] * total
    done = 0
    skipped = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process, shot): i for i, shot in enumerate(shots)}
        try:
            for fut in as_completed(futures):
                res = fut.result()
                done += 1
                if res is not None:
                    shot, out_file, kfs, was_skipped = res
                    indexed[futures[fut]] = (shot, out_file, kfs)
                    if was_skipped:
                        skipped += 1
                if on_progress:
                    on_progress(done, total, skipped)
        except BaseException:
            # PipelineCancelled (or anything else) — drop everything queued;
            # shots already encoding finish into the cache and get reused on
            # the next run.
            pool.shutdown(wait=False, cancel_futures=True)
            if kf_pool:
                kf_pool.shutdown(wait=False, cancel_futures=True)
            raise

    if kf_future is not None:
        try:
            extraidos = kf_future.result()
        except Exception as e:  # noqa: BLE001 — sem keyframe a cena segue viva
            print(f"[CorteCenas] falha extraindo keyframes: {e}", flush=True)
        finally:
            kf_pool.shutdown(wait=True)  # type: ignore[union-attr]

    # Agora sim: quem ficou sem keyframe na hora do corte recebe os da
    # passada paralela.
    resultado: list[tuple[ShotBounds, Path, list[Path]]] = []
    for r in indexed:
        if r is None:
            continue  # ffmpeg não cortou esta cena
        shot, out_file, kfs = r
        resultado.append((shot, out_file, kfs or extraidos.get(shot.idx, [])))
    return resultado
