import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { EnergiaK, type MedidaDoSom } from '@shared/loudness'
import { ffmpegPath } from './ffmpeg-path'

/**
 * A MEDIDA de um arquivo de som: loudness (BS.1770) e canais. O preview usa
 * para tocar no equilibrio do render (src/components/som-do-preview.ts).
 *
 * O ffmpeg so DECODIFICA (estereo, 48 kHz, float, pelo stdout, aos pedacos) e
 * a conta e a de shared/loudness.ts. Decodificar em estereo e de proposito: o
 * render sobe tudo para estereo (aformat) e o ffmpeg faz isso sem mudar o
 * loudness de um mono, entao a medida daqui e a do som dentro do mix.
 *
 * Cache na memoria por caminho + tamanho + mtime: o preview pede a medida de
 * cada faixa ao abrir o projeto, e a mesma musica repetida mede uma vez so.
 * Nada e gravado perto do arquivo medido.
 */

const TAXA = 48_000
const CANAIS = 2
/** Teto de uma medida: arquivo quebrado ou gigante nao segura ninguem. */
const TETO_MS = 90_000

const prontas = new Map<string, MedidaDoSom>()
const emAndamento = new Map<string, Promise<MedidaDoSom>>()

function chaveDoArquivo(path: string): string {
  const st = statSync(path)
  return `${path}|${st.size}|${Math.round(st.mtimeMs)}`
}

export async function medirSom(path: string): Promise<MedidaDoSom> {
  if (!existsSync(path)) throw new Error(`Som não encontrado: ${path}`)
  const chave = chaveDoArquivo(path)
  const pronta = prontas.get(chave)
  if (pronta) return pronta
  const rodando = emAndamento.get(chave)
  if (rodando) return rodando

  const p = naFila(() => decodificarEMedir(path))
    .then((m) => {
      // Teto do cache: os 400 mais novos bastam para qualquer projeto.
      if (prontas.size >= 400) prontas.delete(prontas.keys().next().value!)
      prontas.set(chave, m)
      return m
    })
    .finally(() => emAndamento.delete(chave))
  emAndamento.set(chave, p)
  return p
}

/**
 * Os canais da 1a faixa de audio pelo cabecalho do ffmpeg ("Audio: pcm_s16le,
 * 24000 Hz, mono, s16"). undefined = nao deu para saber.
 */
export function canaisDoCabecalho(stderr: string): number | undefined {
  const linha = /Stream #\d+:\d+[^\r\n]*?: Audio: [^\r\n]*/.exec(stderr)?.[0]
  if (!linha) return undefined
  const partes = linha.split(',').map((p) => p.trim())
  const iHz = partes.findIndex((p) => /\d+ Hz/.test(p))
  const layout = iHz >= 0 ? (partes[iHz + 1] ?? '') : ''
  if (/^mono\b/.test(layout)) return 1
  if (/^stereo\b/.test(layout) || /^downmix\b/.test(layout)) return 2
  const n = /^(\d+) channels/.exec(layout)
  if (n) return Number(n[1])
  const surround = /^(\d+)\.(\d+)/.exec(layout)
  if (surround) return Number(surround[1]) + Number(surround[2])
  return undefined
}

/**
 * No maximo 2 ffmpeg medindo ao mesmo tempo: o preview pede a medida de cada
 * faixa do projeto ao abrir, e 20 musicas decodificando juntas travariam a
 * maquina por nada.
 */
const MEDINDO_JUNTOS = 2
let medindo = 0
const naEspera: (() => void)[] = []
async function naFila<T>(tarefa: () => Promise<T>): Promise<T> {
  if (medindo >= MEDINDO_JUNTOS) await new Promise<void>((r) => naEspera.push(r))
  medindo++
  try {
    return await tarefa()
  } finally {
    medindo--
    naEspera.shift()?.()
  }
}

/** ffmpeg -> f32le estereo 48 kHz pelo stdout -> EnergiaK aos pedacos. */
function decodificarEMedir(path: string): Promise<MedidaDoSom> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      // loglevel info (sem progresso): o cabecalho diz quantos canais o arquivo tem.
      ['-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info', '-i', path, '-vn', '-ac', String(CANAIS), '-ar', String(TAXA), '-f', 'f32le', '-'],
      { windowsHide: true },
    )
    const acc = new EnergiaK(TAXA, CANAIS)
    const QUADRO = 4 * CANAIS
    let resto: Buffer | null = null
    let stderr = ''
    const teto = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ja morreu */
      }
    }, TETO_MS)

    child.stdout.on('data', (pedaco: Buffer) => {
      const buf: Buffer = resto ? Buffer.concat([resto, pedaco]) : pedaco
      const util = buf.length - (buf.length % QUADRO)
      resto = util < buf.length ? Buffer.from(buf.subarray(util)) : null
      if (util === 0) return
      // Copia alinhada: o Buffer do Node pode comecar num offset impar.
      const f = new Float32Array(util / 4)
      Buffer.from(f.buffer).set(buf.subarray(0, util))
      acc.intercalado(f)
    })
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 64_000) stderr += c.toString()
    })
    child.on('error', (err) => {
      clearTimeout(teto)
      reject(new Error(`FFmpeg não pode ser executado (${err.message}).`))
    })
    child.on('close', (code) => {
      clearTimeout(teto)
      if (code !== 0) {
        // Com loglevel info a ultima linha e cabecalho: vale a ultima com cara de erro.
        const linhas = stderr.trim().split(/\r?\n/)
        const detalhe = linhas.filter((l) => /error|invalid|no such|denied|not found/i.test(l)).at(-1) ?? linhas.at(-1) ?? `codigo ${code}`
        reject(new Error(`Não deu para medir o som (${detalhe}).`))
        return
      }
      const r = acc.resultado()
      if (!(r.durationSec > 0)) {
        reject(new Error('Som vazio.'))
        return
      }
      const arred = (x: number): number => Math.round(x * 1000) / 1000
      const lufs = (x: number | null): number | null => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100)
      const canais = canaisDoCabecalho(stderr)
      resolve({
        path,
        durationSec: arred(r.durationSec),
        lufsIntegrado: lufs(r.integrado),
        lufsMomentaneoMax: lufs(r.momentaneoMax),
        picoSec: arred(r.picoSec),
        inicioSomSec: arred(r.inicioSomSec),
        fimSomSec: arred(r.fimSomSec),
        ...(canais !== undefined ? { canais } : {}),
      })
    })
  })
}
