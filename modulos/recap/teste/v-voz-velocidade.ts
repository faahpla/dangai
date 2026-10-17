/**
 * VELOCIDADE DA VOZ e RITMO (decisao do Levi, 15/10), sem gastar nada e sem
 * janela:
 *
 *   1. CACHE PAGO: a chave de quem gerou a 1,0 e IDENTICA a de antes do campo
 *      (hashes gravados com o codigo de ad5e881, antes da mudanca); a 1,2 a
 *      chave muda; no eleven_v4 (sem speed) a nativa nao muda nada. E, se o
 *      perfil real existir, o take pago de verdade do Levi (rc_8bfc71918ce1)
 *      continua achando a MESMA chave do ouvidos.json no cache (so leitura);
 *   2. contrato: take/rascunho sem o campo valem 1,0; o perfil sem o campo
 *      vale 1,2; faixas (nativa 0,7-1,2, acelerar ate 1,25); soMudaOPos;
 *   3. pos: o acelerar e atempo (sem rubberband), com o arquivo em EXATAS N/v
 *      amostras; medido no ffmpeg do projeto com tons conhecidos;
 *   4. ritmo: o inicial calibrado (2,84 p/s a 1,0; ~3,76 a 1,2), a faixa de
 *      palavras e o numero de frases do prompt nesse ritmo, o aprendido;
 *   5. o aviso "52 s - abaixo de 1 min".
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-voz-velocidade.ts
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ffmpegPath } from '../../../electron/services/ffmpeg-path'
import { chaveDoCache, type ConfigPaga } from '../electron/voz/cache'
import { amostrasDoPos, filtroDeVelocidade, filtroDoPos } from '../electron/voz/pos'
import { medidaDoTake } from '../electron/voz/ritmo'
import { lerWav, wavDoPcm } from '../electron/voz/wav'
import { frasesDoAlvo, promptDoRoteiro } from '../electron/gerar/prompts'
import {
  ENCURTA_A_NATIVA_1_2,
  RITMO_DO_TAKE_REAL,
  chaveDoRitmo,
  medidaPlausivel,
  ritmoDaConfig,
  ritmoInicial,
  RITMO_MAX_DO_INICIAL,
  RITMO_MIN_DO_INICIAL,
  type MedidaDoRitmo,
} from '../shared/ritmo'
import { duracaoEstimada, faixaDePalavras, frasesPorPapel, lerRascunho, PAPEIS, roteiroAtual, validarRoteiro } from '../shared/roteiro'
import {
  avisoDoAlvo,
  configDaVozSchema,
  configPadrao,
  pedidoDeAjusteSchema,
  soMudaOPos,
  takeDaVozSchema,
  textoParaNarrar,
  velocidadeNativaEnviada,
  type ConfigDaVoz,
} from '../shared/voz'

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
function lanca(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}
const ms = (s: number): string => `${(s * 1000).toFixed(1)} ms`

// ------------------------------------------------------------ 1. cache pago
console.log('1. chave do cache: a 1,0 e a de antes do campo')
/*
 * Gravados com o codigo de ad5e881 (antes da velocidade nativa), pelo mesmo
 * pedido abaixo. Se um destes mudar, o cache pago antigo do Levi se perde.
 */
const ANTES = {
  eleven: 'fd53d0133ebb0789522049ef4e5adbf3a035896681ca0747e1e67dc1dc80ff7d',
  elevenCtxVar2: 'aea3b57a57f9c6637fac763b561fd1ae61e0abd7edabd840a6803d47ff283882',
  v4: 'e43e730b227ce1488cae9ea07689437278c74f4e5590a216ff385e4b3d49c419',
  fish: 'dc85b37de87007e5c00835c1a132c113d83d62fd2c606e0cbc49e21616a6dd61',
}
// A config como era gravada no take antes do campo: sem velocidadeNativa.
const antigaEleven = { fonte: 'elevenlabs', voiceId: 'VozFalsa0000000000AA', modelId: 'eleven_multilingual_v2', velocidade: 1, cortarPausas: true, settings: { stability: 0.32, similarityBoost: 0.3, style: 0, speakerBoost: true } }
const antigaV4 = { ...antigaEleven, modelId: 'eleven_v4' }
const antigaFish = { fonte: 'fish', voiceId: 'abc123def456', modelId: 's2.1-pro', velocidade: 1, cortarPausas: true, settings: { temperature: 0.7, topP: 0.7 } }
const lida = (c: unknown): ConfigPaga => configDaVozSchema.parse(c) as ConfigPaga
const texto = 'O Senku acordou depois de 3.700 anos de pedra. E isso e ciencia!'
const ctx = { anterior: 'Antes disso, nada.', seguinte: 'Depois, tudo mudou.' }
const vazio = { anterior: '', seguinte: '' }
const chave = (c: ConfigPaga, formato = 'wav_44100', variante = 0, contexto = vazio): string => chaveDoCache({ config: c, texto, contexto }, formato, variante)

const e10 = lida(antigaEleven)
ok('take antigo sem o campo le velocidadeNativa 1', e10.fonte === 'elevenlabs' && e10.velocidadeNativa === 1)
ok('ElevenLabs a 1,0: chave identica a de antes', chave(e10) === ANTES.eleven, chave(e10))
ok('ElevenLabs a 1,0 com contexto e variante 2: identica', chave(e10, 'wav_24000', 2, ctx) === ANTES.elevenCtxVar2)
ok('Fish a 1,0: identica', chave(lida(antigaFish)) === ANTES.fish)
ok('eleven_v4 a 1,0: identica', chave(lida(antigaV4)) === ANTES.v4)
ok('1,0 explicito = sem o campo (mesma chave)', chave(lida({ ...antigaEleven, velocidadeNativa: 1 })) === ANTES.eleven)
const e12 = lida({ ...antigaEleven, velocidadeNativa: 1.2 })
ok('ElevenLabs a 1,2: chave NOVA', chave(e12) !== ANTES.eleven)
ok('1,2 e 1,15 tem chaves diferentes', chave(e12) !== chave(lida({ ...antigaEleven, velocidadeNativa: 1.15 })))
ok('Fish a 1,2: chave nova', chave(lida({ ...antigaFish, velocidadeNativa: 1.2 })) !== ANTES.fish)
ok('eleven_v4 a 1,2: o v4 nao tem speed, chave igual a 1,0', chave(lida({ ...antigaV4, velocidadeNativa: 1.2 })) === ANTES.v4)
ok('acelerar e corte continuam fora da chave', chave(lida({ ...antigaEleven, velocidadeNativa: 1.2, velocidade: 1.25, cortarPausas: false })) === chave(e12))

// O take pago de verdade do Levi (so leitura): a chave do ouvidos.json ainda sai igual.
const PERFIL_REAL = join(process.env['APPDATA'] ?? '', 'AniRecap Studio')
const REAL = join(PERFIL_REAL, 'recaps', 'rc_8bfc71918ce1_mv9hk5uz.json')
const OUVIDOS = join(PERFIL_REAL, 'recaps', 'rc_8bfc71918ce1_mv9hk5uz', 'voz', 'ouvidos.json')
if (existsSync(REAL) && existsSync(OUVIDOS)) {
  const r = lerRascunho(JSON.parse(readFileSync(REAL, 'utf8')))
  const t = r.voz!.takes[0]!
  const rot = r.roteiros.find((x) => x.versao === t.roteiroVersao)!
  const ouvidos = JSON.parse(readFileSync(OUVIDOS, 'utf8')) as string[]
  const k = chaveDoCache({ config: t.config as ConfigPaga, texto: textoParaNarrar(rot).texto, contexto: vazio }, t.chamadas[0]!.formato, 0)
  const naPasta = existsSync(join(PERFIL_REAL, 'recaps', 'cache', 'voz', `${k}.wav`))
  ok('take pago REAL do Levi (1,0): mesma chave do ouvidos.json, e o audio esta no cache', ouvidos.includes(k) && naPasta, `${k.slice(0, 12)}... ${naPasta ? 'no cache' : 'FORA do cache'}`)
} else {
  console.log('  (sem o perfil real do Levi: pulei o take pago de verdade)')
}

// ------------------------------------------------------------ 2. contrato
console.log('\n2. contrato')
const perfilAntigo = configPadrao({ provedor: 'elevenlabs', voiceId: 'VozFalsa0000000000AA', modelId: '' })!
ok('perfil sem o campo: a voz nova sai nativa 1,2', perfilAntigo.fonte === 'elevenlabs' && perfilAntigo.velocidadeNativa === 1.2 && perfilAntigo.velocidade === 1)
const perfil10 = configPadrao({ provedor: 'fish', voiceId: 'abc123def456', modelId: '', velocidadeNativa: 1 })!
ok('perfil a 1,0: fica 1,0', perfil10.fonte === 'fish' && perfil10.velocidadeNativa === 1)
ok('perfil 1.2000000002 (slider) vira 1,2', configPadrao({ provedor: 'fish', voiceId: 'abc123def456', modelId: '', velocidadeNativa: 1.2000000002 })!.fonte === 'fish' && (configPadrao({ provedor: 'fish', voiceId: 'abc123def456', modelId: '', velocidadeNativa: 1.2000000002 }) as Extract<ConfigDaVoz, { fonte: 'fish' }>).velocidadeNativa === 1.2)
ok('nativa 0,7 e 1,2 aceitas', !lanca(() => lida({ ...antigaEleven, velocidadeNativa: 0.7 })) && !lanca(() => lida({ ...antigaEleven, velocidadeNativa: 1.2 })))
ok('nativa 1,5 recusada (a API da 400) e 0,6 tambem', lanca(() => lida({ ...antigaEleven, velocidadeNativa: 1.5 })) && lanca(() => lida({ ...antigaEleven, velocidadeNativa: 0.6 })))
ok('acelerar ate 1,25; 1,3 recusado', !lanca(() => lida({ ...antigaEleven, velocidade: 1.25 })) && lanca(() => lida({ ...antigaEleven, velocidade: 1.3 })))
ok('ajuste (gratis) aceita 1,25', !lanca(() => pedidoDeAjusteSchema.parse({ velocidade: 1.25, cortarPausas: true, pedidoId: 'p1' })))
ok('trocar a nativa NAO e so o pos (e paga)', !soMudaOPos(e10, e12))
ok('trocar o acelerar e so o pos (gratis)', soMudaOPos(e12, lida({ ...antigaEleven, velocidadeNativa: 1.2, velocidade: 1.15 })))
ok('no eleven_v4 a nativa nao conta (nao vira gasto)', soMudaOPos(lida(antigaV4), lida({ ...antigaV4, velocidadeNativa: 1.2 })) && velocidadeNativaEnviada(lida({ ...antigaV4, velocidadeNativa: 1.2 })) === 1)
const imp = configDaVozSchema.parse({ fonte: 'importado', velocidade: 1.1, cortarPausas: true, audio: { nome: 'levi.m4a', hash: 'c'.repeat(64) } })
ok('importado: sem nativa (vale 1)', velocidadeNativaEnviada(imp) === 1 && !('velocidadeNativa' in imp))

// ------------------------------------------------------------ 3. pos (atempo)
console.log('\n3. pos: atempo, arquivo em exatas N/v amostras')
ok('o filtro e atempo, sem rubberband', /^atempo=1\.2000,adelay=delays=353S:all=1,apad=whole_len=1000,atrim=end_sample=1000$/.test(filtroDeVelocidade(1.2, 44_100, 1000)), filtroDeVelocidade(1.2, 44_100, 1000))
ok('a 1,0: anull', filtroDeVelocidade(1, 44_100, 1000) === 'anull')
ok('nenhum rubberband no filtro do pos', !filtroDoPos([{ de: 100, ate: 200 }], 44_100, 44_100, 1.25).includes('rubberband'))
{
  // Tons de 0,1-0,45 s, 60 s, na taxa do ElevenLabs e na recusada: o fim do som na conta, o arquivo exato.
  for (const taxa of [44_100, 24_000]) {
    const regs: [number, number][] = []
    let t = 0.5
    let semente = 11
    const rnd = (): number => {
      semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0
      return semente / 4294967296
    }
    while (t < 60) {
      const d = 0.1 + rnd() * 0.35
      regs.push([t, t + d])
      t += d + 0.05 + rnd() * 0.25
    }
    const am = new Int16Array(Math.round((t + 0.6) * taxa))
    for (const [a, b] of regs) {
      const A = Math.round(a * taxa)
      const B = Math.round(b * taxa)
      const r = Math.round(0.003 * taxa)
      for (let n = A; n < B; n++) {
        const tt = (n - A) / taxa
        const env = Math.min(1, (n - A) / r, (B - n) / r)
        am[n] = Math.round(9000 * env * (0.6 * Math.cos(2 * Math.PI * 150 * tt) + 0.4 * Math.cos(2 * Math.PI * 310 * tt)))
      }
    }
    const pasta = mkdtempSync(join(tmpdir(), 'v-voz-velocidade-'))
    const ent = join(pasta, 'e.wav')
    writeFileSync(ent, wavDoPcm({ taxa, amostras: am }))
    for (const v of [1.1, 1.2, 1.25]) {
      const N = amostrasDoPos(am.length, 0, v)
      const filtro = filtroDeVelocidade(v, taxa, N)
      const r = spawnSync(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', ent, '-af', filtro, '-ar', String(taxa), '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { maxBuffer: 1 << 30 })
      const pcm = lerWav(r.stdout)!
      const tons: [number, number][] = []
      let ini = -1
      let ult = -1
      const junta = Math.round(0.01 * taxa)
      for (let n = 0; n < pcm.amostras.length; n++) {
        if (Math.abs(pcm.amostras[n]!) <= 1500) continue
        if (ini < 0) ini = n
        else if (n - ult > junta) {
          tons.push([ini / taxa, (ult + 1) / taxa])
          ini = n
        }
        ult = n
      }
      if (ini >= 0) tons.push([ini / taxa, (ult + 1) / taxa])
      const mesmos = tons.length === regs.length
      const di = mesmos ? tons.map((x, i) => x[0] - regs[i]![0] / v) : [Infinity]
      const df = mesmos ? tons.map((x, i) => x[1] - regs[i]![1] / v) : [Infinity]
      const max = (xs: number[]): number => Math.max(...xs.map(Math.abs))
      const terco = Math.floor(di.length / 3)
      const media = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
      const deriva = Math.abs(media(di.slice(0, terco)) - media(di.slice(-terco)))
      ok(`${taxa / 1000} kHz a ${v}: arquivo com exatas N/v amostras`, pcm.amostras.length === N, `${pcm.amostras.length} vs ${N}`)
      /*
       * O overlap-add do atempo (janela de 1/24 s) espalha o ATAQUE para tras
       * e o fim para frente conforme a fase da janela: ate ~20 ms numa palavra,
       * constante, sem deriva -- meio quadro de 23,976. O arquivo e exato.
       */
      ok(`${taxa / 1000} kHz a ${v}: cada som no tempo t/v (<= 25 ms, meio quadro), sem deriva`, mesmos && max(di) <= 0.025 && max(df) <= 0.025 && deriva <= 0.003,
        `ataque max ${ms(max(di))}, fim max ${ms(max(df))}, deriva ${ms(deriva)}`)
    }
    rmSync(pasta, { recursive: true, force: true })
  }
}

// ------------------------------------------------------------ 4. ritmo
console.log('\n4. ritmo')
ok('inicial a 1,0 = o take real (170 palavras em 59,82 s)', Math.abs(ritmoInicial(1, 1) - 2.842) < 0.001, ritmoInicial(1, 1).toFixed(3))
ok('inicial a 1,2 = 1,0 x 1,323 (as amostras pelo corte de pausas)', Math.abs(ritmoInicial(1.2, 1) - RITMO_DO_TAKE_REAL * ENCURTA_A_NATIVA_1_2) < 1e-9, ritmoInicial(1.2, 1).toFixed(3))
ok('acelerar multiplica exato', Math.abs(ritmoInicial(1.2, 1.25) - ritmoInicial(1.2, 1) * 1.25) < 1e-9)
ok('nativa menor fala mais devagar (0,7 < 1,0)', ritmoInicial(0.7, 1) < ritmoInicial(1, 1))
const r12 = ritmoInicial(1.2, 1)
const f60 = faixaDePalavras(60, r12)
ok('60 s a 1,2: alvo ~226 palavras, minimo 92%', f60.alvo === Math.round(60 * r12) && f60.min === Math.round(f60.alvo * 0.92) && f60.alvo > 215 && f60.alvo < 235, `${f60.min}-${f60.alvo}-${f60.max}`)
ok('sem ritmo: o 2,7 de antes (162 em 60 s)', faixaDePalavras(60).alvo === 162 && Math.abs(duracaoEstimada(162) - 60) < 0.01)
ok('~Xs no ritmo da voz: 226 palavras a 1,2 ~ 60 s', Math.abs(duracaoEstimada(f60.alvo, r12) - 60) < 0.2)
const fp = frasesPorPapel(60, r12)
const somaFp = PAPEIS.reduce((n, p) => n + fp[p], 0)
ok('frases do prompt crescem com o ritmo (gancho e fechamento ficam)', somaFp === frasesDoAlvo(60, r12) && somaFp >= 24 && somaFp <= 26 && fp.gancho === 2 && fp.fechamento === 2,
  JSON.stringify(fp))
ok('~9 palavras por frase no ritmo novo', Math.abs(f60.alvo / somaFp - 9) < 0.6, (f60.alvo / somaFp).toFixed(1))
ok('frases a 2,7: os moldes de sempre', frasesDoAlvo(60) === 18 && frasesDoAlvo(90) === 25)
const fp90 = frasesPorPapel(90, r12)
ok('90 s a 1,2: ~35 frases', PAPEIS.reduce((n, p) => n + fp90[p], 0) >= 33 && PAPEIS.reduce((n, p) => n + fp90[p], 0) <= 37, JSON.stringify(fp90))
{
  const prompt = promptDoRoteiro({
    indice: { anime: 'Teste', temporada: 1, episodio: 1, kind: 'tv', cues: [], exclusoes: [], planos: [] } as never,
    eventos: [],
    alvoSec: 60,
    ritmo: r12,
    elenco: { personagens: [], comFalante: false, porPalavra: new Map() },
  })
  ok('o prompt pede o alvo no ritmo da voz', prompt.includes(`ALVO de ${f60.alvo} palavras`) && prompt.includes(`mínimo ${f60.min}`) && prompt.includes(`em umas ${somaFp} frases`), prompt.split('\n')[1]!.slice(0, 140))
}
// O "Curto" do validarRoteiro: 180 palavras sao 63 s a 2,7, mas 48 s a 1,2.
{
  const frase = (i: number): { id: string; texto: string; eventoIds: string[]; cueDoMomento: null; intencaoVisual: string; textoDeTela: null; citacaoCueId: null } => ({
    id: `f${String(i + 1).padStart(2, '0')}`,
    texto: 'Uma frase de nove palavras para medir o roteiro todo.',
    eventoIds: [],
    cueDoMomento: null,
    intencaoVisual: 'close',
    textoDeTela: null,
    citacaoCueId: null,
  })
  const roteiro = { alvoSec: 60 as const, secoes: [{ id: 's1', papel: 'gancho' as const, frases: Array.from({ length: 20 }, (_, i) => frase(i)) }] }
  const curto = (r: number | undefined): boolean => validarRoteiro(roteiro, [], undefined, r).some((p) => p.codigo === 'palavras-fora' && p.mensagem.startsWith('Curto'))
  ok('180 palavras: ok a 2,7, "Curto" a 1,2', !curto(undefined) && curto(r12))
}
// Aprendido.
const cfg12 = lida({ ...antigaEleven, velocidadeNativa: 1.2 })
const cfg10 = lida(antigaEleven)
const medida = (c: ConfigDaVoz, palavras: number, duracao: number, arquivo: string): MedidaDoRitmo => ({
  chave: chaveDoRitmo(c),
  voz: 'elevenlabs|VozFalsa0000000000AA|eleven_multilingual_v2',
  nativa: velocidadeNativaEnviada(c),
  acelerar: c.velocidade,
  palavras,
  duracao,
  arquivo,
  quando: new Date().toISOString(),
})
ok('sem medida: o inicial', ritmoDaConfig(cfg12, []).origem === 'inicial' && Math.abs(ritmoDaConfig(cfg12, []).ritmo - r12) < 1e-9)
const so10 = [medida(cfg10, 170, 59.82 / 0.95, 'narracao-a.wav')] // esta voz fala 5% mais devagar que a calibracao
const daVoz = ritmoDaConfig(cfg12, so10)
ok('a mesma voz medida a 1,0: o 1,2 vem do inicial x o fator dela', daVoz.origem === 'da-voz' && Math.abs(daVoz.ritmo - r12 * 0.95) < 1e-6, daVoz.ritmo.toFixed(3))
const medidas = [...so10, medida(cfg12, 220, 62, 'narracao-b.wav'), medida(cfg12, 230, 60, 'narracao-c.wav')]
const exato = ritmoDaConfig(cfg12, medidas)
ok('a mesma config ja medida: palavras / segundos dos takes dela', exato.origem === 'medido' && exato.takes === 2 && Math.abs(exato.ritmo - 450 / 122) < 1e-9, exato.ritmo.toFixed(3))
// Sem voz escolhida a narracao vai ser o audio importado (a voz dele, sem nativa): o ritmo do importado.
ok('sem voz escolhida: o ritmo do importado (2,84 p/s sem medida)', Math.abs(ritmoDaConfig(null, medidas).ritmo - ritmoInicial(1, 1)) < 1e-9 && ritmoDaConfig(null, medidas).nativa === null)
{
  const imp1 = { chave: 'importado|n1.00|a1.00', voz: 'importado', nativa: 1, acelerar: 1, palavras: 150, duracao: 60, arquivo: 'narracao-i.wav', quando: new Date().toISOString() }
  ok('sem voz, com o importado ja medido: o medido dele', ritmoDaConfig(null, [...medidas, imp1]).origem === 'medido' && ritmoDaConfig(null, [...medidas, imp1]).ritmo === 2.5)
}
{
  const take = takeDaVozSchema.parse({
    id: 't1',
    config: cfg12,
    arquivo: `narracao-${'a'.repeat(32)}.wav`,
    duracao: 60,
    palavras: Array.from({ length: 226 }, (_, i) => ({ texto: 'x', start: i * 0.25, end: i * 0.25 + 0.2, fraseId: 'f01' })),
    trechos: [],
    bruto: { arquivo: `bruto-${'b'.repeat(32)}.wav`, duracao: 66, palavras: [], trechos: [] },
    origemDoAlinhamento: 'provedor',
    caracteres: 1,
    criadoEm: new Date().toISOString(),
    roteiroVersao: 1,
  })
  const m = medidaDoTake(take)
  ok('medida de um take: palavras / duracao do arquivo final, na chave da config', m !== null && m.palavras === 226 && m.duracao === 60 && m.chave === chaveDoRitmo(cfg12))
  ok('take sem o corte de pausas nao mede', medidaDoTake({ ...take, config: { ...cfg12, cortarPausas: false } }) === null)
  // Take curto (um teste, um gancho solto) nao ensina o ritmo: varia demais com o texto.
  ok('take curto (40 palavras, 13 s) nao mede', medidaDoTake({ ...take, duracao: 13, palavras: take.palavras.slice(0, 40) }) === null)
}
// Os limites do aprendido (revisao B de 15/10): take curto nao vale, e o resultado fica perto do inicial.
{
  const cfg07 = lida({ ...antigaEleven, velocidadeNativa: 0.7, velocidade: 0.9 })
  const cfg1225 = lida({ ...antigaEleven, velocidadeNativa: 1.2, velocidade: 1.25 })
  ok('medidaPlausivel: 8 palavras em 1,4 s e 3 em 2,9 s nao contam; 170 em 59,82 s conta',
    !medidaPlausivel(8, 1.4) && !medidaPlausivel(3, 2.9) && !medidaPlausivel(40, 13) && medidaPlausivel(170, 59.82))
  const curtoRapido = ritmoDaConfig(cfg12, [medida(cfg12, 8, 1.4, 'curto-a.wav')])
  ok('1 take curto e rapido na mesma config: fica o inicial', curtoRapido.origem === 'inicial' && Math.abs(curtoRapido.ritmo - r12) < 1e-9, curtoRapido.ritmo.toFixed(2))
  const i1225 = ritmoInicial(1.2, 1.25)
  const lento = ritmoDaConfig(cfg1225, [medida(cfg07, 60, 59, 'lento-a.wav')]) // 1,02 p/s a 0,7/0,9: fator ~0,58
  ok('da-voz com fator absurdo: preso em 0,75x do inicial', lento.origem === 'da-voz' && Math.abs(lento.ritmo - i1225 * RITMO_MIN_DO_INICIAL) < 1e-9, lento.ritmo.toFixed(2))
  const rapido = ritmoDaConfig(cfg07, [medida(cfg1225, 330, 60, 'rapido-a.wav')]) // 5,5 p/s a 1,2/1,25
  const i07 = ritmoInicial(0.7, 0.9)
  ok('da-voz no outro sentido: no maximo 1,35x do inicial', rapido.ritmo <= i07 * RITMO_MAX_DO_INICIAL + 1e-9 && rapido.ritmo >= 1, rapido.ritmo.toFixed(2))
  const medidoRapido = ritmoDaConfig(cfg12, [medida(cfg12, 350, 60, 'rapido-b.wav')]) // 5,83 p/s a 1,2
  ok('medido muito acima do inicial: preso em 1,35x (e <= 6 p/s)', Math.abs(medidoRapido.ritmo - Math.min(6, r12 * RITMO_MAX_DO_INICIAL)) < 1e-9, medidoRapido.ritmo.toFixed(2))
  const real = ritmoDaConfig(cfg12, [medida(cfg12, 182, 60, 'real-a.wav')]) // 3,03 p/s: a variacao real fica
  ok('take inteiro mais lento (3,03 p/s, 0,81x): vale como medido', real.origem === 'medido' && Math.abs(real.ritmo - 182 / 60) < 1e-9, real.ritmo.toFixed(2))
}

// ------------------------------------------------------------ 5. aviso do alvo
console.log('\n5. aviso abaixo do alvo')
ok('52,4 s em 60: "52 s - abaixo de 1 min"', avisoDoAlvo(52.4, 60) === '52 s - abaixo de 1 min', String(avisoDoAlvo(52.4, 60)))
ok('84 s em 90: "84 s - abaixo de 1 min 30"', avisoDoAlvo(84.2, 90) === '84 s - abaixo de 1 min 30')
ok('60,1 s em 60: nada', avisoDoAlvo(60.1, 60) === null && avisoDoAlvo(60, 60) === null)
ok('59,82 s (o take aprovado do Levi): nada; 47,9 s: "48 s"', avisoDoAlvo(59.82, 60) === null && avisoDoAlvo(47.9, 60) === '48 s - abaixo de 1 min', String(avisoDoAlvo(47.9, 60)))

// ------------------------------------------------------------ fim
void roteiroAtual
console.log(`\n${total - falhas}/${total} ok${falhas ? ` -- ${falhas} FALHA(S)` : ''}`)
process.exit(falhas ? 1 : 0)
