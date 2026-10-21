import { existsSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { z } from 'zod'
import type { PedidoJson } from '../../../electron/services/llm'
import type { PedidoDeTitulos, PedidoDoPosRender, TextosDoPosRender, TitulosNovos } from '../shared/pos-render'
import { semAcentos, sugestoesDaIa, sugestoesDaVersao, textoDoRoteiro } from '../shared/roteiro'
import { gerarComCache } from './gerar/ia'
import { SEGURANCA_DA_PLATAFORMA, TITULO_E_THUMB } from './gerar/prompts'
import { lerRascunhoDoDisco } from './gerar/rascunho'
import { publish } from './media-server'

/** O que o render do nucleo grava e o <video> toca. */
const VIDEOS = new Set(['.mp4', '.mov', '.webm'])

/**
 * [recap] A TELA POS-RENDER, no main: o video que o render gravou, publicado
 * no servidor local do nucleo (a CSP do renderer ja libera 127.0.0.1), e os
 * titulos e textos de thumb da versao do roteiro de onde o projeto saiu
 * (`sugestoesDaVersao`: a versao editada usa os da versao de origem). So le:
 * nada e gravado no rascunho. Rascunho que sumiu = sem sugestoes, a tela abre
 * mesmo assim.
 */
export function abrirPosRender(pedido: PedidoDoPosRender): TextosDoPosRender {
  // A pasta do projeto mudou de lugar (ou de disco): o video de mesmo nome ao lado do .dangai.
  const aoLado = pedido.projetoPath ? join(dirname(pedido.projetoPath), basename(pedido.outputPath)) : null
  const video = [pedido.outputPath, aoLado].find((c): c is string => c !== null && ehVideo(c)) ?? null
  let sugestoes: ReturnType<typeof sugestoesDaVersao> = null
  if (pedido.rascunhoId && pedido.roteiroVersao) {
    try {
      sugestoes = sugestoesDaVersao(lerRascunhoDoDisco(pedido.rascunhoId), pedido.roteiroVersao)
    } catch {
      sugestoes = null
    }
  }
  return {
    videoUrl: video ? publish(video) : null,
    videoPath: video,
    titulos: [...(sugestoes?.titulos ?? [])],
    thumbs: [...(sugestoes?.thumbs ?? [])],
  }
}

function ehVideo(caminho: string): boolean {
  if (!VIDEOS.has(extname(caminho).toLowerCase())) return false
  try {
    return existsSync(caminho) && statSync(caminho).isFile()
  } catch {
    return false
  }
}

// ------------------------------------------------- "Escrever de novo" (titulos e thumbs)

const respostaDosTitulosSchema = z.object({ titulos: z.array(z.string()), textosDeThumb: z.array(z.string()) })

/**
 * Os 3 titulos e os 3 textos de thumb de novo, num pedido so, pelo ctx.ia do
 * modulo (o gratis, como o roteiro sem escritor pago): as regras do TITULO E
 * THUMB do roteiro e a SEGURANCA DA PLATAFORMA, com os de agora no pedido para
 * vir coisa DIFERENTE. Limpa como os do roteiro (sugestoesDaIa) e tira o que
 * repetiu os de agora. Nao le o cache (e outra tomada). Lanca com o recado curto.
 */
export async function escreverTitulosEThumbs(pedido: PedidoDeTitulos): Promise<TitulosNovos> {
  let rascunho: ReturnType<typeof lerRascunhoDoDisco> | null = null
  if (pedido.rascunhoId) {
    try {
      rascunho = lerRascunhoDoDisco(pedido.rascunhoId)
    } catch {
      rascunho = null
    }
  }
  const versao = rascunho && pedido.roteiroVersao ? rascunho.roteiros.find((v) => v.versao === pedido.roteiroVersao) : undefined
  const roteiro = pedido.roteiro.trim() || (versao ? textoDoRoteiro(versao) : '')
  if (roteiro.length < 40) throw new Error('Sem roteiro no projeto para escrever os titulos.')
  const r = await gerarComCache(promptDosTitulos({ roteiro, anime: rascunho?.titulo ?? null, atuais: pedido.atuais }), { lerCache: false })
  if (!r.ok) throw new Error(recadoCurto(r.nota))
  const limpas = sugestoesDaIa(r.valor)
  const ja = new Set([...pedido.atuais.titulos, ...pedido.atuais.thumbs].map((t) => semAcentos(t)))
  const novos = {
    titulos: (limpas?.titulos ?? []).filter((t) => !ja.has(semAcentos(t))),
    thumbs: (limpas?.thumbs ?? []).filter((t) => !ja.has(semAcentos(t))),
  }
  if (novos.titulos.length === 0 && novos.thumbs.length === 0) throw new Error('A IA nao trouxe nada novo. Tente de novo.')
  return novos
}

/** O pedido (exportado para o teste conferir sem chamar a IA). */
export function promptDosTitulos(d: {
  roteiro: string
  anime: string | null
  atuais: PedidoDeTitulos['atuais']
}): PedidoJson<typeof respostaDosTitulosSchema> {
  const lista = (rotulo: string, itens: readonly string[]): string[] => (itens.length > 0 ? [rotulo, ...itens.map((t) => `- ${t}`)] : [])
  const ja = [...lista('titulos:', d.atuais.titulos), ...lista('textosDeThumb:', d.atuais.thumbs)]
  return {
    schema: respostaDosTitulosSchema,
    etapa: 'titulos-do-video',
    maxTokens: 1024,
    permitirReserva: true,
    sistema: [
      'Voce escreve os titulos e os textos de thumbnail de um short de recap de anime, em portugues do Brasil, para YouTube Shorts e TikTok. O video ja esta pronto: o roteiro abaixo e o que a narracao diz.',
      SEGURANCA_DA_PLATAFORMA,
      TITULO_E_THUMB,
    ].join('\n\n'),
    prompt: [
      ...(d.anime ? [`ANIME: ${d.anime}`, ''] : []),
      'ROTEIRO NARRADO DO VIDEO:',
      d.roteiro,
      ...(ja.length > 0 ? ['', 'JA ESTAO NA TELA (ele quer opcoes DIFERENTES, com outro angulo; nao repita nem reescreva quase igual):', ...ja] : []),
      '',
      'Devolva titulos (3) e textosDeThumb (3).',
    ].join('\n'),
  }
}

/** A nota do llm.ts cabe numa linha da tela: a primeira frase, ate ~160 caracteres. */
function recadoCurto(nota: string): string {
  const linha = nota.replace(/\s+/g, ' ').trim()
  if (!linha) return 'A IA nao respondeu. Tente de novo.'
  if (linha.length <= 160) return linha
  const frase = linha.slice(0, 160).match(/^.*?[.!?](\s|$)/)?.[0]?.trim()
  return frase ?? `${linha.slice(0, 157)}...`
}
