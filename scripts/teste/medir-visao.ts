/**
 * Mede a LEITURA DAS CENAS (passo 3 do B-roll) contra um video que ele ja fez:
 * em que posicao a cena que ele marcou fica na faixa de sugestoes, sem e com o
 * que a IA viu nas cenas -- e, dentro do episodio dele, so pela imagem.
 *
 * Le o projeto, o B-roll e a biblioteca do perfil, e le as cenas pelo mesmo
 * leitor do app (electron/services/describe.ts). Escreve SO na pasta de cache
 * que recebe: as cenas lidas e os vetores, para a segunda passada nao reler.
 *
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/medir-visao.ts <projeto.dangai> <b-roll.txt> <pasta de cache> [episodios: 50,49]`
 *
 * PESO=0.5,1,2 mede a faixa com o peso da imagem escalado. SO_MEDIR=1 nao le
 * cena nenhuma, so mede com o que ja esta no cache.
 *
 * Medido em 10/2026, episodio 50 do Bleach (403 cenas, ~3,4s cada):
 *   "Tudo que aconteceu Depois da Guerra" (26 trechos) e "O final de Bleach"
 *   (6): a cena dele ou uma do mesmo momento (ate 20s) nas 12 primeiras foi de
 *   25% para 47%; nas 3 primeiras, de 15% para 27% no primeiro video.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { lerBroll, resolverTemporadas } from '../../shared/broll.ts'
import type { LibraryClip, Nickname, SceneDescription, ScriptBlock } from '../../shared/channels.ts'
import { buildScriptIndex } from '../../shared/script-reader.ts'
import { sugerirParaBloco, type ContextoDeSugestao } from '../../shared/suggest.ts'
import { consultasDosTrechos, cosseno, notasDeDestaque, textoDaCena } from '../../shared/visao.ts'
import { lerCena } from '../../electron/services/describe.ts'
import { COMPARADOR, INSTRUCAO } from '../../electron/services/visao.ts'

const OLLAMA = 'http://127.0.0.1:11434'

const [projeto, broll, pasta, filtro] = process.argv.slice(2)
if (!projeto || !broll || !pasta) {
  console.log('uso: medir-visao.ts <projeto.dangai> <b-roll.txt> <pasta de cache> [episodios]')
  process.exit(1)
}
mkdirSync(pasta, { recursive: true })
const perfil = join(process.env.APPDATA ?? '', 'Dangai')

const cache = JSON.parse(readFileSync(join(perfil, 'library-cache.json'), 'utf8')) as {
  episodes: Record<string, { clips: LibraryClip[] }>
}
const clips = Object.values(cache.episodes).flatMap((e) => e.clips)
const characters = [...new Set(clips.flatMap((c) => c.characters))]
const apelidos = JSON.parse(readFileSync(join(perfil, 'apelidos.json'), 'utf8')) as Record<string, Nickname[]>
const arquivo = JSON.parse(readFileSync(projeto, 'utf8')) as {
  biblioteca: { blocos: ScriptBlock[] | null; porBloco: Record<string, string[]> }
}
const blocos = arquivo.biblioteca.blocos ?? []
const index = buildScriptIndex(characters, Object.values(apelidos).flat())
const itens = resolverTemporadas(lerBroll(readFileSync(broll, 'utf8')), clips, [], index)
const porCaminho = new Map(clips.map((c) => [c.path.toLowerCase(), c]))
const ctx: ContextoDeSugestao = {
  blocks: blocos,
  clips,
  characters,
  nicknames: Object.values(apelidos).flat(),
  descriptions: {},
  broll: itens,
}

const episodio = (c: LibraryClip): string => `${c.anime}|${c.season}|${c.episode}`
const querEpisodio = filtro ? new Set(filtro.split(',').map(Number)) : null

/** Os trechos marcados, cada um com o episodio da cena dele. */
const casos = blocos
  .map((bloco, i) => {
    const escolhidas = (arquivo.biblioteca.porBloco[i] ?? [])
      .map((p) => porCaminho.get(p.toLowerCase()))
      .filter((c): c is LibraryClip => c !== undefined)
    return { i, bloco, escolhidas }
  })
  .filter((c) => c.escolhidas.length > 0)
  .filter((c) => !querEpisodio || querEpisodio.has(c.escolhidas[0]!.episode))

const episodios = new Set(casos.map((c) => episodio(c.escolhidas[0]!)))
const alvo = clips.filter((c) => episodios.has(episodio(c)))
console.log(`${casos.length} trechos marcados em ${episodios.size} episodios: ${alvo.length} cenas\n`)

async function vetorizar(textos: string[]): Promise<number[][]> {
  const saida: number[][] = []
  for (let k = 0; k < textos.length; k += 64) {
    const r = await fetch(`${OLLAMA}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: COMPARADOR, input: textos.slice(k, k + 64) }),
    })
    if (!r.ok) throw new Error(`embed ${r.status}: ${await r.text()}`)
    saida.push(...((await r.json()) as { embeddings: number[][] }).embeddings)
  }
  return saida
}

async function main(): Promise<void> {
  // ---- leitura, pelo leitor do app ----------------------------------------
  const arqCenas = join(pasta, 'legendas.json')
  const lidas: Record<string, SceneDescription> = existsSync(arqCenas) ? JSON.parse(readFileSync(arqCenas, 'utf8')) : {}
  const faltam = alvo.filter((c) => !lidas[c.id] && c.keyframe && existsSync(c.keyframe))
  if (faltam.length > 0 && process.env.SO_MEDIR !== '1') {
    const t0 = Date.now()
    for (const [k, clip] of faltam.entries()) {
      lidas[clip.id] = (await lerCena(clip.keyframe)) ?? { cena: '', emocao: '', acao: '', cenario: '', plano: '' }
      if ((k + 1) % 20 === 0 || k === faltam.length - 1) {
        writeFileSync(arqCenas, JSON.stringify(lidas), 'utf8')
        const porCena = (Date.now() - t0) / (k + 1)
        console.log(`  ${k + 1}/${faltam.length}  ${(porCena / 1000).toFixed(2)}s por cena  | ${lidas[clip.id]!.cena}`)
      }
    }
  }
  // Como o app guarda (describe.ts/limpar): minusculas, "meio" vira "medio".
  const descricoes: Record<string, SceneDescription> = {}
  for (const [id, l] of Object.entries(lidas)) {
    if (!l.cena) continue
    const m = (t: string): string => t.toLowerCase().trim()
    descricoes[id] = { cena: m(l.cena), emocao: m(l.emocao), acao: m(l.acao), cenario: m(l.cenario), plano: m(l.plano) === 'meio' ? 'medio' : m(l.plano) }
  }

  // ---- vetores, pelo comparador do app ------------------------------------
  const arqVetores = join(pasta, `vetores-${COMPARADOR.replace(/[^a-z0-9.]+/gi, '_')}.json`)
  const vetores: Record<string, number[]> = existsSync(arqVetores) ? JSON.parse(readFileSync(arqVetores, 'utf8')) : {}
  const semVetor = Object.keys(descricoes).filter((id) => !vetores[id])
  if (semVetor.length > 0) {
    const v = await vetorizar(semVetor.map((id) => textoDaCena(descricoes[id]!)))
    semVetor.forEach((id, k) => (vetores[id] = v[k]!))
    writeFileSync(arqVetores, JSON.stringify(vetores), 'utf8')
  }
  const comVetor = Object.keys(descricoes).filter((id) => vetores[id])
  const qs = await vetorizar(consultasDosTrechos(blocos).map((t) => INSTRUCAO + t))
  const semelhancas = qs.map((q) => new Map(comVetor.map((id) => [id, cosseno(q, vetores[id]!)])))
  const visao = semelhancas.map(notasDeDestaque)

  // ---- medicao ------------------------------------------------------------
  /** Perto = mesma cena do episodio: ate 20s da que ele escolheu. */
  const perto = (a: LibraryClip, b: LibraryClip): boolean => episodio(a) === episodio(b) && Math.abs(a.start - b.start) <= 20
  const placar: Record<string, { exata: number[]; perto: number[] }> = {}
  const anotar = (nome: string, ordem: LibraryClip[], escolhidas: LibraryClip[]): string => {
    const p = (placar[nome] ??= { exata: [], perto: [] })
    const ids = new Set(escolhidas.map((e) => e.id))
    const exata = ordem.findIndex((c) => ids.has(c.id)) + 1
    const quase = ordem.findIndex((c) => escolhidas.some((e) => perto(c, e))) + 1
    p.exata.push(exata)
    p.perto.push(quase)
    return `${String(exata || '--').padStart(4)}/${String(quase || '--').padStart(3)}`
  }

  const contextos: Record<string, ContextoDeSugestao> = { 'faixa hoje': ctx }
  for (const k of (process.env.PESO ?? '1').split(',').map(Number)) {
    const escalada = visao.map((v) => Object.fromEntries(Object.entries(v).map(([id, z]) => [id, z * k])))
    contextos[`+imagem x${k}`] = { ...ctx, descriptions: descricoes, visao: escalada }
  }

  for (const caso of casos) {
    const ep = episodio(caso.escolhidas[0]!)
    const linha: string[] = []
    // Dentro do episodio dele: a ordem de hoje e a ordem so pela imagem.
    const hoje = sugerirParaBloco(ctx, caso.i, new Set(), 100000)
      .map((s) => s.clip)
      .filter((c) => episodio(c) === ep)
    linha.push(`ep hoje ${anotar('ep hoje', hoje, caso.escolhidas)}`)
    const pelaImagem = alvo
      .filter((c) => episodio(c) === ep && semelhancas[caso.i]!.has(c.id))
      .sort((a, b) => semelhancas[caso.i]!.get(b.id)! - semelhancas[caso.i]!.get(a.id)!)
    linha.push(`ep imagem ${anotar('ep imagem', pelaImagem, caso.escolhidas)}`)
    // A faixa de sugestoes de verdade (o acervo inteiro).
    for (const [nome, c] of Object.entries(contextos)) {
      linha.push(`${nome} ${anotar(nome, sugerirParaBloco(c, caso.i, new Set(), 60).map((s) => s.clip), caso.escolhidas)}`)
    }
    const dele = descricoes[caso.escolhidas[0]!.id]?.cena ?? '?'
    console.log(`${String(caso.i).padStart(3)} E${caso.escolhidas[0]!.episode}  ${linha.join('  ')}  ${caso.bloco.text.slice(0, 50)}\n      dele: ${dele}`)
  }

  const taxa = (v: number[], ate: number): string => `${Math.round((100 * v.filter((n) => n > 0 && n <= ate).length) / v.length)}%`.padStart(4)
  console.log(`\n${casos.length} trechos -- exata / mesma cena (ate 20s)`)
  for (const [nome, p] of Object.entries(placar)) {
    console.log(
      `  ${nome.padEnd(12)} top1 ${taxa(p.exata, 1)} ${taxa(p.perto, 1)}   top3 ${taxa(p.exata, 3)} ${taxa(p.perto, 3)}   top12 ${taxa(p.exata, 12)} ${taxa(p.perto, 12)}   top60 ${taxa(p.exata, 60)} ${taxa(p.perto, 60)}`,
    )
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
