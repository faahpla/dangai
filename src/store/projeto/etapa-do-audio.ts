import { cadeiaDeAudioSchema, CADEIA_PADRAO, novaEdicao, temposDa, FONTE_PRINCIPAL, type CadeiaDeAudio, type EdicaoDeAudio } from '@shared/edicao-de-audio'
import { avisar } from '../aviso'
import type { GetProjeto, ProjectState, SetProjeto } from '../project'

/** Do store do editor (ver ../project.ts): a etapa de audio, antes da Biblioteca. */
export type FatiaDaEtapaDoAudio = Pick<
  ProjectState,
  'abrirEtapaDoAudio' | 'fecharEtapaDoAudio' | 'mudarEdicaoDeAudio' | 'concluirEtapaDoAudio' | 'pularEtapaDoAudio' | 'salvarCadeiaComoPadrao'
>

/** A cadeia que ele salvou como padrao, ou a de partida. */
async function cadeiaDele(): Promise<CadeiaDeAudio> {
  const r = await window.dangai.getSettings()
  const salva = r.ok ? cadeiaDeAudioSchema.safeParse(r.value.cadeiaDeAudio) : null
  return salva?.success ? salva.data : CADEIA_PADRAO
}

export const fatiaDaEtapaDoAudio = (set: SetProjeto, get: GetProjeto): FatiaDaEtapaDoAudio => ({
  /*
   * A ETAPA DE AUDIO: "quando eu importar pro Dangai quero uma timeline para a
   * edicao do audio". Com `bruto`, uma gravacao nova (com a cadeia que ele
   * salvou como padrao); sem, volta a edicao que o projeto ja tem.
   */
  abrirEtapaDoAudio: async (bruto) => {
    if (bruto) {
      const atual = get().edicaoDeAudio
      // Soltar de novo a MESMA gravacao continua a edicao dela, nao comeca outra.
      if (!atual || atual.bruto !== bruto) {
        // A narracao que acabou de entrar ja foi medida: nao le o arquivo de novo.
        let duracao = get().audio?.path === bruto ? get().audio!.durationSec : null
        if (duracao === null) {
          const analise = await window.dangai.analyzeAudio(bruto)
          if (!analise.ok) {
            set({ error: analise.error })
            return
          }
          duracao = analise.value.durationSec
        }
        set({ edicaoDeAudio: novaEdicao(bruto, duracao, await cadeiaDele()) })
      }
    }
    if (!get().edicaoDeAudio) return
    set({ etapaDoAudio: true, etapaDoRoteiro: false, libraryOpen: false })
  },

  fecharEtapaDoAudio: () => set({ etapaDoAudio: false }),

  mudarEdicaoDeAudio: (mudar) => {
    const atual = get().edicaoDeAudio
    if (!atual) return
    set({ edicaoDeAudio: mudar(atual), projectDirty: true })
  },

  /*
   * PRONTO: a narracao final sai ao lado da gravacao e entra no projeto como a
   * narracao -- o mesmo caminho de soltar um audio --, e a proxima etapa abre
   * (a Biblioteca, com as frases do roteiro).
   */
  concluirEtapaDoAudio: async () => {
    const edicao = get().edicaoDeAudio
    if (!edicao) return
    set({ busy: 'Gerando o áudio final...', error: null })
    const r = await window.dangai.concluirEdicao(edicao)
    if (!r.ok) {
      set({ busy: null, error: r.error })
      return
    }
    const tempos = temposDa(edicao)
    /*
     * O VIDEO JA ESTA MONTADO (ele voltou ao Audio para tirar o Fresh Air, cortar
     * uma respiracao, mudar a velocidade): so o som troca. Cenas, transicoes,
     * selecao e legendas ficam como ele deixou, nos tempos da narracao nova, e
     * ele volta para a linha do tempo. Antes isto passava pelo caminho de soltar
     * uma narracao nova -- que zera tudo.
     */
    const montado = get().plan !== null && get().images.length > 0
    // Ja sincronizado (com ou sem cenas escolhidas): a sincronia e a selecao tambem ficam.
    if (get().audio && (montado || get().scriptBlocks)) {
      const atual = get().audio!.path
      // Os tempos da narracao que esta no video: a do ultimo Pronto, ou a propria gravacao crua inteira.
      const velhos =
        atual === edicao.saida
          ? edicao.tempos
          : atual === edicao.bruto
            ? { trechos: [{ de: 0, ate: edicao.duracaoBruta, em: 0, fonte: FONTE_PRINCIPAL }], velocidade: 100 }
            : null
      set({ busy: null, etapaDoAudio: false, edicaoDeAudio: { ...edicao, saida: r.value, tempos } })
      await get().narracaoNovaNoMesmoVideo(r.value, velhos, tempos)
      // Sem video montado ainda, ele estava escolhendo as cenas: volta para elas.
      if (!montado) await get().irParaEtapa('cenas')
      return
    }
    set({ busy: null, edicaoDeAudio: { ...edicao, saida: r.value, tempos }, etapaDoAudio: false })
    await get().ingest([r.value])
    // A proxima etapa: o roteiro e a sincronia das legendas (depois, as cenas).
    await get().irParaEtapa('roteiro')
  },

  /** Usar a gravacao como esta: fecha a etapa e segue para o roteiro. */
  pularEtapaDoAudio: async () => {
    set({ etapaDoAudio: false })
    if (get().audio) await get().irParaEtapa('roteiro')
  },

  salvarCadeiaComoPadrao: async () => {
    const edicao = get().edicaoDeAudio
    if (!edicao) return
    const r = await window.dangai.saveSettings({ cadeiaDeAudio: edicao.cadeia })
    if (r.ok) avisar('Pronto: os próximos áudios já começam com estes efeitos.', 5000)
    else set({ error: r.error })
  },
})

export type { EdicaoDeAudio }
