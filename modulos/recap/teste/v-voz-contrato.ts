/**
 * O CONTRATO do passo 3 (Voz), sem provedor, sem audio e sem interface:
 *
 * 1. o rascunho v1 de verdade (Dr. Stone S4 - 37, roteiro v3 aprovado) abre
 *    como v2 com `voz: null` -- LIDO da fixture, nunca gravado;
 * 2. o texto que vai ao provedor (textoParaNarrar): faixas de caractere,
 *    palavras iguais as do tokenizeScript do Dangai, contagem;
 * 3. um take FALSO (tempos sinteticos conhecidos): conferirTake, schema,
 *    palavraNoTempo, fraseNoTempo, duracaoTotal;
 * 4. as transicoes: adicionar take, historico, escolher, aprovar, e o roteiro
 *    que muda depois da voz (mudadas, novas, removidas, ordem, so texto de
 *    tela), frasesParaRegravar, contexto, soMudaOPos, configPadrao.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-voz-contrato.ts
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tokenizeScript } from '../../../shared/align'
import {
  aplicarEdicao,
  lerRascunho,
  rascunhoDoRecapSchema,
  RASCUNHO_VERSAO,
  roteiroAtual,
  textoDoRoteiro,
  type RascunhoDoRecap,
  type Roteiro,
} from '../shared/roteiro'
import {
  adicionarTake,
  caracteresDasFrases,
  configDaVozSchema,
  configPadrao,
  conferirTake,
  contarCaracteres,
  contextoDaFrase,
  duracaoTotal,
  escolherTake,
  estadoDaVoz,
  estadoDaVozSchema,
  fraseNoTempo,
  frasesMudadas,
  frasesParaRegravar,
  hashDoTexto,
  marcarVozAprovada,
  palavraNoTempo,
  pedidoDeGeracaoSchema,
  podeIrParaCenas,
  proximoTakeId,
  situacaoDaVoz,
  soMudaOPos,
  takeAtual,
  takeDaVozSchema,
  textoDaEstimativa,
  textoParaNarrar,
  vozDesatualizada,
  type ConfigDaVoz,
  type PalavraComTempo,
  type TakeDaVoz,
  type TrechoDaFrase,
} from '../shared/voz'

let falhas = 0
function confere(ok: boolean, nome: string): void {
  console.log(`  ${ok ? 'ok ' : 'FALHOU'} ${nome}`)
  if (!ok) falhas++
}
function secao(nome: string): void {
  console.log(`\n== ${nome}`)
}
function lanca(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

// [recap] O rascunho do S4-37 vem da fixture (teste/fixture, tirada do
// rascunho real do Levi, roteiro v3 aprovado, sem voz): roda em qualquer maquina.
const EPISODIO_37 = 'ep_25d63d4babd6'

// ------------------------------------------------------------ 1. migracao
secao('1. Rascunho v1 de verdade abre como v2')
const arquivo = join(__dirname, 'fixture', 'rascunho-s4e37-17frases.json')
const antes = statSync(arquivo)
const cru = JSON.parse(readFileSync(arquivo, 'utf8')) as { versao: number; voz?: unknown; episodioId: string }
console.log(`  ${arquivo.split(/[\\/]/).pop()} (versao ${cru.versao} no disco)`)
confere(cru.episodioId.startsWith(EPISODIO_37), 'e o rascunho do S4 - 37')
const r0 = lerRascunho(cru)
confere(r0.versao === RASCUNHO_VERSAO && RASCUNHO_VERSAO === 3, 'leu como v3 (passo 4)')
confere(r0.voz === null && !('voz' in cru), 'sem voz no disco -> voz: null')
confere(r0.aprovado, 'roteiro aprovado')
const rot = roteiroAtual(r0)!
confere(rot !== null, `roteiro atual v${rot.versao}`)
const depois = statSync(arquivo)
confere(antes.mtimeMs === depois.mtimeMs && antes.size === depois.size, 'a fixture nao mudou')
confere(lanca(() => lerRascunho({ ...cru, versao: 4 })), 'versao 4 (futura) e recusada')

// ---------------------------------------------------- 2. texto para narrar
secao('2. Texto que vai ao provedor')
const narrar = textoParaNarrar(rot)
const nFrases = rot.secoes.reduce((n, s) => n + s.frases.length, 0)
const nPalavras = narrar.frases.reduce((n, f) => n + f.palavras.length, 0)
console.log(`  ${contarCaracteres(narrar.texto)} caracteres, ${narrar.frases.length} frases, ${nPalavras} palavras, ${rot.secoes.length} secoes`)
confere(narrar.frases.length === nFrases, 'uma por frase')
confere(narrar.frases.every((f) => narrar.texto.slice(f.de, f.ate) === f.texto), 'as faixas [de, ate) batem com o texto de cada frase')
const tokensDangai = tokenizeScript(textoDoRoteiro(rot))
confere(JSON.stringify(narrar.frases.flatMap((f) => f.palavras)) === JSON.stringify(tokensDangai), 'palavras = tokenizeScript do roteiro inteiro (o que a legenda mostra)')
confere(narrar.texto.split('\n\n').length === rot.secoes.length, 'secoes separadas por linha em branco')
confere(caracteresDasFrases(rot, narrar.frases.map((f) => f.fraseId)) + (narrar.texto.length - narrar.frases.reduce((n, f) => n + f.texto.length, 0)) === contarCaracteres(narrar.texto), 'caracteresDasFrases + separadores = total')
const ctx = contextoDaFrase(rot, narrar.frases[3]!.fraseId, 80)
console.log(`  contexto de ${narrar.frases[3]!.fraseId}: "${ctx.anterior.slice(0, 40)}..." | "${ctx.seguinte.slice(0, 40)}..."`)
confere(ctx.anterior.length <= 80 && ctx.seguinte.length <= 80 && ctx.anterior.length > 0 && ctx.seguinte.length > 0, 'contexto ate 80 caracteres de cada lado')
confere(narrar.texto.includes(ctx.anterior) && narrar.texto.includes(ctx.seguinte), 'contexto e trecho do texto (palavra inteira)')
confere(contextoDaFrase(rot, narrar.frases[0]!.fraseId).anterior === '', 'primeira frase: sem anterior')
confere(hashDoTexto('Mano,  o *Senku*  venceu.') === hashDoTexto('Mano, o Senku venceu.'), 'hash ignora espaco e grifo')
confere(hashDoTexto('Mano, o Senku venceu.') !== hashDoTexto('Mano, o Senku perdeu.'), 'hash muda com o texto')
confere(/^[0-9a-f]{16}$/.test(hashDoTexto('x')), 'hash de 16 hex')

// --------------------------------------------------------- 3. take falso
secao('3. Take falso (tempos sinteticos)')
/**
 * Cada palavra 0,30 s, 0,05 s entre palavras, 0,50 s entre frases, 0,80 s
 * entre secoes, 0,20 s antes da primeira e depois da ultima. Fronteira dos
 * trechos no meio da pausa.
 */
function takeFalso(roteiro: Pick<Roteiro, 'secoes'>, id: string, cfg: ConfigDaVoz, versao: number): TakeDaVoz {
  const { frases } = textoParaNarrar(roteiro)
  const fimDeSecao = new Set(roteiro.secoes.map((s) => s.frases[s.frases.length - 1]?.id))
  const palavras: PalavraComTempo[] = []
  const limites: { fraseId: string; ini: number; fim: number; pausaDepois: number }[] = []
  let t = 0.2
  for (const f of frases) {
    const ini = t
    for (const [i, p] of f.palavras.entries()) {
      if (i > 0) t += 0.05
      palavras.push({ texto: p, start: t, end: t + 0.3, fraseId: f.fraseId })
      t += 0.3
    }
    const pausa = fimDeSecao.has(f.fraseId) ? 0.8 : 0.5
    limites.push({ fraseId: f.fraseId, ini, fim: t, pausaDepois: pausa })
    t += pausa
  }
  const duracao = t - limites[limites.length - 1]!.pausaDepois + 0.2
  const trechos: TrechoDaFrase[] = limites.map((l, i) => {
    const offset = i === 0 ? 0 : limites[i - 1]!.fim + limites[i - 1]!.pausaDepois / 2
    const fim = i === limites.length - 1 ? duracao : l.fim + l.pausaDepois / 2
    const f = frases[i]!
    return { fraseId: l.fraseId, offset, duracao: fim - offset, hashTexto: f.hash, texto: f.texto }
  })
  const audio = { duracao, palavras, trechos }
  return takeDaVozSchema.parse({
    id,
    config: cfg,
    arquivo: `narracao-${'a'.repeat(15)}${id.slice(1)}.wav`,
    ...audio,
    bruto: { arquivo: `bruto-${'b'.repeat(15)}${id.slice(1)}.wav`, ...audio },
    origemDoAlinhamento: 'provedor',
    caracteres: contarCaracteres(textoParaNarrar(roteiro).texto),
    cobrados: 0,
    criadoEm: '2026-10-14T12:00:00.000Z',
    roteiroVersao: versao,
  })
}
const cfg = configPadrao({ provedor: 'elevenlabs', voiceId: 'Crm8VULvkVs5ZBDa1Ixm', modelId: '' })!
confere(cfg !== null && cfg.fonte === 'elevenlabs' && cfg.modelId === 'eleven_multilingual_v2', 'configPadrao: modelo vazio -> eleven_multilingual_v2')
confere(cfg.fonte === 'elevenlabs' && cfg.settings.stability === 0.32 && cfg.velocidade === 1 && cfg.cortarPausas, 'padroes do AniRecap (0.32/0.30), velocidade 1, corta pausas')
confere(configPadrao({ provedor: '', voiceId: '', modelId: '' }) === null, 'sem voz escolhida -> null')
const t1 = takeFalso(rot, 't1', cfg, rot.versao)
console.log(`  t1: ${t1.duracao.toFixed(2)} s, ${t1.palavras.length} palavras, ${t1.trechos.length} trechos`)
confere(conferirTake(t1).length === 0, `conferirTake vazio (${conferirTake(t1).join('; ')})`)
confere(Math.abs(duracaoTotal(t1.trechos) - t1.duracao) < 1e-9, 'duracaoTotal = duracao do arquivo')
const quebrado = { ...t1, trechos: t1.trechos.map((x, i) => (i === 2 ? { ...x, offset: x.offset + 0.1 } : x)) }
confere(conferirTake(quebrado).some((p) => p.includes('esperado')), 'buraco entre trechos e pego')
const foraDeOrdem = { ...t1, palavras: [t1.palavras[1]!, t1.palavras[0]!, ...t1.palavras.slice(2)] }
confere(conferirTake(foraDeOrdem).some((p) => p.includes('fora de ordem')), 'palavra fora de ordem e pega')
const p5 = t1.palavras[5]!
confere(palavraNoTempo(t1.palavras, p5.start + 0.01) === 5, 'palavraNoTempo dentro da palavra')
confere(palavraNoTempo(t1.palavras, p5.end + 0.02) === 5, 'na pausa, a ultima palavra fica acesa')
confere(palavraNoTempo(t1.palavras, 0.05) === -1, 'antes da primeira: -1')
confere(palavraNoTempo(t1.palavras, 1e6) === t1.palavras.length - 1, 'depois do fim: a ultima')
confere(fraseNoTempo(t1.trechos, t1.trechos[4]!.offset + 0.01) === t1.trechos[4]!.fraseId, 'fraseNoTempo')
confere(fraseNoTempo(t1.trechos, t1.duracao + 1) === null, 'fraseNoTempo fora do arquivo: null')
confere(lanca(() => takeDaVozSchema.parse({ ...t1, arquivo: '../segredo.wav' })), 'arquivo com caminho e recusado')
confere(lanca(() => configDaVozSchema.parse({ ...cfg, velocidade: 1.5 })), 'velocidade 1.5 recusada')
confere(lanca(() => configDaVozSchema.parse({ ...cfg, voiceId: 'a/b' })), 'voiceId com barra recusado')
const imp = configDaVozSchema.parse({ fonte: 'importado', velocidade: 1, cortarPausas: false, audio: { nome: 'levi.m4a', hash: 'c'.repeat(64) } })
confere(imp.fonte === 'importado' && imp.voiceId === '' && imp.modelId === '', 'config importado com voiceId/modelId vazios')
confere(lanca(() => pedidoDeGeracaoSchema.parse({ config: cfg, pedidoId: 'p1' })), 'gerar sem `confirmado` e recusado')

// ------------------------------------------------------- 4. transicoes
secao('4. Transicoes da voz no rascunho')
const agora = '2026-10-14T12:00:00.000Z'
let r: RascunhoDoRecap = adicionarTake(r0, t1, agora)
confere(estadoDaVoz(r).atual === 't1' && takeAtual(r)?.id === 't1', 't1 vira o atual')
confere(situacaoDaVoz(r, roteiroAtual(r)) === 'pronta', 'situacao pronta')
confere(!podeIrParaCenas(r, roteiroAtual(r)), 'sem aprovar a voz, Cenas desligado')
const relido = lerRascunho(JSON.parse(JSON.stringify(r)))
confere(JSON.stringify(relido) === JSON.stringify(r), 'rascunho com voz: ida e volta pelo zod sem perda')
r = marcarVozAprovada(r, roteiroAtual(r), agora)
confere(situacaoDaVoz(r, roteiroAtual(r)) === 'aprovada' && podeIrParaCenas(r, roteiroAtual(r)), 'aprovada -> Cenas liga')

const vel = { ...cfg, velocidade: 1.1 }
confere(soMudaOPos(cfg, vel), 'so a velocidade mudou: e ajuste (gratis)')
confere(!soMudaOPos(cfg, { ...cfg, voiceId: 'OutraVoz123' }), 'outra voz: gera de novo')
confere(soMudaOPos(cfg, JSON.parse(JSON.stringify({ settings: cfg.settings, cortarPausas: false, modelId: cfg.modelId, voiceId: cfg.voiceId, fonte: 'elevenlabs', velocidade: 1, velocidadeNativa: cfg.velocidadeNativa })) as ConfigDaVoz), 'ordem das chaves nao importa')
// A velocidade NATIVA muda o audio (15/10): trocar e gerar de novo, pago.
confere(cfg.velocidadeNativa === 1.2 && !soMudaOPos(cfg, { ...cfg, velocidadeNativa: 1 }), 'perfil sem o campo sai a 1,2; outra nativa gera de novo')

const t2 = { ...takeFalso(rot, proximoTakeId(estadoDaVoz(r)), vel, rot.versao), derivadoDe: 't1' }
confere(t2.id === 't2', 'proximoTakeId = t2')
const soHist = adicionarTake(r, t2, agora, true)
confere(estadoDaVoz(soHist).atual === 't1' && estadoDaVoz(soHist).aprovado, 'cancelado depois de pago: t2 so no historico, t1 segue aprovado')
r = adicionarTake(r, t2, agora)
confere(estadoDaVoz(r).atual === 't2' && !estadoDaVoz(r).aprovado, 'take novo desaprova')
r = escolherTake(r, 't1', agora)
confere(estadoDaVoz(r).atual === 't1', 'voltar para o t1')
confere(lanca(() => escolherTake(r, 't9', agora)), 'take inexistente: erro')
confere(lanca(() => estadoDaVozSchema.parse({ ...estadoDaVoz(r), atual: 't9' })), 'zod recusa atual inexistente')

// O roteiro muda depois da voz.
const ids = narrar.frases.map((f) => f.fraseId)
const alvo = ids[2]!
const editarFrase = (base: Roteiro, id: string, mudar: (texto: string) => string, campo: 'texto' | 'textoDeTela' = 'texto'): Roteiro => ({
  ...base,
  secoes: base.secoes.map((s) => ({
    ...s,
    frases: s.frases.map((f) => (f.id === id ? { ...f, [campo]: mudar(campo === 'texto' ? f.texto : (f.textoDeTela ?? '')) } : f)),
  })),
})
const soTela = editarFrase(rot, alvo, () => 'OUTRO', 'textoDeTela')
confere(!vozDesatualizada(frasesMudadas(soTela, t1)), 'mudar so o texto de tela nao desatualiza a voz')
const soEspaco = editarFrase(rot, alvo, (x) => `  ${x.replace(/ /g, '  ')} `)
confere(!vozDesatualizada(frasesMudadas(soEspaco, t1)), 'mudar so espacos nao desatualiza')
const editado = editarFrase(rot, alvo, (x) => x.replace(/\.$/, '') + ' de novo.')
const rEd = aplicarEdicao(r, editado, agora)
confere(!rEd.aprovado && rEd.atual !== r.atual, 'editar o roteiro cria versao nova e desaprova o roteiro (regra do passo 2)')
const m1 = frasesMudadas(roteiroAtual(rEd)!, t1)
confere(JSON.stringify(m1) === JSON.stringify({ mudadas: [alvo], novas: [], removidas: [], ordemMudou: false }), `so ${alvo} mudou`)
confere(situacaoDaVoz(rEd, roteiroAtual(rEd)) === 'desatualizada', 'voz desatualizada')
confere(lanca(() => marcarVozAprovada({ ...rEd, aprovado: true }, roteiroAtual(rEd), agora)), 'aprovar voz desatualizada: erro')
confere(lanca(() => marcarVozAprovada({ ...r, aprovado: false }, roteiroAtual(r), agora)), 'aprovar voz sem roteiro aprovado: erro')
confere(JSON.stringify(frasesParaRegravar(roteiroAtual(rEd)!, t1, [])) === JSON.stringify([alvo]), '"Atualizar a voz" = so a que mudou')
confere(JSON.stringify(frasesParaRegravar(roteiroAtual(rEd)!, t1, [ids[0]!, 'f99'])) === JSON.stringify([ids[0], alvo]), 'pedida + mudada, na ordem do roteiro; inexistente ignorada')
const custo = caracteresDasFrases(roteiroAtual(rEd)!, [alvo])
console.log(`  regravar ${alvo}: ${custo} caracteres`)
confere(custo > 0 && custo < 400, 'custo de uma frase na casa de ~80-200')

const semUma: Roteiro = { ...rot, secoes: rot.secoes.map((s) => ({ ...s, frases: s.frases.filter((f) => f.id !== ids[1]) })) }
const mRem = frasesMudadas(semUma, t1)
confere(JSON.stringify(mRem.removidas) === JSON.stringify([ids[1]]) && mRem.mudadas.length === 0 && !mRem.ordemMudou, 'frase removida')
const comNova: Roteiro = {
  ...rot,
  secoes: rot.secoes.map((s, i) => (i === 0 ? { ...s, frases: [...s.frases, { ...s.frases[0]!, id: 'f99', texto: 'Frase nova aqui.' }] } : s)),
}
const mNova = frasesMudadas(comNova, t1)
confere(JSON.stringify(mNova.novas) === JSON.stringify(['f99']), 'frase nova')
const s0 = rot.secoes[0]!
const trocada: Roteiro = { ...rot, secoes: [{ ...s0, frases: [...s0.frases].reverse() }, ...rot.secoes.slice(1)] }
confere(s0.frases.length < 2 || frasesMudadas(trocada, t1).ordemMudou, 'frases trocadas de ordem')

const est = { fonte: 'elevenlabs' as const, fraseIds: ids, caracteres: 1150, pagos: 1150, aCobrar: 1150, creditos: null, doCache: false, restam: 8850, limite: 10000, plano: 'payg', saldo: null, suficiente: true, aviso: null }
console.log(`  estimativa: "${textoDaEstimativa(est)}"`)
// Caractere e credito sao unidades diferentes: o "restam" e do plano (creditos).
confere(textoDaEstimativa(est) === '1.150 caracteres · ElevenLabs · restam 8.850 creditos', 'texto da estimativa')
confere(textoDaEstimativa({ ...est, creditos: 253 }) === '1.150 caracteres (~253 creditos) · ElevenLabs · restam 8.850 creditos', 'com a taxa aprendida da conta')
confere(textoDaEstimativa({ ...est, aCobrar: 0, pagos: 0, doCache: true }) === 'Ja gerado, sem custo', 'tudo no cache: sem custo')

// O rascunho com voz passa no schema do rascunho inteiro (o que o gravarRascunho exige).
confere(!lanca(() => rascunhoDoRecapSchema.parse(r)), 'rascunho com voz passa no rascunhoDoRecapSchema')

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
process.exitCode = falhas === 0 ? 0 : 1
