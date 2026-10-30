import { preferenciasDoBroll, type ItemDoBroll, type PreferenciaDoBroll } from './broll'
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

/**
 * Quantas o "ver mais" traz. Doze e o que cabe numa faixa sem virar grade; quando
 * nenhuma das doze serve, o proximo passo e olhar bem mais -- e ainda na ordem
 * do que o trecho pede, e nao na ordem do disco como a grade de baixo.
 */
export const MAIS_SUGESTOES = 60

export interface ContextoDeSugestao {
  blocks: readonly ScriptBlock[]
  clips: readonly LibraryClip[]
  characters: readonly string[]
  nicknames: readonly Nickname[]
  descriptions: Record<string, SceneDescription>
  /** Os itens do B-roll do projeto, quando ele soltou um (ver shared/broll.ts). */
  broll?: readonly ItemDoBroll[]
  /**
   * O quanto cada cena lida parece com cada trecho, na ordem dos trechos
   * (electron/services/visao.ts). Ausente sem cenas lidas ou sem o comparador.
   */
  visao?: readonly (Readonly<Record<string, number>> | null)[]
}

/**
 * O que o B-roll pede para cada trecho. Casado por FRASE: a virgula corta o
 * trecho, e "em vez de encontrar as memorias dele," sozinho nao diz de que
 * parte do B-roll ele e.
 */
export function brollDosTrechos(ctx: ContextoDeSugestao): (PreferenciaDoBroll | null)[] {
  if (!ctx.broll || ctx.broll.length === 0) return ctx.blocks.map(() => null)
  return preferenciasDoBroll(
    ctx.blocks.map((b) => b.text),
    ctx.broll,
    buildScriptIndex(ctx.characters, ctx.nicknames),
    ctx.blocks.map((b) => b.sentence),
  )
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
 * O anime em que a Biblioteca deve ABRIR para este roteiro, ou null.
 *
 * Nome de personagem colide entre series: o roteiro da Kiwi cita Kiwi,
 * Rebecca, David e Lucy -- e existe uma Lucy em Mushoku Tensei. Pela lista de
 * `seriesDoRoteiro` eram duas series, e a Biblioteca abria em "Todos", com 52
 * mil cenas. Vale a serie com MAIS personagens citados (Cyberpunk, 4 a 1). No
 * empate, desempata o nome do anime escrito no roteiro ("...EM CYBERPUNK?");
 * sem nenhum personagem citado, o nome sozinho decide. Ainda empatado: null.
 */
export function serieDoRoteiro(ctx: ContextoDeSugestao): string | null {
  if (ctx.blocks.length === 0) return null
  const index = buildScriptIndex(ctx.characters, ctx.nicknames)
  const linhas = readScript(
    ctx.blocks.map((b) => b.text),
    index,
  )
  const citados = new Set(linhas.flatMap((l) => l.matches.map((m) => m.character)))

  const porSerie = new Map<string, Set<string>>()
  for (const clip of ctx.clips) {
    for (const c of clip.characters) {
      if (!citados.has(c)) continue
      const tem = porSerie.get(clip.anime) ?? new Set<string>()
      tem.add(c)
      porSerie.set(clip.anime, tem)
    }
  }

  // O anime escrito no texto: alguma palavra longa do nome dele ("Cyberpunk",
  // "Apothecary", "Mushoku"), sem caixa e sem acento.
  const plano = (t: string): string => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const texto = plano(ctx.blocks.map((b) => b.text).join(' '))
  const escrito = (serie: string): boolean =>
    plano(serie)
      .split(/[^a-z0-9]+/)
      .some((p) => p.length >= 5 && new RegExp(`\\b${p}\\b`).test(texto))

  const ranking = [...porSerie].map(([serie, quem]) => ({ serie, quantos: quem.size })).sort((a, b) => b.quantos - a.quantos)
  const topo = ranking.filter((r) => r.quantos === (ranking[0]?.quantos ?? 0))
  if (topo.length === 1) return topo[0]!.serie
  const candidatas = topo.length > 1 ? topo.map((r) => r.serie) : [...new Set(ctx.clips.map((c) => c.anime))]
  const comNome = candidatas.filter(escrito)
  return comNome.length === 1 ? comNome[0]! : null
}

/**
 * Quem o trecho cita, na ordem de confianca do leitor.
 *
 * E a mesma leitura que alimenta as sugestoes -- no contexto do roteiro
 * inteiro, para "ele" e "ela" arrastarem o nome citado antes. Existe para o
 * botao de "ver todas" saber em QUAL pasta abrir: a faixa mostra doze cenas,
 * e quando nenhuma serve o proximo lugar para procurar e o personagem inteiro.
 */
export function personagensDoBloco(ctx: ContextoDeSugestao, bloco: number): string[] {
  if (!ctx.blocks[bloco] || ctx.characters.length === 0) return []
  const index = buildScriptIndex(ctx.characters, ctx.nicknames)
  const linhas = readScript(
    ctx.blocks.map((b) => b.text),
    index,
  )
  return [...new Set(linhas[bloco]?.matches.map((m) => m.character) ?? [])]
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
  /** Quantas trazer. A faixa mostra SUGESTOES; "ver mais" pede MAIS_SUGESTOES. */
  quantas: number = SUGESTOES,
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

  /*
   * Cena ja usada continua aparecendo -- e so desce na lista.
   *
   * Antes ela sumia da faixa, para nao convidar a repetir. Estava errado:
   * repetir e escolha dele ("em alguns momentos e cabivel eu colocar a mesma
   * cena novamente"), e esconder tirava do alcance justamente a cena que ele
   * queria de volta. O cartao ja mostra "ja usada"; avisar basta.
   */
  const saida = selectClips(
    [{ ...linha, text: alvo.text, start: alvo.start, end: alvo.end }],
    ctx.clips,
    {
      /*
       * Modo teoria mesmo no recap: cronologia so faz sentido quando o app
       * monta a fita inteira em ordem. Aqui ele pula de trecho como quiser, e
       * cobrar "a cena tem que vir depois da anterior" esconderia material bom
       * so porque ele voltou para arrumar o trecho 12.
       */
      mode: 'theory',
      fita: quantas,
      descriptions: ctx.descriptions,
      // A serie sai do roteiro inteiro, nao deste trecho: trecho sem nome
      // nenhum liberaria o acervo todo e traria Bleach num video de Re:Zero.
      series: seriesDoRoteiro(ctx),
      broll: [brollDosTrechos(ctx)[bloco] ?? null],
      visao: [ctx.visao?.[bloco] ?? null],
    },
  )
  const candidatos = saida[0]?.candidates ?? []
  // Estavel: as nao usadas primeiro, mantendo a ordem de nota dentro de cada
  // grupo. Assim repetir continua a um clique, sem roubar a frente.
  return [
    ...candidatos.filter((c) => !jaUsadas.has(c.clip.id)),
    ...candidatos.filter((c) => jaUsadas.has(c.clip.id)),
  ]
}
