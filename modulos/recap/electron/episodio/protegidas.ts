import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pastaDeDocumentos } from '../settings'

/**
 * AS PASTAS EM QUE O STUDIO NUNCA GRAVA.
 *
 * O Corte Cenas do Levi e o AnCut HUB dividem o mesmo config.json e o mesmo
 * index.db em %LOCALAPPDATA%\CorteCenas, e as saidas deles sao a biblioteca que
 * ele usa todo dia. Um arquivo escrito ali pelo Studio -- ou o motor do Studio
 * rodando com o APP_NAME deles -- mistura as duas coisas sem volta. Por isso
 * toda escrita do Studio fora do userData passa por garantirGravavel antes.
 *
 * A excecao e "Analisar com o AnCut": ali quem grava e o PROPRIO CorteCenas.exe
 * do AnCut, na saida dele, e essa escolha e do usuario. O Studio so le depois.
 * E o "Enviar para o AnCut" (L1, electron/ancut/enviar.ts): a UNICA escrita do
 * recap no AnCut, so com o clique do Levi (ou o "Enviar sempre" ligado por ele),
 * com o AnCut fechado, o esquema conferido e backup do index.db antes.
 */

function localAppData(): string {
  return process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
}

/**
 * O `output_dir` do config do Corte Cenas/AnCut, ou null.
 *
 * SO esse campo: o resto do arquivo guarda chaves de API em texto puro, e nao
 * e lido, copiado nem logado. Serve tambem para a busca nas bibliotecas.
 */
export function saidaDoCorteCenas(): string | null {
  try {
    const cru = JSON.parse(
      readFileSync(join(localAppData(), 'CorteCenas', 'CorteCenas', 'config.json'), 'utf8'),
    ) as { output_dir?: unknown }
    const dir = typeof cru.output_dir === 'string' ? cru.output_dir.trim() : ''
    return dir || null
  } catch {
    return null
  }
}

/** As raizes so leitura conhecidas nesta maquina. */
export function pastasSoLeitura(): string[] {
  const lista = [
    // config, cache, modelos e index.db do Corte Cenas e do AnCut instalados
    join(localAppData(), 'CorteCenas'),
    // saida padrao do Corte Cenas/AnCut instalados (PyInstaller)
    join(pastaDeDocumentos(), 'CorteCenas'),
    // o Corte Cenas do Levi rodando do fonte, com Output/ e cache/index.db
    'G:\\App Corte Cenas',
    // os clones de referencia da fusao
    'G:\\ClaudeEditor\\fusao',
  ]
  const saida = saidaDoCorteCenas()
  if (saida) lista.push(saida)
  return lista
}

/** Barra, caixa e barra final nao importam no Windows. */
function normal(caminho: string): string {
  return resolve(caminho).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** O caminho e uma raiz so leitura ou fica dentro de uma. */
export function ehSoLeitura(caminho: string): boolean {
  if (!caminho.trim()) return false
  const alvo = normal(caminho)
  return pastasSoLeitura().some((raiz) => {
    const r = normal(raiz)
    return alvo === r || alvo.startsWith(`${r}\\`)
  })
}

/** Lanca, com a mensagem pronta para a tela, se o Studio nao pode gravar ali. */
export function garantirGravavel(caminho: string): void {
  if (ehSoLeitura(caminho)) {
    throw new Error(
      `O recap nao grava em "${caminho}": essa pasta e do AnCut ou do Corte Cenas, que sao so leitura. Escolha outra pasta.`,
    )
  }
}
