/**
 * CORTAR ERROS (V1) de ponta a ponta, no audio IMPORTADO, sem gastar nada:
 * Whisper e wav2vec2 locais, a voz do Windows (Maria, pt-BR) fazendo o Levi.
 *
 * O audio: o roteiro do S4-37 (17 frases) lido com 3 erros --
 *   - "Eeee..." antes da 2a frase;
 *   - "quando... quando" na 3a (palavra repetida);
 *   - a 5a frase lida duas vezes (a 1a com "cuidar dos projetos").
 * E um 2o audio com uma sobra LONGA (5 s, nada a ver com o roteiro).
 *
 * Confere:
 *   1. os 3 erros achados e cortados (pontas em quadro calado, nunca em palavra
 *      do roteiro); TODAS as palavras do roteiro ficam, com o texto do roteiro;
 *   2. o Whisper de novo na narracao final: nada de "cuidar", um "quando" so,
 *      nenhum erro sobrando;
 *   3. o tempo das palavras contra o audio novo (alinhador de novo), com a
 *      mesma tolerancia do importado de hoje (mediana <= 20 ms, p90 <= 40 ms),
 *      sem e com o corte de pausa e a 1,15x;
 *   4. desligar = take novo de graca, sem corte (narracao = bruto); ligar de
 *      novo volta ao take de antes;
 *   5. a sobra longa fica, com aviso, e as palavras continuam no lugar.
 *
 * Rodar da raiz:
 *   npx esbuild modulos/recap/teste/v-voz-erros.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-voz-erros.cjs
 *   npx electron out/teste/v-voz-erros.cjs
 */
import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { roteiroAtual } from '../shared/roteiro'
import { conferirTake, textoParaNarrar, type TakeDaVoz, type VozGerada } from '../shared/voz'
import { alinharAoAudio, configureAlinhador } from '../../../electron/services/alinhador'
import { configurarEpisodios } from '../electron/episodio/perfil'
import { lerRascunhoDoDisco } from '../electron/gerar/rascunho'
import { configureSettings, type Cofre } from '../../../electron/services/settings'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { guardarContexto } from '../electron/contexto'
import { configureWhisper, transcribe } from '../../../electron/services/whisper'
import { ffmpegPath } from '../../../electron/services/ffmpeg-path'
import { ajustarVoz, importarAudio } from '../electron/voz/gerar'
import { medirEnergia } from '../electron/voz/pos'
import { paraOModelo } from '../electron/voz/alinhamento'
import { acharCandidatos } from '../electron/voz/casar-fala'
import { arquivoDaVoz } from '../electron/voz/pastas'
import { lerWavDoDisco, sha256 } from '../electron/voz/wav'

// Fora do Electron (tsx/node puro) o `app` nao existe: pular com aviso em vez de
// quebrar -- e nunca cair num userData na raiz do repo. Rode pelo electron (ver acima).
if (!process.versions.electron) {
  console.log('v-voz-erros: pulado (precisa do Electron: npx electron <bundle>)')
  process.exit(0)
}

let falhas = 0
let total = 0
function ok(nome: string, cond: boolean, detalhe = ''): void {
  total++
  if (cond) console.log(`  ok   ${nome}${detalhe ? `  (${detalhe})` : ''}`)
  else {
    falhas++
    console.log(`  FALHA ${nome}${detalhe ? `\n        ${detalhe}` : ''}`)
  }
}
const ms = (s: number): string => `${(s * 1000).toFixed(1)} ms`

const RASCUNHO_REAL = join(process.cwd(), 'modulos', 'recap', 'teste', 'fixture', 'rascunho-s4e37-17frases.json')
const temModelos = (dir: string): boolean =>
  existsSync(join(dir, 'alinhamento', 'model_fp16.onnx')) &&
  existsSync(join(dir, 'alinhamento', 'vocab.json')) &&
  existsSync(join(dir, 'whisper', 'Release', 'whisper-cli.exe'))
const MODELOS = [process.env['MODELOS'], join(process.env['APPDATA'] ?? '', 'AniRecap Studio')].find(
  (d): d is string => typeof d === 'string' && d.length > 0 && temModelos(d),
) ?? null
const BASE = join(tmpdir(), 'anirecap-v-voz-erros')
const USER = join(BASE, 'userData')
rmSync(BASE, { recursive: true, force: true })
mkdirSync(join(USER, 'recaps'), { recursive: true })
app.setPath('userData', USER)

const cofre: Cofre = {
  isEncryptionAvailable: () => true,
  encryptString: (t) => Buffer.from(t, 'utf8'),
  decryptString: (b) => b.toString('utf8'),
}

// ------------------------------------------------ a voz do Windows
const PS_FALAR = join(BASE, 'falar.ps1')
writeFileSync(
  PS_FALAR,
  [
    'param([string]$entrada, [string]$saida)',
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$s.SelectVoice('Microsoft Maria Desktop')",
    '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    '$s.SetOutputToWaveFile($saida, $fmt)',
    '$texto = [System.IO.File]::ReadAllText($entrada, [System.Text.Encoding]::UTF8)',
    '$s.Speak($texto)',
    '$s.Dispose()',
  ].join('\r\n'),
  'utf8',
)
/** WAV 22,05 kHz da Maria (pt-BR) falando o texto, em .m4a (como o Levi grava). */
function falarNoWindows(texto: string): string {
  const h = sha256(texto).slice(0, 12)
  const entrada = join(BASE, `win-${h}.txt`)
  const wav = join(BASE, `win-${h}.wav`)
  const m4a = join(BASE, `win-${h}.m4a`)
  writeFileSync(entrada, texto, 'utf8')
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_FALAR, '-entrada', entrada, '-saida', wav], { windowsHide: true })
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '160k', m4a], { windowsHide: true })
  return m4a
}

function erros(a: readonly number[], b: readonly number[]): { med: number; p90: number; max: number } {
  const d = a.map((x, i) => Math.abs(x - b[i]!)).sort((x, y) => x - y)
  return { med: d[Math.floor(d.length / 2)]!, p90: d[Math.floor(d.length * 0.9)]!, max: d.at(-1)! }
}

let pedidoN = 0
const pid = (): string => `e${++pedidoN}`
const progresso = (): void => {}

/** O alinhador de novo na narracao final, com as palavras do roteiro: o "juiz" do tempo. */
async function juiz(id: string, t: TakeDaVoz): Promise<{ med: number; p90: number; max: number; score: number; pior: string }> {
  const novo = await alinharAoAudio(arquivoDaVoz(id, t.arquivo), paraOModelo(t.palavras.map((p) => p.texto)), () => {})
  const e = erros(t.palavras.map((p) => p.start), novo!.tempos.map((x) => x.start))
  const k = t.palavras.reduce((m, p, i) => (Math.abs(p.start - novo!.tempos[i]!.start) > Math.abs(t.palavras[m]!.start - novo!.tempos[m]!.start) ? i : m), 0)
  const pior = `pior "${t.palavras[k]!.texto}"#${k} (score do juiz ${novo!.tempos[k]!.score.toFixed(2)})`
  return { ...e, score: novo!.score, pior }
}

async function testes(): Promise<void> {
  if (!MODELOS) {
    console.log('sem Whisper/wav2vec2 nesta maquina: teste pulado')
    return
  }
  configureSettings(USER, cofre)
  configurarEpisodios(USER)
  configureAlinhador(MODELOS) // so le o modelo
  configureWhisper(join(MODELOS, 'whisper')) // so le o binario e o modelo
  guardarContexto({
    id: 'recap',
    config: () => ({ libraryDir: '', iaProvedor: 'gemini', whisperModel: 'small', modulo: { biblioteca: '' } }),
    chave: () => '',
    ligado: () => true,
  } as unknown as ContextoDoModulo)

  const original = readFileSync(RASCUNHO_REAL, 'utf8')
  const copia = (id: string): string => {
    const c = JSON.parse(original) as Record<string, unknown>
    c['id'] = id
    writeFileSync(join(USER, 'recaps', `${id}.json`), JSON.stringify(c))
    return id
  }
  const ID = copia('rc_25d63d4babd6_erros1')
  const narrar = textoParaNarrar(roteiroAtual(lerRascunhoDoDisco(ID))!)
  const tokens = narrar.frases.flatMap((f) => f.palavras)
  const textos = narrar.frases.map((f) => f.texto)

  // ------------------------------------------------ 1. o audio com 3 erros
  console.log('1. importar o audio com 3 erros (Cortar erros ligado)')
  const comErros = textos
    .map((t, i) => {
      if (i === 1) return `Éééé... ${t}`
      if (i === 2) return t.replace('quando o', 'quando... quando o')
      if (i === 4) return `O Ryusui fundou o conglomerado dele para cuidar dos projetos.\n\n${t}`
      return t
    })
    .join('\n\n')
  ok('o texto falado tem os 3 erros', comErros.includes('Éééé') && comErros.includes('quando... quando') && comErros.includes('cuidar dos projetos'))
  const m4a = falarNoWindows(comErros)
  const t0 = Date.now()
  const g1: VozGerada = await importarAudio(ID, { caminho: m4a, velocidade: 1, cortarPausas: false, cortarErros: true, pedidoId: pid() }, progresso)
  const t1 = g1.take
  console.log(`  (import em ${((Date.now() - t0) / 1000).toFixed(1)} s, score ${t1.qualidade?.score?.toFixed(2)}, suspeitas ${t1.qualidade?.suspeitas})`)
  const achados = t1.bruto.erros
  for (const er of achados) console.log(`    ${er.tipo} "${er.falado}" ${er.de.toFixed(2)}-${er.ate.toFixed(2)} corte ${er.corte ? `${er.corte.de.toFixed(3)}-${er.corte.ate.toFixed(3)}` : `nao (${er.motivo})`}`)
  const cortados = achados.filter((e) => e.corte)
  if (process.env['DEPURAR']) {
    const b = lerWavDoDisco(arquivoDaVoz(ID, t1.bruto.arquivo))
    const en = medirEnergia(b)
    console.log(`    limiar ${en.limiar.toFixed(1)} fala ${en.fala.toFixed(1)}`)
    for (const er of achados.filter((x) => !x.corte)) {
      const k = t1.bruto.palavras.findIndex((p) => p.start >= er.ate - 0.05)
      const ant = t1.bruto.palavras[k - 1]
      const dep = t1.bruto.palavras[k]
      console.log(`    "${er.falado}": antes "${ant?.texto}" ${ant?.start.toFixed(2)}-${ant?.end.toFixed(2)}, depois "${dep?.texto}" ${dep?.start.toFixed(2)}-${dep?.end.toFixed(2)}`)
      const a = (ant?.end ?? 0) - 0.1
      const z = (dep?.start ?? 0) + 0.1
      const linha: string[] = []
      for (let q = Math.floor((a * en.taxa) / en.amostrasPorQuadro); q < Math.ceil((z * en.taxa) / en.amostrasPorQuadro); q++) {
        linha.push(en.db[q]! <= en.limiar ? '_' : en.db[q]! > en.fala - 20 ? '#' : '.')
      }
      console.log(`    ${a.toFixed(2)} ${linha.join('')} ${z.toFixed(2)}`)
    }
  }
  ok('os 3 erros achados e cortados', cortados.length === 3, `${cortados.length} cortados de ${achados.length}`)
  ok('tipos: hesitacao + 2 repeticoes', cortados.filter((e) => e.tipo === 'repeticao').length === 2 && cortados.some((e) => e.tipo === 'hesitacao'), cortados.map((e) => e.tipo).join(','))
  ok('a frase repetida: sai a 1a leitura ("cuidar")', cortados.some((e) => /cuidar/i.test(e.falado)))
  ok('config: cortarErros ligado', t1.config.fonte === 'importado' && t1.config.cortarErros)
  ok('TODAS as palavras do roteiro ficam, com o texto do roteiro', t1.palavras.map((p) => p.texto).join(' ') === tokens.join(' '), `${t1.palavras.length}/${tokens.length}`)
  ok('conferirTake (narracao e bruto) vazio', conferirTake(t1).length === 0 && conferirTake({ duracao: t1.bruto.duracao, palavras: t1.bruto.palavras, trechos: t1.bruto.trechos }).length === 0)
  const bruto = lerWavDoDisco(arquivoDaVoz(ID, t1.bruto.arquivo))
  const e = medirEnergia(bruto)
  // Calado (o limiar da pausa) ou quieto (30 dB abaixo da fala, a emenda entre palavras): erros.ts.
  const quieto = (t: number): boolean => e.db[Math.floor((t * e.taxa) / e.amostrasPorQuadro)]! <= Math.max(e.limiar, e.fala - 30)
  ok('as pontas de cada corte em quadro calado/quieto', cortados.every((c) => quieto(c.corte!.de) && quieto(c.corte!.ate)),
    cortados.map((c) => `${e.db[Math.floor((c.corte!.de * e.taxa) / e.amostrasPorQuadro)]!.toFixed(0)}/${e.db[Math.floor((c.corte!.ate * e.taxa) / e.amostrasPorQuadro)]!.toFixed(0)} dB`).join(' '))
  ok('nenhum corte encosta em palavra do roteiro', cortados.every((c) => t1.bruto.palavras.every((p) => p.end <= c.corte!.de || p.start >= c.corte!.ate)))
  const cortado = cortados.reduce((s, c) => s + c.corte!.ate - c.corte!.de, 0)
  ok('narracao = bruto - cortes (sem pausa, 1x)', Math.abs(t1.duracao - (t1.bruto.duracao - cortado)) < 0.01, `${t1.duracao.toFixed(3)} = ${t1.bruto.duracao.toFixed(3)} - ${cortado.toFixed(3)}`)

  // ------------------------------------------------ 2. o Whisper de novo na narracao final
  console.log('\n2. o Whisper de novo na narracao final')
  const ouvido = await transcribe(arquivoDaVoz(ID, t1.arquivo), 'small', () => {})
  const palavrasOuvidas = (ouvido?.words ?? []).map((w) => w.text)
  const texto = palavrasOuvidas.join(' ')
  ok('nada de "cuidar dos projetos"', !/cuidar/i.test(texto), texto.slice(0, 200))
  ok('"quando" uma vez so', (texto.match(/\bquando\b/gi) ?? []).length === 1)
  const sobrou = acharCandidatos(tokens, palavrasOuvidas)
  ok('nenhum erro sobrando no casamento com o roteiro', sobrou.candidatos.length === 0, JSON.stringify(sobrou.candidatos.map((c) => c.ouvidas.map((j) => palavrasOuvidas[j]).join(' '))))

  // ------------------------------------------------ 3. o tempo das palavras
  console.log('\n3. o tempo das palavras contra o audio novo (mediana <= 20 ms, p90 <= 40 ms)')
  {
    const j = await juiz(ID, t1)
    ok('so os erros, 1x', j.med <= 0.02 && j.p90 <= 0.04, `mediana ${ms(j.med)} p90 ${ms(j.p90)} max ${ms(j.max)} ${j.pior}`)
  }
  const g2 = await ajustarVoz(ID, { velocidade: 1, cortarPausas: true, cortarErros: true, pedidoId: pid() }, progresso)
  {
    const j = await juiz(ID, g2.take)
    ok('erros + pausas, 1x', j.med <= 0.02 && j.p90 <= 0.04, `mediana ${ms(j.med)} p90 ${ms(j.p90)} max ${ms(j.max)} ${j.pior}; ${g2.take.duracao.toFixed(2)} s`)
    ok('com pausas: mais curta que so os erros', g2.take.duracao < t1.duracao - 1)
  }
  const g3 = await ajustarVoz(ID, { velocidade: 1.15, cortarPausas: true, cortarErros: true, pedidoId: pid() }, progresso)
  {
    // O atempo custa ate ~25 ms por palavra (v-voz-motor, v0.1.0): a mesma folga dele.
    const j = await juiz(ID, g3.take)
    ok('erros + pausas, 1,15x', j.med <= 0.025 && j.p90 <= 0.045, `mediana ${ms(j.med)} p90 ${ms(j.p90)} max ${ms(j.max)} ${j.pior}`)
    ok('1,15x: todas as palavras', g3.take.palavras.length === tokens.length && conferirTake(g3.take).length === 0)
  }

  // ------------------------------------------------ 4. desligar e ligar
  console.log('\n4. desligar = take novo de graca, sem corte')
  const g4 = await ajustarVoz(ID, { velocidade: 1, cortarPausas: false, cortarErros: false, pedidoId: pid() }, progresso)
  const t4 = g4.take
  ok('desligado: narracao = bruto (mesma duracao)', Math.abs(t4.duracao - t4.bruto.duracao) < 0.005, `${t4.duracao.toFixed(3)} / ${t4.bruto.duracao.toFixed(3)}`)
  ok('desligado: os erros continuam guardados no bruto', t4.bruto.erros.length === achados.length && t4.config.fonte === 'importado' && !t4.config.cortarErros)
  ok('desligado: palavras = as do bruto', t4.palavras.every((p, i) => Math.abs(p.start - t4.bruto.palavras[i]!.start) < 0.002))
  ok('desligado: 0 cobrado', g4.cobrados === 0 && t4.cobrados === 0)
  {
    // A mesma conta sem corte nenhum (o pior "Why-Man"/"decidiu" e da voz do Windows, nao do corte).
    const j = await juiz(ID, t4)
    console.log(`    (sem corte: mediana ${ms(j.med)} p90 ${ms(j.p90)} max ${ms(j.max)} ${j.pior})`)
  }
  const g5 = await ajustarVoz(ID, { velocidade: 1, cortarPausas: false, cortarErros: true, pedidoId: pid() }, progresso)
  ok('ligar de novo: volta ao 1o take (mesmo arquivo)', g5.take.id === t1.id && g5.take.arquivo === t1.arquivo, `${g5.take.id} / ${t1.id}`)

  // ------------------------------------------------ 5. a sobra longa
  console.log('\n5. sobra longa (5 s fora do roteiro): fica, com aviso')
  const ID2 = copia('rc_25d63d4babd6_erros2')
  const comSobra = textos
    .map((t, i) => (i === 8 ? `${t}\n\nHoje o dia esta muito bonito e eu vou tomar um cafe com bolo de cenoura depois da gravacao de hoje.` : t))
    .join('\n\n')
  const m4a2 = falarNoWindows(comSobra)
  const g6 = await importarAudio(ID2, { caminho: m4a2, velocidade: 1, cortarPausas: false, cortarErros: true, pedidoId: pid() }, progresso)
  const t6 = g6.take
  for (const er of t6.bruto.erros) console.log(`    ${er.tipo} "${er.falado}" ${er.de.toFixed(2)}-${er.ate.toFixed(2)} corte ${er.corte ? 'sim' : `nao (${er.motivo})`}`)
  const longo = t6.bruto.erros.find((x) => x.motivo === 'longo')
  ok('a sobra longa foi achada e ficou ("longo")', longo !== undefined && longo.corte === null && longo.ate - longo.de > 4)
  ok('nenhum corte nela', !t6.bruto.erros.some((x) => x.corte && /cafe|bolo/i.test(x.falado)))
  ok('aviso no take', t6.avisos.some((a) => a.includes('trecho longo')), t6.avisos.join(' | '))
  ok('todas as palavras do roteiro', t6.palavras.map((p) => p.texto).join(' ') === tokens.join(' '))
  ok('narracao = bruto (nada cortado)', Math.abs(t6.duracao - t6.bruto.duracao) < 0.005)
}

app
  .whenReady()
  .then(testes)
  .catch((err: unknown) => {
    falhas++
    console.log('ERRO', err instanceof Error ? err.stack : err)
  })
  .finally(() => {
    console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`} em ${total} conferencias`)
    rmSync(BASE, { recursive: true, force: true })
    app.exit(falhas === 0 ? 0 : 1)
  })
