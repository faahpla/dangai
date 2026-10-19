/**
 * [recap] A 3a RODADA DO VISUAL (19/10, o MRM E02 conferido quadro a quadro), puro:
 *
 *   A. o RECORTE visto de perto: a janela que a tela mostra, a semelhanca de
 *      dois recortes e os outros recortes de um pedaco (outro rosto);
 *   B. o IRMAO da repeticao: o plano so volta, mesmo pedido pela fala do
 *      momento, quando nenhum outro plano do mesmo momento ou evento tem
 *      relevancia parecida;
 *   C. CLAREAR a cena escura: a exposicao sobe ate ficar legivel sem lavar o
 *      preto, e a camada de ajuste curta no tempo da cena;
 *   D. o GRUPO ("o trio", "os parceiros"): o trio que anda junto no indice
 *      vira citado, e quem fala no plano vem antes quando o citado nao esta;
 *   E. o CLOSE EXTREMO: o casar pesa forte contra (so entra sem outra saida
 *      razoavel), e o recorte que entra mesmo assim mira um olho.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-cenas-quase-iguais.ts
 */
import {
  casarFrases,
  citadosNoTexto,
  CLOSE_EXTREMO,
  comOGrupo,
  elencoDoEpisodio,
  grupoDoEpisodio,
  irmaoDaRepeticao,
  prepararPlanos,
  type CandidatoPontuado,
  type FraseDoCasar,
  type ResultadoDoCasar,
} from '../electron/cenas/casar'
import { nomesDaMontagem } from '../electron/montar/edicao-rapida'
import { chaveDoPedaco, type PedacoDaMontagem } from '../electron/montar/projeto'
import { centroNumOlho, escolherNoPedaco, janelaDoFormato, larguraDoMaiorRosto, outrosRecortes, type QuadroDoMotor, type RostoDoMotor } from '../electron/montar/rostos-motor'
import { ajusteDeCorSchema } from '@shared/contract'
import { aplicarAjuste, camadaDeClarear, clarearQuadro, LEGIVEL_CLAREADO, pretoDoQuadro, PRETO_SOBE_NO_MAXIMO } from '../shared/clarear'
import type { Cue, EpisodeIndex, Plano } from '../shared/episodio'
import { papelDaSobreposicao } from '../shared/projeto-do-recap'
import { descritorDoRecorte, janelaVisivel, RECORTE_ALTURA, RECORTE_IGUAL, RECORTE_LARGURA, semelhancaDosRecortes } from '../shared/recorte'
import type { Evento } from '../shared/roteiro'
import { legibilidadeDoQuadro } from '../shared/visao'
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
const EP = `ep_${'e'.repeat(40)}`
function plano(id: string, start: number, end: number, extra: Partial<Plano> = {}): Plano {
  return { id, start, end, arquivo: `C:/fake/${id}.mp4`, keyframe: `C:/fake/${id}_1.jpg`, cueIds: [], falantes: [], personagens: [], ...extra }
}
type TakeDoTeste = Pick<TakeDaVoz, 'id' | 'trechos' | 'palavras' | 'duracao'>
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

// ------------------------------------------------------------ A. o recorte

/** Um recorte sintetico (RECORTE_LARGURA x RECORTE_ALTURA, RGB). */
function recorte(cor: (x: number, y: number) => [number, number, number]): Uint8Array {
  const rgb = new Uint8Array(RECORTE_LARGURA * RECORTE_ALTURA * 3)
  for (let y = 0; y < RECORTE_ALTURA; y++) {
    for (let x = 0; x < RECORTE_LARGURA; x++) {
      const [r, g, b] = cor(x, y)
      const i = 3 * (y * RECORTE_LARGURA + x)
      rgb[i] = r
      rgb[i + 1] = g
      rgb[i + 2] = b
    }
  }
  return rgb
}

function oRecorte(): void {
  console.log('\n== A. O recorte visto de perto')
  // 16:9 em 9:16: a tela mostra ~27,5% da largura; o focusX anda a caixa do render.
  const meio = janelaVisivel(0.5, 1920, 1080)
  const esquerda = janelaVisivel(0, 1920, 1080)
  confere(perto(meio.centro, 0.5, 1e-9) && perto(meio.largura, janelaDoFormato(1920, 1080), 1e-9), 'focusX 0,5: o meio, com a largura da janelaDoFormato', meio)
  confere(esquerda.centro < 0.2 && esquerda.centro > 0.1, 'focusX 0: a janela encosta na esquerda', esquerda)

  // O Lent de perfil duas vezes (o mesmo desenho, a luz um pouco diferente) x o close da fadinha.
  const perfil = (claro: number) => recorte((x, y) => (x > 10 && y > 8 && y < 40 ? [200 + claro, 160 + claro, 140] : [40, 45 + (y % 5), 60]))
  const fadinha = recorte((x, y) => ((x + y) % 7 < 3 ? [230, 200, 230] : [250, 240, 180]))
  const a = descritorDoRecorte(perfil(0))
  const b = descritorDoRecorte(perfil(8))
  const c = descritorDoRecorte(fadinha)
  confere(semelhancaDosRecortes(a, b) >= RECORTE_IGUAL, `o mesmo perfil duas vezes: quase iguais (${semelhancaDosRecortes(a, b).toFixed(2)})`)
  confere(semelhancaDosRecortes(a, c) < RECORTE_IGUAL, `perfil x fadinha: diferentes (${semelhancaDosRecortes(a, c).toFixed(2)})`)
  const liso = descritorDoRecorte(recorte(() => [50, 50, 50]))
  confere(semelhancaDosRecortes(liso, liso) <= 0.5 + 1e-9, 'duas telas lisas: so a cor conta (sem forma, sem correlacao)')

  // Os outros recortes de um pedaco: a fadinha a esquerda, o Lent a direita (o recorte de agora).
  const rosto = (x: number, w: number, pessoa: string | null): RostoDoMotor => ({ x, y: 300, w, h: w, conf: 0.8, tipo: 'rosto', personagem: null, pessoa, sim: null, quem: null })
  const quadros: QuadroDoMotor[] = [0, 1, 2].map((t) => ({ t, ok: true, rostos: [rosto(200, 160, 'Empee'), rosto(1400, 300, 'Lent')] }))
  const pedaco = { largura: 1920, altura: 1080, quadros }
  const janela = janelaDoFormato(1920, 1080)
  const alts = outrosRecortes(pedaco, ['Lent', 'Empee'], janela, (1400 + 150) / 1920)
  confere(alts.length === 1 && alts[0]!.quem === 'Empee' && perto(alts[0]!.centro.centroX, 280 / 1920, 1e-6), 'fora do recorte de agora (o Lent): a fadinha', alts)
  const todos = outrosRecortes(pedaco, ['Empee'], janela, null)
  confere(todos.map((x) => x.quem).join() === 'Empee,Lent', 'sem recorte de agora: quem o pedaco cita primeiro, depois o maior', todos.map((x) => x.quem))
  const miudo: QuadroDoMotor[] = [0, 1, 2].map((t) => ({ t, ok: true, rostos: [rosto(1400, 400, 'Lent'), rosto(100, 20, null)] }))
  confere(outrosRecortes({ largura: 1920, altura: 1080, quadros: miudo }, [], janela, (1400 + 200) / 1920).length === 0, 'rosto miudo de fundo nao vira recorte')
}

// ------------------------------------------------------------ B. o irmao

function cand(id: string, termos: { chave: string; valor: number; rotulo?: string }[]): CandidatoPontuado {
  return {
    candidato: { planoIds: [id], episodioId: EP, inSec: 0, outSec: 3, nota: termos.reduce((s, t) => s + t.valor, 0), porque: [], origem: 'sugestao', keyframe: null },
    planos: [],
    termos: termos.map((t) => ({ chave: t.chave, valor: t.valor, rotulo: t.rotulo ?? t.chave })),
    repetido: false,
    falta: 0,
  }
}

function irmao(): void {
  console.log('\n== B. O irmao da repeticao')
  // O 0126 do f08: o momento (janela 40) e o Lent (pessoa 28). O 0127: o mesmo evento, quase o mesmo.
  const repetida = cand('0126', [{ chave: 'janela', valor: 40, rotulo: 'no momento' }, { chave: 'pessoa', valor: 28 }, { chave: 'extras', valor: -3 }])
  const irmaoBom = cand('0127', [{ chave: 'janela', valor: 17.5, rotulo: 'no evento' }, { chave: 'pessoa', valor: 28 }, { chave: 'extras', valor: -3 }, { chave: 'duracao', valor: -0.8 }])
  const longe = cand('0132', [{ chave: 'pessoa', valor: 28 }, { chave: 'so', valor: 10 }])
  const fraco = cand('0125', [{ chave: 'janela', valor: 22.8, rotulo: 'no evento' }, { chave: 'pessoa', valor: 10 }])
  confere(irmaoDaRepeticao(repetida, [irmaoBom, longe, fraco])?.candidato.planoIds[0] === '0127', 'o 0127 (mesmo evento, relevancia parecida sem o instante) e o irmao')
  confere(irmaoDaRepeticao(repetida, [longe]) === null, 'fora do evento nao e irmao (o momento manda)')
  confere(irmaoDaRepeticao(repetida, [fraco]) === null, 'no evento mas bem menos relevante: nao e irmao')

  // Na conta: duas frases com a fala do momento no plano longo e um irmao no mesmo evento.
  const planos: Plano[] = []
  for (let i = 0; i < 5; i++) planos.push(plano(String(i + 1).padStart(4, '0'), i * 2, i * 2 + 2))
  planos.push(plano('0010', 10, 30))
  for (let i = 0; i < 5; i++) planos.push(plano(String(i + 11).padStart(4, '0'), 30 + i * 2, 32 + i * 2))
  const cues: Cue[] = [12, 26].map((t, k) => ({ id: `c${k + 1}`, start: t, end: t + 1.5, texto: `fala ${k}`, falante: null, estilo: 'Default', tipo: 'fala' as const }))
  for (const p of planos) p.cueIds = cues.filter((c) => c.start < p.end && c.end > p.start).map((c) => c.id)
  const eventos: Evento[] = [{ id: 'e01', cueIds: cues.map((c) => c.id), t0: 0, t1: 40, resumo: 'algo', personagens: [], peso: 3 }]
  const frases = [12, 26].map((_, k) => fr(`f0${k + 1}`, `Frase numero ${k + 1} com algumas palavras.`, { eventoIds: ['e01'], cueDoMomento: `c${k + 1}` }))
  const take = takeDe(frases.map((f) => ({ id: f.id, texto: f.texto, dur: 2 })))
  const r = casarFrases({ indice: { id: EP, planos, cues, exclusoes: [] }, eventos, frases, take, fixas: new Map(), refazer: new Set(frases.map((f) => f.id)), divisao: null })
  const usos = r.casadas.flatMap((c) => c.escolha.cenas).filter((c) => c.candidato.planoIds.includes('0010')).length
  confere(usos === 1, `as duas falas no plano longo, com irmaos no evento: ele entra ${usos} vez`, r.casadas.map((c) => c.escolha.cenas[0]?.candidato.planoIds))
}

// ------------------------------------------------------------ C. clarear

function clarear(): void {
  console.log('\n== C. Clarear a cena escura')
  const L = 54
  const A = 96
  const quadro = (cor: (x: number, y: number) => [number, number, number]): Uint8Array => {
    const rgb = new Uint8Array(L * A * 3)
    for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) {
      const [r, g, b] = cor(x, y)
      rgb.set([r, g, b], 3 * (y * L + x))
    }
    return rgb
  }
  // O Lent de perfil na chuva: o rosto (cabelo listrado) e a gola em meio-tom, o resto quase preto.
  const escuro = quadro((x, y) => {
    if (x > 16 && x < 40 && y > 18 && y < 62) return Math.floor(y / 2) % 2 === 0 ? [90, 78, 72] : [65, 58, 55]
    if (x > 10 && x < 46 && y > 66 && y < 80) return [115, 115, 120]
    return [8 + ((x * 7 + y * 3) % 9), 10, 16]
  })
  const antes = legibilidadeDoQuadro(escuro, L, A)
  const c = clarearQuadro(escuro, L, A)
  confere(antes < 0.5 && !!c && c.ajuste.exposicao > 0 && c.depois > antes, `escuro (${antes.toFixed(2)}): sobe a exposicao (${c?.ajuste.exposicao} stop -> ${c?.depois.toFixed(2)})`, c)
  const depois = c ? aplicarAjuste(escuro, c.ajuste) : escuro
  confere(pretoDoQuadro(depois) - pretoDoQuadro(escuro) <= PRETO_SOBE_NO_MAXIMO, `sem lavar o preto (p5 ${pretoDoQuadro(escuro).toFixed(0)} -> ${pretoDoQuadro(depois).toFixed(0)})`)
  confere(!c || c.depois >= LEGIVEL_CLAREADO || c.ajuste.exposicao === 1.6, 'para no primeiro degrau legivel (ou no mais forte que nao lava)', c)
  const claro = quadro((x, y) => ((Math.floor(x / 6) + Math.floor(y / 6)) % 2 === 0 ? [230, 220, 200] : [60, 90, 140]))
  confere(clarearQuadro(claro, L, A) === null, 'cena legivel: nada')
  const nada = aplicarAjuste(escuro, ajusteDeCorSchema.parse({}))
  confere(nada.every((v, i) => Math.abs(v - escuro[i]!) <= 1), 'o ajuste neutro nao mexe')
  const camada = camadaDeClarear({ cor: ajusteDeCorSchema.parse({ exposicao: 0.7 }), at: 13.5, duracaoSec: 1.42, faixa: 1, id: 'x', nome: 'f06' })
  confere(camada.tipo === 'ajuste' && camada.at === 13.5 && camada.usarSec === 1.42 && camada.faixa === 1 && camada.fileName === 'Clarear: f06', 'a camada de ajuste so no tempo da cena, na faixa pedida', camada)
  confere(papelDaSobreposicao(camada) === 'clarear', 'o papel "clarear" e do modulo (fica guardado no projeto)')
}

// ------------------------------------------------------------ D. o grupo

function grupo(): void {
  console.log('\n== D. O grupo')
  // O Lent e a fadinha juntos (a dupla), o Guy, a Misa e a Elle juntos (o trio).
  const planos: Plano[] = []
  const cues: Cue[] = []
  const pessoa = (nome: string) => ({ nome, conf: 0.9, fonte: 'ancut' as const })
  for (let i = 0; i < 30; i++) {
    const id = String(i + 1).padStart(4, '0')
    const quem = i < 12 ? [pessoa('Lent'), pessoa('Empee')] : i < 20 ? [pessoa('Guy'), pessoa('Misa'), pessoa('Elle')] : i < 25 ? [pessoa('Guy'), pessoa('Misa')] : [pessoa('Empee'), pessoa('Lent')]
    const falante = i < 12 ? 'MP' : 'Guy'
    const cue = `c${id}`
    cues.push({ id: cue, start: i * 3 + 0.5, end: i * 3 + 2.5, texto: `fala ${i}`, falante, estilo: 'Default', tipo: 'fala' })
    planos.push(plano(id, i * 3, i * 3 + 3, { personagens: quem, cueIds: [cue], falantes: [falante] }))
  }
  const indice: Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'> = { id: EP, planos, cues, exclusoes: [] }
  const todos = prepararPlanos(indice)
  confere(grupoDoEpisodio(todos).join() === 'Guy,Misa,Elle', 'o trio que anda junto (a dupla Lent e fadinha nao faz trio)', grupoDoEpisodio(todos))
  confere(grupoDoEpisodio(prepararPlanos({ planos: planos.map((p) => ({ ...p, personagens: [] })), cues: [], exclusoes: [] })).length === 0, 'sem rosto reconhecido (o Nia): nenhum grupo')
  const elenco = elencoDoEpisodio(todos, indice, [])
  const dito = citadosNoTexto('A taxa consome a regeneracao diaria do trio.', elenco)
  confere(comOGrupo('A taxa consome a regeneracao diaria do trio.', dito, elenco).map((c) => c.ficha).join() === 'guy,misa,elle', '"do trio": o Guy, a Misa e a Elle')
  const lent = citadosNoTexto('Os ex-parceiros do Lent jogaram ele na rua.', elenco)
  confere(comOGrupo('Os ex-parceiros do Lent jogaram ele na rua.', lent, elenco).map((c) => c.ficha).join() === 'lent,guy,misa,elle', '"os ex-parceiros do Lent": o Lent primeiro, depois o grupo')
  confere(comOGrupo('O Lent abre o pergaminho.', citadosNoTexto('O Lent abre o pergaminho.', elenco), elenco).length === 1, 'sem palavra de grupo: so quem o texto cita')

  // O recorte: o trio citado nao esta no plano (o Lent e a fadinha explicando) -> quem fala vem primeiro.
  const frases = [{ id: 'f01', texto: 'A taxa consome a regeneracao diaria do trio.', eventoIds: ['e01'] }]
  const roteiro = { secoes: [{ frases }] } as unknown as Parameters<typeof nomesDaMontagem>[1]
  const eventos: Pick<Evento, 'id' | 'personagens'>[] = [{ id: 'e01', personagens: ['Lent'] }]
  const escolhas = [{ fraseId: 'f01', cenas: [{ palavraInicio: 0 }] }] as unknown as Parameters<typeof nomesDaMontagem>[4]
  const pc: PedacoDaMontagem = { fraseId: 'f01', secao: 0, cena: 0, planoId: '0003', arquivo: 'C:/fake/0003.mp4', de: 0, ate: 2, inicio: 0, fim: 2, porque: [] }
  const n = nomesDaMontagem([pc], roteiro, eventos, indice, escolhas)
  const nomes = n.porPedaco.get(chaveDoPedaco(pc)) ?? []
  confere(nomes[0] === 'Empee', 'o trio nao esta no plano: quem FALA (a MP) vem primeiro, nao o maior rosto', nomes)
  confere(nomes.includes('Guy') && nomes.includes('Misa') && nomes.includes('Elle'), 'e o trio continua na lista (se aparecer, entra)', nomes)
}

// ------------------------------------------------------------ E. o close extremo

function closeExtremo(): void {
  console.log('\n== E. O close extremo')
  const janela = janelaDoFormato(1920, 1080)
  // O Nia E01, bloco 1: o rosto do quadro inteiro, os olhos perto das bordas.
  const o = centroNumOlho({ cx: 0.5, w: 1 }, janela)
  confere(!!o && Math.abs(o.centroX - 0.5) > 0.1, 'rosto do quadro inteiro: o recorte vai para um olho, nao para o nariz', o)
  const esq = 0.5 - 0.2
  confere(!!o && (o.olho === 'esquerdo' ? o.centroX > esq && o.centroX - esq < janela / 2 : o.centroX < 0.7 && 0.7 - o.centroX < janela / 2), 'o olho dentro da janela, o resto do rosto para dentro', o)
  confere(centroNumOlho({ cx: 0.5, w: 0.5 }, janela) === null, 'os dois olhos cabem (rosto de meio quadro): o de sempre')
  const so = centroNumOlho({ cx: 0.15, w: 0.9 }, janela)
  confere(so?.olho === 'direito', 'o olho esquerdo fora do quadro: o direito', so)
  // A trilha do close extremo no escolherNoPedaco: marca o olho.
  const rosto: RostoDoMotor = { x: 0, y: 0, w: 1920, h: 1080, conf: 0.9, tipo: 'rosto', personagem: null, pessoa: null, sim: null, quem: null }
  const e = escolherNoPedaco({ largura: 1920, altura: 1080, quadros: [0, 1, 2].map((t) => ({ t, ok: true, rostos: [rosto] })) }, [], [], janela)
  confere(!!e.olho && e.centro !== null && Math.abs(e.centro.centroX - 0.5) > 0.1, 'o pedaco em close extremo sai com o recorte num olho', e)
  confere(perto(larguraDoMaiorRosto({ largura: 1920, altura: 1080, quadros: [0, 1, 2].map((t) => ({ t, ok: true, rostos: [{ ...rosto, w: 960 + t * 96 }] })) })!, 0.55, 1e-6), 'a largura do maior rosto: a mediana dos instantes')

  // Na conta: o plano do momento em close extremo perde para o vizinho do mesmo evento.
  const planos = [plano('0001', 10, 14), plano('0002', 15, 19), plano('0003', 30, 34), plano('0004', 35, 39), plano('0005', 40, 44)]
  const cues: Cue[] = [{ id: 'c1', start: 11, end: 12.5, texto: 'Get out', falante: null, estilo: 'Default', tipo: 'fala' }]
  planos[0]!.cueIds = ['c1']
  const eventos: Evento[] = [{ id: 'e01', cueIds: ['c1'], t0: 10, t1: 19, resumo: 'x', personagens: [], peso: 3 }]
  const frases = [fr('f01', 'Algo acontece com ela aqui.', { eventoIds: ['e01'] }), fr('f02', 'E depois disso tudo muda.', { eventoIds: ['e01'] })]
  const take = takeDe(frases.map((f) => ({ id: f.id, texto: f.texto, dur: 2 })))
  const base = { indice: { id: EP, planos, cues, exclusoes: [] }, eventos, frases: [frases[1]!], take, fixas: new Map(), refazer: new Set(['f02']), divisao: null }
  const sem = casarFrases(base)
  const com = casarFrases({ ...base, rostos: new Map([['0001', CLOSE_EXTREMO + 0.2]]) })
  const plano1 = (r: ResultadoDoCasar): string => r.casadas[0]!.escolha.cenas[0]!.candidato.planoIds[0]!
  confere(plano1(sem) === '0001' && plano1(com) !== '0001', `o plano mais perto em close extremo perde (${plano1(sem)} -> ${plano1(com)})`)
  const so1 = casarFrases({ ...base, indice: { id: EP, planos: [planos[0]!], cues, exclusoes: [] }, rostos: new Map([['0001', 0.95]]) })
  confere(plano1(so1) === '0001', 'sem outra candidata, o close extremo entra')
}

oRecorte()
irmao()
clarear()
grupo()
closeExtremo()
console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
process.exitCode = falhas === 0 ? 0 : 1

// Tipos so usados nas assinaturas acima (o resultado do casar e lido pelos testes da conta).
export type { ResultadoDoCasar }
