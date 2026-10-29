/**
 * UM CLIPE QUE NAO ABRE (electron/services/assets.ts): o importImages de
 * sempre continua recusando a leva, mas so depois de todos pararem -- nenhum
 * "Preparando cena" chega depois do erro (era o recado preso na barra) --, e o
 * importImagesPulando da montagem automatica devolve null so para ele.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-clipe-ruim.ts`.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importImages, importImagesPulando } from '../../electron/services/assets.ts'
import { configureClips } from '../../electron/services/clips.ts'
import { ffmpegPath } from '../../electron/services/ffmpeg-path.ts'
import { startMediaServer } from '../../electron/services/media-server.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}
const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function principal(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'dangai-clipe-ruim-'))
  configureClips(join(dir, 'cache'))
  await startMediaServer()
  const bom = (n: number): string => {
    const p = join(dir, `bom${n}.mp4`)
    execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=24:duration=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p])
    return p
  }
  const preto = join(dir, 'preto.mp4')
  execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', preto])
  const bons = [1, 2, 3, 4, 5, 6].map(bom)

  // O de sempre: recusa, mas sem recado depois do erro.
  const andamento: number[] = []
  let recusou: Error | null = null
  let quando = 0
  try {
    await importImages([bons[0]!, preto, ...bons.slice(1)], undefined, undefined, () => andamento.push(Date.now()))
  } catch (err) {
    recusou = err as Error
    quando = Date.now()
  }
  await espera(1500)
  ok('importImages: o clipe preto ainda recusa a leva', recusou !== null && /preto/i.test(recusou.message), recusou?.message ?? 'nao recusou')
  ok('importImages: nenhum "Preparando cena" depois do erro', andamento.every((t) => t <= quando), `${andamento.filter((t) => t > quando).length} depois`)

  // O da montagem: so o preto vira null.
  const r = await importImagesPulando([bons[0]!, preto, bons[1]!])
  ok('pulando: os bons voltam, na ordem', r.imagens[0] !== null && r.imagens[2] !== null && r.imagens[0]!.fileName === 'bom1.mp4' && r.imagens[2]!.fileName === 'bom2.mp4')
  ok('pulando: o preto vira null, com o motivo', r.imagens[1] === null && r.erros.length === 1 && r.erros[0]!.indice === 1 && /preto/i.test(r.erros[0]!.erro.message))

  rmSync(dir, { recursive: true, force: true })
  console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
}
void principal()
