import type { ImageAsset, Scene, ScenePlan } from './contract'

/**
 * Remontar o video a partir da selecao SEM perder o que foi ajustado.
 *
 * "Tem como adicionar uma funcao de voltar pra selecao na biblioteca? Assim
 * consigo ajustar coisas que dao errado." A selecao ja sobrevivia a montagem,
 * mas montar de novo refazia o plano do zero e reimportava os clipes: camera,
 * efeito, curva, trecho do clipe e enquadramento de TODOS os blocos voltavam ao
 * padrao, para consertar uma cena so. Voltar a selecao so serve se voltar nao
 * custar o trabalho.
 *
 * A ligacao entre o bloco velho e o novo e EXATA, e nao um palpite por tempo:
 * cada clipe que ja estava no projeto e reaproveitado -- o mesmo ImageAsset,
 * com o mesmo id --, e o bloco novo herda do bloco velho que mostrava aquele
 * mesmo asset.
 */

/**
 * Quais imagens do projeto servem de novo, por caminho, na ordem.
 *
 * Reaproveitar e nao reimportar, por tres motivos: o enquadramento que ele
 * arrastou mora no asset e nao voltaria de uma importacao nova (ela procura o
 * rosto de novo); o cache do upscale e por id do asset e seria pago outra vez;
 * e importar dezenas de clipes leva tempo para chegar no mesmo lugar.
 *
 * A mesma cena duas vezes na selecao casa com as duas copias que ja existiam,
 * na ordem -- e so a terceira, se houver, e importada de novo.
 */
export function reaproveitar(
  caminhos: readonly string[],
  velhas: readonly ImageAsset[],
): (ImageAsset | null)[] {
  const livres = new Map<string, ImageAsset[]>()
  for (const img of velhas) {
    const lista = livres.get(img.path) ?? []
    lista.push(img)
    livres.set(img.path, lista)
  }
  return caminhos.map((caminho) => livres.get(caminho)?.shift() ?? null)
}

/**
 * Quantos blocos da timeline de hoje NAO voltam na remontagem.
 *
 * Sao os que a selecao nao conhece: imagem inserida direto na timeline, bloco
 * montado de outro jeito. Remontar os tira sem perguntar, e por isso a
 * Biblioteca avisa antes, com o numero.
 */
export function blocosQueSaem(
  caminhos: readonly string[],
  velhas: readonly ImageAsset[],
  plano: ScenePlan | null,
): number {
  if (!plano) return 0
  const voltam = new Set(
    reaproveitar(caminhos, velhas)
      .filter((img): img is ImageAsset => img !== null)
      .map((img) => img.id),
  )
  return plano.scenes.filter((cena) => {
    const id = velhas[cena.imageIndex]?.id
    return id !== undefined && !voltam.has(id)
  }).length
}

/**
 * Cada bloco novo herda os ajustes do bloco velho que mostrava o MESMO clipe.
 *
 * Herda TUDO que e do bloco -- efeito, intensidade, curva, camera, trecho do
 * clipe, giro, transicao -- e fica com o que e da SELECAO: o inicio e o fim
 * (que saem das frases e das fronteiras que ele marcou) e quais imagens ele
 * mostra. Herdar pelo objeto inteiro, e nao campo a campo, faz qualquer ajuste
 * que o app ganhar no futuro vir junto sem ninguem lembrar de acrescentar.
 *
 * A METADE DE BAIXO so herda se ela tambem for a mesma. Juntar ou separar uma
 * tela dividida na selecao muda quem esta embaixo, e o efeito e o trecho do
 * clipe de baixo eram de outra cena.
 */
export function herdarAjustes(
  novo: ScenePlan,
  imagens: readonly ImageAsset[],
  velho: ScenePlan | null,
  velhas: readonly ImageAsset[],
): { plan: ScenePlan; herdados: number } {
  if (!velho) return { plan: novo, herdados: 0 }

  const porId = new Map<string, Scene>()
  for (const cena of velho.scenes) {
    const id = velhas[cena.imageIndex]?.id
    if (id !== undefined && !porId.has(id)) porId.set(id, cena)
  }

  let herdados = 0
  const scenes = novo.scenes.map((cena) => {
    const antiga = porId.get(imagens[cena.imageIndex]?.id ?? '')
    if (!antiga) return cena
    herdados += 1

    const baixoNovo = cena.imageIndexB == null ? null : (imagens[cena.imageIndexB]?.id ?? null)
    const baixoVelho = antiga.imageIndexB == null ? null : (velhas[antiga.imageIndexB]?.id ?? null)
    const mesmaDeBaixo = baixoNovo === baixoVelho

    return {
      ...antiga,
      start: cena.start,
      end: cena.end,
      imageIndex: cena.imageIndex,
      imageIndexB: cena.imageIndexB,
      ...(mesmaDeBaixo
        ? {}
        : { effectB: cena.effectB, intensityB: cena.intensityB, sourceStartB: cena.sourceStartB }),
    }
  })

  return { plan: { ...novo, scenes }, herdados }
}
