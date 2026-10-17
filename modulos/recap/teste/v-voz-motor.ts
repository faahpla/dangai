/**
 * O MOTOR DE VOZ (electron/services/voz/*) de ponta a ponta, SEM gastar
 * credito: o fetch e trocado por provedores FALSOS.
 *
 *   - ElevenLabs falso: audio sintetico com tempos CONHECIDOS (cada palavra e
 *     um tom; pontuacao vira pausa; depois de cada palavra um "rabo" de ruido a
 *     -45 dB que o alignment NAO cobre, como um "s" final), e o alignment por
 *     caractere desse audio. Da para medir no WAV, amostra por amostra, onde
 *     cada palavra soa;
 *   - Fish falso: a voz do Windows em PT-BR (System.Speech, Maria), que nao
 *     traz tempo nenhum -> alinhador do Dangai;
 *   - importado: a mesma voz do Windows num .m4a, como se o Levi tivesse
 *     gravado.
 *
 * Confere:
 *   1. o corte de pausa: depois dele, cada palavra do take bate com o tom no
 *      audio novo (<= 2 ms), nenhuma pausa longa sobra, nenhum tom encolhe, o
 *      rabo da consoante fica inteiro, e nenhum corte cai em som;
 *   2. acelerar (o pos): o tempo das palavras contra o audio do atempo;
 *   3. regravar uma frase: as anteriores ficam iguais, as seguintes andam pela
 *      diferenca EXATA, e o audio novo bate com os tempos;
 *   4. cache: o mesmo pedido nao chama o provedor de novo (outro rascunho,
 *      ajuste, texto que volta), e muda de chave quando o settings muda;
 *   5. normalizado, recusa do wav_44100, cancelar antes/depois de pagar,
 *      custo que mudou, importado sem "regravar";
 *   6. Fish e importado: o tempo das palavras depois do corte, medido de novo
 *      com o alinhador no audio novo;
 *   7. velocidade NATIVA 1,2 (15/10): o speed vai no corpo, a chave muda, o
 *      regravar usa a do take, o acelerar fica de graca e o ritmo e aprendido.
 *
 * O rascunho e uma COPIA do S4-37 aprovado, numa pasta temporaria. O Whisper e
 * o wav2vec2 sao lidos (so leitura) do %APPDATA%/AniRecap Studio.
 *
 * Rodar da raiz:
 *   npx esbuild modulos/recap/teste/v-voz-motor.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-voz-motor.cjs
 *   npx electron out/teste/v-voz-motor.cjs
 * (SAIDA=<pasta> guarda WAVs e palavras para ouvir/inspecionar.)
 */
import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aplicarEdicao, lerRascunho, marcarAprovado, roteiroAtual, type RascunhoDoRecap } from '../shared/roteiro'
import {
  conferirTake,
  configPadrao,
  estadoDaVoz,
  podeIrParaCenas,
  situacaoDaVoz,
  takeAtual,
  textoParaNarrar,
  type ConfigDaVoz,
  type EstimativaDeCusto,
  type PalavraComTempo,
  type TakeDaVoz,
  type VozGerada,
} from '../shared/voz'
import { alinharAoAudio, configureAlinhador } from '../../../electron/services/alinhador'
import { configurarEpisodios } from '../electron/episodio/perfil'
import { gravarRascunho, lerRascunhoDoDisco } from '../electron/gerar/rascunho'
import { configureSettings, type Cofre } from '../../../electron/services/settings'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { guardarContexto } from '../electron/contexto'
import { configureWhisper } from '../../../electron/services/whisper'
import { estimarVoz } from '../electron/voz/estimar'
import { ffmpegPath } from '../../../electron/services/ffmpeg-path'
import { ajustarVoz, cancelarVoz, gerarVoz, importarAudio, regravarFrases } from '../electron/voz/gerar'
import { cortesDasPausas, medirEnergia, palavrasSuspeitas } from '../electron/voz/pos'
import { paraOModelo } from '../electron/voz/alinhamento'
import { medirLoudness } from '../electron/voz/volume'
import { chaveDoCache } from '../electron/voz/cache'
import { arquivoDaVoz, pastaDoCacheDaVoz } from '../electron/voz/pastas'
import { palavrasDosCaracteres, palavrasPeloTexto, tokensComFaixa, type AlinhamentoDeCaracteres } from '../electron/voz/palavras'
import { lerWavDoDisco, sha256, wavDoPcm, type Pcm } from '../electron/voz/wav'
import { aprovarVoz } from '../electron/voz/takes'
import { lerMedidas, ritmoDoRascunho } from '../electron/voz/ritmo'
import { chaveDoRitmo } from '../shared/ritmo'

// ------------------------------------------------------------------ conferir
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
async function erroDe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return '(nao lancou)'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
const ms = (s: number): string => `${(s * 1000).toFixed(1)} ms`

// --------------------------------------------------------------- pastas
/**
 * [recap] O rascunho vem da FIXTURE (o rc_25d63d4babd6_mv7cxp1z do Levi, so
 * leitura). O alinhador e o Whisper so sao LIDOS de um perfil que ja os tem
 * (MODELOS=<pasta>, ou o perfil do Studio desta maquina); sem nenhum, as
 * secoes 8 (Fish) e 9 (importado) sao puladas -- nada e baixado.
 */
// Da raiz do projeto (o esbuild muda o __dirname para out/teste).
const RASCUNHO_REAL = join(process.cwd(), 'modulos', 'recap', 'teste', 'fixture', 'rascunho-s4e37-17frases.json')
const temModelos = (dir: string): boolean =>
  existsSync(join(dir, 'alinhamento', 'model_fp16.onnx')) &&
  existsSync(join(dir, 'alinhamento', 'vocab.json')) &&
  existsSync(join(dir, 'whisper', 'Release', 'whisper-cli.exe'))
const MODELOS = [process.env['MODELOS'], join(process.env['APPDATA'] ?? '', 'AniRecap Studio')].find(
  (d): d is string => typeof d === 'string' && d.length > 0 && temModelos(d),
) ?? null
const ID = 'rc_25d63d4babd6_mv7cxp1z'
const ID2 = 'rc_25d63d4babd6_copia2'
const BASE = join(tmpdir(), 'anirecap-v-voz-motor')
const USER = join(BASE, 'userData')
const SAIDA = process.env['SAIDA'] ?? join(BASE, 'saida')
rmSync(BASE, { recursive: true, force: true })
mkdirSync(join(USER, 'recaps'), { recursive: true })
mkdirSync(SAIDA, { recursive: true })
app.setPath('userData', USER)

// Cofre falso (base64): as chaves daqui sao falsas e nunca saem do teste.
const cofre: Cofre = {
  isEncryptionAvailable: () => true,
  encryptString: (t) => Buffer.from(Buffer.from(t, 'utf8').toString('base64'), 'utf8'),
  decryptString: (b) => Buffer.from(b.toString('utf8'), 'base64').toString('utf8'),
}

// ------------------------------------------------------- ElevenLabs falso
const TAXA_FALSA = 44_100
const AMPLITUDE = 9000
const LIMIAR_TOM = 1500

interface Falado {
  pcm: Pcm
  alignment: AlinhamentoDeCaracteres
}

/** Ruido deterministico (LCG) para o rabo da consoante. */
function ruido(semente: number): () => number {
  let s = semente >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296 - 0.5
  }
}

/**
 * Fala "falsa": letra/digito = tom de 60 ms (x fator); hifen/apostrofo entre
 * letras = tom de 30 ms; espaco = 30 ms calado; virgula = 320 ms; ponto = 450 ms;
 * quebra de linha = 200 ms. 0,5 s antes e 0,6 s depois. Depois de cada palavra,
 * 40 ms de ruido a ~-45 dBFS que o alignment NAO cobre (o "s" final).
 */
function falarFalso(texto: string, fator: number, taxa: number): Falado {
  const chars = [...texto]
  const soa = (i: number): boolean => {
    const c = chars[i]!
    if (/[\p{L}\p{N}]/u.test(c)) return true
    if (/\s/.test(c)) return false
    // pontuacao dentro da palavra (Why-Man): soa se tem letra dos dois lados
    return i > 0 && i < chars.length - 1 && /[\p{L}\p{N}]/u.test(chars[i - 1]!) && /[\p{L}\p{N}]/u.test(chars[i + 1]!)
  }
  const dur = (i: number): number => {
    const c = chars[i]!
    if (/[\p{L}\p{N}]/u.test(c)) return 0.06 * fator
    if (soa(i)) return 0.03 * fator
    if (c === ' ') return 0.03
    if (c === '\n') return 0.2
    if (/[.!?]/.test(c)) return 0.45
    if (/[,;:]/.test(c)) return 0.32
    return 0.1
  }
  const ini: number[] = []
  const fim: number[] = []
  let t = 0.5
  for (let i = 0; i < chars.length; i++) {
    ini.push(t)
    t += dur(i)
    fim.push(t)
  }
  const total = t + 0.6
  const amostras = new Int16Array(Math.round(total * taxa))
  const rand = ruido(chars.length * 7 + Math.round(fator * 1000))
  // regioes de tom = sequencias de chars que soam
  let i = 0
  while (i < chars.length) {
    if (!soa(i)) {
      i++
      continue
    }
    let j = i
    while (j + 1 < chars.length && soa(j + 1)) j++
    const a = Math.round(ini[i]! * taxa)
    const b = Math.round(fim[j]! * taxa)
    const rampa = Math.round(0.003 * taxa)
    for (let n = a; n < b; n++) {
      const tt = (n - a) / taxa
      let env = 1
      if (n - a < rampa) env = (n - a) / rampa
      if (b - n < rampa) env = Math.min(env, (b - n) / rampa)
      amostras[n] = Math.round(AMPLITUDE * env * (0.6 * Math.cos(2 * Math.PI * 150 * tt) + 0.4 * Math.cos(2 * Math.PI * 310 * tt)))
    }
    // rabo de 40 ms, so no silencio
    const proxIni = j + 1 < chars.length ? (() => {
      let k = j + 1
      while (k < chars.length && !soa(k)) k++
      return k < chars.length ? Math.round(ini[k]! * taxa) : amostras.length
    })() : amostras.length
    const raboFim = Math.min(proxIni - Math.round(0.005 * taxa), b + Math.round(0.04 * taxa))
    for (let n = b; n < raboFim; n++) amostras[n] = Math.round(rand() * 2 * 180)
    i = j + 1
  }
  return {
    pcm: { taxa, amostras },
    alignment: { characters: chars, character_start_times_seconds: ini, character_end_times_seconds: fim },
  }
}

interface Regiao {
  ini: number
  fim: number
}

/** Onde ha TOM no PCM (|x| > LIMIAR_TOM), juntando buracos < 10 ms (passagens por zero). */
function regioesDeTom(pcm: Pcm, ganhoDb = 0): Regiao[] {
  const r: Regiao[] = []
  const junta = Math.round(0.01 * pcm.taxa)
  // A narracao sai com o ganho do volume (volume.ts): o limiar acompanha, senao a borda do tom "anda".
  const limiar = LIMIAR_TOM * 10 ** (ganhoDb / 20)
  let ini = -1
  let ultimo = -1
  for (let n = 0; n < pcm.amostras.length; n++) {
    if (Math.abs(pcm.amostras[n]!) <= limiar) continue
    if (ini < 0) ini = n
    else if (n - ultimo > junta) {
      r.push({ ini: ini / pcm.taxa, fim: (ultimo + 1) / pcm.taxa })
      ini = n
    }
    ultimo = n
  }
  if (ini >= 0) r.push({ ini: ini / pcm.taxa, fim: (ultimo + 1) / pcm.taxa })
  return r
}

/** Erro entre as palavras do take e os tons do WAV (mesma contagem esperada). */
function compararComTons(palavras: readonly PalavraComTempo[], tons: readonly Regiao[]): { n: boolean; ini: number; fim: number } {
  if (palavras.length !== tons.length) return { n: false, ini: Infinity, fim: Infinity }
  let ini = 0
  let fim = 0
  for (const [i, p] of palavras.entries()) {
    ini = Math.max(ini, Math.abs(p.start - tons[i]!.ini))
    fim = Math.max(fim, Math.abs(p.end - tons[i]!.fim))
  }
  return { n: true, ini, fim }
}

// ------------------------------------------------------ voz do Windows
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
const vozesDoWindows = new Map<string, string>()
/** WAV 22,05 kHz da Maria (pt-BR) falando o texto. */
function falarNoWindows(texto: string): string {
  const ja = vozesDoWindows.get(texto)
  if (ja) return ja
  const h = sha256(texto).slice(0, 12)
  const entrada = join(BASE, `win-${h}.txt`)
  const saida = join(BASE, `win-${h}.wav`)
  writeFileSync(entrada, texto, 'utf8')
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_FALAR, '-entrada', entrada, '-saida', saida], {
    windowsHide: true,
  })
  vozesDoWindows.set(texto, saida)
  return saida
}

// ------------------------------------------------------------- fetch falso
interface Chamada {
  host: string
  caminho: string
  formato: string | null
  corpo: Record<string, unknown> | null
  cabecalhos: Record<string, string>
}
const chamadas: Chamada[] = []
const modo = {
  recusar44: false,
  normalizado: false,
  atrasoMs: 0,
  /** Chamado quando a resposta paga ja esta pronta (para o "cancelar depois de pagar"). */
  depoisDePagar: null as null | (() => void),
  /**
   * O corpo do 200 chega devagar (metade agora, o resto em 600 ms) e morre se o
   * signal do fetch abortar -- como o fetch de verdade. Para o Cancelar que cai
   * DURANTE o download da voz ja cobrada.
   */
  corpoLento: false,
}
const vezesDoTexto = new Map<string, number>()

function pagas(): Chamada[] {
  return chamadas.filter((c) => c.caminho.endsWith('/with-timestamps') || c.caminho === '/v1/tts')
}

globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(entrada))
  const cabecalhos = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
  const corpo = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
  chamadas.push({ host: url.host, caminho: url.pathname, formato: url.searchParams.get('output_format'), corpo, cabecalhos })
  const sinal = init?.signal ?? undefined
  if (modo.atrasoMs > 0) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, modo.atrasoMs)
      sinal?.addEventListener('abort', () => {
        clearTimeout(t)
        reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
      })
    })
  }
  if (url.host === 'api.elevenlabs.io') {
    if (url.pathname === '/v1/user/subscription') {
      return new Response(JSON.stringify({ tier: 'payg', character_count: 1200, character_limit: 10000 }), { status: 200 })
    }
    if (url.pathname.endsWith('/with-timestamps') && corpo) {
      const formato = url.searchParams.get('output_format') ?? ''
      if (modo.recusar44 && formato === 'wav_44100') {
        return new Response(JSON.stringify({ detail: { status: 'output_format_not_allowed', message: 'wav_44100 requires the Pro tier' } }), { status: 403 })
      }
      const texto = String(corpo['text'])
      const vez = vezesDoTexto.get(JSON.stringify(corpo)) ?? 0
      vezesDoTexto.set(JSON.stringify(corpo), vez + 1)
      // Com contexto (frase regravada) a fala sai mais lenta: a frase muda de tamanho.
      const fator = (corpo['previous_text'] || corpo['next_text'] ? 1.3 : 1) * (1 + 0.04 * vez)
      const taxa = formato === 'wav_24000' ? 24_000 : TAXA_FALSA
      const falado = modo.normalizado ? falarFalso(texto.replace(/\bDr\./g, 'Doutor'), fator, taxa) : falarFalso(texto, fator, taxa)
      const resposta = {
        audio_base64: wavDoPcm(falado.pcm).toString('base64'),
        alignment: modo.normalizado ? null : falado.alignment,
        normalized_alignment: falado.alignment,
      }
      modo.depoisDePagar?.()
      const json = JSON.stringify(resposta)
      const corpo200: BodyInit = modo.corpoLento
        ? new ReadableStream<Uint8Array>({
            start(ctl) {
              const enc = new TextEncoder()
              ctl.enqueue(enc.encode(json.slice(0, json.length >> 1)))
              const t = setTimeout(() => {
                ctl.enqueue(enc.encode(json.slice(json.length >> 1)))
                ctl.close()
              }, 600)
              sinal?.addEventListener('abort', () => {
                clearTimeout(t)
                ctl.error(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
              })
            },
          })
        : json
      return new Response(corpo200, {
        status: 200,
        // Como a conta payg do Levi: ~0,22 por caractere (medido em 14/10).
        headers: { 'request-id': `req_${chamadas.length}`, 'character-cost': String(Math.round([...texto].length * 0.22)) },
      })
    }
  }
  if (url.host === 'api.fish.audio') {
    if (url.pathname === '/wallet/self/api-credit') return new Response(JSON.stringify({ credit: '5.0000' }), { status: 200 })
    if (url.pathname === '/v1/tts' && corpo) {
      const wav = readFileSync(falarNoWindows(String(corpo['text'])))
      return new Response(new Uint8Array(wav), { status: 200 })
    }
  }
  throw new Error(`fetch inesperado no teste: ${url.host}${url.pathname}`)
}) as typeof fetch

// ---------------------------------------------------------------- ajuda
const progresso = (): void => {}
let pedidoN = 0
const pid = (): string => `p${++pedidoN}`

async function estimar(id: string, pedido: Parameters<typeof estimarVoz>[1]): Promise<EstimativaDeCusto> {
  return estimarVoz(id, pedido)
}

async function gerar(id: string, config: ConfigDaVoz): Promise<VozGerada> {
  const e = await estimar(id, { tipo: 'tudo', config })
  return gerarVoz(id, { config, pedidoId: pid(), confirmado: e.aCobrar }, progresso)
}

async function regravar(id: string, fraseIds: string[]): Promise<VozGerada> {
  const e = await estimar(id, { tipo: 'frases', fraseIds })
  return regravarFrases(id, { fraseIds, pedidoId: pid(), confirmado: e.aCobrar }, progresso)
}

function pcmDoTake(id: string, take: TakeDaVoz): Pcm {
  return lerWavDoDisco(arquivoDaVoz(id, take.arquivo))
}
function pcmDoBruto(id: string, take: TakeDaVoz): Pcm {
  return lerWavDoDisco(arquivoDaVoz(id, take.bruto.arquivo))
}

/** Os invariantes de todo take: conferirTake vazio, arquivos enderecados por conteudo. */
function conferirInvariantes(id: string, take: TakeDaVoz, nome: string): void {
  const p1 = conferirTake(take)
  const p2 = conferirTake({ duracao: take.bruto.duracao, palavras: take.bruto.palavras, trechos: take.bruto.trechos })
  ok(`${nome}: conferirTake (narracao e bruto) vazio`, p1.length === 0 && p2.length === 0, [...p1, ...p2].slice(0, 2).join(' | '))
  const n = readFileSync(arquivoDaVoz(id, take.arquivo))
  const b = readFileSync(arquivoDaVoz(id, take.bruto.arquivo))
  ok(
    `${nome}: nome = sha256 do conteudo`,
    take.arquivo === `narracao-${sha256(n).slice(0, 32)}.wav` && take.bruto.arquivo === `bruto-${sha256(b).slice(0, 32)}.wav`,
  )
  const pcm = pcmDoTake(id, take)
  ok(`${nome}: duracao = amostras/taxa`, Math.abs(pcm.amostras.length / pcm.taxa - take.duracao) < 1e-9)
}

function guardar(nome: string, id: string, take: TakeDaVoz): void {
  copyFileSync(arquivoDaVoz(id, take.arquivo), join(SAIDA, `${nome}.wav`))
  writeFileSync(
    join(SAIDA, `${nome}.palavras.json`),
    JSON.stringify({ take: take.id, config: take.config, origem: take.origemDoAlinhamento, duracao: take.duracao, palavras: take.palavras, trechos: take.trechos }, null, 1),
  )
}

/**
 * A DERIVA entre as palavras do take e os tons: a media do erro do ataque no
 * primeiro terco contra a do ultimo. O remapeamento exato (t' = t/v) nao
 * deriva; um erro que cresce com o tempo seria escala errada.
 */
function deriva(palavras: readonly PalavraComTempo[], tons: readonly Regiao[]): number {
  if (palavras.length !== tons.length || palavras.length < 6) return Infinity
  const d = palavras.map((p, i) => tons[i]!.ini - p.start)
  const terco = Math.floor(d.length / 3)
  const media = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.abs(media(d.slice(0, terco)) - media(d.slice(-terco)))
}

/**
 * O ATEMPO (o "acelerar" desde 15/10, pos.ts): o overlap-add dele (janela de
 * 1/24 s) espalha o ataque para tras e o fim para frente conforme a fase da
 * janela -- ate ~20 ms numa palavra, ~10 de mediana, constante e sem deriva:
 * metade de um quadro de 23,976. O rubberband (14/10) dava 7 ms, mas soou
 * robotico para o Levi. A tolerancia de 2 ms dos caminhos sem acelerar fica.
 */
const FOLGA_DO_ATEMPO_SEC = 0.025
const DERIVA_MAX_SEC = 0.003

/** Mediana, p90 e maximo de |a - b| (e onde esta o maximo). */
function erros(a: readonly number[], b: readonly number[]): { med: number; p90: number; max: number; onde: number } {
  const brutos = a.map((x, i) => Math.abs(x - b[i]!))
  const d = [...brutos].sort((x, y) => x - y)
  return { med: d[Math.floor(d.length / 2)]!, p90: d[Math.floor(d.length * 0.9)]!, max: d.at(-1)!, onde: brutos.indexOf(d.at(-1)!) }
}

/**
 * O alinhador medido de novo no audio NOVO contra o take, e o mesmo alinhador
 * no BRUTO contra o bruto (a "folga" do proprio alinhador: ele nao da o mesmo
 * tempo para a mesma palavra quando o audio em volta muda).
 */
async function remedir(id: string, t: TakeDaVoz): Promise<string> {
  // O juiz le as palavras SEM pontuacao, como o motor (paraOModelo): com ela, o curinga esticava a ultima palavra da frase.
  const tokens = paraOModelo(t.palavras.map((p) => p.texto))
  const novo = await alinharAoAudio(arquivoDaVoz(id, t.arquivo), tokens, () => {})
  const e = erros(t.palavras.map((p) => p.start), novo!.tempos.map((x) => x.start))
  const piores = t.palavras
    .map((p, i) => ({ i, d: Math.abs(p.start - novo!.tempos[i]!.start) }))
    .sort((x, y) => y.d - x.d)
    .slice(0, 3)
    .map((x) => `"${t.palavras[x.i]!.texto}"#${x.i} ${ms(x.d)} (take ${t.palavras[x.i]!.start.toFixed(3)} / medido ${novo!.tempos[x.i]!.start.toFixed(3)}, score ${novo!.tempos[x.i]!.score.toFixed(2)})`)
  return `mediana ${ms(e.med)} p90 ${ms(e.p90)} max ${ms(e.max)}; piores: ${piores.join('; ')}`
}

/**
 * O take contra o SOM (achados da avaliacao de 14/10): nenhuma palavra esticada
 * sobre silencio nem "pausa" em cima da fala, cada fronteira de frase num quadro
 * calado, e a narracao no volume de referencia (medido de novo pelo ebur128).
 */
async function conferirPeloSom(tag: string, id: string, t: TakeDaVoz): Promise<void> {
  const pcm = pcmDoBruto(id, t)
  const e = medirEnergia(pcm)
  // 1. Nenhuma palavra cobre silencio >= 0,3 s (o defeito do "." curinga no alinhador).
  const sobreSilencio = t.bruto.palavras.filter((p) => {
    let calados = 0
    for (let q = Math.floor((p.start * e.taxa) / e.amostrasPorQuadro); q < Math.ceil((p.end * e.taxa) / e.amostrasPorQuadro); q++) {
      calados = e.db[q]! > e.limiar ? 0 : calados + 1
      if (calados >= 30) return true
    }
    return false
  })
  ok(`${tag}: nenhuma palavra cobre silencio de 0,3 s`, sobreSilencio.length === 0, sobreSilencio.map((p) => `"${p.texto}"`).join(' '))
  // 2. As suspeitas (inclui "pausa" marcada em cima da fala) estao na qualidade e no aviso do take.
  const sus = palavrasSuspeitas(t.bruto.palavras, e)
  ok(`${tag}: suspeitas contadas na qualidade e avisadas`,
    (t.qualidade?.suspeitas ?? 0) === sus.length && (sus.length === 0 || t.avisos.some((a) => a.includes('som desmente'))),
    `${sus.length}: ${sus.map((i) => `"${t.bruto.palavras[i]!.texto}"@${t.bruto.palavras[i]!.start.toFixed(2)}`).join(' ')}`)
  // A voz pt-BR do Windows le "Why-Man" de um jeito que o wav2vec2 nao acha: so ali pode haver suspeita.
  const fora = sus.filter((i) => !['o', 'Why-Man', 'quando', 'decidiu'].includes(t.bruto.palavras[i]!.texto))
  ok(`${tag}: suspeitas so em volta do "Why-Man"`, fora.length === 0, fora.map((i) => t.bruto.palavras[i]!.texto).join(' '))
  // A ultima palavra de cada frase acaba no som (a cauda da consoante pode seguir um pouco: o corte a protege pelo fimDoSom).
  let pior = 0
  for (const [i, p] of t.bruto.palavras.entries()) {
    const prox = t.bruto.palavras[i + 1]
    if (!prox || prox.fraseId === p.fraseId) continue
    const q = Math.floor((p.end * e.taxa) / e.amostrasPorQuadro)
    let k = q
    while (k < e.db.length && e.db[k]! > e.limiar && (k * e.amostrasPorQuadro) / e.taxa < prox.start) k++
    pior = Math.max(pior, (k * e.amostrasPorQuadro) / e.taxa - p.end)
  }
  ok(`${tag}: ultima palavra de cada frase termina no som`, pior <= 0.15, `cauda de ate ${ms(pior)} depois do fim`)
  const ruins = t.bruto.trechos.slice(1).filter((tr) => {
    const q = Math.min(e.db.length - 1, Math.floor((tr.offset * e.taxa) / e.amostrasPorQuadro))
    return e.db[q]! > e.limiar
  })
  ok(`${tag}: fronteiras de frase em quadro calado`, ruins.length === 0, ruins.map((r) => r.fraseId).join(','))
  const v = t.volume
  const medido = await medirLoudness(arquivoDaVoz(id, t.arquivo))
  const alvo = v ? Math.min(-23, v.lufs + v.ganho) : Number.NaN
  ok(`${tag}: volume da narracao na referencia (-23 LUFS) ou no teto do pico`,
    v !== null && medido !== null && Math.abs(medido.lufs - alvo) <= 0.3 && medido.pico <= -1.4,
    v && medido ? `medido antes ${v.lufs.toFixed(1)} LUFS, ganho ${v.ganho} dB, narracao ${medido.lufs.toFixed(1)} LUFS pico ${medido.pico.toFixed(1)} dBTP` : 'sem medida')
}

// ------------------------------------------------------------------ testes
async function testes(): Promise<void> {
  configureSettings(USER, cofre)
  configurarEpisodios(USER)
  if (MODELOS) {
    configureAlinhador(MODELOS) // so le o modelo
    configureWhisper(join(MODELOS, 'whisper')) // so le o binario e o modelo
  }
  // [recap] O contexto que o nucleo daria: as chaves (falsas) pelo ctx.chave e
  // a voz padrao na configuracao do modulo.
  const chaves: Record<string, string> = {
    elevenlabsApiKey: 'sk_falsa_motor_0000000000000000000000000000aa',
    fishApiKey: 'falsa-fish-motor-000000000000bb',
  }
  guardarContexto({
    id: 'recap',
    config: () => ({
      libraryDir: '',
      iaProvedor: 'gemini',
      whisperModel: 'small',
      modulo: { biblioteca: '', vozPadrao: { provedor: 'elevenlabs', voiceId: 'VozFalsa0000000000AA', modelId: 'eleven_multilingual_v2' } },
    }),
    chave: (campo: string) => chaves[campo] ?? '',
    ligado: () => true,
  } as unknown as ContextoDoModulo)

  // A copia do rascunho do Levi (v1, aprovado). O original so e LIDO.
  const original = readFileSync(RASCUNHO_REAL, 'utf8')
  writeFileSync(join(USER, 'recaps', `${ID}.json`), original)
  const copia2 = JSON.parse(original) as Record<string, unknown>
  copia2['id'] = ID2
  writeFileSync(join(USER, 'recaps', `${ID2}.json`), JSON.stringify(copia2))
  const r0 = lerRascunhoDoDisco(ID)
  const roteiro0 = roteiroAtual(r0)!
  const narrar = textoParaNarrar(roteiro0)
  const nPalavras = narrar.frases.reduce((s, f) => s + f.palavras.length, 0)
  console.log(`rascunho: ${narrar.frases.length} frases, ${nPalavras} palavras, ${narrar.texto.length} caracteres`)

  // A 1,0: o caminho de antes da velocidade nativa (o do cache pago antigo). A 1,2 tem a secao dela (5b).
  const eleven: ConfigDaVoz = configPadrao({ provedor: 'elevenlabs', voiceId: 'VozFalsa0000000000AA', modelId: 'eleven_multilingual_v2', velocidadeNativa: 1 })!

  // ------------------------------------------------ 0. puras
  console.log('\n0. caracteres -> palavras')
  const ws = palavrasDosCaracteres({
    characters: [...'Oi, Dr. Why-Man.'],
    character_start_times_seconds: [...'Oi, Dr. Why-Man.'].map((_, i) => i * 0.1),
    character_end_times_seconds: [...'Oi, Dr. Why-Man.'].map((_, i) => i * 0.1 + 0.1),
  })
  ok('porte do _alignment_to_words: quebra em espaco', JSON.stringify(ws.map((w) => w.text)) === '["Oi,","Dr.","Why-Man."]')
  ok('tempo da palavra sai das letras (o "." nao estica)', Math.abs(ws[2]!.end - 1.5) < 1e-9, `fim de "Why-Man." = ${ws[2]!.end}`)
  const tf = tokensComFaixa('Ele [pausa] disse (baixo) oi.')
  ok('tokensComFaixa = tokenizeScript com faixas', JSON.stringify(tf) === JSON.stringify([
    { texto: 'Ele', de: 0, ate: 3 },
    { texto: 'disse', de: 12, ate: 17 },
    { texto: 'oi.', de: 26, ate: 29 },
  ]))

  const semLinha = falarFalso(narrar.texto.replace(/\n\n/g, ' '), 1, 24_000)
  const pt = palavrasPeloTexto(semLinha.alignment, narrar.texto, narrar.frases)
  ok('alignment com a linha em branco virando espaco: ainda "provedor"', pt !== null && pt.palavras.length === nPalavras)
  const trocado = falarFalso(narrar.texto.replace('Senku', 'Senko'), 1, 24_000)
  ok('alignment de outro texto: nao e "provedor"', palavrasPeloTexto(trocado.alignment, narrar.texto, narrar.frases) === null)

  // ------------------------------------------------ 1. gerar (ElevenLabs falso)
  console.log('\n1. gerarVoz: ElevenLabs falso, corte de pausa ligado')
  const e1 = await estimar(ID, { tipo: 'tudo', config: eleven })
  ok('estimativa: 1034 caracteres, a cobrar', e1.caracteres === 1034 && e1.aCobrar === 1034 && !e1.doCache, `${e1.caracteres}/${e1.aCobrar}`)
  ok('estimativa: saldo do GET gratis', e1.plano === 'payg' && e1.restam === 8800 && e1.suficiente === true)
  ok('estimar nao chama TTS', pagas().length === 0)
  const custoMudou = await erroDe(() => gerarVoz(ID, { config: eleven, pedidoId: pid(), confirmado: 500 }, progresso))
  ok('confirmado menor que o custo: recusa sem chamar', custoMudou === 'O custo mudou: confira de novo.' && pagas().length === 0, custoMudou)

  const g1 = await gerar(ID, eleven)
  const t1 = g1.take
  ok('1 chamada paga', pagas().length === 1)
  const c1 = pagas()[0]!
  ok('corpo: text = roteiro inteiro, voice_settings do AniRecap, sem speed, sem contexto', c1.corpo?.['text'] === narrar.texto &&
    JSON.stringify(c1.corpo?.['voice_settings']) === JSON.stringify({ stability: 0.32, similarity_boost: 0.3, use_speaker_boost: true, style: 0 }) &&
    !('previous_text' in (c1.corpo ?? {})) && c1.formato === 'wav_44100')
  ok('chave no cabecalho, nunca na URL', c1.cabecalhos['xi-api-key']?.startsWith('sk_falsa') === true && !chamadas.some((c) => c.caminho.includes('sk_falsa')))
  ok('take t1 atual, origem provedor', t1.id === 't1' && g1.rascunho.voz?.atual === 't1' && t1.origemDoAlinhamento === 'provedor')
  ok(`${nPalavras} palavras, texto do roteiro`, t1.palavras.length === nPalavras &&
    t1.palavras.map((p) => p.texto).join(' ') === narrar.frases.flatMap((f) => f.palavras).join(' '))
  ok('cobrados = character-cost (227), chamada com request-id', t1.cobrados === 227 && t1.chamadas[0]?.requestId === 'req_' + (chamadas.indexOf(c1) + 1) && t1.chamadas[0]?.doCache === false)
  conferirInvariantes(ID, t1, 't1')
  guardar('falso-t1-corte', ID, t1)
  {
    // A taxa da conta, aprendida do character-cost (227 por 1034): a estimativa diz caracteres E creditos.
    const deNovo = await estimar(ID, { tipo: 'tudo', config: eleven })
    ok('taxa aprendida: "Gerar tudo de novo" estima ~227 creditos (alem dos 1034 caracteres)', deNovo.pagos === 1034 && deNovo.aCobrar === 1034 && Math.abs((deNovo.creditos ?? 0) - 227) < 0.5,
      `pagos ${deNovo.pagos} aCobrar ${deNovo.aCobrar} creditos ${deNovo.creditos?.toFixed(1)}`)
    const flash = await estimar(ID, { tipo: 'tudo', config: { ...eleven, modelId: 'eleven_flash_v2_5' } as ConfigDaVoz })
    ok('modelo ainda nao pago: o fator da conta x a taxa nominal (Flash = metade)', flash.aCobrar === 517 && Math.abs((flash.creditos ?? 0) - 113.5) < 0.5,
      `aCobrar ${flash.aCobrar} creditos ${flash.creditos?.toFixed(1)}`)
  }

  // O bruto bate com os tons e a narracao tambem (o remapeamento e exato).
  const tonsBruto = regioesDeTom(pcmDoBruto(ID, t1))
  const cb = compararComTons(t1.bruto.palavras, tonsBruto)
  ok('bruto: uma regiao de tom por palavra, tempos <= 2 ms', cb.n && cb.ini <= 0.002 && cb.fim <= 0.004, `ini ${ms(cb.ini)} fim ${ms(cb.fim)}`)
  const pcm1 = pcmDoTake(ID, t1)
  const tons1 = regioesDeTom(pcm1, t1.volume?.ganho ?? 0)
  const cn = compararComTons(t1.palavras, tons1)
  ok('NARRACAO depois do corte: palavras do take = tons do WAV novo (<= 2 ms)', cn.n && cn.ini <= 0.002 && cn.fim <= 0.004, `ini ${ms(cn.ini)} fim ${ms(cn.fim)}`)
  const encolheu = tons1.length !== tonsBruto.length ? Infinity : tonsBruto.reduce((m, r, i) => Math.max(m, Math.abs(r.fim - r.ini - (tons1[i]!.fim - tons1[i]!.ini))), 0)
  ok('nenhum tom (palavra) encolheu', encolheu <= 0.0005, `max ${ms(encolheu)}`)
  const vaos = tons1.slice(1).map((r, i) => r.ini - tons1[i]!.fim)
  const vaosBruto = tonsBruto.slice(1).map((r, i) => r.ini - tonsBruto[i]!.fim)
  ok('nenhuma pausa longa sobrou (vao entre tons < 0,3 s)', Math.max(...vaos) < 0.3, `maior vao ${ms(Math.max(...vaos))}`)
  const longos = vaosBruto.map((v, i) => ({ v, i })).filter((x) => x.v >= 0.3)
  // Vao de tom = rabo (40 ms) + 150 ms de pausa.
  // (a borda do som e achada por quadro de 10 ms: ate +2 quadros de folga)
  const desvio = longos.reduce((m, x) => Math.max(m, Math.abs(vaos[x.i]! - 0.2)), 0)
  ok(`${longos.length} pausas longas viraram 150 ms (+ rabo de 40 ms)`, longos.length > 10 && desvio <= 0.015, `desvio max ${ms(desvio)}`)
  ok('lead e cauda curtos (150 ms)', Math.abs(tons1[0]!.ini - 0.155) <= 0.012 && Math.abs(t1.duracao - tons1.at(-1)!.fim - 0.195) <= 0.012,
    `lead ${ms(tons1[0]!.ini)} cauda ${ms(t1.duracao - tons1.at(-1)!.fim)}`)
  // O rabo (consoante final) inteiro: ha som nos 35 ms depois de cada tom.
  const rabosComidos = tons1.filter((r) => {
    const a = Math.round((r.fim + 0.003) * pcm1.taxa)
    const b = Math.round((r.fim + 0.033) * pcm1.taxa)
    let soma = 0
    for (let n = a; n < b; n++) soma += pcm1.amostras[n]! ** 2
    return Math.sqrt(soma / Math.max(1, b - a)) < 40
  }).length
  ok('o rabo da consoante final nunca foi cortado', rabosComidos === 0, `${rabosComidos} comidos`)
  // Nenhum corte cai em som (conta de novo os cortes do bruto e olha as amostras).
  const pcmB = pcmDoBruto(ID, t1)
  const cortes = cortesDasPausas(t1.bruto.palavras, medirEnergia(pcmB), pcmB.amostras.length)
  const picoNoCorte = cortes.reduce((m, c) => {
    for (let n = c.de; n < c.ate; n++) m = Math.max(m, Math.abs(pcmB.amostras[n]!))
    return m
  }, 0)
  ok(`${cortes.length} cortes, todos em silencio`, picoNoCorte === 0, `pico ${picoNoCorte}`)
  ok('duracao: bruto - cortado', Math.abs(t1.bruto.duracao - cortes.reduce((s, c) => s + c.ate - c.de, 0) / pcmB.taxa - t1.duracao) < 1e-9,
    `${t1.bruto.duracao.toFixed(2)} s -> ${t1.duracao.toFixed(2)} s`)
  await conferirPeloSom('ElevenLabs falso', ID, t1)

  // ------------------------------------------------ 2. velocidade
  console.log('\n2. ajustarVoz: velocidade (gratis)')
  const antes = pagas().length
  const a12 = await ajustarVoz(ID, { velocidade: 1.2, cortarPausas: true, pedidoId: pid() }, progresso)
  const t2 = a12.take
  ok('take t2, derivado de t1, 0 chamada', t2.id === 't2' && t2.derivadoDe === 't1' && pagas().length === antes && t2.cobrados === 0)
  ok('mesmo bruto', t2.bruto.arquivo === t1.bruto.arquivo)
  conferirInvariantes(ID, t2, 't2')
  guardar('falso-t2-vel1.2', ID, t2)
  const tons2 = regioesDeTom(pcmDoTake(ID, t2), t2.volume?.ganho ?? 0)
  const c2 = compararComTons(t2.palavras, tons2)
  const e12 = erros(t2.palavras.map((p) => p.start), tons2.map((r) => r.ini))
  // O atempo (com o atraso que centra o som, pos.ts): ~10 ms de mediana, ate ~20, sem deriva (FOLGA_DO_ATEMPO_SEC).
  const d2 = deriva(t2.palavras, tons2)
  ok('velocidade 1,2: palavras = tons do WAV novo (<= 25 ms, meio quadro), sem deriva', c2.n && c2.ini <= FOLGA_DO_ATEMPO_SEC && c2.fim <= FOLGA_DO_ATEMPO_SEC && d2 <= DERIVA_MAX_SEC,
    `ini mediana ${ms(e12.med)} max ${ms(c2.ini)}; fim max ${ms(c2.fim)}; deriva ${ms(d2)}`)
  ok('duracao = t1/1,2 (amostra)', Math.abs(t2.duracao - t1.duracao / 1.2) < 0.001 && t2.avisos.length === 0, `${t2.duracao.toFixed(4)} vs ${(t1.duracao / 1.2).toFixed(4)}`)
  const a09 = await ajustarVoz(ID, { velocidade: 0.9, cortarPausas: false, pedidoId: pid() }, progresso)
  const tons09 = regioesDeTom(pcmDoTake(ID, a09.take), a09.take.volume?.ganho ?? 0)
  const c09 = compararComTons(a09.take.palavras, tons09)
  const d09 = deriva(a09.take.palavras, tons09)
  ok('velocidade 0,9 sem corte: palavras = tons (<= 25 ms), sem deriva', c09.n && c09.ini <= FOLGA_DO_ATEMPO_SEC && c09.fim <= FOLGA_DO_ATEMPO_SEC && d09 <= DERIVA_MAX_SEC,
    `ini max ${ms(c09.ini)} fim max ${ms(c09.fim)}; deriva ${ms(d09)}`)
  conferirInvariantes(ID, a09.take, 't3')
  const volta = await ajustarVoz(ID, { velocidade: 1, cortarPausas: true, pedidoId: pid() }, progresso)
  ok('voltar ao ajuste de t1 reusa t1 (sem take novo)', volta.take.id === 't1' && estadoDaVoz(volta.rascunho).takes.length === 3 && volta.rascunho.voz?.atual === 't1')
  ok('ajuste igual ao atual e recusado', (await erroDe(() => ajustarVoz(ID, { velocidade: 1, cortarPausas: true, pedidoId: pid() }, progresso))) === 'A voz ja esta com esse ajuste.')

  // ------------------------------------------------ 3. regravar f03
  console.log('\n3. regravarFrases(f03): so a frase, com contexto')
  const e3 = await estimar(ID, { tipo: 'frases', fraseIds: ['f03'] })
  const chF03 = [...narrar.frases[2]!.texto].length
  ok(`estimativa: so f03 (${chF03} caracteres)`, e3.caracteres === chF03 && e3.aCobrar === chF03 && JSON.stringify(e3.fraseIds) === '["f03"]')
  const antes3 = pagas().length
  const g3 = await regravar(ID, ['f03'])
  const t4 = g3.take
  const c3 = pagas().at(-1)!
  ok('1 chamada, text = f03, com previous_text/next_text', pagas().length === antes3 + 1 && c3.corpo?.['text'] === narrar.frases[2]!.texto &&
    String(c3.corpo?.['previous_text']).endsWith('impedir o ataque.') && String(c3.corpo?.['next_text']).startsWith('Anos se passaram'))
  ok(`take t4 derivado de t1, regravadas [f03], cobrados = character-cost`, t4.derivadoDe === 't1' && JSON.stringify(t4.regravadas) === '["f03"]' && t4.cobrados === Math.round(chF03 * 0.22))
  conferirInvariantes(ID, t4, 't4')
  guardar('falso-t4-regravou-f03', ID, t4)
  // No bruto: antes de f03 igual, depois deslocado pela diferenca exata.
  const tr = (t: TakeDaVoz, id: string) => t.bruto.trechos.find((x) => x.fraseId === id)!
  const delta = tr(t4, 'f03').duracao - tr(t1, 'f03').duracao
  const ordem = narrar.frases.map((f) => f.fraseId)
  const iF03 = ordem.indexOf('f03')
  let difAntes = 0
  let difDepois = 0
  for (const [i, p] of t4.bruto.palavras.entries()) {
    const q = t1.bruto.palavras[i]!
    const k = ordem.indexOf(p.fraseId)
    if (k < iF03) difAntes = Math.max(difAntes, Math.abs(p.start - q.start), Math.abs(p.end - q.end))
    if (k > iF03) difDepois = Math.max(difDepois, Math.abs(p.start - (q.start + delta)), Math.abs(p.end - (q.end + delta)))
  }
  ok('frases antes de f03: tempos iguais no bruto', difAntes < 1e-9, `${difAntes}`)
  ok(`frases depois de f03: deslocadas pela diferenca exata (${ms(delta)})`, Math.abs(delta) > 0.05 && difDepois < 1e-9, `erro ${difDepois}`)
  const c4 = compararComTons(t4.palavras, regioesDeTom(pcmDoTake(ID, t4), t4.volume?.ganho ?? 0))
  ok('narracao montada: palavras = tons (<= 2 ms)', c4.n && c4.ini <= 0.002 && c4.fim <= 0.004, `ini ${ms(c4.ini)} fim ${ms(c4.fim)}`)
  const c4b = compararComTons(t4.bruto.palavras, regioesDeTom(pcmDoBruto(ID, t4)))
  ok('bruto emendado: palavras = tons (<= 2 ms)', c4b.n && c4b.ini <= 0.002, `ini ${ms(c4b.ini)}`)

  // Regravar de novo a mesma frase = leitura NOVA (paga); a anterior fica.
  const e3b = await estimar(ID, { tipo: 'frases', fraseIds: ['f03'] })
  ok('regravar de novo f03: cobra (leitura nova)', e3b.aCobrar === chF03)

  // ------------------------------------------------ 4. roteiro muda depois da voz
  console.log('\n4. roteiro muda depois da voz')
  {
    const r = lerRascunhoDoDisco(ID)
    const rot = roteiroAtual(r)!
    const secoes = rot.secoes.map((s) => ({
      ...s,
      frases: s.frases.map((f) => (f.id === 'f05' ? { ...f, texto: 'O Ryusui fundou um conglomerado para tocar os projetos globais.' } : f)),
    }))
    const quando = new Date().toISOString()
    gravarRascunho(marcarAprovado(aplicarEdicao(r, { secoes, alvoSec: rot.alvoSec }, quando), quando))
  }
  const r4 = lerRascunhoDoDisco(ID)
  ok('voz desatualizada', situacaoDaVoz(r4, roteiroAtual(r4)) === 'desatualizada')
  ok('aprovar voz desatualizada recusa', (await erroDe(() => aprovarVoz(ID))).startsWith('O roteiro mudou depois da voz'))
  const e4 = await estimar(ID, { tipo: 'frases', fraseIds: [] })
  ok('"Atualizar a voz": so f05', JSON.stringify(e4.fraseIds) === '["f05"]' && e4.aCobrar === e4.caracteres && e4.caracteres > 50)
  const g4 = await regravar(ID, [])
  ok('voz em dia depois de atualizar', situacaoDaVoz(g4.rascunho, roteiroAtual(g4.rascunho)) === 'pronta')
  conferirInvariantes(ID, g4.take, g4.take.id)
  // Volta o texto antigo: a frase antiga (variante 0 do texto antigo) ainda nao foi
  // gerada sozinha -> paga; e voltar de novo para o novo NAO paga (cache).
  async function trocarF05(texto: string): Promise<void> {
    const r = lerRascunhoDoDisco(ID)
    const rot = roteiroAtual(r)!
    const secoes = rot.secoes.map((s) => ({ ...s, frases: s.frases.map((f) => (f.id === 'f05' ? { ...f, texto } : f)) }))
    const quando = new Date().toISOString()
    gravarRascunho(marcarAprovado(aplicarEdicao(r, { secoes, alvoSec: rot.alvoSec }, quando), quando))
  }
  const textoOriginalF05 = roteiro0.secoes.flatMap((s) => s.frases).find((f) => f.id === 'f05')!.texto
  await trocarF05(textoOriginalF05)
  await regravar(ID, [])
  await trocarF05('O Ryusui fundou um conglomerado para tocar os projetos globais.')
  const e4c = await estimar(ID, { tipo: 'frases', fraseIds: [] })
  const antes4 = pagas().length
  const g4c = await regravar(ID, [])
  ok('texto que volta: cache, 0 chamada', e4c.aCobrar === 0 && e4c.doCache && pagas().length === antes4 && g4c.cobrados === 0)
  const ap = await aprovarVoz(ID)
  ok('aprovar voz -> podeIrParaCenas', podeIrParaCenas(ap, roteiroAtual(ap)))

  // ------------------------------------------------ 5. cache entre rascunhos e settings
  console.log('\n5. cache')
  const antes5 = pagas().length
  const e5 = await estimar(ID2, { tipo: 'tudo', config: eleven })
  const g5 = await gerar(ID2, eleven)
  ok('outro rascunho, mesmo texto e voz: 0 chamada, sem custo', e5.aCobrar === 0 && pagas().length === antes5 && g5.cobrados === 0 && g5.take.chamadas[0]?.doCache === true)
  ok('mesmo audio (bruto igual ao t1)', g5.take.bruto.arquivo === t1.bruto.arquivo)
  const e5b = await estimar(ID2, { tipo: 'tudo', config: eleven })
  // Ja no take desta voz: "Gerar tudo de novo" e de proposito, sem o aviso de voltar (ele ja esta nele).
  ok('"Gerar tudo de novo" no mesmo rascunho: cobra (leitura nova), sem "volte para ele"', e5b.aCobrar === 1034 && !(e5b.aviso ?? '').includes('Ja tem o take'), e5b.aviso ?? '')
  const outraSettings: ConfigDaVoz = { ...eleven, settings: { ...(eleven as Extract<ConfigDaVoz, { fonte: 'elevenlabs' }>).settings, stability: 0.5 } } as ConfigDaVoz
  const e5c = await estimar(ID2, { tipo: 'tudo', config: outraSettings })
  ok('settings diferente: outra chave, cobra', e5c.aCobrar === e5c.caracteres && e5c.aCobrar > 0)
  // Na tela de OUTRA voz (o take atual e o de outro settings), voltar a esta: o aviso aponta o take antigo, de graca.
  await gerar(ID2, outraSettings)
  const e5f = await estimar(ID2, { tipo: 'tudo', config: eleven })
  ok('em outra voz, com um take antigo desta: avisa "volte para ele"', e5f.aCobrar === 1034 && (e5f.aviso ?? '').includes('Ja tem o take t1'), e5f.aviso ?? '')
  const veloc: ConfigDaVoz = { ...eleven, velocidade: 1.1, cortarPausas: false }
  const ped = (c: ConfigDaVoz) => ({ config: c as Extract<ConfigDaVoz, { fonte: 'elevenlabs' }>, texto: narrar.texto, contexto: { anterior: '', seguinte: '' } })
  ok('velocidade e corte fora da chave do cache', chaveDoCache(ped(eleven), 'wav_44100', 0) === chaveDoCache(ped(veloc), 'wav_44100', 0))
  const ID3 = 'rc_25d63d4babd6_copia3'
  const copia3 = JSON.parse(original) as Record<string, unknown>
  copia3['id'] = ID3
  writeFileSync(join(USER, 'recaps', `${ID3}.json`), JSON.stringify(copia3))
  const e5d = await estimar(ID3, { tipo: 'tudo', config: veloc })
  ok('rascunho novo com velocidade 1,1: le do cache, sem custo', e5d.aCobrar === 0)

  // ------------------------------------------------ 5b. velocidade NATIVA 1,2
  console.log('\n5b. velocidade nativa 1,2 (o padrao novo do perfil)')
  {
    const padrao = configPadrao({ provedor: 'elevenlabs', voiceId: 'VozFalsa0000000000AA', modelId: 'eleven_multilingual_v2' })!
    ok('perfil sem o campo: a voz nova sai a 1,2', padrao.fonte === 'elevenlabs' && padrao.velocidadeNativa === 1.2)
    const ID4 = 'rc_25d63d4babd6_nativa12'
    const copia4 = JSON.parse(original) as Record<string, unknown>
    copia4['id'] = ID4
    writeFileSync(join(USER, 'recaps', `${ID4}.json`), JSON.stringify(copia4))
    ok('a 1,2 e outra chave: a leitura a 1,0 nao serve (cobra)', chaveDoCache(ped(padrao), 'wav_44100', 0) !== chaveDoCache(ped(eleven), 'wav_44100', 0))
    const e5n = await estimar(ID4, { tipo: 'tudo', config: padrao })
    ok('estimativa a 1,2: cobra o roteiro inteiro (pergunta de custo)', e5n.aCobrar === 1034 && !e5n.doCache)
    const antes5n = pagas().length
    const g5n = await gerar(ID4, padrao)
    const c5n = pagas().at(-1)!
    ok('1 chamada paga, voice_settings com speed 1,2', pagas().length === antes5n + 1 &&
      JSON.stringify(c5n.corpo?.['voice_settings']) === JSON.stringify({ stability: 0.32, similarity_boost: 0.3, use_speaker_boost: true, style: 0, speed: 1.2 }),
      JSON.stringify(c5n.corpo?.['voice_settings']))
    ok('take com a nativa 1,2 e o alinhamento do provedor', g5n.take.config.fonte === 'elevenlabs' && g5n.take.config.velocidadeNativa === 1.2 && g5n.take.origemDoAlinhamento === 'provedor')
    conferirInvariantes(ID4, g5n.take, 'nativa-1.2')
    const e5r = await estimar(ID4, { tipo: 'frases', fraseIds: ['f03'] })
    const g5r = await regravarFrases(ID4, { fraseIds: ['f03'], pedidoId: pid(), confirmado: e5r.aCobrar }, progresso)
    const c5r = pagas().at(-1)!
    ok('regravar frase usa a velocidade do take (speed 1,2 + contexto)', (c5r.corpo?.['voice_settings'] as Record<string, unknown> | undefined)?.['speed'] === 1.2 &&
      typeof c5r.corpo?.['previous_text'] === 'string' && g5r.take.config.fonte === 'elevenlabs' && g5r.take.config.velocidadeNativa === 1.2)
    conferirInvariantes(ID4, g5r.take, 'nativa-1.2-regravado')
    const antesAj = pagas().length
    const a5 = await ajustarVoz(ID4, { velocidade: 1.25, cortarPausas: true, pedidoId: pid() }, progresso)
    ok('acelerar 1,25 sobre a 1,2: gratis, a nativa fica', pagas().length === antesAj && a5.take.config.fonte === 'elevenlabs' && a5.take.config.velocidadeNativa === 1.2 && a5.take.cobrados === 0)
    ok('acelerar 1,25: duracao = take/1,25 (amostra), sem aviso', Math.abs(a5.take.duracao - g5r.take.duracao / 1.25) < 0.001 && a5.take.avisos.length === 0,
      `${a5.take.duracao.toFixed(4)} vs ${(g5r.take.duracao / 1.25).toFixed(4)}`)
    conferirInvariantes(ID4, a5.take, 'nativa-1.2-acelerar-1.25')
    const tons5 = regioesDeTom(pcmDoTake(ID4, a5.take), a5.take.volume?.ganho ?? 0)
    const c5 = compararComTons(a5.take.palavras, tons5)
    const d5 = deriva(a5.take.palavras, tons5)
    ok('acelerar 1,25: palavras = tons do WAV novo (<= 25 ms), sem deriva', c5.n && c5.ini <= FOLGA_DO_ATEMPO_SEC && c5.fim <= FOLGA_DO_ATEMPO_SEC && d5 <= DERIVA_MAX_SEC,
      `ini max ${ms(c5.ini)} fim max ${ms(c5.fim)}; deriva ${ms(d5)}`)
    // O ritmo aprendido: cada take com corte virou medida, na chave da config dele.
    const medidas = lerMedidas()
    const doTake = medidas.find((m) => m.arquivo === a5.take.arquivo)
    ok('ritmo aprendido do take (palavras / duracao final)', doTake !== undefined && doTake.chave === chaveDoRitmo(a5.take.config) && doTake.palavras === nPalavras && Math.abs(doTake.duracao - a5.take.duracao) < 1e-9,
      `${medidas.length} medidas`)
    const rr = ritmoDoRascunho(lerRascunhoDoDisco(ID4))
    ok('ritmoDoRascunho = o take atual medido', rr.origem === 'medido' && Math.abs(rr.ritmo - nPalavras / a5.take.duracao) < 1e-6, `${rr.ritmo.toFixed(3)} p/s`)
  }

  // ------------------------------------------------ 6. normalizado e recusa do 44,1 kHz
  console.log('\n6. normalized_alignment ("Dr." -> "Doutor") e wav_44100 recusado')
  modo.normalizado = true
  modo.recusar44 = true
  const id6 = 'rc_25d63d4babd6_normalizado'
  const c6 = JSON.parse(original) as Record<string, unknown>
  c6['id'] = id6
  writeFileSync(join(USER, 'recaps', `${id6}.json`), JSON.stringify(c6))
  const cfg6: ConfigDaVoz = { ...eleven, voiceId: 'OutraVozFalsa00000BB' }
  const antes6 = pagas().length
  const g6 = await gerar(id6, cfg6)
  const t6 = g6.take
  ok('2 pedidos: o 44,1 kHz recusado (gratis) e o 24 kHz', pagas().length === antes6 + 2 && pagas().at(-1)?.formato === 'wav_24000')
  ok('aviso do formato e memoria da recusa', t6.avisos.some((a) => a.includes('wav_44100 recusado')) && existsSync(join(pastaDoCacheDaVoz(), 'formatos.json')))
  ok('origem normalizado, texto do roteiro', t6.origemDoAlinhamento === 'normalizado' && t6.palavras.map((p) => p.texto).join(' ') === narrar.frases.flatMap((f) => f.palavras).join(' '))
  const iDr = t6.palavras.findIndex((p) => p.texto === 'Dr.')
  ok('"Dr." entre "famoso" e "Stone."', iDr > 0 && t6.palavras[iDr - 1]!.texto === 'famoso' && t6.palavras[iDr]!.start >= t6.palavras[iDr - 1]!.end - 1e-9 && t6.palavras[iDr]!.end <= t6.palavras[iDr + 1]!.start + 1e-9,
    `ancoradas ${t6.qualidade?.ancoradas}/${t6.qualidade?.total}`)
  conferirInvariantes(id6, t6, 't-normalizado')
  const tons6 = regioesDeTom(pcmDoTake(id6, t6), t6.volume?.ganho ?? 0)
  // As palavras ancoradas batem com o tom; "Doutor" e uma regiao a mais que vira "Dr.".
  ok('24 kHz no take', pcmDoTake(id6, t6).taxa === 24_000)
  ok('regioes de tom = palavras (Doutor <-> Dr.)', tons6.length === t6.palavras.length)
  // "Dr." nao ancorou (o audio disse "Doutor"): fica com o vao entre as vizinhas. O resto bate.
  const c6t = compararComTons(t6.palavras.filter((_, i) => i !== iDr), tons6.filter((_, i) => i !== iDr))
  ok('normalizado: palavras ancoradas = tons depois do corte', c6t.n && c6t.ini <= 0.003, `ini ${ms(c6t.ini)}`)
  const e6 = await estimar(id6, { tipo: 'frases', fraseIds: ['f16'] })
  const g6b = await regravar(id6, ['f16'])
  ok('regravar no take de 24 kHz pede 24 kHz direto', pagas().at(-1)?.formato === 'wav_24000' && g6b.cobrados === Math.round(e6.aCobrar * 0.22))
  conferirInvariantes(id6, g6b.take, 't-normalizado-regravado')
  modo.normalizado = false
  modo.recusar44 = false

  // ------------------------------------------------ 7. cancelar
  console.log('\n7. cancelar')
  const id7 = 'rc_25d63d4babd6_cancelar'
  const c7 = JSON.parse(original) as Record<string, unknown>
  c7['id'] = id7
  writeFileSync(join(USER, 'recaps', `${id7}.json`), JSON.stringify(c7))
  const cfg7: ConfigDaVoz = { ...eleven, voiceId: 'VozCancelar0000000CC' }
  modo.atrasoMs = 1500
  const e7 = await estimar(id7, { tipo: 'tudo', config: cfg7 })
  const p7 = pid()
  const promessa7 = gerarVoz(id7, { config: cfg7, pedidoId: p7, confirmado: e7.aCobrar }, progresso)
  await new Promise((r) => setTimeout(r, 300))
  ok('cancelarVoz acha o pedido', await cancelarVoz(id7, p7))
  const erro7 = await erroDe(() => promessa7)
  ok('cancelado antes de pagar: erro, sem take', /abort/i.test(erro7) || erro7 === 'Cancelado.', erro7)
  ok('rascunho sem voz', lerRascunhoDoDisco(id7).voz === null)
  modo.atrasoMs = 0
  // Depois de pagar: o Cancelar chega com a resposta ja pronta.
  const g7a = await gerar(id7, cfg7) // t1 normal
  const p7b = pid()
  const e7b = await estimar(id7, { tipo: 'tudo', config: cfg7 })
  modo.depoisDePagar = () => {
    void cancelarVoz(id7, p7b)
  }
  const g7b = await gerarVoz(id7, { config: cfg7, pedidoId: p7b, confirmado: e7b.aCobrar }, progresso)
  modo.depoisDePagar = null
  ok('cancelado depois de pagar: take so no historico', g7b.soNoHistorico && g7b.rascunho.voz?.atual === g7a.take.id && estadoDaVoz(g7b.rascunho).takes.length === 2)
  conferirInvariantes(id7, g7b.take, 'take-do-historico')
  {
    // O Cancelar cai DURANTE o download do corpo de um 200 (a voz ja foi cobrada): a leitura segue, entra no cache e vira take do historico.
    const e7c = await estimar(id7, { tipo: 'tudo', config: cfg7 })
    const p7c = pid()
    const antes7c = pagas().length
    const noCache = (): number => readdirSync(pastaDoCacheDaVoz()).filter((n) => /^[0-9a-f]{64}\.wav$/.test(n)).length
    const cache7c = noCache()
    modo.corpoLento = true
    modo.depoisDePagar = () => {
      setTimeout(() => void cancelarVoz(id7, p7c), 100)
    }
    let g7c: VozGerada | null = null
    const erro7c = await erroDe(async () => {
      g7c = await gerarVoz(id7, { config: cfg7, pedidoId: p7c, confirmado: e7c.aCobrar }, progresso)
    })
    modo.corpoLento = false
    modo.depoisDePagar = null
    const v7c = g7c as VozGerada | null
    ok('Cancelar durante o download da voz paga: ela chega, vai para o cache e para o historico', v7c !== null && v7c.soNoHistorico && pagas().length === antes7c + 1,
      v7c ? `soNoHistorico ${v7c.soNoHistorico}, ${estadoDaVoz(v7c.rascunho).takes.length} takes` : erro7c)
    ok('...e a leitura paga esta no cache (nunca paga de novo)', noCache() === cache7c + 1, `${cache7c} -> ${noCache()}`)
  }

  // [recap] Sem o alinhador e o Whisper ja baixados, 8 e 9 sao pulados.
  const id8 = 'rc_25d63d4babd6_fish'
  const id9 = 'rc_25d63d4babd6_importado'
  if (!MODELOS) console.log('\n8 e 9: sem o alinhador/Whisper nesta maquina (MODELOS=<perfil>), pulados')
  else {
  // ------------------------------------------------ 8. Fish (voz do Windows) -> alinhador
  console.log('\n8. Fish falso (voz do Windows) -> alinhador do Dangai')
  const c8 = JSON.parse(original) as Record<string, unknown>
  c8['id'] = id8
  writeFileSync(join(USER, 'recaps', `${id8}.json`), JSON.stringify(c8))
  const fish: ConfigDaVoz = configPadrao({ provedor: 'fish', voiceId: 'fishvozfalsa01', modelId: '' })!
  const e8 = await estimar(id8, { tipo: 'tudo', config: fish })
  ok('Fish: estimativa 1 credito por caractere e saldo', e8.aCobrar === 1034 && e8.saldo === '5.0000' && e8.restam === null)
  const t0 = Date.now()
  const g8 = await gerar(id8, fish)
  const t8 = g8.take
  const c8c = pagas().at(-1)!
  ok('Fish: Bearer, cabecalho model, reference_id, wav', c8c.host === 'api.fish.audio' && c8c.cabecalhos['Authorization']?.startsWith('Bearer ') === true &&
    c8c.cabecalhos['model'] === 's2.1-pro' && c8c.corpo?.['reference_id'] === 'fishvozfalsa01' && c8c.corpo?.['format'] === 'wav')
  ok('Fish: prosody.speed = a nativa do perfil (1,2)', (c8c.corpo?.['prosody'] as Record<string, unknown> | undefined)?.['speed'] === 1.2)
  ok('Fish: origem alinhador, score', t8.origemDoAlinhamento === 'alinhador' && (t8.qualidade?.score ?? 0) >= 0.35, `score ${t8.qualidade?.score?.toFixed(2)} em ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  conferirInvariantes(id8, t8, 'fish')
  guardar('fish-windows-corte', id8, t8)
  {
    // Mede de novo com o alinhador NO AUDIO NOVO e compara com o remapeado.
    const tokens = paraOModelo(t8.palavras.map((p) => p.texto))
    const medido = await alinharAoAudio(arquivoDaVoz(id8, t8.arquivo), tokens, () => {})
    const e = erros(t8.palavras.map((p) => p.start), medido!.tempos.map((t) => t.start))
    ok('Fish: depois do corte, alinhador no audio novo = tempos do take', e.med <= 0.02 && e.p90 <= 0.04, await remedir(id8, t8))
    const pcm = pcmDoBruto(id8, t8)
    const cs = cortesDasPausas(t8.bruto.palavras, medirEnergia(pcm), pcm.amostras.length)
    const pico = cs.reduce((m, c) => {
      for (let n = c.de; n < c.ate; n++) m = Math.max(m, Math.abs(pcm.amostras[n]!))
      return m
    }, 0)
    ok(`Fish: ${cs.length} cortes, nenhum em som`, cs.length > 5 && pico < 300, `pico ${pico} (${(20 * Math.log10(Math.max(1, pico) / 32768)).toFixed(0)} dBFS)`)
  }
  await conferirPeloSom('Fish', id8, t8)
  const g8b = await regravar(id8, ['f03'])
  ok('Fish: regravar sem contexto (a API nao tem)', !('previous_text' in (pagas().at(-1)!.corpo ?? {})) && g8b.take.derivadoDe === t8.id)
  conferirInvariantes(id8, g8b.take, 'fish-regravado')
  {
    // Duas frases com o MESMO texto novo num pedido so: no Fish (sem contexto) e a mesma chave -> paga UMA vez.
    const r = lerRascunhoDoDisco(id8)
    const rot = roteiroAtual(r)!
    const [fa, fb] = [narrar.frases[4]!.fraseId, narrar.frases[11]!.fraseId]
    const igual = 'E isso, meus amigos, e ciencia pura!'
    const secoes = rot.secoes.map((s) => ({ ...s, frases: s.frases.map((f) => (f.id === fa || f.id === fb ? { ...f, texto: igual } : f)) }))
    const quando = new Date().toISOString()
    gravarRascunho(marcarAprovado(aplicarEdicao(r, { secoes, alvoSec: rot.alvoSec }, quando), quando))
    const e = await estimar(id8, { tipo: 'frases', fraseIds: [] })
    const antes = pagas().length
    const g = await regravar(id8, [])
    ok('Fish: a mesma frase duas vezes no pedido = 1 chamada e custo de 1', e.fraseIds.length === 2 && e.pagos === igual.length && e.aCobrar === igual.length && pagas().length === antes + 1 && g.take.chamadas.filter((c) => !c.doCache).length === 1,
      `${e.fraseIds.join(',')} pagos ${e.pagos} chamadas ${pagas().length - antes}`)
    conferirInvariantes(id8, g.take, 'fish-repetida')
  }

  // ------------------------------------------------ 9. importado (voz do Windows em .m4a)
  console.log('\n9. Importar audio: voz do Windows como se o Levi tivesse gravado')
  const c9 = JSON.parse(original) as Record<string, unknown>
  c9['id'] = id9
  writeFileSync(join(USER, 'recaps', `${id9}.json`), JSON.stringify(c9))
  const wavLevi = falarNoWindows(narrar.frases.map((f) => f.texto).join('\n\n'))
  const m4a = join(BASE, 'narracao-do-levi.m4a')
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', wavLevi, '-c:a', 'aac', '-b:a', '128k', m4a], { windowsHide: true })
  const antes9 = pagas().length
  const t9i = Date.now()
  const g9 = await importarAudio(id9, { caminho: m4a, velocidade: 1, cortarPausas: true, pedidoId: pid() }, progresso)
  const t9 = g9.take
  ok('importado: 0 chamada paga, origem alinhador', pagas().length === antes9 && t9.origemDoAlinhamento === 'alinhador' && t9.config.fonte === 'importado' && t9.cobrados === 0,
    `score ${t9.qualidade?.score?.toFixed(2)} ancoradas ${t9.qualidade?.ancoradas}/${t9.qualidade?.total} em ${((Date.now() - t9i) / 1000).toFixed(1)} s`)
  ok('importado: texto do roteiro', t9.palavras.map((p) => p.texto).join(' ') === narrar.frases.flatMap((f) => f.palavras).join(' '))
  conferirInvariantes(id9, t9, 'importado')
  guardar('importado-windows-corte', id9, t9)
  {
    const medido = await alinharAoAudio(arquivoDaVoz(id9, t9.arquivo), paraOModelo(t9.palavras.map((p) => p.texto)), () => {})
    const e = erros(t9.palavras.map((p) => p.start), medido!.tempos.map((t) => t.start))
    ok('importado: depois do corte, alinhador no audio novo = tempos do take', e.med <= 0.02 && e.p90 <= 0.04, await remedir(id9, t9))
  }
  await conferirPeloSom('importado', id9, t9)
  ok('importado: regravar frase recusa', (await erroDe(() => regravar(id9, ['f03']))) === 'Audio importado: grave de novo e importe.')
  const t9b = Date.now()
  const g9b = await importarAudio(id9, { caminho: m4a, velocidade: 1.1, cortarPausas: false, pedidoId: pid() }, progresso)
  ok('importar o mesmo audio de novo: alinhamento guardado (sem Whisper)', Date.now() - t9b < 8000 && g9b.take.bruto.arquivo === t9.bruto.arquivo, `${((Date.now() - t9b) / 1000).toFixed(1)} s`)
  conferirInvariantes(id9, g9b.take, 'importado-1.1')
  // Audio que nao e deste roteiro.
  // Curto demais para o roteiro: recusa antes do Whisper (v0.1.1).
  const curto = falarNoWindows('Hoje vamos falar de receitas de bolo de cenoura com cobertura de chocolate e dicas de forno.')
  const erroCurto = await erroDe(() => importarAudio(id9, { caminho: curto, velocidade: 1, cortarPausas: false, pedidoId: pid() }, progresso))
  ok('audio curto demais para o roteiro: recusa pela duracao', erroCurto.includes('curto demais'), erroCurto)
  // Outro texto com duracao parecida: passa da duracao e e o alinhador que recusa.
  const outro = falarNoWindows(
    Array.from({ length: 5 }, () => 'Hoje vamos falar de receitas de bolo de cenoura com cobertura de chocolate e dicas de forno.').join(' '),
  )
  const erro9 = await erroDe(() => importarAudio(id9, { caminho: outro, velocidade: 1, cortarPausas: false, pedidoId: pid() }, progresso))
  ok('audio de outro texto: recusa', erro9.includes('nao parece ser'), erro9)
  {
    // Cancelar a importacao no meio do Whisper MATA o whisper-cli (antes so a promessa era largada) e a fila anda.
    const m4bOutro = join(BASE, 'narracao-do-levi-96k.m4a')
    execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', wavLevi, '-c:a', 'aac', '-b:a', '96k', m4bOutro], { windowsHide: true })
    const vivosDoWhisper = (): number => {
      try {
        return execFileSync('tasklist', ['/FI', 'IMAGENAME eq whisper-cli.exe', '/NH'], { windowsHide: true }).toString().split('\n').filter((l) => l.includes('whisper-cli')).length
      } catch {
        return -1
      }
    }
    const p9c = pid()
    const promessa9c = importarAudio(id9, { caminho: m4bOutro, velocidade: 1, cortarPausas: false, pedidoId: p9c }, progresso)
    let rodando = 0
    for (let i = 0; i < 60 && rodando === 0; i++) {
      await new Promise((r) => setTimeout(r, 250))
      rodando = vivosDoWhisper()
    }
    await cancelarVoz(id9, p9c)
    const erro9c = await erroDe(() => promessa9c)
    await new Promise((r) => setTimeout(r, 1500))
    // [recap] O Whisper do NUCLEO nao aceita o signal (o do Studio aceitava): o
    // Cancelar solta o pedido na hora, mas o whisper-cli termina sozinho por
    // tras. Pedido ao nucleo (Faah): `signal` opcional no transcribe e no
    // alinharAoAudio. Ate la, so se confere que o pedido foi solto.
    ok('cancelar a importacao solta o pedido na hora', erro9c === 'Cancelado.', `erro "${erro9c}"`)
    console.log(`  nota  whisper-cli vivo antes ${rodando}, depois ${vivosDoWhisper()} (o do nucleo nao para no Cancelar)`)
    const t9d = Date.now()
    const curto = falarNoWindows('Teste curto.')
    await erroDe(() => importarAudio(id9, { caminho: curto, velocidade: 1, cortarPausas: false, pedidoId: pid() }, progresso))
    ok('a importacao seguinte nao espera o Whisper abandonado', Date.now() - t9d < 15_000, `${((Date.now() - t9d) / 1000).toFixed(1)} s`)
  }

  }

  // ------------------------------------------------ 10. todos os takes do disco
  console.log('\n10. rascunhos relidos do disco')
  for (const id of [ID, ID2, id6, id7, ...(MODELOS ? [id8, id9] : [])]) {
    const r: RascunhoDoRecap = lerRascunho(JSON.parse(readFileSync(join(USER, 'recaps', `${id}.json`), 'utf8')))
    const v = estadoDaVoz(r)
    const ruins = v.takes.filter((t) => conferirTake(t).length > 0 || !existsSync(arquivoDaVoz(id, t.arquivo)) || !existsSync(arquivoDaVoz(id, t.bruto.arquivo)))
    ok(`${id}: ${v.takes.length} takes, todos conferem e tem arquivo`, ruins.length === 0 && v.takes.length > 0 && takeAtual(r) !== null)
  }
  const wavs = readdirSync(join(USER, 'recaps', ID, 'voz')).filter((n) => n.endsWith('.wav'))
  ok('nenhum temporario sobrou na pasta da voz', !readdirSync(join(USER, 'recaps', ID, 'voz')).some((n) => n.endsWith('.tmp')), `${wavs.length} WAVs`)
  ok('nenhuma chamada a rede de verdade', chamadas.every((c) => c.host === 'api.elevenlabs.io' || c.host === 'api.fish.audio'))
  console.log(`\nchamadas pagas FALSAS: ${pagas().length} (nenhum credito real)`)
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
    app.exit(falhas === 0 ? 0 : 1)
  })
