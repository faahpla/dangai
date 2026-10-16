/**
 * O COFRE DAS CHAVES: o settings.ts grava as chaves cifradas (campos `*Enc`),
 * migra o settings antigo em texto puro, guarda como veio a chave que nao abre
 * e aceita campo de chave registrado de fora (o de um modulo).
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/teste/v-cofre.ts
 *
 * No tsx nao ha safeStorage (fora do Electron o modulo 'electron' e so o
 * caminho do executavel): usa um cofre falso, reversivel e reconhecivel. Para
 * conferir a cifra DE VERDADE (DPAPI no Windows), o mesmo arquivo roda no
 * Electron e ai usa o safeStorage:
 *   npx esbuild scripts/teste/v-cofre.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-cofre.cjs
 *   npx electron out/teste/v-cofre.cjs
 *
 * O userData vai sempre para uma pasta temporaria: nem o settings de quem roda
 * nem o "Local State" do Electron sao tocados.
 */
import * as electron from 'electron'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  configureSettings,
  decifrar,
  dicaDaChave,
  getSettings,
  getSettingsForRenderer,
  registrarCampoDeChave,
  saveSettings,
  type Cofre,
} from '../../electron/services/settings'

let falhas = 0
function conferir(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) {
    console.log(`  ok    ${nome}`)
  } else {
    falhas += 1
    console.log(`  FALHA ${nome}\n        obtido:   ${a}\n        esperado: ${b}`)
  }
}

// O aviso de "texto puro" e o de chave que nao abre sao esperados aqui: guardados para conferir, nao impressos.
const avisos: string[] = []
console.warn = (...args: unknown[]) => {
  avisos.push(args.map(String).join(' '))
}

const noElectron = typeof electron.app?.whenReady === 'function'
const pasta = mkdtempSync(join(tmpdir(), 'dangai-v-cofre-'))
const arquivo = join(pasta, 'settings.json')
// Antes do ready: e daqui que o Electron tira onde guardar a chave do cofre.
if (noElectron) electron.app.setPath('userData', pasta)

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

const ler = (): Record<string, unknown> => JSON.parse(readFileSync(arquivo, 'utf8')) as Record<string, unknown>
/** Reabre do zero: sem cache, como o app ao iniciar. No Electron, com o safeStorage. */
function reabrir(conteudo?: Record<string, unknown> | null): void {
  if (conteudo === null) rmSync(arquivo, { force: true })
  else if (conteudo) writeFileSync(arquivo, JSON.stringify(conteudo), 'utf8')
  configureSettings(pasta, noElectron ? undefined : cofreFalso)
}

function rodar(): void {
  console.log(noElectron ? 'cofre: safeStorage de verdade' : 'cofre: falso (tsx)')
  if (noElectron) conferir('cifra disponivel depois do ready', electron.safeStorage.isEncryptionAvailable(), true)

  console.log('chave cifrada no disco')
  reabrir(null)
  saveSettings({ anthropicApiKey: 'sk-ant-falsa-cofre-0001', geminiApiKey: 'AIza-falsa-cofre-0006', modulos: { x: { a: 1 } } })
  conferir('nada em texto puro no disco', readFileSync(arquivo, 'utf8').includes('falsa-cofre'), false)
  const disco = ler()
  conferir('vai no campo *Enc, sem o aberto', [typeof disco['anthropicApiKeyEnc'], 'anthropicApiKey' in disco], ['string', false])
  conferir('a do Gemini tambem', [typeof disco['geminiApiKeyEnc'], 'geminiApiKey' in disco], ['string', false])
  conferir('o base64 abre pelo cofre', decifrar(String(disco['anthropicApiKeyEnc'])), 'sk-ant-falsa-cofre-0001')
  reabrir()
  conferir('ida e volta', [getSettings().anthropicApiKey, getSettings().geminiApiKey], ['sk-ant-falsa-cofre-0001', 'AIza-falsa-cofre-0006'])
  conferir('Settings.modulos da fase 0 continua', getSettings().modulos, { x: { a: 1 } })
  const publico = getSettingsForRenderer()
  conferir('o renderer nao ve a chave', JSON.stringify(publico).includes('falsa'), false)
  conferir('so a dica, e sabe que esta cifrada', [publico.hasApiKey, publico.apiKeyHint, publico.chavesProtegidas], [
    true,
    '\u2022\u2022\u2022\u20220001',
    true,
  ])
  conferir('dica de chave curta e vazia', [dicaDaChave('12345678'), dicaDaChave('')], ['', ''])

  console.log('settings antigo, com a chave aberta')
  reabrir({ anthropicApiKey: 'sk-ant-velha-cofre-0002', whisperModel: 'base', libraryDir: 'X:/biblioteca' })
  const velho = getSettings()
  conferir('a chave antiga continua valendo', velho.anthropicApiKey, 'sk-ant-velha-cofre-0002')
  conferir('o resto fica como estava', [velho.whisperModel, velho.libraryDir], ['base', 'X:/biblioteca'])
  const migrado = ler()
  conferir('migrou na leitura: cifrada e sem a aberta', ['anthropicApiKey' in migrado, decifrar(String(migrado['anthropicApiKeyEnc']))], [
    false,
    'sk-ant-velha-cofre-0002',
  ])

  console.log('chave cifrada que nao abre (outra conta do Windows)')
  const deOutraConta = Buffer.from('de-outra-conta').toString('base64')
  reabrir({ anthropicApiKeyEnc: deOutraConta })
  conferir('vira sem chave', getSettings().anthropicApiKey, '')
  saveSettings({ whisperModel: 'medium' })
  conferir('mas nao some do disco ao salvar outra coisa', ler()['anthropicApiKeyEnc'], deOutraConta)
  saveSettings({ anthropicApiKey: 'sk-ant-nova-cofre-0003' })
  reabrir()
  conferir('e a chave nova substitui', getSettings().anthropicApiKey, 'sk-ant-nova-cofre-0003')

  console.log('campo de chave registrado de fora (fase 2: o do modulo)')
  reabrir(null)
  registrarCampoDeChave('chaveDeTesteApiKey')
  registrarCampoDeChave('chaveDeTesteApiKey') // de novo: nao duplica
  saveSettings({ chaveDeTesteApiKey: '  tst-falsa-cofre-0004 ' } as Partial<ReturnType<typeof getSettings>>)
  const comExtra = ler()
  conferir('cifrado como os do nucleo', [typeof comExtra['chaveDeTesteApiKeyEnc'], 'chaveDeTesteApiKey' in comExtra], ['string', false])
  reabrir()
  conferir('ida e volta, aparado', (getSettings() as unknown as Record<string, unknown>)['chaveDeTesteApiKey'], 'tst-falsa-cofre-0004')
  conferir('o renderer nao ve', JSON.stringify(getSettingsForRenderer()).includes('cofre-0004'), false)
  let recusou = false
  try {
    registrarCampoDeChave('nomeEnc')
  } catch {
    recusou = true
  }
  conferir('nome terminado em Enc e recusado', recusou, true)

  if (!noElectron) {
    console.log('sem cifra do sistema')
    reabrir(null)
    cifraLigada = false
    saveSettings({ anthropicApiKey: 'sk-ant-sem-cofre-0005' })
    conferir('guarda aberta, como antes', ler()['anthropicApiKey'], 'sk-ant-sem-cofre-0005')
    conferir('e avisa no log', avisos.some((a) => a.includes('texto puro')), true)
    conferir('a interface sabe', getSettingsForRenderer().chavesProtegidas, false)
    cifraLigada = true
    reabrir()
    conferir('quando a cifra volta, abre a aberta', getSettings().anthropicApiKey, 'sk-ant-sem-cofre-0005')
    conferir('e ja migra', ['anthropicApiKey' in ler(), typeof ler()['anthropicApiKeyEnc']], [false, 'string'])
  }

  console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
}

function fim(): void {
  rmSync(pasta, { recursive: true, force: true })
  if (noElectron) electron.app.exit(falhas === 0 ? 0 : 1)
  else process.exitCode = falhas === 0 ? 0 : 1
}

if (noElectron) void electron.app.whenReady().then(() => {
  rodar()
  fim()
})
else {
  rodar()
  fim()
}
