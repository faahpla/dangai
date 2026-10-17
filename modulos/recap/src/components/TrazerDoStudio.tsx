import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import {
  nadaNovo,
  tamanhoCurto,
  textoDoResumo,
  type ProgressoDaMigracao,
  type ResumoDaMigracao,
  type StudioAchado,
} from '../../shared/migracao'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { Botao, Link } from './pecas'

/**
 * [recap] "TRAZER DO ANIRECAP STUDIO" (parte 5), embaixo da Biblioteca do
 * recap nas Configuracoes. So aparece com dado do Studio neste PC.
 *
 * Traz os rascunhos, a voz paga em cache, o ritmo, o historico de musicas, os
 * personagens do motor, os ajustes e as chaves -- SO lendo o Studio e sem
 * sobrescrever nada do Dangai. Rodar de novo nao duplica. A biblioteca do
 * Studio nao vem: o episodio e cortado de novo quando o rascunho abre.
 */
export function TrazerDoStudio() {
  const [achado, setAchado] = useState<StudioAchado | null>(null)
  const [progresso, setProgresso] = useState<ProgressoDaMigracao | null>(null)
  const [resumo, setResumo] = useState<ResumoDaMigracao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [trazendo, setTrazendo] = useState(false)
  const pedido = useRef<string | null>(null)

  useEffect(() => {
    let vivo = true
    void ponte.acharStudio().then((r) => {
      if (vivo && r.ok) setAchado(r.value)
    })
    const parar = ponte.onTrazerProgresso((p) => {
      if (p.pedidoId === pedido.current) setProgresso(p)
    })
    return () => {
      vivo = false
      parar()
    }
  }, [])

  if (!achado?.existe) return null

  const trazer = async (): Promise<void> => {
    const id = `m${Date.now().toString(36)}`
    pedido.current = id
    setTrazendo(true)
    setErro(null)
    setResumo(null)
    setProgresso(null)
    const r = await ponte.trazerDoStudio(id)
    pedido.current = null
    setTrazendo(false)
    setProgresso(null)
    if (!r.ok) {
      setErro(r.error)
      return
    }
    setResumo(r.value)
    // As dicas das chaves (tem/dica) e a config publica do modulo mudaram.
    void nucleo().reler()
  }

  const cancelar = (): void => {
    if (pedido.current) void ponte.cancelarTrazer(pedido.current)
  }

  const pct = progresso && progresso.total > 0 ? Math.round((progresso.feitos / progresso.total) * 100) : 0
  const colar = resumo?.chaves.filter((c) => c.estado === 'colar-de-novo').map((c) => c.nome) ?? []
  const mudouAjuste = !!resumo && (resumo.ajustes.length > 0 || resumo.chaves.some((c) => c.estado === 'trazida'))

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-[12px] text-ink-2">AniRecap Studio neste PC</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
        {achado.rascunhos} {achado.rascunhos === 1 ? 'rascunho' : 'rascunhos'}, {tamanhoCurto(achado.vozBytes)} de voz paga, personagens,
        ajustes e chaves. So le o Studio; o que ja esta no Dangai fica.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <Botao onClick={() => void trazer()} disabled={trazendo} foco="trazer-do-studio">
          <ArrowDownToLine size={13} strokeWidth={1.5} />
          {trazendo ? 'Trazendo...' : 'Trazer do AniRecap Studio'}
        </Botao>
        {trazendo && (
          <Link onClick={cancelar} title="Para entre um arquivo e outro. O que ja veio fica; trazer de novo continua.">
            Cancelar
          </Link>
        )}
      </div>
      {trazendo && progresso && (
        <div className="mt-2">
          <div className="h-1 w-full overflow-hidden rounded-full bg-elevated">
            <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${pct}%` }} />
          </div>
          <p className="tnum mt-1 text-[11px] text-ink-3">
            {progresso.texto} {progresso.feitos}/{progresso.total}
          </p>
        </div>
      )}
      {erro && <p className="mt-2 select-text text-[11px] leading-relaxed text-danger">{erro}</p>}
      {resumo && (
        <div className="mt-2 select-text text-[11px] leading-relaxed">
          <p className="text-ink-2">{nadaNovo(resumo) && !resumo.cancelado ? 'Nada novo: ja estava tudo aqui.' : textoDoResumo(resumo)}</p>
          {resumo.ajustes.length > 0 && <p className="text-ink-3">Ajustes: {resumo.ajustes.join(', ')}.</p>}
          {colar.length > 0 && <p className="text-danger">Cole as chaves de novo: {colar.join(', ')}.</p>}
          {resumo.avisos.map((a) => (
            <p key={a} className="text-ink-3">
              {a}
            </p>
          ))}
          {resumo.rascunhos.trazidos > 0 && (
            <p className="text-ink-3">Os episodios do Studio sao cortados de novo quando o rascunho abre.</p>
          )}
          {mudouAjuste && <p className="text-ink-3">Feche e abra as Configuracoes para ver as chaves e a voz.</p>}
        </div>
      )}
    </div>
  )
}
