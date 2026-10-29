import type { AjusteDeCor } from './contract'

/**
 * "DO MEU JEITO": a edicao de som e cor que ele repete em todo video, aprendida
 * dos projetos dele e aplicada com um clique.
 *
 * Medido nos 31 projetos do Faah (10/2026): 17 sons por video, quase sempre os
 * mesmos e nos mesmos lugares -- o Return By Death ou o Illuminati nos 3
 * primeiros segundos (91% e 100% das vezes), o GONE TOO FAR a -19 dB embaixo
 * do video todo, o whoosh no corte (95%) e mais nos cortes que TROCAM DE
 * EPISODIO (54%, contra 33% dos cortes), o shutter no corte (100%), o riser
 * terminando num corte perto do fim, e a mesma camada de ajuste em 12 videos.
 *
 * Tres passos, todos puros (rodam no main, na janela e nos testes):
 *  1. resumirProjeto: um projeto salvo vira a lista do que ele fez de som e cor;
 *  2. montarPerfil: os resumos viram REGRAS (qual som, que papel, quantos por
 *     video, onde, em que volume e faixa);
 *  3. planejarMeuJeito: as regras viram os sons de um video novo.
 *
 * Musica de clima (Comedy, Pensando: 20 s a -20 dB num trecho que ele escolhe
 * pelo assunto) fica de fora: o lugar depende do que a frase diz, e chutar
 * errado custaria mais do que deixar para ele.
 */

// ------------------------------------------------------------------ resumo

export interface SomUsado {
  path: string
  nome: string
  faixa: number
  gainDb: number
  inicioSec: number
  /** Quanto tocou, em segundos. */
  usarSec: number
  fadeInSec: number
  fadeOutSec: number
  at: number
  /** `at` em fracao do video (0 = comeco). */
  relativo: number
  /** Que fracao do video ele cobre. */
  cobre: number
  /** corte - at, para o corte a ate 0,4 s do COMECO do som; null sem corte perto. */
  corteNoInicio: number | null
  /** corte - fim do som, para o corte a ate 0,4 s do FIM; null sem corte perto. */
  corteNoFim: number | null
  /** O corte de perto (comeco ou fim) troca de episodio. */
  trocaDeEpisodio: boolean
}

export interface ResumoDoProjeto {
  /** Quando foi salvo, em ms: os mais novos pesam mais na conta. */
  em: number
  duracaoSec: number
  sons: SomUsado[]
  /** A camada de ajuste que cobre a maior parte do video, se houver. */
  cor: AjusteDeCor | null
}

/** O minimo de um .dangai que o resumo le (o ProjectFile cabe aqui). */
export interface ProjetoParaResumir {
  /** O .dangai nem sempre grava a duracao da narracao: falta, vale o fim do ultimo bloco. */
  audio: { path?: string; durationSec?: number } | null
  plan: { scenes: readonly { start: number; end: number; imageIndex: number }[] } | null
  images: readonly { path: string }[]
  trilhas?: readonly {
    path: string
    fileName: string
    faixa: number
    at: number
    durationSec: number
    inicioSec?: number
    usarSec?: number | null
    gainDb?: number
    fadeInSec?: number
    fadeOutSec?: number
    id?: string
  }[]
  sobreposicoes?: readonly { tipo: string; at: number; usarSec?: number | null; cor?: AjusteDeCor }[]
}

/**
 * A pasta do EPISODIO de uma imagem: a de cima da `shots` do AnCut
 * (".../S01E06/shots/0161.mp4" -> "S01E06"), ou a propria pasta para print solto.
 */
export function episodioDaImagem(caminho: string): string {
  const partes = caminho.split(/[\\/]/)
  partes.pop()
  if (partes[partes.length - 1]?.toLowerCase() === 'shots') partes.pop()
  return partes.slice(-2).join('/')
}

/** Os cortes do video (o comeco de cada bloco depois do primeiro) e se trocam de episodio. */
export function cortesDoProjeto(p: ProjetoParaResumir): { t: number; trocaDeEpisodio: boolean }[] {
  const cenas = p.plan?.scenes ?? []
  const ep = (i: number): string => episodioDaImagem(p.images[cenas[i]?.imageIndex ?? -1]?.path ?? '')
  return cenas.slice(1).map((c, k) => ({ t: c.start, trocaDeEpisodio: ep(k + 1) !== ep(k) }))
}

const PERTO_DO_CORTE = 0.4

export function resumirProjeto(p: ProjetoParaResumir, em: number): ResumoDoProjeto | null {
  const dur = p.audio?.durationSec ?? p.plan?.scenes.at(-1)?.end ?? 0
  if (dur <= 0 || !p.plan) return null
  const cortes = cortesDoProjeto(p)
  const perto = (t: number): { t: number; trocaDeEpisodio: boolean } | null => {
    let melhor: { t: number; trocaDeEpisodio: boolean } | null = null
    for (const c of cortes) if (Math.abs(c.t - t) <= PERTO_DO_CORTE && (!melhor || Math.abs(c.t - t) < Math.abs(melhor.t - t))) melhor = c
    return melhor
  }
  const sons: SomUsado[] = []
  for (const t of p.trilhas ?? []) {
    // O que o proprio "Do meu jeito" pos nao ensina nada: so repetiria a regra.
    if (t.id?.startsWith(PREFIXO_DO_MEU_JEITO)) continue
    const inicioSec = t.inicioSec ?? 0
    const usarSec = Math.max(0, t.usarSec ?? t.durationSec - inicioSec)
    if (usarSec <= 0) continue
    const noInicio = perto(t.at)
    const noFim = perto(t.at + usarSec)
    sons.push({
      path: t.path,
      nome: t.fileName,
      faixa: t.faixa,
      gainDb: t.gainDb ?? 0,
      inicioSec,
      usarSec,
      fadeInSec: t.fadeInSec ?? 0,
      fadeOutSec: t.fadeOutSec ?? 0,
      at: t.at,
      relativo: t.at / dur,
      cobre: usarSec / dur,
      corteNoInicio: noInicio ? noInicio.t - t.at : null,
      corteNoFim: noFim ? noFim.t - (t.at + usarSec) : null,
      trocaDeEpisodio: !!(noInicio?.trocaDeEpisodio || noFim?.trocaDeEpisodio),
    })
  }
  const ajustes = (p.sobreposicoes ?? []).filter((s) => s.tipo === 'ajuste' && s.cor)
  const maior = ajustes.sort((a, b) => (b.usarSec ?? 0) - (a.usarSec ?? 0))[0]
  return { em, duracaoSec: dur, sons, cor: maior && (maior.usarSec ?? 0) >= dur * 0.6 ? maior.cor! : null }
}

// ------------------------------------------------------------------ perfil

export type PapelDoSom = 'abertura' | 'musica' | 'corte'

export interface SomDoPerfil {
  path: string
  nome: string
  papel: PapelDoSom
  /** Em quantos projetos aparece. */
  projetos: number
  /** Quantas vezes por video, na media dos videos com som. */
  porVideo: number
  gainDb: number
  faixa: number
  inicioSec: number
  usarSec: number
  fadeInSec: number
  fadeOutSec: number
  /** Corte: o som encosta no corte pelo COMECO (whoosh) ou pelo FIM (riser). */
  ancora: 'inicio' | 'fim'
  /** Quanto antes (ou depois) do corte ele fica, na mediana. */
  deslocamento: number
  /** Que fracao dos cortes dele troca de episodio. */
  trocaDeEpisodio: number
  /** Onde ele cai no video: cinco faixas de tempo, somando 1. */
  posicoes: number[]
  /** Musica: onde ela comeca, em fracao do video. */
  comeco: number
}

export interface PerfilDoMeuJeito {
  /** Quantos projetos entraram na conta. */
  projetos: number
  projetosComSom: number
  duracaoMedia: number
  abertura: SomDoPerfil[]
  musica: SomDoPerfil[]
  cortes: SomDoPerfil[]
  cor: { cor: AjusteDeCor; usos: number } | null
}

/** Os mais recentes que entram na conta: o jeito dele muda, e o de um ano atras pesa menos. */
export const PROJETOS_NA_CONTA = 40

const mediana = (v: readonly number[]): number => {
  if (v.length === 0) return 0
  const o = [...v].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2
}
const moda = (v: readonly number[]): number => {
  const conta = new Map<number, number>()
  for (const x of v) conta.set(x, (conta.get(x) ?? 0) + 1)
  return [...conta].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
}
const fracao = <T>(v: readonly T[], f: (x: T) => boolean): number => (v.length ? v.filter(f).length / v.length : 0)

export function montarPerfil(todos: readonly ResumoDoProjeto[]): PerfilDoMeuJeito {
  const resumos = [...todos].sort((a, b) => b.em - a.em).slice(0, PROJETOS_NA_CONTA)
  const comSom = resumos.filter((r) => r.sons.length > 0)
  const porArquivo = new Map<string, { usos: SomUsado[]; projetos: Set<number> }>()
  comSom.forEach((r, i) => {
    for (const s of r.sons) {
      const chave = s.path.toLowerCase()
      const e = porArquivo.get(chave) ?? { usos: [], projetos: new Set<number>() }
      e.usos.push(s)
      e.projetos.add(i)
      porArquivo.set(chave, e)
    }
  })

  const abertura: SomDoPerfil[] = []
  const musica: SomDoPerfil[] = []
  const cortes: SomDoPerfil[] = []
  for (const { usos, projetos } of porArquivo.values()) {
    // Usado uma vez so e acaso, nao jeito.
    if (projetos.size < 2) continue
    const s = usos[0]!
    const comCorte = usos.filter((u) => u.corteNoInicio !== null || u.corteNoFim !== null)
    // Com corte perto das duas pontas, vale a que encosta mais.
    const pelaPonta = fracao(
      comCorte,
      (u) => u.corteNoFim !== null && (u.corteNoInicio === null || Math.abs(u.corteNoFim) < Math.abs(u.corteNoInicio)),
    )
    const ancora: 'inicio' | 'fim' = pelaPonta > 0.5 ? 'fim' : 'inicio'
    const posicoes = [0, 0, 0, 0, 0]
    for (const u of usos) posicoes[Math.min(4, Math.floor(u.relativo * 5))]! += 1 / usos.length
    const base = {
      path: s.path,
      nome: s.nome,
      projetos: projetos.size,
      porVideo: usos.length / Math.max(1, comSom.length),
      gainDb: Math.round(mediana(usos.map((u) => u.gainDb)) * 10) / 10,
      faixa: moda(usos.map((u) => u.faixa)),
      inicioSec: mediana(usos.map((u) => u.inicioSec)),
      usarSec: mediana(usos.map((u) => u.usarSec)),
      fadeInSec: mediana(usos.map((u) => u.fadeInSec)),
      fadeOutSec: mediana(usos.map((u) => u.fadeOutSec)),
      ancora,
      deslocamento: mediana(
        comCorte.map((u) => (ancora === 'fim' ? (u.corteNoFim ?? 0) : (u.corteNoInicio ?? 0))),
      ),
      trocaDeEpisodio: fracao(comCorte, (u) => u.trocaDeEpisodio),
      posicoes,
      comeco: mediana(usos.map((u) => u.relativo)),
    }
    if (mediana(usos.map((u) => u.cobre)) >= 0.5) musica.push({ ...base, papel: 'musica' })
    else if (fracao(usos, (u) => u.at < 3) >= 0.6) abertura.push({ ...base, papel: 'abertura' })
    else if (comCorte.length / usos.length >= 0.5 && base.usarSec < 8) cortes.push({ ...base, papel: 'corte' })
  }
  const maisUsado = (a: SomDoPerfil, b: SomDoPerfil): number => b.projetos - a.projetos || b.porVideo - a.porVideo
  abertura.sort(maisUsado)
  musica.sort(maisUsado)
  cortes.sort(maisUsado)

  // A cor: a camada de ajuste que mais se repete (igual de verdade, valor a valor).
  const cores = new Map<string, { cor: AjusteDeCor; usos: number }>()
  for (const r of resumos) {
    if (!r.cor) continue
    const chave = JSON.stringify(r.cor)
    const e = cores.get(chave) ?? { cor: r.cor, usos: 0 }
    e.usos++
    cores.set(chave, e)
  }
  const cor = [...cores.values()].sort((a, b) => b.usos - a.usos)[0] ?? null

  return {
    projetos: resumos.length,
    projetosComSom: comSom.length,
    duracaoMedia: comSom.length ? comSom.reduce((t, r) => t + r.duracaoSec, 0) / comSom.length : 60,
    abertura,
    musica,
    cortes,
    cor: cor && cor.usos >= 3 ? cor : null,
  }
}

/** Da para aplicar? Sem ao menos tres videos com som, ainda nao ha jeito para copiar. */
export function perfilPronto(p: PerfilDoMeuJeito | null): p is PerfilDoMeuJeito {
  return !!p && p.projetosComSom >= 3 && p.abertura.length + p.musica.length + p.cortes.length > 0
}

// ------------------------------------------------------------------ plano

/** Os trechos que o "Do meu jeito" poe levam este prefixo no id: rodar de novo troca so eles. */
export const PREFIXO_DO_MEU_JEITO = 'meu-jeito-'

export interface ContextoDoVideo {
  duracaoSec: number
  cortes: readonly { t: number; trocaDeEpisodio: boolean }[]
  /** O que ja esta nas faixas de audio (e fica): faixa e intervalo. */
  ocupado: readonly { faixa: number; at: number; fim: number }[]
  /** A mesma semente da sempre a mesma escolha (o caminho da narracao). */
  semente: string
}

export interface SomAColocar {
  path: string
  nome: string
  papel: PapelDoSom
  faixa: number
  at: number
  inicioSec: number
  usarSec: number
  gainDb: number
  fadeInSec: number
  fadeOutSec: number
}

/** Dois sons de corte nunca mais perto que isto: um em cima do outro vira ruido. */
const ESPACO_ENTRE_CORTES = 1.5
/** O mesmo som de corte nao volta antes disto. */
const MESMO_SOM_A_CADA = 6
/** Som de corte a menos disto de outro deixa o corte menos atraente: espalha pelo video. */
const VIZINHANCA = 5

function aleatorio(semente: string): () => number {
  let h = 2166136261
  for (let i = 0; i < semente.length; i++) h = Math.imul(h ^ semente.charCodeAt(i), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Um dos candidatos, com mais chance para o mais usado (ele alterna entre aberturas). */
function sortear(lista: readonly SomDoPerfil[], r: () => number): SomDoPerfil | null {
  const total = lista.reduce((t, s) => t + s.projetos, 0)
  let x = r() * total
  for (const s of lista) {
    x -= s.projetos
    if (x <= 0) return s
  }
  return lista[0] ?? null
}

export function planejarMeuJeito(
  perfil: PerfilDoMeuJeito,
  ctx: ContextoDoVideo,
): { sons: SomAColocar[]; cor: AjusteDeCor | null } {
  const r = aleatorio(ctx.semente)
  const dur = ctx.duracaoSec
  const sons: SomAColocar[] = []
  const ocupado = [...ctx.ocupado]
  const faixaLivre = (preferida: number, at: number, fim: number): number => {
    const livre = (f: number): boolean => !ocupado.some((o) => o.faixa === f && at < o.fim - 1e-3 && fim > o.at + 1e-3)
    if (livre(preferida)) return preferida
    for (let f = 0; f < 12; f++) if (livre(f)) return f
    return preferida
  }
  const por = (s: SomDoPerfil, at: number, usarSec: number): void => {
    const inicio = Math.max(0, at)
    const toca = Math.max(0.05, Math.min(usarSec, dur - inicio))
    const faixa = faixaLivre(s.faixa, inicio, inicio + toca)
    ocupado.push({ faixa, at: inicio, fim: inicio + toca })
    sons.push({
      path: s.path,
      nome: s.nome,
      papel: s.papel,
      faixa,
      at: inicio,
      inicioSec: s.inicioSec,
      usarSec: toca,
      gainDb: s.gainDb,
      fadeInSec: s.fadeInSec,
      fadeOutSec: s.fadeOutSec,
    })
  }

  const abertura = sortear(perfil.abertura, r)
  if (abertura) por(abertura, 0, abertura.usarSec)

  const musica = sortear(perfil.musica, r)
  if (musica) {
    // Comeca onde ele costuma comecar, encostada no corte mais perto disso.
    const alvo = musica.comeco * dur
    const corte = ctx.cortes.reduce<number | null>((m, c) => (m === null || Math.abs(c.t - alvo) < Math.abs(m - alvo) ? c.t : m), null)
    const comeca = alvo < 3 || corte === null ? 0 : corte
    por(musica, comeca, dur - comeca)
  }

  /*
   * Sons de corte: os mais frequentes escolhem primeiro. Cada um respeita o
   * tempo que o outro TOCA (dois stingers de 3 s a 1,8 s um do outro se
   * atropelavam), o mesmo som nao volta antes de MESMO_SOM_A_CADA, e corte
   * perto de outro som perde ponto -- senao eles se juntavam no comeco e
   * deixavam o meio do video mudo.
   */
  const deCorte: { at: number; fim: number; path: string }[] = []
  const inicioLivre = abertura ? Math.min(3, abertura.usarSec) : 0.5
  for (const s of [...perfil.cortes].sort((a, b) => b.porVideo - a.porVideo)) {
    const quantos = Math.round(s.porVideo * (dur / Math.max(1, perfil.duracaoMedia)))
    const ondeEntra = (corte: number): number =>
      s.ancora === 'fim' ? corte - s.deslocamento - s.usarSec : corte - s.deslocamento
    for (let k = 0; k < quantos; k++) {
      const candidatos = ctx.cortes
        .filter((c) => {
          if (c.t < inicioLivre || c.t > dur - 0.3) return false
          const at = ondeEntra(c.t)
          return deCorte.every(
            (o) =>
              (at >= o.fim + 0.3 || at + s.usarSec <= o.at - 0.3) &&
              Math.abs(o.at - at) >= ESPACO_ENTRE_CORTES &&
              (o.path !== s.path || Math.abs(o.at - at) >= MESMO_SOM_A_CADA),
          )
        })
        .map((c) => ({
          c,
          nota:
            (c.trocaDeEpisodio ? 2 * s.trocaDeEpisodio : 0) +
            3 * (s.posicoes[Math.min(4, Math.floor((c.t / dur) * 5))] ?? 0) -
            1.5 * deCorte.filter((o) => Math.abs(o.at - c.t) < VIZINHANCA).length +
            0.5 * r(),
        }))
        .sort((a, b) => b.nota - a.nota)
      const escolhido = candidatos[0]?.c
      if (!escolhido) break
      const at = ondeEntra(escolhido.t)
      deCorte.push({ at, fim: at + s.usarSec, path: s.path })
      por(s, at, s.usarSec)
    }
  }
  sons.sort((a, b) => a.at - b.at)
  return { sons, cor: perfil.cor?.cor ?? null }
}
