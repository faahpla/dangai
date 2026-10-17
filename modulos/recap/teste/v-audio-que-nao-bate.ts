/**
 * AUDIO QUE NAO E O DO ROTEIRO (v0.1.1): a decisao do alinhador, sem audio.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-audio-que-nao-bate.ts
 */
import { vereditoDoAlinhamento } from '../electron/voz/alinhamento'

const casos: [string, Parameters<typeof vereditoDoAlinhamento>[0], string][] = [
  ['narracao certa (0,81, Whisper concorda)', { temForcado: true, confianca: 0.81, whisperNega: false, temPeloWhisper: true, comWhisper: true }, 'forcado'],
  ['narracao certa, Whisper erra nomes (0,72)', { temForcado: true, confianca: 0.72, whisperNega: true, temPeloWhisper: false, comWhisper: true }, 'forcado'],
  ['outra fala, confianca media (0,45, Whisper discorda)', { temForcado: true, confianca: 0.45, whisperNega: true, temPeloWhisper: false, comWhisper: true }, 'recusar'],
  ['musica/barulho (0,12, Whisper nao ouviu fala)', { temForcado: true, confianca: 0.12, whisperNega: false, temPeloWhisper: false, comWhisper: true }, 'recusar'],
  ['outra fala, confianca baixa (0,2)', { temForcado: true, confianca: 0.2, whisperNega: true, temPeloWhisper: false, comWhisper: true }, 'recusar'],
  ['certa mas com ruido (0,3, Whisper concorda)', { temForcado: true, confianca: 0.3, whisperNega: false, temPeloWhisper: true, comWhisper: true }, 'seguir'],
  ['TTS (Fish) com confianca baixa: como era', { temForcado: true, confianca: 0.2, whisperNega: false, temPeloWhisper: false, comWhisper: false }, 'seguir'],
  ['TTS bom', { temForcado: true, confianca: 0.8, whisperNega: false, temPeloWhisper: false, comWhisper: false }, 'forcado'],
  ['wav2vec2 nao rodou, Whisper concorda', { temForcado: false, confianca: 0, whisperNega: false, temPeloWhisper: true, comWhisper: true }, 'seguir'],
]
let falhas = 0
for (const [nome, entrada, esperado] of casos) {
  const v = vereditoDoAlinhamento(entrada)
  const ok = v === esperado
  if (!ok) falhas++
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${nome}: ${v}${ok ? '' : ` (esperado ${esperado})`}`)
}
console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
