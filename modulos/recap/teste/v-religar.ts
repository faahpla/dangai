/**
 * O MODO TEXTO e o "USAR MEU ROTEIRO" do passo 2 (religarRoteiro), sem gastar
 * cota: a IA e trocada por uma falsa (trocarIaParaTeste) que conta as chamadas.
 *
 * Roda numa COPIA do rascunho do S4-37 (roteiro v3 aprovado) dentro de um
 * perfil temporario, com o indice dele; os dois vem da FIXTURE (teste/fixture,
 * tirada dos dados reais do Levi, sem caminho pessoal) e o teste confere no
 * fim que a fixture nao mudou. Cobre:
 * - as funcoes puras (texto normalizado, precisaReligar, aplicarReligacao);
 * - editar 2 frases e acrescentar 1: as outras 14 ficam IGUAIS (id e
 *   vinculos), a pouco mudada mantem id e evento, a muito mudada e a nova
 *   ganham id livre e sao ligadas numa chamada so; versao 'editado' nova,
 *   desaprovada; as escolhas de cena das mantidas seguem, a da removida sai;
 * - texto igual nao chama nada; o cache serve a mesma religacao de graca;
 * - falha da IA e parada no reserva: o texto ja esta gravado, as frases ficam
 *   por ligar e a proxima religacao completa (sem versao nova);
 * - Cancelar: a resposta que chega depois nao entra;
 * - "Usar meu roteiro": versao nova com tudo novo (s1.. gancho/.../fechamento),
 *   colar de novo nao duplica; num rascunho sem eventos, eles vem antes;
 * - a vez dividida com o gerarRoteiro (um pedido por rascunho).
 *
 * [recap] Portado do Studio. O indice do S4-37 e COPIADO da fixture para uma
 * biblioteca temporaria (a do modulo no teste), e o rascunho para o perfil
 * temporario: nada depende dos dados reais. As escolhas de cena (parte 3)
 * sao as do Studio: as mantidas seguem e a barrinha cabe no texto novo.
 *
 * Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-religar.ts
 */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { guardarContexto } from '../electron/contexto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { z } from 'zod'
import { lerIndice, type EpisodeIndex } from '../shared/episodio'
import {
  aplicarReligacao,
  cuesDoEvento,
  cuesElegiveis,
  ehParadaNoReserva,
  frasesParaReligar,
  mesmoTextoDoRoteiro,
  normalizarTextoDoRoteiro,
  precisaReligar,
  redividirRoteiro,
  roteiroAtual,
  textoDoRoteiro,
  validarRoteiro,
  type EventosDaIa,
  type Frase,
  type RascunhoDoRecap,
  type ReligacaoDaIa,
  type Roteiro,
  type RoteiroReligado,
  type RoteiroReligadoPronto,
} from '../shared/roteiro'
import { hashDoTexto } from '../shared/voz'
import { candidatoDosPlanos, CENAS_VAZIAS, type EscolhaDaFrase, type EstadoDasCenas } from '../shared/cenas'
import { escolherProvedor, gerarJson, type PedidoJson, type RespostaJson } from '../../../electron/services/llm'
import { configureSettings, getSettings, saveSettings, type Cofre } from '../../../electron/services/settings'
import { configurarEpisodios } from '../electron/episodio/indice'
import { pastaDoCache } from '../electron/gerar/cache'
import { trocarIaParaTeste } from '../electron/gerar/ia'
import { blocoDoReligar, SISTEMA_RELIGAR } from '../electron/gerar/prompt-religar'
import { abrirRascunho, gravarRascunho, lerRascunhoDoDisco, pastaDosRascunhos } from '../electron/gerar/rascunho'
import { religarRoteiro } from '../electron/gerar/religar'
import { cancelarRoteiro, gerarRoteiro } from '../electron/gerar/roteiro'

/** A fixture: o rascunho e o indice do S4-37, so leitura (o teste copia para o temp). */
const FIXTURE = join(__dirname, 'fixture')
/** A biblioteca do modulo no teste. */
const BIBLIOTECA = mkdtempSync(join(tmpdir(), 'recap-v-religar-bib-'))

const ID_37 = 'ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067'
const REAL = join(FIXTURE, 'rascunho-s4e37.json')
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
async function lancou(fn: () => unknown): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
const nada = (): void => {}
function sha(caminho: string): string {
  return createHash('sha256').update(readFileSync(caminho)).digest('hex')
}
function pronto(r: RoteiroReligado): RoteiroReligadoPronto {
  if (ehParadaNoReserva(r)) throw new Error('parou no reserva sem esperar')
  return r
}

// ------------------------------------------------------------------ IA falsa

interface Chamada {
  etapa: string
  prompt: string
  permitirReserva: boolean | undefined
}
const chamadas: Chamada[] = []
let falharProxima = false
let reservaProxima = false
let atrasoMs = 0
let indice37: EpisodeIndex

/** As frases marcadas no prompt do religar: ">>> f20: texto". */
function marcadas(prompt: string): string[] {
  return [...prompt.matchAll(/^>>> (f\d{2,}): /gm)].map((m) => m[1]!)
}

/** Liga cada frase marcada ao e20 (com lixo de proposito, que o conserto tira) e fala tambem de uma que nao foi pedida. */
function religacaoFalsa(prompt: string): ReligacaoDaIa {
  const ids = marcadas(prompt)
  const e20 = /^e20 /m.test(prompt)
  return {
    frases: [
      ...ids.map((fraseId, i) => ({
        fraseId: i === 0 ? `[${fraseId}]` : fraseId,
        eventoIds: e20 ? (i === 0 ? ['e99', 'e20'] : ['e20']) : ['e01'],
        cueDoMomento: i === 0 ? 'c9999' : null,
        intencaoVisual: `close no Senku ${i}`,
        textoDeTela: i === 0 ? 'TRES PALAVRAS GRANDES' : null,
      })),
      { fraseId: 'f01', eventoIds: ['e01'], cueDoMomento: null, intencaoVisual: 'nao pedida', textoDeTela: null },
    ],
  }
}

function eventosFalsos(indice: EpisodeIndex): EventosDaIa {
  const falas = cuesElegiveis(indice)
  const eventos: EventosDaIa['eventos'] = []
  for (let i = 0; i + 4 <= falas.length && eventos.length < 18; i += 12) {
    eventos.push({ cueIds: falas.slice(i, i + 4).map((c) => c.id), resumo: `O Senku faz a coisa ${eventos.length + 1}.`, personagens: ['Senku'], peso: 3 })
  }
  return { eventos }
}

async function iaFalsa<S extends z.ZodType>(pedido: PedidoJson<S>): Promise<RespostaJson<z.infer<S>>> {
  chamadas.push({ etapa: pedido.etapa, prompt: pedido.prompt, permitirReserva: pedido.permitirReserva })
  if (atrasoMs > 0) await new Promise((r) => setTimeout(r, atrasoMs))
  if (falharProxima) {
    falharProxima = false
    return { ok: false, nota: 'A cota gratis do Gemini acabou por hoje.', bruto: 'Gemini 429 RESOURCE_EXHAUSTED', provedor: 'gemini' }
  }
  if (reservaProxima && pedido.permitirReserva === false) {
    reservaProxima = false
    return {
      ok: false,
      motivo: 'so-reserva',
      nota: 'So o reserva',
      bruto: '',
      provedor: 'gemini',
      reserva: 'gemini-falso-lite',
      renovaEm: Date.now() + 3_600_000,
      porCota: true,
    }
  }
  let valor: unknown
  if (pedido.etapa === 'religar') valor = religacaoFalsa(pedido.prompt)
  else if (pedido.etapa === 'eventos') valor = eventosFalsos(indice37)
  else valor = { secoes: [] }
  const conferido = pedido.schema.safeParse(valor)
  if (!conferido.success) throw new Error(`resposta falsa fora do schema (${pedido.etapa})`)
  return { ok: true, valor: conferido.data, provedor: 'gemini', modelo: 'gemini-falso' }
}

function contar(etapa?: string): number {
  return chamadas.filter((c) => !etapa || c.etapa === etapa).length
}

// ------------------------------------------------------------------ o roteiro editado

/** As frases do roteiro por id. */
function porId(rt: Pick<Roteiro, 'secoes'>): Map<string, Frase> {
  return new Map(rt.secoes.flatMap((s) => s.frases.map((f) => [f.id, f] as const)))
}

const F07_NOVO = 'O Taiju e a Yuzuriha finalmente se casaram numa baita comemoração.'
const F12_NOVO = 'A ideia agora é apagar a petrificação antes dela acontecer.'
const ACRESCIDA = 'Ninguém achou que isso fosse possível.'

/** Edita 2 frases (f07 pouco, f12 tudo) e acrescenta 1 depois da f13, no texto do modo Texto. */
function textoEditado(rt: Roteiro): string {
  const f = porId(rt)
  return textoDoRoteiro(rt)
    .replace(f.get('f07')!.texto, F07_NOVO)
    .replace(f.get('f12')!.texto, F12_NOVO)
    .replace(f.get('f13')!.texto, `${f.get('f13')!.texto} ${ACRESCIDA}`)
}

/** Copia o rascunho da fixture para o perfil de teste, com escolhas de cena falsas para f07, f12 e f13. */
function copiarReal(comCenas: boolean): RascunhoDoRecap {
  const destino = join(pastaDosRascunhos(), `${RC}.json`)
  copyFileSync(REAL, destino)
  let r = lerRascunhoDoDisco(RC)
  if (comCenas) {
    const atual = roteiroAtual(r)!
    const f = porId(atual)
    const plano = indice37.planos[10]!
    const escolha = (fraseId: string, segunda: boolean): EscolhaDaFrase => {
      const c = candidatoDosPlanos([plano], ID_37, 'sugestao', { porque: ['teste'] })
      const n = f.get(fraseId)!.texto.split(/\s+/).length
      return {
        fraseId,
        cenas: segunda ? [{ candidato: c, palavraInicio: 0 }, { candidato: c, palavraInicio: n - 1 }] : [{ candidato: c, palavraInicio: 0 }],
        fita: [c],
        confianca: 0.5,
        travada: true,
        hashTexto: hashDoTexto(f.get(fraseId)!.texto),
        duracao: 3,
        avisos: [],
      }
    }
    const cenas: EstadoDasCenas = { ...CENAS_VAZIAS, escolhas: [escolha('f07', true), escolha('f12', false), escolha('f13', false)], roteiroVersao: 3 }
    r = { ...r, cenas }
    gravarRascunho(r)
  }
  return r
}

async function principal(): Promise<void> {
  const shaReal = sha(REAL)
  const userData = mkdtempSync(join(tmpdir(), 'anirecap-v-religar-'))
  const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
  configureSettings(userData, cofreFalso)
  saveSettings({ libraryDir: '', geminiApiKey: 'chave-falsa-do-teste', iaProvedor: 'gemini', geminiModelo: '' })
  guardarContexto({
    id: 'recap',
    config: () => ({ libraryDir: '', iaProvedor: 'gemini', whisperModel: 'small', modulo: { biblioteca: BIBLIOTECA } }),
    ligado: () => true,
    // O ctx.ia como o nucleo monta (electron/modulos.ts); o teste troca o gerarJson pela falsa.
    ia: {
      gerarJson,
      provedor: (forcado?: 'gemini' | 'anthropic') => escolherProvedor(getSettings(), forcado),
      modelo: (p: 'gemini' | 'anthropic') => (p === 'gemini' ? getSettings().geminiModelo : getSettings().anthropicModelo),
    },
  } as unknown as ContextoDoModulo)
  configurarEpisodios(userData)
  const indiceReal = join(FIXTURE, 'indice-s4e37.json')
  mkdirSync(join(BIBLIOTECA, '_indices', ID_37), { recursive: true })
  copyFileSync(indiceReal, join(BIBLIOTECA, '_indices', ID_37, 'episodio.json'))
  void dirname
  mkdirSync(pastaDosRascunhos(), { recursive: true })
  const desfazer = trocarIaParaTeste(iaFalsa)
  indice37 = lerIndice(JSON.parse(readFileSync(join(BIBLIOTECA, '_indices', ID_37, 'episodio.json'), 'utf8')))

  try {
    secao('1. Funcoes puras')
    confere(normalizarTextoDoRoteiro('  Um.  Dois.\r\n\r\n\r\n Tres. \n\n \n') === 'Um. Dois.\n\nTres.', 'normaliza: espaco colapsado, partes por linha em branco, CRLF')
    confere(mesmoTextoDoRoteiro('A b.\nC d.\n\nE.', 'A b. C d.\n \nE.') && !mesmoTextoDoRoteiro('A b.', 'A c.'), 'mesmoTextoDoRoteiro: quebra simples nao muda, palavra muda')
    confere(
      precisaReligar({ texto: 'Oi.', eventoIds: [], intencaoVisual: '' }) &&
        !precisaReligar({ texto: 'Oi.', eventoIds: [], intencaoVisual: 'close' }) &&
        !precisaReligar({ texto: 'Oi.', eventoIds: ['e01'], intencaoVisual: '' }) &&
        !precisaReligar({ texto: '  ', eventoIds: [], intencaoVisual: '' }),
      'precisaReligar: so sem evento, sem intencao e com texto',
    )

    secao('2. Rascunho real (copia): editar 2 frases e acrescentar 1')
    const r0 = copiarReal(true)
    const v3 = roteiroAtual(r0)!
    confere(r0.versao === 3 && r0.atual === 3 && r0.aprovado && v3.secoes.flatMap((s) => s.frases).length === 16, `copia lida como v3: roteiro v${r0.atual} aprovado, 16 frases`)
    const texto = textoEditado(v3)
    const local = redividirRoteiro(v3, texto)
    confere(
      local.frases.filter((f) => f.destino === 'igual').length === 14 &&
        local.frases.find((f) => f.id === 'f07')?.destino === 'parecida' &&
        local.religar.length === 2 &&
        local.removidas.join() === 'f12',
      `redivisao: 14 iguais, f07 parecida, 2 novas (${local.religar.join(', ')}), f12 removida`,
    )
    chamadas.length = 0
    const progresso: string[] = []
    const res = pronto(
      await religarRoteiro(RC, { texto, modo: 'editar', versao: 3, criadoEm: v3.criadoEm, pedidoId: 'p1' }, (p) => progresso.push(`${p.etapa}:${p.mensagem}`)),
    )
    const v9 = res.roteiro
    const antes = porId(v3)
    const depois = porId(v9)
    confere(contar() === 1 && contar('religar') === 1, `UMA chamada a IA (etapa religar): ${contar()}`)
    confere(progresso.some((p) => p.startsWith('religar:') && p.includes('Gemini')), `andamento com a etapa religar (${progresso.join(' | ')})`)
    const iguais = [...antes.keys()].filter((id) => id !== 'f07' && id !== 'f12')
    confere(iguais.length === 14 && iguais.every((id) => JSON.stringify(depois.get(id)) === JSON.stringify(antes.get(id))), 'as outras 14 frases: MESMO id, texto e vinculos')
    const f07 = depois.get('f07')
    confere(f07?.texto === F07_NOVO && JSON.stringify(f07.eventoIds) === JSON.stringify(antes.get('f07')!.eventoIds), `f07 pouco mudada: mesmo id, texto novo, evento ${f07?.eventoIds.join(',')}`)
    const [n1, n2] = local.religar
    const novaF12 = depois.get(n1!)
    const acrescida = depois.get(n2!)
    confere(!depois.has('f12') && novaF12?.texto === F12_NOVO && acrescida?.texto === ACRESCIDA, `f12 mudada demais: id livre ${n1}; a acrescida: ${n2}`)
    confere(Number(n1!.slice(1)) > 19 && Number(n2!.slice(1)) > 19, 'ids novos acima de todos os do roteiro (f19)')
    const s5 = v9.secoes.find((s) => s.papel === 'climax')!
    confere(s5.frases.map((f) => f.id).join() === `f13,${n2},f14,f15`, `a acrescida entrou depois da f13 (${s5.frases.map((f) => f.id).join(',')})`)
    confere(
      JSON.stringify(novaF12?.eventoIds) === '["e20"]' && novaF12?.cueDoMomento === null && novaF12?.textoDeTela === null && novaF12?.intencaoVisual === 'close no Senku 0',
      'conserto: evento inexistente, fala fora do evento e tela de 3 palavras sairam',
    )
    confere(JSON.stringify(acrescida?.eventoIds) === '["e20"]' && acrescida?.intencaoVisual === 'close no Senku 1', 'a acrescida ligada ao evento')
    confere(depois.get('f01')!.intencaoVisual === antes.get('f01')!.intencaoVisual, 'frase nao pedida que a IA citou: intocada')
    confere(res.religadas.join() === [n1, n2].join() && res.semEvento.length === 0, `religadas ${res.religadas.join(',')}, sem evento ${res.semEvento.length}`)
    confere(
      res.frases.filter((f) => f.destino === 'igual').length === 14 && res.frases.filter((f) => f.destino === 'nova').length === 2,
      'o casamento devolvido a tela',
    )
    confere(res.rascunho.atual === 9 && v9.origem === 'editado' && v9.derivadoDe === 3 && !res.rascunho.aprovado && res.rascunho.roteiros.length === 9, `versao 'editado' nova v${v9.versao} (de v3), desaprovada`)
    const disco = lerRascunhoDoDisco(RC)
    confere(JSON.stringify(roteiroAtual(disco)) === JSON.stringify(v9), 'o que voltou e o que esta no disco')
    const esc = (disco.cenas?.escolhas ?? []).map((e) => e.fraseId).join()
    confere(esc === 'f07,f13', `escolhas de cena: as mantidas seguem, a da f12 sai (${esc})`)
    const e07 = disco.cenas!.escolhas[0]!
    confere(e07.cenas.length === 2 && e07.cenas[1]!.palavraInicio < F07_NOVO.split(/\s+/).length, 'f07: a barrinha da 2a cena cabe no texto novo')
    confere(validarRoteiro(v9, disco.eventos, indice37).filter((p) => p.nivel === 'erro').length === 0, 'o roteiro religado nao tem erro (aprova)')
    confere(res.avisos.some((a) => /evento inexistente/.test(a)) && res.avisos.some((a) => /fora dos eventos/.test(a)) && res.avisos.some((a) => /Texto de tela/.test(a)), 'os consertos voltam como aviso')

    secao('3. Texto igual: nada chama, nada grava')
    chamadas.length = 0
    const igual = pronto(await religarRoteiro(RC, { texto: `${textoDoRoteiro(v9)}\n\n`, modo: 'editar', pedidoId: 'p2' }, nada))
    confere(contar() === 0 && igual.rascunho.atualizadoEm === disco.atualizadoEm && igual.religadas.length === 0 && !igual.doCache, 'sem chamada, sem versao nova')

    secao('4. Cache: a mesma edicao noutra copia sai de graca')
    copiarReal(false)
    chamadas.length = 0
    const doCache = pronto(await religarRoteiro(RC, { texto, modo: 'editar', pedidoId: 'p3' }, nada))
    confere(contar() === 0 && doCache.doCache && doCache.religadas.length === 2, `0 chamadas, doCache ${doCache.doCache}`)

    secao('5. A IA falhou: o texto fica gravado e a proxima religacao completa')
    rmSync(pastaDoCache(), { recursive: true, force: true })
    copiarReal(false)
    chamadas.length = 0
    falharProxima = true
    const erro = await lancou(() => religarRoteiro(RC, { texto, modo: 'editar', pedidoId: 'p4' }, nada))
    const aposFalha = lerRascunhoDoDisco(RC)
    const rtFalha = roteiroAtual(aposFalha)!
    confere(erro === 'A cota gratis do Gemini acabou por hoje.', `erro para a tela: ${erro}`)
    confere(aposFalha.atual === 9 && mesmoTextoDoRoteiro(textoDoRoteiro(rtFalha), texto), 'o texto ja esta gravado (v9)')
    confere(frasesParaReligar(rtFalha).length === 2, `as 2 frases novas ficam por ligar (${frasesParaReligar(rtFalha).join(',')})`)
    const completa = pronto(await religarRoteiro(RC, { texto: textoDoRoteiro(rtFalha), modo: 'editar', pedidoId: 'p5' }, nada))
    confere(contar('religar') === 2 && completa.religadas.length === 2 && completa.rascunho.atual === 9 && completa.rascunho.roteiros.length === 9, 'a segunda liga as 2, no lugar (sem v10)')

    secao('6. So o reserva livre: para, e o "Usar modelo reserva" completa')
    rmSync(pastaDoCache(), { recursive: true, force: true })
    copiarReal(false)
    chamadas.length = 0
    reservaProxima = true
    const parada = await religarRoteiro(RC, { texto, modo: 'editar', pedidoId: 'p6' }, nada)
    confere(ehParadaNoReserva(parada) && parada.etapa === 'religar', 'ParadoNoReserva na etapa religar')
    confere(frasesParaReligar(roteiroAtual(lerRascunhoDoDisco(RC))!).length === 2, 'texto gravado, frases por ligar')
    const comReserva = pronto(await religarRoteiro(RC, { texto, modo: 'editar', pedidoId: 'p7', aceitouReserva: true }, nada))
    confere(chamadas.map((c) => c.permitirReserva).join() === 'false,true' && comReserva.religadas.length === 2, 'com o aceite: permitirReserva true, frases ligadas')

    secao('7. Cancelar: a resposta que chega depois nao entra')
    rmSync(pastaDoCache(), { recursive: true, force: true })
    copiarReal(false)
    chamadas.length = 0
    atrasoMs = 150
    const emCurso = religarRoteiro(RC, { texto, modo: 'editar', pedidoId: 'pc' }, nada)
    await new Promise((r) => setTimeout(r, 30))
    const ocupado = await lancou(() => gerarRoteiro(RC, { alvoSec: 60 }, nada))
    confere(ocupado === 'Ja estou escrevendo este roteiro. Espere terminar.', 'um pedido por rascunho: o gerarRoteiro espera o religar')
    confere(cancelarRoteiro(RC, 'outro') === false && cancelarRoteiro(RC, 'pc') === true, 'cancelarRoteiro vale para o religar (so com o pedidoId dele)')
    const cancelado = pronto(await emCurso)
    atrasoMs = 0
    const aposCancelar = roteiroAtual(lerRascunhoDoDisco(RC))!
    confere(cancelado.religadas.length === 0 && cancelado.semEvento.length === 2 && frasesParaReligar(aposCancelar).length === 2, 'nada ligado; o texto ficou gravado')
    chamadas.length = 0
    const depoisDoCancelar = pronto(await religarRoteiro(RC, { texto, modo: 'editar', pedidoId: 'p8' }, nada))
    confere(contar() === 0 && depoisDoCancelar.religadas.length === 2, 'a resposta cancelada ficou no cache: ligar de novo sai de graca')

    secao('8. Usar meu roteiro (com roteiro)')
    chamadas.length = 0
    const meu = 'O Senku decidiu voltar no tempo. Ninguém acreditou.\n\nA Lua ficou para trás. O laboratório virou a casa dele.\n\nE agora, será que ele consegue?'
    const colado = pronto(await religarRoteiro(RC, { texto: meu, modo: 'meu-roteiro', alvoSec: 60, pedidoId: 'p9' }, nada))
    const vMeu = colado.roteiro
    const ids = vMeu.secoes.flatMap((s) => s.frases.map((f) => f.id))
    const reservados = colado.rascunho.roteiros.find((x) => x.versao === 9)!
    const maior = Math.max(...reservados.secoes.flatMap((s) => s.frases.map((f) => Number(f.id.slice(1)))))
    confere(colado.rascunho.atual === 10 && vMeu.origem === 'editado' && vMeu.derivadoDe === null && vMeu.modelo === '' && colado.rascunho.roteiros.length === 10, 'versao nova v10, editada, sem origem')
    confere(vMeu.secoes.map((s) => `${s.id}:${s.papel}`).join() === 's1:gancho,s2:desenvolvimento,s3:fechamento', `partes ${vMeu.secoes.map((s) => `${s.id}:${s.papel}`).join(', ')}`)
    confere(ids.length === 5 && ids.every((id) => Number(id.slice(1)) > maior), `5 frases, ids livres (${ids.join(',')} > f${maior})`)
    confere(contar('religar') === 1 && colado.religadas.length === 5 && colado.frases.every((f) => f.destino === 'nova'), 'uma chamada liga as 5')
    chamadas.length = 0
    const deNovo = pronto(await religarRoteiro(RC, { texto: meu, modo: 'meu-roteiro', pedidoId: 'p10' }, nada))
    confere(contar() === 0 && deNovo.rascunho.atual === 10 && deNovo.rascunho.roteiros.length === 10, 'colar o mesmo de novo nao cria outra versao')

    secao('9. Usar meu roteiro num rascunho sem eventos nem roteiro')
    const vazio = await abrirRascunho(ID_37, true)
    confere(vazio.rascunho.eventos.length === 0 && vazio.rascunho.atual === null, 'rascunho novo, vazio')
    chamadas.length = 0
    const primeiro = pronto(await religarRoteiro(vazio.rascunho.id, { texto: meu, modo: 'meu-roteiro', alvoSec: 60, pedidoId: 'p11' }, nada))
    confere(chamadas.map((c) => c.etapa).join() === 'eventos,religar', `eventos antes, depois a religacao (${chamadas.map((c) => c.etapa).join(',')})`)
    confere(primeiro.rascunho.atual === 1 && primeiro.roteiro.origem === 'editado' && primeiro.rascunho.eventos.length > 0 && primeiro.religadas.length === 5, 'v1 colada, ligada aos eventos novos')
    const editarSem = await abrirRascunho(ID_37, true)
    confere(
      (await lancou(() => religarRoteiro(editarSem.rascunho.id, { texto: meu, modo: 'editar' }, nada))) === 'Gere um roteiro antes de editar em texto.',
      'editar em texto sem roteiro: recado',
    )
    confere((await lancou(() => religarRoteiro(RC, { texto: ' \n\n ', modo: 'meu-roteiro' }, nada))) === 'O roteiro ficou vazio.', 'colar vazio: recado')

    secao('10. Prompt')
    const ultimo = chamadas.find((c) => c.etapa === 'religar')!.prompt
    confere(/^>>> f01: O Senku decidiu voltar no tempo\.$/m.test(ultimo) && ultimo.includes('ACONTECIMENTOS') && /^e01 \[/m.test(ultimo), 'o prompt marca as frases e traz os acontecimentos com as falas')
    const bloco = blocoDoReligar(v9, [n1!])
    confere(bloco.includes(`>>> ${n1}: ${F12_NOVO}`) && bloco.includes('    f07: ') && bloco.includes('(e13)'), 'as frases ja ligadas vao com os eventos, como contexto')
    confere(!/Senku|Stone|Witch|Coco/i.test(SISTEMA_RELIGAR) && SISTEMA_RELIGAR.includes('VOCÊ NÃO ESCREVE NADA'), 'sistema sem exemplo de serie, e sem reescrever')

    secao('11. aplicarReligacao: limite de textos de tela e frases sem resposta')
    const telas: Roteiro = {
      ...v9,
      secoes: v9.secoes.map((s) => ({ ...s, frases: s.frases.map((f) => (['f01', 'f02', 'f06', 'f08'].includes(f.id) ? { ...f, textoDeTela: 'X' } : f)) })),
    }
    const lig = aplicarReligacao(
      telas,
      { frases: [{ fraseId: n1!, eventoIds: ['e20'], cueDoMomento: cuesDoEvento(disco.eventos.find((e) => e.id === 'e20')!, indice37)[0]!.id, intencaoVisual: 'x', textoDeTela: 'CHOQUE' }] },
      [n1!, n2!],
      { eventos: disco.eventos, indice: indice37 },
    )
    const ligadas = porId({ secoes: lig.secoes })
    confere(ligadas.get(n1!)!.textoDeTela === null && lig.avisos.some((a) => /alem de 4/.test(a)), 'o 5o texto de tela sai')
    confere(ligadas.get(n1!)!.cueDoMomento !== null, 'fala do evento citado fica como momento')
    confere(lig.semEvento.join() === n2 && lig.avisos.some((a) => /sem resposta/.test(a)) && lig.respondidas === 1, 'a frase sem resposta fica sem evento, com aviso')

    secao('12. A fixture nao mudou')
    confere(sha(REAL) === shaReal, 'sha256 do rascunho da fixture igual ao do comeco')
  } finally {
    desfazer()
    rmSync(userData, { recursive: true, force: true })
    rmSync(BIBLIOTECA, { recursive: true, force: true })
  }
  console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
}

void principal().catch((err) => {
  console.error(err)
  process.exit(1)
})
