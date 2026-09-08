import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Guarda tres campos em um JSON no userData.
 *
 * A spec pedia electron-store, mas a v11 e ESM puro ("type": "module", sem
 * main) e o processo main aqui e CJS -- externalizado, o require() quebra.
 * Para tres campos nao compensa comprar a briga ESM/CJS; isto faz o mesmo,
 * inclusive escrita atomica.
 *
 * A chave da API vive aqui, fora do repositorio. Nunca em .env, nunca no codigo.
 */

export interface Settings {
  anthropicApiKey: string
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
}

const DEFAULTS: Settings = {
  anthropicApiKey: '',
  whisperModel: 'small',
  sfxDir: '',
  libraryDir: '',
  curvePresets: [],
}

let filePath: string | null = null
let cache: Settings | null = null

export function configureSettings(userDataDir: string): void {
  filePath = join(userDataDir, 'settings.json')
  cache = null
}

export function getSettings(): Settings {
  if (cache) return cache
  if (!filePath) throw new Error('Settings nao configurado')

  try {
    const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    cache = coerce(raw)
  } catch {
    // Arquivo ausente ou corrompido: volta ao padrao em vez de derrubar o app.
    cache = { ...DEFAULTS }
  }
  return cache
}

export function saveSettings(patch: Partial<Settings>): Settings {
  if (!filePath) throw new Error('Settings nao configurado')

  const next = coerce({ ...getSettings(), ...patch })
  mkdirSync(dirname(filePath), { recursive: true })

  // Escreve em temporario e renomeia: se o app morrer no meio, o arquivo
  // antigo continua intacto em vez de virar JSON pela metade.
  const temp = `${filePath}.tmp`
  writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8')
  renameSync(temp, filePath)

  cache = next
  return next
}

/** A interface nunca recebe a chave inteira -- so o suficiente para reconhecer. */
export function getSettingsForRenderer(): Omit<Settings, 'anthropicApiKey'> & {
  hasApiKey: boolean
  apiKeyHint: string
} {
  const settings = getSettings()
  const key = settings.anthropicApiKey
  return {
    whisperModel: settings.whisperModel,
    sfxDir: settings.sfxDir,
    libraryDir: settings.libraryDir,
    curvePresets: settings.curvePresets,
    hasApiKey: key.length > 0,
    apiKeyHint: key.length > 8 ? `••••${key.slice(-4)}` : '',
  }
}

function coerce(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS }
  const value = raw as Record<string, unknown>

  const model = value['whisperModel']
  return {
    anthropicApiKey:
      typeof value['anthropicApiKey'] === 'string' ? value['anthropicApiKey'].trim() : '',
    whisperModel: model === 'base' || model === 'small' || model === 'medium' ? model : 'small',
    sfxDir: typeof value['sfxDir'] === 'string' ? value['sfxDir'] : '',
    libraryDir: typeof value['libraryDir'] === 'string' ? value['libraryDir'] : '',
    curvePresets: curvasSalvas(value['curvePresets']),
  }
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
