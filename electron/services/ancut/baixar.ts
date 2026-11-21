import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  tituloDoArquivoBaixado,
  type EventoDoDownload,
  type PedidoDeDownload,
  type QualidadeDoDownload,
  type VideoBaixado,
  type VideoDoLink,
} from '@shared/ancut'
import { ffmpegPath } from '../ffmpeg-path'

/**
 * [ancut] O B-ROLL POR LINK (20/11): trailer, gameplay, teaser -- cola o link,
 * o Dangai baixa e corta como B-roll. O mesmo baixador do AnCut
 * (src/main/services/baixador.ts dele), trazido para ca.
 *
 * Quem baixa e o yt-dlp, o padrao para isso. Ele NAO vai no instalador: o
 * YouTube muda o tempo todo e um yt-dlp parado quebra em semanas, entao ele e
 * baixado na primeira vez e se atualiza uma vez por dia. Junto, o Deno: desde
 * o fim de 2025 o yt-dlp precisa de um JavaScript de fora para o desafio do
 * YouTube. Os dois moram na MESMA pasta que o AnCut usa
 * (%LOCALAPPDATA%\AnCut HUB\ferramentas): quem ja tem o AnCut nao baixa de novo.
 */

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const DENO_ZIP = 'deno-x86_64-pc-windows-msvc.zip'
const DENO_GITHUB = `https://github.com/denoland/deno/releases/latest/download/${DENO_ZIP}`
const UM_DIA_MS = 24 * 60 * 60 * 1000
/** Sem chegar nenhum byte por este tempo, o download e dado como travado. */
const PARADO_MS = 45_000

function pastaDasFerramentas(): string {
  return join(process.env['LOCALAPPDATA'] ?? '', 'AnCut HUB', 'ferramentas')
}

/** O servidor do proprio Deno primeiro (no dia em que isto foi feito o GitHub dava 504 para o zip dele). */
async function enderecosDoDeno(): Promise<string[]> {
  const lista: string[] = []
  try {
    const r = await fetch('https://dl.deno.land/release-latest.txt', { signal: AbortSignal.timeout(15_000) })
    const versao = (await r.text()).trim()
    if (r.ok && /^v\d+\.\d+\.\d+$/.test(versao)) lista.push(`https://dl.deno.land/release/${versao}/${DENO_ZIP}`)
  } catch {
    // sem resposta do servidor do Deno: fica so o GitHub
  }
  lista.push(DENO_GITHUB)
  return lista
}

/** Baixa um arquivo grande com andamento. Grava em `.baixando` e so renomeia no fim. */
async function baixarArquivo(url: string, destino: string, aoProgredir: (fracao: number) => void): Promise<void> {
  const controle = new AbortController()
  let relogio = setTimeout(() => controle.abort(), PARADO_MS)
  const vivo = (): void => {
    clearTimeout(relogio)
    relogio = setTimeout(() => controle.abort(), PARADO_MS)
  }
  const temporario = `${destino}.baixando`
  try {
    const res = await fetch(url, { signal: controle.signal })
    if (!res.ok || !res.body) throw new Error(`o servidor respondeu ${res.status}`)
    vivo()
    const total = Number(res.headers.get('content-length') ?? 0)
    const arquivo = createWriteStream(temporario)
    const leitor = res.body.getReader()
    let lidos = 0
    try {
      for (;;) {
        const { done, value } = await leitor.read()
        if (done) break
        vivo()
        lidos += value.byteLength
        if (!arquivo.write(value)) await new Promise<void>((ok) => arquivo.once('drain', () => ok()))
        if (total > 0) aoProgredir(Math.min(1, lidos / total))
      }
    } finally {
      await new Promise<void>((ok) => arquivo.end(() => ok()))
    }
  } catch (e) {
    await rm(temporario, { force: true })
    if (controle.signal.aborted) throw new Error('o download parou de responder')
    throw e
  } finally {
    clearTimeout(relogio)
  }
  await rm(destino, { force: true })
  await rename(temporario, destino)
}

async function baixarDeAlgum(urls: string[], destino: string, aoProgredir: (fracao: number) => void): Promise<void> {
  let ultimo: unknown = null
  for (const url of urls) {
    try {
      await baixarArquivo(url, destino, aoProgredir)
      return
    } catch (e) {
      ultimo = e
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error('o download falhou')
}

function rodarSimples(exe: string, args: string[], prazoMs: number): Promise<string> {
  return new Promise((ok, falha) => {
    execFile(exe, args, { windowsHide: true, timeout: prazoMs }, (erro, stdout) => (erro ? falha(erro) : ok(String(stdout))))
  })
}

/** A frase do yt-dlp no que a pessoa precisa saber. */
export function explicarErroDoDownload(bruto: string): string {
  const t = bruto.toLowerCase()
  if (t.includes('sign in to confirm your age') || t.includes('age-restricted')) return 'Esse vídeo tem restrição de idade e o YouTube pede login para baixar.'
  if (t.includes('private video')) return 'Esse vídeo é privado.'
  if (t.includes('video unavailable') || t.includes('video is unavailable') || t.includes('this video is not available')) {
    return 'Vídeo indisponível (removido, privado ou bloqueado na sua região).'
  }
  if (t.includes('unsupported url') || t.includes('is not a valid url')) return 'Esse link não é de um site de onde dê para baixar.'
  if (t.includes('sign in to confirm you') && t.includes('bot')) return 'O YouTube pediu para confirmar que não é robô. Tente de novo daqui a pouco.'
  if (/http error 4\d\d/.test(t)) return 'Esse link não abre: a página não existe ou não tem vídeo.'
  if (t.includes('timed out') || t.includes('getaddrinfo') || t.includes('connection')) return 'Não deu para falar com o site. Confira a internet.'
  const linha = bruto
    .replace(/^ERROR:\s*/i, '')
    .replace(/^\[[^\]]+\]\s*[^:]*:\s*/, '')
    .trim()
  return linha ? `O download falhou: ${linha}` : 'O download falhou.'
}

/** O criterio de qualidade: H.264 + AAC antes de tudo (o que o editor abre liso); no maximo, o maior que tiver. */
function ordemDeQualidade(q: QualidadeDoDownload): string {
  return q === 'max' ? 'res,fps,vcodec:av01,acodec:aac' : 'res:1080,fps,vcodec:h264,acodec:aac'
}

let preparando: Promise<{ ytdlp: string; deno: string }> | null = null
let atual: ChildProcess | null = null
let cancelado = false

/** yt-dlp e Deno prontos (baixa na primeira vez; atualiza uma vez por dia). */
function ferramentas(emitir: (e: EventoDoDownload) => void): Promise<{ ytdlp: string; deno: string }> {
  preparando ??= preparar(emitir).finally(() => {
    preparando = null
  })
  return preparando
}

async function preparar(emitir: (e: EventoDoDownload) => void): Promise<{ ytdlp: string; deno: string }> {
  const pasta = pastaDasFerramentas()
  await mkdir(pasta, { recursive: true })
  const ytdlp = join(pasta, 'yt-dlp.exe')
  const deno = join(pasta, 'deno.exe')
  if (!existsSync(ytdlp)) {
    const msg = 'Baixando o yt-dlp (só na primeira vez)…'
    emitir({ tipo: 'ferramenta', mensagem: msg, fracao: 0 })
    await baixarArquivo(YTDLP_URL, ytdlp, (f) => emitir({ tipo: 'ferramenta', mensagem: msg, fracao: f }))
    await writeFile(join(pasta, '.ultima-atualizacao'), String(Date.now()))
  } else {
    await atualizarSePreciso(ytdlp, pasta, emitir)
  }
  if (!existsSync(deno)) {
    const zip = join(pasta, 'deno.zip')
    const msg = 'Baixando o Deno, que o YouTube exige (só na primeira vez)…'
    emitir({ tipo: 'ferramenta', mensagem: msg, fracao: 0 })
    await baixarDeAlgum(await enderecosDoDeno(), zip, (f) => emitir({ tipo: 'ferramenta', mensagem: msg, fracao: f }))
    // O tar do Windows (10 em diante) abre zip.
    const tar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
    await rodarSimples(tar, ['-xf', zip, '-C', pasta], 120_000)
    await rm(zip, { force: true })
    if (!existsSync(deno)) throw new Error('O Deno não veio no pacote baixado.')
  }
  return { ytdlp, deno }
}

/** `yt-dlp -U` no maximo uma vez por dia. Falhar aqui nao impede baixar. */
async function atualizarSePreciso(ytdlp: string, pasta: string, emitir: (e: EventoDoDownload) => void): Promise<void> {
  const marca = join(pasta, '.ultima-atualizacao')
  let ultima = 0
  try {
    ultima = Number(await readFile(marca, 'utf8')) || 0
  } catch {
    ultima = 0
  }
  if (Date.now() - ultima < UM_DIA_MS) return
  emitir({ tipo: 'ferramenta', mensagem: 'Atualizando o yt-dlp…', fracao: -1 })
  try {
    await rodarSimples(ytdlp, ['-U'], 120_000)
  } catch {
    // sem internet ou GitHub fora: segue com a versao atual
  }
  await writeFile(marca, String(Date.now()))
}

function argsComuns(deno: string): string[] {
  const args = ['--ignore-config', '--color', 'never', '--js-runtimes', `deno:${deno}`]
  // `ffmpeg` sozinho = o do PATH, que o yt-dlp acha sem ajuda.
  if (ffmpegPath !== 'ffmpeg') args.push('--ffmpeg-location', ffmpegPath)
  return args
}

/** Roda o yt-dlp linha a linha; volta o codigo e a ultima linha de erro. UTF-8 forcado (titulo com acento). */
function rodar(exe: string, args: string[], aoLer: (linha: string) => void): Promise<{ codigo: number; erro: string }> {
  return new Promise((ok) => {
    const filho = spawn(exe, args, { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } })
    atual = filho
    let erro = ''
    let sobra = ''
    filho.stdout.setEncoding('utf8')
    filho.stdout.on('data', (pedaco: string) => {
      sobra += pedaco
      const linhas = sobra.split(/\r?\n/)
      sobra = linhas.pop() ?? ''
      for (const l of linhas) if (l.trim()) aoLer(l.trim())
    })
    filho.stderr.setEncoding('utf8')
    filho.stderr.on('data', (pedaco: string) => {
      for (const l of pedaco.split(/\r?\n/)) if (/^ERROR:/i.test(l.trim())) erro = l.trim()
    })
    filho.on('error', (e) => {
      erro = e.message
    })
    filho.on('close', (codigo) => {
      if (sobra.trim()) aoLer(sobra.trim())
      atual = null
      ok({ codigo: codigo ?? 1, erro })
    })
  })
}

/** O que tem no link: um video, ou todos os de uma playlist. */
export async function listarLink(url: string, emitir: (e: EventoDoDownload) => void): Promise<{ itens: VideoDoLink[]; erro?: string }> {
  try {
    const { ytdlp, deno } = await ferramentas(emitir)
    const itens: VideoDoLink[] = []
    const r = await rodar(
      ytdlp,
      [...argsComuns(deno), '--no-warnings', '--flat-playlist', '--no-playlist', '--print', '%(.{id,title,webpage_url,url,duration})j', url],
      (linha) => {
        try {
          const v = JSON.parse(linha) as Record<string, unknown>
          itens.push({
            id: String(v['id'] ?? ''),
            titulo: String(v['title'] ?? v['id'] ?? 'Vídeo'),
            url: String(v['webpage_url'] ?? '') || String(v['url'] ?? ''),
            duracao: Number(v['duration'] ?? 0) || 0,
          })
        } catch {
          // linha que nao e do nosso --print: fica de fora
        }
      },
    )
    if (itens.length === 0) return { itens, erro: explicarErroDoDownload(r.erro || 'Nenhum vídeo nesse link.') }
    return { itens }
  } catch (e) {
    return { itens: [], erro: e instanceof Error ? e.message : String(e) }
  }
}

/** Baixa um video (o MP4 vai para a "Baixados" do anime, ao lado do B-roll que sai dele). */
export async function baixarLink(pedido: PedidoDeDownload, emitir: (e: EventoDoDownload) => void): Promise<VideoBaixado | { erro: string }> {
  if (atual) return { erro: 'Já tem um download em andamento.' }
  cancelado = false
  try {
    const { ytdlp, deno } = await ferramentas(emitir)
    await mkdir(pedido.pasta, { recursive: true })
    const args = [
      ...argsComuns(deno),
      '--no-warnings',
      '--no-playlist',
      '--newline',
      '--progress',
      '--progress-template',
      'download:DANGAI-P %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      '--print',
      'before_dl:DANGAI-I %(.{id,title,webpage_url})j',
      '--print',
      'after_move:DANGAI-F %(filepath)j',
      // `--print` sozinho so simularia.
      '--no-simulate',
      '-f',
      'bv*+ba/b',
      '-S',
      ordemDeQualidade(pedido.qualidade),
      '--merge-output-format',
      'mp4',
      '-P',
      pedido.pasta,
      '-o',
      '%(title).120B [%(id)s].%(ext)s',
      '--windows-filenames',
      '--no-mtime',
      pedido.url,
    ]
    let titulo = ''
    let origem = pedido.url
    let arquivo = ''
    let parte = 0
    let ultimo = 0
    const r = await rodar(ytdlp, args, (linha) => {
      if (linha.startsWith('DANGAI-I ')) {
        try {
          const v = JSON.parse(linha.slice(9)) as Record<string, unknown>
          titulo = String(v['title'] ?? '')
          origem = String(v['webpage_url'] ?? '') || origem
        } catch {
          /* segue sem o titulo: cai no nome do arquivo */
        }
      } else if (linha.startsWith('DANGAI-F ')) {
        try {
          arquivo = String(JSON.parse(linha.slice(9)))
        } catch {
          arquivo = linha.slice(9).replace(/^"|"$/g, '')
        }
      } else if (linha.startsWith('DANGAI-P ')) {
        const [pct, vel, falta] = linha.slice(9).split('|')
        const f = Number.parseFloat(pct ?? '') / 100
        if (!Number.isFinite(f)) {
          emitir({ tipo: 'progresso', fracao: -1, velocidade: (vel ?? '').trim(), falta: '', fase: 'video' })
          return
        }
        // Video e audio vem separados, cada um de 0 a 100%: quando a porcentagem despenca, comecou o segundo.
        if (f < ultimo - 0.3) parte += 1
        ultimo = f
        const fracao = parte === 0 ? f * 0.9 : 0.9 + f * 0.1
        const fase = f >= 0.999 && parte >= 1 ? 'juntando' : parte === 0 ? 'video' : 'audio'
        emitir({ tipo: 'progresso', fracao, velocidade: (vel ?? '').trim(), falta: (falta ?? '').trim(), fase })
      }
    })
    if (cancelado) return { erro: 'Cancelado.' }
    if (r.codigo !== 0 || !arquivo) return { erro: explicarErroDoDownload(r.erro) }
    return { arquivo, titulo: titulo || tituloDoArquivoBaixado(arquivo), origem }
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) }
  }
}

/** Para o download (o yt-dlp abre ffmpeg por baixo: vai a arvore inteira). */
export function cancelarDownload(): void {
  const filho = atual
  if (!filho?.pid) return
  cancelado = true
  execFile('taskkill', ['/PID', String(filho.pid), '/T', '/F'], { windowsHide: true }, () => {})
}
