<div align="center">

<img src="app/assets/icon_256.png" width="130" alt="Logo do AnCut HUB">

# AnCut HUB

**Analisador de episódios de anime pra Windows.**
Corta o episódio em shots, identifica os personagens em cada um e organiza tudo
em pastas por personagem e por dupla — automático, sem alimentar pasta de foto nenhuma.

![Windows](https://img.shields.io/badge/Windows-10%2F11%20x64-0078D6)
![Python](https://img.shields.io/badge/Python-3.11-3776AB)
![GPU](https://img.shields.io/badge/GPU-NVIDIA%20CUDA%2012.8%20(opcional)-76B900)

**Este repositório é o motor.** A interface e os instaladores ficam em
**[ancut-hub](https://github.com/faahpla/ancut-hub)**.

**[⬇️ Baixar a versão mais recente](https://github.com/faahpla/ancut-hub/releases/latest)**

[Instalar](#-instalar) •
[Como usar](#-como-usar) •
[Deu problema?](#-deu-problema) •
[Como funciona](#%EF%B8%8F-como-funciona-por-dentro) •
[Pra desenvolvedores](#%EF%B8%8F-rodar-do-código-fonte)

</div>

---

## Créditos

O AnCut HUB é um **fork do [Corte Cenas](https://github.com/leviclementino1-creator/corte-cenas)**,
criado pelo **Levi Clementino**. Todo o motor descrito abaixo — detecção de
shots, reconhecimento de personagem, pipeline de referências, Modo Descoberta —
nasceu do trabalho dele.

Este fork mudou: interface reescrita em Electron (noutro repositório), corte
acelerado por GPU de fato funcionando, limite de galeria na busca de personagens
e um modo headless pra interface conversar com o motor. O crédito da ideia e da
engenharia original é do Levi.

---

## ✨ O que ele faz

Você arrasta um episódio pra janela. O app:

1. 🎬 **Detecta e corta** cada shot (mudança de cena) em um `.mp4` separado
2. 🔍 **Busca os personagens** do anime automaticamente em **3 fontes** (MyAnimeList + AniList + Kitsu, com reservas automáticas se alguma cair) — incluindo temporadas anteriores da franquia
3. 🧠 **Reconhece quem aparece** em cada shot (YOLO detecta os rostos, CLIP compara com as fotos de referência agrupadas em **protótipos por visual** — cabelo solto/preso, uniforme/armadura, cada aparência conta sozinha) — e uma **segunda passada** usa as próprias cenas identificadas como referência pra resgatar as que ficaram sem dono
4. 🤖 Opcional: uma **IA generativa revisa só os casos duvidosos** (barato) ou o episódio inteiro
5. 📁 **Organiza tudo** em `by_character/<Nome>/` e `by_pair/<A>+<B>/` usando hardlinks (sem duplicar espaço em disco)
6. 📱 Ainda gera **versão vertical 1080×1920** de qualquer personagem pra Reels/TikTok, com enquadramento no rosto

E quando o anime é **novo demais** (sem fotos nas bases) ou **não existe nelas**: o
**🔍 Modo Descoberta** agrupa os rostos do próprio episódio, você batiza cada grupo
(com dropdown do elenco oficial e sugestões automáticas quando o anime é conhecido)
e essas fotos viram o banco de referências — que só melhora a cada episódio.

```
Output/Dr Stone/S04E25/
├── shots/               0001.mp4, 0002.mp4, ...        (todos os cortes)
├── by_character/
│   ├── Senku/           só os shots em que o Senku aparece
│   └── Kohaku/
├── by_pair/
│   └── Senku+Kohaku/    shots em que os dois aparecem juntos
└── metadata/            shots.json, characters.json
```

---

## 📥 Instalar

**1 arquivo, 3 cliques, ~1 minuto:**

1. Baixe o **[CorteCenas-Setup mais recente](https://github.com/leviclementino1-creator/corte-cenas/releases/latest)** (~2 GB — procure o `CorteCenas-Setup-X.Y.Z.exe`)
2. Dois cliques no arquivo baixado
3. **Avançar → Avançar → Instalar → Concluir**

Pronto: atalho na área de trabalho e no menu iniciar. O **FFmpeg já vem embutido** — nada de baixar de outro site ou mexer em PATH.

> ⚠️ Se o Windows 11 reclamar (Smart App Control / SmartScreen), é porque o instalador não tem assinatura digital paga — clique em "Mais informações → Executar assim mesmo".

### Requisitos

| Item | Recomendado | Mínimo |
|---|---|---|
| Sistema | Windows 10/11 x64 | Windows 10 x64 |
| GPU | NVIDIA RTX 20xx+ (driver CUDA 12.8+) | Qualquer (roda em CPU, ~20x mais lento) |
| RAM | 16 GB | 8 GB |
| Disco | 8 GB livres | 5 GB |
| Internet | Primeira análise baixa os modelos (~900 MB) e as fotos dos personagens de cada anime | idem |

O badge no topo da janela mostra em que modo você está: 🟢 GPU ou 🟡 CPU.

### 🔄 Atualizações são automáticas

Toda vez que o app abre, ele confere se saiu versão nova. Se sim, pergunta se quer atualizar — aceita, autoriza no UAC, e em ~30 segundos reabre atualizado. **O update baixa só ~53 MB**, não os 2 GB do instalador. Suas configurações e clipes ficam intactos.

---

## 🎬 Como usar

### 1. Carregar o episódio

**Arraste o arquivo do episódio** (`.mp4`, `.mkv`...) pra qualquer lugar da janela — o app preenche anime, temporada e episódio a partir do nome do arquivo. Ou use o botão **Selecionar**.

Arquivo sem o nome do anime (tipo `S01E01-Titulo do Episodio.mkv`)? O app
olha as **pastas** (`Mushoku Tensei/Season 1/...`) e, em último caso, busca
pelo título do episódio. O campo fica editável — confere antes de rodar.

Confira os campos (pra temporadas específicas tipo "Dr. Stone S4", preencher certo importa) e, se quiser, informe os tempos de **OP/ED** pra pular abertura e encerramento.

### 2. Escolher o modo e analisar

| Botão | O que faz | Custo |
|---|---|---|
| **Testar refs (preview)** | Mostra quantas fotos cada personagem tem ANTES de gastar tempo de análise | Grátis |
| **Analisar episódio** 🟢 | O principal: YOLO + CLIP + segunda passada de resgate | Grátis, ilimitado |
| **Analisar + IA nos duvidosos** 🔵 | Igual ao verde, mas os shots que ficaram "quase" vão pra IA desempatar | Pouca quota |
| **🔍 Modo Descoberta** | Agrupa os rostos do próprio episódio pra você batizar — cria/reforça o banco de refs. Foto errada no grupo? **Clica nela** que sai | Grátis |

Presets de rigor: **Auto (recomendado)** equilibra; **Muito Fiel** quase não erra mas marca menos; **Pouco Fiel** marca mais e você filtra depois.

Mudou de ideia no meio? **✕ Cancelar análise** — os shots já cortados ficam em cache e a próxima rodada continua de onde parou.

Durante a análise, um **cronômetro ao lado da barra** mostra o tempo decorrido e a
estimativa pra terminar ("⏱ 2:31 · resta ~1:10"), calculada pelo ritmo real. E se
você estiver em outra janela quando acabar, o app manda uma **notificação do
Windows** — clicar nela traz a janela de volta.

**Reanalisar é quase instantâneo**: os rostos detectados e os embeddings ficam num
cache por episódio — a segunda rodada pula YOLO e CLIP inteiros (de minutos pra
segundos) e vai direto pra decisão. Reanalisar depois de remover/bloquear cenas
ficou barato de verdade.

**Fluxo típico pra um anime novo:** Testar refs → se tiver pouca foto, roda a
**Descoberta** e batiza os grupos (o app sugere os nomes quando conhece o anime)
→ **Analisar episódio** no verde. As refs batizadas entram na análise e nos
próximos episódios tudo já funciona direto no verde.

Se o anime **não for encontrado** nas bases online, o app oferece a Descoberta
sozinho — e a partir do episódio 2 resolve o anime pelo banco local, sem internet.

### 3. Aba Resultados

- Lista de personagens com a contagem de shots de cada um
- Seção **Duplas** na mesma lista ("Senku + Kohaku (12)") — clica e vê só as
  cenas em que os dois aparecem juntos
- **Duplo clique** num thumbnail abre o `.mp4` do shot
- **Botão direito**: aprovar, remover ou mover pra outro personagem — com
  **Ctrl/Shift/laço** pra selecionar vários de uma vez
- 🧠 **Curadoria com memória**: removeu/moveu/aprovou → a decisão **sobrevive à
  reanálise** — e o bloqueio vale **desde o começo** da análise seguinte (a
  cena removida não vira "referência interna" nem espalha o erro). Pode
  reanalisar quanto quiser que o app não desfaz teu trabalho
- **Exportar vertical 1080×1920** — versão Reels/TikTok focada no rosto do personagem selecionado
- **Exportar refs deste anime** — zip do banco de referências pra compartilhar
- **Reforçar refs com este ep** — usa os shots identificados pra engordar o banco de referências (melhora o próximo episódio)

---

## 🆘 Deu problema?

O app registra tudo que acontece num arquivo de log:

1. Abra **⚙ Configurações → 📂 Abrir pasta de logs**
2. Mande o arquivo **`app.log`** pra quem te passou o app

O log diz exatamente o que aconteceu (qual API respondeu, quantas fotos cada personagem conseguiu, onde travou) — sem ele é adivinhação. Ele não contém suas API keys e nunca passa de ~8 MB.

Situações conhecidas:

| Sintoma | Causa | O que fazer |
|---|---|---|
| Aviso "⚠️ MyAnimeList fora do ar" | A API gratuita do Jikan vive sobrecarregada — o app detecta e avisa | Geralmente **nem trava mais**: o elenco vem do cache/reservas (AniList + Kitsu) e a análise roda. Se faltar foto, tentar mais tarde ou usar o **Modo Descoberta** |
| Anime/temporada nova sem fotos nas bases | Bases ainda não têm imagens | **Modo Descoberta** → batizar → analisar no verde |
| Erro de quota da IA | Free tier do dia esgotou | Esperar o reset diário, ou usar o **Analisar episódio** (local, sem limite) |
| App fecha ao abrir | Erro fatal — gera `crash.log` na mesma pasta de logs | Mandar o `crash.log` |
| Frame de outra cena no fim de um clipe antigo | Cortes feitos antes da v0.3.4 (bug corrigido) | Apagar a pasta `shots/` do episódio no Output e reanalisar |

---

## 🤖 Modo IA (opcional)

Duas providers configuráveis em **⚙ Configurações**, com fallback automático:

- **NavyAI** (principal) — gateway OpenAI-compatível; key `sk-navy-...`
- **Gemini direto** (fallback) — key gratuita em [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

Se as duas estiverem preenchidas, a NavyAI é usada primeiro e o Gemini assume automaticamente quando ela falha (quota, erro, timeout). Modelo padrão: `gemini-2.5-flash` (modelos aposentados pelos provedores são migrados sozinhos).

> 💡 **Free tier é apertado pra episódio inteiro**: ~400 shots ≈ 2 milhões de tokens só de prompt. Se a quota diária acabar no meio, o app para na hora e explica — não fica moendo à toa. O pipeline local (botão verde) não tem esse limite.

---

## 📂 Onde ficam as coisas

| O quê | Onde |
|---|---|
| Instalação | `C:\Program Files\CorteCenas\` |
| Configurações | `%LOCALAPPDATA%\CorteCenas\CorteCenas\config.json` |
| Logs (`app.log`, `crash.log`) | `%LOCALAPPDATA%\CorteCenas\CorteCenas\Logs\` |
| Cache (modelos, refs, banco) | `%LOCALAPPDATA%\CorteCenas\CorteCenas\cache\` |
| Clipes de saída | `Documentos\CorteCenas\Output\` (muda em ⚙ Configurações) |

O cache é reaproveitado entre episódios do mesmo anime (e da mesma franquia): o segundo episódio analisa muito mais rápido. E cada episódio guarda as features caras (rostos + embeddings) junto dos metadados — **reanalisar o mesmo episódio leva segundos**. Apagar o cache só força refazer os downloads.

Em **⚙ Configurações → Referências e cache**: abrir a pasta de refs com um
clique, **🧩 fundir pastas duplicadas** (mesmo personagem escrito diferente
pelas fontes — "Tempest, Rimuru" ≡ "Rimuru Tempest" — ou mesmo anime com id
diferente; mostra o plano antes de aplicar), **🧹 limpar só as fotos
baixadas** (galerias online costumam trazer lixo — batismos e fotos manuais
ficam intactos), **♻️ restaurar os padrões de análise** e, como último
recurso, **🗑 apagar o cache inteiro**.

E a duplicação **não volta**: pasta de refs, personagem no banco e batismo
passam a casar nomes por conjunto de palavras ([naming.py](app/naming.py)) —
qualquer fonte que escreva o nome noutro formato reusa o que já existe
(subset tipo "Rimuru" ⊂ "Rimuru Tempest" só quando inambíguo; a família
Greyrat inteira nunca é fundida por engano).

---

## ⚙️ Como funciona por dentro

1. **Parse** — extrai anime/temporada/episódio do nome do arquivo
2. **Detecção de shots** — [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) `ContentDetector`, com progresso em tempo real
3. **Corte + keyframes** — FFmpeg gera o `.mp4` de cada shot (NVENC quando a GPU suporta, cortes em paralelo; margem de meio frame pra nenhum frame da cena seguinte vazar) + 3 keyframes JPG
4. **Banco de personagens** — [AniList GraphQL](https://docs.anilist.co/) resolve o anime e a franquia inteira (BFS pelas relações: sequels, prequels, spin-offs); [Jikan](https://jikan.moe/) traz as galerias de fotos, com **AniList e [Kitsu](https://kitsu.app)** como reservas de elenco quando ele cai — os retratos das 3 fontes sempre entram (2-3 fotos garantidas por personagem, acima do mínimo da análise mesmo em queda total). Pastas locais de personagem (Descoberta, refs manuais) sempre entram
5. **Refs** — imagens filtradas (manga preto-e-branco descartado); rosto de cada ref é recortado pra casar com o espaço de comparação
6. **Embeddings** — `open_clip ViT-L/14`; as refs de cada personagem são agrupadas por **modo visual** (average-linkage) e cada grupo vira um **protótipo** — a similaridade é contra o protótipo mais parecido, não contra a média de tudo
7. **Análise** — YOLO [`deepghs/anime_face_detection`](https://huggingface.co/deepghs/anime_face_detection) (com cascata pra [anime_head](https://huggingface.co/deepghs/anime_head_detection) quando o rosto escapa, **em lote por shot**) → CLIP → cosine contra os protótipos → votação entre keyframes. Boxes e embeddings de cada keyframe ficam num **cache por episódio** (reanálise pula GPU) e cada etapa tem o tempo medido no `app.log` + `timings.json`
8. **Segunda passada** — as cenas identificadas com confiança viram referências temporárias do próprio episódio (mesmo traço/ângulo/luz); as sem dono são recomparadas contra elas com voto único por rosto. Resgata tipicamente **um terço do episódio** que a comparação com refs externas perdia
9. **Resgate por grupo (Descoberta embutida)** — os rostos que AINDA sobraram são agrupados entre si (mesma pessoa dentro do episódio) e cada **grupo inteiro** é comparado com os protótipos: mediana de representantes diversos + margem + concordância. Pega o personagem que pontuava "quase" em todas as cenas e nunca ganhava semente; grupos que nem assim resolverem viram **oferta de batismo** no fim da análise
9. **Revisão IA (opcional)** — só os shots que ficaram "quase" (similaridade na zona cinzenta) vão pro Gemini, com teto de custo, retry, fallback de provider e circuit breaker de quota
10. **Revisão IA por grupo (opcional)** — grupo na zona cinzenta vai pro Gemini como *contact sheet* (várias expressões do mesmo rosto vs refs dos top-3 candidatos): uma pergunta responde dezenas de cenas
11. **Organização** — hardlinks NTFS em `by_character/` e `by_pair/`, `shots.json` + `characters.json`, reaplicando a curadoria manual lembrada

O **Modo Descoberta** troca os passos 4-7 por clustering não-supervisionado dos
rostos do episódio (aglomerativo average-linkage) + tela de batismo; os grupos
nomeados viram refs e personagens de verdade.

<details>
<summary><b>🏗️ Arquitetura de pastas do código</b> (clique pra expandir)</summary>

```
app/
  main.py                  entrada PySide6, splash, checagens pós-janela
  pipeline.py              orquestra o fluxo, emite progresso
  pipeline_types.py        tipos leves (sem torch) pra UI importar
  applog.py                log persistente + tee de stdout/stderr
  config.py                config persistente + migrações
  updater.py               auto-update via GitHub Releases (delta ~53 MB)
  ai_review.py             NavyAI + Gemini fallback + circuit breaker de quota
  video_ingest.py          parse do nome do arquivo
  shot_detection.py        PySceneDetect com callback de progresso
  keyframe_extractor.py    FFmpeg + OpenCV
  ffmpeg_locate.py         resolve ffmpeg embutido vs PATH
  reframe.py               vertical 9:16 com face-tracking
  harvest.py               reforço de refs a partir de shots identificados

  no_console.py            nenhum subprocesso pisca janela de CMD (global)

  providers/               anilist.py, jikan.py, kitsu.py, danbooru.py,
                           anime_provider.py (orquestra fontes + reservas)
  references/              downloader async, filtros, reference_store
  matching/                face_detector (YOLO + cascata head, em lote),
                           embedding_engine (CLIP), character_matcher
                           (multi-protótipo), feature_cache (boxes+embeddings),
                           second_pass (resgate), face_clustering (Descoberta),
                           cooccurrence
  storage/                 db (SQLite), metadata_writer, organizer (hardlinks)
  ui/                      main_window, analyze_tab, results_tab,
                           character_grid, settings_dialog, worker (QThreads)
  assets/                  ícone (7 tamanhos)

fetch_ffmpeg.py            baixa FFmpeg pro ./bin/ (embutido no instalador)
pack_delta.py              gera o zip de update (~53 MB)
apply_update.ps1           helper elevado que aplica o delta
_build_all.bat             build completo: FFmpeg → PyInstaller → delta → Inno
build.spec                 PyInstaller (onedir, console=False)
installer.iss              Inno Setup 6
```

</details>

<details>
<summary><b>🧪 Escolhas técnicas</b> (clique pra expandir)</summary>

- **Re-encode `libx264 ultrafast` / NVENC** em vez de stream-copy — corte preciso no frame, sem flash no início do clipe; duração pela saída com margem de meio frame (sem frame da cena seguinte no fim)
- **open_clip ViT-L/14** — melhor discriminação de personagem que ViT-B/32; GPU em segundos, CPU em minutos
- **YOLO deepghs anime_face + cascata anime_head** — cobre rostos de perfil/ângulo difícil que o detector de rosto perde
- **Multi-protótipo por personagem** — um centroide único mistura cabelo solto/preso, uniforme/armadura e chibi num vetor médio que não parece com NENHUMA das aparências (no teste real, o visual alternativo de um personagem pontuava 0.64 no centroide — reprovado — e 0.97 no protótipo certo). Refs solitárias destoantes são descartadas como provável ruído de galeria quando há refs de sobra
- **Cache de features por episódio** (`face_cache.npz` + `ref_features.npz`) — boxes do YOLO e embeddings do CLIP validados por mtime/tamanho e invalidados por troca de modelo/config; reanálise nem carrega os modelos (~10x mais rápida no E2E: 54s → 5s)
- **Votação entre keyframes** — personagem que só aparece em 1 de 3 keyframes é quase sempre ruído
- **Segunda passada com voto único por rosto** — cada rosto conta pra UM personagem só; sem isso, personagens que dividem muitas cenas contaminavam o resgate um do outro
- **Clustering average-linkage na Descoberta** — o greedy por centroide encadeava 90% dos rostos num blob só; average-linkage entrega grupos puros (errar separando > errar juntando: mesclar na tela de batismo é fácil)
- **Busca com variantes de partícula e truncamento** — "dewa"/"de wa", títulos de fansub encurtados; arquivo sem nome de anime resolve pela pasta ou pelo título do episódio
- **`Accept-Encoding: gzip` exato no Jikan** — o cache nginx deles guarda variantes por encoding: com o header certo a resposta vem do cache (servida até "stale" com o backend morto = 200); com a lista padrão do httpx o pedido furava o cache e caía no backend saturado = 504. Uma linha que transformou "falha sempre" em "funciona até durante a queda"
- **Bloqueio manual vale desde a classificação** — cena removida pelo usuário não é re-atribuída no meio da análise, não vira fonte da segunda passada e a IA não pode recolocá-la
- **Hardlinks NTFS** — um shot em N pastas sem duplicar bytes
- **Franchise pooling** — Dr. Stone S4 herda refs de S1-S3 via relações do AniList
- **Toda falha externa é barulhenta** — API fora do ar (com confirmação: "o MyAnimeList estava fora do ar"), quota esgotada e modelo aposentado geram mensagens específicas e ficam no `app.log`; nada degrada em silêncio; banco montado durante queda de fonte não vai pro cache
</details>

---

## 🖥️ Rodar do código-fonte

```bat
git clone https://github.com/leviclementino1-creator/corte-cenas.git
cd corte-cenas
install.bat   :: cria .venv, instala torch+cu128 (~2.7 GB) e as deps (5-10 min)
run.bat       :: roda direto do fonte — editar app/*.py reflete na hora
```

### Buildar o instalador

Precisa de [Inno Setup 6](https://jrsoftware.org/isdl.php). Depois:

```bat
_build_all.bat
```

Roda em ordem: `fetch_ffmpeg.py` → PyInstaller (~10 min) → `pack_delta.py` (zip de update ~53 MB) → Inno Setup (~8 min). Saída em `releases/`: o setup completo **e** o zip de delta.

### Publicar uma release

1. Bump `__version__` em [app/\_\_init\_\_.py](app/__init__.py) **e** `AppVersion` em [installer.iss](installer.iss)
2. Commit + push
3. `_build_all.bat`
4. ```bat
   gh release create vX.Y.Z releases/CorteCenas-Setup-X.Y.Z.exe releases/CorteCenas-Update-X.Y.Z.zip --title "AnCut HUB vX.Y.Z" --notes-file notas.md
   ```

Todo mundo com o app instalado recebe a oferta de update (delta de ~53 MB) no próximo abrir.

---

## 🗺️ Roadmap

- [ ] **Banco de refs curadas no GitHub** — fonte de fotos controlada por nós, imune a queda de API e com designs atuais das temporadas novas (o botão "Exportar refs" já gera o insumo)
- [ ] **Resultados em tempo real** — shots aparecendo na aba Resultados enquanto a análise roda
- [ ] **Contador de uso do free tier** + estimativa de custo antes de rodar com IA
- [ ] **Barra de progresso do download do CLIP** (~890 MB na primeira análise)
- [ ] **Benchmark CCIP × CLIP** — testar o embedding da DeepGHS treinado especificamente pra "mesmo personagem de anime?" contra o CLIP atual, usando o cache de features
- [ ] Transcrição (Whisper) pra reforçar identificação por fala
- [x] ~~Ponte verde→Descoberta (batismo dos grupos que sobraram)~~ (v0.4.1)
- [x] ~~Cascade de detecção de rosto~~ (v0.2.0)
- [x] ~~Revisão em lote (Ctrl/Shift na grade)~~ (v0.3.1)
- [x] ~~Modo Descoberta~~ (v0.3.0)

---

## 📄 Licença

MIT.
