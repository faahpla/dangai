/**
 * RECONHECER NA MAO (electron/descoberta/ + motor.ts), de verdade: o Python
 * do runtime (ou do .venv), GPU, AniList e o Nia Liston, sem a interface.
 *
 * [recap] Teste MANUAL (como o v-voz-real): usa os episodios do Levi, SO
 * LEITURA, e uma copia do E01 ja cortado. Os caminhos podem ser trocados por
 * RECAP_E01, RECAP_E02 e RECAP_E01_CORTADO.
 *
 * Tudo numa pasta-base TEMPORARIA (perfil, biblioteca e dados do motor). A
 * biblioteca e o perfil reais nunca sao tocados: o E01 ja cortado e COPIADO
 * para <base>/Biblioteca antes (o `preparar` deste script so confere e
 * corrige os caminhos do episodio.json da copia).
 *
 * Fases (cada uma uma chamada):
 *   e01 [base] [saida]
 *     A) inicia, espera os grupos, CANCELA: processo morto, indice intocado.
 *     B) inicia de novo (rostos em cache), grava <saida>/B-grupos.json e
 *        ESPERA o arquivo <saida>/decisao.json (quem roda o teste olha os
 *        recortes e escreve os nomes). Decisao vazia tem que ser recusada sem
 *        matar o processo; a de verdade vai ao motor. Grava B-resultado.json.
 *     Confere: indice com personagens, corte.reconhecer, backup ao lado,
 *     auto_disc_NN.jpg e index.db SO na pasta de dados temporaria, e a pasta
 *     do Corte Cenas e o episodio real sem nenhuma mudanca.
 *   e02 [base] [saida]
 *     Corta + reconhece o E02 (analisarEpisodio, reconhecer: true) com a MESMA
 *     pasta de dados do motor e conta quem foi reconhecido.
 *   semref [base] [saida]  (depois do e01)
 *     O indice parado em 'sem-referencias' SEM planos (_indices): o motor acha
 *     a pasta sozinho, os batizados voltam `conhecido` e o indice vai para a
 *     pasta do episodio.
 *   fechar [base] [saida]
 *     Prazo dos nomes curto (expira e o processo sai) e encerrarMotor com os
 *     grupos na tela (nenhum python orfao).
 *   reabrir [base] [saida]
 *     Cancelar e iniciar de novo na hora: sobe uma rodada NOVA (espera a
 *     velha sair) e a nova chega aos grupos.
 *   travado [base] [saida]
 *     O motor congelado no commit: o "Parar" (so com ele mudo) e o prazo do
 *     salvar matam o processo, liberam a vaga e o indice fica intocado.
 *
 * Rodar da raiz do projeto:
 *   (sem compilar: tsx)
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-descoberta-motor.ts e01 <base> <saida>
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-descoberta-motor.ts e02 <base> <saida>
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { decisaoInicial, type DecisaoDaDescoberta, type EventoDaDescoberta } from '../shared/descoberta'
import { lerIndice, type EventoDoCorte, type FimDaAnalise } from '../shared/episodio'
import {
  cancelarDescoberta,
  confirmarDescoberta,
  descobertaAtual,
  haDescobertaViva,
  iniciarDescoberta,
  trocarEsperaDosNomes,
  trocarPrazosDoSalvar,
  type AvisosDaDescoberta,
} from '../electron/descoberta'
import { configurarEpisodios } from '../electron/episodio/perfil'
import { contarPersonagens, lerPastaDoEpisodio } from '../electron/episodio/pasta-do-episodio'
import { relocarIndice } from '../electron/episodio/relocar'
import { analisarEpisodio, configurarMotor, encerrarMotor, pastaDeDadosDoMotor } from '../electron/motor'
import { configureSettings, saveSettings, type Cofre } from '../../../electron/services/settings'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { guardarContexto } from '../electron/contexto'
import { configurarMotorRuntime } from '../electron/motor-runtime/pastas'

const E01 = process.env['RECAP_E01'] ?? 'C:/Users/levic/Downloads/Nia.Liston.The.Merciless.Maiden.S01E01.Rising.From.the.Darkness.1080p.ADN.WEB-DL.AAC2.0.H.264-VARYG.mkv'
const E02 = process.env['RECAP_E02'] ?? 'C:/Users/levic/Downloads/Nia.Liston.The.Merciless.Maiden.S01E02.A.Job.in.the.Royal.Capital.1080p.ADN.WEB-DL.AAC2.0.H.264-VARYG.mkv'
const ANIME = 'Nia Liston The Merciless Maiden'
const REAL = process.env['RECAP_E01_CORTADO'] ?? 'G:/AniRecap Studio/Biblioteca/Nia Liston The Merciless Maiden/S01E01'

const fase = process.argv[2] ?? 'e01'
const base = resolve(process.argv[3] ?? '.')
const saida = resolve(process.argv[4] ?? join(base, 'saida'))
const raiz = process.cwd()
// Sem argumentos (a rodada de todos os testes) e um teste MANUAL: precisa de
// uma pasta base com a copia do E01. Pula com aviso, sem criar userData na raiz.
if (process.argv[2] === undefined) {
  console.log('PULADO: teste manual -- rode com <fase> <base> <saida> (ver o comeco do arquivo)')
  process.exit(0)
}

let falhas = 0
function confere(cond: unknown, msg: string): void {
  if (cond) console.log(`  ok   ${msg}`)
  else {
    falhas += 1
    console.log(`  FALHA ${msg}`)
  }
}
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const seg = (ms: number): string => `${(ms / 1000).toFixed(1)} s`

// ------------------------------------------------------- pastas intocaveis

type Foto = Map<string, string>
function fotografar(pasta: string, fundo = 3): Foto {
  const foto: Foto = new Map()
  const andar = (dir: string, nivel: number): void => {
    if (nivel > fundo) return
    let itens: string[]
    try {
      itens = readdirSync(dir)
    } catch {
      return
    }
    for (const nome of itens) {
      const p = join(dir, nome)
      try {
        const st = statSync(p)
        foto.set(p, `${st.size}|${st.mtimeMs}`)
        if (st.isDirectory()) andar(p, nivel + 1)
      } catch {
        /* sumiu */
      }
    }
  }
  foto.set(pasta, existsSync(pasta) ? 'existe' : 'ausente')
  andar(pasta, 0)
  return foto
}
function diferencas(antes: Foto, depois: Foto): string[] {
  const out: string[] = []
  for (const [p, v] of depois) if (antes.get(p) !== v) out.push(`${antes.has(p) ? 'mudou' : 'novo'}: ${p}`)
  for (const p of antes.keys()) if (!depois.has(p)) out.push(`sumiu: ${p}`)
  return out
}
const LOCAL = process.env['LOCALAPPDATA'] ?? ''
const INTOCAVEIS = [join(LOCAL, 'CorteCenas'), 'G:/App Corte Cenas/cache', REAL]

// ------------------------------------------------------------------ preparo

const cofreFalso: Cofre = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8'),
}

function preparar(): { biblioteca: string; userData: string } {
  const userData = join(base, 'userData')
  const biblioteca = join(base, 'Biblioteca')
  mkdirSync(userData, { recursive: true })
  mkdirSync(saida, { recursive: true })
  configureSettings(userData, cofreFalso)
  saveSettings({ libraryDir: '' })
  guardarContexto({
    id: 'recap',
    empacotado: false,
    config: () => ({ libraryDir: '', iaProvedor: 'gemini', whisperModel: 'small', modulo: { biblioteca } }),
    ligado: () => true,
    pasta: (tipo: string) => (tipo === 'dados' ? userData : base),
  } as unknown as ContextoDoModulo)
  configurarEpisodios(userData)
  configurarMotor({ userData, appPath: raiz, empacotado: false })
  configurarMotorRuntime({ userData, appPath: raiz, resourcesPath: base, empacotado: false, versaoDoApp: '0.0.0' })
  // Sem a reserva do Corte Cenas: o que reconhecer no E02 tem que vir do batismo.
  process.env['ANIRECAP_ELENCO_RESERVA'] = ''
  return { biblioteca, userData }
}

/** A copia do E01 com os caminhos do episodio.json apontando para ela (nunca para a real). */
function copiaDoE01(biblioteca: string): { pasta: string; id: string } {
  const pasta = join(biblioteca, ANIME, 'S01E01')
  const arquivo = join(pasta, 'episodio.json')
  if (!existsSync(arquivo)) throw new Error(`Copie antes o E01 para ${pasta}`)
  const indice = lerIndice(JSON.parse(readFileSync(arquivo, 'utf8')))
  if (resolve(indice.biblioteca.pasta).toLowerCase() !== resolve(pasta).toLowerCase()) {
    writeFileSync(arquivo, JSON.stringify(relocarIndice(indice, pasta), null, 2), 'utf8')
    console.log('  (copia: caminhos do episodio.json trocados para a pasta temporaria)')
  }
  return { pasta, id: indice.id }
}

/** Avisos que guardam tudo e deixam esperar por um status. */
function gravador(): AvisosDaDescoberta & {
  eventos: EventoDaDescoberta[]
  cortes: EventoDoCorte[]
  ate: (pred: (e: EventoDaDescoberta) => boolean, limiteMs: number) => Promise<EventoDaDescoberta>
} {
  const eventos: EventoDaDescoberta[] = []
  const cortes: EventoDoCorte[] = []
  let ultimaLinha = ''
  return {
    eventos,
    cortes,
    descoberta(e) {
      eventos.push(e)
      const linha = `${e.estado.status} ${e.estado.etapa ?? ''} ${e.estado.progresso ?? '-'} ${e.estado.mensagem}`
      if (linha !== ultimaLinha) {
        ultimaLinha = linha
        console.log(`    [evento] ${linha}`)
      }
    },
    corte(e) {
      cortes.push(e)
      console.log(`    [corte] ${e.estado.status} planos=${e.indice?.planos.length ?? '-'}`)
    },
    async ate(pred, limiteMs) {
      const fim = Date.now() + limiteMs
      while (Date.now() < fim) {
        const achado = [...eventos].reverse().find(pred)
        if (achado) return achado
        await esperar(200)
      }
      throw new Error('o evento esperado nao veio no prazo')
    },
  }
}

async function lanca(fn: () => Promise<unknown>, trecho: string, msg: string): Promise<void> {
  try {
    await fn()
    confere(false, `${msg} (nao lancou)`)
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e)
    confere(texto.includes(trecho), `${msg}: "${texto}"`)
  }
}

// ---------------------------------------------------------------------- e01

async function e01(): Promise<void> {
  const { biblioteca } = preparar()
  const { pasta, id } = copiaDoE01(biblioteca)
  const fotos = INTOCAVEIS.map((p) => fotografar(p))
  const indiceAntes = readFileSync(join(pasta, 'episodio.json'), 'utf8')
  const shotsAntes = readFileSync(join(pasta, 'metadata', 'shots.json'), 'utf8')
  const tempos: Record<string, string> = {}

  console.log('\n[A] inicia, espera os grupos e cancela')
  let av = gravador()
  let t0 = Date.now()
  const a = await iniciarDescoberta({ episodioId: id }, av)
  confere(a.status === 'agrupando' && a.jobId, `estado na hora: ${a.status} ${a.jobId} motivo=${a.motivo}`)
  confere(a.motivo === 'sem-personagens', 'motivo sem-personagens (cenas cortadas sem ninguem)')
  confere(haDescobertaViva(id), 'haDescobertaViva durante')
  await lanca(() => iniciarDescoberta({ episodioId: 'ep_' + '0'.repeat(40) }, gravador()), 'outro episodio', 'outra descoberta ao mesmo tempo')
  const segunda = await iniciarDescoberta({ episodioId: id }, av)
  confere(segunda.jobId === a.jobId, 'segundo clique devolve a mesma (sem subir outro motor)')
  const prontaA = await av.ate((e) => e.estado.status === 'pronta' || e.estado.status === 'falhou', 30 * 60_000)
  tempos['A agrupar (1a vez, rostos calculados)'] = seg(Date.now() - t0)
  if (prontaA.estado.status !== 'pronta') throw new Error(`A falhou: ${prontaA.estado.erro}`)
  confere(prontaA.pronta && prontaA.pronta.grupos.length > 0, `grupos: ${prontaA.pronta?.grupos.length}`)
  const atual = await descobertaAtual(id)
  confere(atual?.pronta?.jobId === a.jobId, 'descobertaAtual devolve os mesmos grupos')
  t0 = Date.now()
  confere(await cancelarDescoberta(a.jobId!), 'cancelarDescoberta = true')
  await av.ate((e) => e.estado.status === 'cancelada' || e.estado.status === 'falhou', 60_000)
  tempos['A cancelar'] = seg(Date.now() - t0)
  confere(av.eventos.at(-1)?.estado.status === 'cancelada', `status final ${av.eventos.at(-1)?.estado.status}`)
  confere(!haDescobertaViva(id), 'haDescobertaViva depois: false')
  confere((await descobertaAtual(id)) === null, 'descobertaAtual depois: null')
  await lanca(() => confirmarDescoberta(a.jobId!, { nomes: { '0': 'X' }, ignorados: [], juntar: [], removidos: {} }), 'expiraram', 'confirmar depois de cancelar')
  confere(readFileSync(join(pasta, 'episodio.json'), 'utf8') === indiceAntes, 'indice intocado pelo cancelamento')
  confere(readFileSync(join(pasta, 'metadata', 'shots.json'), 'utf8') === shotsAntes, 'shots.json intocado pelo cancelamento')

  console.log('\n[B] de novo (rostos em cache), nomes, confirmar')
  av = gravador()
  t0 = Date.now()
  const b = await iniciarDescoberta({ episodioId: id }, av)
  const prontaB = await av.ate((e) => e.estado.status === 'pronta' || e.estado.status === 'falhou', 30 * 60_000)
  tempos['B agrupar (rostos em cache)'] = seg(Date.now() - t0)
  if (prontaB.estado.status !== 'pronta' || !prontaB.pronta) throw new Error(`B falhou: ${prontaB.estado.erro}`)
  const p = prontaB.pronta
  const copias = join(pastaDeDadosDoMotor(), 'descoberta', b.jobId!)
  confere(existsSync(copias), `copias do job em ${copias}`)
  confere(!existsSync(join(pastaDeDadosDoMotor(), 'descoberta', a.jobId!)), 'copias do job A apagadas')
  const grupos = p.grupos.map((g) => ({
    key: g.key,
    cenas: g.cenas,
    rostos: g.totalDeRostos,
    figurante: g.figurante,
    conhecido: g.conhecido,
    sugestao: g.sugestao,
    arquivos: g.rostos.map((_, i) => join(copias, `g${String(g.key).padStart(3, '0')}_${String(i).padStart(3, '0')}.jpg`)),
  }))
  writeFileSync(
    join(saida, 'B-grupos.json'),
    JSON.stringify({ jobId: b.jobId, anime: p.anime, online: p.online, totalDeRostos: p.totalDeRostos, elenco: p.elenco, grupos }, null, 2),
  )
  const principais = p.grupos.filter((g) => !g.figurante)
  console.log(
    `  ${p.grupos.length} grupos (${principais.length} principais, ${p.grupos.length - principais.length} figurantes), ${p.totalDeRostos} rostos, online=${p.online}, elenco=${p.elenco.length} (${p.elenco.filter((e) => e.foto).length} com foto)`,
  )
  for (const g of p.grupos.slice(0, 15)) {
    console.log(`    g${g.key}: ${g.cenas} cenas, ${g.totalDeRostos} rostos${g.figurante ? ' (figurante)' : ''}${g.sugestao ? ` parece ${g.sugestao.nome} ${g.sugestao.similaridade}` : ''}`)
  }

  console.log(`\n  esperando ${join(saida, 'decisao.json')} ...`)
  const arqDecisao = join(saida, 'decisao.json')
  const limite = Date.now() + 50 * 60_000
  while (!existsSync(arqDecisao)) {
    if (Date.now() > limite) throw new Error('decisao.json nao chegou')
    await esperar(1000)
  }
  await esperar(300)
  const decisao = JSON.parse(readFileSync(arqDecisao, 'utf8')) as DecisaoDaDescoberta
  const tEspera = Date.now() - t0
  await lanca(
    () => confirmarDescoberta(b.jobId!, { nomes: {}, ignorados: [], juntar: [], removidos: {} }),
    'pelo menos um',
    'decisao vazia recusada no main',
  )
  confere((await descobertaAtual(id))?.estado.status === 'pronta', 'processo segue esperando depois da recusa')
  t0 = Date.now()
  const resultado = await confirmarDescoberta(b.jobId!, decisao)
  tempos['B salvar (commit + indice)'] = seg(Date.now() - t0)
  tempos['B rodada inteira (com a espera dos nomes)'] = seg(tEspera + (Date.now() - t0))
  writeFileSync(join(saida, 'B-resultado.json'), JSON.stringify({ ...resultado, indice: undefined }, null, 2))
  console.log(`  personagens: ${resultado.personagens.map((x) => `${x.nome}=${x.cenas}`).join(', ')}`)
  console.log(`  cenas com personagem: ${resultado.cenasComPersonagem}/${resultado.totalCenas}; refs: ${resultado.refsSalvas}; descartados: ${resultado.descartados.join(', ') || '-'}`)
  console.log(`  refs em: ${resultado.pastaDasReferencias}`)

  console.log('\n[conferencias]')
  confere(av.eventos.at(-1)?.estado.status === 'feita', 'status final feita')
  confere(av.cortes.length === 1 && av.cortes[0]!.estado.status === 'pronto' && av.cortes[0]!.indice, 'um corteProgresso pronto com o indice')
  const disco = lerIndice(JSON.parse(readFileSync(join(pasta, 'episodio.json'), 'utf8')))
  confere(disco.planos.length === 432, `planos ${disco.planos.length}`)
  confere(disco.planos.some((x) => x.personagens.length > 0), 'planos com personagens no disco')
  confere(disco.corte?.reconhecer === true && disco.reconhecimento === 'feito', `corte.reconhecer=${disco.corte?.reconhecer} reconhecimento=${disco.reconhecimento}`)
  const antigo = JSON.parse(indiceAntes) as { cues: unknown[]; exclusoes: unknown[]; id: string }
  confere(JSON.stringify(disco.cues) === JSON.stringify(antigo.cues) && JSON.stringify(disco.exclusoes) === JSON.stringify(antigo.exclusoes), 'cues e exclusoes iguais')
  confere(readdirSync(pasta).some((n) => /^episodio\.\d{8}-\d{6}(-\d+)?\.json$/.test(n)), 'indice anterior guardado ao lado')
  const dados = lerPastaDoEpisodio(pasta)
  console.log(`  shots.json: ${JSON.stringify(dados ? contarPersonagens(dados) : null)}`)
  const refs = resultado.pastaDasReferencias
  const autoDisc: string[] = []
  if (refs && existsSync(refs)) {
    for (const nome of readdirSync(refs)) {
      const d = join(refs, nome)
      try {
        for (const f of readdirSync(d)) if (f.startsWith('auto_disc_')) autoDisc.push(join(nome, f))
      } catch {
        /* nao e pasta */
      }
    }
  }
  confere(autoDisc.length === resultado.refsSalvas, `auto_disc_NN.jpg no banco: ${autoDisc.length} (esperado ${resultado.refsSalvas})`)
  confere(refs?.toLowerCase().startsWith(pastaDeDadosDoMotor().toLowerCase()), 'refs dentro da pasta de dados TEMPORARIA do motor')
  confere(existsSync(join(pastaDeDadosDoMotor(), 'cache', 'index.db')), 'index.db do motor na pasta temporaria')
  INTOCAVEIS.forEach((pasta, i) => {
    const d = diferencas(fotos[i]!, fotografar(pasta))
    confere(d.length === 0, `intocada: ${pasta}${d.length ? ` (${d.slice(0, 3).join('; ')})` : ''}`)
  })
  console.log('\n[tempos]')
  for (const [k, v] of Object.entries(tempos)) console.log(`  ${k}: ${v}`)
  writeFileSync(join(saida, 'B-tempos.json'), JSON.stringify(tempos, null, 2))
}

// ---------------------------------------------------------------------- e02

async function e02(): Promise<void> {
  const { biblioteca } = preparar()
  const fotos = INTOCAVEIS.map((p) => fotografar(p))
  console.log('\n[E02] cortar + reconhecer com a mesma pasta de dados do motor')
  const t0 = Date.now()
  let resolver: (f: FimDaAnalise) => void = () => {}
  const fimP = new Promise<FimDaAnalise>((r) => {
    resolver = r
  })
  const etapas = new Map<string, number>()
  let ultima = ''
  await analisarEpisodio(
    { path: E02, anime: ANIME, temporada: 1, episodio: 2, kind: '', motor: 'studio', reconhecer: true },
    {
      progresso(p) {
        if (!etapas.has(p.etapaDoMotor)) etapas.set(p.etapaDoMotor, Date.now() - t0)
        const linha = `${p.etapa} ${p.mensagem}`
        if (linha !== ultima && !/^Cena \d+ de/.test(p.mensagem)) {
          ultima = linha
          console.log(`    [${seg(Date.now() - t0)}] ${linha}`)
        }
      },
      fim: resolver,
    },
  )
  const fim = await fimP
  const total = Date.now() - t0
  console.log(`  fim: ${JSON.stringify(fim)}`)
  confere(fim.ok, 'E02 terminou ok')
  if (!fim.ok) return
  const pasta = fim.pastaDoEpisodio
  confere(resolve(pasta).toLowerCase().startsWith(resolve(biblioteca).toLowerCase()), `na biblioteca temporaria: ${pasta}`)
  const dados = lerPastaDoEpisodio(pasta)
  const quem = dados ? contarPersonagens(dados) : []
  const comAlguem = dados ? dados.cenas.filter((c) => c.linhas.some((l) => Array.isArray(l.characters) && l.characters.length > 0)).length : 0
  console.log(`  cenas: ${dados?.cenas.length}; com personagem: ${comAlguem}`)
  console.log(`  quem: ${quem.map((x) => `${x.nome}=${x.cenas}`).join(', ')}`)
  confere(quem.length > 0, 'reconheceu alguem sozinho')
  let timings: unknown = null
  try {
    timings = JSON.parse(readFileSync(join(pasta, 'metadata', 'timings.json'), 'utf8'))
  } catch {
    /* sem */
  }
  INTOCAVEIS.forEach((p, i) => {
    const d = diferencas(fotos[i]!, fotografar(p))
    confere(d.length === 0, `intocada: ${p}${d.length ? ` (${d.slice(0, 3).join('; ')})` : ''}`)
  })
  writeFileSync(
    join(saida, 'E02-resultado.json'),
    JSON.stringify({ segundos: total / 1000, cenas: dados?.cenas.length, comAlguem, quem, etapas: Object.fromEntries(etapas), timings }, null, 2),
  )
  console.log(`  total: ${seg(total)}`)
}

// ------------------------------------------------------------------- semref

/**
 * O caso que o Levi viu: o corte parou em 'sem-referencias' e o indice ficou
 * SEM planos em _indices/<id>. Sintetico a partir da copia do E01 (depois do
 * e01): o motor decide a pasta sozinho (sem outputFolder), tem que cair na
 * mesma S01E01 e reaproveitar o corte; os grupos batizados no e01 voltam
 * `conhecido`, com o nome preenchido.
 */
async function semref(): Promise<void> {
  const { biblioteca } = preparar()
  const { pasta, id } = copiaDoE01(biblioteca)
  const atual = lerIndice(JSON.parse(readFileSync(join(pasta, 'episodio.json'), 'utf8')))
  const pastaIndices = join(biblioteca, '_indices', id)
  mkdirSync(pastaIndices, { recursive: true })
  const quando = new Date().toISOString()
  writeFileSync(
    join(pastaIndices, 'episodio.json'),
    JSON.stringify(
      {
        ...atual,
        planos: [],
        biblioteca: { origem: 'studio', pasta: pastaIndices },
        reconhecimento: 'pulado',
        corte: {
          status: 'falhou',
          jobId: null,
          progresso: null,
          etapa: null,
          mensagem: '',
          motor: 'studio',
          reconhecer: true,
          erro: 'Nenhum personagem ficou com fotos suficientes.',
          inicio: null,
          atualizadoEm: quando,
          descoberta: 'sem-referencias',
        },
      },
      null,
      2,
    ),
  )
  // O indice com planos sai do caminho (fica na copia, com outro nome).
  renameSync(join(pasta, 'episodio.json'), join(pasta, `episodio.semref-${Date.now()}.json`))
  const fotos = INTOCAVEIS.map((p) => fotografar(p))

  console.log('\n[semref] corte parado em sem-referencias, indice sem planos')
  const av = gravador()
  let t0 = Date.now()
  const e = await iniciarDescoberta({ episodioId: id }, av)
  confere(e.motivo === 'sem-referencias' && e.comCorte, `motivo=${e.motivo} comCorte=${e.comCorte}`)
  const pr = await av.ate((x) => x.estado.status === 'pronta' || x.estado.status === 'falhou', 30 * 60_000)
  const tAgrupar = Date.now() - t0
  if (pr.estado.status !== 'pronta' || !pr.pronta) throw new Error(`semref falhou: ${pr.estado.erro}`)
  confere(resolve(pr.pronta.pastaDoEpisodio).toLowerCase() === resolve(pasta).toLowerCase(), `o motor achou a mesma pasta sozinho: ${pr.pronta.pastaDoEpisodio}`)
  const conhecidos = pr.pronta.grupos.filter((g) => g.conhecido)
  console.log(`  ${pr.pronta.grupos.length} grupos; conhecidos: ${conhecidos.map((g) => `g${g.key}=${g.sugestao?.nome}(${g.cenas})`).join(', ')}`)
  confere(conhecidos.length > 0, 'grupos batizados no e01 voltam com nome (conhecido)')
  const inicial = decisaoInicial(pr.pronta)
  confere(Object.keys(inicial.nomes).length === conhecidos.length, 'decisaoInicial preenche os conhecidos')
  t0 = Date.now()
  const r = await confirmarDescoberta(e.jobId!, inicial)
  const tSalvar = Date.now() - t0
  console.log(`  personagens: ${r.personagens.map((x) => `${x.nome}=${x.cenas}`).join(', ')}; ${r.cenasComPersonagem}/${r.totalCenas}`)
  const novo = lerIndice(JSON.parse(readFileSync(join(pasta, 'episodio.json'), 'utf8')))
  confere(novo.planos.length === 432 && novo.corte?.status === 'pronto' && novo.corte.reconhecer, 'indice com planos na pasta do episodio, corte pronto')
  confere(novo.biblioteca.pasta.toLowerCase() === resolve(pasta).toLowerCase(), 'biblioteca.pasta = a pasta do episodio')
  confere(!existsSync(join(pastaIndices, 'episodio.json')) && readdirSync(pastaIndices).some((n) => /^episodio\.\d{8}/.test(n)), 'o de _indices guardado com carimbo (nao apagado)')
  confere(av.cortes.at(-1)?.indice?.planos.length === 432, 'corteProgresso pronto com o indice')
  INTOCAVEIS.forEach((p, i) => {
    const d = diferencas(fotos[i]!, fotografar(p))
    confere(d.length === 0, `intocada: ${p}${d.length ? ` (${d.slice(0, 3).join('; ')})` : ''}`)
  })
  console.log(`\n[tempos] agrupar ${seg(tAgrupar)}; salvar ${seg(tSalvar)}`)
}

// ------------------------------------------------------------------- fechar

/** Processos `python -m app.headless` vivos nesta maquina. */
function processosDoMotor(): number {
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "@(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*app.headless*' }).Count",
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  return Number(String(r.stdout).trim()) || 0
}

/** Prazo dos nomes estourado e o app fechando com os grupos na tela: nada fica orfao. */
async function fechar(): Promise<void> {
  const { biblioteca } = preparar()
  const { id } = copiaDoE01(biblioteca)
  const antes = processosDoMotor()
  console.log(`\n[expira] prazo de 3 s para os nomes (processos do motor antes: ${antes})`)
  trocarEsperaDosNomes(3000)
  let av = gravador()
  const a = await iniciarDescoberta({ episodioId: id }, av)
  confere(a.motivo === 'revisar', `motivo ${a.motivo}`)
  await av.ate((x) => x.estado.status === 'pronta' || x.estado.status === 'falhou', 30 * 60_000)
  confere(processosDoMotor() === antes + 1, 'processo vivo esperando os nomes')
  const f = await av.ate((x) => x.estado.status === 'falhou' || x.estado.status === 'cancelada', 60_000)
  confere(f.estado.status === 'falhou' && /expiraram/.test(f.estado.erro ?? ''), `expirou: ${f.estado.erro}`)
  const ate = Date.now() + 20_000
  while (processosDoMotor() !== antes && Date.now() < ate) await esperar(1000)
  confere(processosDoMotor() === antes, 'processo saiu depois de expirar')
  trocarEsperaDosNomes(null)

  console.log('\n[app fechando] encerrarMotor com os grupos na tela')
  av = gravador()
  await iniciarDescoberta({ episodioId: id }, av)
  await av.ate((x) => x.estado.status === 'pronta' || x.estado.status === 'falhou', 30 * 60_000)
  confere(processosDoMotor() === antes + 1, 'processo vivo esperando os nomes')
  encerrarMotor()
  await esperar(2000)
  confere(processosDoMotor() === antes, 'encerrarMotor matou o processo (sem orfao)')
  const fim = await av.ate((x) => !['agrupando', 'pronta', 'salvando'].includes(x.estado.status), 15_000)
  confere(fim.estado.status === 'falhou' || fim.estado.status === 'cancelada', `estado depois: ${fim.estado.status}`)
  confere(!haDescobertaViva(id), 'nenhuma descoberta viva')
}

// ------------------------------------------------------------------ travado

/** O pid do `python -m app.headless` vivo (o mais novo), ou null. */
function pidDoMotor(): number | null {
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*app.headless*' } | Sort-Object CreationDate | Select-Object -Last 1 -ExpandProperty ProcessId",
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  const pid = Number(String(r.stdout).trim())
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

/** Congela o processo (o motor travado da auditoria de 15/10: NtSuspendProcess). */
function congelar(pid: number): boolean {
  const script = [
    "$t = Add-Type -MemberDefinition '[DllImport(\"ntdll.dll\")] public static extern int NtSuspendProcess(IntPtr h);' -Name Nt -Namespace Cong -PassThru",
    `$p = Get-Process -Id ${pid}`,
    '[Cong.Nt]::NtSuspendProcess($p.Handle)',
  ].join('; ')
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true })
  return String(r.stdout).trim() === '0'
}

/**
 * O motor que trava no commit (achado alto da auditoria de 15/10): antes a
 * tela ficava em "Salvando..." para sempre segurando a vaga. Agora:
 *   [parar] mudo ha MUDO_PARA_PARAR_MS, cancelarDescoberta para (antes disso
 *           recusa), o processo morre, o fim e 'falhou' "Parado...", a
 *           confirmacao e rejeitada e o indice fica intocado;
 *   [prazo] sem ninguem clicar, PRAZO_DO_SALVAR_MS sem sinal mata sozinho.
 */
async function travado(): Promise<void> {
  const { biblioteca } = preparar()
  const { pasta, id } = copiaDoE01(biblioteca)
  const indiceAntes = readFileSync(join(pasta, 'episodio.json'), 'utf8')
  const shotsAntes = readFileSync(join(pasta, 'metadata', 'shots.json'), 'utf8')
  const antes = processosDoMotor()
  trocarPrazosDoSalvar(12_000, 3000)
  try {
    for (const modo of ['parar', 'prazo'] as const) {
      console.log(`\n[${modo}] motor congelado no salvar`)
      const av = gravador()
      const e = await iniciarDescoberta({ episodioId: id }, av)
      const pr = await av.ate((x) => x.estado.status === 'pronta' || x.estado.status === 'falhou', 30 * 60_000)
      if (pr.estado.status !== 'pronta' || !pr.pronta) throw new Error(`${modo}: ${pr.estado.erro}`)
      const pid = pidDoMotor()
      confere(pid !== null && congelar(pid), `processo ${pid} congelado`)
      const decisao: DecisaoDaDescoberta = { nomes: { [String(pr.pronta.grupos[0]!.key)]: 'Teste Travado' }, ignorados: [], juntar: [], removidos: {} }
      const t0 = Date.now()
      const promessa = confirmarDescoberta(e.jobId!, decisao).then(
        () => 'resolveu',
        (err: unknown) => (err instanceof Error ? err.message : String(err)),
      )
      confere((await descobertaAtual(id))?.estado.status === 'salvando', 'salvando')
      if (modo === 'parar') {
        await lanca(() => cancelarDescoberta(e.jobId!), 'Ja esta salvando', 'parar logo no comeco: recusado (o motor pode estar so gravando)')
        await esperar(3500)
        confere((await cancelarDescoberta(e.jobId!)) === true, 'parar com o motor mudo ha 3 s: aceito')
      }
      const fim = await av.ate((x) => x.estado.status === 'falhou' || x.estado.status === 'feita' || x.estado.status === 'cancelada', 60_000)
      const porque = modo === 'parar' ? /Parado/ : /nao respondeu ao salvar/
      confere(fim.estado.status === 'falhou' && porque.test(fim.estado.erro ?? ''), `fim ${fim.estado.status} em ${seg(Date.now() - t0)}: ${fim.estado.erro}`)
      const msg = await promessa
      confere(porque.test(msg), `confirmacao rejeitada: ${msg}`)
      confere(!haDescobertaViva(id), 'vaga do motor livre (nenhuma descoberta viva)')
      const ate = Date.now() + 20_000
      while (processosDoMotor() !== antes && Date.now() < ate) await esperar(1000)
      confere(processosDoMotor() === antes, 'processo congelado morto (sem orfao)')
      confere(readFileSync(join(pasta, 'episodio.json'), 'utf8') === indiceAntes, 'indice intocado')
      confere(readFileSync(join(pasta, 'metadata', 'shots.json'), 'utf8') === shotsAntes, 'shots.json intocado')
    }
  } finally {
    trocarPrazosDoSalvar(null)
  }
}

/**
 * Fechar sem mudanca cancela, e o "Revisar" logo em seguida nao pode pegar a
 * rodada que esta morrendo (o processo leva segundos para sair): antes ela
 * voltava, e o 'cancelada' dela fechava a tela nova.
 */
async function reabrir(): Promise<void> {
  const { biblioteca } = preparar()
  const { id } = copiaDoE01(biblioteca)
  console.log('\n[reabrir] cancelar e iniciar de novo na hora')
  const av = gravador()
  const a = await iniciarDescoberta({ episodioId: id }, av)
  await av.ate((x) => x.estado.status === 'pronta' || x.estado.status === 'falhou', 30 * 60_000)
  confere(await cancelarDescoberta(a.jobId!), 'cancelou')
  const av2 = gravador()
  const t0 = Date.now()
  const b = await iniciarDescoberta({ episodioId: id }, av2)
  confere(b.jobId !== null && b.jobId !== a.jobId, `rodada NOVA (${a.jobId} -> ${b.jobId}) em ${seg(Date.now() - t0)}`)
  confere(b.status === 'agrupando', `status ${b.status}`)
  confere(av.eventos.at(-1)?.estado.status === 'cancelada', 'a velha terminou cancelada antes da nova subir')
  const pr = await av2.ate((x) => x.estado.status === 'pronta' || x.estado.status === 'falhou', 30 * 60_000)
  confere(pr.estado.status === 'pronta' && pr.estado.jobId === b.jobId, `a nova chega aos grupos (${pr.estado.status})`)
  confere(await cancelarDescoberta(b.jobId!), 'cancelou a nova')
  await av2.ate((x) => x.estado.status === 'cancelada', 30_000)
}

async function main(): Promise<void> {
  try {
    if (fase === 'reabrir') await reabrir()
    else if (fase === 'e01') await e01()
    else if (fase === 'e02') await e02()
    else if (fase === 'semref') await semref()
    else if (fase === 'fechar') await fechar()
    else if (fase === 'travado') await travado()
    else throw new Error(`fase desconhecida: ${fase}`)
  } catch (e) {
    falhas += 1
    console.log(`  ERRO ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  } finally {
    encerrarMotor()
  }
  console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
  process.exit(falhas === 0 ? 0 : 1)
}

void main()
