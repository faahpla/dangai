import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ffmpegPath } from './ffmpeg-path'

/**
 * MESCLAR CENAS DA BIBLIOTECA, como o AnCut faz.
 *
 * "No AnCut eu tenho a opcao de selecionar alguns clipes e mesclar... quero a
 * mesma opcao no Dangai, pra nao ter que voltar la, mesclar e sincronizar."
 *
 * Espelha o `_merge_shots` do motor do AnCut (ancut-hub-engine/app/headless.py)
 * para os dois programas continuarem vendo a mesma biblioteca:
 *
 * - o arquivo novo e `shots/<primeira>-<ultima>.mp4` -- o nome que o AnCut da e
 *   que o indexador do Dangai ja entende (ve as cenas 0010..0012 no json);
 * - episodio cortado em modo "compat"/"intra" e REENCODADO com os mesmos
 *   parametros do corte (render_output_params): emendar sem reencodar quebra o
 *   CFR, e o AnCut mediu isso. Em "off", emenda sem reencodar (-c copy);
 * - no banco do AnCut (index.db) as cenas mescladas saem e entra uma no lugar,
 *   com o idx e o keyframe da primeira e o inicio dela + a soma das duracoes.
 *
 * Diferenca de proposito: o AnCut APAGA os pedacos; aqui eles vao para a
 * `_lixeira/<data-hora>/` do episodio (a mesma pasta que a lixeira do AnCut
 * usa), para um engano ter volta.
 *
 * So CENAS SEGUIDAS: o nome "0010-0015" diz ao indexador que as cenas 11 a 14
 * estao dentro -- mesclar 10 com 15 pularia as do meio e a duracao e os
 * personagens sairiam errados.
 */

export interface ResultadoDaMescla {
  /** O caminho do clipe mesclado. */
  path: string
  /** Os caminhos que sairam (foram para a lixeira). */
  pedacos: string[]
  /** O que aconteceu no banco do AnCut. */
  ancut: 'atualizado' | 'sem-banco' | 'episodio-nao-encontrado'
  segundos: number
}

/** "0010" -> [10, 10]; "0010-0012" -> [10, 12]. */
function faixaDoNome(nome: string): [number, number] | null {
  const m = /^(\d+)(?:-(\d+))?\.mp4$/i.exec(nome)
  if (!m) return null
  const a = Number(m[1])
  const b = m[2] === undefined ? a : Number(m[2])
  return b >= a ? [a, b] : null
}

const quatro = (n: number): string => String(n).padStart(4, '0')

/** Os parametros de saida do AnCut para cada modo (keyframe_extractor.render_output_params, sem NVENC). */
function parametrosDoModo(modo: string): string[] {
  if (modo === 'compat' || modo === 'intra') {
    return [
      '-vf', 'fps=24000/1001', '-fps_mode', 'cfr',
      '-c:v', 'libx264', '-crf', '20', '-preset', 'superfast', '-profile:v', 'high',
      ...(modo === 'intra' ? ['-g', '1', '-bf', '0'] : []),
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-f', 'mp4',
    ]
  }
  return ['-c', 'copy']
}

function rodarFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let erro = ''
    child.stderr.on('data', (c: Buffer) => {
      erro += c.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(erro.trim().split(/\r?\n/).slice(-2).join(' ') || `ffmpeg saiu com ${code}`))
    })
  })
}

/** Onde mora o index.db do AnCut: o cache_dir da config dele, ou o padrao. */
function bancoDoAncut(): string | null {
  const base = process.env['LOCALAPPDATA']
  if (!base) return null
  const pasta = join(base, 'CorteCenas', 'CorteCenas')
  let cache = join(pasta, 'cache')
  try {
    const cfg = JSON.parse(readFileSync(join(pasta, 'config.json'), 'utf8')) as { cache_dir?: unknown }
    if (typeof cfg.cache_dir === 'string' && cfg.cache_dir) cache = cfg.cache_dir
  } catch {
    /* sem config: o padrao */
  }
  const banco = join(cache, 'index.db')
  return existsSync(banco) ? banco : null
}

const normal = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

function atualizarAncut(
  episodio: string,
  pedacos: readonly string[],
  novo: string,
): ResultadoDaMescla['ancut'] {
  const caminho = bancoDoAncut()
  if (!caminho) return 'sem-banco'
  const db = new DatabaseSync(caminho)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    const ep = (db.prepare('SELECT id, output_root FROM episode').all() as { id: number; output_root: string | null }[])
      .find((e) => e.output_root && normal(e.output_root) === normal(episodio))
    if (!ep) return 'episodio-nao-encontrado'
    const rels = pedacos.map((p) => relative(episodio, p))
    const linhas = (db.prepare('SELECT id, idx, file, keyframe, start, duration FROM shot WHERE episode_id = ?').all(ep.id) as {
      id: number
      idx: number
      file: string
      keyframe: string | null
      start: number
      duration: number
    }[])
      .filter((r) => rels.some((rel) => normal(rel) === normal(r.file)))
      .sort((a, b) => a.idx - b.idx)
    if (linhas.length === 0) return 'episodio-nao-encontrado'
    const primeira = linhas[0]!
    const soma = linhas.reduce((n, r) => n + r.duration, 0)
    db.exec('BEGIN')
    try {
      const apagar = db.prepare('DELETE FROM shot WHERE id = ?')
      for (const r of linhas) apagar.run(r.id)
      db.prepare('INSERT INTO shot (episode_id, idx, file, keyframe, start, end, duration) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        ep.id,
        primeira.idx,
        relative(episodio, novo),
        primeira.keyframe,
        primeira.start,
        primeira.start + soma,
        soma,
      )
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    return 'atualizado'
  } finally {
    db.close()
  }
}

/** Duracao de um mp4, pelo ffmpeg (so para dizer quantos segundos ficou). */
function duracao(path: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', path], { windowsHide: true })
    let saida = ''
    child.stderr.on('data', (c: Buffer) => {
      saida += c.toString()
    })
    child.on('close', () => {
      const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(saida)
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0)
    })
    child.on('error', () => resolve(0))
  })
}

export async function mesclarClipes(paths: readonly string[]): Promise<ResultadoDaMescla> {
  if (paths.length < 2) throw new Error('Escolha pelo menos duas cenas para mesclar.')

  const shots = dirname(paths[0]!)
  if (basename(shots).toLowerCase() !== 'shots') throw new Error('So da para mesclar cenas cortadas pelo AnCut (pasta shots).')
  if (paths.some((p) => normal(dirname(p)) !== normal(shots))) {
    throw new Error('As cenas precisam ser do mesmo episodio.')
  }
  const episodio = dirname(shots)

  const itens = paths
    .map((p) => ({ p, faixa: faixaDoNome(basename(p)) }))
    .sort((a, b) => (a.faixa?.[0] ?? 0) - (b.faixa?.[0] ?? 0))
  if (itens.some((i) => i.faixa === null)) throw new Error('Alguma cena tem um nome que o AnCut nao gera.')
  for (let k = 1; k < itens.length; k++) {
    if (itens[k]!.faixa![0] !== itens[k - 1]!.faixa![1] + 1) {
      throw new Error(
        'So da para mesclar cenas SEGUIDAS do episodio (ex.: 0010, 0011, 0012). O nome do clipe mesclado diz ao Dangai quais cenas estao dentro, e um buraco no meio deixaria duracao e personagens errados.',
      )
    }
  }
  const faltando = itens.find((i) => !existsSync(i.p))
  if (faltando) throw new Error(`Essa cena nao esta mais no disco: ${basename(faltando.p)}`)

  const de = itens[0]!.faixa![0]
  const ate = itens.at(-1)!.faixa![1]
  const destino = join(shots, `${quatro(de)}-${quatro(ate)}.mp4`)
  if (existsSync(destino)) throw new Error(`Ja existe ${basename(destino)} nesse episodio.`)

  let modo = 'off'
  try {
    modo = readFileSync(join(shots, '.export_mode'), 'utf8').trim()
  } catch {
    /* sem marca: o AnCut tambem trata como "off" */
  }

  // A lista do demuxer concat num arquivo; aspa simples se escapa fechando a string.
  const lista = join(tmpdir(), `dangai-mescla-${Date.now()}.txt`)
  writeFileSync(lista, itens.map((i) => `file '${i.p.replace(/'/g, "'\\''")}'`).join('\n') + '\n', 'utf8')
  try {
    await rodarFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', lista,
      ...parametrosDoModo(modo),
      destino,
    ])
  } catch (err) {
    rmSync(destino, { force: true })
    throw new Error(`Nao deu para mesclar: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    rmSync(lista, { force: true })
  }
  // So mexe nos pedacos DEPOIS de o mesclado existir com conteudo.
  if (!existsSync(destino) || statSync(destino).size === 0) {
    rmSync(destino, { force: true })
    throw new Error('O ffmpeg terminou sem gerar o clipe mesclado.')
  }

  // Os pedacos vao para a lixeira do episodio, no mesmo formato da do AnCut.
  const agora = new Date()
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const carimbo = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}_${p2(agora.getHours())}-${p2(agora.getMinutes())}-${p2(agora.getSeconds())}`
  const lixeira = join(episodio, '_lixeira', carimbo, 'shots')
  mkdirSync(lixeira, { recursive: true })
  const movidos: string[] = []
  for (const i of itens) {
    try {
      renameSync(i.p, join(lixeira, basename(i.p)))
      movidos.push(i.p)
    } catch {
      /* fica no lugar: o indexador o mostraria junto com o mesclado, sem quebrar nada */
    }
  }
  writeFileSync(
    join(episodio, '_lixeira', carimbo, 'dangai-mescla.json'),
    JSON.stringify({ mesclado: relative(episodio, destino), pedacos: movidos.map((p) => relative(episodio, p)) }, null, 2),
  )

  let ancut: ResultadoDaMescla['ancut'] = 'sem-banco'
  try {
    ancut = atualizarAncut(episodio, itens.map((i) => i.p), destino)
  } catch (err) {
    // O clipe ja esta pronto; o banco do AnCut e o que nao deu (aberto e travado?).
    console.warn('[mesclar] banco do AnCut nao atualizado:', err)
    ancut = 'sem-banco'
  }

  return { path: destino, pedacos: movidos, ancut, segundos: await duracao(destino) }
}
