/**
 * RECONHECER NA MAO, so o contrato (shared/descoberta.ts): funcoes puras, sem
 * motor, sem IA e sem interface. O evento cru segue o formato exato do
 * motor/app/headless.py (discovery-ready). Nao escreve nada. Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-descoberta-contrato.ts
 */
import assert from 'node:assert/strict'
import {
  decisaoInicial, nomearGrupo, ignorarGrupo, juntarGrupos, separarGrupo, alternarRosto,
  resumoDaDecisao, paraOMotor, podeReconhecerNaMao, discoveryReadyDoMotorSchema, progressoDaDescoberta,
  grafiasDaDecisao, mudancasDaDecisao, textoDasMudancas, guardarDecisao, reaplicarDecisao, nomesDescartados,
  type GrupoDeRostos,
} from '../shared/descoberta'
import { erroNaTela } from '../electron/descoberta/erro'

// evento cru no formato exato do headless.py
const cru = {
  type: 'discovery-ready', episodeRoot: 'X:/b/Nia/S01E01', animeTitle: 'Nia Liston', season: 1, episode: 1,
  totalFaces: 900, online: true, roster: ['Nia Liston', 'Reni Umi'],
  groups: [
    { key: 0, faces: 300, shots: 80, minor: false, crops: ['metadata/discovery/g000_000.jpg','metadata/discovery/g000_001.jpg'], suggestedName: '', suggestedSim: 0, known: false },
    { key: 1, faces: 100, shots: 30, minor: false, crops: ['metadata/discovery/g001_000.jpg'], suggestedName: 'Reni Umi', suggestedSim: 0.97, known: true },
    { key: 2, faces: 20, shots: 3, minor: false, crops: ['a','b','c'], suggestedName: '', suggestedSim: 0, known: false },
    { key: 3, faces: 6, shots: 2, minor: true, crops: ['a'], suggestedName: '', suggestedSim: 0, known: false },
  ],
}
const ev = discoveryReadyDoMotorSchema.parse(cru)
const grupos: GrupoDeRostos[] = ev.groups.map((g) => ({
  key: g.key, rostos: g.crops.map((c) => 'http://x/' + c), totalDeRostos: g.faces, cenas: g.shots,
  sugestao: g.suggestedName ? { nome: g.suggestedName, similaridade: g.suggestedSim } : null,
  conhecido: g.known, figurante: g.minor,
}))
let d = decisaoInicial({ grupos })
assert.deepEqual(d.nomes, { '1': 'Reni Umi' })
// sem nome nenhum alem do conhecido: ok
assert.equal(resumoDaDecisao(grupos, d).erro, null)
d = nomearGrupo(d, 0, '  Nia   Liston ')
d = juntarGrupos(d, 2, 0) // 2 e o mesmo que 0
assert.deepEqual(d.juntar, [[0, 2]])
assert.equal(d.nomes['2'], 'Nia   Liston')
d = alternarRosto(d, 2, 1)
d = alternarRosto(d, 2, 9) // indice inexistente: filtrado no motor
let cmd = paraOMotor(grupos, d)
assert.deepEqual(cmd.names, { '0': 'Nia Liston', '1': 'Reni Umi', '2': 'Nia Liston' })
assert.deepEqual(cmd.removed, { '2': [1] })
let r = resumoDaDecisao(grupos, d)
assert.equal(r.personagens[0]!.nome, 'Nia Liston'); assert.equal(r.personagens[0]!.cenas, 83)
assert.deepEqual(r.semNome, []) // 3 e figurante
assert.deepEqual(r.ignorados, [3])
// ignorar o 2: o motor pula ele, mas o nome e o conjunto FICAM (desfazer devolve tudo)
d = ignorarGrupo(d, 2, true)
assert.deepEqual(d.juntar, [[0, 2]])
assert.equal(d.nomes['2'], 'Nia   Liston')
cmd = paraOMotor(grupos, d)
assert.deepEqual(cmd.names, { '0': 'Nia Liston', '1': 'Reni Umi' })
assert.deepEqual(cmd.removed, {})
const desfeito = ignorarGrupo(d, 2, false)
assert.deepEqual(paraOMotor(grupos, desfeito).names, { '0': 'Nia Liston', '1': 'Reni Umi', '2': 'Nia Liston' })
// nomear um irmao do conjunto nao tira o ignorar do outro
assert.deepEqual(nomearGrupo(d, 0, 'Nia Liston').ignorados, [2])
d = { ...d, juntar: [] }
// nomes iguais a menos de maiuscula unem na 1a grafia
d = nomearGrupo(d, 3, 'nia liston')
cmd = paraOMotor(grupos, d)
assert.equal(cmd.names['3'], 'Nia Liston')
// separar volta sem nome
d = juntarGrupos(d, 3, 1)
assert.equal(d.nomes['3'], 'Reni Umi')
d = separarGrupo(d, 3)
assert.equal(d.nomes['3'], undefined)
// decisao vazia lanca
assert.throws(() => paraOMotor(grupos, { nomes: {}, ignorados: [], juntar: [], removidos: {} }), /pelo menos um/)
// aviso de poucas cenas
const r2 = resumoDaDecisao(grupos, { nomes: { '3': 'Fulano' }, ignorados: [], juntar: [], removidos: {} })
assert.ok(r2.avisos[0]!.includes('Fulano: so 2 cenas'))
// oferta
const plano = (n: number) => ({ id: String(n), start: 0, end: 1, arquivo: 'a', keyframe: null, cueIds: [], falantes: [], personagens: [] as { nome: string; conf: number; fonte: 'ancut' }[] })
const corteFalhou = { status: 'falhou' as const, descoberta: 'sem-referencias' as const, mensagem: '' }
assert.deepEqual(podeReconhecerNaMao({ planos: [], biblioteca: { origem: 'studio', pasta: 'p' } }, corteFalhou).motivo, 'sem-referencias')
assert.equal(podeReconhecerNaMao({ planos: [plano(1)], biblioteca: { origem: 'studio', pasta: 'p' } }, null).motivo, 'sem-personagens')
assert.equal(podeReconhecerNaMao({ planos: [plano(1)], biblioteca: { origem: 'ancut', pasta: 'p' } }, null).pode, false)
assert.equal(podeReconhecerNaMao({ planos: [], biblioteca: { origem: 'studio', pasta: 'p' } }, { status: 'cortando', descoberta: null, mensagem: '' }).pode, false)
const comP = plano(1); comP.personagens.push({ nome: 'Nia', conf: 0.9, fonte: 'ancut' })
assert.equal(podeReconhecerNaMao({ planos: [comP], biblioteca: { origem: 'studio', pasta: 'p' } }, null).motivo, 'revisar')
assert.equal(progressoDaDescoberta('organizando', 1, false), 1)

// ------------------------------------------------- grafias (15/10, auditoria)
const elenco = ['Nia Liston', 'Neil Liston', 'Lynette Blanc', 'Reliared Silver']
const gr = grafiasDaDecisao(['Nia', 'Nia Liston', 'nia liston', 'Liston', 'Liston, Neil', 'lyn', 'Neil'], elenco)
assert.equal(gr.get('Nia'), 'Nia Liston') // curto contido em um nome dado
assert.equal(gr.get('nia liston'), 'Nia Liston') // caixa: a grafia do elenco
assert.equal(gr.get('Liston, Neil'), 'Neil Liston') // ordem e virgula
assert.equal(gr.get('Neil'), 'Neil Liston') // curto contido em um so
assert.equal(gr.get('Liston'), 'Liston') // cabe em dois: fica
assert.equal(gr.get('lyn'), 'lyn') // pedaco de palavra nao e a pessoa
const g2: GrupoDeRostos[] = [0, 1, 2].map((key) => ({
  key, rostos: ['a', 'b', 'c'], totalDeRostos: 30, cenas: 10, sugestao: null, conhecido: false, figurante: false,
}))
g2.push({ key: 3, rostos: ['a'], totalDeRostos: 9, cenas: 6, sugestao: { nome: 'Velho Nome', similaridade: 1 }, conhecido: true, figurante: false })
const dg = { nomes: { '0': 'Nia Liston', '1': 'Nia', '2': 'lyn', '3': 'Velho Nome' }, ignorados: [], juntar: [], removidos: {} }
const cg = paraOMotor(g2, dg, { elenco })
assert.deepEqual(cg.names, { '0': 'Nia Liston', '1': 'Nia Liston', '2': 'lyn', '3': 'Velho Nome' })
const rg = resumoDaDecisao(g2, dg, { elenco })
assert.equal(rg.personagens.find((p) => p.nome === 'Nia Liston')!.keys.length, 2)
// fora do elenco: so o "lyn" (o conhecido de outro episodio nao conta), com o palpite
assert.deepEqual(rg.foraDoElenco.map((f) => [f.nome, f.parece]), [['lyn', 'Lynette Blanc']])
assert.deepEqual(resumoDaDecisao(g2, dg).foraDoElenco, []) // sem elenco, qualquer nome vale

// ------------------------------------------------- mudancas e retomada
const pr = { grupos: g2 }
let dm = decisaoInicial(pr)
assert.equal(mudancasDaDecisao(pr, dm).total, 0)
dm = ignorarGrupo(dm, 0, true)
dm = juntarGrupos(dm, 2, 1)
dm = alternarRosto(dm, 1, 2)
assert.deepEqual(mudancasDaDecisao(pr, dm), { nomes: 0, ignorados: 1, juntas: 1, rostos: 1, total: 3 })
assert.equal(textoDasMudancas(mudancasDaDecisao(pr, dm)), '1 ignorado, 1 junta, 1 rosto tirado')
dm = nomearGrupo(dm, 1, 'Neil')
const guardada = guardarDecisao('ep_x', pr, dm)
// a rodada nova traz o grupo 2 diferente (mais cenas): so o resto volta
const g3 = g2.map((g) => (g.key === 2 ? { ...g, cenas: 11 } : g))
const volta = reaplicarDecisao(guardada, { grupos: g3 })
assert.deepEqual(volta.ignorados, [0])
assert.equal(volta.nomes['1'], 'Neil')
assert.equal(volta.nomes['2'], undefined)
assert.deepEqual(volta.juntar, [])
assert.deepEqual(volta.removidos, { '1': [2] })
assert.equal(volta.nomes['3'], 'Velho Nome') // o conhecido continua
assert.deepEqual(reaplicarDecisao(guardada, pr), dm)

// ------------------------------------------------- descartados
assert.deepEqual(nomesDescartados(['Nia', 'Bendelio', 'Liston, Neil'], ['Nia Liston', 'Neil Liston']), ['Bendelio'])

// ------------------------------------------------- erro do motor na tela
const morto = erroNaTela('O motor parou sem terminar (codigo 4294967295): Warning: You are sending unauthenticated requests to the HF Hub. Please set a HF_TOKEN | [Tempos] 1384 rostos → 53 grupos | Gerando e')
assert.equal(morto.curto, 'O motor fechou sem terminar. Tente de novo.')
assert.ok(morto.detalhe?.includes('HF_TOKEN'))
assert.ok(!/[^ -~]/.test(morto.detalhe ?? ''), 'detalhe em ASCII')
assert.equal(erroNaTela('O motor parou sem terminar (codigo 1): x | RuntimeError: CUDA out of memory. Tried').curto.startsWith('Faltou memoria na GPU'), true)
assert.equal(erroNaTela('O motor parou sem terminar (codigo 1): File x | KeyError: 7').curto, 'O motor fechou sem terminar (KeyError). Tente de novo.')
assert.equal(erroNaTela('O motor parou com erro: Nenhum grupo recebeu nome. Dê nome a pelo menos um.').curto, 'O motor parou: Nenhum grupo recebeu nome.')
assert.equal(erroNaTela('Os grupos expiraram.').curto, 'Os grupos expiraram.')
console.log('ok')
