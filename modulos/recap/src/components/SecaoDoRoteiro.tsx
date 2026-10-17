import { forwardRef, memo, useEffect, useRef, useState } from 'react'
import { Plus, Trash2, TriangleAlert, Type, WandSparkles, X } from 'lucide-react'
import type { Cue, EpisodeIndex } from '../../shared/episodio'
import {
  INSTRUCAO_MAX,
  ROTULO_DO_PAPEL,
  TEXTO_DE_TELA_MAX_PALAVRAS,
  cuesDoEvento,
  duracaoEstimada,
  falasDaFrase,
  formatarTempo as tempoDoEpisodio,
  palavrasDeTela,
  palavrasDoRoteiro,
  type Evento,
  type Frase,
  type MomentoDaFrase,
  type ProblemaDoRoteiro,
  type Secao,
} from '../../shared/roteiro'
import { useRoteiro, type GeracaoEmCurso } from '../store/gerar-roteiro'
import { useRitmoDaVoz } from '../store/ritmo'
import { Linha } from '@/modulos/kit'
import { AndamentoDoRoteiro } from './AndamentoDoRoteiro'
import { PerguntaDoReserva } from './PerguntaDoReserva'
import { Botao, CAMPO_PEQUENO, CLASSE_DO_CAMPO, COR_DE_AVISO, focarBotao, Link, Secao as Cartao } from './pecas'

/**
 * Poe o cursor numa frase depois que a tela redesenhar (frase nova, dividida,
 * juntada). Pelo atributo, e nao por ref: a frase pode ter acabado de nascer.
 */
export function focarFrase(fraseId: string, onde: 'inicio' | 'fim' | number): void {
  requestAnimationFrame(() => {
    const campo = document.querySelector<HTMLTextAreaElement>(`[data-frase="${fraseId}"] textarea`)
    if (!campo) return
    campo.focus()
    const pos = onde === 'inicio' ? 0 : onde === 'fim' ? campo.value.length : Math.min(onde, campo.value.length)
    campo.setSelectionRange(pos, pos)
    campo.scrollIntoView({ block: 'nearest' })
  })
}

/**
 * UMA PARTE DO ROTEIRO (gancho, contexto...): o cartao com o papel no titulo,
 * a duracao estimada, o "Refazer" e as frases editaveis. O mesmo cartao do
 * passo 1 (Secao), para o assistente continuar com a mesma cara.
 */
export function SecaoDoRoteiro({
  secao,
  eventos,
  indice,
  momentos,
  miniaturas,
  problemas,
  ordem,
  geracao,
}: {
  secao: Secao
  eventos: readonly Evento[]
  indice: EpisodeIndex | null
  momentos: ReadonlyMap<string, MomentoDaFrase | null>
  miniaturas: Readonly<Record<string, string | null>>
  /** Os problemas do roteiro (validarRoteiro) que falam desta parte. */
  problemas: readonly ProblemaDoRoteiro[]
  /** Todas as frases do roteiro em ordem, para as setas andarem entre as partes. */
  ordem: readonly string[]
  geracao: GeracaoEmCurso | null
}) {
  const gerar = useRoteiro((s) => s.gerar)
  const inserirFrase = useRoteiro((s) => s.inserirFrase)
  const removerSecao = useRoteiro((s) => s.removerSecao)
  const aprovando = useRoteiro((s) => s.aprovando)
  const cancelada = useRoteiro((s) => (s.geracaoCancelada?.secaoId === secao.id ? s.geracaoCancelada : null))
  // O "Refazer" desta parte parou antes do modelo reserva: a pergunta fica aqui, onde o olho esta.
  const reserva = useRoteiro((s) => (s.reserva?.secaoId === secao.id ? s.reserva : null))
  const [instrucao, setInstrucao] = useState<string | null>(null)
  // O ritmo da voz que vai narrar: o mesmo "~Xs" da contagem do roteiro.
  const ritmo = useRitmoDaVoz()

  const travado = geracao !== null
  const refazendo = geracao !== null && geracao.secaoId === secao.id
  const palavras = palavrasDoRoteiro({ secoes: [secao] })
  const segundos = Math.round(duracaoEstimada(palavras, ritmo))
  const daParte = problemas.filter((p) => !p.fraseId)
  const erroDaParte = daParte.find((p) => p.nivel === 'erro')
  const avisoDaParte = daParte.find((p) => p.nivel === 'aviso')
  const marca = erroDaParte ?? avisoDaParte

  // Comecou a refazer: o campo da instrucao ja cumpriu o papel.
  useEffect(() => {
    if (refazendo) setInstrucao(null)
  }, [refazendo])

  const refazer = (texto: string): void => {
    setInstrucao(null)
    void gerar({ secaoId: secao.id, instrucao: texto })
  }

  const fecharInstrucao = (): void => {
    setInstrucao(null)
    // O campo sumiu com o foco: volta para o "Refazer" desta parte.
    focarBotao(`refazer-${secao.id}`)
  }

  const novaFrase = (): void => {
    const id = inserirFrase(secao.id)
    if (id) focarFrase(id, 'inicio')
  }

  return (
    <div data-secao={secao.id} className="scroll-mt-4">
      <Cartao
        titulo={ROTULO_DO_PAPEL[secao.papel]}
        acao={
          <div className="flex items-center gap-3">
            {marca && (
              <span title={marca.mensagem} aria-label={marca.mensagem}>
                <TriangleAlert
                  size={12}
                  strokeWidth={1.5}
                  className={marca.nivel === 'erro' ? 'text-danger' : 'text-ink-3'}
                />
              </span>
            )}
            <span className="tnum text-[11px] text-ink-3" title={`${palavras} ${palavras === 1 ? 'palavra' : 'palavras'}`}>
              ~{segundos} s
            </span>
            {instrucao === null && !refazendo && (
              <Botao
                pequeno
                foco={`refazer-${secao.id}`}
                onClick={() => setInstrucao('')}
                disabled={travado || aprovando}
                title="A IA escreve so esta parte de novo. O resto fica igual."
              >
                <WandSparkles size={12} strokeWidth={1.5} />
                Refazer
              </Botao>
            )}
          </div>
        }
      >
        {instrucao !== null && !refazendo && (
          <RefazerParte
            valor={instrucao}
            onChange={setInstrucao}
            onEnviar={() => refazer(instrucao)}
            onFechar={fecharInstrucao}
            desligado={travado || aprovando}
          />
        )}
        {refazendo && geracao ? (
          <AndamentoDoRoteiro geracao={geracao} compacto />
        ) : cancelada ? (
          <AndamentoDoRoteiro geracao={cancelada} compacto cancelado />
        ) : (
          reserva && <PerguntaDoReserva pergunta={reserva} compacto />
        )}

        {secao.frases.length > 0 ? (
          <ol className={['flex flex-col gap-1.5', refazendo ? 'opacity-40' : ''].join(' ')}>
            {secao.frases.map((frase, i) => {
              const momento = momentos.get(frase.id) ?? null
              const lugar = ordem.indexOf(frase.id)
              const daFrase = problemas.filter((p) => p.fraseId === frase.id)
              const erro = daFrase.find((p) => p.nivel === 'erro')
              const avisos = daFrase.filter((p) => p.nivel === 'aviso').map((p) => p.mensagem)
              return (
                <FraseDoRoteiro
                  key={frase.id}
                  frase={frase}
                  secaoId={secao.id}
                  posicao={i}
                  momento={momento}
                  url={momento?.planoId ? (miniaturas[momento.planoId] ?? null) : null}
                  eventos={eventos}
                  indice={indice}
                  erro={erro?.mensagem ?? null}
                  avisos={avisos.length > 0 ? avisos.join('\n') : null}
                  travado={travado}
                  anterior={lugar > 0 ? (ordem[lugar - 1] ?? null) : null}
                  proxima={lugar >= 0 ? (ordem[lugar + 1] ?? null) : null}
                />
              )
            })}
          </ol>
        ) : (
          <div className="flex min-h-7 items-center gap-3">
            <p className="text-[12px] text-ink-2">Parte vazia.</p>
            <Link onClick={() => removerSecao(secao.id)} disabled={travado} title="Tira esta parte do roteiro (da para desfazer no rodape)">
              Remover parte
            </Link>
          </div>
        )}

        <button
          type="button"
          onClick={novaFrase}
          disabled={travado}
          title="Acrescenta uma frase no fim desta parte (Enter numa frase tambem cria a seguinte)"
          className="flex items-center gap-1 self-start text-[11px] text-ink-3 transition-colors duration-150 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-ink-3"
        >
          <Plus size={11} strokeWidth={1.75} />
          Frase
        </button>
      </Cartao>
    </div>
  )
}

/** O campo curto do "Refazer": Enter pede, Esc desiste. */
function RefazerParte({
  valor,
  onChange,
  onEnviar,
  onFechar,
  desligado,
}: {
  valor: string
  onChange: (texto: string) => void
  onEnviar: () => void
  onFechar: () => void
  desligado: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        type="text"
        autoFocus
        value={valor}
        maxLength={INSTRUCAO_MAX}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !desligado) onEnviar()
          if (e.key === 'Escape') {
            // So o campo fecha: o Esc nao sobe ate o do app (que fecharia o assistente).
            e.stopPropagation()
            onFechar()
          }
        }}
        aria-label="Como refazer"
        placeholder="Como? (opcional) Ex.: mais forte, mais curto"
        spellCheck={false}
        className={`${CLASSE_DO_CAMPO} ${CAMPO_PEQUENO} min-w-0 flex-1`}
      />
      <Botao pequeno onClick={onEnviar} disabled={desligado} title="Pedir a parte nova (Enter)">
        <WandSparkles size={12} strokeWidth={1.5} />
        Refazer
      </Botao>
      <button
        type="button"
        onClick={onFechar}
        aria-label="Fechar"
        title="Fechar (Esc)"
        className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
      >
        <X size={13} strokeWidth={1.5} />
      </button>
    </div>
  )
}

/**
 * O tamanho da miniatura: 96x54, e 112x63 em tela de 1600 px ou mais. Com
 * 64x36 o quadro nao dava para reconhecer a cena. RECUO_DO_TEXTO alinha o
 * detalhe com o texto da frase (px-2 + miniatura + gap-3).
 */
const MINIATURA = 'h-[54px] w-[96px] min-[1600px]:h-[63px] min-[1600px]:w-[112px]'
const RECUO_DO_TEXTO = 'pl-[116px] min-[1600px]:pl-[132px]'

/**
 * UMA FRASE: o momento do episodio (miniatura + tempo) e o texto, editavel ali
 * mesmo. O texto cresce com a frase; Enter cria a frase seguinte (ou divide no
 * cursor), Backspace no comeco junta com a anterior, as setas andam entre as
 * frases -- o jeito de um editor de texto, sem modo de edicao para abrir.
 *
 * Clicar no momento abre o detalhe: as falas originais (quem fala), os
 * eventos, o que deveria aparecer na tela e o texto de tela. Esc fecha so ele.
 *
 * Os avisos de fidelidade da frase (validarRoteiro: termo vetado, pronome
 * ambiguo, hipotese dita como fato...) ficam num triangulo ambar ao lado,
 * com a lista no tooltip: pouco texto na tela, e o olho acha a frase.
 */
const FraseDoRoteiro = memo(function FraseDoRoteiro({
  frase,
  secaoId,
  posicao,
  momento,
  url,
  eventos,
  indice,
  erro,
  avisos,
  travado,
  anterior,
  proxima,
}: {
  frase: Frase
  secaoId: string
  posicao: number
  momento: MomentoDaFrase | null
  url: string | null
  eventos: readonly Evento[]
  indice: EpisodeIndex | null
  /** A mensagem do primeiro erro desta frase (validarRoteiro), ou null. */
  erro: string | null
  /** Os avisos desta frase, um por linha (para o tooltip), ou null. */
  avisos: string | null
  travado: boolean
  anterior: string | null
  proxima: string | null
}) {
  const editarFrase = useRoteiro((s) => s.editarFrase)
  const marcarFoco = useRoteiro((s) => s.marcarFoco)
  const [detalhe, setDetalhe] = useState(false)
  const [focado, setFocado] = useState(false)
  const botaoDoMomento = useRef<HTMLButtonElement>(null)

  const falas = indice ? falasDaFrase(frase, eventos, indice) : []
  const evento = momento ? eventos.find((e) => e.id === momento.eventoId) : undefined
  const telaLonga = frase.textoDeTela !== null && palavrasDeTela(frase.textoDeTela) > TEXTO_DE_TELA_MAX_PALAVRAS
  // Frase vazia recem-criada, com o cursor nela, ainda nao e erro: e ele escrevendo.
  const mostrarErro = erro !== null && !focado
  const mostrarAvisos = avisos !== null && !mostrarErro && frase.texto.trim() !== ''

  const teclas = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing || travado) return
    const campo = e.currentTarget
    const inicio = campo.selectionStart
    const fim = campo.selectionEnd
    const semSelecao = inicio === fim
    const loja = useRoteiro.getState()

    if (e.key === 'Enter') {
      e.preventDefault()
      const texto = campo.value
      const antes = texto.slice(0, inicio).trimEnd()
      const depois = texto.slice(fim).trimStart()
      let nova: string | null
      if (!depois) nova = loja.inserirFrase(secaoId, posicao + 1)
      else if (!antes) nova = loja.inserirFrase(secaoId, posicao)
      else nova = loja.dividirFrase(frase.id, antes, depois)
      if (nova) focarFrase(nova, 'inicio')
      return
    }
    if (e.key === 'Backspace' && semSelecao && inicio === 0) {
      if (campo.value.trim() === '') {
        if (!anterior) return
        e.preventDefault()
        loja.removerFrase(frase.id)
        focarFrase(anterior, 'fim')
        return
      }
      const junta = loja.juntarComAnterior(frase.id)
      if (junta) {
        e.preventDefault()
        focarFrase(junta.fraseId, junta.cursor)
      }
      return
    }
    if (e.key === 'ArrowUp' && semSelecao && inicio === 0 && anterior) {
      e.preventDefault()
      focarFrase(anterior, 'fim')
      return
    }
    if (e.key === 'ArrowDown' && semSelecao && fim === campo.value.length && proxima) {
      e.preventDefault()
      focarFrase(proxima, 'inicio')
    }
  }

  const remover = (): void => {
    useRoteiro.getState().removerFrase(frase.id, true)
    // O botao some com a frase: o cursor vai para a vizinha (o "Desfazer" fica no rodape).
    const vizinha = anterior ?? proxima
    if (vizinha) focarFrase(vizinha, 'fim')
  }

  return (
    <li
      data-frase={frase.id}
      onKeyDown={(e) => {
        // Esc com o detalhe aberto fecha so o detalhe, nunca o assistente.
        if (e.key !== 'Escape' || !detalhe) return
        e.stopPropagation()
        setDetalhe(false)
        botaoDoMomento.current?.focus()
      }}
      className={[
        'enter group/frase flex min-w-0 flex-col rounded-sm border bg-elevated transition-colors',
        // Troca a borda em vez de somar (a ordem das classes no CSS decide, ver CampoDeTempo).
        // Com o foco, ink-3: com 16 frases seguidas, a borda de 6% para 10% nao se via.
        mostrarErro ? 'border-danger' : 'border-line focus-within:border-ink-3',
      ].join(' ')}
      title={mostrarErro ? (erro ?? undefined) : undefined}
    >
      <div className="flex min-w-0 items-center gap-3 px-2 py-2">
        <Momento
          ref={botaoDoMomento}
          momento={momento}
          url={url}
          aberto={detalhe}
          dica={dicaDoMomento(momento, evento, falas, frase.intencaoVisual)}
          onClick={() => setDetalhe((v) => !v)}
        />
        <textarea
          value={frase.texto}
          rows={1}
          readOnly={travado}
          onChange={(e) => editarFrase(frase.id, { texto: e.target.value.replace(/\s*\r?\n\s*/g, ' ') })}
          onKeyDown={teclas}
          onFocus={() => {
            setFocado(true)
            marcarFoco(frase.id)
          }}
          onBlur={(e) => {
            setFocado(false)
            if (useRoteiro.getState().fraseEmFoco === frase.id) marcarFoco(null)
            const limpo = e.currentTarget.value.replace(/\s+/g, ' ').trim()
            if (!travado && limpo !== frase.texto) editarFrase(frase.id, { texto: limpo })
          }}
          aria-label="Frase"
          placeholder="Escreva a frase"
          spellCheck={false}
          className={[
            'field-sizing-content min-h-[36px] min-w-0 flex-1 resize-none select-text bg-transparent py-[7px] text-[13px] leading-[22px] text-ink placeholder:text-ink-3 focus:outline-none',
            travado ? 'cursor-default' : '',
          ].join(' ')}
        />
        {frase.textoDeTela && (
          <span
            title={telaLonga ? `Texto de tela com mais de ${TEXTO_DE_TELA_MAX_PALAVRAS} palavras` : 'Texto de tela'}
            className={[
              'flex max-w-[160px] shrink-0 items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              telaLonga ? `border-[#f6a23c] ${COR_DE_AVISO}` : 'border-line text-ink-2',
            ].join(' ')}
          >
            <Type size={10} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">{frase.textoDeTela}</span>
          </span>
        )}
        {mostrarAvisos && (
          <span title={avisos ?? undefined} aria-label={avisos ?? undefined} className={`grid size-5 shrink-0 place-items-center ${COR_DE_AVISO}`}>
            <TriangleAlert size={12} strokeWidth={1.75} />
          </span>
        )}
        <button
          type="button"
          onClick={remover}
          disabled={travado}
          aria-label="Remover a frase"
          title="Remover a frase (da para desfazer no rodape)"
          className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover/frase:opacity-100 group-focus-within/frase:opacity-100 disabled:invisible"
        >
          <Trash2 size={13} strokeWidth={1.5} />
        </button>
      </div>

      {detalhe && (
        <DetalheDaFrase frase={frase} falas={falas} eventos={eventos} indice={indice} momento={momento} travado={travado} />
      )}
    </li>
  )
})

/** O tooltip do momento: quando, o que acontece e as primeiras falas. */
function dicaDoMomento(
  momento: MomentoDaFrase | null,
  evento: Evento | undefined,
  falas: readonly Cue[],
  intencao: string,
): string {
  if (!momento) return 'Sem momento do episodio. Clique para ligar a um evento.'
  const linhas = [`${tempoDoEpisodio(momento.t)}${evento ? ` · ${evento.resumo}` : ''}`]
  if (!momento.planoId) linhas.push('Sem cena do episodio neste instante.')
  const MAXIMO = 6
  for (const cue of falas.slice(0, MAXIMO)) linhas.push(`${cue.falante ? `${cue.falante}: ` : ''}${cue.texto}`)
  if (falas.length > MAXIMO) linhas.push(`e mais ${falas.length - MAXIMO}`)
  if (intencao.trim()) linhas.push(`Na tela: ${intencao.trim()}`)
  linhas.push('Clique para ver as falas.')
  return linhas.join('\n')
}

/**
 * A miniatura do keyframe da cena daquele momento, com o tempo do episodio no
 * canto, pequeno, como o selo da fita na Biblioteca. Sem cena ali, o quadro
 * fica vazio com o tempo; sem evento, tracejado.
 */
const Momento = memo(
  forwardRef<
    HTMLButtonElement,
    {
      momento: MomentoDaFrase | null
      url: string | null
      aberto: boolean
      dica: string
      onClick: () => void
    }
  >(function Momento({ momento, url, aberto, dica, onClick }, ref) {
    const [quebrou, setQuebrou] = useState(false)
    useEffect(() => setQuebrou(false), [url])
    const borda = aberto ? 'border-accent' : 'border-line'

    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        aria-expanded={aberto}
        aria-label="Momento do episodio"
        title={dica}
        className="relative shrink-0 self-start rounded-[2px] transition-opacity hover:opacity-90"
      >
        {!momento ? (
          <span
            className={[
              `grid ${MINIATURA} place-items-center rounded-[2px] border border-dashed text-[10px] text-ink-3`,
              aberto ? 'border-accent' : 'border-line-strong',
            ].join(' ')}
          >
            --
          </span>
        ) : url && !quebrou ? (
          <img
            src={url}
            alt=""
            draggable={false}
            onError={() => setQuebrou(true)}
            className={`${MINIATURA} rounded-[2px] border object-cover ${borda}`}
          />
        ) : (
          <span className={`block ${MINIATURA} rounded-[2px] border bg-surface ${borda}`} />
        )}
        {momento && (
          <span className="tnum pointer-events-none absolute bottom-[3px] right-[3px] rounded-[2px] bg-black/70 px-[3px] text-[9px] leading-[13px] text-white">
            {tempoDoEpisodio(momento.t)}
          </span>
        )}
      </button>
    )
  }),
)

/** Ate quantos caracteres o resumo de um evento entra na lista de escolher (o resto vai no tooltip). */
const RESUMO_NA_LISTA = 70

function cortar(texto: string, maximo: number): string {
  return texto.length > maximo ? `${texto.slice(0, maximo - 1).trimEnd()}…` : texto
}

/**
 * O detalhe da frase: de que eventos ela fala (todos, cada um com X; a lista
 * so acrescenta), as falas originais com quem fala, o que deveria aparecer na
 * tela e o texto de tela. Antes o "Evento" mostrava so o primeiro de dois, e
 * nao dava nem para ver nem para tirar o segundo.
 */
function DetalheDaFrase({
  frase,
  falas,
  eventos,
  indice,
  momento,
  travado,
}: {
  frase: Frase
  falas: readonly Cue[]
  eventos: readonly Evento[]
  indice: EpisodeIndex | null
  momento: MomentoDaFrase | null
  travado: boolean
}) {
  const editarFrase = useRoteiro((s) => s.editarFrase)
  const telaLonga = frase.textoDeTela !== null && palavrasDeTela(frase.textoDeTela) > TEXTO_DE_TELA_MAX_PALAVRAS
  const porId = new Map(eventos.map((e) => [e.id, e]))
  const ligados = frase.eventoIds.map((id) => porId.get(id)).filter((e): e is Evento => e !== undefined)
  const livres = eventos.filter((e) => !frase.eventoIds.includes(e.id))

  /** Troca os eventos; a citacao e o instante so ficam se ainda forem de um deles. */
  const trocarEventos = (eventoIds: string[]): void => {
    const cues = new Set(
      indice ? eventoIds.flatMap((id) => (porId.get(id) ? cuesDoEvento(porId.get(id)!, indice).map((c) => c.id) : [])) : [],
    )
    editarFrase(frase.id, {
      eventoIds,
      citacaoCueId: frase.citacaoCueId && cues.has(frase.citacaoCueId) ? frase.citacaoCueId : null,
      cueDoMomento: frase.cueDoMomento && cues.has(frase.cueDoMomento) ? frase.cueDoMomento : null,
    })
  }

  return (
    <div className={`flex min-w-0 flex-col gap-2 border-t border-line py-2 pr-2 ${RECUO_DO_TEXTO}`}>
      <Linha label="Eventos" title="De que acontecimentos do episodio esta frase fala. O primeiro e o que a tela mostra.">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {ligados.map((ev) => (
            <span
              key={ev.id}
              title={`${tempoDoEpisodio(ev.t0)} · ${ev.resumo}`}
              className="flex h-7 max-w-[260px] min-w-0 items-center gap-1 rounded-sm border border-line bg-surface pl-2 text-[11px] text-ink-2"
            >
              <span className="tnum shrink-0 text-ink-3">{tempoDoEpisodio(ev.t0)}</span>
              <span className="min-w-0 truncate">{ev.resumo}</span>
              <button
                type="button"
                onClick={() => trocarEventos(frase.eventoIds.filter((id) => id !== ev.id))}
                disabled={travado}
                aria-label="Tirar este evento"
                title="Tirar este evento da frase"
                className="grid size-6 shrink-0 place-items-center text-ink-3 hover:text-ink disabled:invisible"
              >
                <X size={11} strokeWidth={1.75} />
              </button>
            </span>
          ))}
          {livres.length > 0 && (
            <select
              value=""
              disabled={travado}
              onChange={(e) => e.target.value && trocarEventos([...frase.eventoIds, e.target.value])}
              aria-label="Acrescentar evento"
              title="Acrescentar um evento a frase"
              className={`${CLASSE_DO_CAMPO} ${CAMPO_PEQUENO} w-[180px] pr-7`}
            >
              <option value="">{ligados.length > 0 ? '+ Evento' : 'Escolher evento'}</option>
              {livres.map((ev) => (
                <option key={ev.id} value={ev.id} title={ev.resumo}>
                  {tempoDoEpisodio(ev.t0)} · {cortar(ev.resumo, RESUMO_NA_LISTA)}
                </option>
              ))}
            </select>
          )}
        </div>
      </Linha>

      {falas.length > 0 ? (
        <ListaDeFalas
          falas={falas}
          citada={frase.citacaoCueId}
          doMomento={momento?.cueId ?? null}
          travado={travado}
          onMomento={(id) => editarFrase(frase.id, { cueDoMomento: id })}
        />
      ) : (
        <p className="text-[11px] text-ink-3">Sem falas ligadas.</p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_240px] gap-x-4">
        <Linha label="Na tela" title="O que deveria aparecer na tela nesta frase. Guia a escolha da cena.">
          <input
            type="text"
            value={frase.intencaoVisual}
            readOnly={travado}
            onChange={(e) => editarFrase(frase.id, { intencaoVisual: e.target.value })}
            onBlur={(e) => {
              const limpo = e.currentTarget.value.trim()
              if (!travado && limpo !== frase.intencaoVisual) editarFrase(frase.id, { intencaoVisual: limpo })
            }}
            aria-label="Na tela"
            placeholder="Ex.: close no rosto"
            spellCheck={false}
            className={`${CLASSE_DO_CAMPO} ${CAMPO_PEQUENO} min-w-0 flex-1`}
          />
        </Linha>
        <Linha
          label="Texto"
          title={`Texto queimado na tela, ${TEXTO_DE_TELA_MAX_PALAVRAS} palavras no maximo (artigo e preposicao nao contam). Vazio = nada.`}
        >
          <input
            type="text"
            value={frase.textoDeTela ?? ''}
            readOnly={travado}
            onChange={(e) => editarFrase(frase.id, { textoDeTela: e.target.value === '' ? null : e.target.value })}
            onBlur={(e) => {
              const limpo = e.currentTarget.value.replace(/\s+/g, ' ').trim() || null
              if (!travado && limpo !== frase.textoDeTela) editarFrase(frase.id, { textoDeTela: limpo })
            }}
            aria-label="Texto de tela"
            aria-invalid={telaLonga}
            placeholder="1-2 palavras"
            spellCheck={false}
            // Com o foco a borda do campo clareia (focus:border-line-strong) e escondia o
            // aviso justo enquanto ele digita: longo, o ambar vale com foco tambem.
            className={[
              telaLonga
                ? CLASSE_DO_CAMPO.replace(' border-line ', ' border-[#f6a23c] ').replace(
                    ' focus:border-line-strong ',
                    ' focus:border-[#f6a23c] ',
                  )
                : CLASSE_DO_CAMPO,
              CAMPO_PEQUENO,
              'min-w-0 flex-1',
            ].join(' ')}
          />
        </Linha>
      </div>
    </div>
  )
}

/**
 * As falas originais da frase. Rolou e ha mais embaixo: a ultima linha some
 * num degrade, em vez de aparecer cortada no meio. O tempo de cada fala e um
 * botao: escolhe aquele instante para a miniatura (o momento da frase).
 */
function ListaDeFalas({
  falas,
  citada,
  doMomento,
  travado,
  onMomento,
}: {
  falas: readonly Cue[]
  citada: string | null
  doMomento: string | null
  travado: boolean
  onMomento: (cueId: string) => void
}) {
  const lista = useRef<HTMLUListElement>(null)
  const [maisEmbaixo, setMaisEmbaixo] = useState(false)
  const medir = (): void => {
    const el = lista.current
    if (el) setMaisEmbaixo(el.scrollHeight - el.scrollTop - el.clientHeight > 2)
  }
  useEffect(medir, [falas])

  return (
    <ul
      ref={lista}
      onScroll={medir}
      className="flex max-h-[168px] min-w-0 flex-col gap-1 overflow-y-auto"
      style={maisEmbaixo ? { maskImage: 'linear-gradient(to bottom, black calc(100% - 24px), transparent)' } : undefined}
    >
      {falas.map((cue) => {
        const eCitada = cue.id === citada
        const eDoMomento = cue.id === doMomento
        return (
          <li
            key={cue.id}
            title={eCitada ? 'A frase cita esta fala' : undefined}
            className={['flex min-w-0 gap-2 text-[12px] leading-snug', eCitada ? 'border-l-2 border-accent pl-1.5' : ''].join(' ')}
          >
            <button
              type="button"
              onClick={() => onMomento(cue.id)}
              disabled={travado}
              title={eDoMomento ? 'O instante da miniatura' : 'Usar este instante na miniatura'}
              className={[
                'tnum w-[38px] shrink-0 text-left disabled:cursor-default',
                eDoMomento ? 'text-ink underline decoration-accent underline-offset-2' : 'text-ink-3 hover:text-ink',
              ].join(' ')}
            >
              {tempoDoEpisodio(cue.start)}
            </button>
            <span className="min-w-0 select-text">
              {cue.falante && <span className="text-ink-2">{cue.falante}: </span>}
              <span className="text-ink">{cue.texto}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
