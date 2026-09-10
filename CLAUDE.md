# Dangai

Máquina de fazer shorts de recap de anime. Entra narração `.mp3`, prints e
roteiro `.txt`; sai um MP4 9:16 pronto para publicar. Não é um editor de vídeo —
é um caminho só, do material bruto ao arquivo final.

## Regra central

**O roteiro é a fonte da verdade.** O Whisper roda local e serve apenas para
obter os tempos; o texto das legendas vem sempre do roteiro, nunca da
transcrição. As cenas são cortadas pela pontuação do roteiro — um ponto final
encerra uma cena.

## Layout

| pasta | o que é |
|---|---|
| `src/` | renderer — `App.tsx`, `components/`, `hooks/`, `store/` |
| `src/remotion/` | composições Remotion que geram o vídeo |
| `electron/` | processo main e `electron/services/` |
| `shared/` | contrato entre main e renderer: `channels.ts`, `contract.ts`, `plan.ts`, `align.ts`, `rhythm.ts`, `sfx.ts`, `selection.ts` |

Mudou o formato de uma mensagem IPC? O tipo mora em `shared/` — mexa lá primeiro
e deixe os dois lados seguirem o tipo.

## Comandos

```bash
npm run dev          # app com recarga automática
npm run typecheck    # TS nos três processos
npm run build        # typecheck + bundles do Electron e do Remotion
npm run dist         # instalador em release/
```

`GH_TOKEN` (de `gh auth token`) só é necessário para **publicar** release.

Ambiente: Node 24, ffmpeg 9 no PATH. Ver `E:\Projetos\COMO-RODAR.md`.
