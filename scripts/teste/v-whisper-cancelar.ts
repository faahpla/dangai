/**
 * CANCELAR UMA TRANSCRICAO: o pedido sai na hora, o whisper-cli morre quando
 * ninguem mais espera, e quem entrou de carona continua recebendo.
 *
 *   DANGAI_WHISPER=<pasta com Release/whisper-cli.exe e ggml-small.bin> \
 *   npx tsx --tsconfig tsconfig.node.json scripts/teste/v-whisper-cancelar.ts <audio>
 *
 * Sem o Whisper ou sem audio, pula (nada a medir nesta maquina).
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { configureWhisper, transcribe } from '../../electron/services/whisper.ts'

const dir = process.env['DANGAI_WHISPER']
const audio = process.argv[2]
if (!dir || !audio || !existsSync(join(dir, 'Release', 'whisper-cli.exe')) || !existsSync(audio)) {
  console.log('Sem o Whisper ou sem audio nesta maquina: pulado.')
  process.exit(0)
}
configureWhisper(dir)

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}
const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const vivos = (): number => {
  try {
    return execSync('tasklist /FI "IMAGENAME eq whisper-cli.exe" /NH', { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.toLowerCase().includes('whisper-cli')).length
  } catch {
    return 0
  }
}
const nada = (): void => {}

async function principal(): Promise<void> {
// 1. Um pedido so, cancelado no meio: sai na hora e o processo morre.
{
  const ctl = new AbortController()
  const t0 = Date.now()
  const p = transcribe(audio, 'small', nada, [], ctl.signal)
  let rodando = false
  for (let i = 0; i < 60 && !rodando; i++) {
    await espera(250)
    rodando = vivos() > 0
  }
  ok('o whisper-cli subiu', rodando)
  ctl.abort()
  const erro = await p.then(() => null, (e: Error) => e)
  const saiu = Date.now() - t0
  ok('o pedido sai com AbortError', erro?.name === 'AbortError', erro?.message)
  await espera(1000)
  ok('o whisper-cli morreu', vivos() === 0, `${vivos()} vivo(s)`)
  console.log(`        (saiu ${saiu} ms depois de pedir)`)
}

// 2. Dois pedidos do mesmo audio; um desiste: o outro recebe a transcricao.
{
  const ctl = new AbortController()
  const a = transcribe(audio, 'small', nada, [], ctl.signal)
  const b = transcribe(audio, 'small', nada, [])
  for (let i = 0; i < 60 && vivos() === 0; i++) await espera(250)
  ctl.abort()
  const ea = await a.then(() => null, (e: Error) => e)
  ok('quem desistiu sai com AbortError', ea?.name === 'AbortError')
  await espera(800)
  ok('o processo segue vivo para o outro', vivos() > 0)
  const tb = await b
  ok('quem ficou recebe a transcricao', (tb?.words.length ?? 0) > 0, `${tb?.words.length ?? 0} palavras`)
}

// 3. Depois de um cancelamento a fila nao fica travada.
{
  const ctl = new AbortController()
  const c = transcribe(audio, 'small', nada, [], ctl.signal)
  ctl.abort()
  await c.catch(() => {})
  const d = await transcribe(audio, 'small', nada, [])
  ok('a proxima transcricao anda', (d?.words.length ?? 0) > 0)
}

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
}
void principal()
