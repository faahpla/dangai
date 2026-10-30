import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { LibraryClip, SceneDescription } from '@shared/channels'
import { duracaoLegivel } from '@shared/visao'
import { ffmpegPath } from './ffmpeg-path'

const execFileP = promisify(execFile)

/**
 * O que a cena MOSTRA, em portugues: uma frase do que acontece, e emocao, acao,
 * cenario e tipo de plano.
 *
 * Por que um modelo de visao e nao o etiquetador: medido no acervo dele, o
 * WD-Tagger e o Qwen3-VL acertam o mesmo tanto em NOME DE PERSONAGEM (27% cada,
 * em 300 cenas), e nenhum dos dois serve para isso. Mas o roteiro dele nao fala
 * "aqui aparece o Rimuru" -- fala "a batalha", "a cidade em ruinas", "ele se
 * lembra". Emocao e acao casam com isso; nome proprio nao casaria.
 *
 * Personagem continua vindo do AnCut, que e a etiquetagem dele mesmo.
 */

/**
 * Sobe quando o formato muda ou o prompt muda o bastante para invalidar o que ja foi lido.
 *
 * 2: a frase da cena (`cena`). E ela que acha "Ryuken entregando a ponta da
 * flecha a Uryu" dentro do episodio -- quatro palavras soltas nao achavam.
 */
const CACHE_VERSION = 2

export const OLLAMA = 'http://127.0.0.1:11434'
export const MODELO = 'qwen3-vl:8b-instruct-q4_K_M'

/**
 * Uma cena por vez.
 *
 * O Ollama enfileira as chamadas de qualquer jeito -- medido de novo em 10/2026,
 * quatro em paralelo levaram o mesmo que quatro em fila. Mandar junto so aumenta
 * a chance de estourar a memoria da placa no meio de um lote de horas.
 */
const TENTATIVAS = 2

/** Medido: ~8% das cenas voltam vazias na primeira tentativa e acertam na segunda. */
const VAZIA: SceneDescription = { cena: '', emocao: '', acao: '', cenario: '', plano: '' }

interface Arquivo {
  version: number
  /** id da cena -> o que ela mostra. */
  descriptions: Record<string, SceneDescription>
}

export type { SceneDescription }

export type DescribeProgress = (mensagem: string) => void

let baseDir: string | null = null

export function configureDescribe(userDataDir: string): void {
  baseDir = userDataDir
}

/** Um arquivo na pasta de dados do Dangai (a do perfil). */
export function noPerfil(nome: string): string {
  if (!baseDir) throw new Error('Descritor não configurado')
  return join(baseDir, nome)
}

function caminhoCache(): string {
  return noPerfil('descricoes.json')
}

export function readDescriptions(): Record<string, SceneDescription> {
  try {
    const cru: unknown = JSON.parse(readFileSync(caminhoCache(), 'utf8'))
    if (
      typeof cru !== 'object' ||
      cru === null ||
      (cru as Arquivo).version !== CACHE_VERSION ||
      typeof (cru as Arquivo).descriptions !== 'object'
    ) {
      return {}
    }
    return (cru as Arquivo).descriptions
  } catch {
    // Sem arquivo ainda, corrompido, ou de versao anterior: comeca vazio.
    return {}
  }
}

function gravarCache(descriptions: Record<string, SceneDescription>): void {
  const alvo = caminhoCache()
  mkdirSync(dirname(alvo), { recursive: true })
  // Temporario e rename: morrer no meio de horas de leitura nao pode deixar um
  // json pela metade no lugar do anterior.
  const temp = `${alvo}.tmp`
  writeFileSync(temp, JSON.stringify({ version: CACHE_VERSION, descriptions } satisfies Arquivo), 'utf8')
  renameSync(temp, alvo)
}

/** O Ollama esta no ar e com o modelo baixado? */
export async function describeReady(modelo: string = MODELO): Promise<{ ok: boolean; motivo: string | null }> {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return { ok: false, motivo: 'O Ollama respondeu com erro.' }
    const j = (await r.json()) as { models?: { name: string }[] }
    const tem = (j.models ?? []).some((m) => m.name === modelo)
    return tem
      ? { ok: true, motivo: null }
      : { ok: false, motivo: `O modelo ${modelo} não está baixado. Rode: ollama pull ${modelo}` }
  } catch {
    return { ok: false, motivo: 'O Ollama não está rodando. Abra o Ollama e tente de novo.' }
  }
}

/*
 * Uma frase e quatro campos curtos, em portugues.
 *
 * Em portugues porque o roteiro dele e em portugues: casar "raiva" com "raiva"
 * dispensa a tabela de traducao que as etiquetas em ingles exigiram.
 *
 * A frase (`cena`) e o que acha a cena CERTA dentro do episodio: o B-roll diz
 * "Ryuken entregando a ponta da flecha a Uryu", e "homem de oculos entrega um
 * objeto pequeno a um rapaz" chega perto disso; "serio / entregando / sala" nao.
 * Aparencia e nao nome: o modelo nao conhece os personagens (27% de acerto em
 * nome, medido), e um nome errado na frase puxaria a cena para a frase errada.
 */
export const PERGUNTA = `Voce descreve um quadro de anime para um editor de video achar a cena certa.
Responda SO com JSON: {"cena":"","emocao":"","acao":"","cenario":"","plano":""}
- cena: UMA frase em portugues, ate 25 palavras, dizendo o que acontece: quem (descreva a aparencia: cabelo, roupa), faz o que, com o que, onde. Se parecer lembranca (cor desbotada, sepia), diga "flashback".
- emocao: o sentimento dominante, UMA palavra em portugues.
- acao: o que acontece, ate 3 palavras em portugues.
- cenario: onde se passa, ate 3 palavras em portugues.
- plano: close, medio, aberto ou detalhe.`

export function limpar(cru: unknown): SceneDescription | null {
  if (typeof cru !== 'object' || cru === null) return null
  const o = cru as Record<string, unknown>
  const campo = (nome: string, teto = 60): string =>
    typeof o[nome] === 'string' ? (o[nome] as string).toLowerCase().trim().slice(0, teto) : ''
  /*
   * O modelo alterna "meio" e "medio" para a mesma coisa, mesmo com o prompt
   * pedindo "medio" -- medido, 9 e 8 vezes em 100 cenas. Duas grafias para um
   * conceito so viraria dois filtros na interface.
   */
  const plano = campo('plano')
  const saida = {
    cena: campo('cena', 240),
    emocao: campo('emocao'),
    acao: campo('acao'),
    cenario: campo('cenario'),
    plano: plano === 'meio' ? 'medio' : plano,
  }
  // Resposta que nao diz nada e falha, nao resultado: vale outra tentativa.
  return saida.cena || saida.emocao || saida.acao || saida.cenario ? saida : null
}

/**
 * O quadro reduzido a 640 de largura, em base64.
 *
 * O keyframe do AnCut e 1080p, e o modelo le a imagem em pedacos: medido, o
 * 1080p vira ~2 mil pedacos e 640 vira ~1 mil -- que e o piso (320 da o mesmo
 * tanto). Cada cena sai ~1,5s mais rapido, sem perder o que acontece nela.
 */
async function quadro(keyframe: string): Promise<string> {
  try {
    const { stdout } = await execFileP(
      ffmpegPath,
      ['-v', 'error', '-i', keyframe, '-vf', 'scale=640:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '4', '-'],
      { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, windowsHide: true },
    )
    if (stdout.length > 0) return stdout.toString('base64')
  } catch {
    // ffmpeg falhou nesta imagem: vai inteira, mais lenta mas lida.
  }
  return readFileSync(keyframe).toString('base64')
}

export async function lerCena(keyframe: string, signal?: AbortSignal): Promise<SceneDescription | null> {
  const b64 = await quadro(keyframe)
  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
    try {
      const r = await fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODELO,
          prompt: PERGUNTA,
          images: [b64],
          stream: false,
          format: 'json',
          // O modelo ocupa ~6 GB da placa. Lendo, as chamadas emendam e ele fica;
          // parou, ele sai logo -- e a placa volta para o DaVinci e o resto.
          keep_alive: '30s',
          // temperatura 0: a mesma cena tem que dar a mesma frase sempre, ou
          // reler o acervo mudaria a montagem sem ninguem ter pedido.
          options: { temperature: 0, num_predict: 200 },
        }),
        signal,
      })
      if (!r.ok) continue
      const j = (await r.json()) as { response?: string }
      const bloco = /\{[\s\S]*\}/.exec(j.response ?? '')
      if (!bloco) continue
      const limpo = limpar(JSON.parse(bloco[0]))
      if (limpo) return limpo
    } catch {
      if (signal?.aborted) return null
      // Rede caiu, JSON veio quebrado, modelo devolveu prosa: tenta de novo e,
      // se insistir, a cena fica sem descricao e a proxima passada retoma.
    }
  }
  return null
}

/** A leitura em andamento, para o "Parar" achar o que parar. */
let emAndamento: AbortController | null = null

/** Para a leitura em andamento. O que ja foi lido fica. */
export function stopDescribe(): void {
  emAndamento?.abort()
}

/**
 * Le as cenas que ainda nao foram lidas.
 *
 * Incremental pelo mesmo motivo do etiquetador, e aqui pesa muito mais: sao
 * ~3,3s por cena, entao o acervo inteiro dele (54 mil cenas) passa de dois
 * dias. O uso esperado e ler POUCO e o que importa: os episodios do B-roll do
 * video de hoje (uns 2.500, umas duas horas), ou um anime de cada vez.
 */
export async function describeClips(
  clips: readonly LibraryClip[],
  onProgress: DescribeProgress,
): Promise<Record<string, SceneDescription>> {
  const pronto = await describeReady()
  if (!pronto.ok) throw new Error(pronto.motivo ?? 'O leitor de cenas não está disponível.')

  const descriptions = readDescriptions()
  const faltando = clips.filter((c) => !descriptions[c.id] && c.keyframe && existsSync(c.keyframe))
  if (faltando.length === 0) return descriptions

  const controle = new AbortController()
  emAndamento = controle
  const t0 = Date.now()
  let feitas = 0
  let vazias = 0

  try {
    for (const clip of faltando) {
      const lida = await lerCena(clip.keyframe, controle.signal)
      if (controle.signal.aborted) break
      if (lida) descriptions[clip.id] = lida
      else {
        vazias++
        // Marca a cena como vista para ela nao ser tentada de novo a cada
        // passada; uma versao nova do cache limpa isso.
        descriptions[clip.id] = { ...VAZIA }
      }

      feitas++
      if (feitas % 5 === 0 || feitas === faltando.length) {
        const restam = faltando.length - feitas
        const porCena = (Date.now() - t0) / feitas
        onProgress(
          `Lendo as cenas: ${feitas.toLocaleString('pt-BR')} de ${faltando.length.toLocaleString('pt-BR')}` +
            (restam > 0 ? ` · faltam ~${duracaoLegivel(restam * porCena)}` : ''),
        )
      }
      // Gravar de tempos em tempos: fechar o app no meio de horas de leitura nao
      // pode jogar fora o que ja foi lido.
      if (feitas % 25 === 0) gravarCache(descriptions)
    }
  } finally {
    if (emAndamento === controle) emAndamento = null
    gravarCache(descriptions)
  }

  if (controle.signal.aborted) {
    onProgress(`Leitura parada: ${feitas.toLocaleString('pt-BR')} cenas lidas. O resto continua de onde parou.`)
  } else {
    onProgress(
      `${faltando.length.toLocaleString('pt-BR')} cenas lidas em ${duracaoLegivel(Date.now() - t0)}` +
        (vazias > 0 ? ` · ${vazias} sem resposta` : '') +
        '.',
    )
  }
  return descriptions
}
