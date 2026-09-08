import { readFileSync } from 'node:fs'
import { buildCaptions } from '../../shared/plan.ts'
import { VIDEO_FPS, type Transcript, type Word } from '../../shared/contract.ts'

const words = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Word[]
const b = buildCaptions({ source: 'script', words, segments: [], text: '', cutCandidates: [] } as Transcript)
const texto = (x: (typeof b)[number]) => x.words.map((w) => w.text).join(' ')

const tres = b.filter((x) => x.words.length > 2)
console.log(`blocos com 3 palavras: ${tres.length} de ${b.length}`)
for (const x of tres) console.log(`  ${(x.from / VIDEO_FPS).toFixed(2)}s  "${texto(x)}" (${texto(x).length} car.)`)

const longos = b.filter((x) => texto(x).length > 12 && x.words.length > 1)
console.log(`\nblocos acima de 12 caracteres: ${longos.length}`)
for (const x of longos.slice(0, 8)) console.log(`  "${texto(x)}" (${texto(x).length})`)
