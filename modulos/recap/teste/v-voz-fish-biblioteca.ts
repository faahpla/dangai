/**
 * (21/10) O Fish Audio sem voz propria e sem saldo: a BIBLIOTECA PUBLICA na
 * escolha de voz e o modelo GRATIS (s2.1-pro-free) sem o aviso de "Sem
 * creditos". Tudo com o fetch trocado por um falso: nenhuma chave de verdade,
 * nada sai para a rede, nada e gasto.
 *
 * Confere:
 *   1. o Testar com o modelo gratis e o saldo zerado: nenhum aviso, so a nota
 *      neutra; com o pago, o "Sem creditos" de sempre; 0 vozes = nota da biblioteca;
 *   2. a biblioteca: GET /model SEM o self, language=pt, sort_by=task_count; a busca
 *      manda o title e, sem nada em portugues, tenta de todas as linguas;
 *   3. o "Colar ID da voz": o ID puro e os links fish.audio/m/<id>; 404, modelo
 *      que nao e TTS e voz em treino;
 *   4. a geracao com o modelo gratis e uma voz publica: o cabecalho `model` e o
 *      reference_id da biblioteca (sintetizarFish, com o fetch falso);
 *   5. a estimativa do modelo gratis: nao le o saldo, nao avisa, "nao usa saldo".
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-voz-fish-biblioteca.ts
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureSettings, type Cofre } from '../../../electron/services/settings'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { guardarContexto } from '../electron/contexto'
import { configurarEpisodios } from '../electron/episodio/perfil'
import { gravarRascunho, lerRascunhoDoDisco } from '../electron/gerar/rascunho'
import { estimarVoz } from '../electron/voz/estimar'
import { sintetizarFish } from '../electron/voz/fish'
import { bibliotecaFish, idDaVozFish, testarFish, vozDoFishPorId } from '../electron/voz-chaves'
import { marcarAprovado } from '../shared/roteiro'
import { configPadrao, dolaresDoFish, modeloFishGratis, textoDaEstimativa, type ConfigFish } from '../shared/voz'

let falhas = 0
function conferir(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) console.log(`  ok   ${nome}`)
  else {
    falhas += 1
    console.log(`  FALHA ${nome}\n        obtido:   ${a}\n        esperado: ${b}`)
  }
}

async function lancou(fn: () => unknown): Promise<string> {
  try {
    await fn()
    return '(nao lancou)'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

// Falsa de proposito, com cara de chave. So aparece aqui dentro.
const CHAVE = 'falsa-fish-biblioteca-0000000000c0de'
const PUBLICA = 'e58b0d7efca34eb38d5c4985e378abcb'

// ------------------------------------------------------------- fetch falso
type Resposta = { status: number; corpo: unknown; bytes?: Uint8Array }
type Rota = (url: URL, init: RequestInit | undefined) => Resposta
let rota: Rota = () => ({ status: 500, corpo: null })
const pedidos: { url: URL; cabecalhos: Record<string, string>; corpo: unknown }[] = []
const fetchDeVerdade = globalThis.fetch
globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(entrada))
  if (url.host !== 'api.fish.audio') throw new Error(`fetch inesperado no teste: ${url.host}`)
  const cabecalhos = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
  pedidos.push({ url, cabecalhos, corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : null })
  const r = rota(url, init)
  if (r.bytes) return new Response(r.bytes, { status: r.status })
  return new Response(r.corpo === null ? '' : JSON.stringify(r.corpo), { status: r.status })
}) as typeof fetch

const modelo = (id: string, titulo: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  _id: id,
  type: 'tts',
  state: 'trained',
  title: titulo,
  languages: ['pt'],
  samples: [{ title: 'a', text: 'a', task_id: 't', audio: `https://x/${id}.mp3` }],
  tags: [],
  author: { _id: 'u', nickname: 'alguem', avatar: '' },
  like_count: 1,
  task_count: 12_345,
  visibility: 'public',
  ...extra,
})

const SALDO_ZERADO = { credit: '0.0000' }
const SEM_VOZ = { total: 0, items: [] }

async function testes(): Promise<void> {
  // ------------------------------------------------ 1. o Testar respeita o modelo
  console.log('1. Testar: o aviso de saldo respeita o modelo')
  rota = (url) => (url.pathname === '/wallet/self/api-credit' ? { status: 200, corpo: SALDO_ZERADO } : { status: 200, corpo: SEM_VOZ })
  const gratis = await testarFish(CHAVE, 's2.1-pro-free')
  conferir('gratis + saldo zerado: sem aviso', gratis.aviso, null)
  conferir('gratis: a nota neutra do saldo e a da biblioteca', [gratis.nota?.startsWith('Modelo gratis: nao usa saldo.'), gratis.nota?.includes('Biblioteca do Fish')], [true, true])
  const pago = await testarFish(CHAVE, 's2.1-pro')
  conferir('pago + saldo zerado: o "Sem creditos" continua', pago.aviso?.startsWith('Sem creditos no Fish Audio'), true)
  conferir('pago: 0 vozes vira nota da biblioteca (nao aviso)', [pago.aviso?.includes('voz propria'), pago.nota?.includes('Biblioteca do Fish')], [false, true])
  const semModelo = await testarFish(CHAVE)
  conferir('sem modelo (o padrao, pago): avisa', semModelo.aviso?.startsWith('Sem creditos no Fish Audio'), true)
  rota = (url) =>
    url.pathname === '/wallet/self/api-credit'
      ? { status: 200, corpo: { credit: '3.5' } }
      : { status: 200, corpo: { total: 1, items: [modelo('aaaaaaaabbbbbbbbccccccccdddddddd', 'Minha voz')] } }
  const comSaldo = await testarFish(CHAVE, 's2.1-pro-free')
  conferir('gratis com saldo e voz propria: nada a dizer', [comSaldo.aviso, comSaldo.nota, comSaldo.vozes.map((v) => [v.nome, v.detalhe])], [null, null, [['Minha voz', 'pt']]])

  // ------------------------------------------------ 2. a biblioteca
  console.log('\n2. Biblioteca do Fish')
  pedidos.length = 0
  rota = () => ({
    status: 200,
    corpo: {
      total: 4,
      items: [
        modelo(PUBLICA, 'Narrador PT', { task_count: 1_234_567 }),
        modelo('11111111222222223333333344444444', 'Treinando', { state: 'training' }),
        modelo('55555555666666667777777788888888', 'Conversao', { type: 'svc' }),
        modelo('99999999aaaaaaaabbbbbbbbcccccccc', 'Locutora', { languages: ['pt', 'en'], task_count: 0 }),
      ],
    },
  })
  const populares = await bibliotecaFish(CHAVE, '')
  const q = pedidos[0]!.url.searchParams
  conferir('GET /model sem o self, em portugues, as mais usadas', [pedidos[0]!.url.pathname, q.get('self'), q.get('language'), q.get('sort_by'), q.get('page_size'), q.get('title')], ['/model', null, 'pt', 'task_count', '40', null])
  conferir('so as TTS prontas, com idioma e usos', populares.vozes.map((v) => [v.id, v.nome, v.detalhe, v.previewUrl]), [
    [PUBLICA, 'Narrador PT', 'pt, 1,2 mi usos', `https://x/${PUBLICA}.mp3`],
    ['99999999aaaaaaaabbbbbbbbcccccccc', 'Locutora', 'pt/en', 'https://x/99999999aaaaaaaabbbbbbbbcccccccc.mp3'],
  ])
  conferir('populares: busca vazia, em portugues', [populares.busca, populares.todasAsLinguas], ['', false])

  pedidos.length = 0
  rota = (url) =>
    url.searchParams.get('language') === 'pt'
      ? { status: 200, corpo: SEM_VOZ }
      : { status: 200, corpo: { total: 1, items: [modelo('0123456789abcdef0123456789abcdef', 'Goku', { languages: ['ja'] })] } }
  const busca = await bibliotecaFish(CHAVE, '  Goku ')
  conferir('busca: o title vai na consulta (aparado)', pedidos.map((p) => [p.url.searchParams.get('title'), p.url.searchParams.get('language')]), [['Goku', 'pt'], ['Goku', null]])
  conferir('busca sem nada em portugues: de todas as linguas', [busca.busca, busca.todasAsLinguas, busca.vozes.map((v) => v.nome)], ['Goku', true, ['Goku']])
  conferir('Bearer no cabecalho, nunca na URL', pedidos.every((p) => p.cabecalhos['Authorization'] === `Bearer ${CHAVE}` && !p.url.toString().includes(CHAVE)), true)

  rota = () => ({ status: 401, corpo: { status: 401, message: 'Unauthorized' } })
  conferir('chave recusada na biblioteca: a nota de sempre', (await lancou(() => bibliotecaFish(CHAVE, ''))).startsWith('Chave invalida: o Fish Audio'), true)

  // ------------------------------------------------ 3. colar o ID
  console.log('\n3. Colar ID da voz')
  conferir('ID e links', [
    idDaVozFish(PUBLICA),
    idDaVozFish(` https://fish.audio/m/${PUBLICA}/ `),
    idDaVozFish(`fish.audio/pt/m/${PUBLICA}`),
    idDaVozFish(`https://www.fish.audio/app/m/${PUBLICA}?x=1`),
    idDaVozFish('Narrador calmo'),
    idDaVozFish('https://example.com/m/e58b0d7efca34eb38d5c4985e378abcb'),
  ], [PUBLICA, PUBLICA, PUBLICA, PUBLICA, '', ''])

  pedidos.length = 0
  rota = (url) => (url.pathname === `/model/${PUBLICA}` ? { status: 200, corpo: modelo(PUBLICA, 'Narrador PT') } : { status: 404, corpo: { status: 404, message: 'Not Found' } })
  const colada = await vozDoFishPorId(CHAVE, `https://fish.audio/m/${PUBLICA}/`)
  conferir('GET /model/{id}: a voz com o nome', [pedidos[0]?.url.pathname, colada.id, colada.nome, colada.detalhe], [`/model/${PUBLICA}`, PUBLICA, 'Narrador PT', 'pt, 12,3 mil usos'])
  conferir('404: nao achei', await lancou(() => vozDoFishPorId(CHAVE, '0123456789abcdef0123456789abcdef')), 'Nao achei essa voz no Fish Audio. Confira o ID ou o link.')
  pedidos.length = 0
  conferir('texto que nao e ID: recusa sem ir a rede', [(await lancou(() => vozDoFishPorId(CHAVE, 'narrador'))).startsWith('Isso nao parece o ID'), pedidos.length], [true, 0])
  rota = () => ({ status: 200, corpo: modelo(PUBLICA, 'Conversao', { type: 'svc' }) })
  conferir('modelo que nao e TTS', (await lancou(() => vozDoFishPorId(CHAVE, PUBLICA))).includes('nao e de voz'), true)
  rota = () => ({ status: 200, corpo: modelo(PUBLICA, 'Treinando', { state: 'training' }) })
  conferir('voz em treino', (await lancou(() => vozDoFishPorId(CHAVE, PUBLICA))).includes('em treino'), true)

  // ------------------------------------------------ 4. gerar: gratis + voz publica
  console.log('\n4. Gerar com o modelo gratis e uma voz da biblioteca (fetch falso)')
  const config = configPadrao({ provedor: 'fish', voiceId: PUBLICA, modelId: 's2.1-pro-free', velocidadeNativa: 1 }) as ConfigFish
  pedidos.length = 0
  const wav = new Uint8Array(200).fill(1)
  rota = (url) => (url.pathname === '/v1/tts' ? { status: 200, corpo: null, bytes: wav } : { status: 404, corpo: null })
  const r = await sintetizarFish(CHAVE, { config, texto: 'Oi, tudo bem?', contexto: { anterior: '', seguinte: '' } }, 'wav_44100')
  const p = pedidos[0]!
  const corpo = p.corpo as Record<string, unknown>
  conferir('POST /v1/tts, cabecalho model = s2.1-pro-free', [p.url.pathname, p.cabecalhos['model'], p.cabecalhos['Authorization'] === `Bearer ${CHAVE}`], ['/v1/tts', 's2.1-pro-free', true])
  conferir('reference_id = a voz publica, wav 44,1 kHz', [corpo['reference_id'], corpo['format'], corpo['sample_rate']], [PUBLICA, 'wav', 44_100])
  conferir('o audio volta', r.bytes.length, 200)
  conferir('o preco do gratis e US$ 0', [modeloFishGratis('s2.1-pro-free'), modeloFishGratis('s2.1-pro'), modeloFishGratis(''), dolaresDoFish(10_000, 's2.1-pro-free')], [true, false, false, 0])

  // ------------------------------------------------ 5. a estimativa do gratis
  console.log('\n5. Estimativa do modelo gratis')
  const base = join(tmpdir(), 'recap-v-voz-fish-biblioteca')
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, 'recaps'), { recursive: true })
  const cofre: Cofre = {
    isEncryptionAvailable: () => true,
    encryptString: (t) => Buffer.from(Buffer.from(t, 'utf8').toString('base64'), 'utf8'),
    decryptString: (b) => Buffer.from(b.toString('utf8'), 'base64').toString('utf8'),
  }
  configureSettings(base, cofre)
  configurarEpisodios(base)
  guardarContexto({
    id: 'recap',
    config: () => ({ libraryDir: '', iaProvedor: 'gemini', whisperModel: 'small', modulo: { biblioteca: '', vozPadrao: { provedor: 'fish', voiceId: PUBLICA, modelId: 's2.1-pro-free' } } }),
    chave: (campo: string) => (campo === 'fishApiKey' ? CHAVE : ''),
    ligado: () => true,
  } as unknown as ContextoDoModulo)
  const fixture = JSON.parse(readFileSync(join(process.cwd(), 'modulos', 'recap', 'teste', 'fixture', 'rascunho-curto.json'), 'utf8')) as { id: string }
  writeFileSync(join(base, 'recaps', `${fixture.id}.json`), JSON.stringify(fixture))
  const rascunho = lerRascunhoDoDisco(fixture.id)
  if (!rascunho.aprovado) gravarRascunho(marcarAprovado(rascunho, new Date().toISOString()))

  pedidos.length = 0
  rota = (url) => (url.pathname === '/wallet/self/api-credit' ? { status: 200, corpo: SALDO_ZERADO } : { status: 404, corpo: null })
  const eGratis = await estimarVoz(fixture.id, { tipo: 'tudo', config })
  conferir('gratis: nao le o saldo, nao avisa, US$ 0', [pedidos.length, eGratis.saldo, eGratis.aviso, eGratis.dolares, eGratis.aCobrar > 0], [0, null, null, 0, true])
  conferir('gratis: o texto diz que nao usa saldo', textoDaEstimativa(eGratis).endsWith('Fish Audio · modelo gratis, nao usa saldo'), true)
  const ePago = await estimarVoz(fixture.id, { tipo: 'tudo', config: { ...config, modelId: 's2.1-pro' } })
  conferir('pago com saldo zerado: le e avisa', [pedidos.length, ePago.saldo, ePago.aviso?.startsWith('Sem saldo no Fish Audio')], [1, '0.0000', true])
  rmSync(base, { recursive: true, force: true })
}

void (async () => {
  try {
    await testes()
  } catch (err) {
    falhas += 1
    console.log(`  QUEBROU: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  } finally {
    globalThis.fetch = fetchDeVerdade
  }
  console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
  process.exit(falhas === 0 ? 0 : 1)
})()
