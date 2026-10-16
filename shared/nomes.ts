/**
 * As varias grafias do mesmo personagem viram UM nome, dentro de cada serie.
 *
 * Mora em shared, e nao dentro de electron/services/library.ts, para poder ser
 * medido contra o acervo real sem subir o app -- e cada regra daqui ja custou
 * uma medicao para acertar.
 *
 * O `character_id` do AnCut nao resolve: ele vale por conjunto de referencias,
 * nao por pessoa. Medido no acervo real, o Rimuru aparece com NOVE combinacoes
 * de nome e id ("Tempest, Rimuru" com os ids 157, 582 e 706, "Rimuru Tempest"
 * com 261 e 97, e por ai). Juntar por id entre episodios juntaria gente
 * diferente; e nao juntar deixava 102 cenas dele invisiveis no filtro.
 */

/** Sem acento, minusculas, so as palavras, ordenadas: "Tempest, Rimuru" == "Rimuru Tempest". */
export function fichasDoNome(nome: string): string[] {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
}

/** Distancia de edicao, com teto: acima de `teto` a resposta e so "longe demais". */
function distancia(a: string, b: string, teto: number): number {
  if (Math.abs(a.length - b.length) > teto) return teto + 1
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const atual = [i]
    let menor = i
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1
      atual[j] = Math.min(anterior[j]! + 1, atual[j - 1]! + 1, anterior[j - 1]! + custo)
      if (atual[j]! < menor) menor = atual[j]!
    }
    if (menor > teto) return teto + 1
    anterior = atual
  }
  return anterior[b.length]!
}

/**
 * Os dois nomes sao a MESMA pessoa escrita com um erro de digitacao?
 *
 * Existe por causa do Lye: no acervo dele ele aparece como "Batenkaitos, Lye"
 * e como "Batenakaitos, Lye". Com as duas grafias, a palavra "lye" apontava
 * para dois personagens, o leitor do roteiro a descartava por ambigua -- e o
 * roteiro que falava dele o tempo todo sugeria cena de outro anime.
 *
 * A regra e estreita de proposito, porque juntar duas pessoas numa so e pior
 * que deixar uma com duas grafias:
 *
 *   - as duas tem o MESMO numero de palavras, e pelo menos duas;
 *   - SO UMA palavra difere, e as outras sao identicas -- o nome proprio igual
 *     segura que e a mesma pessoa;
 *   - a palavra que difere tem 5 letras ou mais dos dois lados, e fica a no
 *     maximo 2 edicoes da outra -- ou so difere na vogal longa do romaji
 *     (semVogalLonga), em qualquer tamanho.
 *
 * "Rem" e "Ram" nao se juntam (uma palavra so, e curtas). "Kurosaki, Ichigo" e
 * "Kurosaki, Isshin" nao se juntam (4 edicoes).
 */
export function mesmaPessoaComErro(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length || a.length < 2) return false
  const sobraA = [...a]
  const sobraB: string[] = []
  for (const f of b) {
    const i = sobraA.indexOf(f)
    if (i >= 0) sobraA.splice(i, 1)
    else sobraB.push(f)
  }
  if (sobraA.length !== 1 || sobraB.length !== 1) return false
  const x = sobraA[0]!
  const y = sobraB[0]!
  if (semVogalLonga(x) === semVogalLonga(y)) return true
  if (Math.min(x.length, y.length) < 5) return false
  return distancia(x, y, 2) <= 2
}

/**
 * A vogal longa do romaji, que cada fonte escreve de um jeito: o MyAnimeList
 * da "Saionji, Ukyou" e "Ishigami, Senkuu", o AniList "Ukyo Saionji" e
 * "Senku Ishigami". No Dr. Stone S4E37 os dois nomes do Ukyo
 * vieram com ids diferentes, e "ukyo" tem 4 letras -- abaixo do piso do erro
 * de digitacao. Fica estreito pelo resto da regra: o sobrenome tem que ser
 * identico.
 */
function semVogalLonga(palavra: string): string {
  return palavra.replace(/ou/g, 'o').replace(/uu/g, 'u').replace(/oo/g, 'o')
}

/** nome cru -> nome escolhido, para uma serie. `contagem` e quantas cenas usam cada nome cru. */
export function canonizar(contagem: ReadonlyMap<string, number>): ReadonlyMap<string, string> {
  interface Grupo {
    fichas: string[]
    nomes: [string, number][]
  }

  // 1) Mesmas palavras, mesma pessoa. Pega inversao e caixa de uma vez.
  const grupos = new Map<string, Grupo>()
  for (const [nome, n] of contagem) {
    const f = fichasDoNome(nome)
    const chave = f.join(' ')
    const g = grupos.get(chave) ?? { fichas: f, nomes: [] }
    g.nomes.push([nome, n])
    grupos.set(chave, g)
  }

  /*
   * 1b) Erro de digitacao: a grafia mais usada absorve a outra. Vem ANTES da
   * regra do nome curto, e isso importa -- com as duas grafias do Lye ainda
   * separadas, um "Lye" sozinho caberia em DOIS nomes longos e ficaria de fora
   * por ambiguidade.
   */
  const uso = (g: Grupo): number => g.nomes.reduce((s, [, n]) => s + n, 0)
  const lista = [...grupos.keys()]
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      const a = grupos.get(lista[i]!)
      const b = grupos.get(lista[j]!)
      if (!a || !b || !mesmaPessoaComErro(a.fichas, b.fichas)) continue
      const [fica, sai, chaveQueSai] = uso(a) >= uso(b) ? [a, b, lista[j]!] : [b, a, lista[i]!]
      fica.nomes.push(...sai.nomes)
      grupos.delete(chaveQueSai)
    }
  }

  /*
   * 2) Nome curto entra no longo -- mas so quando cabe em UM. "Rudeus" so pode
   * ser "Greyrat, Rudeus"; ja "Greyrat" sozinho caberia em Rudeus, Paul, Zenith
   * e Eris, e um palpite ali juntaria a familia inteira numa pessoa so.
   */
  const chaves = [...grupos.keys()]
  const destino = new Map<string, string>()
  for (const chave of chaves) {
    const g = grupos.get(chave)!
    const maiores = chaves.filter((outra) => {
      if (outra === chave) return false
      const o = grupos.get(outra)!
      return g.fichas.length < o.fichas.length && g.fichas.every((f) => o.fichas.includes(f))
    })
    if (maiores.length === 1) destino.set(chave, maiores[0]!)
  }

  // 3) Fica a grafia mais usada: e a que ele reconhece de ver na tela do AnCut.
  const juntos = new Map<string, [string, number][]>()
  for (const chave of chaves) {
    const alvo = destino.get(chave) ?? chave
    juntos.set(alvo, [...(juntos.get(alvo) ?? []), ...grupos.get(chave)!.nomes])
  }

  const mapa = new Map<string, string>()
  for (const nomes of juntos.values()) {
    const escolhido = nomes.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
    for (const [nome] of nomes) mapa.set(nome, escolhido)
  }
  return mapa
}

/**
 * Uma palavra que se le inteira como romaji: silabas do japones, o "n" que
 * fecha silaba e a consoante dobrada. "Senkuu", "Ryuusui", "Ukyou" e "Inoue"
 * passam; "Gourry", "Louis" e "Douglas" nao.
 */
const ROMAJI = /^(?:(?:sh|ch|ts|[kgnhbpmr]y|[kgsztdnhbpmrwyfjv])?[aiueo]|n(?![aiueoy])|([kgsztdhbpmcfj])(?=\1)|t(?=ch))+$/

/**
 * A vogal longa encurtada, so para a TELA: "Senkuu" -> "Senku", "Ryuusui" ->
 * "Ryusui", "Ukyou" -> "Ukyo". Sem isto o mesmo personagem aparecia com tres
 * grafias: a do MyAnimeList onde nao ha legenda com nomes (.srt), a da
 * legenda onde ha (.ass), e a crua na Biblioteca.
 *
 * Estreita de proposito: so "uu" e o "ou" que fecha silaba -- o "ou" antes de
 * vogal e outra coisa ("Inoue" e i-no-u-e), e antes de consoante dobrada e
 * nome de fora ("Rousseau") --, e so em palavra que e romaji ("Gourry" fica).
 * O "oo" fica: "Taiju Ooki" e assim nas duas fontes.
 */
export function vogalLongaCurta(palavra: string): string {
  if (!ROMAJI.test(palavra.toLowerCase())) return palavra
  return palavra.replace(/([uU])[uU]/g, '$1').replace(/([oO])[uU](?![aeiouAEIOU]|(.)\2)/g, '$1')
}

/**
 * O nome como se fala, so para a TELA (o indice guarda o nome cru).
 *
 * O MyAnimeList escreve "Ishigami, Senkuu" -- sobrenome, virgula, nome --, e
 * lido assim na lista de personagens parece ficha de cadastro. Vira "Senku
 * Ishigami", a ordem da AniList. Com `falantes` (os nomes de uma legenda),
 * cada palavra segue a grafia de la quando e o mesmo nome com outra vogal
 * longa (semVogalLonga): o Name do .ass diz "Senku", entao a tela diz "Senku
 * Ishigami". Sem eles, a vogal longa encurta do mesmo jeito (vogalLongaCurta).
 */
export function nomeNatural(nome: string, falantes: readonly string[] = []): string {
  const limpo = nome.trim().replace(/\s+/g, ' ')
  const m = /^([^,]+),\s*([^,]+)$/.exec(limpo)
  const ordem = m ? `${m[2]!.trim()} ${m[1]!.trim()}` : limpo
  const grafia = new Map<string, string>()
  for (const falante of falantes) {
    for (const palavra of falante.trim().split(/\s+/)) {
      if (!/^[A-Za-z]{2,}$/.test(palavra)) continue
      const chave = semVogalLonga(palavra.toLowerCase())
      if (!grafia.has(chave)) grafia.set(chave, palavra)
    }
  }
  return ordem
    .split(' ')
    .map((palavra) => {
      const da = grafia.get(semVogalLonga(palavra.toLowerCase()))
      if (!da) return vogalLongaCurta(palavra)
      // Legenda em caixa alta ("SENKU") nao manda na caixa: so na grafia.
      const caixaUnica = da === da.toUpperCase() || da === da.toLowerCase()
      return caixaUnica ? da.charAt(0).toUpperCase() + da.slice(1).toLowerCase() : da
    })
    .join(' ')
}
