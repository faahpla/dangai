/**
 * As contas da etapa de audio (shared/edicao-de-audio.ts): as faixas, cortar, apagar com o
 * buraco fechando, achar e encolher silencios, e ir e voltar entre o tempo
 * editado e o da gravacao.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/teste/v-edicao-de-audio.ts
 */
import {
  aparar,
  apagarIntervalo,
  apagarTrechos,
  cadeiaDeAudioSchema,
  CADEIA_PADRAO,
  caminhoDaFonte,
  cortarEm,
  cortarSilencios,
  duracaoEditada,
  edicaoDeAudioSchema,
  faixasUsadas,
  fatorDaVelocidade,
  fecharBuraco,
  filtrosDaCadeia,
  ganhoDosTrechos,
  inserirEm,
  limiteDaIa,
  moverPerto,
  moverTrechos,
  novaEdicao,
  silenciosDoSinal,
  sobAgulha,
  sobrepoe,
  substituirIntervalo,
  trechoDaCorrecao,
  type TrechoDaGravacao,
} from '../../shared/edicao-de-audio.ts'
import { montarMix } from '../../electron/services/edicao-de-audio.ts'

let falhas = 0
function conferir(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) {
    console.log(`  ok   ${nome}`)
  } else {
    falhas += 1
    console.log(`  FALHA ${nome}\n        obtido:   ${a}\n        esperado: ${b}`)
  }
}
const round = (x: number): number => Math.round(x * 1000) / 1000
/** [de, ate] da gravacao, na ordem do tempo. */
const pares = (t: readonly TrechoDaGravacao[]): number[][] => ordem(t).map((x) => [round(x.de), round(x.ate)])
/** [em, faixa, de, ate]: onde cada trecho esta. */
const lugares = (t: readonly TrechoDaGravacao[]): number[][] => ordem(t).map((x) => [round(x.em), x.faixa, round(x.de), round(x.ate)])
const ordem = (t: readonly TrechoDaGravacao[]): TrechoDaGravacao[] => [...t].sort((a, b) => a.em - b.em || a.faixa - b.faixa)
const ids = (...t: TrechoDaGravacao[]): Set<string> => new Set(t.map((x) => x.id))
let n = 0
const tr = (em: number, faixa: number, de: number, ate: number, fonte = 'principal'): TrechoDaGravacao => ({
  de,
  ate,
  em,
  faixa,
  fonte,
  ganhoDb: 0,
  id: `x${(n += 1)}`,
})

console.log('cortar e apagar (uma faixa, como era)')
{
  const e = novaEdicao('C:/gravacao.wav', 10)
  conferir('comeca com a gravacao inteira, na A1, no zero', lugares(e.trechos), [[0, 0, 0, 10]])
  const dois = cortarEm(e.trechos, 4)
  conferir('C no 4: dois pedacos, o segundo no 4', lugares(dois), [[0, 0, 0, 4], [4, 0, 4, 10]])
  conferir('a segunda metade ganha id proprio', new Set(dois.map((x) => x.id)).size, 2)
  conferir('cortar onde ja tem corte nao faz nada', pares(cortarEm(dois, 4.005)), [[0, 4], [4, 10]])
  const sem = apagarIntervalo(dois, 2, 6)
  conferir('apagar de 2 a 6 fecha o buraco', lugares(sem), [[0, 0, 0, 2], [2, 0, 6, 10]])
  conferir('a duracao encolhe 4 s', duracaoEditada(sem), 6)
  conferir('apagar o primeiro pedaco (fechando)', lugares(apagarTrechos(sem, ids(ordem(sem)[0]!), true)), [[0, 0, 6, 10]])
  conferir('apagar o primeiro pedaco deixando o vao (Backspace)', lugares(apagarTrechos(sem, ids(ordem(sem)[0]!), false)), [[2, 0, 6, 10]])
  conferir('apagar atravessando tres pedacos', pares(apagarIntervalo(cortarEm(cortarEm(e.trechos, 3), 6), 2, 8)), [[0, 2], [8, 10]])
  conferir('volume so de um pedaco', ordem(ganhoDosTrechos(sem, ids(ordem(sem)[1]!), -6)).map((x) => x.ganhoDb), [0, -6])
  conferir('so o escolhido e cortado', lugares(cortarEm([tr(0, 0, 0, 4), tr(0, 1, 0, 4)], 2, new Set(['x1']))), [[0, 0, 0, 2], [0, 1, 0, 4], [2, 0, 2, 4]])
}

console.log('faixas: o que esta em faixas diferentes toca junto')
{
  // A1: [0-4] e [6-9]; A2: [3-6] -- a fala revezando, como no print do DaVinci.
  const a = tr(0, 0, 0, 4)
  const b = tr(3, 1, 4, 7)
  const c = tr(6, 0, 7, 10)
  const t = [a, b, c]
  conferir('a linha do tempo vai ate o fim do ultimo', duracaoEditada(t), 9)
  conferir('faixas em uso', faixasUsadas(t), 2)
  conferir('debaixo do 3,5: um de cada faixa', sobAgulha(t, 3.5).map((x) => x.id), [a.id, b.id])
  conferir('so da A2', sobAgulha(t, 3.5, 1).map((x) => x.id), [b.id])
  conferir('sem sobreposicao na mesma faixa', sobrepoe(t), false)
  conferir('mover o da A2 para a A1 no 3 cai por cima', moverTrechos(t, ids(b), 0, -1), null)
  conferir('mover para antes do zero nao vale', moverTrechos(t, ids(a), -1, 0), null)
  conferir('mover para uma faixa que nao existe nao vale', moverTrechos(t, ids(b), 0, 9), null)
  const desceu = moverTrechos(t, ids(b), 1, 1)!
  conferir('mover para a A3, um segundo depois', lugares(desceu), [[0, 0, 0, 4], [4, 2, 4, 7], [6, 0, 7, 10]])
  // Arrastar o primeiro da A1 para cima do terceiro: encosta antes dele.
  const perto = moverPerto(t, ids(a), 4, 0)!
  conferir('arrastar por cima do vizinho encosta nele', [round(perto.dt), lugares(perto.trechos)[0]], [2, [2, 0, 0, 4]])
  conferir('dois juntos andam juntos', lugares(moverTrechos(t, ids(a, c), 1, 0)!), [[1, 0, 0, 4], [3, 1, 4, 7], [7, 0, 7, 10]])
}

console.log('apagar com varias faixas: o vao fecha em todas, sem nada por cima de nada')
{
  const a = tr(0, 0, 0, 4)
  const b = tr(4, 1, 4, 7)
  const c = tr(7, 0, 7, 10)
  conferir('tirar o da A2 (Delete): o da A1 depois dele chega para tras', lugares(apagarTrechos([a, b, c], ids(b), true)), [[0, 0, 0, 4], [4, 0, 7, 10]])
  // A2 com um trecho parado que atravessa o vao: ele nao segura a A1.
  conferir(
    'um trecho parado em outra faixa nao segura esta',
    lugares(fecharBuraco([tr(0, 0, 0, 3), tr(2, 1, 20, 25), tr(8, 0, 8, 10)], 3, 8)),
    [[0, 0, 0, 3], [2, 1, 20, 25], [3, 0, 8, 10]],
  )
  // ...mas se a A2 tem um trecho que precisa andar, ele so anda ate encostar: e todos param ali.
  conferir(
    'o vao fecha ate onde da, igual em todas as faixas',
    lugares(fecharBuraco([tr(0, 0, 0, 3), tr(2, 1, 20, 25), tr(8, 1, 0, 1), tr(8, 0, 8, 10)], 3, 8)),
    [[0, 0, 0, 3], [2, 1, 20, 25], [7, 0, 8, 10], [7, 1, 0, 1]],
  )
  conferir(
    'se a A2 vem depois, ela anda junto',
    lugares(fecharBuraco([tr(0, 0, 0, 3), tr(8, 1, 0, 2), tr(9, 0, 3, 4)], 3, 8)),
    [[0, 0, 0, 3], [3, 1, 0, 2], [4, 0, 3, 4]],
  )
  conferir(
    'apagar um intervalo corta todas as faixas',
    lugares(apagarIntervalo([tr(0, 0, 0, 6), tr(1, 1, 0, 6)], 2, 4)),
    [[0, 0, 0, 2], [1, 1, 0, 1], [2, 0, 4, 6], [2, 1, 3, 6]],
  )
}

console.log('aparar a ponta (arrastar a borda)')
{
  const a = tr(0, 0, 0, 4)
  const b = tr(5, 0, 5, 9)
  const dur = { principal: 10 }
  conferir('puxar o fim do primeiro ate o 4,5', lugares(aparar([a, b], a.id, 'fim', 4.5, dur)), [[0, 0, 0, 4.5], [5, 0, 5, 9]])
  conferir('o fim nao passa do vizinho', lugares(aparar([a, b], a.id, 'fim', 7, dur))[0], [0, 0, 0, 5])
  conferir('o comeco do segundo volta ate o 4 (o som anda junto)', lugares(aparar([a, b], b.id, 'inicio', 4.2, dur))[1], [4.2, 0, 4.2, 9])
  conferir('o comeco nao passa do fim do vizinho', lugares(aparar([a, b], b.id, 'inicio', 1, dur))[1], [4, 0, 4, 9])
  conferir('nem do comeco da gravacao', lugares(aparar([tr(3, 0, 1, 4)], 'x' + n, 'inicio', 0, dur)), [[2, 0, 0, 4]])
  conferir('nem do fim da gravacao', lugares(aparar([tr(0, 0, 8, 9)], 'x' + n, 'fim', 5, dur)), [[0, 0, 8, 10]])
  conferir('nunca menor que 0,02 s', lugares(aparar([a], a.id, 'fim', -3, dur)), [[0, 0, 0, 0.02]])
}

console.log('silencios')
{
  // 10 ms por janela: 1 s de fala (-20 dB), 0,8 s de silencio (-70), 1 s de fala, 0,2 s de respiro, 1 s de fala.
  const sinal = [
    ...Array(100).fill(-20),
    ...Array(80).fill(-70),
    ...Array(100).fill(-20),
    ...Array(20).fill(-70),
    ...Array(100).fill(-20),
  ]
  const s = silenciosDoSinal(sinal, 0.01)
  conferir('acha a pausa longa e ignora o respiro curto', s.map((x) => [round(x.de), round(x.ate)]), [[1, 1.8]])
  const r = cortarSilencios([tr(0, 0, 0, 4)], s, 0.12, 4)
  conferir('a pausa encolhe deixando 0,12 s de cada lado, emendado', lugares(r.trechos), [[0, 0, 0, 1.12], [1.12, 0, 1.68, 4]])
  conferir('quanto encurtou', round(r.segundos), 0.56)
  conferir('um silencio cortado', r.cortados, 1)
  const ponta = cortarSilencios([tr(0, 0, 0, 4)], [{ de: 0, ate: 0.6 }, { de: 3.5, ate: 4 }], 0.12, 4)
  conferir('no comeco e no fim so sobra o lado da fala', lugares(ponta.trechos), [[0, 0, 0.48, 3.62]])
  const baixinha = sinal.map((x) => x - 25)
  conferir('gravacao baixinha: o limiar acompanha a fala', silenciosDoSinal(baixinha, 0.01).length, 1)
  conferir('ja cortado fica cortado', pares(cortarSilencios(apagarIntervalo([tr(0, 0, 0, 4)], 1, 1.8), s, 0.12, 4).trechos), [[0, 1], [1.8, 4]])
  // Duas faixas: o trecho da A2 depois do que encolheu chega para tras junto.
  const duas = cortarSilencios([tr(0, 0, 0, 4), tr(4, 1, 0, 1, 'outra')], s, 0.12, { principal: 4, outra: 1 })
  conferir('com duas faixas, o que vem depois anda o que encolheu', lugares(duas.trechos), [[0, 0, 0, 1.12], [1.12, 0, 1.68, 4], [3.44, 1, 0, 1]])
}

console.log('correcoes: a regravacao no lugar do pedaco ruim')
{
  const c = { id: 'correcao-1', caminho: 'C:/correcao.wav', nome: 'correcao.wav', duracao: 3 }
  const base = novaEdicao('C:/gravacao.wav', 10).trechos
  const fonte = (t: readonly TrechoDaGravacao[]): string[] => ordem(t).map((x) => x.fonte)
  const naAgulha = inserirEm(base, 4, 0, [trechoDaCorrecao(c)])
  conferir('na agulha: corta ali e encaixa a correcao no meio', lugares(naAgulha), [[0, 0, 0, 4], [4, 0, 0, 3], [7, 0, 4, 10]])
  conferir('de onde cada pedaco vem', fonte(naAgulha), ['principal', 'correcao-1', 'principal'])
  conferir('o video cresce o tamanho da correcao', duracaoEditada(naAgulha), 13)
  const trocado = substituirIntervalo(base, 4, 6, 0, [trechoDaCorrecao(c)])
  conferir('no lugar da selecao: sai de 4 a 6, entra a correcao', lugares(trocado), [[0, 0, 0, 4], [4, 0, 0, 3], [7, 0, 6, 10]])
  conferir('no comeco', fonte(inserirEm(base, 0, 0, [trechoDaCorrecao(c)])), ['correcao-1', 'principal'])
  conferir('no fim', fonte(inserirEm(base, 10, 0, [trechoDaCorrecao(c)])), ['principal', 'correcao-1'])
  conferir('na A2: a A1 so abre espaco', lugares(inserirEm(base, 4, 1, [trechoDaCorrecao(c)])), [[0, 0, 0, 10], [4, 1, 0, 3]])
  // A correcao e um trecho como os outros: cortar dentro dela vale.
  conferir('cortar dentro da correcao', pares(cortarEm(trocado, 5.5)), [[0, 4], [0, 1.5], [1.5, 3], [6, 10]])
  // Silencio de uma gravacao nao corta a outra no mesmo segundo.
  const silencio = cortarSilencios(trocado, [{ de: 1, ate: 2, fonte: 'correcao-1' }], 0.1, { principal: 10, 'correcao-1': 3 })
  conferir('o silencio da correcao so corta a correcao', lugares(silencio.trechos), [[0, 0, 0, 4], [4, 0, 0, 1.1], [5.1, 0, 1.9, 3], [6.2, 0, 6, 10]])
  conferir('caminho de cada fonte', [caminhoDaFonte({ bruto: 'C:/g.wav', correcoes: [c] }, 'principal'), caminhoDaFonte({ bruto: 'C:/g.wav', correcoes: [c] }, 'correcao-1')], ['C:/g.wav', 'C:/correcao.wav'])
  const antigo = edicaoDeAudioSchema.parse({ bruto: 'x.wav', duracaoBruta: 3, trechos: [{ de: 0, ate: 3, ganhoDb: 0 }], cadeia: CADEIA_PADRAO })
  conferir('projeto de antes das correcoes: tudo da principal, nenhuma correcao', [antigo.trechos[0]!.fonte, antigo.correcoes.length], ['principal', 0])
}

console.log('projeto de antes das faixas abre como era')
{
  const antigo = edicaoDeAudioSchema.parse({
    bruto: 'x.wav',
    duracaoBruta: 10,
    trechos: [{ de: 0, ate: 2 }, { de: 5, ate: 6, fonte: 'c1' }, { de: 6, ate: 10 }],
    cadeia: CADEIA_PADRAO,
  })
  conferir('em fila na A1, um depois do outro', lugares(antigo.trechos), [[0, 0, 0, 2], [2, 0, 5, 6], [3, 0, 6, 10]])
  conferir('cada um com seu id', new Set(antigo.trechos.map((x) => x.id)).size, 3)
  const novo = edicaoDeAudioSchema.parse({ ...antigo, trechos: [{ de: 0, ate: 2, em: 1.5, faixa: 1, id: 'meu' }] })
  conferir('o de agora volta igual', lugares(novo.trechos).concat([[novo.trechos[0]!.id === 'meu' ? 1 : 0]]), [[1.5, 1, 0, 2], [1]])
}

console.log('os efeitos viram filtros do ffmpeg, na ordem dele')
{
  const f = filtrosDaCadeia(CADEIA_PADRAO)!.split(',').map((x) => x.split('=')[0])
  conferir('padrao: gate, nivelador, ganho, corte grave e compressor (bandas em 0 dB ficam de fora)', f, ['agate', 'dynaudnorm', 'volume', 'highpass', 'acompressor'])
  const tudoDesligado = {
    ...CADEIA_PADRAO,
    nivelar: { ...CADEIA_PADRAO.nivelar, ligado: false },
    eq: { ...CADEIA_PADRAO.eq, ligado: false },
    compressor: { ...CADEIA_PADRAO.compressor, ligado: false },
  }
  conferir('tudo desligado: nada', filtrosDaCadeia(tudoDesligado), null)
  const banda = filtrosDaCadeia({ ...tudoDesligado, eq: { ligado: true, corteGraveHz: 0, bandas: [{ freqHz: 3000, ganhoDb: 2.5, q: 1 }] } })
  conferir('uma banda do EQ', banda, 'equalizer=f=3000:t=q:w=1:g=2.5')
  const comp = filtrosDaCadeia({ ...tudoDesligado, compressor: { ligado: true, limiarDb: -20, razao: 3, ataqueMs: 10, soltarMs: 150, ganhoDb: 6 } })
  conferir('compressor em linear: -20 dB = 0,1 e +6 dB = 1,9953', comp, 'acompressor=threshold=0.1:ratio=3:attack=10:release=150:makeup=1.9953')
  const soSubir = filtrosDaCadeia({ ...tudoDesligado, nivelar: { ligado: true, abaixarAlto: false, levantarBaixo: true, abaixarFundo: false, ganhoDeSaidaDb: 0 } })
  conferir('nivelar sem "abaixar o alto": o alvo e o teto', soSubir, 'dynaudnorm=f=250:g=15:p=0.95:m=8:t=0.01')
  conferir('IA no 100: sem limite', limiteDaIa(100), 100)
  conferir('IA no 50: tira ate 20 dB', limiteDaIa(50), 20)
}

console.log('o que vai para o arquivo do projeto')
{
  conferir('a cadeia padrao e valida', cadeiaDeAudioSchema.safeParse(CADEIA_PADRAO).success, true)
  const e = edicaoDeAudioSchema.parse({ bruto: 'x.wav', duracaoBruta: 3, trechos: [{ de: 0, ate: 3 }], cadeia: CADEIA_PADRAO })
  conferir('ganho do trecho e saida tem padrao', [e.trechos[0]!.ganhoDb, e.saida], [0, null])
}

console.log('velocidade sem mudar o tom')
{
  const { velocidade: _fora, ...antiga } = CADEIA_PADRAO
  const lida = cadeiaDeAudioSchema.parse(antiga)
  conferir('cadeia salva antes da velocidade abre em 100%', lida.velocidade, 100)
  conferir('100% nao mexe', fatorDaVelocidade(lida), 1)
  conferir('115% = 1,15', fatorDaVelocidade({ velocidade: 115 }), 1.15)
  conferir('acima de 200% nao vale', cadeiaDeAudioSchema.safeParse({ ...CADEIA_PADRAO, velocidade: 250 }).success, false)
  conferir('abaixo de 50% nao vale', cadeiaDeAudioSchema.safeParse({ ...CADEIA_PADRAO, velocidade: 40 }).success, false)
}

console.log('a mistura das faixas (o audio que sai)')
{
  // 1 s de "voz" constante (0,5) em 48 kHz: facil de ver soma, vao e emenda.
  const voz = new Float32Array(48_000).fill(0.5)
  const em = (s: number): number => Math.round(s * 48_000)
  const mix = montarMix({ principal: voz }, [tr(0, 0, 0, 0.5), tr(0.25, 1, 0.5, 1), tr(1, 0, 0, 0.25)])
  conferir('vai ate o fim do ultimo trecho', mix.length, em(1.25))
  conferir('uma faixa so: o som dela', round(mix[em(0.1)]!), 0.5)
  conferir('duas faixas juntas: somam', round(mix[em(0.4)]!), 1)
  conferir('o vao entre trechos (0,75 a 1) fica em silencio', round(mix[em(0.8)]!), 0)
  conferir('ponta de trecho desce a zero (sem estalo)', round(mix[em(0.75) - 1]!) < 0.1, true)
  const emendado = montarMix({ principal: voz }, [tr(0, 0, 0, 0.5), tr(0.5, 0, 0.5, 1)])
  conferir('cortar sem tirar nada: a onda segue inteira na emenda', [round(emendado[em(0.5) - 1]!), round(emendado[em(0.5)]!)], [0.5, 0.5])
  const pulo = montarMix({ principal: voz }, [tr(0, 0, 0, 0.4), tr(0.4, 0, 0.6, 1)])
  conferir('emenda com pedaco tirado: desce e sobe', round(pulo[em(0.4)]!), 0)
}

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
