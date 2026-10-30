import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { IpcResult } from '@shared/channels'
import {
  ALTURA,
  imagensPadrao,
  LARGURA,
  recorteDaImagem,
  thumbEfetiva,
  type Enquadramento,
  type ImagemDaThumb,
  type MedirTexto,
  type PedidoDeQuadro,
  type PedidoDeRecorte,
  type QuadroDaThumb,
  type RecorteDaThumb,
  type ResultadoDoSalvar,
  type RostoDaThumb,
  type SugestaoDaThumb,
  type SugestoesDaThumb,
  type ThumbDoProjeto,
} from '../../shared/thumb'
import type { CenaNoInstante } from '../../shared/plano'
import { desenharThumb, medidorDoCanvas } from './desenho'
import { prepararDivisor } from './divisores'
import { carregarFontesDaThumb } from './fontes'

/**
 * [thumb] A LOJA DO EDITOR DE THUMBNAIL, em comum: a aba do recap
 * (modulos/recap/src/store/thumb.ts) e o modulo Thumbnail (solta e de um
 * projeto) criam cada um a sua com criarLojaDoEditor, dizendo de onde vem e
 * para onde vai cada coisa (FonteDoEditor): onde a thumb fica guardada, o
 * main que tira o quadro e acha o rosto, as sugestoes, o dialogo da imagem do
 * PC e o salvar.
 *
 * O que ele mexe (layout, textos, cores, fonte, altura do texto, seta,
 * imagens e enquadramento) vai para quem guarda (`gravar`), juntando os
 * toques seguidos num passo so: reabrir a tela continua de onde parou. O que
 * e so da tela (os bitmaps da previa, as sugestoes, o slot escolhido) fica
 * aqui.
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
  /** Quadros por segundo do video (as setas do "Quadro dentro da cena"); null = imagem ou nao leu. */
  fps?: number | null
  /** O instante que a previa mostra enquanto ele arrasta na cena (a miniatura rapida); null = o da imagem. */
  espiando?: number | null
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

/** O salvar de quem usa o editor: null = ele desistiu (o dialogo de salvar). */
export type SalvarDoEditor = (png: Uint8Array<ArrayBuffer>, modo: 'perguntar' | 'substituir' | 'novo') => Promise<IpcResult<ResultadoDoSalvar | null>>

/** De onde vem e para onde vai cada coisa (o recap, o modulo solto, o modulo num projeto). */
export interface FonteDoEditor {
  /** O "documento" aberto agora: outro valor = a tela comeca de novo. */
  chave(): string
  /** A thumb guardada (null = nao tem, ou nao passa). */
  lerGuardada(): ThumbDoProjeto | null
  /** A thumb do comeco quando nao ha guardada. */
  padrao(): ThumbDoProjeto
  /** Guarda (ja juntado: no maximo um a cada ~450 ms, e na hora ao fechar). */
  gravar(thumb: ThumbDoProjeto): void
  quadro(p: PedidoDeQuadro): Promise<IpcResult<QuadroDaThumb>>
  /** Um JPEG pequeno do instante (o arrastar do "Quadro dentro da cena"); sem isto, so o quadro cheio ao soltar. */
  miniatura?(p: PedidoDeQuadro): Promise<IpcResult<Uint8Array>>
  /** Os rostos do quadro; `null` = sem detector agora (a imagem fica no meio, e procura de novo depois). */
  rostos(p: PedidoDeQuadro): Promise<IpcResult<RostoDaThumb[] | null>>
  recorte(p: PedidoDeRecorte): Promise<IpcResult<RecorteDaThumb>>
  upscale(): Promise<IpcResult<boolean>>
  /** As sugestoes; sem isto (o editor solto), nao ha. */
  sugestoes?(): Promise<IpcResult<SugestoesDaThumb>>
  /** O instante, no video, da cena de ordem `ordem` (o rotulo da sugestao). */
  inicioDaCena?(ordem: number): number | null
  /** A cena de origem no instante `t` do video (o quadro limpo). */
  cenaNoInstante?(t: number): CenaNoInstante | null
  /** O dialogo de escolher uma imagem do PC (null = desistiu). */
  escolherArquivo(): Promise<string | null>
  /** Pode salvar agora (ha para onde). */
  podeSalvar(): boolean
  salvar: SalvarDoEditor
  /** O tempo do "Salvo: (x s)" conta so o PNG (o salvar abre um dialogo, que nao entra na conta). */
  tempoSoDoPng?: boolean
}

export interface EstadoDoEditor {
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
  /** A tela abriu a thumb deste documento: outro comeca de novo. */
  doProjeto: string | null
  iniciar(): Promise<void>
  /** Muda o que fica guardado (os toques seguidos viram um passo so de Ctrl+Z). */
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
  /** O instante `t` do video, tirado LIMPO da cena de origem (sem a legenda queimada); `metade` no grid. */
  usarQuadroDoVideo(t: number, metade?: 'a' | 'b'): Promise<void>
  usarArquivo(): Promise<void>
  /** Um arquivo de imagem que ele soltou (ja no lugar certo) no slot. */
  usarCaminho(caminho: string, slot?: 0 | 1): Promise<void>
  enquadrar(slot: 0 | 1, e: Enquadramento | null): void
  /** "Quadro dentro da cena", arrastando: a previa mostra a miniatura rapida do instante (nada muda no projeto). */
  espiarInstante(slot: 0 | 1, t: number): void
  /**
   * "Quadro dentro da cena", soltou: o quadro cheio e LIMPO do instante, os
   * rostos dele de novo e, se o enquadramento era o automatico, ele se refaz
   * pelo rosto novo; o que ele ajustou a mao fica (os avisos dizem se o rosto
   * saiu da area segura). O instante fica guardado.
   */
  mudarInstante(slot: 0 | 1, t: number): Promise<void>
  /** Procura de novo o rosto de quem ficou sem (o motor acabou de ficar pronto), e as sugestoes. */
  procurarRostosDeNovo(): Promise<void>
  salvar(modo: 'perguntar' | 'substituir' | 'novo'): Promise<void>
  esquecerPergunta(): void
  /** Grava o que estiver pendente agora (a tela fechando). */
  gravarPendente(): void
  limpar(): void
}

export type LojaDoEditor = UseBoundStore<StoreApi<EstadoDoEditor>>

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

function urlDe(bytes: Uint8Array, tipo: string): string {
  return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: tipo }))
}

function soltar(p: ImagemNaPrevia | null): void {
  if (p?.url) URL.revokeObjectURL(p.url)
  p?.bitmap?.close()
}

/** Os toques de um arrastar (ou de digitar) dentro disto viram um passo so. */
const JUNTAR_MS = 450

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
    ...(s.trecho ? { trecho: s.trecho } : {}),
  }
}

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

export function criarLojaDoEditor(fonte: FonteDoEditor): LojaDoEditor {
  let gravarDepois: ReturnType<typeof setTimeout> | null = null
  /** A ultima vez que cada slot pediu imagem: a resposta velha nao cai por cima da nova. */
  const pedidoDoSlot: [number, number] = [0, 0]
  /** O arrastar na cena: um pedido de miniatura por vez por slot, e so o ultimo instante pedido. */
  const espia: [{ emVoo: boolean; proximo: number | null }, { emVoo: boolean; proximo: number | null }] = [
    { emVoo: false, proximo: null },
    { emVoo: false, proximo: null },
  ]

  const loja: LojaDoEditor = create<EstadoDoEditor>((set, get) => {
    function gravarAgora(): void {
      if (gravarDepois) clearTimeout(gravarDepois)
      gravarDepois = null
      const thumb = get().thumb
      if (!thumb) return
      fonte.gravar(thumb)
    }

    function gravarLogo(): void {
      if (gravarDepois) clearTimeout(gravarDepois)
      gravarDepois = setTimeout(gravarAgora, JUNTAR_MS)
    }

    function marcador(slot: 0 | 1, meu: number, chave: string) {
      return (p: Partial<ImagemNaPrevia>): void => {
        if (meu !== pedidoDoSlot[slot]) return
        const previas = [...get().previas] as EstadoDoEditor['previas']
        previas[slot] = {
          chave,
          bitmap: null,
          url: null,
          carregando: false,
          procurandoRosto: false,
          erro: null,
          fps: null,
          espiando: null,
          ...previas[slot],
          ...p,
          ...(previas[slot]?.chave === chave ? {} : { chave }),
        }
        set({ previas })
      }
    }

    /** Procura o rosto da imagem do slot (se a resposta ainda for dela). */
    async function procurarRosto(slot: 0 | 1, meu: number, img: ImagemDaThumb): Promise<void> {
      const chave = chaveDa(img)
      const marcar = marcador(slot, meu, chave)
      marcar({ procurandoRosto: true })
      const achado = await fonte.rostos({ arquivo: img.arquivo, t: img.t }).catch(() => null)
      if (meu !== pedidoDoSlot[slot]) return
      marcar({ procurandoRosto: false })
      if (achado?.ok && achado.value !== null) {
        const rostos = achado.value
        atualizarImagem(slot, chave, (atual) => ({
          ...atual,
          rostos,
        }))
      }
    }

    /** Carrega o bitmap da imagem do slot (e procura o rosto, se ainda nao procurou). */
    async function carregarSlot(slot: 0 | 1, img: ImagemDaThumb | null): Promise<void> {
      const meu = ++pedidoDoSlot[slot]
      const velho = get().previas[slot]
      if (!img) {
        soltar(velho)
        const previas = [...get().previas] as EstadoDoEditor['previas']
        previas[slot] = null
        set({ previas })
        return
      }
      const chave = chaveDa(img)
      if (velho?.chave === chave && (velho.bitmap || velho.carregando)) return
      soltar(velho)
      const marcar = marcador(slot, meu, chave)
      marcar({
        bitmap: null,
        url: null,
        carregando: true,
        erro: null,
        procurandoRosto: false,
      })
      const r = await fonte.quadro({ arquivo: img.arquivo, t: img.t }).catch((e: unknown) => ({
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
        fps: r.value.fps ?? null,
        espiando: null,
      })
      // O tamanho de verdade do quadro (a sugestao mede o keyframe): o enquadramento e em fracao, nao muda.
      atualizarImagem(slot, chave, (atual) =>
        atual.largura === r.value.largura && atual.altura === r.value.altura ? atual : { ...atual, largura: r.value.largura, altura: r.value.altura },
      )
      if (img.rostos === null) await procurarRosto(slot, meu, img)
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
      if (!fonte.sugestoes) {
        set({ sugestoes: [], carregandoSugestoes: false, erroDasSugestoes: null })
        return
      }
      set({ carregandoSugestoes: true, erroDasSugestoes: null })
      const r = await fonte.sugestoes().catch((err: unknown) => ({
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
        noVideo: fonte.inicioDaCena?.(s.ordem) ?? null,
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
        const doProjeto = fonte.chave()
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
        const thumb = fonte.lerGuardada() ?? fonte.padrao()
        set({ thumb, doProjeto, slot: 0 })
        void fonte
          .upscale()
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
        const cena = fonte.cenaNoInstante?.(t) ?? null
        const de = metade === 'b' ? (cena?.b ?? cena?.a) : cena?.a
        if (!de) return
        await get().porImagem({
          origem: 'video',
          arquivo: de.arquivo,
          t: de.t,
          largura: 1920,
          altura: 1080,
          rostos: null,
          enquadramento: null,
          trecho: { de: de.de, ate: de.ate },
        })
      },

      usarArquivo: async () => {
        const caminho = await fonte.escolherArquivo().catch(() => null)
        if (!caminho) return
        await get().usarCaminho(caminho)
      },

      usarCaminho: async (caminho, slot) => {
        await get().porImagem(
          {
            origem: 'arquivo',
            arquivo: caminho,
            t: 0,
            largura: 1920,
            altura: 1080,
            rostos: null,
            enquadramento: null,
          },
          slot,
        )
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

      espiarInstante: (slot, t) => {
        const e = espia[slot]
        e.proximo = t
        if (e.emVoo || !fonte.miniatura) return
        e.emVoo = true
        void (async () => {
          try {
            while (e.proximo !== null) {
              const alvo = e.proximo
              e.proximo = null
              const img = get().thumb?.imagens[slot]
              const meu = pedidoDoSlot[slot]
              if (!img) break
              const r = await fonte.miniatura!({ arquivo: img.arquivo, t: alvo }).catch(() => null)
              if (!r?.ok || meu !== pedidoDoSlot[slot]) continue
              let bitmap: ImageBitmap
              try {
                bitmap = await createImageBitmap(new Blob([r.value as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }))
              } catch {
                continue
              }
              const previas = [...get().previas] as EstadoDoEditor['previas']
              const p = previas[slot]
              if (meu !== pedidoDoSlot[slot] || !p) {
                bitmap.close()
                continue
              }
              // So o bitmap da previa troca (a miniatura); o cartao e o projeto ficam com o quadro de antes.
              p.bitmap?.close()
              previas[slot] = { ...p, bitmap, espiando: alvo }
              set({ previas })
            }
          } finally {
            e.emVoo = false
          }
        })()
      },

      mudarInstante: async (slot, t) => {
        const img = get().thumb?.imagens[slot]
        if (!img) return
        espia[slot].proximo = null
        const meu = ++pedidoDoSlot[slot]
        const marcar = marcador(slot, meu, chaveDa(img))
        marcar({ carregando: true, erro: null })
        const r = await fonte.quadro({ arquivo: img.arquivo, t }).catch((e: unknown) => ({
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }))
        if (meu !== pedidoDoSlot[slot]) return
        if (!r.ok) {
          marcar({ carregando: false, erro: r.error })
          return
        }
        let bitmap: ImageBitmap | null = null
        try {
          bitmap = await createImageBitmap(new Blob([r.value.previa as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }))
        } catch {
          bitmap = null
        }
        const thumb = get().thumb
        const atual = thumb?.imagens[slot]
        if (meu !== pedidoDoSlot[slot] || !thumb || !atual || atual.arquivo !== img.arquivo || !bitmap) {
          bitmap?.close()
          if (meu === pedidoDoSlot[slot]) marcar({ carregando: false, erro: bitmap ? null : 'A imagem nao abriu.' })
          return
        }
        // O enquadramento fica como estava: null (o automatico) se refaz pelo rosto novo; o da mao fica.
        const nova: ImagemDaThumb = { ...atual, t, rostos: null, largura: r.value.largura, altura: r.value.altura }
        const imagens = [...thumb.imagens] as ThumbDoProjeto['imagens']
        imagens[slot] = nova
        const previas = [...get().previas] as EstadoDoEditor['previas']
        soltar(previas[slot])
        previas[slot] = {
          chave: chaveDa(nova),
          bitmap,
          url: urlDe(r.value.previa, 'image/jpeg'),
          carregando: false,
          procurandoRosto: false,
          erro: null,
          fps: r.value.fps ?? null,
          espiando: null,
        }
        set({ thumb: { ...thumb, imagens }, previas, salvo: null })
        gravarLogo()
        await procurarRosto(slot, meu, nova)
      },

      procurarRostosDeNovo: async () => {
        const thumb = get().thumb
        if (!thumb) return
        await Promise.all(
          ([0, 1] as const).map(async (slot) => {
            const img = thumb.imagens[slot]
            if (!img || img.rostos !== null) return
            await procurarRosto(slot, pedidoDoSlot[slot], img)
          }),
        )
        if (get().sugestoes?.some((s) => s.rostos === null)) await carregarSugestoes()
      },

      salvar: async (modo) => {
        const { thumb, salvando } = get()
        if (!thumb || salvando || !fonte.podeSalvar()) return
        set({ salvando: true, erroAoSalvar: null, perguntar: null })
        const inicio = performance.now()
        try {
          await carregarFontesDaThumb()
          const png = await pngDaThumb(thumb, fonte.recorte)
          const doPng = performance.now() - inicio
          const r = await fonte.salvar(png.bytes, modo)
          if (!r.ok) throw new Error(r.error)
          if (r.value === null) {
            set({ salvando: false })
            return
          }
          if ('existe' in r.value) {
            set({ salvando: false, perguntar: r.value.existe })
            return
          }
          const salvo = {
            caminho: r.value.salvo,
            ms: Math.round(fonte.tempoSoDoPng ? doPng : performance.now() - inicio),
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

      gravarPendente: () => {
        if (gravarDepois) gravarAgora()
      },

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
  return loja
}

/**
 * O PNG FINAL 1080x1920: cada painel vem do main (a janela da fonte com o
 * upscale, reduzida ao painel exato) e o resto e o MESMO desenho da previa
 * (o divisor, a seta e o texto), na escala 1 e sem guias.
 */
export async function pngDaThumb(
  thumb: ThumbDoProjeto,
  recortar: FonteDoEditor['recorte'],
): Promise<{ bytes: Uint8Array<ArrayBuffer>; ampliado: boolean }> {
  const ef = thumbEfetiva(thumb, medidor(thumb.fonte))
  let ampliado = false
  const paineis = await Promise.all(
    ef.geo.paineis.map(async (painel, i) => {
      const img = thumb.imagens[i]
      if (!img) return null
      const rec = recorteDaImagem(painel, img, ef.enquadramentos[i] ?? null)
      const altura = painel.y1 - painel.y0
      const r = await recortar({
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
  // O divisor no tamanho do arquivo (1 px dele = 1 px da thumb); o mesmo da previa.
  const divisor = await prepararDivisor(ef.divisor)
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
    divisor,
    escala: 1,
    guias: null,
  })
  for (const p of paineis) (p?.fonte as ImageBitmap | undefined)?.close()
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'))
  if (!blob) throw new Error('O PNG nao saiu.')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ampliado }
}
