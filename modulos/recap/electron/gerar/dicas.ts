import { z } from 'zod'
import { dicasDasCenas, roteiroAtual, type Frase, type Roteiro } from '../../shared/roteiro'
import { gerarComCache, TEMPO_LIMITE_DO_PASSO_MS } from './ia'
import { gravarRascunho, lerRascunhoDoDisco } from './rascunho'

/**
 * [recap] As DICAS do passo 4 (lote 2 das ideias, C2/C3) para roteiro de antes
 * dos campos: as etiquetas do Danbooru e a intencao em ingles de cada frase,
 * num pedido SO por roteiro (o Gemini gratis conta pedidos). O roteiro novo ja
 * traz as duas da geracao (fraseDaIaSchema), sem pedido a mais.
 *
 * Nunca lanca: sem IA, sem cota ou resposta torta, o passo 4 segue sem as
 * dicas (o casar fica como era). A resposta entra no cache do passo 2.
 */

const dicasDaIaSchema = z.object({
  frases: z.array(z.object({ fraseId: z.string(), tags: z.array(z.string()), visualEn: z.string() })),
})

const SISTEMA_DICAS = `Você ajuda a escolher cenas de anime para cada frase de um roteiro de recap.
Para cada frase, devolva:
- tags: de 2 a 5 etiquetas do Danbooru, em inglês e minúsculas, do que a tela deve mostrar: ação, objeto, lugar, hora, emoção ("crying", "punching", "sword", "night", "explosion", "hospital bed"). Nada de nome de personagem, cor de cabelo nem "1girl".
- visualEn: a intenção visual em inglês, curta e concreta, como legenda de imagem ("a small girl lying weak in a hospital bed"). Sem nome de personagem: descreva quem é.
Use o fraseId exatamente como veio.`

/** As frases faladas sem as duas dicas. */
export function frasesSemDicas(roteiro: Pick<Roteiro, 'secoes'>): Frase[] {
  return roteiro.secoes.flatMap((s) => s.frases).filter((f) => f.texto.trim() && !f.visualEn && !(f.tags && f.tags.length > 0))
}

export function promptDasDicas(frases: readonly Frase[], resumoDoEvento: (id: string) => string | null): string {
  const linhas = frases.map((f) => {
    const ev = f.eventoIds.map(resumoDoEvento).find(Boolean)
    return `[${f.id}] ${f.texto}${f.intencaoVisual ? ` | na tela: ${f.intencaoVisual}` : ''}${ev ? ` | acontecimento: ${ev}` : ''}`
  })
  return `FRASES:\n${linhas.join('\n')}`
}

export interface DicasFeitas {
  /** Quantas frases ganharam dicas agora. */
  feitas: number
  /** Por que nao (ASCII curto). null = deu certo ou nao precisava. */
  nota: string | null
  doCache: boolean
}

const emAndamento = new Map<string, Promise<DicasFeitas>>()

/** Completa as dicas do roteiro aprovado do rascunho. Um pedido por vez por rascunho. */
export function completarDicas(rascunhoId: string): Promise<DicasFeitas> {
  const ja = emAndamento.get(rascunhoId)
  if (ja) return ja
  const p = completar(rascunhoId).finally(() => emAndamento.delete(rascunhoId))
  emAndamento.set(rascunhoId, p)
  return p
}

async function completar(rascunhoId: string): Promise<DicasFeitas> {
  try {
    const r = lerRascunhoDoDisco(rascunhoId)
    const roteiro = roteiroAtual(r)
    if (!roteiro) return { feitas: 0, nota: null, doCache: false }
    const faltam = frasesSemDicas(roteiro)
    if (faltam.length === 0) return { feitas: 0, nota: null, doCache: false }
    const resumo = new Map(r.eventos.map((e) => [e.id, e.resumo]))
    const resposta = await gerarComCache({
      schema: dicasDaIaSchema,
      sistema: SISTEMA_DICAS,
      prompt: promptDasDicas(faltam, (id) => resumo.get(id) ?? null),
      etapa: 'dicas-das-cenas',
      maxTokens: 3000,
      tempoLimiteMs: TEMPO_LIMITE_DO_PASSO_MS,
    })
    if (!resposta.ok) return { feitas: 0, nota: resposta.nota, doCache: false }
    const porId = new Map<string, Pick<Frase, 'tags' | 'visualEn'>>()
    for (const item of resposta.valor.frases) {
      const id = /f\d{2,}/.exec(item.fraseId)?.[0]
      const dicas = dicasDasCenas(item)
      if (id && (dicas.tags || dicas.visualEn)) porId.set(id, dicas)
    }
    if (porId.size === 0) return { feitas: 0, nota: 'A IA nao devolveu as dicas.', doCache: resposta.doCache }
    resposta.guardar()
    // Relido na hora de gravar (a chamada lenta veio antes): so as frases SEM dicas ganham.
    const atual = lerRascunhoDoDisco(rascunhoId)
    let feitas = 0
    const roteiros = atual.roteiros.map((rot) =>
      rot.versao !== atual.atual
        ? rot
        : {
            ...rot,
            secoes: rot.secoes.map((s) => ({
              ...s,
              frases: s.frases.map((f) => {
                const d = porId.get(f.id)
                if (!d || f.visualEn || (f.tags && f.tags.length > 0)) return f
                feitas += 1
                return { ...f, ...d }
              }),
            })),
          },
    )
    if (feitas > 0) gravarRascunho({ ...atual, roteiros })
    return { feitas, nota: null, doCache: resposta.doCache }
  } catch (e) {
    return { feitas: 0, nota: e instanceof Error ? e.message.slice(0, 120) : String(e), doCache: false }
  }
}
