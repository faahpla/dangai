import { create } from 'zustand'
import { thumbDoProjeto, thumbPadrao, type ThumbDoProjeto } from '../../shared/thumb'
import { cenaNoInstante, cenasDoPlano } from '../../shared/plano'
import { configDaThumbSchema, presetDe, thumbDoPreset, type PresetDaThumb } from '../../shared/pedidos'
import type { MotorDaThumb } from '../../shared/canais'
import { criarLojaDoEditor, type FonteDoEditor, type LojaDoEditor } from '../editor/loja'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'

/**
 * [thumb] A TELA DO MODULO THUMBNAIL: o editor em comum (editor/loja.ts) em
 * dois jeitos, cada um com a sua loja:
 *
 * - SOLTA: abre vazio; cada imagem vem do PC (dialogo ou soltar). Lembra o
 *   ultimo preset (texto, cores, fonte, altura, layout, seta) nas
 *   configuracoes do modulo. O PNG vai para onde ele escolher no dialogo
 *   (abre na pasta da ultima imagem).
 * - DE UM PROJETO: o projeto aberto no editor (escolher outro .dangai abre
 *   ele no editor, pelo nucleo, que pergunta se tem algo por salvar). As
 *   imagens: as sugestoes das cenas (rosto, close, nitidez), qualquer
 *   instante da linha do tempo tirado LIMPO da cena de origem, ou um arquivo
 *   (copiado para <projeto>/thumb). Guarda em `modulos.thumb` do projeto
 *   (nunca no `modulos.recap`). O PNG vai ao lado do video do projeto, se
 *   ja houver render; senao, pergunta onde.
 */

export type ModoDaTela = 'solta' | 'projeto'

const nomeDe = (c: string): string => c.split(/[\\/]/).pop() ?? c
const pastaDe = (c: string): string => c.replace(/[\\/][^\\/]*$/, '')
const semExtensao = (c: string): string => nomeDe(c).replace(/\.[^.]+$/, '')

/** O preset que esta nas configuracoes do modulo (o `paraRenderer`). */
function presetGuardado(): PresetDaThumb | null {
  const lido = configDaThumbSchema.safeParse(nucleo().euMesmo()?.config)
  return lido.success ? lido.data.preset : null
}

function padraoComPreset(): ThumbDoProjeto {
  return thumbDoPreset(presetGuardado(), thumbPadrao(null))
}

/** A ultima imagem do PC que ele usou (o dialogo e o "Salvar PNG" abrem na pasta dela). */
let ultimaImagem: string | null = null

function lembrarImagem(thumb: ThumbDoProjeto): void {
  const img = thumb.imagens[0] ?? thumb.imagens[1]
  if (img?.origem === 'arquivo') ultimaImagem = img.arquivo
}

let presetGravado = ''

const solta: FonteDoEditor = {
  quadro: (p) => ponte.quadro(p),
  miniatura: (p) => ponte.miniatura(p),
  rostos: (p) => ponte.rostos(p),
  recorte: (p) => ponte.recorte(p),
  upscale: () => ponte.upscale(),
  chave: () => 'solta',
  lerGuardada: () => null,
  padrao: padraoComPreset,
  gravar: (thumb) => {
    lembrarImagem(thumb)
    const preset = presetDe(thumb)
    const json = JSON.stringify(preset)
    if (json === presetGravado || json === JSON.stringify(presetGuardado())) return
    presetGravado = json
    void ponte
      .salvarPreset(preset)
      .then(() => nucleo().reler())
      .catch((e: unknown) => console.warn('[thumb] guardar o preset:', e))
  },
  escolherArquivo: async () => {
    const r = await ponte.escolherImagem({ pasta: ultimaImagem ? pastaDe(ultimaImagem) : null, projeto: null })
    if (!r.ok || !r.value) return null
    ultimaImagem = r.value
    return r.value
  },
  podeSalvar: () => true,
  tempoSoDoPng: true,
  salvar: async (png) => {
    const t = useSolta.getState().thumb
    const img = t?.imagens[0] ?? t?.imagens[1] ?? null
    const base = img ?? (ultimaImagem ? { arquivo: ultimaImagem } : null)
    return ponte.salvarComo({
      png,
      pasta: base ? pastaDe(base.arquivo) : null,
      nome: `${base ? semExtensao(base.arquivo) : 'thumbnail'}-thumb.png`,
    })
  },
}

/** O projeto aberto no editor tem alguma coisa (a tela inicial = nada). */
export function haProjetoAberto(): boolean {
  const e = nucleo().ler()
  return e.phase() !== 'empty'
}

function pastaDoProjeto(): string | null {
  const p = nucleo().ler().projectPath
  return p ? pastaDe(p) : null
}

const doProjeto: FonteDoEditor = {
  quadro: (p) => ponte.quadro(p),
  miniatura: (p) => ponte.miniatura(p),
  rostos: (p) => ponte.rostos(p),
  recorte: (p) => ponte.recorte(p),
  upscale: () => ponte.upscale(),
  chave: () => `${nucleo().ler().projectPath ?? ''}`,
  lerGuardada: () => {
    const cru = nucleo().lerDoProjeto()
    return cru && typeof cru === 'object' ? thumbDoProjeto((cru as Record<string, unknown>)['thumb']) : null
  },
  padrao: padraoComPreset,
  gravar: (thumb) => {
    const cru = nucleo().lerDoProjeto()
    const atual = cru && typeof cru === 'object' ? (cru as Record<string, unknown>)['thumb'] : undefined
    if (JSON.stringify(atual) === JSON.stringify(thumb)) return
    nucleo().gravarNoProjeto({ versao: 1, thumb })
  },
  sugestoes: () => ponte.sugestoes(cenasDoPlano(nucleo().ler(), null)),
  inicioDaCena: (ordem) => nucleo().ler().plan?.scenes[ordem]?.start ?? null,
  cenaNoInstante: (t) => cenaNoInstante(nucleo().ler(), t),
  escolherArquivo: async () => {
    const pasta = pastaDoProjeto()
    const r = await ponte.escolherImagem({ pasta, projeto: pasta })
    return r.ok ? r.value : null
  },
  podeSalvar: () => haProjetoAberto(),
  tempoSoDoPng: true,
  salvar: async (png, modo) => {
    const video = useTela.getState().video
    if (video) return ponte.salvarAoLado({ video, png, modo })
    const projeto = nucleo().ler().projectPath
    const audio = nucleo().ler().audio?.path ?? null
    const base = projeto ?? audio
    return ponte.salvarComo({
      png,
      pasta: base ? pastaDe(base) : null,
      nome: `${base ? semExtensao(base) : 'thumbnail'}-thumb.png`,
    })
  },
}

export const useSolta: LojaDoEditor = criarLojaDoEditor(solta)
export const useDoProjeto: LojaDoEditor = criarLojaDoEditor(doProjeto)

export function lojaDo(modo: ModoDaTela): LojaDoEditor {
  return modo === 'solta' ? useSolta : useDoProjeto
}

interface EstadoDaTela {
  aberta: boolean
  modo: ModoDaTela
  /** O detector de rostos do motor (null = ainda nao perguntou). */
  motor: MotorDaThumb | null
  /** O render do projeto (o PNG vai ao lado dele). */
  video: string | null
  abrindoProjeto: boolean
  erroDoProjeto: string | null
  abrir(modo?: ModoDaTela, imagens?: readonly string[]): void
  fechar(): void
  trocarModo(modo: ModoDaTela): void
  /** O .dangai pelo dialogo: abre no editor (pelo nucleo) e a thumb e dele. */
  escolherProjeto(): Promise<void>
  /** O projeto do editor mudou (ou a tela abriu nele): a loja do projeto recomeca dele. */
  entrarNoProjeto(): Promise<void>
  conferirMotor(): Promise<void>
  /** Imagens soltas na previa ou num cartao: cada uma num slot. */
  soltar(caminhos: readonly string[], slot: 0 | 1): Promise<void>
}

export const useTela = create<EstadoDaTela>((set, get) => ({
  aberta: false,
  modo: 'solta',
  motor: null,
  video: null,
  abrindoProjeto: false,
  erroDoProjeto: null,

  abrir: (modo, imagens) => {
    const escolhido = modo ?? (haProjetoAberto() ? 'projeto' : 'solta')
    set({ aberta: true, modo: escolhido, erroDoProjeto: null })
    void get().conferirMotor()
    if (escolhido === 'projeto') void get().entrarNoProjeto()
    else
      void useSolta
        .getState()
        .iniciar()
        .then(() => (imagens && imagens.length > 0 ? get().soltar(imagens, 0) : undefined))
  },

  fechar: () => {
    useSolta.getState().gravarPendente()
    useDoProjeto.getState().gravarPendente()
    set({ aberta: false })
  },

  trocarModo: (modo) => {
    if (modo === get().modo) return
    set({ modo, erroDoProjeto: null })
    if (modo === 'projeto') void get().entrarNoProjeto()
    else void useSolta.getState().iniciar()
  },

  escolherProjeto: async () => {
    if (get().abrindoProjeto) return
    const atual = nucleo().ler().projectPath
    // O dialogo aberto conta como "abrindo": o botao nao abre um segundo por cima.
    set({ abrindoProjeto: true, erroDoProjeto: null })
    const r = await ponte.escolherProjeto(atual ? pastaDe(atual) : null).catch((e: unknown) => ({ ok: false as const, error: String(e) }))
    if (!r.ok || !r.value) {
      set({ abrindoProjeto: false, ...(r.ok ? {} : { erroDoProjeto: r.error }) })
      return
    }
    try {
      useDoProjeto.getState().gravarPendente()
      await nucleo().abrirProjeto(r.value)
      const e = nucleo().ler()
      if (e.error && e.projectPath !== r.value.replace(/\\/g, '/') && e.projectPath !== r.value) set({ erroDoProjeto: e.error })
    } finally {
      set({ abrindoProjeto: false })
    }
    await get().entrarNoProjeto()
  },

  entrarNoProjeto: async () => {
    if (!haProjetoAberto()) {
      useDoProjeto.getState().limpar()
      set({ video: null })
      return
    }
    const e = nucleo().ler()
    const r = await ponte.videoDoProjeto({ audio: e.audio?.path ?? null, ultimo: e.lastOutput }).catch(() => null)
    set({ video: r?.ok ? r.value : null })
    await useDoProjeto.getState().iniciar()
  },

  conferirMotor: async () => {
    const r = await ponte.motor().catch(() => null)
    const motor = r?.ok ? r.value : { pronto: false, motivo: r && !r.ok ? r.error : null }
    const antes = get().motor
    set({ motor })
    // Ficou pronto agora (instalou com a tela aberta): procura os rostos de quem ficou no meio.
    if (motor.pronto && antes && !antes.pronto) {
      void useSolta.getState().procurarRostosDeNovo()
      void useDoProjeto.getState().procurarRostosDeNovo()
    }
  },

  soltar: async (caminhos, slot) => {
    const loja = lojaDo(get().modo)
    const thumb = loja.getState().thumb
    if (!thumb || caminhos.length === 0) return
    const projeto = get().modo === 'projeto' ? pastaDoProjeto() : null
    // Duas imagens soltas juntas com o layout de duas: uma em cada metade.
    const alvos = caminhos.slice(0, thumb.layout === 'duas' ? 2 : 1)
    for (const [i, origem] of alvos.entries()) {
      const r = await ponte.copiarImagem({ arquivo: origem, projeto })
      if (!r.ok) {
        nucleo().mostrarErro(r.error)
        continue
      }
      if (get().modo === 'solta') ultimaImagem = r.value
      const destino = (i === 0 ? slot : slot === 0 ? 1 : 0) as 0 | 1
      loja.getState().escolherSlot(destino)
      await loja.getState().usarCaminho(r.value, destino)
    }
  },
}))
