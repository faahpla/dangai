import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { montarPerfil, resumirProjeto, type PerfilDoMeuJeito, type ProjetoParaResumir, type ResumoDoProjeto } from '@shared/meu-jeito'
import { getSettings } from './settings'

/**
 * O CADERNO DO "DO MEU JEITO" (ver shared/meu-jeito.ts): o resumo de som e cor
 * de cada projeto dele, em <userData>/meu-jeito.json, por caminho do .dangai.
 *
 * Aprende de tres jeitos: ao SALVAR um projeto, ao ABRIR um, e na primeira vez
 * (ou quando aparece projeto novo) varrendo as pastas onde os recentes moram --
 * os 31 projetos do Faah estavam todos em D:\Dopanimes. Le o .dangai e nunca
 * escreve nele.
 */

interface Caderno {
  versao: 1
  projetos: Record<string, { mtimeMs: number; resumo: ResumoDoProjeto | null }>
}

let arquivo: string | null = null
let caderno: Caderno | null = null

export function configureMeuJeito(userDataDir: string): void {
  arquivo = join(userDataDir, 'meu-jeito.json')
}

function ler(): Caderno {
  if (caderno) return caderno
  try {
    const cru = JSON.parse(readFileSync(arquivo!, 'utf8')) as Caderno
    if (cru.versao === 1 && typeof cru.projetos === 'object') return (caderno = cru)
  } catch {
    /* primeira vez */
  }
  return (caderno = { versao: 1, projetos: {} })
}

function gravar(): void {
  if (!arquivo || !caderno) return
  try {
    writeFileSync(`${arquivo}.tmp`, JSON.stringify(caderno))
    renameSync(`${arquivo}.tmp`, arquivo)
  } catch (err) {
    console.warn('[meu-jeito] nao deu para gravar o caderno:', err)
  }
}

const chave = (caminho: string): string => caminho.toLowerCase()
const quando = (p: { savedAt?: string }, mtimeMs: number): number => Date.parse(p.savedAt ?? '') || mtimeMs

/** Um projeto salvo ou aberto agora: o resumo dele entra (ou substitui o de antes). */
export function aprenderDoProjeto(caminho: string, projeto: ProjetoParaResumir & { savedAt?: string }): void {
  try {
    const mtimeMs = existsSync(caminho) ? statSync(caminho).mtimeMs : Date.now()
    ler().projetos[chave(caminho)] = { mtimeMs, resumo: resumirProjeto(projeto, quando(projeto, mtimeMs)) }
    gravar()
  } catch (err) {
    console.warn('[meu-jeito] nao deu para aprender de', caminho, err)
  }
}

/** Os .dangai ate PROFUNDIDADE pastas abaixo. */
function projetosEm(dir: string, profundidade: number): string[] {
  let entradas
  try {
    entradas = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entradas.flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return profundidade > 0 && !e.name.startsWith('.') ? projetosEm(p, profundidade - 1) : []
    return /\.dangai$/i.test(e.name) ? [p] : []
  })
}

let varrendo: Promise<void> | null = null

/**
 * As pastas dos projetos recentes (e a de cima de cada uma), tres niveis para
 * baixo: o que ainda nao esta no caderno, ou mudou desde a ultima leitura,
 * entra. Uma varredura por vez; solta a vez entre um arquivo e outro.
 */
export function aprenderDasPastas(): Promise<void> {
  varrendo ??= (async () => {
    const recentes = getSettings()
      .recentes.map((r) => (typeof r['path'] === 'string' ? r['path'] : null))
      .filter((p): p is string => p !== null)
    const pastas = [...new Set(recentes.flatMap((p) => [dirname(p), dirname(dirname(p))]))]
    const achados = [...new Set(pastas.flatMap((d) => projetosEm(d, 3)))]
    const c = ler()
    let mudou = false
    for (const caminho of achados) {
      await new Promise((r) => setImmediate(r))
      try {
        const mtimeMs = statSync(caminho).mtimeMs
        const ja = c.projetos[chave(caminho)]
        if (ja && ja.mtimeMs >= mtimeMs) continue
        const projeto = JSON.parse((await readFile(caminho, 'utf8')).replace(/^\uFEFF/, '')) as ProjetoParaResumir & { savedAt?: string }
        c.projetos[chave(caminho)] = { mtimeMs, resumo: resumirProjeto(projeto, quando(projeto, mtimeMs)) }
        mudou = true
      } catch {
        /* arquivo que nao abre nao ensina nada */
      }
    }
    if (mudou) gravar()
  })().finally(() => {
    varrendo = null
  })
  return varrendo
}

/** O jeito dele, montado dos resumos (espera a varredura em andamento, se houver). */
export async function perfilDoMeuJeito(): Promise<PerfilDoMeuJeito> {
  if (varrendo) await varrendo
  const resumos = Object.values(ler().projetos)
    .map((p) => p.resumo)
    .filter((r): r is ResumoDoProjeto => r !== null)
  return montarPerfil(resumos)
}
