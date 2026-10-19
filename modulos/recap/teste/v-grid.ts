/**
 * [recap] O GRID (rodada 4, shared/grid.ts e a montagem), puro, com um
 * episodio sintetico e takes montados a mao:
 *
 *   A. as pecas: o limite por minuto, os blocos da legenda, onde o grid entra
 *      (virgula, conectivo, o 2o sujeito), a metade de um candidato e o
 *      encaixe dela;
 *   B. o gatilho: nota perto e cenas diferentes; nao entra com nota longe,
 *      metade que congela, veto, a mesma cena, nota fraca, bloco curto;
 *   C. os limites: nunca na 1a nem na ultima frase, nem no climax; 3 por
 *      minuto, nunca seguidas, 5 s de tela cheia entre elas; frase travada e
 *      "Tela cheia" nunca ganham; sem voz nem com o modo desligado, nada;
 *   D. a ordem: em cima quem a frase cita primeiro; sem pessoas, a nota; a
 *      frase dividida em duas cenas vira um grid com a 1a em cima;
 *   E. o grid que entra no meio da cena (a cena emendada: cheia ate "a
 *      garota", depois o grid com o plano seguinte em cima);
 *   F. idempotente; "Grid" e "Tela cheia" na mao (a cena dele fica); o
 *      contrato (zod) guarda tudo; a config;
 *   G. a montagem: imageIndexB, sourceStartB, o movimento das metades, a
 *      imagem de baixo logo depois da de cima, o foco de cada metade pela
 *      chave da metade (9:8) e o plano de render do nucleo com `abaixo`;
 *   H. a janela 9:8 (o foco do 9:16 erra na metade) e o detector do quadro
 *      que o anime ja divide;
 *   I. o par bom (o Levi, 19/10): (a) pessoa em comum nas duas metades
 *      recusa (o MRM E02 f21 e f12), pessoas diferentes entram (o f07, com a
 *      fadinha fora da janela de cima); (b) metade sem rosto legivel ou de
 *      costas recusa, o personagem citado inteiro entra, sem o detector nao
 *      se sabe; (c) o bonus de rostos diferentes e de rosto + o citado em
 *      acao; vale para a frase dividida e o grid no meio da cena; na mao
 *      continua livre.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-grid.ts
 */
import { toRenderProps } from '@shared/plan'
import { projectFileSchema } from '@shared/project-file'
import type { ImageAsset } from '@shared/contract'
import {
  escolhaDaFraseSchema,
  estadoDasCenasSchema,
  juntarEmUma,
  temGrid,
  type CandidatoDeCena,
  type EscolhaDaFrase,
} from '../shared/cenas'
import { aplicarPatch, coerceConfig, CONFIG_PADRAO } from '../shared/config'
import { encaixarEscolha } from '../shared/encaixe'
import type { EpisodeIndex, Plano } from '../shared/episodio'
import {
  desligarGrid,
  encaixarMetade,
  entradasNaturais,
  gridsAutomaticos,
  iniciosDosBlocos,
  ligarGrid,
  limiteDeGrids,
  metadeDoCandidato,
  modoDoGrid,
  type EntradaDoGrid,
  type QuemNoGrid,
} from '../shared/grid'
import { janelaVisivel, medidasDoQuadro } from '../shared/recorte'
import type { PapelDaSecao, Roteiro } from '../shared/roteiro'
import { hashDoTexto, palavrasDaFrase, type TakeDaVoz } from '../shared/voz'
import { focoNoQuadro, trechosParaFocar } from '../electron/montar/foco'
import { janelaDoFormato } from '../electron/montar/rostos-motor'
import { chaveDaMetade, chaveDoPedaco, montarArquivoDoProjeto, pedacosDaMontagem, type FocoDoPedaco } from '../electron/montar/projeto'
import { temLinhaDeDivisao } from '../electron/cenas/grid'

let falhas = 0
function confere(ok: boolean, mensagem: string, extra?: unknown): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}${extra === undefined ? '' : ` -> ${JSON.stringify(extra).slice(0, 500)}`}`)
  }
}
const secao = (nome: string): void => console.log(`\n== ${nome}`)
const perto = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol

// ------------------------------------------------------------ o episodio

const EP = `ep_${'a'.repeat(40)}`
const id4 = (n: number): string => String(n).padStart(4, '0')

/**
 * 200 planos de 6 s cada (0..1200 s). A frase i (1..18) usa o plano 10i+1 (a
 * escolhida), 10i+2 (a parceira) e 10i+3 (fraca). Excecoes montadas por teste.
 */
function planosBase(): Plano[] {
  const planos: Plano[] = []
  for (let n = 0; n < 200; n++) {
    planos.push({
      id: id4(n),
      start: n * 6,
      end: n * 6 + 6,
      arquivo: `C:/fake/shots/${id4(n)}.mp4`,
      keyframe: `C:/fake/keyframes/${id4(n)}_1.jpg`,
      cueIds: [],
      falantes: [],
      personagens: [],
    })
  }
  return planos
}

function indiceDe(planos: Plano[]): Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'> {
  return { id: EP, planos, cues: [], exclusoes: [] }
}

const cand = (planos: readonly Plano[], ids: string[], nota: number, extra: Partial<CandidatoDeCena> = {}): CandidatoDeCena => {
  const ps = ids.map((id) => planos.find((p) => p.id === id)!)
  return {
    planoIds: ids,
    episodioId: EP,
    inSec: ps[0]!.start,
    outSec: ps[ps.length - 1]!.end,
    nota,
    porque: ['no evento'],
    origem: 'sugestao',
    keyframe: ps[0]!.keyframe,
    ...extra,
  }
}

// ------------------------------------------------------------ o roteiro e o take

interface FraseDoTeste {
  id: string
  texto: string
  dur: number
  papel: PapelDaSecao
}

function roteiroDe(frases: readonly FraseDoTeste[]): Pick<Roteiro, 'secoes' | 'versao'> {
  const secoes: Roteiro['secoes'] = []
  for (const f of frases) {
    let s = secoes[secoes.length - 1]
    if (!s || s.papel !== f.papel) {
      s = { id: `s${secoes.length + 1}`, papel: f.papel, frases: [] }
      secoes.push(s)
    }
    s.frases.push({
      id: f.id,
      texto: f.texto,
      eventoIds: [],
      cueDoMomento: null,
      intencaoVisual: '',
      textoDeTela: null,
      citacaoCueId: null,
    })
  }
  return { secoes, versao: 1 }
}

type TakeDoTeste = Pick<TakeDaVoz, 'id' | 'trechos' | 'palavras' | 'duracao'>

/** Cada frase com a duracao dada, as palavras repartidas por igual (0,1 s de respiro no comeco). */
function takeDe(frases: readonly FraseDoTeste[]): TakeDoTeste {
  const palavras: TakeDaVoz['palavras'] = []
  const trechos: TakeDaVoz['trechos'] = []
  let offset = 0
  for (const f of frases) {
    const ws = palavrasDaFrase(f.texto)
    const passo = (f.dur - 0.2) / ws.length
    let t = offset + 0.1
    for (const w of ws) {
      palavras.push({ texto: w, start: t, end: t + passo * 0.9, fraseId: f.id })
      t += passo
    }
    trechos.push({ fraseId: f.id, offset, duracao: f.dur, hashTexto: hashDoTexto(f.texto), texto: f.texto })
    offset += f.dur
  }
  return { id: 't1', trechos, palavras, duracao: offset }
}

const PAPEIS: PapelDaSecao[] = ['gancho', 'contexto', 'desenvolvimento', 'virada', 'climax', 'fechamento']
/** 18 frases de 3,3 s (59,4 s): 3 por parte, o climax nas frases 13 a 15. */
function frasesBase(): FraseDoTeste[] {
  return Array.from({ length: 18 }, (_, k) => ({
    id: `f${String(k + 1).padStart(2, '0')}`,
    texto: `Na cena ${k + 1} o heroi luta contra o vilao.`,
    dur: 3.3,
    papel: PAPEIS[Math.floor(k / 3)]!,
  }))
}

/** A escolha da frase i: o plano 10i+1 (nota 44), a fita com 10i+2 (41) e 10i+3 (20). */
function escolhaDe(planos: readonly Plano[], f: FraseDoTeste, i: number, extra: Partial<EscolhaDaFrase> = {}): EscolhaDaFrase {
  const a = cand(planos, [id4(10 * i + 1)], 44)
  const b = cand(planos, [id4(10 * i + 2)], 41)
  const c = cand(planos, [id4(10 * i + 3)], 20)
  return {
    fraseId: f.id,
    cenas: [{ candidato: a, palavraInicio: 0 }],
    fita: [a, b, c],
    confianca: 0.5,
    travada: false,
    hashTexto: hashDoTexto(f.texto),
    duracao: f.dur,
    avisos: [],
    ...extra,
  }
}

interface Cenario {
  planos: Plano[]
  frases: FraseDoTeste[]
  roteiro: Pick<Roteiro, 'secoes' | 'versao'>
  take: TakeDoTeste
  escolhas: EscolhaDaFrase[]
}

function cenario(mexer: (c: Cenario) => void = () => {}): Cenario {
  const planos = planosBase()
  const frases = frasesBase()
  const c: Cenario = { planos, frases, roteiro: roteiroDe(frases), take: takeDe(frases), escolhas: [] }
  c.escolhas = frases.map((f, i) => escolhaDe(planos, f, i + 1))
  mexer(c)
  c.roteiro = roteiroDe(c.frases)
  c.take = takeDe(c.frases)
  return c
}

function entrada(c: Cenario, extra: Partial<EntradaDoGrid> = {}): EntradaDoGrid {
  return { roteiro: c.roteiro, take: c.take, indice: indiceDe(c.planos), escolhas: c.escolhas, modo: 'automatico', ...extra }
}

const comGrid = (escolhas: readonly EscolhaDaFrase[]): string[] => escolhas.filter((e) => temGrid(e)).map((e) => e.fraseId)

// ------------------------------------------------------------ A. as pecas

function pecas(): void {
  secao('A. As pecas')
  confere(limiteDeGrids(59.8) === 3, 'limite: 59,8 s -> 3 grids', limiteDeGrids(59.8))
  confere(limiteDeGrids(30) === 2 && limiteDeGrids(10) === 1 && limiteDeGrids(0) === 0, 'limite: 30 s -> 2, 10 s -> 1, sem voz -> 0')
  confere(limiteDeGrids(75) === 4, 'limite: 75 s -> 4 (3 por minuto, arredondado)', limiteDeGrids(75))

  const f: FraseDoTeste = { id: 'f01', texto: 'A criada percebe como a garota voltou cheia de energia.', dur: 3.6, papel: 'contexto' }
  const take = takeDe([f])
  const blocos = iniciosDosBlocos(take)
  // Duas palavras por bloco (10 caracteres): "A criada" | "percebe" | "como a"? -- o artigo desce para o substantivo.
  confere(blocos.has(0) && blocos.has(palavrasDaFrase(f.texto).length), 'blocos: o comeco e o fim da frase sao fronteira', [...blocos])
  confere(blocos.has(4), 'blocos: "a garota" comeca um bloco (o artigo desce junto)', [...blocos])

  const e1 = entradasNaturais('A criada percebe como a garota voltou cheia de energia.')
  confere(e1.includes(4), 'entra no 2o sujeito: "| a garota voltou"', e1)
  const e2 = entradasNaturais('O artesao faz uma demonstracao, mas Nia acha o golpe fraco.')
  confere(e2.includes(5), 'entra no conectivo: "| mas Nia acha"', e2)
  const e3 = entradasNaturais('Pra ajudar os pais, ela vira estrela da transmissao magica.')
  confere(e3.includes(4), 'entra depois da virgula: "| ela vira"', e3)
  confere(!entradasNaturais('O artesao faz uma demonstracao bonita.').length, 'frase sem conectivo nem 2o sujeito: nenhuma entrada', entradasNaturais('O artesao faz uma demonstracao bonita.'))

  const planos = planosBase()
  const mapa = new Map(planos.map((p) => [p.id, p]))
  // Plano 0010 = 60..66 s. Pedindo 3 s a partir de 64: recua para 63 (cobre sem congelar).
  const m = metadeDoCandidato(cand(planos, ['0010'], 40, { inSec: 64 }), 3, mapa)
  confere(!!m && perto(m.inSec, 63) && perto(m.outSec, 66) && m.planoIds.length === 1, 'metade: recua o comeco so o necessario para cobrir', m)
  const span = cand(planos, ['0010', '0011'], 40)
  const m2 = metadeDoCandidato(span, 4, mapa)
  confere(!!m2 && m2.planoIds.join() === '0010', 'metade: de um span, o primeiro plano que cobre sozinho', m2?.planoIds)
  confere(metadeDoCandidato(cand(planos, ['0010'], 40), 7, mapa) === null, 'metade: plano de 6 s nao cobre 7 s (null)')
  const enc = encaixarMetade(cand(planos, ['0010'], 40, { inSec: 65 }), 2, planos)
  confere(perto(enc.candidato.inSec, 64) && perto(enc.falta, 0), 'encaixe da metade: recua para cobrir 2 s, sem falta', enc)
  const curta = encaixarMetade(cand(planos, ['0010'], 40), 8, planos)
  confere(perto(curta.falta, 2) && perto(curta.candidato.inSec, 60), 'encaixe da metade: plano curto fica com a falta (congela 2 s)', curta)
}

// ------------------------------------------------------------ B. o gatilho

function gatilho(): void {
  secao('B. O gatilho')
  const c = cenario()
  const r = gridsAutomaticos(entrada(c))
  const postos = comGrid(r.escolhas)
  confere(postos.length > 0, 'nota perto (44 x 41) e cenas diferentes: grid', postos)
  const g = r.escolhas.find((e) => temGrid(e))!
  const cena = g.cenas.find((x) => x.baixo)!
  confere(cena.candidato.planoIds.length === 1 && cena.baixo!.planoIds.length === 1, 'cada metade e UM plano', cena)
  confere(g.grid?.origem === 'auto' && g.grid.antes.length === 1 && !g.grid.antes[0]!.baixo, 'a frase guarda o grid automatico e a cena de antes', g.grid)
  confere(r.postos.join() === postos.join(), 'postos = as frases com grid', r.postos)

  // Nota longe: a parceira vale 34 (10 abaixo).
  const longe = cenario((x) => x.escolhas.forEach((e) => (e.fita[1] = { ...e.fita[1]!, nota: 34 })))
  confere(comGrid(gridsAutomaticos(entrada(longe)).escolhas).length === 0, 'nota longe (44 x 34): sem grid')

  // A parceira congela: plano de 1,5 s para um bloco de 3,3 s.
  const curta = cenario((x) => {
    for (let i = 1; i <= 18; i++) {
      const p = x.planos[10 * i + 2]!
      p.end = p.start + 1.5
    }
  })
  confere(comGrid(gridsAutomaticos(entrada(curta)).escolhas).length === 0, 'a outra metade congelaria (1,5 s num bloco de 3,3 s): sem grid')

  // Vetada (close extremo, o anime ja divide).
  const vetados = new Map(Array.from({ length: 18 }, (_, k) => [id4(10 * (k + 1) + 2), 'close extremo'] as const))
  confere(comGrid(gridsAutomaticos(entrada(c, { vetados })).escolhas).length === 0, 'parceira vetada (close extremo): sem grid')
  const vetadaACima = new Map(Array.from({ length: 18 }, (_, k) => [id4(10 * (k + 1) + 1), 'o anime ja divide o quadro'] as const))
  confere(comGrid(gridsAutomaticos(entrada(c, { vetados: vetadaACima })).escolhas).length === 0, 'a cena escolhida vetada (o anime ja divide): sem grid')

  // A mesma cena (CLIP): nao serve.
  confere(comGrid(gridsAutomaticos(entrada(c, { mesmaCena: () => true })).escolhas).length === 0, 'as duas metades sao a mesma cena: sem grid')

  // Nota fraca nas duas (20 e 18).
  const fraca = cenario((x) =>
    x.escolhas.forEach((e) => {
      e.cenas[0] = { ...e.cenas[0]!, candidato: { ...e.cenas[0]!.candidato, nota: 20 } }
      e.fita[1] = { ...e.fita[1]!, nota: 18 }
    }),
  )
  confere(comGrid(gridsAutomaticos(entrada(fraca)).escolhas).length === 0, 'duas cenas fracas (20 e 18): sem grid')

  // Bloco curto: frases de 1,8 s.
  const rapida = cenario((x) => x.frases.forEach((f) => (f.dur = 1.8)))
  confere(comGrid(gridsAutomaticos(entrada(rapida)).escolhas).length === 0, 'frase de 1,8 s (menos de 2 s): sem grid')

  // A parceira ja usada em outra frase.
  const usada = cenario((x) => {
    for (let i = 1; i <= 18; i++) x.escolhas[i - 1]!.fita[1] = cand(x.planos, [id4(10 * ((i % 18) + 1) + 1)], 41)
  })
  confere(comGrid(gridsAutomaticos(entrada(usada)).escolhas).length === 0, 'a parceira e a cena de outra frase: sem grid (sem repetir plano)')
}

// ------------------------------------------------------------ C. os limites

function limites(): void {
  secao('C. Os limites')
  const c = cenario()
  const r = gridsAutomaticos(entrada(c))
  const postos = comGrid(r.escolhas)
  const n = (id: string): number => Number(id.slice(1))
  confere(postos.length === 3, '59,4 s: 3 grids', postos)
  confere(!postos.includes('f01') && !postos.includes('f18'), 'nunca na 1a nem na ultima frase', postos)
  confere(!postos.some((id) => n(id) >= 13 && n(id) <= 15), 'nunca no climax (f13-f15)', postos)
  confere(postos.every((id, k) => k === 0 || n(id) - n(postos[k - 1]!) >= 3), 'nunca seguidas, com 5 s de tela cheia entre elas (2 frases de 3,3 s)', postos)
  const tempos = postos.map((id) => {
    const t = c.take.trechos.find((x) => x.fraseId === id)!
    return { de: t.offset, ate: t.offset + t.duracao }
  })
  confere(tempos.every((t, k) => k === 0 || t.de - tempos[k - 1]!.ate >= 5 - 1e-6), 'a tela cheia entre dois grids passa de 5 s', tempos)

  // Travada e "Tela cheia": nunca ganham.
  const travadas = cenario((x) => x.escolhas.forEach((e, k) => (e.travada = k % 2 === 0)))
  const rt = gridsAutomaticos(entrada(travadas))
  confere(comGrid(rt.escolhas).every((id) => !travadas.escolhas.find((e) => e.fraseId === id)!.travada), 'frase travada (ele escolheu) nunca ganha grid automatico', comGrid(rt.escolhas))
  const cheias = cenario((x) => x.escolhas.forEach((e) => (e.telaCheia = true)))
  confere(comGrid(gridsAutomaticos(entrada(cheias)).escolhas).length === 0, '"Tela cheia" dele: o automatico nao poe')

  // Sem voz, ou o modo desligado: nada; o desligado tira os automaticos e deixa o da mao.
  confere(comGrid(gridsAutomaticos(entrada(c, { take: null })).escolhas).length === 0, 'sem voz (estimativa): sem grid')
  const desligado = gridsAutomaticos(entrada({ ...c, escolhas: r.escolhas }, { modo: 'desligado' }))
  confere(comGrid(desligado.escolhas).length === 0, 'modo desligado: os automaticos voltam a tela cheia', comGrid(desligado.escolhas))
  confere(desligado.mudadas.length === 3, 'desligado: as 3 frases mudaram (o servico encaixa de novo)', desligado.mudadas)
  const naMao = ligarGrid(entrada(c), 'f05')
  confere('escolha' in naMao, '"Grid" na mao numa frase', naMao)
  if ('escolha' in naMao) {
    const com = c.escolhas.map((e) => (e.fraseId === 'f05' ? naMao.escolha : e))
    const d2 = gridsAutomaticos(entrada({ ...c, escolhas: com }, { modo: 'desligado' }))
    confere(comGrid(d2.escolhas).join() === 'f05', 'modo desligado: o grid da mao fica', comGrid(d2.escolhas))
    const a2 = gridsAutomaticos(entrada({ ...c, escolhas: com }))
    const ids = comGrid(a2.escolhas)
    confere(ids.includes('f05') && ids.length === 3, 'o grid da mao conta no limite (com ele, mais 2)', ids)
    const n5 = ids.filter((id) => id !== 'f05').map(n)
    confere(n5.every((k) => Math.abs(k - 5) >= 3), 'e no espaco: nenhum automatico colado no da mao', ids)
  }
}

// ------------------------------------------------------------ D. a ordem

function ordem(): void {
  secao('D. A ordem cima/baixo')
  const c = cenario()
  // A frase cita o Lent (palavra 0) e o Guy (palavra 4); a cena escolhida mostra o Guy, a parceira o Lent.
  const quem = {
    citados: new Map(c.frases.map((f) => [f.id, [{ palavra: 0, quem: 'lent' }, { palavra: 4, quem: 'guy' }]] as const)),
    noPlano: (id: string): ReadonlySet<string> => new Set(Number(id) % 10 === 1 ? ['guy'] : Number(id) % 10 === 2 ? ['lent'] : []),
  }
  const r = gridsAutomaticos(entrada(c, { quem }))
  const g = r.escolhas.find((e) => temGrid(e))!
  const cena = g.cenas.find((x) => x.baixo)!
  confere(Number(cena.candidato.planoIds[0]) % 10 === 2, 'em cima quem a frase cita primeiro (o Lent, na parceira)', cena.candidato.planoIds)
  confere(Number(cena.baixo!.planoIds[0]) % 10 === 1, 'embaixo o que vem depois (o Guy)', cena.baixo!.planoIds)
  // Sem pessoas: a de nota maior em cima (o momento da frase).
  const r2 = gridsAutomaticos(entrada(c))
  const c2 = r2.escolhas.find((e) => temGrid(e))!.cenas.find((x) => x.baixo)!
  confere(c2.candidato.nota > c2.baixo!.nota, 'sem pessoas: a de nota maior em cima', [c2.candidato.nota, c2.baixo!.nota])

  // A frase dividida pelo casar em duas cenas (acao e reacao, "mas"): um grid so, a 1a em cima.
  // So a f05 tem par (as outras ficam sem fita): a conta nao compete com elas.
  const soAF05 = (x: Cenario): void =>
    x.escolhas.forEach((e, k) => {
      if (k !== 4) e.fita = e.fita.slice(0, 1)
    })
  const dividida = cenario((x) => {
    x.frases[4] = { ...x.frases[4]!, texto: 'O artesao faz uma demonstracao, mas Nia acha o golpe fraco.', dur: 4.2 }
    const e = x.escolhas[4]!
    const a = cand(x.planos, [id4(51)], 40)
    const b = cand(x.planos, [id4(55)], 38)
    x.escolhas[4] = { ...e, hashTexto: hashDoTexto(x.frases[4]!.texto), cenas: [{ candidato: a, palavraInicio: 0 }, { candidato: b, palavraInicio: 5 }], fita: [a, b] }
    soAF05(x)
  })
  const r3 = gridsAutomaticos(entrada(dividida))
  const e3 = r3.escolhas.find((e) => e.fraseId === 'f05')!
  confere(temGrid(e3) && e3.cenas.length === 1, 'frase dividida ("mas"): as duas cenas viram um grid so', e3.cenas.map((x) => [x.candidato.planoIds, x.baixo?.planoIds]))
  confere(e3.cenas[0]?.candidato.planoIds[0] === '0051' && e3.cenas[0]?.baixo?.planoIds[0] === '0055', 'a cena do 1o pedaco em cima, a do 2o embaixo', e3.cenas[0])
  confere(e3.grid?.antes.length === 2, 'o grid guarda as duas cenas de antes', e3.grid)
  // "e" de sequencia (causa e efeito no tempo): nao vira grid de uma frase so.
  const sequencia = cenario((x) => {
    x.frases[4] = { ...x.frases[4]!, texto: 'Essa nova alma dominou o chi e sobreviveu ao ataque.', dur: 4.2 }
    const e = x.escolhas[4]!
    const a = cand(x.planos, [id4(51)], 40)
    const b = cand(x.planos, [id4(55)], 38)
    // O corte em "| e sobreviveu" (a palavra 6).
    x.escolhas[4] = { ...e, hashTexto: hashDoTexto(x.frases[4]!.texto), cenas: [{ candidato: a, palavraInicio: 0 }, { candidato: b, palavraInicio: 6 }], fita: [a, b] }
    soAF05(x)
  })
  const e4 = gridsAutomaticos(entrada(sequencia)).escolhas.find((e) => e.fraseId === 'f05')!
  confere(!(temGrid(e4) && e4.cenas.length === 1), '"e sobreviveu" (sequencia): as duas cenas ficam em sequencia', e4.cenas.map((x) => [x.candidato.planoIds, x.baixo?.planoIds]))
}

// ------------------------------------------------------------ E. no meio da cena

function noMeio(): void {
  secao('E. O grid entra no meio da cena')
  const c = cenario((x) => {
    // f05: "A criada percebe como | a garota voltou cheia de energia." (3,6 s), a cena emendada 0051 (1,4 s) + 0052 (3 s).
    x.frases[4] = { ...x.frases[4]!, texto: 'A criada percebe como a garota voltou cheia de energia.', dur: 3.6 }
    x.planos[51]!.end = x.planos[51]!.start + 1.4
    x.planos[52]!.start = x.planos[51]!.end
    x.planos[52]!.end = x.planos[52]!.start + 3
    const span = cand(x.planos, ['0051', '0052'], 44.4)
    const outra = cand(x.planos, ['0055'], 40.9)
    x.escolhas[4] = { ...x.escolhas[4]!, hashTexto: hashDoTexto(x.frases[4]!.texto), cenas: [{ candidato: span, palavraInicio: 0 }], fita: [span, outra] }
    // Sem as outras frases concorrendo: so a f05 tem par.
    x.escolhas.forEach((e, k) => {
      if (k !== 4) e.fita = e.fita.slice(0, 1)
    })
  })
  const r = gridsAutomaticos(entrada(c))
  const e = r.escolhas.find((x) => x.fraseId === 'f05')!
  confere(temGrid(e) && e.cenas.length === 2, 'a cena emendada: cheia no comeco, o grid depois', e.cenas.map((x) => [x.palavraInicio, x.candidato.planoIds, x.baixo?.planoIds]))
  confere(e.cenas[1]?.palavraInicio === 4, 'o grid entra em "a garota" (o 2o sujeito)', e.cenas[1]?.palavraInicio)
  confere(e.cenas[1]?.candidato.planoIds[0] === '0052' && e.cenas[1]?.baixo?.planoIds[0] === '0055', 'em cima o plano da cena que continua (0052), embaixo a parceira', e.cenas[1])
  confere(e.cenas[0]?.candidato.planoIds.join('+') === '0051+0052' && !e.cenas[0]?.baixo, 'antes do grid a cena de antes, em tela cheia', e.cenas[0])
  // O encaixe da frase: a cena cheia encolhe para o pedaco dela; as metades cobrem o resto.
  const frase = c.roteiro.secoes.flatMap((s) => s.frases).find((f) => f.id === 'f05')!
  const enc = encaixarEscolha(e, { indice: indiceDe(c.planos), frase, take: c.take })
  const g = enc.escolha.cenas[1]!
  confere(g.candidato.planoIds.length === 1 && g.baixo?.planoIds.length === 1, 'encaixado: as duas metades seguem um plano so', g)
  confere(!enc.escolha.avisos.includes('Cena curta'), 'encaixado: nenhuma metade curta', enc.escolha.avisos)

  // ANTES do corte do casar (a f07 do Nia E01): o casar cortou em "voltou" (palavra 6), com
  // pedacos curtos demais para um grid; o grid entra em "a garota" (palavra 4), com a cena do
  // 2o pedaco em cima, e a nota comparada na fita da frase INTEIRA (a dos pedacos tem outra escala).
  const antes = cenario((x) => {
    x.frases[4] = { ...x.frases[4]!, texto: 'A criada percebe como a garota voltou cheia de energia.', dur: 3.4 }
    // O 0111 tem 1,5 s: nao cobre a frase inteira (os dois pedacos juntos num grid so nao cabem).
    x.planos[51]!.end = x.planos[51]!.start + 1.5
    x.planos[52]!.start = x.planos[51]!.end
    const p0111 = cand(x.planos, ['0051'], 29.2)
    const p0112 = cand(x.planos, ['0052'], 52.5)
    const p0110 = cand(x.planos, ['0055'], 36.0)
    x.escolhas[4] = {
      ...x.escolhas[4]!,
      hashTexto: hashDoTexto(x.frases[4]!.texto),
      cenas: [{ candidato: p0111, palavraInicio: 0 }, { candidato: p0112, palavraInicio: 6 }],
      fita: [p0111, p0112, p0110],
      inteira: [cand(x.planos, ['0051', '0052'], 39.8), cand(x.planos, ['0055'], 36.1)],
    }
    x.escolhas.forEach((e, k) => {
      if (k !== 4) e.fita = e.fita.slice(0, 1)
    })
  })
  const ra = gridsAutomaticos(entrada(antes))
  const ea = ra.escolhas.find((x) => x.fraseId === 'f05')!
  confere(temGrid(ea) && ea.cenas.length === 2 && ea.cenas[1]?.palavraInicio === 4, 'antes do corte do casar: o grid sobe para "a garota"', ea.cenas.map((x) => [x.palavraInicio, x.candidato.planoIds, x.baixo?.planoIds]))
  confere(ea.cenas[1]?.candidato.planoIds[0] === '0052' && ea.cenas[1]?.baixo?.planoIds[0] === '0055', 'em cima a cena do 2o pedaco (a de nota maior), embaixo a parceira', ea.cenas[1])
  confere(ra.candidatas.find((x) => x.fraseId === 'f05')?.como === 'antes', 'a opcao e a de antes do corte', ra.candidatas)
  // Sem a fita da frase inteira, as notas dos pedacos (52,5 x 36) ficam longe: sem grid.
  const semInteira = { ...antes, escolhas: antes.escolhas.map((e) => (e.fraseId === 'f05' ? { ...e, inteira: undefined } : e)) }
  confere(!temGrid(gridsAutomaticos(entrada(semInteira)).escolhas.find((x) => x.fraseId === 'f05')!), 'sem a fita da frase inteira, as notas dos pedacos nao se comparam: sem grid')

  // O mesmo momento do episodio: a parceira a mais de 60 s nao serve (causa e efeito longe).
  const longe = cenario((x) => {
    for (let i = 1; i <= 18; i++) x.escolhas[i - 1]!.fita[1] = cand(x.planos, [id4(Math.min(199, 10 * i + 12))], 41)
  })
  confere(comGrid(gridsAutomaticos(entrada(longe)).escolhas).length === 0, 'parceira a 66 s no episodio: sem grid (nao e o mesmo momento)')
}

// ------------------------------------------------------------ F. idempotente, na mao, contrato, config

function naMaoEContrato(): void {
  secao('F. Idempotente, na mao, o contrato e a config')
  const c = cenario()
  const r1 = gridsAutomaticos(entrada(c))
  const r2 = gridsAutomaticos(entrada({ ...c, escolhas: r1.escolhas }))
  confere(JSON.stringify(r1.escolhas) === JSON.stringify(r2.escolhas), 'rodar de novo da o mesmo (o automatico volta e e decidido igual)')
  confere(r2.mudadas.length === 0 || r2.mudadas.every((id) => r1.postos.includes(id)), 'rodar de novo so mexe nas que tinham grid', r2.mudadas)

  // Na mao, numa frase travada: a cena dele fica como uma das metades.
  const dele = cand(c.planos, [id4(64)], 0, { origem: 'usuario' })
  const travada = { ...c.escolhas[5]!, cenas: [{ candidato: dele, palavraInicio: 0 }], travada: true }
  const escolhas = c.escolhas.map((e, k) => (k === 5 ? travada : e))
  const lig = ligarGrid(entrada({ ...c, escolhas }), 'f06')
  confere('escolha' in lig, '"Grid" numa frase travada', lig)
  if ('escolha' in lig) {
    const cena = lig.escolha.cenas.find((x) => x.baixo)!
    const metades = [cena.candidato.planoIds[0], cena.baixo!.planoIds[0]]
    confere(metades.includes('0064'), 'a cena que ele escolheu fica como uma das metades', metades)
    confere(lig.escolha.grid?.origem === 'mao' && lig.escolha.travada, 'grid na mao, frase travada', lig.escolha.grid)
    const r = gridsAutomaticos(entrada({ ...c, escolhas: c.escolhas.map((e, k) => (k === 5 ? lig.escolha : e)) }))
    confere(temGrid(r.escolhas[5]!) && r.escolhas[5]!.grid?.origem === 'mao', 'o automatico nao mexe no grid da mao', r.escolhas[5]!.grid)
    const cheia = desligarGrid(lig.escolha)
    confere(!temGrid(cheia) && cheia.telaCheia === true && cheia.cenas[0]!.candidato.planoIds[0] === '0064', '"Tela cheia": volta a cena dele, e o automatico nao poe mais', cheia.cenas)
    const r3 = gridsAutomaticos(entrada({ ...c, escolhas: c.escolhas.map((e, k) => (k === 5 ? { ...cheia, travada: false } : e)) }))
    confere(!temGrid(r3.escolhas[5]!), 'com "Tela cheia" (mesmo destravada) o automatico nao poe', r3.escolhas[5]!.cenas)
  }
  // Sem parceira nenhuma: o recado.
  const sozinha = cenario((x) => x.escolhas.forEach((e) => (e.fita = e.fita.slice(0, 1))))
  const sem = ligarGrid(entrada(sozinha), 'f05')
  confere('erro' in sem && /Nenhuma outra cena/.test(sem.erro), '"Grid" sem outra cena boa: o recado', sem)
  // Juntar em 1 (a divisao do casar) tira o grid.
  const comDois = { ...r1.escolhas.find((e) => temGrid(e))!, inteira: [cand(c.planos, ['0001'], 30)], cenas: [...r1.escolhas.find((e) => temGrid(e))!.cenas, { candidato: cand(c.planos, ['0002'], 30), palavraInicio: 5 }] }
  const junta = juntarEmUma(comDois)
  confere(!!junta && !temGrid(junta) && junta.grid === undefined, '"Juntar em 1" volta a tela cheia sem a marca do grid', junta?.grid)

  // O contrato guarda a metade de baixo, o grid, a tela cheia e a marca do passo.
  const g = r1.escolhas.find((e) => temGrid(e))!
  const lido = escolhaDaFraseSchema.parse(JSON.parse(JSON.stringify({ ...g, telaCheia: false })))
  confere(lido.cenas.some((x) => x.baixo) && lido.grid?.origem === 'auto' && lido.telaCheia === false, 'zod: baixo, grid e telaCheia voltam do disco', lido.grid)
  const estado = estadoDasCenasSchema.parse({ escolhas: [g], sugeridasEm: null, roteiroVersao: 1, takeId: 't1', grid: { modo: 'automatico', em: '2026-10-19T12:00:00.000Z' } })
  confere(estado.grid?.modo === 'automatico', 'zod: a marca do ultimo passo do grid', estado.grid)

  // A config: automatico por padrao; desligado fica; lixo vira o padrao.
  confere(CONFIG_PADRAO.cenas.grid === 'automatico' && coerceConfig({}).cenas.grid === 'automatico', 'config: o grid nasce automatico')
  confere(coerceConfig({ cenas: { grid: 'desligado' } }).cenas.grid === 'desligado', 'config: desligado fica')
  confere(coerceConfig({ cenas: { grid: 'talvez' } }).cenas.grid === 'automatico' && modoDoGrid(7) === 'automatico', 'config: lixo vira o padrao')
  const patch = aplicarPatch(coerceConfig({ cenas: { duasCenas: false } }), { cenas: { grid: 'desligado' } })
  confere(patch.cenas.grid === 'desligado' && patch.cenas.duasCenas === false, 'config: mudar o grid nao mexe no resto das cenas', patch.cenas)
}

// ------------------------------------------------------------ G. a montagem

function montagem(): void {
  secao('G. A montagem com imageIndexB')
  const c = cenario()
  const r = gridsAutomaticos(entrada(c))
  const porId = new Map(c.roteiro.secoes.flatMap((s) => s.frases).map((f) => [f.id, f]))
  const indice = indiceDe(c.planos)
  const escolhas = r.escolhas.map((e) => encaixarEscolha(e, { indice, frase: porId.get(e.fraseId)!, take: c.take }).escolha)
  const base = {
    rascunho: { id: 'rc_aaaaaaaaaaaa_teste1', episodioId: EP },
    roteiro: c.roteiro,
    take: c.take,
    indice: { ...indice, cues: [] },
    cenas: { escolhas },
  }
  const { pedacos } = pedacosDaMontagem(base)
  const comBaixo = pedacos.filter((p) => p.baixo)
  confere(comBaixo.length === 3, 'os 3 grids viram 3 blocos com a metade de baixo', comBaixo.map((p) => p.fraseId))
  const p0 = comBaixo[0]!
  confere(p0.baixo!.de >= 0 && p0.baixo!.arquivo.endsWith('.mp4') && p0.baixo!.planoId !== p0.planoId, 'o bloco sabe o mp4 e o ponto da metade de baixo', p0.baixo)

  // O foco: as duas metades pela chave da METADE; os outros pela de sempre.
  const focos = new Map<string, FocoDoPedaco>()
  for (const p of pedacos) {
    if (p.baixo) {
      focos.set(chaveDaMetade(p), { focusX: 0.11, focusY: 0.5, focusAuto: true })
      focos.set(chaveDaMetade(p.baixo), { focusX: 0.89, focusY: 0.5, focusAuto: true })
      focos.set(chaveDoPedaco(p), { focusX: 0.99, focusY: 0.5, focusAuto: true })
    } else focos.set(chaveDoPedaco(p), { focusX: 0.3, focusY: 0.5, focusAuto: true })
  }
  const { file } = montarArquivoDoProjeto({ ...base, narracaoPath: 'C:/fake/narracao.wav', focos, agora: '2026-10-19T12:00:00.000Z' })
  confere(projectFileSchema.safeParse(file).success, 'o .dangai passa no zod do nucleo')
  const cenasGrid = file.plan!.scenes.filter((s) => s.imageIndexB !== null)
  confere(cenasGrid.length === 3, '3 cenas com imageIndexB', cenasGrid.length)
  confere(file.plan!.scenes.filter((s) => s.imageIndexB === null).length === pedacos.length - 3, 'as outras continuam em tela cheia (imageIndexB null)')
  confere(file.images.length === pedacos.length + 3, 'uma imagem a mais por grid (a de baixo)', [file.images.length, pedacos.length])
  const s0 = cenasGrid[0]!
  confere(s0.imageIndexB === s0.imageIndex + 1, 'a imagem de baixo logo depois da de cima (os pares do nucleo)', [s0.imageIndex, s0.imageIndexB])
  confere(perto(s0.sourceStartB, p0.baixo!.de) && perto(s0.sourceStart, p0.de), 'sourceStart e sourceStartB = o ponto de cada mp4', [s0.sourceStart, s0.sourceStartB])
  confere(s0.effect === 'pan-left' && s0.effectB === 'pan-right' && s0.intensityB === null, 'as metades para lados opostos (o padrao do nucleo), a mesma intensidade', [s0.effect, s0.effectB, s0.intensityB])
  const cima = file.images[s0.imageIndex]!
  const baixo = file.images[s0.imageIndexB!]!
  confere(perto(cima.focusX, 0.11) && perto(baixo.focusX, 0.89), 'o foco de cada metade vem da chave da metade (9:8), nao do 9:16', [cima.focusX, baixo.focusX])
  confere(baixo.path === p0.baixo!.arquivo && cima.path === p0.arquivo, 'cada imagem aponta o mp4 da sua metade', [cima.path, baixo.path])
  confere(/grid/.test(s0.reason ?? ''), 'o porque do bloco diz que e grid', s0.reason)
  const cheia = file.plan!.scenes.find((s) => s.imageIndexB === null)!
  confere(perto(file.images[cheia.imageIndex]!.focusX, 0.3), 'o bloco de tela cheia continua com o foco do 9:16', file.images[cheia.imageIndex]!.focusX)

  // Os trechos que a montagem enquadra: as duas metades com a marca.
  const trechos = trechosParaFocar(pedacos)
  confere(trechos.filter((t) => t.metade).length === 6 && trechos.length === pedacos.length + 3, 'trechosParaFocar: as duas metades de cada grid, na janela delas', trechos.length)

  // O plano de render do nucleo: a cena dividida chega com `abaixo` (o original e o foco de cada metade).
  const imagens: ImageAsset[] = file.images.map((im, k) => ({
    id: `img${k}`,
    path: im.path,
    fileName: im.fileName,
    url: `http://x/${k}-916.mp4`,
    urlSource: `http://x/${k}.mp4`,
    width: 1920,
    height: 1080,
    thumbnail: '',
    focusX: im.focusX,
    focusY: im.focusY,
    focusAuto: im.focusAuto,
    kind: 'video',
    section: im.section ?? null,
    durationSec: 6,
  }))
  const props = toRenderProps(file.plan!, imagens, [], null, undefined, 0.355, c.take.duracao)
  const dividida = props.scenes.find((s) => s.abaixo !== null)
  confere(!!dividida && dividida.abaixo!.url.endsWith(`${s0.imageIndexB}.mp4`) && !dividida.abaixo!.url.includes('916'), 'render: a metade de baixo toca o ORIGINAL', dividida?.abaixo?.url)
  confere(!!dividida && perto(dividida.abaixo!.focusX, 0.89) && perto(dividida.focusX, 0.11), 'render: cada metade com o foco dela', [dividida?.focusX, dividida?.abaixo?.focusX])
  confere(!!dividida && dividida.abaixo!.sourceDurationInFrames === null && dividida.sourceDurationInFrames === null, 'render: nenhuma das duas congela (cobrem o bloco)', [dividida?.sourceDurationInFrames, dividida?.abaixo?.sourceDurationInFrames])
}

// ------------------------------------------------------------ H. a janela 9:8 e o detector

function janelaEDetector(): void {
  secao('H. A janela 9:8 e o quadro que o anime ja divide')
  const m = medidasDoQuadro('metade')
  confere(m.width === 1080 && m.height === 960 && m.renderWidth === 1080, 'a metade do short: 1080x960, sem folga', m)
  const j = janelaDoFormato(1920, 1080, 'metade')
  confere(perto(j, 1215 / 1920, 1e-3), 'a metade ve 63% do 16:9 (1215 px)', j)
  confere(perto(janelaDoFormato(1920, 1080, 'short'), 528 / 1920, 2e-3), 'o 9:16 ve 27,5% (o de sempre)', janelaDoFormato(1920, 1080, 'short'))
  // Um rosto em x = 0,2 do 16:9: o foco certo de cada janela.
  const f916 = focoNoQuadro({ centroX: 0.2, centroY: 0.5 }, 1920, 1080, 'short')
  const f98 = focoNoQuadro({ centroX: 0.2, centroY: 0.5 }, 1920, 1080, 'metade')
  const centro = (fx: number, q: 'short' | 'metade'): number => janelaVisivel(fx, 1920, 1080, q).centro
  confere(perto(centro(f98.focusX, 'metade'), Math.max(0.2, 1215 / 1920 / 2), 1e-2), 'o foco 9:8 poe o rosto no meio da metade (ou o mais perto que da)', [f98.focusX, centro(f98.focusX, 'metade')])
  const erro = Math.abs(centro(f916.focusX, 'metade') - 0.2) * 1920
  confere(erro > 100, `o foco do 9:16 usado na metade erra ${Math.round(erro)} px (por isso o foco e recalculado)`, erro)

  // O detector: uma diagonal escura num quadro claro e o anime dividindo; sem ela, nao.
  const W = 192
  const H = 108
  // Um quadro claro e liso: degrade na horizontal, uma onda suave na vertical.
  const claro = (): Uint8Array => {
    const l = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) l[y * W + x] = Math.round(120 + (80 * x) / W + 15 * Math.sin(y / 9))
    return l
  }
  const comDiagonal = claro()
  for (let y = 0; y < H; y++) {
    const x0 = Math.round(105 - (30 * y) / (H - 1))
    for (let d = -1; d <= 1; d++) comDiagonal[y * W + x0 + d] = 10
  }
  confere(temLinhaDeDivisao(comDiagonal), 'detector: a diagonal preta de ponta a ponta (o 0193) e divisao')
  confere(!temLinhaDeDivisao(claro()), 'detector: quadro sem linha nao e divisao')
  const escuro = new Uint8Array(W * H).fill(20)
  confere(!temLinhaDeDivisao(escuro), 'detector: quadro escuro inteiro nao e divisao')
  const tarja = claro()
  for (let y = 0; y < 8; y++) for (let x = 0; x < W; x++) tarja[y * W + x] = 0
  confere(!temLinhaDeDivisao(tarja), 'detector: tarja preta na borda nao e divisao')
  const meia = claro()
  for (let y = 0; y < H / 2; y++) for (let d = -1; d <= 1; d++) meia[y * W + 96 + d] = 10
  confere(!temLinhaDeDivisao(meia), 'detector: linha que nao cruza o quadro inteiro nao e divisao')
  // O anime em 4:3 dentro do 16:9: as tarjas pretas dos lados nao sao divisao...
  const quatroTercos = claro()
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 24 || x >= W - 24) quatroTercos[y * W + x] = 0
  confere(!temLinhaDeDivisao(quatroTercos), 'detector: tarja preta dos lados (4:3) nao e divisao')
  // ...mas a divisao DENTRO da imagem 4:3 continua sendo.
  const dividido43 = Uint8Array.from(quatroTercos)
  for (let y = 0; y < H; y++) for (let d = -1; d <= 1; d++) dividido43[y * W + 96 + d] = 8
  confere(temLinhaDeDivisao(dividido43), 'detector: a linha preta no meio da imagem 4:3 e divisao')
  // O batente da porta (um lado escuro): nao e divisao.
  const porta = claro()
  for (let y = 0; y < H; y++) {
    for (let d = -1; d <= 1; d++) porta[y * W + 96 + d] = 10
    for (let x = 98; x < 130; x++) porta[y * W + x] = 30
  }
  confere(!temLinhaDeDivisao(porta), 'detector: o contorno de uma porta escura (um lado escuro) nao e divisao')
}

// ------------------------------------------------------------ I. o par bom (pessoas e rostos)

function parBom(): void {
  secao('I. O par bom: pessoas diferentes, rosto visivel, o bonus')
  // Quem cada plano mostra, pelo lado do plano na frase: 10i+1 a escolhida, 10i+2 a parceira, 10i+4 uma outra.
  const lado = (id: string): number => Number(id) % 10
  const quem = (noPlano: (id: string) => string[]): QuemNoGrid => ({ citados: new Map(), noPlano: (id) => new Set(noPlano(id)) })
  const soOLent = (lados: number[]): QuemNoGrid => quem((id) => (lados.includes(lado(id)) ? ['lent'] : []))
  const c = cenario()
  const quantos = (extra: Partial<EntradaDoGrid>, x: Cenario = c): string[] => comGrid(gridsAutomaticos(entrada(x, extra)).escolhas)

  // (a) Pessoa em comum nas duas metades: o automatico recusa.
  confere(quantos({ quem: soOLent([1, 2]) }).length === 0, '(a) o Lent nas duas metades (o MRM E02 f21): recusa', quantos({ quem: soOLent([1, 2]) }))
  const comOGuy = quem((id) => (lado(id) === 1 ? ['lent'] : lado(id) === 2 ? ['lent', 'guy'] : []))
  confere(quantos({ quem: comOGuy }).length === 0, '(a) o Lent em cima e o Lent com o Guy embaixo: pessoa em comum, recusa', quantos({ quem: comOGuy }))
  const outra = quem((id) => (lado(id) === 1 ? ['lent'] : lado(id) === 2 ? ['guy'] : []))
  confere(quantos({ quem: outra }).length === 3, '(a) pessoas diferentes (o Lent e o Guy): entra', quantos({ quem: outra }))
  confere(quantos({ quem: quem(() => []) }).length === 3, '(a) ninguem reconhecido nos planos: nao veta (3 grids)', quantos({ quem: quem(() => []) }))
  confere(quantos({ quem: soOLent([1]) }).length === 3, '(a) so a metade de cima reconhecida: nao veta', quantos({ quem: soOLent([1]) }))

  // Com quem a frase cita e o rosto separado da fala (o servico manda os dois): a metade mostra
  // o citado que o plano tem, na ordem da frase (a montagem enquadra nele).
  const naFrase = (citados: string[], rostos: (id: string) => string[], soFala: (id: string) => string[] = () => []): QuemNoGrid => ({
    citados: new Map(c.frases.map((f) => [f.id, citados.map((q, k) => ({ palavra: k + 1, quem: q }))])),
    noPlano: (id) => new Set([...rostos(id), ...soFala(id)]),
    peloRosto: (id) => new Set(rostos(id)),
  })
  // O f21 de verdade: o 0243 tem a fadinha na ponta, mas a metade enquadra o Lent; embaixo, o Lent.
  const f21 = naFrase(['lent'], (id) => (lado(id) === 1 ? ['lent', 'empee'] : lado(id) === 2 ? ['lent'] : []))
  confere(quantos({ quem: f21 }).length === 0, '(a) a frase cita so o Lent e os dois planos tem o Lent: recusa', quantos({ quem: f21 }))
  // O f07 de verdade: a frase cita o Lent e a fadinha; em cima os dois (enquadra o Lent), embaixo a fadinha.
  const f07 = naFrase(['lent', 'empee'], (id) => (lado(id) === 1 ? ['lent', 'empee'] : lado(id) === 2 ? ['empee'] : []))
  confere(quantos({ quem: f07 }).length === 3, '(a) em cima o Lent (a fadinha fica fora da janela), embaixo a fadinha: entra', quantos({ quem: f07 }))
  // O f12 de verdade: a frase cita o Guy; o Guy nas duas (embaixo o Lent caido, que so fala).
  const f12 = naFrase(['guy'], (id) => (lado(id) === 1 || lado(id) === 2 ? ['guy'] : []), (id) => (lado(id) === 2 ? ['lent'] : []))
  confere(quantos({ quem: f12 }).length === 0, '(a) o Guy nas duas metades (o MRM E02 f12): recusa', quantos({ quem: f12 }))
  const soFala = naFrase(['lent'], () => [], (id) => (lado(id) === 1 || lado(id) === 2 ? ['lent'] : []))
  confere(quantos({ quem: soFala }).length === 3, '(a) o Lent so pela fala nas duas (nenhum rosto reconhecido): nao veta pela pessoa', quantos({ quem: soFala }))

  // So o par da frase sai: o limite vai para outra frase.
  const semVeto = comGrid(gridsAutomaticos(entrada(c)).escolhas)
  const naF08 = quem((id) => (id === '0081' || id === '0082' ? ['lent'] : []))
  const comVeto = quantos({ quem: naF08 })
  confere(semVeto.includes('f08') && !comVeto.includes('f08') && comVeto.length === 3, '(a) o Lent e o Lent so na f08: ela fica em tela cheia e o grid vai para outra frase', [semVeto, comVeto])
  // A parceira seguinte, com outra pessoa, entra no lugar da que repete o Lent.
  const comAOutra = cenario((x) => x.escolhas.forEach((e, k) => e.fita.push(cand(x.planos, [id4(10 * (k + 1) + 4)], 40.5))))
  const lentELent = quem((id) => (lado(id) === 1 || lado(id) === 2 ? ['lent'] : lado(id) === 4 ? ['guy'] : []))
  const metadesDe = (escolhas: readonly EscolhaDaFrase[]): string[] =>
    escolhas
      .filter((e) => temGrid(e))
      .map((e) => e.cenas.find((x) => x.baixo)!)
      .map((x) => [lado(x.candidato.planoIds[0]!), lado(x.baixo!.planoIds[0]!)].sort((a, b) => a - b).join('+'))
  const trocadas = metadesDe(gridsAutomaticos(entrada(comAOutra, { quem: lentELent })).escolhas)
  confere(trocadas.length === 3 && trocadas.every((m) => m === '1+4'), '(a) a parceira do mesmo Lent (41) sai e a do Guy (40,5) entra', trocadas)

  // (b) Cada metade com o seu sujeito legivel: rosto visivel, ou o personagem inteiro e claro.
  const rostosDe = (porLado: (l: number) => (number | null)[] | undefined): Map<string, (number | null)[]> => {
    const m = new Map<string, (number | null)[]>()
    for (const p of c.planos) {
      const r = porLado(lado(p.id))
      if (r) m.set(p.id, r)
    }
    return m
  }
  const rosto = [0.3, 0.32, 0.3]
  const semRosto = [null, null, null]
  const comRostos = quantos({ rostos: rostosDe(() => rosto) })
  confere(comRostos.length === 3, '(b) rosto visivel nas duas metades (o Nia E01 f07, a criada e a Nia): entra', comRostos)
  confere(quantos({ rostos: rostosDe(() => semRosto) }).length === 0, '(b) as duas sem rosto (de costas, so a cabeca): recusa')
  confere(quantos({ rostos: rostosDe((l) => (l === 2 ? semRosto : rosto)) }).length === 0, '(b) uma metade sem rosto: recusa')
  confere(quantos({ rostos: rostosDe((l) => (l === 2 ? [0.06, 0.06, 0.06] : rosto)) }).length === 0, '(b) rosto pequeno demais para ler (a Nia na cama ao longe, 0,06): recusa')
  confere(quantos({ rostos: rostosDe((l) => (l === 2 ? [0.3, null, null] : rosto)) }).length === 0, '(b) rosto em 1 so dos 3 instantes, sem personagem reconhecido: recusa')
  confere(quantos({ rostos: rostosDe((l) => (l === 2 ? undefined : rosto)) }).length === 3, '(b) o detector nao olhou um plano: nao se sabe, entra')
  // O personagem inteiro e claro: a fadinha voando (o rosto pequeno em 1 instante), reconhecida e citada.
  const fadinha = rostosDe((l) => (l === 2 ? [null, 0.08, null] : rosto))
  confere(quantos({ rostos: fadinha, quem: f07 }).length === 3, '(b) a fadinha voando, reconhecida e citada (o MRM E02 f07): entra', quantos({ rostos: fadinha, quem: f07 }))
  const deCostas = new Set(c.planos.filter((p) => lado(p.id) === 2).map((p) => p.id))
  confere(quantos({ rostos: fadinha, quem: f07, deCostas }).length === 0, '(b) o mesmo personagem, mas de costas (o Guy e a bruxa indo embora): recusa')
  const naMaoSemRosto = ligarGrid(entrada(c, { rostos: rostosDe(() => semRosto), quem: soOLent([1, 2]) }), 'f05')
  confere('escolha' in naMaoSemRosto && temGrid(naMaoSemRosto.escolha), '"Grid" na mao sem rosto e com o Lent nas duas: continua livre', naMaoSemRosto)

  // (c) O bonus: rostos de pessoas diferentes, ou rosto + o outro citado em acao.
  const nota = (extra: Partial<EntradaDoGrid>, x: Cenario = c): number => gridsAutomaticos(entrada(x, extra)).candidatas.find((o) => o.fraseId === 'f05')?.nota ?? NaN
  const semNada = nota({ quem: outra })
  const comBonus = nota({ rostos: rostosDe(() => rosto), quem: outra })
  confere(Math.abs(comBonus - semNada - 3) < 0.05, '(c) rostos visiveis de pessoas diferentes: +3 na nota', [comBonus, semNada])
  const doisPersonagens = naFrase(['lent', 'guy'], (id) => (lado(id) === 1 ? ['lent'] : lado(id) === 2 ? ['guy'] : []))
  const semRostoVisivel = nota({ rostos: rostosDe(() => [null, 0.08, null]), quem: doisPersonagens })
  confere(Math.abs(semRostoVisivel - nota({ quem: doisPersonagens })) < 0.05, '(c) dois personagens sem rosto visivel: sem bonus', [semRostoVisivel, nota({ quem: doisPersonagens })])
  const reacao = nota({ rostos: rostosDe((l) => (l === 1 ? rosto : [null, 0.08, null])), quem: doisPersonagens })
  confere(Math.abs(reacao - nota({ quem: doisPersonagens }) - 3) < 0.05, '(c) o rosto do Lent (reacao) + o Guy citado em acao: +3', [reacao, nota({ quem: doisPersonagens })])
  // O bonus escolhe a parceira: o Lent de longe (sem rosto legivel) em cima; embaixo o Guy com
  // rosto (40,5) ganha do Guy de longe (41): rosto + o Lent citado em acao.
  const acao = naFrase(['lent', 'guy'], (id) => (lado(id) === 1 ? ['lent'] : lado(id) === 2 || lado(id) === 4 ? ['guy'] : []))
  const longe = [null, 0.08, null]
  const escolhida = metadesDe(gridsAutomaticos(entrada(comAOutra, { quem: acao, rostos: rostosDe((l) => (l === 4 ? rosto : l === 1 || l === 2 ? longe : undefined)) })).escolhas)
  confere(escolhida.length === 3 && escolhida.every((m) => m === '1+4'), '(c) a parceira com rosto (40,5) ganha da de 41 sem rosto visivel, pelo bonus', escolhida)
  const semOBonus = metadesDe(gridsAutomaticos(entrada(comAOutra, { quem: acao, rostos: rostosDe((l) => (l === 1 || l === 2 || l === 4 ? longe : undefined)) })).escolhas)
  confere(semOBonus.every((m) => m === '1+2'), '(c) sem rosto em nenhuma, a de nota maior (41) continua', semOBonus)

  // A frase dividida pelo casar (os dois pedacos num grid so) e o grid no meio da cena: as mesmas regras.
  const dividida = cenario((x) => {
    x.frases[4] = { ...x.frases[4]!, texto: 'O artesao faz uma demonstracao, mas Nia acha o golpe fraco.', dur: 4.2 }
    const a = cand(x.planos, [id4(51)], 40)
    const b = cand(x.planos, [id4(55)], 38)
    x.escolhas[4] = { ...x.escolhas[4]!, hashTexto: hashDoTexto(x.frases[4]!.texto), cenas: [{ candidato: a, palavraInicio: 0 }, { candidato: b, palavraInicio: 5 }], fita: [a, b] }
    x.escolhas.forEach((e, k) => {
      if (k !== 4) e.fita = e.fita.slice(0, 1)
    })
  })
  const f05 = (x: Cenario, extra: Partial<EntradaDoGrid>): EscolhaDaFrase => gridsAutomaticos(entrada(x, extra)).escolhas.find((e) => e.fraseId === 'f05')!
  const nia = quem((id) => (id === '0051' || id === '0055' ? ['nia'] : []))
  const ed = f05(dividida, { quem: nia })
  confere(!temGrid(ed) && ed.cenas.length === 2, 'frase dividida com a Nia nos dois pedacos: as duas cenas ficam em sequencia', ed.cenas.map((x) => [x.candidato.planoIds, x.baixo?.planoIds]))
  const artesaoENia = quem((id) => (id === '0051' ? ['artesao'] : id === '0055' ? ['nia'] : []))
  confere(temGrid(f05(dividida, { quem: artesaoENia })), 'frase dividida com o artesao e a Nia: vira o grid')
  const semRostoEmbaixo = new Map<string, (number | null)[]>([['0051', rosto], ['0055', semRosto]])
  confere(!temGrid(f05(dividida, { quem: artesaoENia, rostos: semRostoEmbaixo })), 'frase dividida com um pedaco sem rosto: sem grid')
  const divididaNaMao = ligarGrid(entrada(dividida, { quem: nia }), 'f05')
  confere('escolha' in divididaNaMao && temGrid(divididaNaMao.escolha), 'na mao, a frase dividida com a mesma pessoa vira grid', divididaNaMao)

  const emendada = cenario((x) => {
    x.frases[4] = { ...x.frases[4]!, texto: 'A criada percebe como a garota voltou cheia de energia.', dur: 3.6 }
    x.planos[51]!.end = x.planos[51]!.start + 1.4
    x.planos[52]!.start = x.planos[51]!.end
    x.planos[52]!.end = x.planos[52]!.start + 3
    const span = cand(x.planos, ['0051', '0052'], 44.4)
    const outraCena = cand(x.planos, ['0055'], 40.9)
    x.escolhas[4] = { ...x.escolhas[4]!, hashTexto: hashDoTexto(x.frases[4]!.texto), cenas: [{ candidato: span, palavraInicio: 0 }], fita: [span, outraCena] }
    x.escolhas.forEach((e, k) => {
      if (k !== 4) e.fita = e.fita.slice(0, 1)
    })
  })
  const garotaEGarota = quem((id) => (id === '0052' || id === '0055' ? ['nia'] : id === '0051' ? ['criada'] : []))
  confere(!temGrid(f05(emendada, { quem: garotaEGarota })), 'no meio da cena com a garota nas duas metades: sem grid')
  const criadaEGarota = quem((id) => (id === '0052' ? ['nia'] : id === '0055' ? ['criada'] : []))
  const em2 = f05(emendada, { quem: criadaEGarota })
  confere(temGrid(em2) && em2.cenas[1]?.palavraInicio === 4, 'no meio da cena com a garota e a criada: o grid entra em "a garota"', em2.cenas.map((x) => [x.palavraInicio, x.candidato.planoIds, x.baixo?.planoIds]))
  const semRostoNoMeio = new Map<string, (number | null)[]>([['0052', rosto], ['0055', semRosto]])
  confere(!temGrid(f05(emendada, { quem: criadaEGarota, rostos: semRostoNoMeio })), 'no meio da cena com a metade de baixo sem rosto: sem grid')
}

pecas()
gatilho()
limites()
ordem()
noMeio()
naMaoEContrato()
montagem()
janelaEDetector()
parBom()

console.log(falhas === 0 ? '\nv-grid: tudo ok' : `\nv-grid: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
