import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PAUSA_CURTA_SEC, PAUSA_LONGA_SEC, TOLERANCIA_SEC, type PalavraComTempo } from '../../shared/voz'
import { rodarFfmpeg, SAIDA_WAV } from './ffmpeg'
import { lerWav, type Pcm } from './wav'

/**
 * O POS da narracao: bruto -> narracao. Corte de pausa e o "acelerar".
 *
 * O que o AniRecap fazia (core/audio_post.py) e os defeitos que isto corrige:
 *   - o silencio era achado pelo silencedetect (-42 dB) e cortado pelo
 *     silenceremove, e os tempos eram remapeados "de cabeca" e depois esticados
 *     pela duracao do mp3 (recalibracao linear): deriva de 0,1-0,3 s no fim;
 *   - o mp3 era reencodado duas vezes.
 *
 * Aqui:
 *   1. as pausas saem do PROPRIO ALINHAMENTO (o vao entre duas palavras), e a
 *      energia do audio so ENCOLHE o que pode sair: o fim de uma palavra que
 *      ainda soa ("s" final, consoante que o alignment fechou cedo) estende a
 *      palavra, e as duas pontas de cada corte tem que cair num quadro calado.
 *      O corte tira o MEIO do vao e deixa PAUSA_CURTA_SEC (metade de cada
 *      lado): nunca encosta em palavra;
 *   2. os cortes viram atrim (por AMOSTRA, start_sample/end_sample) + concat, e
 *      o "acelerar" vira ATEMPO, num filtro so do ffmpeg, em WAV PCM. O atempo
 *      e o do App Resumo, o som que o Levi conhece; o rubberband (14/10) a 1,5
 *      soou robotico para ele (15/10). Medido em 15/10 (tons de 0,06-0,45 s por
 *      60 s, 24 e 44,1 kHz, 0,9-1,25x): o fim de cada som cai na conta, mas o
 *      overlap-add (janela de 1/24 s) "espalha" o ataque para tras, o conteudo
 *      sai ~8 ms ADIANTADO (o centro de cada som), sem deriva, e o arquivo sai
 *      17-28 ms mais curto que N/v. Entao o filtro atrasa a saida
 *      ATRASO_DO_ATEMPO_SEC (centra o som na conta t/v) e acerta o arquivo em
 *      EXATAS N/v amostras (apad + atrim): a conta vale ate a ultima amostra;
 *   3. o tempo de cada palavra e remapeado pela conta exata dos cortes:
 *        t' = (t - cortado_antes_de_t) / velocidade
 *      A duracao final sai da contagem de amostras do WAV gerado; a diferenca
 *      para a conta vira aviso acima de TOLERANCIA_SEC. Nada de escala pela
 *      duracao do arquivo.
 *
 * O preco do atempo nos testes (v-voz-motor, registrado na v0.1.0): com
 * acelerar != 1, a palavra contra o tom vale ate 25 ms (meio quadro a 23,976),
 * com deriva <= 3 ms; com o rubberband eram 15 ms. O overlap-add espalha o
 * ataque de cada palavra em ate ~20 ms (mediana ~10) e o atraso acima ja
 * centra o som: so com atempo nao da para ficar em 15 ms em toda palavra.
 * Duracao exata (N/v amostras), conferirTake (5 ms) e os caminhos sem
 * acelerar (2 ms) continuam como eram.
 */

/** Um pedaco que sai, em amostras [de, ate). */
export interface Corte {
  de: number
  ate: number
}

/** Quadro da medida de energia. 10 ms: fino o bastante para a ponta de uma consoante. */
const QUADRO_SEC = 0.01
/** Corte menor que isto nao vale a emenda. */
const CORTE_MINIMO_SEC = 0.02
/** Rampa nas pontas de cada emenda (no silencio): mata o clique de uma amostra que nao era zero. */
const RAMPA_SEC = 0.004

export interface Energia {
  taxa: number
  amostrasPorQuadro: number
  /** dBFS por quadro (-120 = silencio digital). */
  db: Float32Array
  /** Acima disto o quadro tem SOM. */
  limiar: number
  /** O nivel da fala (p90 dos quadros), para separar fala de respiracao. */
  fala: number
}

/**
 * Quanto abaixo da fala (p90) um quadro ainda e FALA, e nao respiracao ou
 * estalo. Nos takes do S4-37 a respiracao do ElevenLabs fica ~25 dB abaixo da
 * fala (o quadro mais alto dentro de um corte deu -48 dB contra -23 da fala).
 */
const FALA_ABAIXO_DB = 20
/** Uma ilha de som so e fala de verdade com pelo menos isto de quadros no nivel da fala. */
const ILHA_MINIMA_QUADROS = 3

/**
 * Energia por quadro e o limiar de silencio do proprio audio: 6 dB acima do
 * chao de ruido (p10) ou 40 dB abaixo da fala (p90), o que for maior, mas nunca
 * a menos de 25 dB da fala. TTS tem silencio digital (chao -120): o limiar fica
 * ~-58 dBFS e o "s" final, que fica la por -45, conta como som. Gravacao com
 * ruido de sala (-55) fica com ~-49.
 */
export function medirEnergia(pcm: Pcm): Energia {
  const amostrasPorQuadro = Math.max(1, Math.round(pcm.taxa * QUADRO_SEC))
  const quadros = Math.ceil(pcm.amostras.length / amostrasPorQuadro)
  const db = new Float32Array(quadros)
  for (let q = 0; q < quadros; q++) {
    const ini = q * amostrasPorQuadro
    const fim = Math.min(pcm.amostras.length, ini + amostrasPorQuadro)
    let soma = 0
    for (let i = ini; i < fim; i++) {
      const v = pcm.amostras[i]!
      soma += v * v
    }
    const rms = fim > ini ? Math.sqrt(soma / (fim - ini)) : 0
    db[q] = rms > 0 ? Math.max(-120, 20 * Math.log10(rms / 32768)) : -120
  }
  const ordenado = Float32Array.from(db).sort()
  const pct = (p: number): number => (ordenado.length ? ordenado[Math.min(ordenado.length - 1, Math.floor(p * ordenado.length))]! : -120)
  const fala = pct(0.9)
  const chao = pct(0.1)
  const limiar = Math.min(fala - 25, Math.max(chao + 6, fala - 40, -70))
  return { taxa: pcm.taxa, amostrasPorQuadro, db, limiar, fala }
}

function temSom(e: Energia, q: number): boolean {
  return q >= 0 && q < e.db.length && e.db[q]! > e.limiar
}

/** O quadro esta no nivel da FALA (nao so acima do chao de ruido). */
function temFala(e: Energia, q: number): boolean {
  return q >= 0 && q < e.db.length && e.db[q]! > Math.max(e.limiar, e.fala - FALA_ABAIXO_DB)
}

/** Segundos do inicio do quadro q. */
function tempoDoQuadro(e: Energia, q: number): number {
  return (q * e.amostrasPorQuadro) / e.taxa
}

function quadroDe(e: Energia, t: number): number {
  return Math.floor((t * e.taxa) / e.amostrasPorQuadro)
}

/** Onde o som que esta em `t` acaba (estende para a direita enquanto ha som), sem passar de `limite`. */
export function fimDoSom(e: Energia, t: number, limite: number): number {
  let q = quadroDe(e, t)
  if (!temSom(e, q)) return t
  while (temSom(e, q + 1) && tempoDoQuadro(e, q + 1) < limite) q++
  return Math.min(limite, Math.max(t, tempoDoQuadro(e, q + 1)))
}

/** Onde o som que chega em `t` comeca (recua enquanto ha som), sem passar de `limite` (< t). */
export function inicioDoSom(e: Energia, t: number, limite: number): number {
  let q = Math.ceil((t * e.taxa) / e.amostrasPorQuadro) - 1
  if (!temSom(e, q)) return t
  while (temSom(e, q - 1) && tempoDoQuadro(e, q) > limite) q--
  return Math.max(limite, Math.min(t, tempoDoQuadro(e, q)))
}

/** O primeiro instante >= t que comeca um quadro calado (ate `limite`). */
function proximoCalado(e: Energia, t: number, limite: number): number {
  let q = quadroDe(e, t)
  if (!temSom(e, q)) return t
  while (temSom(e, q) && tempoDoQuadro(e, q) < limite) q++
  return Math.max(t, tempoDoQuadro(e, q))
}

/** O ultimo instante <= t que fecha um quadro calado (ate `limite`). */
function anteriorCalado(e: Energia, t: number, limite: number): number {
  let q = Math.ceil((t * e.taxa) / e.amostrasPorQuadro) - 1
  if (!temSom(e, q)) return t
  while (temSom(e, q) && tempoDoQuadro(e, q + 1) > limite) q--
  return Math.min(t, tempoDoQuadro(e, q + 1))
}

/**
 * As ILHAS DE FALA dentro de [a, b] (segundos): trechos de som com pelo menos
 * ILHA_MINIMA_QUADROS no nivel da fala. Respiracao e estalo nao contam (tirar
 * isso e o trabalho do corte); fala sem palavra no alinhamento (um parentese
 * falado, uma palavra a mais na gravacao, um alinhamento que errou) conta, e o
 * corte nunca passa por cima dela.
 */
function ilhasDeFala(e: Energia, a: number, b: number): { de: number; ate: number }[] {
  const ilhas: { de: number; ate: number }[] = []
  const q0 = Math.max(0, quadroDe(e, a))
  const q1 = Math.min(e.db.length, Math.ceil((b * e.taxa) / e.amostrasPorQuadro))
  let q = q0
  while (q < q1) {
    if (!temSom(e, q)) {
      q++
      continue
    }
    const ini = q
    let falando = 0
    while (q < q1 && temSom(e, q)) {
      if (temFala(e, q)) falando++
      q++
    }
    if (falando >= ILHA_MINIMA_QUADROS) {
      ilhas.push({ de: Math.max(a, tempoDoQuadro(e, ini)), ate: Math.min(b, tempoDoQuadro(e, q)) })
    }
  }
  return ilhas
}

/**
 * Os cortes de pausa, em amostras: cada silencio >= PAUSA_LONGA_SEC (entre duas
 * palavras, antes da primeira e depois da ultima) fica com PAUSA_CURTA_SEC.
 * As palavras estao no tempo do bruto, em ordem e sem sobreposicao.
 *
 * O vao entre duas palavras e partido nas ILHAS DE FALA que houver dentro dele
 * (som no nivel da fala sem palavra do roteiro): so os pedacos calados entre
 * elas saem, cada um deixando metade da pausa curta de cada lado. Antes so as
 * duas pontas do corte eram conferidas, e um parentese falado no meio de um
 * vao saia inteiro. `saida.ilhas` conta essas ilhas (vira aviso no take).
 */
export function cortesDasPausas(
  palavras: readonly Pick<PalavraComTempo, 'start' | 'end'>[],
  e: Energia,
  amostras: number,
  saida?: { ilhas: number },
): Corte[] {
  const duracao = amostras / e.taxa
  const longa = PAUSA_LONGA_SEC
  const curta = PAUSA_CURTA_SEC
  const cortes: Corte[] = []
  const empurrar = (r0: number, r1: number): void => {
    if (r1 - r0 < CORTE_MINIMO_SEC) return
    const de = Math.max(0, Math.round(r0 * e.taxa))
    const ate = Math.min(amostras, Math.round(r1 * e.taxa))
    const anterior = cortes.at(-1)
    if (ate - de <= 0 || (anterior && de < anterior.ate)) return
    cortes.push({ de, ate })
  }
  /**
   * Tira o silencio de [a, b], partido nas ilhas de fala: cada pedaco calado
   * >= longa fica com `margemA` no comeco e `margemB` no fim (metade da pausa
   * curta onde encosta numa ilha). Margem 0 = corta ate a ponta (comeco ou fim
   * do arquivo).
   */
  const cortarRegiao = (a: number, b: number, margemA: number, margemB: number): void => {
    const ilhas = ilhasDeFala(e, a, b)
    if (saida) saida.ilhas += ilhas.length
    const pedacos: { x: number; y: number; mx: number; my: number }[] = []
    let x = a
    let mx = margemA
    for (const ilha of ilhas) {
      pedacos.push({ x, y: ilha.de, mx, my: curta / 2 })
      x = ilha.ate
      mx = curta / 2
    }
    pedacos.push({ x, y: b, mx, my: margemB })
    for (const p of pedacos) {
      if (p.y - p.x < longa) continue
      const r0 = p.mx > 0 ? proximoCalado(e, p.x + p.mx, p.y) : p.x
      const r1 = p.my > 0 ? anteriorCalado(e, p.y - p.my, r0) : p.y
      empurrar(r0, r1)
    }
  }
  if (palavras.length === 0) return cortes

  // Antes da primeira palavra: do comeco do arquivo ate a pausa curta antes dela.
  const primeiro = inicioDoSom(e, palavras[0]!.start, 0)
  if (primeiro >= longa) cortarRegiao(0, primeiro, 0, curta)

  // Entre palavras: tira o meio, deixa metade da pausa curta de cada lado.
  for (let k = 0; k < palavras.length - 1; k++) {
    const g0 = palavras[k]!.end
    const g1 = palavras[k + 1]!.start
    if (g1 - g0 < longa) continue
    const s0 = fimDoSom(e, g0, g1)
    const s1 = inicioDoSom(e, g1, s0)
    if (s1 - s0 < longa) continue
    cortarRegiao(s0, s1, curta / 2, curta / 2)
  }

  // Depois da ultima: a pausa curta depois dela, e o resto ate o fim sai.
  const ultimo = fimDoSom(e, palavras.at(-1)!.end, duracao)
  if (duracao - ultimo >= longa) cortarRegiao(ultimo, duracao, curta, 0)
  return cortes
}

// ------------------------------------------------- palavra contra o som

/**
 * Encosta as bordas de cada palavra no SOM: o fim num quadro calado recua ate
 * o ultimo quadro com som (sem passar do inicio dela); o inicio num quadro
 * calado avanca ate o primeiro com som (sem passar do fim). Palavra sem som
 * nenhum fica como esta (e conta como suspeita em palavrasSuspeitas).
 *
 * Por que: o alignment do ElevenLabs as vezes comeca a palavra ~100-150 ms
 * dentro do silencio de antes e termina a ultima da frase ~100 ms depois do
 * som, e o alinhador esticava a ultima palavra por cima da pausa. A sobra
 * entrava nos 150 ms que o corte deixa (pausas com ~300 ms de silencio real) e
 * o karaoke acendia antes do som. O limiar fica ~33 dB abaixo da fala: a
 * consoante final continua dentro da palavra.
 */
export function encostarNoSom<P extends Pick<PalavraComTempo, 'start' | 'end'>>(palavras: readonly P[], e: Energia): P[] {
  return palavras.map((p) => {
    let start = p.start
    let end = p.end
    if (end - start <= 0) return p
    let q = quadroDe(e, start)
    if (!temSom(e, q)) {
      while (q < e.db.length && !temSom(e, q) && tempoDoQuadro(e, q) < end) q++
      if (!temSom(e, q) || tempoDoQuadro(e, q) >= end) return p
      start = Math.max(start, tempoDoQuadro(e, q))
    }
    q = Math.ceil((end * e.taxa) / e.amostrasPorQuadro) - 1
    if (!temSom(e, q)) {
      while (q >= 0 && !temSom(e, q) && tempoDoQuadro(e, q + 1) > start) q--
      if (temSom(e, q)) end = Math.max(start, Math.min(end, tempoDoQuadro(e, q + 1)))
    }
    return start === p.start && end === p.end ? p : { ...p, start, end }
  })
}

/**
 * As palavras cujo TEMPO o audio desmente (indices na lista):
 *   - a faixa dela contem silencio >= PAUSA_LONGA_SEC: foi esticada por cima
 *     de uma pausa;
 *   - ela vem depois de um vao >= PAUSA_LONGA_SEC que e quase todo fala: a
 *     pausa marcada cai em cima da voz e a palavra acende tarde.
 *
 * E a rede de seguranca da qualidade do take: a media do wav2vec2 dilui 4
 * palavras erradas entre 179, e "ancoradas" contava todas.
 */
export function palavrasSuspeitas(palavras: readonly Pick<PalavraComTempo, 'start' | 'end'>[], e: Energia): number[] {
  const suspeitas = new Set<number>()
  const longa = Math.round((PAUSA_LONGA_SEC * e.taxa) / e.amostrasPorQuadro)
  for (const [i, p] of palavras.entries()) {
    // Silencio longo DENTRO da palavra.
    const q0 = quadroDe(e, p.start)
    const q1 = Math.min(e.db.length, Math.ceil((p.end * e.taxa) / e.amostrasPorQuadro))
    let calados = 0
    for (let q = q0; q < q1; q++) {
      calados = temSom(e, q) ? 0 : calados + 1
      if (calados >= longa) {
        suspeitas.add(i)
        break
      }
    }
    // Vao longo antes dela que e fala.
    if (i === 0) continue
    const g0 = palavras[i - 1]!.end
    const g1 = p.start
    if (g1 - g0 < PAUSA_LONGA_SEC) continue
    const v0 = quadroDe(e, g0)
    const v1 = Math.min(e.db.length, Math.ceil((g1 * e.taxa) / e.amostrasPorQuadro))
    let fala = 0
    for (let q = v0; q < v1; q++) if (temFala(e, q)) fala++
    if (v1 > v0 && fala / (v1 - v0) > 0.5) suspeitas.add(i)
  }
  return [...suspeitas].sort((a, b) => a - b)
}

/**
 * A fronteira entre duas frases dentro do vao [fimA, iniB]: o meio do MAIOR
 * trecho calado dele. O meio aritmetico do vao, sem olhar o audio, caia em
 * plena fala quando o alinhamento errava (-19 dB no t4), e o "tocar a frase"
 * comecava no meio de uma palavra. Sem nenhum quadro calado no vao: o quadro
 * de menor energia, e `calado` false (quem chama avisa).
 */
export function fronteiraPeloSom(e: Energia, fimA: number, iniB: number): { t: number; calado: boolean } {
  if (iniB <= fimA) return { t: fimA, calado: false }
  const dentro = (t: number): number => Math.min(iniB, Math.max(fimA, t))
  const calado = maiorTrechoCalado(e, fimA, iniB)
  if (calado) return { t: dentro((calado.de + calado.ate) / 2), calado: true }
  // Nenhum quadro calado: o de menor energia.
  const q0 = Math.max(0, Math.min(e.db.length - 1, quadroDe(e, fimA)))
  const q1 = Math.min(e.db.length, Math.max(q0 + 1, Math.ceil((iniB * e.taxa) / e.amostrasPorQuadro)))
  let menor = q0
  for (let q = q0; q < q1; q++) if (e.db[q]! < e.db[menor]!) menor = q
  return { t: dentro(tempoDoQuadro(e, menor) + (0.5 * e.amostrasPorQuadro) / e.taxa), calado: false }
}

/** O maior trecho de quadros calados seguidos dentro de [a, b] (segundos). null = nenhum quadro calado. */
export function maiorTrechoCalado(e: Energia, a: number, b: number): { de: number; ate: number } | null {
  const q0 = Math.max(0, Math.min(e.db.length - 1, quadroDe(e, a)))
  const q1 = Math.min(e.db.length, Math.max(q0 + 1, Math.ceil((b * e.taxa) / e.amostrasPorQuadro)))
  let melhor: { de: number; ate: number } | null = null
  let q = q0
  while (q < q1) {
    if (temSom(e, q)) {
      q++
      continue
    }
    const de = q
    while (q < q1 && !temSom(e, q)) q++
    if (!melhor || q - de > melhor.ate - melhor.de) melhor = { de, ate: q }
  }
  return melhor ? { de: Math.max(a, tempoDoQuadro(e, melhor.de)), ate: Math.min(b, tempoDoQuadro(e, melhor.ate)) } : null
}

/** Quanto foi cortado ANTES da amostra n (n dentro de um corte = cola no ponto da emenda). */
export function cortadoAntes(cortes: readonly Corte[], n: number): number {
  let soma = 0
  for (const c of cortes) {
    if (c.ate <= n) soma += c.ate - c.de
    else if (c.de < n) {
      soma += n - c.de
      break
    } else break
  }
  return soma
}

/** t (segundos no bruto) -> t' (segundos na narracao), pela conta exata. */
export function remapear(cortes: readonly Corte[], taxa: number, velocidade: number, t: number): number {
  const n = t * taxa
  return (n - cortadoAntes(cortes, n)) / taxa / velocidade
}

/** Os pedacos que ficam, em amostras. */
export function pedacosMantidos(cortes: readonly Corte[], amostras: number): Corte[] {
  const mantidos: Corte[] = []
  let cursor = 0
  for (const c of cortes) {
    if (c.de > cursor) mantidos.push({ de: cursor, ate: c.de })
    cursor = Math.max(cursor, c.ate)
  }
  if (cursor < amostras) mantidos.push({ de: cursor, ate: amostras })
  return mantidos
}

/**
 * Quanto o atempo ADIANTA o conteudo (o centro de cada som), medido em 15/10:
 * 7,5-9,3 ms de 1,05 a 1,25x, nas duas taxas, sem deriva (12-13 ms a 0,9x).
 */
export const ATRASO_DO_ATEMPO_SEC = 0.008

/** Amostras da narracao depois do pos: o que sobra do corte, na velocidade. E a conta t' = t/v ate o fim. */
export function amostrasDoPos(amostras: number, cortadas: number, velocidade: number): number {
  return Math.round((amostras - cortadas) / velocidade)
}

/**
 * O filtro do "acelerar": atempo (0,9-1,25 cabe num estagio so), o atraso que
 * centra o som na conta e o arquivo em EXATAS `saida` amostras (o atempo
 * devolve 17-28 ms a menos: o apad completa com silencio no fim, que e a
 * cauda calada do take, e o atrim corta o que o atraso empurrou para fora).
 */
export function filtroDeVelocidade(velocidade: number, taxa: number, saida: number): string {
  if (velocidade === 1) return 'anull'
  const atraso = Math.round(ATRASO_DO_ATEMPO_SEC * taxa)
  return `atempo=${velocidade.toFixed(4)},adelay=delays=${atraso}S:all=1,apad=whole_len=${saida},atrim=end_sample=${saida}`
}

/**
 * O filtro do ffmpeg: atrim de cada pedaco mantido (por amostra), rampa de
 * RAMPA_SEC nas pontas que viraram emenda, concat, e o "acelerar".
 */
export function filtroDoPos(cortes: readonly Corte[], amostras: number, taxa: number, velocidade: number): string {
  const mantidos = pedacosMantidos(cortes, amostras)
  const rampa = Math.round(RAMPA_SEC * taxa)
  const linhas: string[] = []
  const saidas = mantidos.map((_, i) => `[s${i}]`).join('')
  linhas.push(`[0:a]asplit=${mantidos.length}${saidas}`)
  for (const [i, m] of mantidos.entries()) {
    const cadeia = [`atrim=start_sample=${m.de}:end_sample=${m.ate}`, 'asetpts=PTS-STARTPTS']
    const tam = m.ate - m.de
    if (tam > 4 * rampa) {
      if (m.de > 0) cadeia.push(`afade=t=in:start_sample=0:nb_samples=${rampa}`)
      if (m.ate < amostras) cadeia.push(`afade=t=out:start_sample=${tam - rampa}:nb_samples=${rampa}`)
    }
    linhas.push(`[s${i}]${cadeia.join(',')}[k${i}]`)
  }
  const cortadas = cortes.reduce((s, c) => s + c.ate - c.de, 0)
  const tempo = filtroDeVelocidade(velocidade, taxa, amostrasDoPos(amostras, cortadas, velocidade))
  linhas.push(`${mantidos.map((_, i) => `[k${i}]`).join('')}concat=n=${mantidos.length}:v=0:a=1,${tempo}[saida]`)
  return linhas.join(';\n')
}

export interface ResultadoDoPos {
  pcm: Pcm
  cortes: Corte[]
  /** Segundos cortados do bruto (antes da velocidade). */
  cortado: number
  avisos: string[]
}

/** O recado das ilhas de fala sem palavra que o corte deixou de pe. */
function avisoDasIlhas(n: number): string | null {
  if (n === 0) return null
  return `${n} ${n === 1 ? 'trecho com som' : 'trechos com som'} sem palavra do roteiro numa pausa: ficou, sem corte.`
}

/**
 * Aplica o pos ao bruto (que ja esta no disco em `caminhoDoBruto`). Sem corte e
 * na velocidade 1, devolve o proprio bruto (sem ffmpeg).
 */
export async function aplicarPos(
  caminhoDoBruto: string,
  bruto: Pcm,
  palavras: readonly Pick<PalavraComTempo, 'start' | 'end'>[],
  opcoes: { cortarPausas: boolean; velocidade: number },
  signal?: AbortSignal,
  energia?: Energia,
): Promise<ResultadoDoPos> {
  const amostras = bruto.amostras.length
  const ilhas = { ilhas: 0 }
  const cortes = opcoes.cortarPausas ? cortesDasPausas(palavras, energia ?? medirEnergia(bruto), amostras, ilhas) : []
  const cortado = cortes.reduce((s, c) => s + c.ate - c.de, 0) / bruto.taxa
  const avisosDoCorte = [avisoDasIlhas(ilhas.ilhas)].filter((a): a is string => a !== null)
  if (cortes.length === 0 && opcoes.velocidade === 1) {
    return { pcm: { taxa: bruto.taxa, amostras: bruto.amostras.slice() }, cortes, cortado: 0, avisos: avisosDoCorte }
  }
  // O filtro vai num arquivo (-filter_complex_script): com muitas pausas ele
  // passaria do limite de linha de comando do Windows.
  const pasta = mkdtempSync(join(tmpdir(), 'anirecap-pos-'))
  try {
    const script = join(pasta, 'filtro.txt')
    writeFileSync(script, filtroDoPos(cortes, amostras, bruto.taxa, opcoes.velocidade), 'utf8')
    const saida = await rodarFfmpeg(
      ['-i', caminhoDoBruto, '-filter_complex_script', script, '-map', '[saida]', '-ar', String(bruto.taxa), ...SAIDA_WAV],
      signal,
    )
    const pcm = lerWav(saida)
    if (!pcm || pcm.amostras.length === 0) throw new Error('O pos da voz saiu vazio.')
    const avisos: string[] = [...avisosDoCorte]
    const esperado = (amostras - cortado * bruto.taxa) / opcoes.velocidade
    const diferenca = Math.abs(pcm.amostras.length - esperado) / bruto.taxa
    if (diferenca > TOLERANCIA_SEC) {
      avisos.push(`A narracao saiu ${(diferenca * 1000).toFixed(0)} ms diferente da conta (atempo).`)
    }
    return { pcm, cortes, cortado, avisos }
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}
