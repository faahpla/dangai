/**
 * PROJETO QUE USAVA UM PEDACO MESCLADO ainda abre: o mesclado que comeca nele,
 * o pedaco na lixeira, ou -- lixeira vazia -- o mesclado com aviso.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-relocar-mescla.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openProjectFile } from '../../electron/services/project.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const dir = mkdtempSync(join(tmpdir(), 'dangai-relocar-'))
const ep = join(dir, 'Biblioteca', 'Naruto', 'S01E05')
const shots = join(ep, 'shots')
mkdirSync(shots, { recursive: true })
const audio = join(dir, 'narracao.mp3')
writeFileSync(audio, 'x')
// A mescla: 0010..0012 viraram 0010-0012.mp4; os pedacos foram para a lixeira.
writeFileSync(join(shots, '0010-0012.mp4'), 'mesclado')
writeFileSync(join(shots, '0013.mp4'), 'intacto')
const lixeira = join(ep, '_lixeira', '2026-10-17_10-00-00', 'shots')
mkdirSync(lixeira, { recursive: true })
for (const n of ['0010', '0011', '0012']) writeFileSync(join(lixeira, `${n}.mp4`), n)

const projeto = (clipes: string[]): string => {
  const p = join(dir, `p-${clipes.join('_')}.dangai`)
  writeFileSync(
    p,
    JSON.stringify({
      version: 1, savedAt: '2026-10-17T00:00:00.000Z', formato: 'short',
      audio: { path: audio, rel: null, fileName: 'narracao.mp3' },
      images: clipes.map((c) => ({ path: join(shots, `${c}.mp4`), rel: null, fileName: `${c}.mp4`, focusX: 0.5, focusY: 0.5 })),
      script: null, subtitle: null, plan: null, planOrigin: null, planEdited: false, transcript: null,
      captions: [], captionsEdited: false, captionsEnabled: true, sfxEnabled: false,
    }),
  )
  return p
}

const a = openProjectFile(projeto(['0010', '0011', '0013']))
ok('0010 (o comeco) vira o mesclado, exato', a.file.images[0]!.path === join(shots, '0010-0012.mp4'))
ok('0011 (no meio) vem da lixeira, exato', a.file.images[1]!.path === join(lixeira, '0011.mp4'))
ok('0013 (intacto) fica onde esta', a.file.images[2]!.path === join(shots, '0013.mp4'))
ok('sem aviso quando tudo e exato', (a.avisos ?? []).length === 0)

// A lixeira foi esvaziada: o do meio abre com o mesclado, e com aviso.
rmSync(join(ep, '_lixeira'), { recursive: true, force: true })
const b = openProjectFile(projeto(['0011']))
ok('lixeira vazia: 0011 abre com o mesclado', b.file.images[0]!.path === join(shots, '0010-0012.mp4'))
ok('e avisa que o trecho pode ter mudado', (b.avisos ?? []).length === 1 && /0011\.mp4 foi mesclado em 0010-0012\.mp4/.test(b.avisos![0]!), b.avisos?.[0])

// Um clipe que sumiu de verdade continua recusando, com o nome dele.
let recado = ''
try {
  openProjectFile(projeto(['0099']))
} catch (e) {
  recado = (e as Error).message
}
ok('clipe sumido de verdade ainda recusa', /0099\.mp4/.test(recado), recado.slice(0, 80))

rmSync(dir, { recursive: true, force: true })
console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
