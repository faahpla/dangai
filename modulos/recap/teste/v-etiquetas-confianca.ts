/**
 * [recap] AS ETIQUETAS COM CONFIANCA (19/10): o modulo etiqueta os planos pelo
 * etiquetarComConfianca do nucleo, com o cache na pasta da visao (nunca no
 * etiquetas.json da Biblioteca), guarda a confianca no visao.json e o casar
 * pesa cada etiqueta por ela.
 *
 *   A. as contas puras: o peso pela confianca (a fraca nao conta, sem confianca
 *      vale a posicao como antes), o assunto e a leitura do que foi gravado;
 *   B. o casar: a etiqueta fraca nao leva a cena, a forte leva e pesa mais;
 *      sem confianca (visao.json de antes) tudo como era; o objeto fraco ainda
 *      e assunto;
 *   C. o servico SEM o modelo: o visao.json de antes continua valendo (nada de
 *      baixar 379 MB no passo 4, nada gravado);
 *   D. o servico COM o modelo (RECAP_TESTE_TAGGER = a pasta com o
 *      wd-vit-tagger-v3.onnx e o selected_tags.csv; sem ela, o tagger do
 *      perfil do Dangai, so lido; sem nenhum, pula): o visao.json de antes
 *      reetiqueta sozinho, com a confianca na mesma ordem das tags, os quadros
 *      intactos, o cache some no fim e o etiquetas.json do nucleo nem nasce; a
 *      2a vez nao etiqueta; um corte novo nao herda o cache do velho.
 *
 * Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-etiquetas-confianca.ts
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { configureTagger } from '../../../electron/services/tagger'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { configureSettings, type Cofre } from '../../../electron/services/settings'
import { guardarContexto } from '../electron/contexto'
import { configurarEpisodios } from '../electron/episodio/indice'
import { assuntosDosPlanos, casarFrases, prepararPlanos, type FraseDoCasar, type ResultadoDoCasar } from '../electron/cenas/casar'
import { garantirVisao, sinaisDoEpisodio } from '../electron/cenas/visao'
import type { Cue, EpisodeIndex, Plano } from '../shared/episodio'
import type { Evento } from '../shared/roteiro'
import {
  confiancaDasTagsGravadas,
  pesoDaTag,
  TAG_CHEIA,
  TAG_CORTE,
  TAG_CORTE_DO_ASSUNTO,
  tagsComPeso,
  tagsDoAssunto,
  type SinaisDoCasar,
} from '../shared/visao'

let falhas = 0
function confere(ok: boolean, mensagem: string, extra?: unknown): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}${extra === undefined ? '' : ` -> ${JSON.stringify(extra).slice(0, 300)}`}`)
  }
}
const secao = (nome: string): void => console.log(`\n== ${nome}`)
const perto = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9

// ------------------------------------------------------- o episodio sintetico (B)

const EP = `ep_${'c'.repeat(40)}`
const N = 30
/** 30 planos de 4 s, uma fala por plano (o mesmo desenho do v-cenas-ideias2). */
function montarIndice(): Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'> {
  const planos: Plano[] = []
  const cues: Cue[] = []
  for (let i = 0; i < N; i++) {
    const id = String(i + 1).padStart(4, '0')
    const cueId = `c${id}`
    cues.push({ id: cueId, start: i * 4 + 0.5, end: i * 4 + 3, texto: `fala ${i}`, falante: null, estilo: 'Default', tipo: 'fala' })
    planos.push({ id, start: i * 4, end: i * 4 + 4, arquivo: `C:/fake/${id}.mp4`, keyframe: `C:/fake/${id}_1.jpg`, cueIds: [cueId], falantes: [], personagens: [] })
  }
  return { id: EP, planos, cues, exclusoes: [] }
}
const indice = montarIndice()
const ev = (id: string, de: number, ate: number): Evento => ({
  id,
  cueIds: indice.cues.filter((c) => c.start >= de && c.end <= ate).map((c) => c.id),
  t0: de,
  t1: ate,
  resumo: 'algo acontece',
  personagens: [],
  peso: 3,
})
const eventos = [ev('e01', 0, 24), ev('e02', 24, 48), ev('e03', 48, 72), ev('e04', 72, 120)]
const frase = (id: string, texto: string, eventoIds: string[]): FraseDoCasar => ({ id, texto, eventoIds, cueDoMomento: null, citacaoCueId: null, intencaoVisual: '' })
function casar(frases: FraseDoCasar[], sinais: SinaisDoCasar): ResultadoDoCasar {
  return casarFrases({ indice, eventos, frases, take: null, fixas: new Map(), refazer: new Set(frases.map((f) => f.id)), sinais })
}
const primeira = (r: ResultadoDoCasar, id: string) => r.casadas.find((c) => c.escolha.fraseId === id)?.fita[0]
const termoDaTag = (r: ResultadoDoCasar, fraseId: string, planoId: string): number | null => {
  const c = r.casadas.find((x) => x.escolha.fraseId === fraseId)?.fita.find((x) => x.candidato.planoIds.includes(planoId))
  return c?.termos.find((t) => t.chave === 'tag')?.valor ?? null
}

function puras(): void {
  secao('A. As contas puras')
  confere(pesoDaTag(TAG_CORTE - 0.001, 0) === 0, `abaixo de ${TAG_CORTE} a etiqueta nao conta (mesmo sendo a 1a da lista)`)
  confere(perto(pesoDaTag(TAG_CORTE, 5), 0.5) && perto(pesoDaTag(TAG_CHEIA, 19), 1) && perto(pesoDaTag(0.99, 19), 1), 'com a confianca: 0,5 no corte, 1 a partir da cheia (a posicao nao importa)')
  confere(pesoDaTag(0.6, 0) < pesoDaTag(0.7, 0) && pesoDaTag(0.7, 0) < pesoDaTag(0.8, 0), 'mais confianca, mais peso')
  confere(perto(pesoDaTag(undefined, 0), 1) && perto(pesoDaTag(undefined, 10), 0.75) && perto(pesoDaTag(undefined, 19), 0.525), 'sem confianca: a posicao (a 1a vale 1, a 20a ~0,5), a conta de antes')

  const tags = ['Holding_Paper', 'night', 'holding paper', 'rain']
  const p = new Map([
    ['holding paper', 0.62],
    ['night', 0.36],
    ['rain', 0.9],
  ])
  const pesos = tagsComPeso(tags, p)
  confere([...pesos.keys()].join() === 'holding paper,rain', 'tagsComPeso: normaliza, nao repete e tira a fraca', [...pesos.keys()])
  confere(perto(pesos.get('rain')!, 1) && pesos.get('holding paper')! < 1, 'tagsComPeso: o peso de cada uma pela confianca', [...pesos])
  confere(tagsComPeso(tags, undefined).size === 3, 'tagsComPeso sem confianca: todas as que vieram')
  confere(tagsDoAssunto(['holding', 'paper'], new Map([['holding', TAG_CORTE_DO_ASSUNTO - 0.01], ['paper', TAG_CORTE_DO_ASSUNTO]])).join() === 'paper', `tagsDoAssunto: a partir de ${TAG_CORTE_DO_ASSUNTO}`)
  confere(tagsDoAssunto(['holding', 'paper'], undefined).length === 2, 'tagsDoAssunto sem confianca: todas')

  const gravadas = confiancaDasTagsGravadas({ '0001': ['Night', 'rain'], '0002': ['sword'], '0003': ['a', 'b'] }, { '0001': [0.5, 0.8], '0002': [0.9], '0003': [0.4] })
  confere(gravadas.get('0001')?.get('night') === 0.5 && gravadas.get('0001')?.get('rain') === 0.8 && gravadas.get('0002')?.get('sword') === 0.9, 'a confianca gravada: a mesma ordem das tags, normalizada')
  confere(!gravadas.has('0003'), 'lista torta (tamanhos diferentes) fica de fora: o plano vale pela posicao')
}

function noCasar(): void {
  secao('B. O casar com a confianca')
  // e02 = planos 0007-0012. O 0012 tem "punching" FRACO; o 0009, forte.
  const tagsDoPlano = new Map(
    indice.planos.map((p) => [p.id, p.id === '0012' ? ['punching', 'fighting', '1girl'] : p.id === '0009' ? ['1girl', 'indoors', 'punching'] : ['1girl', 'indoors', 'standing']]),
  )
  const confianca = new Map(
    indice.planos.map((p) => [
      p.id,
      new Map(
        p.id === '0012'
          ? [['punching', 0.38], ['fighting', 0.37], ['1girl', 0.95]]
          : p.id === '0009'
            ? [['1girl', 0.97], ['indoors', 0.8], ['punching', 0.91]]
            : [['1girl', 0.96], ['indoors', 0.7], ['standing', 0.6]],
      ),
    ]),
  )
  const tagsDaFrase = new Map([['f02', ['punching']]])
  const frases = [frase('f01', 'No comeco.', ['e01']), frase('f02', 'E vem o golpe.', ['e02'])]

  const antes = casar(frases, { tagsDoPlano, tagsDaFrase })
  confere(termoDaTag(antes, 'f02', '0012') !== null, 'sem confianca (visao.json de antes): o "punching" do 0012 conta como sempre', termoDaTag(antes, 'f02', '0012'))
  const t12 = termoDaTag(antes, 'f02', '0012')
  const t09 = termoDaTag(antes, 'f02', '0009')
  confere(t12 !== null && t09 !== null && t12 > t09, `sem confianca: pela posicao, a 1a da lista (0012) vale mais que a 3a (0009): ${t12?.toFixed(2)} > ${t09?.toFixed(2)}`)

  const depois = casar(frases, { tagsDoPlano, tagsDaFrase, confiancaDasTags: confianca })
  const f02 = primeira(depois, 'f02')!
  confere(f02.candidato.planoIds[0] === '0009' && f02.candidato.porque.includes('soco'), 'com confianca: o soco forte (0,91) leva a f02 para o 0009', f02.candidato)
  confere(termoDaTag(depois, 'f02', '0012') === null, 'com confianca: o soco fraco (0,38) do 0012 nao conta', termoDaTag(depois, 'f02', '0012'))

  // O peso acompanha a confianca: 0,5 vale menos que 0,91 no mesmo plano.
  const meio = new Map(confianca)
  meio.set('0009', new Map([['1girl', 0.97], ['indoors', 0.8], ['punching', 0.5]]))
  const fraco = casar(frases, { tagsDoPlano, tagsDaFrase, confiancaDasTags: meio })
  const vForte = termoDaTag(depois, 'f02', '0009')
  const vFraco = termoDaTag(fraco, 'f02', '0009')
  confere(vForte !== null && vFraco !== null && vFraco < vForte, `a mesma etiqueta pesa pela confianca (${vFraco?.toFixed(2)} a 0,5 < ${vForte?.toFixed(2)} a 0,91)`)

  // O assunto (o objeto na mao): o objeto fraco ainda conta (a regra do "Lent com o papel").
  const todos = prepararPlanos({ ...indice, planos: indice.planos.slice(0, 3).map((p) => ({ ...p, personagens: [{ nome: 'Lent', conf: 0.95, fonte: 'ancut' as const }] })) })
  const tags3 = new Map([
    ['0001', ['holding', 'outdoors']],
    ['0002', ['paper', 'indoors']],
    ['0003', ['smile']],
  ])
  const conf3 = new Map([
    ['0001', new Map([['holding', 0.39], ['outdoors', 0.8]])],
    ['0002', new Map([['paper', 0.41], ['indoors', 0.9]])],
    ['0003', new Map([['smile', 0.9]])],
  ])
  const assunto = assuntosDosPlanos(todos, tags3, conf3)
  confere(assunto.get('0001')?.objetos.join() === 'mao' && assunto.get('0002')?.objetos.join() === 'papel' && !assunto.has('0003'), 'o "holding" (0,39) e o "paper" (0,41) do Lent ainda sao assunto', [...assunto])
}

// ------------------------------------------------------------------ o servico (C, D)

const RAIZ = mkdtempSync(join(process.env['RECAP_TESTE_PASTA'] ? resolve(process.env['RECAP_TESTE_PASTA']) : tmpdir(), 'recap-v-etiquetas-'))
const USERDATA = join(RAIZ, 'userData')
const DADOS = join(USERDATA, 'modulos', 'recap')
const PASTA_EP = join(RAIZ, 'bib', 'Anime', 'S01E01')

function configurar(): void {
  mkdirSync(DADOS, { recursive: true })
  const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
  configureSettings(USERDATA, cofreFalso)
  guardarContexto({
    id: 'recap',
    empacotado: false,
    config: () => ({ libraryDir: '', iaProvedor: 'gemini', whisperModel: 'small', modulo: { biblioteca: join(RAIZ, 'bib') } }),
    ligado: () => true,
    enviar: () => {},
    pasta: (tipo: string) => (tipo === 'dados' ? DADOS : tipo === 'userData' ? USERDATA : RAIZ),
  } as unknown as ContextoDoModulo)
  configurarEpisodios(DADOS)
}

/** 4 planos com keyframe de verdade (desenhos simples pelo sharp). */
async function episodioDeTeste(atualizadoEm: string): Promise<{ indice: EpisodeIndex; caminho: string }> {
  mkdirSync(join(PASTA_EP, 'keyframes'), { recursive: true })
  const cores = [
    { r: 250, g: 250, b: 250 },
    { r: 20, g: 30, b: 120 },
    { r: 200, g: 40, b: 40 },
    { r: 40, g: 160, b: 60 },
  ]
  const planos: Plano[] = []
  for (let i = 0; i < cores.length; i++) {
    const id = String(i).padStart(4, '0')
    const kf = join(PASTA_EP, 'keyframes', `${id}_1.jpg`)
    if (!existsSync(kf)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="rgb(${cores[i]!.r},${cores[i]!.g},${cores[i]!.b})"/><circle cx="${160 + i * 100}" cy="180" r="${60 + i * 15}" fill="white" stroke="black" stroke-width="6"/></svg>`
      await sharp(Buffer.from(svg)).jpeg().toFile(kf)
    }
    planos.push({ id, start: i * 3, end: i * 3 + 3, arquivo: join(PASTA_EP, 'shots', `${id}.mp4`), keyframe: kf, cueIds: [], falantes: [], personagens: [] })
  }
  const ind = { id: EP, planos, cues: [], exclusoes: [], atualizadoEm } as unknown as EpisodeIndex
  const caminho = join(PASTA_EP, 'episodio.json')
  writeFileSync(caminho, JSON.stringify(ind))
  return { indice: ind, caminho }
}

/** O visao.json como o tagClips deixava (versao 1, tags sem confianca) e quadros de mentira. */
function visaoDeAntes(ind: EpisodeIndex): string {
  const pasta = join(PASTA_EP, 'visao')
  mkdirSync(pasta, { recursive: true })
  const v = {
    versao: 1,
    chave: `${ind.id}|${ind.planos.length}|${ind.atualizadoEm}`,
    quadros: [{ id: `${ind.planos[0]!.id}|1`, arquivo: ind.planos[0]!.keyframe, beleza: 5, nitidez: 100 }],
    cues: [],
    tags: Object.fromEntries(ind.planos.map((p) => [p.id, ['velha', 'outra velha']])),
    gpu: true,
    tempos: { motor: 1, etiquetas: 2 },
  }
  const arquivo = join(pasta, 'visao.json')
  writeFileSync(arquivo, JSON.stringify(v))
  return arquivo
}

async function semModelo(): Promise<void> {
  secao('C. O servico sem o modelo do etiquetador')
  configureTagger(join(RAIZ, 'sem-modelo'))
  const { indice: ind, caminho } = await episodioDeTeste('2026-10-19T10:00:00.000Z')
  const arquivo = visaoDeAntes(ind)
  const antes = readFileSync(arquivo, 'utf8')
  const t0 = Date.now()
  const e = await garantirVisao(ind, caminho, { motor: false, etiquetas: true })
  confere(e.pronta && e.motivo === null, 'o visao.json de antes continua valendo (pronta, sem motivo)', e)
  confere(Date.now() - t0 < 5000 && !existsSync(join(RAIZ, 'sem-modelo')), 'nada baixado (nem a pasta do modelo nasce)')
  confere(readFileSync(arquivo, 'utf8') === antes, 'o visao.json fica como estava')
  const s = sinaisDoEpisodio(ind, caminho)
  confere(s.tagsDoPlano?.get('0000')?.join() === 'velha,outra velha' && s.confiancaDasTags === undefined, 'o casar recebe as tags de antes, sem confianca (vale a posicao)')
}

function pastaDoModelo(): string | null {
  const candidatos = [process.env['RECAP_TESTE_TAGGER'], process.env['APPDATA'] ? join(process.env['APPDATA'], 'Dangai', 'tagger') : undefined]
  for (const c of candidatos) if (c && existsSync(join(c, 'wd-vit-tagger-v3.onnx')) && existsSync(join(c, 'selected_tags.csv'))) return c
  return null
}

async function comModelo(): Promise<void> {
  secao('D. O servico com o modelo: o visao.json de antes reetiqueta sozinho')
  const origem = pastaDoModelo()
  if (!origem) {
    console.log('  (pulei: sem RECAP_TESTE_TAGGER e sem o tagger no perfil do Dangai)')
    return
  }
  // Uma COPIA do modelo num userData temporario: o etiquetas.json do nucleo seria ali.
  const userTagger = join(RAIZ, 'nucleo')
  mkdirSync(join(userTagger, 'tagger'), { recursive: true })
  for (const f of ['wd-vit-tagger-v3.onnx', 'selected_tags.csv']) copyFileSync(join(origem, f), join(userTagger, 'tagger', f))
  configureTagger(userTagger)

  const { indice: ind, caminho } = await episodioDeTeste('2026-10-19T10:00:00.000Z')
  const arquivo = visaoDeAntes(ind)
  const quadrosAntes = JSON.stringify((JSON.parse(readFileSync(arquivo, 'utf8')) as { quadros: unknown }).quadros)
  const t0 = Date.now()
  const e = await garantirVisao(ind, caminho, { motor: false, etiquetas: true })
  const ms = Date.now() - t0
  const v = JSON.parse(readFileSync(arquivo, 'utf8')) as { tags: Record<string, string[]>; confiancas?: Record<string, number[]>; quadros: unknown; versao: number }
  confere(e.pronta && e.motivo === null, `reetiquetou (${ms} ms para ${ind.planos.length} planos)`, e)
  confere(v.versao === 1 && !!v.confiancas && Object.keys(v.tags).length === ind.planos.length, 'o visao.json ganhou as confiancas (mesma versao: quem le so as tags segue igual)', Object.keys(v))
  confere(Object.values(v.tags).every((l) => !l.includes('velha')), 'as tags velhas foram trocadas pelas do etiquetador')
  confere(
    ind.planos.every((p) => (v.tags[p.id] ?? []).length === (v.confiancas?.[p.id] ?? []).length && (v.confiancas?.[p.id] ?? []).every((x) => x > 0.35 && x <= 1)),
    'uma confianca por tag, na mesma ordem, entre 0,35 e 1',
  )
  confere(ind.planos.every((p) => (v.confiancas?.[p.id] ?? []).every((x, i, l) => i === 0 || l[i - 1]! >= x)), 'da mais confiante para a menos')
  confere(JSON.stringify(v.quadros) === quadrosAntes, 'os quadros (o que o motor mediu) ficam intactos')
  confere(!existsSync(join(PASTA_EP, 'visao', 'etiquetas-cache.json')), 'o cache do etiquetador sai no fim (o resultado mora no visao.json)')
  confere(!existsSync(join(userTagger, 'etiquetas.json')), 'o etiquetas.json da Biblioteca do Dangai nem nasce (nenhum id recap/ la)')
  const s = sinaisDoEpisodio(ind, caminho)
  confere(!!s.confiancaDasTags && s.confiancaDasTags.size === ind.planos.length, 'o casar recebe a confianca de cada plano')

  const mtime = statSync(arquivo).mtimeMs
  const t1 = Date.now()
  await garantirVisao(ind, caminho, { motor: false, etiquetas: true })
  confere(statSync(arquivo).mtimeMs === mtime && Date.now() - t1 < 1000, 'a 2a vez nao etiqueta de novo')

  // Corte novo (outro atualizadoEm, os mesmos ids de plano) com um cache que sobrou do velho: nao herda.
  const novo = await episodioDeTeste('2026-10-19T11:00:00.000Z')
  const falso = Object.fromEntries(novo.indice.planos.map((p) => [`recap/${novo.indice.id}/${p.id}`, [{ tag: 'herdada', p: 0.99 }]]))
  writeFileSync(join(PASTA_EP, 'visao', 'etiquetas-cache.json'), JSON.stringify({ version: 1, tags: falso }))
  await garantirVisao(novo.indice, novo.caminho, { motor: false, etiquetas: true })
  const v2 = JSON.parse(readFileSync(arquivo, 'utf8')) as { chave: string; tags: Record<string, string[]>; quadros: unknown }
  confere(v2.chave.endsWith('11:00:00.000Z') && Object.values(v2.tags).every((l) => !l.includes('herdada')), 'corte novo: o cache do corte velho sai antes (nada herdado)')
  confere(v2.quadros === null, 'corte novo sem o motor: os quadros do velho nao valem')
}

async function principal(): Promise<void> {
  puras()
  noCasar()
  configurar()
  await semModelo()
  await comModelo()
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
