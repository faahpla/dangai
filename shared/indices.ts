import type { Scene, ScenePlan } from './contract'

/**
 * A aritmetica de indices entre o plano e a lista de imagens.
 *
 * Cada cena aponta para a lista de imagens por POSICAO, e tela dividida aponta
 * DUAS vezes: `imageIndex` (cima) e `imageIndexB` (baixo). Inserir ou tirar uma
 * imagem da lista anda todo indice dali para frente -- os dois. Ate a v1.43 o
 * store andava so o de cima, em tres lugares diferentes, e a metade de baixo
 * de toda tela dividida depois do ponto mexido ficava apontando para a imagem
 * do VIZINHO.
 *
 * Reportado pelo ajk: "quando ele troca essa cena na tela dividida, ele altera
 * a do bloco seguinte pela mesma cena". Trocar a cena substitui a imagem no
 * indice -- e as duas cenas estavam no mesmo indice. A conta mora aqui, uma
 * vez so, com teste, para nao divergir de novo.
 */

/** Anda os DOIS indices de toda cena: `n` casas a partir de `at`. */
export function abrirEspaco(cena: Scene, at: number, n: number): Scene {
  const anda = (i: number): number => (i >= at ? i + n : i)
  return {
    ...cena,
    imageIndex: anda(cena.imageIndex),
    imageIndexB: cena.imageIndexB === null ? null : anda(cena.imageIndexB),
  }
}

/**
 * Tira a cena `index` do plano, junto com a(s) imagem(ns) dela.
 *
 * Tela dividida leva as DUAS imagens: deixar a de baixo na lista a faria
 * sobrar orfa, e a tira mostraria uma cena que nao esta em bloco nenhum. O
 * tempo vai para o vizinho de tras (ou o da frente, se era a primeira), senao
 * sobraria um buraco preto no meio do video.
 *
 * Imagem que outra cena TAMBEM usa fica: tira-la quebraria a outra.
 */
export function removerCena<T>(
  plan: ScenePlan,
  images: readonly T[],
  index: number,
): { plan: ScenePlan; images: T[] } | null {
  const cena = plan.scenes[index]
  if (!cena || plan.scenes.length < 2) return null

  const outras = plan.scenes.filter((_, i) => i !== index)
  const usadas = new Set(outras.flatMap((c) => (c.imageIndexB === null ? [c.imageIndex] : [c.imageIndex, c.imageIndexB])))
  const saem = new Set(
    [cena.imageIndex, cena.imageIndexB].filter((i): i is number => i !== null && !usadas.has(i)),
  )

  /** Quantas imagens que saem estavam antes de `i`: e quanto ele desce. */
  const desce = (i: number): number => i - [...saem].filter((s) => s < i).length

  const scenes = outras.map((c) => ({
    ...c,
    imageIndex: desce(c.imageIndex),
    imageIndexB: c.imageIndexB === null ? null : desce(c.imageIndexB),
  }))

  const anterior = scenes[index - 1]
  const seguinte = scenes[index]
  if (anterior) scenes[index - 1] = { ...anterior, end: cena.end }
  else if (seguinte) scenes[index] = { ...seguinte, start: cena.start }

  return {
    plan: { ...plan, scenes },
    images: images.filter((_, i) => !saem.has(i)),
  }
}

/**
 * Conserta o projeto que ja SALVOU o desalinhamento.
 *
 * Quem removeu ou inseriu um bloco antes de uma tela dividida, numa versao
 * anterior, tem no arquivo uma metade de baixo apontando para a imagem de outro
 * bloco -- e a imagem certa dela continua na lista, sem ninguem usando.
 *
 * O conserto so age quando os dois sinais aparecem juntos: a metade de baixo
 * DIVIDE a imagem com outra cena, e a imagem logo depois da de cima esta orfa.
 * E a montagem que poe as duas metades lado a lado na lista, entao a orfa
 * vizinha e exatamente a que se perdeu. Fora disso nao ha como saber qual era
 * a certa, e nada e mexido.
 */
export function repararMetadesDeBaixo(plan: ScenePlan, total: number): { plan: ScenePlan; reparadas: number } {
  const usos = new Map<number, number>()
  const contar = (i: number | null): void => {
    if (i !== null) usos.set(i, (usos.get(i) ?? 0) + 1)
  }
  for (const c of plan.scenes) {
    contar(c.imageIndex)
    contar(c.imageIndexB)
  }

  let reparadas = 0
  const scenes = plan.scenes.map((c) => {
    if (c.imageIndexB === null) return c
    const compartilhada = (usos.get(c.imageIndexB) ?? 0) > 1 || c.imageIndexB >= total
    const vizinha = c.imageIndex + 1
    if (!compartilhada || vizinha >= total || usos.has(vizinha)) return c
    usos.set(c.imageIndexB, (usos.get(c.imageIndexB) ?? 1) - 1)
    usos.set(vizinha, 1)
    reparadas += 1
    return { ...c, imageIndexB: vizinha }
  })

  return { plan: reparadas > 0 ? { ...plan, scenes } : plan, reparadas }
}
