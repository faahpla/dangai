import { useEffect, useRef } from 'react'
import { Reorder } from 'motion/react'
import { AlertTriangle, Check, GripVertical, Loader2 } from 'lucide-react'
import { useProject } from '@/store/project'
import type { LibraryClip } from '@shared/channels'
import type { Word } from '@shared/contract'

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
  const cycleBlockWeight = useProject((s) => s.cycleBlockWeight)
  const setAtivo = useProject((s) => s.setActiveBlock)
  const carregar = useProject((s) => s.loadScriptBlocks)
  const transcript = useProject((s) => s.transcript)
  const library = useProject((s) => s.library)
  const reordenar = useProject((s) => s.reorderBlockClips)

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
          const somaPesos = pesosDoBloco.reduce((a, b) => a + b, 0)
          const fatias = pesosDoBloco.map((peso) => (dura * peso) / somaPesos)
          const cada = cenas.length > 0 ? dura / cenas.length : dura
          const aberto = ativo === i

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
                    {congelamentos.length > 0 && (
                      <span
                        className="flex items-center gap-1 text-[10px] text-accent"
                        title={
                          congelamentos.length === 1
                            ? `Uma cena e curta demais: vai congelar ${congelamentos[0]!.toFixed(1)}s no fim`
                            : `${congelamentos.length} cenas sao curtas demais; a pior congela ${Math.max(...congelamentos).toFixed(1)}s`
                        }
                      >
                        <AlertTriangle size={10} strokeWidth={2} />
                        congela
                      </span>
                    )}
                    <span
                      className="tnum flex items-center gap-1 text-[10px] text-accent"
                      /* O numero que ensina o ritmo: 4,2s numa cena so grita que
                         falta cena, sem eu ter que proibir nada. */
                      title={`${cenas.length} cenas dividindo ${dura.toFixed(1)}s`}
                    >
                      <Check size={10} strokeWidth={2} />
                      {cenas.length}× {cada.toFixed(1)}s
                    </span>
                  </span>
                )}
              </div>
              <Frase
                texto={bloco.text}
                palavras={transcript?.words ?? []}
                start={bloco.start}
                end={bloco.end}
                cenas={cenas.length}
                aberto={aberto}
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
                  pesos={pesosDoBloco}
                  porCaminho={porCaminho}
                  onOrdem={(paths) => reordenar(i, paths)}
                  onPeso={(posicao) => cycleBlockWeight(i, posicao)}
                />
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
  start,
  end,
  cenas,
  aberto,
}: {
  texto: string
  palavras: readonly Word[]
  start: number
  end: number
  cenas: number
  aberto: boolean
}) {
  const cor = aberto ? 'text-ink' : 'text-ink-2'

  // Sem cena marcada nao ha o que repartir; sem palavra medida tambem nao.
  const daFrase = cenas > 0 ? palavras.filter((w) => w.start >= start && w.start < end) : []
  if (cenas === 0 || daFrase.length === 0) {
    return (
      <p className={['mt-1 text-[12px] leading-snug', aberto ? 'text-ink' : 'text-ink-3'].join(' ')}>
        {texto}
      </p>
    )
  }

  /*
   * Uma palavra pertence a cena que cobre o INSTANTE EM QUE ELA COMECA.
   *
   * Pelo comeco e nao pelo meio: e o comeco que o espectador ouve junto com o
   * corte, e uma palavra que atravessa a fronteira aparece pintada na cena em
   * que ela entrou -- que e onde ela vai ser vista.
   */
  const passo = (end - start) / cenas
  const trechos: Word[][] = Array.from({ length: cenas }, () => [])
  for (const palavra of daFrase) {
    const i = Math.min(cenas - 1, Math.max(0, Math.floor((palavra.start - start) / passo)))
    trechos[i]!.push(palavra)
  }

  return (
    <p className={['mt-1 text-[12px] leading-snug', cor].join(' ')}>
      {trechos.map((trecho, i) =>
        trecho.length === 0 ? null : (
          <span
            key={i}
            title={`Cena ${i + 1} · ${passo.toFixed(1)}s`}
            className={[
              'mr-1 box-decoration-clone rounded-[2px] px-1 py-[1px]',
              /*
                Uma cor so, alternando a forca -- rosa e a unica cor da interface
                por decisao dele. O que separa uma cena da outra e o contraste
                entre cheia e apagada, que funciona em qualquer numero de cenas
                sem inventar paleta nenhuma.
              */
              i % 2 === 0 ? 'bg-accent-dim text-ink' : 'bg-elevated text-ink-2',
            ].join(' ')}
          >
            {trecho.map((w) => w.text.trim()).join(' ')}
          </span>
        ),
      )}
    </p>
  )
}

/**
 * As cenas de uma frase, na ordem do video, arrastaveis.
 *
 * A ordem dentro da frase e a do ARGUMENTO dele -- nenhuma ordenacao automatica
 * sabe qual imagem vem primeiro em "comprime uma nuvem carregada bem menor". Ate
 * agora ela era a ordem em que ele calhou de clicar, e errar custava desmarcar e
 * remarcar tudo.
 *
 * A borda acesa marca a cena que nao cobre a fatia dela, que e a mesma
 * informacao do aviso la em cima -- mas aqui apontando QUAL delas.
 */
function Fita({
  caminhos,
  duracao,
  pesos,
  porCaminho,
  onOrdem,
  onPeso,
}: {
  caminhos: readonly string[]
  /** O tempo do trecho inteiro, repartido entre as cenas conforme o peso. */
  duracao: number
  /** Peso de cada cena, na ordem da fita. 1 = todas iguais. */
  pesos: readonly number[]
  porCaminho: Map<string, LibraryClip>
  onOrdem: (paths: string[]) => void
  onPeso: (posicao: number) => void
}) {
  const soma = caminhos.reduce((a, _, i) => a + (pesos[i] ?? 1), 0)
  return (
    <Reorder.Group
      axis="x"
      values={[...caminhos]}
      onReorder={onOrdem}
      as="ul"
      className="mt-2 flex gap-1"
      // Arrastar nao pode virar troca de frase: o clique da linha ja faz isso.
      onClick={(event) => event.stopPropagation()}
    >
      {caminhos.map((caminho, i) => {
        const clip = porCaminho.get(caminho)
        const peso = pesos[i] ?? 1
        const fatia = (duracao * peso) / soma
        const congela = clip ? fatia - clip.duration : 0
        return (
          <Reorder.Item
            key={caminho}
            value={caminho}
            as="li"
            className="relative cursor-grab active:cursor-grabbing"
            title={
              clip
                ? `Cena ${i + 1} · #${clip.shot} · ${clip.duration.toFixed(1)}s numa fatia de ${fatia.toFixed(1)}s` +
                  (congela > 0.05 ? ` · congela ${congela.toFixed(1)}s no fim` : '')
                : `Cena ${i + 1}`
            }
          >
            {clip && (
              <img
                src={clip.thumbUrl}
                alt=""
                draggable={false}
                className={[
                  'h-[30px] w-[54px] rounded-[2px] border object-cover',
                  congela > 0.05 ? 'border-accent' : 'border-line',
                ].join(' ')}
              />
            )}
            <span className="tnum absolute left-0 top-0 rounded-br-[2px] bg-black/70 px-1 text-[9px] text-white">
              {i + 1}
            </span>
            {/*
              O peso da cena, num alvo proprio.
              Nao no thumbnail inteiro: ele ja e alca de arrastar, e um clique
              que as vezes reordena e as vezes muda o ritmo seria pior que nao
              ter o controle. Ciclo curto -- 1x, 2x, 3x -- porque a decisao e
              "qual dessas importa", nao um numero exato.
            */}
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onPeso(i)
              }}
              title={`Esta cena pesa ${peso}x — ${fatia.toFixed(1)}s. Clique para mudar.`}
              className={[
                'tnum absolute right-0 top-0 rounded-bl-[2px] px-1 text-[9px]',
                peso > 1 ? 'bg-accent text-white' : 'bg-black/70 text-white/60',
              ].join(' ')}
            >
              {peso}×
            </button>
            <GripVertical
              size={10}
              strokeWidth={1.5}
              className="absolute bottom-0 right-0 text-white/50"
            />
          </Reorder.Item>
        )
      })}
    </Reorder.Group>
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
