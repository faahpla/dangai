import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleCheck, Clapperboard, Copy, FolderOpen, Loader2, Pause, Play, WandSparkles, X } from 'lucide-react'
import { Segmentos } from '@/modulos/kit'
import { hashtagsEmTexto, textoDeCopiarTudo, TITULO_MAX } from '../../shared/pos-render'
import { nucleo } from '../nucleo'
import { useGerar } from '../store/gerar'
import { renderDoProjeto, usePosRender } from '../store/pos-render'
import { gravarThumbPendente, useThumb } from '../store/thumb'
import { Aviso, Botao, COR_DE_AVISO, focarBotao, formatarTempo, Secao } from './pecas'
import { AjustesDaThumb, PreviaDaThumb, RodapeDaThumb } from './Thumbnail'
import { Copiar, copiarTexto } from './TituloEThumb'

/**
 * [recap] A TELA POS-RENDER, como a do CapCut depois de exportar: o video
 * pronto tocando a esquerda; a direita, o que ele copia para publicar -- os
 * 3 titulos (com a contagem de caracteres), os 3 textos de thumb, a descricao
 * e as hashtags (o "Titulo, descricao e hashtags" do nucleo, escrito aqui com
 * um clique se ainda nao houver), "Copiar tudo", "Abrir pasta" e "Fechar".
 * Titulos e thumbs tem o "Escrever de novo" (um pedido de IA para os dois).
 *
 * Abre sozinha no fim de um render bom de um projeto do recap (projeto.ts) e
 * pelo "Video pronto" (barra de status e paleta) depois; projeto normal do
 * Dangai nao abre. Tela cheia do modulo (o resto inerte); Esc, o X e o
 * "Fechar" fecham. O assistente abrindo por cima (a paleta) fecha esta.
 *
 * Duas partes (30/10): "Publicar" (a de sempre) e "Thumbnail" (o gerador da
 * capa 1080x1920, Thumbnail.tsx): a previa da thumb toma o lugar do video.
 */
export function PosRender() {
  const aberta = usePosRender((s) => s.aberta)

  useEffect(() => {
    if (!aberta) return
    nucleo().telaCheia(true)
    // O assistente aberto pela paleta (que fica por cima): esta sai da frente.
    const pararDeOuvir = useGerar.subscribe((s, a) => {
      if (s.aberto && !a.aberto) usePosRender.getState().fechar()
    })
    return () => {
      pararDeOuvir()
      // O ultimo toque na thumb ainda no relogio do "juntar": vai para o projeto agora.
      try {
        gravarThumbPendente()
      } catch (err) {
        console.error('[recap] pos-render: gravar a thumb na limpeza falhou:', err)
      }
      // Nunca lancar na limpeza: o erro derrubaria a janela inteira.
      try {
        nucleo().telaCheia(useGerar.getState().aberto)
      } catch (err) {
        console.error('[recap] pos-render: telaCheia na limpeza falhou:', err)
      }
    }
  }, [aberta])

  if (!aberta) return null
  return createPortal(<JanelaDoPosRender />, document.body)
}

/** O "Video pronto" na barra de status: so em projeto do recap que ja tem render anotado. */
export function BotaoVideoPronto() {
  // O zod so roda quando `modulos` muda (o playhead muda o estado 60x por segundo).
  const modulos = nucleo().usar((s) => s.modulos)
  const arquivo = useMemo(() => renderDoProjeto(modulos)?.arquivo ?? null, [modulos])
  if (!arquivo) return null
  return (
    <button
      type="button"
      onClick={() => void usePosRender.getState().reabrir()}
      aria-label="Video pronto"
      title={`O video do ultimo render e os textos para publicar\n${arquivo}`}
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border border-line bg-elevated px-2 py-0.5 text-[11px] text-ink-2 transition-colors duration-150 hover:text-ink"
    >
      <Clapperboard size={11} strokeWidth={1.5} className="text-accent" />
      Video pronto
    </button>
  )
}

/** O mesmo na paleta (Ctrl+K). Sem render anotado, nao aparece. */
export function comandoDoVideoPronto() {
  const arquivo = renderDoProjeto(nucleo().ler().modulos)?.arquivo ?? null
  if (!arquivo) return []
  return [
    {
      id: 'recap-video-pronto',
      label: 'Video pronto',
      hint: arquivo.split(/[\\/]/).pop() ?? '',
      icon: Clapperboard,
      run: () => void usePosRender.getState().reabrir(),
    },
  ]
}

/** O tamanho da janela antes da 1a medida (e no teste, sem ResizeObserver). */
const CAIXA_INICIAL = { largura: 1040, altura: 740 }
/** A coluna da direita nunca fica mais estreita que isto: o video de 16:9 encolhe antes. */
const DIREITA_MIN = 460
/** Os controles do player (32) e o espaco acima deles (8). */
const CONTROLES = 40
/** Embaixo da previa da thumb: os avisos da area segura e o "Ver area segura". */
const AVISOS_DA_THUMB = 76

/** A janela em si (exportada para o teste desenhar sem o portal). */
export function JanelaDoPosRender() {
  const outputPath = usePosRender((s) => s.outputPath)
  const projetoPath = usePosRender((s) => s.projetoPath)
  const videoUrl = usePosRender((s) => s.videoUrl)
  const carregando = usePosRender((s) => s.carregando)
  const erro = usePosRender((s) => s.erro)
  const titulosDoRoteiro = usePosRender((s) => s.titulos)
  const thumbs = usePosRender((s) => s.thumbs)
  const escrevendo = usePosRender((s) => s.escrevendo)
  const erroDosTextos = usePosRender((s) => s.erroDosTextos)
  const escrevendoTitulos = usePosRender((s) => s.escrevendoTitulos)
  const erroDosTitulos = usePosRender((s) => s.erroDosTitulos)
  const metadata = nucleo().usar((s) => s.metadata)
  const fechar = (): void => usePosRender.getState().fechar()
  const janela = useRef<HTMLDivElement | null>(null)
  const [caixa, setCaixa] = useState(CAIXA_INICIAL)
  const [aba, setAba] = useState<'publicar' | 'thumb'>('publicar')
  const abrirAba = (a: 'publicar' | 'thumb'): void => {
    setAba(a)
    if (a === 'thumb') void useThumb.getState().iniciar()
  }

  // Roteiro de antes das sugestoes (ou colado): os titulos do "Titulo, descricao e hashtags".
  const titulos = titulosDoRoteiro.length > 0 ? titulosDoRoteiro : (metadata?.titles ?? [])
  const descricao = metadata?.description?.trim() || null
  const hashtags = metadata?.hashtags ?? []
  const tudo = textoDeCopiarTudo({ titulos, thumbs, descricao, hashtags })
  const nome = outputPath?.split(/[\\/]/).pop() ?? ''
  // O video sumiu: o "Abrir pasta" mostra o projeto (a pasta dele).
  const mostrar = videoUrl ? outputPath : (projetoPath ?? outputPath)
  const alturaDoVideo = Math.max(160, caixa.altura - CONTROLES)
  const larguraMax = Math.max(200, caixa.largura - DIREITA_MIN - 20)

  // O tamanho util da janela: o player cabe nele na proporcao do proprio video.
  useEffect(() => {
    const el = janela.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const medir = (): void => {
      const r = el.getBoundingClientRect()
      // p-5 (20 px de cada lado).
      setCaixa({ largura: Math.round(r.width - 40), altura: Math.round(r.height - 40) })
    }
    medir()
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Esc na SUBIDA, como o do assistente: com um modal do nucleo por cima (lido na descida), quem fecha e ele.
  useEffect(() => {
    focarBotao('pos-render-copiar-tudo')
    // O fim do render ainda mexe no foco do editor por baixo: confere de novo num instante.
    const deNovo = setTimeout(() => {
      if (!janela.current?.contains(document.activeElement)) focarBotao('pos-render-copiar-tudo')
    }, 250)
    let porCimaNaDescida = false
    const descida = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') porCimaNaDescida = nucleo().haModalPorCima()
    }
    const subida = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || porCimaNaDescida) return
      usePosRender.getState().fechar()
    }
    window.addEventListener('keydown', descida, true)
    window.addEventListener('keydown', subida)
    return () => {
      clearTimeout(deNovo)
      window.removeEventListener('keydown', descida, true)
      window.removeEventListener('keydown', subida)
    }
  }, [])

  const escreverDeNovo = (secao: 'titulos' | 'thumbs') => (
    <Botao
      pequeno
      disabled={escrevendoTitulos !== null}
      onClick={() => void usePosRender.getState().escreverTitulos(secao)}
      title="3 titulos e 3 textos de thumb novos, diferentes destes (uma chamada de IA para os dois)"
    >
      {escrevendoTitulos !== null ? <Loader2 size={12} strokeWidth={1.5} className="animate-spin" /> : <WandSparkles size={12} strokeWidth={1.5} />}
      {escrevendoTitulos !== null ? 'Escrevendo...' : 'Escrever de novo'}
    </Botao>
  )

  return (
    <div className="fixed inset-0 z-[36] grid place-items-center bg-black/55 p-6">
      <div
        ref={janela}
        role="dialog"
        aria-modal="true"
        aria-label="Video pronto"
        style={{ backgroundColor: 'var(--color-elevated)' }}
        className="glass enter flex h-[min(780px,100%)] w-[min(1180px,100%)] min-h-0 gap-5 rounded-lg p-5"
      >
        {aba === 'thumb' ? (
          <PreviaDaThumb altura={Math.max(200, caixa.altura - AVISOS_DA_THUMB)} larguraMax={larguraMax} />
        ) : videoUrl ? (
          <Tocador url={videoUrl} altura={alturaDoVideo} larguraMax={larguraMax} />
        ) : (
          <div
            style={{ width: Math.min(larguraMax, Math.round((alturaDoVideo * 9) / 16)) }}
            className="grid h-full shrink-0 place-items-center rounded-md border border-line bg-black/30 p-4 text-center text-[12px] text-ink-3"
            data-pos="sem-video"
          >
            {carregando ? (
              <Loader2 size={18} strokeWidth={1.5} className="animate-spin text-accent" />
            ) : (
              <span>{erro ?? 'O video nao esta mais na pasta.'}</span>
            )}
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <header className="flex min-w-0 items-center gap-2.5">
            <CircleCheck size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
            <h2 className="shrink-0 text-[15px] font-medium text-ink">Video pronto</h2>
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3" title={outputPath ?? undefined}>
              {nome}
            </span>
            <div className="w-[190px] shrink-0" data-pos="abas">
              <Segmentos
                opcoes={[
                  { valor: 'publicar' as const, rotulo: 'Publicar', title: 'Titulos, descricao e hashtags' },
                  { valor: 'thumb' as const, rotulo: 'Thumbnail', title: 'A capa 1080x1920 do short' },
                ]}
                ativo={(v) => aba === v}
                onChange={abrirAba}
              />
            </div>
            <button
              type="button"
              onClick={fechar}
              aria-label="Fechar"
              title="Fechar (Esc)"
              className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </header>

          {aba === 'thumb' ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
              <AjustesDaThumb />
            </div>
          ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
            <Secao titulo="Titulos" acao={escreverDeNovo('titulos')}>
              {titulos.length > 0 ? (
                <ul className="flex flex-col gap-1.5" data-pos="titulos">
                  {titulos.map((t) => {
                    const n = [...t].length
                    return (
                      <li key={t} className="flex min-w-0 items-center gap-2 rounded-sm border border-line bg-elevated py-1.5 pl-3 pr-1">
                        <span className="min-w-0 flex-1 select-text text-[13px] text-ink">{t}</span>
                        <span
                          className={`tnum shrink-0 text-[11px] ${n > TITULO_MAX ? COR_DE_AVISO : 'text-ink-3'}`}
                          title={`${n} caracteres (o YouTube aceita ate ${TITULO_MAX})`}
                        >
                          {n}/{TITULO_MAX}
                        </span>
                        <Copiar texto={t} rotulo="Copiar o titulo" />
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-[12px] text-ink-3">O roteiro deste projeto nao trouxe titulos.</p>
              )}
              {erroDosTitulos?.secao === 'titulos' && <Aviso>{erroDosTitulos.texto}</Aviso>}
            </Secao>

            <Secao titulo="Texto da thumbnail" acao={escreverDeNovo('thumbs')}>
              {thumbs.length > 0 ? (
                <ul className="flex flex-wrap gap-2" data-pos="thumbs">
                  {thumbs.map((t) => (
                    <li
                      key={t}
                      className="flex items-center gap-1 rounded-sm border border-line bg-elevated py-1 pl-3 pr-1 text-[12px] font-semibold uppercase tracking-wide text-ink"
                    >
                      <span className="select-text">{t.toLocaleUpperCase('pt-BR')}</span>
                      <Copiar texto={t.toLocaleUpperCase('pt-BR')} rotulo="Copiar o texto da thumb" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-ink-3">O roteiro deste projeto nao trouxe textos de thumb.</p>
              )}
              {erroDosTitulos?.secao === 'thumbs' && <Aviso>{erroDosTitulos.texto}</Aviso>}
            </Secao>

            <Secao
              titulo="Descricao"
              acao={
                descricao ? (
                  <>
                    <Botao
                      pequeno
                      disabled={escrevendo}
                      onClick={() => void usePosRender.getState().escreverTextos()}
                      title="Escreve a descricao e as hashtags de novo (uma chamada de IA)"
                    >
                      {escrevendo ? <Loader2 size={12} strokeWidth={1.5} className="animate-spin" /> : <WandSparkles size={12} strokeWidth={1.5} />}
                      {escrevendo ? 'Escrevendo...' : 'Escrever de novo'}
                    </Botao>
                    <Copiar texto={descricao} rotulo="Copiar a descricao" />
                  </>
                ) : undefined
              }
            >
              {descricao ? (
                <p className="select-text whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2" data-pos="descricao">
                  {descricao}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Botao
                    principal
                    foco="pos-render-escrever"
                    disabled={escrevendo}
                    onClick={() => void usePosRender.getState().escreverTextos()}
                    title="A descricao e as hashtags a partir do roteiro (uma chamada de IA)"
                  >
                    {escrevendo ? <Loader2 size={13} strokeWidth={1.5} className="animate-spin" /> : <WandSparkles size={13} strokeWidth={1.5} />}
                    {escrevendo ? 'Escrevendo...' : 'Escrever descricao e hashtags'}
                  </Botao>
                  <span className="text-[11px] text-ink-3">A partir do roteiro, pela IA das Configuracoes.</span>
                </div>
              )}
              {erroDosTextos && <Aviso>{erroDosTextos}</Aviso>}
            </Secao>

            <Secao titulo="Hashtags" acao={hashtags.length > 0 ? <Copiar texto={hashtagsEmTexto(hashtags)} rotulo="Copiar as hashtags" /> : undefined}>
              {hashtags.length > 0 ? (
                <p className="select-text text-[13px] leading-relaxed text-accent" data-pos="hashtags">
                  {hashtagsEmTexto(hashtags)}
                </p>
              ) : (
                <p className="text-[12px] text-ink-3">Saem junto com a descricao.</p>
              )}
            </Secao>
          </div>
          )}

          {aba === 'thumb' ? (
            <RodapeDaThumb fechar={fechar} />
          ) : (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
            <CopiarTudo texto={tudo} />
            <Botao
              onClick={() => {
                if (mostrar) void window.dangai.revealFile(mostrar)
              }}
              disabled={!mostrar}
              title={mostrar ? `${videoUrl ? 'Mostra o video' : 'Mostra o projeto'} no Explorer\n${mostrar}` : undefined}
            >
              <FolderOpen size={13} strokeWidth={1.5} />
              Abrir pasta
            </Botao>
            <Botao onClick={fechar} title="Volta ao editor (Esc)">
              Fechar
            </Botao>
          </footer>
          )}
        </div>
      </div>
    </div>
  )
}

/** "Copiar tudo": os blocos com os rotulos (textoDeCopiarTudo); vira "Copiado" por um instante. */
function CopiarTudo({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false)
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (relogio.current) clearTimeout(relogio.current)
    },
    [],
  )
  return (
    <Botao
      principal
      foco="pos-render-copiar-tudo"
      disabled={!texto}
      onClick={() =>
        void copiarTexto(texto).then((ok) => {
          if (!ok) return
          setCopiado(true)
          if (relogio.current) clearTimeout(relogio.current)
          relogio.current = setTimeout(() => setCopiado(false), 1400)
        })
      }
      title="Titulos, textos da thumb, descricao e hashtags, de uma vez"
    >
      {copiado ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.5} />}
      {copiado ? 'Copiado' : 'Copiar tudo'}
    </Botao>
  )
}

/**
 * O video tocando, com play/pause e a barra. A caixa TEM a proporcao do
 * proprio video (videoWidth/videoHeight: 9:16 no short, 16:9 no long form),
 * do tamanho que cabe na altura da janela (e na largura que sobra): sem faixa
 * preta e sem cortar. Clicar no video tambem pausa.
 */
function Tocador({ url, altura, larguraMax }: { url: string; altura: number; larguraMax: number }) {
  const video = useRef<HTMLVideoElement | null>(null)
  const [tocando, setTocando] = useState(false)
  const [tempo, setTempo] = useState(0)
  const [duracao, setDuracao] = useState(0)
  /** Largura / altura do video (9:16 ate o arquivo dizer). */
  const [proporcao, setProporcao] = useState(9 / 16)
  const largura = Math.floor(Math.min(altura * proporcao, larguraMax))
  const alturaDoVideo = Math.floor(largura / proporcao)

  const alternar = (): void => {
    const v = video.current
    if (!v) return
    if (v.paused || v.ended) void v.play().catch(() => {})
    else v.pause()
  }

  return (
    <div className="flex h-full shrink-0 flex-col justify-center gap-2" style={{ width: largura }}>
      <video
        ref={video}
        src={url}
        autoPlay
        playsInline
        onClick={alternar}
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => setTocando(false)}
        onTimeUpdate={(e) => setTempo(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          setDuracao(Number.isFinite(v.duration) ? v.duration : 0)
          if (v.videoWidth > 0 && v.videoHeight > 0) setProporcao(v.videoWidth / v.videoHeight)
        }}
        style={{ width: largura, height: alturaDoVideo, aspectRatio: String(proporcao) }}
        className="block shrink-0 cursor-pointer rounded-md object-contain"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={alternar}
          aria-label={tocando ? 'Pausar' : 'Tocar'}
          title={tocando ? 'Pausar' : 'Tocar'}
          className="grid size-8 shrink-0 place-items-center rounded-sm border border-line bg-surface text-ink transition-colors duration-150 hover:border-accent"
        >
          {tocando ? <Pause size={14} strokeWidth={1.5} /> : <Play size={14} strokeWidth={1.5} />}
        </button>
        <span className="tnum w-9 shrink-0 text-right text-[11px] text-ink-3">{formatarTempo(tempo)}</span>
        <input
          type="range"
          min={0}
          max={duracao || 0}
          step={0.01}
          value={Math.min(tempo, duracao || 0)}
          onChange={(e) => {
            const v = video.current
            if (!v) return
            v.currentTime = Number(e.target.value)
            setTempo(v.currentTime)
          }}
          aria-label="Posicao do video"
          className="dangai-range min-w-0 flex-1"
        />
        <span className="tnum w-9 shrink-0 text-[11px] text-ink-3">{formatarTempo(duracao)}</span>
      </div>
    </div>
  )
}
