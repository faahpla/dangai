import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import {
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  FolderCog,
  FolderOpen,
  ImageIcon,
  ImagePlus,
  Loader2,
  LocateFixed,
  MoveUpRight,
  Palette,
  Plus,
  RotateCcw,
  Save,
  ScanFace,
  SeparatorHorizontal,
  Star,
  TriangleAlert,
  Type,
  X,
} from 'lucide-react'
import { ajusteDeCorSchema, type AjusteDeCor } from '@shared/contract'
import { camposDoModelo, mesmoJeito, modeloDe, type ModeloDaThumb } from '../../shared/pedidos'
import { Botaozinho, Deslizante, Grupo, Linha, Segmentos, SeletorDeCor as EscolherCor } from '@/modulos/kit'
import {
  ALTURA,
  ANGULO_DA_SOMBRA_PADRAO,
  aplicarEstilo,
  CONTORNO_MAXIMO,
  SOMBRA_MAXIMA,
  degradeDaLinha,
  degradeNoEstilo,
  desenhoDaSeta,
  tintaDaSeta,
  tintaDoDivisor,
  tintaEscolhida,
  ESTILO,
  ESTILOS_DO_TEXTO,
  FORMAS_DA_SETA,
  medidasDaSeta,
  pontoNaSeta,
  SETA_LIVRE_MAXIMA,
  SETA_LIVRE_MINIMA,
  setaPelasMedidas,
  COR_ORIGINAL_DO_DIVISOR,
  CORES_DA_THUMB,
  CORPO_LEGIVEL,
  CORPO_PX,
  enquadramentoPreso,
  escalaQueCobre,
  FONTES_DA_THUMB,
  INCLINACAO_MAXIMA,
  LARGURA,
  MODELOS_DE_DIVISOR,
  painelNoPonto,
  partirEmDuasLinhas,
  recorteDaImagem,
  ROTACAO_MAXIMA,
  TAMANHO_MAXIMO,
  TAMANHO_MINIMO,
  textoYPadrao,
  thumbEfetiva,
  trechoDoQuadro,
  type DivisorDaThumb,
  type GeometriaDaThumb,
  type Ponto,
  type ThumbDoProjeto,
} from '../../shared/thumb'
import { medidor, type LojaDoEditor, type SugestaoNaTela } from './loja'
import { desenharThumb, type PainelPronto } from './desenho'
import { divisorAgora, useDivisoresProntos } from './divisores'
import { useSetasProntas } from './setas'
import { filtroDaCor } from './filtro-de-cor'
import { Aviso, Botao, Caixinha, CAMPO_NORMAL, CLASSE_DO_CAMPO, COR_DE_AVISO, formatarTempo, Link } from './pecas'

/**
 * [thumb] O EDITOR DE THUMBNAIL na tela, em comum (shared/thumb.ts,
 * loja.ts): a previa 1080x1920 e os ajustes -- layout (1 ou 2 imagens), as
 * imagens (de onde vem cada uma e quem usa que diz: as sugestoes das cenas,
 * um quadro do video, um arquivo do PC), o texto (2 linhas, cores, fonte,
 * tamanho, rotacao, altura), o divisor e a inclinacao da emenda (2 imagens) e a seta. O estilo vem de um
 * dos presets das refs (04/11: Kizuni, Faah ou AJK, com o contorno, o degrade proprio, a fonte do PC e a forma
 * da seta por cima); ele so mexe no que o pedido deixou. A aba "Thumbnail" do recap e o modulo Thumbnail montam ESTAS
 * pecas, cada um com a sua loja (ProvedorDoEditor).
 *
 * Na previa: arrastar move a imagem, a rodinha amplia, as bolinhas da seta
 * arrastam as pontas. Enquanto ele ajusta (ou com "Ver area segura"), as
 * faixas proibidas do TikTok aparecem de leve, com as caixas dos rostos --
 * so na tela, nunca no PNG.
 */

const ContextoDoEditor = createContext<LojaDoEditor | null>(null)

/** A loja que as pecas abaixo usam. */
export function ProvedorDoEditor({ loja, children }: { loja: LojaDoEditor; children: ReactNode }) {
  return <ContextoDoEditor.Provider value={loja}>{children}</ContextoDoEditor.Provider>
}

function useLoja(): LojaDoEditor {
  const loja = useContext(ContextoDoEditor)
  if (!loja) throw new Error('O editor de thumbnail sem a loja (ProvedorDoEditor).')
  return loja
}

/** As guias da previa: ligadas pela caixinha ou durante um ajuste (e um instante depois). */
const useGuias = create<{ ver: boolean; ajustandoAte: number; marcar(): void }>((set) => ({
  ver: false,
  ajustandoAte: 0,
  marcar: () => set({ ajustandoAte: Date.now() + 1100 }),
}))

/** Um ajuste acabou de acontecer (por fora da previa): as guias aparecem e somem sozinhas. */
export function marcarAjuste(): void {
  useGuias.getState().marcar()
}

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
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  const fontes = useThumb((s) => s.fontesProntas)
  const doPc = useThumb((s) => s.fontesDoPcProntas)
  return useMemo(() => (thumb ? thumbEfetiva(thumb, medidor(thumb)) : null), [thumb, fontes, doPc])
}

/** As imagens que ele soltou (so os arquivos de imagem), e o slot onde caiu. */
export type AoSoltarImagens = (caminhos: string[], slot: 0 | 1) => void

const EXTENSOES = /\.(png|jpe?g|webp|bmp)$/i

/** Os caminhos de imagem de um soltar (o resto fica de fora). */
function imagensDoSoltar(ev: React.DragEvent): string[] {
  return Array.from(ev.dataTransfer.files)
    .map((f) => window.dangai.pathForFile(f))
    .filter((c) => EXTENSOES.test(c))
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
  /** (13/11) A seta livre inteira: a pega e leva, com as duas pontas juntas. */
  | { tipo: 'mover-seta'; inicio: Ponto; base: Ponto; ponta: Ponto }

/** A previa da thumb, do tamanho do player (9:16), com o arrastar, a rodinha e as guias. */
export function PreviaDaThumb({ altura, larguraMax, aoSoltar }: { altura: number; larguraMax: number; aoSoltar?: AoSoltarImagens }) {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  const previas = useThumb((s) => s.previas)
  const ef = useEfetiva()
  const ver = useGuias((s) => s.ver)
  const ajustando = useAjustando()
  // O PNG do divisor (e cada cor dele) fica pronto depois: a previa redesenha.
  const divisoresProntos = useDivisoresProntos((s) => s.versao)
  // E o PNG da seta do AJK.
  const setasProntas = useSetasProntas((s) => s.versao)
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
      divisor: divisorAgora(ef.divisor),
      escala: w / LARGURA,
      filtroDeCor: filtroDaCor(thumb.cor),
      guias: {
        zonas: guias,
        rostos: guias ? ef.rostos : [],
        pontasDaSeta: !thumb.seta.livre && (guias || emCima),
        molduraDaSeta: !!thumb.seta.livre && (guias || emCima),
      },
    })
  }, [thumb, ef, previas, largura, alto, guias, emCima, divisoresProntos, setasProntas])

  // A rodinha amplia em volta do ponteiro (listener nao passivo: o preventDefault segura a rolagem).
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const rodinha = (ev: WheelEvent): void => {
      const s = useThumb.getState()
      const t = s.thumb
      const efetiva = t ? thumbEfetiva(t, medidor(t)) : null
      if (!t || !efetiva) return
      const p = paraQuadro(el, ev)
      if (t.seta.livre && efetiva.seta && pontoNaSeta(efetiva.seta, p)) {
        ev.preventDefault()
        const m = medidasDaSeta(efetiva.seta.base, efetiva.seta.ponta)
        const tamanho = Math.max(SETA_LIVRE_MINIMA, Math.min(SETA_LIVRE_MAXIMA, m.tamanho * Math.exp(-ev.deltaY * 0.0015)))
        s.mudar({ seta: { ...t.seta, ...setaPelasMedidas(m.meio, tamanho, m.giro) } })
        useGuias.getState().marcar()
        return
      }
      const slot = painelEm(t, efetiva.geo, p)
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
  }, [useThumb])

  /** (13/11) Na seta livre, o ponto em cima dela (a forma inteira pega, nao as pontas). */
  const naSetaLivre = (p: Ponto): boolean => !!thumb?.seta.livre && !!ef?.seta && pontoNaSeta(ef.seta, p)
  const pontaPerto = (p: Ponto): 'base' | 'ponta' | null => {
    if (!ef?.seta || thumb?.seta.livre) return null
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
  const vazia = !thumb.imagens[0] && !thumb.imagens[1]
  // Soltar uma imagem na previa: cai no painel em que ela caiu.
  const soltar = aoSoltar
    ? {
        onDragOver: (ev: React.DragEvent) => {
          if (!ev.dataTransfer.types.includes('Files')) return
          ev.preventDefault()
          ev.dataTransfer.dropEffect = 'copy'
        },
        onDrop: (ev: React.DragEvent) => {
          ev.preventDefault()
          ev.stopPropagation()
          const el = canvas.current
          const caminhos = imagensDoSoltar(ev)
          if (!el || caminhos.length === 0) return
          aoSoltar(caminhos, painelEm(thumb, ef.geo, paraQuadro(el, ev)))
        },
      }
    : {}
  return (
    <div className="flex h-full shrink-0 flex-col justify-center gap-2" style={{ width: largura }}>
      <div className="relative shrink-0" style={{ width: largura, height: alto }} {...soltar}>
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
            if (naSetaLivre(p) && ef.seta) {
              arrasto.current = { tipo: 'mover-seta', inicio: p, base: ef.seta.base, ponta: ef.seta.ponta }
            } else if (qual && ef.seta) {
              arrasto.current = {
                tipo: 'seta',
                qual,
                outra: qual === 'base' ? ef.seta.ponta : ef.seta.base,
              }
            } else {
              const slot = painelEm(thumb, ef.geo, p)
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
              setCursor(naSetaLivre(p) ? 'move' : pontaPerto(p) ? 'grab' : thumb.imagens[painelEm(thumb, ef.geo, p)] ? 'move' : 'default')
              return
            }
            const s = useThumb.getState()
            const t = s.thumb
            if (!t) return
            useGuias.getState().marcar()
            if (a.tipo === 'mover-seta') {
              // O meio da seta nao sai do quadro (ela pode passar da borda, mas nunca sumir).
              const meio = { x: (a.base.x + a.ponta.x) / 2, y: (a.base.y + a.ponta.y) / 2 }
              const dx = Math.max(-meio.x, Math.min(LARGURA - meio.x, p.x - a.inicio.x))
              const dy = Math.max(-meio.y, Math.min(ALTURA - meio.y, p.y - a.inicio.y))
              s.mudar({
                seta: {
                  ...t.seta,
                  base: { x: a.base.x + dx, y: a.base.y + dy },
                  ponta: { x: a.ponta.x + dx, y: a.ponta.y + dy },
                },
              })
              return
            }
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
        {aoSoltar && vazia && !carregando && (
          <div className="pointer-events-none absolute inset-x-0 top-[70%] flex justify-center px-6" data-thumb="previa-vazia">
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-line-strong bg-black/60 px-4 py-3 text-center text-[12px] text-ink-2">
              <ImagePlus size={20} strokeWidth={1.25} className="text-accent" />
              <span>Solte uma imagem aqui, ou escolha ao lado.</span>
            </div>
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

/** O painel do ponto: com 2 imagens, de que lado da emenda (inclinada ou nao) ele caiu. */
function painelEm(t: ThumbDoProjeto, geo: GeometriaDaThumb, p: Ponto): 0 | 1 {
  return t.layout === 'duas' ? painelNoPonto(geo, p) : 0
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

/** Um jeito de escolher a imagem do slot (as abas "Sugestoes", "Quadro do video", "Do computador"). */
export interface FonteDaImagem {
  valor: string
  rotulo: string
  title: string
  conteudo: (p: { nomeDoSlot: string }) => ReactNode
}

export interface PropsDosAjustes {
  /** Os jeitos de escolher a imagem; um so = sem as abas. */
  fontes: readonly FonteDaImagem[]
  /** Textos prontos de um clique (o do roteiro, no recap). */
  textosProntos?: { rotulo: string; textos: readonly string[] } | null
  /** Embaixo do "Escolhendo a imagem..." (o aviso do motor, no modulo). */
  extraDoSlot?: ReactNode
  /** Soltar uma imagem num cartao de imagem (o modulo). */
  aoSoltar?: AoSoltarImagens
}

// ================================================================ as abas

/**
 * AS ABAS DO PAINEL (16/11): "ele tem muitos sliders mas eu tenho que ficar
 * scrollando pra ver o que e cada coisa, melhora a hierarquia visual desse
 * modulo". Era uma coluna so com tudo aberto (imagens, cor, texto, divisor e
 * seta), rolando. Agora os modelos ficam no alto e o resto em cinco abas --
 * Imagens, Texto, Cores, Divisor e Seta --, cada uma cabendo na tela sem
 * rolar, nos grupos do editor (o Grupo e a Linha do kit, os do 2.5.0: rotulo
 * na esquerda, controle na direita, a explicacao no tooltip). A aba Cores
 * junta a cor de tudo e a opcao de mudar a linha 2, o divisor e a seta juntos;
 * as abas Divisor e Seta tem a cor de cada um tambem, no mesmo controle.
 */
export type AbaDaThumb = 'imagens' | 'texto' | 'cores' | 'divisor' | 'seta'

/** A aba aberta (a mesma no modulo e na aba do recap; volta nela ao reabrir, na mesma sessao). */
export const useAbaDaThumb = create<{ aba: AbaDaThumb; ir: (aba: AbaDaThumb) => void }>((set) => ({
  aba: 'imagens',
  ir: (aba) => set({ aba }),
}))

const ABAS: readonly { id: AbaDaThumb; nome: string; Icone: typeof Type; title: string }[] = [
  { id: 'imagens', nome: 'Imagens', Icone: ImageIcon, title: 'As imagens, o enquadramento e a cor delas' },
  { id: 'texto', nome: 'Texto', Icone: Type, title: 'O texto, o estilo, a fonte, o tamanho, o contorno, a sombra e a posição' },
  { id: 'cores', nome: 'Cores', Icone: Palette, title: 'A cor das linhas, do contorno, do divisor e da seta, num lugar só' },
  { id: 'divisor', nome: 'Divisor', Icone: SeparatorHorizontal, title: 'O divisor entre as 2 imagens e a inclinação da emenda' },
  { id: 'seta', nome: 'Seta', Icone: MoveUpRight, title: 'A seta: mostrar, a forma, o jeito, o tamanho e a cor' },
]

/** A barra das abas: presa no alto da coluna enquanto ela rola. */
function AbasDaThumb() {
  const aba = useAbaDaThumb((s) => s.aba)
  const useThumb = useLoja()
  const divisorAceso = useThumb((s) => s.thumb?.layout === 'duas' && s.thumb.divisor.ligado)
  const setaAcesa = useThumb((s) => !!s.thumb?.seta.ligada)
  return (
    <div
      role="tablist"
      aria-label="Ajustes da thumbnail"
      className="sticky top-0 z-10 flex gap-0.5 rounded-md border border-line bg-elevated p-0.5 shadow-[0_8px_14px_-10px_rgba(0,0,0,0.75)]"
      data-thumb="abas"
    >
      {ABAS.map(({ id, nome, Icone, title }) => {
        const ativa = id === aba
        // O divisor e a seta desligados: a aba fica, mais apagada (o que liga mora nela).
        const apagada = (id === 'divisor' && !divisorAceso) || (id === 'seta' && !setaAcesa)
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={ativa}
            title={apagada ? `${title} (desligado)` : title}
            onClick={() => useAbaDaThumb.getState().ir(id)}
            data-thumb={`aba-botao-${id}`}
            className={[
              'flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[4px] px-2 text-[12px] font-medium transition-colors',
              ativa
                ? 'bg-accent-dim text-ink ring-1 ring-inset ring-accent'
                : apagada
                  ? 'text-ink-3/60 hover:bg-surface hover:text-ink-2'
                  : 'text-ink-3 hover:bg-surface hover:text-ink-2',
            ].join(' ')}
          >
            <Icone size={13} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">{nome}</span>
          </button>
        )
      })}
    </div>
  )
}

/** A coluna dos ajustes: os modelos, as abas e a aba aberta. */
export function AjustesDaThumb({ fontes, textosProntos, extraDoSlot, aoSoltar }: PropsDosAjustes) {
  const useThumb = useLoja()
  const temThumb = useThumb((s) => s.thumb !== null)
  const aba = useAbaDaThumb((s) => s.aba)
  // O Ctrl+V cola a imagem copiada no slot escolhido (fora dos campos de texto), em qualquer aba.
  useColarComCtrlV()
  if (!temThumb) return null
  return (
    <div className="flex min-w-0 flex-col gap-3" data-thumb="ajustes">
      <SecaoDeModelos />
      <AbasDaThumb />
      <div key={aba} className="enter flex min-w-0 flex-col gap-3" role="tabpanel" data-thumb={`aba-${aba}`}>
        {aba === 'imagens' && <AbaDasImagens fontes={fontes} extraDoSlot={extraDoSlot} aoSoltar={aoSoltar} />}
        {aba === 'texto' && <AbaDoTexto textosProntos={textosProntos} />}
        {aba === 'cores' && <AbaDasCores />}
        {aba === 'divisor' && <AbaDoDivisor />}
        {aba === 'seta' && <AbaDaSeta />}
      </div>
    </div>
  )
}

/** A aba Imagens: o layout, as duas imagens (o cartao de cada uma), o editor da escolhida e a cor delas. */
function AbaDasImagens({ fontes: jeitos, extraDoSlot, aoSoltar }: Pick<PropsDosAjustes, 'fontes' | 'extraDoSlot' | 'aoSoltar'>) {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  const slot = useThumb((s) => s.slot)
  const previas = useThumb((s) => s.previas)
  const ef = useEfetiva()
  const primeiro = jeitos[0]?.valor ?? ''
  // Cada imagem (cima e baixo) lembra de onde ele estava escolhendo.
  const [fontes, setFontes] = useState<[string, string]>([primeiro, primeiro])
  if (!thumb || !ef) return null
  const mudar = useThumb.getState().mudar
  const img = thumb.imagens[slot]
  const enq = ef.enquadramentos[slot]
  const painel = ef.geo.paineis[slot]
  const fonte = fontes[slot]
  const setFonte = (f: string): void => setFontes((atual) => (slot === 0 ? [f, atual[1]] : [atual[0], f]))
  const nomeDoSlot = thumb.layout === 'uma' ? 'a imagem' : slot === 0 ? 'a imagem de cima' : 'a imagem de baixo'
  const jeito = jeitos.find((j) => j.valor === fonte) ?? jeitos[0]

  return (
    <>
      <Grupo
        titulo="Imagens"
        acao={
          <div className="w-[200px]">
            <Segmentos
              opcoes={[
                { valor: 'uma' as const, rotulo: '1 imagem', title: 'Uma imagem cheia' },
                { valor: 'duas' as const, rotulo: '2 imagens', title: 'Duas imagens (cima e baixo), o texto na emenda' },
              ]}
              ativo={(v) => thumb.layout === v}
              onChange={(v) => mudar({ layout: v })}
            />
          </div>
        }
      >
        <div className={thumb.layout === 'uma' ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-[1fr_auto_1fr] items-center gap-2'}>
          <CartaoDoSlot slot={0} ativo={slot === 0} rotulo={thumb.layout === 'uma' ? 'Imagem' : 'Imagem de cima'} aoSoltar={aoSoltar} />
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
                className="grid size-8 place-items-center rounded-full border border-line bg-elevated text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
              >
                <ArrowUpDown size={14} strokeWidth={1.75} />
              </button>
              <CartaoDoSlot slot={1} ativo={slot === 1} rotulo="Imagem de baixo" aoSoltar={aoSoltar} />
            </>
          )}
        </div>
        <div className="flex flex-col gap-2.5 rounded-sm border border-l-2 border-line border-l-accent bg-elevated/40 p-3" data-thumb="editor-do-slot">
          <p className="text-[11px] text-ink-2">
            Escolhendo <span className="font-medium text-ink">{nomeDoSlot}</span>
            {thumb.layout === 'duas' && <span className="text-ink-3"> (clique na outra para trocar)</span>}
          </p>
          {img && enq && painel && (
            <Linha label="Zoom">
              <Deslizante
                valor={enq.zoom}
                min={1}
                max={4}
                step={0.01}
                texto={`${Math.round(enq.zoom * 100)}%`}
                padrao={1}
                dica="Amplia a imagem escolhida (arrastar na prévia move; a rodinha também amplia)"
                onChange={(z) => {
                  useThumb.getState().enquadrar(slot, enquadramentoPreso(painel, img, { zoom: z, cx: enq.cx, cy: enq.cy }))
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
                title="Volta ao enquadramento automático (rosto na área segura, fora do texto)"
              >
                <LocateFixed size={12} strokeWidth={1.5} />
                Enquadrar sozinho
              </Botao>
            </Linha>
          )}
          {img && <QuadroNaCena key={`${slot}|${img.arquivo}`} slot={slot} />}
          {previas[slot]?.erro && <Aviso>{previas[slot]?.erro}</Aviso>}
          {extraDoSlot}
          {jeitos.length > 1 && (
            <Segmentos
              opcoes={jeitos.map((j) => ({ valor: j.valor, rotulo: j.rotulo, title: j.title }))}
              ativo={(v) => fonte === v}
              onChange={setFonte}
            />
          )}
          {jeito?.conteudo({ nomeDoSlot })}
        </div>
      </Grupo>
      <CorDasImagens />
    </>
  )
}

/**
 * OS MODELOS (13/11): "quero uma opcao de salvar preset/modelo". O jeito
 * inteiro da thumb com um nome; um clique aplica em outra (o texto, as
 * imagens e a cor delas ficam). Salvar com um nome que ja existe atualiza
 * aquele. Aplicar mostra o "Desfazer" -- trocar o visual inteiro sem volta
 * seria um susto. Some na aba do recap, que nao guarda modelos.
 *
 * (16/11) A ESTRELA marca o MODELO DE ABERTURA: "quero poder definir um modelo
 * pra ir direto sempre que o modulo for aberto". A thumb nova nasce com ele
 * (store/tela.ts, padraoComPreset); um so por vez. E a secao virou uma faixa
 * so, acima das abas: o que mais se usa fica sempre a vista.
 */
function SecaoDeModelos() {
  const useThumb = useLoja()
  const fonte = useThumb((s) => s.modelos)
  const thumb = useThumb((s) => s.thumb)
  const [lista, setLista] = useState<ModeloDaThumb[]>(() => fonte?.ler() ?? [])
  const [nome, setNome] = useState<string | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [desfazer, setDesfazer] = useState<{ nome: string; antes: Partial<ThumbDoProjeto> } | null>(null)
  if (!fonte || !thumb) return null

  const gravar = async (nova: ModeloDaThumb[], texto: string): Promise<void> => {
    try {
      setLista(await fonte.gravar(nova))
      setRecado(texto)
      setDesfazer(null)
    } catch (e) {
      setRecado(`Não deu para salvar: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const mesmoNome = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()
  const salvar = (): void => {
    const n = (nome ?? '').trim()
    setNome(null)
    if (!n) return
    const existe = lista.some((m) => mesmoNome(m.nome, n))
    const nova = existe
      ? lista.map((m) => (mesmoNome(m.nome, n) ? { ...modeloDe(thumb, n), ...(m.padrao ? { padrao: true } : {}) } : m))
      : [...lista, modeloDe(thumb, n)]
    void gravar(nova, existe ? `"${n}" atualizado com a thumb de agora.` : `"${n}" salvo.`)
  }
  const aplicar = (m: ModeloDaThumb): void => {
    const { nome: _n, ...agora } = modeloDe(thumb, 'agora')
    setDesfazer({ nome: m.nome, antes: { anguloDaSombra: undefined, coresJuntas: undefined, ...agora, seta: { ...thumb.seta } } })
    useThumb.getState().mudar(camposDoModelo(m))
    setRecado(null)
  }
  const deAbertura = (m: ModeloDaThumb): void => {
    const marcar = !m.padrao
    void gravar(
      lista.map((x) => ({ ...x, padrao: x === m ? marcar : false })),
      marcar ? `A Thumbnail abre sempre com "${m.nome}".` : 'Nenhum modelo de abertura: a Thumbnail abre com a última que você fez.',
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-surface px-3 py-2.5" data-thumb="modelos">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">Modelos</span>
        {lista.map((m) => {
          const ativo = mesmoJeito(m, thumb)
          return (
            <span
              key={m.nome}
              className={[
                'group/modelo flex h-7 items-center rounded-sm border text-[12px] transition-colors',
                ativo ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:border-line-strong hover:text-ink',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => deAbertura(m)}
                aria-pressed={!!m.padrao}
                title={m.padrao ? `"${m.nome}" é o modelo de abertura (clique para desmarcar)` : `Abrir sempre com "${m.nome}"`}
                aria-label={m.padrao ? `Desmarcar ${m.nome} como modelo de abertura` : `Abrir sempre com ${m.nome}`}
                className={[
                  'grid h-full w-6 place-items-center transition-colors',
                  m.padrao ? 'text-accent' : 'text-ink-3 opacity-50 hover:text-ink hover:opacity-100 group-hover/modelo:opacity-100',
                ].join(' ')}
                data-thumb="estrela"
              >
                <Star size={12} strokeWidth={1.75} fill={m.padrao ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                onClick={() => aplicar(m)}
                title={`Aplicar "${m.nome}" nesta thumb (o texto e as imagens ficam)`}
                className="flex h-full items-center gap-1.5 pr-1.5"
              >
                <span className="flex -space-x-1">
                  {[0, 1].map((i) => (
                    <span
                      key={i}
                      className="size-3 rounded-full border border-black/60"
                      style={{ background: m.degrades[i] ? `linear-gradient(${m.degrades[i]![0]}, ${m.degrades[i]![1]})` : m.cores[i as 0 | 1] }}
                    />
                  ))}
                </span>
                {m.nome}
              </button>
              <button
                type="button"
                onClick={() => void gravar(lista.filter((x) => x !== m), `"${m.nome}" apagado.`)}
                title={`Apagar o modelo "${m.nome}"`}
                aria-label={`Apagar o modelo ${m.nome}`}
                className="grid h-full w-6 place-items-center text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover/modelo:opacity-100"
              >
                <X size={11} strokeWidth={2} />
              </button>
            </span>
          )
        })}
        {nome === null ? (
          <button
            type="button"
            onClick={() => setNome('')}
            title="Guarda o jeito desta thumb (estilo, cores, fonte, contorno, sombra, tamanho, divisor e seta) com um nome"
            className="flex h-7 items-center gap-1 rounded-sm border border-dashed border-line-strong px-2 text-[11px] text-ink-3 transition-colors hover:border-accent hover:text-ink"
          >
            <Plus size={12} strokeWidth={1.75} />
            {lista.length === 0 ? 'Salvar esta thumb como modelo' : 'Salvar modelo'}
          </button>
        ) : (
          <span className="flex min-w-[260px] flex-1 items-center gap-1.5">
            <input
              autoFocus
              value={nome}
              maxLength={40}
              placeholder="Nome do modelo (Enter salva)"
              aria-label="Nome do modelo"
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') salvar()
                else if (e.key === 'Escape') setNome(null)
              }}
              className={`${CLASSE_DO_CAMPO} h-7 min-w-0 flex-1 px-2 text-[12px]`}
            />
            <Botao pequeno onClick={salvar} disabled={!nome.trim()}>
              Salvar
            </Botao>
            <Botao pequeno onClick={() => setNome(null)}>
              Cancelar
            </Botao>
          </span>
        )}
      </div>
      {(desfazer || recado) && (
        <p className="flex items-center gap-2 text-[11px] text-ink-3">
          {desfazer ? <span>"{desfazer.nome}" aplicado.</span> : <span>{recado}</span>}
          {desfazer && (
            <Link
              onClick={() => {
                useThumb.getState().mudar(desfazer.antes)
                setDesfazer(null)
              }}
              title="Volta a thumb como estava antes de aplicar o modelo"
            >
              Desfazer
            </Link>
          )}
        </p>
      )}
      {lista.length > 0 && !lista.some((m) => m.padrao) && !desfazer && !recado && (
        <p className="flex items-center gap-1 text-[11px] text-ink-3">
          A <Star size={10} strokeWidth={1.75} className="inline" /> marca o modelo que a Thumbnail já abre aplicado.
        </p>
      )}
    </div>
  )
}

/**
 * A SETA: ligada ou nao, a forma, o JEITO -- apontando o rosto (a automatica,
 * ou as duas bolinhas das pontas) ou LIVRE (13/11): "quero uma opcao dela
 * livre para eu colocar na posicao que eu quiser, sem depender daqueles
 * pontos" -- e (16/11) a COR, no mesmo controle do texto e do divisor. Na
 * livre a seta e um objeto: arrasta na previa, a rodinha em cima dela muda o
 * tamanho, e o tamanho, o giro e o espelho ficam aqui tambem.
 */
function AbaDaSeta() {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  const ef = useEfetiva()
  if (!thumb) return null
  const mudar = useThumb.getState().mudar
  const seta = thumb.seta
  const livre = !!seta.livre
  const irParaLivre = (): void => {
    // Comeca exatamente onde a seta esta agora (a automatica ou a das bolinhas).
    const agora = ef?.seta ?? { ...setaPelasMedidas({ x: LARGURA / 2, y: ALTURA * 0.4 }, 420, -35), lado: 1 as const }
    mudar({ seta: { ...seta, livre: true, base: agora.base, ponta: agora.ponta, espelhada: agora.lado === -1 } })
  }
  return (
    <Grupo
      titulo="Seta"
      acao={
        <Caixinha ligada={seta.ligada} onChange={(v) => mudar({ seta: { ...seta, ligada: v } })}>
          Mostrar a seta
        </Caixinha>
      }
    >
      {!seta.ligada ? (
        <p className="text-[11px] text-ink-3" data-thumb="sem-seta">
          Sem seta. Ligue em "Mostrar a seta": ela aponta o rosto da imagem de cima sozinha.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5" data-thumb="secao-da-seta">
          <Linha label="Forma">
            <Segmentos
              opcoes={FORMAS_DA_SETA.map((f) => ({
                valor: f.id,
                rotulo: f.nome,
                title: f.id === 'vermelha' ? 'A seta vermelha (Kizuni)' : f.id === 'roxa' ? 'A seta roxa do Faah' : 'A seta de pincel do AJK',
              }))}
              ativo={(v) => seta.forma === v}
              onChange={(v) => mudar({ seta: { ...seta, forma: v } })}
            />
          </Linha>
          <Linha label="Posição">
            <Segmentos
              opcoes={[
                { valor: false, rotulo: 'Apontando o rosto', title: 'A seta acha o rosto sozinha; as bolinhas das pontas ajustam' },
                { valor: true, rotulo: 'Livre', title: 'Você põe a seta onde quiser: arraste na prévia, gire e mude o tamanho' },
              ]}
              ativo={(v) => v === livre}
              onChange={(v) => {
                if (v) irParaLivre()
                else mudar({ seta: { ...seta, livre: false, espelhada: false, base: null, ponta: null } })
              }}
            />
          </Linha>
          {livre && seta.base && seta.ponta && <ControlesDaSetaLivre />}
          <CorDaSeta rotulo="Cor" />
          <p className="flex flex-wrap items-center gap-x-2 pl-[76px] text-[11px] text-ink-3">
            {livre
              ? 'Arraste a seta na prévia para mudar de lugar. A rodinha em cima dela muda o tamanho.'
              : 'Arraste as bolinhas da prévia para mudar as pontas.'}
            {!livre && (seta.base || seta.ponta) && (
              <Link onClick={() => mudar({ seta: { ...seta, ligada: true, base: null, ponta: null } })} title="A seta volta a apontar o rosto sozinha">
                Apontar o rosto de novo
              </Link>
            )}
          </p>
        </div>
      )}
    </Grupo>
  )
}

/** O tamanho, o giro e o espelho da seta livre (o meio fica onde esta). */
function ControlesDaSetaLivre() {
  const useThumb = useLoja()
  const seta = useThumb((s) => s.thumb?.seta)
  if (!seta?.base || !seta.ponta) return null
  const m = medidasDaSeta(seta.base, seta.ponta)
  const mudarMedidas = (tamanho: number, giro: number): void => {
    useThumb.getState().mudar({ seta: { ...seta, ...setaPelasMedidas(m.meio, tamanho, giro) } })
    useGuias.getState().marcar()
  }
  return (
    <div className="flex flex-col gap-2.5" data-thumb="seta-livre">
      <Linha label="Tamanho">
        <Deslizante
          valor={m.tamanho}
          min={SETA_LIVRE_MINIMA}
          max={SETA_LIVRE_MAXIMA}
          step={1}
          texto={`${Math.round(m.tamanho)} px`}
          textoLargo
          dica="O tamanho da seta (de uma ponta a outra, no quadro de 1080)"
          onChange={(v) => mudarMedidas(v, m.giro)}
        />
      </Linha>
      <Linha label="Giro">
        <Deslizante
          valor={m.giro}
          min={-180}
          max={180}
          step={1}
          texto={`${Math.round(m.giro)}°`}
          textoLargo
          padrao={0}
          dica="Para onde a seta aponta: 0° = para a direita, -90° = para cima, 90° = para baixo"
          onChange={(v) => mudarMedidas(m.tamanho, v)}
        />
        <Botaozinho
          active={!!seta.espelhada}
          onClick={() => {
            useThumb.getState().mudar({ seta: { ...seta, espelhada: !seta.espelhada } })
            useGuias.getState().marcar()
          }}
          title="Espelha a seta: a curva estufa para o outro lado"
        >
          Espelhar
        </Botaozinho>
      </Linha>
    </div>
  )
}

function CartaoDoSlot({ slot, ativo, rotulo, aoSoltar }: { slot: 0 | 1; ativo: boolean; rotulo: string; aoSoltar?: AoSoltarImagens }) {
  const useThumb = useLoja()
  const img = useThumb((s) => s.thumb?.imagens[slot] ?? null)
  const previa = useThumb((s) => s.previas[slot])
  const detector = useThumb((s) => s.detector)
  const [sobre, setSobre] = useState(false)
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
  const soltar = aoSoltar
    ? {
        onDragOver: (ev: React.DragEvent) => {
          if (!ev.dataTransfer.types.includes('Files')) return
          ev.preventDefault()
          ev.dataTransfer.dropEffect = 'copy'
          setSobre(true)
        },
        onDragLeave: () => setSobre(false),
        onDrop: (ev: React.DragEvent) => {
          ev.preventDefault()
          ev.stopPropagation()
          setSobre(false)
          const caminhos = imagensDoSoltar(ev)
          if (caminhos.length > 0) aoSoltar(caminhos, slot)
        },
      }
    : {}
  return (
    <button
      type="button"
      onClick={() => useThumb.getState().escolherSlot(slot)}
      aria-pressed={ativo}
      data-thumb={`slot-${slot}`}
      title={aoSoltar ? 'As escolhas abaixo vao para esta imagem (ou solte uma imagem aqui)' : 'As escolhas abaixo vao para esta imagem'}
      className={[
        'flex min-w-0 items-center gap-2.5 rounded-sm border p-1.5 text-left transition-colors',
        ativo || sobre ? 'border-accent bg-accent-dim' : 'border-line bg-elevated hover:border-line-strong',
      ].join(' ')}
      {...soltar}
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

/** Quadros por segundo quando o video nao disse (o anime e 23,976). */
const FPS_PADRAO = 24

/**
 * "QUADRO DENTRO DA CENA" (pedido do Levi, 30/10): a imagem veio de uma cena
 * (sugestao ou quadro do video): a barrinha anda SO no trecho daquele clipe na
 * fonte, com as setas de 1 quadro. Arrastando, a previa troca na hora pela
 * miniatura rapida; ao soltar (ou um instante depois da seta), o quadro cheio
 * e limpo da fonte, o rosto de novo e o enquadramento automatico refeito --
 * o que ele ajustou a mao fica.
 */
function QuadroNaCena({ slot }: { slot: 0 | 1 }) {
  const useThumb = useLoja()
  const img = useThumb((s) => s.thumb?.imagens[slot] ?? null)
  const previa = useThumb((s) => s.previas[slot])
  const [arrastando, setArrastando] = useState<number | null>(null)
  const apertado = useRef(false)
  const depois = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Confirmado (o instante da imagem chegou nele): a barra volta a seguir a imagem.
  useEffect(() => {
    if (arrastando !== null && img && Math.abs(img.t - arrastando) < 1e-6) setArrastando(null)
  }, [img?.t])
  useEffect(() => () => void (depois.current && clearTimeout(depois.current)), [])
  const trecho = img ? trechoDoQuadro(img) : null
  if (!img || !trecho) return null
  const fps = previa?.fps ?? FPS_PADRAO
  const passo = 1 / fps
  const valor = arrastando ?? previa?.espiando ?? img.t
  const confirmar = (t: number): void => {
    if (depois.current) clearTimeout(depois.current)
    depois.current = null
    if (Math.abs(t - img.t) < 1e-6) {
      setArrastando(null)
      return
    }
    void useThumb.getState().mudarInstante(slot, t)
  }
  const ir = (t: number, jaConfirma: boolean): void => {
    const preso = Math.max(trecho.de, Math.min(trecho.ate, t))
    setArrastando(preso)
    useThumb.getState().espiarInstante(slot, preso)
    if (depois.current) clearTimeout(depois.current)
    if (jaConfirma) depois.current = setTimeout(() => confirmar(preso), 320)
  }
  const quadro = Math.round((valor - trecho.de) * fps) + 1
  const total = Math.max(1, Math.round((trecho.ate - trecho.de) * fps))
  return (
    <div className="flex flex-col gap-1.5" data-thumb="quadro-na-cena">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-ink-2">Quadro dentro da cena</span>
        <span className="flex-1" />
        {previa?.carregando && <Loader2 size={11} strokeWidth={1.5} className="animate-spin text-ink-3" />}
        <span className="tnum text-[11px] text-ink-3" title={`${formatarTempo(valor, 2)} no arquivo (a cena vai de ${formatarTempo(trecho.de, 1)} a ${formatarTempo(trecho.ate, 1)})`}>
          quadro {Math.min(quadro, total)} de {total}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => ir(valor - passo, true)}
          disabled={valor <= trecho.de + 1e-6}
          aria-label="Um quadro antes"
          title="Um quadro antes"
          className="grid size-6 shrink-0 place-items-center rounded-sm border border-line bg-elevated text-ink-2 transition-colors hover:text-ink disabled:opacity-40"
        >
          <ChevronLeft size={13} strokeWidth={1.75} />
        </button>
        <input
          type="range"
          min={trecho.de}
          max={trecho.ate}
          step={passo}
          value={Math.max(trecho.de, Math.min(trecho.ate, valor))}
          onPointerDown={() => (apertado.current = true)}
          onPointerUp={(e) => {
            apertado.current = false
            confirmar(Number(e.currentTarget.value))
          }}
          onChange={(e) => ir(Number(e.target.value), !apertado.current)}
          aria-label="Quadro dentro da cena"
          title="Arraste para escolher outro quadro desta cena (sai limpo, sem legenda); as setas andam 1 quadro"
          className="dangai-range min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={() => ir(valor + passo, true)}
          disabled={valor >= trecho.ate - 1e-6}
          aria-label="Um quadro depois"
          title="Um quadro depois"
          className="grid size-6 shrink-0 place-items-center rounded-sm border border-line bg-elevated text-ink-2 transition-colors hover:text-ink disabled:opacity-40"
        >
          <ChevronRight size={13} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

function EtiquetaDoGancho() {
  return <span className="rounded-[3px] bg-accent px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-white">Gancho</span>
}

/** A grade das sugestoes (os melhores quadros das cenas). */
export function GradeDeSugestoes({
  carregandoTexto = 'Escolhendo os melhores quadros das cenas (o detector de rosto leva alguns segundos)...',
  vazio = 'Nenhuma cena do video para sugerir. Use um quadro do video ou uma imagem do computador.',
}: {
  carregandoTexto?: string
  vazio?: string
}) {
  const useThumb = useLoja()
  const sugestoes = useThumb((s) => s.sugestoes)
  const carregando = useThumb((s) => s.carregandoSugestoes)
  const erro = useThumb((s) => s.erroDasSugestoes)
  const atual = useThumb((s) => s.thumb?.imagens[s.slot] ?? null)
  if (carregando && !sugestoes?.length) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-ink-3" data-thumb="sugestoes-carregando">
        <Loader2 size={13} strokeWidth={1.5} className="animate-spin text-accent" />
        {carregandoTexto}
      </p>
    )
  }
  if (erro) return <Aviso>{erro}</Aviso>
  if (!sugestoes || sugestoes.length === 0) return <p className="text-[12px] text-ink-3">{vazio}</p>
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="grid grid-cols-4 gap-2" data-thumb="sugestoes">
        {sugestoes.map((s) => (
          <li key={`${s.arquivo}|${s.t}`}>
            <CartaoDaSugestao s={s} escolhida={atual?.arquivo === s.arquivo && Math.abs(atual.t - s.t) < 0.01} />
          </li>
        ))}
      </ul>
      <AvisoDaSugestao />
    </div>
  )
}

/**
 * (23/11, Levi) "Quadro do video"/"Quadro do projeto": COPIAR e SALVAR o quadro
 * LIMPO (sem legenda) do instante escolhido, como o botao direito das
 * Sugestoes. `tempo()` = o instante agora; no grid, um par por metade.
 */
export function CopiarQuadroDoInstante({ tempo, grid, ativo }: { tempo: () => number; grid: boolean; ativo: boolean }) {
  const useThumb = useLoja()
  const pode = useThumb((s) => s.podeMenuNaSugestao)
  if (!pode) return null
  return (
    <>
      <div className="flex flex-wrap items-center gap-2" data-thumb="copiar-quadro">
        {(grid ? (['a', 'b'] as const) : (['a'] as const)).map((metade) => (
          <span key={metade} className="flex items-center gap-2">
            <Botao disabled={!ativo} onClick={() => void useThumb.getState().copiarQuadroDoVideo(tempo(), metade)} title="Copia o quadro limpo (sem legenda) para o Ctrl+V em outro lugar">
              <Copy size={13} strokeWidth={1.5} />
              {grid ? `Copiar ${metade === 'a' ? 'cima' : 'baixo'}` : 'Copiar imagem'}
            </Botao>
            <Botao disabled={!ativo} onClick={() => void useThumb.getState().salvarQuadroDoVideo(tempo(), metade)} title="Salva o quadro limpo (sem legenda) como PNG">
              <Download size={13} strokeWidth={1.5} />
              {grid ? `Salvar ${metade === 'a' ? 'cima' : 'baixo'}...` : 'Salvar imagem como...'}
            </Botao>
          </span>
        ))}
      </div>
      <AvisoDaSugestao />
    </>
  )
}

export function AvisoDaSugestao() {
  const aviso = useLoja()((s) => s.avisoDaSugestao)
  return aviso ? (
    <p className="text-[11px] text-ink-3" data-thumb="aviso-da-sugestao">
      {aviso}
    </p>
  ) : null
}

/**
 * (12/11) O BOTAO DIREITO numa sugestao, pedido do Levi: "Copiar imagem" (para o
 * Ctrl+V em outro lugar) e "Salvar imagem como...", sempre do quadro CHEIO, nao
 * da miniatura. Fecha ao clicar fora, no Esc ou ao rolar.
 */
function MenuDaSugestao({ s, x, y, fechar }: { s: SugestaoNaTela; x: number; y: number; fechar: () => void }) {
  const useThumb = useLoja()
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar()
    }
    window.addEventListener('keydown', tecla)
    window.addEventListener('scroll', fechar, true)
    window.addEventListener('blur', fechar)
    return () => {
      window.removeEventListener('keydown', tecla)
      window.removeEventListener('scroll', fechar, true)
      window.removeEventListener('blur', fechar)
    }
  }, [fechar])
  const item = (texto: string, acao: () => void, dica?: string) => (
    <button
      type="button"
      onClick={() => {
        fechar()
        acao()
      }}
      className="flex w-full items-center justify-between gap-6 rounded-[3px] px-2.5 py-1.5 text-left text-[12px] text-ink-1 hover:bg-white/10"
    >
      {texto}
      {dica && <span className="text-[10px] text-ink-3">{dica}</span>}
    </button>
  )
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[90]"
        onPointerDown={fechar}
        onContextMenu={(e) => {
          e.preventDefault()
          fechar()
        }}
      />
      <div
        className="glass fixed z-[91] min-w-[200px] rounded-md p-1 shadow-lg"
        style={{ left: Math.min(x, window.innerWidth - 210), top: Math.min(y, window.innerHeight - 80) }}
        data-thumb="menu-da-sugestao"
      >
        {item('Copiar imagem', () => void useThumb.getState().copiarSugestao(s), 'para o Ctrl+V')}
        {item('Salvar imagem como...', () => void useThumb.getState().salvarSugestao(s))}
      </div>
    </>,
    document.body,
  )
}

function CartaoDaSugestao({ s, escolhida }: { s: SugestaoNaTela; escolhida: boolean }) {
  const useThumb = useLoja()
  const podeMenu = useThumb((st) => st.podeMenuNaSugestao)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const rosto = Math.max(0, ...(s.rostos ?? []).map((r) => r.w))
  return (
    <>
    {menu && <MenuDaSugestao s={s} x={menu.x} y={menu.y} fechar={() => setMenu(null)} />}
    <button
      type="button"
      onClick={() => void useThumb.getState().usarSugestao(s)}
      onContextMenu={(e) => {
        if (!podeMenu) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
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
    </>
  )
}

/** "Do computador": o botao do dialogo e uma linha dizendo para onde a imagem vai. */
export function DoComputador({ explicacao }: { explicacao: string }) {
  const useThumb = useLoja()
  const aviso = useThumb((s) => s.avisoDoColar)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <Botao onClick={() => void useThumb.getState().usarArquivo()} title="PNG, JPG, WEBP ou BMP">
          <ImagePlus size={13} strokeWidth={1.5} />
          Escolher imagem...
        </Botao>
        <Botao onClick={() => void useThumb.getState().colar()} title="A imagem copiada (print, Copiar imagem, ou um arquivo copiado no Explorer). Atalho: Ctrl+V">
          <ClipboardPaste size={13} strokeWidth={1.5} />
          Colar (Ctrl+V)
        </Botao>
        <span className="text-[11px] text-ink-3">{explicacao}</span>
      </div>
      {aviso && <span className={`text-[11px] ${COR_DE_AVISO}`}>{aviso}</span>}
    </div>
  )
}

/**
 * O CTRL+V do editor (05/11): com a tela da thumb aberta e fora de um campo de
 * texto, cola a imagem da area de transferencia no slot escolhido.
 */
export function useColarComCtrlV(): void {
  const useThumb = useLoja()
  useEffect(() => {
    const tecla = (ev: KeyboardEvent): void => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey || ev.key.toLowerCase() !== 'v') return
      const alvo = ev.target as HTMLElement | null
      if (alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return
      if (!useThumb.getState().thumb) return
      // Antes do atalho do editor (colar clipe na timeline): a tela da thumb e por cima de tudo.
      ev.preventDefault()
      ev.stopPropagation()
      void useThumb.getState().colar()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [useThumb])
}

/** O Anime vivo da Edicao rapida (o mesmo ajuste de modulos/recap/shared/edicao-rapida.ts). */
const ANIME_VIVO: AjusteDeCor = ajusteDeCorSchema.parse({ vibrance: 0.28, contraste: 0.1, realces: -0.05, nitidez: 0.1 })

/** Os controles rapidos da cor: [campo, rotulo, min, max]. As curvas e o resto vem do preset/projeto e ficam. */
const CONTROLES_DE_COR: readonly [keyof AjusteDeCor, string, number, number][] = [
  ['exposicao', 'Exposição', -1.5, 1.5],
  ['contraste', 'Contraste', -1, 1],
  ['realces', 'Realces', -1, 1],
  ['sombras', 'Sombras', -1, 1],
  ['saturacao', 'Saturação', -1, 1],
  ['vibrance', 'Vibrance', -1, 1],
  ['temperatura', 'Temperatura', -1, 1],
  ['nitidez', 'Nitidez', 0, 1],
  ['intensidade', 'Intensidade', 0, 1],
]

/**
 * A COR DAS IMAGENS (05/11): puxar a da camada de ajuste do projeto, um preset
 * de cor salvo (os mesmos do inspetor do editor) ou o Anime vivo, e mexer nos
 * controles rapidos. Vale so nas imagens, como a camada de ajuste no video.
 */
function CorDasImagens() {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  const lerDoProjeto = useThumb((s) => s.lerCorDoProjeto)
  const [presets, setPresets] = useState<{ nome: string; cor: AjusteDeCor }[]>([])
  const [aberta, setAberta] = useState(false)
  useEffect(() => {
    let vivo = true
    void window.dangai
      .getSettings()
      .then((r) => {
        if (!vivo || !r.ok) return
        const lista: { nome: string; cor: AjusteDeCor }[] = []
        for (const p of (r.value.presetsDeCor ?? []) as unknown[]) {
          const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
          const cor = ajusteDeCorSchema.safeParse(o['cor'])
          if (typeof o['nome'] === 'string' && o['nome'].trim() && cor.success) lista.push({ nome: o['nome'].trim().slice(0, 40), cor: cor.data })
        }
        setPresets(lista)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [])
  if (!thumb) return null
  const doProjeto = lerDoProjeto?.() ?? null
  const mesma = (a: AjusteDeCor | null): boolean => !!a && !!thumb.cor && JSON.stringify(a) === JSON.stringify(thumb.cor)
  const por = (cor: AjusteDeCor | null): void => useThumb.getState().mudar({ cor: cor ? ajusteDeCorSchema.parse(cor) : null })
  const opcoes: { nome: string; cor: AjusteDeCor | null; title: string }[] = [
    { nome: 'Nenhuma', cor: null, title: 'As imagens como são (só o look da thumb)' },
    ...(doProjeto ? [{ nome: 'Do projeto', cor: doProjeto, title: 'A cor da camada de ajuste do projeto (a da Edição rápida, se houver)' }] : []),
    { nome: 'Anime vivo', cor: ANIME_VIVO, title: 'O look da Edição rápida' },
    ...presets.map((p) => ({ nome: p.nome, cor: p.cor, title: `O preset de cor "${p.nome}"` })),
  ]
  const ativa = opcoes.find((o) => (o.cor === null ? thumb.cor === null : mesma(o.cor)))
  const base = thumb.cor ?? ajusteDeCorSchema.parse({})
  return (
    <Grupo
      titulo="Cor das imagens"
      acao={
        <Link onClick={() => setAberta((v) => !v)} title="Exposição, contraste, saturação... por cima do que escolheu">
          {aberta ? 'Esconder ajustes' : 'Ajustar'}
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5" data-thumb="cor-das-imagens">
        {opcoes.map((o) => (
          <Botaozinho key={o.nome} active={ativa === o} onClick={() => por(o.cor)} title={o.title}>
            {o.nome}
          </Botaozinho>
        ))}
        {thumb.cor && !ativa && <span className="text-[11px] text-ink-3">(ajustada)</span>}
        {!lerDoProjeto ? null : !doProjeto && <span className="text-[11px] text-ink-3">O projeto não tem camada de ajuste com cor.</span>}
      </div>
      {aberta && (
        <div className="flex flex-col gap-1.5" data-thumb="controles-de-cor">
          {CONTROLES_DE_COR.map(([campo, rotulo, min, max]) => {
            const valor = base[campo] as number
            const padrao = campo === 'intensidade' ? 1 : 0
            return (
              <Linha key={campo} label={rotulo}>
                <Deslizante
                  valor={valor}
                  min={min}
                  max={max}
                  step={0.01}
                  texto={campo === 'intensidade' ? `${Math.round(valor * 100)}%` : `${valor > 0 ? '+' : ''}${Math.round(valor * 100)}`}
                  padrao={padrao}
                  dica={`${rotulo} das imagens`}
                  onChange={(v) => por({ ...base, [campo]: Math.round(v * 100) / 100 })}
                />
              </Linha>
            )
          })}
        </div>
      )}
    </Grupo>
  )
}

// ================================================================ a aba Texto

/** A aba Texto: as duas linhas, o estilo e a fonte num grupo; o tamanho e a posicao ao lado do contorno e da sombra. */
function AbaDoTexto({ textosProntos }: Pick<PropsDosAjustes, 'textosProntos'>) {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  if (!thumb) return null
  const mudar = useThumb.getState().mudar
  return (
    <>
      <Grupo titulo="Texto">
        <LinhaDeTexto linha={0} />
        <LinhaDeTexto linha={1} />
        {textosProntos && textosProntos.textos.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pl-[76px]" data-thumb="do-roteiro">
            <span className="mr-1 text-[11px] text-ink-3">{textosProntos.rotulo}</span>
            {textosProntos.textos.map((t) => (
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
        <Linha label="Estilo">
          <div className="flex min-w-0 flex-1" data-thumb="estilo-do-texto">
            <Segmentos
              opcoes={ESTILOS_DO_TEXTO.map((e) => ({
                valor: e.id,
                rotulo: e.nome,
                title:
                  e.id === 'kiumaz'
                    ? 'Kiumaz: fonte Bangers, branco e amarelo com o degradê de luz, contorno fino, sombra longa, seta vermelha'
                    : e.id === 'kizuni'
                    ? 'Kizuni: fonte Luckiest Guy, branco e amarelo com o degradê de luz, contorno grosso, sombra longa, seta vermelha'
                    : e.id === 'faah'
                      ? 'Faah: branco e roxo com o degradê dele, contorno fino, sombra curta, seta roxa'
                      : 'AJK (Anipoison): branco e amarelo chapados, contorno fino, sombra curta, seta de pincel',
              }))}
              ativo={(v) => thumb.estilo === v}
              // A thumb de AGORA (nao a do render): o que ele acabou de digitar fica.
              onChange={(v) => {
                const agora = useThumb.getState().thumb
                if (agora) mudar(aplicarEstilo(agora, v))
              }}
            />
          </div>
        </Linha>
        <Linha label="Fonte">
          <Segmentos
            opcoes={FONTES_DA_THUMB.map((f) => ({
              valor: f.id,
              rotulo: <span style={{ fontFamily: `"${f.familia}", sans-serif`, fontSize: 12 }}>{f.nome}</span>,
              title: f.nome,
            }))}
            ativo={(v) => !thumb.fontePc && thumb.fonte === v}
            onChange={(v) => mudar({ fonte: v, fontePc: null })}
          />
        </Linha>
        <FonteDoPc />
      </Grupo>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] items-start gap-3">
        <Grupo titulo="Tamanho e posição">
          <TamanhoDoTexto />
          <AlturaDoTexto />
          <RotacaoDoTexto />
        </Grupo>
        <Grupo titulo="Contorno e sombra" dica="A sombra vale para as letras e para a seta, como o Drop Shadow do Photoshop. A cor do contorno fica na aba Cores.">
          <ContornoDoTexto />
          <ForcaDaSombra />
          <AnguloDaSombra />
        </Grupo>
      </div>
    </>
  )
}

/** Uma linha do texto: o campo e, ao lado, a cor dela (um clique leva para a aba Cores). */
function LinhaDeTexto({ linha }: { linha: 0 | 1 }) {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  const ef = useEfetiva()
  if (!thumb) return null
  // A linha comprida encolhe sozinha; pequena demais para ler, o aviso discreto.
  const naThumb = ef?.geo.linhas.find((l) => l.linha === linha)
  const pequena = naThumb && naThumb.px < CORPO_LEGIVEL ? Math.round(naThumb.px) : null
  return (
    <div className="flex flex-col gap-1" data-thumb={`linha-${linha + 1}`}>
      <Linha label={`Linha ${linha + 1}`}>
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
        <button
          type="button"
          onClick={() => useAbaDaThumb.getState().ir('cores')}
          title={`A cor da linha ${linha + 1} (muda na aba Cores)`}
          aria-label={`Mudar a cor da linha ${linha + 1}`}
          className="shrink-0 transition-transform hover:scale-110"
        >
          <AmostraDaTinta fundo={cssDoDegrade(degradeDaLinha(thumb, linha))} />
        </button>
      </Linha>
      {pequena !== null && (
        <p className={`flex items-center gap-1.5 pl-[76px] text-[11px] ${COR_DE_AVISO}`} data-thumb={`texto-longo-${linha + 1}`}>
          <TriangleAlert size={12} strokeWidth={1.75} className="shrink-0" />
          <span title={`A linha encolheu para caber: corpo de ${pequena} px (as refs usam ${CORPO_PX}; abaixo de ${CORPO_LEGIVEL} fica difícil de ler no celular).`}>
            Texto longo: fica pequeno ({pequena} px; o normal é {CORPO_PX}). Encurte ou passe uma palavra para a outra linha.
          </span>
        </p>
      )}
    </div>
  )
}

/**
 * A FONTE DO PC (04/11): buscar pelo nome entre as instaladas no Windows. A
 * escolhida fica no lugar da do app; o "x" volta para ela.
 */
function FonteDoPc() {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  const listar = useThumb((s) => s.listarFontesDoPc)
  const [aberta, setAberta] = useState(false)
  const [busca, setBusca] = useState('')
  const [lista, setLista] = useState<{ nome: string; arquivo: string }[] | null>(null)
  useEffect(() => {
    if (!aberta || lista || !listar) return
    let vivo = true
    void listar().then((l) => {
      if (vivo) setLista(l)
    })
    return () => {
      vivo = false
    }
  }, [aberta, lista, listar])
  if (!thumb || !listar) return null
  const termo = busca.trim().toLowerCase()
  const achadas = (lista ?? []).filter((f) => !termo || f.nome.toLowerCase().includes(termo)).slice(0, 60)
  return (
    <div className="flex flex-col gap-1.5 pl-[76px]" data-thumb="fonte-do-pc">
      <div className="flex flex-wrap items-center gap-2">
        {thumb.fontePc ? (
          <span className="flex items-center gap-1.5 rounded-sm border border-accent bg-elevated px-2 py-0.5 text-[11px] text-ink">
            Do PC: {thumb.fontePc.nome}
            <button
              type="button"
              onClick={() => useThumb.getState().mudar({ fontePc: null })}
              title="Volta para a fonte do app"
              aria-label="Tirar a fonte do PC"
              className="text-ink-3 hover:text-ink"
            >
              <X size={11} strokeWidth={2} />
            </button>
          </span>
        ) : null}
        <Link onClick={() => setAberta((v) => !v)} title="Usar uma fonte instalada no Windows">
          {aberta ? 'Fechar a busca' : 'Buscar fonte do PC'}
        </Link>
      </div>
      {aberta && (
        <div className="flex flex-col gap-1.5">
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome da fonte"
            aria-label="Buscar fonte do PC"
            className={`${CLASSE_DO_CAMPO} ${CAMPO_NORMAL} w-full max-w-[320px]`}
          />
          <div className="flex max-h-[180px] max-w-[320px] flex-col overflow-y-auto rounded-sm border border-line bg-elevated" role="listbox" aria-label="Fontes do PC">
            {lista === null && <span className="px-2 py-1.5 text-[11px] text-ink-3">Lendo as fontes do PC...</span>}
            {lista !== null && achadas.length === 0 && <span className="px-2 py-1.5 text-[11px] text-ink-3">Nenhuma fonte com esse nome.</span>}
            {achadas.map((f) => (
              <button
                key={f.arquivo}
                type="button"
                role="option"
                aria-selected={thumb.fontePc?.arquivo === f.arquivo}
                onClick={() => {
                  useThumb.getState().mudar({ fontePc: { nome: f.nome, arquivo: f.arquivo } })
                  setAberta(false)
                }}
                className={[
                  'px-2 py-1 text-left text-[12px] hover:bg-[var(--color-surface)]',
                  thumb.fontePc?.arquivo === f.arquivo ? 'text-accent' : 'text-ink-2',
                ].join(' ')}
              >
                {f.nome}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * O "voltar ao padrao" de um controle: um icone pequeno que so aparece quando o
 * valor saiu do padrao (o lugar fica reservado: nada pula ao aparecer). Era um
 * botao "Padrao" escrito ao lado de cada slider, sempre la.
 */
function Restaurar({ ativo, onClick, title }: { ativo: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!ativo}
      title={title}
      aria-label={title}
      className={[
        'grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-elevated hover:text-ink',
        ativo ? '' : 'pointer-events-none invisible',
      ].join(' ')}
    >
      <RotateCcw size={12} strokeWidth={1.75} />
    </button>
  )
}

/** "Tamanho do texto": as duas linhas juntas, em fracao do preset; a largura util continua o teto de cada uma. */
function TamanhoDoTexto() {
  const useThumb = useLoja()
  const tamanho = useThumb((s) => s.thumb?.tamanho ?? 1)
  const ef = useEfetiva()
  const noMaximo = (ef?.geo.linhas ?? []).filter((l) => l.noMaximo)
  return (
    <div className="flex flex-col gap-1" data-thumb="tamanho-do-texto">
      <Linha label="Tamanho">
        <Deslizante
          valor={tamanho}
          min={TAMANHO_MINIMO}
          max={TAMANHO_MAXIMO}
          step={0.01}
          texto={`${Math.round(tamanho * 100)}%`}
          padrao={1}
          dica="Aumenta ou diminui as duas linhas juntas (o contorno e a sombra vão junto)"
          onChange={(v) => {
            useThumb.getState().mudar({ tamanho: Math.abs(v - 1) < 0.005 ? 1 : v })
            useGuias.getState().marcar()
          }}
        />
        <Restaurar ativo={tamanho !== 1} onClick={() => useThumb.getState().mudar({ tamanho: 1 })} title="Volta ao tamanho do preset (100%)" />
      </Linha>
      {noMaximo.length > 0 && tamanho > 1 && (
        <p className="pl-[76px] text-[11px] text-ink-3" data-thumb="tamanho-no-maximo">
          Essa linha já está no máximo da largura
          {noMaximo.length === 1 ? ` (linha ${noMaximo[0]!.linha + 1})` : ' (as duas)'}: ela não cresce mais.
        </p>
      )}
    </div>
  )
}

/** O "Contorno" do texto: a grossura (0 = sem). A cor mora na aba Cores. */
function ContornoDoTexto() {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  if (!thumb) return null
  const padrao = Math.round(ESTILO[thumb.estilo].contorno)
  const { px } = thumb.contorno
  const mudar = (v: number): void => useThumb.getState().mudar({ contorno: { ...thumb.contorno, px: v } })
  return (
    <div data-thumb="contorno-do-texto">
      <Linha label="Contorno">
        <Deslizante
          valor={px}
          min={0}
          max={CONTORNO_MAXIMO}
          step={1}
          texto={px === 0 ? 'sem' : `${px} px`}
          padrao={padrao}
          dica="A grossura do contorno das letras (cresce e encolhe com o tamanho do texto); 0 = sem contorno. A cor fica na aba Cores."
          onChange={(v) => {
            mudar(Math.round(v))
            useGuias.getState().marcar()
          }}
        />
        <Restaurar ativo={px !== padrao} onClick={() => mudar(padrao)} title={`Volta ao contorno do estilo (${padrao} px)`} />
      </Linha>
    </div>
  )
}

/**
 * A "SOMBRA" DO TEXTO (13/11, o drop shadow): a distancia e o desfoque da
 * sombra do estilo juntos, em fracao dela. 0 = sem sombra, 100% = a do
 * estilo, 200% = o dobro.
 */
function ForcaDaSombra() {
  const useThumb = useLoja()
  const sombra = useThumb((s) => s.thumb?.sombra ?? 1)
  return (
    <div data-thumb="sombra-do-texto">
      <Linha label="Força">
        <Deslizante
          valor={sombra}
          min={0}
          max={SOMBRA_MAXIMA}
          step={0.05}
          texto={sombra < 0.001 ? 'sem' : `${Math.round(sombra * 100)}%`}
          padrao={1}
          dica="A sombra das letras: distância e desfoque juntos. 0 = sem sombra, 100% = a do estilo"
          onChange={(v) => {
            useThumb.getState().mudar({ sombra: Math.round(v * 100) / 100 })
            useGuias.getState().marcar()
          }}
        />
        <Restaurar ativo={sombra !== 1} onClick={() => useThumb.getState().mudar({ sombra: 1 })} title="Volta a sombra do estilo (100%)" />
      </Linha>
    </div>
  )
}

/**
 * (16/11) O ANGULO DA SOMBRA: "quero que adicione angulo da sombra tambem".
 * Como o do Photoshop -- de onde vem a luz (90 = de cima, a sombra reto para
 * baixo, o de sempre; 120 = a luz do alto a esquerda, a sombra para baixo e a
 * direita). Vale para as letras e para a seta (a luz e uma so). O mostrador
 * redondo gira arrastando, como a roda do Photoshop.
 */
function AnguloDaSombra() {
  const useThumb = useLoja()
  const angulo = useThumb((s) => s.thumb?.anguloDaSombra ?? ANGULO_DA_SOMBRA_PADRAO)
  const semSombra = useThumb((s) => (s.thumb?.sombra ?? 1) < 0.001)
  const mudar = (v: number): void => {
    const a = Math.max(-180, Math.min(180, Math.round(v)))
    useThumb.getState().mudar({ anguloDaSombra: a === ANGULO_DA_SOMBRA_PADRAO ? undefined : a })
    useGuias.getState().marcar()
  }
  return (
    <div data-thumb="angulo-da-sombra" className={semSombra ? 'opacity-50' : ''}>
      <Linha label="Ângulo" title="De onde vem a luz, como no Photoshop: 90° = a sombra reto para baixo; 120° = para baixo e à direita">
        <MostradorDoAngulo angulo={angulo} onChange={mudar} />
        <Deslizante
          valor={angulo}
          min={-180}
          max={180}
          step={1}
          texto={`${angulo}°`}
          padrao={ANGULO_DA_SOMBRA_PADRAO}
          dica="De onde vem a luz: 90° = a sombra reto para baixo"
          onChange={mudar}
        />
        <Restaurar ativo={angulo !== ANGULO_DA_SOMBRA_PADRAO} onClick={() => mudar(ANGULO_DA_SOMBRA_PADRAO)} title="Volta a sombra reto para baixo (90°)" />
      </Linha>
    </div>
  )
}

/** A rodinha do angulo: o risco aponta de onde vem a luz; arrastar gira. */
function MostradorDoAngulo({ angulo, onChange }: { angulo: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const pelo = (ev: React.PointerEvent): void => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const dx = ev.clientX - (r.left + r.width / 2)
    const dy = ev.clientY - (r.top + r.height / 2)
    if (Math.hypot(dx, dy) < 2) return
    onChange((Math.atan2(-dy, dx) * 180) / Math.PI)
  }
  const a = (angulo * Math.PI) / 180
  return (
    <span
      ref={ref}
      role="slider"
      aria-label="Ângulo da luz"
      aria-valuemin={-180}
      aria-valuemax={180}
      aria-valuenow={angulo}
      title="Arraste para girar: o risco aponta de onde vem a luz"
      onPointerDown={(ev) => {
        ev.currentTarget.setPointerCapture(ev.pointerId)
        pelo(ev)
      }}
      onPointerMove={(ev) => {
        if (ev.currentTarget.hasPointerCapture(ev.pointerId)) pelo(ev)
      }}
      className="relative size-6 shrink-0 cursor-grab touch-none rounded-full border border-line-strong bg-elevated active:cursor-grabbing"
    >
      <svg viewBox="-12 -12 24 24" className="absolute inset-0 size-full" aria-hidden="true">
        <line x1={0} y1={0} x2={Math.cos(a) * 8.5} y2={-Math.sin(a) * 8.5} stroke="var(--color-accent)" strokeWidth={2} strokeLinecap="round" />
        <circle cx={0} cy={0} r={1.8} fill="var(--color-ink-2)" />
      </svg>
    </span>
  )
}

/** A "Altura" do bloco de texto (com 2 imagens, a emenda vai junto). */
function AlturaDoTexto() {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  if (!thumb) return null
  const padraoY = textoYPadrao(thumb.layout)
  const y = thumb.textoY ?? padraoY
  return (
    <div data-thumb="altura-do-texto">
      <Linha label="Altura">
        <Deslizante
          valor={y}
          min={0.25}
          max={0.75}
          step={0.005}
          texto={`${Math.round(y * 100)}%`}
          padrao={padraoY}
          dica="Sobe ou desce o bloco de texto (com 2 imagens, a emenda vai junto)"
          onChange={(v) => {
            useThumb.getState().mudar({ textoY: Math.abs(v - padraoY) < 0.002 ? null : v })
            useGuias.getState().marcar()
          }}
        />
        <Restaurar ativo={thumb.textoY !== null} onClick={() => useThumb.getState().mudar({ textoY: null })} title="Volta à altura do layout" />
      </Linha>
    </div>
  )
}

/** "Rotacao": o bloco de texto inteiro gira em volta do meio (a sombra continua caindo no angulo dela). */
function RotacaoDoTexto() {
  const useThumb = useLoja()
  const rotacao = useThumb((s) => s.thumb?.rotacao ?? 0)
  const ef = useEfetiva()
  const encolheu = rotacao !== 0 && (ef?.geo.linhas ?? []).some((l) => l.noMaximo)
  return (
    <div className="flex flex-col gap-1" data-thumb="rotacao-do-texto">
      <Linha label="Rotação">
        <Deslizante
          valor={rotacao}
          min={-ROTACAO_MAXIMA}
          max={ROTACAO_MAXIMA}
          step={0.5}
          texto={`${rotacao > 0 ? '+' : ''}${rotacao.toLocaleString('pt-BR')}°`}
          padrao={0}
          dica="Gira o bloco de texto inteiro, em graus (negativo = sobe para a direita); o contorno gira junto e a sombra não"
          onChange={(v) => {
            useThumb.getState().mudar({ rotacao: Math.abs(v) < 0.25 ? 0 : Math.round(v * 2) / 2 })
            useGuias.getState().marcar()
          }}
        />
        <Restaurar ativo={rotacao !== 0} onClick={() => useThumb.getState().mudar({ rotacao: 0 })} title="Volta o texto reto (0°)" />
      </Linha>
      {encolheu && (
        <p className="pl-[76px] text-[11px] text-ink-3" data-thumb="rotacao-encolheu">
          Girado, o texto encolheu um pouco para não sair do quadro.
        </p>
      )}
    </div>
  )
}

// ================================================================ a aba Cores

/**
 * A ABA CORES (16/11): a cor de tudo num lugar so, cada uma no MESMO controle
 * -- as cores prontas, "Outra" e o degrade proprio (em cima e embaixo): "quero
 * que seja possivel mudar a cor da seta exatamente da mesma forma que altero o
 * texto e o divisor". E a opcao de mudar as tres juntas: "Com a cor da linha
 * 2" faz o divisor e a seta seguirem a linha 2 (a de destaque).
 */
function AbaDasCores() {
  const useThumb = useLoja()
  const juntas = useThumb((s) => !!s.thumb?.coresJuntas)
  return (
    <>
      <Grupo titulo="Texto">
        <CorDaLinha linha={0} />
        <CorDaLinha linha={1} />
        <CorDoContorno />
      </Grupo>
      <Grupo
        titulo="Divisor e seta"
        acao={
          <Caixinha
            ligada={juntas}
            onChange={(v) => useThumb.getState().mudar({ coresJuntas: v })}
            title="O divisor e a seta ficam com a cor (e o degradê) da linha 2: mudou a linha 2, mudam os três"
          >
            Com a cor da linha 2
          </Caixinha>
        }
      >
        <CorDoDivisor />
        <CorDaSeta />
      </Grupo>
    </>
  )
}

/** O CSS de um degrade (de cima para baixo), para as amostras. */
function cssDoDegrade(paradas: readonly { em: number; cor: string }[]): string {
  return `linear-gradient(to bottom, ${paradas.map((p) => `${p.cor} ${Math.round(p.em * 100)}%`).join(', ')})`
}

/** As pontas de um degrade (em cima, embaixo): onde o degrade proprio comeca. */
function pontasDe(paradas: readonly { em: number; cor: string }[]): [string, string] {
  return [paradas[0]?.cor ?? '#ffffff', paradas.at(-1)?.cor ?? '#ffffff']
}

/** A amostra do resultado: um retangulinho com o degrade de cima a baixo. */
function AmostraDaTinta({ fundo }: { fundo: string }) {
  return <span className="block h-5 w-7 shrink-0 rounded-[4px] border border-black/60" style={{ background: fundo }} />
}

const PRETO_E_BRANCO = [
  { id: 'preto', nome: 'Preto', cor: '#000000' },
  { id: 'branco', nome: 'Branco', cor: '#ffffff' },
] as const

/**
 * UMA LINHA DE COR, a mesma para as linhas do texto, o contorno, o divisor e a
 * seta: o rotulo, as bolinhas (a "Original" na frente quando tem), "Outra", o
 * botao "Degradê" e a amostra do resultado. Com o degrade ligado, embaixo, as
 * duas cores (em cima e embaixo). `seguindo` = a peca esta com a cor da linha
 * 2 (as cores juntas): so a amostra e o "Separar".
 */
function LinhaDeCor({
  rotulo,
  data,
  nota,
  selecionada,
  onEscolher,
  onde,
  prontas = CORES_DA_THUMB,
  original,
  degrade,
  previa,
  seguindo,
}: {
  rotulo: string
  data: string
  /** Um lembrete ao lado ("desligado", "só com 2 imagens"). */
  nota?: string | null
  /** A bolinha escolhida (null = nenhuma: a Original, ou o degrade proprio). */
  selecionada: string | null
  onEscolher: (cor: string) => void
  /** O fim do aria-label ("na linha 1", "no divisor"). */
  onde: string
  prontas?: readonly { id: string; nome: string; cor: string }[]
  original?: { fundo: string; ligada: boolean; escolher: () => void }
  /** O degrade proprio (ausente = esta peca nao tem: o contorno). */
  degrade?: { valor: readonly [string, string] | null; mudar: (d: [string, string] | null) => void; inicio: () => [string, string] }
  /** O resultado agora (CSS), na amostra. */
  previa?: string | null
  seguindo?: { separar: () => void } | null
}) {
  const anel = 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--color-surface)]'
  const pronta = selecionada !== null && prontas.some((c) => c.cor === selecionada)
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-thumb={data}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-[68px] shrink-0 text-[11px] text-ink-3">{rotulo}</span>
        {seguindo ? (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-ink-3">
            <span className="truncate">Com a cor da linha 2</span>
            <Link onClick={seguindo.separar} title="Esta peça volta a ter a cor dela (desliga as cores juntas)">
              Separar
            </Link>
          </span>
        ) : (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {original && (
              <button
                type="button"
                onClick={original.escolher}
                title="A cor original do desenho"
                aria-label={`Cor original ${onde}`}
                aria-pressed={original.ligada}
                className={[
                  'flex h-5 shrink-0 items-center gap-1 rounded-full border border-line-strong bg-elevated pl-0.5 pr-2 text-[10px] text-ink-2 transition-colors hover:text-ink',
                  original.ligada ? anel : '',
                ].join(' ')}
              >
                <span className="size-3.5 rounded-full border border-black/60" style={{ background: original.fundo }} />
                Original
              </button>
            )}
            {prontas.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onEscolher(c.cor)}
                title={c.nome}
                aria-label={`Cor ${c.nome} ${onde}`}
                aria-pressed={selecionada === c.cor}
                style={{ backgroundColor: c.cor }}
                className={[
                  'size-5 shrink-0 rounded-full border border-black/60 transition-transform hover:scale-110',
                  selecionada === c.cor ? anel : '',
                ].join(' ')}
              />
            ))}
            {/* "Outra cor": o seletor do Dangai (o kit), e nao a janela branca do sistema. */}
            <EscolherCor
              cor={selecionada ?? '#ffffff'}
              onChange={(c) => onEscolher(c.toLowerCase())}
              titulo={`Outra cor ${onde}`}
              className={[
                'relative grid size-5 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full border border-line-strong transition-transform hover:scale-110',
                selecionada === null || pronta ? '' : anel,
              ].join(' ')}
              style={{
                background: selecionada === null || pronta ? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' : selecionada,
              }}
            />
            {degrade && (
              <Botaozinho
                active={degrade.valor !== null}
                onClick={() => degrade.mudar(degrade.valor ? null : degrade.inicio())}
                title="Escolher as duas cores do degradê (em cima e embaixo)"
              >
                Degradê
              </Botaozinho>
            )}
          </div>
        )}
        {nota && <span className="shrink-0 text-[10px] text-ink-3">{nota}</span>}
        {previa && <AmostraDaTinta fundo={previa} />}
      </div>
      {!seguindo && degrade?.valor && (
        <div className="flex flex-wrap items-center gap-3 pl-[76px]" data-thumb={`${data}-degrade`}>
          <CorAMao rotulo="Em cima" cor={degrade.valor[0]} onChange={(c) => degrade.mudar([c, degrade.valor![1]])} onde={`em cima ${onde}`} />
          <CorAMao rotulo="Embaixo" cor={degrade.valor[1]} onChange={(c) => degrade.mudar([degrade.valor![0], c])} onde={`embaixo ${onde}`} />
        </div>
      )}
    </div>
  )
}

/** Uma bolinha de cor com o seletor do Dangai e o rotulo ao lado. */
function CorAMao({ rotulo, cor, onChange, onde }: { rotulo: string; cor: string; onChange: (cor: string) => void; onde: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
      <EscolherCor
        cor={cor}
        onChange={(c) => onChange(c.toLowerCase())}
        titulo={`Cor ${onde}`}
        className="relative size-5 shrink-0 cursor-pointer overflow-hidden rounded-full border border-black/60 transition-transform hover:scale-110"
        style={{ background: cor }}
      />
      {rotulo}
    </span>
  )
}

/** A cor de uma linha do texto: a pronta, uma a mao ou o degrade proprio (04/11, o roxo do Faah). */
function CorDaLinha({ linha }: { linha: 0 | 1 }) {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  if (!thumb) return null
  const proprio = thumb.degrades[linha]
  const paradas = degradeDaLinha(thumb, linha)
  const escolher = (c: string): void => {
    const cores = [...thumb.cores] as ThumbDoProjeto['cores']
    cores[linha] = c.toLowerCase()
    // Uma cor pronta (ou a mao) desfaz o degrade proprio desta linha.
    const degrades = [...thumb.degrades] as ThumbDoProjeto['degrades']
    degrades[linha] = null
    useThumb.getState().mudar({ cores, degrades })
  }
  const mudarDegrade = (d: [string, string] | null): void => {
    const degrades = [...thumb.degrades] as ThumbDoProjeto['degrades']
    degrades[linha] = d
    const cores = [...thumb.cores] as ThumbDoProjeto['cores']
    if (d) cores[linha] = d[0]
    useThumb.getState().mudar({ degrades, cores })
  }
  return (
    <LinhaDeCor
      rotulo={`Linha ${linha + 1}`}
      data={`cor-da-linha-${linha + 1}`}
      nota={linha === 1 && thumb.coresJuntas ? '+ divisor e seta' : null}
      selecionada={proprio ? null : thumb.cores[linha]}
      onEscolher={escolher}
      onde={`na linha ${linha + 1}`}
      degrade={{ valor: proprio, mudar: mudarDegrade, inicio: () => pontasDe(paradas) }}
      previa={cssDoDegrade(paradas)}
    />
  )
}

/** A cor do contorno das letras: preta, branca ou outra. */
function CorDoContorno() {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  if (!thumb) return null
  const cor = thumb.contorno.cor
  return (
    <LinhaDeCor
      rotulo="Contorno"
      data="cor-do-contorno"
      nota={thumb.contorno.px === 0 ? 'sem contorno' : null}
      selecionada={cor}
      prontas={PRETO_E_BRANCO}
      onEscolher={(c) => useThumb.getState().mudar({ contorno: { ...thumb.contorno, cor: c.toLowerCase() } })}
      onde="do contorno"
    />
  )
}

/** A cor do divisor (16/11: com o degrade proprio, como o texto). */
function CorDoDivisor({ rotulo = 'Divisor' }: { rotulo?: string }) {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  if (!thumb) return null
  const d = thumb.divisor
  const original = COR_ORIGINAL_DO_DIVISOR[d.modelo]
  const tinta = tintaDoDivisor(thumb)
  const mudar = (p: Partial<DivisorDaThumb>): void => {
    const agora = useThumb.getState().thumb
    if (agora) useThumb.getState().mudar({ divisor: { ...agora.divisor, ...p } })
  }
  return (
    <LinhaDeCor
      rotulo={rotulo}
      data="cor-do-divisor"
      nota={thumb.layout !== 'duas' ? 'só com 2 imagens' : !d.ligado ? 'desligado' : null}
      selecionada={d.degrade ? null : d.cor}
      onEscolher={(c) => mudar({ cor: c.toLowerCase(), degrade: null })}
      onde="no divisor"
      original={{ fundo: original, ligada: !d.cor && !d.degrade, escolher: () => mudar({ cor: null, degrade: null }) }}
      // A Linha e uma faixa lisa: so a cor (o degrade nao apareceria).
      degrade={
        d.modelo === 'linha'
          ? undefined
          : {
              valor: d.degrade ?? null,
              mudar: (g) => mudar({ degrade: g }),
              inicio: () => pontasDe(tintaEscolhida(d.cor, null, thumb.estilo)?.paradas ?? degradeNoEstilo(original, thumb.estilo)),
            }
      }
      previa={tinta ? cssDoDegrade(d.modelo === 'linha' ? [{ em: 0, cor: tinta.cor }] : tinta.paradas) : original}
      seguindo={thumb.coresJuntas ? { separar: () => useThumb.getState().mudar({ coresJuntas: false }) } : null}
    />
  )
}

/** A cor da seta (16/11), no mesmo controle do texto e do divisor. */
function CorDaSeta({ rotulo = 'Seta' }: { rotulo?: string }) {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  if (!thumb) return null
  const s = thumb.seta
  const daForma = desenhoDaSeta({ forma: s.forma }).degrade.cores
  const original = `linear-gradient(to bottom, ${daForma[0]}, ${daForma[1]})`
  const tinta = tintaDaSeta(thumb)
  const mudar = (p: Partial<ThumbDoProjeto['seta']>): void => {
    const agora = useThumb.getState().thumb
    if (agora) useThumb.getState().mudar({ seta: { ...agora.seta, ...p } })
  }
  return (
    <LinhaDeCor
      rotulo={rotulo}
      data="cor-da-seta"
      nota={!s.ligada ? 'desligada' : null}
      selecionada={s.degrade ? null : (s.cor ?? null)}
      onEscolher={(c) => mudar({ cor: c.toLowerCase(), degrade: null })}
      onde="na seta"
      original={{ fundo: original, ligada: !s.cor && !s.degrade, escolher: () => mudar({ cor: null, degrade: null }) }}
      degrade={{
        valor: s.degrade ?? null,
        mudar: (g) => mudar({ degrade: g }),
        inicio: () => pontasDe(tintaEscolhida(s.cor, null, thumb.estilo)?.paradas ?? degradeNoEstilo(daForma[0], thumb.estilo)),
      }}
      previa={tinta ? cssDoDegrade(tinta.paradas) : original}
      seguindo={thumb.coresJuntas ? { separar: () => useThumb.getState().mudar({ coresJuntas: false }) } : null}
    />
  )
}

// ================================================================ a aba Divisor

/**
 * A "Inclinacao" da emenda (2 imagens): a emenda vira uma reta inclinada pelo
 * meio dela e o divisor (ligado) gira junto. "= texto" copia a Rotacao do
 * texto (o slash da ref do Faah acompanha o texto girado).
 */
function InclinacaoDaEmenda() {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  if (!thumb) return null
  const d = thumb.divisor
  const inclinacao = d.inclinacao
  const doTexto = Math.max(-INCLINACAO_MAXIMA, Math.min(INCLINACAO_MAXIMA, thumb.rotacao))
  const mudar = (v: number): void => {
    const atual = useThumb.getState().thumb
    if (!atual) return
    useThumb.getState().mudar({ divisor: { ...atual.divisor, inclinacao: v } })
    useGuias.getState().marcar()
  }
  return (
    <div data-thumb="inclinacao-da-emenda">
      <Linha label="Inclinação">
        <Deslizante
          valor={inclinacao}
          min={-INCLINACAO_MAXIMA}
          max={INCLINACAO_MAXIMA}
          step={0.5}
          texto={`${inclinacao > 0 ? '+' : ''}${inclinacao.toLocaleString('pt-BR')}°`}
          padrao={0}
          dica={
            d.ligado
              ? 'Inclina a emenda e o divisor junto, em graus (negativo = sobe para a direita); cada imagem continua cobrindo o seu lado'
              : 'Inclina a emenda entre as imagens, em graus (negativo = sobe para a direita); cada imagem continua cobrindo o seu lado'
          }
          onChange={(v) => mudar(Math.abs(v) < 0.25 ? 0 : Math.round(v * 2) / 2)}
        />
        <Botaozinho
          disabled={inclinacao === doTexto}
          onClick={() => mudar(doTexto)}
          title={`O mesmo ângulo da Rotação do texto (${doTexto > 0 ? '+' : ''}${doTexto.toLocaleString('pt-BR')}°)`}
        >
          = texto
        </Botaozinho>
        <Restaurar ativo={inclinacao !== 0} onClick={() => mudar(0)} title="Volta a emenda reta (0°)" />
      </Linha>
    </div>
  )
}

/** A aba Divisor (so com 2 imagens): ligar, o modelo, o que cada modelo tem, a cor e a inclinacao da emenda. */
function AbaDoDivisor() {
  const useThumb = useLoja()
  const thumb = useThumb((s) => s.thumb)
  if (!thumb) return null
  const mudarThumb = useThumb.getState().mudar
  if (thumb.layout !== 'duas') {
    return (
      <Grupo titulo="Divisor">
        <p className="text-[12px] leading-relaxed text-ink-2" data-thumb="divisor-so-com-duas">
          O divisor e a inclinação ficam na emenda entre as 2 imagens. Com 1 imagem não há emenda.
        </p>
        <div>
          <Botao pequeno onClick={() => mudarThumb({ layout: 'duas' })} title="Passa a thumb para 2 imagens (cima e baixo)">
            Usar 2 imagens
          </Botao>
        </div>
      </Grupo>
    )
  }
  const d = thumb.divisor
  const mudar = (parcial: Partial<DivisorDaThumb>): void => mudarThumb({ divisor: { ...d, ...parcial } })
  return (
    <>
      <Grupo
        titulo="Divisor"
        acao={
          <Caixinha ligada={d.ligado} onChange={(v) => mudar({ ligado: v })}>
            Divisor entre as imagens
          </Caixinha>
        }
      >
        {!d.ligado ? (
          <p className="text-[11px] text-ink-3" data-thumb="divisor">
            Desligado: as duas imagens se encontram direto na emenda. Ligado, ele fica por cima das imagens e por baixo do texto e da seta.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5" data-thumb="divisor">
            <Linha label="Modelo">
              <Segmentos
                opcoes={MODELOS_DE_DIVISOR.map((m) => ({ valor: m.id, rotulo: m.nome, title: m.nome }))}
                ativo={(v) => d.modelo === v}
                onChange={(v) => mudar({ modelo: v })}
              />
            </Linha>
            {(d.modelo === 'rasgo-brilho' || d.modelo === 'rasgo-dentro') && (
              <div data-thumb="brilho-do-divisor" className="flex flex-col gap-2.5">
                <Linha label={d.modelo === 'rasgo-dentro' ? 'Brilho dentro' : 'Brilho'}>
                  <Deslizante
                    valor={d.brilho}
                    min={0}
                    max={100}
                    step={1}
                    texto={d.brilho === 0 ? (d.modelo === 'rasgo-dentro' ? 'padrão' : 'original') : `${Math.round(d.brilho)}%`}
                    padrao={0}
                    dica={
                      d.modelo === 'rasgo-dentro'
                        ? 'O brilho por dentro do rasgo: maior, ele entra mais fundo a partir das bordas.'
                        : 'O brilho em volta do rasgo: maior e mais claro, e o meio do rasgo menos escuro. 0 = o rasgo como veio.'
                    }
                    onChange={(v) => mudar({ brilho: Math.round(v) })}
                  />
                </Linha>
                {d.modelo === 'rasgo-dentro' && (
                  <Linha label="Brilho fora">
                    <Deslizante
                      valor={d.brilhoFora ?? 0}
                      min={0}
                      max={100}
                      step={1}
                      texto={(d.brilhoFora ?? 0) === 0 ? 'sem' : `${Math.round(d.brilhoFora ?? 0)}%`}
                      padrao={0}
                      dica="O brilho em volta do rasgo, na mesma cor viva: maior, o halo fica mais largo e mais forte. 0 = so o brilho de dentro."
                      onChange={(v) => mudar({ brilhoFora: Math.round(v) })}
                    />
                  </Linha>
                )}
              </div>
            )}
            {d.modelo === 'linha' && (
              <div className="pl-[76px]">
                <Caixinha ligada={d.contorno} onChange={(v) => mudar({ contorno: v })}>
                  Contorno escuro
                </Caixinha>
              </div>
            )}
            <CorDoDivisor rotulo="Cor" />
          </div>
        )}
      </Grupo>
      <Grupo titulo="Emenda" dica="A linha onde as duas imagens se encontram (com o divisor ligado, ele gira junto)">
        <InclinacaoDaEmenda />
      </Grupo>
    </>
  )
}

// ================================================================ rodape

export interface PropsDoRodape {
  fechar: () => void
  /** O que aparece quando nada aconteceu ainda ("1080x1920, ao lado do video."). */
  destino: string
  /** O title do "Salvar PNG". */
  tituloDoSalvar?: string
  /** Ha para onde salvar. */
  podeSalvar: boolean
  /** O que o "Abrir pasta" mostra antes de salvar (null = desligado ate salvar). */
  alvoDaPasta: string | null
}

/** O rodape: o "Salvar PNG" (e a pergunta de sobrescrever), "Abrir pasta" e "Fechar". */
export function RodapeDaThumb({ fechar, destino, tituloDoSalvar, podeSalvar, alvoDaPasta }: PropsDoRodape) {
  const useThumb = useLoja()
  const salvando = useThumb((s) => s.salvando)
  const salvo = useThumb((s) => s.salvo)
  const erro = useThumb((s) => s.erroAoSalvar)
  const perguntar = useThumb((s) => s.perguntar)
  const temUpscale = useThumb((s) => s.temUpscale)
  const temImagem = useThumb((s) => Boolean(s.thumb?.imagens[0]))
  const pasta = useThumb((s) => s.pastaDeSalvar)
  const nome = (c: string): string => c.split(/[\\/]/).pop() ?? c

  if (perguntar) {
    return (
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3" data-thumb="perguntar">
        <span className={`flex min-w-0 flex-1 basis-0 items-center gap-1.5 text-[12px] ${COR_DE_AVISO}`}>
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
      <span className="min-w-0 flex-1 basis-0 truncate text-[11px] text-ink-3" data-thumb="estado-do-salvar" title={salvo?.caminho}>
        {erro ? (
          <span className={`whitespace-normal ${COR_DE_AVISO}`}>{erro}</span>
        ) : salvo ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Check size={12} strokeWidth={2} className="shrink-0 text-accent" />
            <span className="truncate">
              Salvo: {nome(salvo.caminho)} ({(salvo.ms / 1000).toFixed(1)} s{salvo.ampliado ? ', com upscale' : ''})
            </span>
          </span>
        ) : temUpscale === false ? (
          'Sem o modelo de upscale: o PNG sai com o redimensionamento comum.'
        ) : pasta ? (
          <span className="flex min-w-0 items-center gap-1.5" data-thumb="pasta-das-thumbs" title={pasta}>
            <span className="truncate">Salva em {pasta}</span>
            <Link onClick={() => useThumb.getState().esquecerPastaDeSalvar()} title="Volta ao lugar de sempre">
              Padrao
            </Link>
          </span>
        ) : (
          destino
        )}
      </span>
      <Botao onClick={() => void useThumb.getState().escolherPastaDeSalvar()} title="Escolher a pasta onde as thumbs sao salvas (fica lembrada)">
        <FolderCog size={13} strokeWidth={1.5} />
        Pasta...
      </Botao>
      <Botao
        principal
        foco="thumb-salvar"
        disabled={salvando || !temImagem || !podeSalvar}
        onClick={() => void useThumb.getState().salvar('perguntar')}
        title={tituloDoSalvar}
      >
        {salvando ? <Loader2 size={13} strokeWidth={1.5} className="animate-spin" /> : <Save size={13} strokeWidth={1.5} />}
        {salvando ? 'Salvando...' : 'Salvar PNG'}
      </Botao>
      <Botao
        onClick={() => {
          const alvo = salvo?.caminho ?? pasta ?? alvoDaPasta
          if (alvo) void window.dangai.revealFile(alvo)
        }}
        disabled={!salvo && !pasta && !alvoDaPasta}
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
