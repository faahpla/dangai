import { existsSync } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import type { FonteDoPc } from '../shared/canais'

/**
 * [thumb] AS FONTES DO PC (04/11, pedido do Levi): o "Buscar fonte do PC" do
 * texto. O canvas so desenha com fonte carregada pela pagina (FontFace), entao
 * o main lista os arquivos das pastas de fontes do Windows (a do sistema e a
 * do usuario, onde o "Instalar para mim" poe) com o nome de dentro do arquivo
 * (a tabela `name`), e entrega os bytes de UMA so se ela estiver na lista --
 * a tela nunca le um caminho qualquer do disco.
 *
 * So .ttf e .otf: a coleção .ttc o FontFace nao abre de forma confiavel.
 * Puro Node (sem electron): o teste roda isto direto.
 */

const EXTENSOES = new Set(['.ttf', '.otf'])

/** As pastas de fontes do Windows (as que existem). */
export function pastasDeFontes(env: NodeJS.ProcessEnv = process.env): string[] {
  const pastas = [join(env['WINDIR'] ?? env['SystemRoot'] ?? 'C:\\Windows', 'Fonts')]
  if (env['LOCALAPPDATA']) pastas.push(join(env['LOCALAPPDATA'], 'Microsoft', 'Windows', 'Fonts'))
  return pastas.filter((p) => existsSync(p))
}

/**
 * O nome da fonte pela tabela `name` (o "nome completo", id 4, em ingles do
 * Windows; senao familia + estilo, ids 1 e 2). null = nao e uma fonte que da
 * para ler.
 */
export function nomeDaFonte(b: Uint8Array): string | null {
  if (b.length < 12) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const tag = v.getUint32(0)
  // 0x00010000 = TrueType, 'OTTO' = OpenType com CFF, 'true' = TrueType do Mac.
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null
  const tabelas = v.getUint16(4)
  let nameAt = -1
  for (let i = 0; i < tabelas; i++) {
    const r = 12 + i * 16
    if (r + 16 > b.length) return null
    if (v.getUint32(r) === 0x6e616d65) nameAt = v.getUint32(r + 8)
  }
  if (nameAt < 0 || nameAt + 6 > b.length) return null
  const quantos = v.getUint16(nameAt + 2)
  const textos = nameAt + v.getUint16(nameAt + 4)
  const achados = new Map<number, { nota: number; texto: string }>()
  for (let i = 0; i < quantos; i++) {
    const r = nameAt + 6 + i * 12
    if (r + 12 > b.length) break
    const plataforma = v.getUint16(r)
    const codificacao = v.getUint16(r + 2)
    const lingua = v.getUint16(r + 4)
    const id = v.getUint16(r + 6)
    if (id !== 1 && id !== 2 && id !== 4) continue
    const tamanho = v.getUint16(r + 8)
    const de = textos + v.getUint16(r + 10)
    if (de + tamanho > b.length) continue
    let texto = ''
    let nota = 0
    if (plataforma === 3 && (codificacao === 1 || codificacao === 0)) {
      for (let k = 0; k + 1 < tamanho; k += 2) texto += String.fromCharCode(v.getUint16(de + k))
      nota = lingua === 0x409 ? 3 : 2
    } else if (plataforma === 1 && codificacao === 0) {
      for (let k = 0; k < tamanho; k++) texto += String.fromCharCode(b[de + k]!)
      nota = 1
    } else continue
    texto = texto.replace(/\0/g, '').trim()
    if (!texto) continue
    const antes = achados.get(id)
    if (!antes || nota > antes.nota) achados.set(id, { nota, texto })
  }
  const completo = achados.get(4)?.texto
  if (completo) return completo
  const familia = achados.get(1)?.texto
  if (!familia) return null
  const estilo = achados.get(2)?.texto
  return estilo && !/^(regular|normal)$/i.test(estilo) ? `${familia} ${estilo}` : familia
}

let cache: { quando: number; lista: FonteDoPc[] } | null = null
/** A lista vale por 2 minutos (ele instala uma fonte e abre a busca de novo). */
const VALIDADE_MS = 2 * 60 * 1000

/** As fontes do PC, por nome (sem repetir: a do usuario ganha da do sistema com o mesmo nome). */
export async function fontesDoPc(pastas = pastasDeFontes()): Promise<FonteDoPc[]> {
  if (cache && Date.now() - cache.quando < VALIDADE_MS) return cache.lista
  const porNome = new Map<string, FonteDoPc>()
  for (const pasta of pastas) {
    const nomes = await readdir(pasta).catch(() => [] as string[])
    for (const n of nomes) {
      if (!EXTENSOES.has(extname(n).toLowerCase())) continue
      const arquivo = join(pasta, n)
      // So o comeco do arquivo: o diretorio das tabelas e a `name` costumam estar nos primeiros KB.
      const nome = await lerNome(arquivo)
      if (nome) porNome.set(nome.toLowerCase(), { nome, arquivo })
    }
  }
  const lista = [...porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  cache = { quando: Date.now(), lista }
  return lista
}

async function lerNome(arquivo: string): Promise<string | null> {
  try {
    const f = await open(arquivo, 'r')
    try {
      const comeco = Buffer.alloc(64 * 1024)
      const { bytesRead } = await f.read(comeco, 0, comeco.length, 0)
      const nome = nomeDaFonte(new Uint8Array(comeco.buffer, comeco.byteOffset, bytesRead))
      if (nome) return nome
      // A `name` depois dos 64 KB (fonte grande): o arquivo inteiro, ate 30 MB.
      const { size } = await f.stat()
      if (size <= bytesRead || size > 30 * 1024 * 1024) return null
      return nomeDaFonte(new Uint8Array(await readFile(arquivo)))
    } finally {
      await f.close()
    }
  } catch {
    return null
  }
}

/** Os bytes de uma fonte DA LISTA (outro caminho = recusa). */
export async function bytesDaFonteDoPc(arquivo: string, pastas = pastasDeFontes()): Promise<Uint8Array> {
  const alvo = resolve(arquivo).toLowerCase()
  const lista = await fontesDoPc(pastas)
  const achada = lista.find((f) => resolve(f.arquivo).toLowerCase() === alvo)
  if (!achada) throw new Error('Essa fonte nao esta nas fontes do PC.')
  const { size } = await stat(achada.arquivo)
  if (size > 30 * 1024 * 1024) throw new Error('A fonte e grande demais.')
  return new Uint8Array(await readFile(achada.arquivo))
}

/** Para o teste: esquece a lista guardada. */
export function esquecerFontesDoPc(): void {
  cache = null
}
