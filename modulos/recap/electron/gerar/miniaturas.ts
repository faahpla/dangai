import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { converterRgbHdr } from '../cor-hdr'
import { abrirIndicePorId } from '../episodio/abrir-indice'
import { publish, startMediaServer } from '../media-server'
import { pastaDosRascunhos } from './rascunho'

/**
 * A miniatura do keyframe das cenas que o roteiro cita, para a tela do passo 2.
 *
 * - acha o indice por abrirIndicePorId (caminhos ja corrigidos) e, para cada
 *   planoId, o `keyframe` do plano;
 * - a tela mostra ~1 miniatura por frase, ~20 por roteiro: uma copia de 320px
 *   em webp (sharp, como a Biblioteca) guardada em <userData>/recaps/miniaturas,
 *   NUNCA na pasta do episodio (a do Corte Cenas/AnCut e so leitura). O nome
 *   leva o mtime do keyframe: cena recortada no passo 1 gera miniatura nova;
 * - publicada pelo servidor de midia local (o mesmo da Biblioteca);
 * - plano sem keyframe, ou keyframe que sumiu do disco: null. Se o sharp nao
 *   der conta da imagem, publica o keyframe original (pesa mais, mas aparece);
 * - episodio HDR: o keyframe sai do video sem converter a cor e fica lavado.
 *   A cor e convertida nos pixels, como a Biblioteca faz (cor-hdr.ts), com
 *   '-hdr' no nome para nao reaproveitar uma miniatura lavada.
 */

const LARGURA = 320
const QUALIDADE = 78
/** A tela pede as do roteiro na tela; mais que isso e engano de quem chamou. */
const MAXIMO_POR_PEDIDO = 200

export async function miniaturasDasCenas(
  episodioId: string,
  planoIds: readonly string[],
): Promise<Record<string, string | null>> {
  const { indice } = abrirIndicePorId(episodioId)
  await startMediaServer()
  const planos = new Map(indice.planos.map((p) => [p.id, p]))
  const pasta = join(pastaDosRascunhos(), 'miniaturas', episodioId)
  const hdr = indice.fonte.hdr
  const saida: Record<string, string | null> = {}

  for (const id of [...new Set(planoIds)].slice(0, MAXIMO_POR_PEDIDO)) {
    const keyframe = planos.get(id)?.keyframe ?? null
    let mtime = 0
    try {
      mtime = keyframe ? Math.round(statSync(keyframe).mtimeMs) : 0
    } catch {
      mtime = 0
    }
    if (!keyframe || mtime === 0) {
      saida[id] = null
      continue
    }
    // O id do plano vem do nome do mp4 ('0025', '0164-0167'): so letra, numero, - e _.
    const destino = join(pasta, `${id.replace(/[^0-9A-Za-z_-]/g, '_')}@${mtime}${hdr ? '-hdr' : ''}.webp`)
    try {
      if (!existsSync(destino)) {
        mkdirSync(pasta, { recursive: true })
        // Temporario + rename: um webp pela metade nunca fica com o nome final.
        const temp = `${destino}.${process.pid}.tmp`
        await gravarMiniatura(keyframe, temp, hdr)
        renameSync(temp, destino)
      }
      saida[id] = publish(destino)
    } catch {
      saida[id] = publish(keyframe)
    }
  }
  return saida
}

async function gravarMiniatura(keyframe: string, destino: string, hdr: boolean): Promise<void> {
  const reduzida = sharp(keyframe).resize({ width: LARGURA, withoutEnlargement: true })
  if (!hdr) {
    await reduzida.webp({ quality: QUALIDADE }).toFile(destino)
    return
  }
  const { data, info } = await reduzida.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  converterRgbHdr(data)
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } })
    .webp({ quality: QUALIDADE })
    .toFile(destino)
}
