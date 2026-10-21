import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Loader2, Music, Shuffle, X } from 'lucide-react'
import { MUSIC_GAIN_DB_MAX, MUSIC_GAIN_DB_MIN } from '@shared/contract'
import { papelDaTrilha } from '../../shared/projeto-do-recap'
import { nucleo } from '../nucleo'
import { trechosDaMusica, useEdicaoRapida } from '../store/edicao-rapida'
import { escolherArquivoDaMusica, rodarSoAMusica } from './EdicaoRapida'

/**
 * [recap] A MUSICA DE FUNDO na barra do editor (o ControleDaMusica do Studio),
 * sobre os trechos de papel 'musica' (`modulos.recap.papel`) das faixas de
 * audio. "Musica" poe uma da pasta sem repetir entre videos, com ducking pela
 * voz (o `ducking` do nucleo); o shuffle (ou o nome) troca pela proxima da
 * pasta; a pasta abre o dialogo; o deslizante e o volume NAS PAUSAS (sob a
 * voz ela desce mais o ducking); o X tira. Cada um e um passo de Ctrl+Z (o
 * deslizante grava ao soltar), e os trechos continuam na faixa para mexer a
 * mao.
 *
 * Sem o aperto da barra do Studio: a barra do Dangai ja some com o que nao
 * cabe; aqui o nome so encurta.
 */
export function ControleDaMusica() {
  const n = nucleo()
  const trilhas = n.usar((s) => s.trilhas)
  const busy = n.usar((s) => s.busy)
  const rodando = useEdicaoRapida((s) => s.rodando)
  const musica = useMemo(() => trechosDaMusica(trilhas), [trilhas])
  const primeira = musica[0]
  const ocupado = rodando !== null || busy !== null

  if (!primeira) {
    return (
      <button
        type="button"
        onClick={() => void rodarSoAMusica()}
        disabled={ocupado}
        aria-label="Musica"
        title="Uma musica da pasta por baixo da narracao, sem repetir entre videos"
        className="lift flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[11px] text-ink-3 hover:text-ink-2 disabled:opacity-40"
      >
        <span className="flex h-[1lh] items-center">
          {rodando === 'musica' ? <Loader2 size={12} strokeWidth={1.5} className="animate-spin" /> : <Music size={12} strokeWidth={1.5} />}
        </span>
        Musica
      </button>
    )
  }

  return (
    <div
      className={[
        'flex shrink-0 items-center gap-1.5 rounded-sm border border-accent bg-accent-dim px-2.5 py-1.5 text-[11px]',
        ocupado ? 'opacity-60' : '',
      ].join(' ')}
    >
      <span className="flex h-[1lh] items-center">
        {rodando === 'musica' ? (
          <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
        ) : (
          <Music size={12} strokeWidth={1.5} className="text-accent" />
        )}
      </span>
      <button
        type="button"
        onClick={() => void rodarSoAMusica()}
        disabled={ocupado}
        title={`${primeira.fileName} - clique para trocar pela proxima da pasta`}
        className="max-w-[110px] truncate text-ink group-data-[compacto]/barra:max-w-[44px]"
      >
        {primeira.fileName.replace(/\.[^.]+$/, '')}
      </button>
      <button
        type="button"
        onClick={() => void rodarSoAMusica()}
        disabled={ocupado}
        aria-label="Trocar a musica"
        title={`Trocar pela proxima da pasta (agora: ${primeira.fileName})`}
        className="grid size-4 shrink-0 place-items-center rounded-sm text-ink-2 hover:text-ink disabled:opacity-40"
      >
        <Shuffle size={11} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        onClick={() => void escolherArquivoDaMusica()}
        disabled={ocupado}
        aria-label="Escolher o arquivo da musica"
        title="Escolher o arquivo da musica"
        className="grid size-4 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink disabled:opacity-40"
      >
        <FolderOpen size={11} strokeWidth={1.5} />
      </button>
      <Volume gainDb={primeira.gainDb} abaixoDb={primeira.ducking?.abaixoDb ?? null} ocupado={ocupado} />
      <button
        type="button"
        onClick={() =>
          n.aplicarNoDocumento((d) => ({ trilhas: d.trilhas.filter((t) => papelDaTrilha(t) !== 'musica') }))
        }
        disabled={ocupado}
        aria-label="Tirar a musica"
        title="Tirar a musica"
        className="grid size-4 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink disabled:opacity-40"
      >
        <X size={11} strokeWidth={1.5} />
      </button>
    </div>
  )
}

/**
 * O volume nas pausas: anda na tela enquanto arrasta e grava ao soltar (um
 * passo de Ctrl+Z por gesto, e nao um por pixel).
 */
function Volume({ gainDb, abaixoDb, ocupado }: { gainDb: number; abaixoDb: number | null; ocupado: boolean }) {
  const [arrastando, setArrastando] = useState<number | null>(null)
  useEffect(() => setArrastando(null), [gainDb])
  const valor = arrastando ?? gainDb
  // A Edicao rapida nivela pelo LUFS do arquivo e pode passar dos limites da
  // cama antiga: o deslizante abre para caber o valor que esta la.
  const min = Math.min(MUSIC_GAIN_DB_MIN, Math.floor(gainDb))
  const max = Math.max(MUSIC_GAIN_DB_MAX, Math.ceil(gainDb))
  const sobVoz = abaixoDb !== null ? ` (sob a voz, ${valor - abaixoDb} dB)` : ''
  const gravar = (): void => {
    if (arrastando === null || arrastando === gainDb) return
    const db = arrastando
    nucleo().aplicarNoDocumento((d) => ({
      trilhas: d.trilhas.map((t) => (papelDaTrilha(t) === 'musica' ? { ...t, gainDb: db } : t)),
    }))
  }
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={0.5}
        value={valor}
        disabled={ocupado}
        onChange={(e) => setArrastando(Number(e.target.value))}
        onPointerUp={gravar}
        onKeyUp={gravar}
        onBlur={gravar}
        aria-label="Volume da musica"
        title={`Volume da musica nas pausas: ${valor} dB${sobVoz}`}
        className="dangai-range w-[56px] shrink-0 disabled:opacity-40"
      />
      <span className="tnum min-w-[46px] shrink-0 whitespace-nowrap text-right text-ink-3 group-data-[compacto]/barra:hidden" title={`Nas pausas${sobVoz}`}>
        {valor} dB
      </span>
    </>
  )
}
