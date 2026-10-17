import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { KindDoEpisodio } from '../../shared/episodio'
import { animeParecido, tituloParecido } from './anime-parecido'
import { AVISO_DE_OUTRO_ARQUIVO, identidadeDaPasta, lerPastaDoEpisodio, sourceDaPasta } from './pasta-do-episodio'
import { garantirGravavel } from './protegidas'

/**
 * O CORTE DE OUTRO ARQUIVO na biblioteca do Studio.
 *
 * O motor (keyframe_extractor.cut_all_shots) reaproveita shots/NNNN.mp4 e
 * keyframes/NNNN_k.jpg PELO NUMERO, conferindo so as marcas shots/.export_mode
 * e shots/.cor -- nunca de qual video eles sairam. Quando o
 * shot_bounds.json.source muda (o mesmo episodio de outro release, que cai na
 * mesma pasta pelo nome e pela franquia), ele recalcula os limites e mesmo
 * assim pula cada clipe e keyframe que ja existe: a pasta fica com os tempos
 * de um release e as imagens de outro, sem aviso nenhum, e o reconhecimento
 * roda nos keyframes velhos.
 *
 * A correcao de verdade e no ancut-hub-engine (invalidar o reaproveitamento
 * quando os limites sao recalculados) e volta por copia (motor/STUDIO.md: o
 * motor daqui nao e "melhorado"). Ate la o Studio, dono desta biblioteca,
 * desarma o reaproveitamento antes de subir o motor: uma marca .cor que nao
 * bate com nenhuma cor faz o motor recortar os clipes E apagar e extrair de
 * novo os keyframes (o mesmo caminho de quando a conversao de cor muda). O
 * face_cache.npz se invalida sozinho, porque e chaveado por mtime e tamanho.
 *
 * Nada e apagado aqui. Qual pasta o motor vai usar so ele sabe (a memoria de
 * franquia dele decide), entao a marca vai em toda pasta plausivel: numa que
 * ele acabe nao usando, o custo e um recorte na proxima analise dela.
 */

/** Diferente de 'original' e de qualquer COR_VERSAO do motor ('sdr-mobius-1'). */
const MARCA_DE_OUTRO_ARQUIVO = 'studio-cortado-de-outro-arquivo'

function normal(caminho: string): string {
  return resolve(caminho).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function pastasDentro(pasta: string): string[] {
  try {
    return readdirSync(pasta, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
      .map((e) => join(pasta, e.name))
  } catch {
    return []
  }
}

function ehPasta(caminho: string): boolean {
  try {
    return statSync(caminho).isDirectory()
  } catch {
    return false
  }
}

/** A chave de nome do motor (anime_folders._chave): caixa e pontuacao fora, espacos unidos. */
function chaveDoMotor(nome: string): string {
  return nome
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]|_/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/**
 * A pasta de anime que o motor do Studio ja combinou para este nome digitado
 * (<dados>/cache/pastas_de_anime.json, memoria `nomes`). null quando nao ha.
 * So le: o arquivo e do motor.
 */
export function pastaLembradaPeloMotor(dadosDoMotor: string, anime: string): string | null {
  try {
    const cru = JSON.parse(readFileSync(join(dadosDoMotor, 'cache', 'pastas_de_anime.json'), 'utf8')) as {
      nomes?: Record<string, unknown>
    }
    const pasta = cru.nomes?.[chaveDoMotor(anime)]
    return typeof pasta === 'string' && pasta ? pasta : null
  } catch {
    return null
  }
}

/**
 * O id do .mkv de onde as cenas da pasta sairam, pelo episodio.json dela. So
 * vale num indice conferido: um "Usar essa analise" de outro release grava o
 * id DELE aqui, com o aviso de cenas de outro arquivo.
 */
function idDoCorte(pasta: string): string | null {
  try {
    const cru = JSON.parse(readFileSync(join(pasta, 'episodio.json'), 'utf8')) as { id?: unknown; avisos?: unknown }
    if (typeof cru.id !== 'string') return null
    const deOutro =
      Array.isArray(cru.avisos) && cru.avisos.some((a) => typeof a === 'string' && a.startsWith(AVISO_DE_OUTRO_ARQUIVO))
    return deOutro ? null : cru.id
  } catch {
    return null
  }
}

export interface PedidoDeCorte {
  /** A biblioteca do Studio (a outputDir do motor). */
  biblioteca: string
  path: string
  anime: string
  temporada: number
  episodio: number
  kind: KindDoEpisodio
  /** A impressao do .mkv, quando ja calculada: o mesmo arquivo so movido de lugar nao precisa recortar. */
  id: string | null
  /** pastaLembradaPeloMotor, para achar a pasta mesmo com outro nome ("Tensura"). */
  pastaLembrada: string | null
}

/**
 * Desarma o reaproveitamento nas pastas da biblioteca do Studio que o motor
 * pode usar para este episodio e que foram cortadas de OUTRO arquivo. Devolve
 * as pastas marcadas (para o log). Nunca lanca: falhar aqui so deixa o motor
 * como ele e.
 */
export function desarmarCorteDeOutroArquivo(pedido: PedidoDeCorte): string[] {
  const marcadas: string[] = []
  for (const serie of pastasDentro(pedido.biblioteca)) {
    const nomeDaSerie = basename(serie)
    for (const pasta of pastasDentro(serie)) {
      const ident = identidadeDaPasta(pasta)
      if (
        !ident ||
        ident.kind !== pedido.kind ||
        ident.temporada !== pedido.temporada ||
        ident.episodio !== pedido.episodio
      ) {
        continue
      }
      const source = sourceDaPasta(pasta)
      // Sem shot_bounds o motor nao tem limite velho para reaproveitar; com o
      // mesmo caminho, ele reaproveita tudo e esta certo.
      if (!source || normal(source) === normal(pedido.path)) continue
      // O mesmo .mkv, so em outro lugar: os clipes sao dele.
      if (pedido.id && idDoCorte(pasta) === pedido.id) continue
      const plausivel =
        animeParecido(nomeDaSerie, pedido.anime) ||
        (pedido.pastaLembrada !== null && nomeDaSerie.toLowerCase() === pedido.pastaLembrada.toLowerCase()) ||
        tituloParecido(lerPastaDoEpisodio(pasta)?.titulo ?? '', pedido.anime)
      if (!plausivel) continue
      const shots = join(pasta, 'shots')
      if (!ehPasta(shots)) continue
      try {
        garantirGravavel(pasta)
        writeFileSync(join(shots, '.cor'), MARCA_DE_OUTRO_ARQUIVO, 'utf8')
        marcadas.push(pasta)
      } catch (e) {
        console.error('[motor] nao deu para desarmar o reaproveitamento em', pasta, e)
      }
    }
  }
  return marcadas
}
