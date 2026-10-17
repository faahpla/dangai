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

/** O que revisarRoteiro devolve. */
export type RevisaoFeita =
  | { pulada: null; revisao: Revisao; doCache: boolean; rascunho: import('./roteiro').RascunhoDoRecap }
  | {
      /** desligada = automatica com o revisor desligado (nada a dizer); falhou = cota, rede, so reserva. */
      pulada: 'desligada' | 'falhou'
      nota: string
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
  }
}
