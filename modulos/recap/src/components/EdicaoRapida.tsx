import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Loader2, WandSparkles, X } from 'lucide-react'
import { nadaLigado, partesLigadas } from '../../shared/edicao-rapida'
import { nucleo } from '../nucleo'
import {
  configDoPadrao,
  edicaoRapidaNoProjeto,
  linhasDoResumo,
  SO_A_MUSICA,
  temEdicaoRapida,
  useEdicaoRapida,
  type OpcoesDaEdicaoRapida,
} from '../store/edicao-rapida'

/**
 * [recap] O BOTAO "EDICAO RAPIDA" da barra do editor (o encaixe
 * BotoesDaBarraDeRender do nucleo), portado do Studio: um clique faz o que e
 * manual -- whoosh nas viradas de parte, impacto no gancho e no climax,
 * musica baixa com ducking, cada bloco no rosto, a legenda no estilo salvo e
 * a cor (camada de ajuste no video inteiro). O que ela faz vem das
 * Configuracoes (Edicao rapida). Tudo continua editavel e Ctrl+Z desfaz a
 * Edicao rapida inteira (um passo so, pelo nucleo.aplicarNoDocumento).
 *
 * O "Desfazer" do resumo do Studio nao veio: a fachada do nucleo nao tem o
 * desfazer. O resumo diz "Ctrl+Z desfaz tudo".
 */

/** Roda a Edicao rapida com o que as Configuracoes dizem, e abre o resumo. */
export async function rodarEdicaoRapida(): Promise<void> {
  const ui = useEdicaoRapida.getState()
  if (ui.rodando) return
  const config = await configDoPadrao()
  // Tudo desligado: nao ha o que fazer (o botao e o Ctrl+K ja ficam apagados).
  if (nadaLigado(config)) {
    nucleo().mostrarErro('Nada ligado na Edicao rapida (Configuracoes).')
    return
  }
  ui.marcarRodando('tudo')
  try {
    const resumo = await edicaoRapidaNoProjeto(config)
    if (resumo) useEdicaoRapida.getState().mostrarResumo(resumo, 'editor')
  } catch (err) {
    nucleo().mostrarErro(`Edicao rapida: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    useEdicaoRapida.getState().marcarRodando(null)
  }
}

/**
 * So a MUSICA (o controle de musica da barra): por uma da pasta sem repetir,
 * trocar pela proxima, ou a escolhida no dialogo (`musicaForcada`). Tambem e um
 * passo de Ctrl+Z. Sem musica nenhuma, o recado vai para o erro do editor.
 */
export async function rodarSoAMusica(opcoes: OpcoesDaEdicaoRapida = {}): Promise<void> {
  const ui = useEdicaoRapida.getState()
  if (ui.rodando) return
  ui.marcarRodando('musica')
  try {
    const resumo = await edicaoRapidaNoProjeto(SO_A_MUSICA, opcoes)
    if (resumo && !resumo.musica) {
      nucleo().mostrarErro(resumo.avisos[0] ?? 'Sem musica na pasta de musicas (Configuracoes).')
    }
  } finally {
    useEdicaoRapida.getState().marcarRodando(null)
  }
}

/** O dialogo do sistema (o do nucleo) para escolher o arquivo da musica. */
export async function escolherArquivoDaMusica(): Promise<void> {
  const r = await window.dangai.pickMusic()
  if (!r.ok) {
    nucleo().mostrarErro(r.error)
    return
  }
  // null = fechou o dialogo sem escolher: nada muda.
  if (r.value) await rodarSoAMusica({ musicaForcada: r.value.path })
}

/** A dica das partes ligadas ("sons, musica, rosto e legenda"); vazia = nada ligado. */
export function useDicaDaEdicaoRapida(): { ligadas: string; nada: boolean } {
  const padrao = useEdicaoRapida((s) => s.padrao)
  const carregarPadrao = useEdicaoRapida((s) => s.carregarPadrao)
  useEffect(() => {
    if (!useEdicaoRapida.getState().padrao) void carregarPadrao()
  }, [carregarPadrao])
  if (!padrao) return { ligadas: 'sons, musica, rosto, legenda, cor e textos', nada: false }
  return { ligadas: partesLigadas(padrao.config), nada: nadaLigado(padrao.config) }
}

/** O popover abre para baixo quando nao cabe acima (o aperto-da-barra do Studio). */
export function useAbreParaBaixo(ref: RefObject<HTMLElement | null>, aberto: boolean, altura: number): boolean {
  const [paraBaixo, setParaBaixo] = useState(false)
  useLayoutEffect(() => {
    if (!aberto || !ref.current) return
    setParaBaixo(ref.current.getBoundingClientRect().top < altura + 12)
  }, [aberto, ref, altura])
  return paraBaixo
}

/** Fecha um popover ao apertar fora dele ou no Esc. */
export function useFecharFora(ref: RefObject<HTMLElement | null>, aberto: boolean, fechar: () => void): void {
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      fechar()
    }
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') fechar()
    }
    document.addEventListener('pointerdown', fora, true)
    window.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('pointerdown', fora, true)
      window.removeEventListener('keydown', tecla)
    }
  }, [aberto, ref, fechar])
}

export function BotaoDaEdicaoRapida() {
  const n = nucleo()
  const pronto = n.usar((s) => s.audio !== null && s.plan !== null && s.images.length > 0)
  const busy = n.usar((s) => s.busy)
  // Projeto com algo posto pela Edicao rapida: o botao fica "ligado".
  const aplicada = n.usar((s) => temEdicaoRapida(s))
  const rodando = useEdicaoRapida((s) => s.rodando)
  const resumo = useEdicaoRapida((s) => s.resumo)
  const aberto = useEdicaoRapida((s) => s.resumoAberto)
  const origem = useEdicaoRapida((s) => s.origemDoResumo)
  const fechar = useEdicaoRapida((s) => s.fecharResumo)
  const { ligadas, nada } = useDicaDaEdicaoRapida()
  const caixa = useRef<HTMLDivElement>(null)
  const paraBaixo = useAbreParaBaixo(caixa, aberto && resumo !== null, 260)
  useFecharFora(caixa, aberto, fechar)

  const ocupado = rodando !== null || busy !== null
  const linhas = resumo ? linhasDoResumo(resumo, origem) : []
  const titulo = nada ? 'Nada ligado na Edicao rapida (Configuracoes)' : `Edicao rapida: ${ligadas} de uma vez. Ctrl+Z desfaz tudo.`

  return (
    <div className="relative shrink-0" ref={caixa}>
      <button
        type="button"
        onClick={() => void rodarEdicaoRapida()}
        disabled={!pronto || ocupado || nada}
        aria-label="Edicao rapida"
        title={titulo}
        className={[
          'lift flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2.5 py-1.5 text-[11px] disabled:opacity-40',
          aplicada || rodando === 'tudo' ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
        ].join(' ')}
      >
        <span className="flex h-[1lh] items-center">
          {rodando === 'tudo' ? (
            <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
          ) : (
            <WandSparkles size={12} strokeWidth={1.5} />
          )}
        </span>
        {/* Barra de render apertada (data-compacto do nucleo, aae00a3): so o icone, o title continua. */}
        <span className="group-data-[compacto]/barra:hidden">{rodando === 'tudo' ? 'Editando...' : 'Edicao rapida'}</span>
      </button>

      {aberto && resumo && (
        <div
          className={`glass enter absolute right-0 z-50 w-[300px] rounded-md p-3 ${paraBaixo ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%+6px)]'}`}
          style={{ backgroundColor: 'rgb(23 23 26 / 0.97)' }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="flex-1 text-[10px] uppercase tracking-wide text-ink-3">Edicao rapida</span>
            <button type="button" onClick={fechar} aria-label="Fechar" className="grid size-5 place-items-center rounded-sm text-ink-3 hover:text-ink">
              <X size={11} strokeWidth={1.5} />
            </button>
          </div>
          {resumo.aplicou === false && <p className="mb-1.5 text-[12px] text-ink-2">Nada mudou: o projeto ja estava assim.</p>}
          <dl className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-[12px]">
            {linhas.map((l) => (
              <div key={l.rotulo} className="contents">
                <dt className="text-ink-2">{l.rotulo}</dt>
                <dd className="min-w-0 truncate text-ink" title={l.dica ?? l.valor}>
                  {l.valor}
                </dd>
              </div>
            ))}
          </dl>
          {resumo.avisos.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5 text-[10px] leading-snug text-ink-2" title={resumo.avisos.join('\n')}>
              {resumo.avisos.slice(0, 3).map((a) => (
                <li key={a} className="truncate">
                  {a}
                </li>
              ))}
              {resumo.avisos.length > 3 && <li>+{resumo.avisos.length - 3}</li>}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2">
            {origem === 'editor' && resumo.aplicou !== false && <span className="text-[11px] text-ink-3">Ctrl+Z desfaz tudo</span>}
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => {
                fechar()
                n.abrirConfiguracoes('recap-edicao-rapida')
              }}
              title="O que a Edicao rapida faz, a pasta de musicas e a cor"
              className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            >
              Ajustar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
