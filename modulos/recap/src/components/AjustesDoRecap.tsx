import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { ConfigDoRecapNaTela } from '../../shared/config'
import { ponte } from '../ponte'
import { useGerar } from '../store/gerar'
import { Link, meioDoCaminho, nuvemDoCaminho } from './pecas'
import { TrazerDoStudio } from './TrazerDoStudio'

/**
 * [recap] A BIBLIOTECA DO RECAP nas Configuracoes (a secao do modulo, depois
 * da Biblioteca do Dangai): onde o recap grava os indices dos episodios e, na
 * parte 4, as cenas que corta. E o pedaco "Biblioteca do Studio" do
 * AjustesDoStudio; o do motor e a secao seguinte (SecaoDoMotor).
 *
 * O rotulo e a linha de cima sao do nucleo (SecoesDosModulos). Pasta do AnCut
 * ou do Corte Cenas e recusada no main, e a frase dele vira o aviso. Embaixo,
 * com dado do Studio neste PC, o "Trazer do AniRecap Studio" (parte 5).
 */
export function AjustesDoRecap() {
  const [config, setConfig] = useState<ConfigDoRecapNaTela | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let vivo = true
    // Veio do "Trocar pasta" do assistente: o nucleo ja rolou ate aqui.
    useGerar.getState().ajustesVistos()
    void ponte.lerConfig().then((r) => {
      if (!vivo) return
      if (r.ok) setConfig(r.value)
      else setAviso(r.error)
    })
    return () => {
      vivo = false
    }
  }, [])

  const gravar = async (pasta: string): Promise<void> => {
    setSalvando(true)
    const r = await ponte.salvarConfig({ biblioteca: pasta })
    setSalvando(false)
    if (r.ok) {
      setConfig(r.value)
      setAviso(null)
    } else {
      setAviso(r.error)
    }
  }

  const escolher = async (): Promise<void> => {
    const r = await ponte.escolherBiblioteca()
    if (!r.ok) {
      setAviso(r.error)
      return
    }
    if (r.value) await gravar(r.value)
  }

  const padrao = !config || config.biblioteca === ''
  const efetiva = config?.bibliotecaEfetiva ?? ''
  const nuvem = efetiva ? nuvemDoCaminho(efetiva) : null

  return (
    <div>
      <button
        type="button"
        onClick={() => void escolher()}
        disabled={salvando}
        title={efetiva || undefined}
        className="lift flex w-full items-center gap-2 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:text-ink disabled:opacity-40"
      >
        <FolderOpen size={13} strokeWidth={1.5} className="shrink-0" />
        {/* Cortado no meio: o fim do caminho e a pasta que importa. */}
        <span className="min-w-0 flex-1 truncate">{efetiva ? meioDoCaminho(efetiva) : 'Escolher a pasta...'}</span>
        {config && padrao && <span className="shrink-0 text-[11px] text-ink-3">(padrao)</span>}
      </button>
      {aviso && <p className="mt-2 select-text text-[11px] leading-relaxed text-danger">{aviso}</p>}
      <p className="mt-2 flex items-baseline gap-2 text-[11px] leading-relaxed text-ink-3">
        <span className="min-w-0 flex-1">
          Onde o recap grava.
          {nuvem && <span className="text-ink-2"> No {nuvem}: ~1 GB por episodio vai para a nuvem.</span>}
        </span>
        {!padrao && (
          <Link onClick={() => void gravar('')} disabled={salvando}>
            Usar o padrao
          </Link>
        )}
      </p>
      <TrazerDoStudio />
    </div>
  )
}
