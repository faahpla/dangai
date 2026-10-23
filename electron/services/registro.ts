import { createWriteStream, mkdirSync, readFileSync, renameSync, statSync, type WriteStream } from 'node:fs'
import { cpus, freemem, homedir, release, totalmem } from 'node:os'
import { join } from 'node:path'
import { format } from 'node:util'

/**
 * O REGISTRO DO APP e o "Copiar relatorio".
 *
 * Quando algo quebrava no PC do ajk, a unica pista era um print -- e o print
 * mostra o recado, nao o que veio antes dele. Agora tudo o que o processo
 * principal e a janela escrevem no console vai tambem para
 * `<userData>/logs/dangai.log`, e o relatorio junta as ultimas linhas com a
 * versao, a maquina e o que estava na tela, pronto para colar no Discord.
 *
 * Nada aqui pode derrubar o app: sem conseguir escrever, o registro so para.
 * Este arquivo nao importa o Electron -- o main entrega a versao e o resto.
 */

/** Passou disto, o registro de agora vira o "anterior" na proxima abertura. */
const LIMITE_DO_ARQUIVO = 2 * 1024 * 1024
/** Uma entrada gigante (o stderr inteiro de um ffmpeg) nao empurra o resto do relatorio. */
const LIMITE_DA_ENTRADA = 6000
const LINHAS_NO_RELATORIO = 300

let arquivo: string | null = null
let anterior: string | null = null
let saida: WriteStream | null = null
let consoleLigado = false

export function iniciarRegistro(userDataDir: string, versao: string): void {
  saida?.end()
  try {
    const pasta = join(userDataDir, 'logs')
    mkdirSync(pasta, { recursive: true })
    arquivo = join(pasta, 'dangai.log')
    anterior = join(pasta, 'dangai-anterior.log')
    try {
      if (statSync(arquivo).size > LIMITE_DO_ARQUIVO) renameSync(arquivo, anterior)
    } catch {
      /* primeira vez: ainda nao ha arquivo */
    }
    saida = createWriteStream(arquivo, { flags: 'a' })
    saida.on('error', () => {
      saida = null
    })
  } catch {
    saida = null
    return
  }
  escrever('-----', `Dangai ${versao} aberto em ${new Date().toISOString()}`)

  if (consoleLigado) return
  consoleLigado = true
  for (const nivel of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[nivel].bind(console)
    console[nivel] = (...args: unknown[]) => {
      original(...args)
      escrever(nivel, format(...args))
    }
  }
}

/** Fecha o arquivo (o console continua indo para o terminal). */
export function encerrarRegistro(): void {
  saida?.end()
  saida = null
}

/** Uma linha de fora do console do main (a janela, um processo que morreu). */
export function registrar(nivel: string, texto: string): void {
  escrever(nivel, texto)
}

function escrever(nivel: string, texto: string): void {
  if (!saida) return
  const corpo =
    texto.length > LIMITE_DA_ENTRADA
      ? `${texto.slice(0, LIMITE_DA_ENTRADA / 2)}\n[... ${texto.length - LIMITE_DA_ENTRADA} caracteres ...]\n${texto.slice(-LIMITE_DA_ENTRADA / 2)}`
      : texto
  saida.write(`${new Date().toTimeString().slice(0, 8)} ${nivel.padEnd(5)} ${corpo}\n`)
}

export interface DadosDoRelatorio {
  versao: string
  /** Os modulos ligados nas configuracoes. */
  modulos: readonly string[]
  /** O que importa das configuracoes (nunca as chaves). */
  configuracoes: Record<string, string>
  /** O que a janela mandou: o erro na tela, o que estava fazendo, o projeto. */
  tela: Record<string, string>
}

/** O texto para colar no Discord. Sem chave de API e sem o nome do usuario do Windows. */
export function montarRelatorio(dados: DadosDoRelatorio): string {
  const nucleos = cpus()
  const gb = (bytes: number): string => `${Math.round(bytes / 1024 ** 3)} GB`
  const partes = [
    'RELATÓRIO DO DANGAI',
    `versão: ${dados.versao}`,
    `quando: ${new Date().toLocaleString('pt-BR')}`,
    `sistema: ${process.platform} ${release()}, ${nucleos.length} nucleos (${nucleos[0]?.model.trim() ?? '?'}), ${gb(totalmem())} de RAM (${gb(freemem())} livres)`,
    `módulos ligados: ${dados.modulos.length > 0 ? dados.modulos.join(', ') : 'nenhum'}`,
    ...Object.entries(dados.configuracoes).map(([k, v]) => `${k}: ${v}`),
    '',
    '--- na tela',
    ...Object.entries(dados.tela).map(([k, v]) => `${k}: ${v}`),
    '',
    `--- o que o app registrou (últimas ${LINHAS_NO_RELATORIO} linhas)`,
    ultimasLinhas(LINHAS_NO_RELATORIO),
  ]
  return limpar(partes.join('\n'))
}

/** As ultimas linhas do registro; faltando, completa com o fim do anterior. */
function ultimasLinhas(quantas: number): string {
  const ler = (caminho: string | null): string[] => {
    if (!caminho) return []
    try {
      return readFileSync(caminho, 'utf8').split('\n').filter((l) => l.length > 0)
    } catch {
      return []
    }
  }
  const agora = ler(arquivo)
  const antes = agora.length < quantas ? ler(anterior).slice(-(quantas - agora.length)) : []
  const linhas = [...antes, ...agora].slice(-quantas)
  return linhas.length > 0 ? linhas.join('\n') : '(registro vazio)'
}

/**
 * Tira do relatorio o que nao e da conta de ninguem: as chaves de API (Gemini,
 * Anthropic, ElevenLabs, Fish) e a pasta do usuario do Windows, que leva o nome
 * dele. Exportado para o teste.
 */
export function limpar(texto: string, casa = homedir()): string {
  let limpo = texto
  for (const forma of new Set([casa, casa.replace(/\\/g, '/'), casa.replace(/\//g, '\\')])) {
    if (forma.length < 4) continue
    limpo = limpo.replace(new RegExp(forma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '~')
  }
  return limpo
    .replace(/AIza[0-9A-Za-z_-]{30,}/g, '[chave]')
    .replace(/sk-ant-[0-9A-Za-z_-]{10,}/g, '[chave]')
    .replace(/sk[-_][0-9A-Za-z]{20,}/g, '[chave]')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[chave]')
    .replace(/((?:api[_-]?key|key|token|authorization|bearer|xi-api-key)["']?\s*[:=]?\s*["']?)[0-9A-Za-z._-]{16,}/gi, '$1[chave]')
}
