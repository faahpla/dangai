import { prepararAlinhador, alinhadorPronto, TAMANHO_DO_ALINHADOR_MB } from './alinhador'
import { navegadorDoRenderPronto, prepararNavegadorDoRender, TAMANHO_DO_NAVEGADOR_MB } from './render'
import { getSettings } from './settings'
import { isWhisperReady, prepararWhisper, tamanhoDoWhisperMb } from './whisper'
import type { ComponenteDoDangai, PreparoDoDangai } from '@shared/channels'

/**
 * "PREPARAR O DANGAI": o que ele baixa na primeira vez, baixado ANTES.
 *
 * Quem instala do zero (o ajk) baixava 1,2 GB no meio do primeiro video: o
 * Whisper ao soltar a narracao, o sincronizador de legendas ao abrir a
 * Biblioteca por roteiro, o navegador do render ao renderizar -- cada um
 * parando o trabalho na hora em que aparecia. Agora a tela inicial avisa o que
 * falta e baixa tudo de uma vez, com o mesmo download de sempre (o mesmo .part
 * e a mesma trava de cada servico: pedir junto com uma transcricao nao baixa
 * duas vezes).
 */

export function componentesDoDangai(): ComponenteDoDangai[] {
  const modelo = getSettings().whisperModel
  return [
    {
      id: 'whisper',
      nome: 'Transcrição (Whisper)',
      para: 'ouvir a narração e achar o tempo de cada palavra',
      mb: tamanhoDoWhisperMb(modelo),
      pronto: isWhisperReady(modelo),
    },
    {
      id: 'sincronizador',
      nome: 'Sincronizador de legendas',
      para: 'casar o roteiro com a voz, palavra por palavra',
      mb: TAMANHO_DO_ALINHADOR_MB,
      pronto: alinhadorPronto(),
    },
    {
      id: 'navegador',
      nome: 'Navegador do render',
      para: 'montar o vídeo no Renderizar',
      mb: TAMANHO_DO_NAVEGADOR_MB,
      pronto: navegadorDoRenderPronto(),
    },
  ]
}

/** Baixa o que falta, um de cada vez. Um que falhar nao impede os outros. */
export async function prepararDangai(onProgress: (p: PreparoDoDangai) => void): Promise<ComponenteDoDangai[]> {
  const faltam = componentesDoDangai().filter((c) => !c.pronto)
  for (const [i, c] of faltam.entries()) {
    const avisar = (mensagem: string): void => onProgress({ id: c.id, mensagem, passo: i + 1, de: faltam.length })
    avisar(`Baixando ${c.nome.toLowerCase()}...`)
    try {
      if (c.id === 'whisper') await prepararWhisper(getSettings().whisperModel, avisar)
      else if (c.id === 'sincronizador') await prepararAlinhador(avisar)
      else await prepararNavegadorDoRender(avisar)
    } catch (err) {
      console.warn(`[preparar] ${c.id} nao baixou:`, err)
    }
  }
  return componentesDoDangai()
}
