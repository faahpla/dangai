/**
 * OS TESTES DO NUCLEO, todos: `npm test`.
 *
 * Roda cada scripts/teste/v-*.ts num processo proprio (um teste que trava ou
 * sai com process.exit nao leva os outros junto) e termina com erro se algum
 * falhar. E o mesmo comando que o GitHub roda antes de publicar uma versao e a
 * cada push no main (.github/workflows/testes.yml): versao com teste quebrado
 * nao chega em ninguem.
 *
 * O tsx vai fixo na versao: o GitHub baixa sempre a mesma, e aqui o npx usa a
 * que ja esta no cache.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const TSX = 'tsx@4.23.15'
// O que importa codigo da janela (alias @/) precisa do tsconfig dela.
const COM_O_DA_JANELA = new Set(['v-recentes-modulos.ts'])

const testes = readdirSync('scripts/teste')
  .filter((nome) => /^v-.*\.ts$/.test(nome))
  .sort()
const falharam = []
const inicio = Date.now()

for (const nome of testes) {
  const comeco = Date.now()
  const tsconfig = COM_O_DA_JANELA.has(nome) ? 'tsconfig.web.json' : 'tsconfig.node.json'
  const r = spawnSync(`npx --yes ${TSX} --tsconfig ${tsconfig} scripts/teste/${nome}`, {
    shell: true,
    encoding: 'utf8',
    timeout: 5 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  const passou = r.status === 0
  const tempo = ((Date.now() - comeco) / 1000).toFixed(1)
  console.log(`${passou ? 'ok   ' : 'FALHA'} ${nome} (${tempo}s)`)
  if (!passou) {
    falharam.push(nome)
    const saida = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`
    console.log(saida.trimEnd().split('\n').slice(-25).map((l) => `      ${l}`).join('\n'))
  }
}

const total = ((Date.now() - inicio) / 1000).toFixed(0)
if (falharam.length === 0) {
  console.log(`\n${testes.length} testes, todos passaram (${total}s).`)
} else {
  console.log(`\n${falharam.length} de ${testes.length} falharam: ${falharam.join(', ')} (${total}s).`)
  process.exit(1)
}
