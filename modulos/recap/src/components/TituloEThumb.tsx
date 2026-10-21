import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { sugestoesDaVersao, type Roteiro } from '../../shared/roteiro'
import { useRoteiro } from '../store/gerar-roteiro'
import { Secao } from './pecas'

/**
 * [recap, A4] "TITULO E THUMB": os 3 titulos e os 3 textos de thumbnail que a
 * IA sugeriu junto com o roteiro (no mesmo pedido), nas regras do guia dele
 * ("Ele Despertou o Maior Poder da Historia", "ELE DESPERTOU"). Pequeno e
 * discreto, no fim do passo 2; cada um com o botao de copiar. A versao
 * editada ou refeita mostra os da versao de onde saiu.
 */
export function TituloEThumb({ tela }: { tela: Roteiro }) {
  const roteiros = useRoteiro((s) => s.rascunho?.roteiros)
  const sugestoes = useMemo(
    () => (roteiros ? sugestoesDaVersao({ roteiros }, tela.versao) : null) ?? tela.sugestoes ?? null,
    [roteiros, tela],
  )
  if (!sugestoes || (sugestoes.titulos.length === 0 && sugestoes.thumbs.length === 0)) return null
  return (
    <Secao titulo="Titulo e thumb">
      {sugestoes.titulos.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {sugestoes.titulos.map((t) => (
            <li key={t} className="group/sugestao flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 select-text truncate text-[12px] text-ink-2" title={t}>
                {t}
              </span>
              <Copiar texto={t} rotulo="Copiar o titulo" />
            </li>
          ))}
        </ul>
      )}
      {sugestoes.thumbs.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {sugestoes.thumbs.map((t) => (
            <li
              key={t}
              className="flex items-center gap-1 rounded-[3px] border border-line bg-elevated py-0.5 pl-2 pr-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-2"
            >
              <span className="select-text">{t}</span>
              <Copiar texto={t} rotulo="Copiar o texto da thumb" pequeno />
            </li>
          ))}
        </ul>
      )}
    </Secao>
  )
}

/** Copia para a area de transferencia (com o jeito antigo de reserva, se a API nao deixar). */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    const campo = document.createElement('textarea')
    campo.value = texto
    campo.style.position = 'fixed'
    campo.style.opacity = '0'
    document.body.appendChild(campo)
    campo.select()
    const ok = document.execCommand('copy')
    campo.remove()
    return ok
  }
}

/** O botao de copiar: vira um check por um instante. */
export function Copiar({ texto, rotulo, pequeno = false }: { texto: string; rotulo: string; pequeno?: boolean }) {
  const [copiado, setCopiado] = useState(false)
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (relogio.current) clearTimeout(relogio.current)
    },
    [],
  )
  return (
    <button
      type="button"
      onClick={() =>
        void copiarTexto(texto).then((ok) => {
          if (!ok) return
          setCopiado(true)
          if (relogio.current) clearTimeout(relogio.current)
          relogio.current = setTimeout(() => setCopiado(false), 1200)
        })
      }
      aria-label={rotulo}
      title={copiado ? 'Copiado' : rotulo}
      className={[
        'grid shrink-0 place-items-center rounded-sm transition-colors duration-150',
        pequeno ? 'size-5' : 'size-6',
        copiado ? 'text-accent' : 'text-ink-3 hover:text-ink',
      ].join(' ')}
    >
      {copiado ? <Check size={pequeno ? 10 : 12} strokeWidth={2} /> : <Copy size={pequeno ? 10 : 12} strokeWidth={1.5} />}
    </button>
  )
}
