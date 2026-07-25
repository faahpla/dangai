import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Segment, Transcript, Word } from '@shared/contract'
import { cutCandidatesFrom } from '@shared/plan'

/**
 * Parser de .srt.
 *
 * Quando o usuario tem legenda pronta, ela ganha do Whisper: os tempos ja foram
 * conferidos por ele e o parse e instantaneo.
 *
 * O .srt so da tempo por bloco, nao por palavra. As palavras sao interpoladas
 * dentro do bloco proporcionalmente ao comprimento -- aproximado, mas os
 * instantes que importam para o corte sao as fronteiras dos blocos, e essas
 * sao exatas.
 */
export function parseSrt(path: string): Transcript {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Nao foi possivel ler "${basename(path)}" (${detail}).`)
  }

  // Remove BOM e normaliza quebras de linha.
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const blocks = text.split(/\n{2,}/)

  const segments: Segment[] = []

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0)
    if (lines.length < 2) continue

    // A linha de tempo pode ser a primeira (sem indice) ou a segunda.
    const timeLine = lines.find((line) => line.includes('-->'))
    if (!timeLine) continue

    const times = parseTimeLine(timeLine)
    if (!times) continue

    const content = lines
      .slice(lines.indexOf(timeLine) + 1)
      .join(' ')
      // Tira as tags de estilo que alguns geradores colocam.
      .replace(/<[^>]+>/g, '')
      .replace(/\{[^}]+\}/g, '')
      .trim()

    if (content.length === 0) continue
    segments.push({ start: times.start, end: times.end, text: content })
  }

  if (segments.length === 0) {
    throw new Error(
      `"${basename(path)}" nao tem legendas legiveis. Confira se o arquivo esta no formato SRT.`,
    )
  }

  const words = interpolateWords(segments)

  return {
    source: 'srt',
    words,
    segments,
    text: segments.map((segment) => segment.text).join(' '),
    cutCandidates: cutCandidatesFrom(words, segments),
  }
}

function parseTimeLine(line: string): { start: number; end: number } | null {
  const match = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(
    line,
  )
  if (!match) return null

  const toSeconds = (h: string, m: string, s: string, ms: string): number =>
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000

  const start = toSeconds(match[1]!, match[2]!, match[3]!, match[4]!)
  const end = toSeconds(match[5]!, match[6]!, match[7]!, match[8]!)
  return end > start ? { start, end } : null
}

/** Reparte o bloco entre as palavras, proporcional ao numero de caracteres. */
function interpolateWords(segments: readonly Segment[]): Word[] {
  const words: Word[] = []

  for (const segment of segments) {
    const tokens = segment.text.split(/\s+/).filter((token) => token.length > 0)
    if (tokens.length === 0) continue

    const totalChars = tokens.reduce((sum, token) => sum + token.length, 0)
    const span = segment.end - segment.start
    let cursor = segment.start

    for (const token of tokens) {
      const share = (token.length / totalChars) * span
      words.push({ text: token, start: cursor, end: cursor + share })
      cursor += share
    }
  }

  return words
}
