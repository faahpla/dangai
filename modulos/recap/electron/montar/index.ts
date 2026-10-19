import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { roteiroAtual, sugestoesDaVersao, type RascunhoDoRecap } from '../../shared/roteiro'
import { podeIrParaCenas, takeAtual } from '../../shared/voz'
import {
  cenasDoRascunho,
  frasesDoRoteiro,
  type CenasGravadas,
  type EstadoDasCenas,
  type PedidoDeMontagem,
  type ProjetoMontado,
} from '../../shared/cenas'
import { encaixarEscolha } from '../../shared/encaixe'
import type { EpisodeIndex } from '../../shared/episodio'
import { gravarRascunho, indiceDoRascunho, lerRascunhoDoDisco } from '../gerar/rascunho'
import { comMesclas } from '../cenas/mesclas'
import { saveProjectFile } from '../project'
import { arquivoDaVoz, pastaDaVoz } from '../voz/pastas'
import { secoesDoTake, type RostosDoLote } from '../../shared/edicao-rapida'
import { aquecerMiniaturas } from './abertura'
import {
  corDaMontagem,
  estiloSalvo,
  personagensDosPedacos,
  registrarAMusica,
  resumoDaMontagem,
  rostosDaMontagem,
  somDaMontagem,
} from './edicao-rapida'
import { focosDosPedacos } from './foco'
import { arquivoDoProjeto, conferirPastaPedida, nomeDoProjeto, pastaPadraoDoProjeto } from './pasta'
import { ganchoDaMontagem, montarArquivoDoProjeto, pedacosDaMontagem, type FocoDoPedaco } from './projeto'
import { textosDaMontagem } from './textos'

/**
 * O ENCAIXE NA VOZ e a MONTAGEM do projeto (agente B).
 *
 * - encaixarNaVoz: cada escolha do rascunho passa pelo encaixarEscolha
 *   (shared/encaixe.ts) com o take ATUAL, e `cenas.takeId` vira o dele. E
 *   chamado pela tela ao entrar no passo 4 e sempre que
 *   escolhasDesatualizadas diz encaixeVelho/duracaoMudou (regravou frase,
 *   trocou de take). De graca.
 * - montarProjeto: o "Abrir no editor". Encaixa de novo no take aprovado
 *   (grava no rascunho se mudou), copia a narracao para a pasta do projeto,
 *   acha o rosto de cada bloco (melhor esforco, com teto) e grava o .dangai
 *   v1 (montarArquivoDoProjeto em ./projeto.ts: audio, transcript alinhado,
 *   script, cenas = mp4 dos planos com sourceStart, Ken Burns, corte seco na
 *   secao e zoom curto na virada, gancho, legendas do editor e `modulos.recap` +
 *   `transcriptTravado`, a trava do nucleo). Validado pelo zod e gravado atomico
 *   pelo saveProjectFile do Dangai (o mesmo `rel` de um Ctrl+S). Nunca escreve
 *   em biblioteca externa (./pasta.ts). A legenda nasce no estilo salvo dele;
 *   com `pedido.edicaoRapida`, o projeto ja chega com som, musica, o rosto
 *   pelo motor e a camada de cor (./edicao-rapida.ts), e o resumo volta em
 *   `edicaoRapida`.
 *
 * Mesma regra do rascunho.ts: ler -> aplicar -> gravar SEM await no meio. A
 * montagem trabalha sobre o que foi lido e encaixado; a parte lenta (rostos)
 * vem depois da gravacao do rascunho e nao relê nem grava o rascunho.
 */

function agora(): string {
  return new Date().toISOString()
}

/**
 * Onde a copia da narracao fica: <pasta>/<nome>.wav. Ja existindo com o MESMO
 * conteudo (montar de novo na mesma pasta), reaproveita; com outro, ganha
 * " (2)" -- nunca grava por cima de um audio que outro projeto usa.
 */
function narracaoNaPasta(pasta: string, nome: string, origem: string): string {
  const tamanho = statSync(origem).size
  for (let n = 1; ; n++) {
    const caminho = join(pasta, n === 1 ? `${nome}.wav` : `${nome} (${n}).wav`)
    if (!existsSync(caminho)) return caminho
    if (statSync(caminho).size === tamanho && readFileSync(caminho).equals(readFileSync(origem))) return caminho
  }
}

/** As escolhas encaixadas no take dado (puro; orfas e frases sem escolha ficam como estao). */
function encaixarTudo(
  cenas: EstadoDasCenas,
  roteiro: NonNullable<ReturnType<typeof roteiroAtual>>,
  indice: EpisodeIndex,
  take: ReturnType<typeof takeAtual>,
): { escolhas: EstadoDasCenas['escolhas']; avisos: string[] } {
  const porId = new Map(frasesDoRoteiro(roteiro).map((f) => [f.id, f]))
  const avisos: string[] = []
  const escolhas = cenas.escolhas.map((e) => {
    const frase = porId.get(e.fraseId)
    if (!frase) return e
    const feito = encaixarEscolha(e, { indice, frase, take })
    avisos.push(...feito.avisos)
    return feito.escolha
  })
  return { escolhas, avisos }
}

export async function encaixarNaVoz(rascunhoId: string): Promise<CenasGravadas> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const roteiro = roteiroAtual(r)
  if (!roteiro) throw new Error('Nao ha roteiro.')
  const indice = comMesclas(indiceDoRascunho(r).indice)
  const take = takeAtual(r)
  const atual = cenasDoRascunho(r)
  const { escolhas, avisos } = encaixarTudo(atual, roteiro, indice, take)
  const quando = agora()
  const novo: RascunhoDoRecap = {
    ...r,
    cenas: { ...atual, escolhas, takeId: take?.id ?? null, encaixadoEm: quando },
    atualizadoEm: quando,
  }
  gravarRascunho(novo)
  return { rascunho: novo, avisos }
}

/** Opcoes que a tela nao manda (os testes usam). */
export interface OpcoesDaMontagem {
  /** Procurar o rosto de cada bloco. Padrao: sim. */
  rostos?: boolean
  /** Teto da busca de rostos, em ms. */
  tetoDosRostosMs?: number
  /** O que esta rodando agora, em ASCII curto (o rodape do passo 4 mostra). */
  aoAndar?: (texto: string) => void
}

// ------------------------------------------------- O2: a montagem no ar

/** As montagens rodando nesta sessao (a marca no disco de uma delas nao e de um app que fechou). */
const montandoAgora = new Set<string>()

interface MontagemNoAr {
  pasta: string
  inicio: string
  /** O passo 4 ja avisou ("a montagem parou no meio"): nao avisa de novo. */
  avisado?: boolean
}

/** <recaps>/<rascunho>/montagem-no-ar.json (pastaDaVoz confere o id). */
function arquivoDaMontagemNoAr(rascunhoId: string): string {
  return join(dirname(pastaDaVoz(rascunhoId)), 'montagem-no-ar.json')
}

function lerMontagemNoAr(rascunhoId: string): MontagemNoAr | null {
  try {
    const d = JSON.parse(readFileSync(arquivoDaMontagemNoAr(rascunhoId), 'utf8')) as Partial<MontagemNoAr>
    return typeof d.pasta === 'string' && typeof d.inicio === 'string' ? { pasta: d.pasta, inicio: d.inicio, avisado: d.avisado === true } : null
  } catch {
    return null
  }
}

function gravarMontagemNoAr(rascunhoId: string, m: MontagemNoAr): void {
  try {
    const arquivo = arquivoDaMontagemNoAr(rascunhoId)
    mkdirSync(dirname(arquivo), { recursive: true })
    writeFileSync(arquivo, JSON.stringify(m), 'utf8')
  } catch {
    /* sem a marca, so falta o aviso (e a pasta nova sai com outro carimbo) */
  }
}

/**
 * O2: a montagem que o app largou no meio (fechou ou caiu no "Abrir no
 * editor"): o passo 4 avisa UMA vez. null = nenhuma (ou ja avisada).
 */
export function montagemInterrompida(rascunhoId: string): { inicio: string } | null {
  if (montandoAgora.has(rascunhoId)) return null
  const m = lerMontagemNoAr(rascunhoId)
  if (!m || m.avisado) return null
  gravarMontagemNoAr(rascunhoId, { ...m, avisado: true })
  return { inicio: m.inicio }
}

/**
 * A pasta da montagem largada no meio, ainda sem o projeto: o "Abrir no
 * editor" de novo usa a MESMA (e nao deixa uma pasta so com a narracao para
 * tras). Com o projeto la dentro, ela e de outra montagem que terminou.
 */
function pastaLargada(rascunhoId: string): string | null {
  if (montandoAgora.has(rascunhoId)) return null
  const m = lerMontagemNoAr(rascunhoId)
  if (!m || !existsSync(m.pasta)) return null
  try {
    const comProjeto = readdirSync(m.pasta).some((f) => /\.(dangai|anirecap)$/i.test(f))
    return comProjeto ? null : m.pasta
  } catch {
    return null
  }
}

export async function montarProjeto(
  rascunhoId: string,
  pedido: PedidoDeMontagem,
  opcoes: OpcoesDaMontagem = {},
): Promise<ProjetoMontado> {
  const largada = pedido.pasta ? null : pastaLargada(rascunhoId)
  montandoAgora.add(rascunhoId)
  try {
    return await montarAqui(rascunhoId, pedido, opcoes, largada)
  } finally {
    montandoAgora.delete(rascunhoId)
    // Terminou (bem ou mal): a marca sai. So o app fechado no meio a deixa.
    try {
      rmSync(arquivoDaMontagemNoAr(rascunhoId), { force: true })
    } catch {
      /* presa: o aviso e a pasta saem na proxima */
    }
  }
}

async function montarAqui(
  rascunhoId: string,
  pedido: PedidoDeMontagem,
  opcoes: OpcoesDaMontagem,
  largada: string | null,
): Promise<ProjetoMontado> {
  // 1. Ler, conferir e encaixar no take aprovado -- sem await ate gravar.
  const r = lerRascunhoDoDisco(rascunhoId)
  const roteiro = roteiroAtual(r)
  if (!roteiro || !r.aprovado) throw new Error('Aprove o roteiro antes de abrir no editor.')
  if (!podeIrParaCenas(r, roteiro)) throw new Error('Aprove a voz antes de abrir no editor.')
  const take = takeAtual(r)
  if (!take) throw new Error('Aprove a voz antes de abrir no editor.')
  // [recap] Plano mesclado pelo Dangai depois do indice: o projeto aponta o mesclado.
  const indice = comMesclas(indiceDoRascunho(r).indice)
  const atual = cenasDoRascunho(r)
  const { escolhas } = encaixarTudo(atual, roteiro, indice, take)
  const cenas: EstadoDasCenas = { ...atual, escolhas, takeId: take.id }
  const precisaGravar =
    atual.takeId !== take.id || JSON.stringify(atual.escolhas) !== JSON.stringify(escolhas)
  if (precisaGravar) {
    const quando = agora()
    gravarRascunho({ ...r, cenas: { ...cenas, encaixadoEm: quando }, atualizadoEm: quando })
  }

  // Os pedacos antes do disco: sem nenhuma cena, nada e criado.
  const previa = pedacosDaMontagem({ rascunho: r, roteiro, take, indice, cenas })
  if (previa.pedacos.length === 0) throw new Error('Nenhuma frase tem cena. Escolha as cenas antes de abrir no editor.')

  // 2. A pasta: a pedida (conferida) ou a padrao; nunca numa biblioteca externa.
  const nome = nomeDoProjeto(indice)
  // O2: a pasta de uma montagem largada no meio (sem o projeto) volta a ser usada.
  const pasta = conferirPastaPedida(pedido.pasta ?? largada ?? pastaPadraoDoProjeto(nome, new Date()))
  const origem = arquivoDaVoz(r.id, take.arquivo)
  if (!existsSync(origem)) throw new Error('O audio da voz aprovada sumiu. Gere ou importe a voz de novo.')
  mkdirSync(pasta, { recursive: true })
  gravarMontagemNoAr(r.id, { pasta, inicio: new Date().toISOString() })

  // 3. A narracao vai junto do projeto (o projeto nao aponta para o userData),
  // com o NOME do projeto: o render do Dangai grava ao lado do audio, com o
  // nome dele ("Dr. Stone S04E37-short.mp4"), e o "Salvar" sugere esse nome.
  const andar = (texto: string): void => {
    try {
      opcoes.aoAndar?.(texto)
    } catch {
      // Recado de andamento nunca derruba a montagem.
    }
  }
  andar('Copiando a narracao...')
  const narracaoPath = narracaoNaPasta(pasta, nome, origem)
  if (!existsSync(narracaoPath)) copyFileSync(origem, narracaoPath)

  // 4. O rosto de cada bloco (melhor esforco) e as miniaturas prontas para o
  // openProject (o mesmo mp4 em dois blocos nao pode correr no import). Com a
  // Edicao rapida, o rosto e o do motor (lote, preferindo quem a frase cita);
  // sem ela, o detector de sempre.
  const config = pedido.edicaoRapida ?? null
  const avisosDaEdicao: string[] = []
  const rostos = async (): Promise<{ focos: Map<string, FocoDoPedaco>; lote: RostosDoLote | null; avisos: string[] }> => {
    if (opcoes.rostos === false) return { focos: new Map(), lote: null, avisos: [] }
    if (config?.rosto) {
      const nomes = personagensDosPedacos(previa.pedacos, roteiro, r.eventos, indice)
      return rostosDaMontagem(previa.pedacos, nomes, r.episodioId, opcoes.tetoDosRostosMs)
    }
    return { focos: await focosDosPedacos(previa.pedacos, opcoes.tetoDosRostosMs), lote: null, avisos: [] }
  }

  // 5. O som da Edicao rapida: whoosh nas viradas, impacto no gancho e no
  // climax, musica com ducking. Os cortes sao os comecos dos blocos (o mesmo
  // `start` que montarArquivoDoProjeto da a cada Scene).
  const somDaEdicao = () =>
    config
      ? somDaMontagem(config, {
          duracaoSec: take.duracao,
          cortes: previa.pedacos.map((p, j) => (j === 0 ? 0 : p.inicio)),
          secoes: secoesDoTake(roteiro, take, r.eventos),
          vozPath: narracaoPath,
        })
      : Promise.resolve(null)

  // Rosto, miniaturas e som nao dependem um do outro: correm juntos. O motor de
  // rostos gasta ~9 s fixos para subir o torch, e nao precisa somar ao resto.
  // O rodape diz o que AINDA falta (a Edicao rapida leva ~20 s).
  const faltam = new Set<'rostos' | 'som' | 'miniaturas'>(['rostos', 'miniaturas', ...(config && (config.sfx || config.musica) ? (['som'] as const) : [])])
  const dizerOQueFalta = (): void => {
    const partes: string[] = []
    if (faltam.has('rostos')) partes.push(config?.rosto ? 'Rostos' : 'Enquadramento')
    if (faltam.has('som')) partes.push(config?.sfx && config.musica ? 'sons e musica' : config?.sfx ? 'sons' : 'musica')
    if (partes.length === 0 && faltam.has('miniaturas')) partes.push('Miniaturas')
    if (partes.length > 0) andar(`${partes.join(', ').replace(/^./, (c) => c.toUpperCase())}...`)
  }
  const acabou = <T,>(qual: 'rostos' | 'som' | 'miniaturas', p: Promise<T>): Promise<T> =>
    p.finally(() => {
      faltam.delete(qual)
      dizerOQueFalta()
    })
  dizerOQueFalta()
  const [feito, , som] = await Promise.all([
    acabou('rostos', rostos()),
    acabou('miniaturas', aquecerMiniaturas(previa.pedacos.map((p) => p.arquivo))),
    acabou('som', somDaEdicao()),
  ])
  andar('Gravando o projeto...')
  const focos = feito.focos
  const lote = feito.lote
  avisosDaEdicao.push(...feito.avisos)
  if (som) avisosDaEdicao.push(...som.avisos)

  // 6. O .dangai: zod + gravacao atomica do nucleo. O estilo salvo da
  // legenda entra com ou sem a Edicao rapida (e o padrao de projeto novo); a
  // camada de cor, so com a parte "cor" ligada.
  const estilo = estiloSalvo(pedido.estilo)
  const cor = config?.cor ? corDaMontagem(take.duracao, pedido.presetsDeCor ?? []) : null
  if (cor) avisosDaEdicao.push(...cor.avisos)
  // O card de gancho (a 1a frase, ou a 1a sugestao de thumb) e os TEXTOS NA
  // TELA das outras frases, acima da camada de cor e depois do card.
  const thumbs = sugestoesDaVersao(r, roteiro.versao)?.thumbs ?? []
  const gancho = ganchoDaMontagem(roteiro, take, thumbs)
  let textos: Awaited<ReturnType<typeof textosDaMontagem>> | null = null
  if (config?.textos) {
    andar('Textos na tela...')
    textos = await textosDaMontagem({
      roteiro,
      take,
      pasta,
      estilo,
      ganchoAteSec: gancho.texto ? gancho.sec : 0,
      faixaDeVideo: cor?.camada ? [cor.camada] : [],
    })
    avisosDaEdicao.push(...textos.avisos)
  }
  const { file, avisos } = montarArquivoDoProjeto({
    rascunho: r,
    roteiro,
    take,
    indice,
    cenas,
    narracaoPath,
    focos,
    agora: agora(),
    eventos: r.eventos,
    estilo,
    trilhas: som?.trilhas ?? [],
    sobreposicoes: [...(cor?.camada ? [cor.camada] : []), ...(textos?.clipes ?? [])],
    thumbs,
  })
  const projetoPath = arquivoDoProjeto(pasta, nome)
  saveProjectFile(projetoPath, file)
  if (!config) return { projetoPath, avisos }

  // 7. Gravado: a musica entra no historico (o proximo short nao repete).
  avisosDaEdicao.push(...(await registrarAMusica(som?.plano ?? null, projetoPath)))
  // Nunca ajustou um estilo: a parte Legenda nao tem o que por, e ele precisa saber por que.
  if (config.legenda && estilo === null) avisosDaEdicao.push('Sem estilo de legenda salvo: ficou o padrao do app')
  return {
    projetoPath,
    avisos,
    edicaoRapida: {
      ...resumoDaMontagem({
        config,
        plano: som?.plano ?? null,
        lote,
        focos,
        pedacos: previa.pedacos,
        rostoRodou: config.rosto && opcoes.rostos !== false,
        legenda: estilo !== null,
        cor: cor?.camada ? cor.nome : null,
        corPresetSumiu: cor?.sumiu ?? null,
        avisos: avisosDaEdicao,
      }),
      textos: textos ? { postos: textos.clipes.length, mantidos: 0, faixa: textos.clipes[0]?.faixa ?? null } : null,
    },
  }
}
