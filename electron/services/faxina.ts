import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A FAXINA DOS ARQUIVOS DE TRABALHO.
 *
 * "Depois de pronto e renderizado vc exclui esse cache mantendo so o projeto
 * salvo." Medido na maquina dele em 07/11/2026: 2,1 GB de cenas melhoradas
 * (upscale) e 247 MB de recortes 9:16 (2.713 arquivos) que NINGUEM ia ler de
 * novo.
 *
 * Por que ninguem ia ler: esses arquivos levam no nome o id da cena, e o id e
 * sorteado a cada importacao -- abrir o mesmo projeto amanha sorteia outros e
 * refaz tudo. Ou seja, eles so valem enquanto o projeto que os criou esta
 * aberto nesta sessao. Por isso a faxina e por SESSAO: os ids que esta janela
 * sorteou saem quando ela fecha. Outra janela do Dangai aberta ao mesmo tempo
 * nao perde nada, porque os ids dela nunca passam por aqui.
 *
 * O que sobra de uma sessao que morreu sem fechar (queda de energia, o app
 * derrubado no Gerenciador) sai na abertura seguinte, se tiver mais de 2 dias.
 *
 * O que fica: o que e caro e reaproveitavel entre sessoes -- a copia SDR do
 * clipe HDR, as miniaturas e tiras (chave pelo conteudo do arquivo), os
 * clipes invertidos e as copias de escuta.
 */

const idsDaSessao = new Set<string>()

/** Um id de cena novo, anotado para a faxina de quando esta janela fechar. */
export function idNovo(): string {
  const id = randomUUID()
  idsDaSessao.add(id)
  return id
}

/** As pastas cujos arquivos comecam com `<id>-`: o recorte 9:16 e o upscale. */
let pastasPorId: string[] = []

const COM_ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/

/** Sobras soltas no %TEMP% por um processo que morreu no meio (Whisper, mescla, rastreio). */
const SOBRA_NO_TEMP = /^dangai-(whisper-\d+\.wav|mescla-\d+\.txt|track-\d+)$/

const DOIS_DIAS = 2 * 86_400_000

export function configurarFaxina(pastas: readonly string[]): void {
  pastasPorId = [...pastas]
  // Sem atrasar a abertura, e depois de qualquer outra janela ter se firmado.
  setTimeout(varrerSobras, 60_000).unref?.()
}

function apagar(caminho: string): number {
  try {
    const st = statSync(caminho)
    const tamanho = st.isDirectory() ? 0 : st.size
    rmSync(caminho, { recursive: true, force: true })
    return tamanho
  } catch {
    // Em uso (o preview segurando o arquivo): fica para a proxima.
    return 0
  }
}

/**
 * Ao fechar: tudo o que esta sessao gerou com id. Sincrono e sem lancar --
 * roda no `will-quit`, quando ja nao ha janela para ouvir um erro.
 */
export function limparAoSair(): number {
  if (idsDaSessao.size === 0) return 0
  let liberado = 0
  for (const pasta of pastasPorId) {
    try {
      if (!existsSync(pasta)) continue
      for (const nome of readdirSync(pasta)) {
        const id = COM_ID.exec(nome)?.[1]
        if (id && idsDaSessao.has(id)) liberado += apagar(join(pasta, nome))
      }
    } catch (err) {
      console.warn('[faxina] ao sair:', err)
    }
  }
  return liberado
}

/** Na abertura: o que sobrou de sessoes que nao fecharam direito. */
export function varrerSobras(agora = Date.now()): number {
  let liberado = 0
  const velho = (caminho: string): boolean => {
    try {
      return agora - statSync(caminho).mtimeMs > DOIS_DIAS
    } catch {
      return false
    }
  }
  for (const pasta of pastasPorId) {
    try {
      if (!existsSync(pasta)) continue
      for (const nome of readdirSync(pasta)) {
        const id = COM_ID.exec(nome)?.[1]
        if (!id || idsDaSessao.has(id)) continue
        const caminho = join(pasta, nome)
        if (velho(caminho)) liberado += apagar(caminho)
      }
    } catch (err) {
      console.warn('[faxina] sobras:', err)
    }
  }
  try {
    const temp = tmpdir()
    for (const nome of readdirSync(temp)) {
      if (!SOBRA_NO_TEMP.test(nome)) continue
      const caminho = join(temp, nome)
      if (velho(caminho)) liberado += apagar(caminho)
    }
  } catch {
    // O %TEMP% ilegivel nao e problema do Dangai.
  }
  if (liberado > 0) console.log(`[faxina] ${Math.round(liberado / 1e6)} MB de sobras apagados`)
  return liberado
}
