/**
 * A BIBLIOTECA VAZIA USA A PASTA DO ANCUT (17/11).
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-biblioteca-do-ancut.ts`.
 *
 * Tudo no TEMP: LOCALAPPDATA e USERPROFILE apontam para pastas sinteticas, entao
 * o AnCut e os Documentos desta maquina nao entram.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureSettings, getSettings, saidaDoAncut } from '../../electron/services/settings.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const tmp = mkdtempSync(join(tmpdir(), 'dangai-bib-ancut-'))
const local = join(tmp, 'local')
const casa = join(tmp, 'casa')
const ud = join(tmp, 'ud')
const saida = join(tmp, 'Saida do AnCut')
for (const d of [local, casa, ud]) mkdirSync(d, { recursive: true })
process.env['LOCALAPPDATA'] = local
process.env['USERPROFILE'] = casa
process.env['HOME'] = casa
delete process.env['DANGAI_SEM_BIBLIOTECA_DO_ANCUT']

const config = (o: object): void => {
  mkdirSync(join(local, 'CorteCenas', 'CorteCenas'), { recursive: true })
  writeFileSync(join(local, 'CorteCenas', 'CorteCenas', 'config.json'), JSON.stringify(o))
}
const abrir = (s: object | null): string => {
  if (s) writeFileSync(join(ud, 'settings.json'), JSON.stringify(s))
  else rmSync(join(ud, 'settings.json'), { force: true })
  configureSettings(ud)
  return getSettings().libraryDir
}

console.log('Sem AnCut')
ok('sem config nem Documentos: nada', saidaDoAncut() === null)
ok('libraryDir continua vazia', abrir({ libraryDir: '' }) === '')

console.log('Com o AnCut')
config({ output_dir: saida })
ok('output_dir que nao existe: nada', saidaDoAncut() === null)
mkdirSync(saida, { recursive: true })
ok('output_dir da config', saidaDoAncut() === saida)
ok('libraryDir vazia vira a do AnCut', abrir({ libraryDir: '' }) === saida)
ok('settings sem o campo tambem', abrir({}) === saida)
ok('settings que nao existe tambem', abrir(null) === saida)
ok('pasta escolhida continua valendo', abrir({ libraryDir: 'D:\Outra' }) === 'D:\Outra')

console.log('Saida padrao (sem output_dir)')
config({ cache_dir: join(tmp, 'cache') })
const padrao = join(casa, 'Documents', 'CorteCenas', 'Output')
ok('sem a pasta padrao: nada', saidaDoAncut() === null)
mkdirSync(padrao, { recursive: true })
ok('Documentos\CorteCenas\Output', saidaDoAncut() === padrao)
ok('libraryDir vazia vira a padrao', abrir({ libraryDir: '' }) === padrao)

console.log('Desligado pelo ambiente')
process.env['DANGAI_SEM_BIBLIOTECA_DO_ANCUT'] = '1'
ok('com DANGAI_SEM_BIBLIOTECA_DO_ANCUT fica vazia', abrir({ libraryDir: '' }) === '')

rmSync(tmp, { recursive: true, force: true })
console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo ok')
process.exit(falhas ? 1 : 0)
