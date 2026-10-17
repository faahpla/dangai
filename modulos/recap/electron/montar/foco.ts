import { medidasDo, type Formato } from '@shared/contract'
import { rostoNosInstantes } from '../assets'
import { probeClip } from '../clips'
import { chaveDoPedaco, type FocoDoPedaco, type PedacoDaMontagem } from './projeto'

/**
 * O ENQUADRAMENTO 9:16 de cada bloco do projeto montado, pelo mesmo detector
 * de rosto que o Dangai usa ao soltar um clipe (lbpcascade_animeface, faces.ts).
 *
 * Por que aqui e nao no openProject: projeto aberto passa o foco pronto para o
 * importImages, que entao NAO procura rosto (e a regra do Dangai: o foco salvo
 * e decisao do usuario). Sem isto, todo bloco do Studio abriria no centro --
 * pior que o mesmo clipe solto a mao no Dangai.
 *
 * Melhor que o do import: olha tres instantes DENTRO do trecho que o bloco usa
 * (25/50/75% de [de, ate]), e nao do arquivo inteiro. Fica o maior rosto, como
 * o rostoNoClipe. Nenhum rosto, erro ou tempo esgotado: centro, sem marca de
 * automatico. Rosto e melhoria, nunca requisito -- o projeto sai de qualquer
 * jeito.
 *
 * Desde a Edicao rapida (14/10) este e o detector de RESERVA: o principal e o
 * YOLO do motor (./rostos-motor.ts), que cai aqui quando o motor nao sobe.
 */

/** Quantos blocos olhados ao mesmo tempo (o mesmo IMPORTE_PARALELO do assets.ts). */
const EM_PARALELO = 3

/** Teto da etapa inteira: passou disso, o resto fica no centro (o Levi esta esperando). */
export const TETO_DOS_ROSTOS_MS = 60_000

/** Onde, dentro do trecho [de, ate] que o bloco toca, os dois detectores olham. */
export const FRACOES_DOS_INSTANTES = [0.25, 0.5, 0.75] as const

export function instantesDoTrecho(de: number, ate: number): number[] {
  const dura = Math.max(ate - de, 0)
  return FRACOES_DOS_INSTANTES.map((f) => de + f * dura)
}

/**
 * Um ponto do quadro (centroX/centroY em fracao, 0..1) no foco do bloco: a
 * fracao da FOLGA da janela do formato, o mesmo sistema do faces.ts (focoPara)
 * e do focoDoRosto da montagem -- este so troca o 'short' fixo pelo formato.
 */
export function focoNoQuadro(
  ponto: { centroX: number; centroY: number },
  largura: number,
  altura: number,
  formato: Formato = 'short',
): { focusX: number; focusY: number } {
  const quadro = medidasDo(formato)
  const escala = Math.max(quadro.renderWidth / largura, quadro.renderHeight / altura)
  const w = Math.max(Math.ceil(largura * escala), quadro.renderWidth)
  const h = Math.max(Math.ceil(altura * escala), quadro.renderHeight)
  const folgaX = w - quadro.renderWidth
  const folgaY = h - quadro.renderHeight
  const prender = (v: number): number => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0.5)
  return {
    focusX: folgaX > 0 ? prender((ponto.centroX * w - quadro.renderWidth / 2) / folgaX) : 0.5,
    focusY: folgaY > 0 ? prender((ponto.centroY * h - quadro.renderHeight / 2) / folgaY) : 0.5,
  }
}

export async function focosDosPedacos(
  pedacos: readonly Pick<PedacoDaMontagem, 'arquivo' | 'de' | 'ate'>[],
  tetoMs = TETO_DOS_ROSTOS_MS,
  formato: Formato = 'short',
): Promise<Map<string, FocoDoPedaco>> {
  const focos = new Map<string, FocoDoPedaco>()
  const unicos = new Map<string, Pick<PedacoDaMontagem, 'arquivo' | 'de' | 'ate'>>()
  for (const p of pedacos) unicos.set(chaveDoPedaco(p), p)
  const fila = [...unicos.entries()]
  const limite = Date.now() + tetoMs
  const medidas = new Map<string, Promise<{ width: number; height: number } | null>>()

  const medir = (arquivo: string): Promise<{ width: number; height: number } | null> => {
    let m = medidas.get(arquivo)
    if (!m) {
      m = probeClip(arquivo).then(
        (info) => (info.width > 0 && info.height > 0 ? { width: info.width, height: info.height } : null),
        () => null,
      )
      medidas.set(arquivo, m)
    }
    return m
  }

  const trabalhar = async (): Promise<void> => {
    for (;;) {
      const proximo = fila.shift()
      if (!proximo || Date.now() > limite) return
      const [chave, p] = proximo
      try {
        const instantes = instantesDoTrecho(p.de, p.ate)
        const [achados, medida] = await Promise.all([rostoNosInstantes(p.arquivo, instantes), medir(p.arquivo)])
        let maior: { centroX: number; centroY: number; area: number } | null = null
        for (const r of achados) if (r && (maior === null || r.area > maior.area)) maior = r
        if (maior && medida) focos.set(chave, { ...focoNoQuadro(maior, medida.width, medida.height, formato), focusAuto: true })
      } catch {
        // Fica no centro.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(EM_PARALELO, fila.length) }, trabalhar))
  return focos
}
