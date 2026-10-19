/**
 * [recap] O PASSO 4 E O "ABRIR NO EDITOR" no main do modulo, sobre a FIXTURE
 * (o indice e o rascunho do S4-37 em teste/fixture), sem IA, sem provedor de
 * voz e sem os dados do Levi. Portado do Studio (v-cenas-casar,
 * v-edicao-rapida-montar, v-edicao-rapida-cor-montar), com o que mudou no
 * modulo:
 *
 * 1. as mesclas do Dangai (shared/mesclas.ts): o plano cujo NNNN.mp4 foi para
 *    a lixeira aponta o AAAA-BBBB.mp4 que o contem, com o ponto certo dentro;
 * 2. o casar (por regras): uma escolha por frase, nada em OP/ED, nenhum trecho
 *    repetido, fita de 6, spans so de planos seguidos, porque ASCII, zod;
 * 3. o servico num perfil temporario: sugerir grava, sugerir de novo nao, a
 *    grade, salvar uma troca de cena (travada);
 * 4. montar SEM Edicao rapida: o .dangai em <biblioteca>/_projetos/, versao 2,
 *    `modulos.recap` (versao 1, vozAlinhada, secoes), `transcriptTravado`, o
 *    estilo salvo da legenda, nenhuma trilha; o plano mesclado vira o mesclado
 *    com o sourceStart certo;
 * 5. montar COM a Edicao rapida (sons de fabrica, musica de uma pasta
 *    temporaria, cor, textos na tela): o `papel` em `modulos.recap` dos itens,
 *    o `ducking` do nucleo na musica, a camada de cor, os textos de tela das
 *    frases como clipes de imagem acima da cor (PNG em <projeto>/textos), a
 *    musica no historico do perfil (nunca na pasta de musicas), o resumo com
 *    "SFX de fabrica";
 * 6. nada escrito fora das pastas temporarias.
 *
 * Usa o ffmpeg (a musica e a narracao de teste). Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-cenas-montar.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { configureSettings, saveSettings, type Cofre } from '../../../electron/services/settings'
import { projectFileSchemaQuePreserva } from '@shared/project-file'
import { guardarContexto } from '../electron/contexto'
import { configurarEpisodios } from '../electron/episodio/indice'
import { gravarRascunho, lerRascunhoDoDisco, pastaDosRascunhos } from '../electron/gerar/rascunho'
import { candidatosDaFrase, salvarCenas, sugerirCenas } from '../electron/cenas'
import { casarFrases, prepararPlanos } from '../electron/cenas/casar'
import { mesclasDoIndice } from '../electron/cenas/mesclas'
import { montarProjeto } from '../electron/montar'
import { configurarSom } from '../electron/som/medir'
import {
  candidatoDosPlanos,
  escolhaDaFraseSchema,
  frasesDoRoteiro,
  planosConsecutivos,
  trechosDoCandidato,
  type CandidatoDeCena,
} from '../shared/cenas'
import { lerIndice, type EpisodeIndex } from '../shared/episodio'
import { faixaDoNome, mesclasDosPlanos } from '../shared/mesclas'
import { papelDaSobreposicao, papelDaTrilha, recapDoProjeto } from '../shared/projeto-do-recap'
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
const RAIZ = mkdtempSync(join(tmpdir(), 'recap-v-cenas-'))
const BIB = join(RAIZ, 'bib')
const USERDATA = join(RAIZ, 'userData')
const DADOS = join(USERDATA, 'modulos', 'recap')
const MUSICAS = join(RAIZ, 'musicas')
const SHOTS = join(BIB, 'Dr. Stone', 'S04E37', 'shots')
const ESTILO = { color: '#FFD400', y: 0.42, scale: 1.2, animation: 'elastica', mark: 'tudo', stroke: 4 }

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args])
}

/** Um take sintetico do roteiro: 0,32 s por palavra, 0,25 s entre frases (o arquivo e um WAV de teste). */
function takeDe(r: RascunhoDoRecap, arquivo: string): TakeDaVoz {
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
    arquivo,
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

function sobreposicao(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

async function principal(): Promise<void> {
  // ------------------------------------------------------------ o perfil
  for (const p of [BIB, DADOS, MUSICAS, SHOTS]) mkdirSync(p, { recursive: true })
  const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
  configureSettings(USERDATA, cofreFalso)
  saveSettings({ libraryDir: '' })
  guardarContexto({
    id: 'recap',
    empacotado: false,
    config: () => ({ libraryDir: '', iaProvedor: 'gemini', whisperModel: 'small', modulo: { biblioteca: BIB, pastaDeMusicas: MUSICAS } }),
    ligado: () => true,
    // 'app' = a raiz do repositorio: a fonte das legendas (assets/fonts) dos textos na tela.
    pasta: (tipo: string) => (tipo === 'dados' ? DADOS : tipo === 'app' ? join(__dirname, '..', '..', '..') : RAIZ),
  } as unknown as ContextoDoModulo)
  configurarEpisodios(DADOS)
  configurarSom({ userData: DADOS, reservaDeSfx: join(__dirname, '..', '..', '..', 'assets', 'sfx') })

  // O indice da fixture, com os planos na pasta temporaria (sem os mp4: o casar e a montagem nao abrem video).
  const bruto = JSON.parse(readFileSync(join(FIXTURE, 'indice-s4e37.json'), 'utf8')) as EpisodeIndex
  bruto.planos = bruto.planos.map((p) => ({ ...p, arquivo: join(SHOTS, `${p.id}.mp4`), keyframe: null }))
  mkdirSync(join(BIB, '_indices', ID_37), { recursive: true })
  writeFileSync(join(BIB, '_indices', ID_37, 'episodio.json'), JSON.stringify(bruto))
  const indice = lerIndice(bruto)

  // A MESCLA do Dangai: 0081-0083 no lugar de 0081, 0082 e 0083 (os pedacos "na lixeira").
  writeFileSync(join(SHOTS, '0081-0083.mp4'), 'mesclado de teste')
  for (const p of indice.planos) if (!['0081', '0082', '0083'].includes(p.id)) writeFileSync(p.arquivo, 'mp4 de teste')

  // O rascunho da fixture com um take aprovado (sintetico) e a narracao de teste.
  const r0 = lerRascunho(JSON.parse(readFileSync(join(FIXTURE, 'rascunho-s4e37.json'), 'utf8')))
  const NARRACAO = `narracao-${'a'.repeat(16)}.wav`
  const take = takeDe(r0, NARRACAO)
  const r: RascunhoDoRecap = {
    ...r0,
    indicePath: join(BIB, '_indices', ID_37, 'episodio.json'),
    voz: { versao: 1, takes: [take], atual: take.id, aprovado: true, aprovadoEm: r0.atualizadoEm } as RascunhoDoRecap['voz'],
  }
  mkdirSync(pastaDosRascunhos(), { recursive: true })
  gravarRascunho(r)
  mkdirSync(join(pastaDosRascunhos(), r.id, 'voz'), { recursive: true })
  ffmpeg(['-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.25:duration=${take.duracao}`, '-ar', '48000', '-ac', '1', join(pastaDosRascunhos(), r.id, 'voz', NARRACAO)])
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=40', '-af', 'volume=0.3', '-ar', '44100', join(MUSICAS, 'Tema de teste.mp3')])

  // ===================================================================== 1.
  secao('1. Mesclas do Dangai')
  confere(JSON.stringify(faixaDoNome('0010.mp4')) === '[10,10]' && JSON.stringify(faixaDoNome('0010-0012.mp4')) === '[10,12]' && faixaDoNome('x.mp4') === null, 'faixaDoNome como o mesclar do nucleo')
  const mapa = mesclasDoIndice(indice)
  const p81 = indice.planos.find((p) => p.id === '0081')!
  const p82 = indice.planos.find((p) => p.id === '0082')!
  const p83 = indice.planos.find((p) => p.id === '0083')!
  confere(Object.keys(mapa).sort().join() === '0081,0082,0083', `os 3 pedacos apontam o mesclado (${Object.keys(mapa).join(',')})`)
  confere(mapa['0081']!.inicioNoArquivo === 0 && Math.abs(mapa['0082']!.inicioNoArquivo - (p82.start - p81.start)) < 1e-3, 'o 0082 comeca depois do 0081 dentro do mesclado')
  confere(Math.abs(mapa['0083']!.duracaoDoArquivo - (p83.end - p81.start)) < 1e-3, 'a duracao do mesclado inteiro')
  const puro = mesclasDosPlanos(
    [
      { id: '0010', start: 10, end: 12, arquivo: 'D:/ep/shots/0010.mp4' },
      { id: '0011', start: 12, end: 15, arquivo: 'D:/ep/shots/0011.mp4' },
      { id: '0012', start: 15, end: 16, arquivo: 'D:/ep/shots/0012.mp4' },
      { id: '0013', start: 16, end: 18, arquivo: 'D:/ep/shots/0013.mp4' },
    ],
    (c) => c.endsWith('0012.mp4'),
    ['D:/ep/shots/0010-0011.mp4', 'D:/ep/shots/0013-0014.mp4', 'D:/outro/shots/0010-0013.mp4'],
  )
  confere(
    puro['0011']?.arquivo === 'D:/ep/shots/0010-0011.mp4' && puro['0011'].inicioNoArquivo === 2 && !puro['0012'] && puro['0013']?.inicioNoArquivo === 0,
    'puro: o mesclado da MESMA pasta; o que existe fica; mesclado de outro episodio nao conta',
  )
  const cand = candidatoDosPlanos([p82], ID_37, 'usuario', { porque: ['teste'] })
  const tr = trechosDoCandidato(cand, indice.planos.map((p) => (mapa[p.id] ? { ...p, ...mapa[p.id] } : p)))
  confere(tr.length === 1 && tr[0]!.arquivo.endsWith('0081-0083.mp4') && Math.abs(tr[0]!.de - (cand.inSec - p81.start)) < 1e-3, 'trechosDoCandidato le o mesclado a partir do ponto do plano')

  // ===================================================================== 2.
  secao('2. O casar (fixture S4-37)')
  const roteiro = roteiroAtual(r)!
  const frases = frasesDoRoteiro(roteiro)
  const res = casarFrases({ indice, eventos: r.eventos, frases, take, fixas: new Map(), refazer: new Set(frases.map((f) => f.id)) })
  const escolhas = res.casadas.map((c) => c.escolha)
  const porId = new Map(prepararPlanos(indice).map((p) => [p.plano.id, p]))
  const candidatos: CandidatoDeCena[] = escolhas.flatMap((e) => [...e.fita, ...e.cenas.map((c) => c.candidato)])
  confere(escolhas.length === frases.length, `uma escolha por frase (${escolhas.length}/${frases.length})`)
  confere(!candidatos.some((c) => indice.exclusoes.some((e) => sobreposicao(c.inSec, c.outSec, e.start, e.end) > 0.001)), 'nenhuma cena em OP/ED')
  const vistos: { plano: string; de: number; ate: number }[] = []
  let repetidos = 0
  for (const e of escolhas)
    for (const c of e.cenas)
      for (const plano of c.candidato.planoIds) {
        const de = c.candidato.inSec
        const ate = Math.min(c.candidato.outSec, de + e.duracao)
        if (vistos.some((v) => v.plano === plano && sobreposicao(v.de, v.ate, de, ate) > 0.05)) repetidos++
        vistos.push({ plano, de, ate })
      }
  confere(repetidos === 0, 'zero trechos repetidos entre frases')
  confere(escolhas.every((e) => e.fita.length === 6), `6 candidatos por frase (${escolhas.map((e) => e.fita.length).join(' ')})`)
  confere(candidatos.every((c) => planosConsecutivos(indice, c.planoIds)), 'spans so de planos consecutivos')
  confere(candidatos.every((c) => !c.planoIds.some((id) => porId.get(id)?.fora)), 'nenhum plano curto, de placa ou de OP/ED')
  confere(candidatos.every((c) => c.porque.length <= 4 && c.porque.every((p) => p.length <= 32 && /^[\x20-\x7e]+$/.test(p))), 'porque <= 4 termos ASCII')
  confere(escolhas.every((e) => escolhaDaFraseSchema.safeParse(e).success && e.cenas[0]!.candidato === e.fita[0]), 'escolhas no zod, a cena colocada e a 1a da fita')
  confere(escolhas.every((e, i) => Math.abs(e.duracao - take.trechos[i]!.duracao) < 1e-9), 'cada escolha na duracao REAL da frase no take')

  // ===================================================================== 3.
  secao('3. O servico (perfil temporario)')
  const arquivoDoRascunho = join(pastaDosRascunhos(), `${r.id}.json`)
  const s1 = await sugerirCenas(r.id)
  confere(s1.rascunho.cenas?.escolhas.length === frases.length, `sugerirCenas gravou ${s1.rascunho.cenas?.escolhas.length} escolhas`)
  const antes = readFileSync(arquivoDoRascunho, 'utf8')
  await sugerirCenas(r.id)
  confere(readFileSync(arquivoDoRascunho, 'utf8') === antes, 'sugerir de novo sem mudanca: nada gravado')
  const g = await candidatosDaFrase(r.id, frases[2]!.id, {})
  confere(g.sugestoes.length === 6 && g.vizinhas.every((x) => x.origem === 'vizinha'), `grade: 6 sugestoes, ${g.vizinhas.length} vizinhas`)
  // Troca a cena da f01 pelo plano 0082 (que esta no mesclado): travada.
  const f01 = s1.rascunho.cenas!.escolhas[0]!
  const troca = { ...f01, cenas: [{ candidato: candidatoDosPlanos([p82], ID_37, 'usuario', { porque: ['escolhida'] }), palavraInicio: 0 }], travada: true }
  const s2 = await salvarCenas(r.id, [troca])
  confere(s2.rascunho.cenas!.escolhas[0]!.cenas[0]!.candidato.planoIds.join() === '0082' && s2.rascunho.cenas!.escolhas[0]!.travada, 'salvar: a troca da cena gravada e travada')

  // ===================================================================== 4.
  secao('4. Abrir no editor SEM a Edicao rapida')
  const m1 = await montarProjeto(r.id, { edicaoRapida: null, estilo: ESTILO, presetsDeCor: [] }, { rostos: false })
  confere(m1.projetoPath.startsWith(join(BIB, '_projetos')) && m1.projetoPath.endsWith('.dangai'), `o .dangai em _projetos (${m1.projetoPath.slice(BIB.length)})`)
  const cru1 = JSON.parse(readFileSync(m1.projetoPath, 'utf8')) as Record<string, unknown>
  const f1 = projectFileSchemaQuePreserva.parse(cru1)
  const rec = recapDoProjeto(f1.modulos)
  confere(f1.version === 2 && rec?.versao === 1 && rec.vozAlinhada && rec.rascunhoId === r.id && rec.takeId === 't1', 'versao 2 e modulos.recap (versao 1, vozAlinhada, rascunho, take)')
  confere((rec?.secoes?.length ?? 0) === 6 && rec!.secoes!.every((s) => s.frases.length > 0), 'as 6 partes do roteiro no tempo do take')
  confere(!('studio' in cru1) && f1.transcriptTravado && f1.transcript?.alinhado === true, 'sem `studio` na raiz; transcriptTravado e o transcript alinhado')
  confere(f1.captionColor === ESTILO.color && f1.captionStroke === ESTILO.stroke, 'a legenda no estilo salvo (veio no pedido)')
  confere(f1.trilhas.length === 0 && f1.sobreposicoes.length === 0 && !m1.edicaoRapida, 'sem Edicao rapida: nenhuma trilha nem camada')
  const img = f1.images.find((i) => i.path.endsWith('0081-0083.mp4'))
  const cena = img ? f1.plan!.scenes[f1.images.indexOf(img)] : undefined
  confere(!!img && !!cena && Math.abs((cena.sourceStart ?? 0) - (troca.cenas[0]!.candidato.inSec - p81.start)) < 1e-3, `a cena 0082 vira o mesclado com o sourceStart certo (${cena?.sourceStart})`)
  confere(!f1.images.some((i) => /[\\/](0081|0082|0083)\.mp4$/.test(i.path)), 'nenhum bloco aponta um pedaco que foi para a lixeira')
  confere(existsSync(f1.audio.path) && f1.audio.path.startsWith(join(BIB, '_projetos')), 'a narracao copiada para a pasta do projeto')

  // ===================================================================== 5.
  secao('5. Abrir no editor COM a Edicao rapida (sons de fabrica, musica, cor, textos)')
  const m2 = await montarProjeto(
    r.id,
    { edicaoRapida: { sfx: true, musica: true, rosto: false, legenda: true, cor: true, textos: true, titulo: true }, estilo: ESTILO, presetsDeCor: [] },
    { rostos: false },
  )
  const f2 = projectFileSchemaQuePreserva.parse(JSON.parse(readFileSync(m2.projetoPath, 'utf8')))
  const musica = f2.trilhas.filter((t) => papelDaTrilha(t) === 'musica')
  const sfx = f2.trilhas.filter((t) => papelDaTrilha(t) === 'whoosh' || papelDaTrilha(t) === 'impacto')
  console.log(`  resumo: ${JSON.stringify(m2.edicaoRapida)}`)
  confere(m2.projetoPath !== m1.projetoPath, 'uma pasta por montagem (nunca por cima)')
  confere(musica.length > 0 && musica.every((t) => t.ducking && t.ducking.abaixoDb > 0 && t.path.startsWith(MUSICAS)), 'a musica da pasta, com o ducking do nucleo')
  confere(sfx.length > 0 && sfx.every((t) => t.path.includes('assets')), `${sfx.length} SFX de fabrica (a reserva do app)`)
  confere(f2.trilhas.every((t) => !('papel' in t) && (t.modulos as { recap?: { papel?: string } }).recap?.papel), 'o papel em modulos.recap de cada trecho')
  const cor = f2.sobreposicoes.filter((o) => papelDaSobreposicao(o) === 'cor')
  confere(cor.length === 1 && cor[0]!.tipo === 'ajuste' && cor[0]!.at === 0 && cor[0]!.fileName === 'Cor: Anime vivo' && !('corOriginal' in cor[0]!), 'a camada de cor (Anime vivo) com o papel em modulos.recap')
  confere(m2.edicaoRapida?.musica === 'Tema de teste.mp3' && m2.edicaoRapida.cor === 'Anime vivo' && m2.edicaoRapida.legenda, 'o resumo diz a musica, a cor e a legenda')
  // Os textos de tela do roteiro da fixture (f11 "PLANO REAL" e f14 "7 BILHOES"): acima da cor, no tempo da frase.
  const textos = f2.sobreposicoes.filter((o) => papelDaSobreposicao(o) === 'texto')
  const recap2 = recapDoProjeto(f2.modulos)!
  const frasesNoTempo = new Map(recap2.secoes!.flatMap((s) => s.frases).map((f) => [f.id, f]))
  const fraseDoClipe = (o: (typeof textos)[number]): string => String((o.modulos as { recap: { fraseId: string } }).recap.fraseId)
  confere(
    textos.length === 2 && textos.map(fraseDoClipe).sort().join() === 'f11,f14' && textos.every((o) => o.faixa === cor[0]!.faixa + 1),
    `os 2 textos de tela entram, na faixa acima da cor (${textos.map((o) => `${fraseDoClipe(o)}@V${o.faixa + 1}`).join(', ')})`,
  )
  confere(
    textos.every((o) => {
      const f = frasesNoTempo.get(fraseDoClipe(o))!
      return o.at >= f.inicio - 0.1 && o.at < f.fim && o.tipo === 'image' && (o.chaves?.length ?? 0) === 3 && o.fadeInSec > 0 && existsSync(o.path)
    }),
    'cada um no tempo da sua frase, com o pop e o PNG gravado',
  )
  confere(textos.every((o) => o.path.startsWith(join(m2.projetoPath, '..', 'textos'))), 'os PNGs em <projeto>/textos')
  confere(recap2.secoes!.flatMap((s) => s.frases).find((f) => f.id === 'f11')?.tela === 'PLANO REAL', 'o texto de tela de cada frase em modulos.recap.secoes (o editor roda de novo sem o rascunho)')
  confere(m2.edicaoRapida?.textos?.postos === 2 && f2.hookText === '', `o resumo diz 2 textos; sem texto na 1a frase e sem thumb, sem card ("${f2.hookText}")`)
  const historico = join(DADOS, 'som', 'musicas-usadas.json')
  confere(existsSync(historico) && readFileSync(historico, 'utf8').includes('Tema de teste.mp3'), 'a musica no historico do perfil do modulo')
  confere(readdirSync(MUSICAS).join() === 'Tema de teste.mp3', 'a pasta de musicas so lida (nada gravado la)')

  // ===================================================================== 6.
  secao('6. Nada fora do lugar')
  const raiz = readdirSync(BIB).sort().join()
  confere(raiz === 'Dr. Stone,_indices,_projetos', `a biblioteca so ganhou _projetos (${raiz})`)
  confere(readdirSync(SHOTS).length === indice.planos.length - 3 + 1, 'a pasta shots do episodio intocada (o modulo so le)')
  const disco = lerRascunhoDoDisco(r.id)
  confere(disco.cenas?.takeId === 't1', 'o rascunho com as cenas encaixadas no take aprovado')
}

principal()
  .then(() => {
    rmSync(RAIZ, { recursive: true, force: true })
    console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
    process.exit(falhas === 0 ? 0 : 1)
  })
  .catch((err: unknown) => {
    console.error(err)
    rmSync(RAIZ, { recursive: true, force: true })
    process.exit(1)
  })
