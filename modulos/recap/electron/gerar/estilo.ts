import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  aprenderExemplo,
  coerceEstilo,
  ESTILO_VAZIO,
  estiloNaTela,
  type EstiloDoRecap,
  type EstiloNaTela,
} from '../../shared/estilo'
import { mesmoTextoDoRoteiro, roteiroAtual, textoDoRoteiro, type RascunhoDoRecap, type Roteiro } from '../../shared/roteiro'
import { contexto } from '../contexto'
import { gravarJsonAtomico } from '../episodio/perfil'

/**
 * [recap] O "MEU ESTILO" no disco: <dados do modulo>/estilo.json (a pasta
 * `dados` do ctx, <userData>/modulos/recap). Leitura tolerante (arquivo
 * quebrado = sem estilo, e o log diz); escrita atomica.
 *
 * E o "APRENDER COM AS MINHAS EDICOES": no aprovar, se o roteiro aprovado
 * difere do que a IA escreveu (a versao 'ia' mais proxima na linha de
 * derivadoDe; a revisada conta como da IA), o texto dele vira exemplo
 * (aprenderExemplo: sem duplicata, so os N mais recentes). "Meu roteiro"
 * (colado, sem versao da IA na linha) tambem conta: o texto e todo dele.
 */

function arquivo(): string {
  return join(contexto().pasta('dados'), 'estilo.json')
}

export function lerEstilo(): EstiloDoRecap {
  let cru: unknown
  try {
    cru = JSON.parse(readFileSync(arquivo(), 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[gerar:estilo] nao abriu: ${String(err)}`)
    return ESTILO_VAZIO
  }
  return coerceEstilo(cru)
}

export function salvarEstilo(raw: unknown): EstiloNaTela {
  const estilo = coerceEstilo(raw)
  gravarJsonAtomico(arquivo(), estilo)
  return estiloNaTela(estilo)
}

export function lerEstiloNaTela(): EstiloNaTela {
  return estiloNaTela(lerEstilo())
}

/** A versao da IA de onde o roteiro saiu (ele mesmo, se for da IA). null = colado/sem IA na linha. */
export function versaoDaIa(r: Pick<RascunhoDoRecap, 'roteiros'>, roteiro: Roteiro): Roteiro | null {
  const vistas = new Set<number>()
  let atual: Roteiro | undefined = roteiro
  while (atual && !vistas.has(atual.versao)) {
    if (atual.origem === 'ia') return atual
    vistas.add(atual.versao)
    const de: number | null = atual.derivadoDe
    atual = de === null ? undefined : r.roteiros.find((x) => x.versao === de)
  }
  return null
}

/**
 * O roteiro sem o que veio do REVISOR frase a frase (o "Aplicar" de uma
 * marca): a frase que ainda tem o texto da sugestao volta ao texto que foi
 * revisado. E o que separa a edicao DELE da do revisor no "aprender" (A2):
 * so o que ele digitou conta. O "Aplicar todas", o "Corrigir erros" e o
 * "Melhorar texto" ja fazem versao da IA (versaoDaIa).
 */
export function semOAplicarDoRevisor(r: Pick<RascunhoDoRecap, 'revisoes'>, roteiro: Pick<Roteiro, 'secoes'>): Pick<Roteiro, 'secoes'> {
  const sugeridas = new Map<string, Map<string, string>>()
  for (const rv of r.revisoes) {
    for (const i of rv.itens) {
      if (!i.sugestao) continue
      const porTexto = sugeridas.get(i.fraseId) ?? new Map<string, string>()
      porTexto.set(i.sugestao, i.texto)
      sugeridas.set(i.fraseId, porTexto)
    }
  }
  return {
    secoes: roteiro.secoes.map((s) => ({
      ...s,
      frases: s.frases.map((f) => {
        const antes = sugeridas.get(f.id)?.get(f.texto)
        return antes === undefined ? f : { ...f, texto: antes }
      }),
    })),
  }
}

/**
 * Depois de aprovar: aprende, se for o caso. Nunca lanca (aprender e extra; a
 * aprovacao ja foi gravada). true = virou exemplo.
 */
export function aprenderDoAprovado(r: RascunhoDoRecap): boolean {
  try {
    const aprovado = roteiroAtual(r)
    if (!r.aprovado || !aprovado) return false
    const estilo = lerEstilo()
    if (!estilo.aprender) return false
    const texto = textoDoRoteiro(aprovado)
    const daIa = versaoDaIa(r, aprovado)
    // So o que ELE digitou conta: o "Aplicar" de uma sugestao do revisor nao e edicao dele.
    if (daIa && mesmoTextoDoRoteiro(textoDoRoteiro(daIa), textoDoRoteiro(semOAplicarDoRevisor(r, aprovado)))) return false
    const novo = aprenderExemplo(estilo, { texto, nome: r.titulo, rascunhoId: r.id, agoraIso: new Date().toISOString() })
    if (novo === estilo) return false
    gravarJsonAtomico(arquivo(), novo)
    return novo.exemplos.some((e) => e.rascunhoId === r.id)
  } catch (err) {
    console.warn(`[gerar:estilo] nao aprendeu: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}
