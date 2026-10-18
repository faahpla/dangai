/**
 * INTEGRACAO REAL do passo 3 no modulo, com a conta do Levi -- GASTA CREDITO.
 *
 * [recap] Portado do v-voz-real do Studio, com o orcamento da parte 2: no
 * MAXIMO UMA chamada paga ao ElevenLabs, de ate 300 caracteres (~70 creditos
 * na taxa da conta dele), para confirmar pelo CAMINHO DO MODULO (gerarVoz):
 *   1. o with-timestamps a velocidade nativa 1,2 (o alignment do provedor vira
 *      as palavras do take, sem Whisper);
 *   2. o cache: o mesmo texto num OUTRO rascunho sai do cache, sem rede (o
 *      fetch e contado: zero pedidos ao text-to-speech na segunda vez);
 *   3. a chave do cache com a nativa (1,2 entra; a 1,0 seria a de antes).
 *
 * As chaves saem do cofre do nucleo pelo ctx.chave, numa COPIA do perfil do
 * Studio (settings.json + Local State, para o safeStorage abrir), numa pasta
 * temporaria apagada no fim. Nunca imprime chave. Antes e depois da chamada
 * paga: GET /v1/user (gratis), e a linha vai para o creditos.log.
 *
 * NUNCA PAGAR DUAS VEZES: o cache desta chamada fica em SAIDA/cache-voz e e
 * semeado na proxima rodada (de graca). SO_CACHE=1 recusa qualquer passo que
 * cobraria. Teto: 300 caracteres e UMA resposta 2xx de TTS por rodada (o
 * wav_44100 recusado pelo plano nao cobra; o motor tenta o wav_24000).
 * SO_USO=1 so le o uso e o ultimo item do historico (gratis); DEPURAR=1
 * mostra cada pedido (sem chave).
 *
 * Rodada da parte 2 (17/10): 234 caracteres, character-cost 51 creditos.
 *
 * Rodar da raiz:
 *   npx esbuild modulos/recap/teste/v-voz-real.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-voz-real.cjs
 *   $env:SO_CACHE='1'; npx electron out/teste/v-voz-real.cjs
 */
import { app } from 'electron'
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aplicarEdicao, marcarAprovado, roteiroAtual, type RascunhoDoRecap } from '../shared/roteiro'
import { conferirTake, configPadrao, textoParaNarrar, type TakeDaVoz } from '../shared/voz'
import { prepararModulos } from '../../../electron/modulos'
import { configureSettings } from '../../../electron/services/settings'
import { recap } from '../electron'
import { contexto } from '../electron/contexto'
import { configurarEpisodios } from '../electron/episodio/perfil'
import { gravarRascunho, lerRascunhoDoDisco } from '../electron/gerar/rascunho'
import { getSettings } from '../electron/settings'
import { lerDoCache, lerOuvidos } from '../electron/voz/cache'
import { estimarVoz } from '../electron/voz/estimar'
import { gerarVoz } from '../electron/voz/gerar'
import { pastaDoCacheDaVoz } from '../electron/voz/pastas'

// Fora do Electron (tsx/node puro) o `app` nao existe: pular com aviso em vez de
// quebrar -- e nunca cair num userData na raiz do repo. Rode pelo electron (ver acima).
if (!process.versions.electron) {
  console.log('v-voz-real: pulado (precisa do Electron: npx electron <bundle>)')
  process.exit(0)
}

const PERFIL_REAL = join(process.env['APPDATA'] ?? '', 'AniRecap Studio')
const ID = 'rc_25d63d4babd6_realp2'
const ID2 = 'rc_25d63d4babd6_realp2b'
const SAIDA = process.env['SAIDA'] ?? join(tmpdir(), 'recap-v-voz-real-saida')
const CREDITOS = join(SAIDA, 'creditos.log')
/** Teto desta rodada, em caracteres de TEXTO mandados. */
const TETO = 300
const BASE = join(tmpdir(), 'recap-v-voz-real')
const USER = join(BASE, 'userData')

rmSync(BASE, { recursive: true, force: true })
mkdirSync(join(USER, 'modulos', 'recap', 'recaps'), { recursive: true })
mkdirSync(SAIDA, { recursive: true })
if (!existsSync(join(PERFIL_REAL, 'settings.json')) || !existsSync(join(PERFIL_REAL, 'Local State'))) {
  console.log('Sem o perfil do Studio nesta maquina: o teste real foi pulado.')
  process.exit(0)
}
copyFileSync(join(PERFIL_REAL, 'settings.json'), join(USER, 'settings.json'))
copyFileSync(join(PERFIL_REAL, 'Local State'), join(USER, 'Local State'))
app.setPath('userData', USER)

let falhas = 0
function ok(nome: string, cond: boolean, detalhe = ''): void {
  if (cond) console.log(`  ok   ${nome}${detalhe ? `  (${detalhe})` : ''}`)
  else {
    falhas++
    console.log(`  FALHA ${nome}${detalhe ? `\n        ${detalhe}` : ''}`)
  }
}

/**
 * Os pedidos de TTS que sairam pela rede (todos) e os que voltaram 2xx (os
 * cobrados). O formato recusado pelo plano (o wav_44100) nao cobra e o motor
 * tenta o seguinte: o teto e de UMA resposta 2xx.
 */
const pedidosDeTts: string[] = []
const pedidosPagos: string[] = []
const fetchDeVerdade = globalThis.fetch
globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = new URL(entrada instanceof Request ? entrada.url : String(entrada))
  const tts = /text-to-speech|\/v1\/tts/.test(url.pathname)
  if (process.env['DEPURAR'] === '1') console.log(`  (fetch ${init?.method ?? 'GET'} ${url.host}${url.pathname.replace(/[A-Za-z0-9]{20}/, '<voz>')})`)
  if (tts) {
    if (pedidosPagos.length >= 1) throw new Error('Segunda chamada paga recusada pelo teste (teto: 1).')
    pedidosDeTts.push(`${url.pathname.replace(/[A-Za-z0-9]{20}/, '<voz>')} ${url.searchParams.get('output_format') ?? ''}`)
  }
  try {
    const r = await fetchDeVerdade(entrada, init)
    if (tts) {
      console.log(`  (TTS ${pedidosDeTts.at(-1)} -> ${r.status})`)
      if (r.ok) pedidosPagos.push(pedidosDeTts.at(-1)!)
    }
    return r
  } catch (err) {
    // So o tipo do erro (a URL e o cabecalho, com a chave, nunca saem daqui).
    const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
    console.log(`  (fetch quebrou: ${e.name} ${e.message} ${e.cause?.code ?? ''} ${e.cause?.message ?? ''})`)
    throw err
  }
}) as typeof fetch

/** GET /v1/user (gratis): o character_count do plano. */
async function caracteresUsados(): Promise<{ usados: number; limite: number; plano: string } | null> {
  const chave = getSettings().elevenlabsApiKey
  const r = await fetchDeVerdade('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': chave }, signal: AbortSignal.timeout(15_000) })
  if (!r.ok) return null
  const a = ((await r.json()) as { subscription?: Record<string, unknown> }).subscription ?? {}
  return { usados: Number(a['character_count']), limite: Number(a['character_limit']), plano: String(a['tier']) }
}

function registrar(oque: string, antes: number | null, depois: number | null): void {
  const gasto = antes !== null && depois !== null ? depois - antes : '?'
  appendFileSync(CREDITOS, `${new Date().toISOString()} | v-voz-real (modulo, parte 2) | ${oque} | ${antes ?? '-'} | ${depois ?? '-'} | ${gasto}\n`)
  console.log(`  creditos: ${oque}: ${antes} -> ${depois} (gasto ${gasto})`)
}

/** Um rascunho curto (as primeiras frases do S4-37 da fixture, ate o teto), aprovado. */
function rascunhoCurto(id: string): RascunhoDoRecap {
  const base = JSON.parse(readFileSync(join(process.cwd(), 'modulos', 'recap', 'teste', 'fixture', 'rascunho-s4e37-17frases.json'), 'utf8')) as Record<string, unknown>
  base['id'] = id
  writeFileSync(join(USER, 'modulos', 'recap', 'recaps', `${id}.json`), JSON.stringify(base))
  const r = lerRascunhoDoDisco(id)
  const rot = roteiroAtual(r)!
  // Corta frase a frase ate caber no teto (o texto que vai ao provedor, com as quebras).
  let secoes = rot.secoes
  for (;;) {
    const teste = { ...rot, secoes }
    if (textoParaNarrar(teste).texto.length <= TETO - 20) break
    const ultima = secoes.at(-1)!
    secoes = ultima.frases.length > 1 ? [...secoes.slice(0, -1), { ...ultima, frases: ultima.frases.slice(0, -1) }] : secoes.slice(0, -1)
  }
  const quando = new Date().toISOString()
  let novo = aplicarEdicao(r, { secoes, alvoSec: rot.alvoSec }, quando)
  try {
    novo = marcarAprovado(novo, quando)
  } catch {
    // O validador do roteiro inteiro (papeis, alvo) nao vale para o trecho: so a marca de aprovado.
    novo = { ...novo, aprovado: true, aprovadoEm: quando }
  }
  gravarRascunho(novo)
  return novo
}

async function rodar(): Promise<void> {
  configureSettings(USER)
  prepararModulos([recap], { userData: USER, appPath: process.cwd(), resourcesPath: process.cwd(), empacotado: false, versaoDoApp: 'teste' })
  configurarEpisodios(join(USER, 'modulos', 'recap'))
  // O cache desta mesma chamada, de uma rodada anterior: sai de graca.
  if (existsSync(join(SAIDA, 'cache-voz'))) cpSync(join(SAIDA, 'cache-voz'), pastaDoCacheDaVoz(), { recursive: true })
  const ctx = contexto()
  const s = getSettings()
  if (!s.elevenlabsApiKey) throw new Error('A chave do ElevenLabs nao abriu na copia do perfil.')
  if (process.env['SO_USO'] === '1') {
    const u = await caracteresUsados()
    const h = await fetchDeVerdade('https://api.elevenlabs.io/v1/history?page_size=1', { headers: { 'xi-api-key': s.elevenlabsApiKey }, signal: AbortSignal.timeout(15_000) })
    const item = ((await h.json()) as { history?: { date_unix?: number; character_count_change_from?: number; character_count_change_to?: number }[] }).history?.[0]
    const ultimo = item?.date_unix ? new Date(item.date_unix * 1000).toISOString() : 'vazio'
    console.log(`uso agora: ${u?.usados} de ${u?.limite} (${u?.plano}); ultimo item do historico: ${ultimo}`)
    return
  }
  console.log(`chave ElevenLabs: abre pelo ctx.chave (${ctx.chave('elevenlabsApiKey').length > 0})`)
  // A voz padrao do Studio (o mesmo formato) entra na config do modulo, a 1,2.
  const doStudio = (JSON.parse(readFileSync(join(USER, 'settings.json'), 'utf8')) as { vozPadrao?: unknown }).vozPadrao
  ctx.salvarConfig({ vozPadrao: { ...(doStudio as object), velocidadeNativa: 1.2 } })
  const config = configPadrao(getSettings().vozPadrao)
  if (!config || config.fonte !== 'elevenlabs') throw new Error('A voz padrao nao e do ElevenLabs.')
  ok('voz padrao na config do modulo, nativa 1,2', config.velocidadeNativa === 1.2, `${config.modelId}`)

  const r = rascunhoCurto(ID)
  const narrar = textoParaNarrar(roteiroAtual(r)!)
  console.log(`trecho: ${narrar.frases.length} frases, ${narrar.texto.length} caracteres`)
  ok(`texto ate ${TETO} caracteres`, narrar.texto.length <= TETO)

  // ------------------------------------------------ 1. a chamada paga
  console.log('\n1. gerarVoz a 1,2 (with-timestamps), pelo caminho do modulo')
  const e1 = await estimarVoz(ID, { tipo: 'tudo', config })
  console.log(`  estimativa: ${e1.caracteres} caracteres, a cobrar ${e1.aCobrar}, creditos ~${e1.creditos ?? '?'}, restam ${e1.restam}, aviso ${e1.aviso}`)
  if (e1.pagos > TETO) throw new Error(`Cobraria ${e1.pagos} caracteres: passa do teto (${TETO}). Nada pago.`)
  if (e1.pagos > 0 && process.env['SO_CACHE'] === '1') throw new Error(`Cobraria ${e1.pagos} caracteres e SO_CACHE=1. Nada pago.`)
  const a1 = e1.pagos > 0 ? await caracteresUsados() : null
  const g1 = await gerarVoz(ID, { config, pedidoId: 'real1', confirmado: e1.aCobrar }, () => {})
  if (e1.pagos > 0) {
    const d1 = await caracteresUsados()
    registrar(`take curto a 1,2 (${e1.pagos} car.; cobrados ${g1.cobrados})`, a1?.usados ?? null, d1?.usados ?? null)
  } else {
    console.log('  (do cache de uma rodada anterior: nada pago)')
  }
  const t1: TakeDaVoz = g1.take
  const meta = [...lerOuvidos(ID)].map((k) => lerDoCache(k)?.meta).find((m) => m && m.caracteres === e1.caracteres)
  ok('origem do alinhamento: o provedor (with-timestamps)', t1.origemDoAlinhamento === 'provedor', t1.origemDoAlinhamento)
  ok('alignment por caractere veio e bate com o texto', !!meta?.alignment && meta.alignment.characters.join('') === narrar.texto)
  ok('take a nativa 1,2', t1.config.fonte === 'elevenlabs' && t1.config.velocidadeNativa === 1.2)
  ok('take confere (palavras do roteiro, trechos, tempos)', conferirTake(t1).length === 0, conferirTake(t1)[0] ?? '')
  ok('no cache por hash', [...lerOuvidos(ID)].every((k) => existsSync(join(pastaDoCacheDaVoz(), `${k}.wav`))))
  console.log(`  ${t1.palavras.length} palavras, bruto ${t1.bruto.duracao.toFixed(2)} s -> ${t1.duracao.toFixed(2)} s, cobrados ${t1.cobrados}, avisos ${JSON.stringify(t1.avisos)}`)
  cpSync(pastaDoCacheDaVoz(), join(SAIDA, 'cache-voz'), { recursive: true })

  // ------------------------------------------------ 2. o mesmo texto, de graca
  console.log('\n2. o mesmo texto noutro rascunho: do cache, sem rede')
  const pagosAntes = pedidosDeTts.length
  rascunhoCurto(ID2)
  const e2 = await estimarVoz(ID2, { tipo: 'tudo', config })
  ok('estimativa: nada a cobrar', e2.aCobrar === 0 && e2.pagos === 0, `${e2.aCobrar}`)
  const g2 = await gerarVoz(ID2, { config, pedidoId: 'real2', confirmado: 0 }, () => {})
  ok('take do cache, cobrados 0', g2.cobrados === 0 && g2.take.cobrados === 0)
  ok('nenhum pedido de TTS saiu pela rede', pedidosDeTts.length === pagosAntes, `${pedidosDeTts.length - pagosAntes}`)
  ok('mesmas palavras e tempos', JSON.stringify(g2.take.bruto.palavras) === JSON.stringify(t1.bruto.palavras))

  console.log(`\npedidos de TTS: ${pedidosDeTts.length} (${pedidosDeTts.join('; ')}); cobrados (2xx): ${pedidosPagos.length}`)
}

app
  .whenReady()
  .then(rodar)
  .then(
    () => (falhas === 0 ? 0 : 1),
    (err: unknown) => {
      console.log('ERRO', err instanceof Error ? err.message : String(err))
      if (process.env['DEPURAR'] === '1' && err instanceof Error) {
        const c = (err as { cause?: unknown }).cause
        console.log(err.stack?.split('\n').slice(0, 8).join('\n'), c instanceof Error ? `causa: ${c.name} ${c.message}` : '')
      }
      return 1
    },
  )
  .then((codigo) => {
    // O que ja foi pago fica (mesmo se algo quebrou depois de pagar): a proxima rodada sai de graca.
    const cache = join(USER, 'modulos', 'recap', 'recaps', 'cache', 'voz')
    if (existsSync(cache)) cpSync(cache, join(SAIDA, 'cache-voz'), { recursive: true })
    // A copia do perfil (chave cifrada) nao fica para tras.
    rmSync(BASE, { recursive: true, force: true })
    console.log(codigo === 0 ? 'TUDO OK' : 'FALHOU')
    app.exit(codigo)
  })
