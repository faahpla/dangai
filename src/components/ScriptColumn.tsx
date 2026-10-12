import { useEffect, useRef, useState } from 'react'
import { Reorder, useDragControls } from 'motion/react'
import {
  Check,
  Copy,
  GripVertical,
  Loader2,
  LocateFixed,
  Pause,
  Merge,
  Minus,
  Plus,
  Rows2,
  Split,
  X,
} from 'lucide-react'
import { useProject } from '@/store/project'
import type { LibraryClip } from '@shared/channels'
import type { Word } from '@shared/contract'
import {
  cabeCortePorPalavra,
  palavrasDoTrecho,
  palavrasPorSlot,
  slotsDoTrecho,
  spansDoTrecho,
  type Span,
} from '@shared/trecho'

/**
 * O roteiro dentro da Biblioteca, trecho a trecho.
 *
 * Existe porque escolher cena sem saber ONDE ela cai era escolher no escuro --
 * palavras dele, "hoje e meio aleatorio ne?!". O trecho aberto recebe as cenas
 * que ele marcar na grade, e o contador diz na hora quanto cada uma vai durar.
 *
 * O alvo e o TRECHO entre pontuacoes, e nao a frase inteira. Ele pediu assim
 * depois de usar: "eu quero ter a possibilidade de selecionar a linha inteira
 * antes de qualquer pontuacao, virgula ou qualquer coisa do genero". Cortar so
 * no ponto final deixava um bloco de 5,5 segundos onde ele queria tres cortes:
 *
 *   "Isso acontece quando Subaru abre o Livro dos Mortos de Reid e,"
 *   "em vez de encontrar as memorias dele,"
 *   "acaba no Corredor das Lembrancas."
 *
 * A frase continua na tela como AGRUPAMENTO, para ele nao perder de vista onde
 * uma ideia comeca e acaba -- foi como ele descreveu, "cada frase que esta
 * dentro de um bloco".
 */
export function ScriptColumn() {
  const audio = useProject((s) => s.audio)
  const blocos = useProject((s) => s.scriptBlocks)
  const busy = useProject((s) => s.scriptBlocksBusy)
  const ativo = useProject((s) => s.activeBlock)
  const porBloco = useProject((s) => s.blockClips)
  const pesos = useProject((s) => s.blockWeights)
  const setBlockWeight = useProject((s) => s.setBlockWeight)
  const removeBlockClip = useProject((s) => s.removeBlockClip)
  const duplicateBlockClip = useProject((s) => s.duplicateBlockClip)
  const unioes = useProject((s) => s.blockSplits)
  const cortes = useProject((s) => s.blockCuts)
  const setBlockCut = useProject((s) => s.setBlockCut)
  const clearBlockCuts = useProject((s) => s.clearBlockCuts)
  const toggleBlockSplit = useProject((s) => s.toggleBlockSplit)
  const setAtivo = useProject((s) => s.setActiveBlock)
  const carregar = useProject((s) => s.loadScriptBlocks)
  const transcript = useProject((s) => s.transcript)
  const library = useProject((s) => s.library)
  const reordenar = useProject((s) => s.reorderBlockClips)
  const juntar = useProject((s) => s.juntarTrechos)
  const separar = useProject((s) => s.separarTrecho)

  const lista = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (audio) void carregar()
  }, [audio, carregar])

  // A frase aberta anda sozinha ao marcar cenas; sem isto ela sairia da vista.
  useEffect(() => {
    lista.current?.querySelector('[data-ativo="sim"]')?.scrollIntoView({ block: 'nearest' })
  }, [ativo])

  if (!audio) {
    return (
      <Coluna>
        <p className="p-4 text-[12px] leading-relaxed text-ink-3">
          Solte a narracao para ver o roteiro aqui e marcar as cenas de cada frase.
        </p>
      </Coluna>
    )
  }

  if (!blocos) {
    return (
      <Coluna>
        <p className="flex items-center gap-2 p-4 text-[12px] text-ink-3">
          <Loader2 size={13} strokeWidth={1.5} className="animate-spin text-accent" />
          {busy ?? 'Lendo o roteiro...'}
        </p>
      </Coluna>
    )
  }

  const marcadas = Object.values(porBloco).reduce((n, c) => n + c.length, 0)

  /*
   * Quantos trechos ainda estao sem cena.
   *
   * O cabecalho dizia "39 trechos · 12 cenas" e nao dizia QUAIS faltavam --
   * numa passada de 39 e facil pular um. Trecho vazio nao some do video: o
   * tempo dele e absorvido pelo trecho anterior, em silencio.
   */
  const vazios = blocos.filter((_, i) => (porBloco[i] ?? []).length === 0).length

  /** Caminho -> a cena da biblioteca, para saber duracao e miniatura. */
  const porCaminho = new Map((library?.clips ?? []).map((c) => [c.path, c]))

  /*
   * Os trechos remontados em frases.
   *
   * A lista que vem do main e achatada -- e o que toda a maquinaria ja consome
   * --, e cada trecho carrega o numero da frase de onde saiu. Agrupar aqui e
   * so juntar os vizinhos que tem o mesmo numero.
   */
  const frases: { indices: number[]; start: number; end: number }[] = []
  for (const [i, bloco] of blocos.entries()) {
    const ultima = frases[frases.length - 1]
    const mesma = ultima && blocos[ultima.indices[0]!]!.sentence === bloco.sentence
    if (mesma) {
      ultima.indices.push(i)
      ultima.end = bloco.end
    } else {
      frases.push({ indices: [i], start: bloco.start, end: bloco.end })
    }
  }

  return (
    <Coluna>
      <header className="flex shrink-0 items-baseline justify-between border-b border-line px-4 py-2.5">
        <span className="text-[12px] font-medium text-ink">Roteiro</span>
        {/*
          Duas ou tres contagens, nunca quatro.
          "25 frases" saia junto e nao mudava decisao nenhuma -- a frase e
          agrupamento visual, o TRECHO e a unidade de trabalho. Com quatro
          numeros o rosa dos vazios ainda quebrava linha.
        */}
        <span className="tnum text-[11px] text-ink-3">
          {blocos.length} trechos
          {marcadas > 0 && ` · ${marcadas} cenas`}
          {vazios > 0 && (
            <span
              className="text-accent"
              title={`${vazios} ${vazios === 1 ? 'trecho ainda sem cena. O tempo dele vai para o trecho anterior.' : 'trechos ainda sem cena. O tempo deles vai para o trecho anterior.'} Tab pula para o proximo.`}
            >
              {' '}
              · {vazios} {vazios === 1 ? 'vazio' : 'vazios'}
            </span>
          )}
        </span>
      </header>

      <div ref={lista} className="min-h-0 flex-1 overflow-y-auto">
        {frases.map((frase, iFrase) => (
          <div key={iFrase} className="border-b border-line">
            {/*
              O cabecalho da frase existe para ele nao perder de vista onde uma
              ideia comeca e acaba. Ele nao e clicavel: quem recebe cena e o
              TRECHO, e um alvo que parece clicavel e nao e seria pior que
              nenhum.
            */}
            {/*
              A frase nao repete o tempo.
              Numa frase de um trecho so, o intervalo dela e o do trecho logo
              abaixo -- o mesmo numero duas vezes seguidas. Quem recebe cena e
              o trecho, entao o tempo fica com ele.
            */}
            <div className="px-4 pb-0.5 pt-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
                Frase {iFrase + 1}
              </span>
            </div>

            {frase.indices.map((i) => {
          const bloco = blocos[i]!
          const cenas = porBloco[i] ?? []
          const dura = bloco.end - bloco.start
          /*
           * As fatias saem do PESO de cada cena, nao do numero delas.
           *
           * Sem peso todas valem 1 e a conta volta a ser a de antes -- partes
           * iguais. A mesma conta roda no applyBlockClips; se as duas
           * discordassem, o que ele ve na fita nao seria o que sai no video.
           */
          const pesosDoBloco = cenas.map((_, j) => pesos[i]?.[j] ?? 1)
          const cada = cenas.length > 0 ? dura / cenas.length : dura
          const aberto = ativo === i

          /*
           * Como o trecho se reparte, pela MESMA conta que monta o plano.
           *
           * Antes eram duas contas parecidas e elas divergiram: a pintura
           * dividia em partes iguais enquanto o video ja respeitava o peso.
           * Agora as duas chamam @shared/trecho, e a cor nao tem como mentir.
           */
          const slots = slotsDoTrecho(cenas, pesos[i], unioes[i])
          const palavrasDaFrase = palavrasDoTrecho(
            transcript?.words ?? [],
            bloco.start,
            bloco.end,
          )
          const cortesDoBloco =
            cortes[i]?.length === slots.length - 1 ? cortes[i]! : null
          const spans = spansDoTrecho(
            bloco.start,
            bloco.end,
            slots,
            palavrasDaFrase,
            cortesDoBloco,
          )
          const podePuxar = cabeCortePorPalavra(slots.length, palavrasDaFrase.length)

          /*
           * Quanto tempo sobra para CADA CENA, e nao para cada slot: a cena
           * unida divide o quadro com a parceira mas dura o slot inteiro.
           */
          const fatias = cenas.map((_, j) => {
            let posicao = 0
            for (const [k, slot] of slots.entries()) {
              if (posicao === j || (slot.paths.length === 2 && posicao + 1 === j)) {
                const sp = spans[k]
                return sp ? sp.end - sp.start : cada
              }
              posicao += slot.paths.length
            }
            return cada
          })

          /*
           * Quanto cada cena curta demais vai CONGELAR.
           *
           * Clipe menor que a fatia dele nao encolhe o bloco: o ultimo frame
           * fica parado ate o bloco fechar. Meio segundo passa; dois segundos
           * viram um print no meio do video, e ate agora isso so aparecia no
           * mp4 pronto -- a escolha manual nao tinha nenhuma trava, enquanto a
           * montagem automatica ja recusava clipe curto demais.
           */
          const congelamentos = cenas
            .map((caminho, j) => ({ clip: porCaminho.get(caminho), fatia: fatias[j] ?? cada }))
            .filter((x): x is { clip: LibraryClip; fatia: number } =>
              x.clip !== undefined && x.clip.duration < x.fatia,
            )
            .map((x) => x.fatia - x.clip.duration)

          return (
            <div
              key={i}
              role="button"
              tabIndex={0}
              data-ativo={aberto ? 'sim' : 'nao'}
              onClick={() => setAtivo(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setAtivo(i)
                }
              }}
              className={[
                'w-full cursor-pointer border-l-2 py-2 pl-4 pr-4 text-left transition-colors duration-150',
                aberto
                  ? 'border-l-accent bg-accent-dim'
                  : 'border-l-transparent hover:bg-elevated',
              ].join(' ')}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="tnum text-[10px] text-ink-3">
                  {tempo(bloco.start)} – {tempo(bloco.end)}
                </span>
                {/*
                  Trecho vazio se anuncia.
                  Ele nao some do video -- o tempo dele e absorvido pelo trecho
                  anterior --, entao pular um sem querer muda a montagem em
                  silencio. Um ponto basta: a lista tem 39 linhas e um aviso
                  por linha viraria ruido.
                */}
                {cenas.length === 0 && !aberto && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3/50"
                    title="Sem cena. O tempo deste trecho vai para o anterior."
                  />
                )}
                {cenas.length > 0 && (
                  <span className="flex items-center gap-2">
                    {/*
                      "Esse sistema de congela... ate hoje acho confuso." O nome
                      agora diz o que se VE no video: a imagem para. O tooltip
                      diz por que e como resolver; a fita do trecho aberto mostra
                      quanto, em cada cena.
                    */}
                    {congelamentos.length > 0 && (
                      <span
                        className="flex items-center gap-1 text-[10px] text-accent"
                        title={
                          (congelamentos.length === 1
                            ? `Uma cena e mais curta que o tempo que ganhou: o ultimo quadro dela fica PARADO por ${congelamentos[0]!.toFixed(1)}s.`
                            : `${congelamentos.length} cenas sao mais curtas que o tempo que ganharam; a pior fica PARADA por ${Math.max(...congelamentos).toFixed(1)}s.`) +
                          ' Abra o trecho: a barra riscada mostra onde. Para resolver, de menos tempo a ela (-), troque por um clipe mais longo ou ponha mais uma cena.'
                        }
                      >
                        <Pause size={10} strokeWidth={2.25} />
                        imagem parada
                      </span>
                    )}
                    <span
                      className="tnum flex items-center gap-1 text-[10px] text-accent"
                      /*
                       * Quantas cenas, por extenso. Era "4× 0.4s", a mesma notacao
                       * do "1x" que ninguem entendia -- e errada com peso: dividia
                       * igual enquanto a fita logo abaixo ja mostrava 0,8s numa das
                       * quatro. Os segundos de cada uma moram na fita agora.
                       *
                       * Com UMA cena os segundos ficam aqui, porque sao o numero que
                       * ensina o ritmo: 4,2s numa cena so grita que falta cena.
                       */
                      title={`${cenas.length} ${cenas.length === 1 ? 'cena' : 'cenas'} dividindo ${dura.toFixed(1)}s`}
                    >
                      <Check size={10} strokeWidth={2} />
                      {cenas.length === 1 ? `1 cena · ${dura.toFixed(1)}s` : `${cenas.length} cenas`}
                    </span>
                  </span>
                )}
              </div>
              <Frase
                texto={bloco.text}
                palavras={palavrasDaFrase}
                spans={spans}
                aberto={aberto}
                podePuxar={podePuxar}
                puxada={cortesDoBloco !== null}
                onPuxar={(fronteira, palavra) => setBlockCut(i, fronteira, palavra)}
                onSoltar={() => clearBlockCuts(i)}
              />

              {/*
                As cenas da frase ABERTA, na ordem do video, arrastaveis. So na
                aberta: a fita nas vinte e seis linhas de uma vez transformaria
                a coluna do roteiro numa segunda esteira.
              */}
              {aberto && cenas.length > 0 && (
                <Fita
                  caminhos={cenas}
                  duracao={dura}
                  fatias={fatias}
                  pesos={pesosDoBloco}
                  porCaminho={porCaminho}
                  onOrdem={(paths) => reordenar(i, paths)}
                  onPeso={(posicao, peso) => setBlockWeight(i, posicao, peso)}
                  onRemover={(posicao) => removeBlockClip(i, posicao)}
                  onRepetir={(posicao) => duplicateBlockClip(i, posicao)}
                  unidas={unioes[i] ?? []}
                  onDividir={(posicao) => toggleBlockSplit(i, posicao)}
                />
              )}

              {/*
                JUNTAR com o proximo, e SEPARAR o que foi juntado.

                A pontuacao corta onde corta, e as vezes corta curto demais:
                "Veldora," sozinho sao 0,3s, e nao cabe clipe nenhum ali. So no
                trecho ABERTO, como a fita -- sao ~40 linhas, e dois botoes em
                cada uma encheriam a coluna de alvos que ele nao esta usando.
              */}
              {aberto && (i < blocos.length - 1 || (bloco.partes?.length ?? 0) >= 2) && (
                <div className="mt-2 flex items-center gap-3">
                  {i < blocos.length - 1 && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        juntar(i)
                      }}
                      title={`Junta com "${blocos[i + 1]!.text}" num trecho so. As cenas dos dois somam.`}
                      className="flex items-center gap-1 text-[11px] text-ink-3 transition-colors duration-150 hover:text-ink"
                    >
                      <Merge size={11} strokeWidth={1.5} />
                      Juntar com o proximo
                    </button>
                  )}
                  {(bloco.partes?.length ?? 0) >= 2 && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        separar(i)
                      }}
                      title={`Volta a ser ${bloco.partes!.length} trechos. As cenas ficam no primeiro.`}
                      className="flex items-center gap-1 text-[11px] text-ink-3 transition-colors duration-150 hover:text-ink"
                    >
                      <Split size={11} strokeWidth={1.5} />
                      Separar
                    </button>
                  )}
                </div>
              )}
            </div>
          )
            })}
          </div>
        ))}
      </div>
    </Coluna>
  )
}

/**
 * O texto da frase pintado por cena.
 *
 * Cada cena cobre um trecho, e o trecho aparece: "A magia mais fraca do Rudeus"
 * e a cena 1, "gasta mais mana que a mais forte." e a cena 2. Foi o que ele
 * pediu -- ver ao vivo ate onde cada clipe vai ficar -- e da para fazer por
 * PALAVRA porque a transcricao ja traz o tempo de cada uma.
 *
 * Com uma cena so, ela cobre a frase inteira. Isso nao e um defeito da pintura:
 * e a divisao de verdade aparecendo, e e o aviso de que falta cena ali.
 */
function Frase({
  texto,
  palavras,
  spans,
  aberto,
  podePuxar,
  puxada,
  onPuxar,
  onSoltar,
}: {
  texto: string
  palavras: readonly Word[]
  spans: readonly Span[]
  aberto: boolean
  podePuxar: boolean
  puxada: boolean
  onPuxar: (fronteira: number, palavra: number) => void
  onSoltar: () => void
}) {
  const [puxando, setPuxando] = useState<number | null>(null)
  const [alvo, setAlvo] = useState<number | null>(null)

  /*
   * O ARRASTE MORA NA JANELA, e nao no paragrafo nem na alca.
   *
   * "A alcinha de arrastar e meio bugada, tem hora que nao consigo colocar
   * onde eu quero." A alca segurava o ponteiro (pointer capture), mas a cada
   * palavra que o corte andava a frase se redesenhava e a alca era RECRIADA
   * em outro lugar -- a captura morria junto, e o arraste soltava sozinho no
   * meio do gesto. Sair do paragrafo tambem soltava. Ouvindo a janela, nada
   * disso interrompe: o gesto so acaba quando o botao sobe.
   *
   * A palavra sob o dedo vem do ELEMENTO sob o ponteiro, e nao de coordenada
   * calculada: o texto QUEBRA LINHA, entao a posicao horizontal sozinha nao
   * diz nada -- a primeira palavra da segunda linha fica a esquerda da
   * ultima da primeira.
   */
  useEffect(() => {
    if (puxando === null) return
    const mover = (event: PointerEvent): void => {
      const sob = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-palavra]')
      const valor = sob?.getAttribute('data-palavra')
      if (valor === null || valor === undefined) return
      const palavra = Number(valor)
      setAlvo(palavra)
      onPuxar(puxando, palavra)
    }
    const soltar = (): void => {
      setPuxando(null)
      setAlvo(null)
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', soltar)
    return () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', soltar)
    }
  }, [puxando, onPuxar])

  if (spans.length === 0 || palavras.length === 0) {
    return (
      <p className={['mt-1 text-[12px] leading-snug', aberto ? 'text-ink' : 'text-ink-3'].join(' ')}>
        {texto}
      </p>
    )
  }

  const doSlot = palavrasPorSlot(palavras, spans)

  /*
   * As palavras agrupadas por cena, para o fundo ser CONTINUO.
   *
   * Pintar palavra por palavra transformava a frase numa grade de caixinhas e
   * escondia justamente o que a cor existe para mostrar: onde uma cena comeca e
   * acaba. O fundo e do grupo; cada palavra continua sendo um elemento proprio
   * por dentro, que e o que o arraste precisa para saber onde o dedo esta.
   */
  const grupos: { slot: number; palavras: { texto: string; indice: number }[] }[] = []
  for (const [indice, palavra] of palavras.entries()) {
    const slot = doSlot[indice]!
    const ultimo = grupos[grupos.length - 1]
    if (!ultimo || ultimo.slot !== slot) {
      grupos.push({ slot, palavras: [{ texto: palavra.text.trim(), indice }] })
    } else {
      ultimo.palavras.push({ texto: palavra.text.trim(), indice })
    }
  }

  return (
    <>
      <p
        className={[
          'mt-1 text-[12px] leading-snug',
          aberto ? 'text-ink' : 'text-ink-2',
          puxando !== null ? 'cursor-ew-resize select-none' : '',
        ].join(' ')}
      >
        {grupos.map((grupo, g) => (
          <span key={g}>
            {/*
              A alca so aparece no trecho ABERTO. Nas quarenta e tres linhas de
              uma vez, uma alca por fronteira viraria uma parede de pontinhos.
            */}
            {g > 0 && aberto && podePuxar && (
              /*
                Area de pegar com 13px, e a barrinha visivel de 3px no meio --
                3px era o alvo inteiro, e errar por um pixel pegava a palavra.
              */
              <span
                role="separator"
                title={`Arraste para escolher em que palavra a cena ${grupo.slot + 1} comeca`}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setPuxando(grupo.slot - 1)
                }}
                onClick={(event) => event.stopPropagation()}
                className="group/alca inline-flex h-4 w-[13px] cursor-ew-resize items-center justify-center align-middle"
              >
                <span
                  className={[
                    'block w-[3px] rounded-full transition-all duration-100',
                    puxando === grupo.slot - 1
                      ? 'h-4 bg-accent shadow-[0_0_6px_rgba(255,62,128,0.8)]'
                      : 'h-3 bg-accent/60 group-hover/alca:h-4 group-hover/alca:bg-accent',
                  ].join(' ')}
                />
              </span>
            )}
            <span
              className={[
                'mr-1 box-decoration-clone rounded-[2px] px-1 py-[1px]',
                /*
                  Uma cor so, alternando a forca -- rosa e a unica cor da
                  interface por decisao dele. O que separa uma cena da outra e o
                  contraste entre cheia e apagada, que funciona em qualquer
                  numero de cenas sem inventar paleta nenhuma.
                */
                grupo.slot % 2 === 0 ? 'bg-accent-dim text-ink' : 'bg-elevated text-ink-2',
              ].join(' ')}
            >
              {grupo.palavras.map((palavra, i) => (
                <span
                  key={palavra.indice}
                  data-palavra={palavra.indice}
                  // A palavra onde a cena vai comecar, enquanto arrasta.
                  className={puxando !== null && alvo === palavra.indice ? 'rounded-[2px] outline outline-1 outline-accent' : undefined}
                >
                  {i > 0 ? ' ' : ''}
                  {palavra.texto}
                </span>
              ))}
            </span>
          </span>
        ))}
      </p>

      {aberto && podePuxar && spans.length > 1 && !puxada && puxando === null && (
        <p className="mt-1 text-[10px] text-ink-3">Arraste a barrinha rosa para escolher em que palavra cada cena comeca.</p>
      )}
      {aberto && puxada && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onSoltar()
          }}
          className="mt-1 text-[10px] text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline"
        >
          voltar a divisao automatica
        </button>
      )}
    </>
  )
}

/**
 * As cenas do trecho aberto, uma por LINHA, na ordem do video.
 *
 * Era uma fileira de miniaturas de 54x30 com quatro controles de 9 pixels
 * empilhados em cima: numero, peso, repetir e dividir -- e o "+" aparecia duas
 * vezes com duas funcoes. Palavras dele: "nao tenho como clicar pra remover um
 * bloco, os botoes de dividir tela nao sao muito visiveis, e o que significa
 * aquele 1x?". Nao tinha como saber.
 *
 * Agora cada cena e uma linha com espaco para dizer o que faz: os SEGUNDOS que
 * ela ganha (o peso virou menos e mais ao lado deles), repetir, remover. E a
 * tela dividida e uma acao ENTRE duas linhas, que e o que ela e -- uma relacao
 * entre duas cenas, e nao uma propriedade de uma.
 *
 * A borda acesa ainda marca a cena que nao cobre a fatia dela, agora com o
 * aviso escrito do lado.
 */
function Fita({
  caminhos,
  duracao,
  fatias,
  pesos,
  porCaminho,
  onOrdem,
  onPeso,
  onRepetir,
  onRemover,
  unidas,
  onDividir,
}: {
  caminhos: readonly string[]
  /** O tempo do trecho inteiro, repartido entre as cenas conforme o peso. */
  duracao: number
  /**
   * Os segundos de CADA cena como o video vai mostrar -- pelas palavras,
   * quando a barrinha cortou a frase. A fita dividia por peso enquanto o selo
   * "imagem parada" do trecho media pelas palavras: o aviso aparecia em cima e
   * nenhuma linha dizia qual cena era.
   */
  fatias?: readonly number[]
  /** Peso de cada cena, na ordem da fita. 1 = todas iguais. */
  pesos: readonly number[]
  porCaminho: Map<string, LibraryClip>
  onOrdem: (paths: string[]) => void
  onPeso: (posicao: number, peso: number) => void
  onRepetir: (posicao: number) => void
  onRemover: (posicao: number) => void
  /** Posicoes unidas com a seguinte, em tela dividida. */
  unidas: readonly number[]
  onDividir: (posicao: number) => void
}) {
  /*
   * O par unido ocupa UM slot, entao a soma dos pesos conta o par uma vez so --
   * a mesma conta do applyBlockClips. Se as duas discordassem, o tempo que ele
   * ve na fita nao seria o do video.
   */
  const uniao = new Set(unidas)
  const donos = caminhos.map((_, i) => (uniao.has(i - 1) ? i - 1 : i))
  const soma = caminhos.reduce((a, _, i) => (donos[i] === i ? a + (pesos[i] ?? 1) : a), 0)
  // Com um slot so, o peso nao muda nada -- o trecho inteiro e dele.
  const slots = donos.filter((d, i) => d === i).length

  /*
   * A chave de cada linha leva a POSICAO junto do caminho: a mesma cena pode
   * estar duas vezes na fita, e duas linhas com a mesma chave fazem o React
   * embaralhar uma com a outra ao arrastar.
   */
  const itens = caminhos.map((caminho, i) => `${i}|${caminho}`)

  return (
    <Reorder.Group
      axis="y"
      values={itens}
      onReorder={(novos) => onOrdem(novos.map((k) => k.slice(k.indexOf('|') + 1)))}
      as="ul"
      className="mt-2 flex flex-col"
      // Mexer na fita nao pode virar troca de trecho: o clique da linha do
      // trecho ja faz isso.
      onClick={(event) => event.stopPropagation()}
    >
      {caminhos.map((caminho, i) => {
        const dono = donos[i]!
        const peso = pesos[dono] ?? 1
        return (
          <LinhaDaFita
            key={itens[i]}
            chave={itens[i]!}
            posicao={i}
            total={caminhos.length}
            clip={porCaminho.get(caminho)}
            fatia={fatias?.[i] ?? (duracao * peso) / soma}
            peso={peso}
            podePesar={slots > 1 && dono === i}
            emCima={uniao.has(i)}
            embaixo={dono !== i}
            onPeso={(novo) => onPeso(i, novo)}
            onRepetir={() => onRepetir(i)}
            onRemover={() => onRemover(i)}
            onDividir={() => onDividir(i)}
          />
        )
      })}
    </Reorder.Group>
  )
}

function LinhaDaFita({
  chave,
  posicao,
  total,
  clip,
  fatia,
  peso,
  podePesar,
  emCima,
  embaixo,
  onPeso,
  onRepetir,
  onRemover,
  onDividir,
}: {
  chave: string
  posicao: number
  total: number
  clip: LibraryClip | undefined
  /** Os segundos que esta cena ganha no trecho. */
  fatia: number
  peso: number
  /** Menos e mais so aparecem onde mudam alguma coisa. */
  podePesar: boolean
  /** Divide a tela com a PROXIMA -- esta fica na metade de cima. */
  emCima: boolean
  /** Divide a tela com a ANTERIOR -- esta fica na metade de baixo. */
  embaixo: boolean
  onPeso: (peso: number) => void
  onRepetir: () => void
  onRemover: () => void
  onDividir: () => void
}) {
  /*
   * So a ALCA arrasta. Antes a linha inteira era alca, e cada botao dentro dela
   * precisava de um stopPropagation no pointerdown para nao virar arrasto --
   * um esquecido, e o botao reordenava a fita em vez de fazer o que dizia.
   */
  const controles = useDragControls()
  const congela = clip ? fatia - clip.duration : 0
  const unida = emCima || embaixo
  const mostrarNaBiblioteca = useProject((s) => s.mostrarNaBiblioteca)

  return (
    <Reorder.Item
      value={chave}
      as="li"
      dragListener={false}
      dragControls={controles}
      className="list-none"
    >
      <div
        className={[
          'flex items-center gap-2 py-1 pr-1',
          // A tela dividida se ve como UM bloco: as duas linhas com a mesma
          // borda, e a de cima colada na de baixo.
          unida ? 'border-l-2 border-accent bg-accent-dim/40 pl-1.5' : 'pl-0',
        ].join(' ')}
        title={
          clip
            ? `#${clip.shot} · o clipe tem ${clip.duration.toFixed(1)}s e ganha ${fatia.toFixed(1)}s aqui`
            : undefined
        }
      >
        <button
          type="button"
          onPointerDown={(event) => controles.start(event)}
          aria-label="Arrastar para mudar a ordem"
          title="Arrastar para mudar a ordem"
          className="shrink-0 cursor-grab touch-none text-ink-3 hover:text-ink-2 active:cursor-grabbing"
        >
          <GripVertical size={13} strokeWidth={1.5} />
        </button>

        <span className="relative shrink-0">
          {clip ? (
            <img
              src={clip.thumbUrl}
              alt=""
              draggable={false}
              className={[
                'h-[36px] w-[64px] rounded-[2px] border object-cover',
                congela > 0.05 ? 'border-accent' : 'border-line',
              ].join(' ')}
            />
          ) : (
            <span className="block h-[36px] w-[64px] rounded-[2px] border border-line bg-elevated" />
          )}
          <span className="tnum absolute left-0 top-0 rounded-br-[2px] bg-black/75 px-1 text-[10px] text-white">
            {posicao + 1}
          </span>
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          {/*
            OS SEGUNDOS, e nao o peso. "1x" nao dizia nada; "0,4s" diz quanto
            tempo esta cena fica na tela, que e a pergunta que ele faz.
          */}
          <span className="flex items-center gap-1">
            {podePesar && (
              <PassoDeTempo
                rotulo="Menos tempo para esta cena"
                desativado={peso <= 1}
                onClick={() => onPeso(peso - 1)}
              >
                <Minus size={10} strokeWidth={2} />
              </PassoDeTempo>
            )}
            <span className={['tnum text-[12px]', peso > 1 ? 'text-accent' : 'text-ink-2'].join(' ')}>
              {fatia.toFixed(1)}s
            </span>
            {podePesar && (
              <PassoDeTempo
                rotulo="Mais tempo para esta cena"
                desativado={peso >= 3}
                onClick={() => onPeso(peso + 1)}
              >
                <Plus size={10} strokeWidth={2} />
              </PassoDeTempo>
            )}
          </span>
          {unida && (
            <span className="truncate text-[10px] leading-tight text-accent">{emCima ? 'em cima' : 'embaixo'}</span>
          )}
          {/*
            IMAGEM PARADA, desenhada: a barra e o tempo que a cena ganha; a
            parte cheia e o clipe tocando, a riscada e o ultimo quadro parado
            esperando o trecho acabar. Era um "congela 0,3s" solto, que ele
            nunca entendeu.
          */}
          {clip && congela > 0.05 && (
            <span
              className="mt-0.5 flex items-center gap-1.5"
              title={`O clipe tem ${clip.duration.toFixed(1)}s, mas esta cena ganha ${fatia.toFixed(1)}s: nos ultimos ${congela.toFixed(1)}s a imagem fica PARADA no ultimo quadro. Para resolver: menos tempo para ela (-), um clipe mais longo, ou mais uma cena no trecho.`}
            >
              <span className="relative flex h-[5px] w-[54px] shrink-0 overflow-hidden rounded-full bg-elevated">
                <span className="h-full bg-ink-3/70" style={{ width: `${(clip.duration / fatia) * 100}%` }} />
                <span className="h-full flex-1 bg-[repeating-linear-gradient(135deg,rgba(255,62,128,0.9)_0_2px,transparent_2px_4px)]" />
              </span>
              <span className="tnum whitespace-nowrap text-[10px] text-accent">parada {congela.toFixed(1)}s</span>
            </span>
          )}
        </div>

        <span className="flex shrink-0 items-center gap-0.5">
          {/*
            Repetir e um icone de COPIA, e nao mais um "+". O "+" era tambem o
            de dividir a tela, e dois botoes com o mesmo desenho fazendo coisas
            diferentes e o tipo de coisa que so se descobre errando.
          */}
          {clip && (
            <AcaoDaLinha
              rotulo="Mostrar este clipe na biblioteca (episodio e posicao)"
              onClick={() => void mostrarNaBiblioteca(clip.path)}
            >
              <LocateFixed size={12} strokeWidth={1.5} />
            </AcaoDaLinha>
          )}
          <AcaoDaLinha rotulo="Usar esta cena mais uma vez, logo depois" onClick={onRepetir}>
            <Copy size={12} strokeWidth={1.5} />
          </AcaoDaLinha>
          <AcaoDaLinha rotulo="Tirar esta cena do trecho" onClick={onRemover} perigo>
            <X size={13} strokeWidth={1.75} />
          </AcaoDaLinha>
        </span>
      </div>

      {/*
        DIVIDIR A TELA mora ENTRE duas linhas, porque e isso que ela e: uma
        relacao entre esta cena e a proxima. Escrito por extenso, e nao um
        circulo de 14px pendurado na borda da miniatura.

        Nao aparece embaixo da metade de baixo: uniao encadeada nao existe --
        tres cenas nao cabem num quadro partido em dois.
      */}
      {posicao < total - 1 && !embaixo && (
        <button
          type="button"
          onClick={onDividir}
          title={
            emCima
              ? 'Voltar as duas para a tela inteira, uma depois da outra'
              : 'As duas tocam juntas: esta na metade de cima, a proxima na de baixo'
          }
          className={[
            'flex w-full items-center gap-1 py-0.5 text-[10px] transition-colors duration-150',
            emCima
              ? 'border-l-2 border-accent bg-accent-dim/40 pl-[27px] text-accent hover:text-ink'
              : 'pl-[21px] text-ink-3 hover:text-ink',
          ].join(' ')}
        >
          <Rows2 size={11} strokeWidth={1.5} />
          {emCima ? 'Tela dividida · separar' : 'Dividir tela com a proxima'}
        </button>
      )}
    </Reorder.Item>
  )
}

function PassoDeTempo({
  rotulo,
  desativado,
  onClick,
  children,
}: {
  rotulo: string
  desativado: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desativado}
      aria-label={rotulo}
      title={rotulo}
      className="grid size-[16px] place-items-center rounded-sm border border-line text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function AcaoDaLinha({
  rotulo,
  onClick,
  perigo = false,
  children,
}: {
  rotulo: string
  onClick: () => void
  perigo?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      className={[
        'grid size-[22px] place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:bg-elevated',
        perigo ? 'hover:text-danger' : 'hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Coluna({ children }: { children: React.ReactNode }) {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-line">{children}</aside>
  )
}

/**
 * Com decimo, sempre.
 *
 * Sem ele "E nao e teoria de fa." aparecia como 0:03 - 0:03, que se le como
 * duracao zero. A frase curta e justamente onde ele precisa ver o numero para
 * decidir se cabe uma cena ou nenhuma.
 */
function tempo(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}
