import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { indicesLembrados } from '../episodio/perfil'
import { doEpisodio, ehDeExtra, idCru } from '../../shared/extras'
import { join } from 'node:path'
import sharp from 'sharp'
import { converterRgbHdr } from '../cor-hdr'
import { abrirIndicePorId } from '../episodio/abrir-indice'
import { publish, startMediaServer } from '../media-server'
import { pastaDosRascunhos } from './rascunho'
import { melhoresKeyframes } from '../cenas/visao'
import { configDoRecap } from '../contexto'

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
  // (27/11) Planos de OUTRO episodio (os extras, prefixados): pede ao episodio deles.
  const deOutros = planoIds.filter((id) => ehDeExtra(id) && !doEpisodio(id, episodioId))
  if (deOutros.length > 0) {
    const saida = await miniaturasDasCenas(episodioId, planoIds.filter((id) => !deOutros.includes(id)))
    const conhecidos = Object.keys(indicesLembrados())
    const porPrefixo = new Map<string, string[]>()
    for (const id of deOutros) porPrefixo.set(id.slice(0, id.indexOf('~')), [...(porPrefixo.get(id.slice(0, id.indexOf('~'))) ?? []), id])
    for (const [prefixo, ids] of porPrefixo) {
      const outro = conhecidos.find((k) => k.slice(3, 13) === prefixo)
      try {
        Object.assign(saida, outro ? await miniaturasDasCenas(outro, ids) : Object.fromEntries(ids.map((id) => [id, null])))
      } catch {
        for (const id of ids) saida[id] = null
      }
    }
    return saida
  }
  if (planoIds.length === 0) return {}
  const { indice, caminho } = abrirIndicePorId(episodioId)
  await startMediaServer()
  // [lote 2, C7] O keyframe mais bonito e nitido do plano, quando o episodio ja foi medido.
  let melhores = new Map<string, string>()
  try {
    if (configDoRecap().cenas.visao) melhores = melhoresKeyframes(indice, caminho)
  } catch {
    // sem medida: o keyframe do meio, como antes
  }
  const planos = new Map(indice.planos.map((p) => [p.id, p]))
  const pasta = join(pastaDosRascunhos(), 'miniaturas', episodioId)
  const hdr = indice.fonte.hdr
  const saida: Record<string, string | null> = {}

  for (const id of [...new Set(planoIds)].slice(0, MAXIMO_POR_PEDIDO)) {
    // (27/11) Plano de um episodio extra vem prefixado (shared/extras.ts): o arquivo e o do id cru.
    const cru = ehDeExtra(id) && doEpisodio(id, episodioId) ? idCru(id) : id
    const keyframe = melhores.get(cru) ?? planos.get(cru)?.keyframe ?? null
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
    const k = /_(\d)\.jpe?g$/i.exec(keyframe)?.[1] ?? ''
    const destino = join(pasta, `${cru.replace(/[^0-9A-Za-z_-]/g, '_')}@${mtime}${k && k !== '1' ? `k${k}` : ''}${hdr ? '-hdr' : ''}.webp`)
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
