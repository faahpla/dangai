import type { LibraryClip, Nickname, ScriptBlock, SceneDescription } from './channels'
import { buildScriptIndex, readScript } from './script-reader'
import { selectClips, type SelectionCandidate } from './selection'

/**
 * Sugerir cenas para o TRECHO que ele esta marcando.
 *
 * Mesmo motor da montagem automatica, usado como assistente e nao como
 * decisor. A diferenca importa: no automatico o app escolhe e ele corrige; aqui
 * ele escolhe e o app so poe as mais provaveis na frente. O acervo tem 20 mil
 * cenas e o roteiro tem ~39 trechos -- o custo do modo manual e varrer o
 * palheiro 39 vezes, e e esse custo que isto corta.
 *
 * Nada aqui filtra a grade: as sugestoes aparecem ANTES dela, e a biblioteca
 * inteira continua a um rolar de distancia.
 */

/** Quantas sugestoes cabem numa faixa sem virar uma segunda grade. */
export const SUGESTOES = 12

export interface ContextoDeSugestao {
  blocks: readonly ScriptBlock[]
  clips: readonly LibraryClip[]
  characters: readonly string[]
  nicknames: readonly Nickname[]
  descriptions: Record<string, SceneDescription>
}

/**
 * As series que o roteiro parece citar.
 *
 * Serve para abrir a Biblioteca ja no anime certo. E so um ponto de partida:
 * a trilha de episodios continua inteira, e trocar de anime ou entrar num
 * episodio especifico funciona igual. Roteiro que nao cita ninguem -- ou que
 * cita gente de duas series -- nao pre-seleciona nada, porque escolher errado
 * por ele seria pior que nao escolher.
 */
export function seriesDoRoteiro(ctx: ContextoDeSugestao): string[] {
  if (ctx.characters.length === 0 || ctx.blocks.length === 0) return []
  const index = buildScriptIndex(ctx.characters, ctx.nicknames)
  const linhas = readScript(
    ctx.blocks.map((b) => b.text),
    index,
  )
  const citados = new Set(linhas.flatMap((l) => l.matches.map((m) => m.character)))
  if (citados.size === 0) return []

  const series = new Set<string>()
  for (const clip of ctx.clips) {
    if (clip.characters.some((c) => citados.has(c))) series.add(clip.anime)
  }
  return [...series]
}

/**
 * As cenas mais provaveis para UM trecho.
 *
 * O trecho e lido no contexto do roteiro inteiro, e nao sozinho: o arrasto de
 * pronome ("ele", "ela") so faz sentido sabendo quem foi citado antes, e trecho
 * curto -- "em vez de encontrar as memorias dele," -- quase nunca traz nome.
 *
 * `jaUsadas` sai da frente: cena marcada em outro trecho reaparecendo no topo
 * seria um convite a repetir imagem no mesmo video.
 */
export function sugerirParaBloco(
  ctx: ContextoDeSugestao,
  bloco: number,
  jaUsadas: ReadonlySet<string>,
): SelectionCandidate[] {
  const alvo = ctx.blocks[bloco]
  if (!alvo || ctx.clips.length === 0) return []

  const index = buildScriptIndex(ctx.characters, ctx.nicknames)
  const linhas = readScript(
    ctx.blocks.map((b) => b.text),
    index,
  )
  const linha = linhas[bloco]
  if (!linha) return []

  const disponiveis = ctx.clips.filter((c) => !jaUsadas.has(c.id))
  const saida = selectClips(
    [{ ...linha, text: alvo.text, start: alvo.start, end: alvo.end }],
    disponiveis,
    {
      /*
       * Modo teoria mesmo no recap: cronologia so faz sentido quando o app
       * monta a fita inteira em ordem. Aqui ele pula de trecho como quiser, e
       * cobrar "a cena tem que vir depois da anterior" esconderia material bom
       * so porque ele voltou para arrumar o trecho 12.
       */
      mode: 'theory',
      fita: SUGESTOES,
      descriptions: ctx.descriptions,
      // A serie sai do roteiro inteiro, nao deste trecho: trecho sem nome
      // nenhum liberaria o acervo todo e traria Bleach num video de Re:Zero.
      series: seriesDoRoteiro(ctx),
    },
  )
  return saida[0]?.candidates ?? []
}
