import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { ComoAchou, EpisodioEncontrado, OrigemDaBiblioteca, PalpiteDoEpisodio } from '../../shared/episodio'
import { getSettings, pastaDaBibliotecaStudio, pastaDeDocumentos } from '../settings'
import { fotosDoElenco } from '../elenco-reserva'
import { pastaDeDadosDoMotor } from '../motor'
import { episodiosEm } from '../library'
import { animeParecido, tituloParecido } from './anime-parecido'
import { impressaoLembrada } from './impressao'
import {
  AVISO_DE_OUTRO_ARQUIVO,
  contarPersonagens,
  identidadeDaPasta,
  lerPastaDoEpisodio,
  sourceDaPasta,
} from './pasta-do-episodio'
import { saidaDoCorteCenas } from './protegidas'
import { sondarArquivo } from './sondar'

/** Uma raiz de biblioteca que a busca varre. */
export interface RaizDeBiblioteca {
  origem: OrigemDaBiblioteca
  pasta: string
}

/** Barra, caixa e barra final nao importam no Windows. */
function normal(caminho: string): string {
  return resolve(caminho).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function dentroDe(caminho: string, raiz: string): boolean {
  const a = normal(caminho)
  const r = normal(raiz)
  return a === r || a.startsWith(`${r}\\`)
}

function ehPasta(caminho: string): boolean {
  try {
    return statSync(caminho).isDirectory()
  } catch {
    return false
  }
}

/**
 * As raizes que existem nesta maquina, sem repetir pasta, da mais especifica
 * para a mais generica (a mesma pasta por dois caminhos fica com a primeira):
 * - studio: a biblioteca do Studio (a unica em que ele grava);
 * - cortecenas / ancut: o `output_dir` do config que o Corte Cenas e o AnCut
 *   DIVIDEM. Nao ha como saber qual dos dois gravou por ultimo; a pasta padrao
 *   do AnCut instalado (<Documentos>/CorteCenas) conta como ancut, qualquer
 *   outra (a do Levi e G:\App Corte Cenas\Output) como cortecenas;
 * - ancut: a saida padrao do AnCut HUB instalado, quando e outra;
 * - dangai: a raiz da Biblioteca herdada do Dangai (settings.libraryDir).
 */
export function raizesDeBiblioteca(): RaizDeBiblioteca[] {
  const documentosDoAncut = join(pastaDeDocumentos(), 'CorteCenas')
  const lista: RaizDeBiblioteca[] = [{ origem: 'studio', pasta: pastaDaBibliotecaStudio() }]
  const saida = saidaDoCorteCenas()
  if (saida) lista.push({ origem: dentroDe(saida, documentosDoAncut) ? 'ancut' : 'cortecenas', pasta: saida })
  lista.push({ origem: 'ancut', pasta: join(documentosDoAncut, 'Output') })
  const { libraryDir } = getSettings()
  if (libraryDir) lista.push({ origem: 'dangai', pasta: libraryDir })

  const vistas = new Set<string>()
  return lista.filter((raiz) => {
    const chave = normal(raiz.pasta)
    if (vistas.has(chave) || !ehPasta(raiz.pasta)) return false
    vistas.add(chave)
    return true
  })
}

// --------------------------------------------------------------- indices do Studio

interface IndiceResumido {
  caminho: string
  id: string
  /** O .mkv de onde veio a LEGENDA -- nao necessariamente o que foi cortado. */
  fontePath: string
  pasta: string
  /**
   * O indice foi montado sobre cenas cortadas de OUTRO arquivo (achado fraco,
   * "Usar essa analise" num outro release). Ele nao prova nada sobre a pasta:
   * nem o id nem o fontePath dele dizem de onde as cenas sairam.
   */
  deOutroArquivo: boolean
}

/** So os campos que a busca usa, sem validar o resto (rapido e tolerante). */
function resumirIndice(caminho: string): IndiceResumido | null {
  try {
    const cru = JSON.parse(readFileSync(caminho, 'utf8')) as {
      id?: unknown
      fonte?: { path?: unknown }
      biblioteca?: { pasta?: unknown }
      avisos?: unknown
    }
    if (typeof cru.id !== 'string') return null
    return {
      caminho,
      id: cru.id,
      fontePath: typeof cru.fonte?.path === 'string' ? cru.fonte.path : '',
      pasta: typeof cru.biblioteca?.pasta === 'string' ? cru.biblioteca.pasta : '',
      deOutroArquivo:
        Array.isArray(cru.avisos) &&
        cru.avisos.some((a) => typeof a === 'string' && a.startsWith(AVISO_DE_OUTRO_ARQUIVO)),
    }
  } catch {
    return null
  }
}

/**
 * Os indices de episodios externos (<bibliotecaStudio>/_indices/<id>/episodio.json),
 * pela pasta. Uma pasta pode ter varios: um por .mkv indexado contra ela.
 */
function indicesExternos(): Map<string, IndiceResumido[]> {
  const mapa = new Map<string, IndiceResumido[]>()
  const pasta = join(pastaDaBibliotecaStudio(), '_indices')
  let nomes: string[] = []
  try {
    nomes = readdirSync(pasta)
  } catch {
    return mapa
  }
  for (const nome of nomes) {
    const resumo = resumirIndice(join(pasta, nome, 'episodio.json'))
    if (!resumo?.pasta) continue
    const chave = normal(resumo.pasta)
    mapa.set(chave, [...(mapa.get(chave) ?? []), resumo])
  }
  return mapa
}

/**
 * De onde vieram as fotos do elenco de um episodio cortado no Studio, quando
 * foi a reserva (elenco-reserva.ts) e nao a busca online. A tela mostra
 * "Fotos: Corte Cenas". So le um json; nunca lanca (o motor pode nem estar
 * configurado, como nos testes).
 */
function fotosDoEpisodio(anime: readonly string[], temporada: number): string | null {
  try {
    const dados = pastaDeDadosDoMotor()
    for (const nome of anime) {
      const r = nome.trim() ? fotosDoElenco(dados, nome, temporada) : null
      if (r) return r.origem
    }
  } catch {
    /* sem motor configurado: nao se sabe */
  }
  return null
}

// -------------------------------------------------------------------- procurar

const FORCA: Record<ComoAchou, number> = { source: 0, impressao: 1, nome: 2, 'anime+episodio': 3 }
const ORDEM_DA_ORIGEM: Record<OrigemDaBiblioteca, number> = { studio: 0, cortecenas: 1, ancut: 2, dangai: 3 }

function nomeDoArquivo(caminho: string): string {
  return basename(caminho.replace(/\\/g, '/')).toLowerCase()
}

/** A serie e a PASTA do usuario (o primeiro nivel abaixo da raiz), como na Biblioteca. */
function serieDaPasta(raiz: string, pasta: string): string {
  const r = normal(raiz)
  const p = normal(pasta)
  if (p.startsWith(`${r}\\`)) {
    const primeiro = resolve(pasta).slice(resolve(raiz).replace(/[\\/]+$/, '').length + 1).split(/[\\/]/)[0]
    if (primeiro && normal(join(raiz, primeiro)) !== p) return primeiro
  }
  return basename(dirname(pasta))
}

/**
 * Procura o episodio em todas as raizes. SO LE: nada e escrito nelas (nem o
 * index.db e aberto -- os personagens vem do shots.json).
 *
 * Do mais forte ao mais fraco (ComoAchou):
 * - source: o shot_bounds.json.source e este arquivo (pasta sem shot_bounds:
 *   o fonte.path de um indice do Studio que conferiu a pasta). Se um indice
 *   conferido da pasta tem OUTRA impressao, o arquivo foi trocado no mesmo
 *   caminho, e o caminho sozinho nao prova nada;
 * - impressao: um indice conferido da pasta tem a impressao deste arquivo
 *   (ele mudou de lugar);
 * - nome: o source tem o mesmo nome de arquivo E a pasta e do mesmo anime e
 *   episodio. Nome sozinho nao basta: o MakeMKV chama todo rip de
 *   title_t00.mkv;
 * - anime+episodio: so a pasta bate (anime parecido + SxxEyy).
 *
 * "Conferido" = o indice nao tem o aviso de cenas de outro arquivo. Os campos
 * do indice falam do .mkv da LEGENDA; so num indice conferido ele e tambem o
 * .mkv que foi cortado. Vazio = nao achou.
 */
export async function procurarEpisodio(
  caminho: string,
  palpite: PalpiteDoEpisodio,
): Promise<EpisodioEncontrado[]> {
  // A impressao da sonda que acabou de rodar; sem ela (arquivo que mudou, ou
  // busca chamada sozinha), calcula. Arquivo que nao abre so perde esse criterio.
  let id = await impressaoLembrada(caminho)
  if (!id) {
    try {
      id = (await sondarArquivo(caminho)).id
    } catch {
      id = null
    }
  }

  const slugDoPalpite = { temporada: palpite.temporada, episodio: palpite.episodio, kind: palpite.kind }
  const externos = indicesExternos()
  const vistas = new Set<string>()
  const achados: EpisodioEncontrado[] = []

  for (const raiz of raizesDeBiblioteca()) {
    for (const pasta of episodiosEm(raiz.pasta, 0)) {
      const chave = normal(pasta)
      if (vistas.has(chave)) continue
      vistas.add(chave)

      const source = sourceDaPasta(pasta)
      const proprio = resumirIndice(join(pasta, 'episodio.json'))
      // O episodio.json DENTRO da pasta e dela, mesmo que a pasta tenha mudado
      // de lugar depois (biblioteca do Studio movida): o caminho gravado nele
      // seria o da pasta velha.
      if (proprio) proprio.pasta = pasta
      const indices = [...(proprio ? [proprio] : []), ...(externos.get(chave) ?? [])]
      const conferidos = indices.filter((i) => !i.deOutroArquivo)
      const ident = identidadeDaPasta(pasta)
      const mesmoEpisodio =
        ident !== null &&
        ident.kind === slugDoPalpite.kind &&
        ident.temporada === slugDoPalpite.temporada &&
        ident.episodio === slugDoPalpite.episodio
      // Lida no maximo uma vez, e so quando precisa (titulo ou achado).
      let dadosLidos: ReturnType<typeof lerPastaDoEpisodio> | undefined
      const ler = (): ReturnType<typeof lerPastaDoEpisodio> => {
        if (dadosLidos === undefined) dadosLidos = lerPastaDoEpisodio(pasta)
        return dadosLidos
      }
      // A pasta pode ter outro nome ("Tensura"); o titulo que o motor gravou
      // no shots.json ainda pode bater.
      const mesmoAnime = (): boolean =>
        animeParecido(serieDaPasta(raiz.pasta, pasta), palpite.anime) || tituloParecido(ler()?.titulo ?? '', palpite.anime)
      // De onde as cenas sairam: o shot_bounds; sem ele, um indice conferido.
      const cortadoDe = source ?? conferidos.find((i) => i.fontePath)?.fontePath ?? null
      const trocadoNoLugar = id !== null && conferidos.length > 0 && !conferidos.some((i) => i.id === id)

      let como: ComoAchou | null = null
      if (cortadoDe && normal(cortadoDe) === normal(caminho) && !trocadoNoLugar) {
        como = 'source'
      } else if (id && conferidos.some((i) => i.id === id)) {
        como = 'impressao'
      } else if (mesmoEpisodio && mesmoAnime()) {
        // Arquivo trocado no mesmo caminho tem o mesmo nome e outro conteudo:
        // fica no achado fraco, com o aviso de release diferente.
        const mesmoNome = !!cortadoDe && nomeDoArquivo(cortadoDe) === nomeDoArquivo(caminho)
        como = mesmoNome && !trocadoNoLugar ? 'nome' : 'anime+episodio'
      }
      if (!como) continue

      const dados = ler()
      if (!dados) continue
      const indice = indices.find((i) => i.id === id) ?? indices[0] ?? null
      const serie = serieDaPasta(raiz.pasta, pasta)
      const temporada = ident?.temporada ?? palpite.temporada
      const personagens = contarPersonagens(dados)
      achados.push({
        origem: raiz.origem,
        pasta,
        anime: serie,
        temporada,
        episodio: ident?.episodio ?? palpite.episodio,
        kind: ident?.kind ?? palpite.kind,
        totalCenas: dados.cenas.length,
        personagens,
        comoAchou: como,
        indice: indice && normal(indice.pasta || pasta) === chave ? indice.caminho : null,
        analisadoEm: Number.isFinite(dados.mtimeShotsJson) ? new Date(dados.mtimeShotsJson).toISOString() : null,
        // So o Studio usa a reserva; e so faz sentido com alguem reconhecido.
        fotosDoElenco:
          raiz.origem === 'studio' && personagens.length > 0 ? fotosDoEpisodio([palpite.anime, serie], temporada) : null,
      })
    }
  }

  return achados.sort(
    (a, b) =>
      FORCA[a.comoAchou] - FORCA[b.comoAchou] ||
      ORDEM_DA_ORIGEM[a.origem] - ORDEM_DA_ORIGEM[b.origem] ||
      (b.analisadoEm ?? '').localeCompare(a.analisadoEm ?? ''),
  )
}
