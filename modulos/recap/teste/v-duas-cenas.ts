/**
 * [recap] ATE 2 CENAS POR FRASE (shared/divisao.ts e o casar), puro, com um
 * episodio sintetico pequeno e takes montados a mao:
 *
 *   A. a decisao: os motivos (longa, duas acoes, dois personagens, plano
 *      curto) e o "nao divide" (pedaco curto, citacao, aspas, desligado,
 *      frase curta sem motivo); tres cenas so na frase muito longa;
 *   B. o ponto de corte: virgula, conectivo, "e" entre oracoes (nao entre
 *      nomes), o meio pelo tempo sem artigo no fim, os tempos do take;
 *   C. a conta (C5) com os pedacos: ordem do episodio dentro da frase, sem
 *      plano repetido, sem o plano do momento da frase seguinte, cada pedaco
 *      com a pessoa dele; a escolha passa no schema e o "Juntar em 1";
 *   D. os pontos fixos: frase travada fica como esta e ninguem usa o trecho;
 *   E. desligado = igual ao de antes; o guloso (sem a conta) tambem divide;
 *   F. a config "Cenas" (Ate 2 cenas por frase e o limiar).
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-duas-cenas.ts
 */
import { casarFrases, type FraseDoCasar, type ResultadoDoCasar } from '../electron/cenas/casar'
import {
  divididaPeloCasar,
  escolhaDaFraseSchema,
  juntarEmUma,
  temposDasCenas,
  temposDosCortes,
  type EscolhaDaFrase,
} from '../shared/cenas'
import { aplicarPatch, CENAS_PADRAO, coerceConfig, CONFIG_PADRAO } from '../shared/config'
import {
  cortarFrase,
  dividirFrase,
  DIVISAO_PADRAO,
  limiarDeDivisao,
  pareceVerbo,
  PEDACO_MIN_SEC,
  type OpcoesDaDivisao,
} from '../shared/divisao'
import type { Cue, EpisodeIndex, Plano } from '../shared/episodio'
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

// ------------------------------------------------------------ o take

type TakeDoTeste = Pick<TakeDaVoz, 'id' | 'trechos' | 'palavras'>

/**
 * Um take montado a mao: cada frase com a duracao dada, as palavras repartidas
 * por igual (0,1 s de respiro no comeco) e 0,3 s de pausa depois da virgula.
 */
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

const LIGADA: OpcoesDaDivisao = DIVISAO_PADRAO

// ------------------------------------------------------------ o episodio

const EP = `ep_${'c'.repeat(40)}`
/**
 * 30 planos de 4 s (0..120 s), uma fala por plano. O Lent (rosto e falante) no
 * 2-3, o Guy no 4-6, a Elle no 12-13, paisagem no 20-23 (sem rosto, sem fala).
 */
function montarIndice(): Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'> {
  const planos: Plano[] = []
  const cues: Cue[] = []
  const falas: Record<number, [string, string]> = {
    2: ['Lent', 'Please, let me stay with you!'],
    3: ['Lent', 'I beg you, I can still help!'],
    4: ['Guy', 'Shut up, you useless battery.'],
    5: ['Guy', 'I will choke the life out of you.'],
    6: ['Guy', 'Get out of my sight.'],
    12: ['Elle', 'Let us go, this is boring.'],
    13: ['Elle', 'Goodbye, loser.'],
  }
  for (let i = 0; i < 30; i++) {
    const id = String(i + 1).padStart(4, '0')
    const cueId = `c${String(i + 1).padStart(4, '0')}`
    const [falante, texto] = falas[i] ?? (i >= 20 && i <= 23 ? [null, ''] : [null, `fala ${i}`])
    if (texto) cues.push({ id: cueId, start: i * 4 + 0.5, end: i * 4 + 3, texto, falante, estilo: 'Default', tipo: 'fala' })
    const personagens: Plano['personagens'] = []
    if (i === 2 || i === 3) personagens.push({ nome: 'Lent', conf: 0.95, fonte: 'ancut' })
    if (i >= 4 && i <= 6) personagens.push({ nome: 'Guy', conf: 0.95, fonte: 'ancut' })
    if (i === 12 || i === 13) personagens.push({ nome: 'Elle', conf: 0.95, fonte: 'ancut' })
    planos.push({
      id,
      start: i * 4,
      end: i * 4 + 4,
      arquivo: `C:/fake/${id}.mp4`,
      keyframe: `C:/fake/${id}_1.jpg`,
      cueIds: texto ? [cueId] : [],
      falantes: falante ? [falante] : [],
      personagens,
    })
  }
  return { id: EP, planos, cues, exclusoes: [] }
}
const indice = montarIndice()
const ev = (id: string, de: number, ate: number, personagens: string[] = []): Evento => ({
  id,
  cueIds: indice.cues.filter((c) => c.start >= de && c.end <= ate).map((c) => c.id),
  t0: de,
  t1: ate,
  resumo: 'algo acontece',
  personagens,
  peso: 3,
})
const eventos = [ev('e01', 0, 28, ['Lent', 'Guy']), ev('e02', 28, 60, ['Elle']), ev('e03', 60, 100), ev('e04', 100, 120)]

function casar(
  frases: FraseDoCasar[],
  take: TakeDoTeste | null,
  extra: { fixas?: Map<string, EscolhaDaFrase>; divisao?: OpcoesDaDivisao | null; camadas?: Record<string, boolean> } = {},
): ResultadoDoCasar {
  const fixas = extra.fixas ?? new Map<string, EscolhaDaFrase>()
  return casarFrases({
    indice,
    eventos,
    frases,
    take,
    fixas,
    refazer: new Set(frases.map((f) => f.id).filter((id) => !fixas.has(id))),
    ...(extra.divisao !== undefined ? { divisao: extra.divisao } : { divisao: LIGADA }),
    ...(extra.camadas ? { camadas: extra.camadas } : {}),
  })
}
const da = (r: ResultadoDoCasar, id: string) => r.casadas.find((c) => c.escolha.fraseId === id)
const planosDa = (r: ResultadoDoCasar, id: string): string[] => (da(r, id)?.escolha.cenas ?? []).map((c) => c.candidato.planoIds[0]!)

// ------------------------------------------------------------ A. a decisao

function decisao(): void {
  console.log('\n== A. A decisao de dividir')
  const so = (texto: string, dur: number) => {
    const f = fr('f01', texto)
    return { f, take: takeDe([{ id: 'f01', texto, dur }]) }
  }
  {
    // a. longa: 4 s, a virgula separa.
    const { f, take } = so('Pra ajudar os pais, ela vira estrela da transmissao magica.', 4)
    const d = dividirFrase(f, take, LIGADA)
    confere(!!d && d.motivos.includes('longa'), 'a. frase de 4 s divide (longa)', d?.motivos)
    confere(d?.pedacos[1]?.texto.startsWith('ela vira') ?? false, 'a. o corte cai na palavra depois da virgula', d?.pedacos.map((p) => p.texto))
  }
  {
    // b. duas acoes em 2,6 s ("mas" + verbo dos dois lados): divide abaixo do limiar.
    const { f, take } = so('O artesao faz uma demonstracao, mas Nia acha o golpe fraco.', 2.6)
    const d = dividirFrase(f, take, LIGADA)
    confere(!!d && d.motivos.includes('duas-acoes') && !d.motivos.includes('longa'), 'b. duas acoes (", mas") divide uma frase de 2,6 s', d?.motivos)
    confere(d?.pedacos[1]?.texto.startsWith('mas Nia') ?? false, 'b. o corte cai no conectivo "mas"', d?.pedacos.map((p) => p.texto))
  }
  {
    // c. dois personagens, um de cada lado do corte.
    const { f, take } = so('Quando o Lent implorou pra ficar, o Guy asfixiou o rapaz.', 2.8)
    const citados = (t: string): string[] => ['lent', 'guy'].filter((n) => t.toLowerCase().includes(n))
    const d = dividirFrase(f, take, LIGADA, { citados })
    confere(!!d && d.motivos.includes('dois-personagens'), 'c. dois personagens (Lent | Guy) dividem', d?.motivos)
    confere(d?.pedacos.map((p) => p.texto).join(' | ') === 'Quando o Lent implorou pra ficar, | o Guy asfixiou o rapaz.', 'c. o corte e o do "quando...,"', d?.pedacos.map((p) => p.texto))
    // O mesmo personagem dos dois lados nao e motivo.
    const { f: f2, take: t2 } = so('Quando o Lent caiu no chao, o Lent chorou sozinho.', 2.4)
    const d2 = dividirFrase(f2, t2, LIGADA, { citados })
    confere(!d2?.motivos.includes('dois-personagens'), 'c. a mesma pessoa dos dois lados nao conta', d2?.motivos)
  }
  {
    // d. plano curto: frase de 2,4 s sem limite natural so divide com a prova.
    const { f, take } = so('A pequena garota segurou a espada pesada do pai dela', 2.4)
    confere(dividirFrase(f, take, LIGADA) === null, 'd. sem motivo nenhum, 2,4 s fica com uma cena')
    const d = dividirFrase(f, take, LIGADA, { planoCurto: true })
    confere(!!d && d.motivos.join() === 'plano-curto', 'd. com a melhor cena unica curta, divide (plano curto)', d?.motivos)
    confere(!!d && !d.natural, 'd. sem limite natural, corta no meio pelo tempo')
  }
  {
    // Nunca: pedaco com menos de 1 s.
    const { f, take } = so('Depois, Nia ensina o irmao.', 1.9)
    confere(dividirFrase(f, take, LIGADA, { planoCurto: true }) === null, 'nunca: pedacos abaixo de 1 s nao dividem')
    // Nunca: fala citada (citacaoCueId) nem aspas.
    const longa = 'O Senku grita que a ciencia vai vencer, e todo mundo comemora junto.'
    const t = takeDe([{ id: 'f01', texto: longa, dur: 4.5 }])
    confere(dividirFrase(fr('f01', longa, { citacaoCueId: 'c0003' }), t, LIGADA) === null, 'nunca: a frase da fala citada fica no plano')
    const comAspas = 'O Senku grita "isso e emocionante", e todo mundo comemora junto.'
    confere(dividirFrase(fr('f01', comAspas), takeDe([{ id: 'f01', texto: comAspas, dur: 4.5 }]), LIGADA) === null, 'nunca: frase com aspas')
    // Nunca: opcao desligada.
    confere(dividirFrase(fr('f01', longa), t, { ...LIGADA, ligada: false }) === null, 'nunca: "Ate 2 cenas" desligado')
    // Frase curta sem motivo.
    const curta = 'Ela pega a espada pesada sem pensar.'
    confere(dividirFrase(fr('f01', curta), takeDe([{ id: 'f01', texto: curta, dur: 2.5 }]), LIGADA) === null, 'frase curta sem motivo fica com uma cena')
  }
  {
    // O limiar da config: 3,5 s nao divide uma frase de 3,2 s sem outro motivo.
    const texto = 'O Ryusui fundou o conglomerado dele para tocar os projetos globais.'
    const t = takeDe([{ id: 'f01', texto, dur: 3.2 }])
    confere(!!dividirFrase(fr('f01', texto), t, LIGADA), 'limiar 3,0: 3,2 s divide')
    confere(dividirFrase(fr('f01', texto), t, { ligada: true, limiarSec: 3.5 }) === null, 'limiar 3,5: 3,2 s nao divide')
  }
  {
    // Tres cenas so acima de 2,5x o limiar (7,5 s com 3,0).
    const texto = 'O grupo atravessa a floresta escura, enfrenta um monstro gigante na ponte, e no fim chega exausto ao castelo.'
    const d8 = dividirFrase(fr('f01', texto), takeDe([{ id: 'f01', texto, dur: 8 }]), LIGADA)
    confere(d8?.pedacos.length === 3, 'frase de 8 s: tres cenas', d8?.pedacos.map((p) => p.texto))
    const d6 = dividirFrase(fr('f01', texto), takeDe([{ id: 'f01', texto, dur: 6 }]), LIGADA)
    confere(d6?.pedacos.length === 2, 'frase de 6 s: duas cenas', d6?.pedacos.map((p) => p.texto))
  }
}

// ------------------------------------------------------------ B. o corte

function corte(): void {
  console.log('\n== B. Onde cortar')
  {
    // O "e" entre nomes nao e limite; o "e" entre oracoes e.
    const texto = 'O Taiju e a Yuzuriha abriram uma empresa e celebraram o casamento.'
    const c = cortarFrase(fr('f01', texto), takeDe([{ id: 'f01', texto, dur: 4.3 }]))
    confere(c?.pedacos[1]?.texto === 'e celebraram o casamento.', 'o "e" entre oracoes, nao o "e" entre os nomes', c?.pedacos.map((p) => p.texto))
    confere(!!c?.duasAcoes, '"abriram ... e celebraram": duas acoes')
  }
  {
    // Sem limite natural: o meio pelo tempo, sem artigo/preposicao no fim do 1o pedaco.
    const texto = 'Tudo muda quando a menina visita uma oficina de armas'
    const c = cortarFrase(fr('f01', texto), takeDe([{ id: 'f01', texto, dur: 3.4 }]))
    const fim = c?.pedacos[0]?.texto.split(' ').pop()?.toLowerCase() ?? ''
    confere(!!c && !['a', 'o', 'de', 'uma', 'um'].includes(fim), 'o meio pelo tempo nao deixa "a"/"de" no fim do pedaco', c?.pedacos.map((p) => p.texto))
  }
  {
    // Os tempos sao os das palavras no take: o pedaco 2 comeca no start da palavra do corte.
    const texto = 'Anos se passaram, e o mundo foi totalmente reconstruido.'
    const take = takeDe([
      { id: 'f00', texto: 'Antes disso.', dur: 1.5 },
      { id: 'f01', texto, dur: 3.6 },
    ])
    const c = cortarFrase(fr('f01', texto), take)!
    const palavra = take.palavras.filter((p) => p.fraseId === 'f01')[c.pedacos[1]!.palavraInicio]!
    confere(Math.abs(c.pedacos[1]!.inicio - (palavra.start - 1.5)) < 1e-6, 'o corte no start real da palavra (relativo ao trecho)', { corte: c.pedacos[1]!.inicio, palavra: palavra.start })
    confere(c.pedacos.every((p) => p.fim - p.inicio >= PEDACO_MIN_SEC), 'cada pedaco com pelo menos 1 s')
    const tempos = temposDosCortes(c.pedacos.map((p) => p.palavraInicio), fr('f01', texto), take)
    confere(tempos.every((t, k) => Math.abs(t.inicio - c.pedacos[k]!.inicio) < 1e-6 && Math.abs(t.fim - c.pedacos[k]!.fim) < 1e-6), 'temposDosCortes da o mesmo tempo dos pedacos')
  }
  {
    confere(['implorou', 'asfixiou', 'celebraram', 'acha', 'é', 'vira', 'estavam'].every(pareceVerbo), 'verbos: -ou, -aram, presente comum, "é"')
    confere(!['quando', 'homem', 'garota', 'e', 'mundo', 'da'].some(pareceVerbo), 'nao verbos: quando, homem, garota, "e", "da"')
  }
}

// ------------------------------------------------------------ C. a conta

function conta(): void {
  console.log('\n== C. A conta com os pedacos')
  const textos = {
    f01: 'Quando o Lent implorou pra ficar, o Guy asfixiou o rapaz.',
    f02: 'O Guy mandou o garoto sumir dali.',
    f03: 'A Elle achou tudo aquilo muito chato.',
    f04: 'Anos se passaram e o mundo inteiro mudou de vez.',
  }
  const frases = [
    fr('f01', textos.f01, { eventoIds: ['e01'], cueDoMomento: 'c0003', intencaoVisual: 'Guy sufocando o Lent' }),
    // A seguinte tem o momento no plano 0007 (o Guy): o pedaco do Guy da f01 nao pega esse plano.
    fr('f02', textos.f02, { eventoIds: ['e01'], cueDoMomento: 'c0007' }),
    fr('f03', textos.f03, { eventoIds: ['e02'], cueDoMomento: 'c0013' }),
    fr('f04', textos.f04, { eventoIds: ['e03'] }),
  ]
  const take = takeDe([
    { id: 'f01', texto: textos.f01, dur: 3.6 },
    { id: 'f02', texto: textos.f02, dur: 2.2 },
    { id: 'f03', texto: textos.f03, dur: 2.4 },
    { id: 'f04', texto: textos.f04, dur: 3.4 },
  ])
  const r = casar(frases, take)
  const f01 = da(r, 'f01')!
  confere(f01.escolha.cenas.length === 2, 'f01 (3,6 s, Lent | Guy) ganha 2 cenas', f01.escolha.cenas.length)
  confere(f01.motivos?.includes('longa') && f01.motivos.includes('dois-personagens'), 'f01: os motivos', f01.motivos)
  const [p1, p2] = f01.escolha.cenas
  const plano = (id: string | undefined) => indice.planos.find((p) => p.id === id)
  confere(!!plano(p1?.candidato.planoIds[0])?.personagens.some((x) => x.nome === 'Lent'), 'pedaco 1 (o Lent implorou) mostra o Lent', p1?.candidato.planoIds)
  confere(!!plano(p2?.candidato.planoIds[0])?.personagens.some((x) => x.nome === 'Guy'), 'pedaco 2 (o Guy asfixiou) mostra o Guy', p2?.candidato.planoIds)
  confere(!!p1 && !!p2 && p2.candidato.inSec >= p1.candidato.inSec, 'dentro da frase, a ordem do episodio')
  confere(!!p1 && !!p2 && !p2.candidato.planoIds.some((id) => p1.candidato.planoIds.includes(id)), 'os dois pedacos em planos diferentes')
  confere(!p2?.candidato.planoIds.includes('0007'), 'o pedaco 2 nao pega o plano do momento da frase seguinte (0007)', p2?.candidato.planoIds)
  confere(p2?.palavraInicio === palavrasDaFrase(textos.f01).indexOf('o', 5), 'o corte na palavra depois da virgula', p2?.palavraInicio)
  const ok = escolhaDaFraseSchema.safeParse(f01.escolha)
  confere(ok.success, 'a escolha dividida passa no schema', ok.success ? null : ok.error.issues)
  confere(divididaPeloCasar(f01.escolha) && (f01.escolha.inteira?.length ?? 0) > 0, 'a escolha guarda a fita da frase inteira (dividida: 2 cenas)')
  const junta = juntarEmUma(f01.escolha)
  confere(junta?.cenas.length === 1 && junta.cenas[0]!.candidato === f01.escolha.inteira![0] && junta.inteira === undefined, 'Juntar em 1: uma cena, a melhor da frase inteira')
  confere(junta !== null && escolhaDaFraseSchema.safeParse(junta).success && !divididaPeloCasar(junta), 'Juntar em 1: passa no schema e nao e mais dividida')
  confere(juntarEmUma({ ...f01.escolha, inteira: undefined }) === null, 'frase nao dividida pelo casar nao junta')
  // Os tempos no take: o pedaco 2 comeca no start da palavra do corte.
  const tempos = temposDasCenas(f01.escolha, frases[0]!, take)
  confere(tempos.length === 2 && tempos[1]!.inicio >= PEDACO_MIN_SEC && tempos[1]!.fim - tempos[1]!.inicio >= PEDACO_MIN_SEC, 'os dois pedacos com pelo menos 1 s no take', tempos)
  // Sem plano repetido no roteiro inteiro.
  const todos = r.casadas.flatMap((c) => c.escolha.cenas.flatMap((x) => x.candidato.planoIds))
  confere(new Set(todos).size === todos.length, 'nenhum plano repetido no roteiro', todos)
  // A curta f02 (2,2 s, sem motivo) fica com uma.
  confere(da(r, 'f02')!.escolha.cenas.length === 1, 'f02 (2,2 s) fica com uma cena')
  // f04: longa, sem nomes: divide no "e" entre as oracoes.
  const f04 = da(r, 'f04')!
  confere(f04.escolha.cenas.length === 2 && f04.pedacos?.[1]?.texto.startsWith('e o mundo'), 'f04: divide no "e" entre oracoes', f04.pedacos?.map((p) => p.texto))
  // A ordem tambem entre as frases: cada frase depois da anterior (ou no mesmo evento).
  const inicios = r.casadas.flatMap((c) => c.escolha.cenas.map((x) => x.candidato.inSec))
  confere(inicios.every((t, i) => i === 0 || t >= inicios[i - 1]! - 4), 'a sequencia anda em frente no episodio', inicios)

  // O momento fica com o PRIMEIRO pedaco: o segundo cita o Lent (planos 0003-0004, ANTES do
  // momento) e mesmo assim nao volta para o trecho da frase anterior.
  const t2 = {
    f00: 'O Lent chegou cedo na taverna da cidade.',
    f01: 'Quando o Guy apareceu, o Lent implorou pra ficar no grupo.',
  }
  const r2 = casar(
    [fr('f00', t2.f00, { eventoIds: ['e01'], cueDoMomento: 'c0003' }), fr('f01', t2.f01, { eventoIds: ['e01'], cueDoMomento: 'c0005' })],
    takeDe([
      { id: 'f00', texto: t2.f00, dur: 2.4 },
      { id: 'f01', texto: t2.f01, dur: 3.8 },
    ]),
  )
  const m = da(r2, 'f01')!
  confere(m.pedacos?.[0]?.janela.cueAncora?.id === 'c0005' && m.pedacos[0].janela.forte, 'a fala do momento e do 1o pedaco (forte)', m.pedacos?.[0]?.janela.cueAncora)
  confere(planosDa(r2, 'f01')[0] === '0005', 'o 1o pedaco no plano do momento (0005)', planosDa(r2, 'f01'))
  const antes = da(r2, 'f00')!.escolha.cenas.flatMap((c) => c.candidato.planoIds)
  const doSegundo = m.escolha.cenas[1]?.candidato
  confere(!!doSegundo && doSegundo.inSec >= m.escolha.cenas[0]!.candidato.inSec && !doSegundo.planoIds.some((id) => antes.includes(id)), 'o 2o pedaco vem depois, sem voltar ao trecho da frase anterior', { antes, doSegundo: doSegundo?.planoIds })
}

// ------------------------------------------------------------ D. os pontos fixos

function fixos(): void {
  console.log('\n== D. Os pontos fixos')
  const textos = {
    f01: 'Quando o Lent implorou pra ficar, o Guy asfixiou o rapaz.',
    f02: 'Anos se passaram e o mundo inteiro mudou de vez.',
  }
  const frases = [
    fr('f01', textos.f01, { eventoIds: ['e01'], cueDoMomento: 'c0003' }),
    fr('f02', textos.f02, { eventoIds: ['e03'] }),
  ]
  const take = takeDe([
    { id: 'f01', texto: textos.f01, dur: 3.8 },
    { id: 'f02', texto: textos.f02, dur: 3.4 },
  ])
  // O Levi escolheu UMA cena (o plano 0005) para a f01, longa: fica assim.
  const p5 = indice.planos[4]!
  const travada: EscolhaDaFrase = {
    fraseId: 'f01',
    cenas: [{ candidato: { planoIds: [p5.id], episodioId: EP, inSec: p5.start, outSec: p5.end, nota: 0, porque: [], origem: 'usuario', keyframe: null }, palavraInicio: 0 }],
    fita: [],
    confianca: 1,
    travada: true,
    hashTexto: hashDoTexto(textos.f01),
    duracao: 3.8,
    avisos: [],
  }
  const r = casar(frases, take, { fixas: new Map([['f01', travada]]) })
  confere(!da(r, 'f01'), 'a frase travada nao volta do casar (fica como esta)')
  const f02 = da(r, 'f02')!
  confere(f02.escolha.cenas.length === 2, 'a outra frase longa divide normalmente')
  confere(!f02.escolha.cenas.some((c) => c.candidato.planoIds.includes(p5.id)), 'ninguem usa o plano da travada', f02.escolha.cenas.map((c) => c.candidato.planoIds))
  // Travada com 2 cenas (feitas a mao): os dois trechos ficam ocupados.
  const p3 = indice.planos[2]!
  const duas: EscolhaDaFrase = { ...travada, cenas: [travada.cenas[0]!, { candidato: { ...travada.cenas[0]!.candidato, planoIds: [p3.id], inSec: p3.start, outSec: p3.end }, palavraInicio: 6 }] }
  const r2 = casar([fr('f01', textos.f01, { eventoIds: ['e01'] }), fr('f02', 'Depois o Lent ficou sozinho chorando no chao frio.', { eventoIds: ['e01'] })], takeDe([{ id: 'f01', texto: textos.f01, dur: 3.8 }, { id: 'f02', texto: 'Depois o Lent ficou sozinho chorando no chao frio.', dur: 3.6 }]), { fixas: new Map([['f01', duas]]) })
  const usados = (da(r2, 'f02')?.escolha.cenas ?? []).flatMap((c) => c.candidato.planoIds)
  confere(!usados.includes(p3.id) && !usados.includes(p5.id), 'as duas cenas da travada ficam ocupadas', usados)
}

// ------------------------------------------------------------ E. desligado e guloso

function desligadoEGuloso(): void {
  console.log('\n== E. Desligado = como antes; o guloso tambem divide')
  const textos = {
    f01: 'Quando o Lent implorou pra ficar, o Guy asfixiou o rapaz.',
    f02: 'A Elle achou tudo aquilo muito chato e foi embora.',
  }
  const frases = [fr('f01', textos.f01, { eventoIds: ['e01'], cueDoMomento: 'c0003' }), fr('f02', textos.f02, { eventoIds: ['e02'], cueDoMomento: 'c0013' })]
  const take = takeDe([
    { id: 'f01', texto: textos.f01, dur: 3.6 },
    { id: 'f02', texto: textos.f02, dur: 3.3 },
  ])
  const sem = casar(frases, take, { divisao: null })
  const desligada = casar(frases, take, { divisao: { ...LIGADA, ligada: false } })
  confere(JSON.stringify(sem.casadas.map((c) => c.escolha)) === JSON.stringify(desligada.casadas.map((c) => c.escolha)), 'desligado = sem a opcao (o casar de antes)')
  confere(sem.casadas.every((c) => c.escolha.cenas.length === 1 && c.escolha.inteira === undefined), 'desligado: uma cena por frase, sem "inteira"')
  const guloso = casar(frases, take, { camadas: { conta: false } })
  const g1 = da(guloso, 'f01')!
  confere(g1.escolha.cenas.length === 2, 'o guloso (sem a conta) tambem divide')
  const [a, b] = g1.escolha.cenas
  confere(!!a && !!b && b.candidato.inSec >= a.candidato.inSec && !b.candidato.planoIds.some((id) => a.candidato.planoIds.includes(id)), 'o guloso: ordem e planos diferentes dentro da frase')
  confere(escolhaDaFraseSchema.safeParse(g1.escolha).success, 'o guloso: a escolha passa no schema')

  // Frase muito longa (8 s, acima de 2,5x o limiar): tres cenas, em ordem, planos diferentes.
  const longa = 'O Lent implorou pra ficar no grupo, o Guy agarrou o garoto pelo pescoco, e a Elle foi embora rindo da cara dele.'
  const r3 = casar([fr('f01', longa, { eventoIds: ['e01', 'e02'], cueDoMomento: 'c0003' })], takeDe([{ id: 'f01', texto: longa, dur: 8 }]))
  const t3 = da(r3, 'f01')!
  const ps = t3.escolha.cenas.map((c) => c.candidato)
  confere(ps.length === 3, 'frase de 8 s: tres cenas', t3.pedacos?.map((p) => p.texto))
  confere(ps.every((c, i) => i === 0 || c.inSec >= ps[i - 1]!.inSec), 'as tres em ordem no episodio', ps.map((c) => c.inSec))
  confere(new Set(ps.flatMap((c) => c.planoIds)).size === ps.flatMap((c) => c.planoIds).length, 'as tres em planos diferentes', ps.map((c) => c.planoIds))
  confere(escolhaDaFraseSchema.safeParse(t3.escolha).success, 'tres cenas: a escolha passa no schema')
}

// ------------------------------------------------------------ F. a config

function config(): void {
  console.log('\n== F. A config "Cenas"')
  confere(CENAS_PADRAO.duasCenas === true && CENAS_PADRAO.limiarDuasCenas === 3, 'padrao: ligado, 3,0 s')
  confere(coerceConfig({}).cenas.duasCenas === true, 'perfil de antes do campo: ligado')
  confere(coerceConfig({ cenas: { duasCenas: false } }).cenas.duasCenas === false, 'desligado fica desligado')
  confere(coerceConfig({ cenas: { limiarDuasCenas: 99 } }).cenas.limiarDuasCenas === 3 && limiarDeDivisao('x') === 3, 'limiar fora da faixa vale o padrao')
  const p = aplicarPatch(CONFIG_PADRAO, { cenas: { limiarDuasCenas: 3.5 } })
  confere(p.cenas.limiarDuasCenas === 3.5 && p.cenas.duasCenas && p.cenas.conta, 'mudar so o limiar nao mexe no resto')
}

decisao()
corte()
conta()
fixos()
desligadoEGuloso()
config()
console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
