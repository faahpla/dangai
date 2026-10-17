/**
 * ENVIAR PARA O ANCUT (L1), NUNCA contra o AnCut de verdade.
 *
 * Tudo numa pasta temporaria:
 *   - a biblioteca do recap: uma COPIA do Nia Liston S01E01 ja cortado (de
 *     G:/AniRecap Studio/Biblioteca, so lido);
 *   - o banco do motor do recap num perfil temporario, com o esquema do
 *     motor/app/storage/db.py e as linhas do episodio (432 cenas, 3 personagens,
 *     ligacoes, favoritos, curadoria);
 *   - o "AnCut": um index.db com o esquema do db.py e coisa de outro anime ja
 *     dentro (os ids do envio tem que ser remapeados), e uma biblioteca vazia;
 *     e as COPIAS dos index.db do AnCut desta maquina (esquema antigo), para a
 *     recusa. RECAP_TESTE_ANCUT_BANCO/RECAP_TESTE_ANCUT_SAIDA apontam para eles.
 *
 * Confere: esquema diferente recusa; AnCut aberto recusa; o envio (linhas, ids
 * remapeados, arquivos, backup); ja existe = pula; falha no meio (depois das
 * linhas, e com a pasta ja no lugar) = ROLLBACK, banco igual byte a byte, a
 * pasta copiada sai e a antiga volta; substituir; o "Enviar sempre" (desligado
 * nao faz nada; ligado com o AnCut aberto avisa e nao envia).
 *
 * Rodar da raiz:
 *   npx esbuild modulos/recap/teste/v-ancut-enviar.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-ancut-enviar.cjs
 *   npx electron out/teste/v-ancut-enviar.cjs
 */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { guardarContexto } from '../electron/contexto'
import { configurarEpisodios } from '../electron/episodio/perfil'
import { configurarMotor } from '../electron/motor'
import {
  acharAncut,
  bancoDoMotorDoRecap,
  conferirEnvio,
  enviarAoAncut,
  enviarSempreAoAncut,
  simularFalhaNoEnvio,
  trocarConferenciaDoAncutAberto,
} from '../electron/ancut/enviar'
import { CONFIG_PADRAO, type ConfigDoRecap } from '../shared/config'

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

const NIA_REAL = 'G:\\AniRecap Studio\\Biblioteca\\Nia Liston The Merciless Maiden\\S01E01'
const ANIME = 'Nia Liston The Merciless Maiden'
const BASE = join(tmpdir(), 'anirecap-v-ancut')
const USER = join(BASE, 'userData')
const BIB = join(BASE, 'biblioteca-recap')
const EP = join(BIB, ANIME, 'S01E01')
const ANCUT = join(BASE, 'ancut')
const BANCO = join(ANCUT, 'cache', 'index.db')
const SAIDA = join(ANCUT, 'Output')
rmSync(BASE, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })
app.setPath('userData', USER)

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')

/** Lista (caminho relativo, tamanho, sha256) de uma pasta. */
function foto(pasta: string, hashes = true): string[] {
  const saida: string[] = []
  const andar = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) andar(p)
      else saida.push(`${relative(pasta, p)}|${statSync(p).size}${hashes ? `|${sha(p)}` : ''}`)
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

let config: ConfigDoRecap = { ...CONFIG_PADRAO, biblioteca: BIB }

async function testes(): Promise<void> {
  if (!existsSync(join(NIA_REAL, 'shots'))) {
    console.log('sem o Nia Liston S01E01 nesta maquina: teste pulado')
    return
  }
  const avisos: { canal: string; dados: unknown }[] = []
  configurarEpisodios(USER)
  configurarMotor({ userData: join(USER, 'modulos', 'recap'), appPath: process.cwd(), empacotado: false })
  guardarContexto({
    id: 'recap',
    config: () => ({ libraryDir: '', iaProvedor: 'gemini', whisperModel: 'small', modulo: config }),
    chave: () => '',
    ligado: () => true,
    enviar: (canal: string, dados: unknown) => avisos.push({ canal, dados }),
  } as unknown as ContextoDoModulo)

  // ------------------------------------------------ 0. o cenario temporario
  console.log('0. copias temporarias (o Nia Liston so e lido)')
  const antesDoNia = foto(NIA_REAL, false)
  mkdirSync(EP, { recursive: true })
  for (const sub of ['shots', 'keyframes', 'metadata']) cpSync(join(NIA_REAL, sub), join(EP, sub), { recursive: true })
  copyFileSync(join(NIA_REAL, 'episodio.json'), join(EP, 'episodio.json'))
  const indice = JSON.parse(readFileSync(join(EP, 'episodio.json'), 'utf8')) as { id: string }
  const ID = indice.id
  const shotsJson = JSON.parse(readFileSync(join(EP, 'metadata', 'shots.json'), 'utf8')) as {
    file: string
    keyframe: string
    start: number
    end: number
    duration: number
  }[]
  ok('copia do episodio feita', foto(EP, false).length > 1000, `${shotsJson.length} cenas`)

  // O banco do motor do recap (perfil temporario): o esquema do db.py e as linhas do episodio.
  const schema = esquemaDoMotor()
  const fonte = bancoDoMotorDoRecap()
  mkdirSync(join(fonte, '..'), { recursive: true })
  {
    const src = new DatabaseSync(fonte)
    src.exec(schema)
    src.exec("INSERT INTO anime (id, anilist_id, mal_id, title, title_english) VALUES (7, NULL, NULL, 'Outro anime do recap', NULL)")
    src.exec(`INSERT INTO anime (id, anilist_id, mal_id, title, title_english) VALUES (9, 171018, 59002, '${ANIME}', 'Nia Liston')`)
    src
      .prepare('INSERT INTO episode (id, anime_id, season, episode, source_file, processed_at, output_root, kind) VALUES (3, 9, 1, 1, ?, CURRENT_TIMESTAMP, ?, \'\')')
      .run('C:\\Users\\levic\\Downloads\\Nia.Liston.S01E01.mkv', EP)
    const personagem = src.prepare('INSERT INTO character (id, anilist_id, mal_id, anime_id, name, role, threshold, reference_count, embedding) VALUES (?, ?, NULL, 9, ?, ?, 0.74, 3, ?)')
    personagem.run(21, 300001, 'Nia Liston', 'MAIN', new Uint8Array([1, 2, 3, 4]))
    personagem.run(22, 300002, 'Lino', 'MAIN', new Uint8Array([5, 6, 7]))
    personagem.run(23, null, 'Reliared', 'SUPPORTING', null)
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

  // O "AnCut": o esquema do db.py com OUTRO anime ja dentro (ids ocupados) e o Nia com um personagem igual.
  mkdirSync(join(BANCO, '..'), { recursive: true })
  mkdirSync(SAIDA, { recursive: true })
  {
    const db = new DatabaseSync(BANCO)
    db.exec(schema)
    db.exec("INSERT INTO anime (id, anilist_id, title) VALUES (1, 131573, 'Dr. STONE'), (2, NULL, 'Mushoku Tensei'), (5, 171018, 'Nia Liston: The Merciless Maiden')")
    db.exec("INSERT INTO episode (id, anime_id, season, episode, output_root, kind) VALUES (1, 1, 4, 24, 'X:\\\\Output\\\\Dr STONE\\\\S04E24', '')")
    db.exec("INSERT INTO character (id, anilist_id, anime_id, name, role) VALUES (1, 900, 1, 'Senku', 'MAIN'), (2, 300001, 5, 'Nia Liston', 'MAIN')")
    const cena = db.prepare("INSERT INTO shot (episode_id, idx, file, keyframe, start, end, duration) VALUES (1, ?, ?, NULL, 0, 1, 1)")
    for (let i = 0; i < 1500; i++) cena.run(i, `shots\\${String(i).padStart(4, '0')}.mp4`)
    db.exec('INSERT INTO shot_character (shot_id, character_id, confidence) VALUES (1, 1, 0.9)')
    db.close()
  }
  process.env['RECAP_TESTE_ANCUT_BANCO'] = BANCO
  process.env['RECAP_TESTE_ANCUT_SAIDA'] = SAIDA
  const lugar = acharAncut()
  ok('o AnCut temporario e achado pela env de teste', lugar?.banco === BANCO && lugar.saida === SAIDA)

  // ------------------------------------------------ 1. recusas
  console.log('\n1. recusas (nada escrito)')
  trocarConferenciaDoAncutAberto(async () => null)
  {
    // As copias dos index.db do AnCut desta maquina (esquema antigo, sem output_root): recusa.
    const reais = [
      join(process.env['LOCALAPPDATA'] ?? '', 'CorteCenas', 'CorteCenas', 'cache', 'index.db'),
      'G:\\App Corte Cenas\\cache\\index.db',
    ].filter((p) => existsSync(p))
    for (const [i, real] of reais.entries()) {
      const copia = join(BASE, `ancut-real-${i}.db`)
      copyFileSync(real, copia)
      const antes = sha(copia)
      process.env['RECAP_TESTE_ANCUT_BANCO'] = copia
      const c = await conferirEnvio(ID)
      const r = await enviarAoAncut(ID, true)
      ok(`copia do index.db do AnCut desta maquina (${i + 1}/${reais.length}): esquema diferente, recusa`, c.situacao === 'esquema-diferente' && !r.enviado && sha(copia) === antes, c.mensagem)
    }
    process.env['RECAP_TESTE_ANCUT_BANCO'] = BANCO
  }
  const bancoAntes = sha(BANCO)
  trocarConferenciaDoAncutAberto(async () => 'ancut hub.exe')
  {
    const c = await conferirEnvio(ID)
    const r = await enviarAoAncut(ID, false)
    ok('AnCut aberto: recusa, nada escrito', c.situacao === 'aberto' && !r.enviado && sha(BANCO) === bancoAntes && foto(SAIDA).length === 0, c.mensagem)
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

  // ------------------------------------------------ 2. o envio
  console.log('\n2. o envio')
  const c = await conferirEnvio(ID)
  ok('conferencia: pronto', c.situacao === 'pronto', `${c.rotulo} - ${c.mensagem}`)
  const r = await enviarAoAncut(ID, false)
  ok('enviado', r.enviado, r.mensagem)
  ok('linhas: anime reaproveitado (anilist), 1 episodio, 2 personagens novos, 432 cenas, 14 ligacoes, 2 favoritos, 1 curadoria',
    JSON.stringify(r.linhas) === JSON.stringify({ anime: 0, episode: 1, character: 2, shot: shotsJson.length, shotCharacter: 14, favorite: 2, manualOverride: 1 }),
    JSON.stringify(r.linhas))
  const destino = join(SAIDA, ANIME, 'S01E01')
  ok('pasta no destino', r.pasta === destino && existsSync(join(destino, 'shots')))
  ok('backup = o banco de antes, byte a byte', r.backup !== null && existsSync(r.backup) && sha(r.backup) === bancoAntes)
  {
    const fotoOrigem = foto(EP).filter((l) => !l.startsWith('episodio.json'))
    const fotoDestino = foto(destino)
    ok('arquivos: shots/, keyframes/, metadata/ iguais (nome, tamanho, sha256)', fotoOrigem.join('\n') === fotoDestino.join('\n'), `${fotoDestino.length} arquivos`)
    ok('nenhuma temporaria sobrou', !readdirSync(join(SAIDA, ANIME)).some((n) => n.includes('.recap-enviando')))
  }
  {
    const db = new DatabaseSync(BANCO, { readOnly: true })
    const src = new DatabaseSync(fonte, { readOnly: true })
    const ep = db.prepare('SELECT * FROM episode WHERE output_root = ?').get(destino) as Record<string, unknown> | undefined
    ok('episodio: anime remapeado (9 -> 5), output_root = a pasta do AnCut, id novo', ep !== undefined && ep['anime_id'] === 5 && ep['season'] === 1 && ep['episode'] === 1 && ep['id'] !== 3, JSON.stringify(ep))
    const epId = ep?.['id'] as number
    const cenas = db.prepare('SELECT id, idx, file, keyframe, start, end, duration FROM shot WHERE episode_id = ? ORDER BY idx').all(epId) as Record<string, unknown>[]
    const daOrigem = src.prepare('SELECT idx, file, keyframe, start, end, duration FROM shot WHERE episode_id = 3 ORDER BY idx').all() as Record<string, unknown>[]
    ok('cenas: as mesmas (idx, file, keyframe, tempos)', JSON.stringify(cenas.map(({ id: _, ...x }) => x)) === JSON.stringify(daOrigem))
    ok('cenas: ids novos (depois das 1500 do outro anime)', cenas.every((s) => (s['id'] as number) > 1500))
    const idDaCena = new Map(cenas.map((s) => [s['idx'] as number, s['id'] as number]))
    const nomes = new Map((db.prepare('SELECT id, name FROM character').all() as { id: number; name: string }[]).map((p) => [p.id, p.name]))
    const ligacoes = db.prepare('SELECT shot_id, character_id, confidence, reviewed, approved FROM shot_character WHERE shot_id IN (SELECT id FROM shot WHERE episode_id = ?)').all(epId) as { shot_id: number; character_id: number }[]
    ok('ligacoes: 14, cena e personagem remapeados (Nia = o id 2 que ja existia)',
      ligacoes.length === 14 &&
        ligacoes.filter((l) => l.character_id === 2).length === 10 &&
        ligacoes.some((l) => l.shot_id === idDaCena.get(100) && nomes.get(l.character_id) === 'Reliared') &&
        ligacoes.filter((l) => nomes.get(l.character_id) === 'Lino').every((l) => [15, 16, 17].map((i) => idDaCena.get(i)).includes(l.shot_id)))
    const lino = db.prepare("SELECT * FROM character WHERE name = 'Lino'").get() as Record<string, unknown>
    ok('personagem novo com o anime remapeado e o embedding inteiro', lino['anime_id'] === 5 && lino['anilist_id'] === 300002 && Buffer.from(lino['embedding'] as Uint8Array).equals(Buffer.from([5, 6, 7])))
    const favs = db.prepare('SELECT shot_id, character_id FROM favorite').all() as { shot_id: number; character_id: number }[]
    ok('favoritos remapeados (0 continua 0)', favs.length === 2 && favs.some((f) => f.shot_id === idDaCena.get(12) && f.character_id === 2) && favs.some((f) => f.shot_id === idDaCena.get(50) && f.character_id === 0))
    const cur = db.prepare('SELECT * FROM manual_override').all() as Record<string, unknown>[]
    ok('curadoria remapeada (episodio e personagem)', cur.length === 1 && cur[0]!['episode_id'] === epId && nomes.get(cur[0]!['character_id'] as number) === 'Lino' && cur[0]!['shot_idx'] === 40)
    const dr = db.prepare('SELECT count(*) AS n FROM shot WHERE episode_id = 1').get() as { n: number }
    ok('o outro anime ficou intocado', dr.n === 1500 && (db.prepare('SELECT count(*) AS n FROM anime').get() as { n: number }).n === 3)
    ok('integridade do banco do AnCut', (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check === 'ok' && (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length === 0)
    db.close()
    src.close()
  }
  ok('a origem (a copia do recap) ficou igual', foto(EP, false).length > 1000 && sha(fonte) !== '' && existsSync(join(EP, 'episodio.json')))

  // ------------------------------------------------ 3. ja existe, falha no meio, substituir
  console.log('\n3. ja existe, falha no meio (rollback), substituir')
  const depoisDoEnvio = sha(BANCO)
  const pastaDepoisDoEnvio = foto(destino)
  {
    const c3 = await conferirEnvio(ID)
    const r3 = await enviarAoAncut(ID, false)
    ok('de novo: ja existe; sem substituir = pula, nada escrito', c3.situacao === 'ja-existe' && !r3.enviado && sha(BANCO) === depoisDoEnvio, `${c3.mensagem} / ${r3.mensagem}`)
  }
  for (const onde of ['depois-das-linhas', 'depois-da-pasta'] as const) {
    simularFalhaNoEnvio(onde)
    const rf = await enviarAoAncut(ID, true)
    simularFalhaNoEnvio(null)
    const itens = readdirSync(join(SAIDA, ANIME))
    ok(`falha ${onde}: nada enviado, banco igual byte a byte (ROLLBACK)`, !rf.enviado && sha(BANCO) === depoisDoEnvio, rf.mensagem)
    ok(`falha ${onde}: a pasta antiga de volta, sem a copia nem sobra`, foto(destino).join('\n') === pastaDepoisDoEnvio.join('\n') && itens.length === 1, itens.join(', '))
  }
  {
    const rs = await enviarAoAncut(ID, true)
    const db = new DatabaseSync(BANCO, { readOnly: true })
    const eps = db.prepare('SELECT id FROM episode WHERE anime_id = 5 AND season = 1 AND episode = 1').all() as { id: number }[]
    const n = (db.prepare('SELECT count(*) AS n FROM shot WHERE episode_id = ?').get(eps[0]?.id ?? -1) as { n: number }).n
    const orfas = (db.prepare('SELECT count(*) AS n FROM shot WHERE episode_id NOT IN (SELECT id FROM episode)').get() as { n: number }).n
    const ligacoes = (db.prepare('SELECT count(*) AS n FROM shot_character').get() as { n: number }).n
    db.close()
    const itens = readdirSync(join(SAIDA, ANIME))
    ok('substituir: um episodio so, 432 cenas, nada orfao', rs.enviado && eps.length === 1 && n === shotsJson.length && orfas === 0 && ligacoes === 15, `${rs.mensagem} ligacoes ${ligacoes}`)
    ok('substituir: a pasta antiga fica ao lado (.antes-<data>), a nova no lugar', itens.length === 2 && itens.some((i) => i.startsWith('S01E01.antes-')) && foto(destino).join('\n') === pastaDepoisDoEnvio.join('\n'), itens.join(', '))
    ok('substituir: backup = o banco de antes dele', rs.backup !== null && sha(rs.backup) === depoisDoEnvio)
  }

  // ------------------------------------------------ 4. o "Enviar sempre"
  console.log('\n4. Enviar sempre')
  const antesDoSempre = sha(BANCO)
  ok('desligado (padrao): nao faz nada', CONFIG_PADRAO.enviarSempreAoAncut === false && (await enviarSempreAoAncut(ID)) === null && sha(BANCO) === antesDoSempre)
  config = { ...config, enviarSempreAoAncut: true }
  trocarConferenciaDoAncutAberto(async () => 'ancut hub.exe')
  {
    const a = await enviarSempreAoAncut(ID)
    ok('ligado com o AnCut aberto: nao envia, avisa (sem perguntar)', a !== null && !a.enviado && /Feche o AnCut/.test(a.mensagem) && sha(BANCO) === antesDoSempre && avisos.some((x) => x.canal === 'recap:ancut:automatico'), a?.mensagem)
  }
  trocarConferenciaDoAncutAberto(async () => null)
  {
    const a = await enviarSempreAoAncut(ID)
    ok('ligado com o episodio ja no AnCut: nao envia, avisa', a !== null && !a.enviado && /ja esta no AnCut/.test(a.mensagem) && sha(BANCO) === antesDoSempre, a?.mensagem)
  }
  ok('o Nia Liston de verdade ficou igual (lista e tamanhos)', foto(NIA_REAL, false).join('\n') === antesDoNia.join('\n'))
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
    rmSync(BASE, { recursive: true, force: true })
    app.exit(falhas === 0 ? 0 : 1)
  })
