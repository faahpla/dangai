/**
 * PREPARAR O DANGAI (electron/services/preparar.ts): a lista do que ele baixa
 * na primeira vez diz certo o que falta e o que ja esta aqui, e com tudo
 * presente o "Baixar agora" nao baixa nada nem avisa progresso. Nada aqui vai
 * para a internet: os arquivos sao de mentira, numa pasta temporaria.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-preparar.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAlinhador } from '../../electron/services/alinhador.ts'
import { componentesDoDangai, prepararDangai } from '../../electron/services/preparar.ts'
import { configureSettings } from '../../electron/services/settings.ts'
import { binaryPath, configureWhisper, modelPath } from '../../electron/services/whisper.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

async function principal(): Promise<void> {
  const ud = mkdtempSync(join(tmpdir(), 'dangai-preparar-'))
  const cwdAntes = process.cwd()
  process.chdir(ud) // o navegador do render mora em <cwd>/.remotion, como no app
  configureSettings(ud)
  configureWhisper(join(ud, 'whisper'))
  configureAlinhador(ud)

  const vazio = componentesDoDangai()
  ok('os tres: transcricao, sincronizador, navegador', vazio.map((c) => c.id).join(',') === 'whisper,sincronizador,navegador')
  ok('perfil novo: nenhum pronto', vazio.every((c) => !c.pronto))
  ok('o tamanho do Whisper e o do modelo escolhido (small, 466 MB)', vazio[0]?.mb === 466, String(vazio[0]?.mb))
  ok('o total passa de 1 GB (o que o ajk baixava no meio do video)', vazio.reduce((t, c) => t + c.mb, 0) > 1000)

  // Tudo "baixado" (arquivos de mentira nos lugares de verdade).
  mkdirSync(join(ud, 'whisper', 'Release'), { recursive: true })
  writeFileSync(binaryPath(), 'x')
  writeFileSync(modelPath('small'), 'x')
  mkdirSync(join(ud, 'alinhamento'), { recursive: true })
  writeFileSync(join(ud, 'alinhamento', 'model_fp16.onnx'), 'x')
  writeFileSync(join(ud, 'alinhamento', 'vocab.json'), '{}')
  mkdirSync(join(ud, '.remotion', 'chrome-headless-shell'), { recursive: true })

  ok('com os arquivos no lugar: todos prontos', componentesDoDangai().every((c) => c.pronto), JSON.stringify(componentesDoDangai().map((c) => c.pronto)))
  const avisos: string[] = []
  const depois = await prepararDangai((p) => avisos.push(p.mensagem))
  ok('com tudo pronto, "Baixar agora" nao baixa nem avisa nada', avisos.length === 0 && depois.every((c) => c.pronto), avisos.join(' | '))

  process.chdir(cwdAntes)
  rmSync(ud, { recursive: true, force: true })
  console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
}
void principal()
