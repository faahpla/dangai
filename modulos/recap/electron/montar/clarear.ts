import sharp from 'sharp'
import type { Formato } from '@shared/contract'
import type { EpisodeIndex, Plano } from '../../shared/episodio'
import { camadaDeClarear, clarearQuadro, LEGIVEL_PARA_CLAREAR } from '../../shared/clarear'
import type { ClipeDoRecap } from '../../shared/projeto-do-recap'
import { janelaVisivel } from '../../shared/recorte'
import { legibilidadeDoQuadro, posDoKeyframe } from '../../shared/visao'
import { chaveDoPedaco, type FocoDoPedaco, type PedacoDaMontagem } from './projeto'

/**
 * [recap] A CENA ESCURA CLAREADA NA MONTAGEM (19/10, 3a rodada do MRM E02).
 *
 * O casar so troca a cena ilegivel quando ha outra de relevancia parecida (o
 * gancho, termosDaLeitura); a relevante e escura fica -- o 0012 do f06, o Lent
 * de perfil na chuva. Aqui, com o recorte ja decidido, cada cena e medida como
 * a TELA vai mostrar (o keyframe mais perto do meio do trecho, recortado no
 * foco) e a ilegivel ganha uma camada de ajuste do nucleo so no tempo dela
 * (clarearQuadro: a exposicao sobe ate ficar legivel, sem lavar o preto).
 *
 * Melhor esforco: keyframe que nao abre, cena sem plano no indice ou erro --
 * fica sem camada. Nada aqui grava arquivo.
 */

/** O tamanho em que o recorte e medido (9:16 de pe, os mesmos pixels do 96x54 da legibilidade). */
const LARGURA = 54
const ALTURA = 96

/** O keyframe mais perto do meio do trecho que a cena mostra (segundos do mp4). */
function keyframeDoMeio(plano: Pick<Plano, 'keyframe' | 'start' | 'end' | 'inicioNoArquivo'>, de: number, ate: number): string | null {
  const kf = plano.keyframe
  if (!kf) return null
  if (!/_1\.jpe?g$/i.test(kf)) return kf
  const dur = plano.end - plano.start
  const meio = (de + ate) / 2 - (plano.inicioNoArquivo ?? 0)
  let k = 1
  let menor = Infinity
  for (const kk of [0, 1, 2]) {
    const d = Math.abs(posDoKeyframe(kk) * dur - meio)
    if (d < menor) {
      menor = d
      k = kk
    }
  }
  return kf.replace(/_1(\.jpe?g)$/i, `_${k}$1`)
}

/** O recorte da tela no keyframe, reduzido a LARGURA x ALTURA (RGB). null = nao leu. */
async function recorteDaTela(kf: string, focusX: number, formato: Formato): Promise<Uint8Array | null> {
  try {
    const meta = await sharp(kf).metadata()
    const W = meta.width ?? 0
    const H = meta.height ?? 0
    if (W <= 0 || H <= 0) return null
    const j = janelaVisivel(focusX, W, H, formato)
    const w = Math.max(1, Math.min(W, Math.round(j.largura * W)))
    const x = Math.max(0, Math.min(W - w, Math.round(j.centro * W - w / 2)))
    const { data } = await sharp(kf)
      .extract({ left: x, top: 0, width: w, height: H })
      .resize(LARGURA, ALTURA, { fit: 'fill' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true })
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  } catch {
    return null
  }
}

export async function clarearDaMontagem(e: {
  pedacos: readonly PedacoDaMontagem[]
  indice: Pick<EpisodeIndex, 'planos'>
  focos: ReadonlyMap<string, FocoDoPedaco>
  /** A faixa de video das camadas (acima da camada de cor). */
  faixa: number
  formato?: Formato
}): Promise<{ clipes: ClipeDoRecap[]; avisos: string[] }> {
  const formato = e.formato ?? 'short'
  const planos = new Map(e.indice.planos.map((p) => [p.id, p]))
  const clipes: ClipeDoRecap[] = []
  const prefixo = `er-clarear-${Date.now().toString(36)}`
  for (const [j, p] of e.pedacos.entries()) {
    try {
      const plano = planos.get(p.planoId)
      const dura = p.fim - p.inicio
      // (rodada 4) O grid fica de fora: a camada clarearia as duas metades por causa de uma.
      if (!plano || !(dura > 0) || p.baixo) continue
      const kf = keyframeDoMeio(plano, p.de, p.de + dura)
      if (!kf) continue
      const rgb = await recorteDaTela(kf, e.focos.get(chaveDoPedaco(p))?.focusX ?? 0.5, formato)
      if (!rgb || legibilidadeDoQuadro(rgb, LARGURA, ALTURA) >= LEGIVEL_PARA_CLAREAR) continue
      const c = clarearQuadro(rgb, LARGURA, ALTURA)
      if (!c) continue
      clipes.push(camadaDeClarear({ cor: c.ajuste, at: p.inicio, duracaoSec: dura, faixa: e.faixa, id: `${prefixo}-${j}`, nome: p.fraseId }))
    } catch {
      // Esta cena fica sem camada.
    }
  }
  return { clipes, avisos: clipes.length > 0 ? [`Clareou ${clipes.length} cena(s) escura(s) com uma camada de ajuste`] : [] }
}
