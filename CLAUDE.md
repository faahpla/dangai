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
- `ducking` no trecho de áudio é do núcleo (não `modulos.recap`): com ele o trecho
  desce sob a voz pelo envelope das palavras do transcript (`shared/ducking.ts`),
  o mesmo no preview e no render; sem ele, nada muda (`v-som-mix.ts`).

Testes: `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-<nome>.ts`.

**Os ganchos** (fase 2). Um módulo só fala com o núcleo por aqui; o núcleo só conhece
o módulo pelos três arquivos de registro, uma linha por módulo:

| registro | o que entra | contrato |
|---|---|---|
| `modulos/registro.main.ts` | `ModuloDoMain` | `electron/modulos.ts` |
| `modulos/registro.preload.ts` | a fábrica da ponte (`modulos/<id>/electron/ponte.ts`) | `shared/modulos.ts` |
| `modulos/registro.renderer.ts` | `ModuloDoRenderer` | `src/modulos/api.ts` |

- **Main:** `configurar` → `registrarIpc` → `ligar` (depois da janela, só ligado) →
  `desligar`; `antesDeSair` segura a saída (teto de 11 min); `motivoParaNaoAtualizar`
  veta o "Atualizar". Tudo em try/catch: módulo que quebra fica de fora e o Dangai abre.
  O `ctx` recusa canal fora de `<id>:` e dá `config`/`salvarConfig`, `chave`/`salvarChave`
  (cofre), `pasta(...)`, `enviar` e `ia` (o `gerarJson` do núcleo, o `provedor()` e o `modelo()` — o
  módulo nunca vê as chaves de IA).
  `transcribe` (whisper) e `alinharAoAudio` aceitam `signal`: o pedido sai na hora e o
  processo morre quando ninguém mais espera a mesma transcrição. Os leitores de pasta do `library.ts` (`episodiosEm`,
  `arquivosEm`, `acharKeyframe`, `nomesCanonicos`, `abrangidas`, `naturalmente`) são públicos.
- **Ponte:** `window.dangai.modulos.<id>`, montada pelo preload do núcleo com um
  `invocar`/`assinar` presos ao prefixo. A ponte roda no sandbox: só `import type` e constantes.
- **Renderer:** telas cheias (`nucleo.telaCheia` deixa o resto inerte e os atalhos quietos),
  botões na tela inicial, seções nas Configurações (com âncora e "abrir numa seção"),
  comandos na paleta, barra de render, barra de status, rótulo do clipe na timeline e
  `interceptarArquivos` (soltar/diálogo). O módulo usa a **fachada** (`src/modulos/nucleo.ts`)
  (com `usarEuMesmo`/`reler`: o `ModuloPublico` do próprio módulo — config pública e tem/dica
  das chaves) e o **kit de interface** (`src/modulos/kit.ts`), nunca o `useProject` nem `@/components`
  direto; mudar os dois é combinar antes. Cada módulo tem uma fronteira de erro sempre
  montada: erro de componente — inclusive na limpeza, ao desligar — some com ele, não com a janela.
- **Ligar/desligar:** Configurações > Módulos (`Settings.modulosLigados`); desligado por padrão.
- **Eventos:** `abrirProjeto`, `depoisDeSalvar`, `depoisDeRenderizar`, `narracaoTrocada`
  (`src/modulos/ganchos.ts`). `aplicarNoDocumento`/`gravarNoProjeto` = um passo de Ctrl+Z.
- **Transcrição travada** (`transcriptTravado`, `nucleo.travarTranscript`): com os tempos
  vindos da voz gerada, análise, Biblioteca e "montar sozinho" não rodam o Whisper — o
  roteiro novo é casado por texto sobre esses tempos. Trocar a narração destrava.
- O `settings.json` também guarda o que não conhece (campos de versão futura, a chave
  cifrada de um módulo que não está instalado).
