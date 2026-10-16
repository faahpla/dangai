/**
 * O SOM DO MIX: o envelope de ganho (ducking) como capacidade do nucleo.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-som-mix.ts`.
 *
 * 1. trecho SEM `ducking` = o de antes: o schema nao inventa o campo, o item
 *    do render sai igual e o grafo do ffmpeg e o MESMO do b932b11 (capturado
 *    do codigo de antes, abaixo);
 * 2. a conta do envelope (shared/ducking.ts);
 * 3. o filtro do ffmpeg toca a mesma curva que ganhoDoEnvelope (medido);
 * 4. envelope longo passa no parser do ffmpeg, e o mux inteiro roda com ele;
 * 5. o preview no equilibrio do render: a medida em JS (shared/loudness.ts)
 *    bate com o ebur128, o desconto da voz e dos arquivos mono, e o MP4
 *    continua com a voz em -14 LUFS.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DUCKING_PADRAO, trechoDeAudioSchema, type Ducking } from '../../shared/contract.ts'
import {
  envelopeDeDucking,
  ganhoDoEnvelope,
  recortarEnvelope,
  trilhaParaMixar,
  type PontoDeGanho,
} from '../../shared/ducking.ts'
import { filtroDoEnvelope } from '../../electron/services/mix.ts'
import { grafoDoMix, muxWithNormalizedAudio, type ResolvedCue } from '../../electron/services/render.ts'
import { ffmpegPath } from '../../electron/services/ffmpeg-path.ts'
import { medirSom } from '../../electron/services/medir-som.ts'
import { LUFS_DA_NARRACAO, monoEmDoisCanais } from '../../shared/loudness.ts'
import { descontoDaVoz, descontoDoArquivo } from '../../src/components/som-do-preview.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}
const secao = (s: string): void => console.log(`\n== ${s}`)
const perto = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol

function ff(args: readonly string[]): Promise<{ code: number; out: Buffer; err: string }> {
  return new Promise((resolve) => {
    const c = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-v', 'error', ...args], { windowsHide: true })
    const out: Buffer[] = []
    let err = ''
    c.stdout.on('data', (d: Buffer) => out.push(d))
    c.stderr.on('data', (d: Buffer) => (err += d.toString()))
    c.on('close', (code) => resolve({ code: code ?? -1, out: Buffer.concat(out), err }))
  })
}

/** O integrado do ebur128 do ffmpeg (a referencia). */
async function integradoDoFfmpeg(path: string): Promise<number | null> {
  const c = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-nostats', '-i', path, '-vn', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { windowsHide: true })
  let err = ''
  c.stderr.on('data', (d: Buffer) => (err += d.toString()))
  await new Promise((r) => c.on('close', r))
  const m = /Integrated loudness:\s*[\r\n]+\s*I:\s*(-?[\d.]+)/.exec(err)
  return m ? Number(m[1]) : null
}

async function main(): Promise<void> {
  // ------------------------------------------------------------ 1. schema
  secao('schema: trecho sem ducking fica sem ducking')
  const base = {
    id: 't1', path: 'x.mp3', fileName: 'x.mp3', faixa: 0, at: 0, durationSec: 10, inicioSec: 0, usarSec: null,
    gainDb: -20, fadeInSec: 0.5, fadeOutSec: 1, peaks: [], rms: [],
  }
  const semCampo = trechoDeAudioSchema.parse(base)
  ok('sem o campo: nenhuma chave `ducking` aparece', !('ducking' in semCampo))
  ok('ducking null continua null', trechoDeAudioSchema.parse({ ...base, ducking: null }).ducking === null)
  const vazio = trechoDeAudioSchema.parse({ ...base, ducking: {} }).ducking
  ok('ducking {} = o padrao', JSON.stringify(vazio) === JSON.stringify(DUCKING_PADRAO), JSON.stringify(vazio))
  const comExtra = trechoDeAudioSchema.parse({ ...base, ducking: { abaixoDb: 9, futuro: 1 } }).ducking as Ducking & { futuro?: number }
  ok('campo desconhecido dentro do ducking fica', comExtra?.abaixoDb === 9 && comExtra.futuro === 1)
  ok('ducking invalido nao derruba o trecho (vira sem ducking)', trechoDeAudioSchema.parse({ ...base, ducking: { abaixoDb: 99 } }).ducking === undefined)

  // ---------------------------------------------------------- 2. envelope
  secao('envelope pelas palavras')
  const d: Ducking = { abaixoDb: 6, ataqueSec: 0.2, soltaSec: 0.5, pausaMinSec: 0.5 }
  ok('sem palavras: []', envelopeDeDucking([], 10, d).length === 0)
  ok('abaixoDb 0: []', envelopeDeDucking([{ start: 1, end: 2 }], 10, { ...d, abaixoDb: 0 }).length === 0)
  ok('duracao 0: []', envelopeDeDucking([{ start: 1, end: 2 }], 0, d).length === 0)

  // fala de 1 a 3 (vao de 0,2 s entre palavras nao sobe), pausa longa, fala de 5 a 6.
  const palavras = [
    { start: 1, end: 1.8, text: 'Ele' },
    { start: 2, end: 3, text: 'voltou' },
    { start: 5, end: 6, text: 'Fim.' },
  ]
  const env = envelopeDeDucking(palavras, 8, d)
  const g = (t: number): number => ganhoDoEnvelope(env, t)
  ok('antes da rampa: 0 dB', g(0.5) === 0)
  ok('rampa de ataque termina na 1a palavra', perto(g(0.9), -3, 0.01) && g(1) === -6, `${g(0.9)} ${g(1)}`)
  ok('vao curto entre palavras fica embaixo', g(1.9) === -6)
  ok('pausa longa sobe ate 0', g(4) === 0)
  ok('solta de 0,5 s depois da fala', perto(g(3.25), -3, 0.01) && g(3.5) === 0)
  ok('depois da ultima fala volta a 0 e fica', g(6.5) === 0 && g(8) === 0)
  ok('pontos em ordem e dentro do video', env.every((p, i) => i === 0 || p.t > env[i - 1]!.t) && env[env.length - 1]!.t <= 8)

  // Fim de frase com vao de 0,15 s (menor que pausaMinSec) abre respiro;
  // abreviacao colada (vao 0,05) nao.
  const respiro = envelopeDeDucking(
    [
      { start: 1, end: 2, text: 'Acabou.' },
      { start: 2.15, end: 3, text: 'Depois' },
      { start: 3.05, end: 4, text: 'Dr.' },
      { start: 4.05, end: 5, text: 'Stone' },
    ],
    6,
    d,
  )
  const meioDoRespiro = ganhoDoEnvelope(respiro, 2.1)
  ok('fim de frase com vao de 0,15 s sobe um pouco', meioDoRespiro > -6 && meioDoRespiro < -4.5, meioDoRespiro.toFixed(2))
  ok('"Dr." colado nao abre respiro', ganhoDoEnvelope(respiro, 4.02) === -6)
  ok('paragrafo tambem fecha frase', ganhoDoEnvelope(envelopeDeDucking(
    [{ start: 1, end: 2, text: 'fim', paragraph: true }, { start: 2.15, end: 3, text: 'outro' }], 4, d), 2.1) > -6)
  ok('palavra sem tempo e ignorada', envelopeDeDucking([{ start: Number.NaN, end: 1 }], 4, d).length === 0)

  const corte = recortarEnvelope(env, 2.5, 4)
  ok('recorte: pontas interpoladas', corte[0]!.t === 2.5 && corte[0]!.db === -6 && corte[corte.length - 1]!.t === 4 && corte[corte.length - 1]!.db === 0)

  // -------------------------------------------- 3. o item do render: igual
  secao('trilhaParaMixar: sem ducking, o item de antes')
  const trecho = { ...base, path: 'm.mp3', at: 0.25, inicioSec: 0.5, usarSec: 2.5 }
  const antes = {
    path: trecho.path, at: trecho.at, inicioSec: trecho.inicioSec, duracaoSec: 2.5,
    gainDb: trecho.gainDb, fadeInSec: trecho.fadeInSec, fadeOutSec: trecho.fadeOutSec,
  }
  const item = trilhaParaMixar(trecho, palavras, 8)
  ok('mesmo objeto, mesmas chaves, sem `envelope`', JSON.stringify(item) === JSON.stringify(antes), JSON.stringify(item))
  ok('ducking null = sem envelope', !('envelope' in trilhaParaMixar({ ...trecho, ducking: null }, palavras, 8)))
  const comDucking = trilhaParaMixar({ ...trecho, ducking: d }, palavras, 8)
  ok('com ducking: envelope recortado no trecho', comDucking.envelope?.[0]?.t === 0.25 && comDucking.envelope?.at(-1)?.t === 2.75)
  ok('com ducking mas sem palavras: sem envelope', !('envelope' in trilhaParaMixar({ ...trecho, ducking: d }, [], 8)))

  // ----------------------------------------------- 4. o grafo: o de antes
  secao('grafo do mix: sem envelope, o MESMO do b932b11')
  const S = '<S>'
  const sfx: ResolvedCue[] = [{ path: `${S}/sfx.wav`, at: 0.4, gainDb: 0, durationSec: 0.3 }]
  const music = { path: `${S}/musica.wav`, gainDb: -20 }
  const trilhas = [
    { path: `${S}/musica.wav`, at: 0.25, inicioSec: 0.5, duracaoSec: 2.5, gainDb: -18, fadeInSec: 0.5, fadeOutSec: 1 },
    { path: `${S}/sfx.wav`, at: 1.1, inicioSec: 0, duracaoSec: 0.5, gainDb: -3, fadeInSec: 0, fadeOutSec: 0 },
  ]
  // Saida do muxWithNormalizedAudio do b932b11 (mix.txt), com estas mesmas entradas.
  const OURO_A = [
    '[1:a]aformat=channel_layouts=stereo[narr]',
    '[2:a]aformat=channel_layouts=stereo,afade=t=out:st=0.270:d=0.03,adelay=400|400,volume=0.25120[s0]',
    '[3:a]aformat=channel_layouts=stereo,atrim=0:3.000,asetpts=N/SR/TB,volume=0.10000,afade=t=in:st=0:d=1.2,afade=t=out:st=1.000:d=2[mus]',
    '[4:a]aformat=channel_layouts=stereo,atrim=start=0.500,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.500,afade=t=out:st=1.500:d=1.000,volume=0.12589,adelay=250|250[t0]',
    '[5:a]aformat=channel_layouts=stereo,atrim=start=0.000,asetpts=PTS-STARTPTS,volume=0.70795,adelay=1100|1100[t1]',
    '[narr][s0][mus][t0][t1]amix=inputs=5:duration=longest:normalize=0[cru];[cru]apad,atrim=0:3.000,asetpts=N/SR/TB[out]',
  ].join(';\n')
  const OURO_B = '[1:a]aformat=channel_layouts=stereo[narr];\n[narr]anull[cru];[cru]apad,atrim=0:3.000,asetpts=N/SR/TB[out]'
  ok('sfx + musica + 2 trechos', grafoDoMix(sfx, music, trilhas, 3) === OURO_A)
  ok('so a narracao', grafoDoMix([], null, [], 3) === OURO_B)
  ok('envelope [] = o mesmo grafo', grafoDoMix(sfx, music, trilhas.map((t) => ({ ...t, envelope: [] })), 3) === OURO_A)
  ok('envelope todo em 0 dB = o mesmo grafo', grafoDoMix(sfx, music, trilhas.map((t) => ({ ...t, envelope: [{ t: 0.25, db: 0 }, { t: 2.75, db: 0 }] })), 3) === OURO_A)

  const envT0 = comDucking.envelope!
  const comEnv = grafoDoMix(sfx, music, [{ ...trilhas[0]!, envelope: envT0 }, trilhas[1]!], 3)
  const filtro = filtroDoEnvelope(envT0, 0.25)!
  ok('com envelope: so entra o filtro entre volume= e adelay= do trecho', comEnv === OURO_A.replace('volume=0.12589,adelay=250|250[t0]', `volume=0.12589,${filtro},adelay=250|250[t0]`))
  ok('filtroDoEnvelope: null sem pontos', filtroDoEnvelope(undefined, 0) === null && filtroDoEnvelope([], 0) === null)

  // ------------------------------------- 5. o ffmpeg toca a mesma curva
  secao('o filtro do ffmpeg = ganhoDoEnvelope (medido)')
  const at = 0.5
  const curva: PontoDeGanho[] = [{ t: 1, db: 0 }, { t: 2, db: -10 }, { t: 3, db: -10 }, { t: 3.5, db: 0 }]
  const f = filtroDoEnvelope(curva, at)!
  const taxa = 48_000
  const tocar = (af: string | null) =>
    ff(['-f', 'lavfi', '-i', `sine=f=1000:d=4.5:sample_rate=${taxa}`, ...(af ? ['-af', af] : []), '-ac', '1', '-f', 'f32le', '-'])
  const [cru, filtrado] = await Promise.all([tocar(null), tocar(f)])
  ok('ffmpeg aceitou o filtro', filtrado.code === 0, filtrado.err.slice(0, 200))
  if (filtrado.code === 0) {
    const a = new Float32Array(cru.out.buffer.slice(cru.out.byteOffset, cru.out.byteOffset + cru.out.length))
    const b = new Float32Array(filtrado.out.buffer.slice(filtrado.out.byteOffset, filtrado.out.byteOffset + filtrado.out.length))
    const rms = (x: Float32Array, t: number): number => {
      const i0 = Math.round((t - 0.01) * taxa)
      const i1 = Math.round((t + 0.01) * taxa)
      let s = 0
      for (let i = i0; i < i1; i++) s += x[i]! * x[i]!
      return Math.sqrt(s / (i1 - i0))
    }
    for (const tl of [0.25, 1.0, 2.0, 2.75, 3.5, 4.2]) {
      const medido = 20 * Math.log10(rms(b, tl) / rms(a, tl))
      const esperado = ganhoDoEnvelope(curva, tl + at)
      ok(`t local ${tl}s: ${esperado.toFixed(1)} dB`, perto(medido, esperado, 0.35), `medido ${medido.toFixed(2)}`)
    }
  }

  // ----------------------------- 6. envelope longo e o mux de verdade
  secao('envelope longo e o mux inteiro')
  const muitas = Array.from({ length: 400 }, (_, i) => ({ start: i * 1.5, end: i * 1.5 + 0.7, text: 'a' }))
  const longo = envelopeDeDucking(muitas, 600, d)
  const fl = filtroDoEnvelope(longo, 0)!
  const dir = mkdtempSync(join(tmpdir(), 'dangai-som-mix-'))
  try {
    const p = (n: string): string => join(dir, n)
    // Por arquivo, como o render: na linha de comando nao cabe.
    writeFileSync(p('longo.txt'), `[0:a]${fl}[o]`)
    const parse = await ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1', '-filter_complex_script', p('longo.txt'), '-map', '[o]', '-f', 'null', '-'])
    ok(`${longo.length} pontos passam no parser do ffmpeg`, parse.code === 0, parse.err.slice(0, 200))

    await ff(['-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p('video.mp4')])
    await ff(['-f', 'lavfi', '-i', 'sine=f=300:d=4', '-ac', '1', p('voz.wav')])
    await ff(['-f', 'lavfi', '-i', 'sine=f=500:d=6', '-ac', '2', p('musica.wav')])
    const t = { path: p('musica.wav'), at: 0, inicioSec: 0, duracaoSec: 4, gainDb: -10, fadeInSec: 0, fadeOutSec: 0 }
    const e: PontoDeGanho[] = [{ t: 0, db: 0 }, { t: 1, db: 0 }, { t: 1.2, db: -6 }, { t: 4, db: -6 }]
    await muxWithNormalizedAudio(p('video.mp4'), p('voz.wav'), p('saida.mp4'), [], null, [{ ...t, envelope: e }], 4)
    const grafo = readFileSync(p('mix.txt'), 'utf8')
    ok('mux com envelope gera o MP4', existsSync(p('saida.mp4')))
    ok('o mix.txt leva o envelope', grafo.includes('asetnsamples=n=256') && grafo.includes("eval=frame"))
    await muxWithNormalizedAudio(p('video.mp4'), p('voz.wav'), p('saida2.mp4'), [], null, [t], 4)
    ok('mux sem envelope: grafo sem filtro novo', !readFileSync(p('mix.txt'), 'utf8').includes('asetnsamples'))

    // ------------------------- 7. o preview no equilibrio do render (-14)
    secao('loudness: a conta em JS = o ebur128 do ffmpeg; o render segue em -14')
    await ff(['-f', 'lavfi', '-i', 'anoisesrc=d=6:c=pink:a=0.1,highpass=f=80', '-ac', '1', p('ruido-mono.wav')])
    await ff(['-f', 'lavfi', '-i', 'sine=f=440:d=5', '-af', 'volume=-8dB', '-ac', '2', p('seno-estereo.wav')])
    for (const [nome, canais] of [['ruido-mono.wav', 1], ['seno-estereo.wav', 2]] as const) {
      const m = await medirSom(p(nome))
      const ref = await integradoDoFfmpeg(p(nome))
      ok(`${nome}: integrado ${m.lufsIntegrado} = ebur128 ${ref}`, m.lufsIntegrado !== null && ref !== null && perto(m.lufsIntegrado, ref, 0.15))
      ok(`${nome}: ${canais} canal(is)`, m.canais === canais, String(m.canais))
    }
    ok('a mesma medida volta do cache', (await medirSom(p('ruido-mono.wav'))) === (await medirSom(p('ruido-mono.wav'))))
    ok('mono soa +3 dB no navegador', perto(monoEmDoisCanais(1), 3.01, 0.01) && monoEmDoisCanais(2) === 0)
    ok('voz mono a -23: faixas -6 dB no preview', perto(descontoDaVoz({ lufsIntegrado: -23, canais: 1 }), -5.99, 0.01))
    ok('voz estereo a -14: nada muda', descontoDaVoz({ lufsIntegrado: -14, canais: 2 }) === 0)
    ok('sem medida: nada muda (o preview de antes)', descontoDaVoz(null) === 0 && descontoDaVoz({ lufsIntegrado: null }) === 0 && descontoDoArquivo(null) === 0)
    ok('faixa mono: -3 dB no preview', perto(descontoDoArquivo({ canais: 1 }), -3.01, 0.01) && descontoDoArquivo({ canais: 2 }) === 0)

    await muxWithNormalizedAudio(p('video.mp4'), p('ruido-mono.wav'), p('so-voz.mp4'), [], null, [], 4)
    const final = await integradoDoFfmpeg(p('so-voz.mp4'))
    ok(`o MP4 continua com a voz em ${LUFS_DA_NARRACAO} LUFS`, final !== null && perto(final, LUFS_DA_NARRACAO, 0.5), String(final))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
}

void main()
