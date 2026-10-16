import { stat } from 'node:fs/promises'
import {
  legendaTemTexto,
  palpiteDoEpisodioSchema,
  type Capitulo,
  type FaixaDeLegenda,
  type FonteDoEpisodio,
  type PalpiteDoEpisodio,
  type SondaDoEpisodio,
} from '../../shared/episodio'
import { ehHdrPeloFfmpeg } from '../cor-hdr'
import { adivinharPeloMotor } from '../motor'
import { sondarComFfprobe, type StreamDoFfprobe } from './ffprobe'
import { impressaoDigital, lembrarImpressao } from './impressao'
import { palpitePeloNome } from './nome'

/**
 * SONDAR o episodio: o que o arquivo e, sem escrever nada em lugar nenhum.
 *
 * Um ffprobe (JSON com streams, format e chapters, ver ffprobe.ts) e a leitura
 * de 8 MiB para a impressao digital: ~150 ms num .mkv de 1,4 GB.
 *
 * BASE DE TEMPO: o `startTimeSec` e o start_time do STREAM DE VIDEO (o PTS do
 * primeiro quadro), com o do container de reserva. O motor (OpenCV) conta o
 * tempo de cada corte como quadro/fps a partir do primeiro quadro, entao e esse
 * o zero do shots.json. Legenda e capitulos vem em PTS absoluto e descontam
 * este valor. Nos .mkv medidos (SubsPlease, VARYG, Erai, ToonsHub) ele e 0.
 */

/** Quanto a sonda espera o `parse` do motor antes de ficar com o porte do Studio. */
const ESPERA_DO_MOTOR_MS = 1500

/** O que sai so do arquivo, sem palpite. O indice usa isto (nao precisa abrir o Python). */
export type SondaDoArquivo = Omit<SondaDoEpisodio, 'palpite' | 'palpiteOrigem'>

function numero(valor: unknown): number | null {
  const n = typeof valor === 'string' ? Number(valor) : typeof valor === 'number' ? valor : Number.NaN
  return Number.isFinite(n) ? n : null
}

/** "24000/1001" -> 23.976. null quando nao da conta (0/0). */
function fracao(valor: string | undefined): number | null {
  if (!valor) return null
  const [a, b] = valor.split('/').map(Number)
  if (!Number.isFinite(a) || !Number.isFinite(b) || !a || !b) return null
  return a / b
}

/** "00:23:59.982000000" (tag DURATION do mkvmerge) -> segundos. */
function duracaoDaTag(tags: Record<string, string> | undefined): number | null {
  const cru = Object.entries(tags ?? {}).find(([k]) => k.toUpperCase().startsWith('DURATION'))?.[1]
  const m = cru ? /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(cru) : null
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

function faixaDe(stream: StreamDoFfprobe): FaixaDeLegenda {
  const tags = stream.tags ?? {}
  const tag = (nome: string): string =>
    Object.entries(tags).find(([k]) => k.toLowerCase() === nome)?.[1]?.trim() ?? ''
  return {
    index: stream.index,
    idioma: tag('language'),
    nome: tag('title'),
    codec: stream.codec_name ?? '',
    default: stream.disposition?.['default'] === 1,
    forced: stream.disposition?.['forced'] === 1,
  }
}

// ------------------------------------------------------------ escolher faixa

/** 0 = pt-BR, 1 = pt sem regiao, 2 = pt europeu, 3 = ingles, 4 = sem idioma, 5 = outro. */
function ordemDoIdioma(faixa: FaixaDeLegenda): number {
  const lang = faixa.idioma.toLowerCase()
  const nome = faixa.nome.toLowerCase()
  const pt =
    ['por', 'pt', 'pob', 'pt-br', 'pt_br', 'ptbr'].includes(lang) || /portugu|brazil|brasil|pt[-_ ]?br/.test(nome)
  if (pt) {
    if (lang === 'pob' || lang === 'pt-br' || lang === 'pt_br' || /brazil|brasil|pt[-_ ]?br|\bbr\b/.test(nome)) return 0
    if (/europ|portugal|pt[-_ ]?pt/.test(nome)) return 2
    return 1
  }
  if (['eng', 'en', 'en-us', 'en-gb'].includes(lang) || /english|ingles/.test(nome)) return 3
  if (!lang || lang === 'und') return 4
  return 5
}

/** Faixa que nao e o dialogo inteiro: so placas/musicas, ou forcada. */
function ehParcial(faixa: FaixaDeLegenda): boolean {
  return faixa.forced || /sign|song|forced|karaoke|lyric|commentary|comentario/i.test(faixa.nome)
}

/** SDH/CC: tem o dialogo, mais descricao de som. Serve, mas a limpa e melhor. */
function ehSdh(faixa: FaixaDeLegenda): boolean {
  return /\bsdh\b|\bcc\b|closed.?caption|hearing/i.test(faixa.nome)
}

function ordemDoCodec(codec: string): number {
  const ordem = ['ass', 'ssa', 'subrip', 'srt', 'webvtt', 'mov_text', 'text']
  const i = ordem.indexOf(codec.toLowerCase())
  return i < 0 ? ordem.length : i
}

/**
 * A faixa que o Studio escolheria: PT-BR > PT > EN, faixa inteira antes de
 * "Signs & Songs"/forcada, a limpa antes da SDH, .ass antes de .srt, e o
 * `default` desempata. Legenda de imagem (PGS, VobSub) nunca: nao tem texto.
 *
 * Forcada so perde, nao some: a SubsPlease do Hell Mode marca a UNICA faixa,
 * que tem o dialogo inteiro, como forced. Sem alternativa, e ela.
 */
export function escolherLegenda(faixas: readonly FaixaDeLegenda[]): number | null {
  const chave = (f: FaixaDeLegenda): number[] => [
    ehParcial(f) ? 1 : 0,
    ordemDoIdioma(f),
    ehSdh(f) ? 1 : 0,
    ordemDoCodec(f.codec),
    f.default ? 0 : 1,
    f.index,
  ]
  const ordenadas = faixas
    .filter((f) => legendaTemTexto(f))
    .map((f) => ({ f, k: chave(f) }))
    .sort((a, b) => {
      for (let i = 0; i < a.k.length; i += 1) {
        const d = a.k[i]! - b.k[i]!
        if (d !== 0) return d
      }
      return 0
    })
  return ordenadas[0]?.f.index ?? null
}

// --------------------------------------------------------------------- sondar

/** O arquivo, as faixas, os capitulos e a impressao. Sem palpite. */
export async function sondarArquivo(caminho: string): Promise<SondaDoArquivo> {
  let tamanho: number
  try {
    const s = await stat(caminho)
    if (!s.isFile()) throw new Error('nao e arquivo')
    tamanho = s.size
  } catch {
    throw new Error(`O arquivo nao existe mais ou nao abre: ${caminho}`)
  }

  const probe = await sondarComFfprobe(caminho)
  const streams = probe.streams ?? []
  // Capa anexada (attached_pic) tambem e "video": fica de fora.
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.['attached_pic'] !== 1)
  if (!video) throw new Error('Esse arquivo nao tem video.')

  const duracaoSec =
    numero(probe.format?.duration) ?? numero(video.duration) ?? duracaoDaTag(video.tags) ?? 0
  if (!(duracaoSec > 0)) throw new Error('Nao deu para saber a duracao desse video.')

  // r_frame_rate e a taxa nominal; num VFR mal marcado ela vem absurda (1000/1)
  // e a media e melhor.
  const nominal = fracao(video.r_frame_rate)
  const fps = nominal && nominal > 1 && nominal <= 120 ? nominal : (fracao(video.avg_frame_rate) ?? 24000 / 1001)

  const startTimeSec = numero(video.start_time) ?? numero(probe.format?.start_time) ?? 0

  const fonte: FonteDoEpisodio = {
    path: caminho,
    tamanho,
    duracaoSec,
    fps,
    startTimeSec,
    largura: video.width ?? 0,
    altura: video.height ?? 0,
    // O mesmo teste que o Dangai faz no texto do ffmpeg (cor-hdr.ts).
    hdr: ehHdrPeloFfmpeg(`${video.color_transfer ?? ''} ${video.color_primaries ?? ''}`),
    codec: video.codec_name ?? '',
  }
  if (fonte.largura <= 0 || fonte.altura <= 0) throw new Error('O video desse arquivo nao tem tamanho legivel.')

  const legendas = streams.filter((s) => s.codec_type === 'subtitle').map(faixaDe)

  const capitulos: Capitulo[] = (probe.chapters ?? [])
    .map((c) => {
      const start = numero(c.start_time)
      const end = numero(c.end_time)
      if (start === null || end === null) return null
      const titulo = Object.entries(c.tags ?? {}).find(([k]) => k.toLowerCase() === 'title')?.[1] ?? ''
      return {
        start: Math.max(0, start - startTimeSec),
        end: Math.max(0, Math.min(duracaoSec, end - startTimeSec)),
        titulo: titulo.trim(),
      }
    })
    .filter((c): c is Capitulo => c !== null && c.end > c.start)

  const id = await impressaoDigital(caminho, tamanho, duracaoSec)
  await lembrarImpressao(caminho, id)

  return { ...fonte, id, legendas, legendaSugerida: escolherLegenda(legendas), capitulos }
}

/**
 * O palpite do motor, se ele responder em ESPERA_DO_MOTOR_MS. Nunca rejeita:
 * motor ausente, quebrado ou lento vira null, e a sonda fica com o porte.
 */
async function palpiteDoMotor(caminho: string): Promise<PalpiteDoEpisodio | null> {
  let relogio: ReturnType<typeof setTimeout> | undefined
  const tempo = new Promise<null>((resolve) => {
    relogio = setTimeout(() => resolve(null), ESPERA_DO_MOTOR_MS)
  })
  try {
    const cru = await Promise.race([adivinharPeloMotor(caminho).catch(() => null), tempo])
    const lido = palpiteDoEpisodioSchema.safeParse(cru)
    return lido.success && lido.data.anime.trim() ? lido.data : null
  } catch {
    return null
  } finally {
    if (relogio) clearTimeout(relogio)
  }
}

export async function sondarEpisodio(caminho: string): Promise<SondaDoEpisodio> {
  // O motor roda em paralelo com o ffprobe: quando ele e rapido, nao custa nada.
  const doMotor = palpiteDoMotor(caminho)
  const arquivo = await sondarArquivo(caminho)
  const motor = await doMotor
  if (motor) return { ...arquivo, palpite: motor, palpiteOrigem: 'motor' }
  return { ...arquivo, palpite: palpitePeloNome(caminho), palpiteOrigem: 'nome' }
}
