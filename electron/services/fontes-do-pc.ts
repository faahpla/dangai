import { existsSync } from 'node:fs'
import { open, readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { VarianteDaFonte } from '@shared/contract'

/**
 * AS FONTES INSTALADAS NO PC, para a legenda (26/11, pedido do Faah: "nunca vi
 * eu ter que colar um .ttf nessa bomba pra conseguir; pq nao busca as fontes
 * que estao instaladas na maquina? igual no modulo de thumbnail").
 *
 * Le as duas pastas de fontes do Windows (a do sistema e a do usuario, onde o
 * "Instalar so para mim" poe) e agrupa os arquivos por FAMILIA, do jeito que o
 * Word mostra: "Arial" e uma familia so, com o normal, o negrito, o italico e o
 * negrito italico em arquivos separados (arial.ttf, arialbd.ttf...). E isso que
 * deixa o botao Negrito usar o negrito DE VERDADE da fonte quando ela tem.
 *
 * O render roda num Chrome proprio, entao a legenda continua carregando o
 * ARQUIVO (servido pelo 127.0.0.1), e nao o nome -- o mesmo caminho das fontes
 * da pasta. Aqui so se descobre quais arquivos existem e de que familia sao.
 *
 * So .ttf e .otf: a colecao .ttc o FontFace nao abre de forma confiavel.
 * Puro Node (sem electron): o teste roda isto direto.
 */

const EXTENSOES = new Set(['.ttf', '.otf'])
/** As fontes de icones do Windows, que declaram letras mas desenham simbolos. */
const SO_ICONES = /\b(icons|mdl2 assets|emoji)\b/i
/** Fonte maior que isto (as CJK de 20+ MB) nao serve para legenda e pesaria o render. */
const MAIOR_FONTE = 30 * 1024 * 1024

/** O que se le de dentro de um arquivo de fonte. */
export interface DadosDaFonte {
  /** A familia "do Word" (nome 1 da tabela `name`): Arial, Arial Black, Bahnschrift... */
  familia: string
  negrito: boolean
  italico: boolean
  /** Fonte de simbolos (Wingdings, Webdings, Marlett): nao escreve letra. */
  simbolo?: boolean
}

/** Um arquivo instalado, ja com a familia e o estilo. */
export interface ArquivoDaFonte extends DadosDaFonte {
  arquivo: string
}

/** Uma familia instalada: os arquivos de cada estilo que ela tem. */
export interface FamiliaDoPc {
  familia: string
  arquivos: Partial<Record<VarianteDaFonte, string>>
}

/** As pastas de fontes do Windows (as que existem). */
export function pastasDeFontes(env: NodeJS.ProcessEnv = process.env): string[] {
  const pastas = [join(env['WINDIR'] ?? env['SystemRoot'] ?? 'C:\\Windows', 'Fonts')]
  if (env['LOCALAPPDATA']) pastas.push(join(env['LOCALAPPDATA'], 'Microsoft', 'Windows', 'Fonts'))
  return pastas.filter((p) => existsSync(p))
}

/**
 * A familia e o estilo, lidos das tabelas `name` e `OS/2`. null = nao e uma
 * fonte que da para ler (ou nao tem nome).
 *
 * O estilo vem do `fsSelection` da OS/2 (bit 0 italico, bit 5 negrito, bit 9
 * obliquo) -- sao os bits que o Windows usa para ligar os quatro arquivos de
 * uma familia --, com o nome do estilo ("Bold Italic") de reserva para fonte
 * sem OS/2.
 */
export function lerDadosDaFonte(b: Uint8Array): DadosDaFonte | null {
  if (b.length < 12) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const tag = v.getUint32(0)
  // 0x00010000 = TrueType, 'OTTO' = OpenType com CFF, 'true' = TrueType do Mac.
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null
  const tabelas = v.getUint16(4)
  let nameAt = -1
  let os2At = -1
  let os2Tam = 0
  for (let i = 0; i < tabelas; i++) {
    const r = 12 + i * 16
    if (r + 16 > b.length) return null
    const t = v.getUint32(r)
    if (t === 0x6e616d65) nameAt = v.getUint32(r + 8)
    else if (t === 0x4f532f32) {
      os2At = v.getUint32(r + 8)
      os2Tam = v.getUint32(r + 12)
    }
  }
  if (nameAt < 0 || nameAt + 6 > b.length) return null

  const quantos = v.getUint16(nameAt + 2)
  const textos = nameAt + v.getUint16(nameAt + 4)
  const achados = new Map<number, { nota: number; texto: string; simbolo: boolean }>()
  for (let i = 0; i < quantos; i++) {
    const r = nameAt + 6 + i * 12
    if (r + 12 > b.length) break
    const plataforma = v.getUint16(r)
    const codificacao = v.getUint16(r + 2)
    const lingua = v.getUint16(r + 4)
    const id = v.getUint16(r + 6)
    if (id !== 1 && id !== 2) continue
    const tamanho = v.getUint16(r + 8)
    const de = textos + v.getUint16(r + 10)
    if (de + tamanho > b.length) continue
    let texto = ''
    let nota = 0
    // Codificacao 0 da plataforma Windows = fonte de simbolos.
    const simbolo = plataforma === 3 && codificacao === 0
    if (plataforma === 3 && (codificacao === 1 || codificacao === 0 || codificacao === 10)) {
      for (let k = 0; k + 1 < tamanho; k += 2) texto += String.fromCharCode(v.getUint16(de + k))
      // O nome em ingles e o que o Windows mostra na lista de fontes.
      nota = lingua === 0x409 ? 3 : 2
    } else if (plataforma === 1 && codificacao === 0) {
      for (let k = 0; k < tamanho; k++) texto += String.fromCharCode(b[de + k]!)
      nota = 1
    } else continue
    texto = texto.replace(/\0/g, '').trim()
    if (!texto) continue
    const antes = achados.get(id)
    if (!antes || nota > antes.nota) achados.set(id, { nota, texto, simbolo })
  }
  const familia = achados.get(1)?.texto
  if (!familia) return null
  const simbolo = achados.get(1)?.simbolo === true
  const estilo = (achados.get(2)?.texto ?? '').toLowerCase()

  let negrito = /\bbold\b/.test(estilo)
  let italico = /\b(italic|oblique)\b/.test(estilo)
  if (os2At >= 0 && os2Tam >= 64 && os2At + 64 <= b.length) {
    const sel = v.getUint16(os2At + 62)
    negrito = (sel & (1 << 5)) !== 0
    italico = (sel & 1) !== 0 || (sel & (1 << 9)) !== 0
  }
  return simbolo ? { familia, negrito, italico, simbolo } : { familia, negrito, italico }
}

export function varianteDe(d: { negrito: boolean; italico: boolean }): VarianteDaFonte {
  return d.negrito ? (d.italico ? 'bi' : 'b') : d.italico ? 'i' : 'r'
}

/**
 * Junta os arquivos por familia (sem diferenca de maiusculas). Dois arquivos
 * da mesma familia e estilo: fica o ULTIMO -- as pastas vem na ordem sistema,
 * usuario, e a fonte que ele instalou para si ganha da do sistema.
 */
export function agruparPorFamilia(arquivos: readonly ArquivoDaFonte[]): FamiliaDoPc[] {
  const porNome = new Map<string, FamiliaDoPc>()
  for (const a of arquivos) {
    const chave = a.familia.toLowerCase()
    let f = porNome.get(chave)
    if (!f) {
      f = { familia: a.familia, arquivos: {} }
      porNome.set(chave, f)
    }
    f.arquivos[varianteDe(a)] = a.arquivo
  }
  return [...porNome.values()].sort((a, b) => a.familia.localeCompare(b.familia, 'pt-BR', { sensitivity: 'base' }))
}

let guardada: { quando: number; lista: Promise<FamiliaDoPc[]> } | null = null
/** Vale por 2 minutos: ele instala uma fonte e abre a lista de novo. */
const VALIDADE_MS = 2 * 60 * 1000

/**
 * As familias instaladas. Pedidos juntos (a abertura do app e o projeto
 * abrindo) esperam a MESMA leitura.
 */
export function fontesDoPc(pastas = pastasDeFontes()): Promise<FamiliaDoPc[]> {
  if (guardada && Date.now() - guardada.quando < VALIDADE_MS) return guardada.lista
  const lista = lerPastas(pastas)
  guardada = { quando: Date.now(), lista }
  // Falhou: a proxima chamada tenta de novo, em vez de guardar o erro.
  lista.catch(() => {
    if (guardada?.lista === lista) guardada = null
  })
  return lista
}

/** Para o teste: esquece a lista guardada. */
export function esquecerFontesDoPc(): void {
  guardada = null
}

async function lerPastas(pastas: readonly string[]): Promise<FamiliaDoPc[]> {
  const caminhos: string[] = []
  for (const pasta of pastas) {
    const nomes = await readdir(pasta).catch(() => [] as string[])
    for (const n of nomes) if (EXTENSOES.has(extname(n).toLowerCase())) caminhos.push(join(pasta, n))
  }
  // Varios de uma vez (sao centenas de arquivos pequenos), mas na ORDEM das pastas.
  const lidos: (ArquivoDaFonte | null)[] = new Array(caminhos.length).fill(null)
  let proximo = 0
  const trabalhar = async (): Promise<void> => {
    while (proximo < caminhos.length) {
      const i = proximo++
      const dados = await lerArquivo(caminhos[i]!)
      // Wingdings e afins (e os icones do Windows): a legenda sairia em desenhos.
      if (dados && !dados.simbolo && !SO_ICONES.test(dados.familia)) lidos[i] = { ...dados, arquivo: caminhos[i]! }
    }
  }
  await Promise.all(Array.from({ length: 16 }, trabalhar))
  return agruparPorFamilia(lidos.filter((a): a is ArquivoDaFonte => a !== null))
}

async function lerArquivo(arquivo: string): Promise<DadosDaFonte | null> {
  try {
    const f = await open(arquivo, 'r')
    try {
      const { size } = await f.stat()
      if (size > MAIOR_FONTE) return null
      // So o comeco: o diretorio das tabelas, a `name` e a OS/2 costumam estar nos primeiros KB.
      const comeco = Buffer.alloc(Math.min(64 * 1024, size))
      const { bytesRead } = await f.read(comeco, 0, comeco.length, 0)
      const dados = lerDadosDaFonte(new Uint8Array(comeco.buffer, comeco.byteOffset, bytesRead))
      if (dados || size <= bytesRead) return dados
      // As tabelas depois dos 64 KB (fonte grande): o arquivo inteiro.
      return lerDadosDaFonte(new Uint8Array(await readFile(arquivo)))
    } finally {
      await f.close()
    }
  } catch {
    return null
  }
}
