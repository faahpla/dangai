import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'

/**
 * A IMPRESSAO DIGITAL do episodio: o `id` do indice e da sonda.
 *
 *   'ep_' + sha1( `${tamanho}|` + 4 MiB iniciais + `|` + 4 MiB finais + `|${Math.round(duracaoSec * 10)}` )
 *
 * Nao depende do caminho: o mesmo .mkv movido para outra pasta continua sendo
 * o mesmo episodio, e a busca acha o indice dele pela impressao. Ler 8 MiB em
 * vez do arquivo inteiro (1,4 GB) custa ~20 ms em vez de segundos, e o comeco
 * mais o fim de um video ja diferem entre dois releases do mesmo episodio.
 *
 * A duracao vai em DECIMOS de segundo: o `-i` do ffmpeg da centesimos e o
 * ffprobe microssegundos, e os dois arredondam para o mesmo decimo.
 */

const BLOCO = 4 * 1024 * 1024

export async function impressaoDigital(caminho: string, tamanho: number, duracaoSec: number): Promise<string> {
  const hash = createHash('sha1')
  hash.update(`${tamanho}|`)
  const arquivo = await open(caminho, 'r')
  try {
    if (tamanho <= BLOCO * 2) {
      // Arquivo pequeno: ele inteiro no lugar dos dois blocos.
      const tudo = Buffer.alloc(tamanho)
      await arquivo.read(tudo, 0, tamanho, 0)
      hash.update(tudo)
    } else {
      const inicio = Buffer.alloc(BLOCO)
      await arquivo.read(inicio, 0, BLOCO, 0)
      const fim = Buffer.alloc(BLOCO)
      await arquivo.read(fim, 0, BLOCO, tamanho - BLOCO)
      hash.update(inicio)
      hash.update('|')
      hash.update(fim)
    }
  } finally {
    await arquivo.close()
  }
  hash.update(`|${Math.round(duracaoSec * 10)}`)
  return `ep_${hash.digest('hex')}`
}

/**
 * A ultima impressao de cada arquivo nesta sessao, pela chave caminho +
 * tamanho + mtime. A sonda calcula; a busca e o indice, que vem logo depois
 * com o mesmo arquivo, reaproveitam sem reler.
 */
const lembradas = new Map<string, string>()

async function chave(caminho: string): Promise<string> {
  const s = await stat(caminho)
  return `${caminho.toLowerCase()}|${s.size}|${Math.round(s.mtimeMs)}`
}

export async function lembrarImpressao(caminho: string, id: string): Promise<void> {
  try {
    lembradas.set(await chave(caminho), id)
  } catch {
    /* arquivo sumiu entre a sonda e aqui: nada a lembrar */
  }
}

/** A impressao ja calculada nesta sessao, se o arquivo nao mudou. */
export async function impressaoLembrada(caminho: string): Promise<string | null> {
  try {
    return lembradas.get(await chave(caminho)) ?? null
  } catch {
    return null
  }
}
