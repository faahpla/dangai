# Dangai

Máquina de fazer shorts de recap de anime. Você solta a narração em `.mp3`, as
prints e o roteiro em `.txt`; ele devolve um MP4 9:16 pronto para publicar.

Não é um editor de vídeo. É um caminho só, do material bruto ao arquivo final,
com ajuste manual onde importa.

## O que ele faz sozinho

- **Transcreve a narração** com Whisper local, sem mandar áudio para lugar nenhum.
- **Casa o roteiro com o áudio** por alinhamento de sequências: o texto das
  legendas vem do roteiro (sem erro de escrita), os tempos vêm da narração.
- **Corta as cenas pela pontuação** do roteiro — um ponto final é o fim de uma
  ideia, e é ali que o olho aceita ver outra imagem.
- **Distribui as imagens** na ordem em que você soltou, uma por bloco.
- Ken Burns, transições, SFX intercalados e legendas queimadas em Komika Axis.
- Renderiza em 1080x1920, 23.976fps, H.264, áudio normalizado em −14 LUFS.

Com uma chave da Anthropic configurada, a distribuição das cenas passa a ser
decidida pelo conteúdo da narração. Sem chave, tudo continua funcionando —
apenas com os cortes pela pontuação.

## Instalar

Baixe o instalador mais recente em
[Releases](https://github.com/faahpla/dangai/releases/latest).

O instalador não é assinado, então o SmartScreen avisa na primeira execução:
**Mais informações → Executar assim mesmo**.

A partir daí o app se atualiza sozinho: ele consulta as releases, baixa em
segundo plano e mostra um botão na barra de status quando a versão nova está
pronta. Reiniciar é decisão sua.

## Desenvolver

```bash
npm install
npm run dev
```

| comando | o que faz |
| --- | --- |
| `npm run dev` | abre o app com recarga automática |
| `npm run typecheck` | TypeScript nos três processos |
| `npm run build` | typecheck + bundles do Electron e do Remotion |
| `npm run dist` | gera o instalador em `release/` |
| `npm run icon -- caminho/logo.png` | regenera `build/icon.ico` |
| `npm run sfx` | sintetiza os SFX de exemplo |

### Publicar uma versão

```bash
npm version minor        # patch, se for só correção
git push
git push origin vX.Y.Z
npm run release
```

**O push vem ANTES do release**, e o script recusa publicar sem isso. A tag vai
num push próprio porque `--follow-tags` só envia tags **anotadas**, e as deste
projeto são leves — `git push --follow-tags` a deixaria para trás sem reclamar.

`npm run release` empacota e publica pelo `gh`. Precisa do `gh` autenticado.
Para ensaiar sem publicar:

```bash
npm run release -- --dry-run
```

Ele confere sozinho, e recusa em vez de publicar errado: tree sujo, tag fora do
remoto ou apontando para outro commit, `latest.yml` de outra versão, tamanho do
`.exe` diferente do que o `latest.yml` declara. No fim pergunta ao endpoint
`releases/latest` o que o **updater** vê — e não o que está na tag.

### Por que não é `electron-builder --publish always`

Porque isso falhou três vezes seguidas, e não por configuração. O
electron-builder abre **um publisher por artefato**, cada um com a release
cacheada numa instância própria. Com o `.exe` e o `.blockmap` são duas chamadas
concorrentes que leem "a release não existe" e criam as duas. Uma ganha, a outra
recebe `422 already_exists` e **aborta o processo** — levando junto o
`latest.yml`, que só seria gerado depois.

Foi assim que a v1.24.0 saiu com duas releases na mesma tag (o GitHub elegeu
como "latest" a que estava quase vazia) e a v1.25.0 saiu sem `latest.yml`.

Uma armadilha que vale conhecer mesmo com o script: **`release/` não é limpo
entre publicações**. O `latest.yml` da versão anterior sobrevive ali com cara de
novo, e subi-lo produz uma release completa na aparência que diz aos apps que a
versão mais recente é a velha — ninguém atualiza, e o sintoma aparece dias
depois. É a conferência que o script faz antes de qualquer upload.

Os apps instalados percebem sozinhos em algumas horas, ou na próxima abertura.

## Onde as coisas ficam

```
electron/     processo main: whisper, ffmpeg, render, arquivos
shared/       o que main e renderer precisam concordar (planos, legendas, alinhamento)
src/          interface React
src/remotion/ a composição do vídeo — a mesma no preview e no render
```

`shared/` existe porque o preview e o render precisam chegar exatamente ao mesmo
plano. Se divergirem, o preview mente.

Dados do usuário ficam em `%APPDATA%/dangai`: chave da API, modelo do Whisper,
pasta de SFX e o Chrome do render.

## Privacidade

Nenhum arquivo sai da sua máquina. O áudio é transcrito localmente e as imagens
nunca são enviadas. Quando a IA está ligada, só o texto da transcrição vai para
a API — mais nada.
