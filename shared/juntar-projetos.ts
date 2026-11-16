import { REGRAS_DA_LEGENDA_PADRAO, sceneSchema, VIDEO_FPS, type CaptionBlock, type RegrasDaLegenda, type Scene, type Word } from './contract'
import { buildCaptions } from './legendas'
import { PROJECT_FILE_VERSION, type FileReference, type ProjectFile } from './project-file'

/**
 * JUNTAR PROJETOS: os videos de ~30 s (Shorts, Reels) viram um de 60 s+ (o
 * TikTok), sem gravar de novo. "Juntar alguns projetos e renderizar de novo"
 * -- o jeito que ele escolheu, e nao colar os MP4 prontos: assim nada e
 * recomprimido duas vezes, a legenda e uma so e da para mexer em tudo antes
 * do render.
 *
 * Cada parte entra INTEIRA ("nao quero cortar nada"), uma depois da outra, e
 * tudo dela anda junto no tempo: a narracao, as cenas, as legendas, as
 * palavras, os sons, as musicas, as camadas de ajuste e a escolha da
 * Biblioteca. Entre duas partes, a LIGACAO quando ele quer:
 *
 *  - FRASE GRAVADA ("E nao para por ai..."): um pedaco de narracao entre as
 *    partes -- empurra o resto para frente --, com a legenda dela e uma cena
 *    (a que ele escolheu na Biblioteca, ou a primeira da parte seguinte);
 *  - SO SOM: um som no corte (o whoosh), sem tempo a mais; a musica de cada
 *    parte segue como estava.
 *
 * Puro: o main le os projetos, mede as narracoes, prepara a frase (o audio
 * dela e o alinhamento) e junta os WAV; isto aqui so faz a conta. Os projetos
 * de origem nunca sao tocados -- sai um projeto novo.
 */

export interface ParteDaJuncao {
  /** O projeto como o main abriu (caminhos ja resolvidos no disco). */
  file: ProjectFile
  /** A duracao da narracao dele, medida no arquivo (e o que a junção do audio usa). */
  duracao: number
}

export type LigacaoDaJuncao =
  | {
      tipo: 'som'
      /** O som do corte (null = sem som: so a emenda). */
      som: { path: string; fileName: string; durationSec: number; peaks: number[] } | null
    }
  | {
      tipo: 'frase'
      /** A frase pronta (com os efeitos dele), em segundos. */
      duracao: number
      /** O que ele falou, como ele digitou: vira a legenda e o roteiro. */
      texto: string
      /** As palavras com o tempo DENTRO da frase (o alinhamento sobre o audio dela). */
      palavras: Word[]
      /** A cena da frase; null = a primeira cena da parte seguinte. */
      cena: { path: string } | null
    }

export interface ResultadoDaJuncao {
  file: ProjectFile
  /** Onde cada parte comeca no video novo (s). */
  inicios: number[]
  /** Onde cada ligacao comeca (s): o corte, no "so som"; o comeco da frase, na frase. */
  ligacoes: number[]
  duracao: number
}

/** A faixa de audio dos sons de ligacao: uma acima de todas as das partes, para nunca encostar num som delas. */
export function faixaDosSonsDeLigacao(partes: readonly ParteDaJuncao[]): number {
  let maior = -1
  for (const p of partes) for (const t of p.file.trilhas) maior = Math.max(maior, t.faixa)
  return maior + 1
}

/** Quanto do som vem ANTES do corte: o meio do whoosh cai na emenda (no maximo 0,4 s antes). */
export function antesDoCorte(durationSec: number): number {
  return Math.min(durationSec / 2, 0.4)
}

export function juntarProjetos(
  partes: readonly ParteDaJuncao[],
  ligacoes: readonly LigacaoDaJuncao[],
  audio: FileReference,
  regras: RegrasDaLegenda = REGRAS_DA_LEGENDA_PADRAO,
): ResultadoDaJuncao {
  if (partes.length < 2) throw new Error('Escolha pelo menos dois projetos para juntar.')
  if (ligacoes.length !== partes.length - 1) throw new Error('Cada emenda precisa da sua ligação.')
  const primeiro = partes[0]!.file
  const ultimo = partes.at(-1)!.file
  const formato = primeiro.formato
  if (partes.some((p) => p.file.formato !== formato)) {
    throw new Error('Os projetos têm formatos diferentes (Short e Long form). Junte só projetos do mesmo formato.')
  }

  // ---------------------------------------------------------- os tempos
  const inicios: number[] = []
  const inicioDaLigacao: number[] = []
  let t = 0
  partes.forEach((p, i) => {
    inicios.push(t)
    t += p.duracao
    const l = ligacoes[i]
    if (!l) return
    inicioDaLigacao.push(t)
    if (l.tipo === 'frase') t += l.duracao
  })
  const duracao = t
  const quadro = (s: number): number => Math.max(0, Math.round(s * VIDEO_FPS))

  // ------------------------------------------- as imagens e as cenas
  const images: ProjectFile['images'] = []
  const scenes: Scene[] = []
  const blocos: NonNullable<ProjectFile['biblioteca']['blocos']> = []
  const porBloco: Record<string, string[]> = {}
  const pesos: Record<string, number[]> = {}
  const unioes: Record<string, number[]> = {}
  const cortes: Record<string, number[]> = {}
  const escolhidos: string[] = []
  const palavras: Word[] = []
  const segmentos: NonNullable<ProjectFile['transcript']>['segments'] = []
  const cortesBons: number[] = []
  const legendas: CaptionBlock[] = []
  const roteiro: string[] = []
  const trilhas: ProjectFile['trilhas'] = []
  const sobreposicoes: ProjectFile['sobreposicoes'] = []
  const sfxManual: ProjectFile['sfxManual'] = []
  let frasesAntes = 0
  const faixaDosSons = faixaDosSonsDeLigacao(partes)

  partes.forEach((p, i) => {
    const f = p.file
    const off = inicios[i]!
    const imagensAntes = images.length
    const blocosAntes = blocos.length
    const id = (x: string): string => `p${i + 1}-${x}`

    images.push(...f.images.map((img) => ({ ...img })))
    const fim = off + p.duracao
    const daParte: Scene[] = []
    for (const c of f.plan?.scenes ?? []) {
      const start = c.start + off
      if (start >= fim - 1e-6) continue
      daParte.push({
        ...c,
        imageIndex: c.imageIndex + imagensAntes,
        imageIndexB: c.imageIndexB === null ? null : c.imageIndexB + imagensAntes,
        start,
        end: Math.min(c.end + off, fim),
      })
    }
    // A ultima cena da parte vai ate o fim da narracao dela: nem buraco preto
    // antes da parte seguinte, nem por cima dela.
    const ultimaDaParte = daParte.at(-1)
    if (ultimaDaParte) ultimaDaParte.end = fim
    scenes.push(...daParte)

    // As palavras, as frases e as pausas boas para cortar.
    const tr = f.transcript
    if (tr) {
      palavras.push(...tr.words.map((w) => ({ ...w, start: w.start + off, end: w.end + off })))
      segmentos.push(...tr.segments.map((s) => ({ ...s, start: s.start + off, end: s.end + off })))
      cortesBons.push(...tr.cutCandidates.map((c) => c + off))
    }
    legendas.push(...f.captions.map((b) => moverLegenda(b, quadro(off))))
    if (f.script?.trim()) roteiro.push(f.script.trim())

    // A escolha da Biblioteca: as frases andam, e os indices de bloco tambem.
    const bib = f.biblioteca
    let maiorFrase = -1
    for (const b of bib.blocos ?? []) {
      maiorFrase = Math.max(maiorFrase, b.sentence, ...(b.partes ?? []).map((x) => x.sentence))
      blocos.push({
        ...b,
        start: b.start + off,
        end: b.end + off,
        sentence: b.sentence + frasesAntes,
        ...(b.partes
          ? { partes: b.partes.map((x) => ({ ...x, start: x.start + off, end: x.end + off, sentence: x.sentence + frasesAntes })) }
          : {}),
      })
    }
    const reindexar = <T>(de: Record<string, T>, para: Record<string, T>): void => {
      for (const [k, v] of Object.entries(de)) para[String(Number(k) + blocosAntes)] = v
    }
    reindexar(bib.porBloco, porBloco)
    reindexar(bib.pesos, pesos)
    reindexar(bib.unioes, unioes)
    reindexar(bib.cortes, cortes)
    escolhidos.push(...bib.escolhidos)
    frasesAntes += maiorFrase + 1

    // Os sons, as musicas e a faixa de video andam pelo comeco (as chaves de
    // animacao sao contadas do comeco do clipe: andam sozinhas). O que passaria
    // do comeco da parte seguinte termina nele -- no projeto sozinho, o fim da
    // narracao cortava; aqui tocaria por cima da outra parte.
    const l = ligacoes[i]
    const limite = l ? inicios[i + 1]! : Infinity
    const frase = l?.tipo === 'frase' ? l.duracao : 0
    for (const x of f.trilhas) {
      const movida = { ...x, id: id(x.id), at: x.at + off }
      const cabe = caberAte(seguirSobAFrase(movida, fim, frase), limite)
      if (cabe) trilhas.push(cabe)
    }
    const anterior = i > 0 ? ligacoes[i - 1] : undefined
    const fraseAntes = anterior?.tipo === 'frase' ? anterior.duracao : 0
    // As camadas param no fim da narracao da parte (o que passava dele nunca
    // apareceu), sem fade a mais.
    for (const x of f.sobreposicoes) {
      const movida = { ...x, id: id(x.id), at: x.at + off }
      const daCor = x.tipo === 'ajuste' ? cobrirAFraseAntes(movida, off, p.duracao, fraseAntes) : movida
      const cabe = caberAte(daCor, l ? fim : Infinity, { folga: 0.05, fade: false })
      if (cabe) sobreposicoes.push(cabe)
    }
    sfxManual.push(...f.sfxManual.map((x) => ({ ...x, id: id(x.id), at: x.at + off })))

    // ------------------------------------------- a ligacao depois desta parte
    if (!l) return
    const ini = inicioDaLigacao[i]!
    if (l.tipo === 'som') {
      if (l.som) {
        trilhas.push({
          id: `ligacao-${i + 1}-som`,
          path: l.som.path,
          fileName: l.som.fileName,
          faixa: faixaDosSons,
          at: Math.max(0, ini - antesDoCorte(l.som.durationSec)),
          durationSec: l.som.durationSec,
          inicioSec: 0,
          usarSec: null,
          gainDb: 0,
          fadeInSec: 0,
          fadeOutSec: 0,
          peaks: l.som.peaks,
          rms: [],
          modulos: {},
        })
      }
      return
    }
    // A FRASE: uma cena, as palavras, a legenda, a frase do roteiro e o bloco.
    const proxima = partes[i + 1]!.file
    const primeiraDaProxima = proxima.plan?.scenes[0]
    const caminhoDaCena = l.cena?.path ?? (primeiraDaProxima ? proxima.images[primeiraDaProxima.imageIndex]?.path : undefined)
    if (caminhoDaCena) {
      const existente = proxima.images.find((img) => img.path === caminhoDaCena)
      images.push(
        existente
          ? { ...existente }
          : { path: caminhoDaCena, rel: null, fileName: caminhoDaCena.split(/[\\/]/).pop() ?? caminhoDaCena, focusX: 0.5, focusY: 0.5, focusAuto: false, section: null, invertido: false },
      )
      scenes.push(
        sceneSchema.parse({
          imageIndex: images.length - 1,
          start: ini,
          end: ini + l.duracao,
          effect: 'zoom-in',
          intensity: 0.08,
          transitionIn: 'cut',
        }),
      )
    }
    const daFrase = l.palavras.map((w) => ({ ...w, start: w.start + ini, end: w.end + ini }))
    palavras.push(...daFrase)
    if (daFrase.length > 0) {
      segmentos.push({ text: l.texto.trim(), start: daFrase[0]!.start, end: daFrase.at(-1)!.end })
      legendas.push(
        ...buildCaptions({ source: 'script', words: l.palavras, segments: [], text: l.texto, cutCandidates: [] }, regras).map((b) =>
          moverLegenda(b, quadro(ini)),
        ),
      )
    }
    cortesBons.push(ini, ini + l.duracao)
    if (l.texto.trim()) roteiro.push(l.texto.trim())
    blocos.push({ text: l.texto.trim(), start: ini, end: ini + l.duracao, sentence: frasesAntes })
    if (caminhoDaCena) porBloco[String(blocos.length - 1)] = [caminhoDaCena]
    frasesAntes += 1
  })

  // As cenas na ordem do tempo (a ultima vai ate o fim da narracao).
  scenes.sort((a, b) => a.start - b.start)
  const ultima = scenes.at(-1)
  if (ultima && ultima.end < duracao) ultima.end = duracao

  const todasComTranscricao = partes.every((p) => p.file.transcript !== null)
  const fontes = new Set(partes.map((p) => p.file.transcript?.source).filter(Boolean))
  const file: ProjectFile = {
    ...primeiro,
    version: PROJECT_FILE_VERSION,
    savedAt: new Date().toISOString(),
    formato,
    audio,
    images,
    script: roteiro.length > 0 ? roteiro.join('\n\n') : null,
    // O que e de UM video so (o B-roll, o resumo de manga, a etapa de audio,
    // os textos de publicacao, os dados de modulo) nao passa: valia para os
    // tempos daquele video.
    broll: null,
    resumoDoManga: null,
    edicaoDeAudio: null,
    subtitle: null,
    plan: scenes.length > 0 ? { scenes } : null,
    planEdited: true,
    transcript: todasComTranscricao
      ? {
          source: fontes.size === 1 ? [...fontes][0]! : 'script',
          words: palavras,
          segments: segmentos,
          text: palavras.map((w) => w.text).join(' '),
          cutCandidates: [...new Set(cortesBons.map((c) => Math.round(c * 1000) / 1000))].sort((a, b) => a - b),
          alinhado: partes.every((p) => p.file.transcript?.alinhado === true),
        }
      : null,
    // Os tempos ja sao os certos: o Whisper nao precisa ouvir a narracao juntada.
    transcriptTravado: todasComTranscricao,
    captions: legendas,
    // As legendas de cada parte voltam como ele deixou (mesclas e correcoes).
    captionsEdited: true,
    trilhas,
    sobreposicoes,
    sfxManual,
    // Uma faixa muda so continua muda se estava muda em TODAS (senao calaria a musica de outra parte).
    faixasMudas: {
      video: primeiro.faixasMudas.video.filter((f) => partes.every((p) => p.file.faixasMudas.video.includes(f))),
      audio: primeiro.faixasMudas.audio.filter((f) => partes.every((p) => p.file.faixasMudas.audio.includes(f))),
    },
    cenasTrancadas: false,
    // O gancho abre o video novo; o fechamento e o do ultimo.
    endText: ultimo.endText,
    endSec: ultimo.endSec,
    metadata: null,
    biblioteca: { escolhidos, blocos: blocos.length > 0 ? blocos : null, porBloco, pesos, unioes, cortes, ativo: null },
    modulos: {},
  }
  return { file, inicios, ligacoes: inicioDaLigacao, duracao }
}

interface Clipe {
  at: number
  durationSec: number
  inicioSec: number
  usarSec: number | null
  fadeOutSec: number
}

const fimDoClipe = (x: Clipe): number => x.at + Math.max(0, x.usarSec ?? x.durationSec - x.inicioSec)

/** Quanto um clipe pode passar da emenda sem ser cortado: o rabo de um whoosh ou de um riser. */
export const FOLGA_NA_EMENDA = 1

/**
 * O clipe que passaria de `limite` (o comeco da parte seguinte) termina nele,
 * com um fade curto se ficou sem o dele (`fade`). Ate `folga` alem passa
 * inteiro (o som do fim de uma parte pode encostar na outra). null = comeca
 * depois do limite: fica de fora.
 */
export function caberAte<T extends Clipe>(
  x: T,
  limite: number,
  { folga = FOLGA_NA_EMENDA, fade = true }: { folga?: number; fade?: boolean } = {},
): T | null {
  if (x.at >= limite - 0.05) return null
  if (fimDoClipe(x) <= limite + folga) return x
  const usar = limite - x.at
  return { ...x, usarSec: usar, ...(fade ? { fadeOutSec: Math.max(x.fadeOutSec, Math.min(1, usar / 3)) } : {}) }
}

/**
 * A MUSICA SEGUE POR BAIXO DA FRASE DE LIGACAO. A musica que ele aparou para
 * acabar com a narracao da parte (o fim dela cai no fim da parte) ganha a
 * duracao da frase -- se o arquivo tem de onde continuar --, em vez de a frase
 * entrar no seco. A musica que acabava antes, ou o arquivo que nao tem mais,
 * fica como estava.
 */
export function seguirSobAFrase<T extends Clipe>(x: T, fimDaParte: number, frase: number): T {
  if (frase <= 0) return x
  if (Math.abs(fimDoClipe(x) - fimDaParte) > 0.15) return x
  const usar = Math.max(0, x.usarSec ?? x.durationSec - x.inicioSec)
  if (x.inicioSec + usar + frase > x.durationSec + 1e-6) return x
  return { ...x, usarSec: usar + frase }
}

/**
 * A COR DA PARTE COBRE A FRASE QUE A ANUNCIA. A cena da frase de ligacao e,
 * de saida, a primeira da parte seguinte: a camada de ajuste que abre essa
 * parte (a cor dela) comeca na frase, em vez de a frase passar sem cor e a cor
 * pular no comeco da parte. So a que cobre a parte (a cor dela, metade ou
 * mais): um efeito curto no comeco (um flash) fica no comeco. As chaves do
 * clipe sao contadas do comeco dele: andam a duracao da frase para ficar onde
 * estavam no video.
 */
export function cobrirAFraseAntes<T extends Clipe & { chaves?: { t: number }[] }>(
  x: T,
  inicioDaParte: number,
  duracaoDaParte: number,
  frase: number,
): T {
  if (frase <= 0 || Math.abs(x.at - inicioDaParte) > 0.15) return x
  const usar = Math.max(0, x.usarSec ?? x.durationSec - x.inicioSec)
  if (usar < duracaoDaParte / 2) return x
  return {
    ...x,
    at: Math.max(0, x.at - frase),
    usarSec: usar + frase,
    ...(x.chaves ? { chaves: x.chaves.map((c) => ({ ...c, t: c.t + frase })) } : {}),
  }
}

function moverLegenda(b: CaptionBlock, deslocamento: number): CaptionBlock {
  return {
    ...b,
    from: b.from + deslocamento,
    words: b.words.map((w) => ({ ...w, from: w.from + deslocamento })),
  }
}
