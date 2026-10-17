import { join } from 'node:path'
import { pastaDosRascunhos } from '../gerar/rascunho'

/**
 * Onde a voz mora no disco. Tudo dentro de <userData>/recaps, ao lado do
 * rascunho -- nunca na biblioteca do AnCut/Corte Cenas nem na pasta do
 * episodio:
 *
 *   recaps/<rascunhoId>.json               o rascunho (com `voz`)
 *   recaps/<rascunhoId>/voz/bruto-<h>.wav  o audio antes do pos, por take
 *   recaps/<rascunhoId>/voz/narracao-<h>.wav  a narracao montada, por take
 *   recaps/cache/voz/<sha256>.wav + .json  o que o provedor devolveu (audio,
 *                                          alignment, request-id): a chave e
 *                                          sha256 de fonte+voz+modelo+settings+
 *                                          texto+contexto+formato. Nunca pagar
 *                                          duas vezes pela mesma coisa.
 *
 * <h> = sha256 do CONTEUDO do WAV (16 a 64 hex): o mesmo audio da o mesmo
 * nome, e um arquivo nunca e sobrescrito com outro conteudo -- o take antigo
 * continua tocando enquanto existir na lista. No "Abrir no editor" o take
 * aprovado e COPIADO para <projeto>/<anime> SxxEyy.wav (montar/index.ts): o
 * projeto nao aponta para o userData.
 *
 * A subpasta <rascunhoId>/ nao confunde a lista de rascunhos: ela so le
 * <id>.json da raiz.
 */

/** O formato de idDoRascunho (shared/roteiro.ts): seguro para virar pasta. */
const ID_VALIDO = /^rc_[0-9a-z_]+$/
/** So os dois nomes que o contrato permite (shared/voz.ts): nada de ../ vindo de fora. */
const NOME_VALIDO = /^(?:narracao|bruto)-[0-9a-f]{16,64}\.wav$/

export function pastaDaVoz(rascunhoId: string): string {
  if (!ID_VALIDO.test(rascunhoId)) throw new Error('Rascunho invalido.')
  return join(pastaDosRascunhos(), rascunhoId, 'voz')
}

/** Caminho absoluto de um arquivo de take (TakeDaVoz.arquivo ou bruto.arquivo). */
export function arquivoDaVoz(rascunhoId: string, nome: string): string {
  if (!NOME_VALIDO.test(nome)) throw new Error('Arquivo de voz invalido.')
  return join(pastaDaVoz(rascunhoId), nome)
}

/** O cache do provedor, compartilhado entre rascunhos (o mesmo texto na mesma voz e o mesmo audio). */
export function pastaDoCacheDaVoz(): string {
  return join(pastaDosRascunhos(), 'cache', 'voz')
}
