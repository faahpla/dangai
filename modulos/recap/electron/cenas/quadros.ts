import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import type { EpisodeIndex, Plano } from '../../shared/episodio'
import {
  ABERTURA_PASSO_SEC,
  ABERTURA_SEC,
  aberturaRuim,
  DIVISAO_ALTURA,
  DIVISAO_LARGURA,
  linhaDeDivisao,
  luzDoCinza,
  movimentoEntre,
  nitidezDoCinza,
  planoDividido,
  QUADRO_ALTURA,
  QUADRO_LARGURA,
  type QuadroMedido,
} from '../../shared/quadro'
import type { SinaisDaImagem } from './casar'
import { rodarFfmpeg } from '../voz/ffmpeg'
import { pastaDaVisao } from './visao'

/**
 * [recap] OS QUADROS DE PERTO de cada plano (19/10, 4a rodada: os vetos do
 * recorte 9:16 e a acao, shared/quadro.ts): o comeco ruim e o movimento pelo
 * ffmpeg (os quadros do comeco, a 12 por segundo, e tres seguidos do meio, em cinza 64x36) e o
 * quadro que o anime ja divide pelos keyframes. Uma vez por corte do
 * episodio: o resultado mora ao lado do visao.json (quadros.json); o que ja
 * esta la nao roda de novo. Falhou um plano: fica sem a medida (o casar segue
 * sem ela). `soCache` (a grade da tela) so le.
 */

/** Sobe quando a forma (ou a conta) muda: o que estiver gravado e refeito. 2 = o comeco a 12 quadros por segundo. */
const QUADROS_VERSAO = 2
/** Planos ao mesmo tempo (cada um sao dois ffmpeg curtos). */
const JUNTOS = 6

interface MedidaDoPlano {
  /** Segundos ruins do comeco (0 = abre bem). */
  abre: number
  /** O movimento cru no meio do plano (movimentoEntre). null = nao mediu. */
  mov: number | null
  /** O anime ja divide o quadro (a linha inclinada nos keyframes). */
  div: boolean
}

interface QuadrosGravados {
  versao: number
  chave: string
  planos: Record<string, MedidaDoPlano>
}

function chaveDoIndice(indice: Pick<EpisodeIndex, 'id' | 'planos' | 'atualizadoEm'>): string {
  return `${indice.id}|${indice.planos.length}|${indice.atualizadoEm}`
}

function lerGravados(arquivo: string, chave: string): QuadrosGravados {
  try {
    const g = JSON.parse(readFileSync(arquivo, 'utf8')) as QuadrosGravados
    if (g.versao === QUADROS_VERSAO && g.chave === chave && g.planos && typeof g.planos === 'object') return g
  } catch {
    // sem gravado: mede
  }
  return { versao: QUADROS_VERSAO, chave, planos: {} }
}

function gravar(arquivo: string, g: QuadrosGravados): void {
  try {
    mkdirSync(dirname(arquivo), { recursive: true })
    const tmp = `${arquivo}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(g), 'utf8')
    renameSync(tmp, arquivo)
  } catch {
    // o cache e conveniencia
  }
}

/** Os quadros em cinza (QUADRO_LARGURA x QUADRO_ALTURA) que o ffmpeg tira com estes argumentos. */
async function quadrosCinza(args: readonly string[]): Promise<Uint8Array[]> {
  const n = QUADRO_LARGURA * QUADRO_ALTURA
  const saida = await rodarFfmpeg([...args, '-vf', `scale=${QUADRO_LARGURA}:${QUADRO_ALTURA}`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'])
  const quadros: Uint8Array[] = []
  for (let i = 0; i + n <= saida.length; i += n) quadros.push(new Uint8Array(saida.buffer, saida.byteOffset + i, n))
  return quadros
}

function medido(q: Uint8Array): QuadroMedido {
  return { luz: luzDoCinza(q), nit: nitidezDoCinza(q, QUADRO_LARGURA, QUADRO_ALTURA) }
}

/** A linha de divisao de um keyframe (cinza DIVISAO_LARGURA x DIVISAO_ALTURA). null = nao leu. */
async function linhaDoKeyframe(arquivo: string): Promise<{ forca: number; inclinacao: number } | null> {
  try {
    const { data } = await sharp(arquivo).resize(DIVISAO_LARGURA, DIVISAO_ALTURA, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true })
    return linhaDeDivisao(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), DIVISAO_LARGURA, DIVISAO_ALTURA)
  } catch {
    return null
  }
}

async function medirPlano(p: Pick<Plano, 'arquivo' | 'keyframe' | 'start' | 'end' | 'inicioNoArquivo'>): Promise<MedidaDoPlano | null> {
  if (!p.arquivo || !(p.end > p.start)) return null
  const base = p.inicioNoArquivo ?? 0
  const dur = p.end - p.start
  try {
    const comeco = await quadrosCinza(['-ss', base.toFixed(3), '-i', p.arquivo, '-t', Math.min(ABERTURA_SEC, dur).toFixed(3), '-r', (1 / ABERTURA_PASSO_SEC).toFixed(3)])
    const meio = await quadrosCinza(['-ss', (base + dur / 2).toFixed(3), '-i', p.arquivo, '-frames:v', '3'])
    const movs = meio.slice(1).map((q, i) => movimentoEntre(meio[i]!, q))
    const linhas = p.keyframe && /_1\.jpe?g$/i.test(p.keyframe)
      ? await Promise.all([0, 1, 2].map((k) => linhaDoKeyframe(p.keyframe!.replace(/_1(\.jpe?g)$/i, `_${k}$1`))))
      : []
    return {
      abre: Math.round(aberturaRuim(comeco.map(medido), meio[0] ? medido(meio[0]) : null) * 1000) / 1000,
      mov: movs.length > 0 ? Math.round((movs.reduce((a, b) => a + b, 0) / movs.length) * 1000) / 1000 : null,
      div: planoDividido(linhas),
    }
  } catch {
    return null
  }
}

const emAndamento = new Map<string, Promise<SinaisDaImagem>>()

/**
 * O comeco ruim, o movimento e os quadros divididos de cada plano do episodio,
 * do cache ou medidos agora (o que faltar). `soCache` = so le. Nunca lanca.
 */
export function quadrosDosPlanos(
  indice: Pick<EpisodeIndex, 'id' | 'planos' | 'atualizadoEm'>,
  caminhoDoIndice: string,
  soCache = false,
): Promise<SinaisDaImagem> {
  const chave = chaveDoIndice(indice)
  const k = `${chave}|${soCache}`
  const ja = emAndamento.get(k)
  if (ja) return ja
  const conta = (async (): Promise<SinaisDaImagem> => {
    const arquivo = join(pastaDaVisao(indice, caminhoDoIndice), 'quadros.json')
    const g = lerGravados(arquivo, chave)
    const faltam = soCache ? [] : indice.planos.filter((p) => !g.planos[p.id])
    for (let i = 0; i < faltam.length; i += JUNTOS) {
      await Promise.all(
        faltam.slice(i, i + JUNTOS).map(async (p) => {
          const m = await medirPlano(p)
          if (m) g.planos[p.id] = m
        }),
      )
    }
    if (faltam.length > 0) gravar(arquivo, g)
    const movimento = new Map<string, number>()
    const abremRuim = new Map<string, number>()
    const divididos = new Set<string>()
    for (const [id, m] of Object.entries(g.planos)) {
      if (m.mov !== null) movimento.set(id, m.mov)
      if (m.abre > 0) abremRuim.set(id, m.abre)
      if (m.div) divididos.add(id)
    }
    return { movimento, abremRuim, divididos }
  })()
    .catch(() => ({}))
    .finally(() => emAndamento.delete(k))
  emAndamento.set(k, conta)
  return conta
}
