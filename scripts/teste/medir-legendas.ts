/**
 * Mede o adiantamento das legendas na transcricao REAL do autosave dele.
 *
 * Uma legenda que comeca antes da propria palavra aparece na tela antes de ser
 * dita. `npx tsx scripts/teste/medir-legendas.ts <caminho do autosave>`
 */
import { readFileSync } from 'node:fs'
import { buildCaptions } from '../../shared/plan.ts'
import { VIDEO_FPS, type Transcript } from '../../shared/contract.ts'

const caminho = process.argv[2] ?? 'C:/Users/faahb/AppData/Roaming/dangai/autosave.dangai'
const arquivo = JSON.parse(readFileSync(caminho, 'utf8')).file as {
  transcript: Transcript
  captions: { from: number; words: { from: number; text: string }[] }[]
}

function medir(blocos: { from: number; words: { from: number; text: string }[] }[], rotulo: string) {
  let adiantadas = 0
  let soma = 0
  let pior = 0
  let piorTxt = ''
  for (const b of blocos) {
    const d = (b.words[0]!.from - b.from) / VIDEO_FPS
    if (d > 0.02) {
      adiantadas += 1
      soma += d
      if (d > pior) {
        pior = d
        piorTxt = b.words.map((w) => w.text).join(' ')
      }
    }
  }
  console.log(
    `${rotulo.padEnd(10)} ${String(adiantadas).padStart(3)} de ${blocos.length} adiantadas` +
      `  | media ${(soma / Math.max(adiantadas, 1)).toFixed(3)}s` +
      `  | pior ${pior.toFixed(3)}s ("${piorTxt}")`,
  )
  return { adiantadas, pior }
}

console.log('legendas que aparecem ANTES da palavra ser dita:\n')
medir(arquivo.captions, 'antes:')
medir(buildCaptions(arquivo.transcript), 'agora:')

// O outro lado da moeda: legenda curta demais pisca em vez de ser lida.
function duracoes(blocos: { durationInFrames: number }[], rotulo: string) {
  const d = blocos.map((b) => b.durationInFrames / VIDEO_FPS).sort((a, b) => a - b)
  const abaixo = (t: number) => d.filter((x) => x < t).length
  console.log(
    `${rotulo.padEnd(10)} mediana ${d[Math.floor(d.length / 2)]!.toFixed(3)}s` +
      `  | mais curta ${d[0]!.toFixed(3)}s` +
      `  | abaixo de 0,25s: ${abaixo(0.25)}  | abaixo de 0,20s: ${abaixo(0.2)}`,
  )
}
console.log('\nduracao das legendas:\n')
duracoes(arquivo.captions as never, 'antes:')
duracoes(buildCaptions(arquivo.transcript) as never, 'agora:')
