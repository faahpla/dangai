import { create } from 'zustand'
import { duracaoDoTrecho, MOTION_CURVE_DEFAULT, type AudioAnalysis } from '@shared/contract'
import { cortesDoProjeto, perfilPronto, planejarMeuJeito, PREFIXO_DO_MEU_JEITO, type PerfilDoMeuJeito } from '@shared/meu-jeito'
import { avisar } from './aviso'
import { useProject, type ProjectState } from './project'
import { ondaDoTrecho } from './projeto/apoio'
import { fecharPassoAgora } from './undo'

/**
 * "DO MEU JEITO" na janela: o perfil aprendido (o main le os projetos; ver
 * electron/services/meu-jeito.ts) e o botao que poe no video aberto a abertura,
 * a musica, os sons nos cortes e a cor dele -- num passo so de Ctrl+Z.
 * Rodar de novo troca so o que ele mesmo pos (id com PREFIXO_DO_MEU_JEITO).
 */

export const useMeuJeito = create<{ perfil: PerfilDoMeuJeito | null; carregar: () => Promise<void> }>((set) => ({
  perfil: null,
  carregar: async () => {
    const r = await window.dangai.perfilDoMeuJeito()
    if (r.ok) set({ perfil: r.value })
  },
}))

/** Em uma frase, o que ele aprendeu: vai no title do botao. */
export function resumoDoPerfil(p: PerfilDoMeuJeito | null): string {
  if (!perfilPronto(p)) return 'Salve alguns vídeos com som (pelo menos 3) e o Dangai aprende o seu jeito de editar.'
  const nome = (n: string): string => n.replace(/\.[a-z0-9]+$/i, '')
  const partes = [
    p.abertura[0] ? `abertura com ${nome(p.abertura[0].nome)}` : null,
    p.musica[0] ? `música ${nome(p.musica[0].nome)}` : null,
    p.cortes.length ? `${p.cortes.slice(0, 3).map((s) => nome(s.nome)).join(', ')} nos cortes` : null,
    p.cor ? 'a sua cor' : null,
  ].filter(Boolean)
  return `Aplica o seu jeito, aprendido de ${p.projetosComSom} vídeos: ${partes.join(', ')}. Ctrl+Z desfaz tudo.`
}

type Trilha = ProjectState['trilhas'][number]
type Sobreposicao = ProjectState['sobreposicoes'][number]

/** Aplica no video aberto. Devolve false quando nao deu (o motivo vai para a barra). */
export async function aplicarMeuJeito(): Promise<boolean> {
  const s = useProject.getState()
  if (!s.audio || !s.plan || s.plan.scenes.length === 0) return false
  const r = await window.dangai.perfilDoMeuJeito()
  if (!r.ok) {
    useProject.setState({ error: r.error })
    return false
  }
  const perfil = r.value
  useMeuJeito.setState({ perfil })
  if (!perfilPronto(perfil)) {
    useProject.setState({ error: 'Ainda não dá para fazer do seu jeito: salve pelo menos 3 vídeos com som, que o Dangai aprende com eles.' })
    return false
  }

  const audio = s.audio
  const ficam = s.trilhas.filter((t) => !t.id.startsWith(PREFIXO_DO_MEU_JEITO))
  const plano = planejarMeuJeito(perfil, {
    duracaoSec: audio.durationSec,
    cortes: cortesDoProjeto({ audio, plan: s.plan, images: s.images }),
    ocupado: ficam.map((t) => ({ faixa: t.faixa, at: t.at, fim: t.at + duracaoDoTrecho(t) })),
    semente: audio.path,
  })

  useProject.setState({ busy: 'Fazendo do seu jeito...' })
  const analises = new Map<string, AudioAnalysis | null>()
  for (const som of plano.sons) {
    if (analises.has(som.path)) continue
    const a = await window.dangai.analyzeAudio(som.path)
    analises.set(som.path, a.ok ? a.value : null)
  }
  const sumiram = new Set<string>()
  const novos: Trilha[] = []
  plano.sons.forEach((som, i) => {
    const a = analises.get(som.path)
    // O arquivo saiu do lugar desde aquele video: fica de fora, e ele fica sabendo.
    if (!a) {
      sumiram.add(som.nome)
      return
    }
    const inicioSec = Math.min(som.inicioSec, Math.max(0, a.durationSec - 0.05))
    novos.push({
      id: `${PREFIXO_DO_MEU_JEITO}${Date.now()}-${i}`,
      path: som.path,
      fileName: a.fileName,
      faixa: som.faixa,
      at: som.at,
      durationSec: a.durationSec,
      inicioSec,
      usarSec: Math.max(0.05, Math.min(som.usarSec, a.durationSec - inicioSec)),
      gainDb: som.gainDb,
      fadeInSec: som.fadeInSec,
      fadeOutSec: som.fadeOutSec,
      ...ondaDoTrecho(a),
      url: a.url,
    })
  })

  // A cor: uma camada de ajuste por cima de tudo, no video inteiro -- se ele
  // ainda nao pos uma dele.
  const sobreFicam = s.sobreposicoes.filter((o) => !o.id.startsWith(PREFIXO_DO_MEU_JEITO))
  const jaTemCor = sobreFicam.some((o) => o.tipo === 'ajuste' && (o.usarSec ?? 0) >= audio.durationSec * 0.6)
  const camada: Sobreposicao | null =
    plano.cor && !jaTemCor
      ? {
          id: `${PREFIXO_DO_MEU_JEITO}ajuste-${Date.now()}`,
          path: '',
          fileName: 'Camada de ajuste',
          tipo: 'ajuste',
          faixa: Math.max(-1, ...sobreFicam.map((o) => o.faixa)) + 1,
          at: 0,
          durationSec: 3600,
          inicioSec: 0,
          usarSec: audio.durationSec,
          x: 0,
          y: 0,
          escala: 1,
          opacidade: 1,
          aspecto: 16 / 9,
          rotacao: 0,
          efeito: 'nenhum',
          intensidade: 0.1,
          curva: MOTION_CURVE_DEFAULT,
          pontosDaCurva: null,
          cor: plano.cor,
          espelhar: false,
          fadeInSec: 0,
          fadeOutSec: 0,
          url: '',
        }
      : null

  // Um passo so de Ctrl+Z para tudo.
  fecharPassoAgora()
  useProject.setState({
    trilhas: [...ficam, ...novos],
    sobreposicoes: camada ? [...sobreFicam, camada] : sobreFicam,
    busy: null,
    projectDirty: true,
  })
  fecharPassoAgora()

  const feito = [`${novos.length} sons`, camada ? 'a sua cor' : null].filter(Boolean).join(' e ')
  avisar(
    `Do seu jeito: ${feito}. Ctrl+Z desfaz tudo.` +
      (sumiram.size ? ` Não achei: ${[...sumiram].join(', ')} (o arquivo mudou de lugar).` : ''),
  )
  return true
}
