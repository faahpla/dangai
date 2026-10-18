/**
 * O2 (18/10): FECHAR O APP NO MEIO NAO PERDE NADA.
 *
 * 1. A decisao do Reconhecer na mao vai ao disco a cada mudanca
 *    (electron/descoberta/salva.ts) e volta igual nos mesmos grupos
 *    (reaplicarDecisao). Um app morto no meio da gravacao (o .tmp que sobrou)
 *    nao estraga a anterior; arquivo torto ou de outro episodio nao volta.
 * 2. A descoberta gravada (O1) so vale para o MESMO corte (sha1 do
 *    shot_bounds.json) e sem batismo depois (cache/batismos.json).
 * 3. O corte que o app largou no meio volta sozinho ao reabrir o .mkv
 *    (corteParado): 'cortando' sem job vivo recomeca; o anime nao achado so
 *    abre (sem cortar de novo); cancelado e pronto ficam como estao.
 * 4. A voz no ar: o pedido que o app largou no meio deixa a marca no disco e o
 *    passo 3 avisa UMA vez (pedidoInterrompido); o roteiro aprovado reabre no
 *    passo 3 (passoDoRascunho), onde o aviso fica.
 * 5. O motor: descoberta_salva.py grava e le de volta igual
 *    (motor/tests/test_descoberta_salva.py), e o corte retomado refaz o clipe
 *    ou o keyframe pela metade e reaproveita o inteiro, com o clipe escrito
 *    num .parcial (motor/tests/test_corte_interrompido.py). Sem o Python do
 *    motor, pula.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-voltar-onde-parou.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  apagarDecisaoSalva,
  caminhoDaDecisao,
  gravarDecisaoSalva,
  lerDecisaoSalva,
  lerDescobertaGravada,
} from '../electron/descoberta/salva'
import {
  decisaoInicial,
  guardarDecisao,
  ignorarGrupo,
  juntarGrupos,
  nomearGrupo,
  reaplicarDecisao,
  type DecisaoDaDescoberta,
  type GrupoDeRostos,
} from '../shared/descoberta'
import { corteParado, type EpisodeIndex, type EstadoDoCorte } from '../shared/episodio'
import { configurarEpisodios } from '../electron/episodio/perfil'
import { comecarPedido, desmarcarNoAr, marcarNoAr, pedidoInterrompido, terminarPedido } from '../electron/voz/pedidos'
import { passoDoRascunho } from '../shared/roteiro'
import { notaDaVozInterrompida } from '../shared/voz'

const raiz = mkdtempSync(join(tmpdir(), 'voltar-'))
const ep = `ep_${'a'.repeat(40)}`
try {
  // ---------------------------------------------------------- 1. a decisao no disco
  const dados = join(raiz, 'motor')
  const grupo = (key: number, cenas: number): GrupoDeRostos => ({
    key, rostos: ['r0', 'r1', 'r2'], totalDeRostos: cenas * 2, cenas, sugestao: null, sugestoes: [], conhecido: false, figurante: false,
  })
  const pronta = { grupos: [grupo(0, 9), grupo(1, 7), grupo(2, 5), grupo(3, 4)] }
  assert.equal(lerDecisaoSalva(dados, ep), null, 'nada gravado ainda')

  // Cada mudanca (como a tela faz) vai ao disco e volta igual.
  const passos: ((d: DecisaoDaDescoberta) => DecisaoDaDescoberta)[] = [
    (d) => nomearGrupo(d, 0, 'Lent'),
    (d) => nomearGrupo(d, 1, 'Misa'),
    (d) => ignorarGrupo(d, 2, true),
    (d) => juntarGrupos(d, 3, 1),
    (d) => ({ ...d, removidos: { '0': [1] } }),
  ]
  let d = decisaoInicial(pronta)
  for (const passo of passos) {
    d = passo(d)
    gravarDecisaoSalva(dados, guardarDecisao(ep, pronta, d))
    const lida = lerDecisaoSalva(dados, ep)
    assert.ok(lida)
    assert.deepEqual(lida.decisao, d)
  }
  // O app "reabriu": os mesmos grupos (a descoberta do disco) recebem tudo de volta.
  const volta = reaplicarDecisao(lerDecisaoSalva(dados, ep)!, pronta)
  assert.deepEqual(volta, d)
  assert.equal(volta.nomes['3'], 'Misa', 'o juntado com nome volta com o nome')
  // Um grupo que mudou (outra rodada, rostos diferentes) comeca limpo; os iguais ficam.
  const outra = { grupos: [grupo(0, 9), grupo(1, 8), grupo(2, 5), grupo(3, 4)] }
  const parcial = reaplicarDecisao(lerDecisaoSalva(dados, ep)!, outra)
  assert.equal(parcial.nomes['0'], 'Lent')
  assert.equal(parcial.nomes['1'], undefined)
  assert.deepEqual(parcial.ignorados, [2])

  // O app morreu no meio de uma gravacao: o .tmp que sobrou nao estraga a anterior.
  writeFileSync(`${caminhoDaDecisao(dados, ep)}.tmp`, '{"episodioId":', 'utf8')
  assert.deepEqual(lerDecisaoSalva(dados, ep)?.decisao, d)
  // A proxima gravacao passa por cima do .tmp velho.
  d = nomearGrupo(d, 2, 'Guy')
  gravarDecisaoSalva(dados, guardarDecisao(ep, pronta, d))
  assert.equal(lerDecisaoSalva(dados, ep)?.decisao.nomes['2'], 'Guy')
  assert.ok(!existsSync(`${caminhoDaDecisao(dados, ep)}.tmp`))
  // Torto ou de outro episodio: nao volta (e nao derruba ninguem).
  const outroEp = `ep_${'b'.repeat(40)}`
  writeFileSync(caminhoDaDecisao(dados, outroEp), readFileSync(caminhoDaDecisao(dados, ep)), 'utf8')
  assert.equal(lerDecisaoSalva(dados, outroEp), null)
  writeFileSync(caminhoDaDecisao(dados, outroEp), 'nada', 'utf8')
  assert.equal(lerDecisaoSalva(dados, outroEp), null)
  // Commit ou Descartar: some.
  apagarDecisaoSalva(dados, ep)
  assert.equal(lerDecisaoSalva(dados, ep), null)
  apagarDecisaoSalva(dados, ep) // de novo: nada quebra
  console.log('decisao no disco: ok')

  // ---------------------------------------------------------- 2. a descoberta gravada
  const pasta = join(raiz, 'Anime', 'S01E01')
  mkdirSync(join(pasta, 'metadata', 'discovery'), { recursive: true })
  const limites = join(pasta, 'metadata', 'shot_bounds.json')
  writeFileSync(limites, '{"shots":[[0,1.5],[1.5,4]]}', 'utf8')
  const sha = createHash('sha1').update(readFileSync(limites)).digest('hex')
  const gravada = {
    versao: 1,
    batismos: 0,
    assinaturaDoCorte: sha,
    episodeRoot: pasta,
    animeTitle: 'Kashita Maryoku',
    season: 1,
    episode: 1,
    totalFaces: 12,
    online: true,
    roster: ['Elle', 'Misa'],
    groups: [
      { key: 0, faces: 8, shots: 3, minor: false, crops: ['metadata/discovery/g000_000.jpg'], suggestedName: 'Elle', suggestedSim: 0.93, known: false, suggestions: [{ name: 'Elle', sim: 0.93 }] },
    ],
  }
  writeFileSync(join(pasta, 'metadata', 'discovery', 'descoberta.json'), JSON.stringify(gravada), 'utf8')
  const fresca = lerDescobertaGravada(pasta, dados)
  assert.ok(fresca)
  assert.equal(fresca.fresca, true)
  assert.equal(fresca.ev.groups[0]?.suggestions[0]?.name, 'Elle')
  // Outro corte (o shot_bounds mudou): nao vale.
  writeFileSync(limites, '{"shots":[[0,2]]}', 'utf8')
  assert.equal(lerDescobertaGravada(pasta, dados)?.porque, 'o corte mudou depois')
  writeFileSync(limites, '{"shots":[[0,1.5],[1.5,4]]}', 'utf8')
  // Alguem batizou personagem depois: nao vale (um grupo pode ter virado conhecido).
  mkdirSync(join(dados, 'cache'), { recursive: true })
  writeFileSync(join(dados, 'cache', 'batismos.json'), '{"total":1}', 'utf8')
  assert.equal(lerDescobertaGravada(pasta, dados)?.porque, 'nomes batizados depois')
  // De outra versao: nem le.
  writeFileSync(join(pasta, 'metadata', 'discovery', 'descoberta.json'), JSON.stringify({ ...gravada, versao: 2 }), 'utf8')
  assert.equal(lerDescobertaGravada(pasta, dados), null)
  console.log('descoberta gravada: ok')

  // ---------------------------------------------------------- 3. o corte pela metade
  const corte = (extra: Partial<EstadoDoCorte>): EstadoDoCorte => ({
    status: 'cortando', jobId: 'job_1', progresso: 0.3, etapa: 'cortando', mensagem: 'Cena 60 de 432', motor: 'studio',
    reconhecer: true, erro: null, inicio: '2026-10-18T14:18:57.287Z', atualizadoEm: '2026-10-18T14:19:47.298Z', descoberta: null, ...extra,
  })
  type IndiceDoTeste = Parameters<typeof corteParado>[0]
  const indice = (c: EstadoDoCorte | undefined, planos = 0): IndiceDoTeste => ({
    planos: Array.from({ length: planos }) as EpisodeIndex['planos'],
    corte: c,
    anime: 'Nia Liston The Merciless Maiden (corrigido)',
    temporada: 1,
    episodio: 1,
    kind: '',
    faixaLegenda: { index: 4, idioma: 'eng', nome: 'HIDI', codec: 'ass', default: false, forced: false } as EpisodeIndex['faixaLegenda'],
  })
  const caiu = corteParado(indice(corte({})), false)
  assert.ok(caiu)
  assert.equal(caiu.retomar, true)
  assert.deepEqual(caiu.palpite, { anime: 'Nia Liston The Merciless Maiden (corrigido)', temporada: 1, episodio: 1, kind: '' }, 'o nome do indice, nao o do arquivo')
  assert.equal(caiu.faixaLegenda, 4)
  assert.equal(caiu.motor, 'studio')
  assert.equal(caiu.reconhecer, true)
  // Ainda vivo no main (trocou de episodio e voltou pelo dialogo): segue.
  assert.equal(corteParado(indice(corte({ status: 'pendente', mensagem: 'Na fila', inicio: null })), true)?.retomar, true)
  // Parou pedindo o elenco: abre o "Corte parou" (Buscar elenco, Reconhecer na mao), sem cortar de novo.
  assert.equal(corteParado(indice(corte({ status: 'falhou', descoberta: 'anime-nao-encontrado', erro: 'x' })), false)?.retomar, false)
  // Falhou de outro jeito, cancelado, pronto, sem corte: como antes.
  assert.equal(corteParado(indice(corte({ status: 'falhou', erro: 'x' })), false), null)
  assert.equal(corteParado(indice(corte({ status: 'pendente', mensagem: 'Cancelado' })), false), null)
  assert.equal(corteParado(indice(corte({ status: 'pronto' }), 3), false), null)
  assert.equal(corteParado(indice(corte({}), 3), false), null, 'com as cenas no indice nao ha o que retomar')
  assert.equal(corteParado(indice(undefined), false), null)
  console.log('corte pela metade: ok')

  // ---------------------------------------------------------- 4. a voz no ar
  configurarEpisodios(join(raiz, 'perfil'))
  const rc = 'rc_teste_voltar'
  assert.equal(pedidoInterrompido(rc), null, 'nada marcado')
  // Terminou (bem, mal ou cancelado): a marca sai junto.
  marcarNoAr(rc, 'p1', 'gerar')
  desmarcarNoAr(rc, 'p1')
  assert.equal(pedidoInterrompido(rc), null)
  // O app morreu no meio: a marca ficou -> avisa uma vez so.
  marcarNoAr(rc, 'p2', 'regravar')
  const parou = pedidoInterrompido(rc)
  assert.equal(parou?.tipo, 'regravar')
  assert.ok(parou && Number.isFinite(Date.parse(parou.inicio)))
  assert.equal(pedidoInterrompido(rc), null, 'o aviso aparece uma vez')
  // Com o pedido rodando nesta sessao, nao e interrompido (e a marca fica).
  marcarNoAr(rc, 'p3', 'gerar')
  comecarPedido(rc, 'p3')
  assert.equal(pedidoInterrompido(rc), null)
  terminarPedido(rc, 'p3')
  desmarcarNoAr(rc, 'p3')
  // Desmarcar OUTRO pedido nao apaga a marca deste.
  marcarNoAr(rc, 'p4', 'ajustar')
  desmarcarNoAr(rc, 'p9')
  assert.equal(pedidoInterrompido(rc)?.tipo, 'ajustar')
  for (const tipo of ['gerar', 'regravar', 'ajustar', 'importar'] as const) {
    const nota = notaDaVozInterrompida({ tipo })
    assert.match(nota, /^[ -~]+$/, 'ASCII')
    assert.ok(nota.includes('o app fechou'))
  }
  // O roteiro aprovado reabre no 3 (com ou sem take); sem aprovar, no 2.
  assert.equal(passoDoRascunho({ aprovado: false, voz: null, roteiros: [], atual: null }), 2)
  assert.equal(passoDoRascunho({ aprovado: true, voz: null, roteiros: [], atual: null }), 3)
  console.log('voz no ar: ok')
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

// ---------------------------------------------------------- 5. o motor
const motor = resolve(import.meta.dirname, '..', 'motor')

/** O Python do runtime instalado (o mesmo jeito do app), ou o .venv de dev. */
function pythonDoMotor(): { cmd: string; env: Record<string, string> } | null {
  const runtime = process.env['ANIRECAP_MOTOR_RUNTIME_PASTA'] || join(process.env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local'), 'Dangai', 'recap', 'motor-runtime')
  for (const lancador of [join(runtime, 'venv', 'Scripts', 'python.exe'), join(motor, '.venv', 'Scripts', 'python.exe')]) {
    if (!existsSync(lancador)) continue
    try {
      const home = /^\s*home\s*=\s*(.+?)\s*$/m.exec(readFileSync(join(lancador, '..', '..', 'pyvenv.cfg'), 'utf8'))?.[1]
      const base = home ? join(home, 'python.exe') : null
      if (base && existsSync(base)) return { cmd: base, env: { __PYVENV_LAUNCHER__: lancador } }
    } catch {
      // sem pyvenv.cfg: o lancador
    }
    return { cmd: lancador, env: {} }
  }
  return null
}

const py = pythonDoMotor()
// O ffmpeg do app (ffmpeg-static) no PATH: o test_corte_interrompido.py corta clipes de verdade.
const CHAVE_DO_PATH = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
const ffmpegDoApp = join(resolve(import.meta.dirname, '..', '..', '..'), 'node_modules', 'ffmpeg-static')
if (!py) {
  console.warn('AVISO: sem o Python do motor (runtime ou .venv): os testes do motor pularam.')
} else {
  for (const arquivo of ['test_descoberta_salva.py', 'test_corte_interrompido.py']) {
    const r = spawnSync(py.cmd, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', arquivo], {
      cwd: motor,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...py.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONNOUSERSITE: '1',
        [CHAVE_DO_PATH]: [ffmpegDoApp, process.env[CHAVE_DO_PATH] ?? ''].join(';'),
      },
    })
    const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`
    if (r.status !== 0) {
      console.error(saida)
      assert.fail(`${arquivo} falhou`)
    }
    console.log(`motor (${arquivo}): ${/Ran (\d+) tests?/.exec(saida)?.[0] ?? 'ok'}`)
  }
}
console.log('v-voltar-onde-parou: tudo ok')
