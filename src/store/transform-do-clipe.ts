import { ESCALA_MAXIMA, ESCALA_MINIMA, POSICAO_LIVRE, VIDEO_FPS, type SobreposicaoSalva } from '@shared/contract'
import { chaveEm, gravarChave, transformNoTempo, type Transform2D } from '@shared/transform'

/**
 * Ler e gravar o transform de um clipe da faixa de video NA AGULHA -- o mesmo
 * caminho para o painel e para a caixa no preview.
 *
 * Sem quadros-chave, mexer muda o valor fixo do clipe. Com chaves, mexer grava
 * uma chave na agulha (cria, ou corrige a que ja esta ali), como no
 * DaVinci e no After Effects depois de ligar o cronometro.
 */

/** Meio quadro: a agulha "esta numa chave" dentro disto. */
export const TOLERANCIA_DA_CHAVE = 0.5 / VIDEO_FPS

type Clipe = Pick<SobreposicaoSalva, 'at' | 'x' | 'y' | 'escala' | 'rotacao' | 'chaves' | 'curvaDasChaves'>

/** Segundos desde o inicio do clipe. */
export const tempoNoClipe = (o: Pick<SobreposicaoSalva, 'at'>, playhead: number): number => Math.max(0, playhead - o.at)

export function transformNaAgulha(o: Clipe, playhead: number): Transform2D {
  return transformNoTempo(o, o.chaves, tempoNoClipe(o, playhead), o.curvaDasChaves ?? 'ease-in-out')
}

export const animado = (o: Pick<SobreposicaoSalva, 'chaves'>): boolean => (o.chaves?.length ?? 0) > 0

const limita = (v: number, de: number, ate: number): number => Math.min(Math.max(v, de), ate)

/** Giro fixo fica entre -180 e 180; numa chave pode dar voltas. */
const giroFixo = (g: number): number => ((((g + 180) % 360) + 360) % 360) - 180

/** O patch que poe `valores` no clipe, na agulha. */
export function patchDoTransform(
  o: Clipe,
  playhead: number,
  valores: Partial<Transform2D>,
): Partial<SobreposicaoSalva> {
  const v: Partial<Transform2D> = {}
  if (valores.x !== undefined) v.x = Math.round(limita(valores.x, -POSICAO_LIVRE, POSICAO_LIVRE) * 10) / 10
  if (valores.y !== undefined) v.y = Math.round(limita(valores.y, -POSICAO_LIVRE, POSICAO_LIVRE) * 10) / 10
  if (valores.escala !== undefined) v.escala = Math.round(limita(valores.escala, ESCALA_MINIMA, ESCALA_MAXIMA) * 1000) / 1000
  if (animado(o)) {
    if (valores.rotacao !== undefined) v.rotacao = Math.round(limita(valores.rotacao, -3600, 3600) * 10) / 10
    const base = transformNaAgulha(o, playhead)
    return { chaves: gravarChave(o.chaves!, tempoNoClipe(o, playhead), v, base, TOLERANCIA_DA_CHAVE) }
  }
  if (valores.rotacao !== undefined) v.rotacao = Math.round(giroFixo(valores.rotacao) * 10) / 10
  return v
}

/** Liga a animacao (a primeira chave, com o que se ve agora) ou grava uma chave na agulha. */
export function patchDeChaveAqui(o: Clipe, playhead: number): Partial<SobreposicaoSalva> {
  const v = transformNaAgulha(o, playhead)
  return { chaves: gravarChave(o.chaves ?? [], tempoNoClipe(o, playhead), v, v, TOLERANCIA_DA_CHAVE) }
}

/** Tira a chave da agulha. Tirando a ultima, o clipe fica parado no valor dela. */
export function patchSemChaveAqui(o: Clipe, playhead: number): Partial<SobreposicaoSalva> {
  const i = chaveEm(o.chaves, tempoNoClipe(o, playhead), TOLERANCIA_DA_CHAVE)
  if (i < 0 || !o.chaves) return {}
  const resto = o.chaves.filter((_, j) => j !== i)
  if (resto.length > 0) return { chaves: resto }
  const c = o.chaves[i]!
  return { chaves: undefined, x: c.x, y: c.y, escala: c.escala, rotacao: Math.round(giroFixo(c.rotacao) * 10) / 10 }
}

/** Desliga a animacao: o clipe fica parado no que se ve na agulha. */
export function patchSemAnimacao(o: Clipe, playhead: number): Partial<SobreposicaoSalva> {
  const v = transformNaAgulha(o, playhead)
  return { chaves: undefined, x: v.x, y: v.y, escala: v.escala, rotacao: Math.round(giroFixo(v.rotacao) * 10) / 10 }
}
