from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from platformdirs import user_config_dir, user_data_dir, user_documents_dir, user_log_dir

# [Studio] Nome proprio. Com "CorteCenas" este motor lia e gravava a mesma
# pasta (config.json, index.db, refs do elenco) do Corte Cenas do Levi e do
# AnCut HUB, que dividem %LOCALAPPDATA%\CorteCenas. Ver STUDIO.md.
APP_NAME = "AniRecapStudioMotor"

# [Studio] A pasta de dados que o AniRecap Studio passa (<userData>/motor).
# Com ela, config, cache (index.db, refs), modelos e logs moram ali, rodando
# do fonte ou empacotado. Sem ela (motor rodado a mao), vale o APP_NAME acima.
_DADOS_DO_HOST = os.environ.get("ANIRECAP_MOTOR_DADOS", "").strip()
DADOS_DIR: Path | None = Path(_DADOS_DO_HOST) if _DADOS_DO_HOST else None

CONFIG_DIR = DADOS_DIR if DADOS_DIR is not None else Path(user_config_dir(APP_NAME))
CONFIG_FILE = CONFIG_DIR / "config.json"
# [Studio] app.log e crash.log (applog.py e run.py) tambem saem do CorteCenas.
LOG_DIR = DADOS_DIR / "logs" if DADOS_DIR is not None else Path(user_log_dir(APP_NAME))

# When PyInstaller-frozen, `PROJECT_ROOT` points inside Program Files —
# read-only for non-admins. Use the current user's Documents / LocalAppData
# instead, so the installed app can write without UAC prompts.
_FROZEN = getattr(sys, "frozen", False)

# Only these fields are written to the JSON between sessions. Matching
# parameters live in this file and are controlled by the code — editing
# `config.py` applies on the next run without needing to touch the JSON.
_PERSISTED_FIELDS = (
    "output_dir",
    "last_anime",
    "last_season",
    "last_episode",
    "default_threshold",
    "argmax_margin",
    "min_shots_per_character",
    "face_crop_padding",
    "credit_edge_threshold",
    # skip_credit_shots: intentionally NOT persisted — the heuristic is
    # fragile and we keep it OFF by default.
    "use_danbooru",
    "media_kind",
    "tmdb_api_key",
    "navyai_api_key",
    "navyai_base_url",
    "navyai_model",
    "gemini_api_key",
    "gemini_model",
    "gpu_warning_dismissed",
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if DADOS_DIR is not None:
    # [Studio] Rodando pelo Studio: tudo na pasta de dados que ele passou. A
    # saida padrao e a biblioteca padrao do Studio; o `run` usa a outputDir
    # da requisicao de qualquer jeito.
    DEFAULT_OUTPUT = Path(user_documents_dir()) / "AniRecap Studio" / "Biblioteca"
    DEFAULT_CACHE = DADOS_DIR / "cache"
    DEFAULT_MODELS = DADOS_DIR / "models"
elif _FROZEN:
    # Installed app: write to user profile locations.
    # [Studio] Era Documents/CorteCenas/Output: a saida do AnCut, so leitura.
    DEFAULT_OUTPUT = Path(user_documents_dir()) / "AniRecap Studio" / "Biblioteca"
    DEFAULT_CACHE = Path(user_data_dir(APP_NAME)) / "cache"
    DEFAULT_MODELS = Path(user_data_dir(APP_NAME)) / "models"
else:
    # Running from source (git clone + run.bat): keep everything project-relative
    # so `cache/` and `Output/` stay next to the code for debugging.
    DEFAULT_OUTPUT = PROJECT_ROOT / "Output"
    DEFAULT_CACHE = PROJECT_ROOT / "cache"
    DEFAULT_MODELS = PROJECT_ROOT / "models"


def _is_writable(p: Path) -> bool:
    """Cheap check: try creating the dir + a probe file. True on success."""
    try:
        p.mkdir(parents=True, exist_ok=True)
        probe = p / ".write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True
    except OSError:
        return False


def _looks_like_program_files(path: str) -> bool:
    """True if `path` is inside Windows' Program Files. Used to migrate
    stale config from an early install that wrote paths there."""
    try:
        s = str(Path(path).resolve()).lower()
    except OSError:
        s = str(path).lower()
    return (
        "program files" in s
        or s.startswith("c:\\windows")
        or s.startswith("c:/windows")
    )


@dataclass
class Config:
    output_dir: str = str(DEFAULT_OUTPUT)
    cache_dir: str = str(DEFAULT_CACHE)
    models_dir: str = str(DEFAULT_MODELS)

    # Shot detection
    #: Piso absoluto de diferença entre quadros. NÃO é mais o gatilho do
    #: corte (ver `shot_detection.detect_shots`): existe só pra barrar ruído
    #: em cena parada. Quem dispara o corte é a comparação com a vizinhança.
    scene_min_content: float = 15.0
    #: Quantas vezes acima da média móvel a diferença precisa estar pra virar
    #: corte. É isto que enxerga corte em cena escura, onde o limiar fixo de
    #: antes (27) não chegava nunca.
    #:
    #: Começou em 3,0 e desceu pra 2,0: em cena de ação piscando, a média já é
    #: enorme e nenhum corte chega a 3x ela. Ver `shot_detection.detect_shots`.
    scene_adaptive_ratio: float = 2.0
    min_shot_seconds: float = 0.6

    # Cutting
    reencode_shots: bool = True
    # Formato de saída dos clipes. Separado em dois níveis DE PROPÓSITO, pra
    # dar pra medir um sem o outro:
    #
    #   "off"     como sempre foi
    #   "compat"  8 bits + 23,976 CFR. H.264 High 10 não é decodificado pelo
    #             WebCodecs nem pelo NVDEC da maioria das placas, então clipe
    #             10-bit cai em decode por software no pipeline de render.
    #   "intra"   compat + todo frame keyframe (seek quadro a quadro barato).
    #             Custa ~1,84x de tamanho de arquivo.
    #
    # Se "compat" já resolver o gargalo, "intra" fica desnecessário e o
    # arquivo continua pequeno.
    render_export_mode: str = "off"

    # Keyframes per shot used for recognition
    keyframes_per_shot: int = 3

    # Reference images per character to download
    references_per_character: int = 8
    # With franchise pooling we easily get 60-80 characters for long series;
    # the min_references filter naturally drops the weakly-covered ones.
    max_characters_per_anime: int = 80
    # Quantos personagens ganham a GALERIA do MyAnimeList (várias fotos).
    #
    # Esta é a etapa mais cara da análise inteira: é uma chamada de API por
    # personagem, espaçadas por rate-limit, e medimos 44% do tempo total indo
    # embora aqui (10 min num elenco de 80). Os personagens vêm ordenados por
    # papel, então os N primeiros são os principais — que é onde ter muitas
    # referências realmente muda o reconhecimento.
    #
    # Quem fica de fora NÃO fica sem nada: todo personagem recebe os retratos
    # oficiais de MAL + AniList + Kitsu (até 3 imagens), acima do mínimo de
    # `min_references_per_character`. E o "reforçar refs" do próprio episódio
    # cobre o resto com o tempo.
    gallery_for_top_characters: int = 18
    # Danbooru has wide coverage but often returns fan art with multiple
    # characters in the same image → contaminates centroids. Off by default.
    use_danbooru: bool = False

    # Matching
    default_threshold: float = 0.80
    # Multi-protótipo: um centroide único por personagem mistura aparências
    # incompatíveis (cabelo solto/preso, uniforme/armadura, chibi/arte
    # oficial) num vetor médio que não parece com NENHUMA delas. Em vez
    # disso, as refs são agrupadas por "modo visual" (average-linkage) e
    # cada grupo vira um protótipo — a similaridade do rosto é contra o
    # protótipo mais parecido, não contra a média de tudo.
    multi_prototype: bool = True
    prototype_merge_threshold: float = 0.80  # refs acima disso fundem no mesmo protótipo
    max_prototypes_per_character: int = 5
    # When True, shots with zero detected faces get no character assignment
    # (instead of falling back to whole-keyframe matching, which produces
    # false positives on scenes that merely share color/composition with
    # a character's refs — e.g. food shots matching an orange-clothed char).
    # With YOLO anime-face catching ~58% of shots, this tradeoff favours
    # precision over recall.
    face_exclusive_when_detected: bool = True
    min_references_per_character: int = 2   # chars with fewer refs are ignored
    argmax_margin: float = 0.03             # best must beat 2nd by this
    min_shots_per_character: int = 4        # post-hoc: chars under this get dropped
    min_keyframe_votes: int = 2             # char must be detected in >=N keyframes

    # Modo híbrido (CLIP decide, IA revisa os duvidosos): um shot SEM
    # personagem atribuído cuja melhor similaridade ficou em
    # [ai_review_low, default_threshold) é "quase" — vai pra IA desempatar.
    ai_review_low: float = 0.62
    ai_review_max_shots: int = 150          # teto de custo por episódio

    # Segunda passada: cenas identificadas com confiança viram referências
    # temporárias do próprio episódio (mesmo traço/ângulo/luz) e as cenas sem
    # dono são recomparadas contra elas. Resolve o clássico "mesma cena, mesmo
    # ângulo, uma identificada e a outra pulada". Threshold 0.86 = o corte de
    # "mesma identidade" do clustering da Descoberta (mesmos embeddings).
    second_pass: bool = True
    second_pass_threshold: float = 0.86
    second_pass_min_sources: int = 2        # shots-fonte mínimos por personagem
    second_pass_max_bank: int = 40          # refs de episódio máximas por personagem

    # Resgate por GRUPO (Descoberta embutida no verde): os rostos que
    # sobraram sem dono são agrupados entre si (mesma pessoa a 0.86+ no
    # próprio episódio) e o GRUPO é comparado com os protótipos — mediana
    # de representantes diversos, com margem e concordância. Evidência
    # agregada permite régua mais baixa que a de um crop isolado; grupos
    # que nem assim resolverem vão pra tela de batismo no fim.
    cluster_rescue: bool = True
    cluster_min_faces: int = 5              # rostos mínimos pra decidir por grupo
    cluster_min_shots: int = 3              # espalhados por N cenas no mínimo
    cluster_min_sim: float = 0.72           # mediana mínima vs protótipos
    cluster_margin: float = 0.05            # folga sobre o 2º candidato
    cluster_agreement: float = 0.6          # fração dos reps votando no top-1
    cluster_review_low: float = 0.62        # acima disso (sem aceitar) → IA por grupo
    cluster_max_reps: int = 8               # representantes diversos por grupo
    # Auto-nomear um grupo exige que o personagem vencedor tenha referências
    # DE VERDADE: com menos de N rostos detectados nas refs (retratos sem
    # rosto não contam), a decisão vira sugestão no batismo — caso real:
    # cluster de 17 rostos auto-nomeado com protótipos de 2 retratinhos.
    cluster_min_ref_faces: int = 3

    # --- anti-fantasma ---
    #
    # O caso: um personagem que NÃO está no episódio aparece com duas ou três
    # cenas raspando o threshold, e vira pasta. Quem quase sempre faz isso é
    # quem tem referências fracas — poucos rostos detectados nas fotos —
    # porque os protótipos dele acabam representando pose e fundo em vez de
    # rosto, e pose e fundo casam com qualquer coisa.
    #
    # Duas exigências, nessa ordem:
    #  1) refs fracas pagam régua mais alta pra cada cena (`weak_ref_penalty`);
    #  2) e o personagem só EXISTE no episódio se cravar pelo menos uma cena
    #     bem acima da dúvida (`anchor_threshold`) — a cena-âncora. Sem
    #     nenhuma, as atribuições automáticas dele caem inteiras.
    #
    # A âncora é o ponto: exigir só "mais cenas" não resolve, porque refs
    # ruins erram MUITAS cenas com a mesma confiança medíocre. Uma única
    # certeza vale mais que dez talvez.
    # --- CCIP: a segunda opinião ---
    #
    # O CLIP decide raspando: a margem média entre 1º e 2º colocado é 0,077.
    # O CCIP (deepghs) foi treinado exatamente pra "estes dois desenhos são a
    # mesma pessoa?" e publica a própria régua: F1 0,917 com corte em 0,1784
    # de DIFERENÇA. Medido nas refs deste acervo (5 personagens, 6 fotos
    # cada): mesma pessoa fica em 0,002-0,238; pessoas diferentes começam em
    # 0,209 — separação folgada onde o CLIP empata.
    #
    # É VETO, não substituto. Só entra nas decisões apertadas do CLIP (as que
    # passaram raspando o threshold), que é onde ele erra. Nas decisões
    # confortáveis não é nem consultado — custaria CPU pra confirmar o óbvio.
    ccip_veto: bool = True
    ccip_veto_band: float = 0.06     # "apertada" = até isto acima do threshold
    ccip_max_refs: int = 6           # rostos de referência por personagem
    ccip_max_faces: int = 3          # rostos da cena comparados

    weak_ref_faces: int = 3          # menos que isto = referências fracas
    weak_ref_penalty: float = 0.03   # somado ao threshold desse personagem
    anchor_threshold: float = 0.88   # a cena que prova que ele está aqui
    face_crop_padding: float = 0.25         # around detected face; more context helps CLIP
    # AI hybrid mode crops get WIDER padding so hair/headband is fully
    # visible — that's often the only thing telling apart similar-styled
    # characters (Chrome vs Senku, Kohaku vs Ruri, etc.).
    face_crop_padding_ai: float = 0.55

    # Credit/text-overlay shot filter (OP/ED, credits rolls).
    # OFF by default — the heuristic over-fires on rich art (witch hats,
    # complex labs, crowded scenes). Use manual OP/ED time skip in the UI
    # for reliable credit exclusion. Users can still flip this on per run.
    skip_credit_shots: bool = False
    credit_edge_threshold: float = 0.55
    credit_min_keyframes: int = 2
    # ViT-L/14: ~890MB download on first run, much better anime discrimination
    # than ViT-B/32. Fine on a 5080 (≈1.5GB VRAM, seconds per episode).
    #: "anime" ou "live" (filme, série com gente de verdade).
    #:
    #: Decide QUEM olha o rosto: em anime, o YOLO da deepghs + CLIP; em live
    #: action, SCRFD + ArcFace (`matching/rosto_real.py`). Não é preferência
    #: — é o par de modelos que sabe responder a pergunta daquele material.
    media_kind: str = "anime"

    #: Chave da API do TMDB — o "AniList do cinema": elenco com foto de cada
    #: ator. Vazia, o live action só funciona pelo Modo Descoberta (agrupa os
    #: rostos e você dá os nomes), que não depende de fonte nenhuma.
    tmdb_api_key: str = ""

    clip_model: str = "ViT-L-14"
    clip_pretrained: str = "openai"

    # GPU
    # [Studio] ANIRECAP_MOTOR_SEM_CUDA=1: a placa nao roda o torch do runtime
    # (GTX 10xx no cu128, sm < 7.5): o torch vai para a CPU, mas o ffmpeg segue
    # com o NVENC/NVDEC da placa. O CUDA_VISIBLE_DEVICES=-1 de antes desligava
    # os dois.
    use_cuda: bool = os.environ.get("ANIRECAP_MOTOR_SEM_CUDA", "") != "1"  # falls back to CPU automatically if unavailable

    # UI
    language: str = "pt"

    last_anime: str = ""
    last_season: int = 1
    last_episode: int = 1

    # AI review — primary provider (NavyAI, OpenAI-compatible gateway).
    # Optional; if no key is set, the AI features are disabled.
    navyai_api_key: str = ""
    navyai_base_url: str = "https://api.navy/v1"
    navyai_model: str = "gemini-2.5-flash"

    # AI review — fallback provider (Gemini native, hit directly via Google's
    # OpenAI-compatible endpoint). Kicks in automatically if NavyAI returns
    # 5xx / rate-limits / errors. Useful with the free tier of both — when one
    # exhausts, the other picks up the slack.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # Whether the user has already seen the "no NVIDIA GPU, will run on CPU"
    # warning. Once dismissed, we don't nag on every startup.
    gpu_warning_dismissed: bool = False

    @classmethod
    def load(cls) -> "Config":
        cfg = cls()
        if CONFIG_FILE.exists():
            try:
                data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
                for k in _PERSISTED_FIELDS:
                    if k in data:
                        setattr(cfg, k, data[k])
            except Exception:
                pass
        # Migration: model names retired by the providers. NavyAI removed
        # gemini-2.0-flash in 2026 (every request 400s with model_not_found)
        # and Google retires old Gemini lines on a similar cadence — swap
        # any dead persisted name for the current default.
        _DEAD_MODELS = {
            "gemini-2.0-flash", "gemini-2.0-flash-lite",
            "gemini-1.5-flash", "gemini-1.5-pro",
        }
        for attr in ("navyai_model", "gemini_model"):
            if getattr(cfg, attr) in _DEAD_MODELS:
                setattr(cfg, attr, "gemini-2.5-flash")
        # Migration: if a persisted output_dir points somewhere unwritable
        # (e.g. old install that pointed inside Program Files), reset to the
        # current safe default. Same for cache/models.
        if _FROZEN:
            for attr, default in (
                ("output_dir", DEFAULT_OUTPUT),
                ("cache_dir", DEFAULT_CACHE),
                ("models_dir", DEFAULT_MODELS),
            ):
                current = getattr(cfg, attr)
                if _looks_like_program_files(current):
                    setattr(cfg, attr, str(default))
        return cfg

    def save(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        payload = {k: getattr(self, k) for k in _PERSISTED_FIELDS}
        CONFIG_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    @property
    def output_path(self) -> Path:
        return Path(self.output_dir)

    @property
    def cache_path(self) -> Path:
        return Path(self.cache_dir)

    @property
    def models_path(self) -> Path:
        return Path(self.models_dir)

    def ensure_dirs(self) -> None:
        """Create the working dirs. If a persisted path is unwritable —
        classic case: install upgraded across versions where old default
        pointed into Program Files — fall back to the current safe default
        for that path and persist the fix so we don't crash next time."""
        fallbacks = {
            "output_dir": DEFAULT_OUTPUT,
            "cache_dir": DEFAULT_CACHE,
            "models_dir": DEFAULT_MODELS,
        }
        dirty = False
        for attr in fallbacks:
            current = Path(getattr(self, attr))
            try:
                current.mkdir(parents=True, exist_ok=True)
            except (OSError, PermissionError):
                new_path = fallbacks[attr]
                new_path.mkdir(parents=True, exist_ok=True)
                setattr(self, attr, str(new_path))
                dirty = True
        (self.cache_path / "anime_db").mkdir(parents=True, exist_ok=True)
        if dirty:
            try:
                self.save()
            except Exception:
                pass
