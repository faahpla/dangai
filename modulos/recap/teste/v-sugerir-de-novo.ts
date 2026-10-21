/**
 * [recap] (21/10) O "SUGERIR DE NOVO" QUE NAO MUDAVA NADA ("Levi: tem a opcao
 * sugerir de novo mas n muda nada"), sobre a FIXTURE do S4-37, sem IA e sem
 * os dados do Levi.
 *
 * O casar e deterministico: refazer uma frase sem nada mudado dava a mesma
 * cena. Com `variar` (o botao), a frase que voltaria igual sai sem os planos
 * de antes; sem `variar` (o automatico, o lembrete de depois de reconhecer),
 * continua igual.
 *
 *   1. sem variar: a frase marcada volta com os mesmos planos (como era);
 *   2. com variar, uma frase: ela muda, sem os planos de antes; as outras ficam;
 *   3. com variar, todas: a maioria muda, nenhum trecho repetido, tudo no zod.
 *
 * Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-sugerir-de-novo.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { configureSettings, saveSettings, type Cofre } from '../../../electron/services/settings'
import { guardarContexto } from '../electron/contexto'
import { configurarEpisodios } from '../electron/episodio/indice'
import { gravarRascunho, pastaDosRascunhos } from '../electron/gerar/rascunho'
import { salvarCenas, sugerirCenas } from '../electron/cenas'
import { escolhaDaFraseSchema, frasesDoRoteiro, type EscolhaDaFrase } from '../shared/cenas'
import { lerIndice, type EpisodeIndex } from '../shared/episodio'
import { lerRascunho, roteiroAtual, type RascunhoDoRecap } from '../shared/roteiro'
import { hashDoTexto, palavrasDaFrase, textoFalado, type TakeDaVoz } from '../shared/voz'

let falhas = 0
function confere(ok: boolean, nome: string): void {
  console.log(`  ${ok ? 'ok ' : 'FALHOU'} ${nome}`)
  if (!ok) falhas++
}
const secao = (nome: string): void => console.log(`\n== ${nome}`)

const FIXTURE = join(__dirname, 'fixture')
const ID_37 = 'ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067'
const RAIZ = mkdtempSync(join(tmpdir(), 'recap-v-sugerir-'))
const BIB = join(RAIZ, 'bib')
const USERDATA = join(RAIZ, 'userData')
const DADOS = join(USERDATA, 'modulos', 'recap')
const SHOTS = join(BIB, 'Dr. Stone', 'S04E37', 'shots')
/** O mesmo que o passo 4 grava na frase pedida (store/gerar-cenas.ts). */
const HASH_VELHO = '0000000000000000'

/** Um take sintetico do roteiro (o mesmo do v-cenas-montar): 0,32 s por palavra. */
function takeDe(r: RascunhoDoRecap): TakeDaVoz {
  const roteiro = roteiroAtual(r)!
  const palavras: TakeDaVoz['palavras'] = []
  const trechos: TakeDaVoz['trechos'] = []
  let t = 0
  for (const f of frasesDoRoteiro(roteiro)) {
    const offset = t
    t += 0.12
    for (const p of palavrasDaFrase(f.texto)) {
      palavras.push({ texto: p, start: t, end: t + 0.28, fraseId: f.id })
      t += 0.32
    }
    t += 0.13
    trechos.push({ fraseId: f.id, offset, duracao: Math.round((t - offset) * 1000) / 1000, hashTexto: hashDoTexto(f.texto), texto: textoFalado(f.texto) })
    t = offset + trechos.at(-1)!.duracao
  }
  const duracao = Math.round(t * 1000) / 1000
  return {
    id: 't1',
    config: { fonte: 'importado', velocidade: 1, cortarPausas: false, audio: { nome: 'teste.wav', hash: 'c'.repeat(64) } },
    arquivo: `narracao-${'a'.repeat(16)}.wav`,
    duracao,
    palavras,
    trechos,
    bruto: { arquivo: `bruto-${'b'.repeat(16)}.wav`, duracao, palavras, trechos },
    origemDoAlinhamento: 'alinhador',
    qualidade: null,
    caracteres: 0,
    cobrados: 0,
    chamadas: [],
    criadoEm: r.criadoEm,
    roteiroVersao: roteiro.versao,
    derivadoDe: null,
    regravadas: [],
    avisos: [],
    volume: null,
  } as TakeDaVoz
}

const planos = (e: EscolhaDaFrase | undefined): string[] =>
  (e?.cenas ?? []).flatMap((c) => [...c.candidato.planoIds, ...(c.baixo?.planoIds ?? [])])
const chave = (e: EscolhaDaFrase | undefined): string => [...planos(e)].sort().join('|')

async function principal(): Promise<void> {
  for (const p of [BIB, DADOS, SHOTS]) mkdirSync(p, { recursive: true })
  const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
  configureSettings(USERDATA, cofreFalso)
  saveSettings({ libraryDir: '' })
  guardarContexto({
    id: 'recap',
    empacotado: false,
    config: () => ({ libraryDir: '', iaProvedor: 'gemini', whisperModel: 'small', modulo: { biblioteca: BIB } }),
    ligado: () => true,
    pasta: (tipo: string) => (tipo === 'dados' ? DADOS : tipo === 'app' ? join(__dirname, '..', '..', '..') : RAIZ),
  } as unknown as ContextoDoModulo)
  configurarEpisodios(DADOS)

  const bruto = JSON.parse(readFileSync(join(FIXTURE, 'indice-s4e37.json'), 'utf8')) as EpisodeIndex
  bruto.planos = bruto.planos.map((p) => ({ ...p, arquivo: join(SHOTS, `${p.id}.mp4`), keyframe: null }))
  mkdirSync(join(BIB, '_indices', ID_37), { recursive: true })
  writeFileSync(join(BIB, '_indices', ID_37, 'episodio.json'), JSON.stringify(bruto))
  for (const p of lerIndice(bruto).planos) writeFileSync(p.arquivo, 'mp4 de teste')

  const r0 = lerRascunho(JSON.parse(readFileSync(join(FIXTURE, 'rascunho-s4e37.json'), 'utf8')))
  const take = takeDe(r0)
  const r: RascunhoDoRecap = {
    ...r0,
    indicePath: join(BIB, '_indices', ID_37, 'episodio.json'),
    voz: { versao: 1, takes: [take], atual: take.id, aprovado: true, aprovadoEm: r0.atualizadoEm } as RascunhoDoRecap['voz'],
  }
  mkdirSync(pastaDosRascunhos(), { recursive: true })
  gravarRascunho(r)
  const frases = frasesDoRoteiro(roteiroAtual(r)!)

  const base = (await sugerirCenas(r.id)).rascunho.cenas!.escolhas
  const daBase = (id: string): EscolhaDaFrase | undefined => base.find((e) => e.fraseId === id)
  const alvo = frases[4]!.id
  // O que o passo 4 faz antes de chamar o main: a frase pedida vira velha (e destravada).
  const marcar = async (ids: string[], de: readonly EscolhaDaFrase[]): Promise<void> => {
    await salvarCenas(r.id, de.filter((e) => ids.includes(e.fraseId)).map((e) => ({ ...e, travada: false, hashTexto: HASH_VELHO })))
  }

  secao('1. Sem variar (o automatico): igual a antes')
  await marcar([alvo], base)
  const s1 = (await sugerirCenas(r.id)).rascunho.cenas!.escolhas
  confere(chave(s1.find((e) => e.fraseId === alvo)) === chave(daBase(alvo)), `a frase volta com os mesmos planos (${chave(daBase(alvo))})`)

  secao('2. Com variar, uma frase')
  await marcar([alvo], s1)
  const s2 = (await sugerirCenas(r.id, true)).rascunho.cenas!.escolhas
  const nova = s2.find((e) => e.fraseId === alvo)
  confere(planos(nova).length > 0 && chave(nova) !== chave(daBase(alvo)), `a frase mudou (${chave(daBase(alvo))} -> ${chave(nova)})`)
  confere(!planos(nova).some((p) => planos(daBase(alvo)).includes(p)), 'nenhum plano de antes na frase')
  confere(
    frases.every((f) => f.id === alvo || chave(s2.find((e) => e.fraseId === f.id)) === chave(daBase(f.id))),
    'as outras frases ficaram como estavam',
  )

  secao('3. Com variar, todas')
  await marcar(
    frases.map((f) => f.id),
    s2,
  )
  const s3 = (await sugerirCenas(r.id, true)).rascunho.cenas!.escolhas
  const mudaram = frases.filter((f) => chave(s3.find((e) => e.fraseId === f.id)) !== chave(s2.find((e) => e.fraseId === f.id))).length
  confere(mudaram >= Math.ceil(frases.length / 2), `a maioria mudou (${mudaram} de ${frases.length})`)
  confere(s3.length === frases.length && s3.every((e) => escolhaDaFraseSchema.safeParse(e).success && e.cenas.length > 0), 'uma escolha valida por frase')
  const vistos: { plano: string; de: number; ate: number }[] = []
  let repetidos = 0
  for (const e of s3)
    for (const c of e.cenas)
      for (const plano of c.candidato.planoIds) {
        const de = c.candidato.inSec
        const ate = Math.min(c.candidato.outSec, de + e.duracao)
        if (vistos.some((v) => v.plano === plano && Math.min(v.ate, ate) - Math.max(v.de, de) > 0.05)) repetidos++
        vistos.push({ plano, de, ate })
      }
  confere(repetidos === 0, 'zero trechos repetidos entre frases')
}

principal()
  .catch((err) => {
    console.error(err)
    falhas++
  })
  .finally(() => {
    rmSync(RAIZ, { recursive: true, force: true })
    console.log(falhas === 0 ? '\nv-sugerir-de-novo: ok' : `\nv-sugerir-de-novo: ${falhas} falha(s)`)
    process.exitCode = falhas === 0 ? 0 : 1
  })
