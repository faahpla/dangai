/**
 * Chaves de voz: o "Testar" do ElevenLabs/Fish com o fetch trocado por um
 * falso, e (no modulo) as chaves no cofre do nucleo pelos camposDeChave, com
 * a tela vendo so tem/dica, e a voz padrao na configuracao do modulo.
 *
 * [recap] Portado do Studio. O "Importar do AniRecap" ficou de fora (lia
 * G:/App Resumo, so desta maquina). O cofre e falso (so embaralha), entao nao
 * precisa do Electron. A chave nunca e impressa: as conferencias que envolvem
 * chave comparam booleano. Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-voz.ts
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listarModulos, prepararModulos } from '../../../electron/modulos'
import { configureSettings, decifrar, type Cofre } from '../../../electron/services/settings'
import { recap } from '../electron'
import { configDoRecap, contexto } from '../electron/contexto'
import { getSettings as getSettingsDoRecap } from '../electron/settings'
import { testarEleven, testarFish } from '../electron/voz-chaves'

let falhas = 0
function conferir(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) {
    console.log(`  ok   ${nome}`)
  } else {
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

// Falsas de proposito, com cara de chave. So aparecem aqui dentro.
const CHAVE = 'sk_falsa_voz_importar_000000000000000000000000abcd'
const CHAVE_FISH = 'falsa-fish-000000000000000000ef01'
const VOZ = 'VozFalsa0000000000AA'
const MODELO = 'eleven_multilingual_v2'

const pasta = join(tmpdir(), 'recap-v-voz')
rmSync(pasta, { recursive: true, force: true })
mkdirSync(pasta, { recursive: true })

const real = process.argv.includes('--real')

// ------------------------------------------------------------- fetch falso
type Rota = (url: URL, cabecalhos: Record<string, string>) => { status: number; corpo: unknown } | 'rede'
let rota: Rota = () => ({ status: 500, corpo: null })
const pedidos: { url: string; cabecalhos: Record<string, string> }[] = []
const fetchDeVerdade = globalThis.fetch

function trocarFetch(): void {
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(entrada))
    const cabecalhos = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
    pedidos.push({ url: url.toString(), cabecalhos })
    const r = rota(url, cabecalhos)
    if (r === 'rede') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    return new Response(r.corpo === null ? '' : JSON.stringify(r.corpo), { status: r.status })
  }) as typeof fetch
}

const VOZES_ELEVEN = {
  voices: [
    { voice_id: 'Pronta00000000000001', name: 'Zeca', category: 'premade', labels: { gender: 'male', accent: 'american' }, preview_url: 'https://x/p1.mp3' },
    { voice_id: VOZ, name: 'Narrador', category: 'cloned', labels: {}, verified_languages: [{ language: 'pt' }], preview_url: 'https://x/p2.mp3' },
    { voice_id: 'barra/na/url', name: 'Invalida', category: 'premade' },
  ],
}

async function testesDoFetch(): Promise<void> {
  trocarFetch()

  console.log('ElevenLabs: chave boa')
  rota = (url) =>
    url.pathname === '/v1/user'
      ? { status: 200, corpo: { subscription: { tier: 'creator', character_count: 1234, character_limit: 100000 } } }
      : { status: 200, corpo: VOZES_ELEVEN }
  pedidos.length = 0
  const bom = await testarEleven(CHAVE)
  conferir('plano e caracteres', [bom.plano, bom.usados, bom.limite, bom.aviso], ['creator', 1234, 100000, null])
  conferir('vozes: a da conta primeiro, id invalido fora', bom.vozes.map((v) => [v.id, v.nome, v.detalhe]), [
    [VOZ, 'Narrador', 'pt'],
    ['Pronta00000000000001', 'Zeca', 'male, american'],
  ])
  conferir('so GET em /v1/user e /v1/voices', pedidos.map((p) => new URL(p.url).pathname), ['/v1/user', '/v1/voices'])
  conferir('chave no cabecalho xi-api-key, nunca na URL', [
    pedidos.every((p) => p.cabecalhos['xi-api-key'] === CHAVE),
    pedidos.some((p) => p.url.includes(CHAVE)),
  ], [true, false])

  console.log('ElevenLabs: erros')
  rota = (url) =>
    url.pathname === '/v1/user'
      ? { status: 200, corpo: { subscription: { tier: 'free', character_count: 10000, character_limit: 10000, next_character_count_reset_unix: 1762128000 } } }
      : { status: 200, corpo: { voices: [] } }
  const semCaracteres = await testarEleven(CHAVE)
  conferir('caracteres acabaram vira aviso "Sem creditos"', semCaracteres.aviso?.startsWith('Sem creditos no ElevenLabs'), true)

  rota = () => ({ status: 401, corpo: { detail: { status: 'invalid_api_key', message: 'Invalid API key' } } })
  const invalida = await lancou(() => testarEleven(CHAVE))
  conferir('401 invalid_api_key', invalida.startsWith('Chave invalida'), true)
  conferir('401 diz o motivo do site', invalida.includes('(invalid_api_key)'), true)
  conferir('401 com chave sem sk_ diz o formato', (await lancou(() => testarEleven('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'))).startsWith('Isso nao parece a chave do ElevenLabs'), true)

  // (21/10) O ID da chave colado no lugar da chave (o site lista o ID; a chave comeca com sk_).
  rota = () => ({ status: 400, corpo: { detail: { status: 'invalid_api_key', message: "API key ID used as API key - only valid API keys can be used. API keys start with 'sk_' and are shown when the key is created or rotated." } } })
  conferir('400 ID da chave no lugar da chave', (await lancou(() => testarEleven(CHAVE))).startsWith('Isso e o ID da chave, nao a chave'), true)

  rota = () => ({ status: 401, corpo: { detail: { status: 'quota_exceeded', message: 'quota' } } })
  conferir('401 quota_exceeded', (await lancou(() => testarEleven(CHAVE))).startsWith('Sem creditos no ElevenLabs'), true)

  rota = (url) =>
    url.pathname === '/v1/user'
      ? { status: 401, corpo: { detail: { status: 'missing_permissions', message: 'needs user_read' } } }
      : { status: 200, corpo: VOZES_ELEVEN }
  const restrita = await testarEleven(CHAVE)
  conferir('chave sem permissao de ler o plano: vale, com aviso', [restrita.plano, restrita.vozes.length, restrita.aviso !== null], [
    null,
    2,
    true,
  ])

  rota = () => 'rede'
  conferir('sem internet', (await lancou(() => testarEleven(CHAVE))).startsWith('Sem internet'), true)

  rota = () => ({ status: 400, corpo: { detail: { status: 'bad', message: `eco da chave ${CHAVE} aqui` } } })
  const eco = await lancou(() => testarEleven(CHAVE))
  conferir('chave ecoada pelo provedor nao chega na nota', [eco.includes(CHAVE), eco.includes('erro 400')], [false, true])

  console.log('Fish Audio')
  rota = (url) =>
    url.pathname === '/wallet/self/api-credit'
      ? { status: 200, corpo: { _id: 'x', user_id: 'u', credit: '4.2000', cumulative_top_up: '10' } }
      : {
          status: 200,
          corpo: {
            total: 3,
            items: [
              { _id: 'aaaaaaaabbbbbbbbccccccccdddddddd', type: 'tts', state: 'trained', title: 'Minha voz', languages: ['pt', 'en'], samples: [{ audio: 'https://x/a.mp3' }] },
              { _id: 'eeeeeeeeffffffff0000000011111111', type: 'tts', state: 'training', title: 'Treinando' },
              { _id: '22222222333333334444444455555555', type: 'svc', state: 'trained', title: 'Conversao' },
            ],
          },
        }
  pedidos.length = 0
  const fish = await testarFish(CHAVE_FISH)
  conferir('saldo e so a voz tts treinada', [fish.saldo, fish.vozes.map((v) => [v.nome, v.detalhe, v.previewUrl]), fish.aviso], [
    '4.2000',
    [['Minha voz', 'pt, en', 'https://x/a.mp3']],
    null,
  ])
  const urlDosModelos = new URL(pedidos[1]?.url ?? 'http://x')
  conferir('lista so as proprias (self=true)', [urlDosModelos.pathname, urlDosModelos.searchParams.get('self')], ['/model', 'true'])
  conferir('Bearer no cabecalho', pedidos.every((p) => p.cabecalhos['Authorization'] === `Bearer ${CHAVE_FISH}`), true)

  rota = (url) =>
    url.pathname === '/wallet/self/api-credit'
      ? { status: 200, corpo: { credit: '0' } }
      : { status: 200, corpo: { total: 0, items: [] } }
  const zerado = await testarFish(CHAVE_FISH)
  conferir('saldo zerado e sem voz: os dois avisos', [zerado.aviso?.startsWith('Sem creditos no Fish Audio'), zerado.aviso?.includes('voz propria')], [true, true])

  rota = () => ({ status: 401, corpo: { status: 401, message: 'Unauthorized' } })
  conferir('401 do Fish', (await lancou(() => testarFish(CHAVE_FISH))).startsWith('Chave invalida: o Fish Audio'), true)
  rota = () => ({ status: 402, corpo: { status: 402, message: 'No payment' } })
  conferir('402 do Fish', (await lancou(() => testarFish(CHAVE_FISH))).startsWith('Sem creditos no Fish Audio'), true)
  rota = () => ({ status: 503, corpo: null })
  conferir('503 do Fish', (await lancou(() => testarFish(CHAVE_FISH))).includes('fora do ar'), true)

  globalThis.fetch = fetchDeVerdade
}

// ------------------------------------------- as chaves no cofre do nucleo
/**
 * [recap] No Dangai as chaves de voz sao campos de chave DO MODULO
 * (camposDeChave): o nucleo cifra (cofre falso aqui, que so embaralha), o
 * modulo le pelo ctx.chave e a tela so ve o `chaves` do ModuloPublico. A voz
 * padrao mora na configuracao do modulo, com o MESMO formato do Studio.
 */
function testesDoCofre(): void {
  const dados = join(pasta, 'userData')
  const arquivoSettings = join(dados, 'settings.json')
  mkdirSync(dados, { recursive: true })
  const cofre: Cofre = {
    isEncryptionAvailable: () => true,
    encryptString: (t) => Buffer.from([...Buffer.from(t, 'utf8')].reverse()),
    decryptString: (b) => Buffer.from([...b].reverse()).toString('utf8'),
  }
  configureSettings(dados, cofre)
  prepararModulos([recap], { userData: dados, appPath: pasta, resourcesPath: pasta, empacotado: false, versaoDoApp: 'teste' })
  const ctx = contexto()
  const publico = () => listarModulos().find((m) => m.id === 'recap')!

  console.log('cofre')
  conferir('sem chave: tem false, dica vazia', publico().chaves, {
    elevenlabsApiKey: { tem: false, dica: '' },
    fishApiKey: { tem: false, dica: '' },
  })
  ctx.salvarChave('elevenlabsApiKey', ` ${CHAVE} `)
  ctx.salvarChave('fishApiKey', CHAVE_FISH)
  const texto = readFileSync(arquivoSettings, 'utf8')
  const disco = JSON.parse(texto) as Record<string, unknown>
  conferir('nada em texto puro no settings.json', [texto.includes(CHAVE), texto.includes(CHAVE_FISH), 'elevenlabsApiKey' in disco], [false, false, false])
  conferir('cifradas nos campos *Enc, com os nomes do Studio', [typeof disco['elevenlabsApiKeyEnc'], typeof disco['fishApiKeyEnc']], ['string', 'string'])
  conferir('o *Enc abre na chave certa (aparada)', decifrar(String(disco['elevenlabsApiKeyEnc'])) === CHAVE, true)
  configureSettings(dados, cofre) // sem cache: le do disco
  conferir('ida e volta pelo ctx.chave', [ctx.chave('elevenlabsApiKey') === CHAVE, getSettingsDoRecap().fishApiKey === CHAVE_FISH], [true, true])
  conferir('o renderer nao ve a chave', JSON.stringify(publico()).includes(CHAVE.slice(0, 20)), false)
  conferir('so tem e dica', publico().chaves['elevenlabsApiKey'], { tem: true, dica: '••••abcd' })
  conferir(
    'campo que nao e do modulo e recusado',
    (() => {
      try {
        ctx.chave('geminiApiKey')
        return 'leu'
      } catch {
        return 'recusou'
      }
    })(),
    'recusou',
  )
  ctx.salvarChave('fishApiKey', '')
  conferir("'' apaga", publico().chaves['fishApiKey'], { tem: false, dica: '' })

  console.log('voz padrao (configuracao do modulo)')
  conferir('sem nada: sem voz, nativa 1,2', configDoRecap().vozPadrao, { provedor: '', voiceId: '', modelId: '', velocidadeNativa: 1.2 })
  ctx.salvarConfig({ vozPadrao: { provedor: 'fish', voiceId: 'barra/x', modelId: 'a b' } })
  conferir('voz com id ou modelo invalido e limpa', configDoRecap().vozPadrao, { provedor: 'fish', voiceId: '', modelId: '', velocidadeNativa: 1.2 })
  ctx.salvarConfig({ vozPadrao: { provedor: 'outro', voiceId: VOZ, modelId: MODELO } })
  conferir('provedor desconhecido vira nenhum', configDoRecap().vozPadrao, { provedor: '', voiceId: '', modelId: '', velocidadeNativa: 1.2 })
  ctx.salvarConfig({ vozPadrao: { provedor: 'elevenlabs', voiceId: VOZ, modelId: MODELO, velocidadeNativa: 1 } })
  ctx.salvarConfig({ vozPadrao: { provedor: 'elevenlabs', voiceId: VOZ, modelId: '' } })
  conferir('trocar so a voz mantem a velocidade nativa escolhida', configDoRecap().vozPadrao.velocidadeNativa, 1)
  ctx.salvarConfig({ biblioteca: '' })
  conferir('gravar a biblioteca nao mexe na voz', configDoRecap().vozPadrao, { provedor: 'elevenlabs', voiceId: VOZ, modelId: '', velocidadeNativa: 1 })
  ctx.salvarConfig({ vozPadrao: { provedor: 'elevenlabs', voiceId: VOZ, modelId: '', velocidadeNativa: 1.5 } })
  conferir('velocidade nativa fora da faixa volta para dentro (1,2)', configDoRecap().vozPadrao.velocidadeNativa, 1.2)
  conferir('a voz vai para a tela (sem segredo)', (publico().config as { vozPadrao?: unknown }).vozPadrao, configDoRecap().vozPadrao)

  rmSync(arquivoSettings, { force: true })
}

/** Opcional: a chave do ElevenLabs salva (so GET, nao gasta). */
async function testeReal(): Promise<void> {
  console.log('\nde verdade (--real): chave salva -> ElevenLabs (so GET)')
  try {
    const chave = getSettingsDoRecap().elevenlabsApiKey
    if (!chave) {
      console.log('  sem chave salva')
      return
    }
    const teste = await testarEleven(chave)
    console.log(`  plano ${teste.plano ?? '?'} · ${teste.usados ?? '?'} de ${teste.limite ?? '?'} caracteres · ${teste.vozes.length} vozes`)
    if (teste.aviso) console.log(`  aviso: ${teste.aviso}`)
  } catch (err) {
    console.log(`  erro: ${err instanceof Error ? err.message : String(err)}`)
  }
}

void (async () => {
  try {
    await testesDoFetch()
    testesDoCofre()
    if (real) await testeReal()
  } catch (err) {
    falhas += 1
    console.log(`  QUEBROU: ${err instanceof Error ? err.message : String(err)}`)
  }
  console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
  process.exit(falhas === 0 ? 0 : 1)
})()
