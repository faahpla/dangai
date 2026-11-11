import { readFileSync, renameSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  casamentoDosQuadrosSchema,
  frasesDoTexto,
  leituraDasPaginasSchema,
  resumoNoProjetoSchema,
  roteiroDoMangaSchema,
  TAMANHOS_DO_RESUMO,
  type CapituloDoManga,
  type FraseDoResumo,
  type LeituraDasPaginas,
  type PedidoDoResumo,
  type QuadroDoResumo,
  type ResumoDoManga,
  type ResumoNoProjeto,
  type RoteiroDeMangaGuardado,
  type SerieDoManga,
} from '@shared/resumo-de-manga'
import { gerarJson } from './llm'
import { capitulosDaPasta, paginasDoCapitulo, recortesDoCapitulo } from './manga'
import { acharQuadros } from './quadros'
import { getSettings } from './settings'

/**
 * O RESUMO DE MANGA do lado do main (ver shared/resumo-de-manga.ts): le os
 * capitulos com a IA e escreve o roteiro.
 *
 * Dois pedidos, e nao um: a LEITURA (as paginas com os quadrinhos numerados ->
 * o que acontece em cada um) fica guardada por capitulo, e ESCREVER de novo
 * (outro tamanho, outro foco) e so texto -- rapido e barato.
 */

/** Sobe quando o que sai da leitura muda: le de novo. */
const VERSAO_DA_LEITURA = 1
/** Paginas por pedido de leitura. 24 de uma vez passou de 5 min no Gemini (11/2026). */
const PAGINAS_POR_LOTE = 8
/** Lotes lidos ao mesmo tempo. */
const LOTES_JUNTOS = 4
/** A pagina vai para a IA com o lado maior neste tamanho. */
const LADO_DA_PAGINA = 1400

let pasta: string | null = null

export function configureResumoDeManga(userDataDir: string): void {
  pasta = join(userDataDir, 'resumo-de-manga')
}

export function seriesDosMangas(): SerieDoManga[] {
  return capitulosDaPasta().map((s) => ({
    serie: s.serie,
    capitulos: s.capitulos.map((c) => ({ ...c, serie: s.serie })),
  }))
}

function capituloDe(dir: string): CapituloDoManga {
  for (const s of seriesDosMangas()) {
    const c = s.capitulos.find((x) => x.dir.toLowerCase() === dir.toLowerCase())
    if (c) return c
  }
  throw new Error(`O capítulo não está mais na pasta dos mangás: ${dir}`)
}

// ----------------------------------------------------------------- os quadros

/** Os quadrinhos de cada capitulo, na ordem de leitura, ainda sem o que a IA viu. */
async function quadrosDosCapitulos(
  capitulos: readonly CapituloDoManga[],
  publicar: (caminho: string) => string,
  andamento: (mensagem: string) => void,
): Promise<QuadroDoResumo[]> {
  const quadros: QuadroDoResumo[] = []
  for (const [i, cap] of capitulos.entries()) {
    const c = i + 1
    const itens = await recortesDoCapitulo(cap.dir, (feitas, total) =>
      andamento(`Recortando os quadrinhos de ${cap.serie} · ${cap.capitulo} (${feitas}/${total})...`),
    )
    for (const item of itens) {
      quadros.push({
        ref: item.quadro === null ? `c${c}p${item.pagina}` : `c${c}p${item.pagina}q${item.quadro}`,
        capitulo: c,
        pagina: item.pagina,
        quadro: item.quadro,
        caminho: item.path,
        miniatura: publicar(item.thumb),
        arquivoDaMiniatura: item.thumb,
        oque: '',
        falas: '',
        forte: false,
      })
    }
  }
  return quadros
}

// ------------------------------------------------------------------- a leitura

/**
 * A pagina com os quadrinhos NUMERADOS por cima, como a IA vai ve-la.
 *
 * Os numeros sao os mesmos dos recortes: o mesmo `acharQuadros` sobre os
 * mesmos pixels, na mesma ordem de leitura.
 */
async function paginaNumerada(arquivo: string): Promise<string> {
  const { data, info } = await sharp(arquivo).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const lida = acharQuadros(data, info.width, info.height, info.channels)
  const W = info.width
  const H = info.height
  const raio = Math.max(14, Math.round(Math.max(W, H) * 0.022))
  const traco = Math.max(3, Math.round(raio / 5))
  const partes = lida.quadros.map((q, k) => {
    const cx = q.x + raio + traco
    const cy = q.y + raio + traco
    return (
      `<rect x="${q.x + traco / 2}" y="${q.y + traco / 2}" width="${q.largura - traco}" height="${q.altura - traco}" fill="none" stroke="#ff1744" stroke-width="${traco}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${raio}" fill="#ff1744" stroke="#fff" stroke-width="${Math.max(2, traco / 2)}"/>` +
      `<text x="${cx}" y="${cy}" font-family="Arial, sans-serif" font-weight="bold" font-size="${Math.round(raio * 1.25)}" fill="#fff" text-anchor="middle" dominant-baseline="central">${k + 1}</text>`
    )
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${partes.join('')}</svg>`
  const escala = Math.min(1, LADO_DA_PAGINA / Math.max(W, H))
  const montada = await sharp(data, { raw: { width: W, height: H, channels: info.channels } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()
  const saida = await sharp(montada)
    .resize({ width: Math.round(W * escala), height: Math.round(H * escala) })
    .jpeg({ quality: 82 })
    .toBuffer()
  return saida.toString('base64')
}

interface LeituraGuardada {
  versao: number
  assinatura: string
  paginas: LeituraDasPaginas['paginas']
}

function assinatura(arquivos: readonly string[]): string {
  const partes = arquivos.map((a) => {
    try {
      const s = statSync(a)
      return `${a}:${s.size}:${Math.round(s.mtimeMs)}`
    } catch {
      return a
    }
  })
  return createHash('sha1').update(partes.join('|')).digest('hex')
}

function arquivoDaLeitura(dir: string): string {
  return join(pasta!, 'leituras', `${createHash('sha1').update(dir.toLowerCase()).digest('hex').slice(0, 16)}.json`)
}

function leituraGuardada(dir: string, sig: string): LeituraGuardada | null {
  try {
    const cru = JSON.parse(readFileSync(arquivoDaLeitura(dir), 'utf8')) as LeituraGuardada
    if (cru.versao === VERSAO_DA_LEITURA && cru.assinatura === sig && Array.isArray(cru.paginas)) return cru
  } catch {
    /* nunca lido */
  }
  return null
}

function guardarLeitura(dir: string, leitura: LeituraGuardada): void {
  try {
    const arquivo = arquivoDaLeitura(dir)
    mkdirSync(join(pasta!, 'leituras'), { recursive: true })
    writeFileSync(`${arquivo}.tmp`, JSON.stringify(leitura))
    renameSync(`${arquivo}.tmp`, arquivo)
  } catch (err) {
    console.warn('[resumo-de-manga] leitura nao guardada:', err)
  }
}

const SISTEMA_DA_LEITURA = `Você lê páginas de mangá para um roteirista de vídeos de resumo.
Cada página vem com os quadrinhos marcados: um contorno vermelho e um NÚMERO num círculo vermelho no canto. Os números já seguem a ordem de leitura do mangá (de cima para baixo, da direita para a esquerda).

Para cada página, e para CADA quadrinho numerado dela, devolva:
- n: o número desenhado no quadrinho.
- oque: o que acontece no quadrinho, numa frase curta e concreta, em português do Brasil. Use o NOME dos personagens sempre que souber quem são (você conhece a obra; use também os nomes que aparecem nas falas). Diga a ação e a emoção ("Asta corta o feitiço da Vanica com a espada, furioso").
- falas: o que dizem os balões e textos importantes do quadrinho, resumido em português (vazio se não houver fala).
- forte: true só para quadrinho de impacto — close de rosto com emoção forte, golpe, transformação, revelação, aparição, página dupla. Quadrinho de transição, fundo ou conversa comum é false.

Página SEM números (uma página de um quadro só, capa ou página dupla): devolva um único item com n = 0 descrevendo a página inteira.
Não pule nenhum número. Não invente o que não está na imagem.`

/** Le um capitulo (do cache, ou com a IA, em lotes). */
async function lerCapitulo(
  cap: CapituloDoManga,
  andamento: (mensagem: string) => void,
): Promise<LeituraDasPaginas['paginas']> {
  const arquivos = paginasDoCapitulo(cap.dir)
  const sig = assinatura(arquivos)
  const guardada = leituraGuardada(cap.dir, sig)
  if (guardada) return guardada.paginas

  const lotes: { de: number; ate: number }[] = []
  for (let de = 0; de < arquivos.length; de += PAGINAS_POR_LOTE) {
    lotes.push({ de, ate: Math.min(arquivos.length, de + PAGINAS_POR_LOTE) })
  }
  let prontos = 0
  const resultado: LeituraDasPaginas['paginas'][] = new Array(lotes.length)
  const lerLote = async (k: number): Promise<void> => {
    const { de, ate } = lotes[k]!
    const inicio = Date.now()
    const imagens = []
    for (let i = de; i < ate; i++) imagens.push({ mime: 'image/jpeg' as const, base64: await paginaNumerada(arquivos[i]!) })
    const r = await gerarJson({
      etapa: 'manga-leitura',
      schema: leituraDasPaginasSchema,
      sistema: SISTEMA_DA_LEITURA,
      prompt:
        `Mangá: ${cap.serie} — ${cap.capitulo}.\n` +
        `Estas são as páginas ${de + 1} a ${ate} (de ${arquivos.length}), na ordem: a 1ª imagem é a página ${de + 1}, a 2ª é a ${de + 2}, e assim por diante.\n` +
        `Devolva "pagina" com esse número (${de + 1} a ${ate}).`,
      imagens,
      maxTokens: 16000,
      tempoLimiteMs: 240_000,
      permitirReserva: false,
    })
    if (!r.ok) throw new Error(r.nota)
    console.log(`[resumo-de-manga] paginas ${de + 1}-${ate} lidas em ${((Date.now() - inicio) / 1000).toFixed(0)} s (${r.modelo})`)
    resultado[k] = r.valor.paginas
    prontos += 1
    andamento(`Lendo ${cap.serie} · ${cap.capitulo} com a IA (${prontos}/${lotes.length})...`)
  }
  andamento(`Lendo ${cap.serie} · ${cap.capitulo} com a IA (0/${lotes.length})...`)
  for (let k = 0; k < lotes.length; k += LOTES_JUNTOS) {
    await Promise.all(lotes.slice(k, k + LOTES_JUNTOS).map((_, d) => lerLote(k + d)))
  }
  const paginas = resultado.flat()
  guardarLeitura(cap.dir, { versao: VERSAO_DA_LEITURA, assinatura: sig, paginas })
  return paginas
}

/** O que a IA viu vai para os quadros (pelo numero da pagina e do quadrinho). */
function anotar(quadros: QuadroDoResumo[], capitulo: number, paginas: LeituraDasPaginas['paginas']): void {
  for (const p of paginas) {
    for (const q of p.quadros) {
      const alvo =
        quadros.find((x) => x.capitulo === capitulo && x.pagina === p.pagina && (q.n === 0 ? x.quadro === null : x.quadro === q.n)) ??
        // O quadrinho que a IA viu e o recorte nao achou: fica na pagina.
        (q.n !== 0 ? quadros.find((x) => x.capitulo === capitulo && x.pagina === p.pagina && x.quadro === null) : undefined)
      if (!alvo) continue
      alvo.oque = alvo.oque ? `${alvo.oque} / ${q.oque}` : q.oque
      alvo.falas = alvo.falas ? `${alvo.falas} / ${q.falas}` : q.falas
      alvo.forte = alvo.forte || q.forte
    }
  }
}

// ------------------------------------------------- o jeito dele de escrever

const EXEMPLOS_GUARDADOS = 5

interface Exemplo {
  titulo: string
  texto: string
}

function arquivoDosExemplos(): string {
  return join(pasta!, 'exemplos.json')
}

function exemplosDeResumo(): Exemplo[] {
  try {
    const cru = JSON.parse(readFileSync(arquivoDosExemplos(), 'utf8')) as unknown
    return Array.isArray(cru)
      ? cru.filter((e): e is Exemplo => typeof e?.titulo === 'string' && typeof e?.texto === 'string')
      : []
  } catch {
    return []
  }
}

/**
 * O roteiro de resumo que ele GRAVOU (o da IA, ja com as correcoes dele) vira
 * exemplo: os proximos resumos saem mais parecidos com o que ele aprova.
 */
export function aprenderResumo(exemplo: Exemplo): void {
  if (!pasta || exemplo.texto.trim().split(/\s+/).length < 40) return
  const outros = exemplosDeResumo().filter((e) => e.texto.trim() !== exemplo.texto.trim())
  try {
    mkdirSync(pasta, { recursive: true })
    const arquivo = arquivoDosExemplos()
    writeFileSync(`${arquivo}.tmp`, JSON.stringify([exemplo, ...outros].slice(0, EXEMPLOS_GUARDADOS)))
    renameSync(`${arquivo}.tmp`, arquivo)
  } catch (err) {
    console.warn('[resumo-de-manga] exemplo nao guardado:', err)
  }
}

/**
 * Os exemplos para a IA imitar: primeiro os resumos de manga que ele gravou
 * (o formato certo), depois os roteiros de curiosidade dos projetos recentes
 * (o tom dele).
 */
function roteirosDele(max = 4): { titulo: string; texto: string }[] {
  const saida: { titulo: string; texto: string }[] = exemplosDeResumo().slice(0, 2)
  for (const r of getSettings().recentes) {
    if (saida.length >= max) break
    const caminho = typeof r['path'] === 'string' ? r['path'] : null
    if (!caminho) continue
    try {
      const projeto = JSON.parse(readFileSync(caminho, 'utf8')) as { script?: unknown }
      const texto = typeof projeto.script === 'string' ? projeto.script.trim() : ''
      if (texto.split(/\s+/).length < 80) continue
      if (saida.some((e) => e.texto.trim() === texto)) continue
      const titulo = typeof r['nome'] === 'string' ? r['nome'] : ''
      saida.push({ titulo, texto })
    } catch {
      /* projeto que sumiu */
    }
  }
  return saida
}

// -------------------------------------------------------------- o roteiro

const SISTEMA_DO_ROTEIRO = `Você escreve o roteiro de Shorts (vídeo vertical curto) de RESUMO DE MANGÁ para um canal brasileiro, narrado pelo dono do canal.
Escreva no jeito dele: os exemplos de roteiros dele vêm no pedido — imite o ritmo, o vocabulário, o tom de conversa, as comparações do dia a dia e o fechamento com uma frase de efeito. Português do Brasil falado.

Regras do texto:
- Cada item de "frases" é UMA frase, que termina em ponto final, interrogação ou exclamação. Frases curtas e diretas, fáceis de narrar.
- A primeira frase é o gancho: o momento mais chocante ou curioso do que vai ser resumido, de um jeito que prenda quem está rolando o feed. Afirme, como nos exemplos dele; não comece com "Você sabia".
- Depois, conte o que acontece NA ORDEM do mangá, com o nome dos personagens. É um resumo: escolha o que importa, não descreva quadro por quadro.
- Feche com uma frase que deixe a pessoa querendo o próximo capítulo ou pensando no que aconteceu.
- Nada de "neste vídeo", "se inscreva", "deixe seu like", emojis ou hashtags.

Regras dos quadrinhos ("quadros" de cada frase):
- Os quadrinhos que MOSTRAM o que a frase está dizendo, pelos códigos da lista (ex.: "c1p12q3"). Só códigos da lista.
- Quantos: um a cada 5 a 7 palavras da frase (uma frase de 14 palavras leva 2 ou 3), no mínimo 1. O vídeo troca de imagem rápido.
- Na ordem do mangá. As frases seguem a ordem das páginas, então os quadrinhos de uma frase vêm depois dos da frase anterior (o gancho pode pegar um quadrinho de qualquer parte).
- Prefira os marcados FORTE. Não repita um quadrinho em duas frases.

"titulo": o título do vídeo, no estilo dos títulos dele (curto, provocativo, com uma palavra em MAIÚSCULAS quando couber, e o nome do mangá).`

function listaDosQuadros(quadros: readonly QuadroDoResumo[], capitulos: readonly CapituloDoManga[]): string {
  const linhas: string[] = []
  let capAtual = 0
  let pagAtual = 0
  for (const q of quadros) {
    if (!q.oque) continue
    if (q.capitulo !== capAtual) {
      capAtual = q.capitulo
      pagAtual = 0
      const c = capitulos[q.capitulo - 1]!
      linhas.push(`\n## Capítulo ${q.capitulo}: ${c.serie} — ${c.capitulo}`)
    }
    if (q.pagina !== pagAtual) {
      pagAtual = q.pagina
      linhas.push(`Página ${q.pagina}:`)
    }
    linhas.push(`${q.ref}${q.forte ? ' [FORTE]' : ''}: ${q.oque}${q.falas ? ` | falas: ${q.falas}` : ''}`)
  }
  return linhas.join('\n')
}

async function escrever(
  pedido: PedidoDoResumo,
  capitulos: readonly CapituloDoManga[],
  quadros: readonly QuadroDoResumo[],
): Promise<{ titulo: string; frases: FraseDoResumo[] }> {
  const exemplos = roteirosDele()
  const palavras = TAMANHOS_DO_RESUMO[pedido.tamanho].palavras
  const series = [...new Set(capitulos.map((c) => c.serie))].join(', ')
  const prompt = [
    exemplos.length
      ? `# Roteiros do canal (o jeito dele de escrever — resumos de mangá que ele já gravou e curiosidades de anime; o tom é o mesmo)\n\n${exemplos
          .map((e) => `Título: ${e.titulo}\n${e.texto}`)
          .join('\n\n---\n\n')}`
      : '',
    `# O que resumir\nMangá: ${series}. ${capitulos.length === 1 ? 'Capítulo' : 'Capítulos'}: ${capitulos.map((c) => c.capitulo).join(', ')}.`,
    `Tamanho: umas ${palavras} palavras no total (somando as frases).`,
    pedido.pedido.trim() ? `Pedido dele para este vídeo: ${pedido.pedido.trim()}` : '',
    `# Os quadrinhos, na ordem do mangá (código: o que acontece | falas)\n${listaDosQuadros(quadros, capitulos)}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const r = await gerarJson({
    etapa: 'manga-roteiro',
    schema: roteiroDoMangaSchema,
    sistema: SISTEMA_DO_ROTEIRO,
    prompt,
    maxTokens: 8000,
    tempoLimiteMs: 240_000,
    permitirReserva: false,
  })
  if (!r.ok) throw new Error(r.nota)

  // So codigos que existem, e cada quadrinho uma vez.
  const existe = new Set(quadros.map((q) => q.ref))
  const usados = new Set<string>()
  const frases = r.valor.frases
    .map((f) => ({
      texto: f.texto.trim().replace(/\s+/g, ' '),
      quadros: f.quadros
        .map((x) => x.trim().toLowerCase())
        .filter((x) => existe.has(x) && !usados.has(x) && (usados.add(x), true)),
    }))
    .filter((f) => f.texto)
  return { titulo: r.valor.titulo.trim(), frases }
}

/**
 * Do capitulo ao roteiro: recorta (se ainda nao), le (se ainda nao) e escreve.
 */
export async function escreverResumoDoManga(
  pedido: PedidoDoResumo,
  publicar: (caminho: string) => string,
  andamento: (mensagem: string) => void,
): Promise<ResumoDoManga> {
  if (!pasta) throw new Error('O resumo de mangá não foi configurado.')
  if (pedido.dirs.length === 0) throw new Error('Escolha pelo menos um capítulo.')
  const capitulos = pedido.dirs.map(capituloDe)
  const quadros = await quadrosDosCapitulos(capitulos, publicar, andamento)
  for (const [i, cap] of capitulos.entries()) {
    anotar(quadros, i + 1, await lerCapitulo(cap, andamento))
  }
  andamento('Escrevendo o roteiro...')
  const { titulo, frases } = await escrever(pedido, capitulos, quadros)
  return { capitulos, quadros, titulo, frases }
}

// ------------------------------------------- o roteiro pronto no caminho de sempre

/** Quantos roteiros escritos ficam guardados para ser reconhecidos. */
const ROTEIROS_GUARDADOS = 30

function arquivoDosRoteiros(): string {
  return join(pasta!, 'roteiros.json')
}

/** Os roteiros que o Resumo de mangá escreveu, o mais recente primeiro. */
export function roteirosDeManga(): RoteiroDeMangaGuardado[] {
  if (!pasta) return []
  try {
    const cru = JSON.parse(readFileSync(arquivoDosRoteiros(), 'utf8')) as unknown
    if (!Array.isArray(cru)) return []
    return cru.flatMap((r) => {
      const ok = resumoNoProjetoSchema.safeParse(r)
      if (!ok.success || typeof r?.id !== 'string') return []
      return [{ ...ok.data, id: r.id as string, em: typeof r?.em === 'number' ? (r.em as number) : 0 }]
    })
  } catch {
    return []
  }
}

/** Guarda (ou atualiza, pelo id) um roteiro escrito pelo Resumo de mangá. */
export function guardarRoteiroDeManga(roteiro: RoteiroDeMangaGuardado): void {
  if (!pasta || roteiro.frases.length === 0) return
  const lista = [roteiro, ...roteirosDeManga().filter((r) => r.id !== roteiro.id)].slice(0, ROTEIROS_GUARDADOS)
  try {
    mkdirSync(pasta, { recursive: true })
    const arquivo = arquivoDosRoteiros()
    writeFileSync(`${arquivo}.tmp`, JSON.stringify(lista))
    renameSync(`${arquivo}.tmp`, arquivo)
  } catch (err) {
    console.warn('[resumo-de-manga] roteiro nao guardado:', err)
  }
}

const SISTEMA_DO_CASAMENTO = `Você monta Shorts de RESUMO DE MANGÁ. O roteiro já está escrito e narrado; falta escolher as imagens.
Para cada frase do roteiro (numeradas), escolha os quadrinhos que MOSTRAM o que ela diz, pelos códigos da lista (ex.: "c1p12q3"). Só códigos da lista.
- Quantos: um a cada 5 a 7 palavras da frase, no mínimo 1. O vídeo troca de imagem rápido.
- O personagem certo, a ação certa, a fala certa: é isso que faz a imagem bater com a narração.
- Na ordem do mangá dentro de cada frase. O roteiro costuma seguir a ordem das páginas, mas o gancho (a primeira frase) pode pegar um quadrinho de qualquer parte.
- Prefira os marcados FORTE. Não repita um quadrinho em duas frases.
- Frase que não fala de nada mostrado (uma opinião, uma pergunta para quem assiste): escolha um quadrinho que combine com o clima dela, perto do anterior.
Responda todas as frases, pelo número.`

/**
 * CASAR UM ROTEIRO PRONTO com os quadrinhos dos capitulos: o roteiro foi escrito
 * fora do Dangai (ou de cabeca), e ele diz de quais capitulos e. Le os capitulos
 * (a leitura fica guardada e serve ao Resumo tambem) e pede a IA os quadrinhos
 * de cada frase -- so texto, como o "escrever".
 */
export async function casarRoteiroComOsQuadrinhos(
  dirs: readonly string[],
  texto: string,
  publicar: (caminho: string) => string,
  andamento: (mensagem: string) => void,
): Promise<ResumoNoProjeto> {
  if (!pasta) throw new Error('O resumo de mangá não foi configurado.')
  if (dirs.length === 0) throw new Error('Escolha pelo menos um capítulo.')
  const frases = frasesDoTexto(texto)
  if (frases.length === 0) throw new Error('O roteiro está vazio.')
  const capitulos = dirs.map(capituloDe)
  const quadros = await quadrosDosCapitulos(capitulos, publicar, andamento)
  for (const [i, cap] of capitulos.entries()) {
    anotar(quadros, i + 1, await lerCapitulo(cap, andamento))
  }
  andamento('Escolhendo os quadrinhos de cada frase...')
  const series = [...new Set(capitulos.map((c) => c.serie))].join(', ')
  const r = await gerarJson({
    etapa: 'manga-casar',
    schema: casamentoDosQuadrosSchema,
    sistema: SISTEMA_DO_CASAMENTO,
    prompt: [
      `# Mangá: ${series}. ${capitulos.length === 1 ? 'Capítulo' : 'Capítulos'}: ${capitulos.map((c) => c.capitulo).join(', ')}.`,
      `# O roteiro, uma frase por linha\n${frases.map((f, i) => `${i + 1}. ${f}`).join('\n')}`,
      `# Os quadrinhos, na ordem do mangá (código: o que acontece | falas)\n${listaDosQuadros(quadros, capitulos)}`,
    ].join('\n\n'),
    maxTokens: 6000,
    // A lista inteira dos quadrinhos e grande: no Gemini lento (11/2026) passou de 4 min.
    tempoLimiteMs: 420_000,
    permitirReserva: false,
  })
  if (!r.ok) throw new Error(r.nota)
  const porRef = new Map(quadros.map((q) => [q.ref, q.caminho]))
  const usados = new Set<string>()
  const porFrase = new Map(r.valor.frases.map((f) => [f.n, f.quadros]))
  return {
    titulo: '',
    capitulos: capitulos.map((c) => c.dir),
    frases: frases.map((f, i) => ({
      texto: f,
      quadros: (porFrase.get(i + 1) ?? [])
        .map((x) => x.trim().toLowerCase())
        .filter((x) => porRef.has(x) && !usados.has(x) && (usados.add(x), true))
        .map((x) => porRef.get(x)!),
    })),
  }
}
