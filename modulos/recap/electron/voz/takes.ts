import { existsSync } from 'node:fs'
import { roteiroAtual, type RascunhoDoRecap } from '../../shared/roteiro'
import {
  desmarcarVozAprovada,
  escolherTake,
  estadoDaVoz,
  marcarVozAprovada,
  type AudioDoTake,
} from '../../shared/voz'
import { analyzeAudio } from '../audio'
import { gravarRascunho, lerRascunhoDoDisco } from '../gerar/rascunho'
import { arquivoDaVoz } from './pastas'

/**
 * As mudancas de voz que nao fazem audio: escolher um take, aprovar, tirar a
 * aprovacao, e publicar o WAV de um take para a tela tocar.
 *
 * Mesma regra do rascunho.ts: ler -> aplicar (funcao pura de shared/voz.ts)
 * -> gravar, sem await no meio, e devolver o rascunho inteiro.
 */

function agora(): string {
  return new Date().toISOString()
}

/** "Voltar para este take". */
export async function escolherTakeDoRascunho(rascunhoId: string, takeId: string): Promise<RascunhoDoRecap> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const novo = escolherTake(r, takeId, agora())
  if (novo !== r) gravarRascunho(novo)
  return novo
}

/** "Aprovar voz": precisa do roteiro aprovado e da voz em dia com ele. */
export async function aprovarVoz(rascunhoId: string): Promise<RascunhoDoRecap> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const aprovado = marcarVozAprovada(r, roteiroAtual(r), agora())
  gravarRascunho(aprovado)
  return aprovado
}

export async function desaprovarVoz(rascunhoId: string): Promise<RascunhoDoRecap> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const desfeito = desmarcarVozAprovada(r, agora())
  if (desfeito !== r) gravarRascunho(desfeito)
  return desfeito
}

/**
 * O WAV do take no servidor de midia local, com a onda (analyzeAudio, como o
 * Dangai faz com a narracao). A duracao e a do take, que e exata (a do
 * analyzeAudio e contada a 8 kHz).
 */
export async function audioDoTake(rascunhoId: string, takeId: string): Promise<AudioDoTake> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const take = estadoDaVoz(r).takes.find((t) => t.id === takeId)
  if (!take) throw new Error('Esse take nao existe mais.')
  const caminho = arquivoDaVoz(rascunhoId, take.arquivo)
  if (!existsSync(caminho)) throw new Error('O audio deste take sumiu do disco. Gere de novo.')
  const analise = await analyzeAudio(caminho)
  return { takeId, url: analise.url, duracao: take.duracao, peaks: analise.peaks, rms: analise.rms ?? [] }
}
