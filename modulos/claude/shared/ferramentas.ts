/**
 * [claude] AS FERRAMENTAS DO MCP DO DANGAI (17/11) e o que aplica um lote de mudancas.
 *
 * O Levi: "tem como vc criar algo, um mcp, pra vc editar mais rapido?". Antes, o
 * Claude fechava o Dangai, mexia no .dangai, reabria e clicava por coordenada (um
 * clique errado apagou um bloco). Agora o Claude pede, o modulo aplica no projeto
 * aberto, valida com o mesmo esquema do Dangai, grava e o Dangai reabre sozinho.
 *
 * Tudo aqui e puro (sem fs, sem Electron): o main mede o que precisa medir (a
 * duracao de um som, o tamanho de uma imagem) e passa pronto.
 */

export const EFEITOS = ['nenhum', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'] as const
export type Efeito = (typeof EFEITOS)[number]

export interface DefinicaoDeFerramenta {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const num = (description: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'number', description, ...extra })
const str = (description: string): Record<string, unknown> => ({ type: 'string', description })

export const FERRAMENTAS: DefinicaoDeFerramenta[] = [
  {
    name: 'estado',
    description: 'O que esta aberto no Dangai agora: o projeto (caminho), a duracao, quantas cenas, sons e imagens por cima.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'listar_cenas',
    description:
      'As cenas (blocos) do projeto aberto, numeradas de 1: tempo na timeline, clipe, ponto de entrada no clipe (s), enquadramento horizontal (focoX 0-1), efeito, camera livre, grid e zoom fixo.',
    inputSchema: {
      type: 'object',
      properties: { de: num('Primeira cena (1 = a primeira). Padrao: 1.'), ate: num('Ultima cena. Padrao: a ultima.') },
    },
  },
  {
    name: 'ver_cenas',
    description:
      'IMAGEM das cenas como o Dangai mostra no video vertical 9:16 (o recorte pelo focoX ou pela camera, com o zoom do efeito): o 1o e o ultimo quadro de cada cena. Use para conferir enquadramento, rosto cortado, borrao no comeco.',
    inputSchema: {
      type: 'object',
      properties: {
        cenas: { type: 'array', items: { type: 'number' }, description: 'Numeros das cenas (1 = a primeira). Vazio = todas.' },
      },
    },
  },
  {
    name: 'ver_clipe',
    description:
      'IMAGEM de um clipe inteiro (8 quadros ao longo dele) no recorte 9:16 de um focoX: para escolher o melhor momento (entrada) e o enquadramento antes de editar.',
    inputSchema: {
      type: 'object',
      properties: { caminho: str('Caminho do mp4 do clipe.'), focoX: num('Enquadramento horizontal 0-1 (0,5 = centro).') },
      required: ['caminho'],
    },
  },
  {
    name: 'editar',
    description:
      'Aplica um LOTE de mudancas no projeto aberto, valida, grava e reabre o projeto no Dangai (o recorte das cenas e refeito). Junte tudo num pedido so. Desfaz com "desfazer".',
    inputSchema: {
      type: 'object',
      properties: {
        cenas: {
          type: 'array',
          description: 'Mudancas por cena.',
          items: {
            type: 'object',
            properties: {
              cena: num('Numero da cena (1 = a primeira).'),
              clipe: str('Trocar o clipe: caminho do mp4.'),
              entrada: num('Ponto de entrada no clipe, em segundos.'),
              focoX: num('Enquadramento horizontal 0-1 (0 = esquerda, 1 = direita).'),
              efeito: { type: 'string', enum: [...EFEITOS], description: 'Movimento da cena.' },
              intensidade: num('Intensidade do movimento (0,02-0,2; padrao 0,1).'),
              zoomFixo: num('Zoom fixo do bloco (1 = sem; 1,3 = 30% mais perto).'),
              origemDoZoom: { type: 'object', properties: { x: num('0-1'), y: num('0-1') }, description: 'De onde o zoom fixo parte (0,0 = canto de cima a esquerda).' },
              camera: { type: 'string', enum: ['desligar'], description: '"desligar" tira a camera livre (volta ao focoX + efeito).' },
              grid: {
                description: 'Tela dividida: a metade de baixo ({clipe, entrada, focoX}) ou "desligar".',
                anyOf: [
                  { type: 'string', enum: ['desligar'] },
                  { type: 'object', properties: { clipe: str('mp4 da metade de baixo'), entrada: num('s'), focoX: num('0-1') }, required: ['clipe'] },
                ],
              },
            },
            required: ['cena'],
          },
        },
        sons: {
          type: 'object',
          properties: {
            adicionar: {
              type: 'array',
              items: {
                type: 'object',
                properties: { arquivo: str('Caminho do som.'), em: num('Instante no video (s).'), ganhoDb: num('Volume em dB (0 = original).'), faixa: num('Faixa de audio (0 = A1). Padrao: a primeira livre a partir da A2.') },
                required: ['arquivo', 'em'],
              },
            },
            remover: { type: 'array', items: { type: 'string' }, description: 'ids dos sons (listar_faixas).' },
          },
        },
        imagens: {
          type: 'object',
          description: 'Imagens/videos por cima do video (ex.: uma seta).',
          properties: {
            adicionar: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  arquivo: str('Caminho do PNG/mp4/mov.'),
                  em: num('Instante (s).'),
                  duracao: num('Quanto tempo fica (s).'),
                  x: num('Deslocamento horizontal em % do quadro (0 = centro).'),
                  y: num('Deslocamento vertical em % do quadro (0 = centro).'),
                  escala: num('Tamanho (1 = o arquivo inteiro cabendo no quadro).'),
                  rotacao: num('Giro em graus (-180 a 180).'),
                },
                required: ['arquivo', 'em', 'duracao'],
              },
            },
            remover: { type: 'array', items: { type: 'string' }, description: 'ids das imagens (listar_faixas).' },
          },
        },
        legenda: { type: 'object', description: 'Campos de estilo da legenda (captionFont, captionColor, captionScale, captionY...) copiados para o projeto.' },
        textos: {
          type: 'object',
          description: 'Titulo, descricao e hashtags da postagem (os da barra de render). Escreva voce mesmo, sem gastar a IA do Dangai.',
          properties: {
            titulos: { type: 'array', items: { type: 'string' }, description: 'Opcoes de titulo (a 1a e a principal).' },
            descricao: str('Descricao do video.'),
            hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtags, com ou sem #.' },
          },
        },
      },
    },
  },
  {
    name: 'listar_faixas',
    description: 'Os sons (musica, efeitos) e as imagens por cima do projeto aberto: id, arquivo, instante, duracao, volume, faixa.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'desfazer',
    description: 'Volta o projeto para antes do ultimo "editar" (e reabre).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'buscar_na_biblioteca',
    description: 'Procura clipes ja cortados na Biblioteca do Dangai (todos os episodios): por texto (anime, personagem, etiqueta), personagem ou episodio (ex.: "S01E07").',
    inputSchema: {
      type: 'object',
      properties: {
        texto: str('Palavras para procurar (anime, personagem, etiqueta).'),
        personagem: str('Nome do personagem.'),
        episodio: str('Episodio, ex.: "S01E07".'),
        anime: str('Parte do nome do anime.'),
        limite: num('Maximo de resultados (padrao 40).'),
      },
    },
  },
  {
    name: 'abrir_projeto',
    description: 'Abre um projeto .dangai no Dangai.',
    inputSchema: { type: 'object', properties: { caminho: str('Caminho do .dangai.') }, required: ['caminho'] },
  },
]

// ------------------------------------------------------------- o lote

export interface MudancaDeCena {
  cena: number
  clipe?: string
  entrada?: number
  focoX?: number
  efeito?: string
  intensidade?: number
  zoomFixo?: number
  origemDoZoom?: { x: number; y: number }
  camera?: 'desligar'
  grid?: 'desligar' | { clipe: string; entrada?: number; focoX?: number }
}

export interface LoteDeMudancas {
  cenas?: MudancaDeCena[]
  sons?: { adicionar?: { arquivo: string; em: number; ganhoDb?: number; faixa?: number }[]; remover?: string[] }
  imagens?: {
    adicionar?: { arquivo: string; em: number; duracao: number; x?: number; y?: number; escala?: number; rotacao?: number }[]
    remover?: string[]
  }
  legenda?: Record<string, unknown>
  textos?: { titulos?: string[]; descricao?: string; hashtags?: string[] }
}

/** O que o main mediu para o lote: a duracao de cada som e o aspecto de cada imagem, pelo caminho. */
export interface Medidas {
  duracao: Record<string, number>
  aspecto: Record<string, number>
}

/** O projeto como o .dangai guarda (so os campos que o lote toca; o resto passa intacto). */
export interface ArquivoDoProjeto {
  images: Record<string, unknown>[]
  plan: { scenes: Record<string, unknown>[] } & Record<string, unknown>
  trilhas?: Record<string, unknown>[]
  sobreposicoes?: Record<string, unknown>[]
  [campo: string]: unknown
}

const nomeDo = (caminho: string): string => caminho.split(/[\\/]/).pop() ?? caminho
const entre = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))
const EXT_DE_VIDEO = /\.(mp4|mov|webm|mkv|m4v)$/i
const CAMPOS_DA_LEGENDA = /^caption[A-Z]/

let contador = 0
const novoId = (tipo: string): string => `claude-${tipo}-${Date.now().toString(36)}-${(contador++).toString(36)}`

/**
 * Aplica o lote num COPIA do projeto e devolve a copia + o que mudou (para o
 * Claude conferir). Erro claro (cena que nao existe, efeito errado) derruba o
 * lote inteiro: nada pela metade.
 */
export function aplicarLote(original: ArquivoDoProjeto, lote: LoteDeMudancas, medidas: Medidas): { arquivo: ArquivoDoProjeto; feito: string[] } {
  const p = JSON.parse(JSON.stringify(original)) as ArquivoDoProjeto
  const cenas = p.plan.scenes
  const feito: string[] = []

  // Cada cena com a SUA imagem: mudar o foco de uma nao muda a de outra que dividia a entrada.
  const propria = (indice: number | null | undefined): number | null => {
    if (indice === null || indice === undefined) return null
    const copia = { ...(p.images[indice] as Record<string, unknown>) }
    p.images.push(copia)
    return p.images.length - 1
  }
  const imagemNova = (base: Record<string, unknown>, caminho: string, focoX: number): Record<string, unknown> => ({
    ...base,
    path: caminho,
    fileName: nomeDo(caminho),
    rel: null,
    focusX: entre(focoX, 0, 1),
    focusY: 0.5,
    focusAuto: false,
    invertido: false,
  })

  for (const m of lote.cenas ?? []) {
    const k = Math.round(m.cena) - 1
    const s = cenas[k]
    if (!s) throw new Error(`A cena ${m.cena} nao existe (o projeto tem ${cenas.length}).`)
    const o: string[] = []
    if (m.clipe) {
      const base = p.images[s['imageIndex'] as number] ?? {}
      p.images.push(imagemNova(base, m.clipe, m.focoX ?? 0.5))
      s['imageIndex'] = p.images.length - 1
      s['sourceStart'] = Math.max(0, m.entrada ?? 0)
      o.push(`clipe ${nomeDo(m.clipe)}`)
    } else if (m.focoX !== undefined) {
      const i = propria(s['imageIndex'] as number)!
      p.images[i] = { ...p.images[i], focusX: entre(m.focoX, 0, 1), focusAuto: false }
      s['imageIndex'] = i
    }
    if (m.focoX !== undefined) o.push(`focoX ${m.focoX}`)
    if (m.entrada !== undefined && !m.clipe) {
      s['sourceStart'] = Math.max(0, m.entrada)
      o.push(`entrada ${m.entrada}s`)
    }
    if (m.efeito !== undefined) {
      if (!(EFEITOS as readonly string[]).includes(m.efeito)) throw new Error(`Efeito "${m.efeito}" nao existe: ${EFEITOS.join(', ')}.`)
      s['effect'] = m.efeito
      o.push(`efeito ${m.efeito}`)
    }
    if (m.intensidade !== undefined) {
      s['intensity'] = entre(m.intensidade, 0.02, 0.2)
      o.push(`intensidade ${s['intensity']}`)
    }
    if (m.zoomFixo !== undefined) {
      if (m.zoomFixo <= 1.0001) {
        delete s['escala']
        delete s['escalaOrigem']
        o.push('sem zoom fixo')
      } else {
        s['escala'] = entre(m.zoomFixo, 1, 4)
        s['escalaOrigem'] = m.origemDoZoom ? { x: entre(m.origemDoZoom.x, 0, 1), y: entre(m.origemDoZoom.y, 0, 1) } : { x: 0.5, y: 0.5 }
        o.push(`zoom fixo ${s['escala']}`)
      }
    }
    if (m.camera === 'desligar') {
      s['camera'] = null
      o.push('camera desligada')
    }
    if (m.grid === 'desligar') {
      s['imageIndexB'] = null
      s['sourceStartB'] = 0
      o.push('sem grid')
    } else if (m.grid && typeof m.grid === 'object') {
      const base = p.images[s['imageIndex'] as number] ?? {}
      p.images.push(imagemNova(base, m.grid.clipe, m.grid.focoX ?? 0.5))
      s['imageIndexB'] = p.images.length - 1
      s['sourceStartB'] = Math.max(0, m.grid.entrada ?? 0)
      if (s['effectB'] === undefined) s['effectB'] = null
      o.push(`grid com ${nomeDo(m.grid.clipe)}`)
    }
    feito.push(`cena ${m.cena}: ${o.join(', ') || 'nada'}`)
  }

  // Sons.
  const trilhas = (p.trilhas ??= [])
  for (const id of lote.sons?.remover ?? []) {
    const i = trilhas.findIndex((t) => t['id'] === id)
    if (i < 0) throw new Error(`Nao achei o som "${id}".`)
    feito.push(`som removido: ${String(trilhas[i]!['fileName'])}`)
    trilhas.splice(i, 1)
  }
  for (const a of lote.sons?.adicionar ?? []) {
    const dur = medidas.duracao[a.arquivo]
    if (!(dur && dur > 0)) throw new Error(`Nao consegui medir o som: ${a.arquivo}`)
    const em = Math.max(0, a.em)
    const ocupa = (f: number): boolean =>
      trilhas.some((t) => t['faixa'] === f && (t['at'] as number) < em + dur && (t['at'] as number) + (((t['usarSec'] as number | null) ?? (t['durationSec'] as number)) || 0) > em)
    let faixa = a.faixa ?? 1
    if (a.faixa === undefined) while (ocupa(faixa) && faixa < 30) faixa++
    trilhas.push({
      id: novoId('som'),
      path: a.arquivo,
      fileName: nomeDo(a.arquivo),
      faixa,
      at: em,
      durationSec: dur,
      inicioSec: 0,
      usarSec: null,
      gainDb: entre(a.ganhoDb ?? 0, -40, 12),
      fadeInSec: 0,
      fadeOutSec: 0,
      peaks: [],
      rms: [],
    })
    feito.push(`som ${nomeDo(a.arquivo)} em ${em.toFixed(2)}s (faixa A${faixa + 1})`)
  }

  // Imagens por cima.
  const sobre = (p.sobreposicoes ??= [])
  for (const id of lote.imagens?.remover ?? []) {
    const i = sobre.findIndex((t) => t['id'] === id)
    if (i < 0) throw new Error(`Nao achei a imagem "${id}".`)
    feito.push(`imagem removida: ${String(sobre[i]!['fileName'])}`)
    sobre.splice(i, 1)
  }
  for (const a of lote.imagens?.adicionar ?? []) {
    const video = EXT_DE_VIDEO.test(a.arquivo)
    const aspecto = medidas.aspecto[a.arquivo]
    if (!(aspecto && aspecto > 0)) throw new Error(`Nao consegui medir a imagem: ${a.arquivo}`)
    const durArquivo = video ? (medidas.duracao[a.arquivo] ?? a.duracao) : 3600
    const em = Math.max(0, a.em)
    const fim = em + Math.max(0.05, a.duracao)
    const ocupa = (f: number): boolean =>
      sobre.some((t) => t['faixa'] === f && (t['at'] as number) < fim && (t['at'] as number) + (((t['usarSec'] as number | null) ?? (t['durationSec'] as number)) || 0) > em)
    let faixa = 0
    while (ocupa(faixa) && faixa < 30) faixa++
    sobre.push({
      id: novoId('imagem'),
      path: a.arquivo,
      fileName: nomeDo(a.arquivo),
      tipo: video ? 'video' : 'image',
      faixa,
      at: em,
      durationSec: durArquivo,
      inicioSec: 0,
      usarSec: Math.max(0.05, a.duracao),
      x: a.x ?? 0,
      y: a.y ?? 0,
      escala: a.escala ?? 1,
      opacidade: 1,
      aspecto,
      rotacao: entre(a.rotacao ?? 0, -180, 180),
      efeito: 'nenhum',
      intensidade: 0.1,
      curva: 'ease-in-out',
      pontosDaCurva: null,
      espelhar: false,
      fadeInSec: 0,
      fadeOutSec: 0,
    })
    feito.push(`imagem ${nomeDo(a.arquivo)} em ${a.em.toFixed(2)}s por ${a.duracao}s`)
  }

  // Legenda: so os campos de estilo.
  for (const [k, v] of Object.entries(lote.legenda ?? {})) {
    if (!CAMPOS_DA_LEGENDA.test(k) || k === 'captions' || k === 'captionsEdited') throw new Error(`"${k}" nao e um campo de estilo da legenda.`)
    p[k] = v
    feito.push(`legenda ${k}`)
  }

  // Titulo, descricao e hashtags.
  if (lote.textos) {
    const atual = (p['metadata'] as { titles: string[]; description: string; hashtags: string[] } | null | undefined) ?? { titles: [], description: '', hashtags: [] }
    const t = lote.textos
    p['metadata'] = {
      titles: t.titulos ? t.titulos.map(String).filter(Boolean) : atual.titles,
      description: t.descricao !== undefined ? String(t.descricao) : atual.description,
      hashtags: t.hashtags ? t.hashtags.map((h) => `#${String(h).replace(/^#+/, '').trim()}`).filter((h) => h.length > 1) : atual.hashtags,
    }
    feito.push('titulo/descricao/hashtags')
  }

  // As imagens que ESTE lote deixou sem uso saem e os indices sao refeitos (a faixa
  // "Cenas N" conta as imagens). As que ja estavam sem uso antes ficam: podem ser
  // material que ele importou e ainda nao pos.
  const usadasAntes = indicesUsados(original.plan.scenes)
  const usadasAgora = indicesUsados(cenas)
  const fica = p.images.map((_, i) => usadasAgora.has(i) || (i < original.images.length && !usadasAntes.has(i)))
  const novo = new Map<number, number>()
  const imagens: Record<string, unknown>[] = []
  p.images.forEach((img, i) => {
    if (!fica[i]) return
    novo.set(i, imagens.length)
    imagens.push(img)
  })
  for (const s of cenas) {
    s['imageIndex'] = novo.get(s['imageIndex'] as number)
    if (typeof s['imageIndexB'] === 'number') s['imageIndexB'] = novo.get(s['imageIndexB'])
  }
  p.images = imagens
  return { arquivo: p, feito }
}

function indicesUsados(cenas: Record<string, unknown>[]): Set<number> {
  const s = new Set<number>()
  for (const c of cenas) {
    if (typeof c['imageIndex'] === 'number') s.add(c['imageIndex'])
    if (typeof c['imageIndexB'] === 'number') s.add(c['imageIndexB'])
  }
  return s
}

/** Uma cena do projeto como o Claude le (listar_cenas). */
export function resumoDasCenas(p: ArquivoDoProjeto, de = 1, ate = Number.POSITIVE_INFINITY): Record<string, unknown>[] {
  return p.plan.scenes
    .map((s, k) => {
      const img = p.images[s['imageIndex'] as number] ?? {}
      const b = s['imageIndexB'] === null || s['imageIndexB'] === undefined ? null : p.images[s['imageIndexB'] as number]
      const cam = s['camera'] as { from?: { x: number; scale: number }; to?: { x: number; scale: number } } | null | undefined
      const r = (v: unknown, c = 2): number | null => (typeof v === 'number' ? Math.round(v * 10 ** c) / 10 ** c : null)
      return {
        cena: k + 1,
        inicio: r(s['start']),
        fim: r(s['end']),
        duracao: r((s['end'] as number) - (s['start'] as number)),
        clipe: img['path'],
        entrada: r(s['sourceStart'] ?? 0),
        focoX: r(img['focusX']),
        focoAutomatico: img['focusAuto'] === true,
        efeito: s['effect'],
        intensidade: s['intensity'],
        ...(cam ? { camera: { de: { x: r(cam.from?.x, 1), zoom: cam.from?.scale }, ate: { x: r(cam.to?.x, 1), zoom: cam.to?.scale } } } : {}),
        ...(b ? { grid: { clipe: b['path'], entrada: r(s['sourceStartB'] ?? 0), focoX: r(b['focusX']) } } : {}),
        ...(typeof s['escala'] === 'number' && s['escala'] > 1 ? { zoomFixo: s['escala'], origemDoZoom: s['escalaOrigem'] } : {}),
      }
    })
    .filter((c) => c.cena >= de && c.cena <= ate)
}
