import { existsSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import {
  episodeIndexSchema,
  lerIndice,
  slugDoEpisodio,
  type Cue,
  type EpisodeIndex,
  type Exclusao,
  type FaixaDeLegenda,
  type IndexarEpisodioArgs,
  type Plano,
} from '../../shared/episodio'
import { sugerirOpEd } from '../../shared/oped'
import { pastaDaBibliotecaStudio } from '../settings'
import { lerFaixa } from './legenda'
import {
  AVISO_DE_OUTRO_ARQUIVO,
  lerPastaDoEpisodio,
  personagensPorCena,
  type PastaDoEpisodio,
} from './pasta-do-episodio'
import {
  gravarJsonAtomico,
  guardarMarcacaoDaSerie,
  indiceLembrado,
  lembrarIndice,
  marcacaoDaSerie,
} from './perfil'
import { garantirGravavel } from './protegidas'
import { indiceMovido, relocarIndice } from './relocar'
import { skipRangesDoAnime } from './skip-ranges'
import { sondarArquivo, type SondaDoArquivo } from './sondar'

/**
 * O INDICE do episodio (episodio.json): a ponte entre o que o motor cortou e o
 * que o roteiro vai citar -- cada plano sabe o que e dito nele e por quem.
 *
 * ONDE MORA, sempre dentro da biblioteca do Studio:
 * - episodio cortado pelo Studio: <pastaDoEpisodio>/episodio.json, ao lado de
 *   shots/;
 * - episodio de biblioteca EXTERNA (AnCut, Corte Cenas, a do Dangai):
 *   <bibliotecaStudio>/_indices/<id>/episodio.json. A pasta externa fica
 *   intocada; o `_` na frente faz a varredura da Biblioteca pular a pasta; e a
 *   chave pelo id (a impressao do .mkv) nao colide com a pasta que o motor do
 *   Studio criaria se o mesmo episodio fosse cortado aqui depois.
 *
 * BASE DE TEMPO: o shots.json do AnCut conta quadro/fps do primeiro quadro (o
 * OpenCV le o video do comeco, sem PTS), e a legenda vem em PTS do container.
 * As duas se encontram descontando da legenda o start_time do stream de video
 * (ver sondar.ts e legenda.ts). Nos .mkv medidos ele e 0 e a conta e
 * identidade; quando nao for, e essa subtracao que alinha. O teste
 * (scripts/teste/v-episodio.ts) confere quadro a quadro no Dr. Stone S4E37 do
 * Corte Cenas que a cena que contem uma fala mostra o mesmo quadro que o .mkv
 * no tempo da fala.
 */

export { configurarEpisodios, pastaDoPerfil } from './perfil'

/** Abaixo disso de sobreposicao, a fala so encosta no corte e nao e da cena. */
const SOBREPOSICAO_MINIMA_SEC = 0.2

export function mesmoCaminho(a: string, b: string): boolean {
  const n = (s: string): string => resolve(s).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return n(a) === n(b)
}

/** Onde fica o episodio.json deste episodio, pela regra do comentario do topo. */
export function caminhoDoIndice(origem: IndexarEpisodioArgs['origem'], pastaDoEpisodio: string, id: string): string {
  if (origem === 'studio') return join(pastaDoEpisodio, 'episodio.json')
  return join(pastaDaBibliotecaStudio(), '_indices', id, 'episodio.json')
}

export function lerIndiceDoDisco(caminho: string): EpisodeIndex | null {
  try {
    return lerIndice(JSON.parse(readFileSync(caminho, 'utf8')))
  } catch {
    return null
  }
}

/**
 * Desde quando o indice conhece as cenas da pasta, em ms. Num indice que nasceu
 * so com as falas e ganhou os planos depois (corte em segundo plano, ver
 * corte-fundo.ts), e o momento em que eles foram anexados -- o `criadoEm` e de
 * ANTES do corte, e o shots.json gravado no fim do corte pareceria mais novo
 * que o indice (o reaproveitar refaria tudo a toa).
 */
export function planosDesde(indice: Pick<EpisodeIndex, 'criadoEm' | 'corte'>): number {
  const anexados = indice.corte?.status === 'pronto' ? Date.parse(indice.corte.atualizadoEm) : Number.NaN
  return Number.isFinite(anexados) ? anexados : Date.parse(indice.criadoEm)
}

/** "2026-10-13T13:55:01.123Z" -> "20261013-135501". */
function carimbo(iso: string): string {
  const d = new Date(iso)
  const valido = Number.isFinite(d.getTime()) ? d : new Date()
  return valido.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

/** Guarda o indice anterior ao lado, com o carimbo dele no nome. Nunca apaga. */
export function guardarAnterior(caminho: string, anterior: EpisodeIndex | null): void {
  if (!existsSync(caminho)) return
  let quando = anterior?.atualizadoEm ?? ''
  if (!quando) {
    try {
      quando = statSync(caminho).mtime.toISOString()
    } catch {
      quando = new Date().toISOString()
    }
  }
  const base = join(dirname(caminho), `episodio.${carimbo(quando)}`)
  let destino = `${base}.json`
  for (let n = 2; existsSync(destino); n += 1) destino = `${base}-${n}.json`
  renameSync(caminho, destino)
}

// -------------------------------------------------------------------- planos

/** A fala cruza o plano o bastante para ser dele: 0,2 s ou metade da fala. */
function cueNoPlano(cue: Cue, start: number, end: number): boolean {
  const dentro = Math.min(cue.end, end) - Math.max(cue.start, start)
  const duracao = cue.end - cue.start
  if (duracao <= 0) return cue.start >= start && cue.start < end
  return dentro >= Math.min(SOBREPOSICAO_MINIMA_SEC, duracao * 0.5)
}

export function montarPlanos(dados: PastaDoEpisodio, cues: readonly Cue[]): Plano[] {
  // Com as grafias do mesmo personagem ja unidas: o roteiro tem que ver UM
  // "Saionji, Ukyou", e nao ele e um "Ukyo Saionji" em cenas diferentes.
  const personagens = personagensPorCena(dados)
  return dados.cenas.map((cena, i) => {
    const daCena = cues.filter((c) => c.start < cena.end && c.end >= cena.start && cueNoPlano(c, cena.start, cena.end))
    const falantes: string[] = []
    for (const c of daCena) {
      if (c.tipo === 'fala' && c.falante && !falantes.includes(c.falante)) falantes.push(c.falante)
    }
    return {
      id: cena.id,
      start: cena.start,
      end: cena.end,
      arquivo: cena.arquivo,
      keyframe: cena.keyframe,
      cueIds: daCena.map((c) => c.id),
      falantes,
      personagens: (personagens[i] ?? []).map((p) => ({
        nome: p.nome,
        conf: p.conf,
        fonte: 'ancut' as const,
      })),
    }
  })
}

/**
 * Se o motor procurou personagens nesta pasta. O timings.json do motor lista as
 * etapas que rodaram: com analyze_shots, procurou (mesmo sem achar ninguem);
 * sem ela, foi so corte. Sem timings.json (pasta antiga), so da para afirmar
 * quando alguma cena tem personagem.
 */
export function reconhecimentoDaPasta(dados: PastaDoEpisodio, planos: readonly Plano[]): EpisodeIndex['reconhecimento'] {
  if (planos.some((p) => p.personagens.length > 0)) return 'feito'
  try {
    const t = JSON.parse(readFileSync(join(dados.pasta, 'metadata', 'timings.json'), 'utf8')) as {
      stages?: Record<string, unknown>
    }
    return t.stages && 'analyze_shots' in t.stages ? 'feito' : 'pulado'
  } catch {
    return 'desconhecido'
  }
}

/**
 * Conferencias de tempo antes de confiar no cruzamento cena x fala.
 *
 * `conferidoAntes`: este mesmo .mkv (id) ja tinha um indice sem aviso nesta
 * pasta, e a pasta nao mudou desde entao -- o arquivo so mudou de lugar. Sem
 * isso, source em outro caminho sempre avisa, mesmo com o mesmo nome: nome
 * igual nao prova nada (o MakeMKV chama todo rip de title_t00.mkv). O comeco
 * do aviso (AVISO_DE_OUTRO_ARQUIVO) e o que a busca le para nao chamar esta
 * pasta de "mesmo arquivo" depois.
 */
export function avisosDeTempo(
  sonda: Pick<SondaDoArquivo, 'duracaoSec'>,
  dados: PastaDoEpisodio,
  caminho: string,
  conferidoAntes: boolean,
): string[] {
  const avisos: string[] = []
  const ultimo = Math.max(...dados.cenas.map((c) => c.end))
  if (ultimo > sonda.duracaoSec + 1) {
    avisos.push(
      `As cenas vao ate ${Math.round(ultimo)}s, mas o video tem ${Math.round(sonda.duracaoSec)}s: a pasta pode ser de outro arquivo.`,
    )
  }
  if (dados.source && !mesmoCaminho(dados.source, caminho) && !conferidoAntes) {
    const outro = basename(dados.source.replace(/\\/g, '/'))
    avisos.push(
      outro.toLowerCase() !== basename(caminho.replace(/\\/g, '/')).toLowerCase()
        ? `${AVISO_DE_OUTRO_ARQUIVO} (${outro}). Se for outro release, falas e cenas podem nao bater.`
        : `${AVISO_DE_OUTRO_ARQUIVO} com o mesmo nome, em outro lugar (${dados.source}). Se for este arquivo movido, tudo certo; se nao, falas e cenas podem nao bater.`,
    )
  }
  return avisos
}

export function avisosDaLegenda(faixa: FaixaDeLegenda | null, cues: readonly Cue[], formato: string | null): string[] {
  if (!faixa) return ['Sem legenda de texto: o episodio fica sem falas.']
  const falas = cues.filter((c) => c.tipo === 'fala')
  if (falas.length === 0) return ['A legenda escolhida nao tem falas (so placas ou musica).']
  if (!falas.some((c) => c.falante)) {
    return formato === 'ass'
      ? ['Legenda sem o campo Name: falas sem falante.']
      : ['Legenda .srt nao diz quem fala: falas sem falante.']
  }
  return []
}

// ------------------------------------------------------------------- indexar

export async function indexarEpisodio(
  args: IndexarEpisodioArgs,
  avisar: (mensagem: string) => void,
): Promise<EpisodeIndex> {
  avisar('Conferindo o arquivo...')
  const sonda = await sondarArquivo(args.path)

  const dados = lerPastaDoEpisodio(args.pastaDoEpisodio)
  if (!dados) throw new Error(`A pasta do episodio nao tem metadata/shots.json legivel: ${args.pastaDoEpisodio}`)
  if (dados.cenas.length === 0) throw new Error(`Nenhuma cena (shots/*.mp4) encontrada em ${args.pastaDoEpisodio}.`)

  const indexDaFaixa = args.faixaLegenda === undefined ? sonda.legendaSugerida : args.faixaLegenda
  const faixa = indexDaFaixa === null ? null : (sonda.legendas.find((f) => f.index === indexDaFaixa) ?? null)
  if (indexDaFaixa !== null && !faixa) throw new Error(`O arquivo nao tem a faixa de legenda ${indexDaFaixa}.`)

  if (args.origem === 'studio') garantirGravavel(args.pastaDoEpisodio)
  const destino = caminhoDoIndice(args.origem, args.pastaDoEpisodio, sonda.id)
  garantirGravavel(dirname(destino))

  const anime = args.palpite.anime.trim() || basename(dirname(args.pastaDoEpisodio)) || 'Sem nome'
  const lido = lerIndiceDoDisco(destino)
  // A pasta do episodio mudou de lugar com o indice dentro (a biblioteca do
  // Studio foi movida): os caminhos dele apontam para a pasta velha. Com a
  // raiz trocada ele volta a valer aqui, e o reaproveitar abaixo regrava.
  const movido = lido !== null && args.origem === 'studio' && indiceMovido(lido, destino)
  const anterior = lido && movido ? relocarIndice(lido, args.pastaDoEpisodio) : lido

  // REAPROVEITAR: mesmo .mkv (id), mesma pasta, mesma faixa, e a pasta nao
  // mudou desde o indice (mesmos mp4 e shots.json mais velho que ele).
  if (anterior && !args.refazer) {
    const mesmasCenas =
      anterior.planos.length === dados.cenas.length &&
      dados.cenas.every((c, i) => anterior.planos[i]?.id === c.id) &&
      dados.mtimeShotsJson <= planosDesde(anterior)
    if (
      anterior.id === sonda.id &&
      mesmoCaminho(anterior.biblioteca.pasta, args.pastaDoEpisodio) &&
      (anterior.faixaLegenda?.index ?? null) === (faixa?.index ?? null) &&
      mesmasCenas
    ) {
      // O que muda sem refazer nada: o nome corrigido na tela e o lugar do .mkv.
      const corrigido: EpisodeIndex = {
        ...anterior,
        anime,
        temporada: args.palpite.temporada,
        episodio: args.palpite.episodio,
        kind: args.palpite.kind,
        fonte: { ...anterior.fonte, path: args.path },
      }
      const mudou =
        movido ||
        corrigido.anime !== anterior.anime ||
        corrigido.temporada !== anterior.temporada ||
        corrigido.episodio !== anterior.episodio ||
        corrigido.kind !== anterior.kind ||
        !mesmoCaminho(corrigido.fonte.path, anterior.fonte.path)
      if (mudou) {
        corrigido.atualizadoEm = new Date().toISOString()
        gravarJsonAtomico(destino, episodeIndexSchema.parse(corrigido))
      }
      lembrarIndice(sonda.id, destino)
      avisar('Falas ja lidas antes.')
      return mudou ? corrigido : anterior
    }
  }

  let cues: Cue[] = []
  let formato: string | null = null
  if (faixa) {
    avisar('Lendo a legenda...')
    const lida = await lerFaixa(args.path, sonda.id, faixa, sonda.startTimeSec)
    cues = lida.cues
    formato = lida.formato
  }

  avisar('Cruzando falas com as cenas...')
  const planos = montarPlanos(dados, cues)

  avisar('Procurando abertura e encerramento...')
  // Refazendo, o que o usuario ja confirmou volta como estava. Primeiro indice
  // NESTE lugar de um .mkv que ja tinha indice em outro (indexado do Corte
  // Cenas e agora cortado pelo Studio, por exemplo): as confirmadas de la
  // valem aqui, porque o tempo e o do .mkv e nao o da pasta.
  //
  // So do MESMO .mkv (id), dos dois lados. Na origem 'studio' o destino e a
  // pasta do episodio, e o indice que estava la pode ser de outro release: a
  // OP dele em outro tempo entraria aqui como ja confirmada, apagaria a
  // sugestao certa deste arquivo e, salva, viraria a marcacao da serie. A
  // marcacao da serie (series.json) continua sugerindo o que valia la.
  const anteriorDoMesmo = anterior?.id === sonda.id ? anterior : null
  const outro = anteriorDoMesmo ? null : indiceLembrado(sonda.id)
  const deOutroLugar = outro && !mesmoCaminho(outro, destino) ? lerIndiceDoDisco(outro) : null
  const herdadas: Exclusao[] =
    (anteriorDoMesmo ?? (deOutroLugar?.id === sonda.id ? deOutroLugar : null))?.exclusoes.filter(
      (e) => e.confirmada,
    ) ?? []
  const conferidoAntes =
    anteriorDoMesmo !== null &&
    mesmoCaminho(anteriorDoMesmo.biblioteca.pasta, args.pastaDoEpisodio) &&
    !anteriorDoMesmo.avisos.some((a) => a.startsWith(AVISO_DE_OUTRO_ARQUIVO)) &&
    dados.mtimeShotsJson <= planosDesde(anteriorDoMesmo)
  const serieDaPasta = basename(dirname(args.pastaDoEpisodio))
  const sugeridas = sugerirOpEd({
    duracaoSec: sonda.duracaoSec,
    capitulos: sonda.capitulos,
    cues,
    skipRanges: skipRangesDoAnime([anime, serieDaPasta, dados.titulo]),
    serie: marcacaoDaSerie(anime, args.palpite.temporada),
    confirmadas: herdadas,
  })

  const agora = new Date().toISOString()
  const indice = episodeIndexSchema.parse({
    versao: 1,
    id: sonda.id,
    fonte: {
      path: args.path,
      tamanho: sonda.tamanho,
      duracaoSec: sonda.duracaoSec,
      fps: sonda.fps,
      startTimeSec: sonda.startTimeSec,
      largura: sonda.largura,
      altura: sonda.altura,
      hdr: sonda.hdr,
      codec: sonda.codec,
    },
    anime,
    temporada: args.palpite.temporada,
    episodio: args.palpite.episodio,
    kind: args.palpite.kind,
    faixaLegenda: faixa,
    cues,
    exclusoes: [...herdadas, ...sugeridas].sort((a, b) => a.start - b.start),
    planos,
    // O episodio que o recap moveu para o AnCut continua sendo dele (a busca
    // pode ter achado a pasta como Corte Cenas ou como a Biblioteca do AnCut).
    biblioteca:
      anterior?.biblioteca.movidoDoRecap && mesmoCaminho(anterior.biblioteca.pasta, args.pastaDoEpisodio)
        ? anterior.biblioteca
        : { origem: args.origem, pasta: args.pastaDoEpisodio },
    reconhecimento: reconhecimentoDaPasta(dados, planos),
    avisos: [...avisosDaLegenda(faixa, cues, formato), ...avisosDeTempo(sonda, dados, args.path, conferidoAntes)],
    criadoEm: agora,
    atualizadoEm: agora,
  } satisfies EpisodeIndex)

  avisar('Salvando...')
  guardarAnterior(destino, anterior)
  gravarJsonAtomico(destino, indice)
  lembrarIndice(sonda.id, destino)
  return indice
}

// ---------------------------------------------------------------- exclusoes

/** Acha o episodio.json pelo id: o lembrado no perfil, o de _indices ou uma varredura curta. */
export function acharIndice(id: string): string | null {
  const confere = (caminho: string | null): boolean => {
    if (!caminho || !existsSync(caminho)) return false
    try {
      return (JSON.parse(readFileSync(caminho, 'utf8')) as { id?: unknown }).id === id
    } catch {
      return false
    }
  }
  const lembrado = indiceLembrado(id)
  if (confere(lembrado)) return lembrado

  const raiz = pastaDaBibliotecaStudio()
  const externo = join(raiz, '_indices', id, 'episodio.json')
  if (confere(externo)) return externo

  // Episodio cortado pelo Studio: <raiz>/<anime>/<SxxEyy>/episodio.json.
  const varrer = (pasta: string, nivel: number): string | null => {
    const aqui = join(pasta, 'episodio.json')
    if (nivel > 0 && confere(aqui)) return aqui
    if (nivel >= 3) return null
    let nomes: string[] = []
    try {
      nomes = readdirSync(pasta, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
        .map((e) => e.name)
    } catch {
      return null
    }
    for (const nome of nomes) {
      const achado = varrer(join(pasta, nome), nivel + 1)
      if (achado) return achado
    }
    return null
  }
  return varrer(raiz, 0)
}

/**
 * Troca a lista inteira de exclusoes do indice `indiceId` e grava.
 *
 * As marcas vem como a regua mandou: `confirmada: true` no que o usuario
 * confirmou, ajustou ou desenhou; sugestao ainda nao vista continua false. As
 * confirmadas de OP/ED/previa viram a marcacao da serie, sugerida no proximo
 * episodio (origem 'serie').
 */
export async function salvarExclusoes(indiceId: string, exclusoes: Exclusao[]): Promise<EpisodeIndex> {
  const caminho = acharIndice(indiceId)
  if (!caminho) throw new Error('Nao achei os dados desse episodio no disco. Analise o episodio de novo.')
  garantirGravavel(dirname(caminho))

  const lido = lerIndiceDoDisco(caminho)
  if (!lido) throw new Error('Os dados desse episodio nao abrem (episodio.json quebrado). Analise o episodio de novo.')
  // A pasta do episodio mudou de lugar com o indice dentro (a biblioteca do
  // Studio foi movida) e ele ainda nao foi regravado -- o "voltar onde parou"
  // abre pelo abrirIndicePorId, que corrige so em memoria. Gravar o lido
  // devolveria a tela os caminhos da pasta velha, e o "Ler de novo" quebrava.
  const atual = indiceMovido(lido, caminho) ? relocarIndice(lido, dirname(caminho)) : lido

  const indice = episodeIndexSchema.parse({
    ...atual,
    exclusoes: [...exclusoes].sort((a, b) => a.start - b.start),
    atualizadoEm: new Date().toISOString(),
  })
  gravarJsonAtomico(caminho, indice)
  lembrarIndice(indice.id, caminho)

  const daSerie = indice.exclusoes.filter((e) => e.confirmada && e.motivo !== 'manual')
  if (daSerie.length > 0) {
    try {
      guardarMarcacaoDaSerie(indice.anime, indice.temporada, {
        episodio: slugDoEpisodio(indice.temporada, indice.episodio, indice.kind),
        duracaoSec: indice.fonte.duracaoSec,
        exclusoes: daSerie.map(({ start, end, motivo }) => ({ start, end, motivo })),
      })
    } catch {
      // A memoria da serie e so sugestao para o proximo episodio: nao vale
      // derrubar o salvar por ela.
    }
  }
  return indice
}
