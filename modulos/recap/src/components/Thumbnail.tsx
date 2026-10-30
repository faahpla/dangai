import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { ArrowUpDown, Check, FolderOpen, ImagePlus, Loader2, LocateFixed, Save, ScanFace, Sparkles, TriangleAlert } from 'lucide-react'
import { Deslizante, Segmentos } from '@/modulos/kit'
import {
  ALTURA,
  CORES_DA_THUMB,
  enquadramentoPreso,
  escalaQueCobre,
  FONTES_DA_THUMB,
  LARGURA,
  partirEmDuasLinhas,
  recorteDaImagem,
  textoYPadrao,
  thumbEfetiva,
  type Ponto,
  type ThumbDoProjeto,
} from '../../shared/thumb'
import { usePosRender } from '../store/pos-render'
import { cenaNoInstante, medidor, useThumb, type SugestaoNaTela } from '../store/thumb'
import { desenharThumb, type PainelPronto } from '../thumb/desenho'
import { Aviso, Botao, Caixinha, CAMPO_NORMAL, CLASSE_DO_CAMPO, COR_DE_AVISO, formatarTempo, Link, Secao } from './pecas'

/**
 * [recap] A PARTE "THUMBNAIL" da tela "Video pronto" (shared/thumb.ts,
 * store/thumb.ts): a previa 1080x1920 no lugar do video, a esquerda, e os
 * ajustes a direita -- layout (1 ou 2 imagens), as imagens (sugestoes das
 * cenas, um quadro do video pronto ou um arquivo dele), o texto (2 linhas,
 * cores, fonte, altura) e a seta. O estilo e fixo (o preset das refs); ele
 * so mexe no que o pedido deixou.
 *
 * Na previa: arrastar move a imagem, a rodinha amplia, as bolinhas da seta
 * arrastam as pontas. Enquanto ele ajusta (ou com "Ver area segura"), as
 * faixas proibidas do TikTok aparecem de leve, com as caixas dos rostos --
 * so na tela, nunca no PNG.
 */

/** As guias da previa: ligadas pela caixinha ou durante um ajuste (e um instante depois). */
const useGuias = create<{ ver: boolean; ajustandoAte: number; marcar(): void }>((set) => ({
  ver: false,
  ajustandoAte: 0,
  marcar: () => set({ ajustandoAte: Date.now() + 1100 }),
}))

/** O ajuste acabou de acontecer: as guias somem sozinhas depois. */
function useAjustando(): boolean {
  const ate = useGuias((s) => s.ajustandoAte)
  const [, redesenhar] = useState(0)
  useEffect(() => {
    const falta = ate - Date.now()
    if (falta <= 0) return
    const t = setTimeout(() => redesenhar((n) => n + 1), falta + 20)
    return () => clearTimeout(t)
  }, [ate])
  return ate > Date.now()
}

/** A thumb como aparece agora (geometria, enquadramentos, seta, avisos). */
function useEfetiva() {
  const thumb = useThumb((s) => s.thumb)
  const fontes = useThumb((s) => s.fontesProntas)
  return useMemo(() => (thumb ? thumbEfetiva(thumb, medidor(thumb.fonte)) : null), [thumb, fontes])
}

type Arrasto =
  | {
      tipo: 'imagem'
      slot: 0 | 1
      inicio: Ponto
      zoom: number
      cx: number
      cy: number
    }
  | { tipo: 'seta'; qual: 'base' | 'ponta'; outra: Ponto }

/** A previa da thumb, do tamanho do player (9:16), com o arrastar, a rodinha e as guias. */
export function PreviaDaThumb({ altura, larguraMax }: { altura: number; larguraMax: number }) {
  const thumb = useThumb((s) => s.thumb)
  const previas = useThumb((s) => s.previas)
  const ef = useEfetiva()
  const ver = useGuias((s) => s.ver)
  const ajustando = useAjustando()
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const arrasto = useRef<Arrasto | null>(null)
  const [cursor, setCursor] = useState('default')
  // As bolinhas da seta so com o ponteiro na previa (ou ajustando): no resto, a thumb como sai.
  const [emCima, setEmCima] = useState(false)
  const largura = Math.floor(Math.min((altura * 9) / 16, larguraMax))
  const alto = Math.floor((largura * 16) / 9)
  const guias = ver || ajustando

  // Desenha a cada mudanca (o canvas na resolucao da tela: nitido no monitor de 150%).
  useEffect(() => {
    const el = canvas.current
    if (!el || !thumb || !ef) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(largura * dpr)
    const h = Math.round(alto * dpr)
    if (el.width !== w) el.width = w
    if (el.height !== h) el.height = h
    const ctx = el.getContext('2d')
    if (!ctx) return
    const paineis = ef.geo.paineis.map((painel, i): PainelPronto | null => {
      const bitmap = previas[i]?.bitmap
      if (!bitmap) return null
      const r = recorteDaImagem(painel, { largura: bitmap.width, altura: bitmap.height }, ef.enquadramentos[i] ?? null)
      return { fonte: bitmap, sx: r.sx, sy: r.sy, sw: r.sw, sh: r.sh }
    })
    desenharThumb(ctx, {
      thumb,
      geo: ef.geo,
      paineis,
      seta: ef.seta,
      escala: w / LARGURA,
      guias: { zonas: guias, rostos: guias ? ef.rostos : [], pontasDaSeta: guias || emCima },
    })
  }, [thumb, ef, previas, largura, alto, guias, emCima])

  // A rodinha amplia em volta do ponteiro (listener nao passivo: o preventDefault segura a rolagem).
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const rodinha = (ev: WheelEvent): void => {
      const s = useThumb.getState()
      const t = s.thumb
      const efetiva = t ? thumbEfetiva(t, medidor(t.fonte)) : null
      if (!t || !efetiva) return
      const p = paraQuadro(el, ev)
      const slot = painelEm(t, efetiva.geo.emenda, p.y)
      const img = t.imagens[slot]
      const painel = efetiva.geo.paineis[slot]
      const enq = efetiva.enquadramentos[slot]
      if (!img || !painel || !enq) return
      ev.preventDefault()
      const r0 = recorteDaImagem(painel, img, enq)
      const ix = r0.sx + p.x / r0.escala
      const iy = r0.sy + (p.y - painel.y0) / r0.escala
      const zoom = Math.max(1, Math.min(4, enq.zoom * Math.exp(-ev.deltaY * 0.0015)))
      const s1 = escalaQueCobre(painel, img) * zoom
      const sx = ix - p.x / s1
      const sy = iy - (p.y - painel.y0) / s1
      const cx = (sx + LARGURA / s1 / 2) / img.largura
      const cy = (sy + (painel.y1 - painel.y0) / s1 / 2) / img.altura
      s.escolherSlot(slot)
      s.enquadrar(slot, enquadramentoPreso(painel, img, { zoom, cx, cy }))
      useGuias.getState().marcar()
    }
    el.addEventListener('wheel', rodinha, { passive: false })
    return () => el.removeEventListener('wheel', rodinha)
  }, [])

  const pontaPerto = (p: Ponto): 'base' | 'ponta' | null => {
    if (!ef?.seta) return null
    const raio = Math.max(34, (14 * LARGURA) / largura)
    if (Math.hypot(p.x - ef.seta.ponta.x, p.y - ef.seta.ponta.y) < raio) return 'ponta'
    if (Math.hypot(p.x - ef.seta.base.x, p.y - ef.seta.base.y) < raio) return 'base'
    return null
  }

  if (!thumb || !ef) {
    return (
      <div style={{ width: largura, height: alto }} className="grid shrink-0 place-items-center rounded-md border border-line bg-black/30">
        <Loader2 size={18} strokeWidth={1.5} className="animate-spin text-accent" />
      </div>
    )
  }

  const carregando = previas.some((p) => p?.carregando)
  return (
    <div className="flex h-full shrink-0 flex-col justify-center gap-2" style={{ width: largura }}>
      <div className="relative shrink-0" style={{ width: largura, height: alto }}>
        <canvas
          ref={canvas}
          data-thumb="previa"
          aria-label="Previa da thumbnail"
          style={{ width: largura, height: alto, cursor }}
          className="block rounded-md"
          onPointerDown={(ev) => {
            const el = canvas.current
            if (!el || ev.button !== 0) return
            const p = paraQuadro(el, ev)
            const qual = pontaPerto(p)
            if (qual && ef.seta) {
              arrasto.current = {
                tipo: 'seta',
                qual,
                outra: qual === 'base' ? ef.seta.ponta : ef.seta.base,
              }
            } else {
              const slot = painelEm(thumb, ef.geo.emenda, p.y)
              const enq = ef.enquadramentos[slot]
              if (!thumb.imagens[slot] || !enq) return
              useThumb.getState().escolherSlot(slot)
              arrasto.current = {
                tipo: 'imagem',
                slot,
                inicio: p,
                zoom: enq.zoom,
                cx: enq.cx,
                cy: enq.cy,
              }
            }
            el.setPointerCapture(ev.pointerId)
            setCursor('grabbing')
            useGuias.getState().marcar()
          }}
          onPointerMove={(ev) => {
            const el = canvas.current
            if (!el) return
            const p = paraQuadro(el, ev)
            const a = arrasto.current
            if (!a) {
              setCursor(pontaPerto(p) ? 'grab' : thumb.imagens[painelEm(thumb, ef.geo.emenda, p.y)] ? 'move' : 'default')
              return
            }
            const s = useThumb.getState()
            const t = s.thumb
            if (!t) return
            useGuias.getState().marcar()
            if (a.tipo === 'seta') {
              const ponto = {
                x: Math.max(0, Math.min(LARGURA, p.x)),
                y: Math.max(0, Math.min(ALTURA, p.y)),
              }
              const outra = a.qual === 'base' ? 'ponta' : 'base'
              s.mudar({
                seta: {
                  ...t.seta,
                  [a.qual]: ponto,
                  [outra]: t.seta[outra] ?? a.outra,
                },
              })
              return
            }
            const img = t.imagens[a.slot]
            const painel = ef.geo.paineis[a.slot]
            if (!img || !painel) return
            const r0 = recorteDaImagem(painel, img, {
              zoom: a.zoom,
              cx: a.cx,
              cy: a.cy,
            })
            const cx = a.cx - (p.x - a.inicio.x) / r0.escala / img.largura
            const cy = a.cy - (p.y - a.inicio.y) / r0.escala / img.altura
            s.enquadrar(a.slot, enquadramentoPreso(painel, img, { zoom: a.zoom, cx, cy }))
          }}
          onPointerUp={(ev) => {
            arrasto.current = null
            canvas.current?.releasePointerCapture(ev.pointerId)
            setCursor('default')
            useGuias.getState().marcar()
          }}
          onPointerCancel={() => {
            arrasto.current = null
            setCursor('default')
          }}
          onPointerEnter={() => setEmCima(true)}
          onPointerLeave={() => setEmCima(false)}
        />
        {carregando && (
          <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-sm bg-black/60 px-2 py-1 text-[11px] text-ink-2">
            <Loader2 size={11} strokeWidth={1.5} className="animate-spin" /> Abrindo o quadro...
          </div>
        )}
      </div>
      <AvisosDaPrevia />
    </div>
  )
}

function paraQuadro(el: HTMLCanvasElement, ev: { clientX: number; clientY: number }): Ponto {
  const r = el.getBoundingClientRect()
  return {
    x: ((ev.clientX - r.left) / Math.max(1, r.width)) * LARGURA,
    y: ((ev.clientY - r.top) / Math.max(1, r.height)) * ALTURA,
  }
}

function painelEm(t: ThumbDoProjeto, emenda: number | null, y: number): 0 | 1 {
  return t.layout === 'duas' && emenda !== null && y >= emenda ? 1 : 0
}

/** Embaixo da previa: os avisos da area segura, ou o "ok" discreto. */
function AvisosDaPrevia() {
  const ef = useEfetiva()
  const ver = useGuias((s) => s.ver)
  if (!ef) return null
  return (
    <div className="flex min-h-8 flex-col gap-1" data-thumb="avisos">
      {ef.avisos.length > 0 ? (
        ef.avisos.map((a) => (
          <p key={`${a.painel}-${a.tipo}`} className={`flex items-start gap-1.5 text-[11px] leading-snug ${COR_DE_AVISO}`}>
            <TriangleAlert size={12} strokeWidth={1.75} className="mt-px shrink-0" />
            <span>{a.texto}</span>
          </p>
        ))
      ) : (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <Check size={12} strokeWidth={2} className="shrink-0 text-accent" />
          Rostos fora das faixas proibidas do TikTok.
        </p>
      )}
      <Caixinha
        ligada={ver}
        onChange={(v) => useGuias.setState({ ver: v })}
        title="Mostra as faixas proibidas (0-13% e 87-100%) e as caixas dos rostos. Nunca vai para o PNG."
      >
        Ver area segura
      </Caixinha>
    </div>
  )
}

// ================================================================ ajustes

type Fonte = 'sugestoes' | 'video' | 'arquivo'

/** A coluna da direita na parte Thumbnail. */
export function AjustesDaThumb() {
  const thumb = useThumb((s) => s.thumb)
  const slot = useThumb((s) => s.slot)
  const previas = useThumb((s) => s.previas)
  const ef = useEfetiva()
  const thumbsDoRoteiro = usePosRender((s) => s.thumbs)
  // Cada imagem (cima e baixo) lembra de onde ele estava escolhendo.
  const [fontes, setFontes] = useState<[Fonte, Fonte]>(['sugestoes', 'sugestoes'])
  if (!thumb || !ef) return null
  const mudar = useThumb.getState().mudar
  const img = thumb.imagens[slot]
  const enq = ef.enquadramentos[slot]
  const painel = ef.geo.paineis[slot]
  const padraoY = textoYPadrao(thumb.layout)
  const fonte = fontes[slot]
  const setFonte = (f: Fonte): void => setFontes((atual) => (slot === 0 ? [f, atual[1]] : [atual[0], f]))
  const nomeDoSlot = thumb.layout === 'uma' ? 'a imagem' : slot === 0 ? 'a imagem de cima' : 'a imagem de baixo'

  return (
    <div className="flex min-w-0 flex-col gap-3" data-thumb="ajustes">
      <Secao
        titulo="Imagens"
        acao={
          <div className="w-[220px]">
            <Segmentos
              opcoes={[
                {
                  valor: 'uma' as const,
                  rotulo: '1 imagem',
                  title: 'Uma imagem cheia',
                },
                {
                  valor: 'duas' as const,
                  rotulo: '2 imagens',
                  title: 'Duas imagens (cima e baixo), o texto na emenda',
                },
              ]}
              ativo={(v) => thumb.layout === v}
              onChange={(v) => mudar({ layout: v })}
            />
          </div>
        }
      >
        <div className={thumb.layout === 'uma' ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-[1fr_auto_1fr] items-center gap-2'}>
          <CartaoDoSlot slot={0} ativo={slot === 0} rotulo={thumb.layout === 'uma' ? 'Imagem' : 'Imagem de cima'} />
          {thumb.layout === 'duas' && (
            <>
              <button
                type="button"
                onClick={() => {
                  useThumb.getState().inverter()
                  useGuias.getState().marcar()
                }}
                disabled={!thumb.imagens[0] && !thumb.imagens[1]}
                aria-label="Inverter cima e baixo"
                title="Inverter cima e baixo (cada uma se enquadra sozinha na metade nova)"
                data-thumb="inverter"
                className="grid size-8 place-items-center rounded-full border border-line bg-surface text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
              >
                <ArrowUpDown size={14} strokeWidth={1.75} />
              </button>
              <CartaoDoSlot slot={1} ativo={slot === 1} rotulo="Imagem de baixo" />
            </>
          )}
        </div>
        <div className="flex flex-col gap-3 rounded-sm border border-l-2 border-line border-l-accent bg-elevated/40 p-3" data-thumb="editor-do-slot">
        <p className="text-[11px] text-ink-2">
          Escolhendo <span className="font-medium text-ink">{nomeDoSlot}</span>
          {thumb.layout === 'duas' && <span className="text-ink-3"> (clique na outra para trocar)</span>}
        </p>
        {img && enq && painel && (
          <div className="flex items-center gap-2" data-thumb="zoom">
            <span className="w-[68px] shrink-0 text-[11px] text-ink-3">Zoom</span>
            <Deslizante
              valor={enq.zoom}
              min={1}
              max={4}
              step={0.01}
              texto={`${Math.round(enq.zoom * 100)}%`}
              padrao={1}
              dica="Amplia a imagem escolhida (arrastar na previa move; a rodinha tambem amplia)"
              onChange={(z) => {
                useThumb.getState().enquadrar(
                  slot,
                  enquadramentoPreso(painel, img, {
                    zoom: z,
                    cx: enq.cx,
                    cy: enq.cy,
                  }),
                )
                useGuias.getState().marcar()
              }}
            />
            <Botao
              pequeno
              disabled={!img.enquadramento}
              onClick={() => {
                useThumb.getState().enquadrar(slot, null)
                useGuias.getState().marcar()
              }}
              title="Volta ao enquadramento automatico (rosto na area segura, fora do texto)"
            >
              <LocateFixed size={12} strokeWidth={1.5} />
              Enquadrar sozinho
            </Botao>
          </div>
        )}
        {previas[slot]?.erro && <Aviso>{previas[slot]?.erro}</Aviso>}
        <Segmentos
          opcoes={[
            {
              valor: 'sugestoes' as const,
              rotulo: 'Sugestoes',
              title: 'Os melhores quadros das cenas do video (o gancho primeiro)',
            },
            {
              valor: 'video' as const,
              rotulo: 'Quadro do video',
              title: 'Qualquer instante do video, tirado limpo da cena original (sem legenda)',
            },
            {
              valor: 'arquivo' as const,
              rotulo: 'Do computador',
              title: 'Uma imagem do PC',
            },
          ]}
          ativo={(v) => fonte === v}
          onChange={setFonte}
        />
        {fonte === 'sugestoes' && <GradeDeSugestoes />}
        {fonte === 'video' && <QuadroDoVideo />}
        {fonte === 'arquivo' && (
          <div className="flex flex-wrap items-center gap-3">
            <Botao onClick={() => void useThumb.getState().usarArquivo()} title="PNG, JPG, WEBP ou BMP">
              <ImagePlus size={13} strokeWidth={1.5} />
              Escolher imagem...
            </Botao>
            <span className="text-[11px] text-ink-3">Vai para {nomeDoSlot} e e copiada para a pasta do projeto; o rosto e enquadrado sozinho.</span>
          </div>
        )}
        </div>
      </Secao>

      <Secao titulo="Texto">
        {[0, 1].map((i) => (
          <LinhaDeTexto key={i} linha={i as 0 | 1} />
        ))}
        {thumbsDoRoteiro.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" data-thumb="do-roteiro">
            <span className="mr-1 text-[11px] text-ink-3">Do roteiro:</span>
            {thumbsDoRoteiro.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => mudar({ linhas: partirEmDuasLinhas(t) })}
                title="Usar este texto (quebrado em 2 linhas)"
                className="lift rounded-sm border border-line bg-elevated px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-2 hover:text-ink"
              >
                {t.toLocaleUpperCase('pt-BR')}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="w-[68px] shrink-0 text-[11px] text-ink-3">Fonte</span>
          <Segmentos
            opcoes={FONTES_DA_THUMB.map((f) => ({
              valor: f.id,
              rotulo: (
                <span
                  style={{
                    fontFamily: `"${f.familia}", sans-serif`,
                    fontSize: 12,
                  }}
                >
                  {f.nome}
                </span>
              ),
              title: f.nome,
            }))}
            ativo={(v) => thumb.fonte === v}
            onChange={(v) => mudar({ fonte: v })}
          />
        </div>
        <div className="flex items-center gap-2" data-thumb="altura-do-texto">
          <span className="w-[68px] shrink-0 text-[11px] text-ink-3">Altura</span>
          <Deslizante
            valor={thumb.textoY ?? padraoY}
            min={0.25}
            max={0.75}
            step={0.005}
            texto={`${Math.round((thumb.textoY ?? padraoY) * 100)}%`}
            padrao={padraoY}
            dica="Sobe ou desce o bloco de texto (com 2 imagens, a emenda vai junto)"
            onChange={(v) => {
              mudar({ textoY: Math.abs(v - padraoY) < 0.002 ? null : v })
              useGuias.getState().marcar()
            }}
          />
        </div>
      </Secao>

      <Secao
        titulo="Seta"
        acao={
          thumb.seta.ligada && (thumb.seta.base || thumb.seta.ponta) ? (
            <Link onClick={() => mudar({ seta: { ligada: true, base: null, ponta: null } })} title="A seta volta a apontar o rosto sozinha">
              Apontar o rosto de novo
            </Link>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Caixinha ligada={thumb.seta.ligada} onChange={(v) => mudar({ seta: { ...thumb.seta, ligada: v } })}>
            Seta vermelha apontando o rosto
          </Caixinha>
          {thumb.seta.ligada && <span className="text-[11px] text-ink-3">Arraste as bolinhas da previa para mudar as pontas.</span>}
        </div>
      </Secao>
    </div>
  )
}

function CartaoDoSlot({ slot, ativo, rotulo }: { slot: 0 | 1; ativo: boolean; rotulo: string }) {
  const img = useThumb((s) => s.thumb?.imagens[slot] ?? null)
  const previa = useThumb((s) => s.previas[slot])
  const detector = useThumb((s) => s.detector)
  const estado = !img
    ? 'Escolha abaixo'
    : previa?.carregando
      ? 'Abrindo...'
      : previa?.procurandoRosto
        ? 'Procurando o rosto...'
        : img.rostos === null
          ? 'Sem detector de rosto'
          : img.rostos.length === 0
            ? 'Nenhum rosto achado'
            : `${img.rostos.length} ${img.rostos.length === 1 ? 'rosto' : 'rostos'}${detector === 'antigo' ? ' (detector simples)' : ''}`
  return (
    <button
      type="button"
      onClick={() => useThumb.getState().escolherSlot(slot)}
      aria-pressed={ativo}
      data-thumb={`slot-${slot}`}
      title="As escolhas abaixo vao para esta imagem"
      className={[
        'flex min-w-0 items-center gap-2.5 rounded-sm border p-1.5 text-left transition-colors',
        ativo ? 'border-accent bg-accent-dim' : 'border-line bg-elevated hover:border-line-strong',
      ].join(' ')}
    >
      <span className="relative block aspect-video w-24 shrink-0 overflow-hidden rounded-[3px] bg-black/40">
        {previa?.url && <img src={previa.url} alt="" className="size-full object-cover" />}
        {previa?.carregando && <Loader2 size={14} strokeWidth={1.5} className="absolute inset-0 m-auto animate-spin text-ink-2" />}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
          {rotulo}
          {img?.gancho && <EtiquetaDoGancho />}
        </span>
        <span className="flex items-center gap-1 truncate text-[11px] text-ink-3">
          {previa?.procurandoRosto ? <Loader2 size={10} strokeWidth={1.5} className="animate-spin" /> : img ? <ScanFace size={11} strokeWidth={1.5} /> : null}
          {estado}
        </span>
      </span>
    </button>
  )
}

function EtiquetaDoGancho() {
  return <span className="rounded-[3px] bg-accent px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-white">Gancho</span>
}

function GradeDeSugestoes() {
  const sugestoes = useThumb((s) => s.sugestoes)
  const carregando = useThumb((s) => s.carregandoSugestoes)
  const erro = useThumb((s) => s.erroDasSugestoes)
  const atual = useThumb((s) => s.thumb?.imagens[s.slot] ?? null)
  if (carregando && !sugestoes?.length) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-ink-3" data-thumb="sugestoes-carregando">
        <Loader2 size={13} strokeWidth={1.5} className="animate-spin text-accent" />
        Escolhendo os melhores quadros das cenas (o detector de rosto leva alguns segundos)...
      </p>
    )
  }
  if (erro) return <Aviso>{erro}</Aviso>
  if (!sugestoes || sugestoes.length === 0)
    return <p className="text-[12px] text-ink-3">Nenhuma cena do video para sugerir. Use um quadro do video ou uma imagem do computador.</p>
  return (
    <ul className="grid grid-cols-4 gap-2" data-thumb="sugestoes">
      {sugestoes.map((s) => (
        <li key={`${s.arquivo}|${s.t}`}>
          <CartaoDaSugestao s={s} escolhida={atual?.arquivo === s.arquivo && Math.abs(atual.t - s.t) < 0.01} />
        </li>
      ))}
    </ul>
  )
}

function CartaoDaSugestao({ s, escolhida }: { s: SugestaoNaTela; escolhida: boolean }) {
  const rosto = Math.max(0, ...(s.rostos ?? []).map((r) => r.w))
  return (
    <button
      type="button"
      onClick={() => void useThumb.getState().usarSugestao(s)}
      title={`${s.rotulo}${s.noVideo !== null ? ` - em ${formatarTempo(s.noVideo)} do video` : ''}${rosto > 0 ? ` - rosto de ${Math.round(rosto * 100)}% da largura` : ' - sem rosto achado'}`}
      className={[
        'group relative block aspect-video w-full overflow-hidden rounded-sm border bg-black/40 transition-colors',
        escolhida ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong',
      ].join(' ')}
    >
      <img src={s.url} alt="" className="size-full object-cover transition-transform duration-150 group-hover:scale-[1.04]" />
      {s.gancho && (
        <span className="absolute left-1 top-1">
          <EtiquetaDoGancho />
        </span>
      )}
      {escolhida && (
        <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-accent text-white">
          <Check size={10} strokeWidth={2.5} />
        </span>
      )}
      <span className="tnum absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-0.5 pt-3 text-left text-[10px] text-white/85">
        {s.noVideo !== null ? formatarTempo(s.noVideo) : s.rotulo}
      </span>
    </button>
  )
}

/**
 * Um instante qualquer do video: a barrinha anda no video pronto (para ele
 * achar o momento), mas o quadro sai LIMPO da cena de origem naquele instante
 * (regra do Levi: thumb nunca com legenda) -- o arquivo e o ponto vem do
 * plano do projeto (cenaNoInstante). No grid, ele escolhe a metade.
 */
function QuadroDoVideo() {
  const videoUrl = usePosRender((s) => s.videoUrl)
  const video = useRef<HTMLVideoElement | null>(null)
  const [tempo, setTempo] = useState(0)
  const [duracao, setDuracao] = useState(0)
  const [usando, setUsando] = useState<'a' | 'b' | null>(null)
  const cena = useMemo(() => cenaNoInstante(tempo), [tempo])
  if (!videoUrl) return <p className="text-[12px] text-ink-3">O video pronto nao esta mais na pasta.</p>
  const usar = (metade: 'a' | 'b'): void => {
    setUsando(metade)
    void useThumb
      .getState()
      .usarQuadroDoVideo(video.current?.currentTime ?? tempo, metade)
      .finally(() => setUsando(null))
  }
  const botao = (metade: 'a' | 'b', rotulo: string, title: string) => (
    <Botao disabled={usando !== null || duracao <= 0 || !cena} onClick={() => usar(metade)} title={title}>
      {usando === metade ? <Loader2 size={13} strokeWidth={1.5} className="animate-spin" /> : <Sparkles size={13} strokeWidth={1.5} />}
      {rotulo}
    </Botao>
  )
  return (
    <div className="flex items-start gap-3" data-thumb="quadro-do-video">
      <video
        ref={video}
        src={videoUrl}
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={(e) => setDuracao(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onTimeUpdate={(e) => setTempo(e.currentTarget.currentTime)}
        className="h-[176px] w-[99px] shrink-0 rounded-sm bg-black object-contain"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-1">
        <div className="flex items-center gap-2">
          <span className="tnum w-10 shrink-0 text-right text-[11px] text-ink-3">{formatarTempo(tempo, 1)}</span>
          <input
            type="range"
            min={0}
            max={duracao || 0}
            step={1 / 30}
            value={Math.min(tempo, duracao || 0)}
            onChange={(e) => {
              const v = video.current
              if (!v) return
              v.currentTime = Number(e.target.value)
              setTempo(v.currentTime)
            }}
            aria-label="Instante do video"
            className="dangai-range min-w-0 flex-1"
          />
          <span className="tnum w-10 shrink-0 text-[11px] text-ink-3">{formatarTempo(duracao, 1)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cena?.b ? (
            <>
              {botao('a', 'Metade de cima', `Tira o quadro limpo de ${cena.a.nome} em ${formatarTempo(cena.a.t, 1)}`)}
              {botao('b', 'Metade de baixo', `Tira o quadro limpo de ${cena.b.nome} em ${formatarTempo(cena.b.t, 1)}`)}
            </>
          ) : (
            botao('a', 'Usar este quadro', cena ? `Tira o quadro limpo de ${cena.a.nome} em ${formatarTempo(cena.a.t, 1)}` : '')
          )}
        </div>
        <p className="text-[11px] leading-snug text-ink-3" data-thumb="cena-no-instante">
          {cena
            ? `Sai limpo, sem legenda: ${cena.b ? 'o grid tem duas cenas, escolha a metade' : `da cena ${cena.a.nome.replace(/\.[^.]+$/, '')} em ${formatarTempo(cena.a.t, 1)}`}.`
            : 'Esse instante nao tem cena no plano do projeto.'}
        </p>
      </div>
    </div>
  )
}

/** Uma linha do texto: o campo e as cores (as prontas e uma a mao). */
function LinhaDeTexto({ linha }: { linha: 0 | 1 }) {
  const thumb = useThumb((s) => s.thumb)
  if (!thumb) return null
  const cor = thumb.cores[linha]
  const mudarCor = (c: string): void => {
    const cores = [...thumb.cores] as ThumbDoProjeto['cores']
    cores[linha] = c.toLowerCase()
    useThumb.getState().mudar({ cores })
  }
  return (
    <div className="flex flex-col gap-1.5" data-thumb={`linha-${linha + 1}`}>
      <div className="flex items-center gap-2">
        <span className="w-[68px] shrink-0 text-[11px] text-ink-3">Linha {linha + 1}</span>
        <input
          value={thumb.linhas[linha]}
          maxLength={40}
          onChange={(e) => {
            const linhas = [...thumb.linhas] as ThumbDoProjeto['linhas']
            linhas[linha] = e.target.value
            useThumb.getState().mudar({ linhas })
          }}
          placeholder={linha === 0 ? 'PODER' : 'SUPREMO'}
          aria-label={`Linha ${linha + 1} do texto`}
          style={{ textTransform: 'uppercase' }}
          className={`${CLASSE_DO_CAMPO} ${CAMPO_NORMAL} flex-1 font-semibold tracking-wide`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-[76px]">
        {CORES_DA_THUMB.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => mudarCor(c.cor)}
            title={c.nome}
            aria-label={`Cor ${c.nome} na linha ${linha + 1}`}
            aria-pressed={cor === c.cor}
            style={{ backgroundColor: c.cor }}
            className={[
              'size-5 shrink-0 rounded-full border border-black/60 transition-transform hover:scale-110',
              cor === c.cor ? 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--color-surface)]' : '',
            ].join(' ')}
          />
        ))}
        <label
          title="Outra cor"
          className={[
            'relative grid size-5 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full border border-line-strong',
            CORES_DA_THUMB.some((c) => c.cor === cor) ? '' : 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--color-surface)]',
          ].join(' ')}
          style={{
            background: CORES_DA_THUMB.some((c) => c.cor === cor) ? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' : cor,
          }}
        >
          <input
            type="color"
            value={cor}
            onChange={(e) => mudarCor(e.target.value)}
            aria-label={`Outra cor na linha ${linha + 1}`}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  )
}

// ================================================================ rodape

/** O rodape da parte Thumbnail: o "Salvar PNG" (e a pergunta de sobrescrever), "Abrir pasta" e "Fechar". */
export function RodapeDaThumb({ fechar }: { fechar: () => void }) {
  const salvando = useThumb((s) => s.salvando)
  const salvo = useThumb((s) => s.salvo)
  const erro = useThumb((s) => s.erroAoSalvar)
  const perguntar = useThumb((s) => s.perguntar)
  const temUpscale = useThumb((s) => s.temUpscale)
  const temImagem = useThumb((s) => Boolean(s.thumb?.imagens[0]))
  const outputPath = usePosRender((s) => s.outputPath)
  const nome = (c: string): string => c.split(/[\\/]/).pop() ?? c

  if (perguntar) {
    return (
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3" data-thumb="perguntar">
        <span className={`mr-auto flex min-w-0 items-center gap-1.5 text-[12px] ${COR_DE_AVISO}`}>
          <TriangleAlert size={13} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate" title={perguntar}>
            Ja existe {nome(perguntar)}.
          </span>
        </span>
        <Botao principal onClick={() => void useThumb.getState().salvar('substituir')} title={perguntar}>
          Substituir
        </Botao>
        <Botao onClick={() => void useThumb.getState().salvar('novo')} title="Salva com outro nome (-thumb-2.png...)">
          Salvar outra
        </Botao>
        <Botao onClick={() => useThumb.getState().esquecerPergunta()}>Cancelar</Botao>
      </footer>
    )
  }

  return (
    <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
      <span className="mr-auto min-w-0 truncate text-[11px] text-ink-3" data-thumb="estado-do-salvar" title={salvo?.caminho}>
        {erro ? (
          <span className={COR_DE_AVISO}>{erro}</span>
        ) : salvo ? (
          <span className="flex items-center gap-1.5">
            <Check size={12} strokeWidth={2} className="shrink-0 text-accent" />
            Salvo: {nome(salvo.caminho)} ({(salvo.ms / 1000).toFixed(1)} s{salvo.ampliado ? ', com upscale' : ''})
          </span>
        ) : temUpscale === false ? (
          'Sem o modelo de upscale: o PNG sai com o redimensionamento comum.'
        ) : (
          '1080x1920, ao lado do video.'
        )}
      </span>
      <Botao
        principal
        foco="thumb-salvar"
        disabled={salvando || !temImagem || !outputPath}
        onClick={() => void useThumb.getState().salvar('perguntar')}
        title={outputPath ? `Grava ${nome(outputPath).replace(/\.[^.]+$/, '')}-thumb.png na pasta do video` : undefined}
      >
        {salvando ? <Loader2 size={13} strokeWidth={1.5} className="animate-spin" /> : <Save size={13} strokeWidth={1.5} />}
        {salvando ? 'Salvando...' : 'Salvar PNG'}
      </Botao>
      <Botao
        onClick={() => {
          const alvo = salvo?.caminho ?? outputPath
          if (alvo) void window.dangai.revealFile(alvo)
        }}
        disabled={!salvo && !outputPath}
        title="Mostra no Explorer"
      >
        <FolderOpen size={13} strokeWidth={1.5} />
        Abrir pasta
      </Botao>
      <Botao onClick={fechar} title="Volta ao editor (Esc)">
        Fechar
      </Botao>
    </footer>
  )
}
