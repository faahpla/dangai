import { useMemo } from 'react'
import { create } from 'zustand'
import type { IpcResult } from '@shared/channels'
import type { AjustesDaVoz as AjustesPublicos, ProvedorDeVoz, VozDoProvedor, VozPadrao } from '../../shared/tipos-da-voz'
import { roteiroAtual, type RascunhoDoRecap, type Roteiro } from '../../shared/roteiro'
import {
  MODELO_PADRAO,
  VELOCIDADE_NATIVA_PADRAO,
  arrumarVelocidadeNativa,
  caracteresDasFrases,
  configDaVozSchema,
  contarCaracteres,
  fraseNoTempo,
  frasesParaRegravar,
  modeloEleven,
  palavraNoTempo,
  settingsElevenSchema,
  settingsFishSchema,
  situacaoDaVoz,
  soMudaOPos,
  takeAtual,
  textoParaNarrar,
  velocidadeNativaDoPerfil,
  type AudioDoTake,
  type ConfigDaVoz,
  type EstimativaDeCusto,
  type EtapaDaVoz,
  type FonteDaVoz,
  type PalavraComTempo,
  type PedidoDeEstimativa,
  type SituacaoDaVoz,
  type TakeDaVoz,
  type TrechoDaFrase,
  type VozGerada,
} from '../../shared/voz'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { useRoteiro } from './gerar-roteiro'

/**
 * O ASSISTENTE "GERAR RECAP", passo 3 (Voz).
 *
 * Store propria, como a dos passos 1 e 2: nada daqui entra no undo nem no
 * projeto aberto. O que vale mora no disco, no RASCUNHO DO RECAP (`voz`,
 * shared/voz.ts). O rascunho na memoria e UM SO, o da store do roteiro
 * (gerar-roteiro.ts): toda chamada do passo 3 devolve o rascunho inteiro e ele
 * entra la (trocarRascunho). Duas copias do mesmo arquivo na tela iam divergir
 * na primeira gravacao cruzada.
 *
 * Aqui mora o que e so da TELA do passo 3:
 *   - o formulario da narracao (fonte, voz, modelo, velocidade nativa, acelerar,
 *     cortar pausas);
 *   - a estimativa de custo (estimarVoz, que nao gasta nada);
 *   - a PERGUNTA de custo: gastar sempre passa por ela, e o `confirmado` que o
 *     main recebe e o numero que o Levi viu;
 *   - o pedido em andamento (gerar, regravar, ajustar, importar), com o
 *     Cancelar, e o audio publicado de cada take.
 *
 * O TOCADOR (useTocador, mais abaixo) e outra store pequena: o tempo muda a
 * cada quadro, e so quem mostra o tempo deve redesenhar a cada quadro.
 */

// ------------------------------------------------------------------ tipos

/** O pedaco dos ajustes que o passo 3 usa (as chaves nunca vem para ca: so se existem). */
export interface AjustesDaVoz {
  hasElevenKey: boolean
  hasFishKey: boolean
  elevenKeyHint: string
  fishKeyHint: string
  vozPadrao: VozPadrao
}

/**
 * O formulario da narracao, como esta na tela. Guarda a voz e o modelo das
 * DUAS fontes pagas: trocar o chip para Fish e voltar nao perde a voz do
 * ElevenLabs escolhida. voiceId '' = nenhuma escolhida ainda.
 */
export interface Formulario {
  fonte: FonteDaVoz
  eleven: { voiceId: string; modelId: string }
  fish: { voiceId: string; modelId: string }
  /** A velocidade NATIVA das fontes pagas (a voz gerada nesse ritmo: muda o audio, e paga). */
  nativa: number
  /** O "acelerar" (o pos, de graca). */
  velocidade: number
  cortarPausas: boolean
}

export type TipoDoPedido = 'gerar' | 'regravar' | 'ajustar' | 'importar'

/** O pedido ao motor em andamento. */
export interface PedidoDaVoz {
  /** Identifica o pedido: o Cancelar solta ESTE (pedidoId = String(token)). */
  token: number
  rascunhoId: string
  tipo: TipoDoPedido
  /** As frases sendo regravadas (as linhas mostram o andamento). Vazio fora do regravar. */
  fraseIds: string[]
  /** Date.now() do clique, para o tempo decorrido. */
  inicio: number
  etapa: EtapaDaVoz
  /** A frase do main (onVozProgresso). null = ainda nenhuma. */
  mensagem: string | null
  /** 0..1 quando o main sabe medir. null = indeterminado. */
  fracao: number | null
  /** O main ja recebeu ESTE pedido (antes, so esperava o anterior terminar). */
  comecou: boolean
}

/**
 * A pergunta "gastar?" na tela. `onde` diz em que cartao ela aparece e para
 * onde o foco volta: 'narracao' (o Gerar), 'mudou' (o aviso do roteiro) ou o
 * id da frase (o Regravar da linha).
 */
export interface PerguntaDeCusto {
  acao: 'gerar' | 'regravar'
  onde: string
  /** gerar: a config do take novo. null no regravar (vale a do take atual). */
  config: ConfigDaVoz | null
  /** regravar: as frases pedidas (o motor soma as que mudaram). */
  fraseIds: string[]
  estimativa: EstimativaDeCusto
}

/** A estimativa do botao Gerar, para a config da tela. */
export interface EstimativaNaTela {
  /** De que config/roteiro/take ela fala (muda = pedir outra). */
  chave: string
  valor: EstimativaDeCusto | null
  erro: string | null
  carregando: boolean
}

/**
 * O que o cartao da narracao oferece, pelo formulario contra o take atual:
 * - 'gerar': sem take, ou outra voz/modelo/velocidade nativa -- PAGO (pergunta antes);
 * - 'de-novo': a mesma voz do take -- "Gerar tudo de novo", PAGO;
 * - 'aplicar': so o acelerar/corte mudaram -- de graca, a partir do bruto;
 * - 'importar': a fonte e o audio dele (a area de soltar e a acao);
 * - 'escolher-voz' / 'sem-chave': falta algo antes de poder gerar.
 */
export type AcaoDaNarracao =
  | { tipo: 'gerar'; config: ConfigDaVoz }
  | { tipo: 'de-novo'; config: ConfigDaVoz }
  | { tipo: 'aplicar'; config: ConfigDaVoz }
  | { tipo: 'importar' }
  | { tipo: 'escolher-voz' }
  | { tipo: 'sem-chave'; fonte: Exclude<FonteDaVoz, 'importado'> }

// --------------------------------------------------------------- constantes

/** Modelos do Fish Audio (cabecalho `model`, docs de 14/10/2026). O primeiro e o padrao. */
export const MODELOS_FISH: readonly { id: string; nome: string }[] = [
  { id: 's2.1-pro', nome: 'S2.1 Pro' },
  { id: 's2-pro', nome: 'S2 Pro' },
  { id: 's1', nome: 'S1' },
]

/** Espera depois da ultima mudanca do formulario antes de pedir a estimativa. */
const ESPERA_DA_ESTIMATIVA_MS = 350
/** Quanto o cartao do andamento segura o lugar depois do Cancelar. */
const CANCELADO_POR_MS = 1000

const FORM_INICIAL: Formulario = {
  fonte: 'elevenlabs',
  eleven: { voiceId: '', modelId: MODELO_PADRAO.elevenlabs },
  fish: { voiceId: '', modelId: MODELO_PADRAO.fish },
  nativa: VELOCIDADE_NATIVA_PADRAO,
  velocidade: 1,
  cortarPausas: true,
}

// ------------------------------------------------------------ puras (tela)

/** O rascunho que a tela mostra (o da store do roteiro). */
export function rascunhoDaTela(): RascunhoDoRecap | null {
  return useRoteiro.getState().rascunho
}

/** Velocidade arredondada ao centesimo: o slider soma 0,05 em ponto flutuante. */
function arredondar(v: number): number {
  return Math.round(v * 100) / 100
}

function mesmoPos(a: Pick<ConfigDaVoz, 'velocidade' | 'cortarPausas'>, b: Pick<ConfigDaVoz, 'velocidade' | 'cortarPausas'>): boolean {
  return Math.abs(a.velocidade - b.velocidade) < 1e-6 && a.cortarPausas === b.cortarPausas
}

/** O formulario com a config de um take (as outras fontes ficam como estavam). */
function formComTake(take: TakeDaVoz, base: Formulario): Formulario {
  const c = take.config
  const f: Formulario = { ...base, fonte: c.fonte, velocidade: c.velocidade, cortarPausas: c.cortarPausas }
  if (c.fonte === 'elevenlabs') f.eleven = { voiceId: c.voiceId, modelId: c.modelId }
  if (c.fonte === 'fish') f.fish = { voiceId: c.voiceId, modelId: c.modelId }
  // A nativa do take (o de antes do campo le 1,0): reabrir nao muda a voz que ja foi paga.
  if (c.fonte !== 'importado') f.nativa = c.velocidadeNativa
  return f
}

/**
 * O formulario de partida, sem take ainda: a voz padrao das Configuracoes e a
 * fonte que tem chave (a da voz padrao primeiro). Sem chave nenhuma, importar.
 */
function formDosAjustes(a: AjustesDaVoz, base: Formulario): Formulario {
  const v = a.vozPadrao
  const eleven =
    v.provedor === 'elevenlabs' && v.voiceId
      ? { voiceId: v.voiceId, modelId: v.modelId || MODELO_PADRAO.elevenlabs }
      : base.eleven
  const fish = v.provedor === 'fish' && v.voiceId ? { voiceId: v.voiceId, modelId: v.modelId || MODELO_PADRAO.fish } : base.fish
  const fonte: FonteDaVoz =
    v.provedor === 'fish' && a.hasFishKey
      ? 'fish'
      : a.hasElevenKey
        ? 'elevenlabs'
        : a.hasFishKey
          ? 'fish'
          : 'importado'
  return { ...base, fonte, eleven, fish, nativa: velocidadeNativaDoPerfil(v), velocidade: 1, cortarPausas: fonte !== 'importado' }
}

/**
 * A voz das fontes pagas que o formulario ainda nao tem: a do take mais
 * recente daquela fonte neste rascunho, senao a voz padrao das Configuracoes.
 * Sem isto, num take importado (ou ao reabrir o app nele), o chip ElevenLabs
 * abria em "Escolha uma voz" com a voz padrao salva. Nunca troca uma voz ja
 * escolhida; devolve o MESMO objeto quando nao ha o que completar.
 */
function completarVozes(form: Formulario, takes: readonly TakeDaVoz[], ajustes: AjustesDaVoz | null): Formulario {
  let f = form
  for (const [fonte, lado] of [
    ['elevenlabs', 'eleven'],
    ['fish', 'fish'],
  ] as const) {
    if (f[lado].voiceId) continue
    const c = [...takes].reverse().find((t) => t.config.fonte === fonte)?.config
    if (c && c.fonte !== 'importado') {
      f = { ...f, [lado]: { voiceId: c.voiceId, modelId: c.modelId } }
      continue
    }
    const v = ajustes?.vozPadrao
    if (v && v.provedor === fonte && v.voiceId) f = { ...f, [lado]: { voiceId: v.voiceId, modelId: v.modelId || MODELO_PADRAO[fonte] } }
  }
  return f
}

/**
 * A config que o formulario pede. null = falta algo (voz nao escolhida, ou
 * importar sem take importado). Os settings (stability...) vem do take atual
 * quando e da mesma fonte -- a tela nao mexe neles --, senao os padroes.
 */
export function configDoForm(form: Formulario, take: TakeDaVoz | null): ConfigDaVoz | null {
  const pos = { velocidade: arredondar(form.velocidade), cortarPausas: form.cortarPausas }
  const velocidadeNativa = arrumarVelocidadeNativa(form.nativa)
  let bruto: unknown
  if (form.fonte === 'elevenlabs') {
    if (!form.eleven.voiceId) return null
    bruto = {
      fonte: 'elevenlabs',
      voiceId: form.eleven.voiceId,
      modelId: form.eleven.modelId || MODELO_PADRAO.elevenlabs,
      velocidadeNativa,
      ...pos,
      settings: take?.config.fonte === 'elevenlabs' ? take.config.settings : settingsElevenSchema.parse({}),
    }
  } else if (form.fonte === 'fish') {
    if (!form.fish.voiceId) return null
    bruto = {
      fonte: 'fish',
      voiceId: form.fish.voiceId,
      modelId: form.fish.modelId || MODELO_PADRAO.fish,
      velocidadeNativa,
      ...pos,
      settings: take?.config.fonte === 'fish' ? take.config.settings : settingsFishSchema.parse({}),
    }
  } else {
    if (take?.config.fonte !== 'importado') return null
    bruto = { ...take.config, ...pos }
  }
  const r = configDaVozSchema.safeParse(bruto)
  return r.success ? r.data : null
}

export function acaoDaNarracao(form: Formulario, take: TakeDaVoz | null, ajustes: AjustesDaVoz | null): AcaoDaNarracao {
  if (form.fonte === 'importado') {
    const cfg = configDoForm(form, take)
    if (cfg && take && !mesmoPos(cfg, take.config)) return { tipo: 'aplicar', config: cfg }
    return { tipo: 'importar' }
  }
  const temChave = form.fonte === 'elevenlabs' ? ajustes?.hasElevenKey : ajustes?.hasFishKey
  // Sem os ajustes lidos ainda, nao acusa falta de chave (piscaria na abertura).
  if (ajustes && !temChave) return { tipo: 'sem-chave', fonte: form.fonte }
  const cfg = configDoForm(form, take)
  if (!cfg) return { tipo: 'escolher-voz' }
  if (!take || !soMudaOPos(cfg, take.config)) return { tipo: 'gerar', config: cfg }
  return mesmoPos(cfg, take.config) ? { tipo: 'de-novo', config: cfg } : { tipo: 'aplicar', config: cfg }
}

/**
 * Caracteres que um "gerar tudo" mandaria (o `text` do take inteiro). E a
 * conta da tela enquanto a estimativa do main nao chega; quem vale para
 * cobrar e a do main.
 */
export function caracteresDoRoteiro(roteiro: Pick<Roteiro, 'secoes'>): number {
  return contarCaracteres(textoParaNarrar(roteiro).texto)
}

/** Creditos por caractere da config (o ElevenLabs Flash cobra metade). */
export function creditosPorCaractere(config: ConfigDaVoz): number {
  return config.fonte === 'elevenlabs' ? modeloEleven(config.modelId).creditosPorCaractere : 1
}

/**
 * Quanto custaria regravar estas frases sobre o take (a mesma conta do
 * main: frasesParaRegravar soma as que mudaram). `extras` = as que entram sem
 * terem sido pedidas.
 */
export function custoDeRegravar(
  roteiro: Pick<Roteiro, 'secoes'>,
  take: TakeDaVoz,
  pedidas: readonly string[],
): { caracteres: number; creditos: number; fraseIds: string[]; extras: number } {
  const fraseIds = frasesParaRegravar(roteiro, take, pedidas)
  const caracteres = caracteresDasFrases(roteiro, fraseIds)
  const pedidasSet = new Set(pedidas)
  return {
    caracteres,
    creditos: Math.ceil(caracteres * creditosPorCaractere(take.config)),
    fraseIds,
    extras: fraseIds.filter((id) => !pedidasSet.has(id)).length,
  }
}

/**
 * De que a estimativa fala: o rascunho, a versao do roteiro, quantos takes
 * (o cache cresce com eles), o take atual (o aviso "volte para o take tN"
 * depende dele) e a config. A tela so mostra a estimativa cuja chave e a da
 * config na tela -- durante a espera curta, a velha nao vale.
 */
export function chaveDaEstimativa(r: Pick<RascunhoDoRecap, 'id' | 'atual' | 'voz'>, config: ConfigDaVoz): string {
  return JSON.stringify([r.id, r.atual, r.voz?.takes.length ?? 0, r.voz?.atual ?? null, config])
}

/**
 * O alinhamento mediu pouco (o audio pode nao ser este roteiro), ou o SOM
 * desmente o tempo de alguma palavra (suspeitas: esticada sobre uma pausa, ou
 * "pausa" em cima da fala). Uma suspeita so ja basta: a media do wav2vec2
 * diluia 4 palavras erradas entre 179 e o aviso nunca aparecia.
 */
export function alinhamentoFraco(take: Pick<TakeDaVoz, 'qualidade'>): boolean {
  const q = take.qualidade
  if (!q) return false
  if (q.suspeitas > 0) return true
  if (q.score !== null && q.score < 0.35) return true
  return q.total > 0 && q.ancoradas / q.total < 0.8
}

/** "Andrea Wolff - clear, youthful, evenly paced" -> "Andrea Wolff": a descricao da biblioteca fica no tooltip. */
export function nomeCurto(nome: string): string {
  return nome.split(/\s+[-–—]\s+/)[0]!.trim() || nome
}

/** A nota do main em poucas palavras para o rodape; a inteira vai no tooltip. */
export function resumoDaFalhaDaVoz(nota: string): { curto: string; configuracoes: boolean } {
  if (/sem chave/i.test(nota)) return { curto: 'Sem chave de voz', configuracoes: true }
  if (/recusad|invalid|401|nao autoriz/i.test(nota)) return { curto: 'Chave de voz recusada', configuracoes: true }
  if (/sem (creditos|caracteres|saldo)|quota|insuficiente/i.test(nota)) return { curto: 'Sem creditos de voz', configuracoes: false }
  if (/custo mudou/i.test(nota)) return { curto: 'O custo mudou: confira de novo', configuracoes: false }
  if (/sem conexao|internet|ENOTFOUND|ECONN/i.test(nota)) return { curto: 'Sem internet', configuracoes: false }
  if (/ainda nao esta pronta/i.test(nota)) return { curto: 'Voz ainda indisponivel', configuracoes: false }
  const primeira = nota.split(/(?<=[.!?])\s/)[0] ?? nota
  return { curto: primeira.length > 56 ? `${primeira.slice(0, 54).trimEnd()}...` : primeira.replace(/\.$/, ''), configuracoes: false }
}

/** 2.43 -> "2,4 s". */
export function segundosCurtos(seg: number): string {
  return `${(Math.round(seg * 10) / 10).toFixed(1).replace('.', ',')} s`
}

/** 1.05 -> "1,05x". */
export function textoDaVelocidade(v: number): string {
  return `${arredondar(v).toFixed(2).replace('.', ',')}x`
}

// --------------------------------------------------------------- a store

interface EstadoDaVozNaTela {
  /** O rascunho a que este estado se refere (o da store do roteiro). */
  rascunhoId: string | null
  ajustes: AjustesDaVoz | null
  form: Formulario
  /** O take de onde o formulario saiu: quando o take atual muda, o formulario segue. */
  formDe: string | null
  /** Ele mexeu no formulario (os ajustes relidos nao passam por cima). */
  formMexido: boolean
  /** As vozes da conta (o "Testar" das Configuracoes, que nao gasta). null = ainda nao lidas. */
  vozes: Record<ProvedorDeVoz, VozDoProvedor[] | null>
  vozesErro: Record<ProvedorDeVoz, string | null>
  carregandoVozes: Record<ProvedorDeVoz, boolean>
  estimativa: EstimativaNaTela | null
  pergunta: PerguntaDeCusto | null
  /** Uma estimativa para a pergunta no ar (o botao mostra "..."). O valor e o `onde` dela. */
  perguntando: string | null
  pedido: PedidoDaVoz | null
  /** O pedido recem-cancelado, por ~1 s: o cartao do andamento segura o lugar. */
  pedidoCancelado: PedidoDaVoz | null
  /** O audio publicado de cada take, por `${rascunhoId}:${takeId}`. */
  audios: Record<string, AudioDoTake>
  carregandoAudio: string | null
  audioErro: { chave: string; erro: string } | null
  aprovando: boolean
  /** O erro da ultima chamada (rodape, vermelho; clicar fecha). */
  erro: string | null
  /** Por que o ultimo pedido falhou: fica no cartao da narracao depois de o erro do rodape fechar. */
  falha: string | null
  recado: string | null
  recadoDetalhe: string | null
  /** O atalho "Configurar" pediu as Configuracoes roladas ate a Voz (AjustesDeVoz rola e apaga). */
  ajustesDeVozPedidos: boolean

  /** O passo abriu (ou trocou de rascunho): zera o que era de outro rascunho. */
  entrar: (rascunhoId: string) => void
  /** O formulario segue o take atual (ou a voz padrao, sem take). */
  sincronizar: () => void
  /** Rele chaves e voz padrao (as Configuracoes podem ter mudado) e as vozes, se a chave mudou. */
  lerAjustes: () => Promise<void>
  carregarVozes: (provedor: ProvedorDeVoz) => Promise<void>
  escolherFonte: (fonte: FonteDaVoz) => void
  mudarForm: (mudar: (f: Formulario) => Formulario) => void
  /** Pede a estimativa da config da tela (com espera curta). */
  estimar: () => void
  /** "Gerar voz" / "Gerar tudo de novo": estima e PERGUNTA. Nao gasta. */
  pedirGeracao: () => Promise<void>
  /** "Regravar": estima e PERGUNTA. [] = "so o que mudou". */
  pedirRegravar: (fraseIds: string[], onde: string) => Promise<void>
  /** O sim da pergunta: so aqui algo e gasto. */
  confirmar: () => Promise<void>
  desistir: () => void
  /** Velocidade/corte do take atual, de graca. */
  aplicarAjuste: () => Promise<void>
  importar: (caminho: string) => Promise<void>
  escolherArquivo: () => Promise<void>
  cancelar: () => void
  escolherTake: (takeId: string) => Promise<void>
  aprovar: () => Promise<void>
  desaprovar: () => Promise<void>
  carregarAudio: (takeId: string) => Promise<void>
  abrirAjustesDeVoz: () => void
  ajustesDeVozVistos: () => void
  limparErro: () => void
  limparRecado: () => void
}

const LIMPO = {
  form: FORM_INICIAL,
  formDe: null,
  formMexido: false,
  estimativa: null,
  pergunta: null,
  perguntando: null,
  pedidoCancelado: null,
  carregandoAudio: null,
  audioErro: null,
  aprovando: false,
  erro: null,
  falha: null,
  recado: null,
  recadoDetalhe: null,
} satisfies Partial<EstadoDaVozNaTela>

let ultimoToken = 0
let relogioDaEstimativa: ReturnType<typeof setTimeout> | null = null
let relogioDoCancelado: ReturnType<typeof setTimeout> | null = null

/**
 * A chamada ao motor de cada rascunho que ainda esta no ar (inclusive a de um
 * pedido cancelado). O main aceita um pedido de voz por rascunho: o novo
 * espera este terminar, mostrando "Esperando o pedido anterior...".
 */
const vozNoAr = new Map<string, Promise<void>>()
function noAr<T>(rascunhoId: string, chamada: Promise<T>): Promise<T> {
  const fim = chamada.then(
    () => undefined,
    () => undefined,
  )
  vozNoAr.set(rascunhoId, fim)
  void fim.then(() => {
    if (vozNoAr.get(rascunhoId) === fim) vozNoAr.delete(rascunhoId)
  })
  return chamada
}

/**
 * Poe o rascunho que o main devolveu na store do roteiro, que e a dona dele.
 * So o MESMO rascunho, e so se nao for mais velho que o da tela (respostas
 * cruzadas chegam fora de ordem). A tela do roteiro (`tela`) nao muda: a voz
 * nao mexe no roteiro.
 */
function trocarRascunho(novo: RascunhoDoRecap): void {
  const atual = useRoteiro.getState().rascunho
  if (!atual || atual.id !== novo.id) return
  if (atual.atualizadoEm > novo.atualizadoEm) return
  useRoteiro.setState({ rascunho: novo })
}

/** O rascunho na tela ainda e este (ele nao trocou de episodio no meio). */
function ainda(id: string): boolean {
  return useRoteiro.getState().rascunho?.id === id
}

function chaveDoAudio(rascunhoId: string, takeId: string): string {
  return `${rascunhoId}:${takeId}`
}

function ajustesDe(s: AjustesPublicos): AjustesDaVoz {
  return {
    hasElevenKey: s.hasElevenKey,
    hasFishKey: s.hasFishKey,
    elevenKeyHint: s.elevenKeyHint,
    fishKeyHint: s.fishKeyHint,
    vozPadrao: s.vozPadrao,
  }
}

/**
 * O gasto de um take em palavras. O Fish cobra em DOLAR pelos caracteres e nao
 * manda character-cost: o `cobrados` dele sao os caracteres enviados, e
 * "1.034 creditos gastos" parecia uma conta que ele nao tem (1o take real, 14/10).
 */
export function textoDoGasto(fonte: TakeDaVoz['config']['fonte'], cobrados: number): string {
  const n = Math.ceil(cobrados).toLocaleString('pt-BR')
  return fonte === 'fish' ? `${n} caracteres cobrados (Fish)` : `${n} creditos gastos`
}

/** Recado do fim de um pedido: o gasto e os avisos do motor. */
function recadoDoFim(tipo: TipoDoPedido, v: VozGerada): { recado: string; detalhe: string | null } {
  const partes: string[] = []
  if (tipo === 'gerar' || tipo === 'regravar') {
    // `cobrados` e o character-cost do provedor: CREDITOS do plano, nao caracteres (a conta do Levi cobra ~0,22 por caractere).
    partes.push(v.cobrados > 0 ? `${textoDoGasto(v.take.config.fonte, v.cobrados)}.` : 'Do cache, sem custo.')
    if (alinhamentoFraco(v.take)) partes.push('Alinhamento fraco: confira.')
  } else if (tipo === 'importar') {
    partes.push(alinhamentoFraco(v.take) ? 'Importado. Alinhamento fraco: confira.' : 'Importado.')
  } else {
    partes.push('Ajustado, sem custo.')
  }
  if (v.avisos.length > 0) partes.push(`${v.avisos.length} ${v.avisos.length === 1 ? 'aviso' : 'avisos'}.`)
  return { recado: partes.join(' '), detalhe: v.avisos.length > 0 ? v.avisos.join('\n') : null }
}

export const useVoz = create<EstadoDaVozNaTela>((set, get) => {
  /**
   * Roda um pedido ao motor (gerar, regravar, ajustar, importar) com o
   * andamento, o Cancelar e a corrida do Cancelar -- a mesma regra do passo 2:
   * a resposta de um pedido cancelado nunca toma a tela.
   */
  const executar = async (
    tipo: TipoDoPedido,
    fraseIds: string[],
    fazer: (rascunhoId: string, pedidoId: string) => Promise<IpcResult<VozGerada>>,
  ): Promise<void> => {
    const r = rascunhoDaTela()
    if (!r || get().pedido || get().aprovando) return
    const id = r.id
    const token = ++ultimoToken
    // O take e a aprovacao de antes: e para eles que a corrida do Cancelar volta.
    const anterior = r.voz?.atual ?? null
    const aprovadoAntes = r.voz?.aprovado === true
    if (relogioDoCancelado) clearTimeout(relogioDoCancelado)
    set({
      pedido: {
        token,
        rascunhoId: id,
        tipo,
        fraseIds,
        inicio: Date.now(),
        etapa: 'preparando',
        mensagem: null,
        fracao: null,
        comecou: false,
      },
      pedidoCancelado: null,
      pergunta: null,
      erro: null,
      falha: null,
      recado: null,
      recadoDetalhe: null,
    })
    const vivo = (): boolean => get().pedido?.token === token

    // Um pedido cancelado deste rascunho ainda no ar: o main so aceita um por vez.
    await (vozNoAr.get(id) ?? Promise.resolve())
    if (!vivo() || !ainda(id)) return
    const p = get().pedido
    if (p) set({ pedido: { ...p, comecou: true } })

    const res = await noAr(id, fazer(id, String(token)))
    if (!ainda(id)) {
      // Trocou de rascunho no meio: o andamento nao pode ficar preso na tela do outro.
      if (vivo()) set({ pedido: null })
      return
    }
    if (!res.ok) {
      if (vivo()) set({ pedido: null, erro: res.error, falha: res.error })
      return
    }
    const v = res.value
    trocarRascunho(v.rascunho)

    if (vivo()) {
      const fim = recadoDoFim(tipo, v)
      set({ pedido: null, recado: fim.recado, recadoDetalhe: fim.detalhe })
      get().sincronizar()
      if (!v.soNoHistorico) void get().carregarAudio(v.take.id)
      return
    }

    /*
     * CANCELADO NO MEIO. O caso comum: o main soube do Cancelar a tempo e o
     * take (pago) foi so para a lista de Takes -- a tela, o take atual e a
     * aprovacao ficam.
     */
    if (v.soNoHistorico) {
      set({ recado: `Take ${v.take.id} guardado em Takes.`, recadoDetalhe: null })
      get().sincronizar()
      return
    }
    // Sem take antes (o primeiro), nao ha o que proteger: ele aparece.
    if (anterior === null) {
      get().sincronizar()
      void get().carregarAudio(v.take.id)
      return
    }
    /*
     * A corrida: o main pos o take como atual antes de o Cancelar chegar.
     * Volta para o take de antes e, se estava aprovado, aprova de novo.
     */
    const volta = await ponte.escolherTake(id, anterior)
    if (!ainda(id)) return
    if (!volta.ok) {
      set({ erro: volta.error })
      return
    }
    let final = volta.value
    if (aprovadoAntes) {
      const ap = await ponte.aprovarVoz(id)
      if (!ainda(id)) return
      if (ap.ok) final = ap.value
    }
    trocarRascunho(final)
    get().sincronizar()
    set({ recado: `Take ${v.take.id} guardado em Takes.`, recadoDetalhe: null })
  }

  /** Estima para a pergunta. null = falhou (o erro ja esta na tela). */
  const estimarParaPerguntar = async (onde: string, pedido: PedidoDeEstimativa): Promise<EstimativaDeCusto | null> => {
    const r = rascunhoDaTela()
    if (!r || get().pedido || get().perguntando) return null
    const id = r.id
    set({ perguntando: onde, pergunta: null, erro: null })
    const e = await ponte.estimarVoz(id, pedido)
    if (!ainda(id) || get().perguntando !== onde) return null
    if (!e.ok) {
      set({ perguntando: null, erro: e.error })
      return null
    }
    set({ perguntando: null })
    return e.value
  }

  return {
    rascunhoId: null,
    ajustes: null,
    vozes: { elevenlabs: null, fish: null },
    vozesErro: { elevenlabs: null, fish: null },
    carregandoVozes: { elevenlabs: false, fish: false },
    pedido: null,
    audios: {},
    ajustesDeVozPedidos: false,
    ...LIMPO,

    entrar: (rascunhoId) => {
      const s = get()
      if (s.rascunhoId === rascunhoId) {
        get().sincronizar()
        return
      }
      if (relogioDaEstimativa) clearTimeout(relogioDaEstimativa)
      // O pedido de outro rascunho segue no main; a resposta dele nao entra aqui (trocarRascunho confere o id).
      set({ ...LIMPO, rascunhoId, pedido: null })
      get().sincronizar()
    },

    sincronizar: () => {
      const r = rascunhoDaTela()
      if (!r || r.id !== get().rascunhoId) return
      const take = takeAtual(r)
      const s = get()
      if (take) {
        // A fonte do take manda; as outras fontes ficam com a voz que ja tinham (ou a completada).
        const base = s.formDe !== take.id ? formComTake(take, s.form) : s.form
        const form = completarVozes(base, r.voz?.takes ?? [], s.ajustes)
        if (s.formDe !== take.id) set({ form, formDe: take.id, formMexido: false })
        else if (form !== s.form) set({ form })
        return
      }
      if (s.formDe !== null) set({ formDe: null })
      if (!s.formMexido && s.ajustes) set({ form: formDosAjustes(s.ajustes, s.form) })
    },

    lerAjustes: async () => {
      const r = await ponte.lerAjustesDaVoz()
      if (!r.ok) return
      const novos = ajustesDe(r.value)
      const antes = get().ajustes
      set({ ajustes: novos })
      get().sincronizar()
      // As vozes sao da chave: chave nova (ou lista nunca lida) = ler de novo. Sem chave, lista vazia.
      const provedores: [ProvedorDeVoz, boolean, string, string | undefined][] = [
        ['elevenlabs', novos.hasElevenKey, novos.elevenKeyHint, antes?.elevenKeyHint],
        ['fish', novos.hasFishKey, novos.fishKeyHint, antes?.fishKeyHint],
      ]
      for (const [p, tem, dica, dicaAntes] of provedores) {
        if (!tem) {
          if (get().vozes[p] !== null) set({ vozes: { ...get().vozes, [p]: null }, vozesErro: { ...get().vozesErro, [p]: null } })
          continue
        }
        if (get().vozes[p] === null || dica !== dicaAntes) void get().carregarVozes(p)
      }
    },

    carregarVozes: async (provedor) => {
      if (get().carregandoVozes[provedor]) return
      set({
        carregandoVozes: { ...get().carregandoVozes, [provedor]: true },
        vozesErro: { ...get().vozesErro, [provedor]: null },
      })
      // O "Testar" das Configuracoes: le o plano e a lista de vozes, sem gastar caractere.
      const r = provedor === 'elevenlabs' ? await ponte.testarEleven(null) : await ponte.testarFish(null)
      set({ carregandoVozes: { ...get().carregandoVozes, [provedor]: false } })
      if (r.ok) set({ vozes: { ...get().vozes, [provedor]: r.value.vozes } })
      else set({ vozesErro: { ...get().vozesErro, [provedor]: r.error } })
    },

    escolherFonte: (fonte) => {
      const s = get()
      if (s.pedido || s.form.fonte === fonte) return
      const r = rascunhoDaTela()
      const take = r ? takeAtual(r) : null
      const pago = (f: FonteDaVoz): boolean => f !== 'importado'
      /*
       * O pos de cada lado: o do take, se ele e desta fonte; entre ElevenLabs e
       * Fish, o da tela; de/para o importado, o padrao dele (a pausa de quem
       * gravou costuma ser de proposito: corte desligado).
       */
      const pos =
        take && take.config.fonte === fonte
          ? { velocidade: take.config.velocidade, cortarPausas: take.config.cortarPausas }
          : pago(fonte) && pago(s.form.fonte)
            ? { velocidade: s.form.velocidade, cortarPausas: s.form.cortarPausas }
            : { velocidade: 1, cortarPausas: pago(fonte) }
      set({
        form: { ...s.form, fonte, ...pos },
        formMexido: true,
        pergunta: s.pergunta?.onde === 'narracao' ? null : s.pergunta,
        // O recado era do que estava na tela ("Cancelado.", "Importado."): a situacao mudou.
        recado: null,
        recadoDetalhe: null,
      })
    },

    mudarForm: (mudar) => {
      const s = get()
      if (s.pedido) return
      const novo = mudar(s.form)
      if (novo === s.form) return
      set({
        form: { ...novo, velocidade: arredondar(novo.velocidade), nativa: arrumarVelocidadeNativa(novo.nativa) },
        formMexido: true,
        // A pergunta era do formulario de antes.
        pergunta: s.pergunta?.onde === 'narracao' ? null : s.pergunta,
        recado: null,
        recadoDetalhe: null,
      })
    },

    estimar: () => {
      if (relogioDaEstimativa) clearTimeout(relogioDaEstimativa)
      relogioDaEstimativa = setTimeout(() => {
        relogioDaEstimativa = null
        const r = rascunhoDaTela()
        const s = get()
        if (!r || r.id !== s.rascunhoId) return
        const take = takeAtual(r)
        const acao = acaoDaNarracao(s.form, take, s.ajustes)
        if (acao.tipo !== 'gerar' && acao.tipo !== 'de-novo') return
        // O cache depende do roteiro e dos takes: qualquer um mudando, a conta muda.
        const chave = chaveDaEstimativa(r, acao.config)
        if (s.estimativa?.chave === chave && (s.estimativa.valor || s.estimativa.carregando)) return
        const id = r.id
        set({ estimativa: { chave, valor: null, erro: null, carregando: true } })
        void ponte.estimarVoz(id, { tipo: 'tudo', config: acao.config }).then((e) => {
          if (get().estimativa?.chave !== chave || !ainda(id)) return
          set({
            estimativa: e.ok
              ? { chave, valor: e.value, erro: null, carregando: false }
              : { chave, valor: null, erro: e.error, carregando: false },
          })
        })
      }, ESPERA_DA_ESTIMATIVA_MS)
    },

    pedirGeracao: async () => {
      const r = rascunhoDaTela()
      const s = get()
      if (!r) return
      const acao = acaoDaNarracao(s.form, takeAtual(r), s.ajustes)
      if (acao.tipo !== 'gerar' && acao.tipo !== 'de-novo') return
      const e = await estimarParaPerguntar('narracao', { tipo: 'tudo', config: acao.config })
      if (!e) return
      set({ pergunta: { acao: 'gerar', onde: 'narracao', config: acao.config, fraseIds: [], estimativa: e } })
    },

    pedirRegravar: async (fraseIds, onde) => {
      const r = rascunhoDaTela()
      if (!r || !takeAtual(r)) return
      const e = await estimarParaPerguntar(onde, { tipo: 'frases', fraseIds })
      if (!e) return
      set({ pergunta: { acao: 'regravar', onde, config: null, fraseIds, estimativa: e } })
    },

    confirmar: async () => {
      const q = get().pergunta
      if (!q || get().pedido) return
      const confirmado = q.estimativa.aCobrar
      if (q.acao === 'gerar' && q.config) {
        const config = q.config
        await executar('gerar', [], (id, pedidoId) => ponte.gerarVoz(id, { config, pedidoId, confirmado }))
        return
      }
      const fraseIds = q.fraseIds
      await executar('regravar', q.estimativa.fraseIds, (id, pedidoId) =>
        ponte.regravarFrases(id, { fraseIds, pedidoId, confirmado }),
      )
    },

    desistir: () => set({ pergunta: null }),

    aplicarAjuste: async () => {
      const { velocidade, cortarPausas } = get().form
      await executar('ajustar', [], (id, pedidoId) =>
        ponte.ajustarVoz(id, { velocidade: arredondar(velocidade), cortarPausas, pedidoId }),
      )
    },

    importar: async (caminho) => {
      const s = get()
      if (s.pedido) {
        set({ erro: 'Espere a voz terminar (ou cancele) antes de importar.' })
        return
      }
      // Soltou um audio com outra fonte na tela: a tela passa a ser a do importado.
      const form = s.form.fonte === 'importado' ? s.form : { ...s.form, fonte: 'importado' as const, velocidade: 1, cortarPausas: false }
      if (form !== s.form) set({ form, formMexido: true })
      await executar('importar', [], (id, pedidoId) =>
        ponte.importarAudio(id, {
          caminho,
          velocidade: arredondar(form.velocidade),
          cortarPausas: form.cortarPausas,
          pedidoId,
        }),
      )
    },

    escolherArquivo: async () => {
      if (get().pedido) return
      const r = await ponte.escolherNarracao()
      if (!r.ok) {
        set({ erro: r.error })
        return
      }
      if (r.value) await get().importar(r.value)
    },

    cancelar: () => {
      const p = get().pedido
      if (!p) return
      // O main manda a resposta deste pedido so para a lista de Takes.
      if (p.comecou) void ponte.cancelarVoz(p.rascunhoId, String(p.token))
      if (relogioDoCancelado) clearTimeout(relogioDoCancelado)
      set({
        pedido: null,
        pedidoCancelado: p,
        recado: 'Cancelado.',
        recadoDetalhe: p.tipo === 'gerar' || p.tipo === 'regravar' ? 'Se a voz ja tiver chegado (paga), ela fica em Takes.' : null,
      })
      relogioDoCancelado = setTimeout(() => {
        relogioDoCancelado = null
        if (get().pedidoCancelado?.token === p.token) set({ pedidoCancelado: null })
      }, CANCELADO_POR_MS)
    },

    escolherTake: async (takeId) => {
      const r = rascunhoDaTela()
      if (!r || get().pedido || get().aprovando) return
      if (r.voz?.atual === takeId) return
      const id = r.id
      const v = await ponte.escolherTake(id, takeId)
      if (!ainda(id)) return
      if (!v.ok) {
        set({ erro: v.error })
        return
      }
      trocarRascunho(v.value)
      // O recado era do take de antes ("1.034 caracteres gastos"): nao vale para este.
      set({ recado: null, recadoDetalhe: null, pergunta: null })
      get().sincronizar()
      void get().carregarAudio(takeId)
    },

    aprovar: async () => {
      const r = rascunhoDaTela()
      if (!r || get().pedido || get().aprovando) return
      const id = r.id
      set({ aprovando: true, erro: null })
      const a = await ponte.aprovarVoz(id)
      if (!ainda(id)) return
      if (!a.ok) {
        set({ aprovando: false, erro: a.error })
        return
      }
      trocarRascunho(a.value)
      set({ aprovando: false, recado: null, recadoDetalhe: null })
    },

    desaprovar: async () => {
      const r = rascunhoDaTela()
      if (!r?.voz?.aprovado || get().pedido) return
      const id = r.id
      const a = await ponte.desaprovarVoz(id)
      if (!ainda(id)) return
      if (!a.ok) set({ erro: a.error })
      else trocarRascunho(a.value)
    },

    carregarAudio: async (takeId) => {
      const r = rascunhoDaTela()
      if (!r) return
      const chave = chaveDoAudio(r.id, takeId)
      const s = get()
      if (s.audios[chave] || s.carregandoAudio === chave) return
      set({ carregandoAudio: chave, audioErro: s.audioErro?.chave === chave ? null : s.audioErro })
      const a = await ponte.urlDoAudio(r.id, takeId)
      if (get().carregandoAudio === chave) set({ carregandoAudio: null })
      if (!a.ok) {
        set({ audioErro: { chave, erro: a.error } })
        return
      }
      set({ audios: { ...get().audios, [chave]: a.value } })
    },

    abrirAjustesDeVoz: () => {
      set({ ajustesDeVozPedidos: true })
      nucleo().abrirConfiguracoes('recap-voz')
    },
    ajustesDeVozVistos: () => set({ ajustesDeVozPedidos: false }),

    limparErro: () => set({ erro: null }),
    limparRecado: () => set({ recado: null, recadoDetalhe: null }),
  }
})

/** O audio publicado do take, se ja chegou. */
export function audioDoTake(s: Pick<EstadoDaVozNaTela, 'audios'>, rascunhoId: string, takeId: string): AudioDoTake | null {
  return s.audios[chaveDoAudio(rascunhoId, takeId)] ?? null
}

/**
 * Em que pe a voz do rascunho na tela esta, contra o roteiro ATUAL. null = sem
 * rascunho. O cabecalho (o check do "3 Voz") e o rodape perguntam a mesma.
 */
export function useSituacaoDaVoz(): SituacaoDaVoz | null {
  const rascunho = useRoteiro((s) => s.rascunho)
  return useMemo(() => (rascunho ? situacaoDaVoz(rascunho, roteiroAtual(rascunho)) : null), [rascunho])
}

/**
 * Liga a escuta do andamento do motor de voz. Devolve a funcao que desliga.
 * Monta com o app (GerarRecap), como as dos passos 1 e 2.
 */
export function escutarVoz(): () => void {
  return ponte.onVozProgresso((p) => {
    const pedido = useVoz.getState().pedido
    // O andamento de um pedido cancelado (ou de outro rascunho) nao fala do que esta na tela.
    if (!pedido || !pedido.comecou || pedido.rascunhoId !== p.rascunhoId || String(pedido.token) !== p.pedidoId) return
    useVoz.setState({ pedido: { ...pedido, etapa: p.etapa, mensagem: p.mensagem, fracao: p.fracao } })
  })
}

// ---------------------------------------------------------------- o tocador

interface EstadoDoTocador {
  /** `${rascunhoId}:${takeId}` carregado. null = nada. */
  chave: string | null
  tocando: boolean
  /** Segundos no arquivo do take. */
  tempo: number
  duracao: number
  /** Ja tocou ou foi movido desde que carregou: so entao a frase sob a agulha acende. */
  usado: boolean
  /** Indice (nas palavras do take) da palavra acesa. -1 = nenhuma ainda. */
  palavra: number
  /** A frase sob a agulha (pelo trecho). null = fora. */
  frase: string | null
  /** Tocando so o trecho desta frase (o play da linha). null = tocando livre. */
  trecho: string | null
  erro: string | null
}

/**
 * O TOCADOR do passo 3: um <audio> so, fora do React, com o tempo publicado a
 * cada quadro enquanto toca. As linhas das frases leem so `frase` e
 * `palavra` (primitivos): a cada palavra nova redesenha so a linha que toca.
 */
export const useTocador = create<EstadoDoTocador>(() => ({
  chave: null,
  tocando: false,
  tempo: 0,
  duracao: 0,
  usado: false,
  palavra: -1,
  frase: null,
  trecho: null,
  erro: null,
}))

let elemento: HTMLAudioElement | null = null
let palavrasDoTake: readonly PalavraComTempo[] = []
let trechosDoTake: readonly TrechoDaFrase[] = []
/** Onde o play da linha para (o fim do trecho da frase). null = toca ate o fim. */
let fimDoTrecho: number | null = null
let quadro = 0

/** Publica o tempo (e a palavra e a frase dele), so o que mudou. */
function marcar(t: number): void {
  const palavra = palavraNoTempo(palavrasDoTake, t)
  const frase = fraseNoTempo(trechosDoTake, t)
  const s = useTocador.getState()
  if (s.tempo !== t || s.palavra !== palavra || s.frase !== frase) useTocador.setState({ tempo: t, palavra, frase })
}

/** O tempo do audio agora, parando no fim do trecho quando toca so uma frase. */
function andar(el: HTMLAudioElement): void {
  let t = el.currentTime
  if (fimDoTrecho !== null && t >= fimDoTrecho) {
    // Volta um triz para DENTRO do trecho: o quadro passa alguns ms da fronteira,
    // e a agulha la fora acenderia a frase seguinte.
    t = Math.max(0, fimDoTrecho - 0.001)
    fimDoTrecho = null
    el.pause()
    el.currentTime = t
    useTocador.setState({ trecho: null })
  }
  marcar(t)
}

function seguir(): void {
  if (quadro) return
  const passo = (): void => {
    quadro = 0
    const el = elemento
    if (!el) return
    andar(el)
    if (!el.paused) quadro = requestAnimationFrame(passo)
  }
  quadro = requestAnimationFrame(passo)
}

function audioDoTocador(): HTMLAudioElement {
  if (elemento) return elemento
  const el = new Audio()
  el.preload = 'auto'
  el.addEventListener('play', () => {
    useTocador.setState({ tocando: true, usado: true, erro: null })
    seguir()
  })
  el.addEventListener('pause', () => {
    useTocador.setState({ tocando: false })
    marcar(el.currentTime)
  })
  el.addEventListener('ended', () => {
    fimDoTrecho = null
    useTocador.setState({ tocando: false, trecho: null })
  })
  el.addEventListener('seeked', () => marcar(el.currentTime))
  /*
   * Janela coberta ou minimizada: o requestAnimationFrame para, e o "so esta
   * frase" tocaria ate o fim da narracao. O timeupdate (~4 por segundo) segue
   * rodando e garante a parada (com folga de um quarto de segundo, so nesse caso).
   */
  el.addEventListener('timeupdate', () => {
    if (!el.paused) andar(el)
  })
  el.addEventListener('error', () => {
    // Sem src (descarregar) tambem dispara 'error': so vale com um take carregado.
    if (useTocador.getState().chave) useTocador.setState({ tocando: false, erro: 'Nao deu para tocar este audio.' })
  })
  elemento = el
  return el
}

function tocarAgora(el: HTMLAudioElement): void {
  void el.play().catch((e: unknown) => {
    // Pausa antes de o play resolver (cliques rapidos) nao e erro.
    if (e instanceof DOMException && e.name === 'AbortError') return
    useTocador.setState({ tocando: false, erro: 'Nao deu para tocar este audio.' })
  })
}

export const tocador = {
  /** Poe o take no tocador. O mesmo take de novo so troca as palavras (o take e imutavel). */
  carregar(chave: string, url: string, take: Pick<TakeDaVoz, 'palavras' | 'trechos' | 'duracao'>): void {
    palavrasDoTake = take.palavras
    trechosDoTake = take.trechos
    const el = audioDoTocador()
    if (useTocador.getState().chave === chave && el.src === url) return
    el.pause()
    fimDoTrecho = null
    el.src = url
    el.load()
    useTocador.setState({
      chave,
      tocando: false,
      tempo: 0,
      duracao: take.duracao,
      usado: false,
      palavra: -1,
      frase: null,
      trecho: null,
      erro: null,
    })
  },

  /** Para e esquece (saiu do passo 3, ou o take sumiu). */
  descarregar(): void {
    fimDoTrecho = null
    palavrasDoTake = []
    trechosDoTake = []
    useTocador.setState({ chave: null, tocando: false, tempo: 0, duracao: 0, usado: false, palavra: -1, frase: null, trecho: null, erro: null })
    if (!elemento) return
    elemento.pause()
    elemento.removeAttribute('src')
    elemento.load()
  },

  /** O play/pause da narracao inteira: segue de onde a agulha esta (do comeco, se acabou). */
  alternar(): void {
    const el = elemento
    if (!el || !useTocador.getState().chave) return
    if (!el.paused) {
      el.pause()
      return
    }
    fimDoTrecho = null
    useTocador.setState({ trecho: null })
    const s = useTocador.getState()
    if (el.ended || el.currentTime >= s.duracao - 0.02) el.currentTime = 0
    tocarAgora(el)
  },

  pausar(): void {
    elemento?.pause()
  },

  /** Leva a agulha (clique na onda, setas). Sai do modo "so esta frase". */
  irPara(t: number): void {
    const el = elemento
    const s = useTocador.getState()
    if (!el || !s.chave) return
    const alvo = Math.min(Math.max(0, t), s.duracao)
    fimDoTrecho = null
    el.currentTime = alvo
    useTocador.setState({ trecho: null, usado: true })
    marcar(alvo)
  },

  /**
   * O play da linha: toca so o trecho da frase. De novo com ele tocando =
   * pausa; e de novo depois da pausa SEGUE de onde parou (como o play geral),
   * nao volta ao comeco da frase.
   */
  tocarTrecho(fraseId: string): void {
    const el = elemento
    if (!el || !useTocador.getState().chave) return
    const tr = trechosDoTake.find((t) => t.fraseId === fraseId)
    if (!tr) return
    const s = useTocador.getState()
    if (s.trecho === fraseId && s.tocando) {
      el.pause()
      return
    }
    fimDoTrecho = tr.offset + tr.duracao
    const pausadaNela = s.trecho === fraseId && el.currentTime >= tr.offset && el.currentTime < fimDoTrecho - 0.05
    if (pausadaNela) {
      tocarAgora(el)
      return
    }
    el.currentTime = tr.offset
    useTocador.setState({ trecho: fraseId, usado: true })
    marcar(tr.offset)
    tocarAgora(el)
  },
}

// Em dev, alcancavel pelo console e pelo teste por CDP, como o roteiroStore.
if (import.meta.env.DEV) {
  Reflect.set(window, 'vozStore', useVoz)
  Reflect.set(window, 'tocadorStore', useTocador)
}
