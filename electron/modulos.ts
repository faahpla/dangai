import { BrowserWindow } from 'electron'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ID_DE_MODULO, prefixoDoModulo, type ModuloPublico } from '@shared/modulos'
import { handle } from './handle'
import { dicaDaChave, getSettings, registrarCampoDeChave, saveSettings, type Settings } from './services/settings'
import { escolherProvedor, gerarJson, type Provedor } from './services/llm'

/**
 * OS MODULOS NO MAIN: o Gerar recap do Levi, e o que vier depois.
 *
 * Um modulo nao edita o nucleo: ele se descreve aqui (ModuloDoMain), e o nucleo
 * chama cada parte na hora certa, sempre dentro de try/catch. Um modulo que
 * quebra ao subir fica marcado (`falhou`) e o Dangai abre sem ele -- antes,
 * um handler repetido fazia o `ipcMain.handle` lancar dentro do `whenReady`,
 * o registro parava no meio e a janela nem abria.
 *
 * O ciclo:
 *  1. `configurar` -- antes do IPC, com as pastas e a versao. Barato: so
 *     guardar caminhos. Roda ligado ou nao.
 *  2. `registrarIpc` -- os canais dele, so com o prefixo `<id>:`.
 *  3. `ligar` -- depois da janela, so se estiver ligado (ou quando ele liga
 *     nas Configuracoes). Aqui vai o que custa: processo, download, verificacao.
 *  4. `desligar` -- quando ele desliga nas Configuracoes.
 *  5. `antesDeSair` -- pode SEGURAR a saida do app (um download, um motor
 *     fechando). O nucleo espera, com teto.
 *  6. `motivoParaNaoAtualizar` -- veta o "Atualizar agora" enquanto algo dele
 *     nao pode ser interrompido.
 */

export interface ContextoDoModulo {
  readonly id: string
  /** `<id>:` -- o unico prefixo de canal que o modulo pode usar. */
  readonly prefixo: string
  readonly empacotado: boolean
  readonly versaoDoApp: string
  /** O handle do nucleo (erro vira IpcResult). Recusa canal fora do prefixo. */
  handle<Args extends unknown[], T>(canal: string, fn: (...args: Args) => Promise<T>): void
  /** Manda um evento para todas as janelas. So canal com o prefixo. */
  enviar(canal: string, dados?: unknown): void
  /** Os campos do nucleo que o modulo le, e a configuracao dele (ja coerida). */
  config(): ConfigVistaPeloModulo
  /** Grava na configuracao DELE (passa pelo validarPatch). Devolve a nova. */
  salvarConfig(patch: unknown): unknown
  /** A chave aberta, so no main. O campo precisa estar em camposDeChave. */
  chave(campo: string): string
  /** Grava (ou apaga, com '') uma chave dele. Vai cifrada para o disco. */
  salvarChave(campo: string, valor: string): void
  /**
   * As pastas dele: `userData` (a do app), `dados` (<userData>/modulos/<id>,
   * criada), `temp` (no temp do sistema, criada), `recursos` (o que ele
   * empacota: resources/modulos/<id>, ou modulos/<id>/recursos em dev) e `app`.
   */
  pasta(tipo: 'userData' | 'dados' | 'temp' | 'recursos' | 'app'): string
  /** Ligado agora nas Configuracoes. */
  ligado(): boolean
  /**
   * A IA DO NUCLEO (Gemini ou Anthropic, o que ele escolheu nas
   * Configuracoes): o modulo pede e recebe, sem nunca ver as chaves.
   */
  ia: {
    /** O gerarJson do nucleo (llm.ts), com a troca de modelo e a reserva. */
    gerarJson: typeof gerarJson
    /** Quem atenderia agora (ou o forcado, se tiver chave). null = nenhuma chave. */
    provedor(forcado?: Provedor): Provedor | null
    /**
     * O modelo escolhido nas Configuracoes para um provedor (para entrar numa
     * chave de cache, por exemplo). '' = automatico (o Gemini escolhe o flash
     * na hora da chamada).
     */
    modelo(provedor: Provedor): string
  }
}

export interface ConfigVistaPeloModulo {
  libraryDir: string
  iaProvedor: Settings['iaProvedor']
  whisperModel: Settings['whisperModel']
  /** A configuracao do modulo, passada pelo coerce dele. */
  modulo: unknown
}

export interface ConfigDoModulo {
  padrao: unknown
  /** Confere o que veio do disco. Lancar = vale o padrao. */
  coerce(raw: unknown): unknown
  /** O que o renderer pode ver (sem segredo). Sem isto, nada vai. */
  paraRenderer?(config: unknown): unknown
  /** Confere um patch antes de gravar. Lancar = recusa com a mensagem. */
  validarPatch?(patch: unknown, atual: unknown): unknown
}

export interface ModuloDoMain {
  id: string
  nome: string
  descricao?: string
  beta?: boolean
  /** Sem escolha salva, nasce ligado? Padrao: nao. */
  ligadoPorPadrao?: boolean
  /** Campos de chave de API do modulo: ganham o cofre do nucleo. */
  camposDeChave?: string[]
  config?: ConfigDoModulo
  configurar?(ctx: ContextoDoModulo): void
  registrarIpc?(ctx: ContextoDoModulo): void
  ligar?(ctx: ContextoDoModulo): void | Promise<void>
  desligar?(ctx: ContextoDoModulo): void | Promise<void>
  antesDeSair?(): Promise<void>
  motivoParaNaoAtualizar?(): string | null
}

export interface BaseDosModulos {
  userData: string
  appPath: string
  resourcesPath: string
  empacotado: boolean
  versaoDoApp: string
}

interface Instalado {
  def: ModuloDoMain
  ctx: ContextoDoModulo
  falhou: string | null
  /** O `ligar` rodou e o `desligar` ainda nao. */
  rodando: boolean
}

const instalados: Instalado[] = []

/** Teto da espera na saida: o "Remover motor" do recap leva ate 10 min. */
const TETO_DA_SAIDA_MS = 11 * 60 * 1000

const mensagem = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function estaLigado(def: ModuloDoMain): boolean {
  const escolhido = getSettings().modulosLigados[def.id]
  return escolhido ?? def.ligadoPorPadrao ?? false
}

function configDe(def: ModuloDoMain): unknown {
  if (!def.config) return null
  const raw = getSettings().modulos[def.id]
  if (raw === undefined) return def.config.padrao
  try {
    return def.config.coerce(raw)
  } catch (err) {
    console.warn(`[modulo:${def.id}] configuracao invalida, vale o padrao:`, err)
    return def.config.padrao
  }
}

function criarContexto(def: ModuloDoMain, base: BaseDosModulos): ContextoDoModulo {
  const prefixo = prefixoDoModulo(def.id)
  const conferirCanal = (canal: string): void => {
    if (!canal.startsWith(prefixo) || canal.length <= prefixo.length) {
      throw new Error(`O modulo "${def.id}" so pode usar canais "${prefixo}...": "${canal}" recusado.`)
    }
  }
  const conferirChave = (campo: string): void => {
    if (!def.camposDeChave?.includes(campo)) {
      throw new Error(`O modulo "${def.id}" nao registrou a chave "${campo}".`)
    }
  }
  const criada = (p: string): string => {
    mkdirSync(p, { recursive: true })
    return p
  }
  return {
    id: def.id,
    prefixo,
    empacotado: base.empacotado,
    versaoDoApp: base.versaoDoApp,
    handle(canal, fn) {
      conferirCanal(canal)
      handle(canal, fn)
    },
    enviar(canal, dados) {
      conferirCanal(canal)
      for (const janela of BrowserWindow.getAllWindows()) janela.webContents.send(canal, dados)
    },
    config() {
      const s = getSettings()
      return { libraryDir: s.libraryDir, iaProvedor: s.iaProvedor, whisperModel: s.whisperModel, modulo: configDe(def) }
    },
    salvarConfig(patch) {
      if (!def.config) throw new Error(`O modulo "${def.id}" nao tem configuracao.`)
      const atual = configDe(def)
      const nova = def.config.validarPatch
        ? def.config.validarPatch(patch, atual)
        : { ...(atual as object), ...(patch as object) }
      saveSettings({ modulos: { ...getSettings().modulos, [def.id]: nova } })
      return nova
    },
    chave(campo) {
      conferirChave(campo)
      const v = (getSettings() as unknown as Record<string, unknown>)[campo]
      return typeof v === 'string' ? v : ''
    },
    salvarChave(campo, valor) {
      conferirChave(campo)
      saveSettings({ [campo]: valor.trim() } as Partial<Settings>)
    },
    pasta(tipo) {
      switch (tipo) {
        case 'userData':
          return base.userData
        case 'dados':
          return criada(join(base.userData, 'modulos', def.id))
        case 'temp':
          return criada(join(tmpdir(), `dangai-${def.id}`))
        case 'recursos':
          return base.empacotado
            ? join(base.resourcesPath, 'modulos', def.id)
            : join(base.appPath, 'modulos', def.id, 'recursos')
        case 'app':
          return base.appPath
      }
    },
    ligado: () => estaLigado(def),
    ia: {
      gerarJson,
      provedor: (forcado) => escolherProvedor(getSettings(), forcado),
      modelo: (provedor) => (provedor === 'gemini' ? getSettings().geminiModelo : getSettings().anthropicModelo),
    },
  }
}

/**
 * 1. Confere e configura os modulos. Antes do registerIpc e de qualquer
 *    getSettings dos modulos: e aqui que as chaves deles entram no cofre.
 */
export function prepararModulos(lista: readonly ModuloDoMain[], base: BaseDosModulos): void {
  for (const def of lista) {
    if (!ID_DE_MODULO.test(def.id) || instalados.some((m) => m.def.id === def.id)) {
      console.error(`[modulos] id invalido ou repetido, ignorado: "${def.id}"`)
      continue
    }
    const m: Instalado = { def, ctx: criarContexto(def, base), falhou: null, rodando: false }
    instalados.push(m)
    try {
      for (const campo of def.camposDeChave ?? []) registrarCampoDeChave(campo)
      def.configurar?.(m.ctx)
    } catch (err) {
      m.falhou = mensagem(err)
      console.error(`[modulo:${def.id}] nao configurou:`, err)
    }
  }
}

/** 2. Os canais do nucleo para os modulos e os de cada modulo. */
export function registrarIpcDosModulos(): void {
  handle<[], ModuloPublico[]>('modulos:listar', async () => listarModulos())
  handle<[string, boolean], ModuloPublico[]>('modulos:ligar', async (id, ligado) => {
    await ligarModulo(id, ligado)
    return listarModulos()
  })
  for (const m of instalados) {
    if (m.falhou) continue
    try {
      m.def.registrarIpc?.(m.ctx)
    } catch (err) {
      m.falhou = mensagem(err)
      console.error(`[modulo:${m.def.id}] nao registrou o IPC:`, err)
    }
  }
}

async function rodarLigar(m: Instalado): Promise<void> {
  if (m.falhou || m.rodando) return
  try {
    await m.def.ligar?.(m.ctx)
    m.rodando = true
  } catch (err) {
    m.falhou = mensagem(err)
    console.error(`[modulo:${m.def.id}] nao ligou:`, err)
  }
}

/** 3. Depois da janela: liga os que estao ligados. Nunca lanca. */
export async function ligarModulosNoInicio(): Promise<void> {
  for (const m of instalados) {
    if (estaLigado(m.def)) await rodarLigar(m)
  }
}

/** Liga ou desliga pelas Configuracoes, e guarda a escolha. */
export async function ligarModulo(id: string, ligado: boolean): Promise<void> {
  const m = instalados.find((x) => x.def.id === id)
  if (!m) throw new Error(`Modulo desconhecido: ${id}`)
  saveSettings({ modulosLigados: { ...getSettings().modulosLigados, [id]: ligado } })
  if (ligado) {
    await rodarLigar(m)
  } else if (m.rodando) {
    m.rodando = false
    try {
      await m.def.desligar?.(m.ctx)
    } catch (err) {
      console.error(`[modulo:${id}] nao desligou direito:`, err)
    }
  }
}

export function listarModulos(): ModuloPublico[] {
  const s = getSettings() as unknown as Record<string, unknown>
  return instalados.map((m) => {
    let config: unknown = null
    try {
      config = m.def.config?.paraRenderer ? m.def.config.paraRenderer(configDe(m.def)) : null
    } catch (err) {
      console.warn(`[modulo:${m.def.id}] paraRenderer falhou:`, err)
    }
    const chaves = Object.fromEntries(
      (m.def.camposDeChave ?? []).map((campo) => {
        const v = typeof s[campo] === 'string' ? (s[campo] as string) : ''
        return [campo, { tem: v.length > 0, dica: dicaDaChave(v) }]
      }),
    )
    return {
      id: m.def.id,
      nome: m.def.nome,
      descricao: m.def.descricao ?? '',
      beta: m.def.beta ?? false,
      ligado: estaLigado(m.def),
      falhou: m.falhou,
      config,
      chaves,
    }
  })
}

/** 6. Algum modulo esta no meio de algo que a atualizacao nao pode cortar? */
export function motivoParaNaoAtualizar(): string | null {
  for (const m of instalados) {
    try {
      const motivo = m.rodando ? (m.def.motivoParaNaoAtualizar?.() ?? null) : null
      if (motivo) return motivo
    } catch (err) {
      console.warn(`[modulo:${m.def.id}] motivoParaNaoAtualizar falhou:`, err)
    }
  }
  return null
}

/**
 * 5. A saida: segura o app ate os modulos terminarem o `antesDeSair` (com
 * teto), e entao sai de verdade. Chamado uma vez, no before-quit.
 */
let saindo = false
export function segurarSaida(evento: { preventDefault(): void }, sair: () => void): void {
  if (saindo) return
  const comSaida = instalados.filter((m) => m.def.antesDeSair && !m.falhou)
  if (comSaida.length === 0) return
  saindo = true
  evento.preventDefault()
  const teto = new Promise<void>((resolve) => setTimeout(resolve, TETO_DA_SAIDA_MS))
  const todos = Promise.allSettled(
    comSaida.map((m) =>
      Promise.resolve()
        .then(() => m.def.antesDeSair!())
        .catch((err: unknown) => console.error(`[modulo:${m.def.id}] antesDeSair falhou:`, err)),
    ),
  )
  void Promise.race([todos, teto]).finally(sair)
}
