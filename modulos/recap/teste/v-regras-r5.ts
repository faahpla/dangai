/**
 * [recap] AS CORRECOES DA 5a RODADA (20/10, a avaliacao renderizada da 1.72),
 * puro, com um episodio sintetico pequeno e os numeros medidos no Nia E01 e
 * no MRM E02:
 *
 *   1. regra 3: o plano seguinte que traz outra pessoa citada e outra cena (o
 *      MRM f07, o Lent no 0104 e a fadinha no 0105); a frase sem evento divide
 *      pelos motivos;
 *   2. a cabeca grande pesa mais fora do gancho (o 0314 e o 0343 do MRM);
 *   3. quem a frase cita, so de costas, perde (o 0313 do Nia f14), menos no
 *      golpe (o 0318 da f15);
 *   4. o verbo que se ve, sem as dicas da IA ("pega" -> arms up, holding);
 *   5. a entrada fora do movimento do comeco (o 0083 do Nia f08);
 *   6. o plano emendado tambem entra depois do efeito do comeco dele (o 0289
 *      da f13 do Nia).
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-regras-r5.ts
 */
import { casarFrases, cenasDiferentes, prepararPlanos, type CandidatoPontuado, type FraseDoCasar, type Termo } from '../electron/cenas/casar'
import { dividirFrase, DIVISAO_PADRAO } from '../shared/divisao'
import { encaixarEscolha, entradasDosPlanos } from '../shared/encaixe'
import { trechosDoCandidato, type EscolhaDaFrase } from '../shared/cenas'
import type { Cue, EpisodeIndex, Plano } from '../shared/episodio'
import { tagsDoTexto } from '../shared/ponte-visual'
import { ABERTURA_PASSO_SEC, trechosAgitados } from '../shared/quadro'
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

const EP = `ep_${'e'.repeat(40)}`
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
const ev = (id: string, de: number, ate: number): Evento => ({
  id,
  cueIds: indice.cues.filter((c) => c.start >= de && c.end <= ate).map((c) => c.id),
  t0: de,
  t1: ate,
  resumo: 'algo acontece',
  personagens: [],
  peso: 3,
})

// ------------------------------------------------------------ 1. regra 3

function regra3(): void {
  console.log('\n== 1. Regra 3: o plano seguinte com outra pessoa; a frase sem evento')
  const todos = prepararPlanos(indice)
  const c = (ids: string[], pessoas: string[] = []): Pick<CandidatoPontuado, 'candidato' | 'planos' | 'termos'> => ({
    candidato: { planoIds: ids, episodioId: EP, inSec: 0, outSec: 1, nota: 0, porque: [], origem: 'sugestao', keyframe: null },
    planos: ids.map((id) => todos.find((p) => p.plano.id === id)!),
    termos: pessoas.map((p): Termo => ({ chave: 'pessoa', rotulo: p, valor: 18 })),
  })
  confere(!cenasDiferentes(c(['0011'], ['Lent']), c(['0012'], ['Lent']), new Map()), 'o plano seguinte com a mesma pessoa e a mesma cena (a criada do Nia f07)')
  confere(cenasDiferentes(c(['0011'], ['Lent']), c(['0012'], ['MP']), new Map()), 'o plano seguinte com OUTRA pessoa citada e outra cena (o Lent e a fadinha do MRM f07)')
  confere(!cenasDiferentes(c(['0011']), c(['0012']), new Map()), 'o plano seguinte sem pessoa reconhecida continua a mesma cena')

  // A frase sem evento (a janela herdada, o "Comenta ai" do fim): 3,8 s divide pelos motivos.
  const eventos = [ev('e01', 0, 60)]
  const textos = ['A historia acaba na cidade grande.', 'Comenta ai: essa cobranca foi merecida ou passou dos limites da regra?']
  const frases = [fr('f00', textos[0]!, { eventoIds: ['e01'], cueDoMomento: 'c0003' }), fr('f01', textos[1]!)]
  const take = takeDe([
    { id: 'f00', texto: textos[0]!, dur: 2.4 },
    { id: 'f01', texto: textos[1]!, dur: 3.8 },
  ])
  const r = casarFrases({ indice, eventos, frases, take, fixas: new Map(), refazer: new Set(['f00', 'f01']), divisao: { ligada: true, limiarSec: 3, minimoSec: 1 }, abrem: new Set(['f00', 'f01']) })
  const f01 = r.casadas.find((x) => x.escolha.fraseId === 'f01')!
  confere(f01.janela.herdada && f01.escolha.cenas.length === 2, 'a frase sem evento e longa divide pelos motivos (o MRM f24)', { herdada: f01.janela.herdada, cenas: f01.escolha.cenas.length, motivos: f01.motivos })
  // Sem momento, o corte de socorro (pedaco abaixo do ritmo de 1,3 s) vale: o final-171 abria o f24 em 1,17 + 1,88 s.
  const cta = 'Comenta ai: essa cobranca foi bem merecida ou exagero?'
  const fcta = fr('f24', cta)
  // Nenhuma fronteira de palavra entre 1,3 e 1,75 s (de 3,05 s): todo corte deixa um pedaco abaixo de 1,3 s.
  const inicios = [0.1, 0.4, 0.7, 1.0, 1.25, 1.8, 2.1, 2.4, 2.7]
  const tcta: TakeDoTeste = {
    id: 't1',
    trechos: [{ fraseId: 'f24', offset: 0, duracao: 3.05, hashTexto: hashDoTexto(cta), texto: cta } as TakeDaVoz['trechos'][number]],
    palavras: palavrasDaFrase(cta).map((w, i) => ({ texto: w, start: inicios[i]!, end: (inicios[i + 1] ?? 3) - 0.05, fraseId: 'f24' }) as TakeDaVoz['palavras'][number]),
  }
  confere(dividirFrase(fcta, tcta, DIVISAO_PADRAO) === null, '(com momento, o pedaco curto nao divide)')
  const sm = dividirFrase(fcta, tcta, DIVISAO_PADRAO, { semMomento: true })
  confere(!!sm && sm.socorro === true, 'sem momento, o corte de socorro divide', sm?.pedacos.map((p) => p.texto))
}

// ------------------------------------------------------------ 2-5. no casar

/** Uma frase de 2,2 s num evento so (0-60 s), o momento no plano 0006, com os sinais dados. */
function casarUma(texto: string, extra: { larguras?: Map<string, (number | null)[]>; confianca?: Map<string, Map<string, number>>; agitados?: Map<string, [number, number][]>; abre?: Set<string>; momento?: string }) {
  const eventos = [ev('e01', 0, 60)]
  const f = [fr('f00', 'A historia comeca no meio da cidade.', { eventoIds: ['e01'], cueDoMomento: 'c0001' }), fr('f01', texto, { eventoIds: ['e01'], cueDoMomento: extra.momento ?? 'c0006' })]
  const take = takeDe([
    { id: 'f00', texto: f[0]!.texto, dur: 2.2 },
    { id: 'f01', texto, dur: 2.2 },
  ])
  const tags = extra.confianca ? new Map([...extra.confianca].map(([id, m]) => [id, [...m.keys()]] as const)) : undefined
  return casarFrases({
    indice,
    eventos,
    frases: f,
    take,
    fixas: new Map(),
    refazer: new Set(['f01']),
    divisao: null,
    ...(extra.abre ? { abrem: extra.abre } : {}),
    ...(tags ? { sinais: { tagsDoPlano: tags, confiancaDasTags: extra.confianca! } } : {}),
    imagem: { ...(extra.larguras ? { larguras: extra.larguras } : {}), ...(extra.agitados ? { agitados: extra.agitados } : {}) },
  }).casadas.find((x) => x.escolha.fraseId === 'f01')!
}

function noCasar(): void {
  console.log('\n== 2. A cabeca grande fora do gancho')
  // O plano do momento (0006) com a cabeca de 0,5 da largura (o 0314 do MRM: 0,51) nos 3 instantes.
  const grande = new Map([['0006', [0.5, 0.5, 0.5] as (number | null)[]]])
  const fora = casarUma('O pior e que a divida principal nem diminui.', { larguras: grande })
  const t0006 = fora.fita.find((c) => c.candidato.planoIds[0] === '0006')
  const cabeca = t0006?.termos.find((t) => t.chave === 'close')
  confere(!!cabeca && cabeca.valor <= -12, 'fora do gancho, a cabeca grande pesa -12', cabeca)
  const noGancho = casarUma('O pior e que a divida principal nem diminui.', { larguras: grande, abre: new Set(['f00', 'f01']) })
  // Com a f01 abrindo uma parte, ela continua fora do gancho; o gancho e a 1a parte. Uma frase so (f00) e o gancho:
  const g = casarFrases({
    indice,
    eventos: [ev('e01', 0, 60)],
    frases: [fr('f00', 'Mano, esse cara foi expulso do grupo.', { eventoIds: ['e01'], cueDoMomento: 'c0006' })],
    take: takeDe([{ id: 'f00', texto: 'Mano, esse cara foi expulso do grupo.', dur: 2.2 }]),
    fixas: new Map(),
    refazer: new Set(['f00']),
    divisao: null,
    imagem: { larguras: grande },
  }).casadas[0]!
  const noG = g.fita.find((c) => c.candidato.planoIds[0] === '0006')?.termos.find((t) => t.chave === 'close')
  confere(!!noG && noG.valor === -3, 'no gancho, o close emocionado pesa pouco (-3, o 0011 do MRM)', noG)
  confere(noGancho.escolha.cenas.length > 0, 'a frase de outra parte tambem casa (sanidade)')

  console.log('\n== 3. Quem a frase cita, so de costas')
  // O 0006 de costas (o 0313 do Nia: "from behind" 0,36, sem rosto); o 0007, a mesma coisa sem estar de costas.
  const costas = new Map([
    ['0006', new Map([['from behind', 0.36], ['1girl', 0.9]])],
    ['0007', new Map([['1girl', 0.9]])],
  ])
  const pega = casarUma('Ela pega a espada pesada sem pensar.', { confianca: costas })
  const deFrente = casarUma('Ela pega a espada pesada sem pensar.', { confianca: new Map([['0006', new Map([['1girl', 0.9]])], ['0007', new Map([['1girl', 0.9]])]]) })
  confere(deFrente.escolha.cenas[0]!.candidato.planoIds[0] === '0006', '(de frente, o plano do momento ganha)', deFrente.escolha.cenas[0]!.candidato.planoIds)
  const doMomento = pega.fita.find((c) => c.candidato.planoIds[0] === '0006')
  confere(pega.escolha.cenas[0]!.candidato.planoIds[0] !== '0006' && (!doMomento || doMomento.termos.some((t) => t.chave === 'deCostas' && t.valor < 0)), '"Ela pega a espada": o plano de costas sem rosto paga e perde', pega.escolha.cenas[0]!.candidato.planoIds)
  const golpe = casarUma('Com um golpe limpo, ela parte o escudo.', { confianca: costas })
  confere(!golpe.fita.some((c) => c.termos.some((t) => t.chave === 'deCostas')), 'no golpe (impacto), de costas nao paga (o 0318 da f15)')
  const ninguem = casarUma('A chuva cai sobre a cidade inteira.', { confianca: costas })
  confere(!ninguem.fita.some((c) => c.termos.some((t) => t.chave === 'deCostas')), 'a frase sem ninguem nao paga')
  const comRosto = casarUma('Ela pega a espada pesada sem pensar.', { confianca: costas, larguras: new Map([['0006', [0.2, 0.2, 0.2]]]) })
  confere(!comRosto.fita.find((c) => c.candidato.planoIds[0] === '0006')?.termos.some((t) => t.chave === 'deCostas'), 'de costas mas com rosto no trecho: nao paga')

  console.log('\n== 4. O verbo que se ve')
  const tags = tagsDoTexto('Ela pega a espada pesada sem pensar duas vezes.')
  confere(tags.includes('arms up') && tags.includes('holding') && tags.includes('sword'), '"pega a espada": arms up, holding e sword (o 0315 do Nia f14)', tags)
  confere(tagsDoTexto('O artesao faz uma demonstracao').includes('motion lines'), '"demonstracao": o movimento do golpe')

  console.log('\n== 5. A entrada fora do movimento do comeco')
  // O plano do momento (0006) com a camera descendo de 0,17 a 1,33 s (o 0083 do Nia E01); a fala dele em 20,5 s.
  const agitados = new Map<string, [number, number][]>([['0006', [[0.17, 1.33]]]])
  const parado = casarUma('E Nia nota as armas escondidas da mulher.', { agitados })
  const do6 = parado.fita.find((c) => c.candidato.planoIds[0] === '0006')
  const de = (do6?.candidato.inSec ?? 0) - 20
  confere(!!do6 && (de <= 0.17 + 1e-6 || de >= 1.33 - 1e-6), 'a entrada nao cai no meio do movimento', de)
  const sem = casarUma('E Nia nota as armas escondidas da mulher.', {})
  const de0 = (sem.fita.find((c) => c.candidato.planoIds[0] === '0006')?.candidato.inSec ?? 0) - 20
  confere(de0 > 0.17 && de0 < 1.33, '(sem a medida, a entrada ficava no meio: 0,35 s, na fala)', de0)
}

// ------------------------------------------------------------ 6. a emenda

function emenda(): void {
  console.log('\n== 6. O plano emendado entra depois do efeito do comeco dele')
  const planos: Plano[] = [
    { id: '0001', start: 0, end: 2.25, arquivo: 'C:/fake/0001.mp4', keyframe: null, cueIds: [], falantes: [], personagens: [] },
    { id: '0002', start: 2.25, end: 4.5, arquivo: 'C:/fake/0002.mp4', keyframe: null, cueIds: [], falantes: [], personagens: [] },
    { id: '0003', start: 4.5, end: 7, arquivo: 'C:/fake/0003.mp4', keyframe: null, cueIds: [], falantes: [], personagens: [] },
  ] as Plano[]
  // O 0002 abre com 0,42 s de borrao escuro (o 0289 do Nia E01).
  const entradas = entradasDosPlanos(planos, new Map([['0002', 0.42]]))
  const idx = { id: EP, planos, cues: [] as Cue[], exclusoes: [] }
  const texto = 'O artesao faz uma demonstracao, mas Nia acha o golpe fraco.'
  const take = takeDe([{ id: 'f13', texto, dur: 4 }])
  const escolha: EscolhaDaFrase = {
    fraseId: 'f13',
    cenas: [{ candidato: { planoIds: ['0001'], episodioId: EP, inSec: 0, outSec: 2.25, nota: 40, porque: [], origem: 'sugestao', keyframe: null }, palavraInicio: 0 }],
    fita: [],
    confianca: 1,
    travada: false,
    hashTexto: hashDoTexto(texto),
    duracao: 4,
    avisos: [],
  }
  const feito = encaixarEscolha(escolha, { indice: idx, frase: fr('f13', texto), take, entradas }).escolha.cenas[0]!.candidato
  confere(feito.planoIds.join() === '0001,0002', 'a frase de 4 s emenda o 0002', feito.planoIds)
  const partes = trechosDoCandidato(feito, planos, entradas)
  confere(Math.abs(partes[1]!.de - 0.42) < 1e-6, 'o 0002 entra a 0,42 s, depois do borrao', partes[1])
  const total = partes.reduce((s, p) => s + (p.ate - p.de), 0)
  confere(Math.abs(total - 4) < 0.05, 'a emenda ainda da os 4 s da frase (o fim anda o que o comeco pulou)', total)
  const semEntradas = trechosDoCandidato(feito, planos)
  confere(semEntradas[1]!.de === 0, 'sem as entradas (a tela), o 0002 do comeco, como antes')
  const deNovo = encaixarEscolha({ ...escolha, cenas: [{ ...escolha.cenas[0]!, candidato: feito }] }, { indice: idx, frase: fr('f13', texto), take, entradas }).escolha.cenas[0]!.candidato
  confere(JSON.stringify(deNovo) === JSON.stringify(feito), 'idempotente com o piso da emenda')

  console.log('\n== 6. Os trechos agitados do comeco')
  const passo = ABERTURA_PASSO_SEC
  const parado = new Uint8Array(64).map((_, i) => (i % 8) * 20)
  const outro = new Uint8Array(64).map((_, i) => ((i + 3) % 8) * 20)
  // 0083: parado, parado, depois a camera anda (de 2 em 2 quadros, como o anime), e para.
  const qs = [parado, parado, outro, outro, parado, parado, outro, outro, parado, parado, parado, parado]
  const t = trechosAgitados(qs, passo)
  confere(t.length === 1 && Math.abs(t[0]![0] - passo) < 1e-3 && Math.abs(t[0]![1] - 8 * passo) < 1e-3, 'o movimento de 2 em 2 quadros vira um trecho so', t)
  confere(trechosAgitados([parado, outro, parado, parado, parado], passo).length === 0 || trechosAgitados([parado, parado, outro, parado, parado], passo).length <= 1, 'um gesto solto nao vira trecho longo')
}

regra3()
noCasar()
emenda()
console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
