/**
 * PEDIDOS A2, A3 E A4 DO LEVI (18/10) no passo 2, SEM gastar cota: a IA e
 * trocada por uma falsa que conta as chamadas e guarda sistema e pedido.
 *
 * Cobre:
 * - A4, a PRECEDENCIA: com estilo, as instrucoes dele vem ANTES do tom padrao
 *   e nenhuma regra do tom padrao que briga com ele fica (o "Mano" banido, o
 *   pedido de comentario, a estrutura do app); o "comenta ai" dele nao pede
 *   outra resposta. Sem estilo: a estrutura de short (A3), o exemplo ruim x
 *   bom e a proibicao da "lista de acontecimentos";
 * - a MASCARA: nenhum nome dos exemplos (nem do guia) chega no prompt;
 * - as SECOES: HOOK/BUILD/MOMENTO CHAVE/FECHAMENTO caem nos papeis do app, no
 *   roteiro colado em formato Kiumaz, sem cabecalho nem emoji na fala;
 * - TITULO E THUMB no schema da saida, limpos e herdados pela versao editada;
 * - o REVISOR nos dois modos (corrigir faz a versao Revisada; melhorar faz a
 *   Melhorada, com a conferencia de prova e os mesmos vinculos), a MARCA do
 *   que mudou, o COMPARAR, e o "aprender" que ignora o "Aplicar".
 *
 * Fixture: um episodio INVENTADO e curto (teste/fixture/*-curto.json), para
 * nenhum nome de serie real do prompt se confundir com os dos exemplos.
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-roteiro-estilo-revisor.ts
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { escolherProvedor, gerarJson, type PedidoJson, type RespostaJson } from '../../../electron/services/llm'
import { configureSettings, getSettings, saveSettings, type Cofre } from '../../../electron/services/settings'
import { guardarContexto } from '../electron/contexto'
import { configurarEpisodios } from '../electron/episodio/indice'
import { aprenderDoAprovado, lerEstilo, salvarEstilo, semOAplicarDoRevisor } from '../electron/gerar/estilo'
import { trocarIaParaTeste } from '../electron/gerar/ia'
import { elencoDoEpisodio, nomesDoElenco } from '../electron/gerar/nomes'
import { EXEMPLO_RUIM_E_BOM, sistemaDoRoteiro, SISTEMA_ROTEIRO, TOM_PADRAO } from '../electron/gerar/prompts'
import { aprovarRoteiro, escolherVersao, gravarRascunho, lerRascunhoDoDisco, pastaDosRascunhos } from '../electron/gerar/rascunho'
import { rascunhoComOTexto } from '../electron/gerar/religar'
import { promptDaMelhoria, revisarRoteiro } from '../electron/gerar/revisor'
import { gerarRoteiro } from '../electron/gerar/roteiro'
import { ritmoDoRascunho } from '../electron/voz/ritmo'
import { CONFIG_PADRAO, type ConfigDoRecap } from '../shared/config'
import { lerIndice, type EpisodeIndex } from '../shared/episodio'
import { blocoDoEstilo, ESTILO_VAZIO, INSTRUCOES_MAX, instrucoesParaPrompt, type EstiloDoRecap } from '../shared/estilo'
import { ehPerguntaDeCusto } from '../shared/escritor'
import { conferirMelhorias, limitarCrescimento, trocasDaMelhoria } from '../shared/melhoria'
import { compararVersoes, mudancasNaTela, resumoDaRevisao, type MelhoriaDaIa, type RevisaoDaIa } from '../shared/revisao'
import {
  aplicarEdicao,
  contarPalavras,
  ehParadaNoReserva,
  faixaDePalavras,
  palavrasDoRoteiro,
  papelDoRotulo,
  partesComPapel,
  roteiroAtual,
  roteiroDaIaSchema,
  sugestoesDaVersao,
  trechosChapados,
  validarRoteiro,
  type FraseDaIa,
  type RoteiroDaIa,
  type RoteiroGerado,
  type RoteiroPronto,
} from '../shared/roteiro'

const FIXTURE = join(__dirname, 'fixture')
const BIBLIOTECA = mkdtempSync(join(tmpdir(), 'recap-v-estilo-bib-'))
const DADOS = mkdtempSync(join(tmpdir(), 'recap-v-estilo-dados-'))
const EP = 'ep_5eb9381cd218262a1b509def908a73a54cf0d28c'
const RC = 'rc_5eb9381cd218_mvcurto1'

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

// ------------------------------------------------------------------ o estilo do jeito do Kiumaz (inventado aqui)

/** As instrucoes no formato do guia dele (texto deste teste, com os nomes que o guia de verdade cita). */
const GUIA = `# Estilo de Roteiro — Kiumaz Shorts

O Kiumaz faz roteiros de Shorts com gancho forte e cara de conversa.

## Tom de voz
Use “Mano…”, “Só que…”, “E pra piorar…” e “Mas aí…”.

### 1. Hook
O hook começa com:
> Mano… o Senku acabou de criar um computador no mundo da pedra.

### 2. Contexto
> O Will sempre foi tratado como inútil porque nasceu sem magia.

### 5. Fechamento
Feche com emoção ou com uma pergunta pra comentar.

## Títulos
- Ele Despertou o Maior Poder da História
- O Senku Criou um Computador no Mundo da Pedra

## Thumbnail
- ELE DESPERTOU
- DUAS GAROTAS?!

#anime #shorts #kiumaz`

const EXEMPLO_FRIEREN = `[TÍTULO]
A Frieren rejeitou um herói mais forte que o Himmel | Frieren

### **HOOK (0–4s)**
Mano, a Frieren rejeitou o herói mais forte da humanidade.

### **BUILD (4–20s)**
Como sempre, a Frieren e o grupo aceitam uma missão boba. Só que a estátua não era a do Himmel.

### **MOMENTO CHAVE (20–40s)**
E ele diz que o Himmel ia salvar o mundo, e não ele.

### **FECHAMENTO (40–50s)**
A Frieren sorri… e diz que ele não foi esquecido.`

const EXEMPLO_SUIKA = `[HOOK | 0–8s]
Mano… FINALMENTE CHEGOU A HORA DA SUIKA BRILHAR!

[BUILD | 8–25s]
O plano do Senku era jogar o frasco pro alto. Mas ele é atingido, e o Dr. Xeno manda o Stanley atacar todo mundo.

[MOMENTO CHAVE | 25–45s]
Só que ninguém percebeu que a Suika já tinha fugido com os frascos! 🏃‍♀️✨

[CTA]
Mas me diz aí, quanto tempo ela vai levar?`

/** Os nomes que NUNCA podem chegar no prompt (os dos exemplos e do guia). */
const NOMES_DOS_EXEMPLOS = /\b(Frieren|Himmel|Suika|SUIKA|Senku|Xeno|Stanley|Will)\b/

const KIUMAZ: EstiloDoRecap = {
  ...ESTILO_VAZIO,
  instrucoes: GUIA,
  exemplos: [
    { id: 'xfrieren01', nome: 'A Frieren rejeitou', texto: EXEMPLO_FRIEREN, origem: 'meu', criadoEm: '2026-10-01T00:00:00.000Z' },
    { id: 'xsuika0001', nome: 'A hora da Suika', texto: EXEMPLO_SUIKA, origem: 'meu', criadoEm: '2026-10-02T00:00:00.000Z' },
  ],
}

// ------------------------------------------------------------------ contexto e IA falsos

const configDoModulo: ConfigDoRecap = { ...CONFIG_PADRAO, biblioteca: BIBLIOTECA }
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

interface Chamada {
  etapa: string
  sistema: string
  prompt: string
}
const chamadas: Chamada[] = []
const contar = (etapa?: string): number => chamadas.filter((c) => !etapa || c.etapa === etapa).length
let indice: EpisodeIndex
/** O alvo de palavras da voz padrao (o fake escreve no tamanho certo: sem tentativa de tamanho). */
let alvoDePalavras = 162
let revisaoFalsa: RevisaoDaIa = { frases: [] }
let melhoriaFalsa: MelhoriaDaIa = { frases: [] }
/** O fechamento do roteiro falso: o pedido de comentario do jeito dele. */
const FECHO_COM_CTA = 'Comenta aí o que você achou.'

function fraseDaIa(texto: string, eventoIds: string[], cue: string | null): FraseDaIa {
  return { texto, eventoIds, cueDoMomento: cue, intencaoVisual: 'close no Kaito', textoDeTela: null, citacaoCueId: null, tags: ['rain'], visualEn: 'a boy in the rain' }
}

/** Ganchos bem diferentes entre si (o mesmo gancho de uma versao anterior pede outra resposta). */
const GANCHOS = [
  'Mano… esse garoto foi chutado do grupo por causa de uma bolsa.',
  'Mano… a guilda trocou o melhor carregador por uma mochila mágica.',
  'Mano… ninguém agradeceu o cara que carregava todo mundo.',
  'Mano… a chuva lavou tudo menos a raiva desse menino.',
]
let ganchoN = 0

/** Um roteiro de IA no tamanho do alvo, com o "Mano" no gancho e o "comenta ai" no fechamento. */
function roteiroFalso(): RoteiroDaIa {
  const gancho = GANCHOS[ganchoN++ % GANCHOS.length]!
  const meio: FraseDaIa[] = []
  const palavrasDoMeio = alvoDePalavras - contarPalavras(gancho) - contarPalavras(FECHO_COM_CTA)
  // Cada frase do meio tem 11 palavras.
  const n = Math.max(1, Math.round(palavrasDoMeio / 11))
  for (let i = 0; i < n; i++) {
    const evento = `e0${(i % 6) + 2}`
    meio.push(fraseDaIa(`Só que o Kaito segurou a mochila pela vez ${i + 1} ali.`, [evento], null))
  }
  return {
    secoes: [
      { papel: 'gancho', frases: [fraseDaIa(gancho, ['e01'], 'c0001')] },
      { papel: 'desenvolvimento', frases: meio },
      { papel: 'fechamento', frases: [fraseDaIa(FECHO_COM_CTA, ['e08'], 'c0023')] },
    ],
    titulos: ['**O Garoto Que Carregava a Guilda**', '"Ele Foi Expulso e Ficou Mais Forte"', 'O Garoto Que Carregava a Guilda', 'Quarto Titulo Que Sobra'],
    textosDeThumb: ['foi expulso?!', 'COFRE', 'ELE FICOU MAIS FORTE', 'UM DOIS TRES QUATRO CINCO SEIS'],
  }
}

async function iaFalsa<S extends z.ZodType>(pedido: PedidoJson<S>): Promise<RespostaJson<z.infer<S>>> {
  chamadas.push({ etapa: pedido.etapa, sistema: pedido.sistema, prompt: pedido.prompt })
  let valor: unknown
  if (pedido.etapa === 'roteiro') valor = roteiroFalso()
  else if (pedido.etapa === 'revisao') valor = revisaoFalsa
  else if (pedido.etapa === 'melhoria') valor = melhoriaFalsa
  else throw new Error(`etapa inesperada: ${pedido.etapa}`)
  const conferido = pedido.schema.safeParse(valor)
  if (!conferido.success) throw new Error(`resposta falsa fora do schema (${pedido.etapa})`)
  return { ok: true, valor: conferido.data, provedor: 'gemini', modelo: 'gemini-falso' }
}

/** A fixture de volta ao comeco (v1, a lista de fatos) entre as partes. */
function rascunhoDoComeco(): void {
  copyFileSync(join(FIXTURE, 'rascunho-curto.json'), join(pastaDosRascunhos(), `${RC}.json`))
}

async function principal(): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'recap-v-estilo-'))
  const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
  configureSettings(userData, cofreFalso)
  saveSettings({ libraryDir: '', geminiApiKey: 'chave-falsa-do-teste', iaProvedor: 'gemini', geminiModelo: '', anthropicApiKey: '' })
  guardarContexto(contextoFalso())
  configurarEpisodios(userData)
  mkdirSync(join(BIBLIOTECA, '_indices', EP), { recursive: true })
  copyFileSync(join(FIXTURE, 'indice-curto.json'), join(BIBLIOTECA, '_indices', EP, 'episodio.json'))
  mkdirSync(pastaDosRascunhos(), { recursive: true })
  rascunhoDoComeco()
  indice = lerIndice(JSON.parse(readFileSync(join(BIBLIOTECA, '_indices', EP, 'episodio.json'), 'utf8')))
  const elenco = nomesDoElenco(elencoDoEpisodio(indice))
  alvoDePalavras = faixaDePalavras(60, ritmoDoRascunho(lerRascunhoDoDisco(RC)).ritmo).alvo
  const desfazer = trocarIaParaTeste(iaFalsa)

  try {
    secao('1. A4: com estilo, o tom e a estrutura sao DELE')
    const bloco = blocoDoEstilo(KIUMAZ, elenco)!
    const sis = sistemaDoRoteiro(bloco)
    const iInstr = sis.indexOf('INSTRUÇÕES DELE')
    const iTom = sis.indexOf('TOM PADRÃO DO APP')
    const iFixas = sis.indexOf('REGRAS FIXAS — ')
    confere(iInstr > 0 && iInstr < iTom && iTom < iFixas, `as instrucoes dele vem ANTES do tom padrao e das regras fixas (${iInstr} < ${iTom} < ${iFixas})`)
    const brigam = TOM_PADRAO.filter((r) => r.brigaComEstilo)
    confere(brigam.length >= 4 && brigam.every((r) => !sis.includes(r.texto)), `nenhuma das ${brigam.length} regras de tom que brigam com o estilo fica`)
    confere(
      ['BANIDO abrir com "Mano"', 'no máximo UM no roteiro inteiro', 'Nada de pedido ao espectador', 'NÍVEL 1', 'ESTRUTURA DE SHORT', 'EXEMPLO DE FORMA'].every((t) => !sis.includes(t)),
      'sem o "Mano" banido, o vocativo contado, o pedido ao espectador proibido, a hierarquia e a estrutura do app',
    )
    confere(TOM_PADRAO.filter((r) => !r.brigaComEstilo).every((r) => sis.indexOf(r.texto) > iInstr), 'o tom que nao briga fica, DEPOIS dele (so onde o estilo nao disser nada)')
    confere(
      ['REGRA ZERO', 'HIPÓTESE TEM DONO', 'Escreva os nomes exatamente como no ELENCO', 'FORMATO DE CADA FRASE', 'TÍTULO E THUMB', 'AS SEÇÕES DO APP RECEBEM A ESTRUTURA DELE'].every((t) => sis.includes(t)),
      'as regras fixas ficam: fidelidade, hipotese, nomes, formato, titulo; e o mapa das secoes',
    )
    confere(sis.includes('MOMENTO CHAVE, CLÍMAX → climax') && sis.includes('HOOK → gancho'), 'o mapa diz HOOK -> gancho e MOMENTO CHAVE -> climax')

    secao('2. A3: sem estilo, a estrutura de short')
    confere(
      ['ESTRUTURA DE SHORT', 'ANTES DA METADE', 'PROIBIDO "LISTA DE ACONTECIMENTOS"', 'EXEMPLO DE FORMA', '"mas", "só que", "até que", "e aí"', 'BANIDO abrir com "Mano"', 'CONSEQUÊNCIA depois'].every((t) =>
        SISTEMA_ROTEIRO.includes(t),
      ),
      'gancho -> injustica -> virada antes da metade, conectivos, sem lista de fatos, corte do que nao tem consequencia',
    )
    confere(!SISTEMA_ROTEIRO.includes('ESTILO DO EDITOR') && !SISTEMA_ROTEIRO.includes('AS SEÇÕES DO APP RECEBEM'), 'sem estilo: nada do estilo nem do mapa')
    confere(
      EXEMPLO_RUIM_E_BOM.includes('RUIM') && EXEMPLO_RUIM_E_BOM.includes('BOM') && EXEMPLO_RUIM_E_BOM.includes('[PERSONAGEM 1]') && !/\b(Lent|Guy|Misa|Elle|Empee|mana)\b/.test(EXEMPLO_RUIM_E_BOM),
      'o exemplo ruim x bom vai mascarado (sem os nomes nem o termo da serie)',
    )

    secao('3. Mascara: nome de exemplo nunca chega no prompt')
    const instr = instrucoesParaPrompt(KIUMAZ, elenco)
    confere(!NOMES_DOS_EXEMPLOS.test(instr) && instr.includes('o [PERSONAGEM') && instr.includes('Ele Despertou o Maior Poder da História'), 'no guia: "o Senku"/"o Will" mascarados, o titulo de exemplo intacto')
    confere(instr.includes('Kiumaz') && instr.includes('Shorts'), 'palavra comum com maiuscula fica (Kiumaz, Shorts)')
    salvarEstilo(KIUMAZ)
    const g1 = pronto(await gerarRoteiro(RC, { alvoSec: 60 }, nada))
    const pedido1 = chamadas.filter((c) => c.etapa === 'roteiro')
    const inteiro = `${pedido1.at(-1)!.sistema}\n${pedido1.at(-1)!.prompt}`
    confere(!NOMES_DOS_EXEMPLOS.test(inteiro), 'NENHUM nome dos exemplos nem do guia no pedido (sistema + prompt)')
    confere(inteiro.includes('Dr. Xeno') === false && inteiro.includes('[PERSONAGEM'), '"Dr. Xeno" vira mascara')

    secao('4. O "comenta ai" e o "Mano" dele nao pedem outra resposta')
    confere(pedido1.length === 1, `com estilo: UMA chamada de roteiro (${pedido1.length})`)
    confere(pedido1[0]!.prompt.includes('LEMBRETE') && pedido1[0]!.prompt.includes('na estrutura do estilo dele'), 'o pedido lembra do estilo e a divisao e a dele')
    const textoG1 = g1.roteiro.secoes.flatMap((s) => s.frases.map((f) => f.texto)).join(' ')
    confere(textoG1.includes(FECHO_COM_CTA) && textoG1.startsWith('Mano…'), 'o roteiro fica com o "Mano…" e o "comenta ai" dele')
    const r1 = lerRascunhoDoDisco(RC)
    const comEstilo = validarRoteiro(g1.roteiro, r1.eventos, indice, undefined, { estilo: true }).map((p) => p.codigo)
    const semEstilo = validarRoteiro(g1.roteiro, r1.eventos, indice).map((p) => p.codigo)
    confere(!comEstilo.includes('cta') && semEstilo.includes('cta'), 'pedido de comentario: aviso so sem estilo')
    salvarEstilo(ESTILO_VAZIO)
    const n4 = contar('roteiro')
    pronto(await gerarRoteiro(RC, { alvoSec: 60 }, nada))
    confere(
      contar('roteiro') - n4 === 2 && chamadas.filter((c) => c.etapa === 'roteiro').at(-1)!.prompt.includes(`Pedido de like ou comentario em "${FECHO_COM_CTA}"`),
      `sem estilo, o mesmo "comenta ai" pede outra resposta (${contar('roteiro') - n4} chamadas)`,
    )
    const pedidoSem = chamadas.filter((c) => c.etapa === 'roteiro').at(-2)!
    confere(pedidoSem.prompt.includes('DIVISÃO (frases por seção, nesta ordem): gancho 2, contexto 3, virada 2, desenvolvimento 6') && !pedidoSem.prompt.includes('LEMBRETE'), 'sem estilo: a divisao da estrutura de short, virada antes da metade')

    secao('5. Titulo e thumb no mesmo pedido')
    const props = (z.toJSONSchema(roteiroDaIaSchema) as { required?: string[] }).required ?? []
    confere(props.includes('titulos') && props.includes('textosDeThumb') && props.includes('secoes'), 'o schema da saida pede titulos e textosDeThumb (sem pedido a mais)')
    const sug = g1.roteiro.sugestoes
    confere(
      !!sug && sug.titulos.length === 3 && sug.titulos[0] === 'O Garoto Que Carregava a Guilda' && sug.titulos[1] === 'Ele Foi Expulso e Ficou Mais Forte',
      `titulos limpos (sem negrito nem aspas), sem repetir, no maximo 3: ${JSON.stringify(sug?.titulos)}`,
    )
    confere(!!sug && JSON.stringify(sug.thumbs) === JSON.stringify(['FOI EXPULSO?!', 'ELE FICOU MAIS FORTE']), `thumb em CAIXA ALTA, de 2 a 5 palavras: ${JSON.stringify(sug?.thumbs)}`)
    const editado = aplicarEdicao(lerRascunhoDoDisco(RC), { ...g1.roteiro, secoes: g1.roteiro.secoes.map((s, i) => (i === 0 ? { ...s, frases: [{ ...s.frases[0]!, texto: 'Mano, o Kaito sumiu com tudo.' }] } : s)) }, new Date().toISOString())
    const ed = roteiroAtual(editado)!
    confere(ed.origem === 'editado' && !ed.sugestoes && sugestoesDaVersao(editado, ed.versao)?.titulos[0] === 'O Garoto Que Carregava a Guilda', 'a versao editada mostra as sugestoes da versao de onde saiu')

    secao('6. Secoes: a estrutura dele cai nos papeis do app')
    confere(
      papelDoRotulo('HOOK (0–4s)') === 'gancho' &&
        papelDoRotulo('BUILD 1') === 'desenvolvimento' &&
        papelDoRotulo('MOMENTO CHAVE | 25–50s') === 'climax' &&
        papelDoRotulo('FECHAMENTO') === 'fechamento' &&
        papelDoRotulo('CTA') === 'fechamento' &&
        papelDoRotulo('PLOT TWIST') === 'virada' &&
        papelDoRotulo('CONTEXTO') === 'contexto' &&
        papelDoRotulo('Clímax + Fechamento') === 'fechamento' &&
        papelDoRotulo('MISSÃO DA ESTÁTUA') === null,
      'HOOK, BUILD, MOMENTO CHAVE, FECHAMENTO, CTA, PLOT TWIST -> os papeis; rotulo livre -> null',
    )
    const colado = `## 🎬 ROTEIRO SHORTS

[TÍTULO]
O garoto que carregava a guilda

**[HOOK | 0–8s]**
Mano… o **Kaito** carregou a guilda nas costas por anos 🔥

---

### 🔵 BUILD 1
Só que o Bram vivia zombando da mochila dele.
E pra piorar, compraram uma bolsa mágica.

### **MOMENTO CHAVE (25–40s)**
Até que a mochila dele brilhou na chuva.

### 🔴 FECHAMENTO
E agora quem vai carregar a guilda?`
    const partes = partesComPapel(colado)
    confere(JSON.stringify(partes.map((p) => p.papel)) === JSON.stringify(['gancho', 'desenvolvimento', 'climax', 'fechamento']), `colado no formato dele: ${partes.map((p) => p.papel).join(', ')}`)
    const falas = partes.flatMap((p) => p.frases).join(' | ')
    confere(!/HOOK|BUILD|MOMENTO|FECHAMENTO|ROTEIRO|\*|🔥|---|garoto que carregava/.test(falas) && falas.includes('Mano… o Kaito carregou'), `sem cabecalho, titulo, negrito nem emoji na fala: "${falas.slice(0, 80)}..."`)
    confere(partes[1]!.frases.length === 2, 'as linhas do bloco viram frases pelo ponto final')
    const pelaTela = rascunhoComOTexto(lerRascunhoDoDisco(RC), { texto: colado, modo: 'meu-roteiro' }, new Date().toISOString())
    const coladoNaVersao = roteiroAtual(pelaTela.rascunho)!
    confere(
      JSON.stringify(coladoNaVersao.secoes.map((s) => s.papel)) === JSON.stringify(['gancho', 'desenvolvimento', 'climax', 'fechamento']) && pelaTela.frases.every((f) => f.destino === 'nova'),
      '"Meu roteiro": as partes nascem com os papeis dele, todas por ligar (o religar segue igual)',
    )
    const simples = partesComPapel('Primeira frase. Segunda frase.\n\nTerceira parte aqui.')
    confere(simples.length === 2 && simples.every((p) => p.papel === null), 'texto sem cabecalho: o de sempre (linha em branco, papel pela posicao)')

    secao('7. Lista de fatos (A3)')
    rascunhoDoComeco()
    const v1 = roteiroAtual(lerRascunhoDoDisco(RC))!
    const chapados = trechosChapados(v1)
    confere(chapados.length === 1 && chapados[0]![0] === 'f03' && chapados[0]!.at(-1) === 'f12', `a v1 da fixture: ${chapados.map((t) => `${t[0]}-${t.at(-1)}`).join(', ')}`)
    const aviso = validarRoteiro(v1, lerRascunhoDoDisco(RC).eventos, indice).find((p) => p.codigo === 'lista-de-fatos')
    confere(!!aviso && !aviso.secaoId && aviso.mensagem.includes('f03-f12'), `aviso na barra: "${aviso?.mensagem}"`)

    secao('8. Revisor: "Corrigir erros" faz a versao Revisada')
    revisaoFalsa = {
      frases: [
        { fraseId: 'f07', problema: 'contradiz', motivo: 'Foi a Rina quem achou.', sugestao: 'A Rina achou uma chave dourada no fundo da caverna.' },
        { fraseId: 'f04', problema: 'confusa', motivo: 'De quem?', sugestao: null },
      ],
    }
    const nRev = contar('revisao')
    const corrigida = await revisarRoteiro(RC, false, 'corrigir')
    confere(corrigida.pulada === null && contar('revisao') - nRev === 1, 'um pedido, no provedor padrao')
    if (corrigida.pulada === null) {
      const nova = roteiroAtual(corrigida.rascunho)!
      confere(corrigida.versaoNova === 2 && nova.versao === 2 && nova.revisada === true && nova.derivadoDe === 1, 'a versao Revisada vira a da tela, derivada da v1')
      confere(corrigida.trocadas === 1 && corrigida.marcadas === 2 && resumoDaRevisao(corrigida) === '1 frase corrigida · 1 marcada', `resumo: "${resumoDaRevisao(corrigida)}"`)
      const marcas = mudancasNaTela(corrigida.rascunho, nova)
      confere(marcas.size === 1 && marcas.get('f07')?.antes === 'O grupo encontrou uma chave dourada na caverna.' && marcas.get('f07')?.modo === 'corrigir', 'a marca da frase trocada leva o texto de antes')
    }
    const auto = await revisarRoteiro(RC, true, 'corrigir')
    confere(auto.pulada === null && auto.versaoNova === null && lerRascunhoDoDisco(RC).roteiros.length === 2, 'o automatico (depois de gerar) so marca: nenhuma versao nova')

    secao('9. Revisor: "Melhorar texto" com a conferencia de prova')
    rascunhoDoComeco()
    salvarEstilo(KIUMAZ)
    melhoriaFalsa = {
      frases: [
        { fraseId: 'f03', motivo: 'lista de fatos', sugestao: 'Era o Kaito quem levava tudo. Sozinho.' },
        { fraseId: 'f05', motivo: 'lista de fatos', sugestao: 'E o pior: a mochila dele virou piada.' },
        { fraseId: 'f08', motivo: 'virada tarde', sugestao: 'Só que, na taverna, o Bram chorou e expulsou o Kaito.' },
        { fraseId: 'f12', motivo: 'final seco', sugestao: 'Até que a Rina e o Bram apareceram juntos.' },
        { fraseId: 'f99', motivo: 'nao existe', sugestao: 'Frase de mentira.' },
        { fraseId: 'f13', motivo: 'igual', sugestao: 'E agora, o que a guilda vai fazer sem ele?' },
      ],
    }
    const nMel = contar('melhoria')
    const melhorada = await revisarRoteiro(RC, false, 'melhorar')
    const pedidoMel = chamadas.filter((c) => c.etapa === 'melhoria').at(-1)!
    confere(melhorada.pulada === null && contar('melhoria') - nMel === 1, 'um pedido so')
    confere(pedidoMel.prompt.includes('TRECHOS CHAPADOS que o app achou (reescreva estes primeiro): f03-f12'), 'o pedido aponta os trechos chapados')
    confere(pedidoMel.sistema.includes('ESTILO DO EDITOR') && pedidoMel.sistema.includes('MESMOS FATOS') && !NOMES_DOS_EXEMPLOS.test(`${pedidoMel.sistema}${pedidoMel.prompt}`), 'segue o estilo dele (mascarado) e a regra dos mesmos fatos')
    if (melhorada.pulada === null) {
      const nova = roteiroAtual(melhorada.rascunho)!
      const base = melhorada.rascunho.roteiros.find((v) => v.versao === 1)!
      const fs = nova.secoes.flatMap((s) => s.frases)
      const f03 = fs.findIndex((f) => f.id === 'f03')
      confere(nova.melhorada === true && nova.origem === 'ia' && nova.derivadoDe === 1 && melhorada.versaoNova === nova.versao, `a versao Melhorada (v${nova.versao}) vira a da tela`)
      confere(melhorada.trocadas === 2 && resumoDaRevisao(melhorada) === '2 frases melhoradas', `"${resumoDaRevisao(melhorada)}": o termo vigiado e o nome sem prova voltaram atras`)
      confere(fs.find((f) => f.id === 'f08')!.texto === base.secoes[2]!.frases[2]!.texto && fs.find((f) => f.id === 'f12')!.texto === 'A Rina apareceu e disse que ia com ele.', 'f08 ("chorou") e f12 (o Bram sem prova) ficaram como eram')
      const dividida = fs[f03 + 1]!
      confere(fs[f03]!.texto === 'Era o Kaito quem levava tudo.' && dividida.texto === 'Sozinho.' && dividida.id === 'f14' && JSON.stringify(dividida.eventoIds) === '["e01"]', 'uma frase vira duas: a segunda com id novo e os mesmos vinculos')
      const f05 = fs.find((f) => f.id === 'f05')!
      const f05base = base.secoes[1]!.frases[2]!
      confere(f05.texto === 'E o pior: a mochila dele virou piada.' && f05.cueDoMomento === f05base.cueDoMomento && f05.intencaoVisual === f05base.intencaoVisual, 'a frase melhorada mantem o momento e a intencao visual')
      const marcas = mudancasNaTela(melhorada.rascunho, nova)
      confere(marcas.size === 3 && marcas.get('f05')?.antes === f05base.texto && marcas.get('f14')?.antes === '' && marcas.get('f05')?.modo === 'melhorar', 'as marcas: as trocadas (com o texto de antes) e a metade nova')
      // Mexeu na frase: a marca dela sai; as outras ficam na versao editada.
      const comEdicao = aplicarEdicao(melhorada.rascunho, { ...nova, secoes: nova.secoes.map((s) => ({ ...s, frases: s.frases.map((f) => (f.id === 'f05' ? { ...f, texto: 'A mochila dele virou piada no grupo.' } : f)) })) }, new Date().toISOString())
      const telaEditada = roteiroAtual(comEdicao)!
      const marcas2 = mudancasNaTela(comEdicao, telaEditada)
      confere(telaEditada.origem === 'editado' && !marcas2.has('f05') && marcas2.has('f03'), 'editou a frase: a marca dela sai, a das outras fica')
      const linhas = compararVersoes(base, nova)
      const mudadas = linhas.filter((l) => !l.igual)
      confere(linhas.length === 14 && mudadas.length === 3 && mudadas.some((l) => l.fraseId === 'f14' && l.esquerda === null), `Comparar: ${linhas.length} linhas, ${mudadas.length} mudaram (a metade nova so na direita)`)
      confere(linhas[0]!.abreParte && linhas.filter((l) => l.abreParte).length === 6, 'Comparar: o rotulo de cada parte na primeira linha dela')
    }
    // A mesma versao de novo: do cache, sem pedido.
    await escolherVersao(RC, 1)
    const nMel2 = contar('melhoria')
    const deNovo = await revisarRoteiro(RC, false, 'melhorar')
    confere(deNovo.pulada === null && deNovo.doCache && contar('melhoria') === nMel2, 'melhorar a mesma versao de novo: do cache, nenhum pedido')
    melhoriaFalsa = { frases: [] }
    rascunhoDoComeco()
    salvarEstilo(ESTILO_VAZIO)
    const nadaAMelhorar = await revisarRoteiro(RC, false, 'melhorar')
    confere(
      nadaAMelhorar.pulada === null && nadaAMelhorar.versaoNova === null && resumoDaRevisao(nadaAMelhorar) === 'Nada a melhorar' && !chamadas.at(-1)!.sistema.includes('ESTILO DO EDITOR'),
      'nada a melhorar: nenhuma versao; sem estilo, sem bloco do estilo',
    )
    const unidade = conferirMelhorias(v1, trocasDaMelhoria({ frases: [{ fraseId: 'f09', motivo: 'x', sugestao: 'O Kaito implorou 3 vezes pra ficar.' }] }, v1), lerRascunhoDoDisco(RC).eventos, indice)
    confere(unidade.desfeitas.includes('f09'), 'numero que nao esta na frase nem no evento: desfeita')
    const longas = trocasDaMelhoria(
      {
        frases: [
          { fraseId: 'f03', motivo: 'x', sugestao: 'O Kaito levava todos os suprimentos da guilda nas costas, sozinho, todo santo dia sem parar.' },
          { fraseId: 'f04', motivo: 'x', sugestao: 'O Bram sempre reclamava que ele era lento demais, todo dia.' },
        ],
      },
      v1,
    )
    const cabe = limitarCrescimento(v1, longas, palavrasDoRoteiro(v1))
    confere(cabe.desfeitas.join() === 'f03' && cabe.trocas.map((t) => t.fraseId).join() === 'f04', 'o tempo do short e fixo: a troca que mais cresce volta atras ate caber')
    confere(limitarCrescimento(v1, longas, palavrasDoRoteiro(v1) + 40).desfeitas.length === 0, 'dentro do alvo: nada volta')
    confere(promptDaMelhoria({ indice, eventos: lerRascunhoDoDisco(RC).eventos, elenco: elencoDoEpisodio(indice), roteiro: v1 }).includes('f03: O Kaito levava'), 'o pedido do melhorar leva o roteiro com os ids')

    secao('10. "Aprender" ignora o "Aplicar" do revisor')
    rascunhoDoComeco()
    salvarEstilo({ ...KIUMAZ, aprender: true })
    revisaoFalsa = { frases: [{ fraseId: 'f06', problema: 'fraca', motivo: 'Generica.', sugestao: 'A Rina foi a unica que defendeu o Kaito.' }] }
    const marcou = await revisarRoteiro(RC, true, 'corrigir')
    confere(marcou.pulada === null && marcou.versaoNova === null && marcou.marcadas === 1, 'o automatico marcou f06 com sugestao')
    // O "Aplicar" da marca: a tela troca o texto (edicao comum) e ele aprova.
    const v1b = roteiroAtual(lerRascunhoDoDisco(RC))!
    const aplicada = { ...v1b, secoes: v1b.secoes.map((s) => ({ ...s, frases: s.frases.map((f) => (f.id === 'f06' ? { ...f, texto: 'A Rina foi a unica que defendeu o Kaito.' } : f)) })) }
    const aprovado1 = await aprovarRoteiro(RC, aplicada)
    confere(roteiroAtual(aprovado1)!.origem === 'editado' && lerEstilo().exemplos.every((e) => e.origem !== 'aprendido'), 'aprovar so com o "Aplicar": nada aprendido')
    confere(semOAplicarDoRevisor(aprovado1, roteiroAtual(aprovado1)!).secoes[2]!.frases[0]!.texto === 'A Rina defendia o Kaito na frente de todos.', 'o texto do revisor volta ao de antes na conta')
    // Agora ele digita: aprende.
    const digitada = roteiroAtual(lerRascunhoDoDisco(RC))!
    const dele = { ...digitada, secoes: digitada.secoes.map((s, i) => (i === 0 ? { ...s, frases: s.frases.map((f, j) => (j === 0 ? { ...f, texto: 'Mano, o Kaito segurou a guilda sozinho por anos.' } : f)) } : s)) }
    const aprovado2 = await aprovarRoteiro(RC, dele)
    const aprendidos = lerEstilo().exemplos.filter((e) => e.origem === 'aprendido')
    confere(aprendidos.length === 1 && aprendidos[0]!.texto.includes('Mano, o Kaito segurou'), 'o que ELE digitou conta: virou exemplo')
    confere(!aprenderDoAprovado(aprovado2), 'aprovar de novo o mesmo: sem duplicata')

    secao('11. O guia inteiro cabe (o teto antigo cortava em 4 mil)')
    confere(INSTRUCOES_MAX >= 10_000, `instrucoes ate ${INSTRUCOES_MAX} caracteres`)
    salvarEstilo({ ...KIUMAZ, instrucoes: `${GUIA}\n${'x'.repeat(9000)}` })
    confere(lerEstilo().instrucoes.length > 9000, 'um guia de ~10 mil caracteres fica inteiro')
    salvarEstilo(ESTILO_VAZIO)
    gravarRascunho(lerRascunhoDoDisco(RC))
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
