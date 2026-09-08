/** Como um pedaco da transcricao vira blocos de legenda. Uso: <json> <de> <ate> */
import { readFileSync } from 'node:fs'
import { buildCaptions } from '../../shared/plan.ts'
import { VIDEO_FPS, type Transcript, type Word } from '../../shared/contract.ts'

const words = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Word[]
const de = Number(process.argv[3] ?? 0)
const ate = Number(process.argv[4] ?? 1e9)

const t: Transcript = { source: 'script', words, segments: [], text: '', cutCandidates: [] }
const blocos = buildCaptions(t)

console.log('inicio    dura    texto')
for (const b of blocos) {
  const ini = b.from / VIDEO_FPS
  if (ini < de || ini > ate) continue
  const dur = b.durationInFrames / VIDEO_FPS
  const txt = b.words.map((w) => w.text).join(' ')
  const marca = dur < 0.25 ? '   <- PISCA' : ''
  console.log(`${ini.toFixed(2).padStart(7)}s ${dur.toFixed(2).padStart(6)}s  "${txt}"${marca}`)
}

const curtas = blocos.filter((b) => b.durationInFrames / VIDEO_FPS < 0.25)
console.log(`\nblocos abaixo de 0,25s no video inteiro: ${curtas.length} de ${blocos.length}`)
for (const b of curtas.slice(0, 10)) {
  console.log(
    `  ${(b.from / VIDEO_FPS).toFixed(2)}s  ${(b.durationInFrames / VIDEO_FPS).toFixed(2)}s  "${b.words.map((w) => w.text).join(' ')}"`,
  )
}
