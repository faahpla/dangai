import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Nickname, NicknameSuggestion } from '@shared/channels'

/**
 * Como o Kintay chama cada personagem quando escreve o roteiro.
 *
 * O leitor de roteiro acha nome escrito ("o Rimuru") e resolve pronome ("ele")
 * com regra, sem modelo nenhum. O que regra nao alcanca e o APELIDO: "o slime"
 * e o Rimuru, "uma Lorde Demonio" e a Luminous. Isso e conhecimento da serie, e
 * nao esta no texto.
 *
 * Medido no roteiro de teoria dele sobre Tensura, 16 frases com personagem:
 *
 *   so nome escrito ............  9 acertos, 0 errado
 *   + arrasto de pronome ....... 14 acertos, 2 errados
 *   + estes apelidos ........... 16 acertos, 1 errado
 *
 * Duas linhas cadastradas fecharam o buraco. O modelo local de 7B tentou fazer
 * o mesmo e disse que "uma Lorde Demonio" era a Chloe, quando e a Luminous --
 * o que poria a personagem errada em meia duzia de blocos. Num video de teoria
 * imagem que contradiz a narracao e pior que imagem nenhuma, e por isso quem
 * decide aqui e ele, nao um modelo.
 */

/** serie (nome da pasta) -> apelidos dela */
type Arquivo = Record<string, Nickname[]>

let caminho: string | null = null

export function configureNicknames(userDataDir: string): void {
  caminho = join(userDataDir, 'apelidos.json')
}

export function readNicknames(): Record<string, Nickname[]> {
  if (!caminho) throw new Error('Apelidos nao configurados')
  try {
    const cru: unknown = JSON.parse(readFileSync(caminho, 'utf8'))
    return coerce(cru)
  } catch {
    // Sem arquivo ainda, ou arquivo corrompido: comeca vazio em vez de derrubar
    // a Biblioteca por causa de uma lista de conveniencia.
    return {}
  }
}

/**
 * Substitui a lista INTEIRA de uma serie.
 *
 * Lista inteira e nao "acrescenta um" de proposito: a tela edita a lista toda,
 * e mandar o estado final evita ter que resolver conflito entre acrescentar e
 * remover na mesma leva.
 */
export function saveNicknames(
  series: string,
  lista: readonly Nickname[],
): Record<string, Nickname[]> {
  if (!caminho) throw new Error('Apelidos nao configurados')
  if (!series.trim()) throw new Error('Sem serie para guardar o apelido.')

  const todos = readNicknames()
  const limpos = limpar(lista)

  if (limpos.length > 0) todos[series] = limpos
  else delete todos[series]

  mkdirSync(dirname(caminho), { recursive: true })
  // Temporario e rename, como o settings: morrer no meio da escrita deixa o
  // arquivo antigo intacto em vez de virar json pela metade.
  const temp = caminho + '.tmp'
  writeFileSync(temp, JSON.stringify(todos, null, 2), 'utf8')
  renameSync(temp, caminho)

  return todos
}

/**
 * Descarta vazio e repetido.
 *
 * Repetido e por TERMO, comparado sem acento e sem caixa: "Slime" e "slime" nao
 * sao duas regras, e a segunda so sobrescreveria a primeira na hora de casar.
 * Fica a ultima, que e a que ele acabou de escrever.
 */
function limpar(lista: readonly Nickname[]): Nickname[] {
  const porTermo = new Map<string, Nickname>()
  for (const item of lista) {
    const term = item.term.trim()
    const character = item.character.trim()
    if (!term || !character) continue
    porTermo.set(normalizar(term), { term, character })
  }
  return [...porTermo.values()].sort((a, b) => a.term.localeCompare(b.term, 'pt-BR'))
}

/** Sem acento, sem caixa. O mesmo tratamento que a busca da Biblioteca usa. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function coerce(cru: unknown): Record<string, Nickname[]> {
  if (typeof cru !== 'object' || cru === null) return {}
  const saida: Arquivo = {}
  for (const [serie, lista] of Object.entries(cru as Record<string, unknown>)) {
    if (!Array.isArray(lista)) continue
    const itens: Nickname[] = []
    for (const item of lista as { term?: unknown; character?: unknown }[]) {
      if (typeof item?.term === 'string' && typeof item?.character === 'string') {
        itens.push({ term: item.term, character: item.character })
      }
    }
    if (itens.length > 0) saida[serie] = itens
  }
  return saida
}

// ------------------------------------------------------- sugestao pelo modelo

/** Onde o Ollama atende quando esta rodando. Nao subimos nem instalamos nada. */
const OLLAMA = 'http://127.0.0.1:11434'

/**
 * O modelo local sugere, o usuario decide.
 *
 * Este e o unico lugar onde ele entra, e de proposito: medido, ele acerta o
 * apelido famoso ("slime" e o Rimuru) e erra o menos famoso -- chegou a dizer
 * que "uma Lorde Demonio" era a Chloe, e ainda inventou um apelido que nao
 * existia no texto.
 *
 * Errar sugerindo nao custa nada, porque ele esta olhando a lista na hora de
 * confirmar. Errar decidindo sozinho custaria o video.
 */
export async function suggestNicknames(
  series: string,
  characters: readonly string[],
): Promise<NicknameSuggestion[]> {
  if (characters.length === 0) return []

  const modelo = await modeloDisponivel()
  if (!modelo) {
    throw new Error(
      'O Ollama nao respondeu. Ele e opcional -- da para cadastrar os apelidos na mao.',
    )
  }

  const prompt = [
    'A serie de anime e "' + series + '".',
    '',
    'Personagens dela:',
    characters.join(', '),
    '',
    'Como fas e videos costumam chamar esses personagens SEM usar o nome?',
    'Exemplos do tipo de coisa: um apelido ("o slime"), um titulo ("o rei demonio"),',
    'uma descricao ("a garota de cabelo branco").',
    '',
    'Regras:',
    '- So apelidos que voce tem certeza. Poucos e certos e melhor que muitos.',
    '- O personagem tem que ser um da lista acima.',
    '- Nao invente apelido generico que serviria para qualquer um.',
    '',
    'So JSON: {"apelidos":[{"termo":"...","personagem":"..."}]}',
  ].join('\n')

  const resposta = await fetch(OLLAMA + '/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: modelo,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0, num_predict: 400 },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!resposta.ok) throw new Error('O Ollama respondeu ' + resposta.status + '.')

  const corpo = (await resposta.json()) as { response?: string }
  let cru: unknown
  try {
    cru = JSON.parse(corpo.response ?? '')
  } catch {
    throw new Error('O modelo respondeu algo que nao era JSON. Tente de novo, ou cadastre na mao.')
  }

  const lista = (cru as { apelidos?: unknown }).apelidos
  if (!Array.isArray(lista)) return []

  /*
   * Sugestao que aponta para personagem inexistente morre aqui. O modelo
   * devolve nome curto ("Rimuru") onde a biblioteca tem "Tempest, Rimuru", e
   * casar isso e a mesma regra de subconjunto que ja unifica as grafias --
   * inclusive recusando o ambiguo em vez de chutar.
   */
  const vistos = new Set<string>()
  const saida: NicknameSuggestion[] = []
  for (const item of lista as { termo?: unknown; personagem?: unknown }[]) {
    const termo = typeof item.termo === 'string' ? item.termo.trim() : ''
    const alvo = typeof item.personagem === 'string' ? item.personagem : ''
    if (termo.length < 3) continue
    const character = casar(alvo, characters)
    if (!character) continue
    const chave = normalizar(termo)
    if (vistos.has(chave)) continue
    vistos.add(chave)
    saida.push({ term: termo, character })
  }
  return saida
}

/** O Ollama esta no ar? Com qual modelo? So usamos o que ele ja baixou. */
async function modeloDisponivel(): Promise<string | null> {
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(2000) })
    if (!r.ok) return null
    const corpo = (await r.json()) as { models?: { name?: unknown }[] }
    const nomes = (corpo.models ?? [])
      .map((m) => (typeof m.name === 'string' ? m.name : ''))
      .filter((n) => n.length > 0)
    if (nomes.length === 0) return null
    // Instruct primeiro: modelo base nao obedece o pedido de JSON.
    return nomes.find((n) => /instruct/i.test(n)) ?? nomes[0]!
  } catch {
    return null
  }
}

function fichas(nome: string): string[] {
  return normalizar(nome)
    .split(/[^a-z0-9]+/)
    .filter((f) => f.length > 0)
}

/** Nome solto -> nome da biblioteca. Cabe em UM, ou nao casa. */
function casar(solto: string, existentes: readonly string[]): string | null {
  const f = fichas(solto)
  if (f.length === 0) return null

  const exato = existentes.filter((p) => fichas(p).sort().join(' ') === [...f].sort().join(' '))
  if (exato.length === 1) return exato[0]!

  // Nos dois sentidos: o modelo diz "Rimuru" para "Tempest, Rimuru", e
  // "Granbell Rosso" para "Granbell".
  const cabe = existentes.filter((p) => {
    const g = fichas(p)
    return f.every((x) => g.includes(x)) || g.every((x) => f.includes(x))
  })
  return cabe.length === 1 ? cabe[0]! : null
}
