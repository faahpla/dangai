/**
 * O cerebro (llm.ts) e as chaves cifradas (settings.ts), sem chave real e sem
 * rede: o fetch e trocado por um falso que responde como o Google e a
 * Anthropic responderiam, e o safeStorage por um cofre falso.
 *
 * O que cobre:
 * - o JSON Schema que vai para o Gemini, tirado dos schemas REAIS do planner e
 *   do metadata e ja limpo, so usa o que a doc do campo aceita;
 * - chave cifrada no disco, ida e volta, migracao do settings antigo em texto
 *   puro, e o caso sem cifra do sistema;
 * - sem chave nenhuma, planner, metadata e a analise inteira caem no mesmo
 *   fallback de antes, sem tocar na rede;
 * - o Gemini: pedido no formato certo, cota do dia, cota por minuto com
 *   retentativa, 5xx, chave invalida, sem internet, troca de formato do JSON e
 *   o "Testar" das configuracoes; e a Anthropic pelo mesmo ponto unico.
 *
 * - o modelo reserva (lite): o automatico so vai nele com permissao.
 *
 * A cifra de verdade (DPAPI) so existe dentro do Electron: ver v-cofre.ts.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/teste/v-llm.ts
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { KEN_BURNS_EFFECTS, TRANSITIONS, type ImageAsset } from '../../shared/contract'
import {
  configureSettings,
  getSettings,
  getSettingsForRenderer,
  saveSettings,
  type Cofre,
} from '../../electron/services/settings'
import {
  ErroDeIa,
  SEM_CHAVE,
  SEM_MODELO_LIVRE,
  ehModeloReserva,
  escolherProvedor,
  gerarJson,
  limparSchema,
  melhorFlash,
  sucessorSugerido,
  esquecerModelos,
  msAteRenovarACota,
  schemaParaGemini,
  testarGemini,
} from '../../electron/services/llm'
import { aiPlanSchema, planWithAI } from '../../electron/services/planner'
import { aiMetadataSchema, generateMetadata } from '../../electron/services/metadata'
import { analyze } from '../../electron/services/transcribe'

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

// ---------------------------------------------------------------- o que a doc aceita
//
// Copiado da descricao do campo `_responseJsonSchema` (GenerationConfig) no
// discovery da v1beta, revisao 20261012:
//   https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta
// "only the following properties are supported: $id $defs $ref $anchor type
// format title description enum (for strings and numbers) items prefixItems
// minItems maxItems minimum maximum anyOf oneOf properties additionalProperties
// required. The non-standard propertyOrdering property may also be set. ...
// If $ref is set on a sub-schema, no other properties, except for than those
// starting as a $, may be set."
//
// Fica aqui, separado do llm.ts, de proposito: o teste confere a limpeza contra
// a doc, e nao contra a propria lista da limpeza.
const DOC = new Set([
  '$id', '$defs', '$ref', '$anchor', 'type', 'format', 'title', 'description', 'enum',
  'items', 'prefixItems', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf', 'oneOf',
  'properties', 'additionalProperties', 'required', 'propertyOrdering',
])
const TIPOS = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])

function problemas(no: unknown, onde = '#'): string[] {
  if (typeof no !== 'object' || no === null || Array.isArray(no)) return [`${onde}: nao e objeto`]
  const schema = no as Record<string, unknown>
  const achados: string[] = []
  for (const chave of Object.keys(schema)) {
    if (!DOC.has(chave)) achados.push(`${onde}: "${chave}" fora da doc`)
  }
  if ('$ref' in schema) {
    for (const chave of Object.keys(schema)) {
      if (!chave.startsWith('$')) achados.push(`${onde}: "${chave}" ao lado de $ref`)
    }
  }
  const tipo = schema['type']
  for (const t of Array.isArray(tipo) ? tipo : tipo === undefined ? [] : [tipo]) {
    if (!TIPOS.has(String(t))) achados.push(`${onde}: type "${String(t)}"`)
  }
  if (Array.isArray(schema['enum'])) {
    for (const v of schema['enum']) {
      if (typeof v !== 'string' && typeof v !== 'number') achados.push(`${onde}: enum com ${typeof v}`)
    }
  }
  if ('format' in schema && !['date-time', 'date', 'time'].includes(String(schema['format']))) {
    achados.push(`${onde}: format "${String(schema['format'])}"`)
  }
  for (const limite of ['minimum', 'maximum']) {
    const v = schema[limite]
    if (v !== undefined && (typeof v !== 'number' || Math.abs(v) >= Number.MAX_SAFE_INTEGER)) {
      achados.push(`${onde}: ${limite} ${String(v)}`)
    }
  }
  const propriedades = schema['properties'] as Record<string, unknown> | undefined
  if (propriedades) {
    for (const [nome, sub] of Object.entries(propriedades)) achados.push(...problemas(sub, `${onde}/${nome}`))
  }
  if (Array.isArray(schema['required'])) {
    for (const nome of schema['required'] as string[]) {
      if (!propriedades || !(nome in propriedades)) achados.push(`${onde}: required "${nome}" sem propriedade`)
    }
  }
  if (schema['items'] !== undefined) achados.push(...problemas(schema['items'], `${onde}/items`))
  if (typeof schema['additionalProperties'] === 'object') {
    achados.push(...problemas(schema['additionalProperties'], `${onde}/additionalProperties`))
  }
  for (const lista of ['anyOf', 'oneOf', 'prefixItems']) {
    if (Array.isArray(schema[lista])) {
      ;(schema[lista] as unknown[]).forEach((sub, i) => achados.push(...problemas(sub, `${onde}/${lista}/${i}`)))
    }
  }
  if (typeof schema['$defs'] === 'object' && schema['$defs'] !== null) {
    for (const [nome, sub] of Object.entries(schema['$defs'] as Record<string, unknown>)) {
      achados.push(...problemas(sub, `${onde}/$defs/${nome}`))
    }
  }
  return achados
}

// ---------------------------------------------------------------- fetch falso

interface Pedido {
  url: string
  metodo: string
  cabecalhos: Record<string, string>
  corpo: Record<string, unknown> | null
}
type Resposta = { status: number; json: unknown } | { rede: string }
let fila: Resposta[] = []
let pedidos: Pedido[] = []

function json(status: number, corpo: unknown): Resposta {
  return { status, json: corpo }
}

globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
  const cabecalhos: Record<string, string> = {}
  new Headers(init?.headers).forEach((valor, nome) => {
    cabecalhos[nome.toLowerCase()] = valor
  })
  const corpo = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
  pedidos.push({ url, metodo: init?.method ?? 'GET', cabecalhos, corpo })

  const proxima = fila.shift()
  if (!proxima) throw new Error(`teste: chamada que nao era esperada para ${url}`)
  if ('rede' in proxima) {
    // O AbortSignal.timeout rejeita com um erro de nome TimeoutError.
    if (proxima.rede === 'TIMEOUT') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    throw new TypeError('fetch failed', { cause: { code: proxima.rede } })
  }
  return new Response(JSON.stringify(proxima.json), {
    status: proxima.status,
    headers: { 'content-type': 'application/json' },
  })
}) as typeof fetch

const avisos: string[] = []
console.warn = (...args: unknown[]) => {
  avisos.push(args.map(String).join(' '))
}

/** O erro que a promessa lancou; se nao lancou, um Error que faz o conferir falhar. */
async function erroDe(promessa: Promise<unknown>): Promise<Error> {
  try {
    await promessa
    return new Error('(nao lancou)')
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}

function preparar(respostas: Resposta[]): void {
  fila = [...respostas]
  pedidos = []
}

function listaDeModelos(): Resposta[] {
  return [
    json(200, {
      models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ],
      nextPageToken: 'pagina-2',
    }),
    json(200, {
      models: [
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
      ],
    }),
  ]
}

function respostaDoGemini(objeto: unknown, fim = 'STOP'): Resposta {
  return json(200, {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: 'pensando...', thought: true }, { text: JSON.stringify(objeto) }],
        },
        finishReason: fim,
      },
    ],
  })
}

function cota(porDia: boolean, espera: string | null, limite = 20): Resposta {
  const detalhes: unknown[] = [
    {
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
      violations: [
        {
          quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          quotaId: porDia
            ? 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'
            : 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
        },
      ],
    },
  ]
  if (espera) detalhes.push({ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: espera })
  return json(429, {
    error: {
      code: 429,
      message: `You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: ${limite}, model: gemini-2.5-flash`,
      status: 'RESOURCE_EXHAUSTED',
      details: detalhes,
    },
  })
}

const TEXTOS = {
  titles: ['  Frieren chora ', 'O adeus de Himmel', 'Terceiro titulo'],
  description: 'Frieren lembra de Himmel. Siga o canal.',
  hashtags: ['#frieren', 'himmel', 'anime shorts'],
}
const ROTEIRO = 'Frieren volta ao vilarejo e lembra de Himmel, o heroi que mudou a vida dela para sempre.'

const pasta = mkdtempSync(join(tmpdir(), 'dangai-v-llm-'))
const arquivo = join(pasta, 'settings.json')

let cifraLigada = true
/** "Cifra" reversivel e reconhecivel: so serve para provar que o texto puro nao vai para o disco. */
const cofreFalso: Cofre = {
  isEncryptionAvailable: () => cifraLigada,
  encryptString: (texto) => Buffer.from(`COFRE:${Buffer.from(texto, 'utf8').toString('hex')}`, 'utf8'),
  decryptString: (cifrado) => {
    const texto = cifrado.toString('utf8')
    if (!texto.startsWith('COFRE:')) throw new Error('nao abre nesta conta')
    return Buffer.from(texto.slice(6), 'hex').toString('utf8')
  },
}

function lerArquivo(): Record<string, unknown> {
  return JSON.parse(readFileSync(arquivo, 'utf8')) as Record<string, unknown>
}

function zerar(conteudo: Record<string, unknown> | null): void {
  rmSync(arquivo, { force: true })
  if (conteudo) writeFileSync(arquivo, JSON.stringify(conteudo), 'utf8')
  configureSettings(pasta, cofreFalso)
}

async function main(): Promise<void> {
  console.log('o JSON Schema que vai para o Gemini')
  {
    const plano = schemaParaGemini(aiPlanSchema)
    const textos = schemaParaGemini(aiMetadataSchema)
    conferir('plano: so o que a doc aceita', problemas(plano), [])
    conferir('textos: so o que a doc aceita', problemas(textos), [])
    conferir('sem $schema na raiz', '$schema' in plano, false)

    const cena = (plano['properties'] as any).scenes.items
    conferir('os efeitos continuam no enum', cena.properties.effect.enum, [...KEN_BURNS_EFFECTS])
    conferir('as transicoes continuam no enum', cena.properties.transitionIn.enum, [...TRANSITIONS])
    conferir('intensidade com a faixa', [cena.properties.intensity.minimum, cena.properties.intensity.maximum], [0.08, 0.15])
    conferir('imageIndex inteiro, sem o teto de inteiro seguro do zod', cena.properties.imageIndex, {
      type: 'integer',
      minimum: 0,
    })
    conferir('schema fechado', [plano['additionalProperties'], cena.additionalProperties], [false, false])
    conferir('textos fechados e completos', textos, {
      type: 'object',
      properties: {
        titles: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        hashtags: { type: 'array', items: { type: 'string' } },
      },
      required: ['titles', 'description', 'hashtags'],
      additionalProperties: false,
    })

    const feio = limparSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        a: { type: 'string', const: 'x', minLength: 2, default: 'x' },
        b: { type: 'number', exclusiveMinimum: 0 },
        c: { type: 'string', format: 'email', pattern: '.+@.+' },
        d: { $ref: '#/$defs/D', description: 'nao pode ao lado de $ref' },
        e: { enum: ['a', true, null] },
      },
      required: ['a', 'b'],
      $defs: { D: { type: 'string', maxLength: 3 } },
    })
    conferir('a limpeza de um schema cheio de coisa recusada passa na doc', problemas(feio), [])
    const props = (feio as any).properties
    conferir('const vira enum', props.a, { type: 'string', enum: ['x'] })
    conferir('exclusiveMinimum vira minimum', props.b, { type: 'number', minimum: 0 })
    conferir('format desconhecido sai', props.c, { type: 'string' })
    conferir('$ref fica sozinho', props.d, { $ref: '#/$defs/D' })
  }

  console.log('chaves cifradas no settings.json')
  {
    zerar(null)
    saveSettings({ geminiApiKey: 'AIza-gemini-falsa-0001', anthropicApiKey: 'sk-ant-falsa-0002' })
    const texto = readFileSync(arquivo, 'utf8')
    conferir('nenhuma chave em texto puro no disco', [texto.includes('gemini-falsa'), texto.includes('ant-falsa')], [false, false])
    const disco = lerArquivo()
    conferir('as duas vao nos campos *Enc', [typeof disco['geminiApiKeyEnc'], typeof disco['anthropicApiKeyEnc']], ['string', 'string'])
    conferir('e os campos abertos nao existem', ['geminiApiKey' in disco, 'anthropicApiKey' in disco], [false, false])

    configureSettings(pasta, cofreFalso) // sem cache: le do disco
    const lidas = getSettings()
    conferir('ida e volta', [lidas.geminiApiKey, lidas.anthropicApiKey], ['AIza-gemini-falsa-0001', 'sk-ant-falsa-0002'])
    conferir('padroes novos', [lidas.iaProvedor, lidas.geminiModelo, lidas.anthropicModelo], ['gemini', '', 'claude-sonnet-5'])

    const publico = getSettingsForRenderer()
    conferir('o renderer nao ve chave nenhuma', JSON.stringify(publico).includes('falsa'), false)
    conferir('so as dicas', [publico.hasGeminiKey, publico.geminiKeyHint, publico.hasApiKey, publico.apiKeyHint], [
      true,
      '\u2022\u2022\u2022\u20220001',
      true,
      '\u2022\u2022\u2022\u20220002',
    ])
    conferir('e sabe que estao cifradas', publico.chavesProtegidas, true)
  }

  console.log('settings antigo, com a chave da Anthropic aberta')
  {
    zerar({ anthropicApiKey: 'sk-ant-velha-0003', whisperModel: 'base', libraryDir: 'X:/biblioteca' })
    const lidas = getSettings()
    conferir('a chave antiga continua valendo', lidas.anthropicApiKey, 'sk-ant-velha-0003')
    conferir('o resto fica como estava', [lidas.whisperModel, lidas.libraryDir], ['base', 'X:/biblioteca'])
    const disco = lerArquivo()
    conferir('migrou na leitura: cifrada e sem a aberta', ['anthropicApiKey' in disco, typeof disco['anthropicApiKeyEnc']], [false, 'string'])
    conferir('quem so tinha a Anthropic continua na Anthropic', escolherProvedor(lidas), 'anthropic')
  }

  console.log('sem cifra do sistema')
  {
    zerar(null)
    cifraLigada = false
    avisos.length = 0
    saveSettings({ geminiApiKey: 'AIza-sem-cofre-0004' })
    conferir('guarda aberta, como antes', lerArquivo()['geminiApiKey'], 'AIza-sem-cofre-0004')
    conferir('e avisa no log', avisos.some((a) => a.includes('texto puro')), true)
    conferir('a interface sabe', getSettingsForRenderer().chavesProtegidas, false)
    cifraLigada = true
    configureSettings(pasta, cofreFalso)
    conferir('quando a cifra volta, abre a aberta', getSettings().geminiApiKey, 'AIza-sem-cofre-0004')
    conferir('e ja migra', ['geminiApiKey' in lerArquivo(), typeof lerArquivo()['geminiApiKeyEnc']], [false, 'string'])
  }

  console.log('chave cifrada que nao abre (outra conta do Windows)')
  {
    zerar({ geminiApiKeyEnc: Buffer.from('de-outra-conta').toString('base64') })
    conferir('vira sem chave', getSettings().geminiApiKey, '')
    saveSettings({ whisperModel: 'medium' })
    conferir('mas nao some do disco ao salvar outra coisa', lerArquivo()['geminiApiKeyEnc'], Buffer.from('de-outra-conta').toString('base64'))
    saveSettings({ geminiApiKey: 'AIza-nova-0005' })
    configureSettings(pasta, cofreFalso)
    conferir('e a chave nova substitui', getSettings().geminiApiKey, 'AIza-nova-0005')
  }

  console.log('nome de modelo vindo de fora')
  {
    zerar(null)
    conferir('com models/ na frente', saveSettings({ geminiModelo: 'models/gemini-2.5-flash' }).geminiModelo, 'gemini-2.5-flash')
    conferir('barra nao entra na URL', saveSettings({ geminiModelo: '../../v1/files' }).geminiModelo, '')
    conferir('Anthropic estranho volta ao padrao', saveSettings({ anthropicModelo: 'a b/c' }).anthropicModelo, 'claude-sonnet-5')
  }

  console.log('quem atende')
  {
    const s = (iaProvedor: 'gemini' | 'anthropic', g: string, a: string) => ({ iaProvedor, geminiApiKey: g, anthropicApiKey: a })
    conferir('gemini com as duas', escolherProvedor(s('gemini', 'g', 'a')), 'gemini')
    conferir('anthropic com as duas', escolherProvedor(s('anthropic', 'g', 'a')), 'anthropic')
    conferir('gemini sem a dele cai na outra', escolherProvedor(s('gemini', '', 'a')), 'anthropic')
    conferir('anthropic sem a dela cai na outra', escolherProvedor(s('anthropic', 'g', '')), 'gemini')
    conferir('nenhuma', escolherProvedor(s('gemini', '', '')), null)
    conferir('forcado nao cai na outra', escolherProvedor(s('gemini', '', 'a'), 'gemini'), null)
  }

  console.log('o modelo do automatico')
  {
    conferir('o mais novo, mesmo com o velho na lista', melhorFlash(['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash']), 'gemini-3.8-flash')
    conferir(
      'sucessor do 404 de modelo aposentado',
      sucessorSugerido('This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements.'),
      'gemini-3.8-flash',
    )
    conferir('404 sem sucessor', sucessorSugerido('models/x is not found for API version v1beta'), null)
    conferir('senao o flash estavel e cheio', melhorFlash(['gemini-3.8-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3-pro']), 'gemini-3.5-flash')
    conferir('so preview: o preview', melhorFlash(['gemini-3.8-flash-preview-09-2026', 'gemini-3-pro']), 'gemini-3.8-flash-preview-09-2026')
    conferir('sem flash: um gemini de texto', melhorFlash(['gemini-3-pro', 'gemini-3-pro-image', 'gemma-3-27b-it']), 'gemini-3-pro')
    conferir('nada', melhorFlash([]), null)
  }

  console.log('sem chave nenhuma: o mesmo fallback de antes, sem rede')
  {
    zerar(null)
    preparar([])
    {
      const err = await erroDe(planWithAI({ imageCount: 2, durationSec: 4, transcript: { source: 'srt', words: [], segments: [], text: 'x', cutCandidates: [] } as any, imageNames: ['a', 'b'] }))
      conferir('planner sem chave lanca ErroDeIa com a nota', [err instanceof ErroDeIa, (err as ErroDeIa).nota], [true, SEM_CHAVE])
    }
    {
      const err = await erroDe(generateMetadata({ texto: ROTEIRO }))
      conferir('metadata sem chave lanca a nota', (err as Error).message, SEM_CHAVE)
    }

    // A analise inteira, com .srt e sem audio de verdade: sem chave, o
    // transcribe.ts nem chama o planner e devolve o fallback de sempre.
    const srt = join(pasta, 'narracao.srt')
    writeFileSync(
      srt,
      '1\n00:00:00,000 --> 00:00:02,000\nFrieren volta ao vilarejo.\n\n2\n00:00:02,000 --> 00:00:04,000\nE lembra de Himmel.\n',
      'utf8',
    )
    const imagem = (nome: string): ImageAsset =>
      ({ id: nome, path: join(pasta, nome), fileName: nome, url: '', urlSource: null, width: 1080, height: 1920, thumbnail: '', focusX: 0.5, focusY: 0.5, focusAuto: false, kind: 'image' }) as unknown as ImageAsset
    const resultado = await analyze(
      { audioPath: join(pasta, 'nao-existe.mp3'), subtitlePath: srt, images: [imagem('a.png'), imagem('b.png')], durationSec: 4, script: null },
      () => {},
      (caminho) => caminho,
    )
    conferir('analise: nao veio da IA', resultado.origin === 'ai', false)
    conferir('analise: a nota de sempre', resultado.aiNote, 'Sem chave da API — cenas distribuidas pelas pausas da narracao.')
    conferir('analise: duas cenas', resultado.plan.scenes.length, 2)
    conferir('nenhuma chamada de rede', pedidos.length, 0)
  }

  console.log('Gemini: o pedido no formato da doc')
  {
    zerar(null)
    saveSettings({ geminiApiKey: 'AIza-falsa-de-teste-0006', iaProvedor: 'gemini' })
    preparar([...listaDeModelos(), respostaDoGemini(TEXTOS)])
    const textos = await generateMetadata({ texto: ROTEIRO })
    conferir('textos saneados como antes', textos, {
      titles: ['Frieren chora', 'O adeus de Himmel', 'Terceiro titulo'],
      description: 'Frieren lembra de Himmel. Siga o canal.',
      hashtags: ['frieren', 'himmel', 'animeshorts'],
    })
    conferir('listou as duas paginas', pedidos.slice(0, 2).map((p) => p.url.replace(/^.*\/v1beta\//, '')), [
      'models?pageSize=1000',
      'models?pageSize=1000&pageToken=pagina-2',
    ])
    const gerar = pedidos[2]!
    conferir('automatico = o flash mais novo da lista', gerar.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent')
    conferir('POST com a chave no cabecalho', [gerar.metodo, gerar.cabecalhos['x-goog-api-key']], ['POST', 'AIza-falsa-de-teste-0006'])
    conferir('chave fora da URL', pedidos.some((p) => p.url.includes('AIza')), false)
    const config = gerar.corpo!['generationConfig'] as Record<string, unknown>
    conferir('responseMimeType JSON', config['responseMimeType'], 'application/json')
    conferir('responseJsonSchema = o schema limpo', config['responseJsonSchema'], schemaParaGemini(aiMetadataSchema))
    conferir('sem $schema no corpo', JSON.stringify(gerar.corpo).includes('$schema'), false)
    conferir('systemInstruction e contents', [
      typeof (gerar.corpo!['systemInstruction'] as any).parts[0].text,
      (gerar.corpo!['contents'] as any)[0].role,
      (gerar.corpo!['contents'] as any)[0].parts[0].text.includes(ROTEIRO),
    ], ['string', 'user', true])
  }

  console.log('Gemini: cota do dia')
  {
    // A mao: nao troca de modelo, a nota da cota e pronto.
    saveSettings({ geminiModelo: 'gemini-3.5-flash' })
    preparar([cota(true, '50000s')])
    {
      const err = await erroDe(generateMetadata({ texto: ROTEIRO }))
      conferir('a nota da cota gratis', (err as Error).message.startsWith('A cota gratis do Gemini acabou por hoje; ela renova a meia-noite (horario do Pacifico'), true)
    }
    conferir('a mao: nao tenta de novo nem troca', pedidos.length, 1)
    saveSettings({ geminiModelo: '' })

    // O caso real de 13/10/2026: a cota gratis e POR MODELO. No automatico, o
    // esgotado sai da escolha ate a cota renovar e o proximo da lista responde.
    preparar([cota(true, '50000s'), ...listaDeModelos(), respostaDoGemini(TEXTOS)])
    const textos = await generateMetadata({ texto: ROTEIRO })
    conferir('automatico: troca de modelo e da certo', textos.titles.length, 3)
    conferir('sem retentativa no esgotado', pedidos.filter((p) => p.url.includes('gemini-3.5-flash:')).length, 1)
    conferir('foi no proximo da lista', pedidos[pedidos.length - 1]!.url.includes('gemini-2.5-flash:'), true)
    preparar([respostaDoGemini(TEXTOS)])
    await generateMetadata({ texto: ROTEIRO })
    conferir('o seguinte ja vai direto no outro', pedidos.map((p) => p.url.replace(/^.*\/models\//, '')), ['gemini-2.5-flash:generateContent'])

    // A cota renova a meia-noite do Pacifico (PDT = UTC-7 em outubro).
    const meiaNoitePdt = Date.UTC(2026, 9, 14, 7, 0, 0)
    conferir('renova a meia-noite do Pacifico', [
      msAteRenovarACota(meiaNoitePdt - 3_600_000),
      msAteRenovarACota(meiaNoitePdt + 1_000),
      msAteRenovarACota(meiaNoitePdt - 10_000),
    ], [3_600_000, 86_399_000, 60_000])

    // Volta ao estado dos testes seguintes: automatico no gemini-3.5-flash.
    esquecerModelos()
    preparar([...listaDeModelos(), respostaDoGemini(TEXTOS)])
    await generateMetadata({ texto: ROTEIRO })
  }

  console.log('Gemini: cota por minuto, com retryDelay')
  {
    preparar([cota(false, '0.05s'), respostaDoGemini(TEXTOS)])
    const textos = await generateMetadata({ texto: ROTEIRO })
    conferir('esperou e conseguiu', [textos.titles.length, pedidos.length], [3, 2])
  }

  console.log('Gemini: modelo sem cota gratis (limit: 0)')
  {
    // So acontece com modelo escolhido a mao: o automatico iria no proximo.
    saveSettings({ geminiModelo: 'gemini-3.5-flash' })
    preparar([cota(true, null, 0)])
    {
      const err = await erroDe(generateMetadata({ texto: ROTEIRO }))
      conferir('diz para trocar de modelo', (err as Error).message.includes('nao tem cota gratis'), true)
    }
    saveSettings({ geminiModelo: '' })
  }

  console.log('Gemini: instavel (5xx)')
  {
    const fora = json(503, {
      error: {
        code: 503,
        message: 'The model is overloaded. Please try again later.',
        status: 'UNAVAILABLE',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.01s' }],
      },
    })
    // Sem lista na hora de trocar (a fila acaba): desiste com a nota.
    preparar([fora, fora, fora])
    {
      const err = await erroDe(generateMetadata({ texto: ROTEIRO }))
      conferir('desiste com a nota', (err as Error).message, 'O Gemini esta instavel agora. Tente de novo em alguns minutos.')
    }
    conferir('1 chamada + 2 retentativas no mesmo modelo', pedidos.slice(0, 3).every((p) => p.url.includes('gemini-3.5-flash:')), true)

    // O caso real de 13/10/2026: o sucessor recem-lancado vive lotado (503
    // "high demand"). No automatico, vai no proximo da lista em vez de desistir.
    zerar(null)
    esquecerModelos()
    saveSettings({ geminiApiKey: 'AIza-falsa-de-teste-0006', iaProvedor: 'gemini' })
    preparar([...listaDeModelos(), fora, fora, fora, ...listaDeModelos(), respostaDoGemini(TEXTOS)])
    const textos = await generateMetadata({ texto: ROTEIRO })
    conferir('lotado: troca de modelo e da certo', textos.titles.length > 0, true)
    conferir('foi no proximo da lista', pedidos[pedidos.length - 1]!.url.includes('gemini-2.5-flash:'), true)
  }

  console.log('Gemini: chave invalida e sem internet')
  {
    preparar([
      json(400, {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }],
        },
      }),
    ])
    {
      const err = await erroDe(generateMetadata({ texto: ROTEIRO }))
      conferir('chave recusada', (err as Error).message, 'Chave do Gemini recusada. Confira em configuracoes (Ctrl+,).')
    }
    conferir('chave errada nao repete', pedidos.length, 1)

    preparar([{ rede: 'ENOTFOUND' }])
    {
      const err = await erroDe(generateMetadata({ texto: ROTEIRO }))
      conferir('sem internet', (err as Error).message, 'Sem conexao com o Gemini. Confira a internet e tente de novo.')
    }
  }

  console.log('Gemini: o Google recusa o campo responseJsonSchema')
  {
    preparar([
      json(400, {
        error: {
          code: 400,
          message: 'Invalid JSON payload received. Unknown name "responseJsonSchema" at \'generation_config\': Cannot find field.',
          status: 'INVALID_ARGUMENT',
        },
      }),
      respostaDoGemini(TEXTOS),
    ])
    const textos = await generateMetadata({ texto: ROTEIRO })
    conferir('conseguiu na segunda', textos.titles.length, 3)
    const segundo = pedidos[1]!.corpo!['generationConfig'] as any
    conferir('com responseFormat.text', [segundo.responseFormat.text.mimeType, 'responseJsonSchema' in segundo], ['APPLICATION_JSON', false])
    preparar([respostaDoGemini(TEXTOS)])
    await generateMetadata({ texto: ROTEIRO })
    conferir('e lembra qual serviu', 'responseFormat' in (pedidos[0]!.corpo!['generationConfig'] as any), true)
  }

  console.log('Gemini: resposta fora do schema e resposta cortada')
  {
    preparar([respostaDoGemini({ titles: 'nao e lista' })])
    {
      const err = await erroDe(generateMetadata({ texto: ROTEIRO }))
      conferir('o zod barra', (err as Error).message, 'O Gemini devolveu um formato inesperado.')
    }
    preparar([json(200, { candidates: [{ content: { parts: [{ text: '{"titles": ["a' }] }, finishReason: 'MAX_TOKENS' }] })])
    {
      const err = await erroDe(generateMetadata({ texto: ROTEIRO }))
      conferir('cortada', (err as Error).message, 'A resposta do Gemini veio cortada no meio. Tente de novo.')
    }
  }

  console.log('Gemini no planner: o friendlyAiNote continua reconhecendo')
  {
    const cena = (imageIndex: number, start: number, end: number) => ({
      imageIndex, start, end, effect: 'zoom-in', intensity: 0.1, transitionIn: 'cut', reason: 'muda de assunto',
    })
    preparar([respostaDoGemini({ scenes: [cena(0, 0, 2), cena(1, 2, 4)] })])
    const transcript = { source: 'srt', words: [], segments: [{ start: 0, end: 4, text: 'Frieren volta.' }], text: 'Frieren volta.', cutCandidates: [] } as any
    const plano = await planWithAI({ imageCount: 2, durationSec: 4, transcript, imageNames: ['a.png', 'b.png'] })
    conferir('plano do Gemini', plano.scenes.map((c) => [c.imageIndex, c.start, c.end]), [[0, 0, 2], [1, 2, 4]])

    preparar([cota(true, null)])
    {
      const err = await erroDe(planWithAI({ imageCount: 2, durationSec: 4, transcript, imageNames: ['a.png', 'b.png'] }))
      const e = err as ErroDeIa
      conferir('message tecnica com 429 (o friendlyAiNote acha "429")', e.message.includes('429'), true)
      conferir('nota pronta junto', e.nota.startsWith('A cota gratis do Gemini acabou por hoje'), true)
    }
  }

  console.log('o botao Testar')
  {
    zerar(null)
    esquecerModelos()
    preparar([...listaDeModelos(), respostaDoGemini({ ok: true })])
    const teste = await testarGemini('AIza-digitada-0007', '')
    conferir('lista so os Gemini de texto, mais novos primeiro', teste.modelos, ['gemini-3.5-flash', 'gemini-2.5-flash'])
    conferir('usou o automatico e deu certo', [teste.modelo, teste.aviso], ['gemini-3.5-flash', null])
    conferir('com a chave digitada', pedidos[0]!.cabecalhos['x-goog-api-key'], 'AIza-digitada-0007')

    preparar([...listaDeModelos(), cota(true, null)])
    const semCota = await testarGemini('AIza-digitada-0007', 'gemini-3.5-flash')
    conferir('chave boa sem cota vira aviso', [semCota.modelo, semCota.aviso?.startsWith('A cota gratis') ?? false], ['gemini-3.5-flash', true])

    // O caso real de 13/10/2026: o modelo aparece na lista mas da 404 para
    // chave nova, e a mensagem indica o sucessor.
    preparar([
      ...listaDeModelos(),
      json(404, {
        error: {
          code: 404,
          message:
            'This model models/gemini-3.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements.',
          status: 'NOT_FOUND',
        },
      }),
      respostaDoGemini({ ok: true }),
    ])
    const aposentado = await testarGemini('AIza-digitada-0007', '')
    conferir('modelo aposentado: vai no sucessor indicado', [aposentado.modelo, aposentado.aviso], ['gemini-3.8-flash', null])
    conferir('e o aposentado sai da lista', aposentado.modelos.includes('gemini-3.5-flash'), false)

    preparar([json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } })])
    {
      const err = await erroDe(testarGemini('AIza-errada', ''))
      // O teste roda no proprio campo da chave: sem o "Confira em configuracoes" (revisao C de 15/10).
      conferir('chave errada lanca a nota (curta: o campo esta ali)', (err as Error).message, 'Chave do Gemini recusada.')
    }
  }

  console.log('Gemini: o automatico sem modelo livre, e o tempo esgotado')
  {
    zerar(null)
    esquecerModelos()
    saveSettings({ geminiApiKey: 'AIza-falsa-de-teste-0006', iaProvedor: 'gemini' })
    // Todos sem cota gratis ("limit: 0"): a nota nao manda escolher outro modelo.
    const semCota = cota(true, null, 0)
    preparar([...listaDeModelos(), semCota, ...listaDeModelos(), semCota, ...listaDeModelos()])
    {
      const err = await erroDe(generateMetadata({ texto: ROTEIRO }))
      conferir('rodou a lista: a nota do automatico', (err as Error).message, SEM_MODELO_LIVRE)
    }
    conferir('tentou os dois modelos', pedidos.filter((p) => p.url.endsWith(':generateContent')).length, 2)

    // Tempo esgotado no automatico: desiste ja (nao espera outro modelo na
    // mesma chamada), mas o "Tente de novo" vai no proximo da lista.
    esquecerModelos()
    preparar([...listaDeModelos(), { rede: 'TIMEOUT' }])
    {
      const err = await erroDe(generateMetadata({ texto: ROTEIRO }))
      conferir('tempo esgotado: a nota', (err as Error).message, 'O Gemini demorou demais para responder. Tente de novo.')
    }
    conferir('tempo esgotado: uma chamada so', pedidos.filter((p) => p.url.endsWith(':generateContent')).length, 1)
    preparar([...listaDeModelos(), respostaDoGemini(TEXTOS)])
    await generateMetadata({ texto: ROTEIRO })
    conferir('o seguinte vai em outro modelo', pedidos[pedidos.length - 1]!.url.includes('gemini-2.5-flash:'), true)

    // A mao: o tempo esgotado nao tira o modelo dele.
    esquecerModelos()
    saveSettings({ geminiModelo: 'gemini-3.5-flash' })
    preparar([{ rede: 'TIMEOUT' }])
    await erroDe(generateMetadata({ texto: ROTEIRO }))
    preparar([respostaDoGemini(TEXTOS)])
    await generateMetadata({ texto: ROTEIRO })
    conferir('a mao: continua no escolhido', pedidos.map((p) => p.url.replace(/^.*\/models\//, '')), ['gemini-3.5-flash:generateContent'])
    saveSettings({ geminiModelo: '' })
    esquecerModelos()
  }

  console.log('modelo reserva (lite): so com permissao')
  {
    conferir(
      'quem e reserva (o "mini" de "gemini" nao conta)',
      ['gemini-3.5-flash-lite', 'gemini-1.5-flash-8b', 'gemini-nano', 'gemini-3.8-flash', 'gemini-3-pro'].map(ehModeloReserva),
      [true, true, true, false, false],
    )
    conferir('so bons: o flash cheio', melhorFlash(['gemini-3.5-flash-lite', 'gemini-3.5-flash'], true), 'gemini-3.5-flash')
    conferir('so bons sem bom: nenhum; senao o lite', [melhorFlash(['gemini-3.5-flash-lite'], true), melhorFlash(['gemini-3.5-flash-lite'])], [
      null,
      'gemini-3.5-flash-lite',
    ])

    zerar(null)
    esquecerModelos()
    saveSettings({ geminiApiKey: 'AIza-falsa-de-teste-0006', iaProvedor: 'gemini' })
    const comLite = (): Resposta[] => [
      json(200, {
        models: [
          { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
        ],
      }),
    ]
    const pedido = (permitirReserva: boolean) => ({
      schema: z.object({ ok: z.boolean() }),
      sistema: 'Responda so com o JSON pedido.',
      prompt: 'Devolva ok = true.',
      etapa: 'teste',
      permitirReserva,
    })
    // O bom acabou a cota do dia: so o lite sobra.
    preparar([...comLite(), cota(true, null), ...comLite()])
    const parada = await gerarJson(pedido(false))
    conferir('sem permissao: para e diz qual e o reserva', [parada.ok, !parada.ok && parada.motivo === 'so-reserva' ? parada.reserva : null], [
      false,
      'gemini-3.5-flash-lite',
    ])
    conferir('e o lite nao foi chamado', pedidos.some((p) => p.url.includes('flash-lite:')), false)
    preparar([...comLite(), respostaDoGemini({ ok: true })])
    const comPermissao = await gerarJson(pedido(true))
    conferir('com permissao: vai no lite', comPermissao.ok ? comPermissao.modelo : null, 'gemini-3.5-flash-lite')
    esquecerModelos()
  }

  console.log('Anthropic pelo mesmo ponto unico')
  {
    zerar(null)
    saveSettings({ anthropicApiKey: 'sk-ant-falsa-0008', anthropicModelo: 'claude-modelo-de-teste' })
    preparar([
      json(200, {
        id: 'msg_teste',
        type: 'message',
        role: 'assistant',
        model: 'claude-modelo-de-teste',
        content: [{ type: 'text', text: JSON.stringify(TEXTOS) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    ])
    const textos = await generateMetadata({ texto: ROTEIRO })
    conferir('so com a da Anthropic, vai na Anthropic', pedidos[0]?.url.startsWith('https://api.anthropic.com/v1/messages'), true)
    conferir('com o modelo das configuracoes', pedidos[0]?.corpo?.['model'], 'claude-modelo-de-teste')
    conferir('e o max_tokens de antes', pedidos[0]?.corpo?.['max_tokens'], 2048)
    conferir('textos saneados', textos.hashtags, ['frieren', 'himmel', 'animeshorts'])

    // O modelo forcado (escritor pago do modulo recap): vale so com o provedor forcado.
    preparar([
      json(200, {
        id: 'msg_teste2',
        type: 'message',
        role: 'assistant',
        model: 'claude-forcado',
        content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    ])
    const forcado = await gerarJson({ schema: z.object({ ok: z.boolean() }), sistema: 's', prompt: 'p', etapa: 'teste', provedor: 'anthropic', modelo: 'claude-forcado' })
    conferir('modelo forcado vai no pedido', pedidos[0]?.corpo?.['model'], 'claude-forcado')
    conferir('e volta como o modelo que respondeu', forcado.ok && forcado.modelo, 'claude-forcado')

    preparar([json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })])
    {
      const err = await erroDe(planWithAI({ imageCount: 1, durationSec: 2, transcript: { source: 'srt', words: [], segments: [], text: 'x', cutCandidates: [] } as any, imageNames: ['a'] }))
      const e = err as ErroDeIa
      conferir('401: message tecnica como antes', e.message.startsWith('401'), true)
      conferir('401: nota pronta', e.nota, 'Chave da Anthropic recusada. Confira em configuracoes (Ctrl+,).')
    }
  }

  rmSync(pasta, { recursive: true, force: true })
  console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
  process.exitCode = falhas === 0 ? 0 : 1
}

main().catch((err: unknown) => {
  console.log('ERRO', err)
  rmSync(pasta, { recursive: true, force: true })
  process.exitCode = 1
})
