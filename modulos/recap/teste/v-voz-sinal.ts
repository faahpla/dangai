/**
 * A VOZ CONTRA O SOM: as correcoes da avaliacao de 14/10 do passo 3, em audio
 * SINTETICO (tons e ruido com tempos conhecidos), sem provedor, sem disco e
 * sem credito.
 *
 *   1. o alinhador recebe as palavras SEM pontuacao (paraOModelo);
 *   2. encostarNoSom: a palavra que comeca no silencio avanca ate o som, a que
 *      termina depois dele recua;
 *   3. palavrasSuspeitas: palavra esticada sobre uma pausa, e "pausa" marcada
 *      em cima da fala;
 *   4. fronteiraPeloSom: a fronteira de frase no meio do maior silencio do vao;
 *   5. o corte de pausa nunca passa por cima de fala sem palavra (o parentese
 *      falado do teste do revisor) e ainda corta a respiracao;
 *   6. a emenda da frase regravada preenche a margem que falta com o silencio
 *      do proprio take (nada de zero digital);
 *   7. o texto falado tira [marcacao] e (marcacao), como a legenda;
 *   8. o volume: leitura do ebur128 e o ganho ate -23 LUFS sem estourar o pico;
 *   9. a estimativa em caracteres E creditos; o andamento do importado.
 *
 * Rodar da raiz:
 *   npx esbuild modulos/recap/teste/v-voz-sinal.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-voz-sinal.cjs
 *   npx electron out/teste/v-voz-sinal.cjs
 */
import { app } from 'electron'
import { palavrasDaFrase, textoDaEstimativa, textoFalado, textoParaNarrar, type EstimativaDeCusto, type PalavraComTempo } from '../shared/voz'
import { paraOModelo } from '../electron/voz/alinhamento'
import { traduzirAndamento } from '../electron/voz/importado'
import { emendar, type BrutoMontado } from '../electron/voz/montar'
import { trechosPelasPalavras } from '../electron/voz/palavras'
import { cortesDasPausas, encostarNoSom, fronteiraPeloSom, medirEnergia, palavrasSuspeitas } from '../electron/voz/pos'
import { aplicarGanho, ganhoParaReferencia, lerResumoDoEbur128 } from '../electron/voz/volume'
import type { Pcm } from '../electron/voz/wav'

let falhas = 0
let total = 0
function ok(nome: string, cond: boolean, detalhe = ''): void {
  total++
  if (cond) console.log(`  ok   ${nome}${detalhe ? `  (${detalhe})` : ''}`)
  else {
    falhas++
    console.log(`  FALHA ${nome}${detalhe ? `\n        ${detalhe}` : ''}`)
  }
}

const TAXA = 24_000
/** Ruido de sala deterministico (~-62 dBFS) + tons nos intervalos dados (amplitude em amostras). */
function sintetico(seg: number, tons: { de: number; ate: number; amp: number }[], ruido = 25): Pcm {
  const n = Math.round(seg * TAXA)
  const a = new Int16Array(n)
  let x = 12345
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    a[i] = Math.round(((x / 0x7fffffff) * 2 - 1) * ruido)
  }
  for (const t of tons) {
    for (let i = Math.round(t.de * TAXA); i < Math.round(t.ate * TAXA) && i < n; i++) {
      a[i] = Math.max(-32768, Math.min(32767, a[i]! + Math.round(t.amp * Math.sin((2 * Math.PI * 220 * i) / TAXA))))
    }
  }
  return { taxa: TAXA, amostras: a }
}
const p = (texto: string, start: number, end: number, fraseId = 'f01'): PalavraComTempo => ({ texto, start, end, fraseId })
const ms = (s: number): string => `${(s * 1000).toFixed(1)} ms`

function rodar(): void {
  // ------------------------------------------------ 1. paraOModelo
  console.log('1. o que o wav2vec2 le')
  const lidos = paraOModelo(['tempo.', 'Why-Man', 'Dr.', 'todos?', '"Ciencia!"', 'é', '37', '—'])
  ok('pontuacao fora, letras e digitos ficam', JSON.stringify(lidos) === JSON.stringify(['tempo', 'WhyMan', 'Dr', 'todos', 'Ciencia', 'é', '37', '—']), JSON.stringify(lidos))
  ok('acento composto (NFD) vira a letra inteira (NFC)', paraOModelo(['é'])[0] === 'é')

  // ------------------------------------------------ 2. encostarNoSom
  console.log('\n2. bordas da palavra no som')
  const tons2 = [
    { de: 0.5, ate: 0.9, amp: 8000 },
    { de: 1.4, ate: 1.8, amp: 8000 },
  ]
  const pcm2 = sintetico(2.4, tons2)
  const e2 = medirEnergia(pcm2)
  const [a, b] = encostarNoSom([p('tempo.', 0.5, 1.25), p('E', 1.27, 1.8)], e2)
  ok('fim esticado sobre a pausa recua ate o som', Math.abs(a!.end - 0.9) <= 0.011, `fim ${a!.end.toFixed(3)} (som ate 0,900)`)
  ok('inicio dentro do silencio avanca ate o som', Math.abs(b!.start - 1.4) <= 0.011, `inicio ${b!.start.toFixed(3)} (som desde 1,400)`)
  const intactas = encostarNoSom([p('x', 0.52, 0.88)], e2)
  ok('palavra dentro do som nao muda', intactas[0]!.start === 0.52 && intactas[0]!.end === 0.88)
  const muda = encostarNoSom([p('x', 1.0, 1.2)], e2)
  ok('palavra sem som nenhum fica como esta', muda[0]!.start === 1.0 && muda[0]!.end === 1.2)
  const duas = encostarNoSom(encostarNoSom([p('tempo.', 0.5, 1.25)], e2), e2)
  ok('idempotente', Math.abs(duas[0]!.end - a!.end) < 1e-9)

  // ------------------------------------------------ 3. suspeitas
  console.log('\n3. palavras que o som desmente')
  const s1 = palavrasSuspeitas([p('tempo.', 0.5, 1.3), p('E', 1.4, 1.8)], e2)
  ok('palavra cobrindo 0,4 s de silencio e suspeita', s1.includes(0), JSON.stringify(s1))
  const s2 = palavrasSuspeitas([p('o', 0.5, 0.52), p('Why-Man', 0.85, 0.9)], e2)
  ok('"pausa" marcada em cima da fala: a palavra seguinte e suspeita', s2.includes(1), JSON.stringify(s2))
  const s3 = palavrasSuspeitas(encostarNoSom([p('tempo.', 0.5, 1.25), p('E', 1.27, 1.8)], e2), e2)
  ok('depois de encostar no som, nada suspeito', s3.length === 0, JSON.stringify(s3))

  // ------------------------------------------------ 4. fronteiras
  console.log('\n4. fronteira de frase no silencio')
  // Vao [0,9; 1,4] com um "hum" curto em 1,0-1,05: o maior silencio e 1,05-1,4.
  const pcm4 = sintetico(2.4, [...tons2, { de: 1.0, ate: 1.05, amp: 3000 }])
  const e4 = medirEnergia(pcm4)
  const f4 = fronteiraPeloSom(e4, 0.9, 1.4)
  ok('meio do maior trecho calado', f4.calado && Math.abs(f4.t - 1.225) <= 0.011, `${f4.t.toFixed(3)} (esperado ~1,225; meio aritmetico 1,150)`)
  const f4b = fronteiraPeloSom(e4, 0.55, 0.85)
  ok('vao sem silencio: avisa (calado false)', !f4b.calado && f4b.t >= 0.55 && f4b.t <= 0.85)
  // Alinhamento errado: a frase 1 "termina" em 1,6 (dentro do segundo tom), a 2 comeca em 1,7.
  const semPausa: string[] = []
  const tr = trechosPelasPalavras(
    [p('um', 0.5, 0.9, 'f01'), p('dois', 1.4, 1.6, 'f01'), p('tres', 1.7, 1.8, 'f02')],
    [
      { fraseId: 'f01', texto: 'um dois', hash: '0000000000000000' },
      { fraseId: 'f02', texto: 'tres', hash: '0000000000000001' },
    ],
    pcm2.amostras.length,
    TAXA,
    e2,
    semPausa,
  )
  ok('fronteira sem silencio no vao vira aviso', semPausa.includes('f02'), JSON.stringify(semPausa))
  ok('trechos cobrem o audio', Math.abs(tr[0]!.duracao + tr[1]!.duracao - 2.4) < 1e-9)

  // ------------------------------------------------ 5. corte de pausa e fala sem palavra
  console.log('\n5. corte de pausa nunca come fala')
  // O teste do revisor: Senku 0,5-0,9 | "(agora com 20 anos)" 1,0-1,8 sem palavra | volta 1,9-2,3 | hoje 2,4-2,8.
  const pcm5 = sintetico(3.2, [
    { de: 0.5, ate: 0.9, amp: 8000 },
    { de: 1.0, ate: 1.8, amp: 8000 },
    { de: 1.9, ate: 2.3, amp: 8000 },
    { de: 2.4, ate: 2.8, amp: 8000 },
  ])
  const e5 = medirEnergia(pcm5)
  const ilhas = { ilhas: 0 }
  const c5 = cortesDasPausas([p('Senku', 0.5, 0.9), p('volta', 1.9, 2.3), p('hoje', 2.4, 2.8)], e5, pcm5.amostras.length, ilhas)
  let picoNoCorte = 0
  for (const c of c5) for (let i = c.de; i < c.ate; i++) picoNoCorte = Math.max(picoNoCorte, Math.abs(pcm5.amostras[i]!))
  ok('nenhum corte em som (antes: 0,975-1,825 s com pico 8000)', picoNoCorte < 200, `${c5.length} cortes, pico ${picoNoCorte}: ${c5.map((c) => `${(c.de / TAXA).toFixed(3)}-${(c.ate / TAXA).toFixed(3)}`).join(' ')}`)
  ok('a fala sem palavra conta como ilha (vira aviso)', ilhas.ilhas === 1, `${ilhas.ilhas}`)
  // Respiracao (-48 dB, 25 dB abaixo da fala) no meio de uma pausa de 1,2 s: o corte ainda tira.
  const pcm5b = sintetico(3.2, [
    { de: 0.5, ate: 0.9, amp: 8000 },
    { de: 1.4, ate: 1.6, amp: 130 },
    { de: 2.1, ate: 2.5, amp: 8000 },
  ])
  const c5b = cortesDasPausas([p('a', 0.5, 0.9), p('b', 2.1, 2.5)], medirEnergia(pcm5b), pcm5b.amostras.length)
  const tirado = c5b.filter((c) => c.de / TAXA > 0.9 && c.ate / TAXA < 2.1).reduce((s, c) => s + c.ate - c.de, 0) / TAXA
  ok('respiracao na pausa nao segura o corte', Math.abs(tirado - (1.2 - 0.15)) <= 0.02, `tirou ${ms(tirado)} de 1,2 s`)

  // ------------------------------------------------ 6. emenda sem zero digital
  console.log('\n6. emenda da frase regravada')
  // Take: f01 0,3-1,0 | f02 1,6-2,4 | f03 3,0-3,6 (ruido de sala em tudo). Fronteiras no meio das pausas.
  const pcm6 = sintetico(4.0, [
    { de: 0.3, ate: 1.0, amp: 6000 },
    { de: 1.6, ate: 2.4, amp: 6000 },
    { de: 3.0, ate: 3.6, amp: 6000 },
  ])
  const frases6 = [
    { fraseId: 'f01', texto: 'um', hash: 'aaaaaaaaaaaaaaaa' },
    { fraseId: 'f02', texto: 'dois', hash: 'bbbbbbbbbbbbbbbb' },
    { fraseId: 'f03', texto: 'tres', hash: 'cccccccccccccccc' },
  ]
  const atual: BrutoMontado = {
    pcm: pcm6,
    palavras: [p('um', 0.3, 1.0, 'f01'), p('dois', 1.6, 2.4, 'f02'), p('tres', 3.0, 3.6, 'f03')],
    trechos: trechosPelasPalavras([p('um', 0.3, 1.0, 'f01'), p('dois', 1.6, 2.4, 'f02'), p('tres', 3.0, 3.6, 'f03')], frases6, pcm6.amostras.length, TAXA, medirEnergia(pcm6)),
  }
  // A f02 nova veio com SO 20 ms antes e 20 ms depois da fala, em silencio DIGITAL (como o provedor manda).
  const nova = new Int16Array(Math.round(0.84 * TAXA))
  for (let i = Math.round(0.02 * TAXA); i < Math.round(0.82 * TAXA); i++) nova[i] = Math.round(6000 * Math.sin((2 * Math.PI * 220 * i) / TAXA))
  const novo = { pcm: { taxa: TAXA, amostras: nova }, palavras: [p('dois', 0.02, 0.82, 'f02')] }
  const emendado = emendar(atual, frases6, new Map([['f02', novo]]))
  let corrida = 0
  let maior = 0
  for (const v of emendado.pcm.amostras) {
    corrida = v === 0 ? corrida + 1 : 0
    maior = Math.max(maior, corrida)
  }
  ok('nenhuma corrida de zero digital >= 5 ms', maior < 0.005 * TAXA, `maior corrida ${ms(maior / TAXA)} (antes: a margem que faltava ficava zero)`)
  const t2 = emendado.trechos[1]!
  const trAntigo = atual.trechos[1]!
  ok('o trecho novo tem as margens do antigo', Math.abs(t2.duracao - trAntigo.duracao) <= 0.002, `${t2.duracao.toFixed(3)} vs ${trAntigo.duracao.toFixed(3)}`)
  // O comeco do trecho novo e o comeco da margem antiga (as mesmas amostras; as primeiras 4 ms tem a rampa da emenda).
  const ini = Math.round(t2.offset * TAXA) + 120
  const iniAntigo = Math.round(trAntigo.offset * TAXA) + 120
  let iguais = 0
  for (let i = 0; i < 200; i++) if (emendado.pcm.amostras[ini + i] === pcm6.amostras[iniAntigo + i]) iguais++
  ok('a margem que faltava e o silencio do proprio take', iguais >= 180, `${iguais}/200 amostras iguais as do take`)
  let salto = 0
  for (let i = 1; i < emendado.pcm.amostras.length; i++) {
    const d = Math.abs(emendado.pcm.amostras[i]! - emendado.pcm.amostras[i - 1]!)
    const tempo = i / TAXA
    if (Math.abs(tempo - t2.offset) < 0.006 || Math.abs(tempo - (t2.offset + t2.duracao)) < 0.006) salto = Math.max(salto, d)
  }
  ok('emendas sem estalo (salto pequeno nas juncoes)', salto <= 120, `salto max ${salto} LSB`)

  // ------------------------------------------------ 7. texto falado
  console.log('\n7. o que a voz fala')
  const frase = 'Senku (agora com 20 anos) volta ao laboratorio [pausa] hoje.'
  ok('marcacao fora do texto mandado', textoFalado(frase) === 'Senku volta ao laboratorio hoje.', textoFalado(frase))
  ok('palavras = o texto mandado, palavra a palavra', JSON.stringify(palavrasDaFrase(frase)) === JSON.stringify(textoFalado(frase).split(' ')))
  const narrar = textoParaNarrar({ secoes: [{ frases: [{ id: 'f01', texto: frase }] }] } as never)
  ok('textoParaNarrar sem a marcacao (o que conta caractere e entra no hash)', narrar.texto === 'Senku volta ao laboratorio hoje.' && narrar.frases[0]!.palavras.length === 5, narrar.texto)

  // ------------------------------------------------ 8. volume
  console.log('\n8. volume')
  const resumo = `[Parsed_ebur128_0 @ x] Summary:\n\n  Integrated loudness:\n    I:         -28.2 LUFS\n    Threshold: -38.6 LUFS\n\n  True peak:\n    Peak:       -8.1 dBFS\n`
  const l = lerResumoDoEbur128(resumo)
  ok('le o resumo do ebur128', l !== null && l.lufs === -28.2 && l.pico === -8.1)
  ok('ElevenLabs (-28,2 LUFS, -8,1 dBTP): +5,2 dB', ganhoParaReferencia({ lufs: -28.2, pico: -8.1 }) === 5.2)
  ok('importado (-23,8 LUFS, -5,1 dBTP): +0,8 dB', ganhoParaReferencia({ lufs: -23.8, pico: -5.1 }) === 0.8)
  ok('pico alto: o ganho para no teto (-1,5 dBTP)', ganhoParaReferencia({ lufs: -28.2, pico: -2.0 }) === 0.5)
  ok('alto demais: abaixa', ganhoParaReferencia({ lufs: -16, pico: -1 }) === -7)
  ok('quase na referencia: nao mexe', ganhoParaReferencia({ lufs: -23.05, pico: -6 }) === 0)
  const g = aplicarGanho({ taxa: TAXA, amostras: Int16Array.from([1000, -1000, 0]) }, 6.0206)
  ok('ganho linear', g.amostras[0] === 2000 && g.amostras[1] === -2000 && g.amostras[2] === 0, Array.from(g.amostras).join(','))

  // ------------------------------------------------ 9. textos
  console.log('\n9. estimativa e andamento')
  const est: EstimativaDeCusto = {
    fonte: 'elevenlabs',
    fraseIds: [],
    caracteres: 1034,
    pagos: 1034,
    aCobrar: 1034,
    creditos: 227.5,
    doCache: false,
    restam: 9745,
    limite: 10000,
    plano: 'payg',
    saldo: null,
    suficiente: true,
    aviso: null,
  }
  ok('caracteres e creditos, cada um com a sua unidade', textoDaEstimativa(est) === '1.034 caracteres (~228 creditos) · ElevenLabs · restam 9.745 creditos', textoDaEstimativa(est))
  ok('sem taxa aprendida: so caracteres', textoDaEstimativa({ ...est, creditos: null }) === '1.034 caracteres · ElevenLabs · restam 9.745 creditos')
  ok('do cache: sem custo', textoDaEstimativa({ ...est, aCobrar: 0, pagos: 0, creditos: null }) === 'Ja gerado, sem custo')
  const a1 = traduzirAndamento('Sincronizando as legendas... 40%')
  ok('alinhador: voz, nao legenda, e a fracao', a1.etapa === 'alinhando' && a1.mensagem === 'Alinhando as palavras... 40%' && a1.fracao === 0.4, JSON.stringify(a1))
  const a2 = traduzirAndamento('Transcrevendo com Whisper... 88%')
  ok('whisper: a fracao do numero', a2.etapa === 'transcrevendo' && a2.fracao === 0.88)
  const a3 = traduzirAndamento('Baixando o sincronizador de legendas (so na primeira vez)... 63/631 MB')
  ok('download do alinhador: MB vira fracao', a3.etapa === 'alinhando' && Math.abs((a3.fracao ?? 0) - 0.1) < 0.01 && a3.mensagem.includes('alinhador'), JSON.stringify(a3))
  ok('sem numero: barra solta', traduzirAndamento('Preparando o audio...').fracao === null)

  console.log(falhas === 0 ? `\nTUDO OK (${total} conferencias)` : `\n${falhas} FALHA(S) em ${total} conferencias`)
}

void app.whenReady().then(() => {
  try {
    rodar()
  } catch (err) {
    falhas++
    console.log('ERRO', err instanceof Error ? (err.stack ?? err.message) : String(err))
  }
  app.exit(falhas === 0 ? 0 : 1)
})
