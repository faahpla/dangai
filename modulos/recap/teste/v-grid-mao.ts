/**
 * [recap] O GRID NA MAO do passo 4 (20/10, o fluxo do Levi): "Grid" na frase,
 * a cena de CIMA na esquerda (ja feita com uma cena so), a de BAIXO na grade;
 * na esquerda, inverter e tirar a de baixo.
 *
 *   A. a sugestao do app para a de baixo (sugestaoDeBaixo): a cena dele fica
 *      em cima, a parceira da fita embaixo com a origem dela (nao 'usuario');
 *      sem parceira, nada;
 *   B. a de baixo que ele clicou (metadeDeBaixoDele + comGridNaMao): o plano
 *      dele, 'usuario'; na frase de 3 cenas so a cena escolhida muda; a marca
 *      'mao', as cenas de antes, travada, sem "Tela cheia"; passa no schema;
 *   C. inverter e tirar a de baixo (a cena volta inteira, a frase vira "Tela
 *      cheia" quando nao sobra grid);
 *   D. o encaixe da metade dele: congela ate 0,5 s sem aviso, mais que isso
 *      "Cena curta" com o recado "... na metade do grid"; a metade do app
 *      segue a folga de antes;
 *   E. o grid automatico nunca mexe na frase do grid na mao nem na "Tela cheia";
 *   F. a montagem: o projeto sai com o imageIndexB da metade dele;
 *   G. a tela: o clique na grade vai embaixo, o Esc cancela, os avisos.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-grid-mao.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { escolhaDaFraseSchema, type CandidatoDeCena, type EscolhaDaFrase } from '../shared/cenas'
import { AVISO_CENA_CURTA, encaixarEscolha } from '../shared/encaixe'
import type { EpisodeIndex, Plano } from '../shared/episodio'
import {
  comGridNaMao,
  gridsAutomaticos,
  inverterMetades,
  metadeDeBaixoDele,
  metadeDeCima,
  sugestaoDeBaixo,
  tirarMetadeDeBaixo,
  type EntradaDoGrid,
  type QuemNoGrid,
} from '../shared/grid'
import type { PapelDaSecao, Roteiro } from '../shared/roteiro'
import { hashDoTexto, palavrasDaFrase, type TakeDaVoz } from '../shared/voz'
import { montarArquivoDoProjeto, pedacosDaMontagem } from '../electron/montar/projeto'

let falhas = 0
function confere(ok: boolean, mensagem: string, extra?: unknown): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}${extra === undefined ? '' : ` -> ${JSON.stringify(extra)}`}`)
  }
}
const secao = (nome: string): void => console.log(`\n== ${nome}`)

// ------------------------------------------------------------ o episodio

const EP = `ep_${'b'.repeat(40)}`
const id4 = (n: number): string => String(n).padStart(4, '0')
/** 120 planos de 6 s; o 0090 tem 1 s (o plano curto). */
const PLANOS: Plano[] = Array.from({ length: 120 }, (_, n) => ({
  id: id4(n),
  start: n * 6,
  end: n * 6 + (n === 90 ? 1 : 6),
  arquivo: `C:/fake/shots/${id4(n)}.mp4`,
  keyframe: `C:/fake/keyframes/${id4(n)}_1.jpg`,
  cueIds: [],
  falantes: [],
  personagens: [],
}))
const MAPA = new Map(PLANOS.map((p) => [p.id, p]))
const indice: Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'> = { id: EP, planos: PLANOS, cues: [], exclusoes: [] }
const cand = (ids: string[], nota: number, extra: Partial<CandidatoDeCena> = {}): CandidatoDeCena => {
  const ps = ids.map((id) => MAPA.get(id)!)
  return { planoIds: ids, episodioId: EP, inSec: ps[0]!.start, outSec: ps[ps.length - 1]!.end, nota, porque: ['no evento'], origem: 'sugestao', keyframe: ps[0]!.keyframe, ...extra }
}

interface FraseDoTeste {
  id: string
  texto: string
  dur: number
  papel: PapelDaSecao
}
const FRASES: FraseDoTeste[] = [
  { id: 'f01', texto: 'No comeco o heroi chega na cidade grande.', dur: 3, papel: 'gancho' },
  { id: 'f02', texto: 'Ele encontra a garota no mercado.', dur: 3, papel: 'contexto' },
  { id: 'f03', texto: 'A garota olha para ele e sorri.', dur: 3.3, papel: 'desenvolvimento' },
  { id: 'f04', texto: 'Ele corre, ela grita, e o vilao aparece no telhado logo depois.', dur: 4.5, papel: 'desenvolvimento' },
  { id: 'f05', texto: 'O vilao ri da cara dos dois.', dur: 3, papel: 'virada' },
  { id: 'f06', texto: 'No fim todo mundo volta para casa.', dur: 3, papel: 'fechamento' },
]
const roteiro: Pick<Roteiro, 'secoes' | 'versao'> = {
  versao: 1,
  secoes: FRASES.map((f, i) => ({
    id: `s${i + 1}`,
    papel: f.papel,
    frases: [{ id: f.id, texto: f.texto, eventoIds: [], cueDoMomento: null, intencaoVisual: '', textoDeTela: null, citacaoCueId: null }],
  })),
}
type TakeDoTeste = Pick<TakeDaVoz, 'id' | 'trechos' | 'palavras' | 'duracao'>
function takeDe(frases: readonly FraseDoTeste[]): TakeDoTeste {
  const palavras: TakeDaVoz['palavras'] = []
  const trechos: TakeDaVoz['trechos'] = []
  let offset = 0
  for (const f of frases) {
    const ws = palavrasDaFrase(f.texto)
    const passo = (f.dur - 0.2) / ws.length
    ws.forEach((w, k) => palavras.push({ texto: w, start: offset + 0.1 + k * passo, end: offset + 0.1 + (k + 0.9) * passo, fraseId: f.id }))
    trechos.push({ fraseId: f.id, offset, duracao: f.dur, hashTexto: hashDoTexto(f.texto), texto: f.texto })
    offset += f.dur
  }
  return { id: 't1', trechos, palavras, duracao: offset }
}
const take = takeDe(FRASES)
const fraseDe = (id: string) => roteiro.secoes.flatMap((s) => s.frases).find((f) => f.id === id)!

/** f03: uma cena (0031) e a fita 0031/0032/0033; f04: tres cenas (0041, 0042, 0043) nas palavras 0, 4 e 8. */
function escolhas(): EscolhaDaFrase[] {
  return FRASES.map((f, i) => {
    const n = (i + 1) * 10
    const base: EscolhaDaFrase = {
      fraseId: f.id,
      cenas: [{ candidato: cand([id4(n + 1)], 44), palavraInicio: 0 }],
      fita: [cand([id4(n + 1)], 44), cand([id4(n + 2)], 41), cand([id4(n + 3)], 20)],
      confianca: 0.5,
      travada: false,
      hashTexto: hashDoTexto(f.texto),
      duracao: f.dur,
      avisos: [],
    }
    if (f.id === 'f04') {
      base.cenas = [
        { candidato: cand(['0041'], 44), palavraInicio: 0 },
        { candidato: cand(['0042'], 42), palavraInicio: 4 },
        { candidato: cand(['0043'], 40), palavraInicio: 8 },
      ]
      base.fita = [cand(['0041'], 44), cand(['0042'], 42), cand(['0043'], 40), cand(['0044'], 39)]
    }
    return encaixarEscolha(base, { indice, frase: fraseDe(f.id), take }).escolha
  })
}
function entrada(xs: EscolhaDaFrase[], extra: Partial<EntradaDoGrid> = {}): EntradaDoGrid {
  const rosto = [{ cx: 0.5, cy: 0.4, w: 0.3, h: 0.5 }]
  const rostos = new Map(PLANOS.map((p) => [p.id, [rosto, rosto, rosto]]))
  const quem: QuemNoGrid = { citados: new Map(), noPlano: (id) => new Set([`p${id}`]) }
  return { roteiro, take, indice, escolhas: xs, modo: 'automatico', rostos, quem, ...extra }
}
const da = (xs: readonly EscolhaDaFrase[], id: string): EscolhaDaFrase => xs.find((x) => x.fraseId === id)!
const dur = (x: EscolhaDaFrase, k: number): number => {
  const f = FRASES.find((y) => y.id === x.fraseId)!
  const ws = palavrasDaFrase(f.texto).length
  const ini = (x.cenas[k]?.palavraInicio ?? 0) / ws
  const fim = (x.cenas[k + 1]?.palavraInicio ?? ws) / ws
  return (fim - ini) * f.dur
}

// ------------------------------------------------------------ A

secao('A. a sugestao do app para a de baixo')
{
  const xs = escolhas()
  const s = sugestaoDeBaixo(entrada(xs), 'f03', 0)
  confere(!('erro' in s), 'a frase de uma cena ganha sugestao', s)
  if (!('erro' in s)) {
    confere(s.cima.planoIds.join() === '0031' && s.cima.origem === 'usuario', 'a cena dele fica em cima (0031, usuario)', s.cima)
    confere(s.baixo?.planoIds.join() === '0032' && s.baixo.origem === 'sugestao', 'embaixo a parceira da fita, marcada como do app', s.baixo)
  }
  const s3 = sugestaoDeBaixo(entrada(xs), 'f04', 1)
  confere(!('erro' in s3) && s3.cima.planoIds.join() === '0042' && s3.baixo?.planoIds.join() === '0044', 'na de 3 cenas, a cena 2 em cima e a 0044 embaixo (as outras cenas da frase nao entram)', s3)
  const so = xs.map((x) => (x.fraseId === 'f03' ? { ...x, fita: [x.fita[0]!] } : x))
  const nada = sugestaoDeBaixo(entrada(so), 'f03', 0)
  confere(!('erro' in nada) && nada.baixo === null, 'sem parceira na fita: nada (ele escolhe na grade)', nada)
  confere('erro' in sugestaoDeBaixo({ ...entrada(xs), take: null }, 'f03', 0), 'sem voz aprovada: recado')
}

// ------------------------------------------------------------ B

secao('B. a de baixo que ele clicou')
{
  const xs = escolhas()
  const f04 = da(xs, 'f04')
  const clicado = cand(['0099'], 0, { origem: 'busca' })
  const d = dur(f04, 1)
  const baixo = metadeDeBaixoDele(clicado, d, MAPA)
  confere(baixo.planoIds.join() === '0099' && baixo.origem === 'usuario' && baixo.inSec === MAPA.get('0099')!.start, 'o plano dele, desde o comeco, usuario', baixo)
  const nova = comGridNaMao(f04, 1, metadeDeCima(f04.cenas[1]!, d, MAPA), baixo)
  confere(nova.cenas[1]!.candidato.planoIds.join() === '0042' && nova.cenas[1]!.baixo?.planoIds.join() === '0099', 'a cena 2: 0042 em cima, 0099 embaixo')
  confere(nova.cenas[0] === f04.cenas[0] && nova.cenas[2] === f04.cenas[2] && !nova.cenas[0]!.baixo && !nova.cenas[2]!.baixo, 'as cenas 1 e 3 ficam como estavam (tela cheia)')
  confere(nova.cenas.map((c) => c.palavraInicio).join() === '0,4,8', 'os cortes nas mesmas palavras')
  confere(nova.grid?.origem === 'mao' && nova.travada && nova.telaCheia === undefined, 'grid na mao, travada, sem Tela cheia', nova.grid?.origem)
  confere(JSON.stringify(nova.grid?.antes) === JSON.stringify(f04.cenas), 'guarda as cenas de antes (o Tela cheia volta a elas)')
  const enc = encaixarEscolha(nova, { indice, frase: fraseDe('f04'), take }).escolha
  confere(enc.cenas[1]!.baixo?.planoIds.join() === '0099' && enc.cenas[1]!.baixo?.origem === 'usuario', 'o encaixe nao troca a de baixo dele', enc.cenas[1]!.baixo)
  confere(escolhaDaFraseSchema.safeParse(enc).success, 'passa no schema')
  // A cima emendada pelo casar vira o plano que cobre; a posta a mao, o plano dele.
  const emenda = cand(['0090', '0091'], 40, { inSec: 540, outSec: 552 })
  confere(metadeDeCima({ candidato: emenda }, 3, MAPA).planoIds.join() === '0091', 'cima do casar emendada (0090 de 1 s + 0091): a metade e o 0091, que cobre')
  confere(metadeDeCima({ candidato: { ...emenda, origem: 'usuario' } }, 3, MAPA).planoIds.join() === '0090', 'cima posta a mao: o plano dele (0090), mesmo curto')
}

// ------------------------------------------------------------ C

secao('C. inverter e tirar a de baixo')
{
  const xs = escolhas()
  const f03 = da(xs, 'f03')
  const s = sugestaoDeBaixo(entrada(xs), 'f03', 0)
  if ('erro' in s || !s.baixo) throw new Error('sem sugestao')
  const g = comGridNaMao(f03, 0, s.cima, s.baixo)
  const inv = inverterMetades(g, 0)!
  confere(inv.cenas[0]!.candidato.planoIds.join() === '0032' && inv.cenas[0]!.baixo?.planoIds.join() === '0031', 'inverter: 0032 em cima, 0031 embaixo')
  confere(inv.cenas[0]!.candidato.origem === 'usuario' && inv.cenas[0]!.baixo?.origem === 'usuario', 'inverter: as duas passam a ser dele')
  confere(inverterMetades(f03, 0) === null, 'sem grid, inverter nao faz nada')
  const tirada = tirarMetadeDeBaixo(g, 0)!
  confere(!tirada.cenas[0]!.baixo && tirada.cenas[0]!.candidato.planoIds.join() === '0031', 'tirar: volta a tela cheia com a de cima')
  confere(JSON.stringify(tirada.cenas[0]!.candidato) === JSON.stringify(f03.cenas[0]!.candidato), 'a cena volta inteira, como era antes do grid')
  confere(tirada.grid === undefined && tirada.telaCheia === true && tirada.travada, 'sem grid na frase: Tela cheia (o automatico nao poe mais)')
  const tiradaInv = tirarMetadeDeBaixo(inv, 0)!
  confere(tiradaInv.cenas[0]!.candidato.planoIds.join() === '0032' && !tiradaInv.cenas[0]!.baixo, 'invertido e tirado: fica a de cima (0032)')
  // Duas cenas com grid: tirar uma deixa a outra.
  const f04 = da(xs, 'f04')
  const dois = comGridNaMao(comGridNaMao(f04, 0, f04.cenas[0]!.candidato, cand(['0098'], 0, { origem: 'usuario' })), 2, f04.cenas[2]!.candidato, cand(['0097'], 0, { origem: 'usuario' }))
  const umSo = tirarMetadeDeBaixo(dois, 0)!
  confere(umSo.grid?.origem === 'mao' && !umSo.cenas[0]!.baixo && umSo.cenas[2]!.baixo?.planoIds.join() === '0097', 'com outro grid na frase, ele fica')
  confere(JSON.stringify(umSo.grid?.antes) === JSON.stringify(f04.cenas), 'as cenas de antes sao as do primeiro grid')
}

// ------------------------------------------------------------ D

secao('D. o encaixe da metade dele')
{
  // f03 com 3,3 s; o 0090 tem 1 s. Frase de 1,4 s = falta 0,4 s; de 1,7 s = falta 0,7 s.
  const curto = (d: number, origem: CandidatoDeCena['origem']) => {
    const fr: FraseDoTeste = { id: 'f03', texto: 'A garota olha para ele e sorri.', dur: d, papel: 'desenvolvimento' }
    const tk = takeDe([fr])
    const x: EscolhaDaFrase = {
      ...da(escolhas(), 'f03'),
      cenas: [{ candidato: cand(['0031'], 44, { origem: 'usuario' }), palavraInicio: 0, baixo: cand(['0090'], 0, { origem }) }],
      grid: { origem: 'mao', antes: [] },
      travada: true,
    }
    return encaixarEscolha(x, { indice, frase: fraseDe('f03'), take: tk })
  }
  const r04 = curto(1.4, 'usuario')
  confere(!r04.escolha.avisos.includes(AVISO_CENA_CURTA) && r04.escolha.cenas[0]!.baixo?.planoIds.join() === '0090', 'falta 0,4 s na dele: congela sem aviso', r04.escolha.avisos)
  const r07 = curto(1.7, 'usuario')
  confere(r07.escolha.avisos.includes(AVISO_CENA_CURTA) && r07.escolha.cenas[0]!.baixo?.planoIds.join() === '0090', 'falta 0,7 s: Cena curta, o plano continua o dele', r07.escolha.avisos)
  confere(r07.avisos.includes('f03: cena curta: 1,0 s para 1,7 s na metade do grid'), 'o recado da metade', r07.avisos)
  const app = curto(1.4, 'sugestao')
  confere(app.escolha.avisos.includes(AVISO_CENA_CURTA) && app.avisos.some((a) => a.includes('grid com uma metade curta')), 'a metade do app: a folga de antes (0,4 s ja avisa)', app.avisos)
}

// ------------------------------------------------------------ E

secao('E. o automatico nao mexe')
{
  const xs = escolhas()
  const s = sugestaoDeBaixo(entrada(xs), 'f04', 1)
  if ('erro' in s || !s.baixo) throw new Error('sem sugestao')
  const naMao = comGridNaMao(da(xs, 'f04'), 1, s.cima, cand(['0099'], 0, { origem: 'usuario' }))
  const cheia = tirarMetadeDeBaixo(comGridNaMao(da(xs, 'f03'), 0, s.cima, s.baixo), 0)!
  const mexidas = xs.map((x) => (x.fraseId === 'f04' ? naMao : x.fraseId === 'f03' ? cheia : x))
  const r = gridsAutomaticos(entrada(mexidas))
  confere(JSON.stringify(da(r.escolhas, 'f04')) === JSON.stringify(naMao), 'o grid na mao fica igualzinho')
  confere(!da(r.escolhas, 'f03').cenas.some((c) => c.baixo), 'a frase que ele tirou o grid continua em tela cheia')
  confere(!r.mudadas.includes('f04') && !r.mudadas.includes('f03'), 'nenhuma das duas e encaixada de novo', r.mudadas)
}

// ------------------------------------------------------------ F

secao('F. a montagem: imageIndexB da metade dele')
{
  const xs = escolhas()
  const f03 = da(xs, 'f03')
  const g = encaixarEscolha(comGridNaMao(f03, 0, metadeDeCima(f03.cenas[0]!, 3.3, MAPA), metadeDeBaixoDele(cand(['0099'], 0, { origem: 'busca' }), 3.3, MAPA)), {
    indice,
    frase: fraseDe('f03'),
    take,
  }).escolha
  const cenas = { escolhas: xs.map((x) => (x.fraseId === 'f03' ? g : x)) }
  const base = { rascunho: { id: 'rc_bbbbbbbbbbbb_teste1', episodioId: EP }, roteiro, take, indice: { ...indice, cues: [] }, cenas }
  const { pedacos } = pedacosDaMontagem(base)
  const p = pedacos.find((x) => x.fraseId === 'f03')!
  confere(p.planoId === '0031' && p.baixo?.planoId === '0099', 'o bloco da f03: 0031 em cima, 0099 embaixo', [p.planoId, p.baixo?.planoId])
  const { file } = montarArquivoDoProjeto({ ...base, narracaoPath: 'C:/fake/narracao.wav', agora: '2026-10-20T12:00:00.000Z' })
  const comB = file.plan!.scenes.filter((s) => s.imageIndexB !== null)
  confere(comB.length === 1, 'uma cena com imageIndexB', comB.length)
  const s0 = comB[0]
  const img = s0 && s0.imageIndexB !== null ? JSON.stringify(file.images[s0.imageIndexB]) : ''
  confere(img.includes('0099'), 'o imageIndexB aponta para o 0099', img)
  confere(!!s0 && JSON.stringify(file.images[s0.imageIndex]).includes('0031'), 'o imageIndex aponta para o 0031')
}

// ------------------------------------------------------------ G

secao('G. a tela')
{
  const raiz = join(__dirname, '..', 'src')
  const ler = (p: string): string => readFileSync(join(raiz, p), 'utf8')
  const store = ler('store/gerar-cenas.ts')
  const trocar = store.slice(store.indexOf('    trocarCena: (candidato, fraseId) =>'), store.indexOf('    adicionarCena: (candidato, fraseId) =>'))
  const adicionar = store.slice(store.indexOf('    adicionarCena: (candidato, fraseId) =>'), store.indexOf('    completarCena: (fraseId, k) =>'))
  confere(trocar.includes('get().porEmbaixo(candidato)') && adicionar.includes('get().porEmbaixo(candidato)'), 'com o grid na mao, o clique (e o Shift+clique) na grade vai embaixo')
  confere(/escolherFrase[\s\S]{0,400}gridNaMao: null/.test(store), 'trocar de frase encerra o grid na mao')
  const passo = ler('components/PassoDasCenas.tsx')
  confere(/'Escape'[\s\S]{0,400}cancelarGrid\(\)/.test(passo) && passo.includes("addEventListener('keydown', esc, true)"), 'Esc cancela (na captura, antes do Esc que fecha o assistente)')
  const grade = ler('components/GradeDasCenas.tsx')
  confere(grade.includes('Agora clique na cena que vai EMBAIXO') && grade.includes('Manter a sugestao') && grade.includes('Cancelar (Esc)'), 'o aviso no topo da grade')
  const frases = ler('components/FrasesDasCenas.tsx')
  confere(frases.includes('Escolha a cena de CIMA') && frases.includes('Inverter cima e baixo') && frases.includes('Tirar a de baixo'), 'na esquerda: a de cima, inverter e tirar a de baixo')
  confere(frases.includes('sugestao do app'), 'a de baixo do app marcada como sugestao')
  confere(/if \(v\) pedirGrid\(fraseId\)[\s\S]{0,120}cancelarGrid\(\)/.test(frases), '"Grid" pede o grid na mao; "Tela cheia" desliga ou cancela')
}

console.log(falhas === 0 ? '\nv-grid-mao: tudo ok' : `\nv-grid-mao: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
