import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  adicionarTake,
  escolherTake,
  estadoDaVoz,
  frasesMudadas,
  modeloEleven,
  proximoTakeId,
  ROTULO_DA_FONTE,
  takeAtual,
  textoParaNarrar,
  vozDesatualizada,
  type ChamadaAoProvedor,
  type EtapaDaVoz,
  type FraseParaNarrar,
  type OrigemDoAlinhamento,
  type PedidoDeAjuste,
  type PedidoDeGeracao,
  type PedidoDeImportacao,
  type PedidoDeRegravar,
  type ProgressoDaVoz,
  type TakeDaVoz,
  type VozGerada,
} from '../../shared/voz'
import { gravarRascunho, lerRascunhoDoDisco } from '../gerar/rascunho'
import { alinharPeloAudio } from './alinhamento'
import { marcarOuvidos } from './cache'
import { planejarFrases, planejarTudo } from './estimar'
import { Cancelado } from './ffmpeg'
import { importarAudioDoLevi, traduzirAndamento } from './importado'
import { brutoPeloSom, emendar, montarTake, type BrutoMontado, type PedacoNovo } from './montar'
import { palavrasPeloRoteiro, palavrasPeloTexto, palavrasDosCaracteres, type PalavrasCasadas } from './palavras'
import { arquivoDaVoz } from './pastas'
import { cancelarPedido, comecarPedido, terminarPedido } from './pedidos'
import { creditosPorCaractere, cumprirPlano, type VozDoProvedor } from './provedor'
import { aprenderRitmo } from './ritmo'
import { lerWavDoDisco, wavDoPcm } from './wav'

/**
 * O MOTOR DE VOZ do passo 3: faz takes. Contrato em shared/voz.ts.
 *
 * Os arquivos desta pasta:
 *   estimar.ts   o plano (o que pedir, qual chave do cache, quanto custa) --
 *                o MESMO na estimativa e aqui, entao o custo mostrado e o cobrado
 *                nunca divergem;
 *   cache.ts     nunca pagar duas vezes (chave por texto+voz+modelo+settings+
 *                contexto+formato, variante para "de novo" explicito);
 *   provedor.ts  cache -> ElevenLabs (eleven.ts) / Fish (fish.ts) -> PCM;
 *   palavras.ts  caracteres -> palavras DO ROTEIRO, e trechos por frase;
 *   alinhamento.ts  Whisper + wav2vec2 do Dangai (Fish, importado, reserva);
 *   pos.ts       corte de pausa (pelo alinhamento) + acelerar (atempo), remapeamento exato;
 *   ritmo.ts     palavras por segundo de cada take (o roteiro seguinte mira o alvo nele);
 *   montar.ts    bruto -> take, e a emenda do "Regravar esta frase";
 *   importado.ts o audio gravado pelo Levi;
 *   wav.ts/ffmpeg.ts  WAV canonico enderecado por conteudo e o ffmpeg do projeto.
 *
 * TODOS os pedidos: comecarPedido/terminarPedido (um por rascunho) e o rascunho
 * RELIDO do disco na hora de gravar (a parte lenta vem antes, sem await entre
 * ler e gravar). Cancelar antes de pagar = "Cancelado."; cancelar depois de a
 * resposta paga voltar = o take sai do mesmo jeito e entra so no historico
 * (soNoHistorico). O que foi pago nunca se perde: ja esta no cache.
 */

export type AvisarProgressoDaVoz = (progresso: ProgressoDaVoz) => void

type Avisar = (etapa: EtapaDaVoz, mensagem: string, fracao?: number | null) => void

function avisador(progresso: AvisarProgressoDaVoz, rascunhoId: string, pedidoId: string): Avisar {
  return (etapa, mensagem, fracao = null) => {
    try {
      progresso({ rascunhoId, pedidoId, etapa, mensagem, fracao })
    } catch {
      /* janela fechada no meio: o take continua */
    }
  }
}

/** O pedido inteiro dentro do registro de pedidos (Cancelar, um por rascunho). */
async function comPedido<T>(rascunhoId: string, pedidoId: string, fazer: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const signal = comecarPedido(rascunhoId, pedidoId)
  try {
    return await fazer(signal)
  } finally {
    terminarPedido(rascunhoId, pedidoId)
  }
}

function conferirCusto(aCobrar: number, confirmado: number): void {
  if (aCobrar > confirmado + 1e-6) throw new Error('O custo mudou: confira de novo.')
}

/**
 * A frase da etapa 'ajustando': o que o pos faz AGORA ("Acelerando 1,10x",
 * "Cortando pausas"). Com `antes` (o ajuste de um take), so o que mudou. Sem
 * corte e sem acelerar, so o volume e igualado.
 */
function mensagemDoPos(c: Pick<TakeDaVoz['config'], 'velocidade' | 'cortarPausas'>, antes?: Pick<TakeDaVoz['config'], 'velocidade' | 'cortarPausas'>): string {
  const partes: string[] = []
  const velocidade = `acelerando ${c.velocidade.toFixed(2).replace('.', ',')}x`
  if (antes) {
    if (antes.cortarPausas !== c.cortarPausas) partes.push(c.cortarPausas ? 'cortando pausas' : 'devolvendo as pausas')
    if (Math.abs(antes.velocidade - c.velocidade) > 1e-6) partes.push(velocidade)
  } else {
    if (c.cortarPausas) partes.push('cortando pausas')
    if (Math.abs(c.velocidade - 1) > 1e-6) partes.push(velocidade)
  }
  const texto = partes.length > 0 ? partes.join(' e ') : 'igualando o volume'
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}...`
}

/** A pior origem entre as partes de um take (provedor < normalizado < alinhador). */
function piorOrigem(origens: readonly OrigemDoAlinhamento[]): OrigemDoAlinhamento {
  if (origens.includes('alinhador')) return 'alinhador'
  if (origens.includes('normalizado')) return 'normalizado'
  return 'provedor'
}

/**
 * Grava o take no rascunho RELIDO (sem await entre ler e gravar): id novo,
 * adicionarTake, e as chaves do cache marcadas como ouvidas.
 */
function gravarTake(
  rascunhoId: string,
  take: TakeDaVoz,
  soNoHistorico: boolean,
  chavesOuvidas: readonly string[],
): VozGerada {
  const r = lerRascunhoDoDisco(rascunhoId)
  const comId: TakeDaVoz = { ...take, id: proximoTakeId(estadoDaVoz(r)) }
  const novo = adicionarTake(r, comId, new Date().toISOString(), soNoHistorico)
  gravarRascunho(novo)
  marcarOuvidos(rascunhoId, chavesOuvidas)
  // O ritmo de verdade desta voz (palavras / segundos do take final): o proximo roteiro mira o alvo nele.
  aprenderRitmo(comId)
  return { rascunho: novo, take: comId, cobrados: comId.cobrados, soNoHistorico, avisos: comId.avisos }
}

function chamadaDe(voz: VozDoProvedor, fraseIds: string[]): ChamadaAoProvedor {
  return { requestId: voz.requestId, caracteres: voz.caracteres, doCache: voz.doCache, fraseIds, formato: voz.formato }
}

// ------------------------------------------------------------- palavras

interface PalavrasDaVoz {
  casadas: PalavrasCasadas
  origem: OrigemDoAlinhamento
  score: number | null
  avisos: string[]
}

/**
 * As palavras do roteiro numa voz do provedor: o alignment original
 * ('provedor'), o normalizado ('normalizado') ou, sem nenhum dos dois (ou no
 * Fish), o alinhador do Dangai sobre o audio ('alinhador').
 */
async function palavrasDaVoz(
  voz: VozDoProvedor,
  texto: string,
  frases: readonly FraseParaNarrar[],
  avisar: Avisar,
  signal?: AbortSignal,
): Promise<PalavrasDaVoz> {
  if (voz.alignment) {
    const direto = palavrasPeloTexto(voz.alignment, texto, frases)
    if (direto) return { casadas: direto, origem: 'provedor', score: null, avisos: [] }
  }
  const avisos: string[] = []
  for (const a of [voz.normalizado, voz.alignment]) {
    if (!a) continue
    const casadas = palavrasPeloRoteiro(palavrasDosCaracteres(a), frases)
    if (casadas) {
      if (casadas.ancoradas < casadas.total) {
        avisos.push(`${casadas.total - casadas.ancoradas} palavras com tempo estimado (numero ou sigla lida por extenso).`)
      }
      return { casadas, origem: 'normalizado', score: null, avisos }
    }
  }
  // Sem tempo do provedor: o alinhador, num WAV temporario do PCM.
  avisar('alinhando', `Alinhando ${frases.reduce((s, f) => s + f.palavras.length, 0)} palavras...`)
  const pasta = mkdtempSync(join(tmpdir(), 'anirecap-alinhar-'))
  try {
    const arquivo = join(pasta, 'voz.wav')
    writeFileSync(arquivo, wavDoPcm(voz.pcm))
    const r = await alinharPeloAudio(arquivo, frases, {
      whisper: false,
      ...(signal ? { signal } : {}),
      avisar: (m) => {
        const a = traduzirAndamento(m)
        avisar('alinhando', a.mensagem, a.fracao)
      },
    })
    if (voz.alignment || voz.normalizado) avisos.push('O tempo do provedor nao bateu com o roteiro: alinhado pelo audio.')
    return { casadas: r.casadas, origem: 'alinhador', score: r.score, avisos: [...avisos, ...r.avisos] }
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

// ----------------------------------------------------------------- gerarVoz

/** "Gerar voz" / "Gerar tudo de novo": o roteiro inteiro em UM pedido (prosodia continua). */
export async function gerarVoz(
  rascunhoId: string,
  pedido: PedidoDeGeracao,
  progresso: AvisarProgressoDaVoz,
): Promise<VozGerada> {
  return comPedido(rascunhoId, pedido.pedidoId, async (signal) => {
    const avisar = avisador(progresso, rascunhoId, pedido.pedidoId)
    avisar('preparando', 'Preparando...')
    if (pedido.config.fonte === 'importado') throw new Error('Para usar um audio gravado, use Importar audio.')
    const config = pedido.config
    const r = lerRascunhoDoDisco(rascunhoId)
    const p = planejarTudo(rascunhoId, r, config)
    const limite = config.fonte === 'elevenlabs' ? modeloEleven(config.modelId).limite : null
    if (limite !== null && p.caracteres > limite) {
      throw new Error(`O roteiro passa do limite do modelo (${limite.toLocaleString('pt-BR')} caracteres por pedido).`)
    }
    conferirCusto(p.aCobrar, pedido.confirmado)

    avisar('gerando', p.plano.doCache ? 'Voz ja gerada antes: sem custo...' : `Pedindo a voz ao ${ROTULO_DA_FONTE[config.fonte]}...`)
    const voz = await cumprirPlano(p.plano, null, signal)
    const pago = !voz.doCache
    // Depois de pagar, nada mais e abortado: o take sai e vai para o historico.
    const sinal = pago ? undefined : signal
    if (sinal?.aborted) throw new Cancelado()

    const pal = await palavrasDaVoz(voz, p.texto, p.frases, avisar, sinal)
    avisar('montando', 'Montando a narracao...')
    // Bordas das palavras e fronteiras das frases pelo SOM (o tempo do provedor as vezes encosta no silencio).
    const { bruto, avisos: avisosDoSom } = brutoPeloSom(voz.pcm, pal.casadas.palavras, p.frases)
    avisar('ajustando', mensagemDoPos(config))
    const take = await montarTake(
      rascunhoId,
      bruto,
      {
        config,
        origem: pal.origem,
        qualidade: { ancoradas: pal.casadas.ancoradas, total: pal.casadas.total, score: pal.score },
        caracteres: p.caracteres,
        // O cobrado DE FATO (cabecalho character-cost) quando veio; senao a conta da estimativa.
        cobrados: pago ? (voz.custo ?? p.caracteres * creditosPorCaractere(config)) : 0,
        chamadas: [chamadaDe(voz, p.frases.map((f) => f.fraseId))],
        roteiroVersao: p.roteiro.versao,
        derivadoDe: null,
        regravadas: [],
        avisos: [...voz.avisos, ...pal.avisos, ...avisosDoSom],
      },
      sinal,
    )
    if (!pago && signal.aborted) throw new Cancelado()
    return gravarTake(rascunhoId, take, pago && signal.aborted, [voz.chave])
  })
}

// ------------------------------------------------------------ regravarFrases

/** "Regravar esta frase" / "Atualizar a voz": so as frases que precisam, com o contexto das vizinhas. */
export async function regravarFrases(
  rascunhoId: string,
  pedido: PedidoDeRegravar,
  progresso: AvisarProgressoDaVoz,
): Promise<VozGerada> {
  return comPedido(rascunhoId, pedido.pedidoId, async (signal) => {
    const avisar = avisador(progresso, rascunhoId, pedido.pedidoId)
    avisar('preparando', 'Preparando...')
    const r = lerRascunhoDoDisco(rascunhoId)
    const p = planejarFrases(rascunhoId, r, pedido.fraseIds)
    if (p.gerar.length === 0 && !vozDesatualizada(frasesMudadas(p.roteiro, p.take))) {
      throw new Error('A voz ja esta em dia com o roteiro.')
    }
    conferirCusto(p.aCobrar, pedido.confirmado)

    const narrar = textoParaNarrar(p.roteiro).frases
    const porId = new Map(narrar.map((f) => [f.fraseId, f]))
    const novos = new Map<string, PedacoNovo>()
    const chamadas: ChamadaAoProvedor[] = []
    const chaves: string[] = []
    const origens: OrigemDoAlinhamento[] = [p.take.origemDoAlinhamento]
    const avisos: string[] = []
    let pagou = false
    let cobrados = 0
    let ancoradas = 0
    let total = 0
    /*
     * A mesma chave paga uma vez so NESTE pedido: no Fish (sem contexto) duas
     * frases com o mesmo texto sao a mesma leitura. A estimativa ja somou uma
     * vez (planejarFrases); aqui a segunda reaproveita o audio da primeira.
     */
    const pagasAqui = new Map<string, VozDoProvedor>()

    for (const [i, id] of p.gerar.entries()) {
      const f = porId.get(id)!
      const plano = p.planos.get(id)!
      // Cancelou entre duas frases: para de gastar. O que ja veio esta no cache.
      if (signal.aborted) {
        throw new Error(
          pagou ? 'Cancelado. As frases ja pagas ficaram guardadas: regravar de novo nao cobra por elas.' : 'Cancelado.',
        )
      }
      const jaPaga = pagasAqui.get(plano.chave)
      avisar('gerando', `${plano.doCache || jaPaga ? 'Lendo' : 'Gerando'} a frase ${i + 1} de ${p.gerar.length}...`, i / p.gerar.length)
      const voz: VozDoProvedor = jaPaga ? { ...jaPaga, doCache: true, custo: null, avisos: [] } : await cumprirPlano(plano, p.taxa, signal)
      if (!voz.doCache) {
        pagou = true
        pagasAqui.set(plano.chave, voz)
        cobrados += voz.custo ?? voz.caracteres * creditosPorCaractere(p.config)
      }
      const sozinha: FraseParaNarrar = { ...f, de: 0, ate: f.texto.length }
      const pal = await palavrasDaVoz(voz, f.texto, [sozinha], avisar, pagou ? undefined : signal)
      novos.set(id, { pcm: voz.pcm, palavras: pal.casadas.palavras })
      chamadas.push(chamadaDe(voz, [id]))
      chaves.push(voz.chave)
      origens.push(pal.origem)
      ancoradas += pal.casadas.ancoradas
      total += pal.casadas.total
      avisos.push(...voz.avisos, ...pal.avisos)
    }

    avisar('montando', 'Montando a narracao...')
    const sinal = pagou ? undefined : signal
    const atual: BrutoMontado = {
      pcm: lerWavDoDisco(arquivoDaVoz(rascunhoId, p.take.bruto.arquivo)),
      palavras: p.take.bruto.palavras,
      trechos: p.take.bruto.trechos,
    }
    const bruto = emendar(atual, narrar, novos)
    // A qualidade: as frases que ficaram herdam a do take; as novas somam a delas.
    const q = p.take.qualidade
    const mantidas = bruto.palavras.filter((w) => !novos.has(w.fraseId)).length
    const qualidade = q
      ? {
          ancoradas: Math.min(mantidas, Math.round((q.ancoradas / Math.max(1, q.total)) * mantidas)) + ancoradas,
          total: mantidas + total,
          score: q.score,
        }
      : { ancoradas: mantidas + ancoradas, total: mantidas + total, score: null }
    avisar('ajustando', mensagemDoPos(p.config))
    const take = await montarTake(
      rascunhoId,
      bruto,
      {
        config: p.config,
        origem: piorOrigem(origens),
        qualidade,
        caracteres: p.caracteres,
        cobrados,
        chamadas,
        roteiroVersao: p.roteiro.versao,
        derivadoDe: p.take.id,
        regravadas: p.gerar,
        avisos,
      },
      sinal,
    )
    if (!pagou && signal.aborted) throw new Cancelado()
    return gravarTake(rascunhoId, take, pagou && signal.aborted, chaves)
  })
}

// ---------------------------------------------------------------- ajustarVoz

function mesmaConfig(a: TakeDaVoz['config'], b: TakeDaVoz['config']): boolean {
  const ordenar = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(ordenar)
      : typeof x === 'object' && x !== null
        ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, ordenar((x as Record<string, unknown>)[k])]))
        : x
  return JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b))
}

/**
 * Trocar so o pos (acelerar, corte de pausa): o bruto do take atual, outro
 * pos. 0 caractere. A velocidade NATIVA fica a do take (muda-la e gerar de
 * novo, pago). Se ja existe um take com o MESMO bruto e o MESMO ajuste
 * (1,0 -> 1,1 -> 1,0), volta para ele em vez de duplicar.
 */
export async function ajustarVoz(
  rascunhoId: string,
  pedido: PedidoDeAjuste,
  progresso: AvisarProgressoDaVoz,
): Promise<VozGerada> {
  return comPedido(rascunhoId, pedido.pedidoId, async (signal) => {
    const avisar = avisador(progresso, rascunhoId, pedido.pedidoId)
    avisar('preparando', 'Preparando...')
    const r = lerRascunhoDoDisco(rascunhoId)
    const take = takeAtual(r)
    if (!take) throw new Error('Gere ou importe a voz antes de ajustar.')
    const config = { ...take.config, velocidade: pedido.velocidade, cortarPausas: pedido.cortarPausas }
    if (mesmaConfig(config, take.config)) throw new Error('A voz ja esta com esse ajuste.')

    const igual = estadoDaVoz(r).takes.find((t) => t.bruto.arquivo === take.bruto.arquivo && mesmaConfig(t.config, config))
    if (igual) {
      const voltou = escolherTake(r, igual.id, new Date().toISOString())
      gravarRascunho(voltou)
      return { rascunho: voltou, take: igual, cobrados: 0, soNoHistorico: false, avisos: [] }
    }

    avisar('ajustando', mensagemDoPos(config, take.config))
    const novo = await montarTake(
      rascunhoId,
      {
        pcm: lerWavDoDisco(arquivoDaVoz(rascunhoId, take.bruto.arquivo)),
        palavras: take.bruto.palavras,
        trechos: take.bruto.trechos,
      },
      {
        config,
        origem: take.origemDoAlinhamento,
        qualidade: take.qualidade,
        caracteres: 0,
        cobrados: 0,
        chamadas: [],
        roteiroVersao: take.roteiroVersao,
        derivadoDe: take.id,
        regravadas: [],
        avisos: [],
      },
      signal,
    )
    if (signal.aborted) throw new Cancelado()
    return gravarTake(rascunhoId, novo, false, [])
  })
}

// ------------------------------------------------------------- importarAudio

/** O audio que o Levi gravou: Whisper + alinhador com o texto do roteiro. */
export async function importarAudio(
  rascunhoId: string,
  pedido: PedidoDeImportacao,
  progresso: AvisarProgressoDaVoz,
): Promise<VozGerada> {
  return comPedido(rascunhoId, pedido.pedidoId, async (signal) => {
    const avisar = avisador(progresso, rascunhoId, pedido.pedidoId)
    const take = await importarAudioDoLevi(rascunhoId, pedido, avisar, signal)
    if (signal.aborted) throw new Cancelado()
    return gravarTake(rascunhoId, take, false, [])
  })
}

/** O Cancelar do andamento. false = o pedido ja tinha terminado. */
export async function cancelarVoz(rascunhoId: string, pedidoId: string): Promise<boolean> {
  return cancelarPedido(rascunhoId, pedidoId)
}
