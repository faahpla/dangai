import { z } from 'zod'
import type { EpisodeIndex, Plano } from './episodio'
// So TIPOS de roteiro.ts: roteiro.ts importa o estadoDasCenasSchema daqui (a
// seta de valor e uma so, roteiro -> cenas, como roteiro -> voz).
import type { Frase, RascunhoDoRecap, Redivisao, Roteiro } from './roteiro'
import { hashDoTexto, palavrasDaFrase, type TakeDaVoz } from './voz'
// edicao-rapida.ts so importa VALORES de contract.ts (sem ciclo com roteiro).
import { configDaEdicaoRapidaSchema, type ResumoDaEdicaoRapida } from './edicao-rapida'

/**
 * AS CENAS, do jeito que o Studio as entende: o contrato do passo 4 do
 * assistente "Gerar recap" (Episodio -> Roteiro -> Voz -> Cenas -> Editor).
 *
 * Fonte unica da verdade para os quatro lados que mexem nelas:
 *   - o CASAR (electron/services/cenas/*, agente A): sugere a fita de cada
 *     frase, de graca, assim que o roteiro e aprovado e os planos existem;
 *   - o ENCAIXE e a MONTAGEM (shared/encaixe.ts, electron/services/montar/*,
 *     agente B): encaixa cada cena na duracao REAL da frase no take aprovado
 *     e monta o .anirecap;
 *   - a TELA de Cenas (src/components/gerar/*Cenas*, src/store/gerar-cenas.ts,
 *     agente C): mostra, troca, poe 2+ cenas numa frase, move a barrinha;
 *   - o ROTEIRO em texto (agente D): re-dividir o roteiro leva as escolhas das
 *     frases que nao mudaram (cenasDepoisDaRedivisao).
 *
 * O caminho: frase do roteiro APROVADO -> EscolhaDaFrase (a fita de ate 6
 * candidatos + a(s) cena(s) escolhida(s), cada uma comecando numa palavra) ->
 * gravado no rascunho do recap (`cenas`, rascunho v3) -> encaixado no take
 * aprovado (`takeId`) -> o projeto.
 *
 * TEMPO
 *   - inSec/outSec de um candidato sao segundos de REPRODUCAO do .mkv, a mesma
 *     base do indice (shared/episodio.ts). O mp4 de um plano comeca em
 *     plano.start: o ponto dentro do arquivo e `t - plano.start`
 *     (trechosDoCandidato faz a conta).
 *   - a duracao de uma frase e a do TRECHO dela no take (voz.ts: os trechos
 *     cobrem o arquivo inteiro, fronteira no meio da pausa). Somando as cenas
 *     de todas as frases da a narracao inteira, sem buraco.
 *   - dentro da frase, a cena k comeca na palavra `palavraInicio` (indice em
 *     palavrasDaFrase(frase.texto), que e o mesmo tokenizeScript das palavras
 *     do take). A primeira cena comeca no inicio do trecho, nunca na primeira
 *     palavra: assim a pausa de antes ja tem imagem.
 *
 * REGRAS DURAS
 *   1. Um candidato e 1+ planos CONSECUTIVOS do indice (o span: a montagem
 *      original do episodio quando a frase e mais longa que o plano).
 *   2. Nada de tempo vindo de LLM: a janela sai do indice (planos e cues).
 *   3. `travada` = o usuario escolheu ou mexeu: sugerir de novo nunca troca.
 *   4. Escolha guarda o hash do texto e a duracao com que foi feita: quem diz
 *      se ficou velha e escolhasDesatualizadas, nunca um "dirty" solto.
 *
 * Os tipos saem de z.infer, como em roteiro.ts. channels.ts so importa TIPOS
 * daqui (o preload fica pequeno). Funcoes puras: rodam igual no main e no
 * renderer.
 */

/** Sobe quando a forma do EstadoDasCenas muda de um jeito que o leitor antigo nao entende. */
export const CENAS_VERSAO = 1 as const

/** Ate quantos candidatos a fita de uma frase guarda. */
export const FITA_MAX = 6

/** Ate quantos termos curtos no "porque" de um candidato ("fala citada", "Senku", "no evento"). */
export const PORQUE_MAX = 4

/**
 * Recados do CASAR que ficam na escolha (o cartao da frase mostra). Os do
 * encaixe moram em encaixe.ts; o encaixe troca os dele e guarda estes.
 * - trecho sem cenas: o indice nao cobre o momento da frase (o Corte Cenas do
 *   S4 - 37 so vai de 1:28 a 22:30), e a cena e a mais perto que existe;
 * - longe do momento: a cena sugerida ficou a mais de 20 s do evento.
 */
export const AVISO_TRECHO_SEM_CENAS = 'Trecho sem cenas no indice'
export const AVISO_LONGE_DO_MOMENTO = 'Longe do momento'

/**
 * Ritmo estimado da narracao, ANTES de haver take: o mesmo PALAVRAS_POR_SEGUNDO
 * de roteiro.ts (2,7). Repetido aqui de proposito: este arquivo so importa
 * TIPOS de roteiro.ts, para nao haver ciclo de valor.
 */
export const PALAVRAS_POR_SEGUNDO_ESTIMADA = 2.7

/**
 * Diferenca de duracao que ainda conta como "a mesma" (1 quadro a 23,976 fps).
 * Acima disso a frase foi regravada ou o take mudou: o encaixe e refeito.
 */
export const TOLERANCIA_DE_DURACAO_SEC = 0.042

// ------------------------------------------------------------------ schemas

const episodioIdSchema = z.string().regex(/^ep_[0-9a-f]{40}$/)
const fraseIdSchema = z.string().regex(/^f\d{2,}$/)
const takeIdSchema = z.string().regex(/^t\d+$/)

/**
 * De onde veio o candidato:
 * - sugestao: a fita do casar (pontuado, com porque);
 * - vizinha: plano perto do momento da frase ("Perto deste momento");
 * - busca: achado pelo filtro de personagem ou pela busca da tela;
 * - usuario: posto a mao (arrastado, ou a janela ajustada por ele).
 */
export const origemDoCandidatoSchema = z.enum(['sugestao', 'vizinha', 'busca', 'usuario'])
export type OrigemDoCandidato = z.infer<typeof origemDoCandidatoSchema>

/** Um candidato a cena de uma frase: 1+ planos consecutivos e a janela dentro deles. */
export const candidatoDeCenaSchema = z
  .object({
    /** Ids dos planos do indice (Plano.id), CONSECUTIVOS e em ordem. Mais de um = span. */
    planoIds: z.array(z.string().min(1)).min(1),
    episodioId: episodioIdSchema,
    /** Inicio da janela, segundos do .mkv. Dentro de [primeiro.start, ultimo.end]. */
    inSec: z.number().nonnegative(),
    /** Fim da janela, segundos do .mkv. > inSec. */
    outSec: z.number().nonnegative(),
    /** Pontuacao do casar. So compara candidatos da MESMA frase (escala livre). */
    nota: z.number(),
    /** Ate 4 termos curtos, ASCII, para o cartao: "fala citada", "Senku", "no evento". */
    porque: z.array(z.string().min(1).max(32)).max(PORQUE_MAX),
    origem: origemDoCandidatoSchema,
    /**
     * Caminho absoluto do keyframe do PRIMEIRO plano (Plano.keyframe), so para
     * referencia: a tela publica as miniaturas por id (miniaturasDasCenas),
     * porque URL do servidor local morre com a sessao.
     */
    keyframe: z.string().nullable(),
  })
  .refine((c) => c.outSec > c.inSec, { message: 'janela vazia ou invertida', path: ['outSec'] })
export type CandidatoDeCena = z.infer<typeof candidatoDeCenaSchema>

/** Uma cena dentro da frase: o candidato escolhido e a palavra em que ela entra. */
export const cenaDaFraseSchema = z.object({
  candidato: candidatoDeCenaSchema,
  /**
   * Indice da palavra (palavrasDaFrase(frase.texto), 0 = a primeira) em que a
   * cena comeca: a barrinha rosa do Dangai. A primeira cena e sempre 0; as
   * outras sobem estritamente.
   */
  palavraInicio: z.number().int().nonnegative(),
})
export type CenaDaFrase = z.infer<typeof cenaDaFraseSchema>

/** O que a frase mostra: a(s) cena(s) e a fita de onde elas sairam. */
export const escolhaDaFraseSchema = z
  .object({
    fraseId: fraseIdSchema,
    /** Na ordem em que entram. Vazio = frase sem cena (fita vazia, ou o usuario tirou). */
    cenas: z.array(cenaDaFraseSchema),
    /** Os melhores candidatos (ate 6), do melhor ao pior. Trocar a cena nao mexe na fita. */
    fita: z.array(candidatoDeCenaSchema).max(FITA_MAX),
    /** 0..1: a margem do 1o para o 2o da fita. Baixa = destaque na tela. */
    confianca: z.number().min(0).max(1),
    /** O usuario escolheu ou mexeu: sugerirCenas nao troca mais (regra dura 3). */
    travada: z.boolean(),
    /** hashDoTexto do texto da frase quando a escolha foi feita. */
    hashTexto: z.string().regex(/^[0-9a-f]{16}$/),
    /** Segundos que a frase durava no ultimo encaixe (take ou estimativa). */
    duracao: z.number().nonnegative(),
    /** Recados curtos, ASCII: "Cena emendada", "Cena curta". */
    avisos: z.array(z.string()).default([]),
    /**
     * O casar DIVIDIU a frase sozinho (2 cenas, raramente 3: shared/divisao.ts):
     * a fita da frase inteira, do jeito que seria com uma cena so. E o "Juntar
     * em 1" da tela (juntarEmUma). Ausente = a frase nao foi dividida pelo casar.
     */
    inteira: z.array(candidatoDeCenaSchema).max(FITA_MAX).optional(),
  })
  .superRefine((e, ctx) => {
    for (const [i, c] of e.cenas.entries()) {
      const anterior = e.cenas[i - 1]
      if (i === 0 && c.palavraInicio !== 0) {
        ctx.addIssue({ code: 'custom', path: ['cenas', i, 'palavraInicio'], message: 'a primeira cena comeca na palavra 0' })
      }
      if (anterior && c.palavraInicio <= anterior.palavraInicio) {
        ctx.addIssue({ code: 'custom', path: ['cenas', i, 'palavraInicio'], message: 'palavraInicio fora de ordem' })
      }
    }
  })
export type EscolhaDaFrase = z.infer<typeof escolhaDaFraseSchema>

/**
 * O que o passo 4 guarda no rascunho do recap (RascunhoDoRecap.cenas, v3).
 * null no rascunho = nunca sugeridas (e o que um rascunho v1/v2 le).
 */
export const estadoDasCenasSchema = z
  .object({
    versao: z.literal(CENAS_VERSAO).default(CENAS_VERSAO),
    /** Uma por frase, na ordem do roteiro. Frase sem escolha = ainda nao sugerida. */
    escolhas: z.array(escolhaDaFraseSchema),
    /** ISO da ultima sugerirCenas. null = nunca. */
    sugeridasEm: z.string().nullable(),
    /** Roteiro.versao sobre a qual as escolhas foram feitas. So informativo (quem decide e o hash). */
    roteiroVersao: z.number().int().positive().nullable(),
    /** O take em que o encaixe foi feito. null = encaixe pela estimativa (sem voz ainda). */
    takeId: takeIdSchema.nullable(),
    /** ISO do ultimo encaixarNaVoz. null = nunca encaixado. */
    encaixadoEm: z.string().nullable().default(null),
  })
  .superRefine((c, ctx) => {
    const vistas = new Set<string>()
    for (const [i, e] of c.escolhas.entries()) {
      if (vistas.has(e.fraseId)) {
        ctx.addIssue({ code: 'custom', path: ['escolhas', i, 'fraseId'], message: `escolha repetida: ${e.fraseId}` })
      }
      vistas.add(e.fraseId)
    }
  })
export type EstadoDasCenas = z.infer<typeof estadoDasCenasSchema>

export const CENAS_VAZIAS: EstadoDasCenas = {
  versao: CENAS_VERSAO,
  escolhas: [],
  sugeridasEm: null,
  roteiroVersao: null,
  takeId: null,
  encaixadoEm: null,
}

// ------------------------------------------------------- pedidos (IPC, zod)

/**
 * Os filtros da grade da tela de Cenas. Tudo opcional: sem filtro, a grade e a
 * fita + as vizinhas do momento + o resto do episodio (fora OP/ED).
 */
export const filtrosDeCandidatosSchema = z.object({
  /** So planos com este personagem (reconhecido ou falante). null = todos. */
  personagem: z.string().max(120).nullable().optional(),
  /** Texto livre: fala, falante, descricao. null = sem busca. */
  busca: z.string().max(200).nullable().optional(),
  /** "Perto deste momento" a partir DESTE plano (Plano.id). null = do momento da frase. */
  vizinhasDe: z.string().max(32).nullable().optional(),
})
export type FiltrosDeCandidatos = z.infer<typeof filtrosDeCandidatosSchema>

export const listaDeEscolhasSchema = z.array(escolhaDaFraseSchema)

/** O "Abrir no editor". `pasta` null/ausente = a pasta padrao do projeto (o main decide). */
export const pedidoDeMontagemSchema = z.object({
  pasta: z.string().min(1).max(1024).nullable().optional(),
  /**
   * A EDICAO RAPIDA junto da montagem (shared/edicao-rapida.ts): o projeto ja
   * chega com SFX, musica, rosto e legenda. null/ausente = a montagem de
   * sempre (o rosto pelo detector antigo). O estilo salvo da legenda entra nos
   * dois casos: e o padrao de projeto novo, como no Dangai.
   */
  edicaoRapida: configDaEdicaoRapidaSchema.nullable().optional(),
  /**
   * [recap] O que e do NUCLEO e a montagem precisa: o estilo de legenda salvo
   * (settings.captionStyle) e os presets de cor (settings.presetsDeCor). A
   * tela le das Configuracoes publicas e manda; o main do modulo nao le o
   * settings do nucleo. Conferidos no main (captionStyleSchema, presetsDeCorConferidos).
   */
  estilo: z.unknown().optional(),
  presetsDeCor: z.array(z.unknown()).max(200).optional(),
})
export type PedidoDeMontagem = z.infer<typeof pedidoDeMontagemSchema>

// --------------------------------------------------- respostas (main -> tela)

/** A grade da tela de Cenas para UMA frase. */
export interface CandidatosDaFrase {
  fraseId: string
  /** A fita da frase ("Sugestoes para este trecho"), do melhor ao pior, com o porque. */
  sugestoes: CandidatoDeCena[]
  /** Planos perto do momento da frase (ou de `vizinhasDe`), na ordem do episodio. */
  vizinhas: CandidatoDeCena[]
  /** O resto do episodio que passa nos filtros (fora OP/ED), na ordem do episodio. */
  outras: CandidatoDeCena[]
  /** Personagens do episodio para o filtro, do mais frequente ao menos. */
  personagens: { nome: string; cenas: number }[]
  /** O momento da frase no episodio (segundos do .mkv). null = frase sem evento. */
  momento: number | null
}

/** O que sugerirCenas / salvarCenas / encaixarNaVoz devolvem. */
export interface CenasGravadas {
  /** O rascunho INTEIRO como ficou no disco (a tela troca o dela por ele). */
  rascunho: RascunhoDoRecap
  /** Recados ASCII ("3 frases sem cena no episodio", "Cena emendada em f07"). */
  avisos: string[]
}

/** O que montarProjeto devolve: o .dangai gravado, pronto para o openProject do nucleo. */
export interface ProjetoMontado {
  projetoPath: string
  avisos: string[]
  /** O que a Edicao rapida fez. Ausente/null = montagem sem ela. */
  edicaoRapida?: ResumoDaEdicaoRapida | null
}

/** O andamento do "Abrir no editor" (main -> renderer): o rodape do passo 4 mostra o texto. */
export interface EtapaDaMontagem {
  rascunhoId: string
  /** ASCII curto ("Rostos, sons e musica...", "Gravando o projeto..."). */
  texto: string
}

// ============================================================ funcoes puras

/** As frases do roteiro, na ordem da narracao. */
export function frasesDoRoteiro(roteiro: Pick<Roteiro, 'secoes'>): Frase[] {
  return roteiro.secoes.flatMap((s) => s.frases)
}

/** O estado das cenas do rascunho (CENAS_VAZIAS quando nunca sugeridas). */
export function cenasDoRascunho(r: { cenas?: EstadoDasCenas | null }): EstadoDasCenas {
  return r.cenas ?? CENAS_VAZIAS
}

export function escolhaDaFrase(cenas: Pick<EstadoDasCenas, 'escolhas'>, fraseId: string): EscolhaDaFrase | null {
  return cenas.escolhas.find((e) => e.fraseId === fraseId) ?? null
}

/** Quantas palavras a frase tem, como a legenda e o take contam. */
export function palavrasNaFrase(texto: string): number {
  return palavrasDaFrase(texto).length
}

export interface DuracaoDaFrase {
  /** Segundos que a frase ocupa na narracao. */
  duracao: number
  /** true = do trecho do take (tempo real); false = estimada pelas palavras. */
  real: boolean
  /** Onde o trecho comeca no arquivo do take. null na estimada. */
  offset: number | null
}

/**
 * Quanto a frase dura: o TRECHO dela no take, quando o take narrou ESTE texto
 * (hashTexto igual); senao a estimativa pelas palavras (o casar roda antes da
 * voz, e a frase editada depois da voz nao tem trecho que valha).
 */
export function duracaoDaFrase(
  frase: Pick<Frase, 'id' | 'texto'>,
  take: Pick<TakeDaVoz, 'trechos'> | null,
): DuracaoDaFrase {
  const trecho = take?.trechos.find((t) => t.fraseId === frase.id)
  if (trecho && trecho.hashTexto === hashDoTexto(frase.texto)) {
    return { duracao: trecho.duracao, real: true, offset: trecho.offset }
  }
  return { duracao: palavrasNaFrase(frase.texto) / PALAVRAS_POR_SEGUNDO_ESTIMADA, real: false, offset: null }
}

/** O trecho da narracao de uma frase no arquivo do take: o que o player toca por cima da cena. */
export function janelaDaNarracao(
  take: Pick<TakeDaVoz, 'trechos'>,
  fraseId: string,
): { inicio: number; fim: number } | null {
  const t = take.trechos.find((x) => x.fraseId === fraseId)
  return t ? { inicio: t.offset, fim: t.offset + t.duracao } : null
}

/**
 * Onde cada cena da escolha comeca e termina, em segundos RELATIVOS ao inicio
 * da frase (0 = o comeco do trecho). Com take valido: a cena k > 0 comeca no
 * `start` da palavra `palavraInicio` (o corte cai no inicio de uma palavra).
 * Sem take: as palavras sao repartidas por igual na duracao estimada. Soma =
 * duracaoDaFrase. Lista vazia = escolha sem cena.
 */
export function temposDasCenas(
  escolha: Pick<EscolhaDaFrase, 'cenas'>,
  frase: Pick<Frase, 'id' | 'texto'>,
  take: Pick<TakeDaVoz, 'trechos' | 'palavras'> | null,
): { inicio: number; fim: number }[] {
  if (escolha.cenas.length === 0) return []
  return temposDosCortes(
    escolha.cenas.map((c) => c.palavraInicio),
    frase,
    take,
  )
}

/**
 * A mesma conta de temposDasCenas, so com as palavras de inicio (a 1a vale 0):
 * o casar usa para medir os pedacos de uma frase antes de haver escolha.
 */
export function temposDosCortes(
  palavrasDeInicio: readonly number[],
  frase: Pick<Frase, 'id' | 'texto'>,
  take: Pick<TakeDaVoz, 'trechos' | 'palavras'> | null,
): { inicio: number; fim: number }[] {
  if (palavrasDeInicio.length === 0) return []
  const d = duracaoDaFrase(frase, take)
  const inicios = palavrasDeInicio.map((p, k) => (k === 0 ? 0 : Math.min(d.duracao, Math.max(0, inicioDaPalavra(p, frase, take, d)))))
  // Monotono mesmo com palavra fora da frase (texto editado): nunca cena de duracao negativa.
  for (let k = 1; k < inicios.length; k++) inicios[k] = Math.max(inicios[k]!, inicios[k - 1]!)
  return inicios.map((inicio, k) => ({ inicio, fim: inicios[k + 1] ?? d.duracao }))
}

/**
 * Onde a palavra `i` da frase comeca, em segundos relativos ao inicio do trecho:
 * o `start` dela no take (tempo real) ou, sem take, as palavras repartidas por
 * igual na duracao estimada.
 */
export function inicioDaPalavra(
  i: number,
  frase: Pick<Frase, 'id' | 'texto'>,
  take: Pick<TakeDaVoz, 'trechos' | 'palavras'> | null,
  d: DuracaoDaFrase = duracaoDaFrase(frase, take),
): number {
  const n = Math.max(1, palavrasNaFrase(frase.texto))
  const p = d.real && take ? take.palavras.filter((x) => x.fraseId === frase.id)[i] : undefined
  if (p && d.offset !== null) return p.start - d.offset
  return (Math.min(i, n) / n) * d.duracao
}

/**
 * Corrige as palavras de inicio para o texto atual da frase: a primeira em 0,
 * as outras subindo estritamente e menores que `nPalavras`. A cena que nao cabe
 * mais (a frase encolheu) sai.
 */
export function normalizarCortes<T extends Pick<EscolhaDaFrase, 'cenas'>>(escolha: T, nPalavras: number): T {
  const cenas: CenaDaFrase[] = []
  for (const c of escolha.cenas) {
    const minimo = cenas.length === 0 ? 0 : cenas[cenas.length - 1]!.palavraInicio + 1
    const palavra = cenas.length === 0 ? 0 : Math.max(minimo, c.palavraInicio)
    if (cenas.length > 0 && palavra >= nPalavras) continue
    cenas.push({ ...c, palavraInicio: palavra })
  }
  return { ...escolha, cenas }
}

/** A frase foi dividida pelo casar e ainda mostra 2+ cenas (o "dividida: 2 cenas" do tooltip). */
export function divididaPeloCasar(escolha: Pick<EscolhaDaFrase, 'cenas' | 'inteira'> | null): boolean {
  return !!escolha && (escolha.inteira?.length ?? 0) > 0 && escolha.cenas.length > 1
}

/**
 * "Juntar em 1": a frase que o casar dividiu volta a ter UMA cena, a melhor da
 * fita da frase inteira (`inteira`), e essa fita volta a ser a dela. Frase nao
 * dividida pelo casar (ou ja com uma cena so): null, nada a juntar.
 */
export function juntarEmUma(escolha: EscolhaDaFrase): EscolhaDaFrase | null {
  const inteira = escolha.inteira ?? []
  const primeira = inteira[0]
  if (!primeira || escolha.cenas.length < 2) return null
  const junta: EscolhaDaFrase = { ...escolha, cenas: [{ candidato: primeira, palavraInicio: 0 }], fita: inteira }
  delete junta.inteira
  return junta
}

/** Um pedaco de mp4 de plano: o que o player encadeia e o que vira cena no projeto. */
export interface TrechoDoArquivo {
  planoId: string
  /** O mp4 do plano (Plano.arquivo). */
  arquivo: string
  /** Segundos DENTRO do mp4 (0 = plano.start; num clipe mesclado, a partir do inicioNoArquivo). */
  de: number
  ate: number
}

/**
 * A janela do candidato em pedacos de arquivo: um por plano do span, com o
 * ponto dentro de cada mp4. Plano que nao esta no indice (ou fora da janela)
 * fica de fora.
 */
export function trechosDoCandidato(
  c: Pick<CandidatoDeCena, 'planoIds' | 'inSec' | 'outSec'>,
  planos: readonly Plano[],
): TrechoDoArquivo[] {
  const porId = new Map(planos.map((p) => [p.id, p]))
  const saida: TrechoDoArquivo[] = []
  for (const id of c.planoIds) {
    const p = porId.get(id)
    if (!p) continue
    // [recap] Plano dentro de um clipe mesclado: o ponto dentro do mp4 anda junto (shared/mesclas.ts).
    const base = p.inicioNoArquivo ?? 0
    const de = Math.max(c.inSec, p.start) - p.start
    const ate = Math.min(c.outSec, p.end) - p.start
    if (ate > de) saida.push({ planoId: id, arquivo: p.arquivo, de: base + de, ate: base + ate })
  }
  return saida
}

/** Os planos sao vizinhos no indice, em ordem (a regra do span). */
export function planosConsecutivos(indice: Pick<EpisodeIndex, 'planos'>, planoIds: readonly string[]): boolean {
  const pos = new Map(indice.planos.map((p, i) => [p.id, i]))
  let anterior = -1
  for (const [k, id] of planoIds.entries()) {
    const i = pos.get(id)
    if (i === undefined) return false
    if (k > 0 && i !== anterior + 1) return false
    anterior = i
  }
  return planoIds.length > 0
}

/**
 * Um candidato que cobre os planos dados (consecutivos, em ordem), com a
 * janela inteira deles salvo `inSec`/`outSec`. Para os stubs, a busca e o
 * "posto a mao".
 */
export function candidatoDosPlanos(
  planos: readonly Plano[],
  episodioId: string,
  origem: OrigemDoCandidato,
  extra: Partial<Pick<CandidatoDeCena, 'inSec' | 'outSec' | 'nota' | 'porque'>> = {},
): CandidatoDeCena {
  const primeiro = planos[0]
  const ultimo = planos[planos.length - 1]
  if (!primeiro || !ultimo) throw new Error('Candidato sem plano.')
  return {
    planoIds: planos.map((p) => p.id),
    episodioId,
    inSec: extra.inSec ?? primeiro.start,
    outSec: extra.outSec ?? ultimo.end,
    nota: extra.nota ?? 0,
    porque: (extra.porque ?? []).slice(0, PORQUE_MAX),
    origem,
    keyframe: primeiro.keyframe,
  }
}

/** Mesmos planos e mesma janela (a meio quadro): a tela marca o cartao da cena escolhida. */
export function mesmoCandidato(
  a: Pick<CandidatoDeCena, 'planoIds' | 'inSec' | 'outSec'>,
  b: Pick<CandidatoDeCena, 'planoIds' | 'inSec' | 'outSec'>,
): boolean {
  return (
    a.planoIds.join('|') === b.planoIds.join('|') &&
    Math.abs(a.inSec - b.inSec) < TOLERANCIA_DE_DURACAO_SEC / 2 &&
    Math.abs(a.outSec - b.outSec) < TOLERANCIA_DE_DURACAO_SEC / 2
  )
}

/**
 * Escolhas que citam um plano que o indice NAO tem mais (o corte foi refeito e
 * os ids mudaram): o casar refaz, mesmo travadas -- a cena nao existe.
 */
export function escolhasForaDoIndice(cenas: Pick<EstadoDasCenas, 'escolhas'>, planos: readonly Pick<Plano, 'id'>[]): string[] {
  if (planos.length === 0) return []
  const ids = new Set(planos.map((p) => p.id))
  return cenas.escolhas.filter((e) => e.cenas.some((c) => c.candidato.planoIds.some((id) => !ids.has(id)))).map((e) => e.fraseId)
}

/** Frases do roteiro (na ordem) sem escolha, ou com escolha sem cena nenhuma. */
export function frasesSemCena(roteiro: Pick<Roteiro, 'secoes'>, cenas: Pick<EstadoDasCenas, 'escolhas'> | null): string[] {
  const porId = new Map((cenas?.escolhas ?? []).map((e) => [e.fraseId, e]))
  return frasesDoRoteiro(roteiro)
    .filter((f) => (porId.get(f.id)?.cenas.length ?? 0) === 0)
    .map((f) => f.id)
}

export interface CenasDesatualizadas {
  /** Frases do roteiro sem escolha nenhuma: sugerirCenas preenche. */
  semEscolha: string[]
  /** A escolha foi feita sobre OUTRO texto (hashTexto): sugerir de novo (se nao travada) e encaixar. */
  textoMudou: string[]
  /** Escolhas de frases que sairam do roteiro: descartar. */
  orfas: string[]
  /** O encaixe nao e deste take (ou foi pela estimativa e agora ha take): encaixarNaVoz. */
  encaixeVelho: boolean
  /** Frases cuja duracao agora difere da usada no encaixe (regravada, take trocado). */
  duracaoMudou: string[]
}

/**
 * O que ficou velho nas cenas, contra o roteiro e o take ATUAIS. `take` =
 * takeAtual(r) (null sem voz). E daqui que a tela decide chamar sugerirCenas
 * (semEscolha/textoMudou) ou encaixarNaVoz (encaixeVelho/duracaoMudou) sozinha.
 */
export function escolhasDesatualizadas(
  roteiro: Pick<Roteiro, 'secoes'>,
  take: Pick<TakeDaVoz, 'id' | 'trechos'> | null,
  cenas: Pick<EstadoDasCenas, 'escolhas' | 'takeId'> | null,
): CenasDesatualizadas {
  const frases = frasesDoRoteiro(roteiro)
  const noRoteiro = new Set(frases.map((f) => f.id))
  const porId = new Map((cenas?.escolhas ?? []).map((e) => [e.fraseId, e]))
  const semEscolha: string[] = []
  const textoMudou: string[] = []
  const duracaoMudou: string[] = []
  for (const f of frases) {
    const e = porId.get(f.id)
    if (!e) {
      semEscolha.push(f.id)
      continue
    }
    if (e.hashTexto !== hashDoTexto(f.texto)) textoMudou.push(f.id)
    if (Math.abs(duracaoDaFrase(f, take).duracao - e.duracao) > TOLERANCIA_DE_DURACAO_SEC) duracaoMudou.push(f.id)
  }
  const orfas = (cenas?.escolhas ?? []).filter((e) => !noRoteiro.has(e.fraseId)).map((e) => e.fraseId)
  const encaixeVelho = (cenas?.escolhas.length ?? 0) > 0 && (take?.id ?? null) !== (cenas?.takeId ?? null)
  return { semEscolha, textoMudou, orfas, encaixeVelho, duracaoMudou }
}

/** Nada a sugerir nem a encaixar. */
export function cenasEmDia(d: CenasDesatualizadas): boolean {
  return (
    d.semEscolha.length === 0 &&
    d.textoMudou.length === 0 &&
    d.orfas.length === 0 &&
    !d.encaixeVelho &&
    d.duracaoMudou.length === 0
  )
}

/**
 * Junta escolhas novas as gravadas (a do mesmo fraseId e trocada) e poe na
 * ORDEM do roteiro; escolha de frase que nao esta no roteiro sai. E a regra do
 * salvarCenas e do sugerirCenas.
 */
export function aplicarEscolhas(
  cenas: EstadoDasCenas,
  novas: readonly EscolhaDaFrase[],
  roteiro: Pick<Roteiro, 'secoes'>,
): EstadoDasCenas {
  const porId = new Map(cenas.escolhas.map((e) => [e.fraseId, e]))
  for (const e of novas) porId.set(e.fraseId, e)
  const escolhas: EscolhaDaFrase[] = []
  for (const f of frasesDoRoteiro(roteiro)) {
    const e = porId.get(f.id)
    if (e) escolhas.push(e)
  }
  return { ...cenas, escolhas }
}

/**
 * Depois de re-dividir o roteiro (modo Texto, redividirRoteiro em roteiro.ts):
 * as frases 'igual' e 'parecida' mantem o id, entao a escolha delas continua
 * (com as palavras de inicio corrigidas para o texto novo); as 'nova' ficam sem
 * escolha (o casar sugere); as removidas saem. A 'parecida' muda o hash do
 * texto: escolhasDesatualizadas marca e o casar refaz, se nao estiver travada.
 */
export function cenasDepoisDaRedivisao(
  cenas: EstadoDasCenas | null,
  redivisao: Pick<Redivisao, 'secoes' | 'frases'>,
): EstadoDasCenas | null {
  if (!cenas) return null
  const mantidas = new Set(redivisao.frases.filter((f) => f.destino !== 'nova').map((f) => f.id))
  const textoNovo = new Map(redivisao.secoes.flatMap((s) => s.frases).map((f) => [f.id, f.texto]))
  const escolhas: EscolhaDaFrase[] = []
  for (const f of redivisao.secoes.flatMap((s) => s.frases)) {
    if (!mantidas.has(f.id)) continue
    const e = cenas.escolhas.find((x) => x.fraseId === f.id)
    if (e) escolhas.push(normalizarCortes(e, palavrasNaFrase(textoNovo.get(f.id) ?? '')))
  }
  return { ...cenas, escolhas }
}
