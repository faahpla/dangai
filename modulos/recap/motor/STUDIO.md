# motor/ no modulo recap do Dangai

Copia de `G:/ClaudeEditor/anirecap-studio/motor` (commit `43a28e7` do AniRecap
Studio), SEM mudanca no Python: as dez mudancas `[Studio]` abaixo valem aqui
igual. O que muda e so quem chama (o modulo, `modulos/recap/electron/motor.ts`):

- o codigo vai no instalador do Dangai em `resources/modulos/recap/motor`
  (`electron-builder.yml`, sem `.venv`/`cache`/`models`/`.pyc`);
- o runtime (Python OFICIAL do python.org pelo nuget.org, assinatura da PSF
  conferida, + torch) e o uv sao instalados pela tela do modulo em
  `%LOCALAPPDATA%/Dangai/recap/motor-runtime` (`electron/motor-runtime/`);
- `ANIRECAP_MOTOR_DADOS` = `<userData do Dangai>/modulos/recap/motor`: o
  config, o `index.db`, as fotos do elenco e os logs sao do modulo, nunca os
  do Studio nem os do Corte Cenas;
- o lock `studio-runtime.json` sai de `modulos/recap/scripts/motor-lock.mjs`
  (com `pythonOficial` e `uv`); dev com `modulos/recap/motor/.venv` usa o venv.

# motor/ no AniRecap Studio

Este é o **motor de personagens** do AniRecap Studio: corta o episódio em cenas
(`shots/NNNN.mp4`, `keyframes/`, `metadata/shots.json`) e reconhece os
personagens pelo rosto (YOLO anime-face + CLIP ViT-L/14 + CCIP). O Studio
continua em TypeScript e sobe este motor como processo separado, falando
JSON-lines (`app/headless.py`), igual ao AnCut HUB.

## Origem

- Cópia de `faahpla/ancut-hub-engine`, commit **`a1d732b`**
  ("fix: vídeo HDR sai com a cor certa — clipes e keyframes"), versão
  `app.__version__ = 0.16.1`.
- O ancut-hub-engine é um fork do **Corte Cenas**, de Levi Clementino.
- Referência local, só leitura: `G:\ClaudeEditor\fusao\ancut-hub-engine`.

**Regra: não "melhorar" o motor aqui.** Detecção, matching, corte e pipeline
ficam idênticos aos do AnCut, para os pontos de corte e o reconhecimento
saírem iguais. Correções de motor vão para o ancut-hub-engine e voltam por
cópia. As únicas mudanças desta cópia estão listadas abaixo e marcadas com
`[Studio]` no código.

## Mudanças em relação ao a1d732b

Motivo das três primeiras: o Corte Cenas do Levi e o AnCut HUB dividem a mesma pasta de
dados, `%LOCALAPPDATA%\CorteCenas\CorteCenas` (config.json com as chaves,
`cache/index.db`, refs do elenco em `cache/anime_db`, `models/`, `Logs/`). Com
o `APP_NAME = "CorteCenas"` original, o motor do Studio leria e gravaria ali, e
um `index.db` misturado não tem volta.

1. **`app/config.py`**
   - `APP_NAME = "AniRecapStudioMotor"` (era `"CorteCenas"`).
   - Nova env **`ANIRECAP_MOTOR_DADOS`**: a pasta de dados que o Studio passa
     (`<userData>/motor`, ou seja `%APPDATA%\AniRecap Studio\motor`). Com ela,
     rodando do fonte ou empacotado:
     - `CONFIG_FILE = <dados>/config.json`
     - cache (index.db, anime_db, skip_ranges.json…) = `<dados>/cache`
     - modelos = `<dados>/models`
     - logs = `<dados>/logs`
     - saída padrão = `<Documentos>/AniRecap Studio/Biblioteca` (o `run`
       sempre usa a `outputDir` da requisição).
   - Sem a env (motor rodado à mão): config e logs em
     `%LOCALAPPDATA%\AniRecapStudioMotor\AniRecapStudioMotor`; do fonte, cache,
     modelos e saída continuam relativos ao projeto (`motor/cache`,
     `motor/models`, `motor/Output`, no `.gitignore`); empacotado, cache e
     modelos em `%LOCALAPPDATA%\AniRecapStudioMotor\...`.
   - A saída padrão do app empacotado era `Documents/CorteCenas/Output`, a
     biblioteca do AnCut. Passou a ser `Documents/AniRecap Studio/Biblioteca`.
   - Nova constante `LOG_DIR`, usada pelos dois itens abaixo.
2. **`app/applog.py`** — `log_dir()` usa `config.LOG_DIR` (era
   `user_log_dir("CorteCenas")`). Só roda no app Qt e no exe (`run.py`); o
   `python -m app.headless` do Studio não chama.
3. **`run.py`** — `_crash_log_path()` usa `config.LOG_DIR` (era
   `user_log_dir("CorteCenas")`).

Conferido (sem mudança): todo `index.db`, refs, `skip_ranges.json`,
`busca_resolvida.json`, `benchmark.db` e modelo do lbpcascade saem de
`Config.cache_path`/`models_path`, que vêm de `config.py`. Os `[CorteCenas]`
dos prints são só prefixo de log; o `User-Agent` dos downloads, o `updater.py`
(auto-update do app Qt) e as telas em `app/ui/` não entram no headless. Os
modelos grandes (CLIP, YOLO, CCIP) ficam no cache global do HuggingFace
(`~/.cache/huggingface`), que não é do Corte Cenas.

### Fontes de elenco (out/2026)

Motivo: na rede do Levi o `api.jikan.moe` não aceita conexão (ConnectTimeout,
também no curl). O elenco vinha só da AniList, com 1 retrato por personagem,
abaixo de `min_references_per_character = 2`, e a análise terminava em
"sem-referencias" depois de ~6 min de timeouts. Três mudanças pequenas, as
três para levar ao ancut-hub-engine:

4. **`app/providers/jikan.py`** — Jikan fora do ar desiste no 1º pedido.
   - `httpx.Timeout(30, connect=CONEXAO_S)`, com `CONEXAO_S = 8`: só abrir a
     conexão ficou curto; a leitura segue em 30 s.
   - `respondeu` / `fora_do_ar`: erro de rede (`httpx.HTTPError`) sem nenhuma
     resposta antes na rodada liga `fora_do_ar` (e `gave_up`) sem retry, e
     dali em diante todo pedido, até o `essencial`, volta `None` na hora,
     contando em `failures` (os avisos de fonte do provider continuam certos).
   - Medido: antes, 69,2 s por pedido e o disjuntor só no 5º (5 × 69 s ≈
     5,8 min por análise); depois, 8,0 s no 1º e 0,0 s nos outros. O
     `resolve()` de Dr. Stone S4 inteiro (AniList + Kitsu, banco parcial)
     caiu para 12 s.
5. **`app/providers/anime_provider.py`** — a Kitsu também pela RAIZ da
   franquia. O retrato extra da Kitsu era buscado só pelo MAL id da temporada
   pedida, mas o elenco da AniList vem da raiz (`get_characters(root_id)`). A
   Kitsu parou de cadastrar elenco por volta de 2020: temporada nova de
   franquia velha volta vazia. Agora, se a temporada vier vazia, tenta o MAL id
   da raiz (`root_mal_id`, achado nas `relations`).
   - Medido: Re:Zero 3ª (mal 54857) e Slime 3ª (mal 53580) = 0 na Kitsu; as
     1ªs temporadas = 50 e 11. Re:Zero S3 com o Jikan fora: 0 → 33
     personagens com 2 fotos.
   - Não resolve Dr. Stone: a Kitsu não tem elenco de nenhuma das 9 entradas
     da franquia (2019 em diante), nem de Mushoku, Frieren, Lv999 ou
     Apothecary. Para esses, a saída é a reserva do Corte Cenas (abaixo) e,
     desde 15/10, o MyAnimeList direto (item 8).
6. **`app/pipeline.py`** (`run`, passo 3/5) — o personagem do elenco acha a
   linha do banco pelo id que o `upsert_character` devolveu, não só pelo
   nome. Bug do upstream: o upsert reusa por tokens a linha de "Senkuu
   Ishigami" (nome da AniList, gravado numa rodada com o MyAnimeList fora)
   para "Ishigami, Senkuu" (MyAnimeList) SEM trocar o nome, e o
   `db_chars.get(ch.name)` do passo 5 não achava a linha: o personagem ficava
   sem embedding e fora do reconhecimento, em silêncio. Agora `ids_do_banco`
   guarda o id por nome e o lookup cai nele quando o nome não bate; os nomes
   que saem no `shots.json` continuam os do banco (os da 1ª rodada).
   - Medido no S04E24 com a reserva DEPOIS de uma rodada sem fotos: antes,
     162 de 385 cenas e 9 nomes (sumiram Senkuu, Gen, Taiju e Ukyou, todos
     de nome composto); depois, 178 de 385 e 12 nomes, igual ao banco limpo.
     O `index.db` do Studio do Levi já tinha os 50 nomes da AniList.

### Rostos em lote para o enquadramento (14/10)

Motivo: a "Edição rápida" enquadra cada bloco 9:16 no rosto. O detector do
Dangai (lbpcascade, frontal) achou rosto em 6 de 20 blocos do S4-37; o YOLO de
anime do motor + a cabeça de reserva acham em 17 de 20. Importar o torch e
subir a GPU custa ~8 s, então é UM processo para o lote inteiro. Esta mudança
é só do Studio (não vai ao ancut-hub-engine): nada do corte nem do
reconhecimento muda.

7. **`app/rostos.py`** (arquivo novo) + **`app/headless.py`**: modo
   `rostos` (`_rostos()` e uma linha no `main()`, marcados `[Studio]`).
   - Pedido JSON na 1ª linha do stdin: `itens` (`chave`, `arquivo`,
     `instantes` em s, `personagens` = quem a frase cita, `candidatos` = quem
     o índice reconhece no plano), `anime`, `temporada`, `identificar`.
   - Eventos: `pronto` (modelos no ar), um `rostos` por item (por quadro:
     caixas `x,y,w,h` em px, `conf`, `tipo` `rosto`|`cabeca`, `personagem`,
     `sim`, `quem`) e `fim`; erro pelo `failed` de sempre. O stdin fica
     aberto e o cancelamento é o mesmo do `run` (`_watch_stdin`).
   - Detecta com os MESMOS pesos do `AnimeFaceDetector`
     (`_YOLO_REPO/_YOLO_FILE`, cabeça só nos quadros sem rosto, conf 0.4,
     mínimo de 32 px a 1080p), pegando-os do cache do HuggingFace sem rede
     primeiro (`local_files_only`). Não mexe em `face_detector.py`.
   - Identifica quando o item tem `candidatos` e o quadro tem rosto. O
     conjunto FECHADO (19/10) são os citados, quem o índice vê no plano e o
     elenco principal do episódio (até 12 pessoas), nunca o elenco inteiro --
     contra o elenco inteiro o CLIP trocou o Gen pelo Gozan e marcou um
     figurante de fundo como Chrome. Cada rosto disputa só a pessoa que mais
     parece com ele (`atribuir`); com uma pessoa só no conjunto, só acima de
     `LIMIAR_SOZINHO`. Devolve `pessoa` (quem é) e `personagem` (o citado).
     CLIP ViT-L/14 + protótipos como o pipeline (`build_prototypes`), com os
     embeddings das fotos lidos do `ref_features.npz` com a MESMA meta do
     `_feature_meta`; foto sem embedding no cache é calculada e NÃO gravada.
     O CLIP sobe numa thread logo no começo, em paralelo com o YOLO.
   - (19/10) Item com citados procura CABEÇA também nos quadros que já têm
     rosto (o perfil); e, quando o 1º citado não tem rosto achado, devolve as
     `janelas` do recorte (`aspecto` = largura visível / altura do quadro):
     o CLIP de 5 posições contra os candidatos (`quem_na_janela`).
   - SÓ LEITURA: `Config.load()` sem `ensure_dirs()`/`save()`, o elenco
     achado por `AnimeFolderStore.franchise_for_name` + `resolve_anime_dir`
     (o mesmo caminho do modo só-cortar), `FeatureCache` sem `save()`.
     Conferido no teste: a pasta de dados fica intocada.
   - Quem chama: `electron/services/montar/rostos-motor.ts` (a decisão do
     foco, a suavização e a reserva no detector antigo moram lá).
   - Medido no S4-37 (20 blocos, RTX 5080, `scripts/teste/v-rosto-s437.ts`):
     rosto em 17/20 (85%) contra 6/20 (30%) do lbpcascade; 15,4 s o lote
     inteiro identificando (pronto em ~9 s) e 12,4 s só detectando, contra
     9,5 s do lbpcascade. O custo é quase todo fixo (torch + CUDA): o
     lbpcascade cresce ~0,5 s por bloco, o motor ~0,1 s.

### MyAnimeList direto, reserva do Jikan (15/10)

Motivo: o `api.jikan.moe` não abre conexão na rede do Levi (item 4), mas o
`myanimelist.net` responde, e o Jikan só lê o MAL e repassa. Sem as galerias,
anime novo ficava com 1 retrato por personagem (AniList) e terminava em
"sem-referencias". Para levar ao ancut-hub-engine também.

8. **`app/providers/mal_direto.py`** (arquivo novo) +
   **`app/providers/anime_provider.py`** + **`app/providers/kitsu.py`**.
   - `MalDireto` lê as MESMAS páginas que o Jikan lê:
     `/anime/<id>/_/characters` (blocos `table.js-anime-character-table`:
     link `/character/<id>/<slug>`, `h3.h3_character_name`, papel
     "Main"/"Supporting" e o retrato) e `/character/<id>/<slug>/pics`
     (links `a.js-picture-gallery`). Devolve os tipos do `JikanClient`
     (`JikanCharacter`, lista de URLs), com o nome no formato do MAL
     ("Liston, Nia" = o do Jikan; o merge por tokens com a AniList e a
     Kitsu continua igual). O retrato do elenco vem como miniatura assinada
     (`/r/42x62/...jpg?s=`) e vira a original (`/images/characters/...jpg`),
     que é a mesma URL da galeria: retrato e foto igual viram um arquivo só.
     O ponto de interrogação de quem não tem foto vira `None`.
   - Página sem os blocos e sem o aviso de vazia ("No characters ... added",
     "No pictures have been added") é FALHA (layout mudou, anti-bot), nunca
     "vazio": vai para o `missing_gallery` e a próxima rodada tenta de novo.
     E desiste do MAL na rodada JÁ na 1ª (`_pagina_estranha`): o 200 zerava
     o contador de falhas seguidas, e com o desafio servido em 200 as 18
     galerias eram pedidas uma a uma (simulado: 19 pedidos, sem desistir;
     agora 2). A página real de anime sem elenco (mal 65161) dá `[]`.
   - Educado: User-Agent de Chrome, um pedido por vez com 1 s de intervalo,
     `connect` de 6 s e leitura de 15 s; sem resposta no 1º pedido desiste
     do MAL na rodada (como o item 4), 3 falhas HTTP seguidas também, e a
     página estranha na 1ª; 429/5xx tem uma 2ª tentativa, 403/405 não.
     Cache em disco
     `<cache>/anime_db/_mal_direto/{anime-<id>-personagens,personagem-<id>-fotos}.json`
     (7 dias; a pasta não tem `metadata.json` nem `[al…]`, ninguém a toma
     por anime).
   - `JikanOuMal` tem a interface do `JikanClient` que o provider usa e é o
     que vai em `self.jikan` (1 linha no `__init__`, `[Studio]`): tenta o
     Jikan e só quando ELE falha (o `failures` dele sobe) lê o MAL direto. O
     `failures` dele só conta quando os DOIS falham, então `partial`,
     `missing_gallery`, `_completar_galerias` e os avisos de fonte seguem
     certos sem mexer neles. Com o Jikan no ar, o resultado é o dele. A busca
     do anime (só com a AniList fora) continua só no Jikan.
   - Kitsu por NOME (`KitsuClient.retrato_por_nome`, `filter[name]`): no
     laço dos personagens, quem ainda tem < 2 URLs e nenhum retrato da Kitsu
     ganha 1. A busca da Kitsu é aproximada ("Nia Liston" devolve Nia
     Teppelin), então só vale o personagem com o mesmo `malId`; sem MAL id
     (elenco da reserva da AniList), só o nome idêntico de 2+ palavras e
     único. Educada: um pedido a cada 0,5 s (`INTERVALO_NOME_S`), no máximo
     18 por rodada (`TETO_NOME`, na ordem por papel: corta figurante, nunca
     principal), e erro de rede, 429, 403 ou 5xx desliga a busca por nome na
     rodada. Achou 0 em Nia Liston, Bocchi e Dr. Stone (que fazia ~32 pedidos
     seguidos): ela fica para personagem que a Kitsu tem solto.
   - Medido (Jikan fora, pasta de dados nova, scratchpad `mal-direto/`):

     | anime | personagens | com ≥ 2 fotos | com 2+ artes distintas | resolve | fotos | pedidos ao MAL |
     |---|---|---|---|---|---|---|
     | Nia Liston (2025) | 22 | 11 (antes: 0) | 2 (Nia, Lynokis) | 34 s | 7 s | 19 |
     | Dr. Stone (9 entradas) | 80 de 93 | 43 | 29 | 60 s | 77 s | 27 |
     | Bocchi the Rock (3 entradas) | 17 | 13 | 13 | 36 s | 31 s | 20 |

     "Com ≥ 2 fotos" conta ARQUIVOS, como o motor. Os outros 9 do Nia Liston
     (e 14 do Dr. Stone) têm a MESMA arte duas vezes: o retrato do MAL e o da
     AniList em dois recortes (ORB + homografia: 177 a 770 pontos em comum,
     contra até 30 entre artes diferentes). No Nia Liston as galerias do MAL
     não acrescentam nada (a da Nia tem 2 fotos e uma cai no `_filtered`;
     com todas em 403 também saem 11): o ganho veio do retrato do elenco do
     MAL somado ao da AniList. O Studio avisa quem foi reconhecido assim
     (abaixo, "Limites").

     Os 8 s do 1º pedido ao Jikan entram no resolve. 2ª rodada: 0 pedidos
     HTTP, 0,2 s (banco + fotos no disco). Banco refeito sem metadata e com o
     MAL bloqueado: elenco e galerias saem do `_mal_direto` (0 pedidos ao
     MAL). MAL também fora: 1 pedido e o caminho antigo (reserva da AniList).
     Galerias em 403: desiste no 3º, banco `partial` com as 18 em
     `missing_gallery`, e o `_completar_galerias` (depois da trégua) as
     completa pelo MAL direto.
   - `run` do Nia Liston S01E01 pelo `analisarEpisodio` do Studio (perfil,
     biblioteca e pasta de dados novos, Jikan fora; 15/10, depois das
     correções): elenco em 44 s dentro da análise (34 s antes das pausas da
     Kitsu por nome), 11 personagens com embedding, `done` (não mais
     "sem-referencias") em 374 s; 214 de 432 cenas com personagem (Nia 147,
     Lynokis 54, Bendelio 16, Lynette 9, Anzel 9, Reliared 9, Fressa 4), e o
     fim com "Uma arte so: Anzel; Bendelio; Blanc, Lynette; Fressa; Silver,
     Reliared" (0,5 s). O S01E02 na mesma pasta de dados: elenco do banco em
     0,1 s, sem pedido ao MAL nem ao Jikan, 316 de 545 cenas com personagem
     (Nia 195, Sharro 62, Lynokis 51, Reliared 23, Anzel 13, Bendelio 6,
     Fressa 5, Gandolf 4) e o aviso para os 6 de uma arte só; Nia e Lynokis,
     com duas artes, ficam de fora.
   - Limites que ficam: anime novo tem galeria de 1 foto no MAL (o próprio
     retrato), então o 2º retrato depende de o nome do MAL e o da AniList
     terem as mesmas palavras (Nia Liston: "Hildetora"/"Hildetaura",
     "Neal"/"Neil" não casam), e quase sempre é a MESMA arte: passa do
     mínimo de 2 com uma imagem só. Conferido nos keyframes do S01E02: o
     Anzel errou 7 de 13 cenas (órfãos com a Sharro, capanga de jaqueta
     marrom) e o Gandolf 2 de 4 (capanga de bandana); a Nia, com duas artes,
     não. Isto NÃO muda no motor (o mínimo conta arquivos, igual ao
     upstream, e com o Jikan no ar seria igual): o Studio confere as fotos
     dos reconhecidos depois do `done`
     (`electron/services/descoberta/arte-unica.ts`, OpenCV em WASM) e a tela
     diz "Confira: ... (uma foto so)" com o "Revisar personagens" ao lado.
     Fixtures e testes, no scratchpad: `mal-direto/fixtures`,
     `mal-direto/scripts/t_parser.py`, `t_falhas.py` (MAL respondendo torto)
     e `t_kitsu_nome.py`; o aviso tem `scripts/teste/v-arte-unica.ts`.

### Acento no caminho e placa sem kernel no cu128 (15/10)

Motivo: o app instalado roda em PCs que não são o do Levi. As duas mudanças
são pequenas e marcadas `[Studio]`; a 9 é para levar ao ancut-hub-engine.

9. **`app/cv2_unicode.py`** (arquivo novo) + **`app/headless.py`** (`main()`,
   uma chamada antes do modo, menos no `probe`). O OpenCV 5 do lock
   (`opencv-python 5.0.0.93`) abre arquivo pela API ANSI do Windows: com
   acento no caminho (`C:\Users\Usuário`, anime com acento na pasta), o
   `cv2.imwrite` devolve False e o `cv2.imread` devolve None, sem erro. O
   corte saía normal (o ffmpeg e o `VideoCapture` aceitam), mas nenhum keyframe
   era gravado e nenhuma foto do elenco lida: o episódio terminava sem
   personagem nenhum. O módulo troca os dois por `np.fromfile + imdecode` e
   `imencode + tofile` (o jeito do `rostos.py`) SÓ quando o caminho não é
   ASCII: nas pastas do Levi o resultado é o do upstream byte a byte.
   - Medido (`extract_keyframes_batch` real, scratchpad `v010/corrigir`): sem
     a troca, "Usuario" = 3 de 3 keyframes, "Usuário" = 0 de 3; com a troca,
     3 de 3 nos dois e o `imread` lê os três.
10. **`app/config.py`**: `use_cuda` nasce `False` com
    `ANIRECAP_MOTOR_SEM_CUDA=1`. O runtime cu128 cuja conferência não rodou a
    conta na GPU (GTX 10xx: o torch 2.11 cu128 só tem sm_75+) subia com
    `CUDA_VISIBLE_DEVICES=-1`, que escondia a placa também do ffmpeg (sem
    NVENC/NVDEC: `cuInit` = NO_DEVICE). Agora o torch vai para a CPU pelo
    `use_cuda` de sempre (YOLO, CLIP, SCRFD, `rostos.py`) e o ffmpeg segue
    com a placa. Só do Studio.

Os modelos (CLIP, YOLO, CCIP, SCRFD) no app instalado vão para
`<runtime>\modelos` (`HF_HOME`, `motor-runtime/ambiente.ts`), não para o
`~/.cache/huggingface`: entram no disco escolhido, no Remover e no
desinstalador. No dev continua o cache global.

## Como o Studio chama

`electron/services/motor.ts`:

- Dev: `motor/.venv/Scripts/python.exe -m app.headless <modo>`, cwd `motor/`.
  O venv é **próprio** (uv, Python 3.12, torch cu128 para a RTX 5080), nunca o
  do Corte Cenas.
- Empacotado (15/10): o CÓDIGO vai no instalador em `resources/motor`
  (`app/`, `run.py`, `requirements.txt`, `studio-runtime.json`); o RUNTIME
  (Python 3.12 + torch + pacotes, ~5 GB) é instalado pelo app no 1º uso em
  `%LOCALAPPDATA%\AniRecap Studio\motor-runtime`, das fontes oficiais, pelo uv
  embutido (`electron/services/motor-runtime/`, tela "Instalar motor de
  personagens"). O Studio sobe `<runtime>\venv` com cwd `resources/motor`;
  a lista exata do que instalar é `motor/studio-runtime.json` (o lock:
  Python, torch cu128/cpu com URL + sha256, e os pacotes do PyPI com hash,
  sem o Qt). Dev com `ANIRECAP_MOTOR_RUNTIME=1` usa o runtime também
  (`ANIRECAP_MOTOR_RUNTIME_PASTA` troca a pasta, para testes).
- Env: `ANIRECAP_MOTOR_DADOS`, `PYTHONIOENCODING=utf-8`,
  `YOLO_AUTOINSTALL=false` (o `run.py` liga isto no exe; o `-m app.headless`
  não passa por ele) e o PATH com o ffmpeg do sistema primeiro e o
  ffmpeg-static do app no fim, de reserva. No runtime (app instalado) é o
  contrário, para não depender do PATH de ninguém: o ffmpeg-static do app
  PRIMEIRO, o ffprobe do compositor do Remotion por ÚLTIMO, Python isolado
  (sem `PYTHONHOME`/`PYTHONPATH`/site do usuário) e `PYTHONDONTWRITEBYTECODE`
  (nada é gravado em `resources/motor`; o site-packages já vem compilado da
  instalação). `motor-runtime/ambiente.ts`.
- Modos usados: `probe` (versão, GPU, ffmpeg), `parse <arquivo>` e `run`
  (requisição JSON na 1ª linha do stdin; `{"cmd":"cancel"}` cancela), e
  `rostos` (o item 7 acima, chamado por `montar/rostos-motor.ts` com o
  próprio spawn; log em `<dados>/logs/ultimos-rostos.log`).
- `run` com `discovery: true` ("Reconhecer na mao", 15/10): o Studio usa o
  Modo Descoberta como o AnCut, sem mudar nada no Python
  (`electron/services/descoberta/` + `analisarEpisodio(..., { descoberta: true })`
  e `comandarDescoberta` em `motor.ts`). Com as cenas no disco vai a
  `outputFolder` da pasta do anime e o corte é reaproveitado
  (`shot_bounds.json` + `shots/`); os rostos ficam em `metadata/face_cache.npz`.
  Depois do `discovery-ready` o processo fica vivo esperando UMA linha
  `{"cmd":"commit-discovery","names":{...},"removed":{...}}` (ou `cancel`); o
  Studio confere antes que pelo menos um grupo tem nome (sem nenhum, o
  `commit_discovery` lança e o processo morre). As fotos batizadas vão para
  `<dados>/cache/anime_db/<anime>/characters/<nome>/auto_disc_NN.jpg` e o
  centroide para `<dados>/cache/index.db`, os do Studio; o `run` normal do
  próximo episódio soma essas fotos às do catálogo e reconhece sozinho.
- Log da última análise: `<dados>/logs/ultima-analise.log`.

"Analisar com o AnCut" não usa esta pasta: chama o `CorteCenas.exe --headless`
do AnCut HUB instalado, que grava na pasta e na biblioteca dele.

## Bugs do motor contornados no Studio (levar ao ancut-hub-engine)

O código daqui continua igual ao upstream. Estes dois bugs são contornados em
TypeScript, nas pastas que são do Studio, e o contorno sai quando a correção
voltar por cópia:

1. **Corte de outro arquivo reaproveitado.** `keyframe_extractor.cut_all_shots`
   reaproveita `shots/NNNN.mp4` e `keyframes/NNNN_k.jpg` pelo número,
   conferindo só `.export_mode` e `.cor`. Quando `_prepare_shots` recalcula os
   limites porque o `shot_bounds.json.source` mudou (outro release do mesmo
   episódio na mesma pasta), a pasta fica com os tempos de um vídeo e as
   imagens do outro. Correção no motor: invalidar o reaproveitamento de clipes
   e keyframes sempre que os limites forem recalculados. Contorno:
   `electron/services/episodio/corte-de-outro-arquivo.ts` grava um `.cor` que
   não bate antes do `run`.
2. **Elenco degradado congelado.** Quando o Jikan falha já na lista de
   personagens, `anime_provider` salva o banco com `partial: true`,
   `missing_gallery: []` e os `mal_id` nulos; `_completar_galerias` sai na hora
   (lista vazia) e o atalho `busca_resolvida.json` reaproveita esse banco para
   sempre (reconhecimento preso em "sem-referencias"). Correção no motor:
   tratar `partial` sem `missing_gallery` (ou personagens sem `mal_id`) como
   refazer a busca inteira depois da trégua de 6 h. Contorno:
   `electron/services/elenco-degradado.ts` põe o `metadata.json` de lado
   (renomeia) depois da trégua.

## Reserva de fotos do elenco (no Studio, sem mexer no motor)

`electron/services/elenco-reserva.ts`. Antes de subir o motor com
reconhecimento — e de novo quando ele volta `needs-input` `refs-missing` —, o
Studio procura o elenco do MESMO anime já baixado pelo Corte Cenas e copia para
`<dados>/cache/anime_db`, onde o motor acha o banco pelo id da franquia e segue
normal.

- Origens, SÓ LEITURA: `G:\App Corte Cenas\cache\anime_db` (Corte Cenas do
  fonte) e `%LOCALAPPDATA%\CorteCenas\CorteCenas\cache\anime_db` (Corte Cenas
  e AnCut HUB instalados, que dividem a pasta). `ANIRECAP_ELENCO_RESERVA`
  (raízes separadas por `;`) troca a lista, para testes.
- O id (`al<id>`, o sufixo `[al<id>]` da pasta) vem do que o motor do Studio já
  resolveu (`busca_resolvida.json`, `pastas_de_anime.json`), do índice de
  buscas do Corte Cenas (`busca_resolvida.json` ou o `index.json` antigo, mesmo
  formato), do `refsDir` do needs-input ou, na falta, do título (só com um
  anime casando).
- Copia `metadata.json` + `characters/` inteiros (as fotos têm o nome que o
  downloader do motor daria, sha1 da URL, e só contam com o metadata junto).
  `ref_features.npz` fica (chaveado pelo caminho absoluto, não bateria). O
  `fetched_at` em segundos do Corte Cenas vira ISO na cópia.
- Só quando o banco do Studio para o id não reconhece ninguém; o banco ruim vai
  inteiro para `<dados>/cache/elenco-posto-de-lado/`. A cópia passa por uma
  pasta temporária e só então ganha o nome final.
- Ensina `nome|sN -> id` ao `busca_resolvida.json` do motor quando o id não
  veio de palpite de título: o motor acha o banco sem a AniList.
- De onde vieram as fotos: `reserva-do-studio.json` na pasta copiada,
  `fotosDoElenco()` e a linha `[studio] fotos do elenco: ...` do log.

## Atualizar a cópia

1. Copiar o ancut-hub-engine novo por cima de `motor/` (sem `.venv`).
2. Reaplicar as dez mudanças acima (procurar `[Studio]` no diff; o
   `app/rostos.py` é só do Studio e fica como está; o
   `app/providers/mal_direto.py` fica até o upstream ter o seu).
3. Atualizar o commit no topo deste arquivo e no `NOTICE`.
4. `node out/teste/v-motor.cjs rapido` (ver `scripts/teste/v-motor.ts`).
5. Pacote novo ou de outra versão no `motor/.venv`? Regerar o lock do app
   instalado: `node scripts/motor-lock.mjs` (e `--conferir`). Ele vai no
   instalador; o app instalado compara a "impressão" dele com a do runtime e
   atualiza sozinho quando só os pacotes mudaram (torch ou Python mudados:
   pergunta antes). Teste: `scripts/teste/v-motor-runtime-instalar.ts`.
