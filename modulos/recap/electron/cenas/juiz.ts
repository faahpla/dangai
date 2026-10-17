import { z } from 'zod'
import type { JuizVisual } from '../../shared/config'
import type { CandidatoDeCena, EscolhaDaFrase } from '../../shared/cenas'

/**
 * [recap] C6, o JUIZ VISUAL (lote 2 das ideias; o Levi pediu o minimo, 17/10):
 * opcional e DESLIGADO por padrao. A IA olha as 3 melhores de cada frase e
 * escolhe, em POUCOS pedidos (lotes de frases com as imagens juntas).
 *
 * Hoje o `gerarJson` do nucleo so manda texto: o juiz so roda quando o nucleo
 * oferecer `ia.gerarJsonComImagens` (pedido anotado para o Faah). Sem isso,
 * sem chave ou desligado, nao faz nada e o casar fica como esta. O Haiku e
 * pago: so com o custo confirmado (custoDoJuiz) -- quem confirma e a tela.
 */

/** Frases por pedido (3 imagens cada): 6 frases = 18 imagens, ~1 pedido a cada 6 frases. */
export const FRASES_POR_PEDIDO = 6
/** Quantas candidatas a IA ve por frase. */
export const CANDIDATAS_POR_FRASE = 3
/** Claude Haiku 5.5: US$ por milhao de tokens (entrada, saida). */
const HAIKU_US$ = { entrada: 0.1, saida: 0.5 }
/** A miniatura de 320x180 da grade custa ~77 tokens de imagem (largura*altura/750); com folga. */
const TOKENS_POR_IMAGEM = 100
const TOKENS_DE_TEXTO_POR_FRASE = 60
const TOKENS_DE_SAIDA_POR_FRASE = 15

export const respostaDoJuizSchema = z.object({
  escolhas: z.array(z.object({ fraseId: z.string(), candidata: z.number().int() })),
})
export type RespostaDoJuiz = z.infer<typeof respostaDoJuizSchema>

export interface ImagemDoJuiz {
  /** "f03#2": a frase e a posicao da candidata (1..3). */
  rotulo: string
  arquivo: string
}

export interface PedidoDoJuiz {
  prompt: string
  imagens: ImagemDoJuiz[]
  fraseIds: string[]
}

/** O que o juiz precisa do nucleo: o gerarJson com imagens (ainda nao existe no nucleo). */
export type GerarJsonComImagens = (pedido: {
  schema: typeof respostaDoJuizSchema
  sistema: string
  prompt: string
  imagens: ImagemDoJuiz[]
  etapa: string
  provedor?: 'gemini' | 'anthropic'
  modelo?: string
}) => Promise<{ ok: true; valor: RespostaDoJuiz } | { ok: false; nota: string }>

export const SISTEMA_DO_JUIZ = `Você escolhe a cena de anime que melhor acompanha cada frase de um roteiro narrado.
Cada frase vem com até 3 imagens candidatas, rotuladas "<fraseId>#<n>". Escolha o n da imagem que mostra o que a frase diz (quem, a ação, o lugar). Na dúvida, fique com a #1.`

/** Os pedidos: lotes de FRASES_POR_PEDIDO frases, cada uma com as CANDIDATAS_POR_FRASE primeiras da fita. */
export function pedidosDoJuiz(
  frases: readonly { id: string; texto: string }[],
  escolhas: ReadonlyMap<string, Pick<EscolhaDaFrase, 'fita'>>,
  keyframeDe: (c: CandidatoDeCena) => string | null,
): PedidoDoJuiz[] {
  const comFita = frases.flatMap((f) => {
    const fita = (escolhas.get(f.id)?.fita ?? []).slice(0, CANDIDATAS_POR_FRASE)
    const imagens = fita.flatMap((c, i) => {
      const arquivo = keyframeDe(c)
      return arquivo ? [{ rotulo: `${f.id}#${i + 1}`, arquivo }] : []
    })
    return imagens.length >= 2 ? [{ f, imagens }] : []
  })
  const saida: PedidoDoJuiz[] = []
  for (let i = 0; i < comFita.length; i += FRASES_POR_PEDIDO) {
    const lote = comFita.slice(i, i + FRASES_POR_PEDIDO)
    saida.push({
      prompt: lote.map(({ f, imagens }) => `[${f.id}] ${f.texto}\n  candidatas: ${imagens.map((x) => x.rotulo).join(', ')}`).join('\n'),
      imagens: lote.flatMap((x) => x.imagens),
      fraseIds: lote.map((x) => x.f.id),
    })
  }
  return saida
}

/** O custo estimado do juiz no Haiku, em US$ (a pergunta de custo mostra). */
export function custoDoJuiz(pedidos: readonly PedidoDoJuiz[]): number {
  const frases = pedidos.reduce((s, p) => s + p.fraseIds.length, 0)
  const imagens = pedidos.reduce((s, p) => s + p.imagens.length, 0)
  const entrada = imagens * TOKENS_POR_IMAGEM + frases * TOKENS_DE_TEXTO_POR_FRASE + pedidos.length * 150
  const saida = frases * TOKENS_DE_SAIDA_POR_FRASE
  return (entrada * HAIKU_US$.entrada + saida * HAIKU_US$.saida) / 1_000_000
}

/** A candidata escolhida vai para o topo da fita e vira a cena (so frase nao travada). */
export function aplicarVeredito(escolha: EscolhaDaFrase, candidata: number): EscolhaDaFrase {
  const k = candidata - 1
  if (escolha.travada || k <= 0 || k >= Math.min(CANDIDATAS_POR_FRASE, escolha.fita.length)) return escolha
  const nova = escolha.fita[k]!
  const fita = [nova, ...escolha.fita.filter((_, i) => i !== k)]
  return { ...escolha, fita, cenas: [{ candidato: nova, palavraInicio: 0 }] }
}

export interface Julgamento {
  escolhas: EscolhaDaFrase[]
  pedidos: number
  /** Por que nao julgou (ASCII curto). null = julgou. */
  nota: string | null
}

/**
 * Julga as escolhas. `gerar` ausente = o nucleo nao manda imagem: nada muda.
 * Haiku sem `custoConfirmado`: nada muda (a tela pergunta antes).
 */
export async function julgar(
  juiz: JuizVisual,
  frases: readonly { id: string; texto: string }[],
  escolhas: readonly EscolhaDaFrase[],
  keyframeDe: (c: CandidatoDeCena) => string | null,
  gerar: GerarJsonComImagens | null,
  opcoes: { temChave: boolean; custoConfirmado: boolean },
): Promise<Julgamento> {
  if (juiz === 'desligado') return { escolhas: [...escolhas], pedidos: 0, nota: null }
  if (!gerar) return { escolhas: [...escolhas], pedidos: 0, nota: 'O nucleo ainda nao manda imagem para a IA.' }
  if (!opcoes.temChave) return { escolhas: [...escolhas], pedidos: 0, nota: 'sem chave' }
  if (juiz === 'haiku' && !opcoes.custoConfirmado) return { escolhas: [...escolhas], pedidos: 0, nota: 'Confirme o custo do juiz.' }
  const porId = new Map(escolhas.map((e) => [e.fraseId, e]))
  const pedidos = pedidosDoJuiz(frases, porId, keyframeDe)
  const vereditos = new Map<string, number>()
  let nota: string | null = null
  for (const p of pedidos) {
    const r = await gerar({
      schema: respostaDoJuizSchema,
      sistema: SISTEMA_DO_JUIZ,
      prompt: p.prompt,
      imagens: p.imagens,
      etapa: 'juiz-visual',
      ...(juiz === 'haiku' ? { provedor: 'anthropic' as const, modelo: 'claude-haiku-5-5' } : { provedor: 'gemini' as const }),
    })
    if (!r.ok) {
      nota = r.nota
      break
    }
    for (const e of r.valor.escolhas) if (p.fraseIds.includes(e.fraseId)) vereditos.set(e.fraseId, e.candidata)
  }
  return {
    escolhas: escolhas.map((e) => (vereditos.has(e.fraseId) ? aplicarVeredito(e, vereditos.get(e.fraseId)!) : e)),
    pedidos: pedidos.length,
    nota,
  }
}
