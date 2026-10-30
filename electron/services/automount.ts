import type { Transcript } from '@shared/contract'
import type {
  AutomountRequest,
  AutomountResult,
  AutomountBlock,
  ScriptBlocksResult,
} from '@shared/channels'
import { episodiosQueFaltam, lerBroll, preferenciasDoBroll, resolverTemporadas, rotuloDoItem } from '@shared/broll'
import { buildScriptIndex, readScript, toPieces, toSentences } from '@shared/script-reader'
import { selectClips } from '@shared/selection'
import { consultasDosTrechos } from '@shared/visao'
import { applyScript, transcriptOnly } from './transcribe'
import { readNicknames } from './nicknames'
import { readDescriptions } from './describe'
import { compararCenas } from './visao'
import { escanearRaizes, raizesDaBiblioteca } from './library'
import { vocabulario, vocabularioDaBiblioteca } from './vocabulario'

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
  // A mesma lista da grade: o que aparece no Ctrl+B pode ser escolhido aqui.
  const raizes = raizesDaBiblioteca()
  if (raizes.length === 0) {
    throw new Error('Escolha a pasta das cenas nas configurações antes de montar sozinho.')
  }

  onProgress('Lendo a biblioteca...')
  const library = await escanearRaizes(raizes, publishThumb, onProgress)

  // Transcricao travada (a voz gerada ja trouxe os tempos): so casa o texto.
  const travada = request.transcript && request.transcript.words.length > 0 ? request.transcript : null
  if (!travada) onProgress('Ouvindo a narração...')
  const { transcript, scriptNote } = travada
    ? await applyScript(request.script, { ...travada, alinhado: true }, onProgress, request.audioPath)
    : await transcriptOnly(
        request.audioPath,
        request.subtitlePath,
        request.script,
        vocabulario(library, request.series),
        onProgress,
      )
  if (!transcript || transcript.segments.length === 0) {
    throw new Error(
      'Não deu para ouvir a narração. Sem o texto não há como saber quem está em cada frase.',
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
  const series = request.series ? [request.series] : []
  // "Episodio 4" sem temporada vira o 4 da temporada de quem o B-roll cita.
  const itens = request.broll ? resolverTemporadas(lerBroll(request.broll), library.clips, series, index) : []
  const faltam = episodiosQueFaltam(itens, library.clips, series)
  const descricoes = readDescriptions()
  /*
   * O que as cenas lidas mostram, comparado com cada frase (shared/visao.ts).
   * Sem cena lida ou sem o comparador no Ollama sai vazio, e a escolha e a de antes.
   */
  const cenasLidas = library.clips.filter(
    (c) => descricoes[c.id]?.cena && (series.length === 0 || series.includes(c.anime)),
  )
  if (cenasLidas.length > 0) onProgress('Comparando as cenas lidas com o roteiro...')
  // Comparador com erro nao derruba a montagem: ela so sai como era antes.
  const visao = await compararCenas(
    consultasDosTrechos(linhas),
    cenasLidas.map((c) => c.id),
  ).catch(() => linhas.map(() => ({})))
  const blocos = selectClips(linhas, library.clips, {
    mode: request.mode,
    series: request.series ? [request.series] : undefined,
    /*
     * O que ja foi lido das cenas. Vazio antes da primeira leitura, e ai a
     * escolha continua sendo a de antes -- ligar o leitor e escolha dele, nao
     * um pedagio antes do primeiro video.
     */
    descriptions: descricoes,
    visao,
    // O B-roll casa pela frase INTEIRA: aqui a frase longa ja veio partida no
    // teto de 3s, e a vizinhanca do casamento junta os pedacos de volta.
    broll: preferenciasDoBroll(
      linhas.map((l) => l.text),
      itens,
      index,
    ),
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
      [
        vazios > 0
          ? `${vazios} ${vazios === 1 ? 'bloco ficou' : 'blocos ficaram'} sem cena -- a biblioteca não tem material para ${vazios === 1 ? 'ele' : 'eles'}.`
          : null,
        // O B-roll pediu episodio que o AnCut ainda nao cortou: as cenas daquela
        // parte vieram de outro lugar, e ele precisa saber por que.
        faltam.length > 0
          ? `O B-roll pede ${faltam.length === 1 ? 'um episódio que não está' : 'episódios que não estão'} na Biblioteca: ${faltam.map(rotuloDoItem).join(', ')}. Corte no AnCut para usar.`
          : null,
      ]
        .filter(Boolean)
        .join(' ') || null,
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
