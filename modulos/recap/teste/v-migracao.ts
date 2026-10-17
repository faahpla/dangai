/**
 * [recap] O "TRAZER DO ANIRECAP STUDIO" (parte 5) sobre um Studio FALSO, sem
 * nada do Levi: chaves cifradas como o os_crypt (v10 + AES-GCM, a chave num
 * Local State "DPAPI" de mentira, aberta por um DPAPI injetado), rascunhos,
 * cache de voz, ritmo, musicas e um index.db com personagens.
 *
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-migracao.ts
 *
 * Confere: o que vem e o que nao vem, o Dangai ganha no conflito, rodar duas
 * vezes nao muda nada, cancelar e continuar, o Studio IDENTICO depois, e
 * nenhuma chave em log.
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import type { DatabaseSync as Db } from 'node:sqlite'
import { aplicarPatch, CONFIG_PADRAO, type ConfigDoRecap } from '../shared/config'
import { nadaNovo, textoDoResumo, type ResumoDaMigracao } from '../shared/migracao'
import { trocarPerfil } from '../electron/migracao/arquivos'
import { abrirV10 } from '../electron/migracao/chaves'
import { acharStudio, trazerDoStudio, type DepsDaMigracao, type PatchDoNucleo, type VistaDoNucleo } from '../electron/migracao'
import { juntarIndiceDoMotor, personagensDoIndice } from '../electron/migracao/motor'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')
const temp = mkdtempSync(join(tmpdir(), 'recap-v-migracao-'))

// ------------------------------------------------------------------ o Studio falso

const CHAVE_AES = randomBytes(32)
const ELEVEN = 'sk_teste_eleven_0123456789abcdef'
const GEMINI = 'AIzaTesteGemini_0123456789abcdef'
const FISH = 'fish_teste_0123456789abcdef'
/** O "DPAPI" de mentira: XOR. O teste injeta o inverso. */
const xor = (b: Buffer): Buffer => Buffer.from(b.map((x) => x ^ 0x5a))

function v10(texto: string): string {
  const nonce = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', CHAVE_AES, nonce)
  const corpo = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  return Buffer.concat([Buffer.from('v10'), nonce, corpo, c.getAuthTag()]).toString('base64')
}

function escrever(caminho: string, dados: string | Buffer): void {
  mkdirSync(dirname(caminho), { recursive: true })
  writeFileSync(caminho, dados)
}

const SCHEMA = `
CREATE TABLE anime (id INTEGER PRIMARY KEY AUTOINCREMENT, anilist_id INTEGER UNIQUE, mal_id INTEGER, title TEXT NOT NULL, title_english TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE episode (id INTEGER PRIMARY KEY AUTOINCREMENT, anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE, season INTEGER NOT NULL, episode INTEGER NOT NULL, source_file TEXT, processed_at TIMESTAMP, output_root TEXT, kind TEXT NOT NULL DEFAULT '', UNIQUE(anime_id, season, episode, kind));
CREATE TABLE character (id INTEGER PRIMARY KEY AUTOINCREMENT, anilist_id INTEGER UNIQUE, mal_id INTEGER, anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE, name TEXT NOT NULL, role TEXT, threshold REAL DEFAULT 0.74, reference_count INTEGER DEFAULT 0, embedding BLOB);
CREATE TABLE shot (id INTEGER PRIMARY KEY AUTOINCREMENT, episode_id INTEGER NOT NULL REFERENCES episode(id) ON DELETE CASCADE, idx INTEGER NOT NULL, file TEXT NOT NULL, keyframe TEXT, start REAL NOT NULL, end REAL NOT NULL, duration REAL NOT NULL, UNIQUE(episode_id, idx));
CREATE TABLE shot_character (shot_id INTEGER NOT NULL REFERENCES shot(id) ON DELETE CASCADE, character_id INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE, confidence REAL NOT NULL, reviewed INTEGER DEFAULT 0, approved INTEGER, PRIMARY KEY (shot_id, character_id));
`

function banco(caminho: string, preencher: (db: Db) => void): void {
  mkdirSync(dirname(caminho), { recursive: true })
  const db = new DatabaseSync(caminho)
  db.exec(SCHEMA)
  preencher(db)
  db.close()
}

const studio = join(temp, 'AniRecap Studio')
const musicas = join(temp, 'musicas')
const sfxDoLevi = join(temp, 'sfx-do-levi')
mkdirSync(musicas, { recursive: true })
mkdirSync(sfxDoLevi, { recursive: true })

escrever(
  join(studio, 'Local State'),
  JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), xor(CHAVE_AES)]).toString('base64') } }),
)
const fishQuebrada = Buffer.from(v10(FISH), 'base64')
fishQuebrada[fishQuebrada.length - 1] ^= 0xff // a tag nao confere: "colar de novo"
escrever(
  join(studio, 'settings.json'),
  JSON.stringify({
    vozPadrao: { provedor: 'elevenlabs', voiceId: 'Crm8VULvkVs5ZBDa1Ixm', modelId: 'eleven_multilingual_v2' },
    pastaDeMusicas: musicas,
    edicaoRapidaPadrao: { aoAbrirNoEditor: false, config: { sfx: true, musica: true, rosto: false, legenda: true, cor: true }, corPreset: 'Meu look' },
    presetsDeCor: [{ nome: 'Meu look', ajuste: { vibrance: 30 } }, { nome: 'Outro', ajuste: {} }],
    sfxDir: sfxDoLevi,
    iaProvedor: 'anthropic',
    geminiModelo: 'gemini-3.8-flash',
    anthropicModelo: 'claude-sonnet-5',
    elevenlabsApiKeyEnc: v10(ELEVEN),
    fishApiKeyEnc: fishQuebrada.toString('base64'),
    geminiApiKeyEnc: v10(GEMINI),
    bibliotecaStudio: 'G:\\Biblioteca do Studio',
  }),
)

const rascunhoBase = JSON.parse(readFileSync(join(__dirname, 'fixture', 'rascunho-s4e37.json'), 'utf8')) as Record<string, unknown>
const RC1 = 'rc_aaaaaaaaaaaa_x1'
const RC2 = 'rc_bbbbbbbbbbbb_x2'
escrever(
  join(studio, 'recaps', `${RC1}.json`),
  JSON.stringify({ ...rascunhoBase, id: RC1, indicePath: 'G:\\Biblioteca do Studio\\Dr STONE\\S04E37\\episodio.json', extraDoStudio: join(studio, 'recaps', RC1, 'voz', 'narracao-1.wav') }),
)
escrever(join(studio, 'recaps', RC1, 'voz', 'narracao-1.wav'), randomBytes(5000))
escrever(join(studio, 'recaps', RC1, 'voz', 'ouvidos.json'), '["abc"]')
escrever(join(studio, 'recaps', `${RC2}.json`), JSON.stringify({ ...rascunhoBase, id: RC2, titulo: 'DO STUDIO' }))
escrever(join(studio, 'recaps', 'rc_cccccccccccc_x3.json'), '{ quebrado')

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const [K1, K2, K3] = [sha('um'), sha('dois'), sha('tres')]
const voz = join(studio, 'recaps', 'cache', 'voz')
escrever(join(voz, `${K1}.wav`), randomBytes(70_000))
escrever(join(voz, `${K1}.json`), '{"character-cost":120}')
escrever(join(voz, `${K2}.wav`), randomBytes(1000))
escrever(join(voz, `${K2}.json`), '{"do":"studio"}')
escrever(join(voz, `${K3}.wav`), randomBytes(1000)) // sem .json: entrada pela metade, nao vem
escrever(join(voz, 'taxas.json'), JSON.stringify({ 'elevenlabs:*': { creditosPorCaractere: 0.22, quando: 'x' }, 'fish:s1': { creditosPorCaractere: 1, quando: 'y' } }))

escrever(
  join(studio, 'recaps', 'ritmos.json'),
  JSON.stringify({ versao: 1, medidas: [{ chave: 'm1', quando: '2026-10-10' }, { chave: 'm2', quando: '2026-10-12' }] }),
)
escrever(
  join(studio, 'som', 'musicas-usadas.json'),
  JSON.stringify({
    versao: 1,
    usadas: [
      { path: 'G:\\musica\\a.mp3', fileName: 'a.mp3', em: '2026-10-15T10:00:00Z', projeto: null },
      { path: 'G:\\musica\\b.mp3', fileName: 'b.mp3', em: '2026-10-15T11:00:00Z', projeto: null },
    ],
  }),
)

const dbStudio = join(studio, 'motor', 'cache', 'index.db')
banco(dbStudio, (db) => {
  db.exec("INSERT INTO anime(id, anilist_id, title) VALUES (1, 206949, 'Kyouran Reijou Nia Liston')")
  db.prepare('INSERT INTO character(anilist_id, anime_id, name, threshold, embedding) VALUES (?, 1, ?, ?, ?)').run(10, 'Nia Liston', 0.7, Buffer.alloc(16, 1))
  db.prepare('INSERT INTO character(anilist_id, anime_id, name, threshold, embedding) VALUES (?, 1, ?, ?, ?)').run(11, 'Lynokis', 0.7, Buffer.alloc(16, 2))
  db.exec("INSERT INTO episode(id, anime_id, season, episode, output_root) VALUES (1, 1, 1, 1, 'G:\\Biblioteca do Studio\\Nia')")
  db.exec("INSERT INTO shot(episode_id, idx, file, start, end, duration) VALUES (1, 0, 'x.mp4', 0, 1, 1)")
})
const animeDb = join(studio, 'motor', 'cache', 'anime_db')
escrever(join(animeDb, 'Kyouran Reijou Nia Liston [al206949]', 'characters', 'Nia Liston', 'auto_disc_01.jpg'), randomBytes(800))
escrever(join(animeDb, 'Kyouran Reijou Nia Liston [al206949]', 'ref_features.npz'), randomBytes(800))
escrever(join(animeDb, 'Kyouran Reijou Nia Liston [al206949]', 'metadata.json'), '{}')
escrever(join(animeDb, 'busca_resolvida.json'), JSON.stringify({ 'nia liston|s1': 'al206949' }))
escrever(
  join(studio, 'motor', 'cache', 'pastas_de_anime.json'),
  JSON.stringify({ nomes: { 'nia liston': 'Nia Liston' }, franquias: { al206949: 'Nia Liston' }, semeado: true }),
)

// ------------------------------------------------------------------ o Dangai falso

interface Dangai {
  dir: string
  cofre: Map<string, string>
  nucleo: VistaDoNucleo & { geminiApiKey: string }
  config: ConfigDoRecap
}

function novoDangai(nome: string): Dangai {
  const dir = join(temp, nome, 'modulos', 'recap')
  mkdirSync(dir, { recursive: true })
  return {
    dir,
    cofre: new Map(),
    nucleo: {
      temGemini: false,
      temAnthropic: false,
      iaProvedor: 'gemini',
      geminiModelo: '',
      anthropicModelo: 'claude-sonnet-5',
      sfxDir: '',
      presetsDeCor: [],
      geminiApiKey: '',
    },
    config: structuredClone(CONFIG_PADRAO),
  }
}

function deps(d: Dangai, extra: Partial<DepsDaMigracao> = {}): DepsDaMigracao {
  return {
    studio,
    modulo: d.dir,
    biblioteca: join(temp, 'Dangai', 'Recap', 'Biblioteca'),
    temp: join(temp, 'tmp'),
    desproteger: async (blob) => xor(blob),
    cofre: { tem: (c) => (d.cofre.get(c) ?? '') !== '', salvar: (c, v) => void d.cofre.set(c, v) },
    nucleo: {
      ler: () => ({ ...d.nucleo, temGemini: d.nucleo.geminiApiKey !== '' }),
      gravar: (p: PatchDoNucleo) => {
        Object.assign(d.nucleo, p)
      },
    },
    config: { ler: () => d.config, salvar: (p) => void (d.config = aplicarPatch(d.config, p)) },
    ritmoDoModulo: () => [{ chave: 'm1', quando: '2026-10-10' }],
    ...extra,
  }
}

/** Lista recursiva caminho|tamanho|mtime|hash (o "antes x depois"). */
function retrato(pasta: string): string {
  const linhas: string[] = []
  const andar = (p: string): void => {
    for (const it of readdirSync(p, { withFileTypes: true })) {
      const c = join(p, it.name)
      if (it.isDirectory()) andar(c)
      else {
        const s = statSync(c)
        linhas.push(`${relative(pasta, c)}|${s.size}|${s.mtimeMs}|${createHash('sha1').update(readFileSync(c)).digest('hex')}`)
      }
    }
  }
  andar(pasta)
  return linhas.sort().join('\n')
}

/** Roda com o console preso: nada do que sai pode ter uma chave. */
async function rodar(d: DepsDaMigracao): Promise<{ r: ResumoDaMigracao; log: string }> {
  const saida: string[] = []
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info }
  const prender = (...a: unknown[]): void => void saida.push(a.map(String).join(' '))
  Object.assign(console, { log: prender, warn: prender, error: prender, info: prender })
  try {
    const r = await trazerDoStudio(d)
    return { r, log: saida.join('\n') + JSON.stringify(r) }
  } finally {
    Object.assign(console, orig)
  }
}

const semChave = (texto: string): boolean => ![ELEVEN, GEMINI, FISH].some((k) => texto.includes(k))

async function principal(): Promise<void> {
  const studioAntes = retrato(studio)

  console.log('\n== 1. O Studio e achado')
  const achado = acharStudio(studio)
  confere(achado.existe && achado.rascunhos === 3, `3 rascunhos no Studio (${achado.rascunhos})`)
  confere(achado.vozBytes === 70_000 + 22 + 1000 + 15, `so as entradas completas contam na voz (${achado.vozBytes})`)
  confere(!acharStudio(join(temp, 'nada')).existe, 'sem perfil do Studio: o botao nao aparece')

  console.log('\n== 2. As chaves do os_crypt')
  confere(abrirV10(v10(ELEVEN), CHAVE_AES) === ELEVEN, 'v10 + AES-GCM abre com a chave do Local State')
  confere(abrirV10(fishQuebrada.toString('base64'), CHAVE_AES) === null, 'tag errada: null, sem lancar')
  confere(abrirV10(v10(ELEVEN), randomBytes(32)) === null, 'outra chave: null')

  console.log('\n== 3. Primeira vez, Dangai vazio')
  const A = novoDangai('DangaiA')
  // O Dangai ja tinha o RC2 e a voz K2 (os dele ganham).
  escrever(join(A.dir, 'recaps', `${RC2}.json`), JSON.stringify({ ...rascunhoBase, id: RC2, titulo: 'DO DANGAI' }))
  escrever(join(A.dir, 'recaps', 'cache', 'voz', `${K2}.wav`), 'do dangai')
  escrever(join(A.dir, 'recaps', 'cache', 'voz', `${K2}.json`), '{"do":"dangai"}')
  escrever(join(A.dir, 'recaps', 'cache', 'voz', 'taxas.json'), JSON.stringify({ 'elevenlabs:*': { creditosPorCaractere: 0.3, quando: 'd' } }))
  escrever(
    join(A.dir, 'som', 'musicas-usadas.json'),
    JSON.stringify({ versao: 1, usadas: [{ path: 'g:/musica/a.mp3', fileName: 'a.mp3', em: '2026-10-16T00:00:00Z', projeto: 'DANGAI' }] }),
  )
  const progresso: string[] = []
  const { r, log } = await rodar(deps(A, { progresso: (f, _t, feitos, total) => void progresso.push(`${f}:${feitos}/${total}`) }))
  console.log(`  resumo: ${textoDoResumo(r)}`)
  confere(r.rascunhos.trazidos === 1 && r.rascunhos.jaEstavam === 1 && r.rascunhos.quebrados === 1, 'rascunhos: 1 veio, 1 ja estava, 1 quebrado')
  const rc1 = JSON.parse(readFileSync(join(A.dir, 'recaps', `${RC1}.json`), 'utf8')) as Record<string, unknown>
  confere(rc1['indicePath'] === '', 'indice na biblioteca do Studio: vira "" (cortar de novo)')
  confere(rc1['extraDoStudio'] === join(A.dir, 'recaps', RC1, 'voz', 'narracao-1.wav'), 'caminho dentro do perfil do Studio trocado pelo do modulo')
  confere(existsSync(join(A.dir, 'recaps', RC1, 'voz', 'narracao-1.wav')), 'a pasta do rascunho veio')
  confere(!existsSync(join(A.dir, 'recaps', RC1, 'voz', 'ouvidos.json')), 'o ouvidos.json fica (1o "Gerar de novo" sai do cache)')
  confere(JSON.parse(readFileSync(join(A.dir, 'recaps', `${RC2}.json`), 'utf8')).titulo === 'DO DANGAI', 'rascunho do mesmo id: o do Dangai ganha')
  confere(r.voz.trazidos === 1 && r.voz.jaEstavam === 1 && r.voz.bytes === 70_000 + 22, `voz: 1 nova (${r.voz.bytes} bytes), 1 ja estava`)
  confere(readFileSync(join(A.dir, 'recaps', 'cache', 'voz', `${K2}.wav`), 'utf8') === 'do dangai', 'audio do mesmo hash: o do Dangai ganha')
  confere(!existsSync(join(A.dir, 'recaps', 'cache', 'voz', `${K3}.wav`)), 'entrada sem .json nao vem')
  const taxas = JSON.parse(readFileSync(join(A.dir, 'recaps', 'cache', 'voz', 'taxas.json'), 'utf8')) as Record<string, { creditosPorCaractere: number }>
  confere(taxas['elevenlabs:*']!.creditosPorCaractere === 0.3 && !!taxas['fish:s1'], 'taxas: a do Dangai fica, a que falta entra')
  confere(r.ritmos === 1, `ritmo: 1 medida nova (${r.ritmos})`)
  const hist = JSON.parse(readFileSync(join(A.dir, 'som', 'musicas-usadas.json'), 'utf8')) as { usadas: { projeto: string | null }[] }
  confere(r.musicas === 1 && hist.usadas.length === 2 && hist.usadas.some((u) => u.projeto === 'DANGAI'), 'musicas: 1 nova, a do Dangai fica')
  const dbA = join(A.dir, 'motor', 'cache', 'index.db')
  confere(r.personagens.trazidos === 2 && personagensDoIndice(dbA).join(',') === 'Lynokis,Nia Liston', 'personagens no index.db do modulo')
  const dA = new DatabaseSync(dbA, { readOnly: true })
  const eps = (dA.prepare('SELECT COUNT(*) AS n FROM episode').get() as { n: number }).n
  const shots = (dA.prepare('SELECT COUNT(*) AS n FROM shot').get() as { n: number }).n
  dA.close()
  confere(eps === 0 && shots === 0, 'sem episodios nem cenas (a biblioteca do Studio nao vem)')
  const elenco = join(A.dir, 'motor', 'cache', 'anime_db', 'Kyouran Reijou Nia Liston [al206949]')
  confere(r.fotos === 1 && existsSync(join(elenco, 'characters', 'Nia Liston', 'auto_disc_01.jpg')), 'a foto do elenco veio')
  confere(!existsSync(join(elenco, 'ref_features.npz')), 'ref_features.npz nao vem (o motor refaz)')
  const pastas = JSON.parse(readFileSync(join(A.dir, 'motor', 'cache', 'pastas_de_anime.json'), 'utf8')) as Record<string, unknown>
  confere(!!pastas['nomes'] && !('semeado' in pastas), 'pastas_de_anime: os mapas, sem o semeado do Studio')
  confere(
    A.config.vozPadrao.voiceId === 'Crm8VULvkVs5ZBDa1Ixm' && A.config.vozPadrao.velocidadeNativa === 1.2,
    'voz padrao e a nativa (perfil antigo = 1,2)',
  )
  confere(A.config.pastaDeMusicas === musicas, 'pasta de musicas')
  confere(A.config.edicaoRapidaPadrao.corPreset === 'Meu look' && !A.config.edicaoRapidaPadrao.aoAbrirNoEditor, 'Edicao rapida com o preset de cor')
  confere(A.nucleo.presetsDeCor.length === 1 && A.nucleo.presetsDeCor[0]!['nome'] === 'Meu look', 'so o preset usado vai para o nucleo')
  confere(A.nucleo.sfxDir === sfxDoLevi, 'pasta de SFX (o Dangai nao tinha)')
  confere(A.nucleo.iaProvedor === 'anthropic' && A.nucleo.geminiModelo === 'gemini-3.8-flash', 'IA: provedor e modelo (o Dangai sem IA)')
  const estado = Object.fromEntries(r.chaves.map((c) => [c.campo, c.estado]))
  confere(estado['elevenlabsApiKey'] === 'trazida' && A.cofre.get('elevenlabsApiKey') === ELEVEN, 'ElevenLabs: aberta e no cofre')
  confere(estado['geminiApiKey'] === 'trazida' && A.nucleo.geminiApiKey === GEMINI, 'Gemini: aberta e no nucleo')
  confere(estado['fishApiKey'] === 'colar-de-novo' && !A.cofre.has('fishApiKey'), 'Fish que nao abre: "colar de novo", o resto segue')
  confere(textoDoResumo(r).includes('chaves: colar de novo (Fish Audio)'), 'o resumo diz qual colar')
  confere(semChave(log), 'nenhuma chave no log nem no resumo')
  confere(progresso.length > 3 && progresso[progresso.length - 1]!.startsWith('fim:'), `progresso ate o fim (${progresso.length} avisos)`)
  confere(retrato(studio) === studioAntes, 'o Studio IDENTICO (tamanho, mtime e conteudo)')

  console.log('\n== 4. Segunda vez: nada muda')
  const moduloDepois1 = retrato(A.dir)
  const { r: r2, log: log2 } = await rodar(deps(A))
  console.log(`  resumo: ${textoDoResumo(r2)}`)
  confere(nadaNovo(r2), 'nada novo')
  confere(r2.rascunhos.jaEstavam === 2 && r2.voz.jaEstavam === 2 && r2.personagens.jaEstavam === 2, 'tudo "ja estava"')
  confere(retrato(A.dir) === moduloDepois1, 'o perfil do modulo nao mudou um byte')
  confere(semChave(log2), 'nenhuma chave no log')
  confere(retrato(studio) === studioAntes, 'o Studio IDENTICO')

  console.log('\n== 5. O Dangai com os dele: nada sobrescrito')
  const B = novoDangai('DangaiB')
  B.config = aplicarPatch(B.config, { vozPadrao: { provedor: 'fish', voiceId: 'abc', modelId: '', velocidadeNativa: 1 }, pastaDeMusicas: 'D:\\minhas' })
  B.cofre.set('elevenlabsApiKey', 'a-do-dangai')
  B.nucleo.geminiApiKey = 'gemini-do-dangai'
  B.nucleo.sfxDir = 'D:\\sfx'
  let abriu = 0
  const { r: rb } = await rodar(deps(B, { desproteger: async (b) => (abriu++, xor(b)) }))
  confere(B.config.vozPadrao.voiceId === 'abc' && B.config.pastaDeMusicas === 'D:\\minhas', 'voz e musicas do Dangai ficam')
  confere(B.cofre.get('elevenlabsApiKey') === 'a-do-dangai' && B.nucleo.geminiApiKey === 'gemini-do-dangai', 'chaves do Dangai ficam')
  confere(B.nucleo.sfxDir === 'D:\\sfx' && B.nucleo.iaProvedor === 'gemini', 'SFX e IA do Dangai ficam')
  confere(abriu === 1 && rb.chaves.filter((c) => c.estado === 'ja-tinha').length === 2, 'abre so a chave que falta (Fish)')

  console.log('\n== 6. Juntar num index.db que ja existe')
  const dbC = join(temp, 'DangaiC', 'index.db')
  banco(dbC, (db) => {
    db.exec("INSERT INTO anime(id, anilist_id, title) VALUES (7, 206949, 'Nia Liston')")
    db.prepare('INSERT INTO character(anilist_id, anime_id, name, threshold) VALUES (10, 7, ?, 0.9)').run('Nia (do Dangai)')
  })
  const j = await juntarIndiceDoMotor(dbStudio, dbC, join(temp, 'tmp'))
  const dC = new DatabaseSync(dbC, { readOnly: true })
  const nia = dC.prepare('SELECT name, threshold FROM character WHERE anilist_id = 10').get() as { name: string; threshold: number }
  const lyn = dC.prepare('SELECT anime_id FROM character WHERE anilist_id = 11').get() as { anime_id: number }
  dC.close()
  confere(j.trazidos === 1 && j.jaEstavam === 1, 'entra so o personagem que falta')
  confere(nia.name === 'Nia (do Dangai)' && nia.threshold === 0.9, 'o personagem do Dangai fica como estava')
  confere(lyn.anime_id === 7, 'o novo cai no anime que ja existia (pelo anilist_id)')

  console.log('\n== 7. Cancelar no meio e continuar')
  const C = novoDangai('DangaiCancela')
  const controle = new AbortController()
  const { r: rc } = await rodar(
    deps(C, {
      sinal: controle.signal,
      progresso: (f) => {
        if (f === 'rascunhos') controle.abort()
      },
    }),
  )
  confere(rc.cancelado && rc.voz.trazidos === 0, 'parou antes da voz')
  confere(readdirSync(join(C.dir, 'recaps')).every((n) => !n.includes('.migrando')), 'sem arquivo pela metade')
  const { r: rc2 } = await rodar(deps(C))
  confere(!rc2.cancelado && rc2.voz.trazidos === 2 && rc2.personagens.trazidos === 2, 'a segunda rodada termina o que faltou')
  const fim = rc.rascunhos.trazidos + rc2.rascunhos.trazidos
  confere(fim === 2, `os dois rascunhos bons no fim (${fim})`)

  console.log('\n== 8. Sem DPAPI: "colar de novo" e o resto vem')
  const D = novoDangai('DangaiSemDpapi')
  const { r: rd } = await rodar(
    deps(D, {
      desproteger: async () => {
        throw new Error('sem DPAPI')
      },
    }),
  )
  confere(rd.chaves.filter((c) => c.estado === 'colar-de-novo').length === 3 && rd.rascunhos.trazidos === 2, 'as 3 chaves pedem colar, os rascunhos vem')

  console.log('\n== 9. trocarPerfil')
  const t = trocarPerfil({ a: 'C:/Users/x/AppData/Roaming/AniRecap Studio/recaps/r.wav', b: 'G:\\outro', c: ['c:\\users\\x\\appdata\\roaming\\anirecap studio'] }, 'C:\\Users\\x\\AppData\\Roaming\\AniRecap Studio', 'C:\\D\\recap')
  confere(t.a === join('C:\\D\\recap', 'recaps', 'r.wav') && t.b === 'G:\\outro' && t.c[0] === 'C:\\D\\recap', 'troca so o que mora no perfil do Studio')

  confere(retrato(studio) === studioAntes, 'no fim: o Studio IDENTICO ao do comeco')
}

principal()
  .catch((err: unknown) => {
    falhas++
    console.log('  FALHOU  lancou:', err instanceof Error ? err.message : err)
  })
  .finally(() => {
    rmSync(temp, { recursive: true, force: true })
    console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
    process.exit(falhas === 0 ? 0 : 1)
  })
