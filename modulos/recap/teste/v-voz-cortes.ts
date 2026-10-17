/**
 * Raio-x dos cortes de pausa de um take guardado (o .bruto.wav e o
 * .palavras.json que o v-voz-real.ts salva): onde cada corte cai, quanto tira
 * e o quadro mais alto DENTRO dele (respiracao ok; fala nunca). So le.
 *   npx esbuild modulos/recap/teste/v-voz-cortes.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-voz-cortes.cjs
 *   node out/teste/v-voz-cortes.cjs <nome.bruto.wav> <nome.palavras.json>
 */
import { readFileSync } from 'node:fs'
import { cortesDasPausas, medirEnergia } from '../electron/voz/pos'
import { lerWav } from '../electron/voz/wav'

const [wav, json] = process.argv.slice(2)
if (!wav || !json) throw new Error('Uso: v-voz-cortes <bruto.wav> <palavras.json>')
const pcm = lerWav(readFileSync(wav))
if (!pcm) throw new Error('WAV ilegivel.')
const palavras = (JSON.parse(readFileSync(json, 'utf8')) as { brutoPalavras: { texto: string; start: number; end: number }[] }).brutoPalavras
const e = medirEnergia(pcm)
const cortes = cortesDasPausas(palavras, e, pcm.amostras.length)
console.log(`limiar ${e.limiar.toFixed(1)} dBFS, ${cortes.length} cortes`)
for (const c of cortes) {
  const q0 = Math.floor(c.de / e.amostrasPorQuadro)
  const q1 = Math.ceil(c.ate / e.amostrasPorQuadro)
  let max = -120
  let onde = q0
  for (let q = q0; q < q1; q++) {
    if (e.db[q]! > max) {
      max = e.db[q]!
      onde = q
    }
  }
  const t0 = c.de / pcm.taxa
  const t1 = c.ate / pcm.taxa
  const antes = palavras.filter((p) => p.end <= t0 + 1e-6).at(-1)
  const depois = palavras.find((p) => p.start >= t1 - 1e-6)
  console.log(
    `${t0.toFixed(3)}-${t1.toFixed(3)} (${(t1 - t0).toFixed(3)} s)  "${antes?.texto ?? '^'}" +${antes ? (t0 - antes.end).toFixed(3) : ''} | ` +
      `${depois ? (depois.start - t1).toFixed(3) : ''}+ "${depois?.texto ?? '$'}"  quadro mais alto ${max.toFixed(1)} dB em ${((onde * e.amostrasPorQuadro) / pcm.taxa).toFixed(2)} s`,
  )
}
