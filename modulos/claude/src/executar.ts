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
    case 'recap':
      return recap(p.args)
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
  abrirRascunho(episodioId: string): Promise<unknown>
  candidatosDaFrase(rascunhoId: string, fraseId: string, filtros: Record<string, unknown>): Promise<unknown>
  salvarCenas(rascunhoId: string, escolhas: unknown[]): Promise<unknown>
  episodiosConhecidos?(rascunhoId: string): Promise<unknown>
  definirExtras?(rascunhoId: string, ids: string[]): Promise<unknown>
  extrasDasCenas?(rascunhoId: string): Promise<unknown>
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

// --------------------------------------------- as cenas do Gerar recap (27/11)

/**
 * O passo Cenas do Gerar recap pela ponte DELE: ver as frases e as cenas de cada
 * uma (do episodio principal ou de um EPISODIO EXTRA), escolher, e trocar a lista
 * de extras. A cena de um extra vem com o id prefixado ('<10 hex>~0025'): mande
 * de volta como veio. O que o Claude escolhe entra travado (o Sugerir nao troca).
 */
interface Candidato {
  planoIds: string[]
  episodioId: string
  inSec: number
  outSec: number
  origem: string
  porque: string[]
}
interface FraseCrua {
  id: string
  texto: string
}
interface EscolhaCrua {
  fraseId: string
  cenas: { candidato: Candidato; palavraInicio: number; baixo?: Candidato }[]
  travada: boolean
  [k: string]: unknown
}
interface RascunhoCru {
  id: string
  episodioId: string
  titulo: string
  atual: number | null
  roteiros: { versao: number; secoes: { frases: FraseCrua[] }[] }[]
  cenas: { escolhas: EscolhaCrua[] } | null
}

const arred = (x: number): number => Math.round(x * 100) / 100

async function recap(args: Record<string, unknown>): Promise<unknown> {
  const r = doRecap()
  const op = String(args['op'] ?? '')
  const episodio = String(args['episodio'] ?? '')
  if (!/^ep_[0-9a-f]{40}$/.test(episodio)) throw new Error('Falta o episodio principal (ep_..., veja "listar_episodios").')
  if (!r.extrasDasCenas || !r.definirExtras || !r.episodiosConhecidos) throw new Error('Este Dangai ainda nao tem episodios extras: atualize o Dangai.')
  const aberto = desembrulhar<{ rascunho: RascunhoCru; indice: { planos: { id: string; arquivo: string }[] } }>(await r.abrirRascunho(episodio))
  const rascunho = aberto.rascunho
  const roteiro = rascunho.roteiros.find((x) => x.versao === rascunho.atual)
  const frases = roteiro ? roteiro.secoes.flatMap((x) => x.frases) : []
  const extras = desembrulhar<{ extras: { episodioId: string; titulo: string; ok: boolean; cenas: number }[]; planos: { id: string; arquivo: string }[] }>(
    await r.extrasDasCenas(rascunho.id),
  )
  const arquivoDe = new Map<string, string>([...aberto.indice.planos, ...extras.planos].map((p) => [p.id, p.arquivo]))
  const resumo = (c: Candidato) => ({
    planoIds: c.planoIds,
    episodio: c.episodioId,
    inSec: arred(c.inSec),
    outSec: arred(c.outSec),
    duracao: arred(c.outSec - c.inSec),
    arquivo: arquivoDe.get(c.planoIds[0] ?? '') ?? null,
    ...(c.porque.length ? { porque: c.porque } : {}),
  })

  if (op === 'extras') {
    if (Array.isArray(args['definir'])) {
      desembrulhar(await r.definirExtras(rascunho.id, (args['definir'] as unknown[]).map(String)))
      return recap({ episodio, op: 'extras' })
    }
    const conhecidos = desembrulhar<{ episodioId: string; titulo: string; cenas: number }[]>(await r.episodiosConhecidos(rascunho.id))
    return {
      principal: { episodio: rascunho.episodioId, titulo: rascunho.titulo },
      extras: extras.extras.map((e) => ({ episodio: e.episodioId, titulo: e.titulo, cenas: e.cenas, abre: e.ok })),
      podeAdicionar: conhecidos.map((c) => ({ episodio: c.episodioId, titulo: c.titulo, cenas: c.cenas })),
    }
  }

  if (op === 'ver') {
    const fraseId = typeof args['frase'] === 'string' ? args['frase'] : ''
    if (!fraseId) {
      const porFrase = new Map((rascunho.cenas?.escolhas ?? []).map((e) => [e.fraseId, e]))
      return {
        rascunho: rascunho.id,
        titulo: rascunho.titulo,
        extras: extras.extras.map((e) => ({ episodio: e.episodioId, titulo: e.titulo })),
        frases: frases.map((f) => {
          const e = porFrase.get(f.id)
          return {
            frase: f.id,
            texto: f.texto,
            travada: e?.travada ?? false,
            cenas: (e?.cenas ?? []).map((c) => ({ palavra: c.palavraInicio, ...resumo(c.candidato), ...(c.baixo ? { baixo: resumo(c.baixo) } : {}) })),
          }
        }),
      }
    }
    const perto = segundosDe(args['perto'])
    const de = typeof args['de'] === 'string' && args['de'] ? args['de'] : null
    const lista = desembrulhar<{ sugestoes: Candidato[]; vizinhas: Candidato[]; outras: Candidato[]; personagens: { nome: string; cenas: number }[]; momento: number | null }>(
      await r.candidatosDaFrase(rascunho.id, fraseId, {
        episodio: de,
        perto,
        personagem: typeof args['personagem'] === 'string' && args['personagem'] ? args['personagem'] : null,
        busca: typeof args['busca'] === 'string' && args['busca'] ? args['busca'] : null,
      }),
    )
    const limite = typeof args['limite'] === 'number' ? args['limite'] : 40
    return {
      frase: fraseId,
      texto: frases.find((f) => f.id === fraseId)?.texto ?? null,
      episodio: de ?? rascunho.episodioId,
      momento: lista.momento,
      personagens: lista.personagens.slice(0, 20).map((p) => p.nome),
      sugestoes: lista.sugestoes.map(resumo),
      perto: lista.vizinhas.map(resumo),
      outras: lista.outras.slice(0, limite).map(resumo),
      outrasNoTotal: lista.outras.length,
    }
  }

  if (op === 'escolher') {
    const fraseId = String(args['frase'] ?? '')
    if (!frases.some((f) => f.id === fraseId)) throw new Error(`Frase fora do roteiro: ${fraseId} (veja cenas_do_recap sem frase).`)
    const atual = rascunho.cenas?.escolhas.find((e) => e.fraseId === fraseId)
    if (!atual) throw new Error('Essa frase ainda nao tem escolha: abra o passo Cenas (o Sugerir enche todas) e tente de novo.')
    const pedidas = Array.isArray(args['cenas']) ? (args['cenas'] as Record<string, unknown>[]) : []
    if (!pedidas.length) throw new Error('Mande as cenas: [{planoIds, episodio, inSec, outSec, palavra}].')
    const cenas = pedidas.map((c, k) => {
      const planoIds = Array.isArray(c['planoIds']) ? (c['planoIds'] as unknown[]).map(String) : []
      const inSec = Number(c['inSec'])
      const outSec = Number(c['outSec'])
      if (!planoIds.length || !(outSec > inSec)) throw new Error(`Cena ${k + 1}: precisa de planoIds, inSec e outSec (como o cenas_do_recap devolveu).`)
      const episodioId = typeof c['episodio'] === 'string' && c['episodio'] ? c['episodio'] : rascunho.episodioId
      return {
        candidato: { planoIds, episodioId, inSec, outSec, nota: 0, porque: [], origem: 'usuario', keyframe: null },
        palavraInicio: k === 0 ? 0 : Number(c['palavra'] ?? 0),
      }
    })
    const nova: Record<string, unknown> = { ...atual, cenas, travada: true }
    delete nova['grid']
    const g = desembrulhar<{ rascunho: RascunhoCru }>(await r.salvarCenas(rascunho.id, [nova]))
    const gravada = g.rascunho.cenas?.escolhas.find((e) => e.fraseId === fraseId)
    return {
      frase: fraseId,
      cenas: (gravada?.cenas ?? []).map((c) => ({ palavra: c.palavraInicio, ...resumo(c.candidato) })),
      aviso: 'Gravado no rascunho. Se o passo Cenas estiver aberto, ele mostra quando reabrir o passo.',
    }
  }
  throw new Error(`op desconhecida: ${op}`)
}
