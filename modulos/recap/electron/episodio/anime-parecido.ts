import { chaveDoAnime } from './perfil'

/**
 * Se dois nomes de anime falam da MESMA serie. Usado pela busca nas
 * bibliotecas (procurar.ts) e pela guarda do corte de outro arquivo
 * (corte-de-outro-arquivo.ts).
 *
 * Mora sozinho, sem nada pesado em volta, porque o motor.ts tambem precisa
 * dele: importar do procurar.ts fecharia um ciclo motor -> procurar -> sondar
 * -> motor.
 */

/** Marcador de temporada no FIM do nome nao muda a serie ("Re Zero 4th Season"). */
const SUFIXO_DE_TEMPORADA =
  /\s+(?:\d+(?:st|nd|rd|th)\s+(?:season|cour)|(?:season|cour|part|parte|temporada)\s+\d+|s\d{1,2}|final\s+season)$/

function semTemporada(chave: string): string {
  let atual = chave
  for (;;) {
    const novo = atual.replace(SUFIXO_DE_TEMPORADA, '').trim()
    if (novo === atual || !novo) return atual
    atual = novo
  }
}

/**
 * "Dr Stone" (do nome do arquivo) e "Dr. Stone" (pasta) sao a mesma serie:
 * caixa e pontuacao fora, sufixo de temporada fora, e entao igual ou as mesmas
 * palavras em outra ordem.
 *
 * Um nome que e so o COMECO do outro NAO conta. "Naruto" x "Naruto
 * Shippuden", "Bleach" x "Bleach Sennen Kessen-hen" e "Dragon Ball" x "Dragon
 * Ball Super" sao animes diferentes que repetem o SxxEyy, e juntar os dois
 * punha as falas de um nas cenas do outro -- e a OP/ED salva ia para a serie
 * errada no series.json.
 */
export function animeParecido(a: string, b: string): boolean {
  const x = semTemporada(chaveDoAnime(a))
  const y = semTemporada(chaveDoAnime(b))
  if (!x || !y) return false
  if (x === y) return true
  const ordenadas = (s: string): string => s.split(' ').sort().join(' ')
  return ordenadas(x) === ordenadas(y)
}

/**
 * O titulo que o motor gravou no shots.json pode trazer o subtitulo da
 * temporada depois de dois-pontos ("Dr. STONE: SCIENCE FUTURE"). So nele, e so
 * antes dos dois-pontos, o comeco tambem vale -- nunca no nome de pasta, que e
 * onde "Naruto" e "Naruto Shippuden" moram lado a lado.
 */
export function tituloParecido(titulo: string, anime: string): boolean {
  if (!titulo) return false
  if (animeParecido(titulo, anime)) return true
  const doisPontos = titulo.indexOf(':')
  return doisPontos > 0 && animeParecido(titulo.slice(0, doisPontos), anime)
}
