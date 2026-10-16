import { dirname, resolve } from 'node:path'
import type { EpisodeIndex } from '../../shared/episodio'

/**
 * A pasta do episodio mudou de lugar com o episodio.json dentro (a biblioteca
 * do Studio foi movida): os caminhos absolutos do indice apontam para a pasta
 * velha. Estas funcoes trocam a raiz. Usadas pelo indexarEpisodio (que regrava
 * o indice corrigido) e pelo abrirIndicePorId (que corrige so em memoria).
 */

function normal(caminho: string): string {
  return resolve(caminho).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/**
 * Troca o comeco `de` por `para` num caminho, sem ligar para a barra nem para
 * a caixa (Windows). Caminho fora de `de` volta igual.
 */
export function trocarRaiz(caminho: string, de: string, para: string): string {
  const base = normal(de)
  const alvo = normal(caminho)
  if (alvo !== base && !alvo.startsWith(`${base}\\`)) return caminho
  const resto = resolve(caminho).replace(/\//g, '\\').slice(base.length)
  return `${resolve(para).replace(/\//g, '\\').replace(/\\+$/, '')}${resto}`
}

/**
 * O indice com a pasta do episodio trocada para `novaPasta`: biblioteca.pasta
 * e o mp4/keyframe de cada plano que estavam dentro da pasta velha. Nao mexe
 * em `fonte.path` (o .mkv mora em outro lugar).
 */
export function relocarIndice(indice: EpisodeIndex, novaPasta: string): EpisodeIndex {
  const velha = indice.biblioteca.pasta
  return {
    ...indice,
    biblioteca: { ...indice.biblioteca, pasta: novaPasta },
    planos: indice.planos.map((p) => ({
      ...p,
      arquivo: trocarRaiz(p.arquivo, velha, novaPasta),
      keyframe: p.keyframe === null ? null : trocarRaiz(p.keyframe, velha, novaPasta),
    })),
  }
}

/**
 * Um indice da biblioteca do Studio que esta dentro de uma pasta diferente da
 * que ele diz: a pasta inteira mudou de lugar e ele foi junto.
 */
export function indiceMovido(indice: EpisodeIndex, caminhoDoIndice: string): boolean {
  return indice.biblioteca.origem === 'studio' && normal(indice.biblioteca.pasta) !== normal(dirname(caminhoDoIndice))
}

