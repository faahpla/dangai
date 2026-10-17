import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, open, rename, rm, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RodaDoTorch } from '../../shared/motor-runtime'
import { ehSemEspaco, falha, FalhaDaInstalacao, InstalacaoCancelada } from './erros'

/**
 * BAIXA uma roda do torch (2,7 GB no cu128) com RETOMADA e confere o sha256.
 *
 * DONO: agente A. Sem electron: o fetch entra por parametro (net.fetch no app,
 * que respeita o proxy do sistema; o fetch do Node nos testes).
 *
 * Por que o app baixa o torch e nao o uv: o uv recomeca do zero a cada falha,
 * e 2,7 GB numa conexao que cai no meio nunca terminariam. Aqui:
 * - <baixando>/<arquivo>.part cresce a cada pedaco; o .part.json guarda url,
 *   sha256, bytes e o etag. Meta diferente (outra versao no lock) = recomeca.
 * - Retoma com `Range: bytes=<n>-` (+ If-Range com o etag): 206 continua, 200
 *   recomeca do zero (o servidor ignorou o Range), 416 vai para o hash.
 * - Rede que cai: ate 5 tentativas seguidas (2/4/8/16/30 s), contadas de novo
 *   sempre que a tentativa anterior trouxe bytes. Sem nenhum byte por 60 s,
 *   a tentativa cai e retoma (conexao pendurada nao segura a barra para sempre).
 * - So no fim: sha256 do arquivo inteiro; bate = renomeia para .whl. Entao um
 *   .whl na pasta com o tamanho certo JA foi conferido.
 */

export type FetchDoMotor = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal; cache?: 'no-store' },
) => Promise<Response>

export interface OpcoesDaDescarga {
  fetch: FetchDoMotor
  signal: AbortSignal
  /** Bytes desta roda ja no disco, a cada pedaco gravado. */
  aoAndar(noDisco: number): void
  /** "Conferindo o download" (o hash de 2,7 GB leva ~10 s). */
  aoConferir?(): void
  log(linha: string): void
  /** Esperas entre tentativas, em ms. */
  esperas?: number[]
  /** Sem nenhum byte por este tempo, a tentativa cai e retoma. */
  silencioMs?: number
  /** Quanto recuar do fim de um .part de outra sessao (MARGEM_DA_RETOMADA; os testes encurtam). */
  margemDaRetomada?: number
}

const ESPERAS_PADRAO = [2000, 4000, 8000, 16_000, 30_000]
/**
 * Ao RETOMAR um .part de outra sessao, recua este tanto antes de pedir o
 * Range. Queda de luz: o NTFS pode voltar com o .part maior que os dados que
 * chegaram ao disco (o fim le como zero), e emendar depois dos zeros faria o
 * sha256 dos 2,7 GB falhar no fim e o download recomecar do zero. 32 MB a
 * mais por retomada e nada perto disso.
 */
export const MARGEM_DA_RETOMADA = 32 * 1024 * 1024
const SILENCIO_PADRAO = 60_000
/** Junta os pedacos da rede antes de gravar: menos escritas pequenas. */
const BLOCO = 4 * 1024 * 1024

interface MetaDaParte {
  url: string
  sha256: string
  bytes: number
  etag: string | null
}

function tamanho(caminho: string): number | null {
  try {
    return statSync(caminho).size
  } catch {
    return null
  }
}

function lerMeta(caminho: string): MetaDaParte | null {
  try {
    const j = JSON.parse(readFileSync(caminho, 'utf8')) as Partial<MetaDaParte>
    if (typeof j.url !== 'string' || typeof j.sha256 !== 'string' || typeof j.bytes !== 'number') return null
    return { url: j.url, sha256: j.sha256, bytes: j.bytes, etag: typeof j.etag === 'string' ? j.etag : null }
  } catch {
    return null
  }
}

function esperar(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    if (signal.aborted) {
      rejeitar(new InstalacaoCancelada())
      return
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', parar)
      resolver()
    }, ms)
    const parar = (): void => {
      clearTimeout(t)
      rejeitar(new InstalacaoCancelada())
    }
    signal.addEventListener('abort', parar, { once: true })
  })
}

/** sha256 do arquivo inteiro, em stream (o torch nao cabe na memoria de uma vez com folga). */
export function sha256DoArquivo(caminho: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const hash = createHash('sha256')
    const s = createReadStream(caminho, { highWaterMark: BLOCO })
    const parar = (): void => {
      s.destroy()
      rejeitar(new InstalacaoCancelada())
    }
    signal?.addEventListener('abort', parar, { once: true })
    s.on('data', (d) => hash.update(d))
    s.on('error', (e) => {
      signal?.removeEventListener('abort', parar)
      rejeitar(e)
    })
    s.on('end', () => {
      signal?.removeEventListener('abort', parar)
      resolver(hash.digest('hex'))
    })
  })
}

/** "bytes 100-199/2753189216" -> {inicio, total}. */
function lerContentRange(valor: string | null): { inicio: number; total: number | null } | null {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(valor?.trim() ?? '')
  if (!m) return null
  return { inicio: Number(m[1]), total: m[3] === '*' ? null : Number(m[3]) }
}

/** Uma tentativa: pede do byte `n` em diante e grava ate a conexao acabar. Devolve quantos bytes trouxe. */
async function umaTentativa(roda: Pick<RodaDoTorch, 'arquivo' | 'url' | 'sha256' | 'bytes'>, parte: string, meta: string, m: MetaDaParte, n: number, o: OpcoesDaDescarga): Promise<number> {
  const ctl = new AbortController()
  const cancelar = (): void => ctl.abort()
  o.signal.addEventListener('abort', cancelar, { once: true })
  let silencio: NodeJS.Timeout | null = null
  const rearmar = (): void => {
    if (silencio) clearTimeout(silencio)
    silencio = setTimeout(() => ctl.abort(new Error(`sem dados ha ${Math.round((o.silencioMs ?? SILENCIO_PADRAO) / 1000)} s`)), o.silencioMs ?? SILENCIO_PADRAO)
  }
  try {
    const headers: Record<string, string> = { 'Accept-Encoding': 'identity' }
    if (n > 0) {
      headers['Range'] = `bytes=${n}-`
      // Etag fraco nao vale no If-Range: sem ele, o 206 e conferido pelo Content-Range e o hash no fim pega o resto.
      if (m.etag && !m.etag.startsWith('W/')) headers['If-Range'] = m.etag
    }
    rearmar()
    const r = await o.fetch(roda.url, { headers, signal: ctl.signal, cache: 'no-store' })
    if (r.status === 416) {
      await r.body?.cancel().catch(() => {})
      // O servidor diz que nao ha nada depois de n: ou ja esta inteiro (o hash decide), ou a parte e de outro arquivo.
      if (n !== roda.bytes) await rm(parte, { force: true })
      return 0
    }
    let inicio: number
    if (r.status === 206 && n > 0) {
      const faixa = lerContentRange(r.headers.get('content-range'))
      if (!faixa || faixa.inicio !== n || (faixa.total !== null && faixa.total !== roda.bytes)) {
        await r.body?.cancel().catch(() => {})
        o.log(`[baixar] ${roda.arquivo}: content-range inesperado (${r.headers.get('content-range')}), recomecando`)
        await rm(parte, { force: true })
        throw new Error('content-range inesperado')
      }
      inicio = n
    } else if (r.status === 200 || r.status === 206) {
      // 200: o servidor ignorou o Range (ou o If-Range nao bateu: o arquivo mudou). Do zero.
      if (n > 0) o.log(`[baixar] ${roda.arquivo}: o servidor mandou do inicio (HTTP ${r.status}), recomecando`)
      inicio = 0
    } else if (r.status >= 500 || r.status === 408 || r.status === 429) {
      await r.body?.cancel().catch(() => {})
      throw new Error(`HTTP ${r.status}`)
    } else {
      await r.body?.cancel().catch(() => {})
      throw falha('sem-internet', `HTTP ${r.status} em ${roda.url}`, `O servidor do PyTorch recusou o download (HTTP ${r.status}).`)
    }
    const etag = r.headers.get('etag')
    if (etag !== m.etag && inicio === 0) {
      m.etag = etag
      await writeFile(meta, JSON.stringify(m), 'utf8')
    }
    if (!r.body) throw new Error('resposta sem corpo')

    const arquivo = await open(parte, inicio === 0 ? 'w' : 'a')
    let escrito = inicio
    let trouxe = 0
    try {
      const leitor = r.body.getReader()
      let pendentes: Uint8Array[] = []
      let noBloco = 0
      const gravar = async (): Promise<void> => {
        if (noBloco === 0) return
        const bloco = pendentes.length === 1 ? pendentes[0]! : Buffer.concat(pendentes, noBloco)
        pendentes = []
        noBloco = 0
        await arquivo.write(bloco)
        o.aoAndar(escrito)
      }
      try {
        for (;;) {
          const { done, value } = await leitor.read()
          if (done) break
          rearmar()
          if (escrito + value.byteLength > roda.bytes) throw new Error(`o servidor mandou mais que ${roda.bytes} bytes`)
          pendentes.push(value)
          noBloco += value.byteLength
          escrito += value.byteLength
          trouxe += value.byteLength
          if (noBloco >= BLOCO) await gravar()
        }
      } finally {
        // A conexao caiu no meio: o que ja chegou e valido e fica no disco (a retomada parte dali).
        await gravar()
      }
    } finally {
      await arquivo.close().catch(() => {})
    }
    return trouxe
  } catch (e) {
    if (o.signal.aborted) throw new InstalacaoCancelada()
    // O motivo do abort do silencio vira a mensagem (o fetch so diz "aborted").
    if (ctl.signal.aborted && ctl.signal.reason instanceof Error) throw ctl.signal.reason
    throw e
  } finally {
    if (silencio) clearTimeout(silencio)
    o.signal.removeEventListener('abort', cancelar)
  }
}

/**
 * Baixa (ou continua) a roda em `pasta` e devolve o caminho do .whl conferido.
 * Lanca FalhaDaInstalacao (sem-internet, sem-espaco, arquivo-corrompido) ou
 * InstalacaoCancelada.
 */
export async function baixarRoda(
  roda: Pick<RodaDoTorch, 'arquivo' | 'url' | 'sha256' | 'bytes'>,
  pasta: string,
  o: OpcoesDaDescarga,
): Promise<string> {
  await mkdir(pasta, { recursive: true })
  const final = join(pasta, roda.arquivo)
  const parte = `${final}.part`
  const meta = `${parte}.json`
  if (tamanho(final) === roda.bytes) {
    o.aoAndar(roda.bytes)
    return final
  }
  if (existsSync(final)) await rm(final, { force: true })

  let m = lerMeta(meta)
  if (!m || m.url !== roda.url || m.sha256 !== roda.sha256 || m.bytes !== roda.bytes) {
    await rm(parte, { force: true })
    m = { url: roda.url, sha256: roda.sha256, bytes: roda.bytes, etag: null }
    await writeFile(meta, JSON.stringify(m), 'utf8')
  }

  // Retomada de outra sessao (o app fechou, a luz caiu): o fim do .part pode nao estar no disco.
  const deAntes = tamanho(parte) ?? 0
  if (deAntes > 0 && deAntes <= roda.bytes) {
    const recuo = Math.max(0, deAntes - (o.margemDaRetomada ?? MARGEM_DA_RETOMADA))
    await truncate(parte, recuo)
    o.log(`[baixar] ${roda.arquivo}: retomando de ${recuo} (recuou ${deAntes - recuo} bytes do fim do .part)`)
  }

  const esperas = o.esperas ?? ESPERAS_PADRAO
  let tentativa = 0
  for (;;) {
    if (o.signal.aborted) throw new InstalacaoCancelada()
    let n = tamanho(parte) ?? 0
    if (n > roda.bytes) {
      await rm(parte, { force: true })
      n = 0
    }
    o.aoAndar(n)
    if (n === roda.bytes) break
    try {
      const trouxe = await umaTentativa(roda, parte, meta, m, n, o)
      if (trouxe > 0) tentativa = 0
      // A conexao fechou antes do fim sem erro (servidor cortou): retoma ja, sem contar.
      if ((tamanho(parte) ?? 0) < roda.bytes && trouxe === 0) throw new Error('a conexao fechou sem mandar nada')
    } catch (e) {
      if (e instanceof InstalacaoCancelada || o.signal.aborted) throw new InstalacaoCancelada()
      if (e instanceof FalhaDaInstalacao) throw e
      if (ehSemEspaco(e)) throw falha('sem-espaco', e instanceof Error ? e.message : String(e))
      const texto = e instanceof Error ? `${e.message}${(e as { cause?: { message?: string } }).cause?.message ? ` (${(e as { cause: { message: string } }).cause.message})` : ''}` : String(e)
      // Trouxe bytes antes de cair: a conta das tentativas recomeca.
      if ((tamanho(parte) ?? 0) > n) tentativa = 0
      if (tentativa >= esperas.length) throw falha('sem-internet', `${roda.arquivo}: ${texto}`)
      o.log(`[baixar] ${roda.arquivo}: ${texto}; tentando de novo em ${Math.round(esperas[tentativa]! / 1000)} s`)
      await esperar(esperas[tentativa]!, o.signal)
      tentativa += 1
    }
  }

  o.aoConferir?.()
  const hash = await sha256DoArquivo(parte, o.signal)
  if (hash !== roda.sha256) {
    await rm(parte, { force: true })
    await rm(meta, { force: true })
    throw falha('arquivo-corrompido', `${roda.arquivo}: sha256 ${hash}, esperado ${roda.sha256}`)
  }
  await rename(parte, final)
  await rm(meta, { force: true })
  o.log(`[baixar] ${roda.arquivo}: ok (${roda.bytes} bytes, sha256 conferido)`)
  return final
}
