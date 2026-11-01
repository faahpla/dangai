/**
 * MOVER PARA O ANCUT (L1), NUNCA contra o AnCut de verdade.
 *
 * Tudo numa pasta temporaria (RECAP_TESTE_PASTA, ou o temp do sistema):
 *   - a biblioteca do recap: uma COPIA de um episodio ja cortado (o Magic Repo
 *     Man de G:/Dangai Recap/Biblioteca ou o Nia Liston de G:/AniRecap
 *     Studio/Biblioteca, so lidos), com o indice, a visao e um projeto do
 *     "Abrir no editor" apontando as cenas;
 *   - o banco do motor do recap num perfil temporario, com o esquema do
 *     motor/app/storage/db.py e as linhas do episodio;
 *   - o "AnCut": um index.db com o esquema do db.py e outro anime ja dentro
 *     (os ids tem que ser remapeados) e uma biblioteca vazia; e as COPIAS dos
 *     index.db do AnCut desta maquina (esquema antigo), para a recusa.
 *     RECAP_TESTE_ANCUT_BANCO/RECAP_TESTE_ANCUT_SAIDA apontam para eles.
 *   - RECAP_TESTE_OUTRO_DISCO (opcional): um segundo AnCut em OUTRO disco, para
 *     a copia + conferencia + remocao de verdade. Sem ele, so a simulada.
 *
 * Confere: as recusas; o MOVER no mesmo disco (rename: a pasta sai do recap,
 * o espaco antes x depois e de uma copia so, o indice em _indices com os
 * caminhos trocados, o perfil, o output_root do motor, a visao, o projeto, a
 * Biblioteca so com a raiz do AnCut); o "Reconhecer agora" (trazer de volta e
 * devolver); a falha no meio em cada ponto = ROLLBACK (tudo igual byte a
 * byte); outro disco (copia + confere + remove, de verdade e simulado);
 * UNIFICAR (igual la -> a daqui na Lixeira; diferente recusa; Lixeira que
 * falha volta tudo; a Lixeira de verdade com uma pasta pequena);
 * SUBSTITUIR (a antiga do AnCut na Lixeira); o "Enviar sempre"; o AnCut que
 * apaga o episodio depois (= cortar de novo); a biblioteca do AnCut recusada
 * com o recado do "Enviar sempre".
 *
 * Rodar da raiz:
 *   npx esbuild modulos/recap/teste/v-ancut-enviar.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-ancut-enviar.cjs
 *   npx electron out/teste/v-ancut-enviar.cjs
 */
import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, parse, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { episodiosEm } from '../../../electron/services/library'
import { guardarContexto } from '../electron/contexto'
import { configDoRecap as configDoModulo } from '../electron/config'
import { abrirIndicePorId } from '../electron/episodio/abrir-indice'
import { configurarEpisodios, indiceLembrado } from '../electron/episodio/perfil'
import { relocarIndice } from '../electron/episodio/relocar'
import { configurarMotor } from '../electron/motor'
import {
  acharAncut,
  bancoDoMotorDoRecap,
  conferirEnvio,
  enviarAoAncut,
  enviarSempreAoAncut,
  simularFalhaNoEnvio,
  trazerDoAncut,
  trocarConferenciaDoAncutAberto,
  unificarComOAncut,
} from '../electron/ancut/enviar'
import { paraALixeira, simularOutroDisco, tamanhoDaPasta, trocarLixeira } from '../electron/ancut/pasta'
import { RECADO_BIBLIOTECA_DO_ANCUT } from '../shared/ancut'
import { CONFIG_PADRAO, type ConfigDoRecap } from '../shared/config'
import { lerIndice, type EpisodeIndex } from '../shared/episodio'

// Fora do Electron (tsx/node puro) o `app` nao existe: pular com aviso em vez de
// quebrar -- e nunca cair num userData na raiz do repo. Rode pelo electron (ver acima).
if (!process.versions.electron) {
  console.log('v-ancut-enviar: pulado (precisa do Electron: npx electron <bundle>)')
  process.exit(0)
}

let falhas = 0
let total = 0
function ok(nome: string, cond: boolean, detalhe = ''): void {
  total++
  if (cond) console.log(`  ok   ${nome}${detalhe ? `  (${detalhe})` : ''}`)
  else {
    falhas++
    console.log(`  FALHA ${nome}${detalhe ? `\n        ${detalhe}` : ''}`)
  }
}

/** Os episodios ja cortados que servem de fonte (so lidos), o primeiro que existir. */
const FONTES = [
  process.env['RECAP_TESTE_EPISODIO'] ?? '',
  'G:\\Dangai Recap\\Biblioteca\\Magic Repo Man Dumped by My Party Ill Cash In With a Cute Support Fairy to Become the Strongest\\S01E01',
  'G:\\AniRecap Studio\\Biblioteca\\Nia Liston The Merciless Maiden\\S01E01',
].filter((p) => p && existsSync(join(p, 'shots')) && existsSync(join(p, 'episodio.json')))
const FONTE = FONTES[0] ?? ''
const ANIME = FONTE ? basename(dirname(FONTE)) : 'x'
const BASE = resolve(process.env['RECAP_TESTE_PASTA'] || join(tmpdir(), 'recap-v-ancut'))
const USER = join(BASE, 'userData')
const BIB = join(BASE, 'biblioteca-recap')
const EP = join(BIB, ANIME, 'S01E01')
const ANCUT = join(BASE, 'ancut')
const BANCO = join(ANCUT, 'cache', 'index.db')
const SAIDA = join(ANCUT, 'Output')
const DESTINO = join(SAIDA, ANIME, 'S01E01')
const LIXEIRA_FALSA = join(BASE, 'lixeira-falsa')
const OUTRO = process.env['RECAP_TESTE_OUTRO_DISCO'] ? resolve(process.env['RECAP_TESTE_OUTRO_DISCO'], 'recap-v-ancut-outro') : ''
rmSync(BASE, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })
app.setPath('userData', USER)

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')
const gb = (n: number): string => `${(n / 1024 ** 3).toFixed(2)} GB`

/** Lista (caminho relativo, tamanho e o sha256 dos .json, ou de tudo) de uma pasta. */
function foto(pasta: string, tudo = false): string[] {
  const saida: string[] = []
  const andar = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) andar(p)
      else saida.push(`${relative(pasta, p)}|${statSync(p).size}${tudo || /\.json$/i.test(e.name) ? `|${sha(p)}` : ''}`)
    }
  }
  if (existsSync(pasta)) andar(pasta)
  return saida.sort()
}

/** O SCHEMA do motor/app/storage/db.py (a fonte da verdade do esquema dos dois bancos). */
function esquemaDoMotor(): string {
  const py = readFileSync(join(process.cwd(), 'modulos', 'recap', 'motor', 'app', 'storage', 'db.py'), 'utf8')
  const m = /SCHEMA = """([\s\S]*?)"""/.exec(py)
  if (!m) throw new Error('SCHEMA do db.py nao achado')
  return m[1]!
}

function outputRootNoMotor(): string | null {
  const db = new DatabaseSync(bancoDoMotorDoRecap(), { readOnly: true })
  try {
    return (db.prepare('SELECT output_root FROM episode WHERE id = 3').get() as { output_root: string | null }).output_root
  } finally {
    db.close()
  }
}

function contarNoAncut(banco = BANCO): { episodios: number; cenasDoEp: number } {
  const db = new DatabaseSync(banco, { readOnly: true })
  try {
    const eps = db.prepare("SELECT id FROM episode WHERE output_root LIKE '%S01E01'").all() as { id: number }[]
    const n = eps.length ? (db.prepare('SELECT count(*) AS n FROM shot WHERE episode_id = ?').get(eps[0]!.id) as { n: number }).n : 0
    return { episodios: eps.length, cenasDoEp: n }
  } finally {
    db.close()
  }
}

/** O AnCut temporario: o esquema do db.py com OUTRO anime ja dentro (ids ocupados) e o mesmo anime pelo AniList. */
function criarAncut(banco: string, saida: string, schema: string): void {
  mkdirSync(dirname(banco), { recursive: true })
  mkdirSync(saida, { recursive: true })
  const db = new DatabaseSync(banco)
  db.exec(schema)
  db.exec("INSERT INTO anime (id, anilist_id, title) VALUES (1, 131573, 'Dr. STONE'), (2, NULL, 'Mushoku Tensei'), (5, 171018, 'O anime do teste')")
  db.exec("INSERT INTO episode (id, anime_id, season, episode, output_root, kind) VALUES (1, 1, 4, 24, 'X:\\\\Output\\\\Dr STONE\\\\S04E24', '')")
  db.exec("INSERT INTO character (id, anilist_id, anime_id, name, role) VALUES (1, 900, 1, 'Senku', 'MAIN'), (2, 300001, 5, 'Personagem A', 'MAIN')")
  const cena = db.prepare('INSERT INTO shot (episode_id, idx, file, keyframe, start, end, duration) VALUES (1, ?, ?, NULL, 0, 1, 1)')
  for (let i = 0; i < 1500; i++) cena.run(i, `shots\\${String(i).padStart(4, '0')}.mp4`)
  db.exec('INSERT INTO shot_character (shot_id, character_id, confidence) VALUES (1, 1, 0.9)')
  db.close()
}

let config: ConfigDoRecap = { ...CONFIG_PADRAO, biblioteca: BIB }

/** O estado inteiro que um rollback tem que devolver igual. */
function estado(): string {
  return JSON.stringify({
    recap: foto(EP),
    indices: foto(join(BIB, '_indices')),
    projetos: foto(join(BIB, '_projetos'), true),
    ancut: foto(SAIDA),
    banco: sha(BANCO),
    perfil: indiceLembrado(ID),
    motor: outputRootNoMotor(),
  })
}

let ID = ''

async function testes(): Promise<void> {
  if (!FONTE) {
    console.log('sem episodio cortado nesta maquina para copiar: teste pulado')
    return
  }
  const avisos: { canal: string; dados: unknown }[] = []
  configurarEpisodios(join(USER, 'modulos', 'recap'))
  configurarMotor({ userData: join(USER, 'modulos', 'recap'), appPath: process.cwd(), empacotado: false })
  guardarContexto({
    id: 'recap',
    config: () => ({ libraryDir: SAIDA, iaProvedor: 'gemini', whisperModel: 'small', modulo: config }),
    chave: () => '',
    ligado: () => true,
    enviar: (canal: string, dados: unknown) => avisos.push({ canal, dados }),
  } as unknown as ContextoDoModulo)
  const lixeiraFalsa = async (caminho: string): Promise<void> => {
    mkdirSync(LIXEIRA_FALSA, { recursive: true })
    renameSync(caminho, join(LIXEIRA_FALSA, `${Date.now()}-${basename(caminho)}`))
  }
  trocarLixeira(lixeiraFalsa)

  // ------------------------------------------------ 0. o cenario temporario
  console.log(`0. copias temporarias em ${BASE} (a fonte so e lida: ${FONTE})`)
  const antesDaFonte = foto(FONTE)
  mkdirSync(EP, { recursive: true })
  for (const nome of readdirSync(FONTE)) {
    if (nome === 'episodio.json' || !statSync(join(FONTE, nome)).isDirectory()) continue
    cpSync(join(FONTE, nome), join(EP, nome), { recursive: true, preserveTimestamps: true })
  }
  // O indice da copia com os caminhos dela (como o recap teria gravado).
  const doDisco = lerIndice(JSON.parse(readFileSync(join(FONTE, 'episodio.json'), 'utf8')))
  const indice0: EpisodeIndex = { ...relocarIndice(doDisco, EP), biblioteca: { origem: 'studio', pasta: EP } }
  writeFileSync(join(EP, 'episodio.json'), JSON.stringify(indice0, null, 2))
  ID = indice0.id
  // Um historico do indice e a visao (o melhor quadro aponta um keyframe da pasta).
  writeFileSync(join(EP, 'episodio.20261018-030000.json'), JSON.stringify({ ...indice0, atualizadoEm: '2026-10-18T03:00:00.000Z' }))
  const kf = indice0.planos.find((p) => p.keyframe)!.keyframe!
  mkdirSync(join(EP, 'visao'), { recursive: true })
  writeFileSync(join(EP, 'visao', 'visao.json'), JSON.stringify({ versao: 1, chave: 'x', quadros: [{ id: `${indice0.planos[0]!.id}|1`, arquivo: kf, beleza: 0.5, nitidez: 0.5 }], cues: null, tags: null, gpu: null, tempos: {} }))
  writeFileSync(join(EP, 'visao', 'imagens.f32'), Buffer.alloc(3072))
  // Um projeto do "Abrir no editor" apontando duas cenas (e um caminho de fora, que fica).
  const PROJ = join(BIB, '_projetos', `${ANIME} S01E01 - 2026-10-18 10h00`, `${ANIME} S01E01.dangai`)
  mkdirSync(dirname(PROJ), { recursive: true })
  const cena0 = indice0.planos[0]!.arquivo
  const cena1 = indice0.planos[1]!.arquivo
  writeFileSync(
    PROJ,
    JSON.stringify(
      {
        version: 2,
        audio: { path: join(dirname(PROJ), 'narracao.wav'), fileName: 'narracao.wav', rel: 'narracao.wav' },
        images: [
          { path: cena0, fileName: basename(cena0), rel: null, url: 'http://127.0.0.1:1234/x' },
          { path: cena1, fileName: basename(cena1), rel: null },
        ],
        music: { path: 'G:\\Musicas\\tema.mp3', fileName: 'tema.mp3', rel: null },
      },
      null,
      2,
    ),
  )
  const projetoAntes = readFileSync(PROJ, 'utf8')
  const shotsJson = JSON.parse(readFileSync(join(EP, 'metadata', 'shots.json'), 'utf8')) as { file: string; keyframe: string; start: number; end: number; duration: number }[]
  ok('copia do episodio feita', foto(EP).length > 100, `${shotsJson.length} cenas, ${gb(tamanhoDaPasta(EP))}`)

  // O banco do motor do recap (perfil temporario): o esquema do db.py e as linhas do episodio.
  const schema = esquemaDoMotor()
  const fonte = bancoDoMotorDoRecap()
  mkdirSync(dirname(fonte), { recursive: true })
  {
    const src = new DatabaseSync(fonte)
    src.exec(schema)
    src.exec("INSERT INTO anime (id, anilist_id, mal_id, title, title_english) VALUES (7, NULL, NULL, 'Outro anime do recap', NULL)")
    src.prepare('INSERT INTO anime (id, anilist_id, mal_id, title, title_english) VALUES (9, 171018, 59002, ?, NULL)').run(ANIME)
    src.prepare("INSERT INTO episode (id, anime_id, season, episode, source_file, processed_at, output_root, kind) VALUES (3, 9, 1, 1, ?, CURRENT_TIMESTAMP, ?, '')").run(indice0.fonte.path, EP)
    const personagem = src.prepare('INSERT INTO character (id, anilist_id, mal_id, anime_id, name, role, threshold, reference_count, embedding) VALUES (?, ?, NULL, 9, ?, ?, 0.74, 3, ?)')
    personagem.run(21, 300001, 'Personagem A', 'MAIN', new Uint8Array([1, 2, 3, 4]))
    personagem.run(22, 300002, 'Personagem B', 'MAIN', new Uint8Array([5, 6, 7]))
    personagem.run(23, null, 'Personagem C', 'SUPPORTING', null)
    const cena = src.prepare('INSERT INTO shot (id, episode_id, idx, file, keyframe, start, end, duration) VALUES (?, 3, ?, ?, ?, ?, ?, ?)')
    shotsJson.forEach((s, i) => cena.run(1000 + i, i, s.file.replace(/\//g, '\\'), s.keyframe.replace(/\//g, '\\'), s.start, s.end, s.duration))
    const liga = src.prepare('INSERT INTO shot_character (shot_id, character_id, confidence, reviewed, approved) VALUES (?, ?, ?, ?, ?)')
    for (let i = 10; i < 20; i++) liga.run(1000 + i, 21, 0.81, 0, null)
    for (let i = 15; i < 18; i++) liga.run(1000 + i, 22, 0.77, 1, 1)
    liga.run(1100, 23, 0.9, 0, null)
    src.exec('INSERT INTO favorite (shot_id, character_id) VALUES (1012, 21), (1050, 0)')
    src.exec("INSERT INTO manual_override (episode_id, shot_idx, character_id, action, confidence) VALUES (3, 40, 22, 'add', 0.95)")
    src.close()
  }
  criarAncut(BANCO, SAIDA, schema)
  process.env['RECAP_TESTE_ANCUT_BANCO'] = BANCO
  process.env['RECAP_TESTE_ANCUT_SAIDA'] = SAIDA
  const lugar = acharAncut()
  ok('o AnCut temporario e achado pela env de teste', lugar?.banco === BANCO && lugar.saida === SAIDA)

  // ------------------------------------------------ 1. recusas
  console.log('\n1. recusas (nada escrito)')
  trocarConferenciaDoAncutAberto(async () => null)
  {
    // Um AnCut de esquema antigo (sem output_root): recusa. Feito aqui, porque o
    // AnCut desta maquina atualizou (31/10) e ja tem o esquema do motor.
    const velho = join(BASE, 'ancut-esquema-antigo.db')
    copyFileSync(BANCO, velho)
    {
      const db = new DatabaseSync(velho)
      db.exec('ALTER TABLE episode DROP COLUMN output_root')
      db.close()
    }
    const antesDoVelho = sha(velho)
    process.env['RECAP_TESTE_ANCUT_BANCO'] = velho
    {
      const c = await conferirEnvio(ID)
      const r = await enviarAoAncut(ID, true)
      ok('AnCut de esquema antigo: esquema diferente, recusa', c.situacao === 'esquema-diferente' && !r.enviado && sha(velho) === antesDoVelho, c.mensagem)
    }
    // As copias dos index.db do AnCut desta maquina: so a conferencia (nada e
    // enviado aqui, o resto do teste precisa do episodio no recap). Esquema
    // antigo recusa; o atual fica pronto.
    const reais = [join(process.env['LOCALAPPDATA'] ?? '', 'CorteCenas', 'CorteCenas', 'cache', 'index.db'), 'G:\\App Corte Cenas\\cache\\index.db'].filter((p) =>
      existsSync(p),
    )
    for (const [i, real] of reais.entries()) {
      const copia = join(BASE, `ancut-real-${i}.db`)
      copyFileSync(real, copia)
      const antes = sha(copia)
      process.env['RECAP_TESTE_ANCUT_BANCO'] = copia
      const c = await conferirEnvio(ID)
      ok(
        `copia do index.db do AnCut desta maquina (${i + 1}/${reais.length}): recusa se o esquema e outro, senao pronto`,
        (c.situacao === 'esquema-diferente' || c.situacao === 'pronto' || c.situacao === 'ja-existe') && sha(copia) === antes,
        c.mensagem,
      )
    }
    process.env['RECAP_TESTE_ANCUT_BANCO'] = BANCO
  }
  const antesDasRecusas = estado()
  trocarConferenciaDoAncutAberto(async () => 'ancut hub.exe')
  {
    const c = await conferirEnvio(ID)
    const r = await enviarAoAncut(ID, false)
    ok('AnCut aberto: recusa, nada escrito', c.situacao === 'aberto' && !r.enviado && estado() === antesDasRecusas, c.mensagem)
  }
  trocarConferenciaDoAncutAberto(async () => 'desconhecido')
  ok('sem como conferir o processo: recusa', (await conferirEnvio(ID)).situacao === 'aberto')
  trocarConferenciaDoAncutAberto(async () => null)
  {
    delete process.env['RECAP_TESTE_ANCUT_SAIDA']
    ok('so uma das envs de teste: AnCut nao encontrado (nunca cai no de verdade)', acharAncut() === null && (await conferirEnvio(ID)).mensagem === 'AnCut nao encontrado')
    process.env['RECAP_TESTE_ANCUT_SAIDA'] = SAIDA
  }
  ok('nenhum backup criado nas recusas', !readdirSync(join(BANCO, '..')).some((n) => n.includes('.bak-')))
  ok('o rotulo rapido (sem o processo) diz pronto', (await conferirEnvio(ID, true)).situacao === 'pronto')

  // ------------------------------------------------ 2. a falha no meio (ROLLBACK), mesmo disco e copia
  console.log('\n2. falha no meio = tudo volta (rollback)')
  for (const outro of [false, true]) {
    simularOutroDisco(outro)
    for (const onde of ['depois-das-linhas', 'depois-da-pasta', 'antes-do-commit'] as const) {
      const antes = estado()
      simularFalhaNoEnvio(onde)
      const r = await enviarAoAncut(ID, false)
      simularFalhaNoEnvio(null)
      const sobra = readdirSync(SAIDA).length === 0 || readdirSync(join(SAIDA, ANIME)).length === 0
      ok(`${outro ? 'outro disco' : 'mesmo disco'}, falha ${onde}: nada movido, tudo igual (pasta, indices, projeto, banco, perfil, motor)`, !r.enviado && estado() === antes && sobra, r.mensagem)
    }
  }
  simularOutroDisco(false)
  for (const n of readdirSync(join(BANCO, '..')).filter((x) => x.includes('.bak-'))) rmSync(join(BANCO, '..', n))

  // ------------------------------------------------ 3. o mover (mesmo disco: rename)
  console.log('\n3. mover no mesmo disco (rename)')
  const tamanhoDoEp = tamanhoDaPasta(EP)
  const espacoAntes = { recap: tamanhoDaPasta(BIB), ancut: tamanhoDaPasta(SAIDA) }
  const fotoAntes = foto(EP).filter((l) => !/^(episodio[^\\]*\.json|visao\\)/.test(l))
  const bancoAntes = sha(BANCO)
  const episodiosAntes = { recap: [...episodiosEm(BIB, 0)].length, ancut: [...episodiosEm(SAIDA, 0)].length }
  const t0 = Date.now()
  const r = await enviarAoAncut(ID, false)
  const ms = Date.now() - t0
  ok('movido (rename, instantaneo)', r.enviado && r.modo === 'rename' && ms < 5000, `${r.mensagem} em ${ms} ms`)
  ok('linhas: anime reaproveitado (anilist), 1 episodio, 2 personagens novos, todas as cenas, 14 ligacoes, 2 favoritos, 1 curadoria',
    JSON.stringify(r.linhas) === JSON.stringify({ anime: 0, episode: 1, character: 2, shot: shotsJson.length, shotCharacter: 14, favorite: 2, manualOverride: 1 }),
    JSON.stringify(r.linhas))
  ok('a pasta saiu do recap e esta no AnCut, igual (lista, tamanhos, sha256 dos .json)', !existsSync(EP) && r.pasta === DESTINO && foto(DESTINO).join('\n') === fotoAntes.join('\n'), `${foto(DESTINO).length} arquivos`)
  ok('a pasta do anime vazia no recap saiu', !existsSync(join(BIB, ANIME)))
  ok('backup = o banco de antes, byte a byte', r.backup !== null && existsSync(r.backup) && sha(r.backup) === bancoAntes)
  const espacoDepois = { recap: tamanhoDaPasta(BIB), ancut: tamanhoDaPasta(SAIDA) }
  const somaAntes = espacoAntes.recap + espacoAntes.ancut
  const somaDepois = espacoDepois.recap + espacoDepois.ancut
  console.log(`     espaco antes:  recap ${gb(espacoAntes.recap)} + AnCut ${gb(espacoAntes.ancut)} = ${gb(somaAntes)}`)
  console.log(`     espaco depois: recap ${gb(espacoDepois.recap)} + AnCut ${gb(espacoDepois.ancut)} = ${gb(somaDepois)}`)
  ok('espaco: uma copia so (a soma nao cresce o tamanho do episodio; a versao antiga somava +1 copia)',
    Math.abs(somaDepois - somaAntes) < 1024 * 1024 && espacoDepois.ancut >= tamanhoDoEp * 0.99 && espacoDepois.recap < 5 * 1024 * 1024,
    `diferenca ${somaDepois - somaAntes} bytes; episodio ${gb(tamanhoDoEp)}`)
  {
    const aberto = abrirIndicePorId(ID)
    const i = aberto.indice
    const caminhoNovo = join(BIB, '_indices', ID, 'episodio.json')
    ok('o indice novo em _indices, origem AnCut, movido pelo recap', aberto.caminho === caminhoNovo && i.biblioteca.origem === 'ancut' && i.biblioteca.pasta === DESTINO && i.biblioteca.movidoDoRecap === true)
    ok('os caminhos das cenas trocados para a pasta do AnCut (e existem)', i.planos.every((p) => p.arquivo.startsWith(DESTINO) && (p.keyframe === null || p.keyframe.startsWith(DESTINO))) && existsSync(i.planos[0]!.arquivo) && existsSync(i.planos.at(-1)!.arquivo))
    ok('o resto do indice igual (falas, marcacoes, atualizadoEm)', JSON.stringify(i.cues) === JSON.stringify(indice0.cues) && JSON.stringify(i.exclusoes) === JSON.stringify(indice0.exclusoes) && i.atualizadoEm === indice0.atualizadoEm)
    ok('o perfil (indices.json) aponta o indice novo', indiceLembrado(ID) === caminhoNovo)
    const doIndice = readdirSync(join(BIB, '_indices', ID)).sort()
    ok('o indice velho e o historico viraram historico em _indices (nada apagado)', doIndice.includes('episodio.20261018-030000.json') && doIndice.filter((n) => /^episodio\.\d{8}-\d{6}(-\d+)?\.json$/.test(n)).length >= 2, doIndice.join(', '))
    const visao = JSON.parse(readFileSync(join(BIB, '_indices', ID, 'visao', 'visao.json'), 'utf8')) as { quadros: { arquivo: string }[] }
    ok('a visao foi junto para _indices, com o melhor quadro apontando o AnCut', visao.quadros[0]!.arquivo === kf.replace(EP, DESTINO) && existsSync(visao.quadros[0]!.arquivo) && existsSync(join(BIB, '_indices', ID, 'visao', 'imagens.f32')))
    ok('nenhum arquivo do recap ficou na pasta do AnCut', !readdirSync(DESTINO).some((n) => /^episodio/i.test(n) || n === 'visao'))
    ok('o banco do motor do recap aponta a pasta do AnCut (output_root)', outputRootNoMotor() === DESTINO)
    const proj = JSON.parse(readFileSync(PROJ, 'utf8')) as { images: { path: string; url?: string }[]; music: { path: string }; audio: { path: string } }
    ok('o projeto do "Abrir no editor" aponta as cenas no AnCut; o resto igual',
      proj.images[0]!.path === cena0.replace(EP, DESTINO) && proj.images[1]!.path === cena1.replace(EP, DESTINO) && proj.music.path === 'G:\\Musicas\\tema.mp3' && proj.images[0]!.url === 'http://127.0.0.1:1234/x' && readFileSync(PROJ, 'utf8').replaceAll(JSON.stringify(DESTINO).slice(1, -1), JSON.stringify(EP).slice(1, -1)) === projetoAntes)
    ok('a conferencia agora diz "no AnCut"', (await conferirEnvio(ID)).situacao === 'no-ancut')
    ok('a tela recebe o indice novo pelo evento do corte', avisos.some((a) => a.canal === 'recap:corte:progresso' && (a.dados as { indice?: EpisodeIndex }).indice?.biblioteca.movidoDoRecap === true), avisos.map((a) => a.canal).join(', '))
  }
  {
    const depois = { recap: [...episodiosEm(BIB, 0)].length, ancut: [...episodiosEm(SAIDA, 0)].length }
    ok('Biblioteca: o episodio aparece UMA vez, na raiz do AnCut (nada na do recap)', episodiosAntes.recap === 1 && episodiosAntes.ancut === 0 && depois.recap === 0 && depois.ancut === 1, `antes ${JSON.stringify(episodiosAntes)} depois ${JSON.stringify(depois)}`)
  }
  {
    const db = new DatabaseSync(BANCO, { readOnly: true })
    const ep = db.prepare('SELECT * FROM episode WHERE output_root = ?').get(DESTINO) as Record<string, unknown> | undefined
    ok('episodio no AnCut: anime remapeado (9 -> 5), output_root = a pasta do AnCut, id novo', ep !== undefined && ep['anime_id'] === 5 && ep['id'] !== 3, JSON.stringify(ep))
    ok('integridade do banco do AnCut', (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check === 'ok' && (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length === 0)
    db.close()
  }

  // ------------------------------------------------ 4. "Reconhecer agora": volta para o recap e devolve
  console.log('\n4. Reconhecer agora com o episodio no AnCut (trazer e devolver)')
  {
    const noAncut = foto(DESTINO)
    const bancoAntesDeTrazer = sha(BANCO)
    trocarConferenciaDoAncutAberto(async () => 'ancut hub.exe')
    const recusa = await trazerDoAncut(ID)
    trocarConferenciaDoAncutAberto(async () => null)
    ok('com o AnCut aberto nao traz (nada mexido)', !recusa.trazido && sha(BANCO) === bancoAntesDeTrazer && existsSync(DESTINO), recusa.mensagem)
    const v = await trazerDoAncut(ID)
    ok('trazido de volta (rename)', v.trazido && v.pasta === EP && existsSync(join(EP, 'shots')) && !existsSync(DESTINO), v.mensagem)
    ok('a mesma pasta de volta (sem os arquivos do recap ainda)', foto(EP).filter((l) => !/^(episodio[^\\]*\.json|visao\\)/.test(l)).join('\n') === noAncut.join('\n'))
    const a = abrirIndicePorId(ID)
    ok('o indice de volta dentro da pasta, origem recap, caminhos do recap', a.caminho === join(EP, 'episodio.json') && a.indice.biblioteca.origem === 'studio' && !a.indice.biblioteca.movidoDoRecap && a.indice.planos.every((p) => p.arquivo.startsWith(EP)))
    ok('a visao voltou junto', existsSync(join(EP, 'visao', 'visao.json')) && (JSON.parse(readFileSync(join(EP, 'visao', 'visao.json'), 'utf8')) as { quadros: { arquivo: string }[] }).quadros[0]!.arquivo === kf)
    ok('o projeto e o motor apontam o recap de novo', readFileSync(PROJ, 'utf8') === projetoAntes && outputRootNoMotor() === EP)
    ok('o AnCut nao lista mais o episodio (as linhas sairam, com backup)', contarNoAncut().episodios === 0 && v.backup !== null && sha(v.backup) === bancoAntesDeTrazer)
    // O fim do reconhecimento: devolve (mesmo com o "Enviar sempre" desligado).
    const d = await enviarSempreAoAncut(ID, { forcar: true })
    ok('no fim, devolvido ao AnCut (uma copia so de novo)', d?.enviado === true && !existsSync(EP) && contarNoAncut().cenasDoEp === shotsJson.length && abrirIndicePorId(ID).indice.biblioteca.movidoDoRecap === true, d?.mensagem)
  }

  // ------------------------------------------------ 5. outro disco: copia + confere + remove
  console.log('\n5. outro disco (copia, confere, tira a daqui)')
  {
    // Volta para o recap e move com a copia simulada no mesmo disco.
    await trazerDoAncut(ID)
    simularOutroDisco(true)
    const antesDaCopia = foto(EP).filter((l) => !/^(episodio[^\\]*\.json|visao\\)/.test(l))
    const rc = await enviarAoAncut(ID, false)
    ok('simulado: modo copia, conferido, a daqui saiu', rc.enviado && rc.modo === 'copia' && !existsSync(EP) && foto(DESTINO).join('\n') === antesDaCopia.join('\n'), rc.mensagem)
    const vc = await trazerDoAncut(ID)
    ok('simulado: e de volta tambem por copia', vc.trazido && existsSync(join(EP, 'shots')) && !existsSync(DESTINO))
    simularOutroDisco(false)
  }
  if (OUTRO && parse(OUTRO).root.toLowerCase() !== parse(BASE).root.toLowerCase()) {
    const banco2 = join(OUTRO, 'cache', 'index.db')
    const saida2 = join(OUTRO, 'Output')
    rmSync(OUTRO, { recursive: true, force: true })
    criarAncut(banco2, saida2, schema)
    process.env['RECAP_TESTE_ANCUT_BANCO'] = banco2
    process.env['RECAP_TESTE_ANCUT_SAIDA'] = saida2
    const destino2 = join(saida2, ANIME, 'S01E01')
    // A falha com a pasta ja copiada no outro disco: a copia sai, o recap fica.
    const antes = { recap: foto(EP), banco: sha(banco2), perfil: indiceLembrado(ID) }
    simularFalhaNoEnvio('depois-da-pasta')
    const rf = await enviarAoAncut(ID, false)
    simularFalhaNoEnvio(null)
    ok(`outro disco de verdade (${parse(OUTRO).root}), falha com a copia la: a copia sai, tudo igual`, !rf.enviado && JSON.stringify({ recap: foto(EP), banco: sha(banco2), perfil: indiceLembrado(ID) }) === JSON.stringify(antes) && !existsSync(destino2) && readdirSync(join(saida2, ANIME)).length === 0, rf.mensagem)
    const fotoAntes2 = foto(EP).filter((l) => !/^(episodio[^\\]*\.json|visao\\)/.test(l))
    const espaco2Antes = tamanhoDaPasta(BIB) + tamanhoDaPasta(saida2)
    const t1 = Date.now()
    const r2 = await enviarAoAncut(ID, false)
    const espaco2Depois = tamanhoDaPasta(BIB) + tamanhoDaPasta(saida2)
    ok(`outro disco de verdade: copiado, conferido e a daqui removida (${Date.now() - t1} ms)`, r2.enviado && r2.modo === 'copia' && !existsSync(EP) && foto(destino2).join('\n') === fotoAntes2.join('\n'), r2.mensagem)
    console.log(`     espaco nos dois discos: antes ${gb(espaco2Antes)}, depois ${gb(espaco2Depois)}`)
    ok('outro disco: uma copia so (a soma dos dois discos nao cresce)', Math.abs(espaco2Depois - espaco2Antes) < 1024 * 1024)
    const v2 = await trazerDoAncut(ID)
    ok('outro disco: de volta por copia, o AnCut sem a pasta', v2.trazido && existsSync(join(EP, 'shots')) && !existsSync(destino2), v2.mensagem)
    process.env['RECAP_TESTE_ANCUT_BANCO'] = BANCO
    process.env['RECAP_TESTE_ANCUT_SAIDA'] = SAIDA
    rmSync(OUTRO, { recursive: true, force: true })
  } else {
    console.log('     (sem RECAP_TESTE_OUTRO_DISCO em outro disco: so o simulado)')
  }

  // ------------------------------------------------ 6. unificar (a copia da versao antiga)
  console.log('\n6. Unificar (ja esta igual no AnCut, copiado pela versao antiga)')
  {
    // O estado da versao antiga: move e copia de volta shots/, keyframes/ e metadata/ (o recap fica com a dele).
    const m = await enviarAoAncut(ID, false)
    mkdirSync(EP, { recursive: true })
    for (const sub of ['shots', 'keyframes', 'metadata', 'by_character']) if (existsSync(join(DESTINO, sub))) cpSync(join(DESTINO, sub), join(EP, sub), { recursive: true })
    writeFileSync(join(EP, 'episodio.json'), JSON.stringify(indice0, null, 2))
    renameSync(join(BIB, '_indices', ID, 'episodio.json'), join(BIB, '_indices', ID, 'episodio.ancut.json'))
    {
      const db = new DatabaseSync(fonte)
      db.prepare('UPDATE episode SET output_root = ? WHERE id = 3').run(EP)
      db.close()
    }
    const aberto = abrirIndicePorId(ID)
    ok('o cenario da versao antiga: duas copias, o recap usando a dele', m.enviado && existsSync(join(EP, 'shots')) && existsSync(join(DESTINO, 'shots')) && aberto.indice.biblioteca.origem === 'studio')
    trocarConferenciaDoAncutAberto(async () => 'ancut hub.exe')
    const c = await conferirEnvio(ID)
    ok('a conferencia diz "unificar" (mesmo com o AnCut aberto: nao escreve la)', c.situacao === 'unificar', c.mensagem)
    // Diferente: recusa e nada muda.
    const shots = join(EP, 'metadata', 'shots.json')
    const original = readFileSync(shots, 'utf8')
    writeFileSync(shots, original.replace(/}\s*\]\s*$/, '} ]'))
    const antesDiferente = estado()
    const cd = await conferirEnvio(ID, true)
    const ud = await unificarComOAncut(ID)
    ok('copias diferentes: nao unifica, nada mexido', cd.situacao === 'ja-existe' && !ud.enviado && estado() === antesDiferente, ud.mensagem)
    writeFileSync(shots, original)
    // A Lixeira falha: tudo volta.
    const antesDaLixeira = estado()
    simularFalhaNoEnvio('antes-da-lixeira')
    const uf = await unificarComOAncut(ID)
    simularFalhaNoEnvio(null)
    ok('a Lixeira falhou: nada unificado, tudo igual', !uf.enviado && estado() === antesDaLixeira, uf.mensagem)
    // A Lixeira de verdade recusou (arquivo em uso no Dangai, visto no teste de UI): tudo volta, com o recado de reabrir.
    trocarLixeira(async () => {
      throw new Error('Operation was aborted')
    })
    const ur = await unificarComOAncut(ID)
    trocarLixeira(lixeiraFalsa)
    ok('a Lixeira recusou (em uso): nada unificado, tudo igual, recado de reabrir', !ur.enviado && estado() === antesDaLixeira && /Lixeira recusou/.test(ur.mensagem) && /Reabra o Dangai/.test(ur.mensagem), ur.mensagem)
    const bancoAntesDeUnificar = sha(BANCO)
    const espacoAntesU = tamanhoDaPasta(BIB) + tamanhoDaPasta(SAIDA)
    const u = await unificarComOAncut(ID)
    trocarConferenciaDoAncutAberto(async () => null)
    const espacoDepoisU = tamanhoDaPasta(BIB) + tamanhoDaPasta(SAIDA)
    const naLixeira = readdirSync(LIXEIRA_FALSA)
    ok('unificado: a daqui foi para a Lixeira, o AnCut intocado', u.enviado && u.modo === 'unificado' && !existsSync(EP) && naLixeira.some((n) => n.endsWith('S01E01')) && sha(BANCO) === bancoAntesDeUnificar, u.mensagem)
    ok('unificado: o recap usa a copia do AnCut (indice, perfil, motor, projeto)', abrirIndicePorId(ID).indice.biblioteca.pasta === DESTINO && indiceLembrado(ID) === join(BIB, '_indices', ID, 'episodio.json') && outputRootNoMotor() === DESTINO && readFileSync(PROJ, 'utf8').includes(JSON.stringify(DESTINO).slice(1, -1)))
    console.log(`     espaco fora da Lixeira: antes ${gb(espacoAntesU)}, depois ${gb(espacoDepoisU)}`)
    ok('unificado: fora da Lixeira, uma copia so', espacoAntesU - espacoDepoisU > tamanhoDoEp * 0.5)
    rmSync(LIXEIRA_FALSA, { recursive: true, force: true })
  }

  // ------------------------------------------------ 7. substituir (diferente la): a antiga vai para a Lixeira
  console.log('\n7. Substituir')
  {
    await trazerDoAncut(ID)
    // Outra versao do episodio no AnCut (a pasta e o banco de la, diferentes).
    await enviarAoAncut(ID, false)
    mkdirSync(EP, { recursive: true })
    cpSync(join(DESTINO, 'shots'), join(EP, 'shots'), { recursive: true })
    cpSync(join(DESTINO, 'keyframes'), join(EP, 'keyframes'), { recursive: true })
    cpSync(join(DESTINO, 'metadata'), join(EP, 'metadata'), { recursive: true })
    writeFileSync(join(DESTINO, 'metadata', 'timings.json'), '{"total_seconds": 1, "stages": {"outra": 1}}')
    writeFileSync(join(EP, 'episodio.json'), JSON.stringify(indice0, null, 2))
    renameSync(join(BIB, '_indices', ID, 'episodio.json'), join(BIB, '_indices', ID, 'episodio.ancut2.json'))
    {
      const db = new DatabaseSync(fonte)
      db.prepare('UPDATE episode SET output_root = ? WHERE id = 3').run(EP)
      db.close()
    }
    const c = await conferirEnvio(ID)
    const pula = await enviarAoAncut(ID, false)
    ok('diferente la: ja existe; sem substituir = pula', c.situacao === 'ja-existe' && !pula.enviado && existsSync(EP), `${c.mensagem} / ${pula.mensagem}`)
    const rs = await enviarAoAncut(ID, true)
    const itens = readdirSync(join(SAIDA, ANIME))
    const n = contarNoAncut()
    ok('substituir: um episodio so no AnCut, a pasta nova no lugar, a daqui saiu', rs.enviado && n.episodios === 1 && n.cenasDoEp === shotsJson.length && !existsSync(EP) && itens.join() === 'S01E01', `${rs.mensagem} [${itens.join(', ')}]`)
    ok('substituir: a versao antiga do AnCut foi para a Lixeira (nao ficou ao lado)', readdirSync(LIXEIRA_FALSA).some((x) => x.includes('S01E01.antes-')))
    rmSync(LIXEIRA_FALSA, { recursive: true, force: true })
  }

  // ------------------------------------------------ 8. o "Enviar sempre"
  console.log('\n8. Enviar sempre')
  {
    await trazerDoAncut(ID)
    const antes = estado()
    ok('desligado (padrao): nao faz nada', CONFIG_PADRAO.enviarSempreAoAncut === false && (await enviarSempreAoAncut(ID)) === null && estado() === antes)
    config = { ...config, enviarSempreAoAncut: true }
    trocarConferenciaDoAncutAberto(async () => 'ancut hub.exe')
    avisos.length = 0
    const a = await enviarSempreAoAncut(ID)
    ok('ligado com o AnCut aberto: fica no recap, avisa curto (sem perguntar)', a !== null && !a.enviado && /^Ficou no recap: Feche o AnCut/.test(a.mensagem) && estado() === antes && avisos.some((x) => x.canal === 'recap:ancut:automatico'), a?.mensagem)
    trocarConferenciaDoAncutAberto(async () => null)
    process.env['RECAP_TESTE_ANCUT_BANCO'] = join(BASE, 'nao-existe.db')
    const nf = await enviarSempreAoAncut(ID)
    process.env['RECAP_TESTE_ANCUT_BANCO'] = BANCO
    ok('ligado sem o AnCut: fica no recap e avisa', nf !== null && !nf.enviado && /AnCut nao encontrado/.test(nf.mensagem) && existsSync(join(EP, 'shots')), nf?.mensagem)
    const b = await enviarSempreAoAncut(ID)
    ok('ligado com o AnCut fechado: move sozinho (e uma tentativa depois funciona)', b?.enviado === true && !existsSync(EP) && contarNoAncut().episodios === 1, b?.mensagem)
    ok('ja no AnCut: o "Enviar sempre" nao faz nada', (await enviarSempreAoAncut(ID)) === null)
    config = { ...config, enviarSempreAoAncut: false }
  }

  // ------------------------------------------------ 9. o AnCut apaga o episodio depois
  console.log('\n9. O AnCut apagou o episodio: precisa cortar de novo')
  {
    renameSync(DESTINO, join(BASE, 'apagado-pelo-ancut'))
    let erro = ''
    try {
      abrirIndicePorId(ID)
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e)
    }
    ok('o indice abre no "precisa cortar de novo" (a frase que a tela troca pelo recado), sem outro erro', /Abra o episodio de novo no passo 1/.test(erro), erro)
    const c = await conferirEnvio(ID)
    ok('o botao nao oferece nada para ele', c.situacao === 'nao-e-do-recap')
    renameSync(join(BASE, 'apagado-pelo-ancut'), DESTINO)
  }

  // ------------------------------------------------ 10. a biblioteca do AnCut como biblioteca do recap
  console.log('\n10. Escolher a biblioteca do AnCut para o recap')
  {
    const atual = { ...config }
    const recado = (pasta: string): string => {
      try {
        configDoModulo.validarPatch!({ biblioteca: pasta }, atual)
        return ''
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    }
    ok('a pasta do AnCut (e dentro dela): recusada com o recado do "Enviar sempre"', recado(SAIDA) === RECADO_BIBLIOTECA_DO_ANCUT && recado(join(SAIDA, ANIME)) === RECADO_BIBLIOTECA_DO_ANCUT)
    ok('a pasta do Corte Cenas do fonte: a recusa de sempre', /so leitura/.test(recado('G:\\App Corte Cenas\\Output')))
    ok('outra pasta: aceita', recado(join(BASE, 'outra-biblioteca')) === '')
  }

  // ------------------------------------------------ 11. a Lixeira de verdade (uma pasta pequena)
  console.log('\n11. A Lixeira do Windows de verdade (pasta pequena)')
  {
    trocarLixeira(null)
    const pequena = join(BASE, `recap-lixeira-teste-${Date.now()}`)
    mkdirSync(join(pequena, 'shots'), { recursive: true })
    writeFileSync(join(pequena, 'shots', '0000.mp4'), 'teste')
    await paraALixeira(pequena)
    let naLixeira = ''
    try {
      naLixeira = execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `(New-Object -ComObject Shell.Application).Namespace(10).Items() | Where-Object { $_.Name -eq '${basename(pequena)}' } | ForEach-Object { $_.Name }`],
        { encoding: 'utf8' },
      ).trim()
    } catch {
      naLixeira = ''
    }
    ok('foi para a Lixeira (nao apagada de vez)', !existsSync(pequena) && naLixeira === basename(pequena), naLixeira || 'nao achei na Lixeira')
    // Devolve do jeito do Explorer (Restaurar), para nao deixar lixo do teste na Lixeira dele.
    try {
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `(New-Object -ComObject Shell.Application).Namespace(10).Items() | Where-Object { $_.Name -eq '${basename(pequena)}' } | ForEach-Object { $_.InvokeVerb('undelete') }`],
        { encoding: 'utf8' },
      )
    } catch {
      /* fica na Lixeira */
    }
    ok('restaurada da Lixeira', existsSync(join(pequena, 'shots', '0000.mp4')))
  }

  ok('a fonte de verdade ficou igual (lista, tamanhos e sha256 dos .json)', foto(FONTE).join('\n') === antesDaFonte.join('\n'))
}

app
  .whenReady()
  .then(testes)
  .catch((err: unknown) => {
    falhas++
    console.log('ERRO', err instanceof Error ? err.stack : err)
  })
  .finally(() => {
    console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`} em ${total} conferencias`)
    trocarLixeira(null)
    rmSync(BASE, { recursive: true, force: true })
    if (OUTRO) rmSync(OUTRO, { recursive: true, force: true })
    app.exit(falhas === 0 ? 0 : 1)
  })
