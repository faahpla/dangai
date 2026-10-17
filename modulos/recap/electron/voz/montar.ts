import {
  conferirTake,
  takeDaVozSchema,
  type ChamadaAoProvedor,
  type ConfigDaVoz,
  type OrigemDoAlinhamento,
  type PalavraComTempo,
  type TakeDaVoz,
  type TrechoDaFrase,
} from '../../shared/voz'
import {
  aplicarPos,
  encostarNoSom,
  fimDoSom,
  inicioDoSom,
  maiorTrechoCalado,
  medirEnergia,
  palavrasSuspeitas,
  remapear,
  type Energia,
} from './pos'
import { arrumarPalavras, trechosPelasPalavras, type FraseDoTrecho } from './palavras'
import { pastaDaVoz } from './pastas'
import { igualarVolume } from './volume'
import { duracaoDoPcm, gravarWavEnderecado, juntar, type Pcm } from './wav'

/**
 * MONTAR UM TAKE: bruto (PCM + palavras + trechos, no tempo do bruto) -> os
 * dois WAVs enderecados por conteudo -> o pos -> o TakeDaVoz conferido.
 *
 * E aqui tambem a EMENDA do "Regravar esta frase": o bruto novo e o bruto do
 * take atual com o pedaco de cada frase regravada trocado, na ordem do roteiro
 * atual. Como os trechos cobrem o bruto e as fronteiras caem no meio da pausa,
 * trocar um pedaco desloca o que vem depois pela diferenca EXATA de amostras.
 */

export interface BrutoMontado {
  pcm: Pcm
  /** Tempo no bruto, em ordem, sem sobreposicao. */
  palavras: PalavraComTempo[]
  /** Cobrem o bruto inteiro (fronteira no meio da pausa). */
  trechos: TrechoDaFrase[]
}

export interface DadosDoTake {
  config: ConfigDaVoz
  origem: OrigemDoAlinhamento
  qualidade: { ancoradas: number; total: number; score: number | null } | null
  caracteres: number
  cobrados: number
  chamadas: ChamadaAoProvedor[]
  roteiroVersao: number
  derivadoDe: string | null
  regravadas: string[]
  avisos: string[]
}

/** O id de verdade sai na hora de gravar (proximoTakeId com o rascunho relido). */
export const ID_PROVISORIO = 't0'

/**
 * O bruto de um audio inteiro (o take do provedor, o importado) pelo SOM: as
 * bordas de cada palavra encostadas no som e a fronteira de cada frase no meio
 * do maior silencio do vao (palavras.ts, pos.ts). Os avisos dizem as frases
 * cujo vao nao tem silencio nenhum.
 */
export function brutoPeloSom(
  pcm: Pcm,
  palavras: readonly PalavraComTempo[],
  frases: readonly FraseDoTrecho[],
): { bruto: BrutoMontado; avisos: string[] } {
  const energia = medirEnergia(pcm)
  const encostadas = encostarNoSom(palavras, energia)
  const semPausa: string[] = []
  const trechos = trechosPelasPalavras(encostadas, frases, pcm.amostras.length, pcm.taxa, energia, semPausa)
  const n = semPausa.length
  const avisos = n > 0 ? [`${n} ${n === 1 ? 'frase comeca' : 'frases comecam'} sem pausa antes no audio (${semPausa.join(', ')}).`] : []
  return { bruto: { pcm, palavras: encostadas, trechos }, avisos }
}

/**
 * A qualidade com a conferencia do SOM: as palavras suspeitas (palavrasSuspeitas)
 * saem das ancoradas e ficam contadas -- uma so ja deixa o alinhamento fraco na
 * tela, que pede confirmacao antes do "Aprovar voz".
 */
function qualidadeComOSom(q: DadosDoTake['qualidade'], total: number, suspeitas: number): TakeDaVoz['qualidade'] {
  if (!q) return suspeitas > 0 ? { ancoradas: Math.max(0, total - suspeitas), total, score: null, suspeitas } : null
  return { ...q, ancoradas: Math.max(0, Math.min(q.ancoradas, q.total - suspeitas)), suspeitas }
}

/**
 * bruto -> take. `signal` (opcional) mata o ffmpeg do pos; depois de uma
 * resposta paga quem chama nao passa o signal (o take tem que sair).
 *
 * As palavras do bruto passam por encostarNoSom aqui tambem (nao muda nada no
 * que ja passou por brutoPeloSom, e acerta os brutos de antes disto num ajuste),
 * e a narracao final sai no volume de referencia (volume.ts).
 */
export async function montarTake(
  rascunhoId: string,
  bruto: BrutoMontado,
  dados: DadosDoTake,
  signal?: AbortSignal,
): Promise<TakeDaVoz> {
  const pasta = pastaDaVoz(rascunhoId)
  const taxa = bruto.pcm.taxa
  const duracaoBruto = duracaoDoPcm(bruto.pcm)
  const energia = medirEnergia(bruto.pcm)
  const palavrasDoBruto = encostarNoSom(bruto.palavras, energia)
  const problemasDoBruto = conferirTake({ duracao: duracaoBruto, palavras: palavrasDoBruto, trechos: bruto.trechos })
  if (problemasDoBruto.length > 0) throw new Error(`O audio da voz nao fechou com o roteiro (${problemasDoBruto[0]}).`)
  const suspeitas = palavrasSuspeitas(palavrasDoBruto, energia)
  const arquivoBruto = gravarWavEnderecado(pasta, 'bruto', bruto.pcm)

  const pos = await aplicarPos(
    arquivoBruto.caminho,
    bruto.pcm,
    palavrasDoBruto,
    { cortarPausas: dados.config.cortarPausas, velocidade: dados.config.velocidade },
    signal,
    energia,
  )
  // O volume: ganho linear ate a referencia (nao mexe em tempo nenhum).
  const volume = await igualarVolume(pos.pcm, signal)
  const amostrasFinais = volume.pcm.amostras.length
  const duracao = amostrasFinais / taxa
  const v = dados.config.velocidade
  const mapa = (t: number): number => Math.min(duracao, Math.max(0, remapear(pos.cortes, taxa, v, t)))

  const palavras = arrumarPalavras(palavrasDoBruto.map((p) => ({ ...p, start: mapa(p.start), end: mapa(p.end) })))
  // As fronteiras do bruto (meio da pausa) pela mesma conta: a ordem nao muda,
  // entao cada palavra continua dentro do trecho dela.
  const fronteiras = [0]
  for (const tr of bruto.trechos.slice(1)) {
    fronteiras.push(Math.min(amostrasFinais, Math.max(fronteiras.at(-1)!, Math.round(mapa(tr.offset) * taxa))))
  }
  fronteiras.push(amostrasFinais)
  const trechos = bruto.trechos.map((tr, i) => ({
    ...tr,
    offset: fronteiras[i]! / taxa,
    duracao: (fronteiras[i + 1]! - fronteiras[i]!) / taxa,
  }))

  const arquivoNarracao = gravarWavEnderecado(pasta, 'narracao', volume.pcm)
  const n = suspeitas.length
  const avisoDasSuspeitas =
    n > 0
      ? [`${n} ${n === 1 ? 'palavra' : 'palavras'} com tempo que o som desmente (${suspeitas.slice(0, 6).map((i) => `"${palavrasDoBruto[i]!.texto}"`).join(', ')}${n > 6 ? '...' : ''}). Confira antes de aprovar.`]
      : []
  const take = takeDaVozSchema.parse({
    id: ID_PROVISORIO,
    config: dados.config,
    arquivo: arquivoNarracao.nome,
    duracao,
    palavras,
    trechos,
    bruto: { arquivo: arquivoBruto.nome, duracao: duracaoBruto, palavras: palavrasDoBruto, trechos: bruto.trechos },
    origemDoAlinhamento: dados.origem,
    qualidade: qualidadeComOSom(dados.qualidade, palavrasDoBruto.length, n),
    caracteres: dados.caracteres,
    cobrados: dados.cobrados,
    chamadas: dados.chamadas,
    criadoEm: new Date().toISOString(),
    roteiroVersao: dados.roteiroVersao,
    derivadoDe: dados.derivadoDe,
    regravadas: dados.regravadas,
    avisos: [...new Set([...dados.avisos, ...pos.avisos, ...avisoDasSuspeitas])],
    volume: volume.volume,
  })
  const problemas = conferirTake(take)
  if (problemas.length > 0) throw new Error(`A narracao montada nao fechou (${problemas[0]}).`)
  return take
}

// ------------------------------------------------------------------ emenda

/** Uma frase gerada sozinha, pronta para entrar no bruto. */
export interface PedacoNovo {
  pcm: Pcm
  /** Tempo NO PEDACO, so desta frase. */
  palavras: PalavraComTempo[]
}

/** Margem padrao antes/depois da fala numa frase que nao existia no take. */
const MARGEM_PADRAO_SEC = 0.2
/** Rampa nas emendas (no silencio). */
const RAMPA_SEC = 0.004
/** Ganho maximo para igualar o volume da frase nova ao take (+-6 dB). */
const GANHO_MAX = 2

/** Potencia media dos quadros com som (para igualar volume entre pedacos). */
function potenciaDaFala(pcm: Pcm, e: Energia, de = 0, ate = pcm.amostras.length): number {
  let soma = 0
  let n = 0
  const q0 = Math.floor(de / e.amostrasPorQuadro)
  const q1 = Math.ceil(ate / e.amostrasPorQuadro)
  for (let q = q0; q < q1 && q < e.db.length; q++) {
    if (e.db[q]! <= e.limiar) continue
    const p = 10 ** (e.db[q]! / 10)
    soma += p
    n++
  }
  return n > 0 ? soma / n : 0
}

function rampas(amostras: Int16Array, taxa: number, inicio: boolean, fim: boolean): void {
  const n = Math.min(Math.round(RAMPA_SEC * taxa), Math.floor(amostras.length / 4))
  for (let i = 0; i < n; i++) {
    const g = i / n
    if (inicio) amostras[i] = Math.round(amostras[i]! * g)
    if (fim) amostras[amostras.length - 1 - i] = Math.round(amostras[amostras.length - 1 - i]! * g)
  }
}

/**
 * `n` amostras do SILENCIO do proprio take, tiradas de [de, ate) em ciclo (o
 * ruido de sala a ~-60 dB repetido nao se ouve). Faixa vazia = zeros.
 */
function tomDaSala(pcm: Pcm, de: number, ate: number, n: number): Int16Array {
  const saida = new Int16Array(Math.max(0, n))
  const ini = Math.max(0, de)
  const tam = Math.min(pcm.amostras.length, ate) - ini
  if (tam <= 0) return saida
  for (let i = 0; i < saida.length; i++) saida[i] = pcm.amostras[ini + (i % tam)]!
  return saida
}

/**
 * Troca as corridas de ZERO DIGITAL (>= 1 ms) de [de, ate) pelo tom da sala:
 * o provedor manda o silencio da frase avulsa como zero exato, e no meio de um
 * take com chao de ruido isso e um buraco. So zero exato: respiracao e ruido
 * que o pedaco trouxe ficam.
 */
function preencherZeros(amostras: Int16Array, de: number, ate: number, tom: (n: number) => Int16Array, minimo: number): void {
  let i = Math.max(0, de)
  const fim = Math.min(amostras.length, ate)
  while (i < fim) {
    if (amostras[i] !== 0) {
      i++
      continue
    }
    const ini = i
    while (i < fim && amostras[i] === 0) i++
    if (i - ini >= minimo) amostras.set(tom(i - ini), ini)
  }
}

/** Funde `tom` em `amostras` a partir de `pos` (a rampa da emenda): o peso do tom desce de 1 a 0 (`tomSai`) ou sobe de 0 a 1. */
function fundir(amostras: Int16Array, pos: number, tom: Int16Array, tomSai: boolean): void {
  const n = tom.length
  for (let i = 0; i < n; i++) {
    const k = pos + i
    if (k < 0 || k >= amostras.length) continue
    const g = (i + 1) / (n + 1)
    const pesoDoTom = tomSai ? 1 - g : g
    amostras[k] = Math.round(amostras[k]! * (1 - pesoDoTom) + tom[i]! * pesoDoTom)
  }
}

function mediana(xs: number[], padrao: number): number {
  const v = xs.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)]! : padrao
}

/**
 * O bruto novo do "Regravar": `ordem` = as frases do roteiro ATUAL (as que a voz
 * fala, na ordem); `novos` = o pedaco de cada frase gerada agora. As outras saem
 * do bruto atual (o trecho inteiro, com a meia pausa de cada lado). Frase
 * removida do roteiro fica de fora.
 *
 * O pedaco novo e aparado as MESMAS margens do trecho que ele substitui (a
 * pausa antes e depois da fala), com o inicio/fim da fala achado pela energia
 * (nunca corta respiracao nem consoante), e o volume da fala igualado ao do
 * trecho antigo (+-6 dB).
 */
export function emendar(atual: BrutoMontado, ordem: readonly FraseDoTrecho[], novos: ReadonlyMap<string, PedacoNovo>): BrutoMontado {
  const taxa = atual.pcm.taxa
  const eAtual = medirEnergia(atual.pcm)
  const trechoAntigo = new Map(atual.trechos.map((t, i) => [t.fraseId, { t, i }]))
  const palavrasAntigas = new Map<string, PalavraComTempo[]>()
  for (const p of atual.palavras) {
    const l = palavrasAntigas.get(p.fraseId)
    if (l) l.push(p)
    else palavrasAntigas.set(p.fraseId, [p])
  }
  const margem = (t: TrechoDaFrase): { antes: number; depois: number } => {
    const ps = palavrasAntigas.get(t.fraseId) ?? []
    if (ps.length === 0) return { antes: MARGEM_PADRAO_SEC, depois: MARGEM_PADRAO_SEC }
    return { antes: ps[0]!.start - t.offset, depois: t.offset + t.duracao - ps.at(-1)!.end }
  }
  const margens = atual.trechos.map(margem)
  const antesPadrao = mediana(margens.map((m) => m.antes), MARGEM_PADRAO_SEC)
  const depoisPadrao = mediana(margens.map((m) => m.depois), MARGEM_PADRAO_SEC)
  const falaDoTake = potenciaDaFala(atual.pcm, eAtual)

  const pedacos: Int16Array[] = []
  const palavras: PalavraComTempo[] = []
  const trechos: TrechoDaFrase[] = []
  /** De onde cada pedaco veio: indice do trecho antigo, ou -1 (novo). */
  const origem: number[] = []
  let cursor = 0

  for (const f of ordem) {
    const novo = novos.get(f.fraseId)
    const antigo = trechoAntigo.get(f.fraseId)
    let amostras: Int16Array
    let deslocar: number
    let suas: PalavraComTempo[]
    if (novo) {
      if (novo.pcm.taxa !== taxa) throw new Error('A frase nova veio numa taxa diferente do take.')
      const m = antigo ? margem(antigo.t) : { antes: antesPadrao, depois: depoisPadrao }
      const e = medirEnergia(novo.pcm)
      const dur = duracaoDoPcm(novo.pcm)
      // As bordas no som: o provedor as vezes comeca a palavra dentro do silencio.
      const ps = encostarNoSom(novo.palavras, e)
      const falaIni = ps.length ? inicioDoSom(e, ps[0]!.start, 0) : 0
      const falaFim = ps.length ? fimDoSom(e, ps.at(-1)!.end, dur) : dur
      const de = Math.round((falaIni - Math.max(0, m.antes)) * taxa)
      const ate = Math.round((falaFim + Math.max(0, m.depois)) * taxa)
      amostras = new Int16Array(Math.max(0, ate - de))
      // Copia o que existe no pedaco; o que falta (margem maior que o silencio que veio) vem DEPOIS do ganho, do proprio take.
      const src0 = Math.max(0, de)
      const src1 = Math.min(novo.pcm.amostras.length, ate)
      if (src1 > src0) amostras.set(novo.pcm.amostras.subarray(src0, src1), src0 - de)
      // Volume da fala igual ao do trecho que sai (ou ao do take, numa frase nova).
      const alvo = antigo
        ? potenciaDaFala(atual.pcm, eAtual, Math.round(antigo.t.offset * taxa), Math.round((antigo.t.offset + antigo.t.duracao) * taxa))
        : falaDoTake
      const temos = potenciaDaFala(novo.pcm, e)
      if (alvo > 0 && temos > 0) {
        const ganho = Math.min(GANHO_MAX, Math.max(1 / GANHO_MAX, Math.sqrt(alvo / temos)))
        if (Math.abs(20 * Math.log10(ganho)) > 0.5) {
          for (let i = 0; i < amostras.length; i++) amostras[i] = Math.max(-32768, Math.min(32767, Math.round(amostras[i]! * ganho)))
        }
      }
      /*
       * O SILENCIO da frase nova vem do proprio take. Antes, a margem que o
       * pedaco nao trouxe (o provedor mandou menos silencio antes ou depois da
       * fala do que o trecho antigo tinha) ficava ZERO digital -- um buraco de
       * silencio absoluto no meio de um take com chao de ruido de ~-62 dB (331
       * ms no bruto do t2, 75 ms na narracao) --, e o silencio que o proprio
       * pedaco trouxe tambem vinha em zero exato. Agora:
       *   - a margem que falta e a do trecho antigo (as mesmas amostras que
       *     estavam la) ou, numa frase nova, a maior pausa do take, com rampa
       *     de 4 ms na juncao;
       *   - o zero exato que o pedaco trouxe fora da fala vira o mesmo tom.
       * Zero so fica onde o take tambem e zero.
       */
      const rampa = Math.max(1, Math.round(RAMPA_SEC * taxa))
      // A maior pausa do take: o tom de uma frase nova, ou quando a margem antiga e curta demais (alguns ms).
      const pausaDoTake = (): [number, number] => {
        const p = maiorTrechoCalado(eAtual, 0, duracaoDoPcm(atual.pcm))
        return p ? [Math.round(p.de * taxa), Math.round(p.ate * taxa)] : [0, 0]
      }
      let fonte0: [number, number]
      let fonte1: [number, number]
      if (antigo) {
        const ini = Math.round(antigo.t.offset * taxa)
        const fim = Math.round((antigo.t.offset + antigo.t.duracao) * taxa)
        const mAntigo = margem(antigo.t)
        fonte0 = [ini, ini + Math.round(Math.max(0, mAntigo.antes) * taxa)]
        fonte1 = [fim - Math.round(Math.max(0, mAntigo.depois) * taxa), fim]
        if (fonte0[1] - fonte0[0] < rampa) fonte0 = pausaDoTake()
        if (fonte1[1] - fonte1[0] < rampa) fonte1 = pausaDoTake()
      } else {
        fonte0 = pausaDoTake()
        fonte1 = fonte0
      }
      const falta0 = src0 - de
      const falta1 = ate - Math.max(src0, src1)
      // O zero exato que o pedaco trouxe antes e depois da fala (antes de a margem que falta entrar).
      const minimoDeZero = Math.max(1, Math.round(0.001 * taxa))
      preencherZeros(amostras, Math.max(0, falta0), Math.round(falaIni * taxa) - de, (n) => tomDaSala(atual.pcm, fonte0[0], fonte0[1], n), minimoDeZero)
      preencherZeros(amostras, Math.round(falaFim * taxa) - de, amostras.length - Math.max(0, falta1), (n) => tomDaSala(atual.pcm, fonte1[0], fonte1[1], n), minimoDeZero)
      if (falta0 > 0) {
        // Do COMECO da margem antiga: casa com o fim do trecho de antes, como era.
        const tom = tomDaSala(atual.pcm, fonte0[0], fonte0[1], falta0 + rampa)
        amostras.set(tom.subarray(0, Math.min(falta0, amostras.length)), 0)
        fundir(amostras, falta0, tom.subarray(falta0), true)
      }
      if (falta1 > 0) {
        // Do FIM da margem antiga: a ultima amostra casa com o comeco do trecho seguinte.
        const n = falta1 + rampa
        const tam = fonte1[1] - fonte1[0]
        const desloc = tam > 0 ? (((tam - (n % tam)) % tam) + tam) % tam : 0
        const tom = tomDaSala(atual.pcm, fonte1[0], fonte1[1], n + desloc).subarray(desloc)
        const comeco = amostras.length - falta1
        fundir(amostras, comeco - rampa, tom.subarray(0, rampa), false)
        amostras.set(tom.subarray(rampa, rampa + falta1), comeco)
      }
      deslocar = -de / taxa
      suas = ps
      origem.push(-1)
    } else {
      if (!antigo) throw new Error(`A frase ${f.fraseId} nao esta no take e nao foi gerada.`)
      const de = Math.round(antigo.t.offset * taxa)
      const ate = Math.round((antigo.t.offset + antigo.t.duracao) * taxa)
      amostras = atual.pcm.amostras.slice(de, ate)
      deslocar = -de / taxa
      suas = palavrasAntigas.get(f.fraseId) ?? []
      origem.push(antigo.i)
    }
    const offset = cursor / taxa
    for (const p of suas) {
      palavras.push({ ...p, fraseId: f.fraseId, start: p.start + deslocar + offset, end: p.end + deslocar + offset })
    }
    trechos.push({ fraseId: f.fraseId, offset, duracao: amostras.length / taxa, hashTexto: f.hash, texto: f.texto })
    pedacos.push(amostras)
    cursor += amostras.length
  }

  // Rampa nas emendas que nao existiam: um lado e novo, ou os dois nao eram vizinhos.
  for (let i = 0; i < pedacos.length; i++) {
    const emendaAntes = i > 0 && !(origem[i]! >= 0 && origem[i - 1]! >= 0 && origem[i]! === origem[i - 1]! + 1)
    const emendaDepois = i < pedacos.length - 1 && !(origem[i]! >= 0 && origem[i + 1]! >= 0 && origem[i + 1]! === origem[i]! + 1)
    rampas(pedacos[i]!, taxa, emendaAntes, emendaDepois)
  }

  const pcm: Pcm = { taxa, amostras: juntar(pedacos) }
  const duracao = pcm.amostras.length / taxa
  const arrumadas = arrumarPalavras(palavras).map((p) => ({ ...p, start: Math.min(p.start, duracao), end: Math.min(p.end, duracao) }))
  return { pcm, palavras: arrumadas, trechos }
}
