import { basename, dirname, extname } from 'node:path'
import type { KindDoEpisodio, PalpiteDoEpisodio } from '../../shared/episodio'

/**
 * Anime, temporada e episodio pelo NOME do arquivo: porte fiel de
 * `parse_filename` (motor/app/video_ingest.py, o mesmo do Corte Cenas).
 *
 * Por que portar em vez de so chamar o `parse` do motor: abrir o Python custa
 * de 0,2 s (quente) a uns 4 s (frio, antivirus olhando o venv), e o motor pode
 * nem estar instalado -- o passo 1 tem que mostrar o palpite mesmo assim. A
 * sonda usa o motor quando ele responde a tempo (fonte unica da heuristica) e
 * cai neste porte quando nao.
 *
 * FIEL quer dizer: mesmas regras, mesma ordem, mesmos defeitos. O teste
 * (scripts/teste/v-episodio-nome.ts) compara este porte com o Python em todos
 * os .mkv da pasta Downloads. Corrigir um caso aqui e nao la faria o palpite
 * mudar conforme o motor responde ou nao -- correcao vai nos dois lados.
 *
 * Diferencas de motor de regex: o `\b`, `\d` e `\w` do Python 3 sao Unicode, e
 * os do JavaScript sao ASCII. Por isso o `\b` aqui e montado com classes
 * Unicode (ver `re`), e os padroes levam a flag `u`.
 */

/** `\b` do Python (Unicode), escrito com lookarounds. */
const W = '[\\p{L}\\p{N}_]'
const LIMITE = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`

/** Monta a regex trocando `\b` pelo limite Unicode. `\d` vira `\p{Nd}`, como no Python. */
function re(fonte: string, flags = ''): RegExp {
  const convertida = fonte.replace(/\\b/g, LIMITE).replace(/\\d/g, '\\p{Nd}')
  return new RegExp(convertida, `u${flags}`)
}

/**
 * int() do Python aceita digito Unicode (o 3 de largura cheia = 3); o Number() nao. NFKC cobre
 * os de largura cheia e os matematicos; o resto (arabe, devanagari...) desce
 * ate o "zero" do bloco, que e o primeiro de 10 digitos seguidos.
 */
function inteiro(texto: string): number {
  let saida = ''
  for (const ch of texto.normalize('NFKC')) {
    if (/[0-9]/.test(ch) || !/\p{Nd}/u.test(ch)) {
      saida += ch
      continue
    }
    const cp = ch.codePointAt(0)!
    let zero = cp
    while (cp - zero < 9 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1
    saida += String(cp - zero)
  }
  return Number.parseInt(saida, 10)
}

/** str.strip(chars) do Python. */
function aparar(texto: string, chars: string): string {
  let i = 0
  let f = texto.length
  while (i < f && chars.includes(texto[i]!)) i += 1
  while (f > i && chars.includes(texto[f - 1]!)) f -= 1
  return texto.slice(i, f)
}

// Combined season+episode patterns -- strongest signal when both are present.
const SE_PATTERNS = [
  re('\\b[Ss](\\d{1,2})[Ee](\\d{1,3})\\b'),
  re('\\bSeason\\s*(\\d{1,2}).*?Episode\\s*(\\d{1,3})\\b', 'i'),
  re('\\b(\\d{1,2})x(\\d{1,3})\\b'),
]

// Season-only signals. "4th Season" ganha de "Season 01" (onde 01 e episodio).
const SEASON_PATTERNS = [
  re('\\b(\\d{1,2})(?:st|nd|rd|th)\\s*Season\\b', 'i'),
  re('\\b[Ss](\\d{1,2})\\b'),
  re('\\bSeason\\s*(\\d{1,2})\\b', 'i'),
  re('\\bTemporada\\s*(\\d{1,2})\\b', 'i'),
]

const EPISODE_PATTERNS = [
  re('\\s-\\s*(\\d{1,3})(?:\\s*(?:v\\d+)?(?:\\s|$))'),
  re('\\bEpis[oó]dio\\s*(\\d{1,3})\\b', 'i'),
  re('\\bEpisode\\s*(\\d{1,3})\\b', 'i'),
  re('\\bEp\\.?\\s*(\\d{1,3})\\b', 'i'),
  re('\\s#(\\d{1,3})\\b'),
]

const BRACKETED = re('\\[[^\\]]*\\]|\\{[^}]*\\}', 'g')
const QUALITY_PAREN = re(
  '\\((?:\\d{3,4}p|\\d{3,4}x\\d{3,4}|BD|BDRip|DVD|DVDRip|WEB|WEB-?DL|HDTV|' +
    'Hi10p?|Ma10p?|x264|x265|HEVC|AAC|FLAC|Dual.?Audio|Multi.?Audio)\\)',
  'gi',
)
const TRAILING_JUNK = re(
  '(?:\\b(?:1080p|720p|480p|2160p|4k|x264|x265|HEVC|AAC|FLAC|BluRay|BDRip|WEB-?DL|HDTV)\\b.*)$',
  'gi',
)

/** clean_title: tira [tags], (qualidade) e lixo do fim, e troca . e _ por espaco. */
export function limparTitulo(cru: string): string {
  let s = cru.replace(BRACKETED, ' ')
  s = s.replace(QUALITY_PAREN, ' ')
  s = s.replace(TRAILING_JUNK, ' ')
  s = s.replace(/[._]+/gu, ' ')
  s = s.replace(re('\\s+', 'g'), ' ')
  return aparar(s, ' -_.')
}

const STRIP_ANIME = [
  re('\\s*-?\\s*\\b[Ss]\\d{1,2}[Ee]\\d{1,3}\\b.*$', 'g'),
  re('\\s*-?\\s*\\b\\d+(?:st|nd|rd|th)\\s*Season\\b.*$', 'gi'),
  re('\\s*-?\\s*\\bSeason\\s*\\d+\\b.*$', 'gi'),
  re('\\s*-?\\s*\\bTemporada\\s*\\d+\\b.*$', 'gi'),
  re('\\s*-?\\s*\\bEpisode\\s*\\d+\\b.*$', 'gi'),
  re('\\s*-?\\s*\\bEpis[oó]dio\\s*\\d+\\b.*$', 'gi'),
  re('\\s*-?\\s*\\bEp\\.?\\s*\\d+\\b.*$', 'gi'),
  re('\\s+\\b[Ss]\\d{1,2}\\b.*$', 'g'),
  re('\\s+-\\s*\\d{1,3}(?:\\s|$).*$', 'g'),
  re('\\s+\\d{1,2}x\\d{1,3}\\b.*$', 'g'),
]

// Pastas de temporada: o nome do anime esta um nivel acima.
const SEASON_DIR = re(
  '^(?:season\\s*\\d*|s\\d{1,2}|temporada\\s*\\d*|specials?|extras?|ovas?|filmes?|movies?)$',
  'i',
)
// Pastas genericas: dali para cima e nome de usuario, raiz do disco.
const STORAGE_DIR = re(
  '^(?:downloads?|desktop|documents?|documentos|videos?|vídeos|animes?|' +
    'series|séries|torrents?|users|home|midia|mídia|media)$',
  'i',
)

const LEADING_SE_TAG = re('^\\s*[Ss]\\d{1,2}[Ee]\\d{1,3}\\s*[-–—_.]*\\s*')
const VERSION_SUFFIX = re('\\s+[Vv]\\d+\\s*$')

function nomePelasPastas(caminho: string, maxUp = 3): string {
  let pasta = dirname(caminho)
  for (let i = 0; i < maxUp; i += 1) {
    const cru = basename(pasta)
    if (!cru || dirname(pasta) === pasta) break
    let cand = limparTitulo(cru)
    pasta = dirname(pasta)
    if (!cand) continue
    if (SEASON_DIR.test(cand)) continue
    if (STORAGE_DIR.test(cand)) break
    for (const pat of STRIP_ANIME) cand = cand.replace(pat, '')
    cand = aparar(cand.replace(VERSION_SUFFIX, ''), ' -_.')
    if ([...cand].length >= 3 && !/^\p{Nd}+$/u.test(cand)) return cand
  }
  return ''
}

const KIND_PATTERNS: [RegExp, 'OP' | 'ED'][] = [
  [re('\\bNC(?:OP|_?OPENING)\\s*_?(\\d+)?\\b', 'i'), 'OP'],
  [re('\\bNC(?:ED|_?ENDING)\\s*_?(\\d+)?\\b', 'i'), 'ED'],
  [re('\\bOP(?:ENING)?\\s*_?(\\d+)\\b', 'i'), 'OP'],
  [re('\\b(?:ED|ENDING)\\s*_?(\\d+)\\b', 'i'), 'ED'],
]

const KIND_MARK = re('\\b(?:NC ?)?(?:OPENING|ENDING|OP|ED)(?:\\s*\\d+)?\\b', 'i')

// Ano entre parenteses/colchetes ou solto. 19xx/20xx so: 1080p nao e ano.
const ANO = re('[(\\[\\s._-](19\\d{2}|20[0-4]\\d)[)\\]\\s._-]')

export function detectarAno(texto: string): number | null {
  const m = ANO.exec(` ${texto} `)
  return m ? inteiro(m[1]!) : null
}

export function detectarKind(texto: string): ['OP' | 'ED' | '', number | null] {
  for (const [pat, kind] of KIND_PATTERNS) {
    const m = pat.exec(texto)
    if (m) return [kind, m[1] ? inteiro(m[1]) : null]
  }
  return ['', null]
}

/** O palpite pelo nome do arquivo (e das pastas, quando o nome nao traz o anime). */
export function palpitePeloNome(caminho: string): PalpiteDoEpisodio {
  const stem = basename(caminho, extname(caminho))
  const limpo = limparTitulo(stem)

  let temporada = 1
  let episodio = 1
  let [kind, numeroDoKind] = detectarKind(stem) as [KindDoEpisodio, number | null]

  let combinado = false
  for (const pat of SE_PATTERNS) {
    const m = pat.exec(limpo)
    if (m) {
      temporada = inteiro(m[1]!)
      episodio = inteiro(m[2]!)
      combinado = true
      break
    }
  }

  if (!combinado) {
    for (const pat of SEASON_PATTERNS) {
      const m = pat.exec(limpo)
      if (m) {
        temporada = inteiro(m[1]!)
        break
      }
    }
    for (const pat of EPISODE_PATTERNS) {
      const m = pat.exec(limpo)
      if (m) {
        episodio = inteiro(m[1]!)
        break
      }
    }
  }

  let nome = limpo
  for (const pat of STRIP_ANIME) nome = nome.replace(pat, '')
  nome = aparar(nome.replace(VERSION_SUFFIX, ''), ' -_.')

  // Arquivo sem nome de anime ("S01E01-Jobless Reincarnation V2.mkv"): pasta,
  // depois o que vem depois da tag, depois o comeco do nome.
  if (!nome) nome = nomePelasPastas(caminho)
  if (!nome) nome = aparar(limpo.replace(LEADING_SE_TAG, '').replace(VERSION_SUFFIX, ''), ' -_.')
  if (!nome) nome = (limpo.split(' - ')[0] ?? '').trim() || stem

  if (kind) {
    // O numero do NCOP e o da abertura, nao o do episodio.
    episodio = numeroDoKind ?? 1
    const corte = KIND_MARK.exec(nome)
    if (corte && aparar(nome.slice(0, corte.index), ' -_.')) nome = aparar(nome.slice(0, corte.index), ' -_.')
  }

  // FILME: sem marca de temporada/episodio E com ano no nome.
  const ano = detectarAno(stem)
  if (!kind && !combinado && ano !== null) {
    kind = 'MOVIE'
    temporada = 1
    episodio = ano
    nome = aparar(` ${nome} `.replace(new RegExp(ANO.source, 'gu'), ' '), ' -_.') || nome
  }

  return { anime: nome, temporada, episodio, kind }
}
