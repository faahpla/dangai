import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LibraryClip, SceneDescription } from '@shared/channels'

/**
 * O que a cena MOSTRA, em portugues: emocao, acao, cenario e tipo de plano.
 *
 * Por que um modelo de visao e nao o etiquetador: medido no acervo dele, o
 * WD-Tagger e o Qwen3-VL acertam o mesmo tanto em NOME DE PERSONAGEM (27% cada,
 * em 300 cenas), e nenhum dos dois serve para isso. Mas o roteiro dele nao fala
 * "aqui aparece o Rimuru" -- fala "a batalha", "a cidade em ruinas", "ele se
 * lembra". Emocao e acao casam com isso; nome proprio nao casaria.
 *
 * Personagem continua vindo do AnCut, que e a etiquetagem dele mesmo.
 */

/** Sobe quando o formato muda ou o prompt muda o bastante para invalidar o que ja foi lido. */
const CACHE_VERSION = 1

const OLLAMA = 'http://127.0.0.1:11434'
const MODELO = 'qwen3-vl:8b-instruct-q4_K_M'

/**
 * Uma cena por vez.
 *
 * O Ollama enfileira as chamadas de qualquer jeito -- mandar em paralelo nao
 * acelera e so aumenta a chance de estourar a memoria da placa no meio de um
 * lote de horas.
 */
const TENTATIVAS = 2

/** Medido: ~8% das cenas voltam vazias na primeira tentativa e acertam na segunda. */
const VAZIA = { emocao: '', acao: '', cenario: '', plano: '' }

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

function caminhoCache(): string {
  if (!baseDir) throw new Error('Descritor nao configurado')
  return join(baseDir, 'descricoes.json')
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
export async function describeReady(): Promise<{ ok: boolean; motivo: string | null }> {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return { ok: false, motivo: 'O Ollama respondeu com erro.' }
    const j = (await r.json()) as { models?: { name: string }[] }
    const tem = (j.models ?? []).some((m) => m.name === MODELO)
    return tem
      ? { ok: true, motivo: null }
      : { ok: false, motivo: `O modelo ${MODELO} nao esta baixado. Rode: ollama pull ${MODELO}` }
  } catch {
    return { ok: false, motivo: 'O Ollama nao esta rodando. Abra o Ollama e tente de novo.' }
  }
}

/*
 * Uma palavra por campo, e em portugues.
 *
 * Em portugues porque o roteiro dele e em portugues: casar "raiva" com "raiva"
 * dispensa a tabela de traducao que as etiquetas em ingles exigiram. E curto
 * porque o que vai casar com o roteiro e a palavra, nao a frase.
 */
const PERGUNTA = `Voce analisa um quadro de anime para um editor de video.
Responda SO com JSON, sem texto em volta: {"emocao":"","acao":"","cenario":"","plano":""}
- emocao: o sentimento dominante, UMA palavra em portugues.
- acao: o que acontece, ate 3 palavras em portugues.
- cenario: onde se passa, ate 3 palavras em portugues.
- plano: close, medio, aberto ou detalhe.`

function limpar(cru: unknown): SceneDescription | null {
  if (typeof cru !== 'object' || cru === null) return null
  const o = cru as Record<string, unknown>
  const campo = (nome: string): string =>
    typeof o[nome] === 'string' ? (o[nome] as string).toLowerCase().trim().slice(0, 60) : ''
  /*
   * O modelo alterna "meio" e "medio" para a mesma coisa, mesmo com o prompt
   * pedindo "medio" -- medido, 9 e 8 vezes em 100 cenas. Duas grafias para um
   * conceito so viraria dois filtros na interface.
   */
  const plano = campo('plano')
  const saida = {
    emocao: campo('emocao'),
    acao: campo('acao'),
    cenario: campo('cenario'),
    plano: plano === 'meio' ? 'medio' : plano,
  }
  // Resposta que nao diz nada e falha, nao resultado: vale outra tentativa.
  return saida.emocao || saida.acao || saida.cenario ? saida : null
}

async function lerCena(keyframe: string): Promise<SceneDescription | null> {
  const b64 = readFileSync(keyframe).toString('base64')
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
          // temperatura 0: a mesma cena tem que dar a mesma palavra sempre, ou
          // reetiquetar o acervo mudaria a montagem sem ninguem ter pedido.
          options: { temperature: 0 },
        }),
      })
      if (!r.ok) continue
      const j = (await r.json()) as { response?: string }
      const bloco = /\{[\s\S]*\}/.exec(j.response ?? '')
      if (!bloco) continue
      const limpo = limpar(JSON.parse(bloco[0]))
      if (limpo) return limpo
    } catch {
      // Rede caiu, JSON veio quebrado, modelo devolveu prosa: tenta de novo e,
      // se insistir, a cena fica sem descricao e a proxima passada retoma.
    }
  }
  return null
}

/**
 * Le as cenas que ainda nao foram lidas.
 *
 * Incremental pelo mesmo motivo do etiquetador, e aqui pesa muito mais: sao
 * ~4,7s por cena, entao o acervo inteiro dele (19.495 cenas) leva ~25 horas.
 * Passar a lista de UM anime por vez e o uso esperado -- um episodio sai em
 * meia hora e ja da para trabalhar nele no mesmo dia.
 */
export async function describeClips(
  clips: readonly LibraryClip[],
  onProgress: DescribeProgress,
): Promise<Record<string, SceneDescription>> {
  const pronto = await describeReady()
  if (!pronto.ok) throw new Error(pronto.motivo ?? 'O leitor de cenas nao esta disponivel.')

  const descriptions = readDescriptions()
  const faltando = clips.filter((c) => !descriptions[c.id] && c.keyframe && existsSync(c.keyframe))
  if (faltando.length === 0) return descriptions

  const t0 = Date.now()
  let feitas = 0
  let vazias = 0

  for (const clip of faltando) {
    const lida = await lerCena(clip.keyframe)
    if (lida) descriptions[clip.id] = lida
    else {
      vazias++
      // Marca a cena como vista para ela nao ser tentada de novo a cada
      // passada; uma versao nova do cache limpa isso.
      descriptions[clip.id] = { ...VAZIA }
    }

    feitas++
    if (feitas % 10 === 0 || feitas === faltando.length) {
      const restam = faltando.length - feitas
      const porCena = (Date.now() - t0) / feitas
      const minutos = Math.ceil((restam * porCena) / 60000)
      onProgress(
        `Lendo ${feitas} de ${faltando.length} cenas` +
          (restam > 0 && minutos > 0 ? ` · faltam ~${minutos} min` : ''),
      )
    }
    // Gravar de tempos em tempos: fechar o app no meio de horas de leitura nao
    // pode jogar fora o que ja foi lido.
    if (feitas % 50 === 0) gravarCache(descriptions)
  }

  gravarCache(descriptions)
  const minutos = ((Date.now() - t0) / 60000).toFixed(0)
  onProgress(
    `${faltando.length} cenas lidas em ${minutos} min` + (vazias > 0 ? ` · ${vazias} sem resposta` : '') + '.',
  )
  return descriptions
}
