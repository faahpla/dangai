import type { Transcript } from '@shared/contract'
import type { ScriptBlocksResult } from '@shared/channels'
import { toPieces } from '@shared/script-reader'
import { applyScript, transcriptOnly } from './transcribe'
import { vocabularioDaBiblioteca } from './vocabulario'

/**
 * So as frases da narracao, com tempo. Nenhuma cena escolhida.
 *
 * Quem decide quantos cortes existem e ele, marcando as cenas de cada frase na
 * Biblioteca. Por isso a frase chega inteira -- um teto de duracao viraria uma
 * escolha tomada por mim antes de ele abrir a tela.
 */
export async function scriptBlocks(
  request: {
    audioPath: string
    subtitlePath: string | null
    script: string | null
    transcript?: Transcript | null
  },
  publishThumb: (absolutePath: string) => string,
  onProgress: (message: string) => void,
): Promise<ScriptBlocksResult> {
  /*
   * A transcricao que a tela ja tem serve inteira.
   *
   * A importacao ouve a narracao e guarda o resultado; ate aqui esta funcao
   * ignorava isso e mandava o Whisper passar DE NOVO pelo mesmo audio, so para
   * chegar ao mesmo texto. Em um minuto e meio de narracao isso eram varios
   * minutos de espera na abertura da Biblioteca.
   *
   * So vale com PALAVRAS medidas: a transcricao que saiu da deteccao de pausas
   * nao tem palavra nenhuma, e e de palavra que sai o trecho.
   */
  const pronta = request.transcript
  if (pronta && pronta.words.length > 0) {
    const { transcript, scriptNote } = await applyScript(request.script, pronta, onProgress, request.audioPath)
    if (transcript && transcript.words.length > 0) {
      return { blocks: toPieces(transcript.words), transcript, scriptNote }
    }
  }

  // O vocabulario e opcional: sem biblioteca apontada, transcreve igual.
  const vocab = await vocabularioDaBiblioteca(publishThumb)

  onProgress('Ouvindo a narração...')
  const { transcript, scriptNote } = await transcriptOnly(
    request.audioPath,
    request.subtitlePath,
    request.script,
    vocab,
    onProgress,
  )
  if (!transcript || transcript.words.length === 0) {
    throw new Error('Não deu para ouvir a narração. Sem o texto não há frase para marcar.')
  }

  /*
   * O bloco aqui e o TRECHO entre pontuacoes, e nao a frase.
   *
   * Quem decide os cortes e ele, e a unidade de decisao dele e o trecho: "eu quero ter a possibilidade de selecionar a
   * linha inteira antes de qualquer pontuacao". A frase sobrevive como
   * agrupamento na tela, pelo campo `sentence`.
   */
  return {
    blocks: toPieces(transcript.words),
    transcript,
    scriptNote,
  }
}
