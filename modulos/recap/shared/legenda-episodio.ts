import { idDaCue, type Cue } from './episodio'

/**
 * A LEGENDA do episodio, de bytes a cues: o parser puro do passo 1.
 *
 * Puro de proposito (sem fs, sem ffmpeg): quem extrai a faixa do .mkv e o main
 * (electron/services/episodio/legenda.ts); aqui so entra o arquivo ja lido. Da
 * para testar com texto na mao e, se um dia a interface precisar, rodar no
 * renderer.
 *
 * Corrige os bugs conhecidos do leitor do AniRecap (fusao/anirecap/core/subtitle.py):
 * - o .ass era lido por POSICAO fixa (`split(',', 9)`, Name = parts[4]). Um
 *   arquivo com outra linha Format (SSA v4 com Marked, ou campos trocados de
 *   ordem) virava texto e falante errados sem erro nenhum. Aqui manda a linha
 *   Format da secao [Events];
 * - abria tudo como utf-8 puro: BOM grudava no primeiro campo e legenda em
 *   cp1252 (comum em .srt antigo) derrubava a leitura. Aqui o BOM decide, e sem
 *   BOM e utf-8 estrito com cp1252 de reserva;
 * - o .srt so fechava uma cue numa linha em branco, entao o arquivo que
 *   terminava sem ela perdia a ULTIMA fala. Aqui a cue aberta fecha no fim.
 */

/** Uma linha lida, antes de ganhar id e de ir para a base de tempo do episodio. */
export interface CueCrua {
  start: number
  end: number
  texto: string
  falante: string | null
  estilo: string
  tipo: Cue['tipo']
}

export type FormatoDeLegenda = 'ass' | 'srt' | 'vtt'

// ---------------------------------------------------------------- decodificar

/**
 * Bytes -> texto. O BOM manda; sem BOM, utf-16 pelo padrao de zeros, depois
 * utf-8 ESTRITO e, se ele recusar, cp1252 -- o encoding do Windows em que os
 * .srt antigos vem. utf-8 frouxo trocaria cada acento por um losango sem avisar.
 */
export function decodificarLegenda(bytes: Uint8Array): string {
  const decodificar = (encoding: string, inicio: number, fatal = false): string =>
    new TextDecoder(encoding, { fatal }).decode(bytes.subarray(inicio))

  let texto: string
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) texto = decodificar('utf-8', 3)
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) texto = decodificar('utf-16le', 2)
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) texto = decodificar('utf-16be', 2)
  else {
    const utf16 = utf16SemBom(bytes)
    if (utf16) texto = decodificar(utf16, 0)
    else {
      try {
        texto = decodificar('utf-8', 0, true)
      } catch {
        texto = decodificar('windows-1252', 0)
      }
    }
  }
  // O TextDecoder ja tira o BOM na maioria dos casos; este e o seguro.
  return texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

/** utf-16 sem BOM: texto latino tem um zero a cada dois bytes, sempre do mesmo lado. */
function utf16SemBom(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length, 4000) & ~1
  if (n < 8) return null
  let paresZero = 0
  let imparesZero = 0
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) paresZero += 1
    if (bytes[i + 1] === 0) imparesZero += 1
  }
  const metade = n / 2
  if (imparesZero > metade * 0.4 && paresZero < metade * 0.05) return 'utf-16le'
  if (paresZero > metade * 0.4 && imparesZero < metade * 0.05) return 'utf-16be'
  return null
}

// ------------------------------------------------------------------------ .ass

/** A ordem do ASS padrao, para o arquivo sem linha Format (acontece em .ssa velho). */
const FORMATO_PADRAO_ASS = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']

/**
 * Palavras de ESTILO que marcam letra de musica. Medido nos .ass de fansub: a
 * abertura vem como "OP", "OP_Romaji", "ED-Eng", "Song", "Insert"; karaoke
 * como "Kara"/"Romaji"/"Kanji". Comparado por palavra inteira, nunca por
 * pedaco: "Ed" dentro de "Edgerunners" ou "Main - Top" nao conta.
 */
const ESTILOS_DE_MUSICA = new Set([
  'op', 'ed', 'opening', 'ending', 'song', 'songs', 'karaoke', 'kara', 'romaji', 'kanji',
  'lyric', 'lyrics', 'insert', 'music', 'musica', 'ost', 'theme',
])

/** Palavras de estilo que marcam texto de tela (placa, titulo, nota do tradutor). */
const ESTILOS_DE_PLACA = new Set([
  'sign', 'signs', 'title', 'titles', 'text', 'note', 'notes', 'tl', 'typeset', 'ts', 'card',
  'eyecatch', 'disclaimer', 'credit', 'credits', 'staff', 'logo', 'screen', 'board', 'letter',
  'caption', 'overlay', 'placa',
])

/**
 * Valores do campo Name que NAO sao gente. A SubsPlease marca toda placa com
 * Name 'Text'; os creditos do tradutor vem como 'Credits'.
 */
const NOMES_QUE_SAO_PLACA = new Set(['text', 'sign', 'signs', 'title', 'credits', 'credit', 'note', 'tl note', 'ts', 'typeset'])
const NOMES_VAZIOS = new Set(['', 'default', '?', '-', '--', 'speaker', 'name', 'none', 'n/a'])

const NOTAS_MUSICAIS = /[♪♫♬♩]/

/**
 * Marcas invisiveis de direcao de texto e espacos de largura zero. A Netflix
 * poe um U+200E na frente de placa ("OBTAINED NITRIC ACID!" com a marca na frente): invisivel
 * na tela, mas quebra comparacao de texto e busca.
 */
const INVISIVEIS = /[​-‏‪-‮⁠-⁤﻿]/g

/**
 * As palavras de um nome de estilo: "OP_Romaji" -> op, romaji; "sign_8958_97_Ramen"
 * -> sign, ramen; "Next_Ep_Title" -> next, ep, title; "OP1" -> op.
 */
function fichasDoEstilo(estilo: string): string[] {
  return estilo
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((f) => f.length > 0)
}

/** "0:01:02.34" -> 62.34. Aceita 3 casas e virgula. NaN quando nao e tempo. */
function tempoAss(cru: string): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d+))?$/.exec(cru.trim())
  if (!m) return Number.NaN
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0)
}

/** Divide em no maximo `n` campos: o ultimo (Text) fica com as virgulas dele. */
function dividirCampos(linha: string, n: number): string[] {
  const partes: string[] = []
  let resto = linha
  for (let i = 0; i < n - 1; i += 1) {
    const virgula = resto.indexOf(',')
    if (virgula < 0) break
    partes.push(resto.slice(0, virgula))
    resto = resto.slice(virgula + 1)
  }
  partes.push(resto)
  return partes
}

interface TextoAss {
  texto: string
  /** \pos ou \move: a linha foi posta num lugar da tela, coisa de placa. */
  posicionada: boolean
  /** \k: silaba de karaoke, coisa de musica. */
  karaoke: boolean
}

/**
 * Tira as tags {\...}, o desenho vetorial (\p1 ... \p0, que e forma e nao
 * texto) e troca \N, \n e \h por espaco.
 */
function limparTextoAss(cru: string): TextoAss {
  let posicionada = false
  let karaoke = false
  let desenhando = false
  let texto = ''
  const partes = cru.split(/(\{[^}]*\})/)
  for (const parte of partes) {
    if (parte.startsWith('{') && parte.endsWith('}')) {
      if (/\\(?:pos|move)\s*\(/i.test(parte)) posicionada = true
      if (/\\[kK][fo]?\d/.test(parte)) karaoke = true
      const desenho = /\\p(\d+)/.exec(parte)
      if (desenho) desenhando = Number(desenho[1]) > 0
      continue
    }
    if (!desenhando) texto += parte
  }
  texto = texto
    // "Super-\Nconductor": a palavra quebrada na linha volta inteira.
    .replace(/(\p{L})-\\[Nn]\s*(?=\p{L})/gu, '$1-')
    .replace(/\\[Nnh]/g, ' ')
    .replace(INVISIVEIS, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { texto, posicionada, karaoke }
}

/** Le um .ass/.ssa pela linha Format da secao [Events]. Tempos crus do arquivo. */
export function lerAss(texto: string): CueCrua[] {
  const saida: CueCrua[] = []
  let secao = ''
  let formato: string[] | null = null

  for (const linhaCrua of texto.split('\n')) {
    const linha = linhaCrua.trim()
    if (!linha || linha.startsWith(';')) continue
    if (linha.startsWith('[') && linha.endsWith(']')) {
      secao = linha.toLowerCase()
      continue
    }
    if (secao !== '[events]') continue

    const m = /^([A-Za-z]+)\s*:\s?(.*)$/.exec(linha)
    if (!m) continue
    const tipoDaLinha = m[1]!.toLowerCase()
    if (tipoDaLinha === 'format') {
      formato = m[2]!.split(',').map((c) => c.trim().toLowerCase())
      continue
    }
    // Comment: e linha desligada pelo proprio legendador.
    if (tipoDaLinha !== 'dialogue') continue

    const campos = formato && formato.includes('text') ? formato : FORMATO_PADRAO_ASS
    const valores = dividirCampos(m[2]!, campos.length)
    if (valores.length < campos.length) continue
    const campo = (nome: string): string => {
      const i = campos.indexOf(nome)
      return i >= 0 ? (valores[i] ?? '') : ''
    }

    const start = tempoAss(campo('start'))
    const end = tempoAss(campo('end'))
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue

    const { texto: limpo, posicionada, karaoke } = limparTextoAss(campo('text'))
    if (!limpo) continue

    const estilo = campo('style').trim()
    const nome = campo('name').trim()
    const efeito = campo('effect').trim().toLowerCase()
    const fichas = fichasDoEstilo(estilo)

    let tipo: Cue['tipo'] = 'fala'
    if (
      NOTAS_MUSICAIS.test(limpo) ||
      karaoke ||
      efeito.startsWith('karaoke') ||
      fichas.some((f) => ESTILOS_DE_MUSICA.has(f))
    ) {
      tipo = 'musica'
    } else if (
      NOMES_QUE_SAO_PLACA.has(nome.toLowerCase()) ||
      fichas.some((f) => ESTILOS_DE_PLACA.has(f)) ||
      // Posicionada e sem falante: placa. Com falante, e fala posta em outro
      // lugar para nao cobrir uma placa -- continua sendo alguem falando.
      (posicionada && NOMES_VAZIOS.has(nome.toLowerCase()))
    ) {
      tipo = 'placa'
    }

    const falante = tipo === 'fala' && !NOMES_VAZIOS.has(nome.toLowerCase()) ? nome : null
    saida.push({ start, end: Math.max(start, end), texto: limpo, falante, estilo, tipo })
  }
  return saida
}

// ------------------------------------------------------------------- .srt/.vtt

const TEMPO_SRT = /^\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)/

/** "00:01:02,345" ou "01:02.345" (vtt) -> segundos. */
function tempoSrt(cru: string): number {
  const [hms, fracao] = cru.trim().split(/[.,]/)
  const partes = (hms ?? '').split(':').map(Number)
  if (partes.some((n) => !Number.isFinite(n))) return Number.NaN
  const [h, m, s] = partes.length === 3 ? partes : [0, partes[0] ?? 0, partes[1] ?? 0]
  return h! * 3600 + m! * 60 + s! + (fracao ? Number(`0.${fracao}`) : 0)
}

/** Texto de uma cue de .srt/.vtt: sem HTML, sem {\an8} perdido, entidades basicas abertas. */
function limparTextoSrt(linhas: readonly string[]): string {
  return linhas
    .join(' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(INVISIVEIS, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Subtitle translation by: Fulana", "Legendas: ..." -- credito, nao fala. */
const CREDITO_DA_LEGENDA = /^(subtitles?|subtitle translation|translation|translated|translator|legendas?|traducao|tradução)\b[^:]{0,30}:/i

/**
 * Cue que e so descricao de som ("[passos]", "(musica tensa)"): legenda SDH/CC.
 * Nao e fala de ninguem -- e, contada como fala, tapava o vao da abertura.
 */
const SO_DESCRICAO = /^[[(][^\])]*[\])]$/
const DESCRICAO_DE_MUSICA = /music|song|singing|sings|musica|cancao|♪/i

/** Tipo de uma cue sem estilo (.srt/.vtt). */
function tipoSemEstilo(texto: string): Cue['tipo'] {
  if (NOTAS_MUSICAIS.test(texto)) return 'musica'
  if (CREDITO_DA_LEGENDA.test(texto)) return 'placa'
  if (SO_DESCRICAO.test(texto)) return DESCRICAO_DE_MUSICA.test(texto) ? 'musica' : 'placa'
  // A Netflix (e quem copia o padrao dela) escreve o texto de TELA todo em
  // maiusculas ("NITRIC ACID FIELD"); fala gritada continua em caixa normal.
  const letras = texto.replace(/[^\p{L}]/gu, '')
  if (letras.length >= 4 && letras === letras.toUpperCase() && letras !== letras.toLowerCase()) return 'placa'
  return 'fala'
}

/**
 * Le .srt e .vtt. A cue abre na linha de tempo e fecha na linha em branco, na
 * proxima linha de tempo OU no fim do arquivo -- era esse ultimo caso que o
 * AniRecap perdia.
 */
export function lerSrt(texto: string): CueCrua[] {
  const linhas = texto.split('\n')
  const saida: CueCrua[] = []
  let aberta: { start: number; end: number; linhas: string[] } | null = null

  const fechar = (): void => {
    if (!aberta) return
    const limpo = limparTextoSrt(aberta.linhas)
    if (limpo) {
      saida.push({
        start: aberta.start,
        end: Math.max(aberta.start, aberta.end),
        texto: limpo,
        // O .srt nao tem campo de falante. Prefixo "NOME:" de SDH nao e
        // confiavel o bastante para virar falante.
        falante: null,
        estilo: '',
        tipo: tipoSemEstilo(limpo),
      })
    }
    aberta = null
  }

  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i]!
    const tempo = TEMPO_SRT.exec(linha)
    if (tempo) {
      fechar()
      const start = tempoSrt(tempo[1]!)
      const end = tempoSrt(tempo[2]!)
      if (Number.isFinite(start) && Number.isFinite(end)) aberta = { start, end, linhas: [] }
      continue
    }
    if (!linha.trim()) {
      fechar()
      continue
    }
    // O numero (ou o identificador do .vtt) logo antes de uma linha de tempo
    // e da PROXIMA cue, nao texto desta.
    if (TEMPO_SRT.test(linhas[i + 1] ?? '')) {
      fechar()
      continue
    }
    if (aberta) aberta.linhas.push(linha.trim())
  }
  fechar()
  return saida
}

// ---------------------------------------------------------------- base de tempo

/**
 * Cruas -> Cue[] na base de tempo do episodio.
 *
 * `deslocamentoSec` e o startTimeSec da sonda: a faixa e extraida com
 * -copyts (tempo absoluto do container), e o indice conta do primeiro quadro.
 * Ordena por inicio, junta repeticoes (o .ass desenha a mesma placa em varias
 * camadas, e o typeset quadro a quadro repete o texto em dezenas de linhas
 * coladas) e numera c0001, c0002...
 */
export function montarCues(cruas: readonly CueCrua[], deslocamentoSec = 0): Cue[] {
  const r3 = (n: number): number => Math.round(n * 1000) / 1000
  const deslocadas = cruas
    .map((c) => ({ ...c, start: r3(Math.max(0, c.start - deslocamentoSec)), end: r3(c.end - deslocamentoSec) }))
    .filter((c) => c.end > 0 && c.texto.length > 0)
    .map((c) => ({ ...c, end: Math.max(c.start, c.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const juntas: CueCrua[] = []
  for (const cue of deslocadas) {
    const repetida = juntas.find(
      (j) =>
        j.texto === cue.texto &&
        j.tipo === cue.tipo &&
        j.falante === cue.falante &&
        // a mesma linha em outra camada, ou a continuacao colada dela
        cue.start <= j.end + 0.05 &&
        (cue.tipo !== 'fala' || (j.start === cue.start && j.end === cue.end)),
    )
    if (repetida) {
      repetida.end = Math.max(repetida.end, cue.end)
      continue
    }
    juntas.push({ ...cue })
  }

  return juntas.map((c, i) => ({
    id: idDaCue(i + 1),
    start: c.start,
    end: c.end,
    texto: c.texto,
    falante: c.falante,
    estilo: c.estilo,
    tipo: c.tipo,
  }))
}

/** Atalho: bytes do arquivo extraido -> cues prontas. */
export function lerLegenda(bytes: Uint8Array, formato: FormatoDeLegenda, deslocamentoSec = 0): Cue[] {
  const texto = decodificarLegenda(bytes)
  const cruas = formato === 'ass' ? lerAss(texto) : lerSrt(texto)
  return montarCues(cruas, deslocamentoSec)
}

/** O formato do arquivo extraido pelo codec da faixa. null = nao da para ler como texto. */
export function formatoDoCodec(codec: string): FormatoDeLegenda | null {
  switch (codec.toLowerCase()) {
    case 'ass':
    case 'ssa':
      return 'ass'
    case 'webvtt':
      return 'vtt'
    case 'subrip':
    case 'srt':
    case 'mov_text':
    case 'text':
      return 'srt'
    default:
      return null
  }
}
