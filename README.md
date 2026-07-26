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
npm version patch
npm run release
git push --follow-tags
```

`npm run release` monta o instalador e publica direto na release do GitHub.
Precisa de `GH_TOKEN` no ambiente — `gh auth token` serve.

Confira a release antes de considerar publicada: o electron-builder às vezes
sobe só o `.blockmap` e deixa a release como rascunho. Sem o `.exe` e o
`latest.yml`, nenhum app se atualiza.

```bash
gh release view vX.Y.Z --json isDraft,assets
gh release upload vX.Y.Z release/Dangai-X.Y.Z-win-x64.exe release/latest.yml
gh release edit vX.Y.Z --draft=false
```

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
