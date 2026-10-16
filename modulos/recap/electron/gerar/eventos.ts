import type { EpisodeIndex } from '../../shared/episodio'
import {
  cuesElegiveis,
  eventosDaIaSchema,
  montarEventos,
  semAcentos,
  type Evento,
  type EventosDaIa,
  type EventosGerados,
  type ProgressoDoRoteiro,
} from '../../shared/roteiro'
import { gerarComCache, nomeDoProvedor, paradaDoPasso, type RespostaDoPasso } from './ia'
import { acertarNomesDosEventos, elencoDoEpisodio, type Elenco } from './nomes'
import { promptDeEventos, SISTEMA_EVENTOS } from './prompts'
import { gravarRascunho, indiceDoRascunho, lerRascunhoDoDisco } from './rascunho'

/**
 * Passo 2a: os ACONTECIMENTOS do episodio (15-40 eventos), presos as falas.
 *
 * - se o rascunho ja tem eventos, devolve os mesmos com doCache: true e NAO
 *   chama a IA (os roteiros citam esses ids);
 * - manda ao LLM so as cuesElegiveis (fala, fora de OP/ED), numeradas
 *   `[c0123 12:03] (Senku) texto`, com o elenco na grafia da legenda;
 * - montarEventos faz o resto: t0/t1 SAEM DAS CUES, cue de placa, de musica,
 *   de OP/ED ou inexistente sai, evento sem cue valida sai (com aviso);
 * - nenhum evento valido: uma nova tentativa com o aviso; de novo nada = erro;
 * - so modelo reserva livre e `permitirReserva` desligado (o padrao): PARA
 *   sem chamar e devolve ParadoNoReserva, sem gravar nada. Os eventos ficam
 *   fixos no rascunho, entao eventos do reserva pesariam em todo roteiro dele.
 */

export interface OpcoesDosEventos {
  /** O usuario aceitou o modelo reserva ("Usar modelo reserva"). Padrao false. */
  permitirReserva?: boolean
}

/** Uma geracao por rascunho de cada vez: dois cliques (ou o roteiro pedindo junto) nao gastam cota duas vezes. */
const emAndamento = new Map<string, Promise<EventosGerados>>()

export function gerarEventos(
  rascunhoId: string,
  avisar: (progresso: ProgressoDoRoteiro) => void,
  opcoes: OpcoesDosEventos = {},
): Promise<EventosGerados> {
  const ja = emAndamento.get(rascunhoId)
  if (ja) return ja
  const p = gerar(rascunhoId, avisar, opcoes.permitirReserva === true).finally(() => emAndamento.delete(rascunhoId))
  emAndamento.set(rascunhoId, p)
  return p
}

/** Duas falas citadas a mais de 3 min uma da outra no mesmo evento: o evento perde o "onde". */
const EVENTO_LONGO_SEC = 180

/**
 * Palavras com maiuscula que o portugues usa para o mundo real e que a
 * legenda em ingles escreve de outro jeito ("Earth" -> "Terra"): nao sao nome
 * inventado.
 */
const NOMES_DO_MUNDO = new Set([
  'terra', 'lua', 'sol', 'marte', 'venus', 'jupiter', 'saturno', 'japao', 'brasil', 'america', 'americas', 'europa',
  'africa', 'asia', 'china', 'eua', 'estados', 'unidos', 'deus', 'deuses', 'natal', 'ano', 'novo',
])

/**
 * Nomes do resumo que nao aparecem em nenhuma fala nem no elenco: o modelo
 * puxou do que sabe da obra ("Reino da Ciencia" num episodio que nao fala
 * dele) e o roteiro repetia. So vira aviso no log -- quem evita e a regra
 * "so nomes que estao nas falas" do prompt; aqui fica o rastro para conferir.
 */
function nomesForaDasFalas(eventos: readonly Evento[], indice: EpisodeIndex, elenco: Elenco): string[] {
  const falas = ` ${semAcentos(indice.cues.map((c) => `${c.texto} ${c.falante ?? ''}`).join(' ')).replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  const conhecidos = new Set(
    elenco.personagens.flatMap((p) => [p.nome, ...p.doIndice]).flatMap((n) => semAcentos(n).match(/[\p{L}\p{N}]+/gu) ?? []),
  )
  const avisos: string[] = []
  for (const ev of eventos) {
    const estranhos = new Set<string>()
    for (const frase of ev.resumo.split(/[.!?]\s+/)) {
      // A primeira palavra da frase tem maiuscula por ser a primeira.
      for (const cru of frase.split(/\s+/).slice(1)) {
        const palavra = cru.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
        if (!/^\p{Lu}/u.test(palavra) || palavra.length < 3) continue
        // Hifen e apostrofo viram espaco, como nas falas: "Why-man" acha "Why-Man".
        const forma = semAcentos(palavra).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
        if (NOMES_DO_MUNDO.has(forma) || conhecidos.has(forma) || falas.includes(` ${forma} `)) continue
        estranhos.add(forma.charAt(0).toUpperCase() + forma.slice(1))
      }
    }
    if (estranhos.size > 0) avisos.push(`Evento ${ev.id} cita nomes que nao estao nas falas: ${[...estranhos].join(', ')}.`)
  }
  return avisos
}

async function gerar(
  rascunhoId: string,
  avisar: (progresso: ProgressoDoRoteiro) => void,
  permitirReserva: boolean,
): Promise<EventosGerados> {
  const r = lerRascunhoDoDisco(rascunhoId)
  if (r.eventos.length > 0) return { rascunho: r, doCache: true, avisos: [] }

  const { indice } = indiceDoRascunho(r)
  const falas = cuesElegiveis(indice)
  if (falas.length === 0) {
    throw new Error(
      indice.cues.some((c) => c.tipo === 'fala')
        ? 'Todas as falas caem na abertura ou no encerramento. Confira a regua no passo 1.'
        : 'Esse episodio nao tem falas (sem legenda de texto). Volte ao passo 1 e escolha uma legenda.',
    )
  }

  const elenco = elencoDoEpisodio(indice)
  const quem = nomeDoProvedor()
  let aviso: string | null = null
  let doCache = true
  let modelo = ''
  let eventos: Evento[] = []
  let avisos: string[] = []

  for (let tentativa = 0; tentativa < 2; tentativa++) {
    // A etapa ja esta no titulo do andamento: aqui so quem responde e quanto leva.
    avisar({
      rascunhoId,
      etapa: 'eventos',
      mensagem: tentativa === 0 ? `${quem} · 1 a 3 min` : `Pedindo de novo · ${quem}`,
    })
    const resposta: RespostaDoPasso<EventosDaIa> = await gerarComCache({
      schema: eventosDaIaSchema,
      sistema: SISTEMA_EVENTOS,
      prompt: promptDeEventos({ indice, falas, elenco, aviso }),
      etapa: 'eventos',
      maxTokens: 16000,
      permitirReserva,
    })
    if (!resposta.ok) {
      if (resposta.motivo === 'so-reserva') return paradaDoPasso(resposta, 'eventos')
      throw new Error(resposta.nota)
    }
    doCache &&= resposta.doCache
    modelo = resposta.modelo
    const montado = montarEventos(acertarNomesDosEventos(resposta.valor, elenco), indice)
    eventos = montado.eventos
    avisos = montado.avisos
    if (eventos.length > 0) {
      // So agora entra no cache: a resposta sem nenhum evento valido nao pode
      // voltar do cache no "Tente de novo".
      resposta.guardar()
      break
    }
    aviso =
      `nenhum dos ${resposta.valor.eventos.length} acontecimentos citou uma fala valida da lista. ` +
      'Use so os ids que aparecem entre colchetes nas FALAS (ex.: "c0123"), sem o tempo.'
  }
  if (eventos.length === 0) throw new Error('A IA nao devolveu acontecimentos validos. Tente de novo.')

  const longos = eventos.filter((e) => e.t1 - e.t0 > EVENTO_LONGO_SEC)
  if (longos.length > 0) {
    avisos.push(`${longos.length} evento(s) juntam falas distantes (mais de 3 min): ${longos.map((e) => e.id).join(', ')}.`)
  }
  avisos.push(...nomesForaDasFalas(eventos, indice, elenco))

  // Relido agora: sem await daqui ate gravar (ver rascunho.ts).
  if (avisos.length > 0) console.log(`[gerar:eventos] ${avisos.join(' | ')}`)
  const atual = lerRascunhoDoDisco(rascunhoId)
  if (atual.eventos.length > 0) return { rascunho: atual, doCache: true, avisos: [] }
  const quando = new Date().toISOString()
  const rascunho = { ...atual, eventos, eventosMeta: { modelo, criadoEm: quando }, atualizadoEm: quando }
  gravarRascunho(rascunho)
  return { rascunho, doCache, avisos }
}
