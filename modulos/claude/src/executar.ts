import type { Nucleo } from '@/modulos/nucleo'
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
    case 'biblioteca': {
      if (!n.ler().library) await n.sincronizarBiblioteca()
      const lib = n.ler().library
      if (!lib) throw new Error('A Biblioteca nao carregou (configure a pasta nas Configuracoes do Dangai).')
      const termos = normal(String(p.args['texto'] ?? ''))
        .split(/\s+/)
        .filter(Boolean)
      const personagem = normal(String(p.args['personagem'] ?? ''))
      const anime = normal(String(p.args['anime'] ?? ''))
      const ep = /s(\d+)\s*e(\d+)/i.exec(String(p.args['episodio'] ?? ''))
      const limite = Math.min(200, Number(p.args['limite']) || 40)
      const achados = lib.clips.filter((c) => {
        if (ep && (c.season !== Number(ep[1]) || c.episode !== Number(ep[2]))) return false
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
        })),
      }
    }
    default:
      throw new Error(`Acao desconhecida: ${String(p.acao)}`)
  }
}
