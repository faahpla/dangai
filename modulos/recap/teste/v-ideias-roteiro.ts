/**
 * LOTE 1 DAS IDEIAS DO LEVI (17/10) no passo 2, SEM gastar cota nem dinheiro:
 * a IA e trocada por uma falsa (trocarIaParaTeste) que conta as chamadas e
 * guarda os prompts.
 *
 * Cobre:
 * - MEU ESTILO: nomes dos exemplos mascarados (e o teste que prova que um nome
 *   de exemplo nao chega no prompt), o teto de tokens cortando os mais antigos,
 *   sem estilo = o prompt de sempre, e o "aprender com as minhas edicoes"
 *   (sem duplicata, so os N mais recentes, so quando ele editou);
 * - REVISOR: a revisao gravada no rascunho, "Aplicar todas" como versao nova
 *   com os mesmos ids e vinculos, "Ignorar", a cota que acaba (a revisao e
 *   pulada sem lancar) e o revisor desligado;
 * - ESCRITOR PAGO: a pergunta de custo ANTES de pagar (nenhuma chamada sem o
 *   sim), o teto respeitado, o modelo e o provedor forcados so na escrita, o
 *   cache (o mesmo pedido nunca paga duas vezes) e o "sem chave" que nao quebra.
 *
 * Usa a fixture do S4-37 (indice e rascunho), copiada para o temp. Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-ideias-roteiro.ts
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { z } from 'zod'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { escolherProvedor, gerarJson, type PedidoJson, type RespostaJson } from '../../../electron/services/llm'
import { configureSettings, getSettings, saveSettings, type Cofre } from '../../../electron/services/settings'
import { guardarContexto } from '../electron/contexto'
import { configurarEpisodios } from '../electron/episodio/indice'
import { lerEstilo, salvarEstilo, aprenderDoAprovado } from '../electron/gerar/estilo'
import { trocarIaParaTeste } from '../electron/gerar/ia'
import { promptDoRoteiro } from '../electron/gerar/prompts'
import { aprovarRoteiro, escolherVersao, lerRascunhoDoDisco, pastaDosRascunhos } from '../electron/gerar/rascunho'
import { aplicarRevisao, ignorarRevisao, revisarRoteiro } from '../electron/gerar/revisor'
import { gerarRoteiro } from '../electron/gerar/roteiro'
import { elencoDoEpisodio, nomesDoElenco } from '../electron/gerar/nomes'
import { lerIndice, type EpisodeIndex } from '../shared/episodio'
import { CONFIG_PADRAO, coerceConfig, type ConfigDoRecap } from '../shared/config'
import {
  aprenderExemplo,
  blocoDoEstilo,
  coerceEstilo,
  ESTILO_VAZIO,
  exemplosParaPrompt,
  mascararNomes,
  nomesNosTextos,
  TETO_DE_TOKENS_DOS_EXEMPLOS,
  type EstiloDoRecap,
  type ExemploDeEstilo,
} from '../shared/estilo'
import { ehPerguntaDeCusto, MODELO_CLAUDE_ESCRITOR, textoDoCusto } from '../shared/escritor'
import { marcasNaTela, revisaoDaVersao, type RevisaoDaIa } from '../shared/revisao'
import {
  ehParadaNoReserva,
  roteiroAtual,
  textoDoRoteiro,
  type RoteiroDaIa,
  type RoteiroGerado,
  type RoteiroPronto,
} from '../shared/roteiro'

const FIXTURE = join(__dirname, 'fixture')
const BIBLIOTECA = mkdtempSync(join(tmpdir(), 'recap-v-ideias-bib-'))
const DADOS = mkdtempSync(join(tmpdir(), 'recap-v-ideias-dados-'))
const ID_37 = 'ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067'
const RC = 'rc_25d63d4babd6_mv78ssvg'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
function secao(titulo: string): void {
  console.log(`\n== ${titulo}`)
}
const nada = (): void => {}
function pronto(r: RoteiroGerado): RoteiroPronto {
  if (ehParadaNoReserva(r) || ehPerguntaDeCusto(r)) throw new Error(`parou: ${r.motivo}`)
  return r
}

// ------------------------------------------------------------------ config e contexto falsos

let configDoModulo: ConfigDoRecap = { ...CONFIG_PADRAO, biblioteca: BIBLIOTECA }
function contextoFalso(): ContextoDoModulo {
  return {
    id: 'recap',
    config: () => ({ libraryDir: '', iaProvedor: 'gemini', whisperModel: 'small', modulo: configDoModulo }),
    ligado: () => true,
    pasta: (tipo: string) => (tipo === 'dados' ? DADOS : tmpdir()),
    ia: {
      gerarJson,
      provedor: (forcado?: 'gemini' | 'anthropic') => escolherProvedor(getSettings(), forcado),
      modelo: (p: 'gemini' | 'anthropic') => (p === 'gemini' ? getSettings().geminiModelo : getSettings().anthropicModelo),
    },
  } as unknown as ContextoDoModulo
}

// ------------------------------------------------------------------ IA falsa

interface Chamada {
  etapa: string
  prompt: string
  provedor: string | undefined
  modelo: string | undefined
}
const chamadas: Chamada[] = []
let falhar: string | null = null
let reservaNaRevisao = false
let ganchoN = 0
let indice37: EpisodeIndex
/** A resposta do revisor da proxima chamada. */
let revisaoFalsa: RevisaoDaIa = { frases: [] }

/** Um roteiro de IA a partir da v3 da fixture (frases que o passo ja aceitou), com o gancho trocado. */
function roteiroFalso(): RoteiroDaIa {
  const v3 = roteiroAtual(lerRascunhoDoDisco(RC)) ?? null
  ganchoN += 1
  const base = v3!.secoes
  return {
    secoes: base.map((s, i) => ({
      papel: s.papel,
      frases: s.frases.map((f, j) => ({
        texto: i === 0 && j === 0 ? `Imagina ${ganchoN} coisa unica que ninguem viu antes nesse episodio.` : f.texto,
        eventoIds: f.eventoIds,
        cueDoMomento: f.cueDoMomento,
        intencaoVisual: f.intencaoVisual || 'close no Senku',
        textoDeTela: f.textoDeTela,
        citacaoCueId: f.citacaoCueId,
        tags: f.tags ?? [],
        visualEn: f.visualEn ?? '',
      })),
    })),
  }
}

async function iaFalsa<S extends z.ZodType>(pedido: PedidoJson<S>): Promise<RespostaJson<z.infer<S>>> {
  chamadas.push({ etapa: pedido.etapa, prompt: pedido.prompt, provedor: pedido.provedor, modelo: pedido.modelo })
  if (falhar && pedido.etapa === 'revisao') {
    const nota = falhar
    falhar = null
    return { ok: false, nota, bruto: 'Gemini 429 RESOURCE_EXHAUSTED: quota', provedor: 'gemini' }
  }
  if (reservaNaRevisao && pedido.etapa === 'revisao') {
    reservaNaRevisao = false
    return { ok: false, motivo: 'so-reserva', nota: 'So o reserva', bruto: '', provedor: 'gemini', reserva: 'gemini-falso-lite', renovaEm: Date.now() + 3_600_000, porCota: true }
  }
  let valor: unknown
  if (pedido.etapa === 'roteiro') valor = roteiroFalso()
  else if (pedido.etapa === 'revisao') valor = revisaoFalsa
  else throw new Error(`etapa inesperada: ${pedido.etapa}`)
  const conferido = pedido.schema.safeParse(valor)
  if (!conferido.success) throw new Error(`resposta falsa fora do schema (${pedido.etapa})`)
  const modelo = pedido.modelo ?? 'gemini-falso'
  return { ok: true, valor: conferido.data, provedor: pedido.provedor ?? 'gemini', modelo }
}
const contar = (etapa?: string): number => chamadas.filter((c) => !etapa || c.etapa === etapa).length

// ------------------------------------------------------------------ exemplos

function exemplo(nome: string, texto: string, criadoEm: string, origem: ExemploDeEstilo['origem'] = 'meu'): ExemploDeEstilo {
  return { id: `x${nome.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)}`, nome, texto, origem, criadoEm }
}

/** Um roteiro de outra serie (Witch Hat Atelier): os nomes NAO podem chegar no prompt do S4-37. */
const DA_OUTRA_SERIE =
  'Coco descobriu que desenhar magia e proibido. Imagina isso. Aí a Coco foi parar no ateliê do Qifrey, e o pior: a Agathe odiou ela de cara. ' +
  'Olha só, o Brushbuddy apareceu de novo. Só que ninguém esperava o que veio depois. E agora?'

async function principal(): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'anirecap-v-ideias-'))
  const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
  configureSettings(userData, cofreFalso)
  saveSettings({ libraryDir: '', geminiApiKey: 'chave-falsa-do-teste', iaProvedor: 'gemini', geminiModelo: '', anthropicApiKey: '' })
  guardarContexto(contextoFalso())
  configurarEpisodios(userData)
  mkdirSync(join(BIBLIOTECA, '_indices', ID_37), { recursive: true })
  copyFileSync(join(FIXTURE, 'indice-s4e37.json'), join(BIBLIOTECA, '_indices', ID_37, 'episodio.json'))
  mkdirSync(pastaDosRascunhos(), { recursive: true })
  copyFileSync(join(FIXTURE, 'rascunho-s4e37.json'), join(pastaDosRascunhos(), `${RC}.json`))
  indice37 = lerIndice(JSON.parse(readFileSync(join(BIBLIOTECA, '_indices', ID_37, 'episodio.json'), 'utf8')))
  const elenco = elencoDoEpisodio(indice37)
  const desfazer = trocarIaParaTeste(iaFalsa)

  try {
    secao('1. Mascarar nomes')
    const nomes = nomesNosTextos([DA_OUTRA_SERIE])
    confere(['coco', 'qifrey', 'agathe', 'brushbuddy'].every((n) => nomes.has(n)) && !nomes.has('imagina') && !nomes.has('olha'), `nomes achados: ${[...nomes].join(', ')}`)
    const mascarado = mascararNomes(DA_OUTRA_SERIE, nomes)
    confere(!/Coco|Qifrey|Agathe|Brushbuddy/.test(mascarado), 'nenhum nome sobra (nem o do comeco da frase, "Coco descobriu")')
    confere(mascarado.startsWith('[PERSONAGEM 1] descobriu') && mascarado.includes('a [PERSONAGEM 1] foi parar'), 'o mesmo nome, o mesmo numero')
    confere(/Imagina isso\. Aí a/.test(mascarado) && mascarado.includes('Olha só') && mascarado.includes('E agora?'), 'o estilo fica (Imagina, Olha so, E agora?)')
    const comElenco = mascararNomes('Senku riu. Xeno tambem.', nomesNosTextos(['Senku riu. Xeno tambem.'], nomesDoElenco(elenco)))
    confere(comElenco === '[PERSONAGEM 1] riu. [PERSONAGEM 2] tambem.', `nome do elenco do episodio no comeco da frase tambem sai: "${comElenco}"`)
    confere(mascararNomes('Chamou o Dr. Xeno agora.', nomesNosTextos(['Chamou o Dr. Xeno agora.'])) === 'Chamou o [PERSONAGEM 1] agora.', '"Dr. Xeno" vira uma mascara so')

    secao('2. O bloco do estilo no prompt (a trava do vazamento)')
    const estilo1: EstiloDoRecap = {
      ...ESTILO_VAZIO,
      instrucoes: 'Tom de amigo contando. Abre no meio da treta. Fecha com pergunta.',
      exemplos: [exemplo('Witch Hat', DA_OUTRA_SERIE, '2026-10-10T00:00:00.000Z')],
    }
    const bloco = blocoDoEstilo(estilo1, nomesDoElenco(elenco))!
    confere(bloco.includes('TOM, RITMO e ESTRUTURA') && bloco.includes('NUNCA copie') && bloco.includes('Nunca escreva "[PERSONAGEM n]"'), 'o bloco diz: referencia de tom, nunca fatos nem nomes')
    salvarEstilo(estilo1)
    const g1 = pronto(await gerarRoteiro(RC, { alvoSec: 60 }, nada))
    const promptComEstilo = chamadas.filter((c) => c.etapa === 'roteiro').at(-1)!.prompt
    confere(promptComEstilo.includes('ESTILO DO EDITOR') && promptComEstilo.includes('INSTRUÇÕES DELE: Tom de amigo'), 'o prompt do roteiro leva o estilo')
    confere(!/Coco|Qifrey|Agathe|Brushbuddy/.test(promptComEstilo), 'NENHUM nome do exemplo chega no prompt do roteiro')
    confere(g1.roteiro.versao === 9 && g1.escritor === undefined, `versao nova v${g1.roteiro.versao}, escrita pelo gratis`)
    // Sem estilo: o prompt de sempre, byte a byte (e o cache de antes continua valendo).
    const r = lerRascunhoDoDisco(RC)
    const base = { indice: indice37, eventos: r.eventos, alvoSec: 60 as const, elenco }
    confere(promptDoRoteiro(base) === promptDoRoteiro({ ...base, estilo: null }) && !promptDoRoteiro(base).includes('ESTILO'), 'sem estilo: prompt identico ao de antes')
    confere(blocoDoEstilo(ESTILO_VAZIO) === null, 'estilo vazio nao gera bloco')

    secao('3. Teto de tokens')
    const grande = (n: number): string => Array.from({ length: n }, (_, i) => `Frase ${i} do roteiro com umas palavras a mais pra pesar.`).join(' ')
    const cheio: EstiloDoRecap = {
      ...ESTILO_VAZIO,
      exemplos: Array.from({ length: 6 }, (_, i) => exemplo(`Ex ${i}`, grande(70), `2026-10-0${i + 1}T00:00:00.000Z`)),
    }
    const ex = exemplosParaPrompt(cheio)
    confere(ex.tokens <= TETO_DE_TOKENS_DOS_EXEMPLOS && ex.textos.length >= 1 && ex.cortados.length >= 1, `dentro do teto: ${ex.textos.length} entram (~${ex.tokens} tokens), ${ex.cortados.length} de fora`)
    confere(ex.textos[0]!.id === 'xex5' && ex.cortados.includes('xex0'), 'os mais antigos saem primeiro')
    const um = exemplosParaPrompt({ ...ESTILO_VAZIO, exemplos: [exemplo('Gigante', grande(600), '2026-10-01T00:00:00.000Z')] })
    confere(um.textos.length === 1 && um.tokens <= TETO_DE_TOKENS_DOS_EXEMPLOS && um.textos[0]!.texto.endsWith('.'), `um exemplo maior que o teto vai cortado no fim de uma frase (~${um.tokens} tokens)`)
    confere(coerceEstilo({ exemplos: Array.from({ length: 14 }, (_, i) => exemplo(`E${i}`, 'Oi.', '2026-10-01T00:00:00.000Z')) }).exemplos.length === 10, 'no maximo 10 exemplos dele')

    secao('4. Aprender com as minhas edicoes')
    const ligado: EstiloDoRecap = { ...ESTILO_VAZIO, aprender: true, aprendidosMax: 3 }
    const quando = (d: number): string => `2026-10-1${d}T00:00:00.000Z`
    let e = aprenderExemplo(ligado, { texto: 'Roteiro um editado por ele.', nome: 'A', rascunhoId: 'rc_a', agoraIso: quando(1) })
    confere(e.exemplos.length === 1 && e.exemplos[0]!.origem === 'aprendido', 'aprovado editado vira exemplo')
    e = aprenderExemplo(e, { texto: 'Roteiro um editado de novo, outra forma.', nome: 'A', rascunhoId: 'rc_a', agoraIso: quando(2) })
    confere(e.exemplos.length === 1 && e.exemplos[0]!.texto.includes('outra forma'), 'o mesmo rascunho aprovado de novo TROCA o dele (sem duplicata)')
    const igual = aprenderExemplo(e, { texto: 'Roteiro um editado de novo, outra forma.', nome: 'B', rascunhoId: 'rc_b', agoraIso: quando(3) })
    confere(igual.exemplos.length === 1, 'texto igual de outro rascunho nao duplica')
    for (const [i, id] of ['rc_c', 'rc_d', 'rc_e'].entries()) e = aprenderExemplo(e, { texto: `Texto diferente numero ${i} sobre outra coisa.`, nome: id, rascunhoId: id, agoraIso: quando(4 + i) })
    confere(e.exemplos.length === 3 && !e.exemplos.some((x) => x.rascunhoId === 'rc_a'), 'so os 3 mais recentes (o mais velho saiu)')
    confere(aprenderExemplo(ESTILO_VAZIO, { texto: 'x', nome: 'x', rascunhoId: 'rc_x', agoraIso: quando(1) }) === ESTILO_VAZIO, 'desligado: nada muda')
    // De ponta a ponta: aprovar a versao da IA sem mexer nao aprende; editada, aprende.
    salvarEstilo({ ...estilo1, aprender: true })
    const v9 = roteiroAtual(lerRascunhoDoDisco(RC))!
    await aprovarRoteiro(RC, v9)
    confere(lerEstilo().exemplos.filter((x) => x.origem === 'aprendido').length === 0, 'aprovar a versao da IA sem editar: nada aprendido')
    const editada = { ...v9, secoes: v9.secoes.map((s, i) => (i === 0 ? { ...s, frases: s.frases.map((f, j) => (j === 0 ? { ...f, texto: 'Mano, o Senku mudou tudo de vez.' } : f)) } : s)) }
    const aprovado = await aprovarRoteiro(RC, editada)
    const aprendidos = lerEstilo().exemplos.filter((x) => x.origem === 'aprendido')
    confere(aprendidos.length === 1 && aprendidos[0]!.rascunhoId === RC && aprendidos[0]!.texto === textoDoRoteiro(roteiroAtual(aprovado)!), 'aprovar depois de editar: o texto aprovado vira exemplo')
    confere(!aprenderDoAprovado(aprovado) && lerEstilo().exemplos.filter((x) => x.origem === 'aprendido').length === 1, 'aprovar de novo o mesmo: sem duplicata')
    salvarEstilo(ESTILO_VAZIO)

    secao('5. Revisor: revisar, aplicar todas (versao nova, mesmos ids), ignorar')
    await escolherVersao(RC, 9)
    const v = roteiroAtual(lerRascunhoDoDisco(RC))!
    const f = v.secoes.flatMap((s) => s.frases)
    revisaoFalsa = {
      frases: [
        { fraseId: f[1]!.id, problema: 'sem-prova', motivo: 'As falas nao dizem isso.', sugestao: 'O Senku so cogita esse plano.' },
        { fraseId: `[${f[2]!.id}]`, problema: 'confusa', motivo: 'Ele quem?', sugestao: null },
        { fraseId: f[3]!.id, problema: null, motivo: '', sugestao: null },
        { fraseId: 'f99', problema: 'fraca', motivo: 'nao existe', sugestao: 'x' },
      ],
    }
    const antes = contar('revisao')
    const feita = await revisarRoteiro(RC, true)
    confere(feita.pulada === null && contar('revisao') - antes === 1, 'uma chamada de revisao, no provedor padrao')
    const rv = feita.pulada === null ? feita.revisao : null
    confere(rv !== null && rv.versao === v.versao && rv.itens.length === 2 && rv.itens[0]!.problema === 'sem-prova', 'so frase que existe, sem marca nula, a grave primeiro')
    confere(chamadas.at(-1)!.provedor === undefined && chamadas.at(-1)!.prompt.includes(`${f[1]!.id}: `), 'o prompt traz o roteiro com os ids')
    const r5 = lerRascunhoDoDisco(RC)
    confere(r5.revisoes.length === 1 && marcasNaTela(revisaoDaVersao(r5, v.versao), v).length === 2, 'gravada no rascunho; 2 marcas na tela')
    const depois = aplicarRevisao(RC)
    const nova = roteiroAtual(depois)!
    const fn = nova.secoes.flatMap((s) => s.frases)
    confere(nova.versao > v.versao && nova.revisada === true && nova.origem === 'ia' && nova.derivadoDe === v.versao && !depois.aprovado, `"Aplicar todas" = versao nova v${nova.versao} (revisada, derivada da v${v.versao}), desaprovada`)
    confere(
      fn.length === f.length && fn.every((x, i) => x.id === f[i]!.id && JSON.stringify(x.eventoIds) === JSON.stringify(f[i]!.eventoIds) && x.cueDoMomento === f[i]!.cueDoMomento),
      'mesmos ids, eventos e momentos em todas as frases',
    )
    confere(fn[1]!.texto === 'O Senku so cogita esse plano.' && fn[2]!.texto === f[2]!.texto, 'so a frase com sugestao trocou')
    confere(depois.roteiros.some((x) => x.versao === v.versao), 'a versao anterior fica em Versoes')
    const marcasDepois = marcasNaTela(revisaoDaVersao(depois, nova.versao), nova)
    confere(marcasDepois.length === 1 && marcasDepois[0]!.fraseId === f[2]!.id, 'na versao nova so sobra a marca sem sugestao')
    const ignorado = ignorarRevisao(RC, [f[2]!.id])
    confere(marcasNaTela(revisaoDaVersao(ignorado, nova.versao), nova).length === 0, '"Ignorar" tira a marca')

    secao('6. Cota acabou: a revisao e pulada, sem travar')
    falhar = 'A cota gratis do Gemini acabou por hoje.'
    const semCota = await revisarRoteiro(RC, true)
    confere(semCota.pulada === 'falhou' && /cota/.test(semCota.nota), `pulada com a nota ("${semCota.pulada !== null ? semCota.nota : ''}")`)
    reservaNaRevisao = true
    const soReserva = await revisarRoteiro(RC, true)
    confere(soReserva.pulada === 'falhou', 'so o reserva livre: pulada (nao revisa com o lite)')
    confere(lerRascunhoDoDisco(RC).revisoes.length === 1, 'nada gravado quando pula')
    configDoModulo = { ...configDoModulo, revisarAoGerar: false }
    const n6 = contar('revisao')
    const desligada = await revisarRoteiro(RC, true)
    confere(desligada.pulada === 'desligada' && contar('revisao') === n6, 'revisor desligado: a automatica nem chama a IA')
    confere((await revisarRoteiro(RC, false)).pulada === null && contar('revisao') === n6 + 1, 'o "Revisar" na mao chama mesmo desligado')
    configDoModulo = { ...configDoModulo, revisarAoGerar: true }

    secao('7. Escritor pago: a pergunta de custo antes de pagar')
    configDoModulo = coerceConfig({ ...configDoModulo, escritor: 'claude' })
    const semChave = pronto(await gerarRoteiro(RC, { alvoSec: 60 }, nada))
    confere(semChave.escritor === undefined && semChave.avisos.some((a) => /sem chave/.test(a)) && chamadas.at(-1)!.provedor === undefined, 'sem a chave da Anthropic: escreve o gratis, com aviso (nao quebra)')
    saveSettings({ anthropicApiKey: 'sk-ant-falsa-do-teste' })
    const n7 = contar()
    const pergunta = await gerarRoteiro(RC, { alvoSec: 60 }, nada)
    confere(ehPerguntaDeCusto(pergunta) && contar() === n7, 'sem o sim: volta a pergunta e NENHUMA chamada')
    const est = ehPerguntaDeCusto(pergunta) ? pergunta.estimativa : null
    confere(est !== null && est.usd > 0.01 && est.usd < 0.2 && est.usdMaximo === est.usd * 2 && est.modelo === MODELO_CLAUDE_ESCRITOR, `~${est ? textoDoCusto(est.usd) : '?'} (${est?.tokensDeEntrada} + ${est?.tokensDeSaida} tokens), teto 2 chamadas`)
    const versoesAntes = lerRascunhoDoDisco(RC).roteiros.length
    confere(lerRascunhoDoDisco(RC).roteiros.length === versoesAntes, 'nada gravado antes do sim')
    const baixo = await gerarRoteiro(RC, { alvoSec: 60, custoAceito: est!.usd / 2 }, nada)
    confere(ehPerguntaDeCusto(baixo) && contar() === n7, 'teto aceito menor que a conta: pergunta de novo, sem chamar')
    const pago = pronto(await gerarRoteiro(RC, { alvoSec: 60, custoAceito: est!.usdMaximo }, nada))
    const pagas = chamadas.slice(n7)
    confere(pago.escritor === 'Claude Sonnet' && pagas.length >= 1 && pagas.length <= 2 && pagas.every((c) => c.etapa === 'roteiro' && c.provedor === 'anthropic' && c.modelo === MODELO_CLAUDE_ESCRITOR), `com o sim: ${pagas.length} chamada(s) so de escrita, no Claude (${MODELO_CLAUDE_ESCRITOR})`)
    confere(pago.roteiro.modelo === MODELO_CLAUDE_ESCRITOR, 'a versao registra quem escreveu')
    // O mesmo pedido de novo: o prompt da primeira chamada paga, no cache -> de graca, sem pergunta.
    const prompt1 = pagas[0]!.prompt
    const n7b = contar()
    const { estaNoCache } = await import('../electron/gerar/ia')
    confere(estaNoCache({ schema: (await import('../shared/roteiro')).roteiroDaIaSchema, sistema: (await import('../electron/gerar/prompts')).SISTEMA_ROTEIRO, prompt: prompt1, etapa: 'roteiro', provedor: 'anthropic', modelo: MODELO_CLAUDE_ESCRITOR }), 'a resposta paga ficou no cache (por hash do pedido)')
    confere(contar() === n7b, 'conferir o cache nao chama nada')
    configDoModulo = coerceConfig({ ...configDoModulo, escritor: 'gemini' })
    const gratis = pronto(await gerarRoteiro(RC, { alvoSec: 60 }, nada))
    confere(gratis.escritor === undefined && chamadas.at(-1)!.provedor === undefined, 'de volta ao gratis: sem forcar provedor nem modelo')
    confere(existsSync(join(DADOS, 'estilo.json')), 'o estilo mora na pasta de dados do modulo')
  } finally {
    desfazer()
    rmSync(userData, { recursive: true, force: true })
    rmSync(BIBLIOTECA, { recursive: true, force: true })
    rmSync(DADOS, { recursive: true, force: true })
  }
  console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
  process.exit(falhas === 0 ? 0 : 1)
}

void principal()
