import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'

/**
 * Guarda tres campos em um JSON no userData.
 *
 * A spec pedia electron-store, mas a v11 e ESM puro ("type": "module", sem
 * main) e o processo main aqui e CJS -- externalizado, o require() quebra.
 * Para tres campos nao compensa comprar a briga ESM/CJS; isto faz o mesmo,
 * inclusive escrita atomica.
 *
 * A chave da API vive aqui, fora do repositorio. Nunca em .env, nunca no codigo.
 *
 * As chaves vao para o disco cifradas pelo safeStorage (DPAPI no Windows), em
 * campos `*Enc`. Em memoria elas ficam abertas: quem chama getSettings() ve
 * `anthropicApiKey` como sempre viu. O settings.json e copiado junto em backup
 * e suporte; chave em texto puro ali e chave vazada.
 */

/**
 * Os campos que sao chave de API: so estes passam pelo cofre.
 *
 * Lista aberta de proposito: um modulo com chave propria registra o campo com
 * registrarCampoDeChave, e ela ganha a mesma cifra, a mesma migracao e o mesmo
 * cuidado com a chave que nao abre, sem o nucleo conhecer o modulo.
 */
const CAMPOS_DE_CHAVE: string[] = ['anthropicApiKey', 'geminiApiKey']

/**
 * Poe mais um campo no cofre. Ele mora na raiz do settings.json (no disco como
 * `<campo>Enc`) e, em memoria, aparece aberto no objeto de getSettings(), como
 * os do nucleo -- mas nunca vai para o renderer.
 *
 * Melhor chamar antes do primeiro getSettings(); depois tambem serve, porque o
 * cache e relido do disco.
 */
export function registrarCampoDeChave(campo: string): void {
  // So nome simples: o campo vira chave do JSON e ganha o sufixo Enc.
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(campo) || campo.endsWith('Enc')) {
    throw new Error(`Campo de chave inválido: ${campo}`)
  }
  if (CAMPOS_DE_CHAVE.includes(campo)) return
  CAMPOS_DE_CHAVE.push(campo)
  cache = null
  ilegiveis = {}
}

/**
 * O pedaco do safeStorage que isto usa.
 *
 * Separado para o teste trocar por um falso: fora do Electron o modulo
 * 'electron' e so o caminho do executavel, sem safeStorage nenhum.
 */
export interface Cofre {
  isEncryptionAvailable(): boolean
  encryptString(texto: string): Buffer
  decryptString(cifrado: Buffer): string
}

export interface Settings {
  anthropicApiKey: string
  /** Chave do Google AI Studio. O Gemini e o padrao: tem cota gratis. */
  geminiApiKey: string
  /**
   * Qual IA ele prefere. Sem a chave dela, vale a outra que tiver chave -- quem
   * so tem a da Anthropic (todo usuario antigo) continua como estava.
   */
  iaProvedor: 'gemini' | 'anthropic'
  /** Modelo do Gemini. Vazio = automatico, o melhor "flash" que a chave enxerga. */
  geminiModelo: string
  /** Modelo da Anthropic. Antes fixo no planner e no metadata. */
  anthropicModelo: string
  /** Modelo do Whisper: quanto maior, melhor e mais lento. */
  whisperModel: 'base' | 'small' | 'medium'
  /** Pasta dos SFX. Vazio = usa a que vem com o app. */
  sfxDir: string
  /** Raiz da biblioteca de cenas do AnCut. Vazio = a biblioteca fica desligada. */
  libraryDir: string
  /**
   * Curvas de movimento que ele guardou.
   *
   * Ficam aqui e nao no projeto porque um ritmo que ele gostou vale para os
   * PROXIMOS videos -- guardar no projeto obrigaria a redesenhar a mesma curva
   * em cada um.
   */
  curvePresets: { nome: string; pontos: [number, number, number, number] }[]
  /**
   * O estilo de legenda que ele deixou por ultimo.
   *
   * Mesmo motivo das curvas: cor, altura, tamanho, fonte e contorno sao gosto
   * DELE, nao caracteristica de um video. Guardado so no projeto, cada video
   * novo nascia no padrao de fabrica e obrigava a refazer os mesmos ajustes --
   * "toda vez ficar alterando e um saco".
   *
   * O projeto continua guardando o proprio estilo: abrir um video antigo mostra
   * o que ELE tinha, e nao o de agora. Isto aqui e so o ponto de partida de
   * quem comeca do zero.
   *
   * `null` ate ele mexer em alguma coisa pela primeira vez.
   */
  captionStyle: Record<string, unknown> | null
  /**
   * Estilos de legenda que ele guardou com nome. Conferidos do outro lado, pelo
   * schema do contract -- aqui so atravessam como objetos.
   */
  captionPresets: Record<string, unknown>[]
  /** As Power Bins: colecoes de arquivos que ele arrasta para a linha do tempo. */
  bins: Record<string, unknown>[]
  /** Curvas da entrada da legenda que ele desenhou e guardou. */
  curvasDeEntrada: Record<string, unknown>[]
  /** Atalhos de teclado configurados. Conferidos no renderer; null = os de fabrica. */
  atalhos: Record<string, unknown> | null
  /** Projetos recentes, o mais novo primeiro. Conferidos no renderer. */
  recentes: Record<string, unknown>[]
  /** Presets de correcao de cor. Conferidos no renderer pelo ajusteDeCorSchema. */
  presetsDeCor: Record<string, unknown>[]
  /** Transicoes configuradas e guardadas com nome. Conferidas no renderer. */
  presetsDeTransicao: Record<string, unknown>[]
  /**
   * As configuracoes de cada MODULO (o Gerar recap), por id do modulo.
   *
   * O nucleo nao entende nada daqui: guarda e devolve como veio. Sem isto, o
   * `coerce` -- que so deixa passar o que conhece -- apagaria as preferencias
   * e as chaves do modulo no primeiro save. Quem confere o proprio pedaco e o
   * modulo. Nao vai para o renderer por aqui.
   */
  modulos: Record<string, unknown>
  /** Que modulo esta ligado, por id. Sem entrada = o padrao do modulo. */
  modulosLigados: Record<string, boolean>
}

const DEFAULTS: Settings = {
  anthropicApiKey: '',
  geminiApiKey: '',
  iaProvedor: 'gemini',
  geminiModelo: '',
  // O mesmo que o planner e o metadata usavam fixo: quem so tem a Anthropic nao muda de modelo.
  anthropicModelo: 'claude-sonnet-5',
  whisperModel: 'small',
  sfxDir: '',
  libraryDir: '',
  curvePresets: [],
  captionPresets: [],
  bins: [],
  curvasDeEntrada: [],
  captionStyle: null,
  atalhos: null,
  recentes: [],
  presetsDeCor: [],
  presetsDeTransicao: [],
  modulos: {},
  modulosLigados: {},
}

let filePath: string | null = null
let cache: Settings | null = null
let cofre: Cofre | null = null
/**
 * Chave cifrada que nao abriu -- settings.json trazido de outra conta do
 * Windows, por exemplo. Volta para o disco como veio: regravar sem ela apagaria
 * de vez uma chave que ainda abre na conta certa.
 */
let ilegiveis: Record<string, string> = {}
/**
 * Os campos do settings.json que esta versao NAO conhece -- de uma versao mais
 * nova do Dangai, ou a chave cifrada (`<campo>Enc`) de um modulo que nao esta
 * instalado aqui. O `coerce` so deixa passar o que conhece; sem isto, o primeiro
 * save apagaria esses campos em silencio. Voltam ao disco como vieram.
 */
let extrasDoArquivo: Record<string, unknown> = {}
let avisouTextoPuro = false

export function configureSettings(userDataDir: string, cofreDoTeste?: Cofre): void {
  filePath = join(userDataDir, 'settings.json')
  // O main chama isto depois do 'ready': antes dele o safeStorage do Windows
  // responde que nao ha cifra, e as chaves iriam para o disco abertas. Fora do
  // Electron (os testes no tsx) o safeStorage nem existe: fica sem cofre.
  cofre = cofreDoTeste ?? safeStorage ?? null
  cache = null
  ilegiveis = {}
  extrasDoArquivo = {}
}

export function getSettings(): Settings {
  if (cache) return cache
  if (!filePath) throw new Error('Settings não configurado')

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    // Arquivo ausente ou corrompido: volta ao padrao em vez de derrubar o app.
    cache = { ...DEFAULTS }
    extrasDoArquivo = {}
    return cache
  }

  const { chaves, emTextoPuro } = abrirChaves(raw)
  cache = coerce({ ...(raw as object), ...chaves })
  extrasDoArquivo = camposDesconhecidos(raw)

  // Settings de antes da cifra, com a chave aberta no arquivo: regrava ja
  // cifrado. Acontece uma vez; da proxima a chave vem do campo *Enc.
  if (emTextoPuro && cifraDisponivel()) {
    try {
      gravar(cache)
    } catch (err) {
      console.warn('[settings] nao deu para cifrar as chaves antigas:', err)
    }
  }
  return cache
}

/** Quem quer saber que as configuracoes mudaram (o main avisa a janela). */
const aoMudar = new Set<() => void>()
export function aoMudarAsConfiguracoes(ouvinte: () => void): () => void {
  aoMudar.add(ouvinte)
  return () => aoMudar.delete(ouvinte)
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const salvas = gravarSettings(patch)
  for (const ouvinte of aoMudar) {
    try {
      ouvinte()
    } catch (err) {
      console.warn('[settings] ouvinte falhou:', err)
    }
  }
  return salvas
}

function gravarSettings(patch: Partial<Settings>): Settings {
  if (!filePath) throw new Error('Settings não configurado')

  const next = coerce({ ...getSettings(), ...patch })
  // Chave nova (ou apagada de proposito) substitui a cifrada que nao abria.
  for (const campo of CAMPOS_DE_CHAVE) {
    if (campo in patch) delete ilegiveis[campo]
  }
  gravar(next)

  cache = next
  return next
}

function gravar(settings: Settings): void {
  if (!filePath) throw new Error('Settings não configurado')
  mkdirSync(dirname(filePath), { recursive: true })

  // Escreve em temporario e renomeia: se o app morrer no meio, o arquivo
  // antigo continua intacto em vez de virar JSON pela metade.
  const temp = `${filePath}.tmp`
  writeFileSync(temp, JSON.stringify(paraODisco(settings), null, 2), 'utf8')
  renameSync(temp, filePath)
}

/** O que vai para o arquivo: igual ao de memoria, mas com as chaves cifradas. */
function paraODisco(settings: Settings): Record<string, unknown> {
  const disco: Record<string, unknown> = { ...extrasDoArquivo, ...settings }
  for (const campo of CAMPOS_DE_CHAVE) {
    const chave = disco[campo]
    delete disco[campo]
    if (typeof chave !== 'string' || !chave) {
      const guardada = ilegiveis[campo]
      if (guardada) disco[`${campo}Enc`] = guardada
      continue
    }
    const cifrada = cifrar(chave)
    if (cifrada !== null) {
      disco[`${campo}Enc`] = cifrada
    } else {
      // Sem cifra do sistema (Linux sem chaveiro, por exemplo) o app continua
      // funcionando como antes, com a chave aberta -- mas avisa no log.
      if (!avisouTextoPuro) {
        console.warn('[settings] safeStorage indisponivel: as chaves ficam em texto puro no settings.json.')
        avisouTextoPuro = true
      }
      disco[campo] = chave
    }
  }
  return disco
}

/**
 * Le as chaves do arquivo: a aberta de settings antigos, ou a cifrada.
 *
 * A aberta ganha quando as duas existem. O app nunca grava as duas juntas, entao
 * isso so acontece quando ele colou uma chave nova a mao no arquivo -- e a nova
 * e a que ele quer.
 */
function abrirChaves(raw: unknown): { chaves: Record<string, string>; emTextoPuro: boolean } {
  const chaves: Record<string, string> = {}
  let emTextoPuro = false
  if (typeof raw !== 'object' || raw === null) return { chaves, emTextoPuro }
  const value = raw as Record<string, unknown>

  for (const campo of CAMPOS_DE_CHAVE) {
    const aberta = value[campo]
    if (typeof aberta === 'string' && aberta.trim().length > 0) {
      chaves[campo] = aberta
      emTextoPuro = true
      continue
    }
    const cifrada = value[`${campo}Enc`]
    if (typeof cifrada !== 'string' || cifrada.length === 0) continue
    const decifrada = decifrar(cifrada)
    if (decifrada === null) {
      console.warn(`[settings] a ${campo} cifrada nao abre nesta conta; fica guardada como veio.`)
      ilegiveis[campo] = cifrada
      chaves[campo] = ''
    } else {
      chaves[campo] = decifrada
    }
  }
  return { chaves, emTextoPuro }
}

function cifraDisponivel(): boolean {
  try {
    return cofre?.isEncryptionAvailable() === true
  } catch {
    return false
  }
}

/** Texto -> base64 cifrado. null = sem cifra agora; quem chama guarda aberto. */
export function cifrar(texto: string): string | null {
  if (!cifraDisponivel()) return null
  try {
    return cofre!.encryptString(texto).toString('base64')
  } catch (err) {
    console.warn('[settings] safeStorage recusou cifrar:', err)
    return null
  }
}

/** base64 cifrado -> texto. null = nao abre (outra conta, arquivo mexido, sem cifra). */
export function decifrar(base64: string): string | null {
  if (!cifraDisponivel()) return null
  try {
    return cofre!.decryptString(Buffer.from(base64, 'base64'))
  } catch {
    return null
  }
}

/** A interface nunca recebe a chave inteira -- so o suficiente para reconhecer. */
export function getSettingsForRenderer(): Omit<Settings, 'anthropicApiKey' | 'geminiApiKey' | 'modulos' | 'modulosLigados'> & {
  hasApiKey: boolean
  apiKeyHint: string
  hasGeminiKey: boolean
  geminiKeyHint: string
  chavesProtegidas: boolean
} {
  const settings = getSettings()
  const key = settings.anthropicApiKey
  return {
    iaProvedor: settings.iaProvedor,
    geminiModelo: settings.geminiModelo,
    anthropicModelo: settings.anthropicModelo,
    whisperModel: settings.whisperModel,
    sfxDir: settings.sfxDir,
    libraryDir: settings.libraryDir,
    curvePresets: settings.curvePresets,
    captionStyle: settings.captionStyle,
    captionPresets: settings.captionPresets,
    bins: settings.bins,
    curvasDeEntrada: settings.curvasDeEntrada,
    atalhos: settings.atalhos,
    recentes: settings.recentes,
    presetsDeCor: settings.presetsDeCor,
    presetsDeTransicao: settings.presetsDeTransicao,
    hasApiKey: key.length > 0,
    apiKeyHint: dicaDaChave(key),
    hasGeminiKey: settings.geminiApiKey.length > 0,
    geminiKeyHint: dicaDaChave(settings.geminiApiKey),
    chavesProtegidas: cifraDisponivel(),
  }
}

/** Os quatro ultimos caracteres: o bastante para reconhecer, pouco para vazar. */
export function dicaDaChave(key: string): string {
  return key.length > 8 ? `••••${key.slice(-4)}` : ''
}

function coerce(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS }
  const value = raw as Record<string, unknown>

  const model = value['whisperModel']
  const settings: Settings = {
    anthropicApiKey:
      typeof value['anthropicApiKey'] === 'string' ? value['anthropicApiKey'].trim() : '',
    geminiApiKey: typeof value['geminiApiKey'] === 'string' ? value['geminiApiKey'].trim() : '',
    /*
     * Quem ja usava o Dangai so com a chave da Anthropic (sem iaProvedor salvo)
     * continua vendo a Anthropic marcada: abrir a versao nova com "Gemini"
     * selecionado e a nota "usa a da Anthropic" parecia que algo tinha mudado
     * sozinho. O Gemini e o padrao so para quem nao tinha escolha nenhuma.
     */
    iaProvedor:
      value['iaProvedor'] === 'anthropic' || value['iaProvedor'] === 'gemini'
        ? value['iaProvedor']
        : typeof value['anthropicApiKey'] === 'string' &&
            value['anthropicApiKey'].trim() !== '' &&
            !(typeof value['geminiApiKey'] === 'string' && value['geminiApiKey'].trim() !== '')
          ? 'anthropic'
          : 'gemini',
    geminiModelo: nomeDeModelo(value['geminiModelo'], ''),
    anthropicModelo: nomeDeModelo(value['anthropicModelo'], DEFAULTS.anthropicModelo),
    whisperModel: model === 'base' || model === 'small' || model === 'medium' ? model : 'small',
    sfxDir: typeof value['sfxDir'] === 'string' ? value['sfxDir'] : '',
    libraryDir: typeof value['libraryDir'] === 'string' ? value['libraryDir'] : '',
    curvePresets: curvasSalvas(value['curvePresets']),
    // Conferido do outro lado, pelo schema do contract: aqui so passa adiante
    // um objeto, e um campo estranho vira o padrao em vez de derrubar o app.
    captionStyle:
      typeof value['captionStyle'] === 'object' && value['captionStyle'] !== null
        ? (value['captionStyle'] as Record<string, unknown>)
        : null,
    captionPresets: Array.isArray(value['captionPresets'])
      ? (value['captionPresets'] as unknown[]).filter(
          (x): x is Record<string, unknown> => typeof x === 'object' && x !== null,
        )
      : [],
    bins: Array.isArray(value['bins'])
      ? (value['bins'] as unknown[]).filter(
          (x): x is Record<string, unknown> => typeof x === 'object' && x !== null,
        )
      : [],
    curvasDeEntrada: Array.isArray(value['curvasDeEntrada'])
      ? (value['curvasDeEntrada'] as unknown[]).filter(
          (x): x is Record<string, unknown> => typeof x === 'object' && x !== null,
        )
      : [],
    atalhos:
      typeof value['atalhos'] === 'object' && value['atalhos'] !== null && !Array.isArray(value['atalhos'])
        ? (value['atalhos'] as Record<string, unknown>)
        : null,
    recentes: Array.isArray(value['recentes'])
      ? (value['recentes'] as unknown[])
          .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
          .slice(0, 12)
      : [],
    presetsDeCor: Array.isArray(value['presetsDeCor'])
      ? (value['presetsDeCor'] as unknown[])
          .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
          .slice(0, 50)
      : [],
    presetsDeTransicao: Array.isArray(value['presetsDeTransicao'])
      ? (value['presetsDeTransicao'] as unknown[])
          .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
          .slice(0, 50)
      : [],
    modulos:
      typeof value['modulos'] === 'object' && value['modulos'] !== null && !Array.isArray(value['modulos'])
        ? (value['modulos'] as Record<string, unknown>)
        : {},
    modulosLigados:
      typeof value['modulosLigados'] === 'object' && value['modulosLigados'] !== null && !Array.isArray(value['modulosLigados'])
        ? Object.fromEntries(
            Object.entries(value['modulosLigados'] as Record<string, unknown>).filter(
              (e): e is [string, boolean] => typeof e[1] === 'boolean',
            ),
          )
        : {},
  }
  // As chaves registradas por modulo nao estao no tipo: passam como texto, ou o
  // coerce -- que so deixa passar o que conhece -- as apagaria no primeiro save.
  for (const campo of CAMPOS_DE_CHAVE) {
    if (campo in settings) continue
    const chave = value[campo]
    if (typeof chave === 'string') (settings as unknown as Record<string, unknown>)[campo] = chave.trim()
  }
  return settings
}

/** Os campos do arquivo que nem o nucleo nem o cofre conhecem. */
function camposDesconhecidos(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const conhecidos = new Set<string>(Object.keys(DEFAULTS))
  for (const campo of CAMPOS_DE_CHAVE) {
    conhecidos.add(campo)
    conhecidos.add(`${campo}Enc`)
  }
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k]) => !conhecidos.has(k)))
}

/**
 * O nome de um modelo, ou o padrao.
 *
 * O do Gemini vai parar no caminho da URL (`models/<nome>:generateContent`), e
 * o valor chega do renderer e de um arquivo editavel a mao: so letra, numero,
 * ponto, traco e sublinhado. Barra ou dois-pontos ali mudariam o endpoint.
 */
export function nomeDeModelo(raw: unknown, padrao: string): string {
  if (typeof raw !== 'string') return padrao
  const nome = raw.trim().replace(/^models\//, '')
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(nome) ? nome : padrao
}

/**
 * As curvas guardadas, conferidas uma a uma.
 *
 * Este arquivo e editavel a mao e sobrevive a atualizacao do app: um valor
 * estranho aqui viraria uma curva que o Remotion nao sabe interpolar, e o
 * sintoma apareceria como movimento travado no meio do render.
 */
function curvasSalvas(raw: unknown): Settings['curvePresets'] {
  if (!Array.isArray(raw)) return []
  const ok: Settings['curvePresets'] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const { nome, pontos } = item as Record<string, unknown>
    if (typeof nome !== 'string' || !nome.trim()) continue
    if (!Array.isArray(pontos) || pontos.length !== 4) continue
    if (!pontos.every((n) => typeof n === 'number' && n >= 0 && n <= 1)) continue
    ok.push({ nome: nome.trim().slice(0, 40), pontos: pontos as [number, number, number, number] })
  }
  // Vinte ja e mais do que qualquer pessoa distingue numa lista de chips.
  return ok.slice(0, 20)
}
