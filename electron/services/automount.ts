import type {
  AutomountRequest,
  AutomountResult,
  AutomountBlock,
  ScriptBlocksResult,
} from '@shared/channels'
import { buildScriptIndex, readScript, toSentences } from '@shared/script-reader'
import { selectClips } from '@shared/selection'
import { transcriptOnly } from './transcribe'
import { readNicknames } from './nicknames'
import { scanLibrary } from './library'
import { getSettings } from './settings'

/**
 * Quantos personagens entram como dica para o Whisper.
 *
 * O prompt inicial do whisper.cpp cabe em ~224 tokens; a biblioteca dele ja tem
 * 96 personagens, e mandar todos passaria do limite e diluiria os que
 * importam. Os mais filmados sao os que a narracao tem mais chance de citar.
 */
const VOCABULARIO_MAX = 40

/**
 * Os nomes que o Whisper mais erra, entregues antes de ele errar.
 *
 * No caminho manual o vocabulario sai dos NOMES DOS ARQUIVOS que o usuario
 * soltou. Na montagem automatica nao ha arquivo nenhum ainda -- e sem isso o
 * Whisper escreveu "Ischigo", o leitor nao reconheceu ninguem e o bloco caiu no
 * plano generico. Medido no app, com a narracao de teste dele.
 *
 * Quando ele solta o roteiro em .txt isto vira redundante, porque o texto passa
 * a ser o dele, exato. Mas o roteiro e opcional e a dica nao custa nada.
 */
function vocabulario(
  library: { clips: readonly { anime: string; characters: string[] }[] },
  series: string | null,
): string[] {
  const quantos = new Map<string, number>()
  for (const clip of library.clips) {
    // Com a serie escolhida, so os nomes dela viram dica -- 40 vagas gastas com
    // personagem de outro anime sao 40 vagas a menos para o que a narracao cita.
    if (series && clip.anime !== series) continue
    for (const nome of clip.characters) quantos.set(nome, (quantos.get(nome) ?? 0) + 1)
  }
  return [...quantos]
    .sort((a, b) => b[1] - a[1])
    .slice(0, VOCABULARIO_MAX)
    .map(([nome]) => nome)
}

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
  request: { audioPath: string; subtitlePath: string | null; script: string | null },
  publishThumb: (absolutePath: string) => string,
  onProgress: (message: string) => void,
): Promise<ScriptBlocksResult> {
  const { libraryDir } = getSettings()
  // O vocabulario e opcional aqui: sem biblioteca apontada, transcreve igual.
  let vocab: string[] = []
  if (libraryDir) {
    try {
      vocab = vocabulario(await scanLibrary(libraryDir, publishThumb, () => {}), null)
    } catch {
      // Biblioteca ilegivel nao pode impedir de ler o roteiro.
    }
  }

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

  // Sem teto e sem piso: a frase e a unidade, do jeito que ele escreveu.
  return {
    blocks: toSentences(transcript.words, Number.POSITIVE_INFINITY, 0),
    transcript,
    scriptNote,
  }
}
