import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { slugDoEpisodio, type EpisodeIndex } from '../../shared/episodio'
import { PROJECT_EXTENSION } from '@shared/project-file'
import { raizesDeBiblioteca } from '../episodio/procurar'
import { pastaDaBibliotecaStudio } from '../settings'

/**
 * ONDE o projeto montado mora.
 *
 * Padrao: <biblioteca do Studio>/_projetos/<anime curto> SxxEyy - <data hora>/,
 *   com <anime curto> SxxEyy <data>.dangai e o .wav da narracao dentro -- e o
 *   render do Dangai sai ali mesmo, como <...>-short.mp4. O anime CURTO
 *   (nomeCurtoDoAnime): no Magic Repo Man o nome cortava no meio da palavra
 *   ("...Support Fairy to Becom") e perdia o S01E02.
 *
 * Por que ali:
 *   - e a pasta do PROPRIO Studio (a unica em que ele grava), no mesmo disco
 *     das cenas que o projeto usa (G:, onde cabe);
 *   - o `_` faz a varredura da Biblioteca pular a pasta (library.ts e
 *     indice.ts pulam '_' e '.', como o _indices): o WAV e o .anirecap nao
 *     aparecem como episodio nem como cena;
 *   - fica a vista dele no Explorer (o userData e escondido) e anda junto se
 *     ele mover a biblioteca;
 *   - uma pasta POR MONTAGEM, com data e hora: abrir no editor de novo nunca
 *     grava por cima de um projeto que ele ja editou.
 * Os mp4 dos planos NAO sao copiados: o projeto aponta para eles onde estao
 * (Corte Cenas, AnCut ou Studio), so leitura, como a Biblioteca do Dangai faz.
 *
 * NUNCA numa biblioteca externa: pasta pedida dentro do Corte Cenas, do AnCut
 * ou da Biblioteca do Dangai e recusada.
 */

export const PASTA_DOS_PROJETOS = '_projetos'

/** Ate `maximo` letras sem partir palavra (uma palavra so maior que o teto e cortada nela). */
function semPartirPalavra(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto
  const corte = texto.slice(0, maximo + 1).lastIndexOf(' ')
  return (corte > 0 ? texto.slice(0, corte) : texto.slice(0, maximo)).trim()
}

/** Nome que o Windows aceita como pasta/arquivo. */
export function nomeSeguro(texto: string): string {
  const limpo = texto
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return semPartirPalavra(limpo, 80).replace(/[. ]+$/, '') || 'Recap'
}

/** Palavras que nao fecham o nome curto ("Magic Repo Man Dumped by" fica sem o "by"). */
const LIGACOES = new Set(['by', 'of', 'the', 'a', 'an', 'to', 'in', 'with', 'my', 'and', 'for', 'on', 'at', 'de', 'do', 'da', 'e', 'o', 'no', 'na', 'ni', 'wa', 'ga'])

/**
 * O nome CURTO do anime: a parte antes do subtitulo (": " ou " - ", como o
 * titulo curto do AniList: "Dr. Stone: Science Future" -> "Dr. Stone"), senao
 * as primeiras ~4 palavras, sem terminar em palavra de ligacao.
 */
export function nomeCurtoDoAnime(anime: string, maxPalavras = 4): string {
  const limpo = anime.replace(/\s+/g, ' ').trim()
  const antes = limpo.split(/\s*:\s+|\s+[-\u2013\u2014]\s+/)[0]!.trim()
  const palavras = (antes.length >= 2 ? antes : limpo).split(' ')
  let curto = palavras.slice(0, maxPalavras)
  while (curto.length > 1 && LIGACOES.has(curto[curto.length - 1]!.toLowerCase())) curto = curto.slice(0, -1)
  return curto.join(' ')
}

/** 'Dr. Stone S04E37', 'Magic Repo Man Dumped S01E02' (o nome da pasta, sem a data). */
export function nomeDoProjeto(indice: Pick<EpisodeIndex, 'anime' | 'temporada' | 'episodio' | 'kind'>): string {
  // O anime ate 60 letras (sem partir palavra): o SxxEyy sempre cabe no teto de 80.
  return nomeSeguro(`${semPartirPalavra(nomeCurtoDoAnime(indice.anime), 60)} ${slugDoEpisodio(indice.temporada, indice.episodio, indice.kind)}`)
}

/** O nome dos arquivos (.dangai, .wav e o -short.mp4 do render): o do projeto com a data ('... S01E02 2026-10-18'). */
export function nomeDosArquivos(nome: string, quando: Date): string {
  return nomeSeguro(`${nome} ${carimbo(quando).slice(0, 10)}`)
}

/** '2026-10-14 15h32' (hora local: e o que ele le na pasta). */
export function carimbo(d: Date): string {
  const dois = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())} ${dois(d.getHours())}h${dois(d.getMinutes())}`
}

/** A pasta nova padrao (nao cria). Ja existindo, ganha " (2)", " (3)"... */
export function pastaPadraoDoProjeto(nome: string, quando: Date, raizStudio = pastaDaBibliotecaStudio()): string {
  const base = join(raizStudio, PASTA_DOS_PROJETOS, `${nome} - ${carimbo(quando)}`)
  let pasta = base
  for (let n = 2; existsSync(pasta); n++) pasta = `${base} (${n})`
  return pasta
}

/** O .anirecap dentro da pasta, sem cobrir um que ja esteja la. */
export function arquivoDoProjeto(pasta: string, nome: string): string {
  let caminho = join(pasta, `${nome}.${PROJECT_EXTENSION}`)
  for (let n = 2; existsSync(caminho); n++) caminho = join(pasta, `${nome} (${n}).${PROJECT_EXTENSION}`)
  return caminho
}

function normal(caminho: string): string {
  return resolve(caminho).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function dentroDe(caminho: string, raiz: string): boolean {
  const a = normal(caminho)
  const r = normal(raiz)
  return a === r || a.startsWith(`${r}\\`)
}

/**
 * As pastas onde o Studio nunca grava: as bibliotecas externas que ele conhece
 * (Corte Cenas, AnCut, a do Dangai) e as do Corte Cenas que a regra do projeto
 * cita por nome, mesmo quando a configuracao delas nao foi achada.
 */
export function pastasProibidas(): string[] {
  const externas = (() => {
    try {
      return raizesDeBiblioteca()
        .filter((r) => r.origem !== 'studio')
        .map((r) => r.pasta)
    } catch {
      return []
    }
  })()
  const local = process.env['LOCALAPPDATA']
  return [...externas, 'G:\\App Corte Cenas', ...(local ? [join(local, 'CorteCenas')] : [])]
}

/** Recusa (com a frase para a tela) uma pasta pedida que nao serve para gravar o projeto. */
export function conferirPastaPedida(pasta: string, proibidas = pastasProibidas()): string {
  if (!isAbsolute(pasta)) throw new Error('Escolha uma pasta completa para o projeto.')
  const alvo = resolve(pasta)
  if (proibidas.some((raiz) => dentroDe(alvo, raiz))) {
    throw new Error('Essa pasta e de uma biblioteca de cenas (so leitura). Escolha outra pasta para o projeto.')
  }
  return alvo
}
