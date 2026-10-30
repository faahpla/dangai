import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  criarEditorNoMain,
  sugestaoDe,
  type AchadoDoMotor,
  type DetectorDoMotor,
} from '../../thumb/electron/editor'
import type { EpisodeIndex, Plano } from '../shared/episodio'
import {
  escolherSugestoes,
  TAGS_DE_EXPRESSAO,
  type CandidatoDaThumb,
  type PedidoDeQuadro,
  type PedidoDeSugestoes,
  type RostoDaThumb,
  type RostosDoQuadro,
  type SugestaoDaThumb,
  type SugestoesDaThumb,
} from '../shared/thumb'
import { normalizarTag } from '../shared/visao'
import { rostoNosInstantes } from './assets'
import { sinaisDoEpisodio } from './cenas/visao'
import { contexto } from './contexto'
import { abrirIndicePorId } from './episodio/abrir-indice'
import { lerRascunhoDoDisco } from './gerar/rascunho'
import { rodarMotorDeRostos } from './montar/rostos-motor'

export { copiarParaOProjeto, quadroRapido, rostosDoMotor, salvarThumb, temUpscale } from '../../thumb/electron/editor'

/**
 * [recap] O GERADOR DE THUMBNAIL da tela "Video pronto", no main. O editor
 * (quadro em cache, rostos, recorte com upscale, salvar) e o em comum do
 * modulo Thumbnail (modulos/thumb/electron/editor.ts); aqui so o que e do
 * recap:
 *
 * - o cache na pasta local DO RECAP (<local>/thumb), como sempre;
 * - os rostos pelo YOLO de anime do motor de personagens (so detectando, um
 *   processo por lote) e, sem ele, o detector antigo do nucleo;
 * - as SUGESTOES pelo indice do episodio: os keyframes das cenas que entraram
 *   no video, com a beleza e a nitidez do passo 4 e as etiquetas de expressao,
 *   o gancho primeiro.
 *
 * O motor de rostos tambem vai para o modulo Thumbnail (index.ts:
 * detectorDoMotor), que nao conhece o recap.
 */

/** Teto do motor por lote (subir o torch custa ~8 s; 60 imagens, ~20 s). */
const TETO_DO_MOTOR_MS = 120_000

/** O motor do recap como detector do editor: so detectar, uma imagem por item, o instante 0. */
export function detectorDoMotor(rodar: typeof rodarMotorDeRostos = rodarMotorDeRostos): DetectorDoMotor {
  return async (imagens) => {
    const itens = imagens.map((arquivo, i) => ({
      chave: `i${i}`,
      arquivo,
      instantes: [0],
      personagens: [],
      candidatos: [],
    }))
    const r = await rodar(itens, { anime: null, temporada: null, identificar: false, aspecto: null }, TETO_DO_MOTOR_MS).catch(() => null)
    if (!r) return null
    const saida = new Map<string, AchadoDoMotor>()
    imagens.forEach((arquivo, i) => {
      const achado = r.resultados.get(`i${i}`)
      if (achado) saida.set(arquivo, achado)
    })
    return saida
  }
}

const editor = criarEditorNoMain({
  pasta: () => join(contexto().pasta('local'), 'thumb'),
  rotulo: '[recap]',
  motor: () => detectorDoMotor(),
  antigo: async (arquivo) => (await rostoNosInstantes(arquivo, [0]))[0] ?? null,
})

export const quadroEmCache = editor.quadroEmCache
export const quadroDaThumb = editor.quadroDaThumb
export const recorteDaThumb = editor.recorteDaThumb

/**
 * Os rostos de varias IMAGENS (arquivos de imagem), pelo cache, pelo motor
 * (um processo para todas) e, no que ele nao respondeu, pelo detector antigo.
 * Nunca lanca: imagem sem resposta fica null.
 */
export function rostosDasImagens(
  imagens: readonly string[],
  rodar: typeof rodarMotorDeRostos = rodarMotorDeRostos,
): Promise<{
  rostos: Map<string, RostoDaThumb[] | null>
  detector: 'motor' | 'antigo' | null
}> {
  return editor.rostosDasImagens(imagens, detectorDoMotor(rodar))
}

export async function rostosDoQuadro(p: PedidoDeQuadro): Promise<RostosDoQuadro> {
  return editor.rostosDoQuadro(p)
}

// ----------------------------------------------------------- as sugestoes

const normal = (c: string): string => c.replace(/\//g, '\\').toLowerCase()

function abrirIndice(p: PedidoDeSugestoes): { indice: EpisodeIndex; caminho: string } | null {
  if (!p.episodioId) return null
  let dica: string | null = null
  if (p.rascunhoId) {
    try {
      dica = lerRascunhoDoDisco(p.rascunhoId).indicePath
    } catch {
      dica = null
    }
  }
  try {
    const a = abrirIndicePorId(p.episodioId, dica)
    return { indice: a.indice, caminho: a.caminho }
  } catch {
    return null
  }
}

/**
 * AS SUGESTOES: os keyframes (25/50/75%) das cenas que entraram no video,
 * com a beleza e a nitidez do passo 4 (visao.json) e as etiquetas de
 * expressao do plano; os rostos de todos num lote so do motor. A escolha e a
 * conta pura (escolherSugestoes): o gancho primeiro, depois close, expressao,
 * nitidez. Cena sem indice (projeto normal, biblioteca sumida): o quadro do
 * meio do trecho mostrado.
 */
export async function sugestoesDaThumb(p: PedidoDeSugestoes, rodar: typeof rodarMotorDeRostos = rodarMotorDeRostos): Promise<SugestoesDaThumb> {
  const aberto = abrirIndice(p)
  const planos = new Map<string, Plano>()
  for (const pl of aberto?.indice.planos ?? []) planos.set(normal(pl.arquivo), pl)
  const sinais = aberto ? sinaisDoEpisodio(aberto.indice, aberto.caminho) : {}

  interface Item {
    cand: CandidatoDaThumb
    /** A imagem para achar o rosto e fazer a miniatura. */
    imagem: string | null
    arquivo: string
    t: number
    rotulo: string
    /** O trecho da cena no arquivo (o "Quadro dentro da cena" anda nele). */
    trecho: { de: number; ate: number }
  }
  const itens = new Map<string, Item>()
  const juntar = (it: Item): void => {
    const ja = itens.get(it.cand.chave)
    if (!ja) {
      itens.set(it.cand.chave, it)
      return
    }
    ja.cand = {
      ...ja.cand,
      gancho: ja.cand.gancho || it.cand.gancho,
      ordem: Math.min(ja.cand.ordem, it.cand.ordem),
      noTrecho: ja.cand.noTrecho || it.cand.noTrecho,
    }
  }
  for (const cena of p.cenas) {
    if (!existsSync(cena.arquivo)) continue
    const plano = planos.get(normal(cena.arquivo))
    const quadros = plano ? (sinais.quadros?.get(plano.id) ?? []) : []
    const tags = plano ? (sinais.tagsDoPlano?.get(plano.id) ?? []) : []
    const expressao = tags.slice(0, 40).some((t) => TAGS_DE_EXPRESSAO.has(normalizarTag(t)))
    if (plano && quadros.length > 0) {
      for (const q of quadros) {
        const t = (plano.inicioNoArquivo ?? 0) + q.pos * Math.max(0, plano.end - plano.start)
        juntar({
          cand: {
            chave: `${plano.id}|${q.k}`,
            plano: plano.id,
            ordem: cena.ordem,
            gancho: cena.gancho,
            rostos: null,
            beleza: q.beleza,
            nitidez: q.nitidez,
            expressao,
            noTrecho: t >= cena.de - 0.05 && t <= cena.ate + 0.05,
          },
          imagem: q.arquivo && existsSync(q.arquivo) ? q.arquivo : null,
          arquivo: cena.arquivo,
          t,
          rotulo: `Cena ${plano.id}`,
          trecho: { de: cena.de, ate: cena.ate },
        })
      }
    } else {
      const t = cena.de + Math.max(0, cena.ate - cena.de) / 2
      const nome = cena.arquivo.split(/[\\/]/).pop() ?? ''
      juntar({
        cand: {
          chave: `${normal(cena.arquivo)}|${t.toFixed(2)}`,
          plano: plano?.id ?? normal(cena.arquivo),
          ordem: cena.ordem,
          gancho: cena.gancho,
          rostos: null,
          beleza: null,
          nitidez: null,
          expressao,
          noTrecho: true,
        },
        imagem: null,
        arquivo: cena.arquivo,
        t,
        rotulo: plano ? `Cena ${plano.id}` : nome.replace(/\.[^.]+$/, ''),
        trecho: { de: cena.de, ate: cena.ate },
      })
    }
  }
  // Sem keyframe no disco: o quadro do proprio video (no cache).
  for (const it of itens.values()) {
    if (it.imagem) continue
    try {
      it.imagem = await quadroEmCache(it.arquivo, it.t)
    } catch {
      it.imagem = null
    }
  }
  const lista = [...itens.values()].filter((it) => it.imagem)
  const achados = await rostosDasImagens(
    lista.map((it) => it.imagem!),
    rodar,
  )
  for (const it of lista) it.cand = { ...it.cand, rostos: achados.rostos.get(it.imagem!) ?? null }
  const escolhidas = escolherSugestoes(lista.map((it) => it.cand))
  const porChave = new Map(lista.map((it) => [it.cand.chave, it]))
  const sugestoes: SugestaoDaThumb[] = []
  for (const e of escolhidas) {
    const it = porChave.get(e.candidato.chave)
    if (!it?.imagem) continue
    try {
      sugestoes.push(await sugestaoDe(it.imagem, it.arquivo, it.t, e.candidato, e.nota, it.rotulo, it.trecho))
    } catch {
      continue
    }
  }
  return { sugestoes, detector: achados.detector }
}
