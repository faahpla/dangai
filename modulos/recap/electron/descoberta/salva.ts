import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  decisaoDaDescobertaSchema,
  discoveryReadyDoMotorSchema,
  type DecisaoGuardada,
  type DiscoveryReadyDoMotor,
} from '../../shared/descoberta'

/**
 * A DESCOBERTA GRAVADA NO DISCO e a DECISAO de quem esta dando os nomes (O1 e
 * O2, pedidos do Levi em 18/10). O formato do motor esta em
 * motor/app/descoberta_salva.py.
 *
 * - A descoberta: <pasta do episodio>/metadata/discovery/descoberta.json (+ os
 *   recortes e os centroides). O fim do corte grava pronta quando ha rostos
 *   sem nome, e a descoberta de agora grava e sai. Vale enquanto o
 *   shot_bounds.json for o mesmo (sha1) e ninguem tiver batizado personagem
 *   depois (<dados do motor>/cache/batismos.json).
 * - A decisao: <dados do motor>/descoberta/decisoes/<episodio>.json, gravada a
 *   cada mudanca (os nomes, juntar, ignorar, rostos tirados) -- fechar o app no
 *   meio nao perde o que ele ja fez. Sai no commit e no "Descartar".
 */

export interface DescobertaGravada {
  /** O discovery-ready da descoberta gravada (o mesmo formato do motor). */
  ev: DiscoveryReadyDoMotor
  /** Vale para o corte de agora e para o banco de nomes de agora. */
  fresca: boolean
  /** Por que nao vale (ASCII, para o log). null quando vale. */
  porque: string | null
}

function sha1DoArquivo(arquivo: string): string | null {
  try {
    return createHash('sha1').update(readFileSync(arquivo)).digest('hex')
  } catch {
    return null
  }
}

/** O contador de batismos do motor (motor/app/descoberta_salva.py, somar_batismo). */
export function batismosDoMotor(dadosDoMotor: string): number {
  try {
    const d = JSON.parse(readFileSync(join(dadosDoMotor, 'cache', 'batismos.json'), 'utf8')) as { total?: unknown }
    return typeof d.total === 'number' ? d.total : 0
  } catch {
    return 0
  }
}

/** A descoberta gravada na pasta do episodio, ou null (nao ha, ou de outra versao). */
export function lerDescobertaGravada(pastaDoEpisodio: string, dadosDoMotor: string): DescobertaGravada | null {
  const arquivo = join(pastaDoEpisodio, 'metadata', 'discovery', 'descoberta.json')
  let d: Record<string, unknown>
  try {
    d = JSON.parse(readFileSync(arquivo, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
  if (d['versao'] !== 1 || !Array.isArray(d['groups'])) return null
  const lido = discoveryReadyDoMotorSchema.safeParse({
    type: 'discovery-ready',
    episodeRoot: d['episodeRoot'],
    animeTitle: d['animeTitle'],
    season: d['season'],
    episode: d['episode'],
    totalFaces: d['totalFaces'],
    online: d['online'],
    roster: d['roster'],
    groups: d['groups'],
  })
  if (!lido.success) return null
  const corte = sha1DoArquivo(join(pastaDoEpisodio, 'metadata', 'shot_bounds.json'))
  let porque: string | null = null
  if (!corte || corte !== d['assinaturaDoCorte']) porque = 'o corte mudou depois'
  else if (batismosDoMotor(dadosDoMotor) !== d['batismos']) porque = 'nomes batizados depois'
  return { ev: lido.data, fresca: porque === null, porque }
}

// ----------------------------------------------------------------- a decisao

function pastaDasDecisoes(dadosDoMotor: string): string {
  return join(dadosDoMotor, 'descoberta', 'decisoes')
}

export function caminhoDaDecisao(dadosDoMotor: string, episodioId: string): string {
  return join(pastaDasDecisoes(dadosDoMotor), `${episodioId}.json`)
}

/** A decisao gravada deste episodio, ou null (nao ha, ou torta). */
export function lerDecisaoSalva(dadosDoMotor: string, episodioId: string): DecisaoGuardada | null {
  try {
    const d = JSON.parse(readFileSync(caminhoDaDecisao(dadosDoMotor, episodioId), 'utf8')) as Record<string, unknown>
    if (d['episodioId'] !== episodioId || !d['assinaturas'] || typeof d['assinaturas'] !== 'object') return null
    const decisao = decisaoDaDescobertaSchema.safeParse(d['decisao'])
    if (!decisao.success) return null
    const assinaturas: Record<string, string> = {}
    for (const [k, v] of Object.entries(d['assinaturas'] as Record<string, unknown>)) if (typeof v === 'string') assinaturas[k] = v
    return { episodioId, assinaturas, decisao: decisao.data }
  } catch {
    return null
  }
}

/** Grava a decisao (arquivo temporario + rename: um app morto no meio nao deixa meio arquivo). */
export function gravarDecisaoSalva(dadosDoMotor: string, guardada: DecisaoGuardada): void {
  const destino = caminhoDaDecisao(dadosDoMotor, guardada.episodioId)
  mkdirSync(pastaDasDecisoes(dadosDoMotor), { recursive: true })
  const tmp = `${destino}.tmp`
  writeFileSync(tmp, JSON.stringify({ ...guardada, atualizadoEm: new Date().toISOString() }), 'utf8')
  renameSync(tmp, destino)
}

export function apagarDecisaoSalva(dadosDoMotor: string, episodioId: string): void {
  const arquivo = caminhoDaDecisao(dadosDoMotor, episodioId)
  try {
    if (existsSync(arquivo)) rmSync(arquivo, { force: true })
  } catch {
    // Preso: sai na proxima.
  }
}
