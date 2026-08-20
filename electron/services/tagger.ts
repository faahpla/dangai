import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import type { LibraryClip } from '@shared/channels'

/**
 * O que APARECE em cada cena, para as 8.201 que nao tem personagem nenhum.
 *
 * O AnCut diz QUEM esta na cena. Ninguem dizia O QUE acontece nela -- e sao
 * dois tercos da biblioteca dele: cenario, plano aberto, detalhe. Sem isso,
 * uma frase como "comprime uma nuvem carregada" nao tinha como achar a cena da
 * nuvem, e a montagem automatica caia num plano generico qualquer.
 *
 * O modelo e o WD-Tagger v3 (SmilingWolf), um classificador de imagem treinado
 * em anime com 10.861 etiquetas. Nao e um modelo de linguagem: ele nao inventa,
 * devolve uma probabilidade por etiqueta.
 *
 * Medido na maquina dele (RTX 3060) antes de existir este arquivo:
 *
 *   DirectML   60ms por imagem  ->  13 minutos pelos 13.063 clipes
 *   CPU       449ms por imagem  ->  98 minutos
 *
 * E dentro do app EMPACOTADO, que era o risco real: sessao DML criada e
 * inferencia em 72ms. O onnxruntime-node do Windows ja traz o DirectML junto,
 * entao nao ha CUDA para instalar nem binario para buscar na primeira execucao.
 */

/** Sobe quando a forma do arquivo muda; o que estiver gravado e descartado. */
const CACHE_VERSION = 1

const MODEL_URL = 'https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/model.onnx'
const TAGS_URL =
  'https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/selected_tags.csv'
const MODEL_MB = 379

/** O lado que o modelo espera. Nao e escolha nossa. */
const LADO = 448

/**
 * Confianca minima para uma etiqueta valer.
 *
 * 0.35 e o valor que o autor do modelo recomenda para as etiquetas gerais.
 * Mais baixo enche a busca de ruido; mais alto perde cenario, que e justamente
 * o que estamos atras.
 */
const LIMITE = 0.35

/**
 * Teto de etiquetas por cena.
 *
 * Um plano cheio de gente pode passar de quarenta acima do limite, quase todas
 * sobre roupa e cor de cabelo. As vinte mais confiantes ja carregam o cenario e
 * a acao, e o arquivo fica em poucos megabytes em vez de dezenas.
 */
const POR_CENA = 20

/**
 * Quantas cenas sao preparadas em paralelo.
 *
 * O gargalo se divide: o sharp roda em thread propria e a inferencia e uma fila
 * so na GPU. Preparar adiantado mantem a placa ocupada em vez de esperar disco.
 */
const PREPARO_PARALELO = 4

type Categoria = number
interface Etiqueta {
  name: string
  category: Categoria
}

interface Arquivo {
  version: number
  /** id da cena -> etiquetas, da mais confiante para a menos. */
  tags: Record<string, string[]>
}

export type TaggerProgress = (mensagem: string) => void

let baseDir: string | null = null

export function configureTagger(userDataDir: string): void {
  baseDir = join(userDataDir, 'tagger')
}

function exigirDir(): string {
  if (!baseDir) throw new Error('Etiquetador nao configurado')
  return baseDir
}

function caminhoModelo(): string {
  return join(exigirDir(), 'wd-vit-tagger-v3.onnx')
}

function caminhoEtiquetas(): string {
  return join(exigirDir(), 'selected_tags.csv')
}

function caminhoCache(): string {
  return join(exigirDir(), '..', 'etiquetas.json')
}

/** O modelo ja esta no disco? */
export function taggerReady(): boolean {
  return existsSync(caminhoModelo()) && existsSync(caminhoEtiquetas())
}

export function readTags(): Record<string, string[]> {
  try {
    const cru: unknown = JSON.parse(readFileSync(caminhoCache(), 'utf8'))
    if (
      typeof cru !== 'object' ||
      cru === null ||
      (cru as Arquivo).version !== CACHE_VERSION ||
      typeof (cru as Arquivo).tags !== 'object'
    ) {
      return {}
    }
    return (cru as Arquivo).tags
  } catch {
    // Sem arquivo ainda, corrompido, ou de uma versao anterior: comeca vazio.
    return {}
  }
}

function gravarCache(tags: Record<string, string[]>): void {
  const alvo = caminhoCache()
  mkdirSync(dirname(alvo), { recursive: true })
  // Temporario e rename: morrer no meio de treze minutos de etiquetagem nao
  // pode deixar um json pela metade no lugar do anterior.
  const temp = alvo + '.tmp'
  writeFileSync(temp, JSON.stringify({ version: CACHE_VERSION, tags } satisfies Arquivo), 'utf8')
  renameSync(temp, alvo)
}

/**
 * Etiqueta as cenas que ainda nao tem etiqueta.
 *
 * Incremental de proposito: o episodio da semana custa segundos, e um episodio
 * novo nunca obriga a refazer os treze minutos do acervo inteiro. Devolve o
 * mapa inteiro, nao so o que mudou -- quem chama quer o estado final.
 */
export async function tagClips(
  clips: readonly LibraryClip[],
  onProgress: TaggerProgress,
): Promise<Record<string, string[]>> {
  await baixarModelo(onProgress)

  const tags = readTags()
  const faltando = clips.filter((c) => !tags[c.id])
  if (faltando.length === 0) return tags

  onProgress(`Preparando o etiquetador...`)
  const etiquetas = lerEtiquetas()
  const ort = await import('onnxruntime-node')
  const sessao = await ort.InferenceSession.create(caminhoModelo(), {
    /*
     * DirectML primeiro, CPU como reserva.
     *
     * A lista e tentada em ordem e o onnxruntime cai para a proxima sozinho, o
     * que importa em maquina sem GPU: 98 minutos e ruim, mas e melhor que um
     * erro. Nao ha CUDA aqui de proposito -- o pacote do Windows nao traz, e
     * exigir instalacao separada seria um pedagio antes do primeiro uso.
     */
    executionProviders: ['dml', 'cpu'],
    graphOptimizationLevel: 'all',
  })

  const entrada = sessao.inputNames[0]!
  const saidaNome = sessao.outputNames[0]!

  let feitas = 0
  let proxima = 0
  const t0 = Date.now()

  const trabalhar = async (): Promise<void> => {
    while (proxima < faltando.length) {
      const clip = faltando[proxima++]!
      try {
        const tensor = await prepararTensor(clip, ort)
        const saida = await sessao.run({ [entrada]: tensor })
        tags[clip.id] = melhores(saida[saidaNome]!.data as Float32Array, etiquetas)
      } catch {
        /*
         * Cena que nao abre nao pode derrubar a etiquetagem inteira. Ela fica
         * sem etiqueta e a proxima passada tenta de novo -- se o problema era o
         * arquivo estar sendo escrito naquele instante, resolve sozinho.
         */
      }

      feitas++
      if (feitas % 25 === 0 || feitas === faltando.length) {
        const restam = faltando.length - feitas
        const porCena = (Date.now() - t0) / feitas
        const minutos = Math.ceil((restam * porCena) / 60000)
        onProgress(
          `Etiquetando ${feitas} de ${faltando.length} cenas` +
            (restam > 0 && minutos > 0 ? ` · faltam ~${minutos} min` : ''),
        )
      }
      // Gravar de tempos em tempos: fechar o app no meio nao joga fora o que
      // ja custou GPU.
      if (feitas % 500 === 0) gravarCache(tags)
    }
  }

  await Promise.all(Array.from({ length: PREPARO_PARALELO }, trabalhar))
  gravarCache(tags)

  const segundos = ((Date.now() - t0) / 1000).toFixed(0)
  onProgress(`${faltando.length} cenas etiquetadas em ${segundos}s.`)
  return tags
}

/**
 * A imagem no formato que o modelo espera: 448x448, BGR, canal por ultimo.
 *
 * O padding e BRANCO e a imagem entra inteira (`contain`), nao esticada: cena
 * de anime e 16:9 e esticar para quadrado deforma rosto e cenario, o que
 * derruba a confianca de tudo.
 *
 * Prefere o keyframe original do AnCut e cai para a miniatura de 320px que o
 * Dangai guarda. Medido, as duas concordam em 84% das etiquetas -- a miniatura
 * as vezes acha MAIS cenario (o encolhimento realca a composicao) e as vezes
 * perde detalhe fino como `cloud`. A reserva existe para o dia em que a
 * biblioteca dele estiver na nuvem: ai so a miniatura local estara a mao.
 */
async function prepararTensor(
  clip: LibraryClip,
  ort: typeof import('onnxruntime-node'),
): Promise<import('onnxruntime-node').Tensor> {
  const fonte = clip.keyframe && existsSync(clip.keyframe) ? clip.keyframe : clip.thumbPath
  const bruto = await sharp(fonte)
    .resize(LADO, LADO, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw()
    .toBuffer()

  const dados = new Float32Array(LADO * LADO * 3)
  for (let i = 0; i < LADO * LADO; i++) {
    dados[i * 3 + 0] = bruto[i * 3 + 2]!
    dados[i * 3 + 1] = bruto[i * 3 + 1]!
    dados[i * 3 + 2] = bruto[i * 3 + 0]!
  }
  return new ort.Tensor('float32', dados, [1, LADO, LADO, 3])
}

/**
 * As etiquetas gerais mais confiantes.
 *
 * So a categoria 0. A 4 e nome de personagem (o AnCut ja resolve isso, e melhor
 * que o modelo) e a 9 e classificacao etaria, que nao serve para achar cena.
 */
function melhores(probs: Float32Array, etiquetas: readonly Etiqueta[]): string[] {
  const achadas: { name: string; p: number }[] = []
  for (let i = 0; i < etiquetas.length; i++) {
    const e = etiquetas[i]!
    const p = probs[i] ?? 0
    if (e.category === 0 && p > LIMITE) achadas.push({ name: e.name, p })
  }
  return achadas
    .sort((a, b) => b.p - a.p)
    .slice(0, POR_CENA)
    .map((t) => t.name.replaceAll('_', ' '))
}

function lerEtiquetas(): Etiqueta[] {
  return readFileSync(caminhoEtiquetas(), 'utf8')
    .split('\n')
    .slice(1)
    .filter((l) => l.trim().length > 0)
    .map((linha) => {
      const [, name, category] = linha.split(',')
      return { name: name ?? '', category: Number(category ?? -1) }
    })
}

async function baixarModelo(onProgress: TaggerProgress): Promise<void> {
  if (taggerReady()) return
  mkdirSync(exigirDir(), { recursive: true })

  if (!existsSync(caminhoEtiquetas())) {
    onProgress('Baixando a lista de etiquetas...')
    await baixar(TAGS_URL, caminhoEtiquetas(), () => {})
  }
  if (!existsSync(caminhoModelo())) {
    await baixar(MODEL_URL, caminhoModelo(), (mb) =>
      onProgress(`Baixando o etiquetador... ${mb}/${MODEL_MB} MB`),
    )
  }
}

/** Mesma receita do download do Whisper: .part e rename so no fim. */
async function baixar(url: string, alvo: string, onMb: (mb: number) => void): Promise<void> {
  const resposta = await fetch(url, { redirect: 'follow' })
  if (!resposta.ok || !resposta.body) {
    throw new Error(`Nao deu para baixar o etiquetador (${resposta.status}).`)
  }

  const parcial = `${alvo}.part`
  let baixado = 0
  let ultimo = 0

  const fonte = Readable.fromWeb(resposta.body as Parameters<typeof Readable.fromWeb>[0])
  fonte.on('data', (pedaco: Buffer) => {
    baixado += pedaco.length
    const mb = Math.floor(baixado / 1_000_000)
    if (mb > ultimo) {
      ultimo = mb
      onMb(mb)
    }
  })

  await pipeline(fonte, createWriteStream(parcial))
  renameSync(parcial, alvo)
}
