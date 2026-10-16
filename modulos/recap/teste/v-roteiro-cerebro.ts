/**
 * O CEREBRO do passo 2 (Roteiro) de ponta a ponta, SEM gastar cota: a IA e
 * trocada por uma falsa (trocarIaParaTeste), que devolve respostas montadas
 * com as falas reais do indice e conta as chamadas.
 *
 * Cobre electron/services/gerar/*: elenco e grafia dos nomes, prompts (sem
 * exemplo de serie), cache por sha256, rascunho em disco (zod, atomico,
 * reabrir), eventos (t0/t1 das cues, OP/placa fora, dedupe de chamada),
 * roteiro (nova tentativa pelo tamanho, "Outra versao" com os ganchos
 * anteriores, "Refazer esta parte" com a costura e o pedido), edicao, versoes,
 * aprovacao, a guarda de pedido simultaneo, falha da IA e as miniaturas pelo
 * servidor de midia. E as correcoes de 13/10/2026: outra tomada nao le o
 * cache, gancho repetido pede de novo, resposta recusada nao entra no cache,
 * "Refazer" com frase vazia em outra parte, Cancelar que guarda so no
 * historico, rascunho novo do mesmo episodio, placas e "em cena" no prompt.
 *
 * [recap] Portado do Studio. Os indices reais do Dr. Stone sao COPIADOS da
 * biblioteca do Studio (so leitura) para uma biblioteca temporaria, que e a
 * biblioteca do modulo no teste; o perfil tambem e temporario. Nada e gravado
 * fora do temp. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-roteiro-cerebro.ts
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { guardarContexto } from '../electron/contexto'
import type { z } from 'zod'
import { lerIndice, type EpisodeIndex } from '../shared/episodio'
import {
  cueExcluida,
  cuesElegiveis,
  faixaDePalavras,
  palavrasDoRoteiro,
  roteiroAtual,
  validarRoteiro,
  type EventosDaIa,
  type FraseDaIa,
  type RoteiroDaIa,
  type SecaoDaIa,
} from '../shared/roteiro'
import type { PedidoJson, RespostaJson } from '../../../electron/services/llm'
import { configureSettings, saveSettings, type Cofre } from '../../../electron/services/settings'
import { configurarEpisodios } from '../electron/episodio/indice'
import { chaveDoCache, pastaDoCache } from '../electron/gerar/cache'
import { trocarIaParaTeste } from '../electron/gerar/ia'
import { cancelarRoteiro } from '../electron/gerar/roteiro'
import { dividirEmFrases } from '../electron/gerar/frases'
import { acertarNome, acertarNomesNoTexto, elencoDoEpisodio } from '../electron/gerar/nomes'
import { promptDeEventos, promptDoRoteiro, SISTEMA_EVENTOS, SISTEMA_ROTEIRO, SISTEMA_SECAO } from '../electron/gerar/prompts'
import {
  abrirRascunho,
  aprovarRoteiro,
  escolherVersao,
  lerRascunhoDoDisco,
  listarRascunhos,
  pastaDosRascunhos,
  salvarRoteiro,
} from '../electron/gerar/rascunho'
import { gerarEventos } from '../electron/gerar/eventos'
import { gerarRoteiro } from '../electron/gerar/roteiro'
import { ritmoDoRascunho } from '../electron/voz/ritmo'
import { miniaturasDasCenas } from '../electron/gerar/miniaturas'

/** A biblioteca REAL do Studio: so leitura (o teste copia dela para o temp). */
const REAL = 'G:\\AniRecap Studio\\Biblioteca'
/** A biblioteca do modulo no teste: uma copia minima, no temp. */
const BIBLIOTECA = mkdtempSync(join(tmpdir(), 'recap-v-cerebro-bib-'))

/** Copia um arquivo da biblioteca real para a do teste, no mesmo caminho relativo. */
function copiar(caminhoReal: string): void {
  const destino = join(BIBLIOTECA, relative(REAL, caminhoReal))
  mkdirSync(dirname(destino), { recursive: true })
  copyFileSync(caminhoReal, destino)
}

/** O contexto que o nucleo daria ao modulo: so a config (a biblioteca no temp). */
function contextoFalso(): ContextoDoModulo {
  return {
    id: 'recap',
    prefixo: 'recap:',
    empacotado: false,
    versaoDoApp: 'teste',
    config: () => ({ libraryDir: '', iaProvedor: 'gemini', whisperModel: 'small', modulo: { biblioteca: BIBLIOTECA } }),
    ligado: () => true,
  } as unknown as ContextoDoModulo
}
const ID_37 = 'ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067'
const ID_24 = 'ep_7f20fe8a8728a5329c365e2b81648155cd2336e7'

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

// ------------------------------------------------------------------ IA falsa

interface Chamada {
  etapa: string
  prompt: string
  sistema: string
}
const chamadas: Chamada[] = []
let falharProxima: string | null = null
/** O proximo roteiro inteiro sai com o gancho da v1 ("Mano,"), mesmo pedindo outro. */
let repetirGancho = false
/** Os eventos saem todos com id inventado (resposta que o passo recusa). */
let eventosRuins = false
/** Espera antes de responder (para o Cancelar chegar no meio). */
let atrasoMs = 0

function frase(texto: string, eventoIds: string[], extra: Partial<FraseDaIa> = {}): FraseDaIa {
  return { texto, eventoIds, cueDoMomento: null, intencaoVisual: 'close no Senku', textoDeTela: null, citacaoCueId: null, ...extra }
}

/** N palavras de narracao "falada", em frases de 10. */
function frases(n: number, eventoId: string, prefixo: string): FraseDaIa[] {
  const saida: FraseDaIa[] = []
  let sobra = n
  let i = 0
  while (sobra > 0) {
    const k = Math.min(10, sobra)
    const palavras = Array.from({ length: k }, (_, j) => (j === 0 ? `${prefixo}${i}` : 'palavra'))
    saida.push(frase(`${palavras.join(' ')}.`, [eventoId]))
    sobra -= k
    i += 1
  }
  return saida
}

let indice37: EpisodeIndex
function eventosFalsos(indice: EpisodeIndex): EventosDaIa {
  const falas = cuesElegiveis(indice)
  const eventos: EventosDaIa['eventos'] = []
  for (let i = 0; i + 4 <= falas.length && eventos.length < 18; i += 12) {
    eventos.push({
      cueIds: falas.slice(i, i + 4).map((c) => c.id),
      resumo: `Senkuu-san faz a coisa ${eventos.length + 1}.`,
      personagens: ['Senkuu Ishigami', 'Ishigami', 'Dr. Xeno'],
      peso: eventos.length === 3 ? 7 : 3,
    })
  }
  // Um evento so de placa/OP/ED e um com id inventado: os dois tem que sair.
  const naOpEd = indice.cues.filter((c) => cueExcluida(c, indice.exclusoes))
  const placa = indice.cues.filter((c) => c.tipo === 'placa').slice(0, 2)
  eventos.push({ cueIds: [...naOpEd.map((c) => c.id), ...placa.map((c) => c.id)], resumo: 'Abertura.', personagens: [], peso: 1 })
  eventos.push({ cueIds: ['c9999'], resumo: 'Inventado.', personagens: [], peso: 2 })
  return { eventos }
}

/** Um gancho que nenhuma versao anterior teve (o "Outra versao" de verdade): 10 palavras unicas. */
let ganchoN = 0
function ganchoNovo(): string {
  ganchoN += 1
  return `${Array.from({ length: 10 }, (_, j) => (j === 0 ? `Imagina${ganchoN}` : `p${j}x${ganchoN}`)).join(' ')}.`
}

function roteiroFalso(palavras: number, gancho: string): RoteiroDaIa {
  const resto = palavras - 10
  const primeira = gancho === 'Mano,' ? 'Mano, o Senkuu-san solta: "fiz algo enorme agora mesmo."' : ganchoNovo()
  return {
    secoes: [
      { papel: 'gancho', frases: [frase(primeira, ['e01'], { textoDeTela: 'Que isso', citacaoCueId: 'c0001' })] },
      { papel: 'contexto', frases: frases(Math.round(resto * 0.3), 'e02', 'Contexto') },
      { papel: 'desenvolvimento', frases: frases(Math.round(resto * 0.5), 'e05', 'Meio') },
      { papel: 'fechamento', frases: [...frases(resto - Math.round(resto * 0.3) - Math.round(resto * 0.5) - 2, 'e09', 'Fim'), frase('E agora? Vai.', [], { textoDeTela: 'muitas palavras demais aqui' })] },
      { papel: 'virada', frases: [] },
    ],
  }
}

async function iaFalsa<S extends z.ZodType>(pedido: PedidoJson<S>): Promise<RespostaJson<z.infer<S>>> {
  chamadas.push({ etapa: pedido.etapa, prompt: pedido.prompt, sistema: pedido.sistema })
  if (atrasoMs > 0) await new Promise((r) => setTimeout(r, atrasoMs))
  if (falharProxima) {
    const nota = falharProxima
    falharProxima = null
    return { ok: false, nota, bruto: 'Gemini 429 RESOURCE_EXHAUSTED: quota', provedor: 'gemini' }
  }
  let valor: unknown
  if (pedido.etapa === 'eventos') valor = eventosRuins ? { eventos: [{ cueIds: ['c9999 0:31'], resumo: 'Inventado.', personagens: [], peso: 3 }] } : eventosFalsos(indice37)
  else if (pedido.etapa === 'roteiro') {
    const ajuste = pedido.prompt.includes('SUA RESPOSTA ANTERIOR')
    const outra = pedido.prompt.includes('VERSÕES ANTERIORES')
    const igual = repetirGancho && !ajuste
    // A primeira sai curta de proposito (60 palavras): tem que vir a nova tentativa.
    valor = roteiroFalso(ajuste ? 160 : outra ? 158 : 60, outra && !igual ? 'Imagina' : 'Mano,')
  } else if (pedido.etapa === 'secao') {
    valor = { frases: [frase('Parte nova e bem mais forte, com o Senku no meio.', ['e03']), frase('E ninguem esperava.', ['e03'])] } satisfies SecaoDaIa
  }
  const conferido = pedido.schema.safeParse(valor)
  if (!conferido.success) throw new Error(`resposta falsa fora do schema (${pedido.etapa})`)
  return { ok: true, valor: conferido.data, provedor: 'gemini', modelo: 'gemini-falso' }
}

function contar(etapa?: string): number {
  return chamadas.filter((c) => !etapa || c.etapa === etapa).length
}

function baixar(url: string): Promise<{ status: number; tipo: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let bytes = 0
      res.on('data', (c: Buffer) => (bytes += c.length))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, tipo: String(res.headers['content-type'] ?? ''), bytes }))
    }).on('error', reject)
  })
}

// ------------------------------------------------------------------ roteiro do teste

async function principal(): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'anirecap-v-cerebro-'))
  const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
  configureSettings(userData, cofreFalso)
  saveSettings({ libraryDir: '', geminiApiKey: 'chave-falsa-do-teste', iaProvedor: 'gemini', geminiModelo: '' })
  guardarContexto(contextoFalso())
  configurarEpisodios(userData)
  const desfazer = trocarIaParaTeste(iaFalsa)
  // A copia minima: os dois indices e os keyframes que as miniaturas pedem.
  copiar(join(REAL, '_indices', ID_37, 'episodio.json'))
  const real24 = join(REAL, 'Dr STONE', 'S04E24')
  copiar(join(real24, 'episodio.json'))
  const cru24 = lerIndice(JSON.parse(readFileSync(join(real24, 'episodio.json'), 'utf8')))
  for (const p of cru24.planos.filter((x) => x.keyframe).slice(10, 13)) {
    copiar(join(real24, relative(cru24.biblioteca.pasta, p.keyframe!)))
  }
  indice37 = lerIndice(JSON.parse(readFileSync(join(BIBLIOTECA, '_indices', ID_37, 'episodio.json'), 'utf8')))

  try {
    secao('1. Elenco e grafia dos nomes')
    const el37 = elencoDoEpisodio(indice37)
    const nomes37 = el37.personagens.map((p) => p.nome)
    confere(nomes37[0] === 'Senku' && nomes37.includes('Ukyo') && nomes37.includes('Ryusui') && nomes37.includes('Xeno'), `S4-37: falante manda (${nomes37.slice(0, 6).join(', ')})`)
    confere(!nomes37.some((n) => /Senkuu|Ukyou|Ryuusui|-chan/.test(n)) && nomes37.includes('Why-Man'), 'S4-37: sem grafia do MyAnimeList nem honorifico; Why-Man como no texto')
    const i24 = lerIndice(JSON.parse(readFileSync(join(BIBLIOTECA, 'Dr STONE', 'S04E24', 'episodio.json'), 'utf8')))
    const el24 = elencoDoEpisodio(i24)
    const nomes24 = el24.personagens.map((p) => p.nome)
    confere(!el24.comFalante && nomes24[0] === 'Senku' && nomes24.includes('Ukyo'), `S04E24 (.srt sem falante): ${nomes24.join(', ')}`)
    confere(
      acertarNomesNoTexto('O Senkuu e o SENKU-san viram o Ishigami e a Suika.', el37) === 'O Senku e o Senku viram o Ishigami e a Suika.',
      'texto: Senkuu/SENKU-san -> Senku; outra palavra do nome fica',
    )
    confere(acertarNomesNoTexto('Ao lado, Gen.', el37) === 'Ao lado, Gen.', 'texto: palavra comum nao e tocada')
    confere(
      ['Senkuu Ishigami', 'Ishigami', 'Ukyou Saionji', 'Fulano-kun'].map((n) => acertarNome(n, el37)).join('|') === 'Senku|Senku|Ukyo|Fulano',
      'nome de evento -> elenco',
    )

    secao('2. Prompts')
    const p37 = promptDeEventos({ indice: indice37, falas: cuesElegiveis(indice37), elenco: el37 })
    confere(p37.includes('[c0001 0:03] (Senku) Now, then, Why-Man'), 'fala numerada com tempo e falante')
    const p24 = promptDeEventos({ indice: i24, falas: cuesElegiveis(i24), elenco: el24 })
    confere(/\n\[c0001 0:18\] She did all/.test(p24) && p24.includes('NÃO diz quem fala'), '.srt sem falante: sem parenteses, com o aviso')
    const foraDoPrompt = indice37.cues.filter((c) => c.tipo !== 'fala' || cueExcluida(c, indice37.exclusoes))
    confere(foraDoPrompt.length > 30 && !foraDoPrompt.some((c) => p37.includes(`[${c.id} `)), `OP/ED e placa sem id no prompt (${foraDoPrompt.length} cues)`)
    confere(p37.includes('[placa 11:31] A Few Years Later') && /\[placa 20:52\] Why-Man \/ .*\(28 itens\)/.test(p37), 'placas como contexto, no tempo delas (a de 28 pecas resumida)')
    confere(!/Translation|work of fiction|Thank you for/i.test(p37) && p24.includes('[placa 20:22] DR. XENO JOINED YOUR GROUP!') && !/Subtitle translation|DO NOT ATTEMPT/.test(p24), 'creditos e avisos fora; placa de historia dentro')
    confere(['HIPÓTESE ≠ FATO', 'IDEIA TEM DONO', 'SÓ NOMES QUE ESTÃO NAS FALAS', 'from NASA', '"pedir" ou "perguntar" ≠ "enfrentar"'].every((t) => SISTEMA_EVENTOS.includes(t)), 'regras novas de eventos (hipotese, dono, nomes, ingles, escalada)')
    confere(['só retomam o SUJEITO da frase ANTERIOR', 'HIPÓTESE TEM DONO', 'SALTO DE TEMPO', 'PALAVRAS VIGIADAS', 'cueDoMomento', 'UMA opção só', '"MÁQUINA DO TEMPO" conta 2', 'BANIDO abrir com "Mano"'].every((t) => SISTEMA_ROTEIRO.includes(t)), 'regras novas do roteirista (pronome, hipotese, salto, termos, momento, tela)')
    const todos = [SISTEMA_EVENTOS, SISTEMA_ROTEIRO, SISTEMA_SECAO].join('\n')
    confere(!/Coco|Agathe|Agott|Carn|Kieffrey|Witch|lagarta|Brushbuddy|Sylph|Mitsuhiko|Futae|Yukiya|Miku|Senku|Stone/i.test(todos), 'sem exemplo de serie nos prompts de sistema')
    confere(['NÍVEL 1', 'NÍVEL 6', 'REGRA ZERO', 'NÃO ESCALE', 'VOZ FALADA', 'CORTE IMPIEDOSO', 'honoríficos'].every((t) => todos.includes(t)), 'regras do AniRecap presentes')
    const k1 = chaveDoCache({ etapa: 'e', provedor: 'gemini', modeloPedido: '', sistema: 's', prompt: 'p', schema: {} })
    confere(k1 === chaveDoCache({ etapa: 'e', provedor: 'gemini', modeloPedido: '', sistema: 's', prompt: 'p', schema: {} }) && /^[0-9a-f]{64}$/.test(k1), 'chave do cache: sha256 estavel')
    confere(k1 !== chaveDoCache({ etapa: 'e', provedor: 'gemini', modeloPedido: 'gemini-x', sistema: 's', prompt: 'p', schema: {} }), 'chave muda com o modelo pedido')
    confere(p24.includes('O protagonista NÃO é o falante padrão') && !p37.includes('falante padrão'), 'regra de atribuicao so na legenda sem falante')
    confere(
      JSON.stringify(dividirEmFrases('Será que dá? O plano final começou. E o Dr. Stone riu! "Eu topo." Fim')) ===
        JSON.stringify(['Será que dá?', 'O plano final começou.', 'E o Dr. Stone riu!', '"Eu topo."', 'Fim']),
      'uma frase por item: divide no ponto, nao em "Dr."',
    )
    confere(
      dividirEmFrases('Mano... esse cara fez isso.').length === 1 && dividirEmFrases('Ele sumiu... Ninguem viu.').length === 2 && dividirEmFrases('Ele tem 7.8 bilhoes.').length === 1,
      'reticencias: pausa (minuscula) fica, fim (maiuscula) divide; numero com ponto nao divide',
    )

    secao('3. Rascunho: criar, reabrir, ids')
    const a = await abrirRascunho(ID_37)
    confere(a.rascunho.titulo === 'Dr. Stone S04E37' && a.rascunho.eventos.length === 0 && a.rascunho.alvoSec === 60, `novo: ${a.rascunho.id} "${a.rascunho.titulo}"`)
    confere(existsSync(join(pastaDosRascunhos(), `${a.rascunho.id}.json`)), 'gravado em <userData>/recaps')
    confere(a.indice.id === ID_37 && a.indice.cues.length === indice37.cues.length, 'devolve o indice')
    const de = await abrirRascunho(ID_37)
    confere(de.rascunho.id === a.rascunho.id, 'reabrir devolve o mesmo rascunho')
    confere((await lancou(() => lerRascunhoDoDisco('../../x'))) === 'Rascunho invalido.', 'id com caminho e recusado')
    confere(/nao existe mais/.test((await lancou(() => lerRascunhoDoDisco('rc_nao_existe'))) ?? ''), 'rascunho inexistente: mensagem para a tela')
    const id = a.rascunho.id

    secao('4. Eventos')
    const progresso: string[] = []
    const ev = await gerarEventos(id, (p) => progresso.push(`${p.etapa}: ${p.mensagem}`))
    const e = ev.rascunho.eventos
    confere(contar('eventos') === 1 && !ev.doCache, `1 chamada (${progresso.join(' / ')})`)
    confere(e.length === 18 && e.every((x, i) => x.id === `e${String(i + 1).padStart(2, '0')}`), `${e.length} eventos, ids e01..`)
    const cues = new Map(indice37.cues.map((c) => [c.id, c]))
    confere(e.every((x) => x.t0 === cues.get(x.cueIds[0]!)!.start && x.t1 === Math.max(...x.cueIds.map((c) => cues.get(c)!.end))), 't0/t1 sairam das cues')
    confere(ev.avisos.some((s) => /sem fala valida: descartados/.test(s)) && ev.avisos.some((s) => /ignoradas/.test(s)), `OP/placa/id inventado descartados: ${ev.avisos.join(' | ')}`)
    confere(e.every((x) => x.personagens.join() === 'Senku,Xeno') && e[0]!.resumo.startsWith('Senku faz'), 'nomes no elenco (Senkuu Ishigami/Ishigami -> Senku, Dr. Xeno -> Xeno)')
    confere(e[3]!.peso === 5, 'peso 7 preso em 5')
    confere(ev.rascunho.eventosMeta?.modelo === 'gemini-falso', 'eventosMeta com o modelo')
    const ev2 = await gerarEventos(id, nada)
    confere(contar('eventos') === 1 && ev2.doCache && ev2.rascunho.eventos.length === 18, 'de novo: os mesmos, sem chamar a IA')

    const b = await abrirRascunho(ID_24)
    const [x1, x2] = await Promise.all([gerarEventos(b.rascunho.id, nada), gerarEventos(b.rascunho.id, nada)])
    confere(contar('eventos') === 2 && x1 === x2, 'dois pedidos ao mesmo tempo: uma chamada so')

    secao('5. Roteiro: primeira versao com nova tentativa pelo tamanho')
    const antes = contar('roteiro')
    const r1 = await gerarRoteiro(id, { alvoSec: 60 }, nada)
    // O alvo e no ritmo da voz que narra (shared/ritmo.ts): aqui, sem voz, o do audio importado (2,84 p/s -> 171).
    const ritmo = ritmoDoRascunho(null)
    const faixa = faixaDePalavras(60, ritmo.ritmo)
    confere(ritmo.origem === 'inicial' && faixa.alvo === 171, `sem voz escolhida: alvo ${faixa.alvo} palavras em 60 s (${ritmo.ritmo.toFixed(2)} p/s)`)
    const pal1 = palavrasDoRoteiro(r1.roteiro)
    confere(contar('roteiro') - antes === 2, '60 palavras na primeira resposta: 1 nova tentativa')
    confere(new RegExp(`tinha 6\\d palavras faladas em \\d+ frases, e o alvo é ${faixa.alvo} palavras`).test(chamadas.at(-1)!.prompt) && /Faltam frases em: .*desenvolvimento \(tem \d+, o pedido é 7\)/.test(chamadas.at(-1)!.prompt) && chamadas.at(-1)!.prompt.includes('[s1 · gancho]'), 'a tentativa leva a resposta anterior e o motivo (em frases por parte)')
    const pRot = chamadas.at(-1)!.prompt
    confere(pRot.includes('DIVISÃO (frases por seção): gancho 2, contexto 2, desenvolvimento 7') && pRot.includes('SALTO DE TEMPO: placa na tela (11:31) "A Few Years Later"') && pRot.includes('   (sem cena no episódio)') && /\n   em cena: /.test(pRot), 'prompt do roteiro: frases por parte, salto de tempo, sem cena, em cena')
    confere(pal1 >= faixa.min && pal1 <= faixa.max, `ficou a que acertou o tamanho: ${pal1} palavras (${faixa.min}-${faixa.max})`)
    confere(r1.roteiro.versao === 1 && r1.rascunho.atual === 1 && r1.roteiro.origem === 'ia' && r1.roteiro.pedido?.tipo === 'inteiro', 'versao 1 da IA, atual')
    confere(r1.roteiro.secoes.every((s) => s.frases.length > 0) && !r1.roteiro.secoes.some((s) => s.papel === 'virada'), 'secao vazia removida')
    const fim = r1.roteiro.secoes.at(-1)!.frases.slice(-2).map((f) => f.texto)
    confere(JSON.stringify(fim) === JSON.stringify(['E agora?', 'Vai.']), `item com duas frases virou dois (${fim.join(' | ')})`)
    const g = r1.roteiro.secoes[0]!.frases[0]!
    confere(g.texto.includes('o Senku solta') && g.textoDeTela === 'Que isso' && g.citacaoCueId === 'c0001', 'nome consertado no roteiro; tela e citacao (com a fala no texto) mantidas')
    confere(r1.avisos.some((s) => /Texto de tela com mais de 2 palavras removido: "muitas palavras demais aqui"/.test(s)) && r1.avisos.some((s) => /Sem evento/.test(s)), `avisos: ${r1.avisos.join(' | ')}`)
    confere(chamadas.filter((c) => c.etapa === 'roteiro').every((c) => c.prompt.includes('e01 [') && c.prompt.includes('   [c0001] (Senku)')), 'eventos com as falas no prompt')

    secao('6. Cache: rascunho novo do mesmo episodio nao gasta cota')
    rmSync(join(pastaDosRascunhos(), `${id}.json`))
    const n0 = contar()
    const c = await abrirRascunho(ID_37)
    const ce = await gerarEventos(c.rascunho.id, nada)
    const cr = await gerarRoteiro(c.rascunho.id, { alvoSec: 60 }, nada)
    confere(contar() === n0 && ce.doCache && cr.doCache, `0 chamadas (eventos e roteiro do cache: ${readdirSync(pastaDoCache()).length} arquivos)`)
    confere(JSON.stringify(cr.roteiro.secoes) === JSON.stringify(r1.roteiro.secoes), 'mesmo roteiro')
    const id2 = c.rascunho.id

    secao('7. Outra versao, edicao, aprovacao, versoes')
    const r2 = await gerarRoteiro(id2, { alvoSec: 60 }, nada)
    const pr2 = chamadas.at(-1)!.prompt
    confere(pr2.includes('VERSÕES ANTERIORES') && pr2.includes('- Mano, o Senku solta'), 'outra versao: o prompt leva o gancho anterior')
    confere(r2.roteiro.versao === 2 && r2.rascunho.atual === 2 && r2.roteiro.secoes[0]!.frases[0]!.texto.startsWith('Imagina'), 'versao 2 e a atual')
    const editado = structuredClone(r2.roteiro)
    editado.secoes[1]!.frases[0]!.texto = 'Frase editada pelo Levi.'
    const s1 = await salvarRoteiro(id2, editado)
    confere(s1.atual === 3 && roteiroAtual(s1)!.origem === 'editado' && roteiroAtual(s1)!.derivadoDe === 2, 'primeira edicao: versao 3 editado')
    // A tela segue a versao gravada (versao e criadoEm do disco): assim troca no lugar.
    const editado2 = structuredClone(roteiroAtual(s1)!)
    editado2.secoes[1]!.frases[0]!.texto = 'Frase editada de novo.'
    const s2 = await salvarRoteiro(id2, editado2)
    confere(s2.atual === 3 && s2.roteiros.length === 3, 'segunda edicao troca no lugar')
    const s3 = await salvarRoteiro(id2, editado2)
    confere(s3.atualizadoEm === s2.atualizadoEm, 'salvar sem mudar nao grava')
    const velha = await salvarRoteiro(id2, { ...editado, secoes: editado2.secoes.map((x, i) => (i === 2 ? { ...x, frases: x.frases.slice(1) } : x)) })
    confere(velha.atual === 4 && velha.roteiros.find((x) => x.versao === 3)!.secoes[1]!.frases[0]!.texto === 'Frase editada de novo.', 'tela de base velha (outra janela): vira v4, a v3 fica')
    await escolherVersao(id2, 3)
    const ap = await aprovarRoteiro(id2, editado2)
    confere(ap.aprovado && ap.aprovadoEm !== null && ap.atual === 3, 'aprovado')
    const volta = await escolherVersao(id2, 1)
    confere(volta.atual === 1 && !volta.aprovado, 'voltar para a v1 desaprova')
    confere(lerRascunhoDoDisco(id2).atual === 1, 'gravado no disco')

    secao('8. Refazer esta parte (com edicao pendente da tela)')
    const base = structuredClone(roteiroAtual(volta)!)
    base.secoes[0]!.frases[0]!.texto = 'Gancho mexido na tela e ainda nao gravado.'
    const antesSecao = contar('secao')
    const rs = await gerarRoteiro(id2, { alvoSec: 60, secaoId: 's2', instrucao: 'mais forte', base }, nada)
    const ps = chamadas.at(-1)!.prompt
    confere(contar('secao') - antesSecao === 1, '1 chamada')
    confere(ps.includes('>>> [s2 · contexto] ← REFAZER ESTA PARTE') && ps.includes('PEDIDO DO EDITOR: mais forte') && ps.includes('Ela vem logo depois de: "Gancho mexido na tela'), 'prompt: secao marcada, pedido e costura')
    const daTela = rs.rascunho.roteiros.find((x) => x.versao === 5)!
    confere(daTela.origem === 'editado' && daTela.secoes[0]!.frases[0]!.texto.startsWith('Gancho mexido'), 'a edicao pendente foi gravada antes (v5)')
    confere(rs.roteiro.versao === 6 && rs.roteiro.derivadoDe === 5 && rs.roteiro.pedido?.tipo === 'secao' && rs.roteiro.pedido.instrucao === 'mais forte', 'v6 derivada da v5, pedido secao')
    const s2nova = rs.roteiro.secoes.find((s) => s.id === 's2')!
    confere(s2nova.frases.length === 2 && s2nova.frases[0]!.texto.startsWith('Parte nova') && s2nova.frases.every((f) => !daTela.secoes.flatMap((s) => s.frases).some((v) => v.id === f.id)), 'secao trocada, ids novos')
    confere(JSON.stringify(rs.roteiro.secoes.filter((s) => s.id !== 's2')) === JSON.stringify(daTela.secoes.filter((s) => s.id !== 's2')), 'as outras secoes ficaram iguais')
    confere(validarRoteiro(rs.roteiro, rs.rascunho.eventos, indice37).every((p) => p.nivel !== 'erro'), 'sem erro')
    const antesDeNovo = contar('secao')
    await escolherVersao(id2, 5)
    const rs2 = await gerarRoteiro(id2, { alvoSec: 60, secaoId: 's2', instrucao: 'mais forte' }, nada)
    confere(contar('secao') - antesDeNovo === 1 && !rs2.doCache, 'mesma base e mesma instrucao de novo: chama a IA (nao devolve a parte recusada do cache)')
    // Uma frase vazia em OUTRA parte barra a aprovacao, nao o "Refazer".
    const comVazia = structuredClone(roteiroAtual(rs2.rascunho)!)
    comVazia.secoes[2]!.frases.push({ ...comVazia.secoes[2]!.frases[0]!, id: 'f99', texto: '' })
    const rs3 = await gerarRoteiro(id2, { alvoSec: 60, secaoId: 's2', base: comVazia }, nada)
    confere(rs3.roteiro.secoes[2]!.frases.some((x) => x.id === 'f99' && x.texto === ''), 'refazer s2 com frase vazia na s3: sai (a vazia continua la, para ele resolver)')

    secao('9. Guardas e falhas')
    const lento = gerarRoteiro(id2, { alvoSec: 90 }, nada)
    confere(/Ja estou escrevendo/.test((await lancou(() => gerarRoteiro(id2, { alvoSec: 60 }, nada))) ?? ''), 'segundo pedido simultaneo e recusado')
    const r90 = await lento
    confere(r90.roteiro.alvoSec === 90 && r90.rascunho.alvoSec === 90, 'alvo 90 vai para a versao e para o rascunho')
    const arquivosAntes = readdirSync(pastaDoCache()).length
    falharProxima = 'A cota gratis do Gemini acabou por hoje.'
    confere((await lancou(() => gerarRoteiro(id2, { alvoSec: 60, instrucao: 'mais curto' }, nada))) === 'A cota gratis do Gemini acabou por hoje.', 'falha da IA vira a nota amigavel')
    confere(readdirSync(pastaDoCache()).length === arquivosAntes, 'falha nao entra no cache')
    confere(/Essa parte nao existe/.test((await lancou(() => gerarRoteiro(id2, { alvoSec: 60, secaoId: 's99' }, nada))) ?? ''), 'secao inexistente: mensagem para a tela')

    secao('10. Lista e disco')
    const lista = await listarRascunhos()
    confere(lista.length === 2 && lista[0]!.id === id2 && lista[0]!.versoes === 10 && lista[0]!.eventos === 18, `lista: ${lista.map((l) => `${l.titulo} v${l.versoes}`).join(', ')}`)
    confere(JSON.stringify(lerRascunhoDoDisco(id2)) === JSON.stringify(r90.rascunho), 'o disco tem o mesmo rascunho que a resposta')
    confere(!readdirSync(pastaDosRascunhos()).some((n) => n.endsWith('.tmp')), 'nenhum temporario sobrou')

    secao('10b. Outra versao, gancho repetido, cancelar, recusa fora do cache, rascunho novo')
    // Outra versao com o mesmo prompt (o gancho da lista nao mudou): chama a IA.
    const n1 = contar('roteiro')
    const o1 = await gerarRoteiro(id2, { alvoSec: 60 }, nada)
    const o2 = await gerarRoteiro(id2, { alvoSec: 60 }, nada)
    confere(contar('roteiro') - n1 >= 2 && !o1.doCache && !o2.doCache, 'outra versao duas vezes: as duas chamam a IA')
    // A IA repete o gancho de uma versao anterior: pede de novo, com o motivo.
    repetirGancho = true
    const n2 = contar('roteiro')
    const o3 = await gerarRoteiro(id2, { alvoSec: 60 }, nada)
    repetirGancho = false
    confere(contar('roteiro') - n2 === 2 && /o gancho saiu igual ao da versão 1/.test(chamadas.at(-1)!.prompt), 'gancho igual ao da v1: nova tentativa com o motivo')
    confere(o3.roteiro.secoes[0]!.frases[0]!.texto.startsWith('Imagina'), 'ficou a versao com o gancho novo')
    // Cancelar: a resposta entra so no historico; a atual e a aprovacao ficam.
    const antesDoCancelar = await aprovarRoteiro(id2, roteiroAtual(lerRascunhoDoDisco(id2))!)
    atrasoMs = 150
    const emCurso = gerarRoteiro(id2, { alvoSec: 60, pedidoId: 'p-cancela' }, nada)
    await new Promise((r) => setTimeout(r, 30))
    confere(cancelarRoteiro(id2, 'p-cancela') && !cancelarRoteiro(id2, 'outro'), 'cancelar acha o pedido pelo id')
    const cancelado = await emCurso
    atrasoMs = 0
    confere(
      cancelado.soNoHistorico && cancelado.rascunho.atual === antesDoCancelar.atual && cancelado.rascunho.aprovado && cancelado.rascunho.roteiros.length === antesDoCancelar.roteiros.length + 1,
      'cancelado: versao nova so no historico, a atual continua aprovada',
    )
    confere(!cancelarRoteiro(id2, 'p-cancela'), 'depois de terminar, cancelar nao acha mais o pedido')
    // Resposta recusada (nenhum evento valido) nao entra no cache: o "Tente de novo" chama de novo.
    const novo = await abrirRascunho(ID_24, true)
    confere(novo.rascunho.id !== b.rascunho.id && novo.rascunho.eventos.length === 0, 'rascunho NOVO do mesmo episodio (falas mudaram)')
    confere((await abrirRascunho(ID_24)).rascunho.id === novo.rascunho.id, 'reabrir o episodio pega o rascunho novo')
    // Sem o cache dos eventos bons do S04E24 (secao 4): o pedido tem que ir a IA.
    rmSync(pastaDoCache(), { recursive: true, force: true })
    eventosRuins = true
    const n3 = contar('eventos')
    confere(/acontecimentos validos/.test((await lancou(() => gerarEventos(novo.rascunho.id, nada))) ?? ''), 'eventos todos invalidos: erro')
    confere(/acontecimentos validos/.test((await lancou(() => gerarEventos(novo.rascunho.id, nada))) ?? '') && contar('eventos') - n3 === 4, 'tentar de novo chama a IA de novo (2 + 2), nada veio do cache')
    eventosRuins = false

    secao('11. Miniaturas')
    const planosCom = i24.planos.filter((p) => p.keyframe).slice(10, 13).map((p) => p.id)
    const mini = await miniaturasDasCenas(ID_24, [...planosCom, 'nao-existe'])
    confere(mini['nao-existe'] === null && planosCom.every((p) => typeof mini[p] === 'string'), `${planosCom.length} urls, plano inexistente = null`)
    const baixado = await baixar(mini[planosCom[0]!]!)
    confere(baixado.status === 200 && baixado.bytes > 1000 && baixado.bytes < 60_000, `servidor entrega a miniatura (${baixado.status}, ${baixado.tipo}, ${baixado.bytes} bytes)`)
    const pastaMini = join(pastaDosRascunhos(), 'miniaturas', ID_24)
    confere(readdirSync(pastaMini).length === 3 && readdirSync(pastaMini).every((n) => n.endsWith('.webp') && statSync(join(pastaMini, n)).size > 0), 'copias webp no userData, nada na pasta do episodio')
    const mini2 = await miniaturasDasCenas(ID_24, planosCom)
    confere(planosCom.every((p) => mini2[p] === mini[p]), 'pedir de novo devolve a mesma url')

    // Um prompt de roteiro inteiro, para conferir o tamanho que vai ao modelo.
    const tamanho = promptDoRoteiro({ indice: indice37, eventos: r90.rascunho.eventos, alvoSec: 60, elenco: el37 }).length
    console.log(`\n  (prompt de roteiro com 18 eventos: ${tamanho} caracteres)`)
  } finally {
    desfazer()
    rmSync(userData, { recursive: true, force: true })
    rmSync(BIBLIOTECA, { recursive: true, force: true })
  }
  console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
  process.exit(falhas === 0 ? 0 : 1)
}

void principal()
