import { cadeiaDeAudioSchema, CADEIA_PADRAO, novaEdicao, type CadeiaDeAudio, type EdicaoDeAudio } from '@shared/edicao-de-audio'
import { avisar } from '../aviso'
import { perguntar } from '../pergunta'
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
    // Ja com cenas, a narracao nova refaz as frases e a selecao: so com o ok dele.
    if (get().images.length > 0) {
      const seguir = await perguntar({
        titulo: 'Trocar a narração do vídeo?',
        texto:
          'O vídeo já tem cenas. Com o áudio novo, as frases e as legendas são lidas de novo, e as cenas escolhidas na Biblioteca precisam ser conferidas.',
        sim: 'Trocar a narração',
        nao: 'Cancelar',
      })
      if (!seguir) return
    }
    set({ busy: 'Gerando o áudio final...', error: null })
    const r = await window.dangai.concluirEdicao(edicao)
    if (!r.ok) {
      set({ busy: null, error: r.error })
      return
    }
    set({ busy: null, edicaoDeAudio: { ...edicao, saida: r.value }, etapaDoAudio: false })
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
