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
 * O bloco so entra no prompt quando ha estilo. Desde 18/10 (pedido A4 do
 * Levi) ele MANDA no tom e na estrutura: vai no comeco do sistema do
 * roteirista, antes do tom padrao, e as regras do app que brigavam com ele
 * (o "Mano" banido, o pedido ao espectador...) saem. As regras fixas ficam so
 * para o que nao pode quebrar: fidelidade, nomes e formato (prompts.ts).
 *
 * As INSTRUCOES tambem passam pela mascara (instrucoesParaPrompt): o guia do
 * GPT dele (Kiumaz) cita personagens nos exemplos ("o Senku", "o Will").
 */

/** O guia do GPT dele tem ~10 mil caracteres; 4 mil (o teto ate a 1.68) cortava no meio. */
export const INSTRUCOES_MAX = 12000
/** O teto antigo: instrucoes com exatamente este tamanho foram cortadas pela versao de antes. */
export const INSTRUCOES_MAX_ANTIGO = 4000
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
const NAO_E_NOME = new Set(['eu', 'tv', 'ok', 'ep', 'eps', 'anime', 'deus', 'plot', 'twist', 'wikipedia', 'shorts', 'hook', 'build', 'cta', 'youtube', 'tiktok'])

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

/**
 * Pode ser nome: maiuscula so na primeira letra. Palavra toda em CAIXA ALTA e
 * enfase do editor ("um segredo que muda TUDO", "PORCO IMORTAL") e nao entra
 * na lista -- mas um nome achado em outro lugar continua mascarado em caixa
 * alta tambem (mascararNomes so olha a primeira letra).
 */
function pareceNome(palavra: string): boolean {
  if (!maiuscula(palavra) || NAO_E_NOME.has(forma(palavra))) return false
  const letras = palavra.replace(/[^\p{L}]/gu, '')
  return !(letras.length >= 2 && letras === letras.toUpperCase())
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
 * As formas que aparecem com MINUSCULA em algum dos textos: palavra comum que
 * as vezes vem com maiuscula ("Shorts" no titulo e "anime shorts" nas tags,
 * o "A" de "Mano, A Frieren"), e nao nome. Sem isto a mascara trocava o "A"
 * do comeco de toda frase por "[PERSONAGEM n]".
 */
function formasMinusculas(textos: readonly string[]): Set<string> {
  const formas = new Set<string>()
  for (const texto of textos) {
    for (const m of texto.matchAll(PALAVRA)) {
      const primeira = m[0][0] ?? ''
      if (primeira !== primeira.toUpperCase() && primeira === primeira.toLowerCase()) formas.add(forma(m[0]))
    }
  }
  return formas
}

/**
 * Os NOMES de um conjunto de textos: toda palavra com maiuscula fora do
 * comeco da frase (a mesma palavra no comeco de outra frase tambem e nome),
 * menos as que aparecem com minuscula em algum dos textos (palavra comum), e
 * os nomes do elenco (cada palavra deles, onde quer que aparecam). Devolve as
 * formas (sem acento, minusculas).
 */
export function nomesNosTextos(textos: readonly string[], elenco: readonly string[] = []): Set<string> {
  const nomes = new Set<string>()
  for (const texto of textos) {
    for (const p of pedacos(texto)) {
      if (!p.comecoDeFrase && pareceNome(p.palavra)) nomes.add(forma(p.palavra))
    }
  }
  for (const comum of formasMinusculas(textos)) nomes.delete(comum)
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
 * Linha de TITULO (quase toda palavra com maiuscula): "Ele Despertou o Maior
 * Poder da Historia", "PODER SECRETO", "## Estilo de Roteiro". Nas instrucoes
 * ela nao diz quem e nome -- senao o exemplo de titulo do guia virava mascara.
 */
function linhaDeTitulo(linha: string): boolean {
  const palavras = [...linha.matchAll(PALAVRA)].map((m) => m[0]).filter((p) => p.length >= 3)
  if (palavras.length < 2) return false
  return palavras.filter(maiuscula).length / palavras.length >= 0.6
}

/**
 * Os nomes do ESTILO INTEIRO, para a mascara dos exemplos e das instrucoes
 * (o mesmo conjunto e o mesmo numero nos dois): toda palavra com maiuscula
 * no meio da frase dos exemplos e das instrucoes -- nas instrucoes, fora das
 * linhas de titulo ("Ele Despertou o Maior Poder" e exemplo de titulo, nao
 * nome) --, menos as que aparecem com minuscula em algum texto, mais o elenco.
 * O "Senku" e o "Will" do guia dele saem; o "Kiumaz" (que tambem aparece como
 * "kiumaz" nas tags) e o "Shorts" ficam.
 */
export function nomesDoEstilo(instrucoes: string, exemplos: readonly string[], elenco: readonly string[] = []): Set<string> {
  const nomes = new Set<string>()
  const juntar = (texto: string): void => {
    for (const p of pedacos(texto)) {
      if (!p.comecoDeFrase && pareceNome(p.palavra)) nomes.add(forma(p.palavra))
    }
  }
  for (const texto of exemplos) juntar(texto)
  for (const linha of instrucoes.split('\n')) if (!linhaDeTitulo(linha)) juntar(linha)
  for (const comum of formasMinusculas([instrucoes, ...exemplos])) nomes.delete(comum)
  for (const nome of elenco) {
    for (const m of nome.matchAll(PALAVRA)) {
      const f = forma(m[0])
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

/** A mascara dividida entre exemplos e instrucoes: o mesmo nome, o mesmo numero. */
export interface MascaraDoEstilo {
  nomes: ReadonlySet<string>
  mapa: Map<string, number>
}

export function mascaraDoEstilo(estilo: Pick<EstiloDoRecap, 'instrucoes' | 'exemplos'>, elenco: readonly string[] = []): MascaraDoEstilo {
  return { nomes: nomesDoEstilo(estilo.instrucoes, estilo.exemplos.map((e) => e.texto), elenco), mapa: new Map() }
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
  mascara: MascaraDoEstilo = mascaraDoEstilo(estilo, elenco),
): ExemplosNoPrompt {
  const ordem = [...estilo.exemplos].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
  const textos: { id: string; texto: string }[] = []
  const cortados: string[] = []
  let tokens = 0
  for (const e of ordem) {
    const mascarado = mascararNomes(e.texto, mascara.nomes, mascara.mapa)
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
 * As INSTRUCOES dele como vao ao prompt: com os nomes de personagem
 * mascarados (o guia do GPT dele cita "o Senku", "o Will"). Vazio = sem.
 */
export function instrucoesParaPrompt(
  estilo: Pick<EstiloDoRecap, 'instrucoes' | 'exemplos'>,
  elenco: readonly string[] = [],
  mascara: MascaraDoEstilo = mascaraDoEstilo(estilo, elenco),
): string {
  const texto = estilo.instrucoes.trim()
  return texto ? mascararNomes(texto, mascara.nomes, mascara.mapa) : ''
}

/**
 * O BLOCO "ESTILO DO EDITOR". null = sem estilo. Vai no COMECO do sistema do
 * roteirista (prompts.ts), antes do tom padrao, e diz que o estilo MANDA no
 * tom e na estrutura; as regras fixas (fidelidade, nomes, formato) vem
 * depois e valem com qualquer estilo.
 */
export function blocoDoEstilo(estilo: EstiloDoRecap, elenco: readonly string[] = []): string | null {
  if (!temEstilo(estilo)) return null
  const mascara = mascaraDoEstilo(estilo, elenco)
  const linhas = [
    'ESTILO DO EDITOR — ELE MANDA NO TOM E NA ESTRUTURA. Escreva do JEITO dele: como ele abre (o gancho), o contexto, como a tensão cresce, o momento chave, como ele fecha, os conectivos, as gírias e o tamanho das frases. Onde o estilo dele e o tom padrão do app discordarem, vale o DELE. Só as REGRAS FIXAS do fim (fidelidade, nomes e formato) valem acima dele: o estilo muda o jeito de contar, nunca os fatos.',
  ]
  const instrucoes = instrucoesParaPrompt(estilo, elenco, mascara)
  if (instrucoes) linhas.push(`INSTRUÇÕES DELE: ${instrucoes}`)
  const ex = exemplosParaPrompt(estilo, elenco, TETO_DE_TOKENS_DOS_EXEMPLOS, mascara)
  if (ex.textos.length > 0) {
    linhas.push(
      `ROTEIROS DE EXEMPLO QUE ELE APROVOU (${ex.textos.length}; de OUTROS episódios e de OUTRAS séries, com os nomes trocados por [PERSONAGEM n]). Use como referência de TOM, RITMO e ESTRUTURA: como ele abre, o tamanho das frases, as gírias, os conectivos, como ele fecha. NUNCA copie deles fatos, nomes, lugares, termos, acontecimentos nem frases inteiras — os fatos vêm só dos ACONTECIMENTOS deste episódio, e os nomes só do ELENCO dele. Nunca escreva "[PERSONAGEM n]" no roteiro.`,
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
