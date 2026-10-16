import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Cue, FaixaDeLegenda } from '../../shared/episodio'
import { formatoDoCodec, lerLegenda, type FormatoDeLegenda } from '../../shared/legenda-episodio'
import { ffmpegPath } from '../ffmpeg-path'
import { pastaDasLegendas } from './perfil'

/**
 * Tira a faixa de legenda do .mkv e le as falas (o parser e o puro, em
 * shared/legenda-episodio.ts).
 *
 * A faixa vai para o cache do perfil (userData/episodios/legendas/<id>-<faixa>):
 * extrair exige o ffmpeg atravessar o arquivo inteiro (1,4 GB, alguns
 * segundos), e reindexar o mesmo episodio nao precisa disso de novo. O id do
 * episodio no nome garante que outro .mkv nunca reaproveita a faixa errada.
 *
 * -map 0:<index> com o indice ABSOLUTO do stream (o `index` do ffprobe). O
 * 0:s:N contaria so entre as legendas e pegaria outra faixa num arquivo com
 * anexos ou dois audios na frente.
 *
 * -copyts: a faixa sai com o PTS do container, sem o ffmpeg puxar o comeco
 * para zero por conta propria. Quem desconta o start_time e o montarCues, com o
 * mesmo valor que a sonda mediu -- uma conta so, em um lugar so.
 */

interface ComoExtrair {
  formato: FormatoDeLegenda
  /** Codec de saida: copia quando o formato ja e o do arquivo, converte quando nao. */
  codec: string
  muxer: string
}

function comoExtrair(faixa: FaixaDeLegenda): ComoExtrair | null {
  const formato = formatoDoCodec(faixa.codec)
  if (!formato) return null
  const codec = faixa.codec.toLowerCase()
  if (formato === 'ass') return { formato, codec: codec === 'ass' ? 'copy' : 'ass', muxer: 'ass' }
  if (formato === 'vtt') return { formato, codec: 'copy', muxer: 'webvtt' }
  return { formato, codec: codec === 'subrip' || codec === 'srt' ? 'copy' : 'srt', muxer: 'srt' }
}

function rodarFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const filho = spawn(ffmpegPath, args, { windowsHide: true })
    const erro: Buffer[] = []
    filho.stderr.on('data', (c: Buffer) => erro.push(c))
    filho.on('error', (e) => reject(e))
    filho.on('close', (codigo) => {
      if (codigo === 0) resolve()
      else {
        const ultima = Buffer.concat(erro).toString('utf8').trim().split('\n').pop() ?? ''
        reject(new Error(`O ffmpeg nao conseguiu tirar a legenda${ultima ? `: ${ultima}` : ''}`))
      }
    })
  })
}

/** O arquivo da faixa no cache, extraindo se ainda nao existe. */
export async function extrairFaixa(
  video: string,
  idDoEpisodio: string,
  faixa: FaixaDeLegenda,
): Promise<{ arquivo: string; formato: FormatoDeLegenda }> {
  const como = comoExtrair(faixa)
  if (!como) throw new Error(`A faixa ${faixa.index} e legenda de imagem (${faixa.codec}): nao tem texto para ler.`)
  const pasta = pastaDasLegendas()
  mkdirSync(pasta, { recursive: true })
  const arquivo = join(pasta, `${idDoEpisodio}-${faixa.index}.${como.formato}`)
  try {
    if (existsSync(arquivo) && statSync(arquivo).size > 0) return { arquivo, formato: como.formato }
  } catch {
    /* refaz */
  }
  const temp = `${arquivo}.${process.pid}.tmp`
  try {
    await rodarFfmpeg([
      '-hide_banner', '-v', 'error', '-y', '-copyts',
      '-i', video,
      '-map', `0:${faixa.index}`,
      '-c:s', como.codec,
      '-f', como.muxer,
      temp,
    ])
    renameSync(temp, arquivo)
  } finally {
    rmSync(temp, { force: true })
  }
  return { arquivo, formato: como.formato }
}

/** A faixa lida e ja na base de tempo do episodio (menos startTimeSec). */
export async function lerFaixa(
  video: string,
  idDoEpisodio: string,
  faixa: FaixaDeLegenda,
  startTimeSec: number,
): Promise<{ cues: Cue[]; formato: FormatoDeLegenda }> {
  const { arquivo, formato } = await extrairFaixa(video, idDoEpisodio, faixa)
  return { cues: lerLegenda(readFileSync(arquivo), formato, startTimeSec), formato }
}
