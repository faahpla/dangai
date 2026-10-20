/**
 * ROTEIRO x NARRACAO QUE NAO BATE -- os casos que o Claude do Levi achou no
 * fluxo normal (importar audio e roteiro): o audio certo continua casando; o
 * de outro assunto, o longo cheio de outras coisas e o cortado no meio sao
 * recusados, cada um com o motivo dele.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-roteiro-nao-bate.ts`.
 */
import { alinharRoteiro } from '../../shared/align.ts'
import type { Word } from '../../shared/contract.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const ROTEIRO =
  'A Kiwi usa mascara porque o rosto dela foi destruido numa missao. Ela nunca confiou em ninguem depois que o antigo parceiro a traiu. ' +
  'Por isso ela some sempre que o grupo precisa de ajuda, e volta so quando o trabalho ja esta pago. ' +
  'Mas no fim ela entrega o grupo inteiro para a Arasaka, e ninguem viu isso chegando.'
const OUTRO =
  'O Goku treinou com o mestre Kame durante anos e aprendeu que a forca de verdade vem de dentro, e que o que importa e o que voce faz quando ninguem esta olhando. ' +
  'Depois disso ele enfrentou o Piccolo, o Vegeta e o Freeza, e cada luta deixou uma cicatriz que o anime nunca mostrou de verdade.'

/** As palavras como o Whisper devolveria: em minusculas, sem pontuacao, 0,4 s cada. */
const falado = (texto: string, inicio = 0): Word[] =>
  texto
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t, i) => ({ text: t, start: inicio + i * 0.4, end: inicio + i * 0.4 + 0.35 }))
const palavras = ROTEIRO.split(/\s+/)
const motivo = (r: ReturnType<typeof alinharRoteiro>): string => ('falha' in r ? r.falha : 'casou')

ok('audio certo: casa', motivo(alinharRoteiro(ROTEIRO, falado(ROTEIRO))) === 'casou')
// O Whisper erra algumas palavras: continua casando.
const comErros = falado(ROTEIRO).map((w, i) => (i % 9 === 4 ? { ...w, text: 'xyz' } : w))
ok('audio certo com erros do Whisper: casa', motivo(alinharRoteiro(ROTEIRO, comErros)) === 'casou')
// Cinco minutos de outra coisa ANTES da narracao certa: ainda casa (o trecho casado e denso).
const antes = Array.from({ length: 20 }, () => OUTRO).join(' ')
const antesW = falado(antes)
const certoDepois = falado(ROTEIRO, antesW.at(-1)!.end + 1)
ok('certo com muita outra coisa antes: casa', motivo(alinharRoteiro(ROTEIRO, [...antesW, ...certoDepois])) === 'casou')

ok('audio de outro assunto: nao bate', motivo(alinharRoteiro(ROTEIRO, falado(OUTRO))) === 'nao-bate')
// 19 "minutos" de outras coisas: as palavras comuns nao podem bastar.
const longo = falado(Array.from({ length: 120 }, () => OUTRO).join(' '))
ok('audio longo de outras coisas: nao bate', motivo(alinharRoteiro(ROTEIRO, longo)) === 'nao-bate', motivo(alinharRoteiro(ROTEIRO, longo)))

// So 60% do roteiro foi narrado: o audio acaba antes, e diz o que falta.
const sessenta = palavras.slice(0, Math.round(palavras.length * 0.6)).join(' ')
const r60 = alinharRoteiro(ROTEIRO, falado(sessenta))
ok('60% narrado: acaba antes do roteiro', motivo(r60) === 'acaba-antes', motivo(r60))
ok('e conta quantas palavras faltam', 'falha' in r60 && r60.faltam === palavras.length - Math.round(palavras.length * 0.6), 'falha' in r60 ? String(r60.faltam) : '')
ok('e mostra o comeco do que falta', 'falha' in r60 && typeof r60.trecho === 'string' && r60.trecho.startsWith(palavras[Math.round(palavras.length * 0.6)]!), 'falha' in r60 ? r60.trecho : '')
// 50%: antes saia "o roteiro nao bate", o que era falso.
const metade = alinharRoteiro(ROTEIRO, falado(palavras.slice(0, Math.round(palavras.length / 2)).join(' ')))
ok('50% narrado: acaba antes (e nao "nao bate")', motivo(metade) === 'acaba-antes', motivo(metade))
// Comeco faltando.
const semComeco = alinharRoteiro(ROTEIRO, falado(palavras.slice(12).join(' ')))
ok('comeco nao narrado: comeca depois', motivo(semComeco) === 'comeca-depois', motivo(semComeco))
// Falta so a ultima frase curta (menos de 8 palavras): ainda casa, como sempre.
const quaseTudo = alinharRoteiro(ROTEIRO, falado(palavras.slice(0, palavras.length - 5).join(' ')))
ok('faltando 5 palavras no fim: ainda casa', motivo(quaseTudo) === 'casou', motivo(quaseTudo))

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
