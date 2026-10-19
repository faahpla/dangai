/**
 * O SERVIDOR DE MIDIA SOLTA O ARQUIVO quando o player desiste do pedido.
 *
 * O <video> do preview pede "bytes=0-" e desiste no meio (pulou de ponto,
 * fechou a miniatura). Com `createReadStream().pipe(res)`, a leitura ficava
 * parada, com o arquivo ABERTO, ate o app fechar -- e a pasta do episodio nao
 * ia para a Lixeira ("Enviar para o AnCut" do modulo recap). Aqui: pede um
 * pedaco de um arquivo grande, desiste, e confere que da para apagar a pasta.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-servidor-solta-arquivo.ts`.
 */
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publish, startMediaServer } from '../../electron/services/media-server.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}
const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function principal(): Promise<void> {
  await startMediaServer()
  const pasta = mkdtempSync(join(tmpdir(), 'dangai-solta-'))
  const arquivo = join(pasta, '0001.mp4')
  // 64 MB: maior que qualquer buffer -- a leitura PARA esperando o player.
  writeFileSync(arquivo, Buffer.alloc(64 * 1024 * 1024, 1))
  const url = new URL(publish(arquivo))

  // O player pede o arquivo do comeco ao fim, le um pouco e desiste.
  await new Promise<void>((resolve) => {
    const req = request({ host: url.hostname, port: url.port, path: url.pathname + url.search, headers: { Range: 'bytes=0-' } }, (res) => {
      res.once('data', () => {
        req.destroy()
        resolve()
      })
    })
    req.end()
  })
  await espera(500)

  // Com o arquivo ainda aberto, o Windows nao deixa a pasta sair do lugar.
  let moveu = false
  const outra = `${pasta}-movida`
  try {
    renameSync(pasta, outra)
    moveu = true
  } catch (e) {
    console.log('       ', (e as Error).message.split('\n')[0])
  }
  ok('depois de o player desistir, a pasta sai do lugar', moveu)
  rmSync(moveu ? outra : pasta, { recursive: true, force: true })
  ok('e apaga', !existsSync(pasta) && !existsSync(outra))

  console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
}
void principal()
