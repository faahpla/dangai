import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type {
  ConferenciaDoEnvio,
  EnvioAutomatico,
  ModoDaMudanca,
  ResultadoDaVolta,
  ResultadoDoEnvio,
  SituacaoNoAncut,
} from '../../shared/ancut'
import { CANAIS } from '../../shared/canais'
import { episodeIndexSchema, type EpisodeIndex, type EstadoDoCorte, type EventoDoCorte } from '../../shared/episodio'
import { configDoRecap, contexto } from '../contexto'
import { haDescobertaViva } from '../descoberta/vivas'
import { abrirIndicePorId } from '../episodio/abrir-indice'
import { gravarJsonAtomico, lembrarIndice, pastaDosEpisodios } from '../episodio/perfil'
import { saidaDoCorteCenas } from '../episodio/protegidas'
import { relocarIndice, trocarRaiz } from '../episodio/relocar'
import { visaoDoEpisodioRodando } from '../cenas/visao'
import { PASTA_DOS_PROJETOS } from '../montar/pasta'
import { pastaDeDadosDoMotor } from '../motor'
import { pastaDaBibliotecaStudio, pastaDeDocumentos } from '../settings'
import {
  apagarOrigem,
  copiarEConferir,
  diferencaEntre,
  listarPasta,
  mesmoDisco,
  normal,
  paraALixeira,
  renomear,
  tirarSeVazia,
} from './pasta'

/**
 * MOVER PARA O ANCUT (L1). A UNICA escrita do recap no AnCut HUB, e so com o
 * clique do Levi (ou o "Enviar sempre", desligado por padrao).
 *
 * MOVE, nao copia ("e literalmente pra quem nao quer a biblioteca separada",
 * "pq se nao come mt espaco"): depois, o episodio mora SO na biblioteca do
 * AnCut, e no recap fica o indice pequeno (_indices/<id>/episodio.json, com os
 * caminhos trocados para la, e o id -> arquivo do perfil).
 *
 * O motor do recap e copia do ancut-hub-engine, com o MESMO esquema de banco
 * (motor/app/storage/db.py). Entao mover e:
 *   1. achar o AnCut: o index.db (o cache_dir da config dele, como o
 *      mesclar.ts do nucleo) e a biblioteca (o output_dir). O AnCut lista a
 *      biblioteca PELO BANCO (headless._recent: episode.output_root), entao a
 *      linha do banco e o que faz o episodio aparecer la;
 *   2. conferir antes de escrever: o AnCut fechado (processo), o esquema do
 *      index.db instalado igual ao do motor do recap (PRAGMA table_info) e o
 *      episodio que ja existe la (substituir ou pular; IGUAL = unificar);
 *   3. outro disco: copiar a pasta para uma temporaria escondida ao lado do
 *      destino e conferir (lista, tamanhos e sha256 dos .json); backup do
 *      index.db; as linhas do banco do motor do recap para o do AnCut, com os
 *      ids remapeados, numa transacao so; os arquivos do recap (o indice, o
 *      historico dele e a visao) para _indices/<id>; a pasta no lugar (mesmo
 *      disco: rename); o indice novo, o perfil, o output_root no banco do
 *      motor do recap e os projetos do recap que apontavam a pasta velha;
 *      COMMIT. Qualquer erro: ROLLBACK e tudo volta como estava (a pasta, o
 *      indice, o banco do motor, os projetos).
 *   4. depois do COMMIT: outro disco -> a pasta daqui sai (ja conferida la);
 *      substituir -> a pasta antiga do AnCut vai para a Lixeira do Windows.
 *
 * O "Reconhecer agora" de um episodio que mora no AnCut traz ele de volta
 * (trazerDoAncut: as linhas saem do index.db, com backup, e a pasta volta),
 * reconhece no recap e devolve (o mover de sempre).
 *
 * Teste: RECAP_TESTE_ANCUT_BANCO e RECAP_TESTE_ANCUT_SAIDA apontam para
 * copias temporarias (nunca o AnCut de verdade); trocarConferenciaDoAncutAberto,
 * simularFalhaNoEnvio, simularOutroDisco e trocarLixeira (pasta.ts) sao as
 * costuras do teste.
 */

/** As tabelas que o envio escreve (todas do db.py). O esquema delas tem que ser igual nos dois bancos. */
const TABELAS = ['anime', 'episode', 'character', 'shot', 'shot_character', 'favorite', 'manual_override'] as const
/** O que diz se duas copias do episodio sao a mesma (o que a versao antiga copiava). */
const SUBPASTAS = ['shots', 'keyframes', 'metadata'] as const

type Linha = Record<string, SQLInputValue>
type Desfazer = () => void

function localAppData(): string {
  return process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
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

type PontoDeFalha = 'depois-das-linhas' | 'depois-da-pasta' | 'antes-do-commit' | 'antes-da-lixeira' | null
let falhaSimulada: PontoDeFalha = null

/** Costura do teste: a mudanca falha no meio (depois das linhas, com a pasta ja no lugar, antes do COMMIT, antes da Lixeira). */
export function simularFalhaNoEnvio(onde: PontoDeFalha): void {
  falhaSimulada = onde
}

function talvezFalhar(onde: Exclude<PontoDeFalha, null>): void {
  if (falhaSimulada === onde) throw new Error(`falha simulada (${onde})`)
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
  for (const id of episodiosNaPasta(db, destino)) ids.add(id)
  return [...ids]
}

/** Os episodios do AnCut cuja pasta (output_root) e esta. */
function episodiosNaPasta(db: DatabaseSync, pasta: string): number[] {
  return (db.prepare('SELECT id, output_root FROM episode').all() as { id: number; output_root: string | null }[])
    .filter((e) => e.output_root && normal(e.output_root) === normal(pasta))
    .map((e) => Number(e.id))
}

/** O episodio sai do AnCut com o que pende dele (cenas, ligacoes, favoritos, curadoria). O backup guarda tudo. */
function apagarEpisodio(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM favorite WHERE shot_id IN (SELECT id FROM shot WHERE episode_id = ?)').run(id)
  db.prepare('DELETE FROM shot_character WHERE shot_id IN (SELECT id FROM shot WHERE episode_id = ?)').run(id)
  db.prepare('DELETE FROM shot WHERE episode_id = ?').run(id)
  db.prepare('DELETE FROM manual_override WHERE episode_id = ?').run(id)
  db.prepare('DELETE FROM episode WHERE id = ?').run(id)
}

type ContagemDeLinhas = NonNullable<ResultadoDoEnvio['linhas']>

const NENHUMA_LINHA: ContagemDeLinhas = { anime: 0, episode: 0, character: 0, shot: 0, shotCharacter: 0, favorite: 0, manualOverride: 0 }

/** As linhas do episodio, do banco do motor do recap para o do AnCut (dentro da transacao de quem chama). */
function inserirLinhas(db: DatabaseSync, src: DatabaseSync, origem: Origem, destino: string): ContagemDeLinhas {
  const linhas = { ...NENHUMA_LINHA }
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
      const r = db.prepare('SELECT id FROM character WHERE anime_id = ? AND lower(name) = lower(?)').get(animeDele, String(p['name'])) as
        | { id: number }
        | undefined
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
  return linhas
}

// ------------------------------------------------------------ conferir

interface Conferido extends ConferenciaDoEnvio {
  ancut?: LugarDoAncut
  origem?: Origem
  destino?: string
  indice?: EpisodeIndex
}

function situacao(s: SituacaoNoAncut, mensagem: string, extra: Partial<Conferido> = {}): Conferido {
  return { situacao: s, mensagem, rotulo: extra.origem?.rotulo ?? null, ...extra }
}

/** So as tres subpastas que a versao antiga copiava (o resto -- by_character, o indice, a visao -- nao conta). */
function foraDasSubpastas(rel: string): boolean {
  return !rel.includes(sep) && !(SUBPASTAS as readonly string[]).includes(rel.toLowerCase())
}

/** As duas copias tem as mesmas shots/, keyframes/ e metadata/ (lista, tamanhos e sha256 dos .json)? */
function copiasIguais(a: string, b: string): boolean {
  try {
    return diferencaEntre(listarPasta(a, foraDasSubpastas), listarPasta(b, foraDasSubpastas)) === null
  } catch {
    return false
  }
}

/**
 * Tudo que se confere antes de escrever. `processo: false` pula a conferencia
 * do AnCut aberto (o tasklist), para a tela saber o rotulo do botao sem custo;
 * quem vai escrever sempre confere de novo com ela.
 */
async function conferirTudo(episodioId: string, processo: boolean): Promise<Conferido> {
  let indice: EpisodeIndex
  try {
    indice = abrirIndicePorId(episodioId).indice
  } catch {
    return situacao('nao-e-do-recap', 'So episodio cortado pelo recap.')
  }
  if (indice.biblioteca.origem === 'ancut' && indice.biblioteca.movidoDoRecap) {
    return situacao('no-ancut', 'Uma copia so, na biblioteca do AnCut.', { indice })
  }
  const pasta = indice.biblioteca.origem === 'studio' && existsSync(join(indice.biblioteca.pasta, 'shots')) ? indice.biblioteca.pasta : null
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
      return situacao('esquema-diferente', 'O AnCut instalado tem outra versao do banco. Nada foi movido.', { origem })
    }
    const destino = join(ancut.saida, basename(dirname(pasta)), basename(pasta))
    const extra = { ancut, origem, destino, indice }
    const existentes = episodiosQueJaExistem(db, origem, destino)
    // Copiado pela versao antiga: a pasta la, o banco de la apontando ela, e IGUAL. Unificar nao escreve no AnCut.
    if (existsSync(destino) && episodiosNaPasta(db, destino).length > 0 && copiasIguais(pasta, destino)) {
      return situacao('unificar', 'Ja esta igual no AnCut.', extra)
    }
    if (processo) {
      const aberto = await conferirAberto()
      if (aberto) {
        return situacao(
          'aberto',
          aberto === 'desconhecido' ? 'Nao deu para conferir se o AnCut esta fechado.' : 'Feche o AnCut antes de mover.',
          { origem },
        )
      }
    }
    if (existentes.length > 0 || existsSync(destino)) return situacao('ja-existe', 'Este episodio ja esta no AnCut.', extra)
    return situacao('pronto', 'Pronto para mover.', extra)
  } catch (err) {
    return situacao('sem-ancut', `Nao deu para ler o banco do AnCut (${err instanceof Error ? err.message.slice(0, 60) : 'erro'}).`)
  } finally {
    src?.close()
    db?.close()
  }
}

/** A conferencia, sem escrever nada (a tela pergunta "substituir?" com ela). `rapido` = sem conferir o processo. */
export async function conferirEnvio(episodioId: string, rapido = false): Promise<ConferenciaDoEnvio> {
  const c = await conferirTudo(episodioId, !rapido)
  return { situacao: c.situacao, mensagem: c.mensagem, rotulo: c.rotulo }
}

// --------------------------------------------- o que anda junto com a pasta

function carimbo(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/** O primeiro nome livre: x.json, x-2.json, x-3.json... */
function livre(caminho: string): string {
  if (!existsSync(caminho)) return caminho
  const m = /^(.*?)(\.[^.\\/]*)?$/.exec(caminho)!
  for (let n = 2; ; n++) {
    const outro = `${m[1]}-${n}${m[2] ?? ''}`
    if (!existsSync(outro)) return outro
  }
}

/** "2026-10-13T13:55:01.123Z" -> "20261013-135501" (o carimbo do historico do indice, como o guardarAnterior). */
function carimboDoIndice(arquivo: string): string {
  let quando = ''
  try {
    quando = String((JSON.parse(readFileSync(arquivo, 'utf8')) as { atualizadoEm?: unknown }).atualizadoEm ?? '')
  } catch {
    /* sem data: a de agora */
  }
  const d = new Date(quando)
  return (Number.isFinite(d.getTime()) ? d : new Date()).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

/** Os arquivos do RECAP no primeiro nivel da pasta do episodio: o indice, o historico dele e a visao (cenas/visao.ts). */
export function ehDoRecap(nome: string): boolean {
  if (nome.includes(sep) || nome.includes('/')) return false
  return /^episodio(\..+)?\.json$/i.test(nome) || /^episodio\.json\..+\.tmp$/i.test(nome) || nome.toLowerCase() === 'visao'
}

/** Rename que se desfaz. */
function mover(de: string, para: string, desfazer: Desfazer[]): void {
  renomear(de, para)
  desfazer.push(() => renameSync(para, de))
}

/**
 * Os arquivos do recap saem da pasta do episodio para _indices/<id> (o mesmo
 * disco da biblioteca do recap: renames): o indice e o historico dele viram
 * historico la, e a visao vai inteira. O indice que ja estava em _indices
 * (de antes do corte) tambem vira historico.
 */
function tirarArquivosDoRecap(pasta: string, doIndice: string, quando: string, desfazer: Desfazer[]): void {
  mkdirSync(doIndice, { recursive: true })
  const externo = join(doIndice, 'episodio.json')
  if (existsSync(externo)) mover(externo, livre(join(doIndice, `episodio.${carimboDoIndice(externo)}.json`)), desfazer)
  for (const nome of readdirSync(pasta)) {
    if (!ehDoRecap(nome)) continue
    const de = join(pasta, nome)
    if (nome.toLowerCase() === 'visao') {
      const la = join(doIndice, 'visao')
      if (existsSync(la)) mover(la, livre(join(doIndice, `visao.antes-${quando}`)), desfazer)
      mover(de, la, desfazer)
    } else if (nome.toLowerCase() === 'episodio.json') mover(de, livre(join(doIndice, `episodio.${carimboDoIndice(de)}.json`)), desfazer)
    else mover(de, livre(join(doIndice, nome)), desfazer)
  }
}

/** Grava o texto (temporario + rename) e guarda o de antes para desfazer. */
function trocarTexto(arquivo: string, novo: string, desfazer: Desfazer[]): void {
  const antes = readFileSync(arquivo, 'utf8')
  const temp = `${arquivo}.${process.pid}.tmp`
  writeFileSync(temp, novo, 'utf8')
  renameSync(temp, arquivo)
  desfazer.push(() => writeFileSync(arquivo, antes, 'utf8'))
}

/**
 * Os caminhos da visao (o melhor quadro de cada plano, cenas/visao.ts) trocam
 * de raiz junto com a pasta: as medidas valem do mesmo jeito (o atualizadoEm
 * do indice nao muda), so os keyframes mudaram de lugar.
 */
function trocarRaizDaVisao(pastaDaVisao: string, de: string, para: string, desfazer: Desfazer[]): void {
  const arquivo = join(pastaDaVisao, 'visao.json')
  if (!existsSync(arquivo)) return
  let v: { quadros?: { arquivo?: unknown }[] | null }
  try {
    v = JSON.parse(readFileSync(arquivo, 'utf8')) as typeof v
  } catch {
    return
  }
  if (!Array.isArray(v.quadros)) return
  let mudou = false
  for (const q of v.quadros) {
    if (typeof q.arquivo !== 'string') continue
    const n = trocarRaiz(q.arquivo, de, para)
    if (n !== q.arquivo) {
      q.arquivo = n
      mudou = true
    }
  }
  if (mudou) trocarTexto(arquivo, JSON.stringify(v), desfazer)
}

/** Caminho absoluto do Windows (letra ou UNC): o unico tipo de texto que os projetos trocam. */
const CAMINHO_ABSOLUTO = /^(?:[A-Za-z]:[\\/]|\\\\)/

function trocarCaminhos(valor: unknown, de: string, para: string): { valor: unknown; trocas: number } {
  if (typeof valor === 'string') {
    if (!CAMINHO_ABSOLUTO.test(valor)) return { valor, trocas: 0 }
    const n = trocarRaiz(valor, de, para)
    return n === valor ? { valor, trocas: 0 } : { valor: n, trocas: 1 }
  }
  if (Array.isArray(valor)) {
    let trocas = 0
    const lista = valor.map((v) => {
      const r = trocarCaminhos(v, de, para)
      trocas += r.trocas
      return r.valor
    })
    return { valor: lista, trocas }
  }
  if (valor && typeof valor === 'object') {
    let trocas = 0
    const obj: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor)) {
      const r = trocarCaminhos(v, de, para)
      trocas += r.trocas
      obj[k] = r.valor
    }
    return { valor: obj, trocas }
  }
  return { valor, trocas: 0 }
}

/**
 * Os projetos que o "Abrir no editor" gravou (<biblioteca do recap>/_projetos)
 * apontam os mp4 pelo caminho: os que usam a pasta velha passam a apontar a
 * nova, senao deixariam de abrir. So os caminhos mudam; o resto do arquivo
 * fica como ele editou. Devolve quantos projetos mudaram.
 */
function trocarRaizDosProjetos(de: string, para: string, desfazer: Desfazer[]): number {
  const raiz = join(pastaDaBibliotecaStudio(), PASTA_DOS_PROJETOS)
  let pastas: string[] = []
  try {
    pastas = readdirSync(raiz, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(raiz, e.name))
  } catch {
    return 0
  }
  const procurado = JSON.stringify(normal(de)).slice(1, -1)
  let n = 0
  for (const pasta of pastas) {
    let nomes: string[] = []
    try {
      nomes = readdirSync(pasta).filter((nome) => /\.dangai$/i.test(nome))
    } catch {
      continue
    }
    for (const nome of nomes) {
      const arquivo = join(pasta, nome)
      let texto: string
      try {
        texto = readFileSync(arquivo, 'utf8')
      } catch {
        continue
      }
      // Atalho: so abre o JSON de quem cita a pasta (sem caixa).
      if (!texto.toLowerCase().includes(procurado)) continue
      let dados: unknown
      try {
        dados = JSON.parse(texto)
      } catch {
        continue
      }
      const r = trocarCaminhos(dados, de, para)
      if (r.trocas === 0) continue
      const recuo = /^\{\r?\n(\s+)"/.exec(texto)?.[1]?.length ?? 0
      trocarTexto(arquivo, JSON.stringify(r.valor, null, recuo || undefined), desfazer)
      n++
    }
  }
  return n
}

/** O output_root do episodio no banco do motor do recap (o "Reconhecer agora" e o proximo mover acham ele por la). */
function trocarRaizNoMotor(epId: number, para: string, desfazer: Desfazer[]): void {
  const db = new DatabaseSync(bancoDoMotorDoRecap())
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    const antes = (db.prepare('SELECT output_root FROM episode WHERE id = ?').get(epId) as { output_root: string | null } | undefined)?.output_root ?? null
    db.prepare('UPDATE episode SET output_root = ? WHERE id = ?').run(para, epId)
    desfazer.push(() => {
      const d = new DatabaseSync(bancoDoMotorDoRecap())
      try {
        d.exec('PRAGMA busy_timeout = 5000')
        d.prepare('UPDATE episode SET output_root = ? WHERE id = ?').run(antes, epId)
      } finally {
        d.close()
      }
    })
  } finally {
    db.close()
  }
}

/** O indice novo no lugar (atomico) e o perfil apontando para ele. Desfazer devolve o perfil byte a byte. */
function gravarIndice(caminho: string, indice: EpisodeIndex, desfazer: Desfazer[]): EpisodeIndex {
  const valido = episodeIndexSchema.parse(indice)
  gravarJsonAtomico(caminho, valido)
  desfazer.push(() => rmSync(caminho, { force: true }))
  const mapa = join(pastaDosEpisodios(), 'indices.json')
  const antes = existsSync(mapa) ? readFileSync(mapa, 'utf8') : null
  lembrarIndice(indice.id, caminho)
  desfazer.push(() => (antes === null ? rmSync(mapa, { force: true }) : writeFileSync(mapa, antes, 'utf8')))
  return valido
}

/** Desfaz na ordem contraria; um passo que falha nao segura os outros. Devolve quantos falharam. */
function desfazerTudo(desfazer: Desfazer[]): number {
  let falhas = 0
  for (const passo of desfazer.reverse()) {
    try {
      passo()
    } catch (err) {
      falhas++
      console.error('[ancut] nao deu para desfazer um passo:', err)
    }
  }
  return falhas
}

/** O corte 'pronto' do indice, para o evento da tela (o indice de antes do corte em segundo plano nao tem). */
function estadoDoIndice(indice: EpisodeIndex): EstadoDoCorte {
  return (
    indice.corte ?? {
      status: 'pronto',
      jobId: null,
      progresso: 1,
      etapa: null,
      mensagem: '',
      motor: 'studio',
      reconhecer: indice.reconhecimento === 'feito',
      erro: null,
      inicio: null,
      atualizadoEm: indice.atualizadoEm,
      descoberta: null,
    }
  )
}

/** A tela do passo 1 (e o passo 4) trocam de indice pelo mesmo evento do fim do corte. */
function avisarIndiceNovo(indice: EpisodeIndex): void {
  try {
    contexto().enviar(CANAIS.corteProgresso, { episodioId: indice.id, estado: estadoDoIndice(indice), indice } satisfies EventoDoCorte)
  } catch {
    /* sem janela (teste): fica so o resultado */
  }
}

/** Algo do motor mexendo nesta pasta agora: nao muda de lugar. */
function ocupadoAgora(episodioId: string): string | null {
  if (haDescobertaViva(episodioId)) return 'Esse episodio esta no Reconhecer na mao. Termine antes.'
  if (visaoDoEpisodioRodando(episodioId)) return 'O motor esta vendo as cenas desse episodio. Tente daqui a pouco.'
  return null
}

function curto(err: unknown, n = 100): string {
  return err instanceof Error ? err.message.slice(0, n) : 'erro'
}

// ------------------------------------------------------------ mover

let ocupado = false

function naoEnviado(mensagem: string): ResultadoDoEnvio {
  return { enviado: false, mensagem, linhas: null, pasta: null, backup: null, modo: null, indice: null }
}

/**
 * Move (ou substitui) o episodio. `substituir` so vale quando ele ja esta la,
 * diferente; sem ele, "ja existe" = pula, nada escrito. Igual la (copiado pela
 * versao antiga) = unifica.
 */
export async function enviarAoAncut(episodioId: string, substituir: boolean): Promise<ResultadoDoEnvio> {
  if (ocupado) return naoEnviado('Ja tem uma mudanca para o AnCut em andamento.')
  ocupado = true
  try {
    const c = await conferirTudo(episodioId, true)
    const preso = ocupadoAgora(episodioId)
    if (c.situacao === 'unificar' && c.origem && c.destino && c.indice) return preso ? naoEnviado(preso) : await unificar(c.origem, c.destino, c.indice)
    if (c.situacao === 'ja-existe' && !substituir) return naoEnviado('Pulado: o episodio ja estava no AnCut.')
    if ((c.situacao !== 'pronto' && c.situacao !== 'ja-existe') || !c.ancut || !c.origem || !c.destino || !c.indice) return naoEnviado(c.mensagem)
    if (preso) return naoEnviado(preso)
    return await moverPasta(c.ancut, c.origem, c.destino, c.indice)
  } finally {
    ocupado = false
  }
}

/** "Unificar" pelo botao (a mesma conferencia; so faz se estiver igual). */
export async function unificarComOAncut(episodioId: string): Promise<ResultadoDoEnvio> {
  if (ocupado) return naoEnviado('Ja tem uma mudanca para o AnCut em andamento.')
  ocupado = true
  try {
    const c = await conferirTudo(episodioId, false)
    if (c.situacao !== 'unificar' || !c.origem || !c.destino || !c.indice) {
      return naoEnviado(c.situacao === 'ja-existe' ? 'As duas copias nao estao iguais: nada foi mexido.' : c.mensagem)
    }
    const preso = ocupadoAgora(episodioId)
    if (preso) return naoEnviado(preso)
    return await unificar(c.origem, c.destino, c.indice)
  } finally {
    ocupado = false
  }
}

async function moverPasta(ancut: LugarDoAncut, origem: Origem, destino: string, indice: EpisodeIndex): Promise<ResultadoDoEnvio> {
  const quando = carimbo()
  const recap = origem.pasta
  const doIndice = join(pastaDaBibliotecaStudio(), '_indices', indice.id)
  const indiceNovo = join(doIndice, 'episodio.json')
  const outroDisco = !mesmoDisco(recap, destino)
  // Escondida (o ponto na frente): as varreduras da Biblioteca e do recap pulam.
  const temporaria = join(dirname(destino), `.${basename(destino)}.recap-movendo`)
  let modo: ModoDaMudanca = outroDisco ? 'copia' : 'rename'

  // 1. Outro disco: a copia conferida ao lado do destino, antes de tudo (pode demorar; nada foi escrito ainda).
  if (outroDisco) {
    // So a NOSSA temporaria de uma mudanca que caiu antes (o nome e do recap).
    rmSync(temporaria, { recursive: true, force: true })
    try {
      await copiarEConferir(recap, temporaria, ehDoRecap)
    } catch (err) {
      return naoEnviado(`Nada foi movido: a copia para o disco do AnCut falhou (${curto(err, 80)}).`)
    }
  }

  // 2. O backup do index.db (e do -wal, se houver), antes de qualquer escrita.
  const backup = `${ancut.banco}.bak-${quando}`
  try {
    copyFileSync(ancut.banco, backup)
    for (const extra of ['-wal', '-shm']) if (existsSync(ancut.banco + extra)) copyFileSync(ancut.banco + extra, backup + extra)
  } catch (err) {
    rmSync(temporaria, { recursive: true, force: true })
    return naoEnviado(`Nada foi movido: sem o backup do banco do AnCut (${curto(err, 80)}).`)
  }

  const desfazer: Desfazer[] = []
  let antiga: string | null = null
  let linhas = { ...NENHUMA_LINHA }
  let novo: EpisodeIndex
  const src = new DatabaseSync(bancoDoMotorDoRecap(), { readOnly: true })
  const db = new DatabaseSync(ancut.banco)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('BEGIN IMMEDIATE')
    try {
      // 3. As linhas, numa transacao so. Substituir: o episodio antigo sai antes (o backup guarda tudo).
      for (const velho of episodiosQueJaExistem(db, origem, destino)) apagarEpisodio(db, velho)
      linhas = inserirLinhas(db, src, origem, destino)
      talvezFalhar('depois-das-linhas')

      // 4. Os arquivos do recap (o indice, o historico dele e a visao) saem da pasta para _indices/<id>.
      tirarArquivosDoRecap(recap, doIndice, quando, desfazer)

      // 5. A pasta no lugar. Substituir: a antiga do AnCut vai para o lado, escondida (a Lixeira depois do COMMIT).
      if (existsSync(destino)) {
        antiga = join(dirname(destino), `.${basename(destino)}.antes-${quando}`)
        mover(destino, antiga, desfazer)
      }
      if (outroDisco) mover(temporaria, destino, desfazer)
      else {
        try {
          mover(recap, destino, desfazer)
        } catch (err) {
          // Letra diferente que e o mesmo disco nao cai aqui; o contrario (mesma letra, outro volume montado) sim.
          if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
          modo = 'copia'
          await copiarEConferir(recap, temporaria, ehDoRecap)
          mover(temporaria, destino, desfazer)
        }
      }
      talvezFalhar('depois-da-pasta')

      // 6. O recap passa a ler a pasta do AnCut: o indice novo, o perfil, o banco do motor e os projetos.
      if (existsSync(join(doIndice, 'visao'))) trocarRaizDaVisao(join(doIndice, 'visao'), recap, destino, desfazer)
      const relocado = relocarIndice(indice, destino)
      novo = gravarIndice(indiceNovo, { ...relocado, biblioteca: { origem: 'ancut', pasta: destino, movidoDoRecap: true } }, desfazer)
      trocarRaizNoMotor(Number(origem.episodio['id']), destino, desfazer)
      trocarRaizDosProjetos(recap, destino, desfazer)
      talvezFalhar('antes-do-commit')
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
    const falhas = desfazerTudo(desfazer)
    rmSync(temporaria, { recursive: true, force: true })
    return {
      ...naoEnviado(
        `Nada foi movido: ${curto(err)}. ${falhas === 0 ? 'Ficou tudo como estava.' : `${falhas} passo(s) nao voltaram: confira a pasta.`}`,
      ),
      backup,
    }
  } finally {
    db.close()
    src.close()
  }

  // 7. Depois do COMMIT (nada mais volta): outro disco -> a pasta daqui sai, ja conferida la.
  let sobra = ''
  if (modo === 'copia' && !apagarOrigem(recap)) sobra = ' A pasta daqui nao saiu inteira (arquivo aberto?): apague depois.'
  if (antiga) {
    try {
      await paraALixeira(antiga)
    } catch {
      sobra += ` A versao antiga do AnCut ficou em ${basename(antiga)}.`
    }
  }
  tirarSeVazia(dirname(recap))
  avisarIndiceNovo(novo)
  return {
    enviado: true,
    mensagem: `No AnCut: ${linhas.shot} cenas, uma copia so.${sobra}`,
    linhas,
    pasta: destino,
    backup,
    modo,
    indice: novo,
  }
}

/**
 * UNIFICAR: o episodio ja esta IGUAL no AnCut (a versao antiga copiava). O
 * recap passa a usar a copia de la (o indice, o perfil, o banco do motor e os
 * projetos apontam para ela) e a daqui vai para a Lixeira do Windows. Nada e
 * escrito no AnCut. A Lixeira falhou: tudo volta.
 */
async function unificar(origem: Origem, destino: string, indice: EpisodeIndex): Promise<ResultadoDoEnvio> {
  const quando = carimbo()
  const recap = origem.pasta
  const doIndice = join(pastaDaBibliotecaStudio(), '_indices', indice.id)
  const indiceNovo = join(doIndice, 'episodio.json')
  const desfazer: Desfazer[] = []
  let novo: EpisodeIndex
  try {
    // Confere de novo, na hora: so a mesma copia vai para a Lixeira.
    if (!copiasIguais(recap, destino)) return naoEnviado('As duas copias nao estao iguais: nada foi mexido.')
    tirarArquivosDoRecap(recap, doIndice, quando, desfazer)
    if (existsSync(join(doIndice, 'visao'))) trocarRaizDaVisao(join(doIndice, 'visao'), recap, destino, desfazer)
    novo = gravarIndice(indiceNovo, { ...relocarIndice(indice, destino), biblioteca: { origem: 'ancut', pasta: destino, movidoDoRecap: true } }, desfazer)
    trocarRaizNoMotor(Number(origem.episodio['id']), destino, desfazer)
    trocarRaizDosProjetos(recap, destino, desfazer)
    talvezFalhar('antes-da-lixeira')
    await paraALixeira(recap)
  } catch (err) {
    const falhas = desfazerTudo(desfazer)
    return naoEnviado(
      `Nada foi unificado: ${curto(err)}. ${falhas === 0 ? 'Ficou tudo como estava.' : `${falhas} passo(s) nao voltaram: confira a pasta.`}${/Lixeira recusou/.test(curto(err)) ? ' Reabra o Dangai e tente de novo.' : ''}`,
    )
  }
  tirarSeVazia(dirname(recap))
  avisarIndiceNovo(novo)
  return {
    enviado: true,
    mensagem: 'Unificado: fica so a copia do AnCut. A daqui foi para a Lixeira.',
    linhas: { ...NENHUMA_LINHA },
    pasta: destino,
    backup: null,
    modo: 'unificado',
    indice: novo,
  }
}

// ------------------------------------------------- trazer de volta (Reconhecer agora)

function naoTrazido(mensagem: string): ResultadoDaVolta {
  return { trazido: false, mensagem, pasta: null, backup: null, indice: null }
}

/**
 * O "Reconhecer agora" de um episodio que mora no AnCut: ele VOLTA para a
 * biblioteca do recap (o motor do recap so grava na biblioteca dele, e ali
 * reaproveita o corte e os rostos), com as mesmas conferencias do mover. As
 * linhas dele saem do index.db do AnCut (com backup) para o AnCut nunca listar
 * uma pasta que nao esta la. Depois do reconhecimento, a tela devolve (o mover
 * de sempre). Uma copia so o tempo todo.
 */
export async function trazerDoAncut(episodioId: string): Promise<ResultadoDaVolta> {
  if (ocupado) return naoTrazido('Ja tem uma mudanca para o AnCut em andamento.')
  ocupado = true
  try {
    let indice: EpisodeIndex
    try {
      indice = abrirIndicePorId(episodioId).indice
    } catch (err) {
      return naoTrazido(curto(err))
    }
    if (indice.biblioteca.origem !== 'ancut' || !indice.biblioteca.movidoDoRecap) return naoTrazido('So episodio que o recap moveu para o AnCut.')
    const la = indice.biblioteca.pasta
    if (!existsSync(join(la, 'shots'))) return naoTrazido('A pasta do episodio nao esta mais no AnCut.')
    const ancut = acharAncut()
    if (!ancut) return naoTrazido('AnCut nao encontrado')
    const aqui = join(pastaDaBibliotecaStudio(), basename(dirname(la)), basename(la))
    if (existsSync(aqui)) return naoTrazido('Ja tem uma pasta desse episodio no recap. Nada foi mexido.')
    const preso = ocupadoAgora(episodioId)
    if (preso) return naoTrazido(preso)

    let origem: Origem | null = null
    let ids: number[] = []
    {
      const src = new DatabaseSync(bancoDoMotorDoRecap(), { readOnly: true })
      const db = new DatabaseSync(ancut.banco, { readOnly: true })
      try {
        origem = episodioNaOrigem(src, la)
        if (origem && !mesmoEsquema(esquema(src), esquema(db))) return naoTrazido('O AnCut instalado tem outra versao do banco. Nada foi mexido.')
        ids = episodiosNaPasta(db, la)
      } finally {
        src.close()
        db.close()
      }
    }
    if (!origem) return naoTrazido('O banco do motor do recap nao tem este episodio.')
    const aberto = await conferirAberto()
    if (aberto) return naoTrazido(aberto === 'desconhecido' ? 'Nao deu para conferir se o AnCut esta fechado.' : 'Feche o AnCut antes de reconhecer.')
    return await trazer(ancut, origem, indice, la, aqui, ids)
  } finally {
    ocupado = false
  }
}

async function trazer(ancut: LugarDoAncut, origem: Origem, indice: EpisodeIndex, la: string, aqui: string, ids: number[]): Promise<ResultadoDaVolta> {
  const quando = carimbo()
  const doIndice = join(pastaDaBibliotecaStudio(), '_indices', indice.id)
  const indiceExterno = join(doIndice, 'episodio.json')
  const outroDisco = !mesmoDisco(la, aqui)
  const temporaria = join(dirname(aqui), `.${basename(aqui)}.recap-voltando`)
  let modo: 'rename' | 'copia' = outroDisco ? 'copia' : 'rename'

  if (outroDisco) {
    rmSync(temporaria, { recursive: true, force: true })
    try {
      await copiarEConferir(la, temporaria)
    } catch (err) {
      return naoTrazido(`Nada foi mexido: a copia de volta falhou (${curto(err, 80)}).`)
    }
  }
  const backup = `${ancut.banco}.bak-${quando}`
  try {
    copyFileSync(ancut.banco, backup)
    for (const extra of ['-wal', '-shm']) if (existsSync(ancut.banco + extra)) copyFileSync(ancut.banco + extra, backup + extra)
  } catch (err) {
    rmSync(temporaria, { recursive: true, force: true })
    return naoTrazido(`Nada foi mexido: sem o backup do banco do AnCut (${curto(err, 80)}).`)
  }

  const desfazer: Desfazer[] = []
  let novo: EpisodeIndex
  const db = new DatabaseSync(ancut.banco)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const id of ids) apagarEpisodio(db, id)
      talvezFalhar('depois-das-linhas')
      if (outroDisco) mover(temporaria, aqui, desfazer)
      else {
        try {
          mover(la, aqui, desfazer)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
          modo = 'copia'
          await copiarEConferir(la, temporaria)
          mover(temporaria, aqui, desfazer)
        }
      }
      talvezFalhar('depois-da-pasta')
      // O indice volta para dentro da pasta (origem 'studio'); o de _indices vira historico; a visao vai junto.
      if (existsSync(indiceExterno)) mover(indiceExterno, livre(join(doIndice, `episodio.${carimboDoIndice(indiceExterno)}.json`)), desfazer)
      if (existsSync(join(doIndice, 'visao')) && !existsSync(join(aqui, 'visao'))) {
        mover(join(doIndice, 'visao'), join(aqui, 'visao'), desfazer)
        trocarRaizDaVisao(join(aqui, 'visao'), la, aqui, desfazer)
      }
      const relocado = relocarIndice(indice, aqui)
      novo = gravarIndice(join(aqui, 'episodio.json'), { ...relocado, biblioteca: { origem: 'studio', pasta: aqui } }, desfazer)
      trocarRaizNoMotor(Number(origem.episodio['id']), aqui, desfazer)
      trocarRaizDosProjetos(la, aqui, desfazer)
      talvezFalhar('antes-do-commit')
      db.exec('COMMIT')
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* ja tinha caido */
      }
      throw err
    }
  } catch (err) {
    const falhas = desfazerTudo(desfazer)
    rmSync(temporaria, { recursive: true, force: true })
    return {
      ...naoTrazido(`Nada foi mexido: ${curto(err)}. ${falhas === 0 ? 'Ficou tudo como estava.' : `${falhas} passo(s) nao voltaram: confira a pasta.`}`),
      backup,
    }
  } finally {
    db.close()
  }
  let sobra = ''
  if (modo === 'copia' && !apagarOrigem(la)) sobra = ' A pasta do AnCut nao saiu inteira (arquivo aberto?).'
  tirarSeVazia(dirname(la))
  avisarIndiceNovo(novo)
  return { trazido: true, mensagem: `De volta ao recap para reconhecer.${sobra}`, pasta: aqui, backup, indice: novo }
}

// ------------------------------------------------------ o "Enviar sempre"

/**
 * Ao fim de cada corte (e de cada reconhecimento) do recap, com "Enviar
 * sempre" ligado: as mesmas conferencias, e nunca pergunta no meio do fluxo.
 * AnCut aberto, nao achado, esquema diferente, episodio ja la diferente: fica
 * no recap e avisa a tela. Igual la: unifica. `forcar` = devolver ao AnCut o
 * episodio que veio de la para o "Reconhecer agora" (mesmo desligado).
 */
export async function enviarSempreAoAncut(episodioId: string, opcoes: { forcar?: boolean } = {}): Promise<EnvioAutomatico | null> {
  if (!opcoes.forcar && !configDoRecap().enviarSempreAoAncut) return null
  const c = await conferirEnvio(episodioId)
  if (c.situacao === 'no-ancut' || c.situacao === 'nao-e-do-recap') return null
  let aviso: EnvioAutomatico
  if (c.situacao !== 'pronto' && c.situacao !== 'unificar') {
    aviso = { episodioId, enviado: false, mensagem: `Ficou no recap: ${c.mensagem}` }
  } else {
    const r = await enviarAoAncut(episodioId, false)
    aviso = { episodioId, enviado: r.enviado, mensagem: r.enviado ? r.mensagem : `Ficou no recap: ${r.mensagem}` }
  }
  try {
    contexto().enviar(CANAIS.ancutAutomatico, aviso)
  } catch {
    /* sem janela: fica so o resultado */
  }
  return aviso
}
