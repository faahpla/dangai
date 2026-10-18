/**
 * [recap] O PASSO 4, O "ABRIR NO EDITOR" E A EDICAO RAPIDA COM O EPISODIO
 * MOVIDO PARA O ANCUT (L1), sobre a FIXTURE do S4-37 (o indice e o rascunho
 * em teste/fixture), sem IA, sem voz paga e sem os dados do Levi.
 *
 * O episodio nasce cortado pelo recap (origem 'studio', na biblioteca
 * temporaria, com as linhas no banco do motor do recap), vai para um "AnCut"
 * temporario (RECAP_TESTE_ANCUT_BANCO/SAIDA) pelo mover de verdade, e dai:
 *   1. o rascunho acha o indice novo pelo id (o indicePath velho sumiu);
 *   2. sugerir as cenas, a grade e salvar uma troca: os planos sao os da
 *      pasta do AnCut;
 *   3. montar SEM e COM a Edicao rapida: o .dangai em _projetos aponta os mp4
 *      na pasta do AnCut (que existem), nada na pasta velha;
 *   4. nada foi escrito na pasta do AnCut (o recap so le).
 *
 * Usa o ffmpeg (a narracao e a musica de teste). Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-ancut-passo4.ts
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { configureSettings, saveSettings, type Cofre } from '../../../electron/services/settings'
import { projectFileSchemaQuePreserva } from '@shared/project-file'
import { guardarContexto } from '../electron/contexto'
import { configurarEpisodios } from '../electron/episodio/indice'
import { relocarIndice } from '../electron/episodio/relocar'
import { gravarRascunho, indiceDoRascunho, pastaDosRascunhos } from '../electron/gerar/rascunho'
import { candidatosDaFrase, salvarCenas, sugerirCenas } from '../electron/cenas'
import { montarProjeto } from '../electron/montar'
import { configurarSom } from '../electron/som/medir'
import { bancoDoMotorDoRecap, enviarAoAncut, trocarConferenciaDoAncutAberto } from '../electron/ancut/enviar'
import { configurarMotor } from '../electron/motor'
import { candidatoDosPlanos, frasesDoRoteiro } from '../shared/cenas'
import { lerIndice, type EpisodeIndex } from '../shared/episodio'
import { papelDaTrilha } from '../shared/projeto-do-recap'
import { lerRascunho, roteiroAtual, type RascunhoDoRecap } from '../shared/roteiro'
import { hashDoTexto, palavrasDaFrase, textoFalado, type TakeDaVoz } from '../shared/voz'

let falhas = 0
function confere(ok: boolean, nome: string): void {
  console.log(`  ${ok ? 'ok ' : 'FALHOU'} ${nome}`)
  if (!ok) falhas++
}
const secao = (nome: string): void => console.log(`\n== ${nome}`)

const FIXTURE = join(__dirname, 'fixture')
const ID_37 = 'ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067'
const RAIZ = mkdtempSync(join(process.env['RECAP_TESTE_PASTA'] ? resolve(process.env['RECAP_TESTE_PASTA']) : tmpdir(), 'recap-v-ancut-passo4-'))
const BIB = join(RAIZ, 'bib')
const USERDATA = join(RAIZ, 'userData')
const DADOS = join(USERDATA, 'modulos', 'recap')
const MUSICAS = join(RAIZ, 'musicas')
const EP = join(BIB, 'Dr. Stone', 'S04E37')
const ANCUT = join(RAIZ, 'ancut')
const BANCO = join(ANCUT, 'cache', 'index.db')
const SAIDA = join(ANCUT, 'Output')
const DESTINO = join(SAIDA, 'Dr. Stone', 'S04E37')
const ESTILO = { color: '#FFD400', y: 0.42, scale: 1.2, animation: 'elastica', mark: 'tudo', stroke: 4 }

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args])
}

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')
function foto(pasta: string): string {
  const saida: string[] = []
  const andar = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) andar(p)
      else saida.push(`${relative(pasta, p)}|${statSync(p).size}|${sha(p)}`)
    }
  }
  if (existsSync(pasta)) andar(pasta)
  return saida.sort().join('\n')
}

/** Um take sintetico do roteiro: 0,32 s por palavra, 0,25 s entre frases (como o v-cenas-montar). */
function takeDe(r: RascunhoDoRecap, arquivo: string): TakeDaVoz {
  const roteiro = roteiroAtual(r)!
  const palavras: TakeDaVoz['palavras'] = []
  const trechos: TakeDaVoz['trechos'] = []
  let t = 0
  for (const f of frasesDoRoteiro(roteiro)) {
    const offset = t
    t += 0.12
    for (const p of palavrasDaFrase(f.texto)) {
      palavras.push({ texto: p, start: t, end: t + 0.28, fraseId: f.id })
      t += 0.32
    }
    t += 0.13
    trechos.push({ fraseId: f.id, offset, duracao: Math.round((t - offset) * 1000) / 1000, hashTexto: hashDoTexto(f.texto), texto: textoFalado(f.texto) })
    t = offset + trechos.at(-1)!.duracao
  }
  const duracao = Math.round(t * 1000) / 1000
  return {
    id: 't1',
    config: { fonte: 'importado', velocidade: 1, cortarPausas: false, audio: { nome: 'teste.wav', hash: 'c'.repeat(64) } },
    arquivo,
    duracao,
    palavras,
    trechos,
    bruto: { arquivo: `bruto-${'b'.repeat(16)}.wav`, duracao, palavras, trechos },
    origemDoAlinhamento: 'alinhador',
    qualidade: null,
    caracteres: 0,
    cobrados: 0,
    chamadas: [],
    criadoEm: r.criadoEm,
    roteiroVersao: roteiro.versao,
    derivadoDe: null,
    regravadas: [],
    avisos: [],
    volume: null,
  } as TakeDaVoz
}

/** O SCHEMA do motor/app/storage/db.py. */
function esquemaDoMotor(): string {
  const py = readFileSync(join(process.cwd(), 'modulos', 'recap', 'motor', 'app', 'storage', 'db.py'), 'utf8')
  return /SCHEMA = """([\s\S]*?)"""/.exec(py)![1]!
}

async function principal(): Promise<void> {
  // ------------------------------------------------------------ o perfil
  for (const p of [BIB, DADOS, MUSICAS, join(EP, 'shots'), join(EP, 'metadata')]) mkdirSync(p, { recursive: true })
  const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
  configureSettings(USERDATA, cofreFalso)
  saveSettings({ libraryDir: SAIDA })
  guardarContexto({
    id: 'recap',
    empacotado: false,
    config: () => ({ libraryDir: SAIDA, iaProvedor: 'gemini', whisperModel: 'small', modulo: { biblioteca: BIB, pastaDeMusicas: MUSICAS } }),
    ligado: () => true,
    enviar: () => {},
    pasta: (tipo: string) => (tipo === 'dados' ? DADOS : RAIZ),
  } as unknown as ContextoDoModulo)
  configurarEpisodios(DADOS)
  configurarMotor({ userData: DADOS, appPath: process.cwd(), empacotado: false })
  configurarSom({ userData: DADOS, reservaDeSfx: join(__dirname, '..', '..', '..', 'assets', 'sfx') })

  // O episodio cortado PELO RECAP: a pasta com os mp4 (de teste), o indice dentro dela e as linhas no motor.
  const bruto = JSON.parse(readFileSync(join(FIXTURE, 'indice-s4e37.json'), 'utf8')) as EpisodeIndex
  const indice: EpisodeIndex = { ...relocarIndice(lerIndice(bruto), EP), biblioteca: { origem: 'studio', pasta: EP } }
  for (const p of indice.planos) writeFileSync(p.arquivo, `mp4 de teste ${p.id}`)
  writeFileSync(join(EP, 'metadata', 'shots.json'), JSON.stringify(indice.planos.map((p, i) => ({ shot_id: p.id, file: `shots/${p.id}.mp4`, keyframe: null, start: p.start, end: p.end, duration: p.end - p.start, characters: [], idx: i }))))
  writeFileSync(join(EP, 'episodio.json'), JSON.stringify(indice, null, 2))
  const schema = esquemaDoMotor()
  mkdirSync(join(bancoDoMotorDoRecap(), '..'), { recursive: true })
  {
    const db = new DatabaseSync(bancoDoMotorDoRecap())
    db.exec(schema)
    db.exec("INSERT INTO anime (id, anilist_id, title) VALUES (1, 131573, 'Dr. STONE')")
    db.prepare("INSERT INTO episode (id, anime_id, season, episode, output_root, kind) VALUES (1, 1, 4, 37, ?, '')").run(EP)
    const cena = db.prepare('INSERT INTO shot (episode_id, idx, file, keyframe, start, end, duration) VALUES (1, ?, ?, NULL, ?, ?, ?)')
    indice.planos.forEach((p, i) => cena.run(i, `shots\\${p.id}.mp4`, p.start, p.end, p.end - p.start))
    db.close()
  }
  mkdirSync(join(BANCO, '..'), { recursive: true })
  mkdirSync(SAIDA, { recursive: true })
  {
    const db = new DatabaseSync(BANCO)
    db.exec(schema)
    db.close()
  }
  process.env['RECAP_TESTE_ANCUT_BANCO'] = BANCO
  process.env['RECAP_TESTE_ANCUT_SAIDA'] = SAIDA
  trocarConferenciaDoAncutAberto(async () => null)

  // O rascunho da fixture com o indicePath VELHO (dentro da pasta do recap) e um take aprovado.
  const r0 = lerRascunho(JSON.parse(readFileSync(join(FIXTURE, 'rascunho-s4e37.json'), 'utf8')))
  const NARRACAO = `narracao-${'a'.repeat(16)}.wav`
  const take = takeDe(r0, NARRACAO)
  const r: RascunhoDoRecap = {
    ...r0,
    indicePath: join(EP, 'episodio.json'),
    voz: { versao: 1, takes: [take], atual: take.id, aprovado: true, aprovadoEm: r0.atualizadoEm } as RascunhoDoRecap['voz'],
  }
  mkdirSync(pastaDosRascunhos(), { recursive: true })
  gravarRascunho(r)
  mkdirSync(join(pastaDosRascunhos(), r.id, 'voz'), { recursive: true })
  ffmpeg(['-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.25:duration=${take.duracao}`, '-ar', '48000', '-ac', '1', join(pastaDosRascunhos(), r.id, 'voz', NARRACAO)])
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=40', '-af', 'volume=0.3', '-ar', '44100', join(MUSICAS, 'Tema de teste.mp3')])

  // ===================================================================== 0.
  secao('0. O episodio vai para o AnCut (o mover de verdade)')
  const m = await enviarAoAncut(ID_37, false)
  confere(m.enviado && !existsSync(EP) && existsSync(join(DESTINO, 'shots')), `movido (${m.mensagem})`)
  const fotoDoAncut = foto(DESTINO)

  // ===================================================================== 1.
  secao('1. O rascunho acha o indice novo')
  const aberto = indiceDoRascunho(r)
  confere(aberto.caminho === join(BIB, '_indices', ID_37, 'episodio.json') && aberto.indice.biblioteca.pasta === DESTINO, 'pelo id, mesmo com o indicePath velho')

  // ===================================================================== 2.
  secao('2. O passo 4 com as cenas no AnCut')
  const frases = frasesDoRoteiro(roteiroAtual(r)!)
  const s1 = await sugerirCenas(r.id)
  const escolhas = s1.rascunho.cenas?.escolhas ?? []
  confere(escolhas.length === frases.length, `sugerir: uma escolha por frase (${escolhas.length}/${frases.length})`)
  const planos = new Map(aberto.indice.planos.map((p) => [p.id, p]))
  confere(escolhas.every((e) => e.cenas.every((c) => c.candidato.planoIds.every((id) => planos.get(id)?.arquivo.startsWith(DESTINO)))), 'as cenas sugeridas sao planos da pasta do AnCut')
  const g = await candidatosDaFrase(r.id, frases[2]!.id, {})
  confere(g.sugestoes.length > 0, `a grade da frase (${g.sugestoes.length} sugestoes)`)
  const p0 = aberto.indice.planos.find((p) => !escolhas.some((e) => e.cenas.some((c) => c.candidato.planoIds.includes(p.id))) && p.end - p.start > 1.5)!
  const troca = { ...escolhas[0]!, cenas: [{ candidato: candidatoDosPlanos([p0], ID_37, 'usuario', { porque: ['escolhida'] }), palavraInicio: 0 }], travada: true }
  const s2 = await salvarCenas(r.id, [troca])
  confere(s2.rascunho.cenas!.escolhas[0]!.cenas[0]!.candidato.planoIds.join() === p0.id, 'salvar uma troca de cena')

  // ===================================================================== 3.
  secao('3. Abrir no editor (sem e com a Edicao rapida)')
  const m1 = await montarProjeto(r.id, { edicaoRapida: null, estilo: ESTILO, presetsDeCor: [] }, { rostos: false })
  const f1 = projectFileSchemaQuePreserva.parse(JSON.parse(readFileSync(m1.projetoPath, 'utf8')))
  confere(m1.projetoPath.startsWith(join(BIB, '_projetos')), 'o .dangai em _projetos do recap')
  confere(f1.images.length > 0 && f1.images.every((i) => i.path.startsWith(DESTINO) && existsSync(i.path)), `os ${f1.images.length} blocos apontam mp4 na pasta do AnCut (que existem)`)
  confere(!JSON.stringify(f1).includes(JSON.stringify(EP).slice(1, -1)), 'nada aponta a pasta velha do recap')
  const m2 = await montarProjeto(
    r.id,
    { edicaoRapida: { sfx: true, musica: true, rosto: false, legenda: true, cor: true }, estilo: ESTILO, presetsDeCor: [] },
    { rostos: false },
  )
  const f2 = projectFileSchemaQuePreserva.parse(JSON.parse(readFileSync(m2.projetoPath, 'utf8')))
  confere(f2.images.every((i) => i.path.startsWith(DESTINO)) && f2.trilhas.some((t) => papelDaTrilha(t) === 'musica'), 'com a Edicao rapida: as cenas no AnCut, a musica e os sons')

  // ===================================================================== 4.
  secao('4. A pasta do AnCut so foi lida')
  confere(foto(DESTINO) === fotoDoAncut, 'a pasta do episodio no AnCut igual byte a byte')
  confere(readdirSync(BIB).sort().join() === '_indices,_projetos', `a biblioteca do recap so tem o indice e os projetos (${readdirSync(BIB).sort().join(', ')})`)
}

principal()
  .then(() => {
    rmSync(RAIZ, { recursive: true, force: true })
    console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
    process.exit(falhas === 0 ? 0 : 1)
  })
  .catch((err: unknown) => {
    console.error(err)
    rmSync(RAIZ, { recursive: true, force: true })
    process.exit(1)
  })
