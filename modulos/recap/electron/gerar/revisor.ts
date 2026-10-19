import {
  adicionarVersao,
  conectivosRepetidos,
  CONECTIVO_MAX,
  textoDaMuleta,
  faixaDePalavras,
  proximaVersao,
  roteiroAtual,
  textoDaParada,
  textoDosTrechos,
  trechosChapados,
  type RascunhoDoRecap,
  type Roteiro,
} from '../../shared/roteiro'
import {
  comRevisao,
  itensDaRevisao,
  marcasNaTela,
  melhoriaDaIaSchema,
  revisaoDaIaSchema,
  revisaoDaVersao,
  roteiroRevisado,
  type ModoDaRevisao,
  type Revisao,
  type RevisaoFeita,
} from '../../shared/revisao'
import { conferirMelhorias, limitarCrescimento, roteiroMelhorado, trocasDaMelhoria } from '../../shared/melhoria'
import { blocoDoEstilo, instrucoesParaPrompt, temEstilo } from '../../shared/estilo'
import type { EpisodeIndex } from '../../shared/episodio'
import { configDoRecap } from '../contexto'
import { lerEstilo } from './estilo'
import { gerarComCache } from './ia'
import { elencoDoEpisodio, nomesDoElenco, type Elenco } from './nomes'
import { blocoDosEventos, tituloDoEpisodio } from './prompts'
import { gravarRascunho, indiceDoRascunho, lerRascunhoDoDisco } from './rascunho'
import { ritmoDoRascunho } from '../voz/ritmo'

/**
 * [recap] O REVISOR + "NAO ALUCINAR" do passo 2 (shared/revisao.ts): UMA
 * chamada, no provedor padrao (gratis no Gemini). Com o free tier sao 3
 * pedidos por roteiro: eventos + roteiro + revisao.
 *
 * Dois modos (A2, 18/10), um pedido cada:
 * - CORRIGIR ERROS (o de sempre): marca sem prova, contradiz, confusa, fraca
 *   e repetida. O automatico, depois de gerar, so marca; o do botao (na mao)
 *   ja faz a versao 'Revisada' com as sugestoes;
 * - MELHORAR TEXTO: reescreve os trechos chapados (lista de fatos, gancho
 *   fraco, final seco) com gancho e ritmo, no Estilo, e a resposta passa pela
 *   mesma conferencia de prova (shared/melhoria.ts) antes de virar a versao
 *   'Melhorada'.
 *
 * - nunca trava: cota, rede, so o reserva livre -> `pulada: 'falhou'`, com a
 *   nota, e a tela so avisa. Nao usa o modelo reserva (o lite revisando
 *   erraria mais do que acharia);
 * - le o roteiro GRAVADO (a tela grava antes) e grava no rascunho RELIDO na
 *   hora (sem await entre ler e gravar, a regra do rascunho.ts);
 * - com cache: revisar de novo a mesma versao nao gasta;
 * - nao divide a vez do roteiro (naVezDoRoteiro): ele pode pedir "Outra
 *   versao" com a revisao no ar. Uma revisao por rascunho de cada vez.
 * As instrucoes do estilo vao com os nomes mascarados (instrucoesParaPrompt).
 */

export const SISTEMA_REVISOR = `Você é o revisor de roteiros de shorts de anime. Você recebe os ACONTECIMENTOS de um episódio (cada um com as falas da legenda que o provam) e o ROTEIRO de um short, frase por frase, com os acontecimentos que cada frase cita. Você confere CADA frase contra as falas dos acontecimentos que ela cita e aponta o que está errado. Você NÃO reescreve o roteiro inteiro.

PARA CADA FRASE COM PROBLEMA, devolva:
- fraseId: o id da frase, copiado da lista (ex.: "f07").
- problema (o mais grave que ela tiver):
  "sem-prova" — a frase afirma um fato, nome, lugar, número, motivo, relação ou emoção que NÃO está nas falas nem no resumo dos acontecimentos citados (alucinação). O que você sabe da obra e não está nas falas também é sem prova.
  "contradiz" — as falas dizem outra coisa: vítima ou autor trocado; verbo escalado ("sugere" virou "convence", "pede" virou "enfrenta", "menciona" virou "revela"); HIPÓTESE dita como FATO ("maybe", "could", "I think", "what if" viraram certeza ou plano decidido); a IDEIA de um personagem dada a outro ou ao grupo (IDEIA TEM DONO); o que veio depois de um salto de tempo dito como simultâneo.
  "confusa" — "ele"/"ela" sem dono claro (a frase anterior tem outro sujeito, ou dois personagens), frase que o espectador não entende sozinha, ordem que confunde.
  "fraca" — genérica, sem informação nova, clichê, ou gancho que não prende quando o episódio tem algo mais forte.
  "repetida" — repete o fato ou as palavras de outra frase do roteiro.
- motivo: o porquê, curto (até 15 palavras), em português do Brasil; cite a fala quando ajudar.
- sugestao: a frase reescrita que resolve o problema — UMA frase só, no mesmo tom falado (português do Brasil, "pra", "tá") e no mesmo tamanho (5 a 12 palavras), sem inventar nada que as falas não sustentem: o fato errado sai ou vira o que as falas dizem. Mantenha os nomes como no ELENCO. null quando o certo é cortar a frase.

REGRAS:
- Frase de ligação, pergunta ao espectador e fechamento sem fato ("E agora?") não têm o que provar: só marque se forem confusas, fracas ou repetidas.
- Tom dramatizado ("e o pior", "caraca") não é problema; fato exagerado é.
- Na dúvida, NÃO marque. Marque só o que importa: no máximo 10 frases, as mais graves primeiro.
- Frase sem problema não entra na lista.`

/** O "Melhorar texto": o sistema, com o estilo dele (o bloco inteiro) quando ha. */
export function sistemaDaMelhoria(estilo: string | null): string {
  const base = `Você é o editor de roteiros de shorts de anime. Você recebe os ACONTECIMENTOS citados (cada um com as falas da legenda que o provam) e o ROTEIRO de um short, frase por frase. Sua tarefa: MELHORAR O TEXTO sem mudar os fatos — reescrever os trechos chapados com gancho e ritmo.

O QUE MELHORAR:
- TRECHO CHAPADO ("lista de acontecimentos"): frases seguidas no mesmo molde (sujeito + verbo + fato, do mesmo tamanho), sem virada nem emoção. Os trechos que o app achou vêm marcados no pedido; olhe também o resto. Reescreva com conectivos de virada ("mas", "só que", "até que", "e aí"; um de cada, sem repetir), variando o tamanho (uma frase curta de impacto no meio) e com a emoção que os acontecimentos dizem.
- GANCHO FRACO: a primeira frase tem que jogar quem assiste dentro do conflito ou do absurdo mais forte do roteiro.
- VIRADA TARDE: se a virada só chega depois da metade, anuncie antes com um micro-gancho ("Só que tinha um detalhe."), sem mudar a ordem dos fatos.
- FINAL SECO: a última frase deixa consequência, pergunta ou "e agora?".${
    estilo ? '\n- O TOM e a ESTRUTURA são os do ESTILO DO EDITOR (no fim destas instruções): o jeito dele de abrir, de costurar e de fechar.' : ''
  }

REGRAS (não negociáveis):
- MESMOS FATOS: a frase reescrita só pode dizer o que os acontecimentos que ELA cita sustentam (as falas e o resumo). Nada de fato, nome, motivo, emoção ou número novo. HIPÓTESE continua hipótese; IDEIA TEM DONO; o verbo não escala ("sugere" não vira "convence").
- A frase reescrita continua com a MESMA função e os mesmos acontecimentos: só o jeito de dizer muda. Não junte duas frases numa e não corte frase.
- Uma frase vira UMA frase (um ponto final no fim). Se ajudar o ritmo, pode virar DUAS frases curtas, separadas por ponto.
- MESMO TAMANHO: o tempo do short é fixo. Cada frase reescrita fica com no máximo 2 palavras a mais que a original, e o roteiro inteiro não cresce (se uma frase ganhar palavras, outra perde).
- CONECTIVO NÃO VIRA MULETA: o mesmo conectivo abrindo frase ("só que", "mas", "e aí", "até que", "então", "aí") aparece no máximo ${CONECTIVO_MAX} vezes no roteiro INTEIRO, contando as frases que você não reescreve. Se ele já está ${CONECTIVO_MAX} vezes, use outra virada ou nenhuma.
- Nomes exatamente como no ELENCO; "ele"/"ela" só retomam o sujeito da frase anterior.
- Nada de markdown, emoji, hashtag nem rótulo de seção.
- Frase que já está boa NÃO entra na lista. No máximo 12 frases: as que mais mudam o roteiro.

PARA CADA FRASE MELHORADA, devolva:
- fraseId: o id copiado da lista (ex.: "f07");
- motivo: curto, até 6 palavras ("lista de fatos", "gancho fraco", "final seco", "virada tarde");
- sugestao: o texto novo.`
  return estilo ? `${base}\n\n${estilo}` : base
}

export interface EntradaDoRevisor {
  indice: Pick<EpisodeIndex, 'anime' | 'temporada' | 'episodio' | 'kind' | 'cues' | 'exclusoes' | 'planos'>
  eventos: RascunhoDoRecap['eventos']
  elenco: Elenco
  roteiro: Pick<Roteiro, 'secoes'>
  /** As instrucoes do "Meu estilo" (so o texto dele, mascarado, sem os exemplos): a sugestao segue o tom. */
  instrucoes?: string | null
}

/** O cabecalho e os acontecimentos citados, iguais nos dois modos. */
function comecoDoPedido(e: EntradaDoRevisor): string[] {
  // So os acontecimentos citados (com todas as falas deles); roteiro sem citacao nenhuma leva todos.
  const citados = new Set(e.roteiro.secoes.flatMap((s) => s.frases.flatMap((f) => f.eventoIds)))
  const eventos = citados.size > 0 ? e.eventos.filter((ev) => citados.has(ev.id)) : e.eventos
  const nomes = nomesDoElenco(e.elenco)
  return [
    `EPISÓDIO: ${tituloDoEpisodio(e.indice)}`,
    `ELENCO (grafia da legenda): ${nomes.length > 0 ? nomes.join(', ') : '(a legenda não traz nomes)'}`,
    '',
    'ACONTECIMENTOS CITADOS (id [início-fim] peso | personagens: resumo; embaixo, quem está em cena e as falas do trecho):',
    blocoDosEventos(eventos, e.indice, e.elenco),
    '',
  ]
}

/** O roteiro com os ids (o que os dois modos devolvem por frase). */
function roteiroComIds(roteiro: Pick<Roteiro, 'secoes'>): string[] {
  const linhas = ['ROTEIRO (id: frase (acontecimentos citados)):']
  for (const s of roteiro.secoes) {
    linhas.push(`[${s.id} · ${s.papel}]`)
    for (const f of s.frases) {
      const texto = f.texto.replace(/\s+/g, ' ').trim()
      linhas.push(`  ${f.id}: ${texto}${f.eventoIds.length > 0 ? ` (${f.eventoIds.join(', ')})` : ' (sem acontecimento)'}`)
    }
  }
  return linhas
}

export function promptDoRevisor(e: EntradaDoRevisor): string {
  const linhas = comecoDoPedido(e)
  if (e.instrucoes?.trim()) linhas.push(`INSTRUÇÕES DO EDITOR (a sugestão segue o tom dele): ${e.instrucoes.trim()}`, '')
  linhas.push(...roteiroComIds(e.roteiro))
  return linhas.join('\n')
}

/** O pedido do "Melhorar texto": o de cima, mais os trechos chapados que o app achou (trechosChapados). */
export function promptDaMelhoria(e: Omit<EntradaDoRevisor, 'instrucoes'>): string {
  const chapados = trechosChapados(e.roteiro)
  // As muletas que ja estao no roteiro: o "Melhorar de novo" de uma versao com "So que" 5x.
  const muletas = conectivosRepetidos(e.roteiro)
  const linhas = comecoDoPedido(e)
  linhas.push(
    chapados.length > 0
      ? `TRECHOS CHAPADOS que o app achou (reescreva estes primeiro): ${textoDosTrechos(chapados)}.`
      : 'O app não achou trecho chapado: olhe o gancho, a virada, o final e o ritmo.',
    ...(muletas.length > 0
      ? [
          `CONECTIVOS REPETIDOS que o app achou (deixe cada um no máximo ${CONECTIVO_MAX} vezes): ${muletas
            .map((m) => `"${m.rotulo}" ${m.vezes}x (${m.fraseIds.join(', ')})`)
            .join('; ')}.`,
        ]
      : []),
    '',
    ...roteiroComIds(e.roteiro),
  )
  return linhas.join('\n')
}

const emRevisao = new Set<string>()

function agora(): string {
  return new Date().toISOString()
}

/**
 * Revisa a versao atual (gravada). `automatico` = depois de gerar: respeita o
 * "Revisar depois de gerar" e so marca. Na mao: o modo do botao.
 */
export async function revisarRoteiro(rascunhoId: string, automatico: boolean, modo: ModoDaRevisao = 'corrigir'): Promise<RevisaoFeita> {
  if (automatico && !configDoRecap().revisarAoGerar) return { pulada: 'desligada', nota: 'Revisor desligado.' }
  if (emRevisao.has(rascunhoId)) throw new Error('Ja estou revisando este roteiro.')
  emRevisao.add(rascunhoId)
  try {
    return modo === 'melhorar' && !automatico ? await melhorar(rascunhoId) : await revisar(rascunhoId, !automatico)
  } finally {
    emRevisao.delete(rascunhoId)
  }
}

/** O roteiro da tela tem frase com texto? E o rascunho tem eventos? */
function semOQueRevisar(r: RascunhoDoRecap, atual: Roteiro | null): RevisaoFeita | null {
  if (!atual || !atual.secoes.some((s) => s.frases.some((f) => f.texto.trim()))) return { pulada: 'falhou', nota: 'Sem roteiro para revisar.' }
  if (r.eventos.length === 0) return { pulada: 'falhou', nota: 'Sem eventos: gere o roteiro antes.' }
  return null
}

/** Quantas frases da `base` mudaram de texto na `nova`. */
function frasesTrocadas(base: Pick<Roteiro, 'secoes'>, nova: Pick<Roteiro, 'secoes'>): number {
  const antes = new Map(base.secoes.flatMap((s) => s.frases.map((f) => [f.id, f.texto] as const)))
  return nova.secoes.reduce((n, s) => n + s.frases.filter((f) => antes.has(f.id) && antes.get(f.id) !== f.texto).length, 0)
}

async function revisar(rascunhoId: string, aplicar: boolean): Promise<RevisaoFeita> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const atual = roteiroAtual(r)
  const vazio = semOQueRevisar(r, atual)
  if (vazio) return vazio
  const { indice } = indiceDoRascunho(r)
  const elenco = elencoDoEpisodio(indice)
  const resposta = await gerarComCache({
    schema: revisaoDaIaSchema,
    sistema: SISTEMA_REVISOR,
    prompt: promptDoRevisor({
      indice,
      eventos: r.eventos,
      elenco,
      roteiro: atual!,
      instrucoes: instrucoesParaPrompt(lerEstilo(), nomesDoElenco(elenco)),
    }),
    etapa: 'revisao',
    maxTokens: 4000,
    permitirReserva: false,
  })
  if (!resposta.ok) {
    const nota = resposta.motivo === 'so-reserva' ? textoDaParada(resposta) : resposta.nota
    console.log(`[gerar:revisao] pulada: ${resposta.bruto}`)
    return { pulada: 'falhou', nota }
  }
  resposta.guardar()
  const revisao: Revisao = { versao: atual!.versao, criadoEm: agora(), modelo: resposta.modelo, itens: itensDaRevisao(resposta.valor, atual!) }

  // Relido agora: sem await daqui ate gravar. A versao pode ter saido do historico no meio.
  const fresco = lerRascunhoDoDisco(rascunhoId)
  if (!fresco.roteiros.some((v) => v.versao === revisao.versao)) return { pulada: 'falhou', nota: 'A versao mudou durante a revisao.' }
  let final = comRevisao(fresco, revisao, agora())
  let versaoNova: number | null = null
  let trocadas = 0
  // "Corrigir erros" na mao: as sugestoes ja viram a versao Revisada (se a revisada ainda e a da tela).
  const base = roteiroAtual(final)
  if (aplicar && base && base.versao === revisao.versao) {
    const quando = agora()
    const nova = roteiroRevisado(base, marcasNaTela(revisao, base), { versao: proximaVersao(final), agoraIso: quando, modelo: revisao.modelo })
    if (nova) {
      trocadas = frasesTrocadas(base, nova)
      final = adicionarVersao(final, nova, quando)
      versaoNova = nova.versao
    }
  }
  gravarRascunho(final)
  return { pulada: null, modo: 'corrigir', revisao, doCache: resposta.doCache, rascunho: final, versaoNova, trocadas, marcadas: revisao.itens.length }
}

async function melhorar(rascunhoId: string): Promise<RevisaoFeita> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const atual = roteiroAtual(r)
  const vazio = semOQueRevisar(r, atual)
  if (vazio) return vazio
  const { indice } = indiceDoRascunho(r)
  const elenco = elencoDoEpisodio(indice)
  const estilo = lerEstilo()
  const comEstilo = temEstilo(estilo)
  const resposta = await gerarComCache({
    schema: melhoriaDaIaSchema,
    sistema: sistemaDaMelhoria(blocoDoEstilo(estilo, nomesDoElenco(elenco))),
    prompt: promptDaMelhoria({ indice, eventos: r.eventos, elenco, roteiro: atual! }),
    etapa: 'melhoria',
    maxTokens: 6000,
    permitirReserva: false,
  })
  if (!resposta.ok) {
    const nota = resposta.motivo === 'so-reserva' ? textoDaParada(resposta) : resposta.nota
    console.log(`[gerar:melhoria] pulada: ${resposta.bruto}`)
    return { pulada: 'falhou', nota }
  }
  resposta.guardar()
  // A mesma conferencia de prova, sem outro pedido: troca que traz problema volta atras.
  const ritmo = ritmoDoRascunho(r).ritmo
  const provadas = conferirMelhorias(atual!, trocasDaMelhoria(resposta.valor, atual!), r.eventos, indice, ritmo, { estilo: comEstilo })
  if (provadas.desfeitas.length > 0) console.log(`[gerar:melhoria] desfeitas pela conferencia: ${provadas.desfeitas.join(', ')}`)
  // E o tempo do short e fixo: o que mais cresce volta atras ate caber no alvo.
  const conferidas = limitarCrescimento(atual!, provadas.trocas, faixaDePalavras(atual!.alvoSec, ritmo).max)
  if (conferidas.desfeitas.length > 0) console.log(`[gerar:melhoria] desfeitas pelo tamanho: ${conferidas.desfeitas.join(', ')}`)

  // Relido agora: sem await daqui ate gravar. A versao melhorada sai da que foi lida.
  const fresco = lerRascunhoDoDisco(rascunhoId)
  const base = fresco.roteiros.find((v) => v.versao === atual!.versao)
  if (!base || fresco.atual !== base.versao) return { pulada: 'falhou', nota: 'A versao mudou durante a revisao.' }
  const quando = agora()
  const nova = roteiroMelhorado(base, conferidas.trocas, { versao: proximaVersao(fresco), agoraIso: quando, modelo: resposta.modelo })
  const final = nova ? adicionarVersao(fresco, nova, quando) : fresco
  if (nova) gravarRascunho(final)
  // A conferencia depois: conectivo que a versao nova repete mais que a de antes ("So que" 5x) vira recado.
  const antes = new Map(conectivosRepetidos(base).map((m) => [m.rotulo, m.vezes]))
  const muleta = nova
    ? conectivosRepetidos(nova)
        .filter((m) => m.vezes > (antes.get(m.rotulo) ?? CONECTIVO_MAX))
        .map(textoDaMuleta)
        .join(', ') || null
    : null
  if (muleta) console.log(`[gerar:melhoria] muleta na versao nova: ${muleta}`)
  return {
    pulada: null,
    modo: 'melhorar',
    revisao: null,
    doCache: resposta.doCache,
    rascunho: final,
    versaoNova: nova?.versao ?? null,
    trocadas: conferidas.trocas.length,
    marcadas: 0,
    muleta,
  }
}

/** "Aplicar todas": versao nova a partir da atual, com as sugestoes das marcas que valem. */
export function aplicarRevisao(rascunhoId: string): RascunhoDoRecap {
  const r = lerRascunhoDoDisco(rascunhoId)
  const atual = roteiroAtual(r)
  if (!atual) throw new Error('Nao ha roteiro.')
  const revisao = revisaoDaVersao(r, atual.versao)
  const quando = agora()
  const novo = roteiroRevisado(atual, marcasNaTela(revisao, atual), {
    versao: proximaVersao(r),
    agoraIso: quando,
    modelo: revisao?.modelo ?? atual.modelo,
  })
  if (!novo) throw new Error('Nada para aplicar: nenhuma marca com sugestao.')
  const final = adicionarVersao(r, novo, quando)
  gravarRascunho(final)
  return final
}

/** "Ignorar": as marcas dessas frases somem (na revisao que vale para a versao atual). */
export function ignorarRevisao(rascunhoId: string, fraseIds: readonly string[]): RascunhoDoRecap {
  const r = lerRascunhoDoDisco(rascunhoId)
  const atual = roteiroAtual(r)
  const revisao = atual ? revisaoDaVersao(r, atual.versao) : null
  if (!revisao) return r
  const tirar = new Set(fraseIds)
  if (!revisao.itens.some((i) => tirar.has(i.fraseId) && !i.ignorado)) return r
  const final = comRevisao(r, { ...revisao, itens: revisao.itens.map((i) => (tirar.has(i.fraseId) ? { ...i, ignorado: true } : i)) }, agora())
  gravarRascunho(final)
  return final
}
