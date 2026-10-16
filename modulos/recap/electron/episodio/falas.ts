import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  episodeIndexSchema,
  statusDoCorte,
  temPlanos,
  type Cue,
  type EpisodeIndex,
  type EstadoDoCorte,
  type Exclusao,
  type IndexarFalasArgs,
  type PalpiteDoEpisodio,
} from '../../shared/episodio'
import { sugerirOpEd } from '../../shared/oped'
import { pastaDaBibliotecaStudio } from '../settings'
import { acharIndice, avisosDaLegenda, guardarAnterior, indexarEpisodio, lerIndiceDoDisco, mesmoCaminho } from './indice'
import { lerFaixa } from './legenda'
import { gravarJsonAtomico, indiceLembrado, lembrarIndice, marcacaoDaSerie } from './perfil'
import { garantirGravavel } from './protegidas'
import { indiceMovido, relocarIndice } from './relocar'
import { skipRangesDoAnime } from './skip-ranges'
import { sondarArquivo, type SondaDoArquivo } from './sondar'

/**
 * AS FALAS SEM ESPERAR O CORTE (decisao do Levi, 14/10): o indice do episodio
 * NASCE so com a legenda (cues, quem fala) e a sugestao de OP/ED, em segundos,
 * e o "Proximo: Roteiro" ja libera. As cenas chegam depois, pelo corte em
 * segundo plano (corte-fundo.ts), que ANEXA os planos a este mesmo indice.
 *
 * Onde mora enquanto espera: <bibliotecaStudio>/_indices/<id>/episodio.json,
 * com `biblioteca: { origem: 'studio', pasta: <essa pasta> }`. Assim
 * caminhoDoIndice('studio', pasta, id) aponta para o mesmo arquivo, o
 * indiceMovido nao o confunde com uma pasta que mudou de lugar, e o
 * salvarExclusoes/acharIndice/abrirIndicePorId funcionam sem mudar nada. O `_`
 * faz a varredura da Biblioteca pular a pasta.
 *
 * Os mesmos cuidados do indexarEpisodio (indice.ts), que continua sendo o
 * caminho do episodio JA cortado:
 * - as confirmadas do mesmo .mkv (id) passam para o indice novo;
 * - a marcacao da serie e o skip_ranges do Corte Cenas entram na sugestao;
 * - nada e gravado fora da biblioteca do Studio (garantirGravavel);
 * - o indice anterior no mesmo lugar e renomeado, nunca apagado.
 *
 * Nenhum `await` entre ler o indice do disco e grava-lo: o fim do corte
 * (corte-fundo.ts) le e grava o mesmo arquivo, e no meio de um await ele pode
 * ter acabado de anexar os planos e mudado o indice de lugar.
 */

/** A pasta do indice que espera o corte. */
export function pastaDoIndiceSemCenas(id: string): string {
  return join(pastaDaBibliotecaStudio(), '_indices', id)
}

/** O corte de um indice que acabou de nascer: ninguem pediu ainda. */
export function estadoPendente(agoraIso: string, motor: EstadoDoCorte['motor'] = 'studio', reconhecer = true): EstadoDoCorte {
  return {
    status: 'pendente',
    jobId: null,
    progresso: null,
    etapa: null,
    mensagem: '',
    motor,
    reconhecer,
    erro: null,
    inicio: null,
    atualizadoEm: agoraIso,
    descoberta: null,
  }
}

/**
 * Um indice COM cenas para este .mkv, cuja pasta ainda existe: o lembrado no
 * perfil ou o de _indices (episodio externo indexado antes). Caminhos ja
 * corrigidos quando a pasta mudou de lugar.
 */
function indiceComCenas(id: string): { indice: EpisodeIndex; caminho: string } | null {
  const candidatos = [acharIndice(id), join(pastaDoIndiceSemCenas(id), 'episodio.json')]
  const vistos = new Set<string>()
  for (const caminho of candidatos) {
    if (!caminho || vistos.has(caminho.toLowerCase())) continue
    vistos.add(caminho.toLowerCase())
    const lido = lerIndiceDoDisco(caminho)
    if (!lido || lido.id !== id || !temPlanos(lido) || statusDoCorte(lido) !== 'pronto') continue
    const indice = indiceMovido(lido, caminho) ? relocarIndice(lido, dirname(caminho)) : lido
    const pasta = indice.biblioteca.pasta
    // A pasta foi apagada ou trocada (biblioteca externa que saiu do lugar):
    // um indice cujos mp4 nao existem nao serve para o passo 4.
    if (!existsSync(join(pasta, 'metadata', 'shots.json')) || !existsSync(indice.planos[0]!.arquivo)) continue
    return { indice, caminho }
  }
  return null
}

function faixaPedida(sonda: SondaDoArquivo, pedida: IndexarFalasArgs['faixaLegenda']): SondaDoArquivo['legendas'][number] | null {
  const index = pedida === undefined ? sonda.legendaSugerida : pedida
  if (index === null) return null
  const faixa = sonda.legendas.find((f) => f.index === index)
  if (!faixa) throw new Error(`O arquivo nao tem a faixa de legenda ${index}.`)
  return faixa
}

function nomeDoPalpite(p: PalpiteDoEpisodio): string {
  return p.anime.trim() || 'Sem nome'
}

/**
 * O episodio que ja tem cenas: o indexarEpisodio de sempre sobre a pasta dele
 * (reaproveita quando nada mudou; com outra faixa, rele a legenda). O nome do
 * indice fica o dele -- e o da pasta das cenas, que agrupa na Biblioteca.
 */
async function comAsCenas(
  achado: { indice: EpisodeIndex },
  args: IndexarFalasArgs,
  index: number | null,
  avisar: (mensagem: string) => void,
): Promise<EpisodeIndex> {
  const { indice } = achado
  return indexarEpisodio(
    {
      path: args.path,
      pastaDoEpisodio: indice.biblioteca.pasta,
      origem: indice.biblioteca.origem,
      palpite: { anime: indice.anime, temporada: indice.temporada, episodio: indice.episodio, kind: indice.kind },
      faixaLegenda: index,
    },
    avisar,
  )
}

export async function indexarFalas(args: IndexarFalasArgs, avisar: (mensagem: string) => void): Promise<EpisodeIndex> {
  avisar('Conferindo o arquivo...')
  const sonda = await sondarArquivo(args.path)
  const faixa = faixaPedida(sonda, args.faixaLegenda)
  const index = faixa?.index ?? null
  const anime = nomeDoPalpite(args.palpite)

  // 1) Ja cortado (por aqui ou por fora): nada a esperar.
  const jaCortado = indiceComCenas(sonda.id)
  if (jaCortado) return comAsCenas(jaCortado, args, index, avisar)

  const destino = join(pastaDoIndiceSemCenas(sonda.id), 'episodio.json')
  garantirGravavel(dirname(destino))

  // 2) Ja havia um indice so com falas, com a mesma faixa: reaproveita. O que
  // muda sem reler nada e o nome corrigido na tela e o lugar do .mkv.
  {
    const lido = lerIndiceDoDisco(destino)
    const esperando = lido && lido.id === sonda.id && !temPlanos(lido) ? lido : null
    if (esperando && (esperando.faixaLegenda?.index ?? null) === index) {
      const corrigido: EpisodeIndex = {
        ...esperando,
        anime,
        temporada: args.palpite.temporada,
        episodio: args.palpite.episodio,
        kind: args.palpite.kind,
        fonte: { ...esperando.fonte, path: args.path },
      }
      const mudou =
        corrigido.anime !== esperando.anime ||
        corrigido.temporada !== esperando.temporada ||
        corrigido.episodio !== esperando.episodio ||
        corrigido.kind !== esperando.kind ||
        !mesmoCaminho(corrigido.fonte.path, esperando.fonte.path)
      if (mudou) {
        corrigido.atualizadoEm = new Date().toISOString()
        gravarJsonAtomico(destino, episodeIndexSchema.parse(corrigido))
      }
      lembrarIndice(sonda.id, destino)
      avisar('Falas ja lidas antes.')
      return mudou ? corrigido : esperando
    }
  }

  // 3) Le a legenda (o unico passo que demora: o ffmpeg atravessa o .mkv uma
  // vez; depois a faixa fica no cache do perfil).
  let cues: Cue[] = []
  let formato: string | null = null
  if (faixa) {
    avisar('Lendo a legenda...')
    const lida = await lerFaixa(args.path, sonda.id, faixa, sonda.startTimeSec)
    cues = lida.cues
    formato = lida.formato
  }

  // O corte pode ter terminado durante a leitura (trocou a faixa com as cenas
  // quase prontas): o indice agora tem cenas e mora em outro lugar.
  const cortouNoMeio = indiceComCenas(sonda.id)
  if (cortouNoMeio) return comAsCenas(cortouNoMeio, args, index, avisar)

  avisar('Procurando abertura e encerramento...')
  // Daqui ate gravar, sem await.
  const lido = lerIndiceDoDisco(destino)
  const anteriorDoMesmo = lido?.id === sonda.id ? lido : null
  const lembrado = anteriorDoMesmo ? null : indiceLembrado(sonda.id)
  const deOutroLugar = lembrado && !mesmoCaminho(lembrado, destino) ? lerIndiceDoDisco(lembrado) : null
  // So do MESMO .mkv: a OP de outro release em outro tempo nao entra aqui como confirmada.
  const herdadas: Exclusao[] =
    (anteriorDoMesmo ?? (deOutroLugar?.id === sonda.id ? deOutroLugar : null))?.exclusoes.filter((e) => e.confirmada) ?? []
  const sugeridas = sugerirOpEd({
    duracaoSec: sonda.duracaoSec,
    capitulos: sonda.capitulos,
    cues,
    skipRanges: skipRangesDoAnime([anime]),
    serie: marcacaoDaSerie(anime, args.palpite.temporada),
    confirmadas: herdadas,
  })

  const agora = new Date().toISOString()
  // Trocar a faixa de um indice que ja estava esperando nao mexe no corte dele.
  const corte = anteriorDoMesmo && !temPlanos(anteriorDoMesmo) && anteriorDoMesmo.corte ? anteriorDoMesmo.corte : estadoPendente(agora)
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
    planos: [],
    biblioteca: { origem: 'studio', pasta: dirname(destino) },
    // Quem diz se houve reconhecimento e o corte, quando os planos chegam.
    reconhecimento: 'desconhecido',
    avisos: avisosDaLegenda(faixa, cues, formato),
    criadoEm: agora,
    atualizadoEm: agora,
    corte,
  } satisfies EpisodeIndex)

  avisar('Salvando...')
  guardarAnterior(destino, lido)
  gravarJsonAtomico(destino, indice)
  lembrarIndice(sonda.id, destino)
  return indice
}
