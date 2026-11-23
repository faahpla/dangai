import { semAcento, type Clima } from './trilha-sonora'

/**
 * O GUIA DE MUSICAS DO LEVI (22/11, "o estilo de audio do Kiumaz"). Ele mesmo
 * disse para que serve cada faixa da pasta e onde ela entra. Isto manda no
 * palpite pelo nome e na IA (electron/som/clima.ts), e o ponto de entrada daqui
 * manda no detector de drop (electron/som/entradas.ts).
 *
 * Por que existe: no Overgeared S01E09 (22/11), um video de acao e progressao,
 * a Edicao rapida pos ELSE PARIS (suspense) e Afternoon of Konoha (comedia
 * slice of life). O Levi chamou de erro: as duas sao "muito especificas".
 *
 * A musica e achada pelo NOME do arquivo (sem acento, minusculas), entao vale em
 * qualquer pasta.
 */
export interface MusicaDoGuia {
  id: string
  nome: RegExp
  /** Os climas em que ela serve, o principal primeiro. */
  climas: readonly Clima[]
  /**
   * Muito especifica: so toca quando o trecho pede EXATAMENTE um dos climas
   * dela. Nunca entra como "a mais parecida" (os vizinhos do clima) nem como
   * qualquer uma.
   */
  especifica?: boolean
  /** O DROP que o Levi usa (segundo do arquivo), por clima ou para todos ('*'). */
  entradaSec?: Partial<Record<Clima | '*', number>>
  /**
   * Onde ela COMECA (segundo do arquivo), pulando o comeco: CLIMA LINDO 0:10,
   * River's End 1:20. Sem drop: o trecho toca dali.
   */
  comecoSec?: number
  /** So no gancho: a slowed da Montagem Batchi (depois dele, a instrumental). */
  soNoGancho?: boolean
  /**
   * A abertura de UM anime (Haruka Mirai = Black Clover): so nos videos dele, e
   * neles ela vem primeiro. O anime sai do nome do projeto (a narracao se chama
   * "<anime> SxxEyy data.wav").
   */
  doAnime?: RegExp
}

export const GUIA_DE_MUSICAS: readonly MusicaDoGuia[] = [
  // "a que mais gosto": a slowed no gancho, a instrumental da virada em diante (ver COMBO_DO_GANCHO).
  { id: 'montagem-slowed', nome: /montagem batchi.*slowed/, climas: ['acao'], soNoGancho: true },
  { id: 'montagem-instrumental', nome: /montagem batchi.*instrumental/, climas: ['acao', 'epica'], entradaSec: { '*': 19 } },
  // "uso muito pos hook! bem generica, encaixa com quase todo contexto, as vs o video todo"
  { id: 'passo-bem-solto', nome: /passo bem solto/, climas: ['acao', 'epica', 'comedia', 'calma', 'suspense'] },
  // "Hook e pos hook (na entrada do refrao)... perto de 14 segundos entra o contexto"
  { id: 'haruka-mirai', nome: /haruka mirai/, climas: ['acao', 'epica'], entradaSec: { '*': 14 }, doAnime: /black ?clover/ },
  // "cenas emocionais ou contando historia do personagem... em 1:44 otimos ganchos pra partes epicas"
  { id: 'my-hero', nome: /my hero is our hero|futari no hero/, climas: ['sentimental', 'epica'], entradaSec: { epica: 104 } },
  // "curiosidade... sempre comeco perto de 0:10... neutra, nao e boa com partes emocionais e epicas"
  { id: 'clima-lindo', nome: /clima lindo/, climas: ['calma', 'comedia'], comecoSec: 10 },
  // "bem especifica, so quando consigo encaixar em um suspense"
  { id: 'else-paris', nome: /else paris/, climas: ['suspense'], especifica: true },
  // "boa pra inicio de video se pegar a parte certa... nunca num romance, talvez um acao"
  { id: 'x-galactico', nome: /x.?galactico/, climas: ['acao'] },
  // "boa pra anime de acao pq tem mt altos e baixos, boa entrada pra meio de video"
  { id: 'specialz', nome: /specialz/, climas: ['acao', 'epica'] },
  // "MUITO especifica! comediazao bem slice of life"
  { id: 'afternoon-of-konoha', nome: /afternoon of konoha/, climas: ['comedia'], especifica: true },
  // "curiosidade, romance, e neutra"
  { id: 'no-signal', nome: /no signal/, climas: ['calma', 'romance'] },
  // "otima pra romance e partes emocionais"
  { id: 'we-dont-talk-anymore', nome: /we don.?t talk anymore/, climas: ['romance', 'sentimental'] },
  // "partes epicas... 0:46 tem uma otima entrada, ja entra com tudo"
  { id: 'where-our-blue-is', nome: /where our blue is/, climas: ['epica', 'acao'], entradaSec: { '*': 46 } },
  // "historias tristes e emocionais, mas e mais baixa... comecar tipo 1:20"
  { id: 'rivers-end', nome: /river.?s end/, climas: ['sentimental'], comecoSec: 80 },
  // "boa pra acao mas situacional"
  { id: 'kaikai-kitan', nome: /kaikai kitan/, climas: ['acao'] },
  // "generica, boa pra historinha mais animada, pode entrar no meio tbm, 0:07"
  { id: 'mente-ma', nome: /mente ma\b/, climas: ['comedia', 'calma', 'acao'], entradaSec: { '*': 7 } },
  // "animadassa, aura, 0:15 entrada"
  { id: 'no-batidao', nome: /no batidao/, climas: ['acao', 'epica'], entradaSec: { '*': 15 } },
]

/** A combinacao do gancho: a slowed ate a virada, a instrumental dali (0:25 da slowed = 0:19 da instrumental). */
export const COMBO_DO_GANCHO = {
  gancho: 'montagem-slowed',
  depois: 'montagem-instrumental',
  /** O segundo da slowed que cai na saida do gancho. */
  corteNoGanchoSec: 25,
  /** O segundo da instrumental que toca na saida do gancho (o drop dela). */
  entradaDepoisSec: 19,
} as const

/** A musica do guia pelo nome do arquivo. null = ele nao falou dela. */
export function musicaDoGuia(fileName: string): MusicaDoGuia | null {
  const nome = semAcento(fileName.replace(/\\/g, '/').split('/').pop() ?? fileName)
  return GUIA_DE_MUSICAS.find((m) => m.nome.test(nome)) ?? null
}

/** O drop do guia para o clima (o do clima, senao o de todos). null = o detector acha. */
export function entradaDoGuia(m: MusicaDoGuia | null, clima: Clima): number | null {
  if (!m?.entradaSec) return null
  return m.entradaSec[clima] ?? m.entradaSec['*'] ?? null
}

/**
 * A musica de um anime so (doAnime) serve neste video? `projeto` = o nome da
 * narracao ou do projeto ("Black Clover S02E08 2026-11-21.wav"). Sem nome: nao.
 */
export function servePeloAnime(m: MusicaDoGuia | null, projeto: string | null): boolean {
  if (!m?.doAnime) return true
  if (!projeto) return false
  return m.doAnime.test(semAcento(projeto.split(/[\\/]/).pop() ?? projeto))
}
