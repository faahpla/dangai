import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Pause, Play } from 'lucide-react'
import type { TakeDaVoz, TrechoDeErro } from '../../shared/voz'
import { audioDoTake, tocador, useVoz } from '../store/gerar-voz'
import { COR_DE_AVISO } from './pecas'

/**
 * CORTAR ERROS (V1), na tela: o resumo ("3 trechos cortados") e a lista para
 * OUVIR cada trecho que saiu, tocado do bruto (na narracao ele ja nao esta).
 * So no audio importado. O que ficou (Whisper incerto, sobra longa, fala
 * emendada) aparece na lista com o motivo, apagado.
 */

/** Um <audio> so para os trechos, fora do React (como o tocador do passo). */
let ouvinte: HTMLAudioElement | null = null
let fimDoTrecho = 0
let ouvindoAgora: string | null = null
const assinantes = new Set<(chave: string | null) => void>()

function avisar(chave: string | null): void {
  ouvindoAgora = chave
  for (const a of assinantes) a(chave)
}

function elemento(): HTMLAudioElement {
  if (ouvinte) return ouvinte
  const el = new Audio()
  el.preload = 'auto'
  const vigiar = (): void => {
    if (!el.paused && el.currentTime >= fimDoTrecho) el.pause()
    if (!el.paused) requestAnimationFrame(vigiar)
  }
  el.addEventListener('play', () => requestAnimationFrame(vigiar))
  el.addEventListener('pause', () => avisar(null))
  el.addEventListener('ended', () => avisar(null))
  ouvinte = el
  return el
}

function ouvir(chave: string, url: string, de: number, ate: number): void {
  const el = elemento()
  if (ouvindoAgora === chave && !el.paused) {
    el.pause()
    return
  }
  tocador.pausar()
  if (el.src !== url) el.src = url
  fimDoTrecho = ate
  el.currentTime = de
  avisar(chave)
  void el.play().catch(() => avisar(null))
}

function useOuvindo(): string | null {
  const [chave, setChave] = useState<string | null>(ouvindoAgora)
  useEffect(() => {
    assinantes.add(setChave)
    return () => {
      assinantes.delete(setChave)
      // Saiu da tela: para o trecho.
      if (assinantes.size === 0) ouvinte?.pause()
    }
  }, [])
  return chave
}

const NOME_DO_TIPO: Record<TrechoDeErro['tipo'], string> = {
  repeticao: 'Repeticao',
  hesitacao: 'Hesitacao',
  sobra: 'Sobra',
}
const NOME_DO_MOTIVO: Record<NonNullable<TrechoDeErro['motivo']>, string> = {
  incerto: 'ficou: incerto',
  longo: 'ficou: longo',
  'sem-silencio': 'ficou: emendado',
}

function segundos(s: number): string {
  return `${s.toFixed(1).replace('.', ',')} s`
}

export function ErrosDoAudio({ rascunhoId, take }: { rascunhoId: string; take: TakeDaVoz }) {
  const audio = useVoz((s) => audioDoTake(s, rascunhoId, take.id))
  const ouvindo = useOuvindo()
  const erros = take.bruto.erros
  const [aberta, setAberta] = useState(erros.length <= 4)
  if (take.config.fonte !== 'importado') return null
  const ligado = take.config.cortarErros
  const cortados = erros.filter((e) => e.corte).length
  const ficaram = erros.length - cortados
  if (erros.length === 0) {
    return ligado ? <p className="text-[11px] text-ink-3">Nenhum erro no audio</p> : null
  }
  const resumo = ligado
    ? `${cortados} ${cortados === 1 ? 'trecho cortado' : 'trechos cortados'}${ficaram > 0 ? ` · ${ficaram} ${ficaram === 1 ? 'ficou' : 'ficaram'}` : ''}`
    : `${erros.length} ${erros.length === 1 ? 'erro' : 'erros'} no audio, sem corte`
  const url = audio?.urlDoBruto ?? null
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-erros-do-audio>
      <button
        type="button"
        onClick={() => setAberta((a) => !a)}
        aria-expanded={aberta}
        className="flex w-fit items-center gap-1 text-[12px] text-ink-2 hover:text-ink"
      >
        {aberta ? <ChevronDown size={12} strokeWidth={1.5} /> : <ChevronRight size={12} strokeWidth={1.5} />}
        {resumo}
      </button>
      {aberta && (
        <ul className="flex min-w-0 flex-col gap-1">
          {erros.map((e, i) => {
            const chave = `${take.id}:${i}`
            const tocando = ouvindo === chave
            // Ouve o que SAI (o corte); o que ficou, a fala dele.
            const de = e.corte?.de ?? e.de
            const ate = e.corte?.ate ?? e.ate
            const sai = ligado && e.corte !== null
            return (
              <li
                key={chave}
                className={[
                  'flex min-w-0 items-center gap-2 rounded-sm border border-line bg-elevated px-2 py-0.5',
                  sai ? '' : 'opacity-60',
                ].join(' ')}
              >
                <button
                  type="button"
                  onClick={() => url && ouvir(chave, url, de, ate)}
                  disabled={!url}
                  aria-label={tocando ? 'Pausar o trecho' : 'Ouvir o trecho'}
                  title={!url ? 'Carregando o audio...' : tocando ? 'Pausar' : sai ? 'Ouvir o que saiu' : 'Ouvir o trecho'}
                  className={[
                    'grid size-6 shrink-0 place-items-center rounded-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
                    tocando ? 'text-accent' : 'text-ink-2 hover:text-ink',
                  ].join(' ')}
                >
                  {tocando ? <Pause size={12} strokeWidth={1.5} /> : <Play size={12} strokeWidth={1.5} />}
                </button>
                <span className="w-[70px] shrink-0 text-[11px] text-ink-3">{NOME_DO_TIPO[e.tipo]}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink" title={e.falado}>
                  {e.falado}
                </span>
                {e.motivo && <span className={`shrink-0 text-[11px] ${e.motivo === 'incerto' ? 'text-ink-3' : COR_DE_AVISO}`}>{NOME_DO_MOTIVO[e.motivo]}</span>}
                <span className="shrink-0 text-[11px] tabular-nums text-ink-3">{segundos(ate - de)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
