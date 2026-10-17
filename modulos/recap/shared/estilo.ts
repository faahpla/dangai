import { similaridadeDeTexto } from './roteiro'

/**
 * [recap] O "MEU ESTILO" do roteiro (como um Gem do Gemini ou um GPT): as
 * instrucoes do Levi em texto livre, os roteiros de exemplo que ele gosta e,
 * ligado, os roteiros que ele aprovou DEPOIS de editar (aprendidos).
 *
 * Mora num arquivo na pasta de dados do modulo (electron/gerar/estilo.ts):
 * dez exemplos de 1-2 mil caracteres nao cabem bem no settings.json.
 *
 * O PERIGO CONHECIDO e o vazamento entre series: o Studio tirou os exemplos de
 * serie do prompt porque os nomes (Coco, Agathe...) apareciam no roteiro de
 * outro anime. Por isso, tres travas:
 *  (a) o bloco diz que os exemplos sao referencia de TOM, RITMO e ESTRUTURA,
 *      nunca de fatos ou nomes;
 *  (b) os nomes proprios dos exemplos sao MASCARADOS antes de ir ("[PERSONAGEM
 *      1]"): palavra com maiuscula fora do comeco da frase, e o nome do elenco
 *      do episodio onde quer que apareca;
 *  (c) o teste (teste/v-ideias-roteiro.ts) prova que o nome de um exemplo nao
 *      chega no prompt.
 *
 * O bloco so entra no prompt quando ha estilo: sem estilo, o pedido e o mesmo
 * de antes, byte a byte (e o cache continua valendo).
 */

export const INSTRUCOES_MAX = 4000
export const NOME_DO_EXEMPLO_MAX = 40
export const TEXTO_DO_EXEMPLO_MAX = 8000
/** Os exemplos que ele cola ou importa ("de 3 a 10"). */
export const EXEMPLOS_MAX = 10
/** Quantos aprendidos guardar (os mais recentes). */
export const APRENDIDOS_OPCOES = [3, 5, 10] as const
export const APRENDIDOS_PADRAO = 5
/**
 * Teto dos exemplos no prompt, em tokens estimados. ~6 mil tokens cabem 3-5
 * roteiros de 60-90 s; o free tier aguenta (e um prompt maior, nao mais
 * pedidos). Passou, saem os mais antigos.
 */
export const TETO_DE_TOKENS_DOS_EXEMPLOS = 6000

export interface ExemploDeEstilo {
  /** 'x' + carimbo base36 + sufixo. */
  id: string
  nome: string
  texto: string
  /** meu = colado/importado; aprendido = aprovado depois de editar. */
  origem: 'meu' | 'aprendido'
  /** ISO. A ordem do corte: os mais antigos saem primeiro. */
  criadoEm: string
  /** No aprendido: o rascunho de onde veio (aprovar de novo troca, nao duplica). */
  rascunhoId?: string
}

export interface EstiloDoRecap {
  instrucoes: string
  exemplos: ExemploDeEstilo[]
  /** "Aprender com as minhas edicoes". */
  aprender: boolean
  /** Quantos aprendidos guardar. */
  aprendidosMax: number
}

export const ESTILO_VAZIO: EstiloDoRecap = { instrucoes: '', exemplos: [], aprender: false, aprendidosMax: APRENDIDOS_PADRAO }

/** O que a tela recebe: o estilo e a medida do que vai ao prompt. */
export interface EstiloNaTela {
  estilo: EstiloDoRecap
  /** Tokens estimados dos exemplos que entram (ja mascarados). */
  tokensDosExemplos: number
  teto: number
  /** Ids dos exemplos que entram no prompt (os outros ficaram de fora pelo teto). */
  usados: string[]
}

/** Tokens estimados: ~3,5 caracteres por token no portugues (conta de bolso, sem tokenizer). */
export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / 3.5)
}

const limpar = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '')

/** O que veio do disco ou da tela, conferido. Campo errado vale o padrao; exemplo vazio sai. */
export function coerceEstilo(raw: unknown): EstiloDoRecap {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const lista = Array.isArray(r['exemplos']) ? r['exemplos'] : []
  const exemplos: ExemploDeEstilo[] = []
  const ids = new Set<string>()
  for (const cru of lista) {
    if (!cru || typeof cru !== 'object') continue
    const e = cru as Record<string, unknown>
    const texto = limpar(e['texto'], TEXTO_DO_EXEMPLO_MAX)
    if (!texto) continue
    let id = typeof e['id'] === 'string' && /^x[0-9a-z]{1,24}$/.test(e['id']) ? e['id'] : novoIdDeExemplo(exemplos.length)
    if (ids.has(id)) id = novoIdDeExemplo(exemplos.length)
    ids.add(id)
    const origem = e['origem'] === 'aprendido' ? 'aprendido' : 'meu'
    const criadoEm = typeof e['criadoEm'] === 'string' && !Number.isNaN(Date.parse(e['criadoEm'])) ? e['criadoEm'] : new Date(0).toISOString()
    const exemplo: ExemploDeEstilo = { id, nome: limpar(e['nome'], NOME_DO_EXEMPLO_MAX) || `Exemplo ${exemplos.length + 1}`, texto, origem, criadoEm }
    if (origem === 'aprendido' && typeof e['rascunhoId'] === 'string' && /^rc_[0-9a-z_]+$/.test(e['rascunhoId'])) exemplo.rascunhoId = e['rascunhoId']
    exemplos.push(exemplo)
  }
  const n = Number(r['aprendidosMax'])
  const aprendidosMax = Number.isInteger(n) && n >= 1 && n <= 10 ? n : APRENDIDOS_PADRAO
  const meus = exemplos.filter((e) => e.origem === 'meu').slice(0, EXEMPLOS_MAX)
  const aprendidos = exemplos
    .filter((e) => e.origem === 'aprendido')
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .slice(0, aprendidosMax)
  return {
    instrucoes: limpar(r['instrucoes'], INSTRUCOES_MAX),
    exemplos: [...meus, ...aprendidos],
    aprender: r['aprender'] === true,
    aprendidosMax,
  }
}

let contadorDeId = 0
export function novoIdDeExemplo(semente = 0): string {
  contadorDeId = (contadorDeId + 1 + semente) % 1296
  return `x${Date.now().toString(36)}${contadorDeId.toString(36).padStart(2, '0')}`
}

export function temEstilo(e: EstiloDoRecap): boolean {
  return e.instrucoes.trim() !== '' || e.exemplos.length > 0
}

// ------------------------------------------------------------ mascarar nomes

/** Palavra com inicial maiuscula (hifen e apostrofo contam: "Why-Man", "D'Arc"). */
const PALAVRA = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu
/** Abreviacoes que terminam em ponto sem terminar a frase. */
const ABREVIACOES = new Set(['dr', 'dra', 'sr', 'sra', 'srta', 'prof', 'profa', 'st', 'mr', 'mrs', 'ms', 'jr'])
/**
 * Maiuscula que nao e nome mesmo no meio da frase: siglas da narracao e
 * palavras que a gente escreve com maiuscula. Pouca coisa: a duvida vai para
 * a mascara (mascarar demais so tira um pouco de sabor do exemplo).
 */
const NAO_E_NOME = new Set(['eu', 'tv', 'ok', 'ep', 'eps', 'anime', 'deus', 'plot', 'twist'])

const forma = (palavra: string): string =>
  palavra
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’']/g, "'")

function maiuscula(palavra: string): boolean {
  const primeira = palavra[0] ?? ''
  return primeira !== primeira.toLowerCase() && primeira === primeira.toUpperCase()
}

interface Pedaco {
  palavra: string
  inicio: number
  fim: number
  /** A primeira palavra da frase (depois de . ! ? reticencias ou do comeco/linha nova). */
  comecoDeFrase: boolean
}

function pedacos(texto: string): Pedaco[] {
  const saida: Pedaco[] = []
  let anterior: Pedaco | null = null
  for (const m of texto.matchAll(PALAVRA)) {
    const inicio = m.index ?? 0
    const entre = anterior ? texto.slice(anterior.fim, inicio) : texto.slice(0, inicio)
    const abreviacao = anterior !== null && entre.trimStart().startsWith('.') && ABREVIACOES.has(forma(anterior.palavra))
    const comecoDeFrase: boolean = anterior === null || ((/[.!?…]/.test(entre) || /\n/.test(entre)) && !abreviacao)
    const p: Pedaco = { palavra: m[0], inicio, fim: inicio + m[0].length, comecoDeFrase }
    saida.push(p)
    anterior = p
  }
  return saida
}

/**
 * Os NOMES de um conjunto de textos: toda palavra com maiuscula fora do
 * comeco da frase (a mesma palavra no comeco de outra frase tambem e nome), e
 * os nomes do elenco (cada palavra deles, onde quer que aparecam). Devolve as
 * formas (sem acento, minusculas).
 */
export function nomesNosTextos(textos: readonly string[], elenco: readonly string[] = []): Set<string> {
  const nomes = new Set<string>()
  for (const texto of textos) {
    for (const p of pedacos(texto)) {
      if (!p.comecoDeFrase && maiuscula(p.palavra) && !NAO_E_NOME.has(forma(p.palavra))) nomes.add(forma(p.palavra))
    }
  }
  for (const nome of elenco) {
    for (const m of nome.matchAll(PALAVRA)) {
      const f = forma(m[0])
      // "o", "da", "de": parte de nome composto que e palavra comum.
      if (f.length >= 3 && !NAO_E_NOME.has(f)) nomes.add(f)
    }
  }
  return nomes
}

/**
 * Troca os nomes de um texto por "[PERSONAGEM n]". Palavras de nome seguidas
 * ("Dr. Xeno", "Ryusui Nanami") viram UMA mascara. O mesmo nome tem o mesmo
 * numero em todos os exemplos (o `mapa` e dividido entre eles), para o modelo
 * ver o ritmo de um personagem que volta. Placeholders ja mascarados ficam.
 */
export function mascararNomes(texto: string, nomes: ReadonlySet<string>, mapa: Map<string, number> = new Map()): string {
  const lista = pedacos(texto)
  let saida = ''
  let corte = 0
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i]!
    // So a forma com maiuscula: "Mano" no meio da frase nao pode levar o "mano" do resto.
    if (!nomes.has(forma(p.palavra)) || !maiuscula(p.palavra)) continue
    // Junta as palavras de nome seguidas (so espaco ou "Dr. " no meio).
    let j = i
    while (j + 1 < lista.length) {
      const prox = lista[j + 1]!
      const entre = texto.slice(lista[j]!.fim, prox.inicio)
      const ligado = entre === ' ' || (entre === '. ' && ABREVIACOES.has(forma(lista[j]!.palavra)))
      if (!ligado || !nomes.has(forma(prox.palavra)) || !maiuscula(prox.palavra)) break
      j += 1
    }
    // "Dr." antes do nome entra na mascara.
    let inicio = p.inicio
    const antes = i > 0 ? lista[i - 1]! : null
    if (antes && texto.slice(antes.fim, p.inicio) === '. ' && ABREVIACOES.has(forma(antes.palavra)) && antes.inicio >= corte) inicio = antes.inicio
    const chave = lista.slice(i, j + 1).map((x) => forma(x.palavra)).join(' ')
    let n = mapa.get(chave)
    if (n === undefined) {
      n = mapa.size + 1
      mapa.set(chave, n)
    }
    saida += texto.slice(corte, inicio) + `[PERSONAGEM ${n}]`
    corte = lista[j]!.fim
    i = j
  }
  return saida + texto.slice(corte)
}

// ------------------------------------------------------------ o bloco do prompt

export interface ExemplosNoPrompt {
  /** Os exemplos ja mascarados, do mais novo ao mais antigo, dentro do teto. */
  textos: { id: string; texto: string }[]
  tokens: number
  /** Ids que ficaram de fora pelo teto. */
  cortados: string[]
}

/**
 * Os exemplos que vao ao prompt: mascarados, do mais novo ao mais antigo,
 * ate o teto de tokens. O primeiro que nao cabe inteiro sai (e os mais
 * antigos que ele); se nem o mais novo cabe, ele vai cortado no fim de uma
 * frase, para o estilo nunca ficar sem exemplo nenhum.
 */
export function exemplosParaPrompt(
  estilo: EstiloDoRecap,
  elenco: readonly string[] = [],
  teto = TETO_DE_TOKENS_DOS_EXEMPLOS,
): ExemplosNoPrompt {
  const ordem = [...estilo.exemplos].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
  const nomes = nomesNosTextos(
    ordem.map((e) => e.texto),
    elenco,
  )
  const mapa = new Map<string, number>()
  const textos: { id: string; texto: string }[] = []
  const cortados: string[] = []
  let tokens = 0
  for (const e of ordem) {
    const mascarado = mascararNomes(e.texto, nomes, mapa)
    const custo = estimarTokens(mascarado)
    if (cortados.length > 0 || tokens + custo > teto) {
      if (textos.length === 0) {
        const cabe = mascarado.slice(0, Math.floor(teto * 3.5))
        const fim = Math.max(cabe.lastIndexOf('. '), cabe.lastIndexOf('! '), cabe.lastIndexOf('? '))
        const cortado = fim > 0 ? cabe.slice(0, fim + 1) : cabe
        textos.push({ id: e.id, texto: cortado })
        tokens += estimarTokens(cortado)
      } else cortados.push(e.id)
      continue
    }
    textos.push({ id: e.id, texto: mascarado })
    tokens += custo
  }
  return { textos, tokens, cortados }
}

/**
 * O BLOCO "ESTILO DO EDITOR" que vai no fim do prompt do roteirista. null =
 * sem estilo (o prompt fica como era). As regras de fidelidade e de formato
 * mandam sobre o estilo: o bloco diz isso.
 */
export function blocoDoEstilo(estilo: EstiloDoRecap, elenco: readonly string[] = []): string | null {
  if (!temEstilo(estilo)) return null
  const linhas = [
    'ESTILO DO EDITOR — escreva do JEITO dele. O estilo manda no TOM, no RITMO, no vocabulário e em como abrir e fechar; nunca nas regras de fidelidade, de formato e de tamanho acima.',
  ]
  if (estilo.instrucoes.trim()) linhas.push(`INSTRUÇÕES DELE: ${estilo.instrucoes.trim()}`)
  const ex = exemplosParaPrompt(estilo, elenco)
  if (ex.textos.length > 0) {
    linhas.push(
      `ROTEIROS DE EXEMPLO QUE ELE APROVOU (${ex.textos.length}; de OUTROS episódios e de OUTRAS séries, com os nomes trocados por [PERSONAGEM n]). Use SÓ como referência de TOM, RITMO e ESTRUTURA: como ele abre, o tamanho das frases, as gírias, os conectivos, como ele fecha. NUNCA copie deles fatos, nomes, lugares, termos, acontecimentos nem frases inteiras — os fatos vêm só dos ACONTECIMENTOS deste episódio, e os nomes só do ELENCO dele. Nunca escreva "[PERSONAGEM n]" no roteiro.`,
    )
    ex.textos.forEach((t, i) => linhas.push(`--- EXEMPLO ${i + 1} ---`, t.texto))
    linhas.push('--- FIM DOS EXEMPLOS ---')
  }
  return linhas.join('\n')
}

/** A medida da tela: tokens dos exemplos que entram e quais entram. */
export function estiloNaTela(estilo: EstiloDoRecap): EstiloNaTela {
  const ex = exemplosParaPrompt(estilo)
  return { estilo, tokensDosExemplos: ex.tokens, teto: TETO_DE_TOKENS_DOS_EXEMPLOS, usados: ex.textos.map((t) => t.id) }
}

// ------------------------------------------------------------ aprender com as edicoes

/** Mesmo texto, ou quase (so pontuacao, caixa ou uma palavra): nao vale outro exemplo. */
const QUASE_IGUAL = 0.97

/**
 * "APRENDER COM AS MINHAS EDICOES": o roteiro aprovado depois de editado vira
 * exemplo. Pura: devolve o estilo novo, ou o mesmo objeto quando nada muda
 * (desligado, texto vazio, igual a um exemplo que ja existe).
 * - o mesmo rascunho aprovado de novo TROCA o aprendido dele (sem duplicata);
 * - fica so os `aprendidosMax` mais recentes.
 */
export function aprenderExemplo(
  estilo: EstiloDoRecap,
  novo: { texto: string; nome: string; rascunhoId: string; agoraIso: string },
): EstiloDoRecap {
  if (!estilo.aprender) return estilo
  const texto = novo.texto.replace(/\r\n?/g, '\n').trim().slice(0, TEXTO_DO_EXEMPLO_MAX)
  if (!texto) return estilo
  const doMesmo = estilo.exemplos.find((e) => e.origem === 'aprendido' && e.rascunhoId === novo.rascunhoId)
  // Aprovou de novo sem mudar o texto: o aprendido dele ja e esse.
  if (doMesmo && similaridadeDeTexto(doMesmo.texto, texto) >= QUASE_IGUAL) return estilo
  const outros = estilo.exemplos.filter((e) => e !== doMesmo)
  if (outros.some((e) => similaridadeDeTexto(e.texto, texto) >= QUASE_IGUAL)) {
    // Ja tem (colado por ele, ou de outro rascunho): o do mesmo rascunho que ficou velho sai.
    return outros.length === estilo.exemplos.length ? estilo : { ...estilo, exemplos: outros }
  }
  const aprendido: ExemploDeEstilo = {
    id: novoIdDeExemplo(),
    nome: novo.nome.slice(0, NOME_DO_EXEMPLO_MAX) || 'Aprovado',
    texto,
    origem: 'aprendido',
    criadoEm: novo.agoraIso,
    rascunhoId: novo.rascunhoId,
  }
  const meus = outros.filter((e) => e.origem === 'meu')
  const aprendidos = [aprendido, ...outros.filter((e) => e.origem === 'aprendido')]
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .slice(0, estilo.aprendidosMax)
  return { ...estilo, exemplos: [...meus, ...aprendidos] }
}
