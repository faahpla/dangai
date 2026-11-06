/**
 * As contas da etapa de audio (shared/edicao-de-audio.ts): cortar, apagar com o
 * buraco fechando, achar e encolher silencios, e ir e voltar entre o tempo
 * editado e o da gravacao.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/teste/v-edicao-de-audio.ts
 */
import {
  apagarIntervalo,
  apagarTrecho,
  cadeiaDeAudioSchema,
  CADEIA_PADRAO,
  caminhoDaFonte,
  cortarEm,
  cortarSilencios,
  duracaoEditada,
  edicaoDeAudioSchema,
  filtrosDaCadeia,
  ganhoDoTrecho,
  limiteDaIa,
  iniciosEditados,
  inserirEm,
  noBruto,
  noEditado,
  novaEdicao,
  silenciosDoSinal,
  substituirIntervalo,
  trechoDaCorrecao,
  type TrechoDaGravacao,
} from '../../shared/edicao-de-audio.ts'

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
const pares = (t: readonly TrechoDaGravacao[]): number[][] => t.map((x) => [round(x.de), round(x.ate)])
const round = (x: number): number => Math.round(x * 1000) / 1000

console.log('cortar e apagar')
{
  const e = novaEdicao('C:/gravacao.wav', 10)
  conferir('comeca com a gravacao inteira', pares(e.trechos), [[0, 10]])
  const dois = cortarEm(e.trechos, 4)
  conferir('C no 4: dois pedacos', pares(dois), [[0, 4], [4, 10]])
  conferir('cortar onde ja tem corte nao faz nada', pares(cortarEm(dois, 4.005)), [[0, 4], [4, 10]])
  const sem = apagarIntervalo(dois, 2, 6)
  conferir('apagar de 2 a 6 fecha o buraco', pares(sem), [[0, 2], [6, 10]])
  conferir('a duracao encolhe 4 s', duracaoEditada(sem), 6)
  conferir('o instante 3 editado e o 7 da gravacao', noBruto(sem, 3), { indice: 1, bruto: 7 })
  conferir('o 7 da gravacao volta para o 3', noEditado(sem, 7), 3)
  conferir('o 4 da gravacao foi cortado', noEditado(sem, 4), null)
  conferir('onde cada pedaco comeca', iniciosEditados(sem), [0, 2])
  conferir('apagar o primeiro pedaco', pares(apagarTrecho(sem, 0)), [[6, 10]])
  conferir('apagar atravessando tres pedacos', pares(apagarIntervalo([...cortarEm(cortarEm(e.trechos, 3), 6)], 2, 8)), [[0, 2], [8, 10]])
  conferir('volume so de um pedaco', ganhoDoTrecho(sem, 1, -6).map((x) => x.ganhoDb), [0, -6])
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
  const r = cortarSilencios([{ de: 0, ate: 4, ganhoDb: 0 }], s, 0.12, 4)
  conferir('a pausa encolhe deixando 0,12 s de cada lado', pares(r.trechos), [[0, 1.12], [1.68, 4]])
  conferir('quanto encurtou', round(r.segundos), 0.56)
  conferir('um silencio cortado', r.cortados, 1)
  const ponta = cortarSilencios([{ de: 0, ate: 4, ganhoDb: 0 }], [{ de: 0, ate: 0.6 }, { de: 3.5, ate: 4 }], 0.12, 4)
  conferir('no comeco e no fim so sobra o lado da fala', pares(ponta.trechos), [[0.48, 3.62]])
  const baixinha = sinal.map((x) => x - 25)
  conferir('gravacao baixinha: o limiar acompanha a fala', silenciosDoSinal(baixinha, 0.01).length, 1)
  conferir('ja cortado fica cortado', pares(cortarSilencios(apagarIntervalo([{ de: 0, ate: 4, ganhoDb: 0 }], 1, 1.8), s, 0.12, 4).trechos), [[0, 1], [1.8, 4]])
}

console.log('correcoes: a regravacao no lugar do pedaco ruim')
{
  const c = { id: 'correcao-1', caminho: 'C:/correcao.wav', nome: 'correcao.wav', duracao: 3 }
  const base = novaEdicao('C:/gravacao.wav', 10).trechos
  const fonte = (t: readonly { fonte?: string }[]): string[] => t.map((x) => x.fonte ?? '?')
  const naAgulha = inserirEm(base, 4, [trechoDaCorrecao(c)])
  conferir('na agulha: corta ali e encaixa a correcao no meio', pares(naAgulha), [[0, 4], [0, 3], [4, 10]])
  conferir('de onde cada pedaco vem', fonte(naAgulha), ['principal', 'correcao-1', 'principal'])
  conferir('o video cresce o tamanho da correcao', duracaoEditada(naAgulha), 13)
  const trocado = substituirIntervalo(base, 4, 6, [trechoDaCorrecao(c)])
  conferir('no lugar da selecao: sai de 4 a 6, entra a correcao', pares(trocado), [[0, 4], [0, 3], [6, 10]])
  conferir('a selecao virou a correcao', fonte(trocado), ['principal', 'correcao-1', 'principal'])
  conferir('no comeco', fonte(inserirEm(base, 0, [trechoDaCorrecao(c)])), ['correcao-1', 'principal'])
  conferir('no fim', fonte(inserirEm(base, 10, [trechoDaCorrecao(c)])), ['principal', 'correcao-1'])
  // A correcao e um trecho como os outros: cortar dentro dela vale.
  conferir('cortar dentro da correcao', pares(cortarEm(trocado, 5.5)), [[0, 4], [0, 1.5], [1.5, 3], [6, 10]])
  conferir('o 1 da correcao esta no 5 editado', noEditado(trocado, 1, 'correcao-1'), 5)
  // Silencio de uma gravacao nao corta a outra no mesmo segundo.
  const silencio = cortarSilencios(trocado, [{ de: 1, ate: 2, fonte: 'correcao-1' }], 0.1, { principal: 10, 'correcao-1': 3 })
  conferir('o silencio da correcao so corta a correcao', pares(silencio.trechos), [[0, 4], [0, 1.1], [1.9, 3], [6, 10]])
  conferir('caminho de cada fonte', [caminhoDaFonte({ bruto: 'C:/g.wav', correcoes: [c] }, 'principal'), caminhoDaFonte({ bruto: 'C:/g.wav', correcoes: [c] }, 'correcao-1')], ['C:/g.wav', 'C:/correcao.wav'])
  const antigo = edicaoDeAudioSchema.parse({ bruto: 'x.wav', duracaoBruta: 3, trechos: [{ de: 0, ate: 3, ganhoDb: 0 }], cadeia: CADEIA_PADRAO })
  conferir('projeto de antes das correcoes: tudo da principal, nenhuma correcao', [antigo.trechos[0]!.fonte, antigo.correcoes.length], ['principal', 0])
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

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
