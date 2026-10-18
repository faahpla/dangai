/**
 * O1 (18/10): OS ATALHOS DO RECONHECER NA MAO (shared/atalhos.ts), sem janela.
 *
 * Com o foco num cartao: 1-9 escolhe a sugestao, Enter confirma (palpite
 * forte vira nome; sem ele, vai ao campo), I ignora/volta, J junta com o de
 * antes, setas andam (cima/baixo: uma linha da grade), letra comeca o nome,
 * "?" abre a lista. Ctrl/Alt nunca sao atalhos do cartao (Ctrl+Enter salva tudo).
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-reconhecer-teclado.ts
 */
import assert from 'node:assert/strict'
import { acaoDaTecla, aplicarAtalho, cartaoVizinho, LISTA_DE_ATALHOS, proximoSemNome, sugestoesDoGrupo } from '../shared/atalhos'
import { decisaoInicial, nomearGrupo, SIMILARIDADE_FORTE, type GrupoDeRostos } from '../shared/descoberta'

function grupo(key: number, extra: Partial<GrupoDeRostos> = {}): GrupoDeRostos {
  return { key, rostos: ['a', 'b', 'c'], totalDeRostos: 10, cenas: 5, sugestao: null, sugestoes: [], conhecido: false, figurante: false, ...extra }
}

// ------------------------------------------------------------------ 1. teclas
assert.deepEqual(acaoDaTecla({ key: '1' }), { tipo: 'sugestao', indice: 0 })
assert.deepEqual(acaoDaTecla({ key: '9' }), { tipo: 'sugestao', indice: 8 })
assert.equal(acaoDaTecla({ key: '0' }), null)
assert.deepEqual(acaoDaTecla({ key: 'Enter' }), { tipo: 'confirmar' })
assert.deepEqual(acaoDaTecla({ key: 'i' }), { tipo: 'ignorar' })
assert.deepEqual(acaoDaTecla({ key: 'I' }), { tipo: 'ignorar' })
assert.deepEqual(acaoDaTecla({ key: 'j' }), { tipo: 'juntar' })
assert.deepEqual(acaoDaTecla({ key: 'ArrowLeft' }), { tipo: 'andar', para: 'antes' })
assert.deepEqual(acaoDaTecla({ key: 'ArrowDown' }), { tipo: 'andar', para: 'abaixo' })
assert.deepEqual(acaoDaTecla({ key: ' ' }), { tipo: 'ampliar' })
assert.deepEqual(acaoDaTecla({ key: 'Tab' }), { tipo: 'campo' })
assert.deepEqual(acaoDaTecla({ key: '?' }), { tipo: 'ajuda' })
assert.deepEqual(acaoDaTecla({ key: 'R' }), { tipo: 'digitar' })
assert.deepEqual(acaoDaTecla({ key: 'é' }), { tipo: 'digitar' }, 'letra com acento comeca o nome')
assert.equal(acaoDaTecla({ key: '1', ctrlKey: true }), null)
assert.equal(acaoDaTecla({ key: 'Enter', ctrlKey: true }), null, 'Ctrl+Enter e o salvar tudo da tela')
assert.equal(acaoDaTecla({ key: 'j', altKey: true }), null)
assert.equal(acaoDaTecla({ key: 'F5' }), null)
assert.equal(acaoDaTecla({ key: '-' }), null)
console.log('teclas: ok')

// ------------------------------------------------------------------ 2. setas
const linha = [0, 1, 2, 3, 4, 5, 6]
assert.equal(cartaoVizinho(linha, 2, 'depois', 4), 3)
assert.equal(cartaoVizinho(linha, 2, 'antes', 4), 1)
assert.equal(cartaoVizinho(linha, 2, 'abaixo', 4), 6)
assert.equal(cartaoVizinho(linha, 5, 'acima', 4), 1)
assert.equal(cartaoVizinho(linha, 0, 'antes', 4), null)
assert.equal(cartaoVizinho(linha, 6, 'abaixo', 4), null)
assert.equal(cartaoVizinho(linha, 3, 'abaixo', 0), 4, 'grade sem colunas medidas anda de um em um')
assert.equal(cartaoVizinho(linha, 99, 'depois', 4), 0, 'cursor perdido volta ao primeiro')
console.log('setas: ok')

// ------------------------------------------------------------------ 3. sugestoes 1-9
const doze = Array.from({ length: 12 }, (_, i) => ({ nome: `N${i}`, similaridade: 0.9 - i / 100 }))
assert.equal(sugestoesDoGrupo(grupo(0, { sugestoes: doze })).length, 9)
assert.deepEqual(sugestoesDoGrupo(grupo(0, { sugestao: { nome: 'Elle', similaridade: 0.91 } })), [{ nome: 'Elle', similaridade: 0.91 }])
assert.deepEqual(sugestoesDoGrupo(grupo(0)), [])
console.log('sugestoes: ok')

// ------------------------------------------------------------------ 4. aplicar
const grupos = new Map<number, GrupoDeRostos>([
  [0, grupo(0, { conhecido: true, sugestao: { nome: 'Lent', similaridade: 0.99 } })],
  [1, grupo(1, { sugestoes: [{ nome: 'Misa', similaridade: 0.8 }, { nome: 'Guy', similaridade: 0.7 }] })],
  [2, grupo(2, { sugestao: { nome: 'Elle', similaridade: SIMILARIDADE_FORTE } })],
  [3, grupo(3, { sugestao: { nome: 'Guy', similaridade: SIMILARIDADE_FORTE - 0.05 } })],
  [4, grupo(4)],
])
const ordem = [0, 1, 2, 3, 4]
let d = decisaoInicial({ grupos: [...grupos.values()] })
assert.deepEqual(d.nomes, { '0': 'Lent' })

// "2" no grupo 1: Guy; o cursor vai ao proximo SEM nome (2).
let r = aplicarAtalho({ tipo: 'sugestao', indice: 1 }, d, grupos, ordem, 1)
assert.equal(r.decisao.nomes['1'], 'Guy')
assert.equal(r.proximo, 2)
assert.equal(r.campo, false)
d = r.decisao
// Numero sem sugestao: nada muda, o cursor fica.
r = aplicarAtalho({ tipo: 'sugestao', indice: 5 }, d, grupos, ordem, 1)
assert.equal(r.decisao, d)
assert.equal(r.proximo, null)
// Enter com palpite forte: vira o nome.
r = aplicarAtalho({ tipo: 'confirmar' }, d, grupos, ordem, 2)
assert.equal(r.decisao.nomes['2'], 'Elle')
assert.equal(r.proximo, 3)
d = r.decisao
// Enter com palpite fraco: vai ao campo (nunca inventa o nome).
r = aplicarAtalho({ tipo: 'confirmar' }, d, grupos, ordem, 3)
assert.equal(r.campo, true)
assert.equal(r.decisao, d)
// Enter num grupo ja com nome: so anda (ao proximo sem nome).
r = aplicarAtalho({ tipo: 'confirmar' }, d, grupos, ordem, 1)
assert.equal(r.decisao, d)
assert.equal(r.proximo, 3)
// I ignora e anda; I de novo volta a considerar e o cursor fica.
r = aplicarAtalho({ tipo: 'ignorar' }, d, grupos, ordem, 3)
assert.deepEqual(r.decisao.ignorados, [3])
assert.equal(r.proximo, 4)
r = aplicarAtalho({ tipo: 'ignorar' }, r.decisao, grupos, ordem, 3)
assert.deepEqual(r.decisao.ignorados, [])
assert.equal(r.proximo, null)
// J junta com o de antes; o nome dado depois vale para os dois.
r = aplicarAtalho({ tipo: 'juntar' }, d, grupos, ordem, 4)
assert.deepEqual(r.decisao.juntar, [[3, 4]])
const juntos = nomearGrupo(r.decisao, 4, 'Roger')
assert.equal(juntos.nomes['3'], 'Roger')
assert.equal(juntos.nomes['4'], 'Roger')
// J de novo (ja juntos) e J no primeiro cartao: nada.
assert.equal(aplicarAtalho({ tipo: 'juntar' }, r.decisao, grupos, ordem, 4).decisao, r.decisao)
assert.equal(aplicarAtalho({ tipo: 'juntar' }, d, grupos, ordem, 0).decisao, d)
// J com o de antes que ja tem nome: o conjunto fica com ele.
r = aplicarAtalho({ tipo: 'juntar' }, d, grupos, ordem, 3)
assert.deepEqual(r.decisao.juntar, [[2, 3]])
assert.equal(r.decisao.nomes['3'], 'Elle')
// Acoes da tela (andar, ampliar, ajuda) nao mexem na decisao; grupo que nao existe tambem nao.
assert.equal(aplicarAtalho({ tipo: 'andar', para: 'depois' }, d, grupos, ordem, 1).decisao, d)
assert.equal(aplicarAtalho({ tipo: 'ajuda' }, d, grupos, ordem, 1).decisao, d)
assert.equal(aplicarAtalho({ tipo: 'sugestao', indice: 0 }, d, grupos, ordem, 42).decisao, d)

// O proximo sem nome pula os nomeados e os ignorados; sem nenhum, o seguinte; no fim, null.
assert.equal(proximoSemNome(ordem, 0, { ...d, ignorados: [3] }), 4)
assert.equal(proximoSemNome([0, 1, 2], 0, d), 1)
assert.equal(proximoSemNome(ordem, 4, d), null)
console.log('aplicar: ok')

// ------------------------------------------------------------------ 5. a lista do "?"
assert.ok(LISTA_DE_ATALHOS.length >= 6)
for (const [tecla, oque] of LISTA_DE_ATALHOS) {
  assert.match(tecla, /^[\x20-\x7e]+$/, 'ASCII')
  assert.match(oque, /^[\x20-\x7e]+$/, 'ASCII')
  assert.ok(oque.split(' ').length <= 4, `pouco texto: "${oque}"`)
}
console.log('v-reconhecer-teclado: tudo ok')
