/**
 * [recap] EPISODIOS EXTRAS (27/11), puro: o plano de outro episodio entra nas
 * escolhas com o id prefixado e a montagem acha o arquivo certo.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-extras.ts
 */
import type { Plano } from '../shared/episodio'
import { comExtras, doEpisodio, ehDeExtra, extrasForaDoRascunho, idCru, idNoExtra } from '../shared/extras'
import { escolhasForaDoIndice, filtrosDeCandidatosSchema, trechosDoCandidato, type CenaDaFrase, type EscolhaDaFrase } from '../shared/cenas'
import { rascunhoDoRecapSchema } from '../shared/roteiro'

let falhas = 0
function confere(ok: boolean, mensagem: string, extra?: unknown): void {
  if (ok) console.log(`ok    ${mensagem}`)
  else {
    falhas++
    console.log(`FALHA ${mensagem}`, extra ?? '')
  }
}

const PRINCIPAL = `ep_${'a'.repeat(40)}`
const EXTRA = `ep_${'b1'.repeat(20)}`
const OUTRO = `ep_${'c'.repeat(40)}`

const plano = (id: string, start: number, arquivo: string): Plano =>
  ({ id, start, end: start + 3, arquivo, keyframe: null, personagens: [], falantes: [] }) as unknown as Plano

const principal = { id: PRINCIPAL, planos: [plano('0010', 30, 'P/0010.mp4'), plano('0011', 33, 'P/0011.mp4')] }
const extra = { id: EXTRA, planos: [plano('0010', 30, 'X/0010.mp4'), plano('0011', 33, 'X/0011.mp4')] }

// A. ids
const id = idNoExtra(EXTRA, '0010')
confere(id === 'b1b1b1b1b1~0010', 'id prefixado com 10 hex do episodio', id)
confere(ehDeExtra(id) && !ehDeExtra('0010'), 'reconhece o prefixado')
confere(idCru(id) === '0010' && idCru('0011') === '0011', 'id cru volta')
confere(doEpisodio(id, EXTRA) && !doEpisodio(id, OUTRO), 'sabe de que episodio e')
confere(filtrosDeCandidatosSchema.safeParse({ vizinhasDe: id, episodio: EXTRA, perto: 750 }).success, 'filtros aceitam episodio e perto')

// B. o indice junto: o mesmo '0010' nos dois episodios, cada cena acha o seu arquivo
const junto = comExtras(principal, [extra])
confere(junto.planos.length === 4, 'planos dos extras no fim', junto.planos.length)
confere(comExtras(principal, []) === principal, 'sem extras, o mesmo indice')
const doExtra = trechosDoCandidato({ planoIds: [id], inSec: 30.5, outSec: 32 }, junto.planos)
confere(doExtra.length === 1 && doExtra[0]!.arquivo === 'X/0010.mp4' && Math.abs(doExtra[0]!.de - 0.5) < 1e-9, 'trecho do extra sai do arquivo do extra', doExtra)
const doPrincipal = trechosDoCandidato({ planoIds: ['0010'], inSec: 30.5, outSec: 32 }, junto.planos)
confere(doPrincipal[0]?.arquivo === 'P/0010.mp4', 'trecho do principal continua no principal', doPrincipal)

// C. fora do indice / fora dos extras
const cena = (planoIds: string[]): CenaDaFrase =>
  ({ candidato: { planoIds, episodioId: PRINCIPAL, inSec: 30, outSec: 32, nota: 0, porque: [], origem: 'usuario', keyframe: null }, palavraInicio: 0 }) as CenaDaFrase
const escolha = (fraseId: string, planoIds: string[]): EscolhaDaFrase => ({ fraseId, cenas: [cena(planoIds)] }) as unknown as EscolhaDaFrase
const cenas = { escolhas: [escolha('f01', ['0010']), escolha('f02', [id]), escolha('f03', ['9999'])] }
const fora = escolhasForaDoIndice(cenas, principal.planos)
confere(fora.join(',') === 'f03', 'o plano de extra nao conta como corte refeito', fora)
confere(extrasForaDoRascunho(cenas, [{ episodioId: EXTRA }]).length === 0, 'extra na lista: nada a refazer')
confere(extrasForaDoRascunho(cenas, []).join(',') === 'f02', 'extra tirado da lista: a frase refaz')

// D. rascunho de antes le sem extras
const base = rascunhoDoRecapSchema.safeParse({
  versao: 3,
  id: 'rc_aaaaaaaaaaaa_x',
  episodioId: PRINCIPAL,
  indicePath: 'x',
  titulo: 't',
  alvoSec: 60,
  eventos: [],
  eventosMeta: null,
  roteiros: [],
  atual: null,
  aprovado: false,
  aprovadoEm: null,
  criadoEm: '2026-11-27T00:00:00Z',
  atualizadoEm: '2026-11-27T00:00:00Z',
})
confere(!base.success || base.data.episodiosExtras.length === 0, 'rascunho antigo le episodiosExtras = []', base.success ? null : base.error.issues[0])

process.exitCode = falhas === 0 ? 0 : 1
