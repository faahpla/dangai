import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { cosseno, notasDeDestaque, textoDaCena } from '@shared/visao'
import { describeReady, noPerfil, OLLAMA, readDescriptions } from './describe'

/**
 * Compara o que as cenas mostram com o que o roteiro diz (ver shared/visao.ts).
 *
 * Um modelo de vetores pequeno no Ollama: ~640 MB, multilingue, e de graca.
 * Sem ele as cenas lidas ainda contam pelas palavras (shared/selection.ts) --
 * so nao acham "casamento" a partir de "se casaram".
 */
export const COMPARADOR = 'qwen3-embedding:0.6b'

/**
 * O Qwen3-Embedding pede a tarefa escrita na CONSULTA (e so nela), em ingles
 * mesmo com o texto em portugues -- e como ele foi treinado.
 */
export const INSTRUCAO =
  'Instruct: Given a sentence from an anime recap narration, retrieve the description of the anime frame that best illustrates it\nQuery: '

/** Quantos textos por chamada. O modelo e pequeno; lote grande so economiza ida e volta. */
const LOTE = 64

/** Sobe quando o modelo ou o jeito de guardar muda: vetor de outro modelo nao compara. */
const VERSAO = 1

interface Arquivo {
  versao: number
  modelo: string
  /** resumo do texto da cena -> vetor em base64 (Int8, ver `encolher`). */
  vetores: Record<string, string>
}

/**
 * O vetor de cada texto de cena, pelo resumo do TEXTO e nao pelo id: cena
 * relida com frase nova ganha vetor novo sozinha.
 *
 * Guardado no disco porque refazer custa: ~47 cenas por segundo, entao os
 * episodios de um B-roll (~2.700 cenas) levariam um minuto a cada abertura.
 */
let vetores: Map<string, Int8Array> | null = null

const resumo = (texto: string): string => createHash('sha1').update(texto).digest('base64url').slice(0, 16)

function carregar(): Map<string, Int8Array> {
  if (vetores) return vetores
  vetores = new Map()
  try {
    const a = JSON.parse(readFileSync(noPerfil('descricoes-vetores.json'), 'utf8')) as Arquivo
    if (a.versao === VERSAO && a.modelo === COMPARADOR) {
      for (const [k, v] of Object.entries(a.vetores)) vetores.set(k, new Int8Array(Buffer.from(v, 'base64')))
    }
  } catch {
    // Sem arquivo ainda, ou corrompido: os vetores sao refeitos.
  }
  return vetores
}

function gravar(mapa: Map<string, Int8Array>): void {
  const alvo = noPerfil('descricoes-vetores.json')
  mkdirSync(dirname(alvo), { recursive: true })
  const a: Arquivo = { versao: VERSAO, modelo: COMPARADOR, vetores: {} }
  for (const [k, v] of mapa) a.vetores[k] = Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64')
  const temp = `${alvo}.tmp`
  writeFileSync(temp, JSON.stringify(a), 'utf8')
  renameSync(temp, alvo)
}

/**
 * Cada numero do vetor em um byte (-127 a 127).
 *
 * O cosseno nao liga para a escala do vetor, so para a direcao -- e medido nas
 * 26 frases do Bleach, a ordem das sugestoes saiu identica a do vetor inteiro.
 * Um quarto do tamanho no disco: ~1,4 KB por cena.
 */
function encolher(v: readonly number[]): Int8Array {
  let maior = 0
  for (const x of v) maior = Math.max(maior, Math.abs(x))
  return Int8Array.from(v, (x) => (maior === 0 ? 0 : Math.round((x / maior) * 127)))
}

async function vetorizar(textos: readonly string[]): Promise<number[][]> {
  const saida: number[][] = []
  for (let k = 0; k < textos.length; k += LOTE) {
    const r = await fetch(`${OLLAMA}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: COMPARADOR, input: textos.slice(k, k + LOTE) }),
    })
    if (!r.ok) throw new Error(`O comparador de cenas respondeu com erro (${r.status}).`)
    const j = (await r.json()) as { embeddings?: number[][] }
    saida.push(...(j.embeddings ?? []))
  }
  if (saida.length !== textos.length) throw new Error('O comparador de cenas devolveu menos vetores que o pedido.')
  return saida
}

/**
 * Para cada consulta, as cenas (entre `ids`) que se destacam: id -> nota.
 *
 * Sem o comparador no Ollama, sai vazio para cada consulta -- a escolha segue
 * pelo que ja fazia, e nao trava nada.
 */
export async function compararCenas(
  consultas: readonly string[],
  ids: readonly string[],
): Promise<Record<string, number>[]> {
  const vazio = consultas.map(() => ({}))
  if (consultas.length === 0 || ids.length === 0) return vazio
  if (!(await describeReady(COMPARADOR)).ok) return vazio

  const descricoes = readDescriptions()
  const cenas: { id: string; chave: string; texto: string }[] = []
  for (const id of ids) {
    const d = descricoes[id]
    if (!d?.cena) continue
    const texto = textoDaCena(d)
    cenas.push({ id, chave: resumo(texto), texto })
  }
  if (cenas.length === 0) return vazio

  const mapa = carregar()
  const faltam = [...new Map(cenas.filter((c) => !mapa.has(c.chave)).map((c) => [c.chave, c.texto]))]
  if (faltam.length > 0) {
    const novos = await vetorizar(faltam.map(([, texto]) => texto))
    faltam.forEach(([chave], k) => mapa.set(chave, encolher(novos[k]!)))
    gravar(mapa)
  }

  const qs = await vetorizar(consultas.map((c) => INSTRUCAO + c))
  return qs.map((q) => {
    const semelhancas = new Map<string, number>()
    for (const c of cenas) semelhancas.set(c.id, cosseno(q, mapa.get(c.chave)!))
    return notasDeDestaque(semelhancas)
  })
}
