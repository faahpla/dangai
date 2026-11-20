import type { Nucleo } from '@/modulos/nucleo'
import type { CaptionStyle } from '@shared/contract'
import type { PedidoDoClaude } from '../shared/canais'

/**
 * [claude] O QUE A JANELA FAZ a pedido do servidor MCP: le o projeto aberto,
 * abre um projeto e procura na Biblioteca. Tudo pela fachada do nucleo.
 */

const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** O auto save grava ~1,2 s depois da ultima mudanca: espera ele, para nao gravar por cima do "editar". */
async function semMudancaPendente(n: Nucleo): Promise<void> {
  for (let k = 0; k < 25 && n.ler().projectDirty; k++) await espera(200)
}

const normal = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/**
 * A legenda do projeto aberto no formato de um preset (o estiloAtual do nucleo).
 * Os campos caption* estao no store mas fora do EstadoPublico: leitura so.
 */
function estiloDoProjeto(n: Nucleo): Record<string, unknown> {
  const s = n.ler() as unknown as Record<string, unknown>
  const fonte = s['captionFont'] as { nome?: string } | null | undefined
  return {
    color: s['captionColor'],
    y: s['captionY'],
    scale: s['captionScale'],
    fontNome: fonte?.nome ?? '',
    animation: s['captionAnimation'],
    animationFrames: s['captionAnimationFrames'],
    mark: s['captionMark'],
    pontuacao: s['captionPontuacao'],
    shadow: s['captionShadow'],
    stroke: s['captionStroke'],
    animationCurve: s['captionAnimationCurve'],
  }
}

/**
 * Os campos em que o preset difere da legenda do projeto (sem as regras de corte).
 * fontNome difere tambem quando a fonte do preset nao esta na pasta de fontes deste PC.
 */
function diferencas(preset: CaptionStyle, atual: Record<string, unknown>): string[] {
  const p = preset as unknown as Record<string, unknown>
  return Object.keys(atual).filter((k) => p[k] !== undefined && JSON.stringify(p[k]) !== JSON.stringify(atual[k]))
}

/** "12:30", "1:02:03", "750" ou 750 em segundos. null = nao veio. */
function segundosDe(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string' || !v.trim()) return null
  const partes = v.trim().split(':').map(Number)
  if (partes.some((x) => !Number.isFinite(x))) throw new Error(`Tempo invalido: "${v}" (use "12:30" ou segundos).`)
  return partes.reduce((s, x) => s * 60 + x, 0)
}

export async function executar(n: Nucleo, p: PedidoDoClaude): Promise<unknown> {
  switch (p.acao) {
    case 'estado': {
      const e = n.ler()
      const cenas = e.plan?.scenes ?? []
      return {
        projeto: e.projectPath,
        duracao: cenas.length ? Math.round(cenas[cenas.length - 1]!.end * 100) / 100 : 0,
        cenas: cenas.length,
        sons: e.trilhas.length,
        imagensPorCima: e.sobreposicoes.length,
        naoSalvo: e.projectDirty,
        ocupado: e.busy,
        versaoDoApp: e.appVersion,
        biblioteca: e.library ? { clipes: e.library.clips.length, animes: e.library.animes } : null,
      }
    }
    case 'projeto': {
      await semMudancaPendente(n)
      return { caminho: n.ler().projectPath, arquivo: n.paraArquivo() }
    }
    case 'abrir': {
      const caminho = String(p.args['caminho'] ?? '')
      await n.abrirProjeto(caminho)
      const e = n.ler()
      const igual = (x: string | null): string => (x ?? '').replace(/\\/g, '/').toLowerCase()
      if (igual(e.projectPath) !== igual(caminho)) throw new Error(e.error ?? `O Dangai nao abriu ${caminho} (a janela estava ocupada? tente de novo).`)
      return { aberto: e.projectPath }
    }
    case 'legenda': {
      const presets = n.ler().captionPresets
      const nome = typeof p.args['aplicar'] === 'string' ? p.args['aplicar'].trim() : ''
      if (nome) {
        const achado = presets.find((x) => x.nome === nome) ?? presets.find((x) => normal(x.nome) === normal(nome))
        if (!achado) throw new Error(`Nao ha preset "${nome}". Os salvos: ${presets.map((x) => x.nome).join(', ') || 'nenhum'}.`)
        n.aplicarEstiloDeLegenda(achado.estilo)
      }
      const atual = estiloDoProjeto(n)
      return {
        aplicado: nome || null,
        presets: presets.map((x) => {
          const dif = diferencas(x.estilo, atual)
          return { nome: x.nome, estilo: x.estilo, igualAoProjeto: dif.length === 0, diferencas: dif }
        }),
        legendaDoProjeto: atual,
      }
    }
    case 'biblioteca': {
      if (!n.ler().library) await n.sincronizarBiblioteca()
      const lib = n.ler().library
      if (!lib) throw new Error('A Biblioteca nao carregou (configure a pasta nas Configuracoes do Dangai).')
      const favoritas = new Set(await n.lerFavoritas())
      const soFavoritas = p.args['favoritas'] === true
      const termos = normal(String(p.args['texto'] ?? ''))
        .split(/\s+/)
        .filter(Boolean)
      const personagem = normal(String(p.args['personagem'] ?? ''))
      const anime = normal(String(p.args['anime'] ?? ''))
      const ep = /s(\d+)\s*e(\d+)/i.exec(String(p.args['episodio'] ?? ''))
      const limite = Math.min(200, Number(p.args['limite']) || 40)
      // "perto": so as cenas daquele trecho do episodio (o minuto que a fala/o roteiro diz).
      const perto = segundosDe(p.args['perto'])
      if (perto !== null && !ep) throw new Error('"perto" precisa do episodio (ex.: episodio "S01E12", perto "14:32").')
      const raio = Number(p.args['raio']) > 0 ? Number(p.args['raio']) : 15
      const distancia = (c: { start: number; duration: number }): number =>
        perto === null ? 0 : perto < c.start ? c.start - perto : perto > c.start + c.duration ? perto - (c.start + c.duration) : 0
      const achados = lib.clips.filter((c) => {
        if (perto !== null && distancia(c) > raio) return false
        if (soFavoritas && !favoritas.has(c.id)) return false
        if (ep &&(c.season !== Number(ep[1]) || c.episode !== Number(ep[2]))) return false
        if (anime && !normal(`${c.anime} ${c.animeTitle}`).includes(anime)) return false
        if (personagem && !c.characters.some((x) => normal(x).includes(personagem))) return false
        if (termos.length) {
          const tudo = normal(`${c.anime} ${c.animeTitle} ${c.characters.join(' ')} ${c.shot}`)
          if (!termos.every((t) => tudo.includes(t))) return false
        }
        return true
      })
      if (perto !== null) achados.sort((a, b) => distancia(a) - distancia(b))
      return {
        total: achados.length,
        clipes: achados.slice(0, limite).map((c) => ({
          caminho: c.path,
          anime: c.animeTitle || c.anime,
          episodio: `S${String(c.season).padStart(2, '0')}E${String(c.episode).padStart(2, '0')}`,
          plano: c.shot,
          noEpisodio: Math.round(c.start * 100) / 100,
          duracao: Math.round(c.duration * 100) / 100,
          personagens: c.characters,
          favorita: favoritas.has(c.id),
        })),
      }
    }
    case 'episodios': {
      const r = await doRecap().listarRascunhos()
      const lista = desembrulhar<{ id: string; episodioId: string; titulo: string; passo: number; atualizadoEm: string }[]>(r)
      return lista.map((x) => ({ rascunho: x.id, episodio: x.episodioId, titulo: x.titulo, passo: x.passo, atualizadoEm: x.atualizadoEm }))
    }
    case 'reconhecer':
      return reconhecer(p.args)
    default:
      throw new Error(`Acao desconhecida: ${String(p.acao)}`)
  }
}

// ------------------------------------------------- reconhecer personagens

/**
 * O "Reconhecer na mao" do Gerar recap, pela ponte DELE (window.dangai.modulos.recap):
 * o motor agrupa os rostos do episodio, o Claude da nome a cada grupo e confirma.
 * So quando o modulo Gerar recap esta ligado; cenas do AnCut o recap recusa (so le).
 */
interface PonteDoRecap {
  listarRascunhos(): Promise<unknown>
  iniciarDescoberta(pedido: { episodioId: string }): Promise<unknown>
  descobertaAtual(episodioId: string): Promise<unknown>
  confirmarDescoberta(jobId: string, decisao: unknown): Promise<unknown>
  cancelarDescoberta(jobId: string, manter?: boolean): Promise<unknown>
}

function doRecap(): PonteDoRecap {
  const r = (window as unknown as { dangai?: { modulos?: { recap?: PonteDoRecap } } }).dangai?.modulos?.recap
  if (!r) throw new Error('O modulo Gerar recap esta desligado (Configuracoes > Modulos).')
  return r
}

function desembrulhar<T>(r: unknown): T {
  const x = r as { ok?: boolean; value?: T; error?: string } | null
  if (!x || x.ok !== true) throw new Error(x?.error ?? 'O Gerar recap nao respondeu.')
  return x.value as T
}

interface GrupoDaJanela {
  key: number
  rostos: string[]
  totalDeRostos: number
  cenas: number
  sugestao: { nome: string; similaridade: number } | null
  sugestoes: { nome: string; similaridade: number }[]
  conhecido: boolean
  figurante: boolean
}

async function reconhecer(args: Record<string, unknown>): Promise<unknown> {
  const r = doRecap()
  const acao = String(args['acao'] ?? 'ver')
  const episodioId = String(args['episodio'] ?? '')
  if (acao === 'confirmar' || acao === 'cancelar') {
    const jobId = String(args['jobId'] ?? '')
    if (!jobId) throw new Error('Falta o jobId (vem no resultado do "iniciar"/"ver").')
    if (acao === 'cancelar') return desembrulhar(await r.cancelarDescoberta(jobId, false))
    const d = (args['decisao'] ?? {}) as Record<string, unknown>
    const decisao = { nomes: d['nomes'] ?? {}, ignorados: d['ignorados'] ?? [], juntar: d['juntar'] ?? [], removidos: d['removidos'] ?? {} }
    return desembrulhar(await r.confirmarDescoberta(jobId, decisao))
  }
  if (!/^ep_[0-9a-f]{40}$/.test(episodioId)) throw new Error('Falta o episodio (ep_..., veja "listar_episodios").')
  if (acao === 'iniciar') desembrulhar(await r.iniciarDescoberta({ episodioId }))
  // Espera o agrupamento (com o corte pronto, ~20 s; sem corte, minutos).
  for (let k = 0; k < 110; k++) {
    const ev = desembrulhar<{
      estado: { status: string; mensagem: string; erro: string | null }
      pronta: { jobId: string; anime: string; online: boolean; grupos: GrupoDaJanela[]; elenco: { nome: string; foto: string | null }[] } | null
    } | null>(await r.descobertaAtual(episodioId))
    const st = ev?.estado.status
    if (st === 'pronta' && ev?.pronta) {
      const p = ev.pronta
      // As imagens vao como URL do servidor de midia local: quem baixa e o main
      // (a janela em dev nao pode, CORS).
      const grupos = []
      for (const g of p.grupos) {
        const rostos = g.rostos.slice(0, 8)
        grupos.push({
          key: g.key,
          cenas: g.cenas,
          rostos,
          conhecido: g.conhecido,
          figurante: g.figurante,
          palpite: g.sugestao?.nome ?? null,
          sugestoes: g.sugestoes.slice(0, 3).map((s) => s.nome),
        })
      }
      const elenco = p.elenco.map((e) => ({ nome: e.nome, foto: e.foto }))
      return { jobId: p.jobId, anime: p.anime, online: p.online, grupos, elenco }
    }
    if (st === 'falhou' || st === 'cancelada') throw new Error(`Reconhecimento ${st}: ${ev?.estado.erro ?? ''}`)
    if (!ev && acao === 'ver') throw new Error('Nenhum reconhecimento em andamento neste episodio (use acao "iniciar").')
    await espera(3000)
  }
  throw new Error('O agrupamento ainda nao acabou: chame de novo com acao "ver".')
}
