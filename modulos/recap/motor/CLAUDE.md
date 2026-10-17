# AnCut HUB

Fork rebatizado do **Corte Cenas** (de Levi Clementino) — app desktop de análise
de anime que corta episódios em cenas, reconhece personagens (YOLO + CLIP) e
organiza os clipes por personagem/dupla. Este fork adiciona uma camada de UI
nova (preview de vídeo, cards, tema) e rebranding. **O motor de IA é o do
Corte Cenas e não deve ser alterado sem necessidade.**

## Como rodar (do fonte)

```bash
.venv\Scripts\python.exe run.py    # ou run.bat
```

- `.venv` já criado: Python 3.12, torch 2.11+cu128 (roda na RTX 3060), PySide6 6.11.1.
- ffmpeg vem do PATH (`C:\ffmpeg\bin`).
- Modelos (CLIP ViT-L/14, YOLO anime-face) ficam no cache global do HuggingFace
  (`~/.cache/huggingface`) — não re-baixam.

## Dados (cache/models)

Rodando do fonte, `config.py` usa `cache/` e `models/` locais do projeto. Aqui
eles são **junctions** pra `C:\Users\faahb\AppData\Local\CorteCenas\CorteCenas\
{cache,models}` — reaproveitam as refs/análises do Corte Cenas instalado. A aba
Resultados só popula DEPOIS de rodar uma análise na sessão (não auto-carrega
episódios antigos).

## Camada de UI nova (feita neste fork)

- `app/ui/preview_panel.py` — player de vídeo embutido (QtMultimedia).
- `app/ui/character_grid.py` — `ShotCardDelegate` (cards + selo de confiança),
  áudio no hover, sinais `shot_selected`/`shot_activated`/`shot_action`.
- `app/ui/results_tab.py` — 3 colunas: personagens | grade | preview.
- `app/ui/main_window.py` — tema `_DARK_QSS`.

QtMultimedia é importado sob `try/except` (`MULTIMEDIA_OK`); sem ele, o app
cai no fallback (player externo).

## Correções de compatibilidade (deps novas)

- `app/shot_detection.py` — scenedetect 0.7.x: callback recebe `FrameTimecode`,
  usar `.get_frames()`.
- `app/matching/embedding_engine.py` — open_clip 3.x: `force_quick_gelu=True`
  pros pesos "openai", senão os embeddings não batem com as refs cacheadas.

## Rebrand

Só o nome visível ("Corte Cenas" → "AnCut HUB"). Mantidos técnicos: `APP_NAME=
"CorteCenas"` (pasta de dados), `updater.GITHUB_REPO` (auto-update do Levi),
nomes de exe/instalador. Ver `AnCut-HUB-NOTES.md` pro histórico completo.

## Build do instalador

`build.spec` já inclui o QtMultimedia (plugins de mídia + backend FFmpeg do Qt).
Fluxo: `build.bat` → PyInstaller → `installer.iss` no ISCC.
