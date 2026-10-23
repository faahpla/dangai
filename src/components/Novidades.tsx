import { useEffect } from 'react'
import { create } from 'zustand'
import { NOVIDADES, novidadesParaMostrar, type Novidade } from '@shared/novidades'

/**
 * A JANELINHA "O QUE MUDOU", na primeira abertura depois de atualizar (ver
 * shared/novidades.ts). A ultima versao vista fica no localStorage desta
 * maquina, como o layout: sobrevive a atualizacao e nao viaja com projeto.
 */

const CHAVE = 'dangai.novidades.vista'

export const useNovidades = create<{ abertas: Novidade[] | null }>(() => ({ abertas: null }))

/** Na abertura do app: mostra o que mudou desde a ultima versao vista aqui. */
export async function verNovidadesAoAbrir(): Promise<void> {
  const versao = await window.dangai.appVersion()
  if (!versao.ok) return
  let vista: string | null = null
  try {
    vista = localStorage.getItem(CHAVE)
  } catch {
    return // sem armazenamento, a janelinha abriria a cada inicio
  }
  // Quem nunca viu a janelinha mas ja tem projetos recentes veio de uma versao de antes dela.
  const configuracoes = vista === null ? await window.dangai.getSettings() : null
  const jaUsava = configuracoes?.ok === true && configuracoes.value.recentes.length > 0
  const novas = novidadesParaMostrar(versao.value, vista, jaUsava)
  try {
    localStorage.setItem(CHAVE, versao.value)
  } catch {
    /* fica para a proxima */
  }
  if (novas.length > 0) useNovidades.setState({ abertas: novas })
}

/** "Novidades desta versao", pela paleta: as da versao mais recente da lista. */
export function abrirNovidades(): void {
  const ultima = NOVIDADES.find((n) => n.itens.length > 0)
  if (ultima) useNovidades.setState({ abertas: [ultima] })
}

export function Novidades() {
  const abertas = useNovidades((s) => s.abertas)
  const fechar = (): void => useNovidades.setState({ abertas: null })

  useEffect(() => {
    if (!abertas) return
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        fechar()
      }
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [abertas])

  if (!abertas) return null
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-6" onPointerDown={fechar}>
      <div
        role="dialog"
        aria-label="O que mudou"
        onPointerDown={(e) => e.stopPropagation()}
        className="glass enter flex max-h-[80vh] w-full max-w-[520px] flex-col gap-4 overflow-y-auto rounded-lg p-5"
      >
        <h2 className="text-[15px] font-semibold text-ink">
          {abertas.length === 1 ? `O que mudou na versão ${abertas[0]!.versao}` : 'O que mudou desde a última vez'}
        </h2>
        {abertas.map((n) => (
          <div key={n.versao} className="flex flex-col gap-2">
            {abertas.length > 1 && <span className="text-[11px] uppercase tracking-wide text-ink-3">Versão {n.versao}</span>}
            <ul className="flex flex-col gap-2">
              {n.itens.map((item) => (
                <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-ink-2">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={fechar}
            className="lift rounded-sm border border-accent bg-accent-dim px-3 py-1.5 text-[13px] font-medium text-ink"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  )
}
