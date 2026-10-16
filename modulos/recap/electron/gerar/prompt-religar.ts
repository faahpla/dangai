import type { EpisodeIndex } from '../../shared/episodio'
import { type Evento, type Roteiro } from '../../shared/roteiro'
import { nomesDoElenco, type Elenco } from './nomes'
import { blocoDosEventos, tituloDoEpisodio } from './prompts'

/**
 * O PROMPT DO RELIGAR (modo Texto e "Usar meu roteiro" do passo 2).
 *
 * O roteiro ja esta escrito -- pelo Levi, nao pela IA. O modelo NAO escreve
 * nem reescreve nada: so diz, para cada frase marcada, de que acontecimentos
 * ela fala, o instante do episodio que a tela mostra, o que aparece na tela e,
 * raramente, um texto de tela. E o que o roteirista ja devolve junto com cada
 * frase que escreve (prompts.ts, FORMATO DE CADA FRASE); aqui vem em lote,
 * numa chamada so, para todas as frases novas.
 *
 * Mora fora do prompts.ts (que so recebe acrescimo) porque e um pedido de
 * outra natureza: anotar, nao escrever. Usa os mesmos blocos de eventos (com
 * quem esta em cena e as falas do trecho), para a ligacao sair com a mesma
 * fidelidade do roteiro da IA. Texto com acento: e conteudo para o modelo.
 */

export const SISTEMA_RELIGAR = `Você é o assistente de um editor de shorts de anime. O editor escreveu (ou mexeu) a NARRAÇÃO de um short sobre um episódio, e algumas frases ainda não estão ligadas aos ACONTECIMENTOS do episódio. Você liga essas frases — e só essas.

VOCÊ NÃO ESCREVE NADA: não reescreva, não corrija e não comente as frases. O texto é do editor e fica como está.

PARA CADA FRASE MARCADA COM >>>, devolva:
- fraseId: o id da frase, copiado da lista (ex.: "f20").
- eventoIds: os ids dos acontecimentos de onde vem a informação da frase (ex.: ["e07"]). O PRIMEIRO é o que a tela mostra enquanto a frase é dita. Use as frases vizinhas e os acontecimentos delas para entender de que momento a frase fala. Lista vazia só quando a frase não conta fato nenhum do episódio (pergunta ao espectador, frase de ligação). Nunca invente id.
- cueDoMomento: o id da fala ("c0123") do INSTANTE que a tela deve mostrar enquanto a frase é dita, escolhido entre as falas do primeiro acontecimento citado (ou dos outros citados). Frases seguidas sobre o mesmo acontecimento escolhem falas diferentes, na ordem. null em frase sem acontecimento.
- intencaoVisual: o que aparece na tela, a partir do acontecimento citado e do "em cena" dele — personagem que está em cena + ação ou expressão ("close no X assustado", "Y e Z discutindo"), ou objeto que as falas citam. UMA opção só (nada de "X ou Y"). Nada de logo, mapa, gráfico, diagrama, flashback, céu, planeta inteiro ou imagem genérica: a cena tem que existir no episódio. Em frase sem acontecimento, a imagem que melhor acompanha a frase dentro do episódio.
- textoDeTela: quase sempre null. Só numa frase de impacto muito alto, 1 ou 2 palavras DE CONTEÚDO queimadas na tela (artigo e preposição não contam), um rótulo, nunca a frase falada.

FIDELIDADE:
- Ligue a frase ao acontecimento que ela CONTA, não a um parecido. Na dúvida entre dois, cite os dois (o mais forte primeiro).
- Se a frase afirma algo que nenhum acontecimento sustenta, ligue ao mais próximo do que ela diz; o editor revisa.
- Acontecimento marcado "(sem cena no episódio)" não pode ser o único de uma frase.
- Escreva os nomes exatamente como no ELENCO, em português do Brasil, com acento.

SAÍDA: uma entrada por frase marcada, na ordem da narração. Nada sobre as frases sem >>>.`

export interface EntradaDoReligar {
  indice: Pick<EpisodeIndex, 'anime' | 'temporada' | 'episodio' | 'kind' | 'cues' | 'exclusoes' | 'planos'>
  eventos: readonly Evento[]
  elenco: Elenco
  roteiro: Pick<Roteiro, 'secoes'>
  /** Os ids das frases a ligar (frasesParaReligar). */
  alvo: readonly string[]
}

/**
 * O roteiro inteiro, frase por frase, com o id e os acontecimentos das ja
 * ligadas (contexto: a frase nova costuma falar do mesmo momento da vizinha);
 * as que faltam vem marcadas com >>>.
 */
export function blocoDoReligar(roteiro: Pick<Roteiro, 'secoes'>, alvo: readonly string[]): string {
  const marcar = new Set(alvo)
  const linhas: string[] = []
  for (const s of roteiro.secoes) {
    linhas.push(`[${s.id} · ${s.papel}]`)
    for (const f of s.frases) {
      const texto = f.texto.replace(/\s+/g, ' ').trim()
      if (marcar.has(f.id)) linhas.push(`>>> ${f.id}: ${texto}`)
      else linhas.push(`    ${f.id}: ${texto}${f.eventoIds.length > 0 ? ` (${f.eventoIds.join(', ')})` : ' (sem acontecimento)'}`)
    }
  }
  return linhas.join('\n')
}

export function promptDoReligar(e: EntradaDoReligar): string {
  const nomes = nomesDoElenco(e.elenco)
  return [
    `EPISÓDIO: ${tituloDoEpisodio(e.indice)}`,
    `ELENCO (grafia da legenda): ${nomes.length > 0 ? nomes.join(', ') : '(a legenda não traz nomes; use os que aparecem nas falas)'}`,
    '',
    'ACONTECIMENTOS (id [início-fim] peso | personagens: resumo; embaixo, quem está em cena e as falas do trecho):',
    blocoDosEventos(e.eventos, e.indice, e.elenco),
    '',
    `ROTEIRO DO EDITOR (${e.alvo.length} ${e.alvo.length === 1 ? 'frase marcada' : 'frases marcadas'} com >>> para ligar; entre parênteses, os acontecimentos das outras):`,
    blocoDoReligar(e.roteiro, e.alvo),
  ].join('\n')
}
