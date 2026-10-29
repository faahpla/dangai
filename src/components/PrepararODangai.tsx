import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import type { ComponenteDoDangai } from '@shared/channels'

/**
 * PREPARAR O DANGAI, no canto da tela inicial: o que ele baixa na primeira vez
 * (Whisper, sincronizador de legendas, navegador do render -- ~1,2 GB), antes
 * do primeiro video e nao no meio dele. Quem ja tem tudo nunca ve isto. "Agora
 * nao" esconde ate a proxima abertura; o download em si e o de sempre de cada
 * servico (ver electron/services/preparar.ts).
 */
export function PrepararODangai() {
  const [faltam, setFaltam] = useState<ComponenteDoDangai[] | null>(null)
  const [andamento, setAndamento] = useState<string | null>(null)
  const [falhou, setFalhou] = useState(false)
  const [fechado, setFechado] = useState(false)

  useEffect(() => {
    void window.dangai.componentesDoDangai().then((r) => {
      if (r.ok) setFaltam(r.value.filter((c) => !c.pronto))
    })
  }, [])
  useEffect(() => window.dangai.onPrepararProgresso((p) => setAndamento(`${p.passo} de ${p.de} · ${p.mensagem}`)), [])

  if (fechado || !faltam || faltam.length === 0) return null

  const totalMb = faltam.reduce((t, c) => t + c.mb, 0)
  const tamanho = totalMb >= 1000 ? `${(totalMb / 1000).toFixed(1).replace('.', ',')} GB` : `${totalMb} MB`

  const baixar = async (): Promise<void> => {
    setFalhou(false)
    setAndamento('Começando...')
    const r = await window.dangai.prepararDangai()
    setAndamento(null)
    if (!r.ok) {
      setFalhou(true)
      return
    }
    const sobram = r.value.filter((c) => !c.pronto)
    setFaltam(sobram)
    setFalhou(sobram.length > 0)
  }

  return (
    <div
      role="region"
      aria-label="Preparar o Dangai"
      className="enter absolute bottom-6 left-6 z-10 flex w-[340px] flex-col gap-3 rounded-md border border-line bg-surface p-4"
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <Download size={14} strokeWidth={1.5} className="text-accent" />
        Preparar o Dangai
      </div>
      <p className="text-[12px] leading-relaxed text-ink-3">
        Falta baixar o que ele usa no primeiro vídeo ({tamanho}). Baixando agora, nada para no meio do trabalho.
        Só acontece uma vez.
      </p>
      <ul className="flex flex-col gap-1.5">
        {faltam.map((c) => (
          <li key={c.id} className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="min-w-0">
              <span className="text-ink-2">{c.nome}</span>
              <span className="block truncate text-[11px] text-ink-3">{c.para}</span>
            </span>
            <span className="tnum shrink-0 text-[11px] text-ink-3">{c.mb} MB</span>
          </li>
        ))}
      </ul>
      {falhou && !andamento && (
        <p className="text-[11px] text-danger">Não deu para baixar tudo agora. Confira a internet e tente de novo.</p>
      )}
      {andamento ? (
        <span className="flex items-center gap-2 text-[11px] text-ink-2">
          <Loader2 size={12} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
          <span className="truncate">{andamento}</span>
        </span>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void baixar()}
            className="lift rounded-sm border border-accent bg-accent-dim px-3 py-1.5 text-[12px] font-medium text-ink"
          >
            Baixar agora ({tamanho})
          </button>
          <button
            type="button"
            onClick={() => setFechado(true)}
            className="rounded-sm px-2 py-1.5 text-[12px] text-ink-3 hover:text-ink-2"
          >
            Agora não
          </button>
        </div>
      )}
    </div>
  )
}
