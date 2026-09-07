/**
 * Mede os dois caminhos de upscale contra o que o app faz hoje.
 *
 *   HOJE  = o recorte 9:16 de sempre (estica a fonte 1,78x)
 *   A     = esse mesmo recorte, passado no upscaler e reduzido de volta
 *   B     = recorta a tira da FONTE, upscala a tira, reduz para 1080x1920
 *
 * Os tres terminam em 1080x1920, que e o que o video usa.
 */
import sharp from 'sharp'
import ort from 'onnxruntime-node'

const LARGURA = 1080
const ALTURA = 1920
const MODELO = process.argv[2]
const ESCALA = 4 // o modelo e x4
const LADO = 256 // tamanho do ladrilho
const BORDA = 16 // sobreposicao, para a emenda nao aparecer

let sessao = null
async function abrir() {
  if (!sessao) {
    sessao = await ort.InferenceSession.create(MODELO, { executionProviders: ['dml', 'cpu'] })
  }
  return sessao
}

/** Passa a imagem inteira pelo modelo, em ladrilhos com sobreposicao. */
async function upscale(entrada) {
  const s = await abrir()
  const { data, info } = await entrada.raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info

  const saida = Buffer.alloc(W * ESCALA * H * ESCALA * 3)
  for (let y = 0; y < H; y += LADO) {
    for (let x = 0; x < W; x += LADO) {
      // ladrilho com borda, preso dentro da imagem
      const x0 = Math.max(0, x - BORDA)
      const y0 = Math.max(0, y - BORDA)
      const x1 = Math.min(W, x + LADO + BORDA)
      const y1 = Math.min(H, y + LADO + BORDA)
      const lw = x1 - x0
      const lh = y1 - y0

      const t = new Float32Array(3 * lh * lw)
      for (let j = 0; j < lh; j++) {
        for (let i = 0; i < lw; i++) {
          const p = ((y0 + j) * W + (x0 + i)) * C
          t[0 * lh * lw + j * lw + i] = data[p] / 255
          t[1 * lh * lw + j * lw + i] = data[p + 1] / 255
          t[2 * lh * lw + j * lw + i] = data[p + 2] / 255
        }
      }
      const r = await s.run({ input: new ort.Tensor('float32', t, [1, 3, lh, lw]) })
      const o = r.output.data
      const ow = lw * ESCALA
      const oh = lh * ESCALA

      // devolve so o miolo do ladrilho, sem a borda de sobreposicao
      const cx = (x - x0) * ESCALA
      const cy = (y - y0) * ESCALA
      const cw = Math.min(LADO, W - x) * ESCALA
      const ch = Math.min(LADO, H - y) * ESCALA
      for (let j = 0; j < ch; j++) {
        for (let i = 0; i < cw; i++) {
          const de = (cy + j) * ow + (cx + i)
          const para = ((y * ESCALA + j) * (W * ESCALA) + (x * ESCALA + i)) * 3
          for (let c = 0; c < 3; c++) {
            saida[para + c] = Math.max(0, Math.min(255, Math.round(o[c * oh * ow + de] * 255)))
          }
        }
      }
    }
  }
  return sharp(saida, { raw: { width: W * ESCALA, height: H * ESCALA, channels: 3 } })
}

/** O recorte 9:16 do app, replicado fielmente (makeRenderReady, foco no centro). */
function janela(w, h, foco = 0.5) {
  const escala = Math.max(LARGURA / w, ALTURA / h)
  const sw = Math.max(Math.ceil(w * escala), LARGURA)
  const sh = Math.max(Math.ceil(h * escala), ALTURA)
  return {
    escala,
    sw,
    sh,
    left: Math.round((sw - LARGURA) * foco),
    top: Math.round((sh - ALTURA) * foco),
  }
}

async function medir(fonte, saidaBase) {
  const meta = await sharp(fonte).metadata()
  const { escala, sw, sh, left, top } = janela(meta.width, meta.height)

  // HOJE
  let t = Date.now()
  await sharp(fonte)
    .resize(sw, sh, { fit: 'fill' })
    .extract({ left, top, width: LARGURA, height: ALTURA })
    .png()
    .toFile(`${saidaBase}-hoje.png`)
  const tHoje = Date.now() - t

  // A: pega o recorte pronto e passa no upscaler
  t = Date.now()
  const recorte = sharp(`${saidaBase}-hoje.png`)
  const ampA = await upscale(recorte)
  await ampA.resize(LARGURA, ALTURA, { fit: 'fill' }).png().toFile(`${saidaBase}-A.png`)
  const tA = Date.now() - t

  // B: recorta a tira da FONTE e upscala so ela
  t = Date.now()
  const tiraW = Math.round(LARGURA / escala)
  const tiraH = Math.round(ALTURA / escala)
  const tiraX = Math.max(0, Math.min(meta.width - tiraW, Math.round(left / escala)))
  const tiraY = Math.max(0, Math.min(meta.height - tiraH, Math.round(top / escala)))
  const tira = sharp(fonte).extract({ left: tiraX, top: tiraY, width: tiraW, height: tiraH })
  const ampB = await upscale(tira)
  await ampB.resize(LARGURA, ALTURA, { fit: 'fill' }).png().toFile(`${saidaBase}-B.png`)
  const tB = Date.now() - t

  return { fonte: `${meta.width}x${meta.height}`, tira: `${tiraW}x${tiraH}`, tHoje, tA, tB }
}

const alvos = process.argv.slice(3)
console.log('fonte        tira usada    hoje      A (recorte)   B (fonte)')
for (const [i, f] of alvos.entries()) {
  const r = await medir(f, f.replace(/\.png$/, ''))
  console.log(
    `${r.fonte.padEnd(12)} ${r.tira.padEnd(13)} ${(r.tHoje + 'ms').padEnd(9)} ` +
      `${((r.tA / 1000).toFixed(1) + 's').padEnd(13)} ${(r.tB / 1000).toFixed(1)}s`,
  )
}
