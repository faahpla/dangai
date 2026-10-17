import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * WAV do motor de voz: PCM 16 bits MONO, sempre. E o formato do bruto e da
 * narracao de todo take.
 *
 * Por que escrever o cabecalho aqui e nao deixar o ffmpeg gravar: o arquivo e
 * ENDERECADO POR CONTEUDO (nome = sha256 dos bytes). Um cabecalho canonico de
 * 44 bytes, sem LIST/INFO com a versao do encoder, faz o mesmo audio dar
 * sempre o mesmo nome -- em qualquer maquina e com qualquer ffmpeg. E a
 * contagem de amostras sai daqui, exata (a duracao do take e amostras/taxa).
 */

export interface Pcm {
  /** Amostras por segundo. */
  taxa: number
  /** Mono, inteiro de 16 bits. */
  amostras: Int16Array
}

export function duracaoDoPcm(pcm: Pcm): number {
  return pcm.amostras.length / pcm.taxa
}

export function sha256(dados: Buffer | string): string {
  return createHash('sha256').update(dados).digest('hex')
}

/**
 * Le um WAV PCM 16 bits (mono ou mais canais, que viram mono pela media).
 * null = nao e PCM 16 bits (float, 24 bits, mp3 dentro de WAV...): quem chama
 * passa pelo ffmpeg.
 *
 * Tolera o cabecalho de quem gravou sem saber o tamanho (stream): data com
 * tamanho 0 ou maior que o arquivo vale "ate o fim".
 */
export function lerWav(buf: Buffer): Pcm | null {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  let pos = 12
  let canais = 0
  let taxa = 0
  let bits = 0
  let formato = 0
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    let tam = buf.readUInt32LE(pos + 4)
    const corpo = pos + 8
    if (id === 'fmt ') {
      formato = buf.readUInt16LE(corpo)
      canais = buf.readUInt16LE(corpo + 2)
      taxa = buf.readUInt32LE(corpo + 4)
      bits = buf.readUInt16LE(corpo + 14)
      // WAVE_FORMAT_EXTENSIBLE: o formato de verdade e o subformato (GUID).
      if (formato === 0xfffe && tam >= 26) formato = buf.readUInt16LE(corpo + 24)
    } else if (id === 'data') {
      if (formato !== 1 || bits !== 16 || canais < 1 || taxa <= 0) return null
      if (tam === 0 || tam === 0xffffffff || corpo + tam > buf.length) tam = buf.length - corpo
      const quadros = Math.floor(tam / (2 * canais))
      const amostras = new Int16Array(quadros)
      if (canais === 1) {
        for (let i = 0; i < quadros; i++) amostras[i] = buf.readInt16LE(corpo + i * 2)
      } else {
        for (let i = 0; i < quadros; i++) {
          let soma = 0
          for (let c = 0; c < canais; c++) soma += buf.readInt16LE(corpo + (i * canais + c) * 2)
          amostras[i] = Math.round(soma / canais)
        }
      }
      return { taxa, amostras }
    }
    // Pedacos tem tamanho par (padding de 1 byte quando impar).
    pos = corpo + tam + (tam % 2)
  }
  return null
}

/** O WAV canonico: RIFF + fmt (PCM 16 bits mono) + data. Sem nenhum outro pedaco. */
export function wavDoPcm(pcm: Pcm): Buffer {
  const dados = pcm.amostras.length * 2
  const buf = Buffer.alloc(44 + dados)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dados, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(pcm.taxa, 24)
  buf.writeUInt32LE(pcm.taxa * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dados, 40)
  for (let i = 0; i < pcm.amostras.length; i++) buf.writeInt16LE(pcm.amostras[i]!, 44 + i * 2)
  return buf
}

/** O audio de um take, com a frase certa quando ele sumiu do disco. */
export function lerWavDoDisco(caminho: string): Pcm {
  if (!existsSync(caminho)) throw new Error('O audio deste take sumiu do disco. Gere de novo.')
  const pcm = lerWav(readFileSync(caminho))
  if (!pcm) throw new Error('O audio do take nao e um WAV que o Studio le.')
  return pcm
}

/** Quantos hex do sha256 vao no nome: 128 bits, sem colisao na pratica, nome curto. */
const HEX_NO_NOME = 32

/**
 * Grava o PCM como <prefixo>-<sha>.wav em `pasta`, enderecado por conteudo:
 * o mesmo audio da o mesmo nome e um arquivo que ja existe NUNCA e reescrito
 * (o take antigo continua tocando). Temporario + rename: nunca meio arquivo.
 */
export function gravarWavEnderecado(
  pasta: string,
  prefixo: 'bruto' | 'narracao',
  pcm: Pcm,
): { nome: string; caminho: string } {
  const bytes = wavDoPcm(pcm)
  const nome = `${prefixo}-${sha256(bytes).slice(0, HEX_NO_NOME)}.wav`
  const caminho = join(pasta, nome)
  if (!existsSync(caminho)) {
    mkdirSync(pasta, { recursive: true })
    const temp = `${caminho}.${process.pid}.${Date.now()}.tmp`
    try {
      writeFileSync(temp, bytes)
      renameSync(temp, caminho)
    } finally {
      rmSync(temp, { force: true })
    }
  }
  return { nome, caminho }
}

/** Um pedaco [de, ate) em amostras (copia). */
export function fatiar(pcm: Pcm, de: number, ate: number): Int16Array {
  const a = Math.max(0, Math.min(pcm.amostras.length, Math.round(de)))
  const b = Math.max(a, Math.min(pcm.amostras.length, Math.round(ate)))
  return pcm.amostras.slice(a, b)
}

/** Junta pedacos de amostras na ordem. */
export function juntar(pedacos: readonly Int16Array[]): Int16Array {
  const total = pedacos.reduce((s, p) => s + p.length, 0)
  const saida = new Int16Array(total)
  let pos = 0
  for (const p of pedacos) {
    saida.set(p, pos)
    pos += p.length
  }
  return saida
}
