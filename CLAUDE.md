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

## Módulos (o Gerar recap do Levi)

Dois donos no mesmo `main`, sem PR: `modulos/recap/` é do Levi (leviclementino1-creator);
o resto é do Faah. Mudança no núcleo pedida pelo módulo entra pequena, um assunto
por commit. Antes de cada push: `git pull --rebase`, `npm run typecheck` e os testes.

**O núcleo guarda e devolve o que não entende** (fase 0, ver `v-modulos.ts`):

- dados de módulo em `modulos.<id>` — na raiz do projeto, em cada trecho de áudio
  e em cada clipe da faixa de vídeo; nas configurações, em `Settings.modulos`.
  O núcleo nunca interpreta; quem valida o próprio pedaço é o módulo;
- campos desconhecidos da raiz e dos itens (o `studio` do AniRecap Studio, um
  campo de versão futura) voltam ao arquivo como vieram
  (`projectFileSchemaQuePreserva`, `extrasDoProjeto`);
- arquivo com dado de módulo grava `version: 2`; sem, continua 1;
- `.anirecap` abre, mas nunca é regravado: o Salvar sugere um `.dangai`.

Testes: `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-<nome>.ts`.
