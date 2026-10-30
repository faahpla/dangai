import { create } from 'zustand'
import { recapDoProjeto } from '../../shared/projeto-do-recap'
import {
  ALTURA,
  imagensPadrao,
  LARGURA,
  recorteDaImagem,
  thumbDoProjeto,
  thumbEfetiva,
  thumbPadrao,
  type CenaDoVideo,
  type Enquadramento,
  type ImagemDaThumb,
  type MedirTexto,
  type SugestaoDaThumb,
  type ThumbDoProjeto,
} from '../../shared/thumb'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { desenharThumb, medidorDoCanvas } from '../thumb/desenho'
import { carregarFontesDaThumb } from '../thumb/fontes'
import { usePosRender } from './pos-render'

/**
 * [recap] O GERADOR DE THUMBNAIL na tela "Video pronto" (shared/thumb.ts).
 *
 * O que ele mexe (layout, textos, cores, fonte, altura do texto, seta,
 * imagens e enquadramento) fica no projeto, em `modulos.recap.thumb`
 * (gravarNoProjeto, juntando os toques seguidos num passo so): reabrir a
 * tela continua de onde parou. O que e so da tela (os bitmaps da previa, as
 * sugestoes, o slot escolhido) fica aqui.
 *
 * Primeira vez no projeto: o texto vem da 1a sugestao de thumb do roteiro
 * (quebrado em 2 linhas) e as imagens das sugestoes -- em cima a cena do
 * gancho com o rosto mais forte, embaixo a melhor das outras.
 */

/** Uma imagem carregada para a previa (o JPEG do quadro em cache, ja decodificado). */
export interface ImagemNaPrevia {
  /** arquivo|t: a imagem do projeto que este bitmap mostra. */
  chave: string
  bitmap: ImageBitmap | null
  /** URL do JPEG (blob:) para o cartao do slot. */
  url: string | null
  carregando: boolean
  procurandoRosto: boolean
  erro: string | null
}

export interface SugestaoNaTela extends Omit<SugestaoDaThumb, 'miniatura'> {
  /** blob: da miniatura. */
  url: string
  /** O instante da cena no video (s). */
  noVideo: number | null
}

export interface ResultadoDoPng {
  caminho: string
  ms: number
  ampliado: boolean
}

export interface EstadoDaThumb {
  thumb: ThumbDoProjeto | null
  previas: [ImagemNaPrevia | null, ImagemNaPrevia | null]
  slot: 0 | 1
  sugestoes: SugestaoNaTela[] | null
  carregandoSugestoes: boolean
  erroDasSugestoes: string | null
  detector: 'motor' | 'antigo' | null
  fontesProntas: boolean
  temUpscale: boolean | null
  salvando: boolean
  erroAoSalvar: string | null
  /** O PNG ja existe: o caminho, para a tela perguntar. */
  perguntar: string | null
  salvo: ResultadoDoPng | null
  /** A tela abriu a thumb deste projeto (o .dangai): outro projeto comeca de novo. */
  doProjeto: string | null
  iniciar(): Promise<void>
  /** Muda o que fica no projeto (os toques seguidos viram um passo so de Ctrl+Z). */
  mudar(parcial: Partial<ThumbDoProjeto>): void
  escolherSlot(slot: 0 | 1): void
  /**
   * "Inverter" (2 imagens): a de cima vai para baixo e a de baixo para cima,
   * cada uma REENQUADRADA sozinha na metade nova (as faixas de cima e de baixo
   * sao diferentes) e a seta volta a apontar o rosto da nova de cima.
   */
  inverter(): void
  /** Poe uma imagem no slot escolhido (sugestao, quadro do video ou arquivo). */
  porImagem(img: ImagemDaThumb, slot?: 0 | 1): Promise<void>
  usarSugestao(s: SugestaoNaTela): Promise<void>
  /** O instante `t` do video pronto, tirado LIMPO da cena de origem (sem a legenda queimada); `metade` no grid. */
  usarQuadroDoVideo(t: number, metade?: 'a' | 'b'): Promise<void>
  usarArquivo(): Promise<void>
  enquadrar(slot: 0 | 1, e: Enquadramento | null): void
  salvar(modo: 'perguntar' | 'substituir' | 'novo'): Promise<void>
  esquecerPergunta(): void
  limpar(): void
}

const chaveDa = (img: Pick<ImagemDaThumb, 'arquivo' | 't'>): string => `${img.arquivo}|${img.t.toFixed(3)}`

/** O medidor do texto num canvas solto (a fonte ja carregada). */
let canvasDeMedir: HTMLCanvasElement | null = null
export function medidor(fonte: ThumbDoProjeto['fonte']): MedirTexto {
  // Sem DOM (o teste): a conta aproximada da Luckiest Guy.
  if (typeof document === 'undefined') return (texto, px) => ({ largura: texto.length * px * 0.58, cap: px * 0.7 })
  canvasDeMedir ??= document.createElement('canvas')
  const ctx = canvasDeMedir.getContext('2d')
  if (!ctx) return (texto, px) => ({ largura: texto.length * px * 0.6, cap: px * 0.7 })
  return medidorDoCanvas(ctx, fonte)
}

/** As cenas que entraram no video (o plano do projeto), com o trecho de cada uma e quem e do gancho. */
export function cenasDoVideo(): CenaDoVideo[] {
  const e = nucleo().ler()
  const scenes = e.plan?.scenes ?? []
  const recap = recapDoProjeto(e.modulos)
  // O gancho e a 1a frase do roteiro (2 ou 3 cenas); sem as secoes, as 2 primeiras cenas.
  const frase = recap?.secoes?.[0]?.frases?.[0] ?? null
  const gancho = frase ? { de: frase.inicio, ate: frase.fim } : { de: 0, ate: scenes[1]?.end ?? scenes[0]?.end ?? 0 }
  const cenas: CenaDoVideo[] = []
  scenes.forEach((s, ordem) => {
    const dentro = Math.min(s.end, gancho.ate) - Math.max(s.start, gancho.de) > 0.05
    const dur = Math.max(0, s.end - s.start)
    const a = e.images[s.imageIndex]
    if (a)
      cenas.push({
        arquivo: a.path,
        de: s.sourceStart ?? 0,
        ate: (s.sourceStart ?? 0) + dur,
        ordem,
        gancho: dentro,
      })
    const b = s.imageIndexB !== null && s.imageIndexB !== undefined ? e.images[s.imageIndexB] : undefined
    if (b)
      cenas.push({
        arquivo: b.path,
        de: s.sourceStartB ?? 0,
        ate: (s.sourceStartB ?? 0) + dur,
        ordem,
        gancho: dentro,
      })
  })
  return cenas
}

/**
 * A cena que o video mostra no instante `t` (o plano do projeto): o arquivo
 * de ORIGEM e o ponto dentro dele (o `sourceStart` mais o quanto o bloco ja
 * andou). No grid, as duas metades. O quadro sai dali, sem a legenda que o
 * render queimou. null = fora do plano.
 */
export function cenaNoInstante(t: number): { a: { arquivo: string; t: number; nome: string }; b: { arquivo: string; t: number; nome: string } | null } | null {
  const e = nucleo().ler()
  const scenes = e.plan?.scenes ?? []
  const s = scenes.find((x) => t >= x.start && t < x.end) ?? (t >= (scenes[scenes.length - 1]?.end ?? 0) ? scenes[scenes.length - 1] : undefined)
  if (!s) return null
  const dentro = Math.max(0, Math.min(t, s.end) - s.start)
  const nome = (c: string): string => c.split(/[\\/]/).pop() ?? c
  const a = e.images[s.imageIndex]
  if (!a) return null
  const b = s.imageIndexB !== null && s.imageIndexB !== undefined ? e.images[s.imageIndexB] : undefined
  return {
    a: { arquivo: a.path, t: (s.sourceStart ?? 0) + dentro, nome: nome(a.path) },
    b: b ? { arquivo: b.path, t: (s.sourceStartB ?? 0) + dentro, nome: nome(b.path) } : null,
  }
}

function inicioDaCena(ordem: number): number | null {
  return nucleo().ler().plan?.scenes[ordem]?.start ?? null
}

function urlDe(bytes: Uint8Array, tipo: string): string {
  return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: tipo }))
}

function soltar(p: ImagemNaPrevia | null): void {
  if (p?.url) URL.revokeObjectURL(p.url)
  p?.bitmap?.close()
}

let gravarDepois: ReturnType<typeof setTimeout> | null = null
/** Os toques de um arrastar (ou de digitar) dentro disto viram um passo so. */
const JUNTAR_MS = 450

function gravarAgora(): void {
  if (gravarDepois) clearTimeout(gravarDepois)
  gravarDepois = null
  const thumb = useThumb.getState().thumb
  if (!thumb) return
  const n = nucleo()
  const cru = n.ler().modulos?.recap
  if (!cru || typeof cru !== 'object') return
  if (JSON.stringify((cru as Record<string, unknown>)['thumb']) === JSON.stringify(thumb)) return
  n.gravarNoProjeto({ ...(cru as Record<string, unknown>), thumb })
}

function gravarLogo(): void {
  if (gravarDepois) clearTimeout(gravarDepois)
  gravarDepois = setTimeout(gravarAgora, JUNTAR_MS)
}

/** A ultima vez que cada slot pediu imagem: a resposta velha nao cai por cima da nova. */
const pedidoDoSlot: [number, number] = [0, 0]

export const useThumb = create<EstadoDaThumb>((set, get) => {
  /** Carrega o bitmap da imagem do slot (e procura o rosto, se ainda nao procurou). */
  async function carregarSlot(slot: 0 | 1, img: ImagemDaThumb | null): Promise<void> {
    const meu = ++pedidoDoSlot[slot]
    const velho = get().previas[slot]
    if (!img) {
      soltar(velho)
      const previas = [...get().previas] as EstadoDaThumb['previas']
      previas[slot] = null
      set({ previas })
      return
    }
    const chave = chaveDa(img)
    if (velho?.chave === chave && (velho.bitmap || velho.carregando)) return
    soltar(velho)
    const marcar = (p: Partial<ImagemNaPrevia>): void => {
      if (meu !== pedidoDoSlot[slot]) return
      const previas = [...get().previas] as EstadoDaThumb['previas']
      previas[slot] = {
        chave,
        bitmap: null,
        url: null,
        carregando: false,
        procurandoRosto: false,
        erro: null,
        ...previas[slot],
        ...p,
        ...(previas[slot]?.chave === chave ? {} : { chave }),
      }
      set({ previas })
    }
    marcar({
      bitmap: null,
      url: null,
      carregando: true,
      erro: null,
      procurandoRosto: false,
    })
    const r = await ponte.quadroDaThumb({ arquivo: img.arquivo, t: img.t }).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }))
    if (meu !== pedidoDoSlot[slot]) return
    if (!r.ok) {
      marcar({ carregando: false, erro: r.error })
      return
    }
    const url = urlDe(r.value.previa, 'image/jpeg')
    let bitmap: ImageBitmap | null = null
    try {
      bitmap = await createImageBitmap(
        new Blob([r.value.previa as Uint8Array<ArrayBuffer>], {
          type: 'image/jpeg',
        }),
      )
    } catch {
      bitmap = null
    }
    if (meu !== pedidoDoSlot[slot]) {
      URL.revokeObjectURL(url)
      bitmap?.close()
      return
    }
    marcar({
      bitmap,
      url,
      carregando: false,
      erro: bitmap ? null : 'A imagem nao abriu.',
    })
    // O tamanho de verdade do quadro (a sugestao mede o keyframe): o enquadramento e em fracao, nao muda.
    atualizarImagem(slot, chave, (atual) =>
      atual.largura === r.value.largura && atual.altura === r.value.altura ? atual : { ...atual, largura: r.value.largura, altura: r.value.altura },
    )
    if (img.rostos === null) {
      marcar({ procurandoRosto: true })
      const achado = await ponte.rostosDaThumb({ arquivo: img.arquivo, t: img.t }).catch(() => null)
      if (meu !== pedidoDoSlot[slot]) return
      marcar({ procurandoRosto: false })
      if (achado?.ok)
        atualizarImagem(slot, chave, (atual) => ({
          ...atual,
          rostos: achado.value.rostos,
        }))
    }
  }

  /** Muda a imagem do slot so se ainda for a mesma (o arquivo|t). */
  function atualizarImagem(slot: 0 | 1, chave: string, f: (img: ImagemDaThumb) => ImagemDaThumb): void {
    const thumb = get().thumb
    const atual = thumb?.imagens[slot]
    if (!thumb || !atual || chaveDa(atual) !== chave) return
    const nova = f(atual)
    if (nova === atual) return
    const imagens = [...thumb.imagens] as ThumbDoProjeto['imagens']
    imagens[slot] = nova
    set({ thumb: { ...thumb, imagens } })
    gravarLogo()
  }

  async function carregarSugestoes(): Promise<void> {
    const e = nucleo().ler()
    const recap = recapDoProjeto(e.modulos)
    set({ carregandoSugestoes: true, erroDasSugestoes: null })
    const r = await ponte
      .sugestoesDaThumb({
        episodioId: recap?.episodioId ?? null,
        rascunhoId: recap?.rascunhoId ?? null,
        cenas: cenasDoVideo(),
      })
      .catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }))
    if (!r.ok) {
      set({
        carregandoSugestoes: false,
        erroDasSugestoes: r.error,
        sugestoes: [],
      })
      return
    }
    for (const s of get().sugestoes ?? []) URL.revokeObjectURL(s.url)
    const sugestoes: SugestaoNaTela[] = r.value.sugestoes.map(({ miniatura, ...s }) => ({
      ...s,
      url: urlDe(miniatura, 'image/jpeg'),
      noVideo: inicioDaCena(s.ordem),
    }))
    set({ sugestoes, carregandoSugestoes: false, detector: r.value.detector })
    // Primeira vez: as imagens padrao (o gancho com o rosto mais forte em cima).
    const thumb = get().thumb
    if (thumb && !thumb.imagens[0] && !thumb.imagens[1] && sugestoes.length > 0) {
      const [cima, baixo] = imagensPadrao(
        sugestoes.map((s) => ({
          s,
          candidato: { ...candidatoDe(s) },
          nota: s.nota,
        })),
      )
      const imagens: ThumbDoProjeto['imagens'] = [cima ? imagemDaSugestao(cima.s) : null, baixo ? imagemDaSugestao(baixo.s) : null]
      set({ thumb: { ...thumb, imagens } })
      gravarLogo()
      void carregarSlot(0, imagens[0])
      void carregarSlot(1, imagens[1])
    }
  }

  return {
    thumb: null,
    previas: [null, null],
    slot: 0,
    sugestoes: null,
    carregandoSugestoes: false,
    erroDasSugestoes: null,
    detector: null,
    fontesProntas: false,
    temUpscale: null,
    salvando: false,
    erroAoSalvar: null,
    perguntar: null,
    salvo: null,
    doProjeto: null,

    iniciar: async () => {
      const e = nucleo().ler()
      const doProjeto = `${e.projectPath ?? ''}|${recapDoProjeto(e.modulos)?.rascunhoId ?? ''}`
      void carregarFontesDaThumb().then(() => set({ fontesProntas: true }))
      if (get().thumb && get().doProjeto === doProjeto) {
        // A mesma tela de novo: so confere as imagens (os bitmaps podem ter sido soltos).
        const t = get().thumb!
        void carregarSlot(0, t.imagens[0])
        void carregarSlot(1, t.imagens[1])
        if (!get().sugestoes) void carregarSugestoes()
        return
      }
      get().limpar()
      const cru = e.modulos?.recap
      const salva = cru && typeof cru === 'object' ? thumbDoProjeto((cru as Record<string, unknown>)['thumb']) : null
      const thumb = salva ?? thumbPadrao(usePosRender.getState().thumbs[0] ?? null)
      set({ thumb, doProjeto, slot: 0 })
      void ponte
        .upscaleDaThumb()
        .then((r) => set({ temUpscale: r.ok ? r.value : false }))
        .catch(() => set({ temUpscale: false }))
      void carregarSlot(0, thumb.imagens[0])
      void carregarSlot(1, thumb.imagens[1])
      await carregarSugestoes()
    },

    mudar: (parcial) => {
      const thumb = get().thumb
      if (!thumb) return
      const novo = { ...thumb, ...parcial }
      // Uma imagem so: o slot de baixo fica guardado, mas o escolhido volta para o de cima.
      set({
        thumb: novo,
        ...(novo.layout === 'uma' ? { slot: 0 as const } : {}),
        salvo: null,
      })
      gravarLogo()
    },

    escolherSlot: (slot) => set({ slot }),

    inverter: () => {
      const { thumb, previas, slot } = get()
      if (!thumb || thumb.layout !== 'duas') return
      // O enquadramento de um painel nao serve no outro: os dois voltam ao automatico.
      const solta = (img: ImagemDaThumb | null): ImagemDaThumb | null => (img ? { ...img, enquadramento: null } : null)
      const imagens: ThumbDoProjeto['imagens'] = [solta(thumb.imagens[1]), solta(thumb.imagens[0])]
      // Uma leitura no meio do caminho cairia no slot errado: as duas recomecam.
      pedidoDoSlot[0] += 1
      pedidoDoSlot[1] += 1
      const carregando = previas.some((p) => p?.carregando || p?.procurandoRosto)
      set({
        thumb: { ...thumb, imagens, seta: { ...thumb.seta, base: null, ponta: null } },
        previas: carregando ? [null, null] : [previas[1], previas[0]],
        slot: slot === 0 ? 1 : 0,
        salvo: null,
      })
      if (carregando) {
        soltar(previas[0])
        soltar(previas[1])
        void carregarSlot(0, imagens[0])
        void carregarSlot(1, imagens[1])
      }
      gravarLogo()
    },

    porImagem: async (img, slot = get().slot) => {
      const thumb = get().thumb
      if (!thumb) return
      const imagens = [...thumb.imagens] as ThumbDoProjeto['imagens']
      imagens[slot] = img
      set({ thumb: { ...thumb, imagens }, salvo: null })
      gravarLogo()
      await carregarSlot(slot, img)
    },

    usarSugestao: async (s) => get().porImagem(imagemDaSugestao(s)),

    usarQuadroDoVideo: async (t, metade = 'a') => {
      const cena = cenaNoInstante(t)
      const fonte = metade === 'b' ? (cena?.b ?? cena?.a) : cena?.a
      if (!fonte) return
      await get().porImagem({
        origem: 'video',
        arquivo: fonte.arquivo,
        t: fonte.t,
        largura: 1920,
        altura: 1080,
        rostos: null,
        enquadramento: null,
      })
    },

    usarArquivo: async () => {
      const pr = usePosRender.getState()
      const base = pr.projetoPath ?? pr.outputPath
      const pasta = base ? base.replace(/[\\/][^\\/]*$/, '') : null
      const r = await ponte.escolherImagemDaThumb(pasta).catch(() => null)
      if (!r?.ok || !r.value) return
      await get().porImagem({
        origem: 'arquivo',
        arquivo: r.value,
        t: 0,
        largura: 1920,
        altura: 1080,
        rostos: null,
        enquadramento: null,
      })
    },

    enquadrar: (slot, e) => {
      const thumb = get().thumb
      const img = thumb?.imagens[slot]
      if (!thumb || !img) return
      const imagens = [...thumb.imagens] as ThumbDoProjeto['imagens']
      imagens[slot] = { ...img, enquadramento: e }
      set({ thumb: { ...thumb, imagens }, salvo: null })
      gravarLogo()
    },

    salvar: async (modo) => {
      const { thumb, salvando } = get()
      const video = usePosRender.getState().outputPath
      if (!thumb || salvando || !video) return
      set({ salvando: true, erroAoSalvar: null, perguntar: null })
      const inicio = performance.now()
      try {
        await carregarFontesDaThumb()
        const png = await pngDaThumb(thumb)
        const r = await ponte.salvarThumb({ video, png: png.bytes, modo })
        if (!r.ok) throw new Error(r.error)
        if ('existe' in r.value) {
          set({ salvando: false, perguntar: r.value.existe })
          return
        }
        const salvo = {
          caminho: r.value.salvo,
          ms: Math.round(performance.now() - inicio),
          ampliado: png.ampliado,
        }
        set({ salvando: false, salvo })
        get().mudar({ salvoEm: salvo.caminho })
        set({ salvo })
        gravarAgora()
      } catch (e) {
        set({
          salvando: false,
          erroAoSalvar: e instanceof Error ? e.message : String(e),
        })
      }
    },

    esquecerPergunta: () => set({ perguntar: null }),

    limpar: () => {
      if (gravarDepois) gravarAgora()
      pedidoDoSlot[0] += 1
      pedidoDoSlot[1] += 1
      for (const p of get().previas) soltar(p)
      for (const s of get().sugestoes ?? []) URL.revokeObjectURL(s.url)
      set({
        thumb: null,
        previas: [null, null],
        sugestoes: null,
        carregandoSugestoes: false,
        erroDasSugestoes: null,
        detector: null,
        salvando: false,
        erroAoSalvar: null,
        perguntar: null,
        salvo: null,
        doProjeto: null,
      })
    },
  }
})

function candidatoDe(s: SugestaoNaTela) {
  return {
    chave: chaveDa(s),
    plano: s.arquivo,
    ordem: s.ordem,
    gancho: s.gancho,
    rostos: s.rostos,
    beleza: null,
    nitidez: null,
    expressao: false,
    noTrecho: true,
  }
}

function imagemDaSugestao(s: SugestaoNaTela): ImagemDaThumb {
  return {
    origem: 'cena',
    arquivo: s.arquivo,
    t: s.t,
    largura: s.largura,
    altura: s.altura,
    rostos: s.rostos,
    enquadramento: null,
    ...(s.gancho ? { gancho: true } : {}),
  }
}

/** Grava o que estiver pendente agora (a tela fechando). */
export function gravarThumbPendente(): void {
  if (gravarDepois) gravarAgora()
}

/**
 * O PNG FINAL 1080x1920: cada painel vem do main (a janela da fonte com o
 * upscale, reduzida ao painel exato) e o resto e o MESMO desenho da previa,
 * na escala 1 e sem guias.
 */
export async function pngDaThumb(thumb: ThumbDoProjeto): Promise<{ bytes: Uint8Array<ArrayBuffer>; ampliado: boolean }> {
  const ef = thumbEfetiva(thumb, medidor(thumb.fonte))
  let ampliado = false
  const paineis = await Promise.all(
    ef.geo.paineis.map(async (painel, i) => {
      const img = thumb.imagens[i]
      if (!img) return null
      const rec = recorteDaImagem(painel, img, ef.enquadramentos[i] ?? null)
      const altura = painel.y1 - painel.y0
      const r = await ponte.recorteDaThumb({
        arquivo: img.arquivo,
        t: img.t,
        sx: rec.sx,
        sy: rec.sy,
        sw: rec.sw,
        sh: rec.sh,
        largura: LARGURA,
        altura,
      })
      if (!r.ok) throw new Error(r.error)
      ampliado ||= r.value.ampliado
      const bitmap = await createImageBitmap(
        new Blob([r.value.png as Uint8Array<ArrayBuffer>], {
          type: 'image/png',
        }),
      )
      return {
        fonte: bitmap,
        sx: 0,
        sy: 0,
        sw: bitmap.width,
        sh: bitmap.height,
      }
    }),
  )
  const canvas = document.createElement('canvas')
  canvas.width = LARGURA
  canvas.height = ALTURA
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('O canvas nao abriu.')
  desenharThumb(ctx, {
    thumb,
    geo: ef.geo,
    paineis,
    seta: ef.seta,
    escala: 1,
    guias: null,
  })
  for (const p of paineis) (p?.fonte as ImageBitmap | undefined)?.close()
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'))
  if (!blob) throw new Error('O PNG nao saiu.')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ampliado }
}
