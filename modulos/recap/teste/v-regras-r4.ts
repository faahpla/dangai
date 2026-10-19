/**
 * [recap] AS REGRAS DA 4a RODADA (19/10, a edicao do Levi no Nia E01), puro,
 * com um episodio sintetico pequeno e os numeros medidos no Nia E01 e no MRM E02:
 *
 *   1. a ordem do episodio dentro do mesmo evento (a parte nova pode voltar);
 *   2. a acao fisica da frase (impacto x gesto) e o pedaco do momento;
 *   3. dividir so quando ganha (o ritmo de 1,3 s, o gancho, o pedaco sem imagem);
 *   4. os vetos de perto: o comeco ruim (a 12 quadros por segundo, a entrada
 *      depois do efeito no casar, na grade e no encaixe; vetado so o que fica
 *      curto), o movimento sem o flash e o quadro que o anime ja divide;
 *   5. o evento vizinho pelo substantivo raro e a legenda literal;
 *   6. o recorte: quem o momento cita (nome, papel, retomada, protagonista),
 *      o rosto visivel no lugar da nuca e o aceso no lugar da silhueta;
 *   7. cenas diferentes entre os pedacos da mesma frase.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-regras-r4.ts
 */
import {
  casarFrases,
  cenasDiferentes,
  elencoDoEpisodio,
  eventosPeloTexto,
  legendaLiteral,
  pedacoDoMomento,
  prepararPlanos,
  type CandidatoPontuado,
  type FraseDoCasar,
} from '../electron/cenas/casar'
import { entradaDepoisDoEfeito } from '../electron/cenas/index'
import { nomesDaMontagem, protagonistaDoRoteiro, quemOMomentoCita, textoDoMomento } from '../electron/montar/edicao-rapida'
import { chaveDoPedaco, type PedacoDaMontagem } from '../electron/montar/projeto'
import { ehSilhueta, escolherNoPedaco, luzNaCaixa, type RostoDoMotor, type RostosDoPedaco } from '../electron/montar/rostos-motor'
import { dividirFrase, DIVISAO_PADRAO, PEDACO_MIN_DIVIDIR_SEC } from '../shared/divisao'
import { encaixarEscolha, entradasDosPlanos } from '../shared/encaixe'
import type { EscolhaDaFrase } from '../shared/cenas'
import type { Cue, EpisodeIndex, Plano } from '../shared/episodio'
import { acaoFisica, consultaVisual, tagsDoTexto } from '../shared/ponte-visual'
import {
  ABERTURA_PASSO_SEC,
  aberturaRuim,
  linhaDeDivisao,
  movimentoEntre,
  planoDividido,
  type QuadroMedido,
} from '../shared/quadro'
import type { Evento } from '../shared/roteiro'
import { hashDoTexto, palavrasDaFrase, type TakeDaVoz } from '../shared/voz'

let falhas = 0
function confere(ok: boolean, mensagem: string, extra?: unknown): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}${extra === undefined ? '' : ` -> ${JSON.stringify(extra).slice(0, 400)}`}`)
  }
}

// ------------------------------------------------------------ o episodio e o take

type TakeDoTeste = Pick<TakeDaVoz, 'id' | 'trechos' | 'palavras'>

/** Cada frase com a duracao dada; as palavras repartidas por igual (0,1 s de respiro, 0,3 s na virgula). */
function takeDe(frases: readonly { id: string; texto: string; dur: number }[]): TakeDoTeste {
  const palavras: TakeDaVoz['palavras'] = []
  const trechos: TakeDaVoz['trechos'] = []
  let offset = 0
  for (const f of frases) {
    const ws = palavrasDaFrase(f.texto)
    const virgulas = ws.filter((w) => /[,;:]$/.test(w)).length
    const passo = (f.dur - 0.2 - 0.3 * virgulas) / ws.length
    let t = offset + 0.1
    for (const w of ws) {
      palavras.push({ texto: w, start: t, end: t + passo * 0.9, fraseId: f.id } as TakeDaVoz['palavras'][number])
      t += passo
      if (/[,;:]$/.test(w)) t += 0.3
    }
    trechos.push({ fraseId: f.id, offset, duracao: f.dur, hashTexto: hashDoTexto(f.texto), texto: f.texto } as TakeDaVoz['trechos'][number])
    offset += f.dur
  }
  return { id: 't1', trechos, palavras }
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
/** 30 planos de 4 s, uma fala por plano ("fala N"). */
function montarIndice(): Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'> {
  const planos: Plano[] = []
  const cues: Cue[] = []
  for (let i = 0; i < 30; i++) {
    const id = String(i + 1).padStart(4, '0')
    const cueId = `c${String(i + 1).padStart(4, '0')}`
    cues.push({ id: cueId, start: i * 4 + 0.5, end: i * 4 + 3, texto: `fala ${i}`, falante: null, estilo: 'Default', tipo: 'fala' })
    planos.push({ id, start: i * 4, end: i * 4 + 4, arquivo: `C:/fake/${id}.mp4`, keyframe: `C:/fake/${id}_1.jpg`, cueIds: [cueId], falantes: [], personagens: [] })
  }
  return { id: EP, planos, cues, exclusoes: [] }
}
const indice = montarIndice()
const ev = (id: string, de: number, ate: number, resumo = 'algo acontece', personagens: string[] = []): Evento => ({
  id,
  cueIds: indice.cues.filter((c) => c.start >= de && c.end <= ate).map((c) => c.id),
  t0: de,
  t1: ate,
  resumo,
  personagens,
  peso: 3,
})

// ------------------------------------------------------------ 1. a ordem no evento

function regra1(): void {
  console.log('\n== 1. A ordem do episodio dentro do mesmo evento')
  const eventos = [ev('e01', 0, 120)]
  const textos = ['Tudo comeca no meio da cidade grande.', 'Ela corre pela rua principal.', 'Ela encontra o velho amigo dela.']
  const take = takeDe(textos.map((texto, i) => ({ id: `f0${i}`, texto, dur: 2.4 })))
  // f01 tem o momento no plano 0011 (40-44 s); f02, no 0006 (20-24 s): ANTES, no mesmo evento.
  const frases = [
    fr('f00', textos[0]!, { eventoIds: ['e01'], cueDoMomento: 'c0001' }),
    fr('f01', textos[1]!, { eventoIds: ['e01'], cueDoMomento: 'c0011' }),
    fr('f02', textos[2]!, { eventoIds: ['e01'], cueDoMomento: 'c0006' }),
  ]
  const casar = (abrem?: Set<string>) =>
    casarFrases({ indice, eventos, frases, take, fixas: new Map(), refazer: new Set(frases.map((f) => f.id)), divisao: null, ...(abrem ? { abrem } : {}) })
  const r = casar()
  const cena = (id: string) => r.casadas.find((c) => c.escolha.fraseId === id)!.escolha.cenas[0]!.candidato
  const f01 = cena('f01')
  const f02 = cena('f02')
  // A conta escolhe as duas EM ORDEM (no Nia: 1163 -> 1216 -> 1223 -> 1231 s, como o Levi), mesmo que
  // uma delas saia do momento dela.
  confere(f02.inSec >= f01.inSec + 2.4 - 0.5, 'f02, do mesmo evento, nao volta para antes do fim da f01', { f01: [f01.planoIds, f01.inSec], f02: [f02.planoIds, f02.inSec] })
  // A frase que abre uma parte nova ("Tudo comecou quando...") pode recomecar a historia: cada uma no seu momento.
  const r2 = casar(new Set(['f00', 'f02']))
  const cena2 = (id: string) => r2.casadas.find((c) => c.escolha.fraseId === id)!.escolha.cenas[0]!.candidato
  confere(cena2('f01').planoIds[0] === '0011' && cena2('f02').planoIds[0] === '0006', 'abrindo uma parte, a f02 volta ao momento dela (0006) e a f01 fica no dela (0011)', [cena2('f01').planoIds, cena2('f02').planoIds])
}

// ------------------------------------------------------------ 2. a acao

function regra2(): void {
  console.log('\n== 2. A acao fisica da frase')
  confere(acaoFisica('Com um corte limpo, a garota parte um escudo.') === 'impacto', '"parte um escudo": impacto')
  confere(acaoFisica('Ela pega a espada pesada sem pensar duas vezes.') === 'gesto', '"pega a espada": gesto')
  confere(acaoFisica('Ela sabe que derrotaria qualquer servo daquela mansao.') === null, '"ela sabe que derrotaria": sem acao fisica (pensamento)')
  confere(tagsDoTexto('Ela pega a espada pesada').includes('sword'), 'a ponte: "espada" vira a etiqueta sword', tagsDoTexto('Ela pega a espada pesada'))
  confere(consultaVisual('Com um corte limpo, a garota parte um escudo.') !== null, 'a frase de acao vira uma consulta visual')
  // O pedaco do momento: o 1o, salvo quando ele e de acao e outro nao e (o comentario sobre a acao).
  confere(pedacoDoMomento(['impacto', null]) === 1, '"O artesao faz uma demonstracao, | mas Nia acha o golpe fraco": o momento no 2o')
  confere(pedacoDoMomento([null, 'impacto']) === 0 && pedacoDoMomento(['gesto', 'impacto']) === 0, 'sem acao no 1o (ou acao nos dois): o momento no 1o')
}

// ------------------------------------------------------------ 3. dividir so quando ganha

function regra3(): void {
  console.log('\n== 3. Dividir so quando ganha')
  const texto = 'Pra ajudar os pais, ela vira estrela da transmissao magica.'
  const take = takeDe([{ id: 'f01', texto, dur: 3.6 }])
  const f = fr('f01', texto)
  confere(!!dividirFrase(f, take, DIVISAO_PADRAO), 'longa sem prova: divide pelos motivos (como antes)')
  confere(dividirFrase(f, take, DIVISAO_PADRAO, { ganha: false }) === null, 'longa, mas nenhum pedaco ganha: uma cena (3,0 s so faz candidata)')
  confere(!!dividirFrase(f, take, DIVISAO_PADRAO, { ganha: false, gancho: true }), 'no gancho, divide pelos motivos (o Levi dividiu f01 e f02)')
  confere(!!dividirFrase(f, take, DIVISAO_PADRAO, { ganha: false, planoCurto: true }), 'a cena unica congelando: divide')
  confere(PEDACO_MIN_DIVIDIR_SEC === 1.3, 'o ritmo do Levi: pedaco de 1,3 s no minimo')
  const d = dividirFrase(f, take, DIVISAO_PADRAO)
  const t = take.palavras
  const fimDo1o = d ? t[d.pedacos[1]!.palavraInicio]!.start : 0
  confere(!!d && fimDo1o >= PEDACO_MIN_DIVIDIR_SEC && 3.6 - fimDo1o >= PEDACO_MIN_DIVIDIR_SEC, 'os dois pedacos com o ritmo', d?.pedacos.map((p) => p.texto))
  const semImagem = 'Tudo comecou quando a pequena Nia Liston estava morrendo.'
  confere(dividirFrase(fr('f01', semImagem), takeDe([{ id: 'f01', texto: semImagem, dur: 3.6 }]), DIVISAO_PADRAO) === null, '"Tudo comecou" nao mostra nada: vai junto, a frase fica inteira (f03 do Nia)')
}

// ------------------------------------------------------------ 4. os vetos de perto

function regra4(): void {
  console.log('\n== 4. O comeco ruim, o movimento e o quadro dividido')
  const meio: QuadroMedido = { luz: 120, nit: 900 }
  const bom: QuadroMedido = { luz: 118, nit: 850 }
  const clarao: QuadroMedido = { luz: 240, nit: 100 }
  // O 0318 do Nia: ~10 quadros de clarao, o 7o quadro (a 12/s) ja e o golpe.
  const comeco = [clarao, clarao, clarao, clarao, clarao, clarao, bom, bom, bom]
  confere(Math.abs(aberturaRuim(comeco, meio) - 6 * ABERTURA_PASSO_SEC) < 1e-9, 'o clarao de 0,5 s: a entrada depois dele', aberturaRuim(comeco, meio))
  confere(aberturaRuim([clarao, bom, clarao, clarao, bom, bom], meio) === 4 * ABERTURA_PASSO_SEC, 'o clarao que pisca so acaba com dois quadros bons seguidos')
  confere(aberturaRuim([bom, clarao], meio) === 0, 'abre bem: 0')
  confere(aberturaRuim([{ luz: 10, nit: 5 }, bom], meio) === ABERTURA_PASSO_SEC, 'o preto da transicao conta')
  confere(aberturaRuim([{ luz: 115, nit: 120 }, bom, bom], meio) === ABERTURA_PASSO_SEC, 'o borrao (nitidez abaixo de 30% do meio) conta')

  // O movimento sem a luz: o flash que so clareia nao e movimento.
  const a = new Uint8Array(64).map((_, i) => (i % 8) * 20)
  const claro = a.map((v) => Math.min(255, v + 60))
  const andou = new Uint8Array(64).map((_, i) => ((i + 3) % 8) * 20)
  confere(movimentoEntre(a, claro) < 1 && movimentoEntre(a, andou) > 30, 'o flash nao e movimento; o que anda e', { flash: movimentoEntre(a, claro), anda: movimentoEntre(a, andou) })

  // O quadro dividido: a linha escura inclinada de cima a baixo; a reta em pe (batente) nao.
  const L = 256
  const A = 144
  const quadro = (x0: number, x1: number): Uint8Array => {
    const q = new Uint8Array(L * A).fill(160)
    for (let l = 0; l < A; l++) {
      const x = Math.round(x0 + ((x1 - x0) * l) / (A - 1))
      q[l * L + x] = 20
    }
    return q
  }
  const inclinada = linhaDeDivisao(quadro(100, 160), L, A)
  const empe = linhaDeDivisao(quadro(128, 128), L, A)
  confere(inclinada.forca >= 0.95 && inclinada.inclinacao >= 0.1, 'a linha inclinada divide (o 0193 do Nia)', inclinada)
  confere(empe.forca === 0, 'a reta em pe nao conta (porta, pilar)', empe)
  confere(planoDividido([inclinada, inclinada, null]) && !planoDividido([inclinada, empe, empe]), 'dividido: a linha em 2 dos 3 keyframes')

  console.log('\n== 4. A entrada depois do efeito (casar, grade e encaixe)')
  const planos: Plano[] = [
    { id: '0001', start: 0, end: 4, arquivo: 'C:/fake/0001.mp4', keyframe: null, cueIds: [], falantes: [], personagens: [] },
    { id: '0002', start: 4, end: 6.75, arquivo: 'C:/fake/0002.mp4', keyframe: null, cueIds: [], falantes: [], personagens: [] },
    { id: '0003', start: 6.75, end: 8.25, arquivo: 'C:/fake/0003.mp4', keyframe: null, cueIds: [], falantes: [], personagens: [] },
    { id: '0004', start: 8.25, end: 9.25, arquivo: 'C:/fake/0004.mp4', keyframe: null, cueIds: [], falantes: [], personagens: [] },
  ] as Plano[]
  const ruins = new Map([['0002', 0.5], ['0004', 0.9]])
  const entradas = entradasDosPlanos(planos, ruins)
  confere(entradas.get('0002') === 4.5 && entradas.get('0004') === 9.15 && !entradas.has('0001'), 'as entradas: o comeco do plano + o efeito', [...entradas])
  // A grade: a entrada pula o efeito se sobra o minimo; senao, o comeco de sempre.
  const comUtil = (p: Plano) => ({ plano: p, util: { de: p.start, ate: p.end } })
  confere(entradaDepoisDoEfeito(comUtil(planos[1]!), ruins, 1) === 4.5, 'a grade: o 0318 entra depois do clarao')
  confere(entradaDepoisDoEfeito(comUtil(planos[3]!), ruins, 1) === 8.25, 'a grade: sem sobrar o minimo, o comeco de sempre')
  // O encaixe: a frase de 2,61 s no plano de 2,75 s com 0,5 s de clarao NAO recua para dentro do clarao.
  const idx = { id: EP, planos, cues: [] as Cue[], exclusoes: [] }
  const texto = 'Com um corte limpo, a garota parte um escudo.'
  const takeF = takeDe([{ id: 'f15', texto, dur: 2.61 }])
  const escolha: EscolhaDaFrase = {
    fraseId: 'f15',
    cenas: [{ candidato: { planoIds: ['0002'], episodioId: EP, inSec: 4.5, outSec: 6.75, nota: 50, porque: [], origem: 'sugestao', keyframe: null }, palavraInicio: 0 }],
    fita: [],
    confianca: 1,
    travada: false,
    hashTexto: hashDoTexto(texto),
    duracao: 2.61,
    avisos: [],
  }
  const semPiso = encaixarEscolha(escolha, { indice: idx, frase: fr('f15', texto), take: takeF })
  const comPiso = encaixarEscolha(escolha, { indice: idx, frase: fr('f15', texto), take: takeF, entradas })
  confere(semPiso.escolha.cenas[0]!.candidato.inSec < 4.5, 'sem as entradas, o encaixe recua para caber (o clarao volta)', semPiso.escolha.cenas[0]!.candidato.inSec)
  confere(comPiso.escolha.cenas[0]!.candidato.inSec === 4.5 && comPiso.escolha.cenas[0]!.candidato.planoIds.join() === '0002', 'com as entradas: fica depois do clarao e segura o fim (0,36 s)', comPiso.escolha.cenas[0]!.candidato)
  const deNovo = encaixarEscolha(comPiso.escolha, { indice: idx, frase: fr('f15', texto), take: takeF, entradas })
  confere(JSON.stringify(deNovo.escolha.cenas) === JSON.stringify(comPiso.escolha.cenas), 'idempotente com as entradas')
  const comecoVelho = { ...escolha, cenas: [{ ...escolha.cenas[0]!, candidato: { ...escolha.cenas[0]!.candidato, inSec: 4.1 } }] }
  confere(encaixarEscolha(comecoVelho, { indice: idx, frase: fr('f15', texto), take: takeF, entradas }).escolha.cenas[0]!.candidato.inSec === 4.5, 'um comeco velho dentro do clarao vai para depois dele')
  const amao = { ...comecoVelho, cenas: [{ ...comecoVelho.cenas[0]!, candidato: { ...comecoVelho.cenas[0]!.candidato, origem: 'usuario' as const } }] }
  confere(encaixarEscolha(amao, { indice: idx, frase: fr('f15', texto), take: takeF, entradas }).escolha.cenas[0]!.candidato.inSec === 4.1, 'posto a mao, o comeco e dele')

  // O casar: a janela comeca depois do efeito; o plano que fica curto demais depois de pular nao abre janela.
  const eventos = [ev('e01', 0, 120)]
  const f = [fr('f00', 'Ela corre muito pela estrada.', { eventoIds: ['e01'], cueDoMomento: 'c0011' })]
  const casar = (abremRuim: Map<string, number>) =>
    casarFrases({ indice, eventos, frases: f, take: takeDe([{ id: 'f00', texto: f[0]!.texto, dur: 2.2 }]), fixas: new Map(), refazer: new Set(['f00']), divisao: null, imagem: { abremRuim } })
  const fita = casar(new Map([['0011', 0.5]])).casadas[0]!.fita
  const do11 = fita.find((c) => c.candidato.planoIds[0] === '0011')
  confere(!!do11 && do11.candidato.inSec >= 40.5 - 1e-9, 'a janela do plano que abre com clarao comeca depois dele', do11?.candidato.inSec)
  const fita2 = casar(new Map([['0011', 3.3]])).casadas[0]!.fita
  confere(!fita2.some((c) => c.candidato.planoIds[0] === '0011'), 'efeito ate quase o fim (sobra 0,7 s): o plano nao abre janela', fita2.map((c) => c.candidato.planoIds.join('+')))
}

// ------------------------------------------------------------ 5. o texto amplia

function regra5(): void {
  console.log('\n== 5. O evento vizinho e a legenda literal')
  const eventos = [
    ev('e01', 0, 40, 'A familia conversa no jantar.'),
    ev('e02', 40, 80, 'Ela pede desculpas e diz que esta curada.'),
    ev('e03', 80, 120, 'A transmissao recebe cartas de fas do reino.'),
  ]
  const elenco = elencoDoEpisodio(prepararPlanos(indice), indice, eventos)
  const achados = eventosPeloTexto('Pra ajudar os pais, ela vira estrela da transmissao magica.', [eventos[1]!], eventos, elenco)
  confere(achados.map((e) => e.id).join() === 'e03', '"transmissao" (raro) acha o evento vizinho e03', achados.map((e) => e.id))
  confere(eventosPeloTexto('Ela pede desculpas no jantar.', [eventos[1]!], eventos, elenco).every((e) => e.id !== 'e03'), 'sem o substantivo raro, nada')
  // A legenda literal: a vizinha diz "job offer ... capital" (2 conceitos), a do momento nao.
  const cues: Cue[] = [
    { id: 'c0001', start: 0.5, end: 2, texto: 'We sold so many magic screens!', falante: null, estilo: 'Default', tipo: 'fala' },
    { id: 'c0002', start: 2.5, end: 4, texto: 'A job offer from the royal capital.', falante: null, estilo: 'Default', tipo: 'fala' },
    { id: 'c0003', start: 4.5, end: 6, texto: 'How wonderful, my lady!', falante: null, estilo: 'Default', tipo: 'fala' },
  ]
  const e = { ...ev('e01', 0, 8), cueIds: cues.map((c) => c.id) }
  const lit = legendaLiteral('Agora, Nia foi chamada pra um trabalho na capital.', { id: 'c0003' }, [e], { cues, exclusoes: [] })
  confere(lit?.id === 'c0002', 'a fala de referencia vai para a legenda literal (c0376 do Nia: "job offer from the royal capital")', lit?.id)
}

// ------------------------------------------------------------ 6. o recorte

const rosto = (x: number, w: number, extra: Partial<RostoDoMotor> = {}): RostoDoMotor => ({
  x,
  y: 200,
  w,
  h: w * 1.2,
  conf: 0.85,
  tipo: 'rosto',
  personagem: null,
  pessoa: null,
  sim: null,
  quem: null,
  ...extra,
})
const pedaco = (rostos: RostoDoMotor[]): RostosDoPedaco => ({ largura: 1920, altura: 1080, quadros: [0.5, 1, 1.5].map((t) => ({ t, ok: true, rostos })) })
const JANELA = 0.3164

function regra6(): void {
  console.log('\n== 6. O recorte: o rosto visivel e o aceso')
  // O 0294 do Nia: a nuca do artesao (cabeca, 0,34) contra a criada (0,12) e a Nia (0,10).
  const nuca = rosto(40, 650, { tipo: 'cabeca', h: 600 })
  const criada = rosto(1600, 230)
  const nia = rosto(1300, 190, { y: 600 })
  const e = escolherNoPedaco(pedaco([nuca, criada, nia]), ['Nia'], [], JANELA)
  confere(e.centro !== null && e.centro.centroX > 0.6, 'a nuca perde do rosto visivel: o recorte vai para a criada e a Nia (o Levi, focusX 1,0)', e.centro)
  confere(e.juntos >= 1, 'a Nia cabe junto da criada', e.juntos)
  const soNuca = escolherNoPedaco(pedaco([nuca]), [], [], JANELA)
  confere(soNuca.centro !== null && soNuca.centro.centroX < 0.3, 'so a nuca no plano: fica nela')

  // A silhueta (o mordomo do 0132): escura, lisa, mais escura que o quadro.
  confere(ehSilhueta({ media: 35, desvio: 12 }, 140), 'escura, lisa e no claro: silhueta')
  confere(!ehSilhueta({ media: 52, desvio: 40 }, 74), 'o Lent na noite (luz 52, desvio 40, quadro 74): nao e silhueta')
  confere(!ehSilhueta({ media: 50, desvio: 20 }, 37), 'o rosto escuro num quadro escuro (o gancho do MRM): nao e silhueta')
  const vulto = rosto(1500, 400, { luz: 35, silhueta: true })
  const acesa = rosto(150, 260, { luz: 150 })
  const s = escolherNoPedaco(pedaco([vulto, acesa]), [], [], JANELA)
  confere(s.centro !== null && s.centro.centroX < 0.3, 'a silhueta maior perde do rosto aceso', s.centro)
  const sozinho = escolherNoPedaco(pedaco([vulto]), [], [], JANELA)
  confere(sozinho.centro !== null && sozinho.centro.centroX > 0.7, 'sem rosto aceso, a silhueta continua o foco (o 0038 do Levi)')
  const lentNaNoite = rosto(400, 170, { luz: 52, pessoa: 'Lent', personagem: 'Lent' })
  const fada = rosto(1180, 200, { luz: 185, pessoa: 'Empee', personagem: 'Empee' })
  const n = escolherNoPedaco(pedaco([lentNaNoite, fada]), ['Lent', 'Empee'], [], JANELA)
  confere(n.personagem === 'Lent', 'o citado na noite (nao e silhueta) continua o foco (0112 do MRM E02)', n)
  // A luz na caixa: o cinza medio e o desvio.
  const cinza = new Uint8Array(16 * 9).fill(200)
  for (let l = 0; l < 4; l++) for (let c = 0; c < 4; c++) cinza[l * 16 + c] = 20
  const luz = luzNaCaixa(cinza, 16, 9, { x: 0, y: 0, w: 480, h: 480 }, 1920, 1080)
  confere(!!luz && Math.abs(luz.media - 20) < 1e-9 && luz.desvio === 0, 'a luz na caixa (pixels do quadro original)', luz)

  console.log('\n== 6. Quem o momento cita')
  const ind = {
    ...indice,
    planos: indice.planos.map((p, i) => ({ ...p, personagens: i < 6 ? [{ nome: 'Nia', conf: 0.9, fonte: 'ancut' as const }] : i < 9 ? [{ nome: 'Neal', conf: 0.9, fonte: 'ancut' as const }] : [] })),
  }
  const eventos = [ev('e01', 0, 120, 'algo', ['Nia', 'Neal'])]
  const elenco = elencoDoEpisodio(prepararPlanos(ind), ind, eventos)
  const nia1 = { ficha: 'nia', rotulo: 'Nia' }
  confere(quemOMomentoCita('O artesao faz uma demonstracao,', [nia1], nia1, elenco).outro, '"O artesao faz": outra pessoa (papel)')
  confere(quemOMomentoCita('Um homem usou magia proibida', [nia1], nia1, elenco).outro, '"Um homem usou": alguem novo')
  const ret = quemOMomentoCita('pra enfiar outra alma nela.', [nia1], null, elenco)
  confere(!ret.outro && ret.citados[0]?.ficha === 'nia', '"nela": o sujeito herdado', ret)
  const prot = quemOMomentoCita('Essa garotinha de quatro anos guarda um segredo.', [], nia1, elenco)
  confere(prot.citados[0]?.ficha === 'nia', '"Essa garotinha", sem sujeito antes: a protagonista', prot)
  const nome = quemOMomentoCita('mas Nia acha o golpe fraco.', [], null, elenco)
  confere(nome.citados[0]?.ficha === 'nia' && nome.referente, 'o nome manda', nome)
  confere(!quemOMomentoCita('parar pros outros brilharem.', [nia1], nia1, elenco).referente, 'sem ninguem no momento: a oracao continua (nomesDaMontagem)')
  confere(protagonistaDoRoteiro(['Nia corre.', 'Depois, Nia ensina o Neal.', 'O Neal cai.', 'Nia ri.'], elenco)?.ficha === 'nia', 'a protagonista: quem o roteiro mais cita')

  // A montagem: "O artesao faz uma demonstracao, mas Nia acha o golpe fraco." numa cena de 3 planos.
  const texto = 'O artesao faz uma demonstracao, mas Nia acha o golpe fraco.'
  const frases = [
    { id: 'f12', texto: 'Tudo muda quando Nia visita uma oficina.', eventoIds: ['e01'] },
    { id: 'f13', texto, eventoIds: ['e01'] },
  ]
  const take = takeDe([
    { id: 'f12', texto: frases[0]!.texto, dur: 3 },
    { id: 'f13', texto, dur: 4.5 },
  ])
  const pc = (planoId: string, inicio: number, fim: number): PedacoDaMontagem => ({
    fraseId: 'f13',
    secao: 0,
    cena: 0,
    planoId,
    arquivo: `C:/fake/${planoId}.mp4`,
    de: 0,
    ate: fim - inicio,
    inicio,
    fim,
    porque: [],
  })
  const pedacos = [pc('0010', 3, 4.4), pc('0011', 4.4, 5.5), pc('0012', 5.5, 7.5)]
  const roteiro = { secoes: [{ frases }] } as unknown as Parameters<typeof nomesDaMontagem>[1]
  const escolhas = [{ fraseId: 'f12', cenas: [{ palavraInicio: 0 }] }, { fraseId: 'f13', cenas: [{ palavraInicio: 0 }] }] as unknown as Parameters<typeof nomesDaMontagem>[4]
  confere(textoDoMomento(pedacos[2]!, take.palavras)?.startsWith('Nia') ?? false, 'o texto do momento: as palavras que soam no pedaco', textoDoMomento(pedacos[2]!, take.palavras))
  const nm = nomesDaMontagem(pedacos, roteiro, eventos, ind, escolhas, take.palavras)
  const de = (p: PedacoDaMontagem): string[] => nm.porPedaco.get(chaveDoPedaco(p)) ?? []
  confere(!de(pedacos[0]!).includes('Nia') && !de(pedacos[1]!).includes('Nia'), '"O artesao faz uma demonstracao": a Nia fora dos dois primeiros planos', [de(pedacos[0]!), de(pedacos[1]!)])
  confere(de(pedacos[0]!).includes('Neal'), '...com os outros do evento no lugar (o Neal)', de(pedacos[0]!))
  confere(de(pedacos[2]!)[0] === 'Nia', '"Nia acha o golpe fraco": a Nia no ultimo', de(pedacos[2]!))
  const semTempo = nomesDaMontagem(pedacos, roteiro, eventos, ind, escolhas)
  confere(semTempo.porPedaco.get(chaveDoPedaco(pedacos[0]!))?.[0] === 'Nia', 'sem as palavras com tempo: a cena inteira, como antes (a Nia citada)')
}

// ------------------------------------------------------------ 7. cenas diferentes

function regra7(): void {
  console.log('\n== 7. Cenas diferentes entre os pedacos')
  const todos = prepararPlanos(indice)
  const c = (ids: string[]): Pick<CandidatoPontuado, 'candidato' | 'planos'> => ({
    candidato: { planoIds: ids, episodioId: EP, inSec: 0, outSec: 1, nota: 0, porque: [], origem: 'sugestao', keyframe: null },
    planos: ids.map((id) => todos.find((p) => p.plano.id === id)!),
  })
  confere(!cenasDiferentes(c(['0011']), c(['0012']), new Map()), 'o plano seguinte da mesma sequencia nao e outra cena (f07 do Nia, 0111 -> 0112)')
  confere(cenasDiferentes(c(['0011']), c(['0015']), new Map()), 'outro trecho e outra cena')
  confere(!cenasDiferentes(c(['0011']), c(['0015']), new Map([['0011', 1], ['0015', 1]])), 'o mesmo grupo visual (outro angulo) nao e outra cena')
}

regra1()
regra2()
regra3()
regra4()
regra5()
regra6()
regra7()
console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
