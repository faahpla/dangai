import type { ResumoDoRascunho } from '../../shared/roteiro'
import { PASSOS, type PassoDoAssistente } from './gerar-passos'

/**
 * "NOVO RECAP | CONTINUAR" (decisao do Levi, 15/10).
 *
 * Antes, o primeiro clique em "Gerar recap" reabria sozinho o ultimo
 * rascunho: quem queria comecar outro episodio caia no recap velho e tinha de
 * "Trocar episodio". Agora o clique abre uma escolha (EscolhaDoRecap.tsx):
 * "Novo recap" (o principal: escolher ou soltar o .mkv) e "Continuar", os
 * ultimos recaps -- clicar num volta onde ele parou. Sem rascunho nenhum, o
 * clique vai direto ao seletor de arquivo, como antes.
 *
 * Aqui so as regras puras da lista (sem store, sem window): o que entra, em
 * que ordem e como cada linha se le. A porta (abrirOuEscolher) e o abrir de
 * um recap (continuar) moram em gerar.ts.
 */

/** Quantas linhas a escolha mostra: os recaps da semana cabem, e a lista nao vira gaveta. */
export const RECAPS_PARA_CONTINUAR = 6

/** Uma linha do "Continuar". */
export interface RecapParaContinuar {
  episodioId: string
  /** 'Dr STONE'. */
  anime: string
  /** 'S04E24', 'S01-OP1', 'Filme'. Vazio quando o titulo nao segue o padrao. */
  episodio: string
  /** Onde ele reabre (o mesmo do passoAoRestaurar). */
  passo: PassoDoAssistente
  /** 'Roteiro', 'Voz', 'Cenas'. */
  nomeDoPasso: string
  /** ISO do ultimo salvamento: o "ha 2 h" da linha. */
  atualizadoEm: string
}

/*
 * O titulo do rascunho e `${anime} ${slugDoEpisodio(...)}` (tituloDoEpisodio,
 * no main). O slug e sempre o fim: 'S04E24', 'S01-OP1', 'Filme' ou
 * 'Filme (2016)'. Separar aqui evita mandar mais um campo pelo IPC so para a
 * tela por o episodio numa coluna.
 */
const FIM_DO_TITULO = /^(.+?)\s+(S\d{2,}(?:E\d+|-[A-Za-z]+\d+)|Filme(?: \(\d+\))?)$/

/** 'Dr STONE S04E24' -> { anime: 'Dr STONE', episodio: 'S04E24' }. Fora do padrao, tudo no anime. */
export function partesDoTitulo(titulo: string): { anime: string; episodio: string } {
  const limpo = titulo.trim()
  const m = FIM_DO_TITULO.exec(limpo)
  if (!m) return { anime: limpo, episodio: '' }
  return { anime: m[1]!.trim(), episodio: m[2]! }
}

/** O nome do passo como o cabecalho do assistente mostra. */
export function nomeDoPasso(passo: PassoDoAssistente): string {
  return PASSOS.find((p) => p.n === passo)?.nome ?? ''
}

/**
 * As linhas do "Continuar", do mais recente para o mais antigo, no maximo
 * `maximo`. UMA por episodio: abrirRascunho(episodioId) reabre o mais recente
 * daquele episodio, entao uma segunda linha do mesmo episodio (o rascunho
 * antigo que ficou no disco depois de um "Recomecar") abriria a mesma coisa.
 *
 * Rascunho cujo video sumiu continua na lista: o roteiro e a voz estao no
 * rascunho e as cenas na biblioteca do Studio, e o que faltar o proprio
 * abrir diz (o recado do abrirRascunho, ou o do corte no passo 1).
 */
export function recapsParaContinuar(
  lista: readonly ResumoDoRascunho[],
  maximo = RECAPS_PARA_CONTINUAR,
): RecapParaContinuar[] {
  // O main ja manda do mais novo ao mais velho; ordenar de novo nao custa e nao depende disso.
  const emOrdem = [...lista].sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm))
  const vistos = new Set<string>()
  const linhas: RecapParaContinuar[] = []
  for (const r of emOrdem) {
    if (linhas.length >= maximo) break
    if (vistos.has(r.episodioId)) continue
    vistos.add(r.episodioId)
    const { anime, episodio } = partesDoTitulo(r.titulo)
    // Resumo sem `passo` (main de antes desta versao): o passo 2, onde todo rascunho comeca.
    const passo: PassoDoAssistente = r.passo ?? 2
    linhas.push({
      episodioId: r.episodioId,
      anime,
      episodio,
      passo,
      nomeDoPasso: nomeDoPasso(passo),
      atualizadoEm: r.atualizadoEm,
    })
  }
  return comAMesmaGrafia(linhas)
}

/** 'Dr. Stone' e 'Dr STONE' sao o mesmo anime: so letras e numeros, sem caixa. */
function chaveDoAnime(anime: string): string {
  return anime.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/*
 * O titulo vem de cada rascunho (o anime como foi digitado ou achado naquele
 * episodio), e a lista mostrava o mesmo anime com duas grafias lado a lado.
 * Na tela vale a do recap mais recente daquele anime.
 */
function comAMesmaGrafia(linhas: RecapParaContinuar[]): RecapParaContinuar[] {
  const grafia = new Map<string, string>()
  for (const l of linhas) {
    const chave = chaveDoAnime(l.anime)
    if (chave && !grafia.has(chave)) grafia.set(chave, l.anime)
  }
  return linhas.map((l) => ({ ...l, anime: grafia.get(chaveDoAnime(l.anime)) ?? l.anime }))
}

/**
 * "agora", "ha 5 min", "ha 2 h", "ontem", "ha 3 dias" -- ou o dia (15/10)
 * depois de uma semana. A mesma escala dos "Projetos recentes" da tela inicial.
 */
export function haQuantoTempo(iso: string, agoraMs: number = Date.now()): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const min = Math.round((agoraMs - ms) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `ha ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `ha ${h} h`
  const d = Math.round(h / 24)
  if (d === 1) return 'ontem'
  if (d < 7) return `ha ${d} dias`
  const data = new Date(ms)
  return `${String(data.getDate()).padStart(2, '0')}/${String(data.getMonth() + 1).padStart(2, '0')}`
}
