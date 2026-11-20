import { spawn } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { ffmpegPath } from '../../../electron/services/ffmpeg-path'

/**
 * [claude] BUSCAR FALA: acha um momento nas LEGENDAS dos episodios (o video de
 * curiosidade cita coisas de varios episodios; a fala diz em que minuto). Le a
 * faixa de legenda do .mkv (portugues primeiro) ou um .ass/.srt/.vtt solto, pelo
 * ffmpeg do Dangai. So leitura; cache por arquivo + tamanho + data.
 */

export interface Fala {
  inicio: number
  fim: number
  texto: string
}

const VIDEO = /\.(mkv|mp4|webm|avi|mov)$/i
const LEGENDA = /\.(ass|ssa|srt|vtt)$/i
const cache = new Map<string, Fala[]>()

function rodar(args: string[], teto = 60_000): Promise<{ saida: string; erro: string }> {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, args, { windowsHide: true })
    let saida = ''
    let erro = ''
    const t = setTimeout(() => p.kill(), teto)
    p.stdout.on('data', (b: Buffer) => (saida += b.toString('utf8')))
    p.stderr.on('data', (b: Buffer) => (erro += b.toString('utf8')))
    p.on('error', () => {
      clearTimeout(t)
      resolve({ saida, erro })
    })
    p.on('close', () => {
      clearTimeout(t)
      resolve({ saida, erro })
    })
  })
}

/** A faixa de legenda a usar: portugues > ingles > a primeira. null = o video nao tem legenda. */
export function escolherFaixa(listaDoFfmpeg: string, idioma?: string): number | null {
  const faixas = listaDoFfmpeg
    .split('\n')
    .filter((l) => /Stream #\d+:\d+.*Subtitle:/.test(l))
    .map((l) => ({ lang: (/Stream #\d+:\d+\((\w+)\)/.exec(l)?.[1] ?? '').toLowerCase(), imagem: /hdmv_pgs|dvd_sub|dvb_sub/i.test(l) }))
  const texto = faixas.map((f, i) => ({ ...f, i })).filter((f) => !f.imagem)
  if (!texto.length) return null
  const quer = (idioma ?? '').toLowerCase()
  const pref = [quer, 'por', 'pt', 'pob', 'eng', 'en'].filter(Boolean)
  for (const p of pref) {
    const achou = texto.find((f) => f.lang === p || (p.length === 2 && f.lang.startsWith(p)))
    if (achou) return achou.i
  }
  return texto[0]!.i
}

const tempo = (h: string, m: string, s: string, ms: string): number => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000

/** SRT (o que o ffmpeg devolve) em falas, sem as marcas do ASS. */
export function lerSrt(srt: string): Fala[] {
  const falas: Fala[] = []
  for (const bloco of srt.replace(/\r/g, '').split(/\n\n+/)) {
    const m = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(bloco)
    if (!m) continue
    const texto = bloco
      .slice(bloco.indexOf(m[0]) + m[0].length)
      .replace(/\{[^}]*\}/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\\N/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (texto) falas.push({ inicio: tempo(m[1]!, m[2]!, m[3]!, m[4]!), fim: tempo(m[5]!, m[6]!, m[7]!, m[8]!), texto })
  }
  return falas
}

export async function falasDoArquivo(arquivo: string, idioma?: string): Promise<Fala[]> {
  const st = statSync(arquivo)
  const chave = `${arquivo}|${st.size}|${Math.round(st.mtimeMs)}|${idioma ?? ''}`
  const pronto = cache.get(chave)
  if (pronto) return pronto
  let args: string[]
  if (VIDEO.test(arquivo)) {
    const { erro } = await rodar(['-hide_banner', '-i', arquivo], 20_000)
    const faixa = escolherFaixa(erro, idioma)
    if (faixa === null) {
      cache.set(chave, [])
      return []
    }
    args = ['-v', 'error', '-i', arquivo, '-map', `0:s:${faixa}`, '-f', 'srt', '-']
  } else args = ['-v', 'error', '-i', arquivo, '-f', 'srt', '-']
  const { saida } = await rodar(args)
  const falas = lerSrt(saida)
  cache.set(chave, falas)
  return falas
}

const normal = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')

/** Os arquivos de video/legenda de uma lista e de uma pasta (sem subpastas). */
export function arquivosDaBusca(arquivos: readonly string[], pasta: string | null): string[] {
  const lista = [...arquivos]
  if (pasta) for (const f of readdirSync(pasta)) if (VIDEO.test(f) || LEGENDA.test(f)) lista.push(join(pasta, f))
  return [...new Set(lista)].filter((f) => VIDEO.test(f) || LEGENDA.test(f))
}

export interface Achado {
  arquivo: string
  episodio: string | null
  em: number
  ate: number
  fala: string
}

/** As falas com TODAS as palavras (numa fala ou na fala + a seguinte), em ordem de arquivo e tempo. */
export function procurarNasFalas(arquivo: string, falas: readonly Fala[], texto: string): Achado[] {
  const termos = normal(texto).split(/\s+/).filter((t) => t.length > 1)
  if (!termos.length) return []
  const ep = /s(\d{1,2})\s*e(\d{1,3})/i.exec(basename(arquivo, extname(arquivo)))
  const episodio = ep ? `S${ep[1]!.padStart(2, '0')}E${ep[2]!.padStart(2, '0')}` : null
  const achados: Achado[] = []
  for (let i = 0; i < falas.length; i++) {
    const um = normal(falas[i]!.texto)
    const dois = i + 1 < falas.length ? `${um} ${normal(falas[i + 1]!.texto)}` : um
    const cabe = (s: string): boolean => termos.every((t) => s.includes(t))
    // A fala inteira na SEGUINTE: deixa ela achar sozinha (o par comecaria cedo demais).
    const proxima = i + 1 < falas.length ? normal(falas[i + 1]!.texto) : ''
    if (!cabe(um) && proxima && cabe(proxima)) continue
    if (cabe(um) || cabe(dois)) {
      const junto = !cabe(um)
      achados.push({
        arquivo,
        episodio,
        em: Math.round(falas[i]!.inicio * 100) / 100,
        ate: Math.round((junto ? falas[i + 1]!.fim : falas[i]!.fim) * 100) / 100,
        fala: junto ? `${falas[i]!.texto} / ${falas[i + 1]!.texto}` : falas[i]!.texto,
      })
      if (junto) i++
    }
  }
  return achados
}
