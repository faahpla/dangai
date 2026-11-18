import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import type { ContextoDoModulo, ModuloDoMain } from '../../../electron/modulos'
import { saveProjectFile } from '../../../electron/services/project'
import { projectFileSchema, type ProjectFile } from '../../../shared/project-file'
import { CANAIS_DO_CLAUDE as C, type AcaoDaJanela, type EstadoDoServidor, type RespostaDoClaude } from '../shared/canais'
import { aplicarLote, resumoDasCenas, type ArquivoDoProjeto, type LoteDeMudancas, type Medidas } from '../shared/ferramentas'
import { aspectoDe, folha, janelaDaCena, sondar, type Ladrilho } from './imagens'
import { subirServidor, type Conteudo, type ServidorLigado } from './servidor'

/**
 * [claude] O MODULO "CLAUDE (MCP)" no main (pedido do Levi, 17/11: "tem como
 * vc criar algo, um mcp, pra vc editar mais rapido?"). Ligado nas
 * Configuracoes, sobe um servidor MCP em 127.0.0.1 que o Claude Code (ou
 * qualquer cliente MCP) conecta com um comando so. O Claude le as cenas, ve o
 * recorte 9:16 em imagem e manda um lote de mudancas -- sem fechar o app, sem
 * clicar por coordenada.
 *
 * O projeto mora na janela: cada ferramenta que precisa dele vira um pedido
 * (`claude:pedido`) que o renderer do modulo responde. Editar = o projeto
 * como o Ctrl+S gravaria + o lote, validado pelo esquema do Dangai, gravado no
 * .dangai e reaberto (a reabertura refaz o recorte das cenas com o foco novo).
 */

const configSchema = z.object({ porta: z.number().int().min(1024).max(65535).default(47321) })
type ConfigDoClaude = z.infer<typeof configSchema>

let ctxGuardado: ContextoDoModulo | null = null
let servidor: ServidorLigado | null = null
let erroAoSubir: string | null = null
const pendentes = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
/** O projeto antes de cada "editar", por caminho: o "desfazer". */
const historico = new Map<string, unknown[]>()

function senha(ctx: ContextoDoModulo): string {
  let s = ctx.chave('senha')
  if (!s) {
    s = randomBytes(18).toString('base64url')
    ctx.salvarChave('senha', s)
  }
  return s
}

function estado(ctx: ContextoDoModulo): EstadoDoServidor {
  const s = ctx.ligado() ? senha(ctx) : ''
  const url = servidor ? `http://127.0.0.1:${servidor.porta}/mcp` : null
  return {
    ligado: ctx.ligado(),
    rodando: servidor !== null,
    url,
    senha: s,
    comando: url ? `claude mcp add --transport http dangai ${url} --header "Authorization: Bearer ${s}"` : null,
    erro: erroAoSubir,
  }
}

function pedirAJanela<T>(acao: AcaoDaJanela, args: Record<string, unknown> = {}, ms = 120_000): Promise<T> {
  const ctx = ctxGuardado
  if (!ctx) return Promise.reject(new Error('Modulo sem contexto.'))
  const id = randomUUID()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendentes.delete(id)
      reject(new Error('O Dangai nao respondeu (a janela esta aberta?).'))
    }, ms)
    pendentes.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
    ctx.enviar(C.pedido, { id, acao, args })
  })
}

interface ProjetoDaJanela {
  caminho: string | null
  arquivo: ArquivoDoProjeto | null
}

async function projetoAberto(): Promise<{ caminho: string; arquivo: ArquivoDoProjeto }> {
  const p = await pedirAJanela<ProjetoDaJanela>('projeto')
  if (!p.arquivo || !p.arquivo.plan) throw new Error('Nenhum projeto aberto no Dangai (abra um com "abrir_projeto").')
  if (!p.caminho) throw new Error('O projeto aberto ainda nao tem arquivo .dangai (salve com Ctrl+S antes).')
  return { caminho: p.caminho, arquivo: p.arquivo }
}

const texto = (t: string): Conteudo => ({ type: 'text', text: t })
const json = (v: unknown): Conteudo => texto(JSON.stringify(v, null, 1))

async function gravarEReabrir(caminho: string, arquivo: unknown): Promise<void> {
  const v = projectFileSchema.safeParse(arquivo)
  if (!v.success) {
    const i = v.error.issues.slice(0, 5).map((x) => `${x.path.join('.')}: ${x.message}`)
    throw new Error(`O projeto ficaria invalido, nada foi gravado:\n${i.join('\n')}`)
  }
  // O objeto (nao o parse): campos que o esquema nao conhece voltam como vieram.
  saveProjectFile(caminho, arquivo as ProjectFile)
  await pedirAJanela('abrir', { caminho })
}

async function medir(lote: LoteDeMudancas): Promise<Medidas> {
  const m: Medidas = { duracao: {}, aspecto: {} }
  const confere = (c: string): void => {
    if (!existsSync(c)) throw new Error(`Arquivo nao existe: ${c}`)
  }
  for (const s of lote.sons?.adicionar ?? []) {
    confere(s.arquivo)
    const d = (await sondar(s.arquivo)).duracao
    if (d) m.duracao[s.arquivo] = d
  }
  for (const i of lote.imagens?.adicionar ?? []) {
    confere(i.arquivo)
    const a = await aspectoDe(i.arquivo)
    if (a) m.aspecto[i.arquivo] = a
    if (/\.(mp4|mov|webm|mkv|m4v)$/i.test(i.arquivo)) {
      const d = (await sondar(i.arquivo)).duracao
      if (d) m.duracao[i.arquivo] = d
    }
  }
  for (const c of lote.cenas ?? []) {
    if (c.clipe) confere(c.clipe)
    if (c.grid && typeof c.grid === 'object') confere(c.grid.clipe)
  }
  return m
}

async function verCenas(arquivo: ArquivoDoProjeto, quais: number[]): Promise<Conteudo[]> {
  const cenas = arquivo.plan.scenes
  const numeros = (quais.length ? quais : cenas.map((_, k) => k + 1)).filter((n) => n >= 1 && n <= cenas.length)
  if (!numeros.length) throw new Error(`Nenhuma dessas cenas existe (o projeto tem ${cenas.length}).`)
  const ladrilhos: Ladrilho[] = numeros.map((n) => {
    const s = cenas[n - 1]!
    const img = arquivo.images[s['imageIndex'] as number] ?? {}
    const caminho = String(img['path'] ?? '')
    const foco = typeof img['focusX'] === 'number' ? img['focusX'] : 0.5
    const d = (s['end'] as number) - (s['start'] as number)
    const ss = typeof s['sourceStart'] === 'number' ? s['sourceStart'] : 0
    const a = janelaDaCena(s, foco, 0)
    const b = janelaDaCena(s, foco, 1)
    const grid = s['imageIndexB'] !== null && s['imageIndexB'] !== undefined ? ' grid' : ''
    return {
      quadros: [
        { caminho, t: ss + 0.04, ...a },
        { caminho, t: ss + Math.max(0.05, d - 0.06), ...b },
      ],
      rotulo: `#${n} ${(s['start'] as number).toFixed(1)}s${grid}`,
    }
  })
  const saida: Conteudo[] = [texto(`Cenas ${numeros.join(', ')}: 1o e ultimo quadro de cada uma, no recorte 9:16 do video.`)]
  for (let g = 0; g < ladrilhos.length; g += 30) {
    saida.push({ type: 'image', mimeType: 'image/jpeg', data: await folha(ladrilhos.slice(g, g + 30), Math.min(10, ladrilhos.length - g)) })
  }
  return saida
}

async function verClipe(caminho: string, focoX: number): Promise<Conteudo[]> {
  if (!existsSync(caminho)) throw new Error(`Arquivo nao existe: ${caminho}`)
  const dur = (await sondar(caminho)).duracao ?? 0
  if (!(dur > 0)) throw new Error('Nao consegui ler a duracao do clipe.')
  const n = 8
  const ts = Array.from({ length: n }, (_, k) => Math.min(dur - 0.05, 0.04 + (k * (dur - 0.1)) / (n - 1)))
  const cx = 0.158 + Math.min(1, Math.max(0, focoX)) * 0.684
  const ladrilhos: Ladrilho[] = ts.map((t) => ({ quadros: [{ caminho, t, cx, zoom: 1 }], rotulo: `${t.toFixed(2)}s` }))
  return [
    texto(`Clipe de ${dur.toFixed(2)} s, 8 quadros no recorte 9:16 com focoX ${focoX}.`),
    { type: 'image', mimeType: 'image/jpeg', data: await folha(ladrilhos, 8) },
  ]
}

async function chamar(nome: string, args: Record<string, unknown>): Promise<Conteudo[]> {
  switch (nome) {
    case 'estado':
      return [json(await pedirAJanela('estado'))]
    case 'listar_cenas': {
      const { arquivo } = await projetoAberto()
      const de = typeof args['de'] === 'number' ? args['de'] : 1
      const ate = typeof args['ate'] === 'number' ? args['ate'] : Number.POSITIVE_INFINITY
      return [json(resumoDasCenas(arquivo, de, ate))]
    }
    case 'listar_faixas': {
      const { arquivo } = await projetoAberto()
      const r = (v: unknown): unknown => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)
      return [
        json({
          sons: (arquivo.trilhas ?? []).map((t) => ({
            id: t['id'],
            arquivo: t['path'],
            faixa: `A${(t['faixa'] as number) + 1}`,
            em: r(t['at']),
            duracao: r(t['usarSec'] ?? (t['durationSec'] as number) - ((t['inicioSec'] as number) ?? 0)),
            ganhoDb: t['gainDb'],
            ducking: Boolean(t['ducking']),
          })),
          imagens: (arquivo.sobreposicoes ?? []).map((o) => ({
            id: o['id'],
            arquivo: o['path'],
            tipo: o['tipo'],
            em: r(o['at']),
            duracao: r(o['usarSec'] ?? o['durationSec']),
            x: o['x'],
            y: o['y'],
            escala: o['escala'],
            rotacao: o['rotacao'],
          })),
        }),
      ]
    }
    case 'ver_cenas': {
      const { arquivo } = await projetoAberto()
      const quais = Array.isArray(args['cenas']) ? (args['cenas'] as unknown[]).map(Number).filter(Number.isFinite) : []
      return verCenas(arquivo, quais)
    }
    case 'ver_clipe':
      return verClipe(String(args['caminho'] ?? ''), typeof args['focoX'] === 'number' ? args['focoX'] : 0.5)
    case 'editar': {
      const lote = args as LoteDeMudancas
      const { caminho, arquivo } = await projetoAberto()
      const { arquivo: novo, feito } = aplicarLote(arquivo, lote, await medir(lote))
      if (!feito.length) return [texto('Nada para mudar.')]
      await gravarEReabrir(caminho, novo)
      const h = historico.get(caminho) ?? []
      h.push(arquivo)
      if (h.length > 30) h.shift()
      historico.set(caminho, h)
      return [texto(`Feito e reaberto:\n- ${feito.join('\n- ')}`)]
    }
    case 'desfazer': {
      const { caminho } = await projetoAberto()
      const h = historico.get(caminho)
      const antes = h?.pop()
      if (!antes) throw new Error('Nada para desfazer (o desfazer guarda os "editar" desde que o Dangai abriu).')
      await gravarEReabrir(caminho, antes)
      return [texto(`Desfeito. Restam ${h!.length} passos.`)]
    }
    case 'buscar_na_biblioteca':
      return [json(await pedirAJanela('biblioteca', args, 180_000))]
    case 'presets_de_legenda':
      return [json(await pedirAJanela('legenda', args))]
    case 'abrir_projeto': {
      const caminho = String(args['caminho'] ?? '')
      if (!/\.dangai$/i.test(caminho) || !existsSync(caminho)) throw new Error(`Nao achei o projeto: ${caminho}`)
      await pedirAJanela('abrir', { caminho })
      return [json(await pedirAJanela('estado'))]
    }
    default:
      throw new Error(`Ferramenta desconhecida: ${nome}`)
  }
}

async function ligar(ctx: ContextoDoModulo): Promise<void> {
  if (servidor) return
  erroAoSubir = null
  const cfg = ctx.config().modulo as ConfigDoClaude
  try {
    senha(ctx)
    servidor = await subirServidor(cfg.porta, () => ctx.chave('senha'), ctx.versaoDoApp, chamar)
  } catch (e) {
    erroAoSubir = e instanceof Error ? e.message : String(e)
  }
  ctx.enviar(C.estado, estado(ctx))
}

async function desligar(ctx: ContextoDoModulo): Promise<void> {
  const s = servidor
  servidor = null
  for (const [id, p] of pendentes) {
    clearTimeout(p.timer)
    p.reject(new Error('O modulo Claude foi desligado.'))
    pendentes.delete(id)
  }
  if (s) await s.fechar()
  ctx.enviar(C.estado, estado(ctx))
}

export const claude: ModuloDoMain = {
  id: 'claude',
  nome: 'Claude (MCP)',
  descricao: 'Deixa o Claude Code editar o projeto aberto: ler as cenas, ver o recorte 9:16 e mudar enquadramento, entrada, efeito, sons e setas.',
  beta: true,
  ligadoPorPadrao: false,
  camposDeChave: ['senha'],
  config: {
    padrao: configSchema.parse({}),
    coerce: (raw) => configSchema.parse(raw ?? {}),
    paraRenderer: (c) => c,
    validarPatch: (patch, atual) => configSchema.parse({ ...(atual as ConfigDoClaude), ...((patch ?? {}) as object) }),
  },

  configurar(ctx) {
    ctxGuardado = ctx
  },

  registrarIpc(ctx) {
    ctx.handle<[RespostaDoClaude], null>(C.resposta, async (r) => {
      const p = pendentes.get(r.id)
      if (p) {
        clearTimeout(p.timer)
        pendentes.delete(r.id)
        if (r.ok) p.resolve(r.resultado)
        else p.reject(new Error(r.erro ?? 'erro na janela'))
      }
      return null
    })
    ctx.handle<[], EstadoDoServidor>(C.estado, async () => estado(ctx))
    ctx.handle<[], EstadoDoServidor>(C.novaSenha, async () => {
      ctx.salvarChave('senha', randomBytes(18).toString('base64url'))
      return estado(ctx)
    })
  },

  ligar,
  desligar,

  async antesDeSair() {
    if (servidor) await servidor.fechar()
    servidor = null
  },
}
