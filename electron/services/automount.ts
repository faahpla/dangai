import type { Transcript } from '@shared/contract'
import type {
  AutomountRequest,
  AutomountResult,
  AutomountBlock,
  ScriptBlocksResult,
} from '@shared/channels'
import { buildScriptIndex, readScript, toPieces, toSentences } from '@shared/script-reader'
import { selectClips } from '@shared/selection'
import { applyScript, transcriptOnly } from './transcribe'
import { readNicknames } from './nicknames'
import { readDescriptions } from './describe'
import { scanLibrary } from './library'
import { vocabulario, vocabularioDaBiblioteca } from './vocabulario'
import { getSettings } from './settings'

/**
 * Montar o video sozinho: narracao entra, clipes escolhidos saem.
 *
 * A cadeia inteira, e nenhum degrau usa modelo de linguagem:
 *
 *   1. transcrever a narracao (o mesmo Whisper de sempre)
 *   2. juntar os segmentos em FRASES, porque o Whisper corta por respiro
 *   3. dizer quem esta em cada frase -- nome escrito, apelido, arrasto
 *   4. casar cada frase com um clipe da biblioteca
 *
 * Medido nos dois roteiros reais dele: 17/17 blocos no de teoria e 21/21 no de
 * recap, sem repetir clipe e sem nunca por um personagem que a frase nao cita.
 *
 * O que sai daqui e uma PROPOSTA com fita de candidatos, nao um veredito. O
 * ultimo degrau -- aplicar -- acontece no renderer, pela mesma porta do arraste.
 */
export async function automount(
  request: AutomountRequest,
  /** Publica o keyframe no servidor local. Vem de fora, como na varredura. */
  publishThumb: (absolutePath: string) => string,
  onProgress: (message: string) => void,
): Promise<AutomountResult> {
  const { libraryDir } = getSettings()
  if (!libraryDir) {
    throw new Error('Escolha a pasta das cenas nas configuracoes antes de montar sozinho.')
  }

  onProgress('Lendo a biblioteca...')
  const library = await scanLibrary(libraryDir, publishThumb, onProgress)

  onProgress('Ouvindo a narracao...')
  const { transcript, scriptNote } = await transcriptOnly(
    request.audioPath,
    request.subtitlePath,
    request.script,
    vocabulario(library, request.series),
    onProgress,
  )
  if (!transcript || transcript.segments.length === 0) {
    throw new Error(
      'Nao deu para ouvir a narracao. Sem o texto nao ha como saber quem esta em cada frase.',
    )
  }

  onProgress('Lendo o roteiro...')
  /*
   * Os apelidos de TODAS as series entram juntos.
   *
   * Cabe porque nome de personagem nao colide entre as series dele -- medido:
   * 96 personagens em 7 series, zero palavra repetida. E o que dispensa um
   * seletor de serie antes de montar.
   */
  const apelidos = Object.values(readNicknames()).flat()
  const index = buildScriptIndex(library.characters, apelidos)

  const frases = toSentences(transcript.words)
  const lidas = readScript(
    frases.map((f) => f.text),
    index,
  )
  const linhas = lidas.map((linha, i) => ({
    ...linha,
    text: frases[i]!.text,
    start: frases[i]!.start,
    end: frases[i]!.end,
  }))

  onProgress('Escolhendo as cenas...')
  const blocos = selectClips(linhas, library.clips, {
    mode: request.mode,
    series: request.series ? [request.series] : undefined,
    /*
     * O que ja foi lido das cenas. Vazio antes da primeira leitura, e ai a
     * escolha continua sendo a de antes -- ligar o leitor e escolha dele, nao
     * um pedagio antes do primeiro video.
     */
    descriptions: readDescriptions(),
  })

  const saida: AutomountBlock[] = blocos.map((b) => ({
    start: b.start,
    end: b.end,
    text: b.text,
    characters: b.characters,
    candidates: b.candidates.map((c) => ({
      path: c.clip.path,
      thumbUrl: c.clip.thumbUrl,
      label: `${c.clip.anime} S${c.clip.season}E${c.clip.episode} #${c.clip.shot}`,
      durationSec: c.clip.duration,
      reason: c.reason,
    })),
  }))

  const vazios = saida.filter((b) => b.candidates.length === 0).length

  return {
    blocks: saida,
    transcript,
    scriptNote,
    /*
     * Bloco sem clipe nao e defeito: o roteiro dele cita "o pai" e "a mae" do
     * Ichigo, e nenhum dos dois tem cena identificada na biblioteca. Avisar
     * quantos ficaram e melhor que preencher com qualquer coisa.
     */
    note:
      vazios > 0
        ? `${vazios} ${vazios === 1 ? 'bloco ficou' : 'blocos ficaram'} sem cena -- a biblioteca nao tem material para ${vazios === 1 ? 'ele' : 'eles'}.`
        : null,
  }
}

/**
 * So as frases da narracao, com tempo. Nenhuma cena escolhida.
 *
 * A montagem automatica quebra a frase no teto de 3 segundos porque ELA precisa
 * decidir sozinha quantos cortes existem. Aqui nao: quem decide e ele, marcando
 * as cenas de cada frase. Por isso a frase chega inteira -- o teto viraria uma
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
    const { transcript, scriptNote } = applyScript(request.script, pronta, onProgress)
    if (transcript && transcript.words.length > 0) {
      return { blocks: toPieces(transcript.words), transcript, scriptNote }
    }
  }

  // O vocabulario e opcional: sem biblioteca apontada, transcreve igual.
  const vocab = await vocabularioDaBiblioteca(publishThumb)

  onProgress('Ouvindo a narracao...')
  const { transcript, scriptNote } = await transcriptOnly(
    request.audioPath,
    request.subtitlePath,
    request.script,
    vocab,
    onProgress,
  )
  if (!transcript || transcript.words.length === 0) {
    throw new Error('Nao deu para ouvir a narracao. Sem o texto nao ha frase para marcar.')
  }

  /*
   * O bloco aqui e o TRECHO entre pontuacoes, e nao a frase.
   *
   * A montagem automatica quebra no teto de 3 segundos porque LA e o app que
   * decide sozinho quantos cortes existem. Aqui quem decide e ele, e a unidade
   * de decisao dele e o trecho: "eu quero ter a possibilidade de selecionar a
   * linha inteira antes de qualquer pontuacao". A frase sobrevive como
   * agrupamento na tela, pelo campo `sentence`.
   */
  return {
    blocks: toPieces(transcript.words),
    transcript,
    scriptNote,
  }
}
