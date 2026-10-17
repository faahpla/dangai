import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import {
  historicoDeMusicasSchema,
  HISTORICO_DE_MUSICAS_VAZIO,
  musicaSemRepetir,
  nomeDoArquivo,
  type HistoricoDeMusicas,
  type MusicaDaPasta,
} from '../../shared/edicao-rapida'
import { getSettings, pastaDeMusicasEfetiva } from '../settings'
import { medirSom, pastaDoSomNoPerfil } from './medir'

/**
 * A MUSICA DE FUNDO da Edicao rapida.
 *
 * - A pasta e pastaDeMusicasEfetiva() (electron/services/settings.ts): a
 *   escolhida nas Configuracoes ou PASTA_DE_MUSICAS_PADRAO (G:/App Resumo/music,
 *   hoje um .m4a e um .mp3). SO LEITURA: nada aqui grava nela -- so readdir,
 *   stat e o ffmpeg lendo para medir.
 * - O historico mora em <userData>/som/musicas-usadas.json
 *   (historicoDeMusicasSchema), gravado atomico (temp + rename), e a escolha e
 *   a pura musicaSemRepetir (shared/edicao-rapida.ts): primeiro as nunca
 *   usadas, depois a usada ha mais tempo -- nao repete entre shorts.
 * - Medir (duracao e LUFS integrado) e o medirSom de ./medir.ts, com cache.
 */

/** Sinal de stub (mantido para quem ja importa): parte da Edicao rapida que nao rodou vira aviso. */
export const NAO_IMPLEMENTADO = 'Edicao rapida: som ainda nao implementado.'

const EXTENSOES = ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac', '.opus']

/** Pasta trocavel no teste (o app usa a das Configuracoes). */
let pastaForcada: string | null = null
export function usarPastaDeMusicasNoTeste(pasta: string | null): void {
  pastaForcada = pasta
}

function pastaAtual(): string {
  if (pastaForcada !== null) return pastaForcada
  try {
    return pastaDeMusicasEfetiva()
  } catch {
    return ''
  }
}

function caminhoDoHistorico(): string | null {
  const pasta = pastaDoSomNoPerfil()
  return pasta ? join(pasta, 'musicas-usadas.json') : null
}

/** Historico em memoria quando nao ha perfil (teste): o "sem repetir" vale na sessao. */
let historicoSemPerfil: HistoricoDeMusicas = HISTORICO_DE_MUSICAS_VAZIO

export function lerHistoricoDeMusicas(): HistoricoDeMusicas {
  const arq = caminhoDoHistorico()
  if (!arq) return historicoSemPerfil
  if (!existsSync(arq)) return HISTORICO_DE_MUSICAS_VAZIO
  try {
    const r = historicoDeMusicasSchema.safeParse(JSON.parse(readFileSync(arq, 'utf8')))
    return r.success ? r.data : HISTORICO_DE_MUSICAS_VAZIO
  } catch {
    return HISTORICO_DE_MUSICAS_VAZIO
  }
}

function gravarHistorico(h: HistoricoDeMusicas): void {
  const arq = caminhoDoHistorico()
  if (!arq) {
    historicoSemPerfil = h
    return
  }
  const parcial = `${arq}.${process.pid}.tmp`
  writeFileSync(parcial, JSON.stringify(h, null, 2))
  renameSync(parcial, arq)
}

const chave = (p: string): string => p.replace(/\\/g, '/').toLowerCase()

/** As faixas de audio da pasta (mp3, m4a, wav, ogg, flac, aac), sem medir, com `usadaEm` do historico. */
export async function listarMusicas(): Promise<MusicaDaPasta[]> {
  const pasta = pastaAtual()
  if (!pasta || !existsSync(pasta)) return []
  let nomes: string[]
  try {
    nomes = readdirSync(pasta)
  } catch {
    return []
  }
  const historico = lerHistoricoDeMusicas()
  const ultimaVez = new Map<string, string>()
  for (const u of historico.usadas) {
    const k = chave(u.path)
    const antes = ultimaVez.get(k)
    if (!antes || u.em > antes) ultimaVez.set(k, u.em)
  }
  return nomes
    .filter((n) => EXTENSOES.includes(extname(n).toLowerCase()))
    .filter((n) => {
      try {
        return statSync(join(pasta, n)).isFile()
      } catch {
        return false
      }
    })
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((n) => {
      const path = join(pasta, n)
      return { path, fileName: n, durationSec: null, lufsIntegrado: null, usadaEm: ultimaVez.get(chave(path)) ?? null }
    })
}

/**
 * A musica da vez SEM REPETIR (musicaSemRepetir sobre o historico), ja medida.
 * Uma que nao da para ler (arquivo quebrado) cede a vez a proxima. null =
 * pasta vazia ou ausente. Nao registra.
 */
export async function escolherMusica(evitar: readonly string[] = []): Promise<MusicaDaPasta | null> {
  const todas = await listarMusicas()
  const historico = lerHistoricoDeMusicas()
  let restantes = todas
  for (let tentativa = 0; tentativa < 6 && restantes.length > 0; tentativa++) {
    const vez = musicaSemRepetir(restantes, historico, evitar)
    if (!vez) return null
    try {
      const m = await medirSom(vez.path)
      return { ...vez, durationSec: m.durationSec, lufsIntegrado: m.lufsIntegrado }
    } catch (err) {
      console.warn('[som] musica ilegivel, tentando a proxima:', vez.fileName, err)
      restantes = restantes.filter((x) => x.path !== vez.path)
    }
  }
  return null
}

/**
 * Anota a musica de UM projeto no historico (userData; nunca na pasta de
 * musicas). Uma entrada POR PROJETO, sobrescrita: o historico diz a musica
 * que cada projeto TEM ao ser gravado/renderizado, e nao cada troca -- uma
 * musica experimentada e desfeita com Ctrl+Z nao conta como usada (avaliacao
 * de 14/10). `path` null = o projeto ficou sem musica: a entrada dele sai.
 * Sem `projeto` (teste), so acrescenta.
 */
export async function registrarMusicaUsada(path: string | null, projeto: string | null = null): Promise<true> {
  const h = lerHistoricoDeMusicas()
  const doProjeto = (u: { projeto: string | null }): boolean => projeto !== null && u.projeto !== null && chave(u.projeto) === chave(projeto)
  const antes = projeto ? h.usadas.find(doProjeto) : undefined
  // A mesma musica de novo no mesmo projeto (salvar outra vez): fica a data de
  // quando ela entrou, senao reabrir e salvar um projeto antigo faria a musica
  // dele parecer a mais recente.
  if (antes && path && chave(antes.path) === chave(path)) return true
  const outras = projeto ? h.usadas.filter((u) => !doProjeto(u)) : h.usadas
  if (!path && outras.length === h.usadas.length) return true
  const usadas = path ? [...outras, { path, fileName: nomeDoArquivo(path), em: new Date().toISOString(), projeto }] : outras
  // O "sem repetir" so olha a ultima vez de cada faixa: 500 linhas bastam.
  gravarHistorico({ versao: 1, usadas: usadas.slice(-500) })
  return true
}

/** Como a pasta de musicas esta, para o recado certo ("vazia" x "nao encontrada" x "sem pasta"). */
export function estadoDaPastaDeMusicas(): 'ok' | 'vazia' | 'sumiu' | 'sem-pasta' {
  if (pastaForcada !== null) {
    if (!pastaForcada) return 'sem-pasta'
    if (!existsSync(pastaForcada)) return 'sumiu'
  } else {
    let escolhida = ''
    try {
      escolhida = getSettings().pastaDeMusicas
    } catch {
      escolhida = ''
    }
    const efetiva = pastaAtual()
    if (!efetiva) return escolhida ? 'sumiu' : 'sem-pasta'
  }
  const pasta = pastaAtual()
  try {
    const tem = readdirSync(pasta).some((n) => EXTENSOES.includes(extname(n).toLowerCase()))
    return tem ? 'ok' : 'vazia'
  } catch {
    return 'sumiu'
  }
}
