import { basename } from 'node:path'
import { temposDasCenas, trechosDoCandidato, type EscolhaDaFrase, type EstadoDasCenas } from '../../shared/cenas'
import {
  CLIP_INTENSITY,
  CLIP_MOTION_CURVE,
  HOOK_SEC_DEFAULT,
  KEN_BURNS_EFFECTS,
  medidasDo,
  VIDEO_FPS,
  type CaptionStyle,
  type Scene,
  type Segment,
  type Transcript,
  type Transition,
  type Word,
} from '@shared/contract'
import { aplicarEstiloNoProjeto, secoesDoTake } from '../../shared/edicao-rapida'
import { encaixarEscolha } from '../../shared/encaixe'
import type { EpisodeIndex } from '../../shared/episodio'
import { buildCaptions, cutCandidatesFrom } from '@shared/plan'
import { PROJECT_FILE_VERSION, projectFileSchema, type ProjectFile } from '@shared/project-file'
import {
  clipeParaONucleo,
  ID_DO_MODULO,
  trilhaParaONucleo,
  VERSAO_DO_RECAP_NO_PROJETO,
  type ClipeDoRecap,
  type RecapNoProjeto,
  type TrilhaDoRecap,
} from '../../shared/projeto-do-recap'
import { ROTULO_DO_PAPEL, textoDoRoteiro, type Evento, type RascunhoDoRecap, type Roteiro } from '../../shared/roteiro'
import { ganchoDoRoteiro } from '../../shared/textos-na-tela'
import type { TakeDaVoz } from '../../shared/voz'

/**
 * A MONTAGEM do projeto a partir do rascunho do recap: puro, sem disco.
 *
 * Entra o roteiro aprovado, o take aprovado, as escolhas de cena (encaixadas
 * no take) e o indice do episodio; sai o .dangai inteiro, ja validado
 * pelo zod (projectFileSchema), do jeito que o editor do Dangai abre:
 *
 * - `audio`: a narracao do take (o WAV ja copiado para a pasta do projeto);
 * - `transcript`: as palavras do take (texto do roteiro, tempo do provedor ou
 *   do alinhador), um segmento por frase, `paragraph` na ultima palavra de
 *   cada secao (a linha em branco do roteiro), `alinhado: true`;
 * - `script`: textoDoRoteiro (o mesmo texto, com as secoes em paragrafos);
 * - `images` + `plan`: um bloco por PEDACO de mp4 -- cada cena escolhida vira
 *   um bloco por plano que ela usa (a emenda vira blocos contiguos, com o corte
 *   do proprio episodio no meio). O bloco aponta o mp4 do plano e parte de
 *   `sourceStart` = o ponto dentro do arquivo (trechosDoCandidato);
 * - os cortes caem nas FRONTEIRAS DE FRASE do take (trecho.offset, exato) e
 *   nas palavras escolhidas com a barrinha (o start da palavra no take);
 * - movimento como o planoDosBlocos do store (src/store/project.ts): rodizio
 *   de KEN_BURNS_EFFECTS, CLIP_INTENSITY, curva CLIP_MOTION_CURVE; corte seco
 *   dentro da secao e uma transicao curta (TRANSICAO_DA_VIRADA) na virada de
 *   secao; o primeiro bloco entra seco;
 * - card de gancho com o textoDeTela da 1a frase (sem ele, a 1a sugestao de
 *   thumb: ganchoDaMontagem);
 * - legendas: as do editor (buildCaptions com as regras padrao), com
 *   `captionsEdited: false` -- o openProject refaz com as regras de quem abre;
 * - [recap] `modulos.recap` (versao 1) com `vozAlinhada: true` e `secoes`, as
 *   partes do roteiro no tempo do take (viradas do som, nomes do rosto); e
 *   `transcriptTravado: true`, a trava do nucleo que no Studio era a guarda
 *   de reanalise;
 * - a legenda no ESTILO SALVO dele (settings.captionStyle), como um projeto
 *   novo do Dangai, e as faixas de audio e a camada de cor da Edicao rapida
 *   quando pedida (./edicao-rapida.ts).
 *
 * planOrigin 'auto' (o plano em que cada bloco dura a frase que escolheu a
 * cena dele) e planEdited true, como a montagem automatica do Dangai.
 */

/** A virada de secao: um zoom curto (a regra do Levi: corte seco dentro da secao). */
export const TRANSICAO_DA_VIRADA: Transition = 'zoom-in'
/** ~334 ms: curta, mas com tempo para a curva do zoom acelerar e frear. */
export const QUADROS_DA_VIRADA = 8

/** Pedaco menor que isto nao vira bloco: o tempo dele vai para o vizinho (2 quadros). */
export const PEDACO_MINIMO_SEC = 2 / VIDEO_FPS

/** O gancho fica na tela o tempo da 1a frase, dentro destes limites. */
const GANCHO_MIN_SEC = 1.5
const GANCHO_MAX_SEC = 4

export interface FocoDoPedaco {
  focusX: number
  focusY: number
  /** Veio do detector de rosto (a interface diz que o app enquadrou). */
  focusAuto: boolean
}

/** (rodada 4) A metade de BAIXO de um bloco em grid: o mp4 e o trecho dele que toca junto. */
export interface MetadeDaMontagem {
  planoId: string
  arquivo: string
  /** Segundos DENTRO do mp4: `de` vira o sourceStartB do bloco. */
  de: number
  ate: number
}

/** Um bloco do plano antes de virar Scene: de onde vem a imagem e onde entra na narracao. */
export interface PedacoDaMontagem {
  fraseId: string
  /** Indice da secao no roteiro (vira `section` da imagem e decide a transicao). */
  secao: number
  /** A cena dentro da frase (0 = a primeira). */
  cena: number
  planoId: string
  /** O mp4 do plano (Plano.arquivo), so lido. */
  arquivo: string
  /** Segundos DENTRO do mp4: `de` vira o sourceStart do bloco. */
  de: number
  ate: number
  /** Onde entra e sai na narracao (segundos do take). */
  inicio: number
  fim: number
  porque: string[]
  /**
   * (rodada 4) O GRID: a metade de baixo (a cena tem `baixo`). Este pedaco e
   * a de cima; os dois enquadram na janela da METADE (1080x960), nao no 9:16.
   */
  baixo?: MetadeDaMontagem
}

/** Chave do foco de um pedaco: o mesmo mp4 pode entrar duas vezes, de pontos diferentes. */
export function chaveDoPedaco(p: Pick<PedacoDaMontagem, 'arquivo' | 'de'>): string {
  return `${p.arquivo}@${p.de.toFixed(3)}`
}

/**
 * (rodada 4) Chave do foco de uma METADE do grid: o mesmo mp4 e ponto, mas a
 * janela e a da metade (9:8), e o foco do 9:16 erra ate 646 px nela.
 */
export function chaveDaMetade(p: Pick<PedacoDaMontagem, 'arquivo' | 'de'>): string {
  return `${chaveDoPedaco(p)}|metade`
}

export interface EntradaDaMontagem {
  rascunho: Pick<RascunhoDoRecap, 'id' | 'episodioId'>
  roteiro: Pick<Roteiro, 'secoes' | 'versao'>
  take: Pick<TakeDaVoz, 'id' | 'duracao' | 'palavras' | 'trechos'>
  indice: Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'>
  cenas: Pick<EstadoDasCenas, 'escolhas'>
  /** O WAV da narracao JA COPIADO para a pasta do projeto (caminho absoluto). */
  narracaoPath: string
  /** Enquadramento por chaveDoPedaco. Ausente = centro. */
  focos?: ReadonlyMap<string, FocoDoPedaco>
  agora: string
  /**
   * Os eventos do rascunho: dao os personagens de cada frase em
   * `studio.secoes` (o rosto e o som da Edicao rapida leem). Ausente = sem nomes.
   */
  eventos?: readonly Pick<Evento, 'id' | 'personagens'>[]
  /**
   * O estilo de legenda salvo dele (settings.captionStyle): o projeto montado
   * nasce com ele, como um projeto novo do Dangai. Ausente/null = o padrao.
   */
  estilo?: CaptionStyle | null
  /** As faixas de audio da Edicao rapida (trilhasDoPlanoDeSom). Ausente = nenhuma. */
  trilhas?: readonly TrilhaDoRecap[]
  /** A faixa de video da Edicao rapida: a camada de cor (camadaDeCor) e os textos na tela. Ausente = nenhuma. */
  sobreposicoes?: readonly ClipeDoRecap[]
  /** As sugestoes de texto de thumb do roteiro: a 1a vira o card de gancho quando a 1a frase nao tem texto. */
  thumbs?: readonly string[]
  /** (19/10) A Edicao rapida > Titulo no gancho: so com ela o projeto nasce com o card. Ausente = sem card. */
  titulo?: boolean
  /**
   * (19/10) Quem cada frase cita, na ordem de preferencia (nomesDaMontagem): o
   * `personagens` de `studio.secoes`. Ausente = os personagens dos eventos.
   */
  nomesDasFrases?: ReadonlyMap<string, readonly string[]>
  /** O minimo na tela das emendas (config Cenas). Ausente = o padrao. */
  minimoSec?: number
  /** (4a rodada) A entrada depois do efeito de cada plano que abre ruim (ContextoDoEncaixe.entradas). Ausente = sem piso. */
  entradas?: ReadonlyMap<string, number>
}

/**
 * O CARD DE GANCHO do projeto montado: o texto (o da 1a frase, ou a 1a
 * sugestao de thumb) e quanto ele fica na tela -- o tempo da 1a frase, entre
 * GANCHO_MIN_SEC e GANCHO_MAX_SEC. Os textos na tela comecam depois dele.
 */
export function ganchoDaMontagem(
  roteiro: Pick<Roteiro, 'secoes'>,
  take: Pick<TakeDaVoz, 'trechos'>,
  thumbs: readonly string[] = [],
): { texto: string; sec: number; origem: 'frase' | 'thumb' | null } {
  const primeira = roteiro.secoes[0]?.frases[0]
  const trecho = primeira ? take.trechos.find((t) => t.fraseId === primeira.id) : undefined
  const gancho = ganchoDoRoteiro(primeira, thumbs)
  const sec = trecho ? Math.round(Math.min(Math.max(trecho.duracao, GANCHO_MIN_SEC), GANCHO_MAX_SEC) * 10) / 10 : HOOK_SEC_DEFAULT
  return { texto: gancho.texto, sec, origem: gancho.origem }
}

/**
 * Os pedacos de mp4 do video, em ordem e contiguos: o primeiro de cada frase
 * comeca no trecho.offset dela, os seguintes no start da palavra escolhida, e
 * dentro de uma emenda no ponto em que o plano anterior acaba.
 *
 * Toda escolha passa de novo pelo encaixarEscolha com ESTE take (idempotente):
 * um encaixe velho nunca chega ao projeto. Frase sem cena pega a 1a da fita;
 * sem fita, a cena anterior continua (aviso).
 */
export function pedacosDaMontagem(e: Omit<EntradaDaMontagem, 'narracaoPath' | 'focos' | 'agora'>): {
  pedacos: PedacoDaMontagem[]
  avisos: string[]
} {
  const avisos: string[] = []
  const trechos = new Map(e.take.trechos.map((t) => [t.fraseId, t]))
  const escolhas = new Map(e.cenas.escolhas.map((x) => [x.fraseId, x]))
  const pedacos: PedacoDaMontagem[] = []

  e.roteiro.secoes.forEach((secao, si) => {
    for (const frase of secao.frases) {
      const trecho = trechos.get(frase.id)
      if (!trecho) {
        avisos.push(`${frase.id}: frase sem voz`)
        continue
      }
      let escolha: EscolhaDaFrase | undefined = escolhas.get(frase.id)
      if (!escolha || escolha.cenas.length === 0) {
        const primeira = escolha?.fita[0]
        if (!escolha || !primeira) {
          avisos.push(`${frase.id}: sem cena, a anterior continua`)
          continue
        }
        escolha = { ...escolha, cenas: [{ candidato: primeira, palavraInicio: 0 }] }
        avisos.push(`${frase.id}: sem cena escolhida, entrou a 1a sugestao`)
      }
      const ctx = {
        indice: e.indice,
        frase,
        take: e.take,
        ...(e.minimoSec !== undefined ? { minimoSec: e.minimoSec } : {}),
        ...(e.entradas ? { entradas: e.entradas } : {}),
      }
      const feito = encaixarEscolha(escolha, ctx)
      avisos.push(...feito.avisos)
      const tempos = temposDasCenas(feito.escolha, frase, e.take)

      feito.escolha.cenas.forEach((cena, k) => {
        const t = tempos[k]
        if (!t) return
        const inicio = trecho.offset + t.inicio
        const fim = trecho.offset + t.fim
        if (fim - inicio <= 0) return
        const partes = trechosDoCandidato(cena.candidato, e.indice.planos)
        if (partes.length === 0) {
          avisos.push(`${frase.id}: cena sem arquivo`)
          return
        }
        // (rodada 4) O grid: a metade de baixo toca junto, do comeco ao fim da cena.
        const deBaixo = cena.baixo ? trechosDoCandidato(cena.baixo, e.indice.planos)[0] : undefined
        if (cena.baixo && !deBaixo) avisos.push(`${frase.id}: metade de baixo sem arquivo, a cena fica cheia`)
        let cursor = inicio
        partes.forEach((p, j) => {
          if (cursor >= fim - 1e-9) return
          // O ultimo pedaco fecha a cena: falta pequena de imagem vira o
          // ultimo quadro segurado (o encaixe ja avisou se passou da folga).
          const ate = j === partes.length - 1 ? fim : Math.min(fim, cursor + (p.ate - p.de))
          pedacos.push({
            fraseId: frase.id,
            secao: si,
            cena: k,
            planoId: p.planoId,
            arquivo: p.arquivo,
            de: p.de,
            ate: p.ate,
            inicio: cursor,
            fim: ate,
            porque: cena.candidato.porque,
            // Cima emendada (raro: so na mao): a de baixo continua de onde estava.
            ...(deBaixo
              ? { baixo: { planoId: deBaixo.planoId, arquivo: deBaixo.arquivo, de: deBaixo.de + (cursor - inicio), ate: deBaixo.ate } }
              : {}),
          })
          cursor = ate
        })
      })
    }
  })

  return { pedacos: semPedacoMinusculo(pedacos), avisos }
}

/**
 * Pedaco de menos de 2 quadros nao vira bloco (piscaria): o tempo dele vai para
 * o anterior da MESMA frase; sendo o primeiro da frase, para o seguinte (que
 * passa a comecar na fronteira -- a fronteira de frase continua exata).
 */
function semPedacoMinusculo(pedacos: readonly PedacoDaMontagem[]): PedacoDaMontagem[] {
  const saida: PedacoDaMontagem[] = []
  let herdado: number | null = null
  for (const [i, p] of pedacos.entries()) {
    const atual: PedacoDaMontagem = herdado === null ? p : { ...p, inicio: herdado }
    herdado = null
    if (atual.fim - atual.inicio >= PEDACO_MINIMO_SEC) {
      saida.push(atual)
      continue
    }
    const anterior = saida[saida.length - 1]
    const seguinte = pedacos[i + 1]
    if (anterior && anterior.fraseId === atual.fraseId) saida[saida.length - 1] = { ...anterior, fim: atual.fim }
    else if (seguinte) herdado = atual.inicio
    else if (anterior) saida[saida.length - 1] = { ...anterior, fim: atual.fim }
    else saida.push(atual)
  }
  return saida
}

/** O transcript do take: o texto do roteiro com o tempo do take, como o Dangai monta do roteiro. */
export function transcriptDoTake(
  roteiro: Pick<Roteiro, 'secoes'>,
  take: Pick<TakeDaVoz, 'palavras'>,
): Transcript {
  // A ultima palavra de cada secao fecha um paragrafo (a linha em branco do
  // textoDoRoteiro): e o que o paragraphEnds e o ritmo do Dangai leem.
  const ultimaDaFrase = new Map<string, number>()
  take.palavras.forEach((p, i) => ultimaDaFrase.set(p.fraseId, i))
  const fechaParagrafo = new Set<number>()
  for (const secao of roteiro.secoes) {
    for (let k = secao.frases.length - 1; k >= 0; k--) {
      const i = ultimaDaFrase.get(secao.frases[k]!.id)
      if (i !== undefined) {
        fechaParagrafo.add(i)
        break
      }
    }
  }
  const words: Word[] = take.palavras.map((p, i) => ({
    text: p.texto,
    start: p.start,
    end: p.end,
    ...(fechaParagrafo.has(i) ? { paragraph: true } : {}),
  }))
  const segments: Segment[] = []
  for (const frase of roteiro.secoes.flatMap((s) => s.frases)) {
    const dela = take.palavras.filter((p) => p.fraseId === frase.id)
    const primeira = dela[0]
    const ultima = dela[dela.length - 1]
    if (!primeira || !ultima) continue
    segments.push({ text: dela.map((p) => p.texto).join(' '), start: primeira.start, end: ultima.end })
  }
  return {
    source: 'script',
    words,
    segments,
    text: words.map((w) => w.text).join(' '),
    cutCandidates: cutCandidatesFrom(words, segments),
    alinhado: true,
  }
}

/** O enquadramento do rosto no mesmo sistema do faces.ts (focoPara): fracao da folga da janela 9:16. */
export function focoDoRosto(
  rosto: { centroX: number; centroY: number },
  largura: number,
  altura: number,
): { focusX: number; focusY: number } {
  const quadro = medidasDo('short')
  const escala = Math.max(quadro.renderWidth / largura, quadro.renderHeight / altura)
  const w = Math.max(Math.ceil(largura * escala), quadro.renderWidth)
  const h = Math.max(Math.ceil(altura * escala), quadro.renderHeight)
  const folgaX = w - quadro.renderWidth
  const folgaY = h - quadro.renderHeight
  const prender = (v: number): number => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0.5)
  return {
    focusX: folgaX > 0 ? prender((rosto.centroX * w - quadro.renderWidth / 2) / folgaX) : 0.5,
    focusY: folgaY > 0 ? prender((rosto.centroY * h - quadro.renderHeight / 2) / folgaY) : 0.5,
  }
}

/** O .dangai inteiro, validado. Lanca quando nenhuma frase tem cena. */
export function montarArquivoDoProjeto(e: EntradaDaMontagem): { file: ProjectFile; pedacos: PedacoDaMontagem[]; avisos: string[] } {
  const { pedacos, avisos } = pedacosDaMontagem(e)
  if (pedacos.length === 0) throw new Error('Nenhuma frase tem cena. Escolha as cenas antes de abrir no editor.')

  const papeis = e.roteiro.secoes.map((s) => ROTULO_DO_PAPEL[s.papel])
  const duracao = e.take.duracao

  // Uma imagem por pedaco e, no grid, a da metade de baixo logo depois (como os
  // `pares` da montagem automatica do nucleo). As duas metades enquadram na
  // janela da metade (chaveDaMetade): o foco do 9:16 erra nela.
  const imagem = (arquivo: string, foco: FocoDoPedaco | undefined, secao: number) => ({
    path: arquivo,
    rel: null,
    fileName: basename(arquivo),
    focusX: foco?.focusX ?? 0.5,
    focusY: foco?.focusY ?? 0.5,
    focusAuto: foco?.focusAuto ?? false,
    section: secao,
    sectionName: papeis[secao] ?? `Parte ${secao + 1}`,
    invertido: false,
  })
  const images: ReturnType<typeof imagem>[] = []
  const indices = pedacos.map((p) => {
    const cima = images.push(imagem(p.arquivo, e.focos?.get(p.baixo ? chaveDaMetade(p) : chaveDoPedaco(p)), p.secao)) - 1
    const baixo = p.baixo ? images.push(imagem(p.baixo.arquivo, e.focos?.get(chaveDaMetade(p.baixo)), p.secao)) - 1 : null
    return { cima, baixo }
  })

  const scenes: Scene[] = pedacos.map((p, j) => {
    const seguinte = pedacos[j + 1]
    // Fronteiras contiguas: o fim de um e o comeco do outro (sem buraco nem
    // soma de float). O primeiro comeca em 0; o ultimo vai ate o fim da voz.
    const start = j === 0 ? 0 : p.inicio
    const end = seguinte ? seguinte.inicio : Math.max(duracao, p.fim)
    const virada = j > 0 && p.secao !== pedacos[j - 1]!.secao
    const { cima, baixo } = indices[j]!
    // (rodada 4) O grid nasce como o nucleo recomenda (planoDosBlocos): as metades
    // indo para lados opostos -- cima para a esquerda, baixo para a direita --, na
    // mesma intensidade (intensityB null segue a de cima).
    const metade = p.baixo && baixo !== null ? p.baixo : null
    const porque = p.porque.length > 0 ? `: ${p.porque.join(', ')}` : ''
    return {
      imageIndex: cima,
      imageIndexB: metade ? baixo : null,
      start,
      end,
      effect: metade ? 'pan-left' : KEN_BURNS_EFFECTS[j % KEN_BURNS_EFFECTS.length]!,
      intensity: CLIP_INTENSITY,
      effectB: metade ? 'pan-right' : null,
      intensityB: null,
      curve: CLIP_MOTION_CURVE,
      curvePoints: null,
      camera: null,
      sourceStart: p.de,
      sourceStartB: metade ? metade.de : 0,
      rotation: 0,
      transitionIn: virada ? TRANSICAO_DA_VIRADA : 'cut',
      ...(virada ? { transicao: { frames: QUADROS_DA_VIRADA } } : {}),
      reason: metade ? `${p.fraseId}: grid ${p.planoId} / ${metade.planoId}${porque}` : `${p.fraseId}${porque}`,
    }
  })

  const transcript = transcriptDoTake(e.roteiro, e.take)
  const gancho = e.titulo ? ganchoDaMontagem(e.roteiro, e.take, e.thumbs ?? []) : { texto: '', sec: HOOK_SEC_DEFAULT }

  // [recap] O que no Studio era o `studio` da raiz: `modulos.recap`, versao 1.
  // O transcript fica travado pelo nucleo (`transcriptTravado`), nao por uma
  // guarda do modulo.
  const recap: RecapNoProjeto = {
    versao: VERSAO_DO_RECAP_NO_PROJETO,
    rascunhoId: e.rascunho.id,
    episodioId: e.rascunho.episodioId,
    takeId: e.take.id,
    roteiroVersao: e.roteiro.versao,
    vozAlinhada: true,
    geradoEm: e.agora,
    // As partes do roteiro no tempo do take: as viradas do som e os nomes do rosto.
    secoes: secoesDoTake(e.roteiro, e.take, e.eventos ?? [], e.nomesDasFrases),
  }

  // O zod confere E completa os campos com padrao (cor, fonte, curva...),
  // exatamente como um projeto novo do Dangai nasce.
  const padrao = projectFileSchema.parse({
    version: PROJECT_FILE_VERSION,
    savedAt: e.agora,
    formato: 'short',
    audio: { path: e.narracaoPath, rel: null, fileName: basename(e.narracaoPath) },
    images,
    script: textoDoRoteiro(e.roteiro),
    subtitle: null,
    plan: { scenes },
    planOrigin: 'auto',
    planEdited: true,
    transcript,
    captions: buildCaptions(transcript),
    captionsEdited: false,
    // Recap sem legenda nao existe: o projeto ja nasce com ela ligada.
    captionsEnabled: true,
    sfxEnabled: false,
    hookText: gancho.texto,
    hookSec: gancho.sec,
    transcriptTravado: true,
    modulos: { [ID_DO_MODULO]: recap },
    // O `papel`/`corOriginal` da Edicao rapida vao para `modulos.recap` do item.
    ...(e.trilhas && e.trilhas.length > 0 ? { trilhas: e.trilhas.map((t) => trilhaParaONucleo(t)) } : {}),
    ...(e.sobreposicoes && e.sobreposicoes.length > 0 ? { sobreposicoes: e.sobreposicoes.map((o) => clipeParaONucleo(o)) } : {}),
  })
  // O estilo salvo por cima dos padroes (o project-file tem defaults proprios:
  // sem isto o projeto abria no estilo de fabrica). Passa de novo no zod.
  const file = e.estilo ? projectFileSchema.parse(aplicarEstiloNoProjeto(padrao, e.estilo)) : padrao

  return { file, pedacos, avisos }
}
