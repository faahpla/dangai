/**
 * A fita do trecho: peso, repeticao e tela dividida.
 *
 * As tres compartilham a mesma conta em applyBlockClips -- quanto tempo cada
 * SLOT recebe --, entao mexer numa pode quebrar a outra em silencio. Por isso
 * um teste so, e sempre olhando o PLANO montado, que e o que vira video.
 *
 * Roda com o app em dev:
 *   npx electron-vite dev -- --remote-debugging-port=9333 --user-data-dir=<descartavel>
 * A biblioteca dele e SO LEITURA -- o mtime e conferido no fim.
 */
import { statSync } from 'node:fs'
import { avaliar, esperarStore, fechar } from './cdp.mjs'

const BIB = 'D:/FAAH/ANIMES/CORTE DE CENAS'
const antesMtime = statSync(BIB).mtimeMs
const MP3 = process.argv[2]
const TXT = process.argv[3]
if (!MP3 || !TXT) {
  console.error('uso: node v-fita.mjs <narracao.mp3> <roteiro.txt>')
  process.exit(2)
}

let p = 0
let f = 0
const ok = (n, c, d = '') => {
  if (c) {
    p++
    console.log(`  ok   ${n}`)
  } else {
    f++
    console.log(`  FALHOU ${n}${d ? ` -- ${d}` : ''}`)
  }
}

await esperarStore()

const preparar = `
  const s = window.dangaiStore.getState()
  s.reset()
  await new Promise(r => setTimeout(r, 400))
  await window.dangai.saveSettings({ libraryDir: ${JSON.stringify(BIB)} })
  await s.ingest([${JSON.stringify(MP3)}, ${JSON.stringify(TXT)}])
  for (let i = 0; i < 240 && !window.dangaiStore.getState().audio; i++) await new Promise(r => setTimeout(r, 500))
  await window.dangaiStore.getState().openLibrary(true)
  for (let i = 0; i < 300 && !window.dangaiStore.getState().library; i++) await new Promise(r => setTimeout(r, 500))
  await window.dangaiStore.getState().loadScriptBlocks()
  for (let i = 0; i < 600 && window.dangaiStore.getState().scriptBlocksBusy !== null; i++) await new Promise(r => setTimeout(r, 500))
  await new Promise(r => setTimeout(r, 900))
`

/*
 * Uma cena marcada BEM depois: o ultimo bloco do plano e esticado ate o fim da
 * narracao por definicao, e medir tempo nele nao mediria peso nenhum.
 */
const ancora = `
  window.dangaiStore.getState().setActiveBlock(15)
  window.dangaiStore.getState().toggleBlockClip(longas[70].path)
  await new Promise(r => setTimeout(r, 200))
`

console.log('\n== peso: a divisao segue o peso, nao a contagem ==')
const peso = await avaliar(`
  ${preparar}
  const st = window.dangaiStore.getState()
  const longas = st.library.clips.filter(c => c.duration > 5)
  st.setActiveBlock(0)
  for (const c of [longas[3], longas[8], longas[12]]) window.dangaiStore.getState().toggleBlockClip(c.path)
  await new Promise(r => setTimeout(r, 300))
  // 1 -> 2 -> 3 na primeira
  window.dangaiStore.getState().cycleBlockWeight(0, 0)
  window.dangaiStore.getState().cycleBlockWeight(0, 0)
  ${ancora}
  await window.dangaiStore.getState().applyBlockClips()
  for (let i = 0; i < 300 && window.dangaiStore.getState().busy !== null; i++) await new Promise(r => setTimeout(r, 500))
  const d = window.dangaiStore.getState()
  if (d.error) return { erro: d.error }
  return { erro: null, pesos: d.blockWeights[0], duracoes: d.plan.scenes.slice(0, 3).map(x => +(x.end - x.start).toFixed(3)) }
`)
ok('montou sem erro', !peso.erro, String(peso.erro))
if (!peso.erro) {
  const [a, b, c] = peso.duracoes
  console.log(`  pesos ${JSON.stringify(peso.pesos)} -> ${JSON.stringify(peso.duracoes)}`)
  ok('a cena de peso 3 dura ~3x a de peso 1', Math.abs(a / b - 3) < 0.15, `razao ${(a / b).toFixed(2)}`)
  ok('as duas de peso 1 duram o mesmo', Math.abs(b - c) < 0.02, `${b} e ${c}`)
}

console.log('\n== repetir: a mesma cena duas vezes no mesmo trecho ==')
const repetir = await avaliar(`
  ${preparar}
  const st = window.dangaiStore.getState()
  const longas = st.library.clips.filter(c => c.duration > 5)
  st.setActiveBlock(0)
  window.dangaiStore.getState().toggleBlockClip(longas[3].path)
  await new Promise(r => setTimeout(r, 200))
  window.dangaiStore.getState().duplicateBlockClip(0, 0)
  await new Promise(r => setTimeout(r, 200))
  const lista = window.dangaiStore.getState().blockClips[0] ?? []
  ${ancora}
  await window.dangaiStore.getState().applyBlockClips()
  for (let i = 0; i < 300 && window.dangaiStore.getState().busy !== null; i++) await new Promise(r => setTimeout(r, 500))
  const d = window.dangaiStore.getState()
  if (d.error) return { erro: d.error }
  const caminhos = d.plan.scenes.map(x => d.images[x.imageIndex]?.path)
  return {
    erro: null,
    naFita: lista.length,
    iguaisNaFita: lista[0] === lista[1],
    repetidosNoPlano: caminhos.length - new Set(caminhos).size,
    orfas: d.plan.scenes.filter(x => !d.images[x.imageIndex]).length,
  }
`)
ok('a fita ficou com duas', repetir.naFita === 2, String(repetir.naFita))
ok('e sao a mesma cena', repetir.iguaisNaFita)
ok('o plano tem cena repetida', repetir.repetidosNoPlano > 0, JSON.stringify(repetir))
ok('nenhuma cena ficou orfa', repetir.orfas === 0, String(repetir.orfas))

console.log('\n== dividir: o par ocupa UM slot, com o tempo de uma cena ==')
/*
 * As cenas medidas ficam CERCADAS por ancoras, uma antes e outra depois.
 *
 * As duas pontas do plano sao esticadas: o primeiro bloco volta ate o zero
 * para o video nao comecar em preto, e o ultimo vai ate o fim da narracao para
 * nao cortar o respiro final. Medir duracao em qualquer uma das duas nao mede
 * peso nenhum -- mede a costura. Com ancora no trecho 1 e no 20, os blocos do
 * trecho 5 ficam no meio e sao comparaveis entre si.
 */
const dividir = await avaliar(`
  ${preparar}
  const st = window.dangaiStore.getState()
  const longas = st.library.clips.filter(c => c.duration > 5)
  st.setActiveBlock(1)
  window.dangaiStore.getState().toggleBlockClip(longas[70].path)
  await new Promise(r => setTimeout(r, 200))

  window.dangaiStore.getState().setActiveBlock(5)
  /*
   * QUATRO cenas, e a comparacao usa a 2a e o par.
   *
   * O primeiro slot de um trecho absorve o tempo dos trechos vazios que vieram
   * antes -- a costura que impede vao no video --, entao ele tambem nao serve
   * de referencia. A cena 0 fica com essa sobra; a 1 e o par (2+3) sao dois
   * slots limpos do mesmo trecho, ambos de peso 1.
   */
  for (const c of [longas[3], longas[8], longas[12], longas[20]]) window.dangaiStore.getState().toggleBlockClip(c.path)
  await new Promise(r => setTimeout(r, 300))
  window.dangaiStore.getState().toggleBlockSplit(5, 2)
  await new Promise(r => setTimeout(r, 200))

  // ancora depois, para o par nao ser o ultimo bloco (que estica ate o fim)
  window.dangaiStore.getState().setActiveBlock(20)
  window.dangaiStore.getState().toggleBlockClip(longas[85].path)
  await new Promise(r => setTimeout(r, 200))

  await window.dangaiStore.getState().applyBlockClips()
  for (let i = 0; i < 300 && window.dangaiStore.getState().busy !== null; i++) await new Promise(r => setTimeout(r, 500))
  const d = window.dangaiStore.getState()
  if (d.error) return { erro: d.error }
  // 0 = ancora (estica ate o zero); 1 = a cena que absorve a sobra;
  // 2 = cena limpa; 3 = o par; 4 = ancora final (estica ate o fim)
  const solta = d.plan.scenes[2]
  const par = d.plan.scenes[3]
  return {
    erro: null,
    imagens: d.images.length,
    blocos: d.plan.scenes.length,
    parTemDuas: par.imageIndexB !== null,
    soltaTemUma: solta.imageIndexB === null,
    duracaoPar: +(par.end - par.start).toFixed(3),
    duracaoSolta: +(solta.end - solta.start).toFixed(3),
  }
`)
ok('montou sem erro', !dividir.erro, String(dividir.erro))
if (!dividir.erro) {
  console.log(`  ${dividir.imagens} imagens em ${dividir.blocos} blocos · par ${dividir.duracaoPar}s · solta ${dividir.duracaoSolta}s`)
  ok('o par aponta para duas imagens', dividir.parTemDuas)
  ok('a cena solta continua com uma', dividir.soltaTemUma)
  ok(
    'ha uma imagem a mais que blocos (o par usa duas)',
    dividir.imagens === dividir.blocos + 1,
    `${dividir.imagens} imagens, ${dividir.blocos} blocos`,
  )
  ok(
    'o par NAO ganhou tempo extra',
    Math.abs(dividir.duracaoPar - dividir.duracaoSolta) < 0.02,
    `${dividir.duracaoPar}s contra ${dividir.duracaoSolta}s`,
  )
}

console.log('\n== unir de novo desfaz, e unir encadeado nao existe ==')
const desfazer = await avaliar(`
  const s = window.dangaiStore.getState()
  s.toggleBlockSplit(5, 2)
  await new Promise(r => setTimeout(r, 150))
  const depoisDeDesfazer = window.dangaiStore.getState().blockSplits[5] ?? []
  // 1 e 2 sao vizinhas validas; unir a 2 tem de desfazer a uniao da 1
  window.dangaiStore.getState().toggleBlockSplit(5, 1)
  window.dangaiStore.getState().toggleBlockSplit(5, 2)
  await new Promise(r => setTimeout(r, 150))
  const encadeado = window.dangaiStore.getState().blockSplits[5] ?? []
  // a ultima posicao nao tem proxima: unir ali nao pode fazer nada
  window.dangaiStore.getState().toggleBlockSplit(5, 3)
  await new Promise(r => setTimeout(r, 150))
  const depoisDaUltima = window.dangaiStore.getState().blockSplits[5] ?? []
  return {
    depoisDeDesfazer,
    encadeado,
    ultimaRecusou: JSON.stringify(depoisDaUltima) === JSON.stringify(encadeado),
  }
`)
ok('clicar de novo separa', desfazer.depoisDeDesfazer.length === 0, JSON.stringify(desfazer.depoisDeDesfazer))
ok(
  'unir a 2 desfaz a uniao da 1 (tres cenas numa tela partida em duas nao existe)',
  JSON.stringify(desfazer.encadeado) === '[2]',
  JSON.stringify(desfazer.encadeado),
)
ok(
  'a ultima cena nao une com ninguem, porque nao ha proxima',
  desfazer.ultimaRecusou,
  String(desfazer.ultimaRecusou),
)

console.log()
ok('nada foi escrito na biblioteca dele', statSync(BIB).mtimeMs === antesMtime)
await avaliar(`window.dangaiStore.getState().reset(); return true`)
fechar()
console.log(`\n${p} passaram, ${f} falharam\n`)
process.exit(f > 0 ? 1 : 0)
