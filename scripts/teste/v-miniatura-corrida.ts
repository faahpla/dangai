/**
 * Duas miniaturas do MESMO mp4 ao mesmo tempo, com o cache frio.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-miniatura-corrida.ts`.
 *
 * O importImages importa 3 a 3 (IMPORTE_PARALELO), e a miniatura do clipe tem
 * nome fixo por arquivo (thumb-c-<hash>.webp). Com o mesmo mp4 em dois blocos
 * vizinhos, a segunda chamada achava o .webp da primeira pela metade, tentava
 * apagar e o Windows devolvia EPERM: o projeto nao abria. Aqui as chamadas tem
 * que sair as duas (e as tres) com a mesma imagem, e um arquivo so no cache.
 *
 * Tudo numa pasta temporaria: um clipe sintetico do ffmpeg e o cache das
 * miniaturas, para nao mexer no dangai-render-cache do app.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureClips, makeClipThumbnail, probeClip } from '../../electron/services/clips'
import { ffmpegPath } from '../../electron/services/ffmpeg-path'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const pasta = mkdtempSync(join(tmpdir(), 'dangai-miniatura-'))
const cache = join(pasta, 'cache')
mkdirSync(cache, { recursive: true })
configureClips(cache)

const clipe = join(pasta, 'clipe.mp4')
execFileSync(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24', '-t', '3',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', clipe,
])

const miniaturas = (): string[] => readdirSync(cache).filter((n) => n.startsWith('thumb-c-') && n.endsWith('.webp'))
const esfriar = (): void => {
  for (const n of miniaturas()) rmSync(join(cache, n), { force: true })
}

const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * `chamadas` miniaturas do mesmo clipe, a k-esima comecando k*atrasoMs depois.
 * O atraso reproduz o import de verdade: la cada trabalhador sonda o clipe
 * antes, e a segunda chamada chega com o ffmpeg da primeira no meio da
 * gravacao (sem a correcao, 30 a 80 ms de atraso caiam no EPERM).
 */
async function rodada(nome: string, chamadas: number, atrasoMs: number, durationSec?: number): Promise<void> {
  esfriar()
  const r = await Promise.allSettled(
    Array.from({ length: chamadas }, (_, k) => espera(k * atrasoMs).then(() => makeClipThumbnail(clipe, durationSec))),
  )
  const erros = r.flatMap((x) => (x.status === 'rejected' ? [String((x.reason as Error)?.message ?? x.reason)] : []))
  ok(`${nome}: as ${chamadas} chamadas resolvem`, erros.length === 0, erros.join(' | '))
  const urls = r.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []))
  ok(`${nome}: todas sao webp`, urls.length > 0 && urls.every((u) => u.startsWith('data:image/webp;base64,')))
  ok(`${nome}: todas a mesma imagem`, urls.length > 0 && urls.every((u) => u === urls[0]))
  const ficou = miniaturas()
  ok(
    `${nome}: um arquivo so no cache, inteiro`,
    ficou.length === 1 && statSync(join(cache, ficou[0]!)).size >= 200,
    ficou.map((n) => `${n} ${statSync(join(cache, n)).size}B`).join(', '),
  )
}

async function main(): Promise<void> {
  const { durationSec } = await probeClip(clipe)
  for (let atraso = 0; atraso <= 150; atraso += 10) await rodada(`2x, atraso ${atraso} ms`, 2, atraso)
  for (const atraso of [0, 20, 40, 60]) await rodada(`3x, atraso ${atraso} ms, duracao do import`, 3, atraso, durationSec)

  // Cache quente: o caminho de sempre continua devolvendo a mesma imagem.
  const antes = await makeClipThumbnail(clipe, durationSec)
  const [a, b] = await Promise.all([makeClipThumbnail(clipe), makeClipThumbnail(clipe)])
  ok('cache quente: as duas leem a mesma imagem', a === antes && b === antes)
}

main()
  .catch((e: unknown) => {
    console.log(`  FALHA inesperada  -- ${(e as Error)?.stack ?? String(e)}`)
    falhas++
  })
  .finally(() => {
    rmSync(pasta, { recursive: true, force: true })
    console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
    process.exitCode = falhas === 0 ? 0 : 1
  })
