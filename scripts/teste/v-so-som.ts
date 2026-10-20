/**
 * O .MP4 SO DE SOM COM CAPA (o meme do ajk): a capa nao e imagem de video. A
 * sonda recusa como video, e a faixa de video o devolve como 'som' -- para ir a
 * uma faixa de audio, em vez de quebrar o render no compositor do Remotion.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-so-som.ts`.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ErroSoSom, probeClip } from '../../electron/services/clips.ts'
import { configureSobreposicao, prepararSobreposicao } from '../../electron/services/sobreposicao.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}
const ff = (args: string[]): void => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args])
}

async function principal(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'dangai-so-som-'))
  configureSobreposicao(dir)
  const som = join(dir, 'som.m4a')
  const capa = join(dir, 'capa.jpg')
  const comCapa = join(dir, 'meme-com-capa.mp4')
  const video = join(dir, 'video.mp4')
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.6', '-c:a', 'aac', som])
  ff(['-f', 'lavfi', '-i', 'color=c=red:s=320x320', '-frames:v', '1', capa])
  ff(['-i', som, '-i', capa, '-map', '0', '-map', '1', '-c', 'copy', '-disposition:v:0', 'attached_pic', comCapa])
  ff(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', video])

  let erro: unknown = null
  try {
    await probeClip(comCapa)
  } catch (e) {
    erro = e
  }
  ok('a capa nao passa por imagem de video', erro instanceof ErroSoSom, String(erro))
  ok('o recado diz o nome do arquivo', erro instanceof Error && /meme-com-capa\.mp4.*so tem som/.test(erro.message), erro instanceof Error ? erro.message : '')
  const p = await prepararSobreposicao(comCapa)
  ok('na faixa de video ele volta como som', p.tipo === 'som', p.tipo)
  const v = await probeClip(video)
  ok('video de verdade continua video', v.width === 640 && v.height === 360, `${v.width}x${v.height}`)
  ok('e entra na faixa de video', (await prepararSobreposicao(video)).tipo === 'video')

  rmSync(dir, { recursive: true, force: true })
  console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
}
void principal()
