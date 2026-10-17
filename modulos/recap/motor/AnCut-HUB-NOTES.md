# AnCut HUB — notas da migração (a partir do Corte Cenas)

Este projeto é um fork do **Corte Cenas** (de Levi Clementino) com uma camada de
UI nova e rebranding. **O motor de IA não foi tocado** — detecção de cena,
reconhecimento de personagem (YOLO + CLIP), clustering, franchise pooling,
export vertical e AI review continuam idênticos ao upstream.

## O que foi adicionado à interface

1. **Preview de vídeo embutido** (`app/ui/preview_panel.py`, novo)
   - Player interno (`QMediaPlayer`/`QVideoWidget`): play/pause, barra de seek
     com tempo, loop (ligado por padrão), mute e volume, e botão ⧉ pra abrir no
     player do sistema.
   - Na aba Resultados: **clique simples** carrega a cena (pausada); **duplo
     clique** toca. Antes o duplo clique abria o player externo do Windows.

2. **Tema repaginado** (`app/ui/main_window.py`, `_DARK_QSS`)
   - Mantém a identidade (escuro + acento verde `#4CAF50`), com cards
     arredondados, sliders/scrollbars/splitter/menus/tooltips estilizados e a
     variante `QPushButton[accent="true"]` pra ação principal.

3. **Cards custom na grade** (`app/ui/character_grid.py`, `ShotCardDelegate`)
   - Cada shot vira um card: thumbnail com cantos arredondados, **selo de
     confiança colorido** (verde ≥0.90 / âmbar ≥0.75 / vermelho abaixo) e marca
     ✓ de aprovado. Continua sendo `QListWidget` em IconMode — seleção
     múltipla, laço e menu de contexto seguem funcionando.

4. **Áudio no hover** (`app/ui/character_grid.py`)
   - Passar o mouse sobre um card toca o áudio da cena (debounce de 220 ms).
   - Toggle "🔊 Prévia no hover" na grade, **desligado por padrão** pra não
     conflitar com o preview embutido.

> Segurança: tudo que depende de QtMultimedia está sob `try/except`. Se um build
> não tiver os plugins de mídia, `MULTIMEDIA_OK=False` e o app volta ao
> comportamento antigo (player externo, sem preview/hover) — não quebra.

## Ajustes pedidos (2ª leva)

1. **Remover personagem errado do episódio** — botão direito num personagem na
   lista da aba Resultados → "🗑 Remover deste episódio". Tira todas as cenas
   dele de uma vez, grava `block` em manual_override (reanálise não traz de
   volta) e sincroniza as pastas. Em `results_tab.py`
   (`_show_char_context_menu` / `_remove_character_from_episode`).
2. **Prévia animada no hover (GIF-like)** — toggle "🎞 Prévia no hover" na grade:
   passar o mouse toca a cena muda, em loop, no painel de preview (varre clipes
   sem clicar). Sinal `shot_hovered` (character_grid) → `preview.hover_preview`
   (preview_panel, sempre mudo). O antigo "áudio no hover" virou toggle separado.
3. **Redesign** — `_DARK_QSS` reescrita (paleta em camadas, tabs "pill",
   combos/spinbox estilizados, tipografia) + cabeçalho com logo + wordmark
   "AnCut HUB" no topo (`main_window.py`). Obs: `app/assets/icon_*.png` ainda é o
   ícone antigo "CC" — trocar por um ícone próprio do AnCut HUB fecha o rebrand.

## Correções de compatibilidade (deps novas via pip)

Instalar as libs nas versões atuais (do `requirements.txt` com `>=`) trouxe dois
bugs que foram corrigidos no fonte:

1. **`app/shot_detection.py`** — `scenedetect 0.7.x` mudou o callback de
   `detect_scenes`: o `frame_num` agora é um `FrameTimecode`, não `int`, e o
   `frame_num / total_frames` estourava `TypeError`. Fix: usar
   `frame_num.get_frames()` quando disponível (funciona em 0.6.x e 0.7.x).
2. **`app/matching/embedding_engine.py`** — `open_clip 3.x` parou de ativar
   QuickGELU por padrão pra "ViT-L-14"; os pesos "openai" precisam dele. Sem
   isso os embeddings novos ficariam num espaço diferente das referências já
   cacheadas, degradando o reconhecimento. Fix: `force_quick_gelu=True` quando
   `pretrained == "openai"`.

Validado headless: detecção de cenas, YOLO (ultralytics 8.4) e CLIP (open_clip
3.3) rodam sem erro nas versões instaladas.

## Rebranding (Corte Cenas → AnCut HUB)

Só o **nome visível** mudou. Foram trocadas 37 ocorrências de `"Corte Cenas"`
(com espaço) por `"AnCut HUB"`: título da janela, splash, notificações, tray,
diálogos, README e installer.

**Mantidos de propósito** (mexer quebraria algo):
- `config.py` → `APP_NAME = "CorteCenas"`. A pasta de dados/cache/modelos
  continua a mesma, então o AnCut HUB **reaproveita seus modelos já baixados
  (CLIP ~890 MB, YOLO) e o banco de referências** — nada de re-download.
- `updater.py` → `GITHUB_REPO = "leviclementino1-creator/corte-cenas"`. O
  auto-update ainda puxa do repositório do Levi. Se um dia você publicar
  releases próprias do AnCut HUB, troque aqui.
- Nomes de executável/instalador (`CorteCenas.exe`, `CorteCenas-Setup-*`) em
  `installer.iss` / `build.spec` — batem com o updater. Renomear exige mexer nos
  três juntos + um repo de releases próprio.

## Como rodar (a partir do código)

```bash
pip install -r requirements.txt   # (torch com CUDA: ver README)
python run.py                     # ou run.bat
```

## Build (preview precisa dos plugins de mídia) — JÁ CONFIGURADO

O `build.spec` já foi ajustado pro preview funcionar no instalador. Como o
PyInstaller não tem hook próprio pro QtMultimedia, o spec agora:

- adiciona `PySide6.QtMultimedia`, `PySide6.QtMultimediaWidgets` e
  `PySide6.QtNetwork` aos `hiddenimports`;
- coleta à mão (via glob no diretório do PySide6) os 10 binários que faltavam:
  os plugins `ffmpegmediaplugin.dll` / `windowsmediaplugin.dll` (→
  `PySide6/plugins/multimedia`) e o backend FFmpeg do Qt `avcodec/avformat/
  avutil/swresample/swscale` + `Qt6Multimedia*.dll` (→ `PySide6/`).

Verificado que a coleta encontra os 10 arquivos no PySide6 6.11. Depois de
buildar, dá pra conferir a presença de
`dist/CorteCenas/_internal/PySide6/plugins/multimedia/` no output.

Sem isso o app rodaria, mas sem o preview embutido (cai no fallback).

## Arquivos alterados nesta migração

- `app/ui/preview_panel.py` — novo
- `app/ui/character_grid.py` — cards + hover audio + sinal `shot_selected`
- `app/ui/results_tab.py` — 3ª coluna de preview, fiação dos sinais
- `app/ui/main_window.py` — tema `_DARK_QSS`, título
- + 12 arquivos com o nome de exibição rebatizado

O diff das mudanças de UI está em `_ui-changes.patch` (referência).
