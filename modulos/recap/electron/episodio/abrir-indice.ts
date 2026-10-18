import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { lerIndice, temPlanos, type EpisodeIndex } from '../../shared/episodio'
import { acharIndice } from './indice'
import { indiceMovido, relocarIndice } from './relocar'

/**
 * O indice do episodio pelo ID, para quem vem depois do passo 1 (o rascunho do
 * recap, as miniaturas do roteiro) e nao passou pela busca.
 *
 * Existe porque o indice guarda caminhos ABSOLUTOS (a pasta do episodio, o mp4
 * e o keyframe de cada cena), e a biblioteca do Studio pode mudar de lugar: em
 * 13/10/2026 ela saiu do OneDrive para G:/AniRecap Studio/Biblioteca, e o
 * episodio.json do S04E24 foi junto com os caminhos da pasta velha. Achar pelo
 * id e corrigir os caminhos aqui deixa todo leitor ver a pasta de verdade.
 *
 * So le: a correcao fica em memoria. Quem grava o indice corrigido e o passo 1
 * (indexarEpisodio reaproveita o indice movido e regrava com os caminhos novos).
 */

export interface IndiceAberto {
  indice: EpisodeIndex
  /** Onde o episodio.json esta de fato. */
  caminho: string
  /** Os caminhos foram corrigidos em memoria (a pasta mudou de lugar). */
  movido: boolean
}

/**
 * Le o indice `id`. `dica` = um caminho conhecido (o `indicePath` do rascunho);
 * se ele nao existe mais ou e de outro episodio, procura como o salvarExclusoes
 * (lembrado no perfil, _indices, varredura curta da biblioteca do Studio).
 */
export function abrirIndicePorId(id: string, dica?: string | null): IndiceAberto {
  let caminho: string | null = null
  if (dica && existsSync(dica)) {
    try {
      if ((JSON.parse(readFileSync(dica, 'utf8')) as { id?: unknown }).id === id) caminho = dica
    } catch {
      caminho = null
    }
  }
  caminho ??= acharIndice(id)
  if (!caminho) throw new Error('Nao achei os dados desse episodio. Abra o episodio de novo no passo 1.')

  let indice: EpisodeIndex
  try {
    indice = lerIndice(JSON.parse(readFileSync(caminho, 'utf8')))
  } catch {
    throw new Error('Os dados desse episodio nao abrem (episodio.json quebrado). Abra o episodio de novo no passo 1.')
  }
  if (indiceMovido(indice, caminho)) {
    return { indice: relocarIndice(indice, dirname(caminho)), caminho, movido: true }
  }
  // O episodio que o recap moveu para o AnCut (L1) e o AnCut apagou depois: e
  // o mesmo caso do indice que sumiu -- precisa ser cortado de novo (o roteiro
  // e a voz continuam no rascunho).
  if (indice.biblioteca.movidoDoRecap && temPlanos(indice) && !existsSync(join(indice.biblioteca.pasta, 'metadata', 'shots.json'))) {
    throw new Error('Nao achei os dados desse episodio. Abra o episodio de novo no passo 1.')
  }
  return { indice, caminho, movido: false }
}
