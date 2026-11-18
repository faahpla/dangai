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
      const achados = lib.clips.filter((c) => {
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
    default:
      throw new Error(`Acao desconhecida: ${String(p.acao)}`)
  }
}
