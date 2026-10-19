/**
 * [recap] OS APELIDOS DE UM PERSONAGEM NUM EPISODIO (teste real do Magic Repo
 * Man E02, 18/10): a fadinha tinha dois nomes. O reconhecimento (AniList) a
 * chama de "Empee"; a legenda, de "MP" e de "MP<U+30FB>Yggdrasil". No filtro de
 * personagens ela virava dois chips ("Empee" e "MP <U+00B7> Yggdrasil"), o roteiro
 * que dizia "a fadinha MP" nao achava as cenas dela, e o rosto da Edicao
 * rapida procurava uma "MP" que o motor nao conhece.
 *
 * Duas regras, estreitas de proposito (juntar duas pessoas e pior que deixar
 * uma com dois nomes):
 * - SIGLA SOLETRADA: "MP" e "Empee" / "Em-pee" / "Emu Pi" (o nome das letras
 *   em ingles, ou no romaji); "CC" e "Cee-cee". A sigla e uma palavra de 2 a 4
 *   letras MAIUSCULAS (ou "C.C."); o outro nome, inteiro, e a soletracao;
 * - APELIDO NA LEGENDA: "MP<U+30FB>Yggdrasil" (o ponto do meio japones U+30FB, ou U+00B7 e
 *   U+2022) e UMA pessoa com dois nomes: as partes viram a mesma pessoa.
 *
 * O nome que fica (canonico) e o do ROSTO reconhecido quando ha: e o que o
 * motor e o AnCut conhecem. Puro: roda no main, no renderer e nos testes.
 */

/** O nome de cada letra, em ingles e em romaji (o que o AniList e a legenda escrevem). */
const NOMES_DAS_LETRAS: Readonly<Record<string, readonly string[]>> = {
  a: ['a', 'ei', 'ay', 'ey', 'ee'],
  b: ['bi', 'bee', 'be'],
  c: ['ci', 'si', 'see', 'cee', 'shi', 'shii', 'ce'],
  d: ['di', 'dee', 'de', 'dii'],
  e: ['e', 'i', 'ee', 'ii'],
  f: ['ef', 'eff', 'efu'],
  g: ['ji', 'gee', 'jee', 'ge', 'jii'],
  h: ['eich', 'aitch', 'eichi', 'etchi', 'aga'],
  i: ['ai', 'eye', 'i'],
  j: ['jei', 'jay', 'je', 'jee'],
  k: ['kei', 'kay', 'ke', 'ka'],
  l: ['el', 'ell', 'eru', 'ele'],
  m: ['em', 'emu', 'eme'],
  n: ['en', 'enu', 'ene'],
  o: ['o', 'oh', 'ou', 'oo'],
  p: ['pi', 'pee', 'pii', 'pe'],
  q: ['kyu', 'cue', 'kew', 'kyuu', 'que'],
  r: ['ar', 'are', 'aru', 'erre'],
  s: ['es', 'ess', 'esu', 'esse'],
  t: ['ti', 'tee', 'tii', 'te'],
  u: ['yu', 'you', 'yuu', 'u'],
  v: ['vi', 'vee', 'bui', 've'],
  w: ['dabliu', 'doubleyou', 'daburu', 'dablyu'],
  x: ['ex', 'ekusu', 'ekkusu', 'xis', 'eks'],
  y: ['wai', 'why', 'ipsilon'],
  z: ['zi', 'zee', 'zed', 'zetto', 'ze'],
}

/** O separador do apelido na legenda: "MP<U+30FB>Yggdrasil", "MP <U+00B7> Yggdrasil", "MP <U+2022> Yggdrasil". */
const SEPARADOR_DE_APELIDO = /\s*[\u30FB\u00B7\u2022\uFF65\u2027\u2219]\s*/

/** Sem acento, minusculas, so letras e numeros (juntos). */
function soLetras(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** "MP", "CC", "C.C." -> as letras ("mp", "cc"); null = nao e sigla. */
export function letrasDaSigla(nome: string): string | null {
  const limpo = nome.trim()
  if (/^[A-Z]{2,4}$/.test(limpo)) return limpo.toLowerCase()
  if (/^(?:[A-Z]\.){2,4}$/.test(limpo)) return limpo.replace(/\./g, '').toLowerCase()
  return null
}

/** Todas as soletracoes da sigla, juntas: "mp" -> "empee", "empi", "emupii"... */
export function soletracoes(letras: string): Set<string> {
  let atuais = ['']
  for (const letra of letras) {
    const nomes = NOMES_DAS_LETRAS[letra]
    if (!nomes) return new Set()
    atuais = atuais.flatMap((a) => nomes.map((n) => a + n))
  }
  return new Set(atuais)
}

/** Um nome e a sigla soletrada do outro ("MP" e "Empee", "Cee-cee" e "CC")? */
export function mesmaSigla(a: string, b: string): boolean {
  const confere = (sigla: string, outro: string): boolean => {
    const letras = letrasDaSigla(sigla)
    if (!letras) return false
    const junto = soLetras(outro)
    return junto.length > letras.length && soletracoes(letras).has(junto)
  }
  return confere(a, b) || confere(b, a)
}

/** As partes de um nome com apelido ("MP<U+30FB>Yggdrasil" -> ["MP", "Yggdrasil"]); sem apelido, o nome so. */
export function partesDoNome(nome: string): string[] {
  const partes = nome
    .split(SEPARADOR_DE_APELIDO)
    .map((p) => p.trim())
    .filter(Boolean)
  return partes.length > 1 ? partes : [nome.trim()]
}

/** Os dois nomes sao a mesma pessoa pelas regras daqui (igual sem acento/caixa, ou sigla soletrada). */
function mesmo(a: string, b: string): boolean {
  const x = soLetras(a)
  return (x.length > 0 && x === soLetras(b)) || mesmaSigla(a, b)
}

/**
 * Os apelidos do episodio: nome cru -> o nome do personagem. `principais` sao
 * os nomes dos ROSTOS reconhecidos (ficam como estao: sao o canonico); `outros`
 * sao os falantes da legenda e os personagens dos eventos. So entra no mapa o
 * nome que MUDA. Um nome que cabe em dois rostos fica de fora (ambiguo).
 */
export function apelidosDoElenco(principais: Iterable<string>, outros: Iterable<string>): Map<string, string> {
  const rostos = [...new Set([...principais].map((n) => n.trim()).filter(Boolean))]
  const nomes = [...new Set([...outros].map((n) => n.trim()).filter(Boolean))]
  const mapa = new Map<string, string>()
  const rostoDe = (nome: string): string | null => {
    const achados = rostos.filter((r) => partesDoNome(nome).some((p) => mesmo(p, r)) || mesmo(nome, r))
    return achados.length === 1 ? achados[0]! : null
  }
  // 1) Pelo rosto: "MP" e "MP<U+30FB>Yggdrasil" -> "Empee"; as partes do apelido vao junto.
  for (const nome of nomes) {
    const rosto = rostoDe(nome)
    if (!rosto) continue
    if (nome !== rosto) mapa.set(nome, rosto)
    for (const parte of partesDoNome(nome)) if (parte !== rosto && !rostos.includes(parte)) mapa.set(parte, rosto)
  }
  // 2) Apelido sem rosto: as partes viram a primeira ("X<U+30FB>Y" e "Y" -> "X").
  for (const nome of nomes) {
    const partes = partesDoNome(nome)
    if (partes.length < 2 || mapa.has(nome)) continue
    const dono = mapa.get(partes[0]!) ?? partes[0]!
    mapa.set(nome, dono)
    for (const parte of partes.slice(1)) if (!mapa.has(parte) && !rostos.includes(parte)) mapa.set(parte, dono)
  }
  // 3) As partes soltas que ja tem dono ("Yggdrasil" sozinho, falante de outra fala).
  for (const nome of nomes) {
    if (mapa.has(nome)) continue
    const dono = [...mapa.entries()].find(([k]) => partesDoNome(k).length > 1 && partesDoNome(k).includes(nome))?.[1]
    if (dono && dono !== nome) mapa.set(nome, dono)
  }
  return mapa
}

/** O nome do personagem (o canonico) de um nome cru. */
export function nomeDoPersonagem(nome: string, apelidos: ReadonlyMap<string, string>): string {
  return apelidos.get(nome.trim()) ?? nome
}

/**
 * Os falantes da legenda unidos pelo apelido ("MP" 181 + "MP<U+30FB>Yggdrasil" 4 +
 * "Yggdrasil" 1 = um so, 186 falas), com a grafia mais usada na legenda.
 */
export function falantesUnidos<T extends { nome: string; falas: number }>(
  falantes: readonly T[],
  apelidos: ReadonlyMap<string, string>,
): { nome: string; falas: number; grafias: string[] }[] {
  const grupos = new Map<string, { falas: number; grafias: Map<string, number> }>()
  for (const f of falantes) {
    const dono = nomeDoPersonagem(f.nome, apelidos)
    const g = grupos.get(dono) ?? { falas: 0, grafias: new Map<string, number>() }
    g.falas += f.falas
    g.grafias.set(f.nome, (g.grafias.get(f.nome) ?? 0) + f.falas)
    grupos.set(dono, g)
  }
  return [...grupos.values()]
    .map((g) => {
      const grafias = [...g.grafias.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
      return { nome: grafias[0]!, falas: g.falas, grafias }
    })
    .sort((a, b) => b.falas - a.falas)
}
