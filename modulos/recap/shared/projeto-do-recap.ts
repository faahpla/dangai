import { z } from 'zod'
import { ajusteDeCorSchema, type AjusteDeCor, type SobreposicaoSalva, type TrechoDeAudioSalvo } from '@shared/contract'
import { papelDaSecaoSchema } from './roteiro'

/**
 * [recap] O PEDACO DO RECAP NO PROJETO: o que no Studio era o `studio` da raiz
 * e o `papel`/`corOriginal` dos itens, no lugar que o nucleo guarda para o
 * modulo (`modulos.recap`, ver o CLAUDE.md do Dangai).
 *
 * - raiz: `modulos.recap` = a origem do "Abrir no editor" (rascunho, episodio,
 *   take, roteiro, `vozAlinhada`, `secoes`), com `versao: 1`. A guarda de
 *   reanalise do Studio virou o `transcriptTravado` do nucleo
 *   (`nucleo.travarTranscript`): este pedaco so lembra de onde o projeto veio;
 * - trecho de audio: `modulos.recap.papel` ('musica' | 'whoosh' | 'impacto');
 *   o `ducking` e do nucleo (`trilha.ducking`);
 * - clipe da faixa de video: `modulos.recap.papel` ('cor') e `corOriginal`;
 *   no texto de tela, `papel: 'texto'`, `fraseId` e `marca` (textos-na-tela.ts).
 *
 * O codigo portado do Studio (shared/edicao-rapida.ts) trabalha com o item
 * "achatado" (`papel` e `corOriginal` no proprio item): `paraOModulo` achata
 * na entrada e `paraONucleo` devolve ao lugar na saida. O mesmo
 * `paraONucleo` converte um projeto antigo do Studio (`converterDoStudio`).
 *
 * So `zod`, o contrato do nucleo e o papel das secoes: edicao-rapida.ts
 * importa daqui apenas TIPOS (cenas -> edicao-rapida -> roteiro fecharia um
 * ciclo de valor).
 */

export const ID_DO_MODULO = 'recap'
export const VERSAO_DO_RECAP_NO_PROJETO = 1 as const

export const PAPEIS_DA_TRILHA = ['musica', 'whoosh', 'impacto'] as const
export const papelDaTrilhaSchema = z.enum(PAPEIS_DA_TRILHA)
export type PapelDaTrilha = z.infer<typeof papelDaTrilhaSchema>

/**
 * 'cor' = a camada de ajuste; 'texto' = um texto de tela do roteiro (textos-na-tela.ts);
 * 'clarear' = a camada de ajuste curta que clareia uma cena escura (clarear.ts, 19/10).
 */
export const PAPEIS_DA_SOBREPOSICAO = ['cor', 'texto', 'clarear'] as const
export const papelDaSobreposicaoSchema = z.enum(PAPEIS_DA_SOBREPOSICAO)
export type PapelDaSobreposicao = z.infer<typeof papelDaSobreposicaoSchema>

/** O trecho de audio como o codigo do Studio ve: com `papel` no proprio item. */
export type TrilhaDoRecap = TrechoDeAudioSalvo & { papel?: PapelDaTrilha }
/** O clipe da faixa de video como o codigo do Studio ve: `papel` e `corOriginal` no item. */
export type ClipeDoRecap = SobreposicaoSalva & { papel?: PapelDaSobreposicao; corOriginal?: AjusteDeCor }

// =================================================================== a raiz

/**
 * Uma frase no tempo do video (o `fraseDoStudioSchema` do Studio): os
 * personagens dos eventos que ela cita, para o rosto preferir o deles.
 */
export const fraseNoTempoSchema = z.object({
  id: z.string(),
  inicio: z.number().nonnegative(),
  fim: z.number().nonnegative(),
  personagens: z.array(z.string()).default([]),
  /**
   * O texto de tela da frase no roteiro aprovado (null = nenhum). Ausente =
   * projeto montado antes dos Textos na tela: a Edicao rapida no editor le do
   * rascunho.
   */
  tela: z.string().nullable().optional(),
})

/** Uma parte do roteiro no tempo do video: as viradas do som e os nomes do rosto. */
export const secaoNoTempoSchema = z.object({
  id: z.string(),
  papel: papelDaSecaoSchema,
  inicio: z.number().nonnegative(),
  fim: z.number().nonnegative(),
  frases: z.array(fraseNoTempoSchema).default([]),
})
export type SecaoNoTempo = z.infer<typeof secaoNoTempoSchema>

/** `modulos.recap` na raiz do projeto (o `origemDoStudioSchema` do Studio, com versao). */
export const recapNoProjetoSchema = z
  .object({
    versao: z.literal(VERSAO_DO_RECAP_NO_PROJETO),
    rascunhoId: z.string().regex(/^rc_[0-9a-z_]+$/),
    episodioId: z.string().regex(/^ep_[0-9a-f]{40}$/),
    takeId: z.string().regex(/^t\d+$/),
    roteiroVersao: z.number().int().positive(),
    /** A narracao veio com as palavras alinhadas (a voz gerada): o transcript fica travado. */
    vozAlinhada: z.boolean(),
    geradoEm: z.string(),
    /** Ausente no projeto montado antes da Edicao rapida. */
    secoes: z.array(secaoNoTempoSchema).optional(),
    /**
     * O ultimo render bom (20/10, a tela pos-render): o arquivo e quando. O
     * "Video pronto" da barra de status reabre a tela por aqui, sem gerar nada
     * de novo. Ausente = ainda sem render.
     */
    render: z.object({ arquivo: z.string().min(1), em: z.string() }).optional(),
    /**
     * Os titulos e textos de thumb do "Escrever de novo" da tela pos-render
     * (20/10): valem no lugar dos do roteiro. Ausente = os do roteiro.
     */
    sugestoesDoVideo: z.object({ titulos: z.array(z.string()), thumbs: z.array(z.string()), em: z.string() }).optional(),
  })
  // Guarda o que nao conhece (um campo de versao futura do modulo).
  .loose()
export type RecapNoProjeto = z.infer<typeof recapNoProjetoSchema>

/** O pedaco do recap lido de `modulos` (null = nao tem, ou nao passa). */
export function recapDoProjeto(modulos: Record<string, unknown> | undefined | null): RecapNoProjeto | null {
  const lido = recapNoProjetoSchema.safeParse(modulos?.[ID_DO_MODULO])
  return lido.success ? lido.data : null
}

// ================================================================= os itens

type ComModulos = { modulos?: Record<string, unknown> | undefined }

function dadosDoItem(item: ComModulos): Record<string, unknown> {
  const d = item.modulos?.[ID_DO_MODULO]
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {}
}

/** Poe (ou tira, sem nada) o pedaco do recap no `modulos` do item, sem tocar no de outro modulo. */
function comDados<T extends ComModulos>(item: T, dados: Record<string, unknown>): T {
  const { [ID_DO_MODULO]: _antigo, ...outros } = item.modulos ?? {}
  const modulos = Object.keys(dados).length > 0 ? { ...outros, [ID_DO_MODULO]: dados } : outros
  const { modulos: _m, ...resto } = item
  return (Object.keys(modulos).length > 0 ? { ...resto, modulos } : resto) as T
}

/** O papel de um trecho de audio: o do modulo ou, num projeto do Studio, o do proprio item. */
export function papelDaTrilha(t: ComModulos & { papel?: unknown }): PapelDaTrilha | undefined {
  const lido = papelDaTrilhaSchema.safeParse(dadosDoItem(t)['papel'] ?? t.papel)
  return lido.success ? lido.data : undefined
}

export function papelDaSobreposicao(o: ComModulos & { papel?: unknown }): PapelDaSobreposicao | undefined {
  const lido = papelDaSobreposicaoSchema.safeParse(dadosDoItem(o)['papel'] ?? o.papel)
  return lido.success ? lido.data : undefined
}

export function corOriginalDe(o: ComModulos & { corOriginal?: unknown }): AjusteDeCor | undefined {
  const lido = ajusteDeCorSchema.safeParse(dadosDoItem(o)['corOriginal'] ?? o.corOriginal)
  return lido.success ? lido.data : undefined
}

/** O trecho do nucleo achatado para o codigo do Studio. */
export function trilhaParaOModulo<T extends TrechoDeAudioSalvo>(t: T): T & { papel?: PapelDaTrilha } {
  const papel = papelDaTrilha(t)
  const { papel: _p, ...cru } = t as T & { papel?: unknown }
  // O papel sai de `modulos.recap` (fica so achatado): o mesmo trecho nao tem dois papeis.
  const { papel: _mp, ...dados } = dadosDoItem(cru)
  const resto = comDados(cru, dados)
  return (papel ? { ...resto, papel } : resto) as T & { papel?: PapelDaTrilha }
}

/** O trecho achatado de volta ao lugar: `papel` em `modulos.recap`. */
export function trilhaParaONucleo<T extends TrechoDeAudioSalvo & { papel?: unknown }>(t: T): Omit<T, 'papel'> {
  const papel = papelDaTrilha(t)
  const { papel: _p, ...resto } = t
  const { papel: _velho, ...dados } = dadosDoItem(resto)
  return comDados(resto, papel ? { ...dados, papel } : dados) as Omit<T, 'papel'>
}

export function clipeParaOModulo<T extends SobreposicaoSalva>(o: T): T & { papel?: PapelDaSobreposicao; corOriginal?: AjusteDeCor } {
  const papel = papelDaSobreposicao(o)
  const corOriginal = corOriginalDe(o)
  const { papel: _p, corOriginal: _c, ...cru } = o as T & { papel?: unknown; corOriginal?: unknown }
  // Tirados de `modulos.recap`: a camada achatada e comparada campo a campo com a que a Edicao rapida poe.
  const { papel: _mp, corOriginal: _mc, ...dados } = dadosDoItem(cru)
  const resto = comDados(cru, dados)
  return { ...resto, ...(papel ? { papel } : {}), ...(corOriginal ? { corOriginal } : {}) } as T & {
    papel?: PapelDaSobreposicao
    corOriginal?: AjusteDeCor
  }
}

export function clipeParaONucleo<T extends SobreposicaoSalva & { papel?: unknown; corOriginal?: unknown }>(
  o: T,
): Omit<T, 'papel' | 'corOriginal'> {
  const papel = papelDaSobreposicao(o)
  const corOriginal = corOriginalDe(o)
  const { papel: _p, corOriginal: _c, ...resto } = o
  const { papel: _vp, corOriginal: _vc, ...dados } = dadosDoItem(resto)
  return comDados(resto, { ...dados, ...(papel ? { papel } : {}), ...(corOriginal ? { corOriginal } : {}) }) as Omit<
    T,
    'papel' | 'corOriginal'
  >
}

// ========================================================= projeto do Studio

/** O que um projeto do Studio traz que vive em outro lugar no Dangai. */
export interface ProjetoParaConverter {
  modulos?: Record<string, unknown> | undefined
  trilhas: readonly (TrechoDeAudioSalvo & { papel?: unknown })[]
  sobreposicoes: readonly (SobreposicaoSalva & { papel?: unknown; corOriginal?: unknown })[]
  /** O `studio` da raiz (o arquivo inteiro do .anirecap, ou os extras do store). */
  studio?: unknown
}

export interface Conversao<T extends ProjetoParaConverter> {
  /** `modulos` com o `recap` (ou como estava, se o studio nao passa). */
  modulos: Record<string, unknown>
  trilhas: T['trilhas'][number][]
  sobreposicoes: T['sobreposicoes'][number][]
  /** A voz era a do take alinhado: o transcript precisa ficar travado. */
  travar: boolean
}

const temCampo = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k) && (o as Record<string, unknown>)[k] !== undefined

/**
 * Um projeto que passou pelo AniRecap Studio (o `studio` na raiz, ou `papel`/
 * `corOriginal` nos itens) no formato do modulo. null = nao ha o que mudar
 * (projeto do Dangai, ou ja convertido). Com `modulos.recap` ja la, a raiz
 * fica como esta (o `studio` velho nao passa por cima do que o modulo gravou).
 */
export function converterDoStudio<T extends ProjetoParaConverter>(p: T): Conversao<T> | null {
  const itens = p.trilhas.some((t) => temCampo(t, 'papel')) || p.sobreposicoes.some((o) => temCampo(o, 'papel') || temCampo(o, 'corOriginal'))
  const jaTem = recapDoProjeto(p.modulos) !== null
  const studio = !jaTem && p.studio && typeof p.studio === 'object' ? (p.studio as Record<string, unknown>) : null
  const raiz = studio ? recapNoProjetoSchema.safeParse({ ...studio, versao: VERSAO_DO_RECAP_NO_PROJETO }) : null
  if (!itens && !raiz?.success) return null
  return {
    modulos: raiz?.success ? { ...(p.modulos ?? {}), [ID_DO_MODULO]: raiz.data } : { ...(p.modulos ?? {}) },
    trilhas: p.trilhas.map((t) => (temCampo(t, 'papel') ? trilhaParaONucleo(t) : t)) as T['trilhas'][number][],
    sobreposicoes: p.sobreposicoes.map((o) =>
      temCampo(o, 'papel') || temCampo(o, 'corOriginal') ? clipeParaONucleo(o) : o,
    ) as T['sobreposicoes'][number][],
    travar: raiz?.success === true && raiz.data.vozAlinhada,
  }
}
