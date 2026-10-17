import { existsSync, readdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ConfigDoRecap } from '../../shared/config'
import {
  historicoDeMusicasSchema,
  PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO,
  preferenciasDaEdicaoRapidaSchema,
} from '../../shared/edicao-rapida'
import {
  RESUMO_VAZIO,
  type ChaveTrazida,
  type FaseDaMigracao,
  type ResumoDaMigracao,
  type StudioAchado,
} from '../../shared/migracao'
import { lerRascunho } from '../../shared/roteiro'
import { VELOCIDADE_NATIVA_PADRAO } from '../../shared/voz'
import {
  arquivosEm,
  Cancelado,
  conferirSinal,
  copiarSeFalta,
  dentroDe,
  gravarJson,
  lerJsonOuNull,
  tamanhoDe,
  trocarPerfil,
} from './arquivos'
import { abrirChavesDoStudio, type DesprotegerDpapi } from './chaves'
import { arquivosDoElenco, copiarElenco, juntarArquivoDeMapa, juntarIndiceDoMotor } from './motor'

/**
 * [recap] TRAZER DO ANIRECAP STUDIO (parte 5): o perfil do Studio
 * (%APPDATA%/AniRecap Studio) para o perfil do modulo
 * (%APPDATA%/Dangai/modulos/recap). Os dois tem o mesmo desenho, porque o
 * modulo e o Studio portado:
 *
 *   recaps/<rc>.json + recaps/<rc>/    os rascunhos (o .json por ULTIMO)
 *   recaps/cache/voz/<sha256>.*        a voz PAGA (a mesma chave de cache)
 *   recaps/ritmos.json                 o ritmo aprendido da voz
 *   som/musicas-usadas.json            o "sem repetir" das musicas
 *   motor/cache/index.db + anime_db/   os personagens do "Reconhecer na mao"
 *   settings.json + Local State        os ajustes e as chaves cifradas
 *
 * REGRAS: so LE o Studio; nunca sobrescreve o que o Dangai ja tem (o dele
 * ganha, por id/hash/chave); rodar de novo nao duplica nada; cancelar para
 * entre arquivos e o que ja veio fica (a proxima rodada continua).
 *
 * NAO traz: a biblioteca do Studio (o Levi escolheu outra pasta; o episodio e
 * cortado de novo ao abrir, e o rascunho continua pelo mesmo episodioId), o
 * runtime do motor (o Dangai tem o dele), as miniaturas e o cache da IA (se
 * refazem), e o `ouvidos.json` de cada rascunho -- sem ele, o primeiro "Gerar
 * tudo de novo" no Dangai devolve a leitura ja paga do cache, de graca.
 */

/** Os campos do Studio que a tela le e a migracao usa (o resto fica la). */
interface SettingsDoStudio {
  vozPadrao?: { provedor?: unknown; voiceId?: unknown; modelId?: unknown; velocidadeNativa?: unknown }
  pastaDeMusicas?: unknown
  edicaoRapidaPadrao?: unknown
  sfxDir?: unknown
  iaProvedor?: unknown
  geminiModelo?: unknown
  anthropicModelo?: unknown
  presetsDeCor?: unknown
  [campo: string]: unknown
}

/** O que a migracao le do nucleo do Dangai (nunca uma chave: so se tem). */
export interface VistaDoNucleo {
  temGemini: boolean
  temAnthropic: boolean
  iaProvedor: string
  geminiModelo: string
  anthropicModelo: string
  sfxDir: string
  presetsDeCor: Record<string, unknown>[]
}

/** O que ela grava no nucleo, quando o Dangai nao tem o dele. */
export interface PatchDoNucleo {
  geminiApiKey?: string
  iaProvedor?: 'gemini' | 'anthropic'
  geminiModelo?: string
  anthropicModelo?: string
  sfxDir?: string
  presetsDeCor?: Record<string, unknown>[]
}

export interface DepsDaMigracao {
  /** O perfil do Studio. */
  studio: string
  /** O perfil do modulo (ctx.pasta('dados')). */
  modulo: string
  /** A biblioteca do modulo: indicePath fora dela vira '' (o episodio e cortado de novo). */
  biblioteca: string
  /** Pasta temporaria do modulo (a copia do index.db do Studio). */
  temp: string
  desproteger: DesprotegerDpapi
  /** As chaves de voz do modulo (o cofre do nucleo, ctx.chave/ctx.salvarChave). */
  cofre: { tem(campo: string): boolean; salvar(campo: string, valor: string): void }
  nucleo: { ler(): VistaDoNucleo; gravar(patch: PatchDoNucleo): void }
  config: { ler(): ConfigDoRecap; salvar(patch: Partial<ConfigDoRecap>): void }
  /** As medidas do ritmo que o modulo ja tem (lerMedidas: o arquivo, ou semeadas dos rascunhos). */
  ritmoDoModulo(): unknown[]
  progresso?(fase: FaseDaMigracao, texto: string, feitos: number, total: number): void
  sinal?: AbortSignal
}

const ID_DO_RASCUNHO = /^rc_[0-9a-z_]+$/
const CHAVE_DO_CACHE = /^[0-9a-f]{64}$/

const CHAVES: readonly { campo: string; nome: string; doNucleo: boolean }[] = [
  { campo: 'elevenlabsApiKey', nome: 'ElevenLabs', doNucleo: false },
  { campo: 'fishApiKey', nome: 'Fish Audio', doNucleo: false },
  { campo: 'geminiApiKey', nome: 'Gemini', doNucleo: true },
]

function rascunhosDoStudio(studio: string): string[] {
  try {
    return readdirSync(join(studio, 'recaps'))
      .filter((n) => n.endsWith('.json') && ID_DO_RASCUNHO.test(n.slice(0, -5)))
      .map((n) => n.slice(0, -5))
      .sort()
  } catch {
    return []
  }
}

/** As entradas completas do cache da voz: <sha>.json mais o audio <sha>.<ext>. */
function entradasDaVoz(pasta: string): { chave: string; arquivos: string[] }[] {
  let nomes: string[] = []
  try {
    nomes = readdirSync(pasta)
  } catch {
    return []
  }
  const porChave = new Map<string, string[]>()
  for (const n of nomes) {
    const base = basename(n, extname(n))
    if (!CHAVE_DO_CACHE.test(base) || n.includes('.migrando') || n.endsWith('.tmp')) continue
    porChave.set(base, [...(porChave.get(base) ?? []), n])
  }
  return [...porChave]
    .filter(([chave, arquivos]) => arquivos.includes(`${chave}.json`) && arquivos.length > 1)
    .map(([chave, arquivos]) => ({ chave, arquivos }))
    .sort((a, b) => a.chave.localeCompare(b.chave))
}

/** Ha dado do Studio nesta pasta? E quanto (a linha da tela, antes de trazer). */
export function acharStudio(studio: string): StudioAchado {
  const tem =
    existsSync(join(studio, 'settings.json')) || existsSync(join(studio, 'recaps')) || existsSync(join(studio, 'motor', 'cache', 'index.db'))
  if (!tem) return { existe: false, pasta: studio, rascunhos: 0, vozBytes: 0 }
  const voz = join(studio, 'recaps', 'cache', 'voz')
  const vozBytes = entradasDaVoz(voz).reduce((s, e) => s + e.arquivos.reduce((t, a) => t + tamanhoDe(join(voz, a)), 0), 0)
  return { existe: true, pasta: studio, rascunhos: rascunhosDoStudio(studio).length, vozBytes }
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Traz tudo. Nunca lanca por um item: o item que falha vira aviso e o resto segue. Cancelar devolve o parcial. */
export async function trazerDoStudio(deps: DepsDaMigracao): Promise<ResumoDaMigracao> {
  const r: ResumoDaMigracao = structuredClone(RESUMO_VAZIO)
  const { studio, modulo, sinal } = deps
  const studioSettings = (lerJsonOuNull(join(studio, 'settings.json')) ?? {}) as SettingsDoStudio

  const rascunhos = rascunhosDoStudio(studio)
  const vozDoStudio = join(studio, 'recaps', 'cache', 'voz')
  const vozDoModulo = join(modulo, 'recaps', 'cache', 'voz')
  const entradas = entradasDaVoz(vozDoStudio)
  const animeDb = join(studio, 'motor', 'cache', 'anime_db')
  const elenco = arquivosDoElenco(animeDb)
  const total = rascunhos.length + entradas.length + elenco.length + 3
  let feitos = 0
  const passo = (fase: FaseDaMigracao, t: string): void => {
    feitos++
    deps.progresso?.(fase, t, Math.min(feitos, total), total)
  }

  try {
    // 1. Os ajustes: so onde o Dangai ainda esta no padrao (o dele ganha).
    deps.progresso?.('ajustes', 'Ajustes', feitos, total)
    trazerAjustes(deps, studioSettings, r)
    passo('ajustes', 'Ajustes')

    // 2. As chaves: abertas so as que o Dangai nao tem.
    await trazerChaves(deps, studioSettings, r)
    passo('chaves', 'Chaves')

    // 3. Os rascunhos: a pasta antes, o .json por ultimo (ele marca o rascunho completo).
    for (const id of rascunhos) {
      conferirSinal(sinal)
      await trazerRascunho(deps, id, r)
      passo('rascunhos', 'Rascunhos')
    }

    // 4. A voz paga: o audio antes, o .json por ultimo (o mesmo contrato do cache).
    for (const e of entradas) {
      conferirSinal(sinal)
      if (existsSync(join(vozDoModulo, `${e.chave}.json`))) {
        r.voz.jaEstavam++
      } else {
        let bytes = 0
        const ordem = [...e.arquivos.filter((a) => !a.endsWith('.json')), `${e.chave}.json`]
        for (const a of ordem) bytes += await copiarSeFalta(join(vozDoStudio, a), join(vozDoModulo, a), sinal)
        r.voz.trazidos++
        r.voz.bytes += bytes
      }
      passo('voz', 'Voz paga')
    }
    juntarArquivoDeMapa(join(vozDoStudio, 'taxas.json'), join(vozDoModulo, 'taxas.json'), [])

    // 5. O ritmo da voz e o historico das musicas: juntos pela chave.
    conferirSinal(sinal)
    r.ritmos = juntarRitmos(deps)
    r.musicas = juntarMusicas(studio, modulo)
    passo('historico', 'Historico')

    // 6. O motor: os personagens e as fotos do elenco.
    conferirSinal(sinal)
    try {
      const p = await juntarIndiceDoMotor(
        join(studio, 'motor', 'cache', 'index.db'),
        join(modulo, 'motor', 'cache', 'index.db'),
        deps.temp,
      )
      r.personagens = p
    } catch {
      r.avisos.push('Os personagens do motor nao vieram (o banco nao abriu).')
    }
    r.fotos = await copiarElenco(animeDb, join(modulo, 'motor', 'cache', 'anime_db'), () => passo('motor', 'Personagens'), sinal)
    juntarArquivoDeMapa(
      join(studio, 'motor', 'cache', 'pastas_de_anime.json'),
      join(modulo, 'motor', 'cache', 'pastas_de_anime.json'),
      ['nomes', 'franquias'],
    )
    passo('motor', 'Personagens')
  } catch (err) {
    if (!(err instanceof Cancelado)) throw err
    r.cancelado = true
  }
  deps.progresso?.('fim', 'Pronto', total, total)
  return r
}

function trazerAjustes(deps: DepsDaMigracao, s: SettingsDoStudio, r: ResumoDaMigracao): void {
  const atual = deps.config.ler()
  const patch: Partial<ConfigDoRecap> = {}

  // A voz padrao e a velocidade nativa (perfil de antes do campo: o 1,2 do Studio).
  const voz = s.vozPadrao
  const provedor = voz?.provedor === 'elevenlabs' || voz?.provedor === 'fish' ? voz.provedor : ''
  if (atual.vozPadrao.provedor === '' && provedor && texto(voz?.voiceId)) {
    patch.vozPadrao = {
      provedor,
      voiceId: texto(voz?.voiceId),
      modelId: texto(voz?.modelId),
      velocidadeNativa: typeof voz?.velocidadeNativa === 'number' ? voz.velocidadeNativa : VELOCIDADE_NATIVA_PADRAO,
    }
    r.ajustes.push('voz padrao')
  }

  // A pasta de musicas: a escolhida no Studio ou o padrao dele, se existe neste PC.
  const musicas = texto(s.pastaDeMusicas) || PASTA_DE_MUSICAS_DO_STUDIO
  if (atual.pastaDeMusicas === '' && musicas && existsSync(musicas)) {
    patch.pastaDeMusicas = musicas
    r.ajustes.push('pasta de musicas')
  }

  // A Edicao rapida (com o preset de cor): so se a do Dangai ainda e a de fabrica.
  const padrao = JSON.stringify(PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO)
  const daStudio = preferenciasDaEdicaoRapidaSchema.safeParse(s.edicaoRapidaPadrao ?? {})
  const nucleo = deps.nucleo.ler()
  const patchDoNucleo: PatchDoNucleo = {}
  if (JSON.stringify(atual.edicaoRapidaPadrao) === padrao && daStudio.success && JSON.stringify(daStudio.data) !== padrao) {
    patch.edicaoRapidaPadrao = daStudio.data
    r.ajustes.push('Edicao rapida')
    const nome = daStudio.data.corPreset
    const presets = Array.isArray(s.presetsDeCor) ? (s.presetsDeCor as Record<string, unknown>[]) : []
    const preset = nome ? presets.find((p) => p && p['nome'] === nome) : undefined
    if (preset && !nucleo.presetsDeCor.some((p) => p['nome'] === nome)) {
      patchDoNucleo.presetsDeCor = [...nucleo.presetsDeCor, preset]
      r.ajustes.push('preset de cor')
    } else if (nome && !preset && !nucleo.presetsDeCor.some((p) => p['nome'] === nome)) {
      r.avisos.push(`O preset de cor "${nome}" nao estava no Studio: vale o Anime vivo.`)
    }
  }

  // A pasta de SFX: so uma pasta escolhida (fora do perfil do Studio) e so se o Dangai nao tem a dele.
  const sfx = texto(s.sfxDir)
  if (nucleo.sfxDir === '' && sfx && existsSync(sfx) && !dentroDe(sfx, deps.studio)) {
    patchDoNucleo.sfxDir = sfx
    r.ajustes.push('pasta de SFX')
  }

  // A IA (provedor e modelo): so com o Dangai sem IA nenhuma configurada.
  if (!nucleo.temGemini && !nucleo.temAnthropic) {
    const prov = s.iaProvedor === 'gemini' || s.iaProvedor === 'anthropic' ? s.iaProvedor : null
    const gm = typeof s.geminiModelo === 'string' ? s.geminiModelo.trim() : null
    const am = typeof s.anthropicModelo === 'string' ? s.anthropicModelo.trim() : null
    if (prov && prov !== nucleo.iaProvedor) patchDoNucleo.iaProvedor = prov
    if (gm !== null && gm !== nucleo.geminiModelo) patchDoNucleo.geminiModelo = gm
    if (am && am !== nucleo.anthropicModelo) patchDoNucleo.anthropicModelo = am
    if (patchDoNucleo.iaProvedor || patchDoNucleo.geminiModelo !== undefined || patchDoNucleo.anthropicModelo) {
      r.ajustes.push('IA (provedor e modelo)')
    }
  }

  if (Object.keys(patch).length > 0) deps.config.salvar(patch)
  if (Object.keys(patchDoNucleo).length > 0) deps.nucleo.gravar(patchDoNucleo)
}

/** O PASTA_DE_MUSICAS_PADRAO do Studio: o settings dele vazio vale esta pasta, se existe. */
const PASTA_DE_MUSICAS_DO_STUDIO = 'G:/App Resumo/music'

async function trazerChaves(deps: DepsDaMigracao, s: SettingsDoStudio, r: ResumoDaMigracao): Promise<void> {
  const nucleo = deps.nucleo.ler()
  const temNoDangai = (c: (typeof CHAVES)[number]): boolean => (c.doNucleo ? nucleo.temGemini : deps.cofre.tem(c.campo))
  const noStudio = (campo: string): boolean => texto(s[`${campo}Enc`]) !== '' || texto(s[campo]) !== ''
  // Abre so o que vai ser usado: chave que o Dangai ja tem nem sai do Studio.
  const precisa = CHAVES.filter((c) => noStudio(c.campo) && !temNoDangai(c)).map((c) => c.campo)
  const abertas = precisa.length > 0 ? await abrirChavesDoStudio(deps.studio, s, precisa, deps.desproteger) : new Map<string, string | null>()
  for (const c of CHAVES) {
    const linha: ChaveTrazida = { campo: c.campo, nome: c.nome, estado: 'sem' }
    if (!noStudio(c.campo)) {
      linha.estado = 'sem'
    } else if (temNoDangai(c)) {
      linha.estado = 'ja-tinha'
    } else {
      const valor = abertas.get(c.campo) ?? null
      if (!valor) {
        linha.estado = 'colar-de-novo'
      } else {
        try {
          if (c.doNucleo) deps.nucleo.gravar({ geminiApiKey: valor })
          else deps.cofre.salvar(c.campo, valor)
          linha.estado = 'trazida'
        } catch {
          linha.estado = 'colar-de-novo'
        }
      }
    }
    r.chaves.push(linha)
  }
  abertas.clear()
}

async function trazerRascunho(deps: DepsDaMigracao, id: string, r: ResumoDaMigracao): Promise<void> {
  const { studio, modulo, sinal } = deps
  const destino = join(modulo, 'recaps', `${id}.json`)
  if (existsSync(destino)) {
    r.rascunhos.jaEstavam++
    return
  }
  const cru = lerJsonOuNull(join(studio, 'recaps', `${id}.json`))
  let trocado: Record<string, unknown>
  try {
    lerRascunho(cru)
    trocado = trocarPerfil(cru as Record<string, unknown>, studio, modulo)
    // O indice na biblioteca do Studio nao vem: o rascunho abre pedindo o corte de novo.
    const indice = trocado['indicePath']
    if (typeof indice === 'string' && indice && !dentroDe(indice, deps.biblioteca)) trocado['indicePath'] = ''
    lerRascunho(trocado)
  } catch {
    r.rascunhos.quebrados++
    return
  }
  const pasta = join(studio, 'recaps', id)
  for (const rel of arquivosEm(pasta)) {
    // O "ja ouvi" do Studio fica la: no Dangai o 1o "Gerar tudo de novo" sai do cache pago.
    if (rel.replace(/\\/g, '/') === 'voz/ouvidos.json') continue
    if (rel.includes('.migrando') || rel.endsWith('.tmp')) continue
    await copiarSeFalta(join(pasta, rel), join(modulo, 'recaps', id, rel), sinal)
  }
  conferirSinal(sinal)
  gravarJson(destino, trocado)
  r.rascunhos.trazidos++
}

interface Medida {
  chave: string
  quando?: string
}

function juntarRitmos(deps: DepsDaMigracao): number {
  const doStudio = lerJsonOuNull(join(deps.studio, 'recaps', 'ritmos.json')) as { medidas?: unknown } | null
  const vindas = (Array.isArray(doStudio?.medidas) ? doStudio.medidas : []).filter(
    (m): m is Medida => !!m && typeof m === 'object' && typeof (m as Medida).chave === 'string',
  )
  if (vindas.length === 0) return 0
  const arquivo = join(deps.modulo, 'recaps', 'ritmos.json')
  const doArquivo = lerJsonOuNull(arquivo) as { medidas?: unknown } | null
  // Sem o arquivo, a base e o que o modulo semeia dos rascunhos (os trazidos inclusive).
  const base = (existsSync(arquivo) && Array.isArray(doArquivo?.medidas) ? doArquivo.medidas : deps.ritmoDoModulo()).filter(
    (m): m is Medida => !!m && typeof m === 'object' && typeof (m as Medida).chave === 'string',
  )
  const chaves = new Set(base.map((m) => m.chave))
  const novas = vindas.filter((m) => !chaves.has(m.chave))
  if (novas.length === 0 && existsSync(arquivo)) return 0
  const todas = [...base, ...novas].sort((a, b) => String(a.quando ?? '').localeCompare(String(b.quando ?? ''))).slice(-60)
  gravarJson(arquivo, { versao: 1, medidas: todas })
  return novas.length
}

function juntarMusicas(studio: string, modulo: string): number {
  const vindo = historicoDeMusicasSchema.safeParse(lerJsonOuNull(join(studio, 'som', 'musicas-usadas.json')))
  if (!vindo.success || vindo.data.usadas.length === 0) return 0
  const arquivo = join(modulo, 'som', 'musicas-usadas.json')
  const atual = historicoDeMusicasSchema.safeParse(lerJsonOuNull(arquivo))
  const usadas = atual.success ? [...atual.data.usadas] : []
  const chave = (p: string): string => p.replace(/[\\/]+/g, '/').toLowerCase()
  const vistas = new Set(usadas.map((u) => chave(u.path)))
  let novas = 0
  for (const u of vindo.data.usadas) {
    if (vistas.has(chave(u.path))) continue
    usadas.push(u)
    vistas.add(chave(u.path))
    novas++
  }
  if (novas === 0) return 0
  usadas.sort((a, b) => a.em.localeCompare(b.em))
  gravarJson(arquivo, { versao: 1, usadas })
  return novas
}

