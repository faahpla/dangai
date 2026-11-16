import { create } from 'zustand'
import type { FraseDeLigacaoPronta, LigacaoPedida } from '@shared/channels'
import { cadeiaDeAudioSchema, CADEIA_PADRAO, type CadeiaDeAudio } from '@shared/edicao-de-audio'
import { useProject } from './project'
import { useRecentes } from './recentes'

/**
 * A TELA DO JUNTAR PROJETOS (16/11): os videos de ~30 s viram um de 60 s+.
 * Ele escolhe os projetos na ordem, a ligacao de cada emenda (uma frase
 * gravada, com os efeitos da etapa de Audio e uma cena da Biblioteca, ou so um
 * som) e o nome; o main junta (electron/services/juntar-projetos.ts) e o
 * projeto novo abre no editor. Os projetos de origem nao mudam.
 */

export interface ParteNaTela {
  caminho: string
  nome: string
  duracaoSec: number
  capa: string | null
}

export type LigacaoNaTela =
  | { tipo: 'som'; som: string | null }
  | {
      tipo: 'frase'
      /** O arquivo gravado (cru). */
      arquivo: string | null
      /** Quanto o arquivo cru dura (a conta do total, antes da velocidade). */
      duracaoBruta: number
      texto: string
      cadeia: CadeiaDeAudio
      cena: string | null
      /** A ultima versao ouvida com os efeitos (some ao mudar os efeitos ou o arquivo). */
      pronta: FraseDeLigacaoPronta | null
    }

interface EstadoDoJuntar {
  aberta: boolean
  partes: ParteNaTela[]
  /** Uma por emenda: `ligacoes[i]` liga a parte i a i+1. */
  ligacoes: LigacaoNaTela[]
  nome: string
  /** O nome foi digitado por ele (ai nao segue mais a primeira parte). */
  nomeDele: boolean
  juntando: boolean
  erro: string | null
  /** O som de sempre do corte (o do Pan, nas Configuracoes). */
  somPadrao: string | null
  /** Os efeitos "meu padrao" da etapa de Audio: a frase comeca com eles. */
  cadeiaPadrao: CadeiaDeAudio
  abrir: () => Promise<void>
  fechar: () => void
  adicionar: (parte: ParteNaTela) => void
  remover: (i: number) => void
  mover: (de: number, para: number) => void
  mudarLigacao: (i: number, nova: LigacaoNaTela) => void
  virarFrase: (i: number) => void
  virarSom: (i: number) => void
  setNome: (nome: string) => void
  juntar: () => Promise<void>
}

/** A frase e o tempo que ela soma ao video: a pronta, ou a crua pela velocidade. */
export function duracaoDaLigacao(l: LigacaoNaTela): number {
  if (l.tipo === 'som') return 0
  if (l.pronta) return l.pronta.duracao
  return l.duracaoBruta / ((l.cadeia.velocidade ?? 100) / 100)
}

const nomePadrao = (partes: readonly ParteNaTela[]): string => (partes[0] ? `${partes[0].nome} (versão longa)` : '')

export const useJuntar = create<EstadoDoJuntar>((set, get) => ({
  aberta: false,
  partes: [],
  ligacoes: [],
  nome: '',
  nomeDele: false,
  juntando: false,
  erro: null,
  somPadrao: null,
  cadeiaPadrao: CADEIA_PADRAO,

  abrir: async () => {
    set({ aberta: true, erro: null })
    void useRecentes.getState().carregar()
    const r = await window.dangai.getSettings()
    if (r.ok) {
      const cadeia = cadeiaDeAudioSchema.safeParse(r.value.cadeiaDeAudio)
      set({ somPadrao: r.value.somDoPan || null, cadeiaPadrao: cadeia.success ? cadeia.data : CADEIA_PADRAO })
    }
  },

  fechar: () => set({ aberta: false, erro: null }),

  adicionar: (parte) => {
    const { partes, ligacoes, somPadrao, nomeDele } = get()
    const novas = [...partes, parte]
    set({
      partes: novas,
      // Toda emenda nova comeca com o som de sempre; a frase e quando ele quer.
      ligacoes: novas.length >= 2 ? [...ligacoes, { tipo: 'som', som: somPadrao }] : ligacoes,
      nome: nomeDele ? get().nome : nomePadrao(novas),
      erro: null,
    })
  },

  remover: (i) => {
    const { partes, ligacoes, nomeDele } = get()
    const novas = partes.filter((_, k) => k !== i)
    // Sai a ligacao que encostava nela: a de depois, ou a de antes se era a ultima.
    const tirar = i < ligacoes.length ? i : i - 1
    set({
      partes: novas,
      ligacoes: ligacoes.filter((_, k) => k !== tirar),
      nome: nomeDele ? get().nome : nomePadrao(novas),
    })
  },

  mover: (de, para) => {
    const { partes, nomeDele } = get()
    if (para < 0 || para >= partes.length || de === para) return
    const novas = [...partes]
    const [p] = novas.splice(de, 1)
    novas.splice(para, 0, p!)
    // As ligacoes ficam nas emendas (a 1a emenda continua com a ligacao dela).
    set({ partes: novas, nome: nomeDele ? get().nome : nomePadrao(novas) })
  },

  mudarLigacao: (i, nova) => set({ ligacoes: get().ligacoes.map((l, k) => (k === i ? nova : l)) }),

  virarFrase: (i) => {
    const atual = get().ligacoes[i]
    if (!atual || atual.tipo === 'frase') return
    get().mudarLigacao(i, { tipo: 'frase', arquivo: null, duracaoBruta: 0, texto: '', cadeia: get().cadeiaPadrao, cena: null, pronta: null })
  },

  virarSom: (i) => {
    const atual = get().ligacoes[i]
    if (!atual || atual.tipo === 'som') return
    get().mudarLigacao(i, { tipo: 'som', som: get().somPadrao })
  },

  setNome: (nome) => set({ nome, nomeDele: true }),

  juntar: async () => {
    const { partes, ligacoes, nome, juntando } = get()
    if (juntando) return
    if (partes.length < 2) {
      set({ erro: 'Escolha pelo menos dois projetos.' })
      return
    }
    const pedidas: LigacaoPedida[] = []
    for (const [i, l] of ligacoes.entries()) {
      if (l.tipo === 'som') {
        pedidas.push({ tipo: 'som', som: l.som })
        continue
      }
      if (!l.arquivo) {
        set({ erro: `A ligação ${i + 1} é uma frase: escolha o arquivo gravado (ou troque para "Só som").` })
        return
      }
      if (!l.texto.trim()) {
        set({ erro: `Escreva o que você falou na frase da ligação ${i + 1}: é o texto da legenda.` })
        return
      }
      pedidas.push({ tipo: 'frase', arquivo: l.arquivo, texto: l.texto.trim(), cadeia: l.cadeia, cena: l.cena })
    }
    set({ juntando: true, erro: null })
    const projeto = useProject.getState()
    projeto.setBusy('Juntando os projetos...')
    const r = await window.dangai.juntarProjetos({
      nome: nome.trim() || nomePadrao(partes),
      partes: partes.map((p) => p.caminho),
      ligacoes: pedidas,
      regras: projeto.captionRules,
    })
    useProject.getState().setBusy(null)
    if (!r.ok) {
      set({ juntando: false, erro: r.error })
      return
    }
    // O projeto novo abre no editor; a tela recomeca vazia para a proxima vez.
    set({ juntando: false, aberta: false, partes: [], ligacoes: [], nome: '', nomeDele: false })
    await useProject.getState().openProject(r.value)
  },
}))
