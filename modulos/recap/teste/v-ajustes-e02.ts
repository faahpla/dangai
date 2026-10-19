/**
 * [recap] OS DETALHES DE TELA do teste real do Magic Repo Man E02 (18/10),
 * sem gastar nada e sem o app:
 *
 * 1. o nome do projeto: o anime CURTO + SxxEyy (+ data nos arquivos), sem
 *    cortar palavra ("...Support Fairy to Becom" sem o S01E02 era o de antes);
 * 2. a chamada ao publico ("Comenta ai: ...?") sem evento nao avisa; frase
 *    de fato sem evento continua avisando;
 * 3. a muleta: o "Melhorar texto" do E02 abriu 5 frases com "So que" -- o
 *    aviso ('"So que" repetido 5x'), o prompt do Melhorar com a regra (no
 *    maximo 2) e as muletas achadas, e o recado depois de melhorar;
 * 4. o foco depois de gerar a voz: o "Aprovar voz", nunca um botao que gasta;
 * 5. o saldo do ElevenLabs desconta o que a sessao gastou e a conta ainda nao
 *    refletiu (10.000 - 284 = 9.716), e volta a confiar na conta quando ela
 *    reflete;
 * 6. o Fish: o custo em US$ (US$ 15 por milhao de bytes) na linha do custo, e
 *    a 1a voz da conta sugerida quando nenhuma foi escolhida.
 *
 * Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-ajustes-e02.ts
 */
import { promptDaMelhoria, sistemaDaMelhoria } from '../electron/gerar/revisor'
import { carimbo, nomeCurtoDoAnime, nomeDoProjeto, nomeDosArquivos, nomeSeguro } from '../electron/montar/pasta'
import { esquecerSaldo, registrarGastoEleven, restamDescontado } from '../electron/voz/saldo'
import { resumoDaRevisao } from '../shared/revisao'
import { chamaOPublico, conectivosRepetidos, validarRoteiro, type Evento, type Roteiro } from '../shared/roteiro'
import {
  custoEmDolar,
  dolaresDoFish,
  ehBotaoPago,
  focoDepoisDaVoz,
  sugerirVozDoFish,
  textoDaEstimativa,
  type EstimativaDeCusto,
} from '../shared/voz'

let falhas = 0
function confere(ok: boolean, nome: string): void {
  console.log(`  ${ok ? 'ok ' : 'FALHOU'} ${nome}`)
  if (!ok) falhas++
}
const secao = (nome: string): void => console.log(`\n== ${nome}`)

const MRM = 'Magic Repo Man Dumped by My Party Ill Cash In With a Cute Support Fairy to Become the Strongest'

/** As frases do E02 (v2, a aprovada, e v3, a do "Melhorar texto"), com os eventos citados. */
const V2: [string, string, string[]][] = [
  ['gancho', 'Mano… esse cara foi expulso por ser considerado inútil.', ['e01']],
  ['gancho', 'Só que ele deixou o antigo grupo com uma dívida impagável.', ['e06']],
  ['contexto', 'O Lent passou cinco anos servindo apenas de bateria mágica.', ['e01']],
  ['contexto', 'Só que no fim, os parceiros jogaram ele na rua.', ['e10']],
  ['desenvolvimento', 'Mas é aqui que a história vira.', ['e02']],
  ['desenvolvimento', 'Mas o líder Guy humilha o garoto e se recusa a pagar.', ['e12']],
  ['virada', 'Só que essa recusa era o gatilho da Cobrança Forçada.', ['e13']],
  ['fechamento', 'Mas caíram na cobrança mais impiedosa do mundo mágico.', ['e21']],
  ['fechamento', 'Comenta aí: essa cobrança foi merecida ou passou dos limites?', []],
]
const V3: [string, string, string[]][] = [
  ['gancho', 'Mano… esse cara foi expulso por acharem que era inútil.', ['e01']],
  ['gancho', 'Só que ele deixou os ex-parceiros com uma dívida impagável.', ['e06']],
  ['contexto', 'Só que no fim, os parceiros jogaram ele na rua.', ['e10']],
  ['desenvolvimento', 'Só que aí a história dá uma virada completa.', ['e02']],
  ['desenvolvimento', 'Só que o líder Guy humilha ele e se nega a pagar.', ['e12']],
  ['virada', 'Só que essa recusa era o gatilho da Cobrança Forçada.', ['e13']],
  ['fechamento', 'Mas caíram direto na cobrança mais cruel desse mundo.', ['e21']],
  ['fechamento', 'Comenta aí: essa cobrança foi bem merecida ou exagero?', []],
]

function roteiro(frases: [string, string, string[]][]): Roteiro {
  const secoes: Roteiro['secoes'] = []
  frases.forEach(([papel, texto, eventoIds], i) => {
    let s = secoes[secoes.length - 1]
    if (!s || s.papel !== papel) {
      s = { id: `s${secoes.length + 1}`, papel: papel as Roteiro['secoes'][number]['papel'], frases: [] }
      secoes.push(s)
    }
    s.frases.push({
      id: `f${String(i + 1).padStart(2, '0')}`,
      texto,
      eventoIds,
      cueDoMomento: null,
      intencaoVisual: eventoIds.length > 0 ? 'close' : '',
      textoDeTela: null,
      citacaoCueId: null,
    })
  })
  return { versao: 1, alvoSec: 60, secoes, modelo: 'teste', criadoEm: '2026-10-18T00:00:00.000Z', origem: 'ia', derivadoDe: null, pedido: null }
}

const EVENTOS: Evento[] = ['e01', 'e02', 'e06', 'e10', 'e12', 'e13', 'e21'].map((id, i) => ({
  id,
  cueIds: [`c${String(i + 1).padStart(4, '0')}`],
  t0: i * 10,
  t1: i * 10 + 5,
  resumo: 'Lent e expulso, cobra a divida e o grupo se recusa a pagar.',
  personagens: ['Lent', 'Guy'],
  peso: 3,
}))

function principal(): void {
  // ===================================================================== 1.
  secao('1. O nome do projeto')
  const ep = { anime: MRM, temporada: 1, episodio: 2, kind: '' }
  const quando = new Date(2026, 9, 18, 21, 46)
  confere(nomeCurtoDoAnime(MRM) === 'Magic Repo Man Dumped', `o anime curto: "${nomeCurtoDoAnime(MRM)}"`)
  confere(nomeDoProjeto(ep) === 'Magic Repo Man Dumped S01E02', `a pasta: "${nomeDoProjeto(ep)} - ${carimbo(quando)}"`)
  confere(nomeDosArquivos(nomeDoProjeto(ep), quando) === 'Magic Repo Man Dumped S01E02 2026-10-18', `os arquivos: "${nomeDosArquivos(nomeDoProjeto(ep), quando)}.dangai"`)
  confere(nomeCurtoDoAnime('Dr. Stone: Science Future') === 'Dr. Stone' && nomeCurtoDoAnime('Sousou no Frieren') === 'Sousou no Frieren', 'o titulo antes do subtitulo ("Dr. Stone"); curto fica inteiro')
  confere(nomeCurtoDoAnime('The Rising of the Shield Hero') === 'The Rising', 'nao termina em palavra de ligacao ("The Rising of the" -> "The Rising")')
  const longos = [MRM, 'Tensei shitara Slime Datta Ken: Coleus no Yume', 'Kono Subarashii Sekai ni Shukufuku wo! Kurenai Densetsu', 'A'.repeat(120)]
  const inteiras = longos.every((t) => {
    const nome = nomeDoProjeto({ anime: t, temporada: 2, episodio: 13, kind: '' })
    const palavras = nome.split(' ')
    const doAnime = t.split(/\s+/)
    return nome.endsWith('S02E13') && nome.length <= 80 && palavras.slice(0, -1).every((p, i) => p === doAnime[i] || (t.length > 80 && i === 0))
  })
  confere(inteiras, 'nenhum nome corta palavra no meio, e o SxxEyy sempre fica')
  confere(nomeSeguro(`${'palavra '.repeat(15)}fim`) === `${'palavra '.repeat(10).trim()}`, 'o teto de 80 letras corta na palavra inteira')

  // ===================================================================== 2.
  secao('2. A chamada ao publico sem evento')
  const p2 = validarRoteiro(roteiro(V2), EVENTOS)
  const semEvento = p2.filter((p) => p.codigo === 'frase-sem-evento')
  confere(semEvento.length === 0, `"Comenta ai: ...?" sem evento nao avisa (${semEvento.map((p) => p.fraseId).join(',') || 'nenhum'})`)
  const comFato = validarRoteiro(roteiro([...V2, ['fechamento', 'O Guy perdeu a casa inteira.', []]]), EVENTOS)
  confere(comFato.some((p) => p.codigo === 'frase-sem-evento' && p.fraseId === 'f10'), 'frase de fato sem evento continua avisando')
  confere(
    chamaOPublico('Comenta aí: essa cobrança foi merecida?') && chamaOPublico('E você, faria o mesmo?') && chamaOPublico('Me diz nos comentários quem ganha.') && chamaOPublico('O que vocês acham disso?'),
    'comenta / e voce / me diz / o que voces acham',
  )
  confere(!chamaOPublico('O Lent comentava a divida.') && !chamaOPublico('Ela diz que vai cobrar.'), 'fala de personagem nao e chamada ao publico')

  // ===================================================================== 3.
  secao('3. A muleta do Melhorar texto')
  const m3 = conectivosRepetidos(roteiro(V3))
  confere(m3.length === 1 && m3[0]!.rotulo === 'So que' && m3[0]!.vezes === 5, `a v3: "So que" ${m3[0]?.vezes}x (${m3[0]?.fraseIds.join(', ')})`)
  const p3 = validarRoteiro(roteiro(V3), EVENTOS)
  confere(p3.some((p) => p.codigo === 'conectivo-repetido' && p.mensagem === '"So que" repetido 5x' && p.nivel === 'aviso'), 'o aviso: "So que" repetido 5x')
  const m2 = conectivosRepetidos(roteiro(V2))
  confere(m2.map((m) => `${m.rotulo} ${m.vezes}`).sort().join(', ') === 'Mas 3, So que 3', `a v2 tambem passa de 2 (${m2.map((m) => `${m.rotulo} ${m.vezes}x`).join(', ')})`)
  confere(conectivosRepetidos(roteiro(V2.slice(0, 4))).length === 0, 'ate 2 do mesmo: sem aviso')
  const sistema = sistemaDaMelhoria(null)
  confere(/CONECTIVO NÃO VIRA MULETA/.test(sistema) && /no máximo 2 vezes no roteiro INTEIRO/.test(sistema), 'o prompt do Melhorar tem a regra (no maximo 2)')
  const pedido = promptDaMelhoria({
    indice: { anime: MRM, temporada: 1, episodio: 2, kind: '', cues: [], exclusoes: [], planos: [] },
    eventos: EVENTOS,
    elenco: { personagens: [], comFalante: false, porPalavra: new Map() },
    roteiro: roteiro(V3),
  })
  confere(/CONECTIVOS REPETIDOS que o app achou[^\n]*"So que" 5x \(f02, f03, f04, f05, f06\)/.test(pedido), 'o "Melhorar de novo" leva as muletas achadas (frases)')
  confere(
    resumoDaRevisao({ modo: 'melhorar', trocadas: 6, marcadas: 0, versaoNova: 3, muleta: '"So que" repetido 5x' }) === '6 frases melhoradas, mas com muleta: "So que" repetido 5x' &&
      resumoDaRevisao({ modo: 'melhorar', trocadas: 6, marcadas: 0, versaoNova: 3 }) === '6 frases melhoradas',
    'o recado depois de melhorar diz a muleta',
  )

  // ===================================================================== 4.
  secao('4. O foco depois de gerar a voz')
  const depois = focoDepoisDaVoz({ cancelado: false })
  confere(depois[0] === 'aprovar-voz' && depois.includes('proximo-cenas') && depois.includes('tocar-voz'), `gerou: ${depois.join(' > ')}`)
  confere([...depois, ...focoDepoisDaVoz({ cancelado: true })].every((f) => !ehBotaoPago(f)), 'nenhum botao que gasta, nem depois de cancelar')
  confere(ehBotaoPago('gerar-voz') && ehBotaoPago('regravar-f02') && ehBotaoPago('regravar-mudou') && !ehBotaoPago('aprovar-voz') && !ehBotaoPago('aplicar-voz'), 'pagos: Gerar e Regravar; o Aplicar (pos) e de graca')

  // ===================================================================== 5.
  secao('5. O saldo do ElevenLabs depois de gastar')
  esquecerSaldo()
  confere(restamDescontado(10_000) === 10_000, 'a primeira leitura: 10.000')
  registrarGastoEleven(284)
  confere(restamDescontado(10_000) === 9_716, 'gastou 284 e a conta ainda diz 10.000: a tela diz 9.716')
  registrarGastoEleven(120)
  confere(restamDescontado(10_000) === 9_596, 'mais 120: 9.596')
  confere(restamDescontado(9_596) === 9_596 && restamDescontado(9_596) === 9_596, 'a conta refletiu: volta a confiar nela (sem descontar duas vezes)')
  confere(restamDescontado(9_000) === 9_000, 'gasto fora do app (a conta caiu mais): vale a conta')
  esquecerSaldo()
  registrarGastoEleven(500)
  confere(restamDescontado(10_000) === 10_000, 'gasto antes de qualquer leitura nao inventa saldo')

  // ===================================================================== 6.
  secao('6. Fish: o custo em US$ e a voz sugerida')
  const texto = V2.map(([, t]) => t).join(' ')
  const bytes = Buffer.byteLength(texto, 'utf8')
  const usd = dolaresDoFish(bytes, 's2.1-pro')
  confere(Math.abs(usd - (bytes * 15) / 1e6) < 1e-12 && dolaresDoFish(bytes, 's2.1-pro-free') === 0, `US$ 15 por milhao de bytes (${bytes} bytes = US$ ${usd.toFixed(5)}); o free nao cobra`)
  const e1291: EstimativaDeCusto = {
    fonte: 'fish', fraseIds: [], caracteres: 1291, pagos: 1291, aCobrar: 1291, creditos: null, doCache: false,
    restam: null, limite: null, plano: null, saldo: '7.51', dolares: dolaresDoFish(1329, 's2.1-pro'), suficiente: null, aviso: null,
  }
  confere(textoDaEstimativa(e1291) === '1.291 caracteres (~US$ 0,02) · Fish Audio · saldo US$ 7,51', `a linha: "${textoDaEstimativa(e1291)}"`)
  confere(custoEmDolar(0.004) === '< US$ 0,01' && custoEmDolar(1.5) === '~US$ 1,50', 'centavos: "< US$ 0,01"; "~US$ 1,50"')
  const eleven: EstimativaDeCusto = { ...e1291, fonte: 'elevenlabs', creditos: 284, saldo: null, dolares: null, restam: 9716 }
  confere(textoDaEstimativa(eleven) === '1.291 caracteres (~284 creditos) · ElevenLabs · restam 9.716 creditos', 'o ElevenLabs como era')
  const form = { fonte: 'fish', fish: { voiceId: '', modelId: '' }, eleven: { voiceId: 'x', modelId: 'y' } }
  const sugerido = sugerirVozDoFish(form, [{ id: 'voz-propria-1' }, { id: 'outra' }])
  confere(sugerido.fish.voiceId === 'voz-propria-1' && sugerido.fish.modelId === 's2.1-pro', 'sem voz do Fish: a 1a da conta, no modelo padrao')
  const escolhida = { ...form, fish: { voiceId: 'a-dele', modelId: 's1' } }
  confere(sugerirVozDoFish(escolhida, [{ id: 'voz-propria-1' }]) === escolhida && sugerirVozDoFish(form, []) === form && sugerirVozDoFish(form, null) === form, 'voz escolhida (ou conta sem voz): nada muda')
}

try {
  principal()
  console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
} catch (err) {
  console.error(err)
  process.exit(1)
}
