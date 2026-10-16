import { readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { canonizar } from '@shared/nomes'
import {
  abrangidas,
  acharKeyframe,
  arquivosEm,
  naturalmente,
  nomesCanonicos,
  type RawShot,
} from '../library'

/**
 * A PASTA DE UM EPISODIO cortado (formato do AnCut/Corte Cenas/motor do
 * Studio), lida com as MESMAS regras da Biblioteca (library.ts):
 *
 *   <serie>/<SxxEyy>/
 *     shots/0020.mp4, shots/0164-0167.mp4   <- o que existe de verdade
 *     keyframes/0020_1.jpg
 *     metadata/shots.json                   <- retrato do momento do corte
 *     metadata/shot_bounds.json             <- `source` = o .mkv de origem
 *     metadata/characters.json
 *
 * O disco manda: o shots.json nunca e reescrito depois do corte, entao a
 * lixeira e a juncao de cenas so aparecem na lista de arquivos de shots/. Uma
 * cena e um mp4 que existe E que o json explica (`abrangidas`).
 *
 * So le. Nada aqui escreve, e e usado tanto na biblioteca do Studio quanto nas
 * do AnCut e do Corte Cenas.
 */

export interface CenaDaPasta {
  /** O nome do mp4 sem extensao: '0025' ou '0164-0167'. */
  id: string
  arquivo: string
  /** As linhas do shots.json que o arquivo cobre (uma, ou varias numa juncao). */
  linhas: RawShot[]
  start: number
  end: number
  keyframe: string | null
}

export interface PastaDoEpisodio {
  pasta: string
  /** O `anime` do shots.json (titulo que o motor achou). '' quando nao veio. */
  titulo: string
  /** O `source` do shot_bounds.json: o .mkv de onde as cenas sairam. */
  source: string | null
  /** mtime do metadata/shots.json, em ms. */
  mtimeShotsJson: number
  cenas: CenaDaPasta[]
  /** Nome cru -> nome escolhido (o mais longo do mesmo character_id). */
  canonico: ReadonlyMap<string, string>
}

/**
 * O comeco do aviso que o indice grava quando as cenas da pasta sairam de
 * OUTRO .mkv (indice.ts). A busca (procurar.ts) le por ele: um indice com esse
 * aviso nao prova de onde a pasta foi cortada.
 */
export const AVISO_DE_OUTRO_ARQUIVO = 'As cenas foram cortadas de outro arquivo'

function numero(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : ''
}

/** O `source` do shot_bounds.json, sem ler o resto. null quando nao existe ou nao abre. */
export function sourceDaPasta(pasta: string): string | null {
  try {
    const cru = JSON.parse(readFileSync(join(pasta, 'metadata', 'shot_bounds.json'), 'utf8')) as { source?: unknown }
    const source = texto(cru.source).trim()
    return source || null
  } catch {
    return null
  }
}

/** Le a pasta. null quando ela nao tem um metadata/shots.json legivel. */
export function lerPastaDoEpisodio(pasta: string): PastaDoEpisodio | null {
  const jsonPath = join(pasta, 'metadata', 'shots.json')
  let mtimeShotsJson: number
  let cru: unknown
  try {
    mtimeShotsJson = statSync(jsonPath).mtimeMs
    cru = JSON.parse(readFileSync(jsonPath, 'utf8'))
  } catch {
    return null
  }
  if (!Array.isArray(cru)) return null

  const porShot = new Map<string, RawShot>()
  for (const item of cru as RawShot[]) {
    const shot = texto(item.shot_id)
    if (shot) porShot.set(shot, item)
  }
  const titulo = (cru as RawShot[]).map((s) => texto(s.anime)).find((t) => t.length > 0) ?? ''

  const keyframes = arquivosEm(join(pasta, 'keyframes'))
  const cenas: CenaDaPasta[] = []
  for (const nome of [...arquivosEm(join(pasta, 'shots'))].sort(naturalmente)) {
    if (!nome.toLowerCase().endsWith('.mp4')) continue
    const id = nome.slice(0, -4)
    const linhas = abrangidas(id, porShot)
    if (linhas.length === 0) continue
    const inicio = linhas[0]!
    const fim = linhas[linhas.length - 1]!
    cenas.push({
      id,
      arquivo: join(pasta, 'shots', nome),
      linhas,
      start: numero(inicio.start),
      end: Math.max(numero(inicio.start), numero(fim.end)),
      keyframe: acharKeyframe(pasta, keyframes, texto(inicio.keyframe), texto(inicio.shot_id)),
    })
  }

  return {
    pasta,
    titulo,
    source: sourceDaPasta(pasta),
    mtimeShotsJson,
    cenas,
    canonico: nomesCanonicos(pasta),
  }
}

/** Personagem de uma linha do shots.json, com a confianca do motor. */
export interface PersonagemDaLinha {
  nome: string
  conf: number
}

/** Os personagens das linhas de uma cena (uniao, maior confianca), com o nome canonico. */
export function personagensDaCena(
  cena: CenaDaPasta,
  canonico: ReadonlyMap<string, string>,
): PersonagemDaLinha[] {
  const melhor = new Map<string, number>()
  for (const linha of cena.linhas) {
    if (!Array.isArray(linha.characters)) continue
    for (const item of linha.characters as { name?: unknown; confidence?: unknown }[]) {
      const cru = texto(item.name).trim()
      if (!cru) continue
      const nome = canonico.get(cru) ?? cru
      const conf = Math.min(1, Math.max(0, numero(item.confidence)))
      melhor.set(nome, Math.max(melhor.get(nome) ?? 0, conf))
    }
  }
  return [...melhor.entries()].map(([nome, conf]) => ({ nome, conf })).sort((a, b) => b.conf - a.conf)
}

/**
 * Os personagens de cada cena, na ordem de `dados.cenas`, com as grafias do
 * mesmo personagem ja unidas dentro do episodio (`canonizar`, a mesma regra da
 * Biblioteca). O character_id do motor nao basta: no Dr. Stone S4E37 do Corte
 * Cenas, "Saionji, Ukyou" (id 258) e "Ukyo Saionji" (id 266) sao a mesma
 * pessoa.
 */
export function personagensPorCena(dados: PastaDoEpisodio): PersonagemDaLinha[][] {
  const crus = dados.cenas.map((c) => personagensDaCena(c, dados.canonico))
  const contagem = new Map<string, number>()
  for (const lista of crus) for (const p of lista) contagem.set(p.nome, (contagem.get(p.nome) ?? 0) + 1)
  const mapa = canonizar(contagem)
  return crus.map((lista) => {
    const melhor = new Map<string, number>()
    for (const p of lista) {
      const nome = mapa.get(p.nome) ?? p.nome
      melhor.set(nome, Math.max(melhor.get(nome) ?? 0, p.conf))
    }
    return [...melhor.entries()].map(([nome, conf]) => ({ nome, conf })).sort((a, b) => b.conf - a.conf)
  })
}

/** Quem aparece e em quantas cenas, do mais frequente ao menos, com as grafias unidas. */
export function contarPersonagens(dados: PastaDoEpisodio): { nome: string; cenas: number }[] {
  const final = new Map<string, number>()
  for (const lista of personagensPorCena(dados)) {
    for (const p of lista) final.set(p.nome, (final.get(p.nome) ?? 0) + 1)
  }
  return [...final.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([nome, cenas]) => ({ nome, cenas }))
}

/** 'S04E37' -> {temporada 4, episodio 37, kind ''}; 'S01-OP2' -> OP 2; 'Filme (2019)' -> MOVIE. */
export function identidadeDaPasta(
  pasta: string,
): { temporada: number; episodio: number; kind: '' | 'OP' | 'ED' | 'MOVIE' } | null {
  const nome = basename(pasta)
  let m = /S(\d+)E(\d+)/i.exec(nome)
  if (m) return { temporada: Number(m[1]), episodio: Number(m[2]), kind: '' }
  m = /S(\d+)-(OP|ED)(\d+)/i.exec(nome)
  if (m) return { temporada: Number(m[1]), episodio: Number(m[3]), kind: m[2]!.toUpperCase() as 'OP' | 'ED' }
  m = /^Filme(?: \((\d{4})\))?$/i.exec(nome)
  if (m) return { temporada: 1, episodio: m[1] ? Number(m[1]) : 1, kind: 'MOVIE' }
  return null
}
