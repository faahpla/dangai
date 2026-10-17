import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EpisodeIndex } from '../../shared/episodio'
import { abrirIndicePorId } from '../episodio/abrir-indice'
import { aplicarMesclas, mesclasDosPlanos, type PlanoNoMesclado } from '../../shared/mesclas'

/**
 * [recap] As mesclas do Dangai no disco (shared/mesclas.ts): lista os
 * `AAAA-BBBB.mp4` das pastas `shots` do indice e resolve os planos que
 * sairam do lugar. SO LE: nada e gravado no episodio nem no indice.
 */

const MESCLADO = /^\d+-\d+\.mp4$/i

/** Os planos mesclados do indice: planoId -> o mesclado e o ponto dentro dele. */
export function mesclasDoIndice(indice: Pick<EpisodeIndex, 'planos'>): Record<string, PlanoNoMesclado> {
  // So se algum mp4 sumiu: o caso comum (nada mesclado) nao lista pasta nenhuma.
  const sumidos = indice.planos.filter((p) => !existsSync(p.arquivo))
  if (sumidos.length === 0) return {}
  const mesclados: string[] = []
  for (const pasta of new Set(sumidos.map((p) => dirname(p.arquivo)))) {
    try {
      for (const nome of readdirSync(pasta)) if (MESCLADO.test(nome)) mesclados.push(join(pasta, nome))
    } catch {
      /* pasta sumiu: o plano fica como esta (a tela ja diz "cena sem arquivo") */
    }
  }
  return mesclasDosPlanos(sumidos, existsSync, mesclados)
}

/** O indice com os planos mesclados apontando o mesclado (copia, so em memoria). */
export function comMesclas<T extends Pick<EpisodeIndex, 'planos'>>(indice: T): T {
  return aplicarMesclas(indice, mesclasDoIndice(indice))
}

/** O mapa do episodio, para a tela do passo 4 (que nao le o disco). */
export function mesclasDoEpisodio(episodioId: string): Record<string, PlanoNoMesclado> {
  return mesclasDoIndice(abrirIndicePorId(episodioId).indice)
}
