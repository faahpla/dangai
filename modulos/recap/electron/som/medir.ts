import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MedidaDoSom } from '../../shared/edicao-rapida'
import { EnergiaK } from '@shared/loudness'
import { ffmpegPath } from '../ffmpeg-path'

/**
 * A MEDIDA de um arquivo de som (Edicao rapida). Nivelar e por LOUDNESS, nunca
 * por pico (regra do Levi): dois whooshes com o mesmo pico soam ate 8 dB
 * diferentes.
 *
 * O ffmpeg so DECODIFICA (estereo, 48 kHz, float, pelo stdout, aos pedacos) e
 * a conta e a de shared/loudness.ts (BS.1770, a mesma do ebur128; o teste
 * v-som-mix confere as duas). Decodificar em estereo e de proposito: o render
 * sobe tudo para estereo (aformat) e o ffmpeg faz isso sem mudar o loudness de
 * um mono, entao a medida daqui e a do som dentro do mix.
 *
 * Cache por caminho + tamanho + mtime em <userData>/som/medidas.json (um SFX
 * custa ~50 ms; uma musica de 2 min, ~1 s). Sem configurarSom (teste), o cache
 * fica so na memoria. Nada aqui grava perto do arquivo medido: a pasta de
 * musicas (G:/App Resumo/music) e SO LEITURA.
 */

/** O que o cache guarda: a medida do contrato + os blocos de 400 ms (o integrado de um trecho). */
export interface MedidaDetalhada extends MedidaDoSom {
  /** Loudness de cada bloco de 400 ms, passo de 100 ms (ver LoudnessMedido.blocos). */
  blocos: number[]
  /** Quando foi medido (ISO), so para o log. */
  medidoEm: string
}

/** Muda quando a conta muda: medida velha no cache e jogada fora. */
const VERSAO_DA_MEDIDA = 1
const TAXA = 48_000
const CANAIS = 2
/** Teto de uma medida: arquivo quebrado ou gigante nao segura a Edicao rapida. */
const TETO_MS = 90_000

let pastaDoSom: (() => string) | null = null
let reservaDeSfx: (() => string | null) | null = null

/**
 * O main chama uma vez (main.ts): onde moram o cache e o historico de musicas
 * (<userData>/som) e a pasta dos SFX que vem com o app (a RESERVA quando a
 * pasta dele nao tem um tipo).
 */
export function configurarSom(opcoes: {
  userData: string | (() => string)
  reservaDeSfx: string | null | (() => string | null)
}): void {
  // [recap] A pasta de dados do modulo e pedida na hora (o ctx.pasta cria).
  const base = opcoes.userData
  pastaDoSom = () => join(typeof base === 'string' ? base : base(), 'som')
  const reserva = opcoes.reservaDeSfx
  reservaDeSfx = typeof reserva === 'function' ? reserva : () => reserva
  cache = null
}

/** <userData>/som, criada na hora. null = nao configurado (teste sem perfil). */
export function pastaDoSomNoPerfil(): string | null {
  if (!pastaDoSom) return null
  try {
    const pasta = pastaDoSom()
    mkdirSync(pasta, { recursive: true })
    return pasta
  } catch {
    return null
  }
}

/** A pasta dos SFX que vem com o app (assets/sfx ou resources/sfx). */
export function pastaDeReservaDeSfx(): string | null {
  const pasta = reservaDeSfx?.() ?? null
  return pasta && existsSync(pasta) ? pasta : null
}

// ---------------------------------------------------------------------- cache

interface ArquivoDeCache {
  versao: number
  medidas: Record<string, MedidaDetalhada>
}

let cache: Map<string, MedidaDetalhada> | null = null
const emAndamento = new Map<string, Promise<MedidaDetalhada>>()

function caminhoDoCache(): string | null {
  const pasta = pastaDoSomNoPerfil()
  return pasta ? join(pasta, 'medidas.json') : null
}

function lerCache(): Map<string, MedidaDetalhada> {
  if (cache) return cache
  cache = new Map()
  const arq = caminhoDoCache()
  if (!arq || !existsSync(arq)) return cache
  try {
    const bruto = JSON.parse(readFileSync(arq, 'utf8')) as ArquivoDeCache
    if (bruto && bruto.versao === VERSAO_DA_MEDIDA && bruto.medidas && typeof bruto.medidas === 'object') {
      for (const [k, v] of Object.entries(bruto.medidas)) {
        if (v && typeof v.durationSec === 'number' && Array.isArray(v.blocos)) cache.set(k, v)
      }
    }
  } catch {
    // Cache corrompido: mede de novo. Nunca derruba a Edicao rapida.
  }
  return cache
}

function gravarCache(): void {
  const arq = caminhoDoCache()
  if (!arq || !cache) return
  // So o que ainda existe no disco, e no maximo 400 arquivos (os mais novos).
  const entradas = [...cache.entries()].slice(-400)
  const dados: ArquivoDeCache = { versao: VERSAO_DA_MEDIDA, medidas: Object.fromEntries(entradas) }
  const parcial = `${arq}.${process.pid}.tmp`
  try {
    writeFileSync(parcial, JSON.stringify(dados))
    renameSync(parcial, arq)
  } catch (err) {
    console.warn('[som] nao deu para gravar o cache de medidas:', err)
  }
}

function chaveDoArquivo(path: string): string {
  const st = statSync(path)
  return `${path}|${st.size}|${Math.round(st.mtimeMs)}`
}

// --------------------------------------------------------------------- medida

/** A medida do contrato (sem os blocos). */
export async function medirSom(path: string): Promise<MedidaDoSom> {
  const m = await medirSomDetalhado(path)
  return {
    path: m.path,
    durationSec: m.durationSec,
    lufsIntegrado: m.lufsIntegrado,
    lufsMomentaneoMax: m.lufsMomentaneoMax,
    picoSec: m.picoSec,
    inicioSomSec: m.inicioSomSec,
    fimSomSec: m.fimSomSec,
    ...(m.canais !== undefined ? { canais: m.canais } : {}),
  }
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

/** A medida com os blocos de 400 ms, do cache quando o arquivo nao mudou. */
export async function medirSomDetalhado(path: string): Promise<MedidaDetalhada> {
  if (!existsSync(path)) throw new Error(`Som nao encontrado: ${path}`)
  const chave = chaveDoArquivo(path)
  const pronta = lerCache().get(chave)
  if (pronta) return { ...pronta, path }
  const rodando = emAndamento.get(chave)
  if (rodando) return rodando

  const p = naFila(() => decodificarEMedir(path))
    .then((m) => {
      lerCache().set(chave, m)
      gravarCache()
      return m
    })
    .finally(() => emAndamento.delete(chave))
  emAndamento.set(chave, p)
  return p
}

/**
 * No maximo 2 ffmpeg medindo ao mesmo tempo: o preview pede a medida de cada
 * faixa do projeto ao abrir, e 20 musicas decodificando juntas travariam a
 * maquina por nada (a conta e por stream, nao precisa de paralelo).
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

/**
 * ffmpeg -> f32le estereo 48 kHz pelo stdout -> EnergiaK aos pedacos. O resto
 * de um pedaco (meio quadro) espera o proximo.
 */
function decodificarEMedir(path: string): Promise<MedidaDetalhada> {
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
      reject(new Error(`FFmpeg nao pode ser executado (${err.message}).`))
    })
    child.on('close', (code) => {
      clearTimeout(teto)
      if (code !== 0) {
        // Com loglevel info a ultima linha e cabecalho: vale a ultima com cara de erro.
        const linhas = stderr.trim().split(/\r?\n/)
        const detalhe = linhas.filter((l) => /error|invalid|no such|denied|not found/i.test(l)).at(-1) ?? linhas.at(-1) ?? `codigo ${code}`
        reject(new Error(`Nao deu para medir o som (${detalhe}).`))
        return
      }
      const r = acc.resultado()
      if (!(r.durationSec > 0)) {
        reject(new Error('Som vazio.'))
        return
      }
      const arred = (x: number): number => Math.round(x * 1000) / 1000
      const lufs = (x: number | null): number | null => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100)
      resolve({
        path,
        durationSec: arred(r.durationSec),
        lufsIntegrado: lufs(r.integrado),
        lufsMomentaneoMax: lufs(r.momentaneoMax),
        picoSec: arred(r.picoSec),
        inicioSomSec: arred(r.inicioSomSec),
        fimSomSec: arred(r.fimSomSec),
        canais: canaisDoCabecalho(stderr),
        blocos: r.blocos,
        medidoEm: new Date().toISOString(),
      })
    })
  })
}
