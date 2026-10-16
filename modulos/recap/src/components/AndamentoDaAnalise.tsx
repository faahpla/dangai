import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Check, Circle, Loader2 } from 'lucide-react'
import { ROTULO_DA_ETAPA, type EtapaDaAnalise } from '../../shared/episodio'
import { useGerar } from '../store/gerar'
import { Botao, formatarTempo, Secao } from './pecas'

/*
 * A ORDEM DAS ETAPAS na tela e a ordem em que o motor de fato anda: ele busca o
 * elenco ANTES de cortar (a identidade do anime decide a pasta), corta, volta
 * ao elenco para as fotos de referencia e so entao reconhece. Por isso o
 * "Elenco" pode acender duas vezes -- e o motor, nao a tela.
 */
const ORDEM: EtapaDaAnalise[] = ['preparando', 'elenco', 'detectando', 'cortando', 'personagens', 'organizando']
const SO_COM_PERSONAGENS: EtapaDaAnalise[] = ['elenco', 'personagens']

/**
 * Uma palavra por etapa: os seis chips cabem numa linha ate a 1024 px. O nome
 * por extenso (ROTULO_DA_ETAPA) fica no tooltip e na barra de status.
 */
const ROTULO_CURTO: Record<EtapaDaAnalise, string> = {
  preparando: 'Preparar',
  elenco: 'Elenco',
  detectando: 'Cortes',
  cortando: 'Cenas',
  personagens: 'Personagens',
  organizando: 'Finalizar',
}

/**
 * (d) O ANDAMENTO DA ANALISE: as etapas, a barra, a frase do motor, o tempo
 * decorrido e o Cancelar. Analise leva minutos; nenhum minuto pode passar sem
 * sinal visivel.
 *
 * Analise so de corte nao mostra as etapas de personagens: riscadas, elas so
 * ocupavam lugar e faziam o rotulo dos outros quebrar em duas linhas.
 */
export function AndamentoDaAnalise() {
  const fase = useGerar((s) => s.fase)
  const job = useGerar((s) => s.job)
  const progresso = useGerar((s) => s.progresso)
  const vistas = useGerar((s) => s.etapasVistas)
  const cancelar = useGerar((s) => s.cancelar)
  const agora = useRelogio(fase === 'analisando' && job !== null)

  if (fase !== 'analisando' || !job) return null

  const atual: EtapaDaAnalise = progresso?.etapa ?? 'preparando'
  const decorrido = Math.max(0, (agora - job.inicio) / 1000)
  const fracao = progresso?.fracao ?? null
  const etapas = job.reconhecer ? ORDEM : ORDEM.filter((e) => !SO_COM_PERSONAGENS.includes(e))
  // A frase do motor ja vem curta do main (frase-do-motor.ts); vazia, vale o nome da etapa.
  const frase =
    progresso?.mensagem ||
    (job.id === null ? 'Chamando o motor...' : `${ROTULO_DA_ETAPA[atual]}...`)

  return (
    <Secao
      titulo={job.motor === 'studio' ? 'Analisando no Studio' : 'Analisando com o AnCut'}
      acao={
        <div className="flex items-center gap-3">
          <span className="tnum text-[11px] text-ink-3" title="Tempo decorrido">
            {formatarTempo(decorrido)}
          </span>
          <Botao pequeno onClick={() => void cancelar()} disabled={job.cancelando}>
            {job.cancelando ? 'Cancelando...' : 'Cancelar'}
          </Botao>
        </div>
      }
    >
      <ol className={['grid gap-1.5', etapas.length === 6 ? 'grid-cols-6' : 'grid-cols-4'].join(' ')}>
        {etapas.map((etapa) => {
          const eAtual = etapa === atual
          const feita = !eAtual && vistas.includes(etapa)
          return (
            <li
              key={etapa}
              title={ROTULO_DA_ETAPA[etapa]}
              aria-current={eAtual ? 'step' : undefined}
              className={[
                'flex h-7 min-w-0 items-center gap-1.5 rounded-sm border px-2',
                eAtual ? 'border-accent bg-accent-dim' : 'border-line bg-elevated',
              ].join(' ')}
            >
              {eAtual ? (
                <Loader2 size={11} strokeWidth={1.75} className="shrink-0 animate-spin text-accent" />
              ) : feita ? (
                <Check size={11} strokeWidth={2} className="shrink-0 text-ink-2" />
              ) : (
                <Circle size={11} strokeWidth={1.5} className="shrink-0 text-ink-3" />
              )}
              <span
                className={[
                  'min-w-0 truncate text-[11px]',
                  eAtual ? 'text-ink' : feita ? 'text-ink-2' : 'text-ink-3',
                ].join(' ')}
              >
                {ROTULO_CURTO[etapa]}
              </span>
            </li>
          )
        })}
      </ol>

      <Barra fracao={fracao} />

      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 select-text truncate text-[11px] text-ink-2" title={frase}>
          {frase}
        </p>
        {fracao !== null && <span className="tnum shrink-0 text-[11px] text-ink-3">{Math.round(fracao * 100)}%</span>}
      </div>
    </Secao>
  )
}

/** A barra da etapa: cheia ate a fracao, ou um trecho correndo quando o motor nao sabe quanto falta. */
export function Barra({ fracao }: { fracao: number | null }) {
  return (
    <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-line-strong">
      {fracao === null ? (
        <motion.span
          className="absolute inset-y-0 w-1/3 rounded-full bg-accent"
          initial={{ left: '-33%' }}
          animate={{ left: '100%' }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : (
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-300 ease-dangai"
          style={{ width: `${Math.max(2, fracao * 100)}%` }}
        />
      )}
    </div>
  )
}

/** Um Date.now() que anda de segundo em segundo enquanto `ligado`. */
export function useRelogio(ligado: boolean): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (!ligado) return
    setAgora(Date.now())
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ligado])
  return agora
}

/**
 * Lendo a legenda e cruzando as falas com as cenas, e sugerindo OP/ED.
 * Segundos, nao minutos: uma linha e a barra bastam.
 */
export function Indexando() {
  const fase = useGerar((s) => s.fase)
  const mensagem = useGerar((s) => s.indexando)
  if (fase !== 'indexando') return null
  return (
    <Secao titulo="Lendo as falas">
      <p className="flex items-center gap-2 text-[12px] text-ink-2">
        <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
        <span className="min-w-0 truncate">{mensagem ?? 'Lendo a legenda...'}</span>
      </p>
      <Barra fracao={null} />
    </Secao>
  )
}
