/**
 * [recap] ARRUMAR O VISUAL (19/10, o teste real do Magic Repo Man E02), puro:
 *
 *   A. o foco no CITADO: o rosto identificado de quem o pedaco cita ganha do
 *      maior (mesmo pequeno), os dois citados que cabem entram juntos, os que
 *      nao cabem ficam com o 1o; sem identidade, o maior de sempre; a janela do
 *      1o citado sem rosto achado; o conjunto fechado do motor;
 *   B. os NOMES: o apelido da legenda ("MP" -> o rosto "Empee"), o citado no
 *      texto do pedaco na frente, o sujeito herdado da frase inteira e quem fala
 *      desempatando entre os citados;
 *   C. a variedade por PLANO na conta: o plano so volta quando a frase pede (a
 *      fala do momento cai nele), nunca 3 vezes; e a mesma cena (grupo visual);
 *   D. o MINIMO NA TELA: o pedaco da divisao, a emenda do encaixe, o span do
 *      casar, o semPiscar (frase dividida pela estimativa volta a uma cena, sem
 *      rajada de 3 curtas), o "antes da voz" e a config;
 *   E. o GANCHO legivel (2a rodada): a legibilidade (nao a luz media) so
 *      desempata entre candidatas de relevancia parecida; a ilegivel de
 *      relevancia fraca perde para a legivel relevante; a que bate o evento
 *      nunca perde para uma que nao bate; vale a frase inteira do gancho;
 *   F. o MESMO ASSUNTO (rosto + objeto) em 3 das ultimas 5 cenas pesa contra,
 *      menos quando a fala do momento cai no plano.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-arrumar-visual.ts
 */
import {
  apelidosDoIndice,
  apelidosPelaLegenda,
  assuntosDosPlanos,
  bateOMomento,
  casarFrases,
  citadosNoTexto,
  elencoDoEpisodio,
  elencoPrincipal,
  gruposVisuais,
  LEGIVEL,
  mesmoAssunto,
  prepararPlanos,
  relevanciaForte,
  type FraseDoCasar,
  type ResultadoDoCasar,
} from '../electron/cenas/casar'
import { nomesDaMontagem } from '../electron/montar/edicao-rapida'
import { chaveDoPedaco, type PedacoDaMontagem } from '../electron/montar/projeto'
import {
  candidatosDoPedaco,
  escolherNoPedaco,
  janelaDoFormato,
  type QuadroDoMotor,
  type RostoDoMotor,
  type RostosDoPedaco,
} from '../electron/montar/rostos-motor'
import { escolhasDesatualizadas, temposDasCenas, trechosDoCandidato, type CandidatoDeCena, type EscolhaDaFrase } from '../shared/cenas'
import { aplicarPatch, CENAS_PADRAO, coerceConfig, CONFIG_PADRAO } from '../shared/config'
import { cortarFrase, minimoNaTela, MINIMO_NA_TELA_PADRAO_SEC } from '../shared/divisao'
import { encaixarEscolha, semPiscar, type ContextoDoEncaixe } from '../shared/encaixe'
import type { Cue, EpisodeIndex, Plano } from '../shared/episodio'
import type { Evento } from '../shared/roteiro'
import { LEITURA_ALTURA, LEITURA_LARGURA, legibilidadeDoQuadro, objetosDasTags, type QuadroDaVisao } from '../shared/visao'
import { hashDoTexto, palavrasDaFrase, type TakeDaVoz } from '../shared/voz'

let falhas = 0
function confere(ok: boolean, mensagem: string, extra?: unknown): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}${extra === undefined ? '' : ` -> ${JSON.stringify(extra).slice(0, 400)}`}`)
  }
}
const perto = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol

// ------------------------------------------------------------ montagem do teste

type TakeDoTeste = Pick<TakeDaVoz, 'id' | 'trechos' | 'palavras' | 'duracao'>

/** Um take montado a mao: cada frase com a duracao dada e as palavras repartidas por igual. */
function takeDe(frases: readonly { id: string; texto: string; dur: number }[]): TakeDoTeste {
  const palavras: TakeDaVoz['palavras'] = []
  const trechos: TakeDaVoz['trechos'] = []
  let offset = 0
  for (const f of frases) {
    const ws = palavrasDaFrase(f.texto)
    const passo = (f.dur - 0.2) / ws.length
    ws.forEach((w, i) => palavras.push({ texto: w, start: offset + 0.1 + i * passo, end: offset + 0.1 + (i + 0.9) * passo, fraseId: f.id } as TakeDaVoz['palavras'][number]))
    trechos.push({ fraseId: f.id, offset, duracao: f.dur, hashTexto: hashDoTexto(f.texto), texto: f.texto } as TakeDaVoz['trechos'][number])
    offset += f.dur
  }
  return { id: 't1', trechos, palavras, duracao: offset }
}

const fr = (id: string, texto: string, extra: Partial<FraseDoCasar> = {}): FraseDoCasar => ({
  id,
  texto,
  eventoIds: [],
  cueDoMomento: null,
  citacaoCueId: null,
  intencaoVisual: '',
  ...extra,
})

const EP = `ep_${'d'.repeat(40)}`
function plano(id: string, start: number, end: number, extra: Partial<Plano> = {}): Plano {
  return { id, start, end, arquivo: `C:/fake/${id}.mp4`, keyframe: `C:/fake/${id}_1.jpg`, cueIds: [], falantes: [], personagens: [], ...extra }
}

// ------------------------------------------------------------ A. o foco

function rosto(x: number, w: number, extra: Partial<RostoDoMotor> = {}): RostoDoMotor {
  return { x, y: 300, w, h: w, conf: 0.8, tipo: 'rosto', personagem: null, pessoa: null, sim: null, quem: null, ...extra }
}
const tres = (rostos: RostoDoMotor[], janelas?: QuadroDoMotor['janelas'][]): QuadroDoMotor[] =>
  [0, 1, 2].map((q) => ({ t: q, ok: true, rostos, ...(janelas?.[q] ? { janelas: janelas[q] } : {}) }))
const pedaco = (quadros: QuadroDoMotor[]): RostosDoPedaco => ({ largura: 1920, altura: 1080, quadros })
const JANELA = janelaDoFormato(1920, 1080, 'short')

function foco(): void {
  console.log('\n== A. O foco no citado')
  {
    // MRM E02 "O Lent passou cinco anos": a Misa grande na esquerda, o Lent pequeno no meio.
    const misa = rosto(0, 400, { pessoa: 'Misa' })
    const lent = rosto(880, 150, { pessoa: 'Lent', personagem: 'Lent' })
    const e = escolherNoPedaco(pedaco(tres([misa, lent])), ['Lent'], ['Lent'], JANELA)
    confere(e.como === 'citado' && e.personagem === 'Lent' && perto(e.centro!.centroX, (880 + 75) / 1920, 1e-3), 'o citado pequeno (0,14 do maior) ganha da Misa grande', e)
    const sem = escolherNoPedaco(pedaco(tres([misa, rosto(880, 150)])), ['Lent'], ['Lent'], JANELA)
    confere(sem.como === 'maior' && perto(sem.centro!.centroX, 200 / 1920, 1e-3), 'sem identidade: o maior rosto, como antes', sem)
  }
  {
    // Os dois citados cabem (o Lent e a fadinha lado a lado): os dois no quadro.
    const lent = rosto(700, 200, { personagem: 'Lent', pessoa: 'Lent' })
    const mp = rosto(980, 80, { personagem: 'Empee', pessoa: 'Empee' })
    const e = escolherNoPedaco(pedaco(tres([lent, mp])), ['Lent', 'Empee'], [], JANELA)
    confere(e.como === 'citado' && e.juntos === 1 && e.centro!.centroX > (700 + 100) / 1920, 'dois citados que cabem entram juntos', e)
    // Nao cabem (um em cada ponta): fica o 1o citado.
    const longe = rosto(1700, 150, { personagem: 'Empee', pessoa: 'Empee' })
    const e2 = escolherNoPedaco(pedaco(tres([lent, longe])), ['Empee', 'Lent'], [], JANELA)
    confere(e2.personagem === 'Empee' && e2.juntos === 0 && perto(e2.centro!.centroX, 1775 / 1920, 1e-3), 'nao cabem: o 1o citado (Empee), sozinho', e2)
  }
  {
    // "O Guy e as garotas": a Misa com mais confianca no indice, o Guy citado primeiro.
    const misa = rosto(280, 270, { personagem: 'Misa', pessoa: 'Misa' })
    const guy = rosto(945, 300, { personagem: 'Guy', pessoa: 'Guy' })
    const elle = rosto(1460, 240, { personagem: 'Elle', pessoa: 'Elle' })
    const e = escolherNoPedaco(pedaco(tres([misa, guy, elle])), ['Guy', 'Misa', 'Elle'], ['Misa', 'Guy', 'Elle'], JANELA)
    confere(e.personagem === 'Guy' && Math.abs(e.centro!.centroX - (945 + 150) / 1920) < 0.15, 'a ordem e a do texto, nao a confianca do indice', e)
  }
  {
    // A fadinha de costas em close (sem rosto achado) e o Lent achado: a janela dela, 2 de 3 instantes.
    const lent = rosto(1309, 395, { personagem: 'Lent', pessoa: 'Lent' })
    const jan = (x: number, quem: string, personagem: string | null) => ({ x, w: 528, quem, sim: 0.85, personagem })
    const janelas = [
      [jan(0, 'Empee', null), jan(328, 'Empee', null), jan(1313, 'Lent', 'Lent')],
      [jan(0, 'Empee', null), jan(328, 'Empee', 'Empee'), jan(1313, 'Lent', 'Lent')],
      [jan(0, 'Empee', null), jan(328, 'Empee', 'Empee'), jan(1313, 'Lent', 'Lent')],
    ]
    const e = escolherNoPedaco(pedaco(tres([lent], janelas)), ['Empee', 'Lent'], [], JANELA)
    confere(e.como === 'janela' && e.personagem === 'Empee' && perto(e.centro!.centroX, (328 + 264) / 1920, 1e-3), '"Ela ativou": a janela da fadinha ganha do Lent (citado depois)', e)
    const so1 = [janelas[0]!, janelas[0]!, janelas[2]!]
    const e2 = escolherNoPedaco(pedaco(tres([lent], so1)), ['Empee', 'Lent'], [], JANELA)
    confere(e2.como === 'citado' && e2.personagem === 'Lent', 'a janela em 1 de 3 instantes nao basta: o Lent', e2)
    const e3 = escolherNoPedaco(pedaco(tres([lent], janelas)), ['Lent', 'Empee'], [], JANELA)
    confere(e3.como === 'citado' && e3.personagem === 'Lent', 'a janela de um citado DEPOIS do achado nao conta', e3)
  }
  {
    // Rosto miudo demais (figurante de fundo marcado) nao puxa o quadro.
    const grande = rosto(100, 600)
    const miudo = rosto(1500, 90, { personagem: 'Lent', pessoa: 'Lent' })
    const e = escolherNoPedaco(pedaco(tres([grande, miudo])), ['Lent'], [], JANELA)
    confere(e.como === 'maior', 'citado com 0,02 do maior rosto fica de fora (o figurante de fundo)', e)
  }
  {
    const c = candidatosDoPedaco(['Empee', 'Lent'], ['Lent', 'Misa'], ['Lent', 'Empee', 'Guy', 'Misa', 'Elle'])
    confere(c.join(',') === 'Empee,Lent,Misa,Guy,Elle', 'conjunto fechado: os citados, o plano e o elenco principal, uma vez cada', c)
    confere(candidatosDoPedaco([], ['Lent'], ['Lent', 'Guy']).length === 0, 'sem citado: nao identifica (o maior rosto)')
  }
}

// ------------------------------------------------------------ B. os nomes

/**
 * 40 planos de 3 s: a fadinha (rosto "Empee", falante "MP") no 0-19, o Lent
 * (rosto e falante) no 10-29, o Guy no 30-39.
 */
function indiceDosNomes(): Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'> {
  const planos: Plano[] = []
  const cues: Cue[] = []
  for (let i = 0; i < 40; i++) {
    const id = String(i + 1).padStart(4, '0')
    const personagens: Plano['personagens'] = []
    if (i < 20) personagens.push({ nome: 'Empee', conf: 0.95, fonte: 'ancut' })
    if (i >= 10 && i < 30) personagens.push({ nome: 'Lent', conf: 0.9, fonte: 'ancut' })
    if (i >= 30) personagens.push({ nome: 'Guy', conf: 0.9, fonte: 'ancut' })
    const falante = i < 10 ? 'MP' : i < 30 ? 'Lent' : 'Guy'
    const cueId = `c${id}`
    cues.push({ id: cueId, start: i * 3 + 0.5, end: i * 3 + 2.5, texto: `fala ${i}`, falante, estilo: 'Default', tipo: 'fala' })
    planos.push(plano(id, i * 3, i * 3 + 3, { cueIds: [cueId], falantes: [falante], personagens }))
  }
  return { id: EP, planos, cues, exclusoes: [] }
}

function nomes(): void {
  console.log('\n== B. Os nomes')
  const indice = indiceDosNomes()
  const ap = apelidosPelaLegenda(indice)
  confere(ap.get('MP') === 'Empee' && ap.size === 1, 'o falante "MP" e o rosto "Empee" (apelido pela legenda)', [...ap])
  confere(apelidosDoIndice(indice).get('MP') === 'Empee', 'o apelidosDoIndice (a sigla soletrada + a legenda) tambem', [...apelidosDoIndice(indice)])
  // Poucas falas com rosto: a legenda sozinha nao faz apelido (a sigla soletrada e outra regra).
  const pouco = { ...indice, cues: indice.cues.filter((c) => c.falante !== 'MP' || Number(c.id.slice(1)) <= 5) }
  confere(apelidosPelaLegenda(pouco).size === 0, 'com 5 falas so, a legenda nao faz apelido')
  confere(elencoPrincipal(indice).join(',') === 'Empee,Lent,Guy', 'o elenco principal: quem mais aparece', elencoPrincipal(indice))
  const todos = prepararPlanos(indice)
  const elenco = elencoDoEpisodio(todos, indice, [])
  const c = citadosNoTexto('O poder do Lent evolui junto da fadinha MP.', elenco)
  confere(c.map((x) => x.ficha).join(',') === 'lent,empee' && c[1]?.rotulo === 'MP', '"a fadinha MP" cita a Empee (ficha de 2 letras pelo apelido)', c)
  confere(todos[0]!.falas[0]?.fichas.join() === 'empee', 'a fala da "MP" conta como a Empee no casar', todos[0]!.falas)

  // A montagem: cada pedaco com quem o TEXTO DELE cita na frente.
  const frases = [
    { id: 'f01', texto: 'O poder do Lent evolui pro rank SSS junto da fadinha MP.', eventoIds: ['e01'] },
    { id: 'f02', texto: 'E ao checar o historico, ele descobre algo absurdo.', eventoIds: ['e01'] },
    { id: 'f03', texto: 'E a fadinha MP armou a maior cilada de todas.', eventoIds: ['e01'] },
    { id: 'f04', texto: 'Ela ativou o temido pagamento rotativo de mana!', eventoIds: ['e01'] },
  ]
  const roteiro = { secoes: [{ frases }] } as unknown as Parameters<typeof nomesDaMontagem>[1]
  const eventos: Pick<Evento, 'id' | 'personagens'>[] = [{ id: 'e01', personagens: ['Lent', 'MP'] }]
  const escolhas = [
    { fraseId: 'f01', cenas: [{ palavraInicio: 0 }, { palavraInicio: 5 }] },
    { fraseId: 'f02', cenas: [{ palavraInicio: 0 }] },
    { fraseId: 'f03', cenas: [{ palavraInicio: 0 }] },
    { fraseId: 'f04', cenas: [{ palavraInicio: 0 }] },
  ] as unknown as Parameters<typeof nomesDaMontagem>[4]
  // f01/1 mostra um plano em que a MP fala (planos 0-9); os outros, onde o Lent fala.
  const pc = (fraseId: string, cena: number, planoId: string): PedacoDaMontagem => ({
    fraseId,
    secao: 0,
    cena,
    planoId,
    arquivo: `C:/fake/${planoId}.mp4`,
    de: 0,
    ate: 2,
    inicio: 0,
    fim: 2,
    porque: [],
  })
  const pedacos = [pc('f01', 0, '0015'), pc('f01', 1, '0002'), pc('f02', 0, '0016'), pc('f03', 0, '0017'), pc('f04', 0, '0018')]
  const n = nomesDaMontagem(pedacos, roteiro, eventos, indice, escolhas)
  const de = (p: PedacoDaMontagem): string => (n.porPedaco.get(chaveDoPedaco(p)) ?? []).join(',')
  confere(de(pedacos[0]!).startsWith('Lent'), '"O poder do Lent evolui": o Lent na frente', de(pedacos[0]!))
  confere(de(pedacos[1]!).startsWith('Empee'), '"...junto da fadinha MP": a Empee (o nome do rosto) na frente', de(pedacos[1]!))
  confere(de(pedacos[2]!).startsWith('Lent'), '"ele descobre": o sujeito da frase de antes e o Lent (o 1o citado), nao a MP do fim', de(pedacos[2]!))
  confere(de(pedacos[4]!).startsWith('Empee'), '"Ela ativou": a MP da frase de antes', de(pedacos[4]!))
  confere((n.porFrase.get('f01') ?? []).join(',') === 'Lent,Empee', 'a frase inteira (studio.secoes): Lent, Empee', n.porFrase.get('f01'))
  // Quem fala desempata entre os citados do pedaco: "Lent ... MP" com a MP falando no plano.
  const n2 = nomesDaMontagem([pc('f01', 0, '0003')], roteiro, eventos, indice, [{ fraseId: 'f01', cenas: [{ palavraInicio: 0 }] }] as unknown as Parameters<typeof nomesDaMontagem>[4])
  confere((n2.porPedaco.get(chaveDoPedaco(pc('f01', 0, '0003'))) ?? [])[0] === 'Empee', 'dois citados no pedaco e a MP falando no plano: ela na frente', n2.porPedaco.get(chaveDoPedaco(pc('f01', 0, '0003'))))
}

// ------------------------------------------------------------ C. variedade por plano

/**
 * Um evento de 0 a 40 s num plano LONGO (0010, 10-30 s) cercado de planos de
 * 2 s; tres frases do mesmo evento. `cues`: em que segundos caem as falas do
 * momento de cada frase (null = frase sem cue do momento).
 */
function indiceDoPlanoLongo(cues: (number | null)[]): { indice: Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'>; frases: FraseDoCasar[]; eventos: Evento[] } {
  const planos: Plano[] = []
  for (let i = 0; i < 5; i++) planos.push(plano(String(i + 1).padStart(4, '0'), i * 2, i * 2 + 2))
  planos.push(plano('0010', 10, 30))
  for (let i = 0; i < 5; i++) planos.push(plano(String(i + 11).padStart(4, '0'), 30 + i * 2, 32 + i * 2))
  const cs: Cue[] = cues.flatMap((t, k) => (t === null ? [] : [{ id: `c${k + 1}`, start: t, end: t + 1.5, texto: `fala ${k}`, falante: null, estilo: 'Default', tipo: 'fala' as const }]))
  for (const p of planos) p.cueIds = cs.filter((c) => c.start < p.end && c.end > p.start).map((c) => c.id)
  const eventos: Evento[] = [{ id: 'e01', cueIds: cs.map((c) => c.id), t0: 0, t1: 40, resumo: 'algo', personagens: [], peso: 3 }]
  const frases = cues.map((t, k) => fr(`f0${k + 1}`, `Frase numero ${k + 1} com algumas palavras.`, { eventoIds: ['e01'], cueDoMomento: t === null ? null : `c${k + 1}` }))
  return { indice: { id: EP, planos, cues: cs, exclusoes: [] }, frases, eventos }
}

function vezesDoPlano(r: ResultadoDoCasar, id: string): number {
  return r.casadas.flatMap((c) => c.escolha.cenas).filter((c) => c.candidato.planoIds.includes(id)).length
}

function variedade(): void {
  console.log('\n== C. A variedade por plano')
  const casar = (cues: (number | null)[]): ResultadoDoCasar => {
    const { indice, frases, eventos } = indiceDoPlanoLongo(cues)
    const take = takeDe(frases.map((f) => ({ id: f.id, texto: f.texto, dur: 2 })))
    return casarFrases({ indice, eventos, frases, take, fixas: new Map(), refazer: new Set(frases.map((f) => f.id)), divisao: null })
  }
  // As tres frases com a fala do momento no plano longo: nunca 3 vezes (a repeticao pedida pesa -30).
  const todas = casar([12, 19, 26])
  const n = vezesDoPlano(todas, '0010')
  confere(n >= 1 && n <= 2, `tres frases pedem o plano longo: ele entra ${n} vez(es), nunca 3`, todas.casadas.map((c) => c.escolha.cenas[0]?.candidato.planoIds))
  // Sem o limite (o casar de antes) as tres pegavam o plano longo: o caso e o mesmo.
  confere(todas.casadas.every((c) => c.escolha.cenas.length === 1), 'cada frase com uma cena')
  // So a 1a pede: o plano longo uma vez so.
  const uma = casar([12, null, null])
  confere(vezesDoPlano(uma, '0010') === 1, 'sem a frase pedir, o plano nao volta (outro trecho dele)', uma.casadas.map((c) => c.escolha.cenas[0]?.candidato.planoIds))

  // A mesma cena: planos vizinhos quase iguais no CLIP viram um grupo.
  const v = (x: number[]): Float32Array => {
    const a = new Float32Array(4)
    x.forEach((y, i) => (a[i] = y))
    const n = Math.hypot(...a)
    return a.map((y) => y / n)
  }
  const ps = prepararPlanos({ planos: [plano('a', 0, 2), plano('b', 2, 4), plano('c', 4, 6), plano('d', 6, 8)], cues: [], exclusoes: [] })
  const q = (vetor: Float32Array): QuadroDaVisao[] => [{ k: 1, pos: 0.5, arquivo: '', vetor, beleza: null, nitidez: null }]
  const g = gruposVisuais(ps, new Map([['a', q(v([1, 0, 0, 0]))], ['b', q(v([0, 1, 0, 0]))], ['c', q(v([1, 0.1, 0, 0]))], ['d', q(v([0, 0, 1, 0]))]]))
  confere(g.get('a') === g.get('c') && g.get('a') !== g.get('b') && g.get('d') !== g.get('a'), 'plano e contraplano (a, c) sao a mesma cena; b e d nao', [...g])
}

// ------------------------------------------------------------ D. minimo na tela

function minimo(): void {
  console.log('\n== D. O minimo na tela')
  {
    // "So que no fim," fica com 0,7 s numa voz rapida: so o minimo baixo deixa cortar ali.
    const f = { id: 'f01', texto: 'So que no fim, os parceiros jogaram ele na rua.' }
    const take = takeDe([{ ...f, dur: 2.2 }])
    const c06 = cortarFrase(f, take, 2, 0.6)
    const c1 = cortarFrase(f, take, 2, 1)
    confere(!!c06 && c06.pedacos.some((p) => p.fim - p.inicio < 1), 'com minimo 0,6 s o corte na virgula deixa um pedaco de 0,7 s', c06?.pedacos)
    confere(!c1 || c1.pedacos.every((p) => p.fim - p.inicio >= 1 - 1e-6), 'com o minimo de 1,0 s: nenhum pedaco abaixo', c1?.pedacos)
  }
  {
    // A emenda nao entra em plano mais curto que o minimo (os 0,63 s do contador do MRM E02).
    const planos = [plano('0001', 100, 100.63), plano('0002', 100.63, 101.26), plano('0003', 101.26, 101.89)]
    const indice = { id: EP, planos, cues: [], exclusoes: [] }
    const texto = 'Eles vao passar o dia todo sem sobrar nada de magia.'
    const take = takeDe([{ id: 'f01', texto, dur: 2.5 }])
    const cand: CandidatoDeCena = { planoIds: ['0001'], episodioId: EP, inSec: 100, outSec: 100.63, nota: 0, porque: [], origem: 'sugestao', keyframe: null }
    const esc: EscolhaDaFrase = { fraseId: 'f01', cenas: [{ candidato: cand, palavraInicio: 0 }], fita: [cand], confianca: 0.5, travada: false, hashTexto: hashDoTexto(texto), duracao: 0, avisos: [] }
    const ctx: ContextoDoEncaixe = { indice, frase: { id: 'f01', texto, citacaoCueId: null, cueDoMomento: null, eventoIds: [] }, take }
    const r = encaixarEscolha(esc, ctx)
    const pedacos = trechosDoCandidato(r.escolha.cenas[0]!.candidato, planos).map((t) => t.ate - t.de)
    confere(r.escolha.cenas[0]!.candidato.planoIds.join() === '0001', 'planos de 0,63 s nao entram na emenda: o 1o segura o quadro', { planos: r.escolha.cenas[0]!.candidato.planoIds, pedacos })
    const r08 = encaixarEscolha(esc, { ...ctx, minimoSec: 0.6 })
    confere(r08.escolha.cenas[0]!.candidato.planoIds.length > 1, 'com o minimo em 0,6 s (a config), a emenda volta', r08.escolha.cenas[0]!.candidato.planoIds)
  }
  {
    // O span do casar: planos de 0,6 s nunca viram um span de relances.
    const planos: Plano[] = []
    for (let i = 0; i < 12; i++) planos.push(plano(String(i + 1).padStart(4, '0'), i * 0.65, (i + 1) * 0.65))
    for (let i = 0; i < 6; i++) planos.push(plano(String(i + 13).padStart(4, '0'), 7.8 + i * 3, 10.8 + i * 3))
    const indice = { id: EP, planos, cues: [], exclusoes: [] }
    const eventos: Evento[] = [{ id: 'e01', cueIds: [], t0: 0, t1: 8, resumo: 'algo', personagens: [], peso: 3 }]
    const frases = [fr('f01', 'Eles vao passar o dia todo sem sobrar nada.', { eventoIds: ['e01'] })]
    const take = takeDe([{ id: 'f01', texto: frases[0]!.texto, dur: 2.5 }])
    const r = casarFrases({ indice, eventos, frases, take, fixas: new Map(), refazer: new Set(['f01']), divisao: null })
    const c = r.casadas[0]!.escolha.cenas[0]!.candidato
    const ruim = c.planoIds.length > 1 && c.planoIds.some((id) => planos.find((p) => p.id === id)!.end - planos.find((p) => p.id === id)!.start < 1)
    confere(!ruim, 'o casar nao emenda planos de 0,65 s (o span de relances)', c.planoIds)
  }
  {
    // semPiscar: a frase dividida pela estimativa e a voz rapida (pedaco de 0,7 s) volta a ter uma cena.
    const planos = [plano('0001', 0, 10), plano('0002', 10, 20), plano('0003', 20, 30)]
    const indice = { id: EP, planos, cues: [], exclusoes: [] }
    const textos = ['So que no fim, os parceiros jogaram ele na rua.', 'Mas e aqui que a historia vira de vez.', 'O poder do Lent evolui pro rank mais alto.']
    const take = takeDe([
      { id: 'f01', texto: textos[0]!, dur: 1.9 },
      { id: 'f02', texto: textos[1]!, dur: 1.1 },
      { id: 'f03', texto: textos[2]!, dur: 2.4 },
    ])
    const cand = (id: string, de: number): CandidatoDeCena => ({ planoIds: [id], episodioId: EP, inSec: de, outSec: de + 4, nota: 0, porque: [], origem: 'sugestao', keyframe: null })
    const dividida = (fraseId: string, texto: string, travada: boolean, corte = 3): EscolhaDaFrase => ({
      fraseId,
      cenas: [
        { candidato: cand('0001', 0), palavraInicio: 0 },
        { candidato: cand('0002', 10), palavraInicio: corte },
      ],
      fita: [cand('0001', 0), cand('0002', 10)],
      confianca: 0.5,
      travada,
      hashTexto: hashDoTexto(texto),
      duracao: 0,
      avisos: [],
      inteira: [cand('0003', 20)],
    })
    const frases = new Map(textos.map((t, i) => [`f0${i + 1}`, { id: `f0${i + 1}`, texto: t, citacaoCueId: null, cueDoMomento: null, eventoIds: [] }]))
    const ctx = (id: string): ContextoDoEncaixe | null => (frases.has(id) ? { indice, frase: frases.get(id)!, take } : null)
    const e1 = dividida('f01', textos[0]!, false)
    const durs = temposDasCenas(e1, frases.get('f01')!, take).map((t) => t.fim - t.inicio)
    const r = semPiscar([e1], ctx, 1)
    confere(durs.some((d) => d < 1) && r.escolhas[0]!.cenas.length === 1 && r.escolhas[0]!.cenas[0]!.candidato.planoIds[0] === '0003', `pedaco de ${Math.min(...durs).toFixed(2)} s: volta a uma cena (a melhor da frase inteira)`, r.escolhas[0])
    confere(r.juntadas.join() === 'f01', 'o semPiscar diz quem juntou', r.juntadas)
    const travada = semPiscar([dividida('f01', textos[0]!, true)], ctx, 1)
    confere(travada.escolhas[0]!.cenas.length === 2 && travada.juntadas.length === 0, 'a que ele mexeu (travada) fica como esta')
    confere(JSON.stringify(semPiscar(r.escolhas, ctx, 1).escolhas) === JSON.stringify(r.escolhas), 'idempotente')
    // A rajada: 3 cenas seguidas abaixo de 1,2 s (pedacos de 1,1 s): a dividida junta.
    const take2 = takeDe([
      { id: 'f01', texto: textos[0]!, dur: 2.2 },
      { id: 'f02', texto: textos[1]!, dur: 1.1 },
      { id: 'f03', texto: textos[2]!, dur: 2.4 },
    ])
    const ctx2 = (id: string): ContextoDoEncaixe | null => (frases.has(id) ? { indice, frase: frases.get(id)!, take: take2 } : null)
    const e = dividida('f01', textos[0]!, false, 5)
    const ds = temposDasCenas(e, frases.get('f01')!, take2).map((t) => t.fim - t.inicio)
    const unica = (id: string): EscolhaDaFrase => ({ ...dividida(id, frases.get(id)!.texto, false), cenas: [{ candidato: cand('0002', 10), palavraInicio: 0 }] })
    const rj = semPiscar([e, unica('f02'), unica('f03')], ctx2, 1)
    confere(ds.every((d) => d >= 1 && d < 1.2) && rj.juntadas.join() === 'f01', `rajada (${ds.map((d) => d.toFixed(2)).join(' + ')} + 1,10): a frase dividida junta`, { ds, juntadas: rj.juntadas })
    // Sem a 3a curta (a frase seguinte longa): a dividida fica com as duas cenas.
    const take3 = takeDe([
      { id: 'f01', texto: textos[0]!, dur: 2.2 },
      { id: 'f02', texto: textos[1]!, dur: 2 },
      { id: 'f03', texto: textos[2]!, dur: 2.4 },
    ])
    const ctx3 = (id: string): ContextoDoEncaixe | null => (frases.has(id) ? { indice, frase: frases.get(id)!, take: take3 } : null)
    const sem = semPiscar([e, unica('f02'), unica('f03')], ctx3, 1)
    confere(sem.juntadas.length === 0 && sem.escolhas[0]!.cenas.length === 2, 'duas curtas seguidas (sem a 3a) ficam como estao', sem.juntadas)
  }
  {
    // "Antes da voz": sugeridas pela estimativa antes do take; as travadas ficam.
    const roteiro = { secoes: [{ frases: [{ id: 'f01', texto: 'a b c' }, { id: 'f02', texto: 'd e f' }] }] } as unknown as Parameters<typeof escolhasDesatualizadas>[0]
    const esc = (id: string, travada: boolean) => ({ fraseId: id, travada, hashTexto: hashDoTexto(id === 'f01' ? 'a b c' : 'd e f'), duracao: 1 }) as unknown as EscolhaDaFrase
    const take = { id: 't1', trechos: [], criadoEm: '2026-10-19T00:43:44.189Z' }
    const d = escolhasDesatualizadas(roteiro, take, { escolhas: [esc('f01', false), esc('f02', true)], takeId: 't1', sugeridasEm: '2026-10-19T00:15:48.901Z' })
    confere(d.antesDaVoz.join() === 'f01', 'sugeridas antes do take: a nao travada volta ao casar', d.antesDaVoz)
    const depois = escolhasDesatualizadas(roteiro, take, { escolhas: [esc('f01', false)], takeId: 't1', sugeridasEm: '2026-10-19T02:28:50.956Z' })
    confere(depois.antesDaVoz.length === 0, 'sugeridas depois do take: nada a refazer')
  }
  {
    confere(CENAS_PADRAO.minimoNaTela === MINIMO_NA_TELA_PADRAO_SEC && MINIMO_NA_TELA_PADRAO_SEC === 1, 'padrao: 1,0 s')
    confere(coerceConfig({ cenas: { minimoNaTela: 9 } }).cenas.minimoNaTela === 1 && minimoNaTela('x') === 1, 'minimo fora da faixa vale o padrao')
    const p = aplicarPatch(CONFIG_PADRAO, { cenas: { minimoNaTela: 1.2 } })
    confere(p.cenas.minimoNaTela === 1.2 && p.cenas.duasCenas && p.cenas.limiarDuasCenas === 3, 'mudar so o minimo nao mexe no resto')
  }
}

// ------------------------------------------------------------ E. o gancho legivel

/** Um quadro sintetico (LEITURA_LARGURA x LEITURA_ALTURA, RGB) pintado por `cor(x, y)`. */
function quadro(cor: (x: number, y: number) => [number, number, number]): Uint8Array {
  const rgb = new Uint8Array(LEITURA_LARGURA * LEITURA_ALTURA * 3)
  for (let y = 0; y < LEITURA_ALTURA; y++) {
    for (let x = 0; x < LEITURA_LARGURA; x++) {
      const [r, g, b] = cor(x, y)
      const i = 3 * (y * LEITURA_LARGURA + x)
      rgb[i] = r
      rgb[i + 1] = g
      rgb[i + 2] = b
    }
  }
  return rgb
}

function gancho(): void {
  console.log('\n== E. O gancho legivel')
  // A legibilidade: o escuro por igual cai; o escuro com olho aceso e o claro com forma passam.
  const lido = (rgb: Uint8Array): number => legibilidadeDoQuadro(rgb, LEITURA_LARGURA, LEITURA_ALTURA)
  const escuroIgual = lido(quadro((x) => [40 + (x % 3), 42, 50]))
  // Tres rostos escuros (cabelo listrado) com os olhos vermelhos acesos e o brilho em volta, num fundo quase preto.
  const olhosAcesos = lido(
    quadro((x, y) => {
      for (const cx of [20, 48, 76]) {
        const dx = x - cx
        const dy = y - 24
        if ((Math.abs(dx - 5) < 3 || Math.abs(dx + 5) < 3) && Math.abs(dy) < 2) return [255, 30, 40]
        if ((Math.abs(dx - 5) < 5 || Math.abs(dx + 5) < 5) && Math.abs(dy) < 4) return [150, 30, 50]
        if (Math.abs(dx) < 11 && Math.abs(dy) < 16) return y % 4 < 2 ? [80, 60, 95] : [45, 35, 60]
      }
      return [15, 10, 20]
    }),
  )
  const claro = lido(quadro((x, y) => ((Math.floor(x / 6) + Math.floor(y / 6)) % 2 === 0 ? [230, 220, 200] : [60, 90, 140])))
  confere(escuroIgual < LEGIVEL, `o escuro por igual (o queixo na chuva) e ilegivel: ${escuroIgual.toFixed(2)}`)
  confere(olhosAcesos >= LEGIVEL, `escuro com olho aceso (o grupo de olhos vermelhos) passa: ${olhosAcesos.toFixed(2)}`)
  confere(claro > 0.9, `claro com forma: ${claro.toFixed(2)}`)
  confere(legibilidadeDoQuadro(new Uint8Array(3), 10, 10) === 0, 'quadro sem pixels: 0')

  // A relevancia: forte (o rosto de quem a frase cita, o momento forte, a fala citada) e o que "bate".
  const t = (chave: string, valor: number, rotulo = chave) => ({ chave, valor, rotulo })
  confere(relevanciaForte([t('pessoa', 20, 'Lent')], { forte: false }) && !relevanciaForte([t('pessoa', 8, 'Lent fala')], { forte: false }), 'o rosto citado e forte; a fala de fora de quadro nao')
  confere(relevanciaForte([t('janela', 40, 'no momento')], { forte: true }) && !relevanciaForte([t('janela', 38, 'no momento')], { forte: false }), 'o momento forte e forte; o estimado pelas palavras nao')
  confere(!relevanciaForte([t('janela', 30, 'no evento'), t('imagem', 6, 'parecido')], { forte: true }) && bateOMomento([t('janela', 30, 'no evento')], { forte: false }), '"no evento" + "parecido": fraca, mas bate o evento')

  // O caso do MRM E02: dois planos no evento, o 0001 ilegivel (e um pouco mais perto) e o 0002 legivel.
  const planos = [plano('0001', 10, 14), plano('0002', 15, 19), plano('0003', 30, 34), plano('0004', 35, 39), plano('0005', 40, 44)]
  const cues: Cue[] = [{ id: 'c1', start: 11, end: 12.5, texto: 'Get out of here', falante: null, estilo: 'Default', tipo: 'fala' }]
  planos[0]!.cueIds = ['c1']
  const indice = { id: EP, planos, cues, exclusoes: [] }
  const eventos: Evento[] = [
    { id: 'e01', cueIds: ['c1'], t0: 10, t1: 19, resumo: 'expulso', personagens: [], peso: 3 },
    { id: 'e02', cueIds: [], t0: 30, t1: 44, resumo: 'depois', personagens: [], peso: 3 },
  ]
  const ruim = 0.1
  const boa = 0.9
  const leitura = (l1: number, l2 = boa): Map<string, (number | null)[]> =>
    new Map<string, (number | null)[]>([
      ['0001', [l1, l1, l1]],
      ['0002', [l2, l2, l2]],
      ['0003', [ruim, ruim, ruim]],
      ['0004', [boa, boa, boa]],
      ['0005', [boa, boa, boa]],
    ])
  const texto = 'Esse cara foi expulso por ser inutil.'
  const casar = (frases: FraseDoCasar[], l: Map<string, (number | null)[]> | null, abrem?: Set<string>, ind = indice): ResultadoDoCasar => {
    const take = takeDe(frases.map((f) => ({ id: f.id, texto: f.texto, dur: 2 })))
    return casarFrases({ indice: ind, eventos, frases, take, fixas: new Map(), refazer: new Set(frases.map((f) => f.id)), divisao: null, ...(l ? { leitura: l } : {}), ...(abrem ? { abrem } : {}) })
  }
  const primeiro = (r: ResultadoDoCasar, id = 'f01'): string => r.casadas.find((c) => c.escolha.fraseId === id)!.escolha.cenas[0]!.candidato.planoIds[0]!
  const so = [fr('f01', texto, { eventoIds: ['e01'] })]
  confere(primeiro(casar(so, null)) === '0001', 'sem a leitura medida: o plano mais perto (0001), como antes')
  confere(primeiro(casar(so, leitura(ruim))) === '0002', 'ilegivel e de relevancia fraca: perde para a legivel do mesmo evento (0002)')
  confere(primeiro(casar(so, leitura(0.55))) === '0001', 'escuro mas legivel (0,55): nada muda (0001)')
  // O momento FORTE (a cue do momento) no plano ilegivel: so desempata, e o 0001 e bem mais relevante.
  const forte = [fr('f01', texto, { eventoIds: ['e01'], cueDoMomento: 'c1' })]
  const rf = casar(forte, leitura(ruim))
  const termoForte = rf.casadas[0]!.fita.find((c) => c.candidato.planoIds[0] === '0001')?.termos.find((x) => x.chave === 'ilegivel')
  confere(primeiro(rf) === '0001' && !!termoForte && termoForte.valor >= -5 - 1e-9, 'o momento forte no plano ilegivel: so desempata (ate -5) e fica', termoForte)
  // A fala CITADA no plano ilegivel manda.
  const citada = [fr('f01', 'Esse cara gritou "Get out of here" e foi expulso.', { eventoIds: ['e01'], citacaoCueId: 'c1' })]
  confere(primeiro(casar(citada, leitura(ruim))) === '0001', 'a fala citada no plano ilegivel continua mandando')
  // A que bate o evento nunca perde para uma legivel que nao bate: so o 0001 no evento (os outros fora dele).
  const sozinho = { ...indice, planos: [plano('0001', 10, 14, { cueIds: ['c1'] }), plano('0003', 30, 34), plano('0004', 35, 39), plano('0005', 40, 44)] }
  const rs = casar(so, leitura(ruim), undefined, sozinho)
  confere(primeiro(rs) === '0001', 'ilegivel no evento x legiveis fora dele: fica a do evento (o escuro nao troca a cena certa pela errada)', rs.casadas[0]!.fita.map((c) => `${c.candidato.planoIds[0]} ${c.candidato.nota}`))
  // No meio da parte, a legibilidade nao pesa.
  const duas = [fr('f01', 'Outra coisa acontece depois.', { eventoIds: ['e02'] }), fr('f02', texto, { eventoIds: ['e01'] })]
  confere(primeiro(casar(duas, leitura(ruim)), 'f02') === '0001', 'no meio da parte, o ilegivel nao muda nada')
  // Abrindo uma parte, pesa menos que no gancho (ate -8).
  const r = casar(duas, leitura(ruim), new Set(['f01', 'f02']))
  const termos = r.casadas.find((c) => c.escolha.fraseId === 'f02')!.fita.flatMap((c) => c.termos.filter((x) => x.chave === 'ilegivel'))
  confere(termos.length > 0 && termos.every((x) => x.valor < 0 && x.valor >= -8 - 1e-9), 'o comeco da parte pesa o ilegivel mais leve (ate -8)', termos)
  // O gancho e a frase inteira: dividida em 2 cenas, o 2o pedaco tambem foge do ilegivel.
  const longa = [fr('f01', 'Esse cara foi expulso do grupo dele, por acharem que ele era um peso inutil.', { eventoIds: ['e01'] })]
  const takeLongo = takeDe([{ id: 'f01', texto: longa[0]!.texto, dur: 4 }])
  const rd = casarFrases({ indice, eventos, frases: longa, take: takeLongo, fixas: new Map(), refazer: new Set(['f01']), divisao: { ligada: true, limiarSec: 3 }, leitura: leitura(ruim) })
  const pedacos = rd.casadas[0]!.pedacos ?? []
  confere(pedacos.length < 2 || pedacos[1]!.fita.some((c) => c.termos.some((x) => x.chave === 'ilegivel' || x.chave === 'bonito')) || !pedacos[1]!.fita.some((c) => c.candidato.planoIds.includes('0001')), 'o 2o pedaco do gancho tambem olha a legibilidade', pedacos.map((p) => p.fita.map((c) => c.candidato.planoIds[0])))
}

// ------------------------------------------------------------ F. o mesmo assunto

function assunto(): void {
  console.log('\n== F. O mesmo assunto')
  confere(objetosDasTags(['holding', 'Holding_Paper', 'smile']).sort().join() === 'mao,papel', '"holding" e "holding paper": na mao e papel', objetosDasTags(['holding', 'Holding_Paper', 'smile']))
  const lentPapel = { pessoas: ['lent'], objetos: ['papel'] }
  confere(mesmoAssunto(lentPapel, { pessoas: ['lent', 'empee'], objetos: ['mao'] }), 'Lent com papel x Lent e a fadinha com algo na mao: o mesmo assunto')
  confere(!mesmoAssunto(lentPapel, { pessoas: ['empee'], objetos: ['papel'] }) && !mesmoAssunto(lentPapel, { pessoas: ['lent'], objetos: ['arma'] }), 'outra pessoa ou outro objeto: nao')
  const ps = prepararPlanos({ planos: [plano('a', 0, 2, { personagens: [{ nome: 'Lent', conf: 0.9, fonte: 'ancut' }] }), plano('b', 2, 4)], cues: [], exclusoes: [] })
  const as = assuntosDosPlanos(ps, new Map([['a', ['holding', 'paper']], ['b', ['paper']]]))
  confere(as.get('a')?.pessoas.join() === 'lent' && !as.has('b'), 'so plano com rosto e objeto tem assunto', [...as])

  // Seis frases do mesmo evento; os planos 0001-0006 sao o Lent com o papel, 0011-0016 o Lent com a
  // fadinha, sem o papel (a reacao: a mesma gente, outro assunto).
  const planos: Plano[] = []
  const tags = new Map<string, string[]>()
  for (let i = 0; i < 6; i++) {
    const a = String(i + 1).padStart(4, '0')
    const b = String(i + 11).padStart(4, '0')
    planos.push(plano(a, i * 8, i * 8 + 4, { personagens: [{ nome: 'Lent', conf: 0.9, fonte: 'ancut' }] }))
    planos.push(plano(b, i * 8 + 4, i * 8 + 8, { personagens: [{ nome: 'Lent', conf: 0.9, fonte: 'ancut' }, { nome: 'Empee', conf: 0.9, fonte: 'ancut' }] }))
    tags.set(a, ['holding', 'paper', '1boy'])
    tags.set(b, ['1girl', '1boy', 'wings'])
  }
  planos.sort((x, y) => x.start - y.start)
  const cues: Cue[] = []
  const frases: FraseDoCasar[] = []
  for (let i = 0; i < 6; i++) {
    // A fala do momento de cada frase cai no plano do Lent; so a 1a e a 6a "pedem" (cue do momento).
    const id = `c${i + 1}`
    cues.push({ id, start: i * 8 + 1, end: i * 8 + 2.5, texto: `fala ${i}`, falante: 'Lent', estilo: 'Default', tipo: 'fala' })
    frases.push(fr(`f0${i + 1}`, `O Lent olha o papel de novo na parte ${i + 1}.`, { eventoIds: ['e01'], cueDoMomento: i === 0 || i === 5 ? id : null }))
  }
  for (const p of planos) p.cueIds = cues.filter((c) => c.start < p.end && c.end > p.start).map((c) => c.id)
  const eventos: Evento[] = [{ id: 'e01', cueIds: cues.map((c) => c.id), t0: 0, t1: 48, resumo: 'o papel', personagens: ['Lent'], peso: 3 }]
  const take = takeDe(frases.map((f) => ({ id: f.id, texto: f.texto, dur: 2.5 })))
  const r = casarFrases({ indice: { id: EP, planos, cues, exclusoes: [] }, eventos, frases, take, fixas: new Map(), refazer: new Set(frases.map((f) => f.id)), divisao: null, sinais: { tagsDoPlano: tags } })
  const escolhidos = r.casadas.map((c) => c.escolha.cenas[0]!.candidato.planoIds[0]!)
  const doLent = (id: string): boolean => Number(id) < 10
  let pior = 0
  for (let i = 0; i + 5 <= escolhidos.length + 0; i++) pior = Math.max(pior, escolhidos.slice(i, i + 5).filter(doLent).length)
  confere(escolhidos.some((id) => !doLent(id)) && pior <= 3, `o Lent com o papel alterna com a fadinha (no maximo ${pior} em 5, contando as que a fala pede)`, escolhidos)
  confere(doLent(escolhidos[0]!) && doLent(escolhidos[5]!), 'a fala do momento no plano (a 1a e a 6a) manda', escolhidos)
  const termos = r.casadas.flatMap((c) => c.fita[0]!.termos.filter((x) => x.chave === 'assunto'))
  confere(termos.every((x) => x.valor < 0), 'o termo "mesmo assunto" pesa contra quando entra', termos)
}

foco()
nomes()
variedade()
minimo()
gancho()
assunto()
console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
process.exitCode = falhas === 0 ? 0 : 1
