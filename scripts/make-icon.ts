import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

/**
 * Gera os icones do app a partir de uma imagem so.
 *
 *   npm run icon -- "C:\\caminho\\logo.png"
 *
 * A logo nao precisa ser quadrada: ela e centralizada num quadrado
 * transparente, porque icone do Windows e sempre quadrado e esticar a arte
 * deformaria o desenho.
 *
 * O .ico e montado na mao. Nao ha biblioteca para isso no projeto e nao vale
 * uma dependencia: desde o Vista o formato aceita PNG embutido, entao o arquivo
 * e so um cabecalho, uma tabela e os PNGs colados em sequencia.
 */

/** Tamanhos que o Windows procura: lista de arquivos, barra, atalho, alt-tab. */
const TAMANHOS = [16, 24, 32, 48, 64, 128, 256]

/** Respiro em volta da arte, em fracao do lado. Sem isso o icone fica sufocado. */
const MARGEM = 0.06

const origem = process.argv[2]
if (!origem) {
  console.error('uso: npm run icon -- "caminho/para/logo.png"')
  process.exit(1)
}

const destino = join(process.cwd(), 'build')
mkdirSync(destino, { recursive: true })

/** A arte centralizada num quadrado transparente do lado pedido. */
async function quadrado(lado: number): Promise<Buffer> {
  const util = Math.round(lado * (1 - MARGEM * 2))

  const arte = await sharp(origem)
    // Apara a transparencia da borda antes de encaixar: sem isso o respiro que
    // o arquivo ja trazia soma com o nosso e a arte encolhe no icone pequeno,
    // onde cada pixel conta.
    .trim({ threshold: 1 })
    .resize(util, util, { fit: 'inside', withoutEnlargement: false })
    .toBuffer()

  return sharp({
    create: {
      width: lado,
      height: lado,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: arte, gravity: 'centre' }])
    .png()
    .toBuffer()
}

const pngs = await Promise.all(TAMANHOS.map(quadrado))

// ---------------------------------------------------------------- .ico
const cabecalho = Buffer.alloc(6)
cabecalho.writeUInt16LE(0, 0) // reservado
cabecalho.writeUInt16LE(1, 2) // 1 = icone
cabecalho.writeUInt16LE(TAMANHOS.length, 4)

const tabela = Buffer.alloc(16 * TAMANHOS.length)
let offset = cabecalho.length + tabela.length

TAMANHOS.forEach((lado, i) => {
  const png = pngs[i]!
  const base = i * 16
  // 256 se escreve como 0: o campo tem um byte so.
  tabela.writeUInt8(lado === 256 ? 0 : lado, base)
  tabela.writeUInt8(lado === 256 ? 0 : lado, base + 1)
  tabela.writeUInt8(0, base + 2) // cores da paleta: nenhuma, e RGBA
  tabela.writeUInt8(0, base + 3) // reservado
  tabela.writeUInt16LE(1, base + 4) // planos
  tabela.writeUInt16LE(32, base + 6) // bits por pixel
  tabela.writeUInt32LE(png.length, base + 8)
  tabela.writeUInt32LE(offset, base + 12)
  offset += png.length
})

writeFileSync(join(destino, 'icon.ico'), Buffer.concat([cabecalho, tabela, ...pngs]))

// O electron-builder usa o png de 512 no Linux e como base do icns no mac.
writeFileSync(join(destino, 'icon.png'), await quadrado(512))

console.log(`build/icon.ico  ${TAMANHOS.join(', ')}px`)
console.log('build/icon.png  512px')
