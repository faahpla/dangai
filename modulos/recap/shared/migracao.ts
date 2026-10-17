/**
 * [recap] TRAZER DO ANIRECAP STUDIO (parte 5): os tipos do botao nas
 * Configuracoes. So tipos e funcoes puras (a ponte importa so tipos).
 *
 * O botao SO LE o perfil do Studio (%APPDATA%/AniRecap Studio) e junta no
 * perfil do modulo, sem nunca sobrescrever: o que ja existe no Dangai ganha.
 * Rodar duas vezes da o mesmo resultado (a segunda nao traz nada).
 */

/** O que a tela sabe antes de trazer: so aparece com dado do Studio. */
export interface StudioAchado {
  existe: boolean
  /** A pasta do perfil do Studio (a de producao, ou RECAP_STUDIO_DIR no dev). */
  pasta: string
  rascunhos: number
  /** Bytes da voz paga em cache (recaps/cache/voz). */
  vozBytes: number
}

export type FaseDaMigracao = 'ajustes' | 'chaves' | 'rascunhos' | 'voz' | 'historico' | 'motor' | 'fim'

/** main -> renderer, durante o trazer. */
export interface ProgressoDaMigracao {
  pedidoId: string
  fase: FaseDaMigracao
  /** 'Voz paga', 'Rascunhos'... */
  texto: string
  feitos: number
  total: number
}

/** O estado de uma chave no fim. Nunca leva a chave, nem um pedaco dela. */
export type EstadoDaChave = 'trazida' | 'ja-tinha' | 'colar-de-novo' | 'sem'

export interface ChaveTrazida {
  campo: string
  /** 'ElevenLabs', 'Fish Audio', 'Gemini'. */
  nome: string
  estado: EstadoDaChave
}

export interface ResumoDaMigracao {
  rascunhos: { trazidos: number; jaEstavam: number; quebrados: number }
  voz: { trazidos: number; bytes: number; jaEstavam: number }
  /** Medidas novas do ritmo da voz (recaps/ritmos.json). */
  ritmos: number
  /** Musicas novas no historico da Edicao rapida. */
  musicas: number
  personagens: { trazidos: number; jaEstavam: number }
  /** Fotos do elenco (anime_db) trazidas. */
  fotos: number
  /** O que veio das configuracoes: 'voz padrao', 'pasta de musicas'... */
  ajustes: string[]
  chaves: ChaveTrazida[]
  cancelado: boolean
  /** Coisas que nao vieram e por que (ASCII, curtas). */
  avisos: string[]
}

export const RESUMO_VAZIO: ResumoDaMigracao = {
  rascunhos: { trazidos: 0, jaEstavam: 0, quebrados: 0 },
  voz: { trazidos: 0, bytes: 0, jaEstavam: 0 },
  ritmos: 0,
  musicas: 0,
  personagens: { trazidos: 0, jaEstavam: 0 },
  fotos: 0,
  ajustes: [],
  chaves: [],
  cancelado: false,
  avisos: [],
}

/** 340 MB, 3,1 MB, 12 KB. */
export function tamanhoCurto(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`
  if (bytes >= 10 * 1024 * 1024) return `${Math.round(bytes / 1024 ** 2)} MB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} MB`
  if (bytes > 0) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return '0 MB'
}

/** "ok", "colar de novo" ou "ja tinha", pelo pior estado das chaves que existiam no Studio. */
export function estadoDasChaves(chaves: readonly ChaveTrazida[]): string {
  const vistas = chaves.filter((c) => c.estado !== 'sem')
  if (vistas.length === 0) return 'nenhuma no Studio'
  const colar = vistas.filter((c) => c.estado === 'colar-de-novo')
  if (colar.length > 0) return `colar de novo (${colar.map((c) => c.nome).join(', ')})`
  return 'ok'
}

/** A linha do fim: "12 rascunhos, 340 MB de voz, 7 personagens, chaves: ok". */
export function textoDoResumo(r: ResumoDaMigracao): string {
  const partes = [
    `${r.rascunhos.trazidos} ${r.rascunhos.trazidos === 1 ? 'rascunho' : 'rascunhos'}`,
    `${tamanhoCurto(r.voz.bytes)} de voz`,
    `${r.personagens.trazidos} ${r.personagens.trazidos === 1 ? 'personagem' : 'personagens'}`,
    `chaves: ${estadoDasChaves(r.chaves)}`,
  ]
  return `${r.cancelado ? 'Cancelado. Ate aqui: ' : ''}${partes.join(', ')}`
}

/** Nada novo: a segunda vez (ou um Studio ja trazido). */
export function nadaNovo(r: ResumoDaMigracao): boolean {
  return (
    r.rascunhos.trazidos === 0 &&
    r.voz.trazidos === 0 &&
    r.ritmos === 0 &&
    r.musicas === 0 &&
    r.personagens.trazidos === 0 &&
    r.fotos === 0 &&
    r.ajustes.length === 0 &&
    !r.chaves.some((c) => c.estado === 'trazida')
  )
}
