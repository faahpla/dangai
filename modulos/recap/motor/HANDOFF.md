# AnCut HUB — Briefing para próxima iteração

**Objetivo deste documento:** dar ao próximo assistente (Fable 5, ou quem for) contexto suficiente pra entender o projeto sem ler cada linha, um panorama honesto do que está feito, e uma lista priorizada do que ainda vale atacar.

**Data do snapshot:** julho de 2026, versão atual publicada: v0.1.7.

**Repo:** https://github.com/leviclementino1-creator/corte-cenas

---

## 1. O que o AnCut HUB é

App desktop Windows (Python + PySide6) que **analisa um episódio de anime**, corta em shots, identifica personagens automaticamente e organiza os clipes por personagem/dupla — **sem exigir que o usuário alimente pastas de referência manualmente**.

**Fluxo típico:**
1. Usuário arrasta um `.mp4` de episódio.
2. App detecta shots (PySceneDetect), corta com FFmpeg.
3. Busca metadata do anime (AniList → Jikan fallback) + baixa fotos dos personagens.
4. Gera embeddings CLIP dos personagens (centroide por personagem) e dos rostos detectados em cada shot (YOLO anime-face).
5. Match por cosine + threshold → cada shot vira hardlink em `by_character/<Nome>/` e `by_pair/<A>+<B>/`.
6. Usuário abre a aba Resultados, vê thumbnails, aprova/rejeita/move manualmente.
7. Pode gerar versão vertical 1080×1920 pra Reels/TikTok focada no rosto do personagem.

**Público-alvo:** um usuário técnico (o dono do projeto) e 2-3 amigos que ele quer distribuir pra usarem. Não é comercial, não é escala.

---

## 2. Stack técnica

### Backend / Core
- **Python 3.11** (torch precisa 3.11 no Windows com CUDA 12.8)
- **PySide6** para UI (Qt6)
- **torch + CUDA 12.8** com fallback CPU
- **open_clip** (`ViT-L/14`, pretrained `openai`) para embeddings
- **ultralytics + huggingface_hub** para YOLO anime-face (`deepghs/anime_face_detection`)
- **PySceneDetect** (`ContentDetector`) para shot boundaries
- **ffmpeg-python** com `ffmpeg.exe` bundled (dispensa PATH no user)
- **SQLite** (`cache/index.db`) para persistência de shots, personagens, refs

### Providers de dados
- **AniList GraphQL** (search + relations pra franchise pooling)
- **Jikan REST v4** (character pictures + fallback de search quando AniList tá offline)
- **Danbooru** (opt-in, off por padrão, tende a contaminar centroides com fan-art multi-char)

### AI (opcional)
- **NavyAI** (gateway OpenAI-compat, primary)
- **Google Gemini nativo** (fallback via OpenAI-compat endpoint `generativelanguage.googleapis.com/v1beta/openai`)

### Distribuição
- **PyInstaller** (onedir, `console=False`, dist ~5 GB uncompressed)
- **Inno Setup 6** empacota em `.exe` (~1.9 GB compressed com LZMA2 max)
- **GitHub Releases** como CDN
- **Auto-update via delta zip** (~53 MB, aplicado por PowerShell helper elevado)

---

## 3. Layout de arquivos

```
app/
  main.py                  entrada QApplication, splash, checagens
  __init__.py              __version__
  pipeline.py              orquestra tudo (~900 linhas — o arquivo mais gordo)
  pipeline_types.py        AIMode, PipelineResult, STAGES (light, sem torch)
  config.py                Config dataclass, load/save, paths per-frozen/source
  updater.py               GitHub API check, delta zip + full setup fallback
  deps_check.py            ffmpeg + cuda + yolo/hf deps
  ffmpeg_locate.py         resolve bundled vs PATH + run_ffmpeg_hidden helper
  ai_review.py             NavyAIClient + Gemini fallback + classify_*
  video_ingest.py          parse do nome do arquivo (regex)
  shot_detection.py        wrapper PySceneDetect
  keyframe_extractor.py    corte + keyframes (ffmpeg-python)
  reframe.py               vertical 9:16 com face-tracking
  harvest.py               reforço de refs a partir de shots identificados

  providers/
    anilist.py             GraphQL search + relations
    jikan.py               REST + search fallback
    danbooru.py            (off por padrão)
    anime_provider.py      resolver unificado + franchise pooling BFS

  references/
    image_downloader.py    httpx async
    image_filters.py       saturação HSV → drop de manga refs
    reference_store.py     layout de cache/anime_db/<id>/characters/<slug>/

  matching/
    face_detector.py       YOLO deepghs + lbpcascade fallback
    embedding_engine.py    open_clip wrapper com CUDA fallback
    character_matcher.py   centroides + cosine + threshold + argmax_margin
    cooccurrence.py        contagem de pares (A+B) por shot
    credit_detector.py     text_area × connected_components (off por padrão)

  storage/
    db.py                  schema + queries SQLite
    metadata_writer.py     shots.json + characters.json por episódio
    organizer.py           hardlinks NTFS by_character / by_pair
    skip_ranges.py         OP/ED time-skip

  ui/
    main_window.py         topo com GPU badge + settings + tabs + closeEvent
    analyze_tab.py         seleção, presets, botão IA dropdown (~600 linhas)
    results_tab.py         lista chars + grid + right-click actions (~500)
    character_grid.py      thumbs + context menu (approve/remove/move)
    settings_dialog.py     3 grupos: NavyAI, Gemini, Sobre/Atualizações (com scroll)
    deps_dialog.py         MissingDeps, FFmpeg, NoGpu
    worker.py              QThread wrappers (lazy-import torch)

  assets/
    icon.ico + icon_*.png  7 tamanhos gerados por scratchpad/gen_icon.py

bin/                       (não versionado — baixado por fetch_ffmpeg.py)
  ffmpeg.exe               empacotado no instalador
  ffprobe.exe

cache/                     (não versionado, per-frozen vai pra %LOCALAPPDATA%)
  index.db                 SQLite global
  anime_db/<id>/characters/<slug>/*.jpg
  huggingface/             modelos (YOLO ~22 MB, CLIP ViT-L/14 ~890 MB)

Output/<Anime>/SxxEyy/     (default: Documentos\CorteCenas\Output\ quando frozen)

# Scripts de build
fetch_ffmpeg.py            baixa ffmpeg release-essentials e extrai pra ./bin/
pack_delta.py              gera CorteCenas-Update-X.Y.Z.zip do dist/ (~53 MB)
apply_update.ps1           PowerShell elevado que aplica o delta zip
_build_all.bat             orquestrador local (fetch → PyInstaller → pack_delta → Inno)
build.spec                 spec do PyInstaller
installer.iss              spec do Inno Setup

# Distribuição / user setup
install.bat                cria .venv + baixa torch cu128 + demais deps (para dev)
run.bat                    ativa .venv + roda run.py (para dev)
```

---

## 4. Sistema de update (importante entender)

### Instalação inicial
Usuário baixa **`CorteCenas-Setup-X.Y.Z.exe`** (~1.94 GB) do GitHub Releases. Roda o Inno Setup, instala em `C:\Program Files\CorteCenas\` com atalhos, entrada em Adicionar/Remover, etc.

### Update automático
1. Ao abrir, `check_and_offer_update()` hita `api.github.com/repos/.../releases/latest`.
2. Se `tag_name` > `__version__`, mostra dialog.
3. User aceita → prefere baixar `CorteCenas-Update-X.Y.Z.zip` (~53 MB) se existir; senão cai no `-Setup-X.Y.Z.exe` (~1.94 GB).
4. Se delta:
   - Extrai zip pra `%TEMP%\CorteCenas-Update-X.Y.Z-extract\`
   - Chama `ShellExecuteW` verb `runas` no `powershell.exe apply_update.ps1 -Source <extract> -Install <program_files>`
   - UAC solicita permissão
   - PowerShell espera app fechar, robocopy /E aplica, relança o exe
5. Se setup completo: `ShellExecute runas` no setup.exe com `/VERYSILENT /RESTARTAPPLICATIONS /CLOSEAPPLICATIONS`.

### O que está no delta zip
Whitelist definida em `pack_delta.py`:
- `CorteCenas.exe`
- `_internal/app/**` (nossos assets + apply_update.ps1)

**Não** inclui torch, PySide6, FFmpeg, CUDA DLLs, HuggingFace deps. Esses só voltam a atualizar quando `build.spec` mudar (e aí user baixa o setup full de novo).

### Limitação real do delta
Se alguma dependência Python mudar em `requirements.txt` (por ex. bump `open_clip` ou `torch`), o delta **NÃO** carrega o pacote atualizado. Precisa detectar isso no `pack_delta.py` e falhar / avisar "esse update precisa do setup completo".

Hoje o `pack_delta.py` sempre roda e sempre gera zip — **não checa se deps mudaram**. É um risco: se eu fizer `pip install torch==2.9` em local e rodar build, o dist tem torch novo mas o zip só carrega nosso código. Usuário pega update quebrado.

---

## 5. Histórico de versões (contexto rápido)

| Versão | O que mudou |
|--------|-------------|
| v0.1.0 | Primeira release pública. NavyAI (Gemini via gateway) apenas. |
| v0.1.1 | Gemini como fallback direto, botão manual "Verificar atualizações", checagem de FFmpeg no startup, ícone, botão Configurações repositionado. |
| v0.1.2 | FFmpeg embutido no instalador (~200 MB), detecção de GPU + fallback CPU, README reescrito user-first. |
| v0.1.3 | **Crítico:** fix crash em Program Files (paths mudaram pra Documentos/LocalAppData), `console=False`, crash handler dialog + log. |
| v0.1.4 | Settings dialog com scroll (botões Salvar/Cancelar fixos no bottom). |
| v0.1.5 | Skipped — foi absorvido em v0.1.6. |
| v0.1.6 | Startup 25x mais rápido (10s → 0.4s, lazy import de torch), updater com UAC direto (ShellExecute runas), CMD popup dos shots sumiu (CREATE_NO_WINDOW), Jikan fallback quando AniList offline, **delta updates ~53 MB**. |
| v0.1.7 | Splash screen, badge GPU/CPU no topo, fallback AniList visível, mensagem "preparando ambiente" na primeira análise. |

Todas as releases anteriores a v0.1.3 são publicamente marcadas com aviso `🚨 versão quebrada — use v0.1.3+`.

---

## 6. Análise técnica honesta

### O que está bom
- **Arquitetura por camadas**: providers isolados de UI, workers em QThread, pipeline stage-based com progress callback. Fácil trocar peças.
- **Fallbacks reais**: NavyAI → Gemini automático, AniList → Jikan automático, GPU → CPU automático, YOLO → lbpcascade automático. Nenhum é "config-only", todos funcionam sem intervenção.
- **Cache agressivo**: shot detection cached por arquivo, embeddings de referência salvos no SQLite (blob), franchise inteira em `cache/anime_db/al<root>/`. Reprocessar é rápido.
- **Delta updates funcionando**: 53 MB por update em vez de 2 GB é uma melhoria de 36×. Já é production-grade.
- **Crash handler**: qualquer erro fatal vira dialog + log em `%LOCALAPPDATA%\CorteCenas\logs\crash.log`. User pode enviar sem precisar reproduzir.

### O que é técnica dívida
- **`pipeline.py` está gigante (~900 linhas)** e mistura orquestração com detalhes de matching. `_run_ai_recognition` e o path CLIP dividem `_finalize_episode` mas o resto é duplicado. Boa candidato pra split em `pipelines/clip_pipeline.py` + `pipelines/ai_pipeline.py`.
- **Config é misturada**: `_PERSISTED_FIELDS` é whitelist manual. Se adicionar campo e esquecer de listar, silenciosamente não persiste. Deve migrar pra `pydantic-settings` ou similar.
- **Zero testes automatizados.** Nada. Cada bump de versão é blind — só testado manualmente no PC do dev. Um teste de smoke no build de release seria altíssimo valor.
- **Nenhum CI/CD.** Build é local, upload é local, tag é local. Se der GH Action pra rodar `_build_all.bat` num runner Windows GPU-less (dá pra fazer CPU-only build) e postar no release, elimina o gargalo do dev.
- **`_build_all.bat` tem paths hardcoded (`G:\App AnCut HUB`)** — se o dev mudar de máquina/pasta, quebra. Deveria usar `%~dp0` como o `build_installer.bat` original.
- **Pack_delta não valida deps** (ver seção 4). Um `sha256` de `requirements.txt` embedded na build + comparação no updater resolveria: "esse update precisa do setup completo, deps mudaram".

### Concerns de segurança
- **Nenhum code signing.** Smart App Control do Windows 11 bloqueia. Todo user tem que desligar SAC (irreversível sem reset) ou clicar "run anyway". Se distribuir pra 10+ pessoas, vai virar suporte. Certificado EV custa ~$200/ano mas resolve.
- **Update não valida integridade.** `apply_update.ps1` roda robocopy no que vier no zip. Se o GitHub API for MITMado (improvável mas possível), attacker consegue rodar código elevado no PC do user. Fix: SHA-256 do zip no release notes, ou assinar o zip com GPG.
- **API keys em plaintext** em `~/AppData/Local/CorteCenas/config.json`. Windows Credential Manager (`keyring`) resolveria pra Gemini/NavyAI keys.
- **Updater PS script não é assinado.** Signal: usuários com PowerShell execution policy restritivo podem falhar. `-ExecutionPolicy Bypass` no ShellExecute contorna, mas é frágil.
- **Sem verificação de versão do runtime.** Se um user com CUDA 11 tentar rodar, torch nem carrega, crash handler pega, mas mensagem não diz "atualiza driver". Podia detectar e sugerir.

### UX debt
- **Sem barra de progresso real do download do CLIP (~890 MB).** Hoje texto estático "Baixando modelo CLIP..." — user pode achar travado. Fix: monkey-patch `huggingface_hub.utils.tqdm` pra emitir Qt signals.
- **Sem estimativa de custo/tokens ANTES de rodar análise com IA.** User clica, vê custo depois. Pra free tier isso importa (limite Gemini free = 1500 requests/dia). Idealmente: dialog "esse ep tem 340 shots ≈ 340 requests ≈ 22% do free tier hoje. Continuar?".
- **Sem contador de uso local.** Hoje o `total_pt` e `total_ct` são printed pra stderr (invisível em frozen). Podia salvar em `usage.json` diário e mostrar num painel.
- **Sem tutorial ou sample no primeiro run.** User novo abre, não sabe o que fazer. Um "carregar episódio de exemplo" seria valioso.
- **Sem submissão automática de crash log.** User tem que encontrar o arquivo manualmente e mandar. Um botão "enviar crash pra dev" (via URL do GitHub Issues API ou webhook) resolveria.
- **UI de revisão manual não existe** apesar do schema ter `shot_character.reviewed / approved`. Right-click funciona (approve/remove/move por thumb), mas não tem batch, não tem "mostrar só ambíguos", nada. É a maior feature gap.

### Performance
- **Cold start ainda tem ~5s de import de torch na primeira análise da sessão** (já emite "preparando ambiente"). Podia fazer em background right after startup, num idle-thread — assim quando o user clica Analisar, torch já tá carregado.
- **Franchise BFS não é paralelo.** `_collect_franchise` faz N chamadas AniList seriais. Pra Dr. Stone S4 são umas 6-8 requests. Podia usar `asyncio.gather`.
- **Download de refs por char é serial** dentro do `image_downloader`. Podia paralelizar por char.
- **YOLO roda um frame por vez.** Se batch (8 frames de uma vez) → GPU aproveita melhor. Mas exige refactor do face_detector.
- **CLIP embedding roda um frame por vez** também no path CLIP. Batchar 32 frames de uma vez daria talvez 3-5x speedup.

### Limitações de produto
- **API AniList atualmente offline** (julho/2026) — fallback Jikan funciona mas perde franchise pooling. Se AniList voltar, tudo OK. Se AniList não voltar, feature de franchise pooling precisa ser reimplementada em cima de outra fonte (kitsu.io? MAL scraping?).
- **CLIP ViT-L/14 openai é decente pra anime mas não excelente.** Modelos treinados especificamente em anime (Marqo/anime-aesthetic, DanbooruTagger CLIP) provavelmente teriam melhor discriminação. Trade-off: 890 MB → possivelmente 2 GB.
- **YOLO deepghs pega ~55% dos rostos.** Perde os de perfil, olhando pra baixo, muito pequenos. Um segundo modelo em cascade (specialized profile) subiria pra ~75%.
- **Manga refs contaminam centroides** apesar do filtro por saturação. HSV é fraco pra distinguir "monochrome hard" de "washed out anime scene". Um segundo classifier binário color-vs-manga treinado especificamente resolveria.

---

## 7. Roadmap / ideias em ordem de valor

### Alta prioridade (impacto alto, esforço médio)

**A. Contador de uso free tier + estimativa pré-run**
- Salvar `usage.json` diário por provider (Gemini/NavyAI)
- Reset à meia-noite
- Painel visível em Configurações ou barra de status
- Dialog de confirmação ao clicar "Analisar com IA": "esse ep vai usar X% do free tier hoje"
- Parsing de 429 do Gemini pra mensagem específica de quota esgotada
- Estimativa: 2-3 horas

**B. UI de revisão manual em batch**
- Aba nova ou modal em Resultados: "Revisar personagem X"
- Grid com todos os shots atribuídos, checkbox aprovado/rejeitado
- Botão "aprovar visíveis" e "rejeitar visíveis"
- Persiste em `shot_character.reviewed/approved` (schema já pronto)
- Filtro "só mostrar não revisados" ou "só ambíguos (confidence < 0.85)"
- Estimativa: 4-6 horas

**C. Barra de progresso real do CLIP download**
- Monkey-patch em `huggingface_hub.utils.tqdm` antes de chamar `open_clip.create_model_and_transforms`
- Custom tqdm subclass emite Qt Signal por update
- QProgressDialog mostra `Baixando modelo CLIP: 42% (376 MB / 890 MB)`
- Fallback: se monkey-patch falhar (huggingface_hub mudou), volta pro texto atual
- Estimativa: 2-3 horas

### Média prioridade (feature nova)

**D. Cascade YOLO (frontal + profile)**
- Adicionar segundo modelo `deepghs/anime_face_profile_detection` ou similar
- Rodar ambos, unir bboxes com NMS
- Provavelmente sobe hit rate de 55% pra 70%+
- Estimativa: 2-3 horas

**E. Batching de CLIP e YOLO**
- Refactor `EmbeddingEngine.embed_images` pra processar batch de 32
- `AnimeFaceDetector.detect` receber lista de imagens
- Pipeline agrupa keyframes em lotes antes de chamar
- Speedup esperado: 3-5x na etapa `analyze_shots`
- Estimativa: 4-5 horas (requer testar accuracy não muda)

**F. Whisper pra transcrição**
- Whisper small model (~500 MB) roda por episódio
- Guarda transcript em `metadata/transcript.json`
- Usa pra reforçar identificação: se personagem X aparece no frame + fala nele, confidence + 0.1
- Estimativa: 6-8 horas (integração + UI pra visualizar)

### Baixa prioridade (nice to have)

**G. CI/CD com GitHub Actions**
- Runner Windows CPU-only pode fazer o build (torch CPU version, sem CUDA)
- Publica release automático ao tag push
- Elimina step manual do dev
- Estimativa: 3-4 horas

**H. Code signing**
- Comprar EV cert (~$200/ano)
- Assinar `CorteCenas.exe` e `CorteCenas-Setup-*.exe`
- Smart App Control para de bloquear
- Só vale se distribuir pra 10+ pessoas
- Estimativa: setup 2-3 horas + custo $200

**I. Detecção de mudanças de deps no delta**
- SHA256 de `requirements.txt` embedded na build
- Updater compara antes de aplicar delta
- Se diferente, força fallback pra full setup
- Estimativa: 1-2 horas

**J. Suporte a i18n**
- Textos hardcoded em português hoje
- Extrair pra `.ts` files e usar `QTranslator`
- Adicionar inglês
- Estimativa: 4-5 horas

---

## 8. O que fazer PRIMEIRO se eu fosse o Fable

Ordem que eu atacaria, começando pela primeira:

1. **A (uso free tier + estimativa)** — resolve dor imediata do usuário atual, pouco esforço, alto valor pra quem usa free plan (que é todo mundo pra 2-3 pessoas).
2. **C (barra de progresso do CLIP)** — muito visível, quem instala pela primeira vez espera 1-3 min sem feedback. Bug de percepção.
3. **B (UI de revisão manual)** — feature gap mais óbvio. Schema já pronto, só falta widget. Aumenta muito o valor real do app pro usuário final.
4. **I (checagem de deps no delta)** — bug latente. Antes que aconteça na natureza.
5. **D (cascade YOLO)** — melhoria de qualidade grande com pouco código.

Deixaria pra depois: F (Whisper), E (batching), G (CI/CD), H (signing), J (i18n).

---

## 9. Notas para o próximo assistente

### Padrões que existem hoje
- Todo worker é `QObject` movido pra `QThread`, com signals `progress` / `finished` / `failed`.
- Todo import pesado (`torch`, `open_clip`, `cv2`) é lazy dentro do `run()` do worker.
- Todos os providers têm `.close()` e devem ser chamados em `try/finally`.
- Nenhum arquivo tem comentário multi-linha longo. Se o "porquê" não é óbvio, comentário de uma linha.
- Nunca importar `pipeline.py` de dentro de UI — usar `pipeline_types.py` pra tipos leves.

### Sobre commits
- Mensagem começa com `v0.X.Y - <resumo>`.
- Body descreve o "porquê" (motivação/bug) mais que o "o quê" (que se lê no diff).
- Autor Co-Authored-By linha é opcional mas existe em alguns.

### Sobre releases
- Sempre gera 2 assets: setup exe + update zip.
- Bump `__version__` em `app/__init__.py` E `AppVersion` em `installer.iss` juntos.
- Notes em português, formato markdown.
- Versões quebradas (v0.1.0-v0.1.2) têm notes reescritas com aviso 🚨.

### Ferramentas do dev
- Windows 11 x64, RTX 5080, CUDA 12.8
- Python 3.11 em `C:\Program Files\Python311\`
- Inno Setup 6 em `%LOCALAPPDATA%\Programs\Inno Setup 6\`
- GitHub CLI (`gh`) em `C:\Program Files\GitHub CLI\`
- Git em `C:\Program Files\Git\`

### Como testar mudança sem rebuildar
`run.bat` roda direto do fonte via `.venv`. Mudança em `app/*.py` reflete no próximo `run.bat` — não precisa rebuild PyInstaller pra iterar em código.

Rebuild só quando quiser gerar release nova pra distribuir.

---

## 10. Coisa que só o autor humano decide

- **Compensa gastar $200/ano em code signing cert?** Depende de escala real de distribuição.
- **Compensa migrar pra Electron/Tauri?** PyInstaller funciona mas é gordo (2 GB por install). Uma Electron app com Python backend embutido poderia ser 500 MB. Mas é rewrite substancial.
- **AniList vai voltar?** Se voltar, franchise pooling reativa. Se não, precisa outra fonte de relations (não trivial de encontrar).
- **Escopo do app: só anime ou generalizar pra qualquer vídeo?** Hoje amarra bastante no domínio (nomes de personagens, refs de MAL, etc). Ampliar pra "qualquer vídeo com detecção de rosto" seria feature crossover interessante mas descaracteriza.

---

**Fim do briefing.**
