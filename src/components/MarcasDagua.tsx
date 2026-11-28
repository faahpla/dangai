import { useState } from 'react'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { MODOS_DA_MARCA, NOME_DO_MODO, novaMarca, nomeSugerido, type MarcaDagua } from '@shared/marca-dagua'
import { gravarMarcas, useMarcas } from '@/store/marca-dagua'

/**
 * OS CANAIS E AS MARCAS D'AGUA, nas Configuracoes (shared/marca-dagua.ts).
 * Cada canal: o nome, o PNG do tamanho do video (ja na posicao), o modo de
 * mistura (Overlay, o que ele pediu) e a forca. No editor, o botao "Marca"
 * escolhe qual vai em cada video.
 */
export function MarcasDagua() {
  const lista = useMarcas((s) => s.lista)
  const [recado, setRecado] = useState<string | null>(null)

  const mudar = (id: string, patch: Partial<MarcaDagua>): void =>
    void gravarMarcas(lista.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  const escolherPng = async (): Promise<string | null> => {
    const r = await window.dangai.pickFiles()
    if (!r.ok || r.value.length === 0) return null
    const png = r.value.find((c) => /\.(png|webp)$/i.test(c))
    if (!png) {
      setRecado('Escolha um PNG (com fundo transparente), do tamanho do vídeo.')
      return null
    }
    setRecado(null)
    return png
  }

  return (
    <div className="flex flex-col gap-2" data-marca="lista">
      {lista.length === 0 && (
        <p className="text-[12px] leading-relaxed text-ink-3">
          Nenhum canal ainda. Adicione o PNG da marca de cada canal — do tamanho do vídeo (1080×1920), com a marca já no
          lugar e o resto transparente.
        </p>
      )}
      {lista.map((m) => (
        <div key={m.id} className="flex gap-3 rounded-md border border-line bg-elevated p-2.5" data-marca={m.id}>
          {/* A marca sobre um xadrez, para ver o que e transparente. */}
          <div
            className="h-[96px] w-[54px] shrink-0 overflow-hidden rounded-sm border border-line"
            style={{ backgroundImage: 'repeating-conic-gradient(#2a2a2e 0% 25%, #1b1b1e 0% 50%)', backgroundSize: '10px 10px' }}
          >
            {m.url && <img src={m.url} alt="" className="size-full object-contain" />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <input
                defaultValue={m.nome}
                maxLength={40}
                aria-label="Nome do canal"
                onKeyDown={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const nome = e.target.value.trim()
                  if (nome && nome !== m.nome) mudar(m.id, { nome })
                }}
                className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1 text-[13px] text-ink focus:border-line-strong focus:outline-none"
              />
              <button
                type="button"
                onClick={async () => {
                  const png = await escolherPng()
                  if (png) mudar(m.id, { caminho: png })
                }}
                title={m.caminho}
                className="lift flex shrink-0 items-center gap-1 rounded-sm border border-line bg-surface px-2 py-1 text-[11px] text-ink-2 hover:text-ink"
              >
                <FolderOpen size={12} strokeWidth={1.5} /> Trocar PNG
              </button>
              <button
                type="button"
                onClick={() => void gravarMarcas(lista.filter((x) => x.id !== m.id))}
                title="Tirar este canal (o arquivo fica no disco)"
                aria-label="Tirar este canal"
                className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 hover:bg-surface hover:text-danger"
              >
                <Trash2 size={13} strokeWidth={1.6} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-[11px] text-ink-3">Modo</span>
              <select
                value={m.modo}
                onChange={(e) => mudar(m.id, { modo: e.target.value as MarcaDagua['modo'] })}
                className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1 text-[12px] text-ink"
              >
                {MODOS_DA_MARCA.map((modo) => (
                  <option key={modo} value={modo}>
                    {NOME_DO_MODO[modo]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-[11px] text-ink-3">Força</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                defaultValue={m.opacidade}
                aria-label="Força da marca"
                onPointerUp={(e) => mudar(m.id, { opacidade: Number((e.target as HTMLInputElement).value) })}
                onKeyUp={(e) => mudar(m.id, { opacidade: Number((e.target as HTMLInputElement).value) })}
                className="dangai-range min-w-0 flex-1"
              />
              <span className="tnum w-9 shrink-0 text-right text-[11px] text-ink-3">{Math.round(m.opacidade * 100)}%</span>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={async () => {
          const png = await escolherPng()
          if (png) await gravarMarcas([...lista, novaMarca(nomeSugerido(png), png)])
        }}
        className="lift flex items-center justify-center gap-1.5 rounded-sm border border-dashed border-line px-3 py-2 text-[12px] text-ink-2 hover:text-ink"
      >
        <Plus size={13} strokeWidth={1.6} /> Adicionar a marca de um canal (PNG)
      </button>
      {recado && <p className="text-[11px] text-danger">{recado}</p>}
    </div>
  )
}
