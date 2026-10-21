import type { EpisodeIndex } from './episodio'

/**
 * (21/10) O AVISO ANTES DE SEGUIR: o episodio sem personagens reconhecidos.
 *
 * Por que: o Faah importou um episodio que o AnCut ja tinha cortado, mas sem
 * reconhecer ninguem. Sem quem e quem, a escolha de cenas cai muito: o
 * recorte enquadra a pessoa errada (no Nia E01, o Neal numa frase da Nia),
 * "a garota" nao vira a protagonista, o grid automatico nao entra (ele falha
 * fechado sem identidade) e "quem a frase cita" vira o maior rosto.
 *
 * Duas forcas:
 * - 'sem': reconhecimento pulado (so corte), elenco vazio ou ninguem achado
 *   -- 0 planos com personagem. O Nia E01 e "pulado: 0 de 432 planos". Elenco
 *   vazio (characters.json `[]`) sempre acaba aqui: sem foto, ninguem casa.
 * - 'fraco': rodou, mas quase nada foi identificado (menos de LIMIAR_FRACO
 *   dos planos com alguem -- o caso do elenco com 1 foto por personagem,
 *   abaixo do minimo do motor, em que so um ou outro passa).
 *
 * Indice sem planos ainda (o corte por tras): so da para dizer 'sem' quando o
 * corte foi pedido sem reconhecer; com reconhecer, espera as cenas.
 */
export const LIMIAR_FRACO = 0.1

export interface AvisoDeReconhecimento {
  tipo: 'sem' | 'fraco'
  /** Planos com alguem reconhecido. */
  comPersonagem: number
  /** Planos do episodio (0 = ainda cortando). */
  total: number
  /** 'pulado' = o motor so cortou; 'ninguem' = procurou e nao achou (ou nao ha como saber). */
  porque: 'pulado' | 'ninguem' | 'poucos'
}

export function avisoDeReconhecimento(
  indice: Pick<EpisodeIndex, 'planos' | 'reconhecimento' | 'corte'>,
): AvisoDeReconhecimento | null {
  const total = indice.planos.length
  if (total === 0) {
    return indice.corte?.reconhecer === false ? { tipo: 'sem', comPersonagem: 0, total: 0, porque: 'pulado' } : null
  }
  const comPersonagem = indice.planos.filter((p) => p.personagens.length > 0).length
  if (comPersonagem === 0) {
    return { tipo: 'sem', comPersonagem, total, porque: indice.reconhecimento === 'pulado' ? 'pulado' : 'ninguem' }
  }
  if (comPersonagem / total < LIMIAR_FRACO) return { tipo: 'fraco', comPersonagem, total, porque: 'poucos' }
  return null
}

/** As frases da tela, em ASCII como o resto do modulo. */
export const TITULO_SEM_PERSONAGENS = 'Sem personagens reconhecidos'
/** O porque, debaixo do titulo (a caixa tem titulo: a 1a frase vira ele). */
export const CONSEQUENCIA =
  "Sem isso a escolha de cenas fica pior: o recorte nao sabe quem e quem, 'a garota' nao vira a protagonista e o grid nao entra."
/** O texto inteiro (tooltip do selo, leitor de tela). */
export const TEXTO_SEM_PERSONAGENS = `Esse episodio nao tem personagens reconhecidos. ${CONSEQUENCIA}`

/** O titulo da caixa: o 'fraco' leva os numeros nele ("Poucos personagens reconhecidos (12 de 432 planos)"). */
export function tituloDoAviso(a: AvisoDeReconhecimento): string {
  return a.tipo === 'sem' ? TITULO_SEM_PERSONAGENS : `Poucos personagens reconhecidos (${a.comPersonagem} de ${a.total} planos)`
}

/** O corpo, debaixo do titulo: no 'fraco', "Com tao poucos" no lugar do "Sem isso". */
export function corpoDoAviso(a: AvisoDeReconhecimento): string {
  return a.tipo === 'sem' ? CONSEQUENCIA : CONSEQUENCIA.replace(/^Sem isso/, 'Com tao poucos,')
}

export function textoDoAviso(a: AvisoDeReconhecimento): string {
  return a.tipo === 'sem' ? TEXTO_SEM_PERSONAGENS : `${tituloDoAviso(a)}. ${corpoDoAviso(a)}`
}

/** A linha miuda debaixo do texto: de onde vem o "sem" ("Reconhecimento pulado: 0 de 432 planos"). */
export function detalheDoAviso(a: AvisoDeReconhecimento): string | null {
  if (a.tipo === 'fraco') return null
  const planos = a.total > 0 ? `: 0 de ${a.total} planos` : ''
  return a.porque === 'pulado' ? `Reconhecimento pulado${planos}` : `Ninguem reconhecido${planos}`
}

/** O selo do passo 4. */
export function seloDoAviso(a: AvisoDeReconhecimento): string {
  return a.tipo === 'sem' ? 'sem personagens: escolha mais fraca' : 'poucos personagens: escolha mais fraca'
}

// ------------------------------------------------- o "Seguir assim" lembrado

/**
 * "Seguir assim" vale para AQUELE episodio: guardado no localStorage do app
 * (por perfil), pelo id do episodio e pela forca do aviso -- um 'sem' aceito
 * nao cala o 'fraco' de depois de reconhecer. Fica tambem como a marca de "as
 * cenas foram escolhidas sem personagens": reconhecido depois, o passo 4
 * sugere "Sugerir de novo" (e esquece a marca).
 */
export const CHAVE_SEGUIR_ASSIM = 'recap.seguirSemPersonagens'
/** Os mais antigos saem: a lista nao cresce para sempre. */
export const MAXIMO_LEMBRADOS = 300

type Armazem = Pick<Storage, 'getItem' | 'setItem'>
type Lembrados = Record<string, AvisoDeReconhecimento['tipo']>

function ler(armazem: Armazem | null): Lembrados {
  if (!armazem) return {}
  try {
    const cru: unknown = JSON.parse(armazem.getItem(CHAVE_SEGUIR_ASSIM) ?? '{}')
    if (!cru || typeof cru !== 'object' || Array.isArray(cru)) return {}
    const certo: Lembrados = {}
    for (const [id, tipo] of Object.entries(cru)) if (tipo === 'sem' || tipo === 'fraco') certo[id] = tipo
    return certo
  } catch {
    return {}
  }
}

function gravar(armazem: Armazem | null, lembrados: Lembrados): void {
  if (!armazem) return
  const ids = Object.keys(lembrados)
  const corte = ids.slice(0, Math.max(0, ids.length - MAXIMO_LEMBRADOS))
  for (const id of corte) delete lembrados[id]
  try {
    armazem.setItem(CHAVE_SEGUIR_ASSIM, JSON.stringify(lembrados))
  } catch {
    // Sem armazem (cota, modo privado): pergunta de novo da proxima vez. Nada quebra.
  }
}

/** Guarda o "Seguir assim" deste episodio (o mais novo vai para o fim). */
export function lembrarSeguirAssim(armazem: Armazem | null, episodioId: string, tipo: AvisoDeReconhecimento['tipo']): void {
  const lembrados = ler(armazem)
  delete lembrados[episodioId]
  lembrados[episodioId] = tipo
  gravar(armazem, lembrados)
}

/** A forca que ele aceitou neste episodio, ou null. */
export function seguiuAssim(armazem: Armazem | null, episodioId: string): AvisoDeReconhecimento['tipo'] | null {
  return ler(armazem)[episodioId] ?? null
}

export function esquecerSeguirAssim(armazem: Armazem | null, episodioId: string): void {
  const lembrados = ler(armazem)
  if (!(episodioId in lembrados)) return
  delete lembrados[episodioId]
  gravar(armazem, lembrados)
}

/** O aviso a mostrar ao seguir: null quando reconhecido ou quando ele ja aceitou esta mesma forca. */
export function avisoAoSeguir(
  indice: Pick<EpisodeIndex, 'id' | 'planos' | 'reconhecimento' | 'corte'>,
  armazem: Armazem | null,
): AvisoDeReconhecimento | null {
  const aviso = avisoDeReconhecimento(indice)
  if (!aviso) return null
  return seguiuAssim(armazem, indice.id) === aviso.tipo ? null : aviso
}

/**
 * O passo 4 depois de reconhecer: as cenas foram sugeridas sem personagens
 * (ele seguiu assim) e agora o episodio esta reconhecido -> "Sugerir de novo".
 */
export function pedeSugerirDeNovo(
  indice: Pick<EpisodeIndex, 'id' | 'planos' | 'reconhecimento' | 'corte'>,
  armazem: Armazem | null,
): boolean {
  return seguiuAssim(armazem, indice.id) !== null && avisoDeReconhecimento(indice) === null
}
