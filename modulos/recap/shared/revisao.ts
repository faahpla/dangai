import { z } from 'zod'
import type { Roteiro } from './roteiro'

/**
 * [recap] O REVISOR do passo 2: UMA passada extra da IA (no provedor padrao,
 * gratis no Gemini) que le o roteiro contra os eventos e as falas que cada
 * frase cita, e marca por frase:
 *  - 'sem-prova': o fato nao esta nas falas citadas (alucinacao);
 *  - 'contradiz': as falas dizem outra coisa (vitima trocada, hipotese virou
 *    fato, a ideia de um virou do grupo, verbo escalado);
 *  - 'confusa': pronome sem dono, frase que nao se entende sozinha;
 *  - 'fraca': generica, sem informacao, cliche;
 *  - 'repetida': repete fato ou palavra de outra frase.
 * Cada marca traz o motivo e, quando da, a frase sugerida.
 *
 * A revisao mora no rascunho (`revisoes`), uma por versao revisada. A tela
 * mostra a da versao na tela ou a de uma versao de onde ela saiu (editar cria
 * uma 'editado' derivada); uma marca so aparece enquanto a frase tem o MESMO
 * texto que foi revisado -- mexeu na frase, a marca some.
 *
 * "Aplicar" numa frase troca o texto (edicao comum da tela); "Aplicar todas"
 * cria uma VERSAO NOVA ('ia', `revisada`), com os mesmos ids e vinculos -- a
 * voz e as cenas seguem pelo id, como no religar. Ele escolhe a versao que
 * fica em "Versoes".
 */

export const PROBLEMAS_DA_REVISAO = ['sem-prova', 'contradiz', 'confusa', 'fraca', 'repetida'] as const
export type ProblemaDaRevisao = (typeof PROBLEMAS_DA_REVISAO)[number]

/** O rotulo do chip (1-2 palavras) e se e alucinacao (cor de perigo). */
export const ROTULO_DO_PROBLEMA: Record<ProblemaDaRevisao, { rotulo: string; grave: boolean }> = {
  'sem-prova': { rotulo: 'Sem prova', grave: true },
  contradiz: { rotulo: 'Contradiz', grave: true },
  confusa: { rotulo: 'Confusa', grave: false },
  fraca: { rotulo: 'Fraca', grave: false },
  repetida: { rotulo: 'Repetida', grave: false },
}

/** O que o LLM devolve: FECHADO, sem default e frouxo, como os outros schemas do passo 2. */
export const revisaoDaIaSchema = z.object({
  frases: z.array(
    z.object({
      fraseId: z.string(),
      problema: z.enum(PROBLEMAS_DA_REVISAO).nullable(),
      motivo: z.string(),
      sugestao: z.string().nullable(),
    }),
  ),
})
export type RevisaoDaIa = z.infer<typeof revisaoDaIaSchema>

export const itemDaRevisaoSchema = z.object({
  fraseId: z.string(),
  /** O texto da frase quando foi revisada: mudou, a marca nao vale mais. */
  texto: z.string(),
  problema: z.enum(PROBLEMAS_DA_REVISAO),
  motivo: z.string(),
  /** A frase sugerida. null = sem sugestao (so o aviso). */
  sugestao: z.string().nullable(),
  ignorado: z.boolean(),
})
export type ItemDaRevisao = z.infer<typeof itemDaRevisaoSchema>

export const revisaoSchema = z.object({
  /** A versao revisada. */
  versao: z.number().int().positive(),
  criadoEm: z.string(),
  modelo: z.string(),
  /** So as frases com problema. Vazio = revisada, nada a apontar. */
  itens: z.array(itemDaRevisaoSchema),
})
export type Revisao = z.infer<typeof revisaoSchema>

/** Quantas revisoes o rascunho guarda (as mais novas). */
export const REVISOES_MAX = 20
/** Marcas por roteiro, no maximo: revisor que marca tudo nao ajuda. */
export const MARCAS_MAX = 10

/**
 * [A2] Os dois modos do botao "Revisar":
 * - corrigir: o de sempre (sem prova, contradiz, confusa, fraca, repetida).
 *   Na mao, ja aplica as sugestoes numa versao 'Revisada'; o automatico,
 *   depois de gerar, so marca (o "Aplicar todas" faz a versao);
 * - melhorar: reescreve os trechos chapados (lista de fatos, gancho fraco,
 *   final seco) com gancho e ritmo, no Estilo, SEM fato novo: versao 'Melhorada'.
 * Um pedido cada um, gratis no Gemini.
 */
export const MODOS_DA_REVISAO = ['corrigir', 'melhorar'] as const
export type ModoDaRevisao = (typeof MODOS_DA_REVISAO)[number]

/** O que revisarRoteiro devolve. */
export type RevisaoFeita =
  | {
      pulada: null
      modo: ModoDaRevisao
      /** A revisao gravada (corrigir). null no melhorar (nao guarda marcas: a versao nova ja e o resultado). */
      revisao: Revisao | null
      doCache: boolean
      rascunho: import('./roteiro').RascunhoDoRecap
      /** A versao Revisada/Melhorada criada agora. null = nada a trocar (ou o automatico, que so marca). */
      versaoNova: number | null
      /** Frases trocadas na versao nova. */
      trocadas: number
      /** Frases marcadas pelo revisor (corrigir), com ou sem sugestao. */
      marcadas: number
    }
  | {
      /** desligada = automatica com o revisor desligado (nada a dizer); falhou = cota, rede, so reserva. */
      pulada: 'desligada' | 'falhou'
      nota: string
    }

/** O recado curto depois de revisar: "1 frase corrigida", "6 frases melhoradas", "Nada a corrigir". */
export function resumoDaRevisao(feita: { modo: ModoDaRevisao; trocadas: number; marcadas: number; versaoNova: number | null }): string {
  const n = feita.trocadas
  if (feita.modo === 'melhorar') return n === 0 ? 'Nada a melhorar' : `${n} ${n === 1 ? 'frase melhorada' : 'frases melhoradas'}`
  if (n > 0) {
    const semSugestao = feita.marcadas - n
    return `${n} ${n === 1 ? 'frase corrigida' : 'frases corrigidas'}${semSugestao > 0 ? ` · ${semSugestao} ${semSugestao === 1 ? 'marcada' : 'marcadas'}` : ''}`
  }
  if (feita.marcadas > 0) return `${feita.marcadas} ${feita.marcadas === 1 ? 'frase marcada' : 'frases marcadas'}`
  return 'Nada a corrigir'
}

/** Uma frase so: uma linha, sem aspas de enfeite em volta, com ponto no fim. */
function sugestaoLimpa(s: string | null): string | null {
  if (s === null) return null
  const t = s.replace(/\s+/g, ' ').trim().replace(/^["“]|["”]$/g, '').trim()
  if (!t) return null
  return /[.!?…]$/.test(t) ? t : `${t}.`
}

/**
 * A resposta do LLM -> os itens da revisao: so frase que existe na versao,
 * uma marca por frase (a primeira), sem marca nula, sugestao igual ao texto
 * vira null, e no maximo MARCAS_MAX (as graves primeiro).
 */
export function itensDaRevisao(bruto: RevisaoDaIa, roteiro: Pick<Roteiro, 'secoes'>): ItemDaRevisao[] {
  const textos = new Map(roteiro.secoes.flatMap((s) => s.frases.map((f) => [f.id, f.texto] as const)))
  const vistos = new Set<string>()
  const itens: ItemDaRevisao[] = []
  for (const r of bruto.frases) {
    const id = /f\d{2,}/.exec(r.fraseId)?.[0]
    if (!id || vistos.has(id) || r.problema === null) continue
    const texto = textos.get(id)
    if (texto === undefined) continue
    vistos.add(id)
    const sugestao = sugestaoLimpa(r.sugestao)
    itens.push({
      fraseId: id,
      texto,
      problema: r.problema,
      motivo: r.motivo.replace(/\s+/g, ' ').trim().slice(0, 300),
      sugestao: sugestao && sugestao !== texto.trim() ? sugestao.slice(0, 400) : null,
      ignorado: false,
    })
  }
  const ordem = (i: ItemDaRevisao): number => (ROTULO_DO_PROBLEMA[i.problema].grave ? 0 : 1)
  // A ordem do roteiro fica entre os de mesmo peso (sort e estavel).
  return itens.sort((a, b) => ordem(a) - ordem(b)).slice(0, MARCAS_MAX)
}

/** Guarda a revisao no rascunho: troca a da mesma versao, e fica com as REVISOES_MAX mais novas. */
export function comRevisao<R extends { revisoes: Revisao[] }>(r: R, revisao: Revisao, agoraIso: string): R & { atualizadoEm: string } {
  const outras = r.revisoes.filter((x) => x.versao !== revisao.versao)
  return { ...r, revisoes: [...outras, revisao].slice(-REVISOES_MAX), atualizadoEm: agoraIso }
}

/**
 * A revisao que vale para o roteiro `tela`: a da propria versao ou a da
 * versao mais proxima de onde ela saiu (derivadoDe). null = nenhuma.
 */
export function revisaoDaVersao(
  r: { roteiros: readonly Pick<Roteiro, 'versao' | 'derivadoDe'>[]; revisoes: readonly Revisao[] },
  versao: number,
): Revisao | null {
  const vistas = new Set<number>()
  let v: number | null = versao
  while (v !== null && !vistas.has(v)) {
    vistas.add(v)
    const achada = r.revisoes.find((x) => x.versao === v)
    if (achada) return achada
    v = r.roteiros.find((x) => x.versao === v)?.derivadoDe ?? null
  }
  return null
}

/** As marcas que aparecem: frase que existe na tela, com o MESMO texto, nao ignorada. */
export function marcasNaTela(revisao: Revisao | null, tela: Pick<Roteiro, 'secoes'> | null): ItemDaRevisao[] {
  if (!revisao || !tela) return []
  const textos = new Map(tela.secoes.flatMap((s) => s.frases.map((f) => [f.id, f.texto] as const)))
  return revisao.itens.filter((i) => !i.ignorado && textos.get(i.fraseId) === i.texto)
}

/**
 * "APLICAR TODAS": a versao `base` com o texto das frases marcadas (com
 * sugestao) trocado. Mesmos ids, eventos, momento, intencao visual e texto de
 * tela; a citacao sai se o texto novo nao tem mais aspas. Devolve null quando
 * nao ha o que trocar.
 */
export function roteiroRevisado(
  base: Roteiro,
  marcas: readonly ItemDaRevisao[],
  ctx: { versao: number; agoraIso: string; modelo: string },
): Roteiro | null {
  const trocar = new Map(marcas.filter((m) => m.sugestao).map((m) => [m.fraseId, m.sugestao!] as const))
  let trocadas = 0
  const secoes = base.secoes.map((s) => ({
    ...s,
    frases: s.frases.map((f) => {
      const nova = trocar.get(f.id)
      if (!nova || nova === f.texto) return f
      trocadas += 1
      return { ...f, texto: nova, citacaoCueId: /["“”]/.test(nova) ? f.citacaoCueId : null }
    }),
  }))
  if (trocadas === 0) return null
  return {
    versao: ctx.versao,
    alvoSec: base.alvoSec,
    secoes,
    modelo: ctx.modelo,
    criadoEm: ctx.agoraIso,
    origem: 'ia',
    derivadoDe: base.versao,
    pedido: null,
    revisada: true,
    ...(base.sugestoes ? { sugestoes: base.sugestoes } : {}),
  }
}

// ------------------------------------------------------- melhorar texto

/** O que o LLM devolve no "Melhorar texto": FECHADO e frouxo, como os outros. */
export const melhoriaDaIaSchema = z.object({
  frases: z.array(
    z.object({
      fraseId: z.string(),
      /** Por que mudou, curto ("lista de fatos", "gancho fraco", "final seco"). */
      motivo: z.string(),
      /** O texto novo: uma frase (ou duas curtas). */
      sugestao: z.string(),
    }),
  ),
})
export type MelhoriaDaIa = z.infer<typeof melhoriaDaIaSchema>

// ------------------------------------------------------- o que mudou

/** Uma frase que o revisor trocou e que continua como ele deixou. */
export interface MudancaDaRevisao {
  /** O texto de antes ('' = frase nova, a 2a metade de uma frase dividida). */
  antes: string
  modo: ModoDaRevisao
}

/**
 * [A2] AS FRASES QUE O REVISOR TROCOU, para a marca discreta na tela: na
 * versao Revisada/Melhorada e nas edicoes dela, a frase que ainda tem o texto
 * que o revisor deixou e que era outro na versao de onde ela saiu. Mexeu na
 * frase, a marca sai. Mapa fraseId -> o texto de antes.
 */
export function mudancasNaTela(
  r: { roteiros: readonly Pick<Roteiro, 'versao' | 'derivadoDe' | 'origem' | 'revisada' | 'melhorada' | 'secoes'>[] },
  tela: Pick<Roteiro, 'versao' | 'secoes'> | null,
): Map<string, MudancaDaRevisao> {
  const saida = new Map<string, MudancaDaRevisao>()
  if (!tela) return saida
  // Sobe pelas edicoes ate a versao que o revisor fez; outra versao da IA no caminho corta.
  const vistas = new Set<number>()
  let v: number | null = tela.versao
  let revisora: (typeof r.roteiros)[number] | undefined
  while (v !== null && !vistas.has(v)) {
    vistas.add(v)
    const atual = r.roteiros.find((x) => x.versao === v)
    if (!atual) return saida
    if (atual.revisada || atual.melhorada) {
      revisora = atual
      break
    }
    if (atual.origem !== 'editado') return saida
    v = atual.derivadoDe
  }
  if (!revisora || revisora.derivadoDe === null) return saida
  const base = r.roteiros.find((x) => x.versao === revisora!.derivadoDe)
  if (!base) return saida
  const modo: ModoDaRevisao = revisora.melhorada ? 'melhorar' : 'corrigir'
  const dele = new Map(revisora.secoes.flatMap((s) => s.frases.map((f) => [f.id, f.texto] as const)))
  const antes = new Map(base.secoes.flatMap((s) => s.frases.map((f) => [f.id, f.texto] as const)))
  for (const s of tela.secoes) {
    for (const f of s.frases) {
      const texto = dele.get(f.id)
      if (texto === undefined || texto !== f.texto) continue
      const velho = antes.get(f.id)
      if (velho === texto) continue
      saida.set(f.id, { antes: velho ?? '', modo })
    }
  }
  return saida
}

/** Uma linha do "Comparar": a mesma frase (pelo id) nas duas versoes. */
export interface LinhaDaComparacao {
  /** O papel da parte (da direita, ou da esquerda quando so ela tem a frase). */
  papel: Roteiro['secoes'][number]['papel']
  /** Primeira linha da parte: a tela poe o rotulo. */
  abreParte: boolean
  fraseId: string
  esquerda: string | null
  direita: string | null
  igual: boolean
}

/**
 * [A2] O "COMPARAR": as duas versoes lado a lado, frase por frase, casadas
 * pelo id (o revisor, o refazer e a edicao mantem o id da frase). Na ordem da
 * DIREITA; a frase que so a esquerda tem entra logo depois da vizinha que
 * as duas tem. Versoes sem nada em comum (outra versao inteira) se alinham
 * pela posicao do id.
 */
export function compararVersoes(esquerda: Pick<Roteiro, 'secoes'>, direita: Pick<Roteiro, 'secoes'>): LinhaDaComparacao[] {
  type Item = { id: string; texto: string; papel: LinhaDaComparacao['papel']; secaoId: string }
  const lista = (r: Pick<Roteiro, 'secoes'>): Item[] =>
    r.secoes.flatMap((s) => s.frases.map((f) => ({ id: f.id, texto: f.texto, papel: s.papel, secaoId: s.id })))
  const a = lista(esquerda)
  const b = lista(direita)
  const daEsquerda = new Map(a.map((x) => [x.id, x] as const))
  const naDireita = new Set(b.map((x) => x.id))
  const linhas: (Omit<LinhaDaComparacao, 'abreParte'> & { secaoId: string })[] = []
  // As que so a esquerda tem, agrupadas atras da ultima vizinha comum.
  const sobras = new Map<string, Item[]>()
  let vizinha = ''
  for (const x of a) {
    if (naDireita.has(x.id)) vizinha = x.id
    else sobras.set(vizinha, [...(sobras.get(vizinha) ?? []), x])
  }
  const soltar = (depoisDe: string): void => {
    // A frase que saiu fica na parte da vizinha (sem abrir rotulo novo no meio).
    for (const x of sobras.get(depoisDe) ?? []) {
      const anterior = linhas[linhas.length - 1]
      linhas.push({ papel: anterior?.papel ?? x.papel, secaoId: anterior?.secaoId ?? `e-${x.secaoId}`, fraseId: x.id, esquerda: x.texto, direita: null, igual: false })
    }
    sobras.delete(depoisDe)
  }
  soltar('')
  for (const x of b) {
    const e = daEsquerda.get(x.id)
    linhas.push({ papel: x.papel, secaoId: x.secaoId, fraseId: x.id, esquerda: e?.texto ?? null, direita: x.texto, igual: e !== undefined && e.texto === x.texto })
    soltar(x.id)
  }
  return linhas.map((l, i) => {
    const { secaoId, ...resto } = l
    return { ...resto, abreParte: i === 0 || linhas[i - 1]!.secaoId !== secaoId }
  })
}
