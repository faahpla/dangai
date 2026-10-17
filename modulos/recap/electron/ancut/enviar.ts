import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { ConferenciaDoEnvio, EnvioAutomatico, ResultadoDoEnvio, SituacaoNoAncut } from '../../shared/ancut'
import { CANAIS } from '../../shared/canais'
import { configDoRecap, contexto } from '../contexto'
import { abrirIndicePorId } from '../episodio/abrir-indice'
import { saidaDoCorteCenas } from '../episodio/protegidas'
import { pastaDeDadosDoMotor } from '../motor'
import { pastaDeDocumentos } from '../settings'

/**
 * ENVIAR PARA O ANCUT (L1). A UNICA escrita do recap no AnCut HUB, e so com o
 * clique do Levi (ou o "Enviar sempre", desligado por padrao).
 *
 * O motor do recap e copia do ancut-hub-engine, com o MESMO esquema de banco
 * (motor/app/storage/db.py). Entao enviar e:
 *   1. achar o AnCut: o index.db (o cache_dir da config dele, como o
 *      mesclar.ts do nucleo) e a biblioteca (o output_dir). O AnCut lista a
 *      biblioteca PELO BANCO (headless._recent: episode.output_root), entao a
 *      linha do banco e o que faz o episodio aparecer la;
 *   2. conferir antes de escrever: o AnCut fechado (processo), o esquema do
 *      index.db instalado igual ao do motor do recap (PRAGMA table_info) e o
 *      episodio que ja existe la (substituir ou pular);
 *   3. copiar shots/, keyframes/ e metadata/ para uma pasta temporaria ao lado
 *      do destino; backup do index.db (index.db.bak-<data>); as linhas do
 *      banco do motor do recap para o do AnCut, com os ids remapeados, numa
 *      transacao so; a pasta no lugar; COMMIT. Qualquer erro: ROLLBACK, a
 *      pasta copiada sai e a antiga (se era substituir) volta ao lugar.
 *
 * Substituir nao apaga a pasta antiga do AnCut: ela fica ao lado, como
 * `<episodio>.antes-<data>` (o AnCut lista pelo banco e nao a ve). O banco
 * antigo fica no backup.
 *
 * Teste: RECAP_TESTE_ANCUT_BANCO e RECAP_TESTE_ANCUT_SAIDA apontam para
 * copias temporarias (nunca o AnCut de verdade); trocarConferenciaDoAncutAberto
 * e simularFalhaNoEnvio sao as costuras do teste.
 */

/** As tabelas que o envio escreve (todas do db.py). O esquema delas tem que ser igual nos dois bancos. */
const TABELAS = ['anime', 'episode', 'character', 'shot', 'shot_character', 'favorite', 'manual_override'] as const
/** As subpastas do episodio que vao (by_character/ e by_pair/ o organizador do AnCut refaz). */
const SUBPASTAS = ['shots', 'keyframes', 'metadata'] as const

type Linha = Record<string, SQLInputValue>

function localAppData(): string {
  return process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
}

/** Barra, caixa e barra final nao importam no Windows. */
function normal(caminho: string): string {
  return resolve(caminho).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

export interface LugarDoAncut {
  banco: string
  saida: string
}

/**
 * O cache_dir da config do AnCut. SO esse campo (e o output_dir, em
 * saidaDoCorteCenas): o resto do arquivo guarda chaves de API em texto puro e
 * nao e lido, copiado nem logado.
 */
function cacheDoAncut(pasta: string): string | null {
  try {
    const cru = JSON.parse(readFileSync(join(pasta, 'config.json'), 'utf8')) as { cache_dir?: unknown }
    return typeof cru.cache_dir === 'string' && cru.cache_dir.trim() ? cru.cache_dir.trim() : join(pasta, 'cache')
  } catch {
    return null
  }
}

/** Onde mora o AnCut nesta maquina. null = nao instalado (sem config ou sem index.db). */
export function acharAncut(): LugarDoAncut | null {
  const bancoDeTeste = process.env['RECAP_TESTE_ANCUT_BANCO']
  const saidaDeTeste = process.env['RECAP_TESTE_ANCUT_SAIDA']
  if (bancoDeTeste || saidaDeTeste) {
    return bancoDeTeste && saidaDeTeste && existsSync(bancoDeTeste) ? { banco: bancoDeTeste, saida: saidaDeTeste } : null
  }
  const pasta = join(localAppData(), 'CorteCenas', 'CorteCenas')
  const cache = cacheDoAncut(pasta)
  if (!cache) return null
  const banco = join(cache, 'index.db')
  if (!existsSync(banco)) return null
  return { banco, saida: saidaDoCorteCenas() ?? join(pastaDeDocumentos(), 'CorteCenas', 'Output') }
}

/** O index.db do motor do recap (ANIRECAP_MOTOR_DADOS/cache). */
export function bancoDoMotorDoRecap(): string {
  return join(pastaDeDadosDoMotor(), 'cache', 'index.db')
}

// ------------------------------------------------------- o AnCut aberto

function rodar(cmd: string, args: readonly string[]): Promise<string> {
  return new Promise((ok, falhou) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }, (err, saida) => {
      if (err) falhou(err)
      else ok(String(saida))
    })
  })
}

/**
 * O nome do processo do AnCut aberto, null = fechado, 'desconhecido' = nao deu
 * para conferir (e entao nao envia). O AnCut HUB, o motor dele
 * (CorteCenas.exe) e o Corte Cenas rodando do fonte (python com a pasta dele).
 * O python do motor do recap nao conta.
 */
async function processoDoAncutAberto(): Promise<string | null> {
  try {
    const lista = await rodar('tasklist', ['/FO', 'CSV', '/NH'])
    const nomes = lista
      .split(/\r?\n/)
      .map((l) => (/^"([^"]+)"/.exec(l)?.[1] ?? '').toLowerCase())
      .filter(Boolean)
    for (const n of ['ancut hub.exe', 'cortecenas.exe']) if (nomes.includes(n)) return n
    if (!nomes.some((n) => n.startsWith('python'))) return null
    const linhas = await rodar('powershell', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | ForEach-Object { $_.CommandLine }",
    ])
    for (const l of linhas.split(/\r?\n/)) {
      if (/corte ?cenas|ancut/i.test(l) && !/recap|dangai/i.test(l)) return 'Corte Cenas'
    }
    return null
  } catch {
    return 'desconhecido'
  }
}

let conferirAberto: () => Promise<string | null> = processoDoAncutAberto

/** Costura do teste: quem diz se o AnCut esta aberto. null = volta ao de verdade. */
export function trocarConferenciaDoAncutAberto(f: (() => Promise<string | null>) | null): void {
  conferirAberto = f ?? processoDoAncutAberto
}

let falhaSimulada: 'depois-das-linhas' | 'depois-da-pasta' | null = null

/** Costura do teste: o envio falha no meio (depois das linhas, ou com a pasta ja no lugar). */
export function simularFalhaNoEnvio(onde: typeof falhaSimulada): void {
  falhaSimulada = onde
}

// ------------------------------------------------------------ o banco

/** As colunas de cada tabela (ordenadas). Tabela que falta = lista vazia. */
function esquema(db: DatabaseSync): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const t of TABELAS) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]
    m.set(t, cols.map((c) => c.name).sort())
  }
  return m
}

function mesmoEsquema(a: Map<string, string[]>, b: Map<string, string[]>): boolean {
  return TABELAS.every((t) => (a.get(t) ?? []).length > 0 && (a.get(t) ?? []).join(',') === (b.get(t) ?? []).join(','))
}

/** INSERT de todas as colunas da linha menos `id` (autoincremento), com as trocadas. Devolve o id novo. */
function inserir(db: DatabaseSync, tabela: string, linha: Linha, trocar: Linha, semId = true): number {
  const dados: Linha = { ...linha, ...trocar }
  if (semId) delete dados['id']
  const cols = Object.keys(dados)
  // As tabelas de ligacao (sem id proprio): dois personagens do recap que viram o mesmo no AnCut nao derrubam o envio.
  const ou = semId ? '' : ' OR IGNORE'
  const r = db
    .prepare(`INSERT${ou} INTO ${tabela} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => dados[c] ?? null))
  return Number(r.lastInsertRowid)
}

interface Origem {
  pasta: string
  rotulo: string
  episodio: Linha
  anime: Linha
}

/** O episodio no banco do motor do recap (pela pasta, como o mesclar.ts do nucleo). */
function episodioNaOrigem(src: DatabaseSync, pasta: string): Origem | null {
  const eps = src.prepare('SELECT * FROM episode').all() as Linha[]
  const ep = eps.find((e) => typeof e['output_root'] === 'string' && normal(e['output_root']) === normal(pasta))
  if (!ep) return null
  const anime = src.prepare('SELECT * FROM anime WHERE id = ?').get(ep['anime_id']!) as Linha | undefined
  if (!anime) return null
  const kind = String(ep['kind'] ?? '')
  const rotulo = `${String(anime['title'])} ${kind && kind !== 'MOVIE' ? `${kind} ` : ''}S${String(ep['season']).padStart(2, '0')}E${String(ep['episode']).padStart(2, '0')}`
  return { pasta, rotulo, episodio: ep, anime }
}

/** O anime no AnCut: pelo id do AniList, senao pelo titulo (sem caixa). */
function animeNoAncut(db: DatabaseSync, anime: Linha): number | null {
  if (anime['anilist_id'] !== null && anime['anilist_id'] !== undefined) {
    const r = db.prepare('SELECT id FROM anime WHERE anilist_id = ?').get(anime['anilist_id']) as { id: number } | undefined
    if (r) return Number(r.id)
  }
  const r = db.prepare('SELECT id FROM anime WHERE lower(title) = lower(?)').get(String(anime['title'])) as { id: number } | undefined
  return r ? Number(r.id) : null
}

/** Os episodios do AnCut que este ocuparia: o mesmo anime/temporada/episodio/tipo, ou a mesma pasta. */
function episodiosQueJaExistem(db: DatabaseSync, origem: Origem, destino: string): number[] {
  const ids = new Set<number>()
  const animeId = animeNoAncut(db, origem.anime)
  if (animeId !== null) {
    const r = db
      .prepare('SELECT id FROM episode WHERE anime_id = ? AND season = ? AND episode = ? AND kind = ?')
      .get(animeId, origem.episodio['season']!, origem.episodio['episode']!, String(origem.episodio['kind'] ?? '')) as { id: number } | undefined
    if (r) ids.add(Number(r.id))
  }
  for (const e of db.prepare('SELECT id, output_root FROM episode').all() as { id: number; output_root: string | null }[]) {
    if (e.output_root && normal(e.output_root) === normal(destino)) ids.add(Number(e.id))
  }
  return [...ids]
}

// ------------------------------------------------------------ conferir

interface Conferido extends ConferenciaDoEnvio {
  ancut?: LugarDoAncut
  origem?: Origem
  destino?: string
}

function situacao(s: SituacaoNoAncut, mensagem: string, extra: Partial<Conferido> = {}): Conferido {
  return { situacao: s, mensagem, rotulo: extra.origem?.rotulo ?? null, ...extra }
}

/** A pasta do episodio do recap (so a biblioteca do recap, com shots/). */
function pastaDoRecap(episodioId: string): string | null {
  try {
    const { indice } = abrirIndicePorId(episodioId)
    if (indice.biblioteca.origem !== 'studio') return null
    const pasta = indice.biblioteca.pasta
    return pasta && existsSync(join(pasta, 'shots')) ? pasta : null
  } catch {
    return null
  }
}

async function conferirTudo(episodioId: string): Promise<Conferido> {
  const pasta = pastaDoRecap(episodioId)
  if (!pasta) return situacao('nao-e-do-recap', 'So episodio cortado pelo recap.')
  const ancut = acharAncut()
  if (!ancut) return situacao('sem-ancut', 'AnCut nao encontrado')
  const fonte = bancoDoMotorDoRecap()
  if (!existsSync(fonte)) return situacao('sem-banco-do-recap', 'O banco do motor do recap nao tem este episodio.')
  let src: DatabaseSync | null = null
  let db: DatabaseSync | null = null
  try {
    src = new DatabaseSync(fonte, { readOnly: true })
    const origem = episodioNaOrigem(src, pasta)
    if (!origem) return situacao('sem-banco-do-recap', 'O banco do motor do recap nao tem este episodio.')
    db = new DatabaseSync(ancut.banco, { readOnly: true })
    if (!mesmoEsquema(esquema(src), esquema(db))) {
      return situacao('esquema-diferente', 'O AnCut instalado tem outra versao do banco. Nada foi enviado.', { origem })
    }
    const aberto = await conferirAberto()
    if (aberto) {
      return situacao(
        'aberto',
        aberto === 'desconhecido' ? 'Nao deu para conferir se o AnCut esta fechado.' : 'Feche o AnCut antes de enviar.',
        { origem },
      )
    }
    const destino = join(ancut.saida, basename(dirname(pasta)), basename(pasta))
    const extra = { ancut, origem, destino }
    if (episodiosQueJaExistem(db, origem, destino).length > 0 || existsSync(destino)) {
      return situacao('ja-existe', 'Este episodio ja esta no AnCut.', extra)
    }
    return situacao('pronto', 'Pronto para enviar.', extra)
  } catch (err) {
    return situacao('sem-ancut', `Nao deu para ler o banco do AnCut (${err instanceof Error ? err.message.slice(0, 60) : 'erro'}).`)
  } finally {
    src?.close()
    db?.close()
  }
}

/** A conferencia, sem escrever nada (a tela pergunta "substituir?" com ela). */
export async function conferirEnvio(episodioId: string): Promise<ConferenciaDoEnvio> {
  const c = await conferirTudo(episodioId)
  return { situacao: c.situacao, mensagem: c.mensagem, rotulo: c.rotulo }
}

// ------------------------------------------------------------ enviar

function carimbo(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

let enviando = false

function naoEnviado(mensagem: string): ResultadoDoEnvio {
  return { enviado: false, mensagem, linhas: null, pasta: null, backup: null }
}

/**
 * Envia (ou substitui) o episodio. `substituir` so vale quando ele ja esta la;
 * sem ele, "ja existe" = pula, nada escrito.
 */
export async function enviarAoAncut(episodioId: string, substituir: boolean): Promise<ResultadoDoEnvio> {
  if (enviando) return naoEnviado('Ja tem um envio ao AnCut em andamento.')
  enviando = true
  try {
    const c = await conferirTudo(episodioId)
    if (c.situacao === 'ja-existe' && !substituir) return naoEnviado('Pulado: o episodio ja estava no AnCut.')
    if ((c.situacao !== 'pronto' && c.situacao !== 'ja-existe') || !c.ancut || !c.origem || !c.destino) return naoEnviado(c.mensagem)
    return await copiar(c.ancut, c.origem, c.destino)
  } finally {
    enviando = false
  }
}

async function copiar(ancut: LugarDoAncut, origem: Origem, destino: string): Promise<ResultadoDoEnvio> {
  const quando = carimbo()
  const temporaria = `${destino}.recap-enviando`
  // So a NOSSA temporaria de um envio que caiu antes (o sufixo e do recap).
  rmSync(temporaria, { recursive: true, force: true })
  mkdirSync(temporaria, { recursive: true })
  let antiga: string | null = null
  let novaNoLugar = false
  const desfazerPasta = (): void => {
    rmSync(novaNoLugar ? destino : temporaria, { recursive: true, force: true })
    if (antiga && existsSync(antiga) && !existsSync(destino)) renameSync(antiga, destino)
  }

  // 1. A pasta, numa temporaria ao lado do destino (mesmo disco: o rename no fim e instantaneo).
  try {
    for (const sub of SUBPASTAS) {
      const de = join(origem.pasta, sub)
      if (existsSync(de)) await cp(de, join(temporaria, sub), { recursive: true, errorOnExist: true, force: false })
    }
  } catch (err) {
    desfazerPasta()
    return naoEnviado(`Nao deu para copiar a pasta (${err instanceof Error ? err.message.slice(0, 80) : 'erro'}).`)
  }

  // 2. O backup do index.db (e do -wal, se houver), antes de qualquer escrita.
  const backup = `${ancut.banco}.bak-${quando}`
  try {
    copyFileSync(ancut.banco, backup)
    for (const extra of ['-wal', '-shm']) if (existsSync(ancut.banco + extra)) copyFileSync(ancut.banco + extra, backup + extra)
  } catch (err) {
    desfazerPasta()
    return naoEnviado(`Nao deu para fazer o backup do banco do AnCut (${err instanceof Error ? err.message.slice(0, 80) : 'erro'}).`)
  }

  // 3. As linhas, numa transacao so.
  const src = new DatabaseSync(bancoDoMotorDoRecap(), { readOnly: true })
  const db = new DatabaseSync(ancut.banco)
  const linhas = { anime: 0, episode: 0, character: 0, shot: 0, shotCharacter: 0, favorite: 0, manualOverride: 0 }
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('BEGIN IMMEDIATE')
    try {
      const epOrigem = Number(origem.episodio['id'])
      const animes = new Map<number, number>()
      const animeDestino = (idOrigem: number): number => {
        const ja = animes.get(idOrigem)
        if (ja !== undefined) return ja
        const a = src.prepare('SELECT * FROM anime WHERE id = ?').get(idOrigem) as Linha
        let id = animeNoAncut(db, a)
        if (id === null) {
          id = inserir(db, 'anime', a, {})
          linhas.anime++
        }
        animes.set(idOrigem, id)
        return id
      }
      const animeId = animeDestino(Number(origem.anime['id']))

      // Substituir: o episodio antigo sai (com o que pende dele). O backup guarda tudo.
      for (const velho of episodiosQueJaExistem(db, origem, destino)) {
        db.prepare('DELETE FROM favorite WHERE shot_id IN (SELECT id FROM shot WHERE episode_id = ?)').run(velho)
        db.prepare('DELETE FROM shot_character WHERE shot_id IN (SELECT id FROM shot WHERE episode_id = ?)').run(velho)
        db.prepare('DELETE FROM shot WHERE episode_id = ?').run(velho)
        db.prepare('DELETE FROM manual_override WHERE episode_id = ?').run(velho)
        db.prepare('DELETE FROM episode WHERE id = ?').run(velho)
      }

      const epId = inserir(db, 'episode', origem.episodio, { anime_id: animeId, output_root: destino })
      linhas.episode++

      // Os personagens: os do anime e qualquer outro que o episodio cite.
      const personagens = src
        .prepare(
          `SELECT * FROM character WHERE anime_id = ?
             OR id IN (SELECT sc.character_id FROM shot_character sc JOIN shot s ON s.id = sc.shot_id WHERE s.episode_id = ?)
             OR id IN (SELECT character_id FROM manual_override WHERE episode_id = ?)
             OR id IN (SELECT f.character_id FROM favorite f JOIN shot s ON s.id = f.shot_id WHERE s.episode_id = ?)`,
        )
        .all(Number(origem.anime['id']), epOrigem, epOrigem, epOrigem) as Linha[]
      const personagem = new Map<number, number>()
      for (const p of personagens) {
        const animeDele = animeDestino(Number(p['anime_id']))
        let id: number | null = null
        if (p['anilist_id'] !== null && p['anilist_id'] !== undefined) {
          const r = db.prepare('SELECT id FROM character WHERE anilist_id = ?').get(p['anilist_id']) as { id: number } | undefined
          if (r) id = Number(r.id)
        }
        if (id === null) {
          const r = db
            .prepare('SELECT id FROM character WHERE anime_id = ? AND lower(name) = lower(?)')
            .get(animeDele, String(p['name'])) as { id: number } | undefined
          if (r) id = Number(r.id)
        }
        if (id === null) {
          id = inserir(db, 'character', p, { anime_id: animeDele })
          linhas.character++
        }
        personagem.set(Number(p['id']), id)
      }

      const cena = new Map<number, number>()
      for (const s of src.prepare('SELECT * FROM shot WHERE episode_id = ? ORDER BY idx').all(epOrigem) as Linha[]) {
        cena.set(Number(s['id']), inserir(db, 'shot', s, { episode_id: epId }))
        linhas.shot++
      }
      for (const sc of src
        .prepare('SELECT sc.* FROM shot_character sc JOIN shot s ON s.id = sc.shot_id WHERE s.episode_id = ?')
        .all(epOrigem) as Linha[]) {
        inserir(db, 'shot_character', sc, { shot_id: cena.get(Number(sc['shot_id']))!, character_id: personagem.get(Number(sc['character_id']))! }, false)
        linhas.shotCharacter++
      }
      for (const f of src.prepare('SELECT f.* FROM favorite f JOIN shot s ON s.id = f.shot_id WHERE s.episode_id = ?').all(epOrigem) as Linha[]) {
        const quem = Number(f['character_id'])
        inserir(db, 'favorite', f, { shot_id: cena.get(Number(f['shot_id']))!, character_id: quem === 0 ? 0 : (personagem.get(quem) ?? 0) }, false)
        linhas.favorite++
      }
      for (const m of src.prepare('SELECT * FROM manual_override WHERE episode_id = ?').all(epOrigem) as Linha[]) {
        inserir(db, 'manual_override', m, { episode_id: epId, character_id: personagem.get(Number(m['character_id']))! }, false)
        linhas.manualOverride++
      }
      if (falhaSimulada === 'depois-das-linhas') throw new Error('falha simulada (depois das linhas)')

      // 4. A pasta no lugar (a antiga, se havia, fica ao lado), e so entao o COMMIT.
      if (existsSync(destino)) {
        antiga = `${destino}.antes-${quando}`
        renameSync(destino, antiga)
      }
      mkdirSync(dirname(destino), { recursive: true })
      renameSync(temporaria, destino)
      novaNoLugar = true
      if (falhaSimulada === 'depois-da-pasta') throw new Error('falha simulada (depois da pasta)')
      db.exec('COMMIT')
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* a transacao ja tinha caido */
      }
      throw err
    }
  } catch (err) {
    desfazerPasta()
    return {
      ...naoEnviado(`Nada foi enviado: ${err instanceof Error ? err.message.slice(0, 100) : 'erro'}. O banco do AnCut ficou como estava.`),
      backup,
    }
  } finally {
    db.close()
    src.close()
  }
  return {
    enviado: true,
    mensagem: `Enviado ao AnCut: ${linhas.shot} cenas.`,
    linhas,
    pasta: destino,
    backup,
  }
}

// ------------------------------------------------------ o "Enviar sempre"

/**
 * Ao fim de cada corte do recap, com "Enviar sempre" ligado: as mesmas
 * conferencias, e nunca pergunta no meio do fluxo. AnCut aberto, episodio que
 * ja esta la, esquema diferente: nao envia e avisa a tela.
 */
export async function enviarSempreAoAncut(episodioId: string): Promise<EnvioAutomatico | null> {
  if (!configDoRecap().enviarSempreAoAncut) return null
  const c = await conferirEnvio(episodioId)
  let aviso: EnvioAutomatico
  if (c.situacao !== 'pronto') {
    aviso = { episodioId, enviado: false, mensagem: `Nao enviado ao AnCut: ${c.mensagem}` }
  } else {
    const r = await enviarAoAncut(episodioId, false)
    aviso = { episodioId, enviado: r.enviado, mensagem: r.mensagem }
  }
  try {
    contexto().enviar(CANAIS.ancutAutomatico, aviso)
  } catch {
    /* sem janela: fica so o resultado */
  }
  return aviso
}
