import type { EpisodeIndex, Plano } from './episodio'

/**
 * [recap] AS CENAS MESCLADAS PELO DANGAI, vistas pelo modulo.
 *
 * A Biblioteca do Dangai mescla cenas SEGUIDAS como o AnCut
 * (electron/services/mesclar.ts do nucleo): nasce `shots/AAAA-BBBB.mp4`, os
 * pedacos vao para `<episodio>/_lixeira/<carimbo>/shots/` e o
 * `dangai-mescla.json` fica la. O indice do recap foi feito antes e continua
 * apontando `shots/NNNN.mp4`, que saiu do lugar.
 *
 * O modulo SO LE: o plano cujo mp4 sumiu passa a apontar o mesclado que o
 * contem (AAAA <= NNNN <= BBBB, deduzido pelo nome, a mesma regra do
 * indexador e do mesclar), com `inicioNoArquivo` = onde ele comeca dentro do
 * mesclado. Os planos do indice sao contiguos (o fim de um e o comeco do
 * outro, como o corte os gravou), entao o ponto e a soma das duracoes dos
 * planos de antes dentro do mesmo mesclado. Nada e gravado: nem no indice nem
 * na pasta do episodio.
 *
 * Puro (o disco entra por `existe` e pela lista dos mesclados): o main
 * (electron/cenas/mesclas.ts) e o teste usam igual.
 */

/** "0010.mp4" -> [10, 10]; "0010-0012.mp4" -> [10, 12] (o faixaDoNome do mesclar do nucleo). */
export function faixaDoNome(nome: string): [number, number] | null {
  const m = /^(\d+)(?:-(\d+))?(?:\.mp4)?$/i.exec(nome)
  if (!m) return null
  const a = Number(m[1])
  const b = m[2] === undefined ? a : Number(m[2])
  return b >= a ? [a, b] : null
}

const nomeDe = (caminho: string): string => caminho.split(/[\\/]/).pop() ?? caminho
const pastaDe = (caminho: string): string => caminho.slice(0, caminho.length - nomeDe(caminho).length).replace(/[\\/]+$/, '').toLowerCase().replace(/\//g, '\\')

export interface PlanoNoMesclado {
  arquivo: string
  inicioNoArquivo: number
  /** O mesclado inteiro, em segundos (os planos do indice que ele cobre). */
  duracaoDoArquivo: number
}

/**
 * Para cada plano cujo mp4 nao existe mais, o mesclado que o contem e o ponto
 * dentro dele. `mesclados` = caminhos dos `AAAA-BBBB.mp4` que existem nas
 * pastas `shots` do indice. Plano que existe, ou sem mesclado que o cubra,
 * fica de fora (como estava).
 */
export function mesclasDosPlanos(
  planos: readonly Pick<Plano, 'id' | 'start' | 'end' | 'arquivo'>[],
  existe: (caminho: string) => boolean,
  mesclados: readonly string[],
): Record<string, PlanoNoMesclado> {
  const candidatos = mesclados
    .map((m) => ({ m, pasta: pastaDe(m), faixa: faixaDoNome(nomeDe(m)) }))
    .filter((x): x is { m: string; pasta: string; faixa: [number, number] } => x.faixa !== null && x.faixa[1] > x.faixa[0])
  const faixas = planos.map((p) => ({ p, faixa: faixaDoNome(nomeDe(p.arquivo)) ?? faixaDoNome(p.id) }))
  const saida: Record<string, PlanoNoMesclado> = {}
  for (const { p, faixa } of faixas) {
    if (!faixa || existe(p.arquivo)) continue
    const pasta = pastaDe(p.arquivo)
    // O menor mesclado que cobre o plano (um mesclado de mesclado cobre mais).
    const dono = candidatos
      .filter((c) => c.pasta === pasta && c.faixa[0] <= faixa[0] && faixa[1] <= c.faixa[1])
      .sort((a, b) => a.faixa[1] - a.faixa[0] - (b.faixa[1] - b.faixa[0]))[0]
    if (!dono) continue
    // Onde ele comeca dentro do mesclado: a distancia ate o 1o pedaco do
    // mesclado no indice (os planos sao contiguos); sem esse pedaco no
    // indice, a soma das duracoes dos de antes que estao la.
    const daPasta = faixas.filter((x) => x.faixa && pastaDe(x.p.arquivo) === pasta)
    const primeiro = daPasta.find((x) => x.faixa![0] === dono.faixa[0])
    const inicio = primeiro
      ? Math.max(p.start - primeiro.p.start, 0)
      : daPasta
          .filter((x) => x.faixa![0] >= dono.faixa[0] && x.faixa![1] < faixa[0])
          .reduce((soma, x) => soma + Math.max(x.p.end - x.p.start, 0), 0)
    const cobertos = daPasta.filter((x) => x.faixa![0] >= dono.faixa[0] && x.faixa![1] <= dono.faixa[1])
    const total = cobertos.length > 0 ? Math.max(...cobertos.map((x) => x.p.end)) - Math.min(...cobertos.map((x) => x.p.start)) : p.end - p.start
    saida[p.id] = {
      arquivo: dono.m,
      inicioNoArquivo: Math.round(inicio * 1000) / 1000,
      duracaoDoArquivo: Math.max(Math.round(total * 1000) / 1000, 0.001),
    }
  }
  return saida
}

/** O indice com os planos mesclados apontando o mesclado (copia; o original nao muda). */
export function aplicarMesclas<T extends Pick<EpisodeIndex, 'planos'>>(indice: T, mapa: Readonly<Record<string, PlanoNoMesclado>>): T {
  if (Object.keys(mapa).length === 0) return indice
  return { ...indice, planos: indice.planos.map((p) => (mapa[p.id] ? { ...p, ...mapa[p.id] } : p)) }
}
