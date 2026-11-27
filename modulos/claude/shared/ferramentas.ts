import { naFolga } from '../../../shared/camera'
import type { CameraFrame } from '../../../shared/contract'
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

/** O ritmo (o grafico da cena) em palavras -> o preset do nucleo ou a bezier desenhada. */
export const CURVAS = ['constante', 'suave', 'acelera', 'freia', 'chega-rapido'] as const
const CURVA_DO_NUCLEO: Record<(typeof CURVAS)[number], { curve: string; pontos: [number, number, number, number] | null }> = {
  constante: { curve: 'linear', pontos: null },
  suave: { curve: 'ease-in-out', pontos: null },
  acelera: { curve: 'ease-in', pontos: null },
  freia: { curve: 'ease-out', pontos: null },
  // O pan do Levi (Nia E08, 24/11): chega rapido e assenta.
  'chega-rapido': { curve: 'ease-out', pontos: [0, 0, 0.052, 0.964] },
}
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
    name: 'ver_varios',
    description:
      'IMAGEM com o quadro INTEIRO (16:9) de varios clipes lado a lado (ate 48), numerados na ordem da lista: para escolher por EXPRESSAO ou ACAO ' +
      'entre muitos candidatos (ex.: "ele odeia" = a cara mais brava entre as cenas do personagem; "empurrado" = o empurrao). ' +
      'Os caminhos vem do buscar_na_biblioteca. momento 0-1 = onde em cada clipe (0,5 = o meio).',
    inputSchema: {
      type: 'object',
      properties: {
        caminhos: { type: 'array', items: { type: 'string' }, description: 'Os mp4 dos clipes.' },
        momento: num('Onde em cada clipe, 0-1 (padrao 0,5).'),
      },
      required: ['caminhos'],
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
              camera: {
                description:
                  'CAMERA LIVRE: o caminho do enquadramento, em pontos onde o ASSUNTO esta no quadro 16:9 original ' +
                  '{pontos:[{t:0, cx:0.2}, {t:1, cx:0.7}]} (t = fracao da cena 0-1; cx/cy = centro do que mostrar, 0 = esquerda/topo, 1 = direita/base; zoom 1-3). ' +
                  'Pontos no meio (0<t<1) seguem quem anda. Fora do alcance, a janela para na borda (sem tarja preta). "desligar" volta ao focoX + efeito.',
                anyOf: [
                  { type: 'string', enum: ['desligar'] },
                  {
                    type: 'object',
                    properties: {
                      pontos: {
                        type: 'array',
                        items: { type: 'object', properties: { t: num('0-1'), cx: num('0-1'), cy: num('0-1 (padrao 0,5)'), zoom: num('1-3 (padrao 1)') }, required: ['t', 'cx'] },
                      },
                    },
                    required: ['pontos'],
                  },
                ],
              },
              curva: {
                type: 'string',
                enum: [...CURVAS],
                description: 'O RITMO do movimento (o grafico): constante, suave (acelera e freia), acelera, freia, chega-rapido (o pan do Levi: chega rapido e assenta).',
              },
              curvaPontos: { type: 'array', items: { type: 'number' }, description: 'O grafico desenhado: [x1, y1, x2, y2] do cubic-bezier, tudo 0-1.' },
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
    description: 'Procura clipes ja cortados na Biblioteca do Dangai (todos os episodios): por texto (anime, personagem, etiqueta), personagem ou episodio (ex.: "S01E07"). favoritas: true = so as cenas que o usuario marcou com a estrela (as preferidas dele: use primeiro quando servirem). Cada clipe diz se e favorita.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: str('Palavras para procurar (anime, personagem, etiqueta).'),
        personagem: str('Nome do personagem.'),
        episodio: str('Episodio, ex.: "S01E07".'),
        anime: str('Parte do nome do anime.'),
        limite: num('Maximo de resultados (padrao 40).'),
        favoritas: { type: 'boolean', description: 'So as favoritas (a estrela da Biblioteca).' },
        perto: str('Com episodio: so as cenas perto deste momento do episodio ("12:30" ou segundos), da mais perto para a mais longe.'),
        raio: num('Segundos para cada lado do "perto" (padrao 15).'),
      },
    },
  },
  {
    name: 'buscar_fala',
    description:
      'Acha um momento pelas LEGENDAS dos episodios (video de curiosidade: cada frase pode ser de um episodio). ' +
      'Le a legenda dos .mkv (portugues primeiro) ou .ass/.srt soltos. Devolve episodio (SxxEyy do nome do arquivo), em/ate (segundos) e a fala. ' +
      'Depois: buscar_na_biblioteca {anime, episodio, perto: em} para as cenas daquele trecho.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: str('Palavras da fala (todas precisam aparecer; sem acento tudo bem).'),
        arquivos: { type: 'array', items: { type: 'string' }, description: 'Episodios (.mkv) ou legendas (.ass/.srt) para procurar.' },
        pasta: str('Ou uma pasta: procura em todos os videos/legendas dela.'),
        idioma: str('Faixa de legenda preferida (ex.: "por", "eng"). Padrao: portugues, depois ingles.'),
        limite: num('Maximo de resultados (padrao 30).'),
      },
      required: ['texto'],
    },
  },
  {
    name: 'presets_de_legenda',
    description:
      'Os presets de legenda salvos no Dangai (nome e estilo) e qual deles bate com a legenda do projeto aberto. aplicar: "<nome>" poe aquele preset na legenda do projeto (sem virar o padrao dos proximos videos).',
    inputSchema: { type: 'object', properties: { aplicar: str('Nome do preset para aplicar.') } },
  },
  {
    name: 'listar_episodios',
    description: 'Os episodios do Gerar recap (rascunhos): id do episodio (ep_...), titulo, passo. Para o reconhecer_personagens.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'reconhecer_personagens',
    description:
      'O "Reconhecer na mao" do Gerar recap: o motor agrupa os rostos do episodio e voce da nome a cada grupo. ' +
      'acao "iniciar" (agrupa e devolve a FOLHA: uma linha por grupo com ate 8 rostos, + a folha do elenco com foto) -> ' +
      'voce compara e decide -> acao "confirmar" com jobId e decisao {nomes:{"<key>":"Nome"}, ignorados:[key], juntar:[[k1,k2]], removidos:{"<key>":[i]}}. ' +
      'Regras: grupo que JA TEM NOME (conhecido) define o texto do personagem -- use o mesmo nos outros grupos dele; personagem novo = nome EXATO do elenco; ' +
      'grupo misturado/figurante/duvida = sem nome. As fotos viram referencia: o proximo episodio ja vem reconhecido. ' +
      'Cenas cortadas pelo AnCut: o Dangai recusa (o reconhecimento e no AnCut). "ver" = a folha de novo; "cancelar" = nada muda.',
    inputSchema: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ['iniciar', 'ver', 'confirmar', 'cancelar'] },
        episodio: str('Id do episodio (ep_...), de listar_episodios.'),
        jobId: str('O jobId que o iniciar/ver devolveu (confirmar/cancelar).'),
        decisao: { type: 'object', description: '{nomes, ignorados, juntar, removidos} (confirmar).' },
      },
      required: ['acao'],
    },
  },
  {
    name: 'episodios_extras',
    description:
      'Gerar recap: os EPISODIOS EXTRAS do recap (de onde a aba Cenas tambem tira cenas: video de curiosidade, flashback, "no ep 1 ele foi expulso"). ' +
      'O roteiro e a voz continuam do principal. Sem definir: o principal, os extras e os episodios que da para adicionar (os que este Dangai ja abriu). ' +
      'definir: [ids ep_...] troca a lista inteira ([] tira todos; frase com cena de um extra tirado volta para o Sugerir).',
    inputSchema: {
      type: 'object',
      properties: {
        episodio: str('O episodio PRINCIPAL do recap (ep_..., de listar_episodios).'),
        definir: { type: 'array', items: { type: 'string' }, description: 'A lista nova de extras (ids ep_...).' },
      },
      required: ['episodio'],
    },
  },
  {
    name: 'cenas_do_recap',
    description:
      'Gerar recap, passo Cenas. Sem frase: as frases do roteiro (id, texto) e as cenas escolhidas de cada uma. ' +
      'Com frase: as candidatas -- sugestoes (so do principal), perto (do momento da frase ou de "perto") e outras -- do principal ou de um extra (de). ' +
      'Cada cena traz planoIds, episodio, inSec, outSec e o arquivo (mp4: mande ao ver_varios para olhar). ' +
      'Cena de outro episodio: episodios_extras (adicionar) -> cenas_do_recap com de + perto (o minuto da cena naquele episodio) ou personagem/busca.',
    inputSchema: {
      type: 'object',
      properties: {
        episodio: str('O episodio PRINCIPAL do recap (ep_...).'),
        frase: str('Id da frase (f01...). Sem: a lista das frases.'),
        de: str('Id de um episodio EXTRA (ep_...). Sem: o principal.'),
        perto: str('"12:30" ou segundos: as cenas perto deste minuto do episodio escolhido.'),
        personagem: str('So cenas com este personagem.'),
        busca: str('Texto: fala, falante, descricao.'),
        limite: num('Quantas "outras" (padrao 40).'),
      },
      required: ['episodio'],
    },
  },
  {
    name: 'escolher_cenas_do_recap',
    description:
      'Gerar recap: troca as cenas de UMA frase (entra travada, o Sugerir nao mexe). cenas na ordem: ' +
      '[{planoIds, episodio, inSec, outSec, palavra}] copiados do cenas_do_recap (cena de extra vai com o episodio dela e o id prefixado como veio); ' +
      'palavra = em que palavra da frase a cena entra (a 1a e 0; as outras sobem). O "Abrir no editor" monta cada cena do episodio dela.',
    inputSchema: {
      type: 'object',
      properties: {
        episodio: str('O episodio PRINCIPAL do recap (ep_...).'),
        frase: str('Id da frase (f01...).'),
        cenas: { type: 'array', items: { type: 'object' }, description: '[{planoIds, episodio, inSec, outSec, palavra}]' },
      },
      required: ['episodio', 'frase', 'cenas'],
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
  camera?: 'desligar' | { pontos: { t: number; cx: number; cy?: number; zoom?: number }[] }
  curva?: string
  curvaPontos?: number[]
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

/** A camera livre a partir de onde o ASSUNTO esta (cx/cy da fonte): presa na folga, sem tarja. */
export function cameraDosPontos(
  pontos: readonly { t: number; cx: number; cy?: number; zoom?: number }[],
  aspectoDaFonte: number,
  aspectoDoQuadro: number,
): { camera: { from: CameraFrame; to: CameraFrame; source: true; keys: (CameraFrame & { t: number })[] }; presos: number } {
  if (!pontos.length) throw new Error('A camera livre precisa de pelo menos 1 ponto ({t, cx}).')
  let presos = 0
  const frame = (q: { cx: number; cy?: number; zoom?: number }): CameraFrame => {
    const pedido = { scale: entre(q.zoom ?? 1, 1, 3), x: (0.5 - entre(q.cx, 0, 1)) * 100, y: (0.5 - entre(q.cy ?? 0.5, 0, 1)) * 100 }
    const f = naFolga(pedido, aspectoDaFonte, aspectoDoQuadro)
    if (Math.abs(f.x - pedido.x) > 0.5 || Math.abs(f.y - pedido.y) > 0.5) presos++
    return { scale: Math.round(f.scale * 1000) / 1000, x: Math.round(f.x * 100) / 100, y: Math.round(f.y * 100) / 100 }
  }
  const ord = [...pontos].sort((a, b) => a.t - b.t)
  const de = ord.find((q) => q.t <= 0.001) ?? ord[0]!
  const ate = [...ord].reverse().find((q) => q.t >= 0.999) ?? ord[ord.length - 1]!
  const meio = ord.filter((q) => q !== de && q !== ate && q.t > 0.001 && q.t < 0.999)
  return {
    camera: { from: frame(de), to: frame(ate), source: true, keys: meio.map((q) => ({ t: Math.round(q.t * 1000) / 1000, ...frame(q) })) },
    presos,
  }
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
    } else if (m.camera && typeof m.camera === 'object') {
      const caminho = String((p.images[s['imageIndex'] as number] ?? {})['path'] ?? '')
      const aspecto = medidas.aspecto[caminho]
      if (!(aspecto && aspecto > 0)) throw new Error(`Nao consegui medir o clipe da cena ${m.cena} para a camera livre.`)
      const quadro = p['formato'] === 'long' ? 16 / 9 : 9 / 16
      const { camera, presos } = cameraDosPontos(m.camera.pontos ?? [], aspecto, quadro)
      s['camera'] = camera
      o.push(`camera livre ${camera.keys.length + 2} pontos (x ${camera.from.x} -> ${camera.to.x})${presos ? `, ${presos} ponto(s) parado(s) na borda` : ''}`)
    }
    if (m.curva !== undefined) {
      const c = CURVA_DO_NUCLEO[m.curva as (typeof CURVAS)[number]]
      if (!c) throw new Error(`Curva "${m.curva}" nao existe: ${CURVAS.join(', ')}.`)
      s['curve'] = c.curve
      s['curvePoints'] = c.pontos
      o.push(`curva ${m.curva}`)
    }
    if (m.curvaPontos !== undefined) {
      if (m.curvaPontos.length !== 4 || m.curvaPontos.some((v) => !Number.isFinite(v))) throw new Error('curvaPontos = [x1, y1, x2, y2] (4 numeros 0-1).')
      s['curvePoints'] = m.curvaPontos.map((v) => entre(v, 0, 1))
      o.push(`grafico [${(s['curvePoints'] as number[]).join(', ')}]`)
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
      const cam = s['camera'] as { from?: CameraFrame; to?: CameraFrame; keys?: (CameraFrame & { t: number })[] } | null | undefined
      // A camera na MESMA lingua do editar: onde o assunto fica no quadro 16:9 (cx/cy 0-1).
      const ponto = (t: number, f: CameraFrame | undefined) => ({ t, cx: r(0.5 - (f?.x ?? 0) / 100, 3), cy: r(0.5 - (f?.y ?? 0) / 100, 3), zoom: r(f?.scale ?? 1, 2) })
      const curva = Object.entries(CURVA_DO_NUCLEO).find(([, c]) => c.curve === s['curve'] && JSON.stringify(c.pontos) === JSON.stringify(s['curvePoints'] ?? null))?.[0]
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
        ...(cam
          ? { camera: { pontos: [ponto(0, cam.from), ...(cam.keys ?? []).map((k) => ponto(k.t, k)), ponto(1, cam.to)] } }
          : {}),
        curva: curva ?? (Array.isArray(s['curvePoints']) ? `grafico [${(s['curvePoints'] as number[]).join(', ')}]` : (s['curve'] ?? 'ease-in-out')),
        ...(b ? { grid: { clipe: b['path'], entrada: r(s['sourceStartB'] ?? 0), focoX: r(b['focusX']) } } : {}),
        ...(typeof s['escala'] === 'number' && s['escala'] > 1 ? { zoomFixo: s['escala'], origemDoZoom: s['escalaOrigem'] } : {}),
      }
    })
    .filter((c) => c.cena >= de && c.cena <= ate)
}
