import type { EpisodeIndex, Plano } from './episodio'
import type { Frase } from './roteiro'
import type { TakeDaVoz } from './voz'
import {
  duracaoDaFrase,
  normalizarCortes,
  palavrasNaFrase,
  temposDasCenas,
  TOLERANCIA_DE_DURACAO_SEC,
  type CandidatoDeCena,
  type EscolhaDaFrase,
} from './cenas'

/**
 * O ENCAIXE de uma escolha de cena na duracao da frase (agente B).
 *
 * Puro: roda no main (encaixarNaVoz, montarProjeto) e no renderer (a tela de
 * Cenas encaixa na hora o candidato clicado, antes de salvarCenas). As regras
 * da decisao do Levi (14/10):
 *   - a duracao e a da frase NO TAKE (duracaoDaFrase com o take atual); sem
 *     take, a estimativa;
 *   - frase mais longa que a janela do candidato: span com o plano SEGUINTE do
 *     mesmo momento (planos consecutivos do indice), com aviso;
 *   - frase mais curta: a janela comeca no instante da fala citada
 *     (citacaoCueId), se houver; senao fica no comeco do plano;
 *   - 2+ cenas na frase: cada uma recebe o pedaco entre as palavras de inicio
 *     (temposDasCenas) e e encaixada no seu pedaco.
 *
 * COMO A CONTA E FEITA
 *   - o que conta e a COBERTURA: os segundos de imagem que os planos da janela
 *     tem de fato. Um vao entre dois planos do indice (cena tirada no corte)
 *     nao vira imagem -- trechosDoCandidato pula o vao, e a montagem poe os
 *     pedacos em fila. Por isso a janela [inSec, outSec] pode ser mais longa
 *     que a frase, nunca a imagem;
 *   - o comeco preferido e a fala citada, quando ela cai nos planos do
 *     candidato; senao o inSec que ja veio (o comeco do plano no candidato
 *     padrao, ou o momento que o casar escolheu). Candidato posto a mao
 *     ('usuario') guarda o comeco dele;
 *   - a frase cabe nos planos do candidato: a janela fica neles, recuando o
 *     comeco so o necessario (a fala citada continua dentro). Nao cabe: entra o
 *     plano SEGUINTE do indice (o corte original do episodio), ate SPAN_MAX
 *     planos; no fim do episodio ou na OP/ED, o ANTERIOR; e se ainda faltar, a
 *     cena fica curta e o editor segura o ultimo quadro (aviso);
 *   - falta pequena (ate FOLGA_SEM_EMENDA_SEC) nao vira emenda: alguns quadros
 *     segurados nao se veem, e um relance de 3 quadros de outro plano se ve;
 *   - plano na OP/ED (o meio dele numa exclusao, sugerida ou confirmada, a
 *     mesma regra de cuesElegiveis) nunca entra sozinho numa emenda;
 *   - e IDEMPOTENTE: encaixar de novo com o mesmo take devolve a mesma
 *     escolha, e com outro take parte da janela que ja estava (o comeco
 *     escolhido fica), crescendo ou encolhendo so o fim.
 */

/** Ate quantos planos uma emenda junta (a montagem original de 2 a 3 planos, com folga). */
export const SPAN_MAX_PLANOS = 4

/** Falta de imagem que se resolve segurando o ultimo quadro, sem emendar outro plano (6 quadros). */
export const FOLGA_SEM_EMENDA_SEC = 0.25

/**
 * Pedaco de emenda mais curto que isto passa como um RELANCE: e o mesmo
 * limite do "Bloco N tem 0.3s e vai passar como um flash" do preflight do
 * editor (BLOCO_CURTO_SEC). Visto no 1o short de ponta a ponta (14/10): uma
 * frase 0,3 s mais longa que o plano emendava 0,3 s do seguinte.
 */
export const PEDACO_MINIMO_DA_EMENDA_SEC = 0.8

/**
 * Ate quanto de falta o encaixe prefere recuar o comeco / segurar o ultimo
 * quadro a emendar um relance de outro plano (12 quadros: com o Ken Burns
 * andando, nao se nota; o relance se nota).
 */
export const SEGURAR_EM_VEZ_DE_RELANCE_SEC = 0.5

/** Recados que ficam NA ESCOLHA (o cartao da frase mostra). */
export const AVISO_CENA_EMENDADA = 'Cena emendada'
export const AVISO_CENA_CURTA = 'Cena curta'
export const AVISO_CENA_FORA = 'Cena fora do episodio'

export interface ContextoDoEncaixe {
  indice: Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'>
  frase: Pick<Frase, 'id' | 'texto' | 'citacaoCueId' | 'cueDoMomento' | 'eventoIds'>
  /** O take atual (takeAtual do rascunho). null = sem voz: encaixa pela estimativa. */
  take: Pick<TakeDaVoz, 'id' | 'trechos' | 'palavras'> | null
}

export interface EscolhaEncaixada {
  escolha: EscolhaDaFrase
  /** Recados ASCII para a tela e para o retorno do IPC ("f07: cena emendada"). */
  avisos: string[]
}

export function encaixarEscolha(escolha: EscolhaDaFrase, ctx: ContextoDoEncaixe): EscolhaEncaixada {
  const d = duracaoDaFrase(ctx.frase, ctx.take)
  const corrigida = normalizarCortes(escolha, palavrasNaFrase(ctx.frase.texto))
  const tempos = temposDasCenas(corrigida, ctx.frase, ctx.take)
  const daEscolha = new Set<string>()
  const avisos: string[] = []
  const cenas = corrigida.cenas.map((cena, k) => {
    const t = tempos[k]
    const precisa = t ? t.fim - t.inicio : 0
    const feito = encaixarCandidato(cena.candidato, precisa, ctx)
    for (const a of feito.avisos) {
      daEscolha.add(a.curto)
      avisos.push(`${ctx.frase.id}: ${a.longo}`)
    }
    return { ...cena, candidato: feito.candidato }
  })
  // Os recados do encaixe sao refeitos aqui; os do casar ("Trecho sem cenas no
  // indice") ficam -- falam do momento da frase, que o encaixe nao muda.
  const doEncaixe = new Set<string>([AVISO_CENA_EMENDADA, AVISO_CENA_CURTA, AVISO_CENA_FORA])
  const doCasar = corrigida.avisos.filter((a) => !doEncaixe.has(a))
  return {
    escolha: { ...corrigida, cenas, duracao: d.duracao, avisos: [...new Set([...doCasar, ...daEscolha])] },
    avisos,
  }
}

// ------------------------------------------------------------ um candidato

interface AvisoDoEncaixe {
  curto: string
  longo: string
}

/** O plano esta na OP/ED (ou outra exclusao): o meio dele cai num trecho excluido. */
export function planoExcluido(
  plano: Pick<Plano, 'start' | 'end'>,
  exclusoes: EpisodeIndex['exclusoes'],
): boolean {
  const meio = (plano.start + plano.end) / 2
  return exclusoes.some((e) => meio >= e.start && meio < e.end)
}

/** Segundos de imagem dos planos [a..b] a partir de `inicio` (vaos entre planos nao contam). */
function cobertura(planos: readonly Plano[], a: number, b: number, inicio: number): number {
  let soma = 0
  for (let i = a; i <= b; i++) {
    const p = planos[i]!
    soma += Math.max(0, p.end - Math.max(p.start, inicio))
  }
  return soma
}

/** O fim da janela que da `precisa` segundos de imagem a partir de `inicio`, andando pelos planos [a..b]. */
function fimPelaCobertura(planos: readonly Plano[], a: number, b: number, inicio: number, precisa: number): number {
  let acumulado = 0
  for (let i = a; i <= b; i++) {
    const p = planos[i]!
    const de = Math.max(p.start, inicio)
    const tem = p.end - de
    if (tem <= 0) continue
    if (acumulado + tem >= precisa) return de + (precisa - acumulado)
    acumulado += tem
  }
  return planos[b]!.end
}

/** O comeco da janela que da `precisa` segundos de imagem terminando no fim de b, andando para tras ate a. */
function inicioPelaCobertura(planos: readonly Plano[], a: number, b: number, precisa: number): number {
  let acumulado = 0
  for (let i = b; i >= a; i--) {
    const p = planos[i]!
    const tem = p.end - p.start
    if (acumulado + tem >= precisa) return p.end - (precisa - acumulado)
    acumulado += tem
  }
  return planos[a]!.start
}

function segundos(s: number): string {
  return `${s.toFixed(1).replace('.', ',')}s`
}

function encaixarCandidato(
  c: CandidatoDeCena,
  precisaBruto: number,
  ctx: ContextoDoEncaixe,
): { candidato: CandidatoDeCena; avisos: AvisoDoEncaixe[] } {
  const planos = ctx.indice.planos
  const pos = new Map(planos.map((p, i) => [p.id, i]))
  const posicoes = c.planoIds.map((id) => pos.get(id)).filter((i): i is number => i !== undefined)
  if (posicoes.length === 0) {
    // Plano que o indice nao conhece (indice refeito, biblioteca trocada): nao
    // ha como medir nada. A cena fica como estava, com o aviso.
    return {
      candidato: c,
      avisos: [{ curto: AVISO_CENA_FORA, longo: 'a cena nao esta mais no episodio' }],
    }
  }

  // Um quadro no minimo: o schema recusa janela vazia, e cena de zero segundo
  // nao existe no editor.
  const precisa = Math.max(precisaBruto, TOLERANCIA_DE_DURACAO_SEC)
  let a = Math.min(...posicoes)
  let b = Math.max(...posicoes)
  const livre = (i: number): boolean => {
    const p = planos[i]
    return p !== undefined && !planoExcluido(p, ctx.indice.exclusoes)
  }

  // O comeco preferido: a fala citada dentro dos planos do candidato; senao o
  // inSec que veio. Posto a mao, o comeco e dele.
  const citada = ctx.frase.citacaoCueId ? ctx.indice.cues.find((q) => q.id === ctx.frase.citacaoCueId) : undefined
  const citacaoDentro =
    citada !== undefined && citada.start >= planos[a]!.start - 1e-6 && citada.start < planos[b]!.end
  const preferido = c.origem !== 'usuario' && citacaoDentro ? citada.start : c.inSec
  let inicio = Math.min(Math.max(preferido, planos[a]!.start), planos[b]!.end)

  if (cobertura(planos, a, b, inicio) < precisa - TOLERANCIA_DE_DURACAO_SEC) {
    if (cobertura(planos, a, b, planos[a]!.start) >= precisa - FOLGA_SEM_EMENDA_SEC) {
      // Cabe (ou quase) nos planos do candidato: recua o comeco so o
      // necessario; a fala citada continua dentro da janela.
      inicio = Math.max(planos[a]!.start, Math.min(inicio, inicioPelaCobertura(planos, a, b, precisa)))
    } else {
      // Nao cabe: o plano seguinte do episodio, como a montagem original...
      while (
        cobertura(planos, a, b, inicio) < precisa - FOLGA_SEM_EMENDA_SEC &&
        b - a + 1 < SPAN_MAX_PLANOS &&
        livre(b + 1)
      ) {
        b += 1
      }
      // ...e, no fim do episodio ou na porta da OP/ED, o anterior.
      while (
        cobertura(planos, a, b, inicio) < precisa - FOLGA_SEM_EMENDA_SEC &&
        b - a + 1 < SPAN_MAX_PLANOS &&
        livre(a - 1)
      ) {
        a -= 1
        inicio = Math.max(planos[a]!.start, inicioPelaCobertura(planos, a, b, precisa))
      }
    }
  }

  let fim = Math.max(fimPelaCobertura(planos, a, b, inicio, precisa), inicio + TOLERANCIA_DE_DURACAO_SEC)

  // So os planos que a janela toca de fato (encolher a frase solta a emenda).
  const tocados: number[] = []
  for (let i = a; i <= b; i++) {
    const p = planos[i]!
    if (Math.min(p.end, fim) - Math.max(p.start, inicio) > 1e-6) tocados.push(i)
  }
  // Emenda sem relance: nenhum pedaco de plano curto demais (pecas puras abaixo).
  const ajuste = semRelance(planos, tocados.length > 0 ? tocados : [a], inicio, fim, precisa)
  const usados = ajuste.usados
  inicio = ajuste.inicio
  fim = ajuste.fim
  const ua = usados[0]!
  const ub = usados[usados.length - 1]!
  const falta = precisa - cobertura(planos, ua, ub, inicio) + Math.max(0, cobertura(planos, ua, ub, fim))
  const primeiro = planos[ua]!

  const avisos: AvisoDoEncaixe[] = []
  if (usados.length > 1) {
    avisos.push({ curto: AVISO_CENA_EMENDADA, longo: `cena emendada com ${usados.length - 1} plano(s) do episodio` })
  }
  // A falta que o semRelance escolheu segurar (no maximo SEGURAR_EM_VEZ_DE_RELANCE_SEC) nao e aviso.
  if (falta > Math.max(FOLGA_SEM_EMENDA_SEC, ajuste.segurado + 1e-6)) {
    avisos.push({ curto: AVISO_CENA_CURTA, longo: `cena curta, falta ${segundos(falta)} de imagem` })
  }

  return {
    candidato: {
      ...c,
      planoIds: usados.map((i) => planos[i]!.id),
      inSec: inicio,
      outSec: fim,
      keyframe: primeiro.keyframe,
    },
    avisos,
  }
}

// ------------------------------------------------------------ sem relance

/** O pedaco de cada plano da janela, em segundos de imagem. */
function pedacoNoPlano(p: Plano, inicio: number, fim: number): number {
  return Math.max(0, Math.min(p.end, fim) - Math.max(p.start, inicio))
}

/**
 * Uma emenda cujo primeiro ou ultimo pedaco ficaria mais curto que
 * PEDACO_MINIMO_DA_EMENDA_SEC (um relance de outro plano):
 * - ULTIMO pedaco curto: sem o ultimo plano, a frase cabe nos outros
 *   recuando o comeco e segurando no maximo SEGURAR_EM_VEZ_DE_RELANCE_SEC?
 *   Entao sai o plano (a fala citada continua dentro: so recua). Senao a
 *   janela anda para frente o que falta para o ultimo pedaco ter o minimo,
 *   se o primeiro continuar com o minimo;
 * - PRIMEIRO pedaco curto (comeco perto do fim do plano, ou o anterior que
 *   entrou na porta da OP/ED): sai o plano, e o fim anda o mesmo tanto se o
 *   ultimo plano tiver imagem; senao segura, se for pouco.
 * Sem saida boa, fica como estava (o editor avisa o flash). Idempotente: o
 * resultado nao tem relance, e encaixar de novo cai no mesmo caminho.
 */
function semRelance(
  planos: readonly Plano[],
  usadosIniciais: readonly number[],
  inicioInicial: number,
  fimInicial: number,
  precisa: number,
): { usados: number[]; inicio: number; fim: number; segurado: number } {
  let usados = [...usadosIniciais]
  let inicio = inicioInicial
  let fim = fimInicial
  let segurado = 0
  const minimo = PEDACO_MINIMO_DA_EMENDA_SEC

  if (usados.length > 1) {
    const ultimo = planos[usados[usados.length - 1]!]!
    const pl = pedacoNoPlano(ultimo, inicio, fim)
    if (pl < minimo) {
      const resto = usados.slice(0, -1)
      const ra = resto[0]!
      const rb = resto[resto.length - 1]!
      const daComeco = cobertura(planos, ra, rb, planos[ra]!.start)
      if (precisa - daComeco <= SEGURAR_EM_VEZ_DE_RELANCE_SEC) {
        usados = resto
        inicio = Math.max(planos[ra]!.start, Math.min(inicio, inicioPelaCobertura(planos, ra, rb, precisa)))
        fim = planos[rb]!.end
        segurado = Math.max(0, precisa - cobertura(planos, ra, rb, inicio))
      } else {
        const delta = minimo - pl
        const pf = pedacoNoPlano(planos[usados[0]!]!, inicio, fim)
        if (pf - delta >= minimo && fim + delta <= ultimo.end + 1e-9) {
          inicio += delta
          fim += delta
        }
      }
    }
  }

  if (usados.length > 1) {
    const p0 = planos[usados[0]!]!
    const pf = pedacoNoPlano(p0, inicio, fim)
    if (pf < minimo) {
      const ultimo = planos[usados[usados.length - 1]!]!
      const resto = usados.slice(1)
      const comecoDoResto = planos[resto[0]!]!.start
      if (fim + pf <= ultimo.end + 1e-9) {
        usados = resto
        inicio = comecoDoResto
        fim += pf
      } else if (pf <= SEGURAR_EM_VEZ_DE_RELANCE_SEC) {
        usados = resto
        inicio = comecoDoResto
        segurado = Math.max(segurado, pf)
      }
    }
  }

  return { usados, inicio, fim, segurado }
}
