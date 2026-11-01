import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { CLIMAS, climaDaPasta, climaPelaFala, climaPeloPapel, climaSchema, semAcento, type Clima } from '../../shared/trilha-sonora'
import { contexto } from '../contexto'
import { gerarComCache } from '../gerar/ia'
import { pastaDoSomNoPerfil } from './medir'

/**
 * O CLIMA da trilha (01/11): o de cada PARTE do roteiro e o de cada MUSICA.
 *
 * - Parte: UM pedido curto a IA com a fala de cada parte (cache pelo
 *   prompt: rodar de novo nao gasta). Sem IA ou com falha: palavras-chave
 *   (climaPelaFala); sem nada claro, o papel da parte.
 * - Musica: a SUBPASTA ("acao/", "sentimental/"...) manda; o nome dizendo
 *   ("MUSICA DE SUSPENSE") tambem; o resto vai num pedido a IA so com os
 *   NOMES, e a resposta fica em <userData>/som/clima-das-musicas.json (cada
 *   musica e perguntada uma vez so).
 */

const LISTA = CLIMAS.join(', ')

const SISTEMA_DAS_PARTES = `Voce escolhe a musica de fundo de um short de recap de anime. Para cada parte do roteiro, diga o CLIMA musical que combina com o que ela conta: ${LISTA}.
- acao: luta, perseguicao, ataque. epica: poder despertando, virada heroica, revelacao grandiosa. sentimental: perda, morte, lembranca, tristeza. romance: amor, casal. suspense: misterio, ameaca, segredo, tensao. comedia: piada, vergonha, situacao ridicula. calma: explicacao neutra, cotidiano.
- Partes vizinhas com o mesmo clima devem repetir o clima: so mude quando a mudanca for clara.
- Responda um clima por parte, na ordem.`

const SISTEMA_DAS_MUSICAS = `Voce organiza musicas instrumentais usadas em edits e recaps de anime. Pelo NOME de cada musica (titulo, anime, artista), diga o clima dela: ${LISTA}.
- Abertura de anime shonen e trilha de luta: acao ou epica. Lo-fi, slowed e chill: calma. Piano e trilha triste: sentimental. Phonk e funk montagem: acao. Musica "de suspense": suspense.
- Responda um clima por musica, com o numero dela.`

/** O clima de cada parte. `textos[i]` = a fala da parte i. */
export async function climasDasPartes(
  partes: readonly { papel: string | null; texto: string }[],
): Promise<{ climas: Clima[]; fonte: 'ia' | 'palavras' }> {
  const reserva = (): Clima[] => partes.map((p) => climaPelaFala(p.texto) ?? climaPeloPapel(p.papel))
  if (partes.length === 0) return { climas: [], fonte: 'palavras' }
  if (partes.every((p) => !p.texto.trim()) || !temIa()) return { climas: reserva(), fonte: 'palavras' }
  try {
    const prompt = partes.map((p, i) => `Parte ${i + 1}${p.papel ? ` (${p.papel})` : ''}: ${p.texto.slice(0, 1200)}`).join('\n\n')
    const r = await gerarComCache({
      schema: z.object({ climas: z.array(climaSchema) }),
      sistema: SISTEMA_DAS_PARTES,
      prompt,
      etapa: 'clima-das-partes',
      tempoLimiteMs: 60_000,
      maxTokens: 400,
    })
    if (!r.ok || r.valor.climas.length !== partes.length) return { climas: reserva(), fonte: 'palavras' }
    r.guardar()
    return { climas: r.valor.climas, fonte: 'ia' }
  } catch (err) {
    console.warn('[som] clima das partes pela IA falhou:', err)
    return { climas: reserva(), fonte: 'palavras' }
  }
}

function temIa(): boolean {
  try {
    return contexto().ia.provedor() !== null
  } catch {
    return false
  }
}

// ------------------------------------------------------------ as musicas

let memoria: Record<string, Clima> | null = null

function caminhoDaMemoria(): string | null {
  const pasta = pastaDoSomNoPerfil()
  return pasta ? join(pasta, 'clima-das-musicas.json') : null
}

function lerMemoria(): Record<string, Clima> {
  if (memoria) return memoria
  memoria = {}
  const arq = caminhoDaMemoria()
  if (!arq || !existsSync(arq)) return memoria
  try {
    const bruto = JSON.parse(readFileSync(arq, 'utf8')) as { versao?: number; musicas?: Record<string, unknown> }
    for (const [k, v] of Object.entries(bruto.musicas ?? {})) {
      const c = climaSchema.safeParse(v)
      if (c.success) memoria[k] = c.data
    }
  } catch {
    // Memoria corrompida: pergunta de novo.
  }
  return memoria
}

function gravarMemoria(): void {
  const arq = caminhoDaMemoria()
  if (!arq || !memoria) return
  const parcial = `${arq}.${process.pid}.tmp`
  try {
    writeFileSync(parcial, JSON.stringify({ versao: 1, musicas: memoria }, null, 2))
    renameSync(parcial, arq)
  } catch (err) {
    console.warn('[som] nao deu para gravar o clima das musicas:', err)
  }
}

/** O clima que o NOME do arquivo ja diz ("MUSICA DE SUSPENSE", "sad piano"). */
export function climaPeloNomeDaMusica(fileName: string): Clima | null {
  for (const palavra of semAcento(fileName).split(/[^a-z]+/)) {
    if (palavra.length < 3) continue
    const c = climaDaPasta(palavra)
    if (c) return c
  }
  return null
}

/**
 * O clima de cada musica: subpasta > nome > memoria > IA (so os que faltam,
 * num pedido). null = ninguem soube (a escolha usa como "qualquer").
 */
export async function climasDasMusicas(
  musicas: readonly { path: string; fileName: string; subpasta?: string | null }[],
): Promise<Map<string, Clima | null>> {
  const saida = new Map<string, Clima | null>()
  const mem = lerMemoria()
  const perguntar: { path: string; fileName: string }[] = []
  for (const m of musicas) {
    const c = (m.subpasta ? climaDaPasta(m.subpasta) : null) ?? climaPeloNomeDaMusica(m.fileName) ?? mem[m.fileName] ?? null
    saida.set(m.path, c)
    if (c === null) perguntar.push(m)
  }
  if (perguntar.length === 0 || !temIa()) return saida
  try {
    const lote = perguntar.slice(0, 80)
    const r = await gerarComCache({
      schema: z.object({ musicas: z.array(z.object({ n: z.number().int(), clima: climaSchema })) }),
      sistema: SISTEMA_DAS_MUSICAS,
      prompt: lote.map((m, i) => `${i + 1}. ${m.fileName.replace(/\.[^.]+$/, '')}`).join('\n'),
      etapa: 'clima-das-musicas',
      tempoLimiteMs: 60_000,
      maxTokens: 1200,
    })
    if (!r.ok) return saida
    r.guardar()
    for (const { n, clima } of r.valor.musicas) {
      const m = lote[n - 1]
      if (!m) continue
      saida.set(m.path, clima)
      mem[m.fileName] = clima
    }
    gravarMemoria()
  } catch (err) {
    console.warn('[som] clima das musicas pela IA falhou:', err)
  }
  return saida
}
