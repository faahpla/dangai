/**
 * [recap] O LOTE 2 das ideias (escolha de cenas, C1-C7), puro, com um
 * episodio sintetico pequeno:
 *
 *   A. sem sinal nenhum e com as camadas desligadas: nada do lote 2 aparece
 *      (o casar fica com as regras de antes);
 *   B. C5, a conta do roteiro inteiro: ordem do episodio, sem repetir e os
 *      pontos fixos (travadas) respeitados;
 *   C. C4: o rosto citado vira regra com candidatos bastantes (e so penaliza
 *      com poucos); o "ela" herda o sujeito; as duas pessoas juntas;
 *   D. C2/C3: a imagem parecida e as etiquetas sobem a nota, com o porque curto;
 *   E. C1: frase sem evento acha a ancora pela fala de mesmo sentido;
 *   F. C7: o trecho do plano longo foge do quadro borrado; a miniatura e o melhor quadro;
 *   G. C6: o juiz (IA falsa): desligado, sem imagem no nucleo, Haiku sem custo, e julgando;
 *   H. as dicas da IA (tags, visualEn) limpas.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-cenas-ideias2.ts
 */
import { casarFrases, porqueCurto, quemOMomentoCita, type FraseDoCasar, type ResultadoDoCasar } from '../electron/cenas/casar'
import { aplicarVeredito, custoDoJuiz, julgar, pedidosDoJuiz, type GerarJsonComImagens } from '../electron/cenas/juiz'
import type { EscolhaDaFrase } from '../shared/cenas'
import type { Cue, EpisodeIndex, Plano } from '../shared/episodio'
import { dicasDasCenas, type Evento } from '../shared/roteiro'
import { CAMADAS_DESLIGADAS, type QuadroDaVisao, type SinaisDoCasar } from '../shared/visao'
import { hashDoTexto } from '../shared/voz'

let falhas = 0
function confere(ok: boolean, mensagem: string, extra?: unknown): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}${extra === undefined ? '' : ` -> ${JSON.stringify(extra).slice(0, 300)}`}`)
  }
}

const EP = `ep_${'b'.repeat(40)}`
const N = 30
/** 30 planos de 4 s (0..120 s), uma fala por plano; a Nia no 3-6, a Lynokis no 8, as duas no 12. */
function montarIndice(): Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'> {
  const planos: Plano[] = []
  const cues: Cue[] = []
  for (let i = 0; i < N; i++) {
    const id = String(i + 1).padStart(4, '0')
    const cueId = `c${String(i + 1).padStart(4, '0')}`
    cues.push({ id: cueId, start: i * 4 + 0.5, end: i * 4 + 3, texto: `fala ${i}`, falante: null, estilo: 'Default', tipo: 'fala' })
    const personagens: Plano['personagens'] = []
    if (i >= 3 && i <= 6) personagens.push({ nome: 'Liston, Nia', conf: 0.95, fonte: 'ancut' })
    if (i === 8) personagens.push({ nome: 'Lynokis', conf: 0.95, fonte: 'ancut' })
    if (i === 12) personagens.push({ nome: 'Liston, Nia', conf: 0.95, fonte: 'ancut' }, { nome: 'Lynokis', conf: 0.95, fonte: 'ancut' })
    planos.push({ id, start: i * 4, end: i * 4 + 4, arquivo: `C:/fake/${id}.mp4`, keyframe: `C:/fake/${id}_1.jpg`, cueIds: [cueId], falantes: [], personagens })
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
const frase = (id: string, texto: string, eventoIds: string[], cueDoMomento: string | null = null): FraseDoCasar => ({
  id,
  texto,
  eventoIds,
  cueDoMomento,
  citacaoCueId: null,
  intencaoVisual: '',
})
function casar(
  frases: FraseDoCasar[],
  extra: { sinais?: SinaisDoCasar; camadas?: Record<string, boolean>; fixas?: Map<string, EscolhaDaFrase> } = {},
): ResultadoDoCasar {
  const fixas = extra.fixas ?? new Map<string, EscolhaDaFrase>()
  return casarFrases({
    indice,
    eventos,
    frases,
    take: null,
    fixas,
    refazer: new Set(frases.map((f) => f.id).filter((id) => !fixas.has(id))),
    ...(extra.sinais ? { sinais: extra.sinais } : {}),
    ...(extra.camadas ? { camadas: extra.camadas } : {}),
  })
}
const primeira = (r: ResultadoDoCasar, id: string) => r.casadas.find((c) => c.escolha.fraseId === id)?.fita[0]
const chaves = (r: ResultadoDoCasar): Set<string> => new Set(r.casadas.flatMap((c) => c.fita.flatMap((x) => x.termos.map((t) => t.chave))))
const LOTE2 = ['imagem', 'sentido', 'tag', 'forte', 'juntos', 'alterna', 'borrado']

/** Vetor de 4 dimensoes, normalizado. */
function vet(...x: number[]): Float32Array {
  const n = Math.hypot(...x) || 1
  return new Float32Array(x.map((v) => v / n))
}
const neutro = (i: number): Float32Array => vet(1, 0.1 * Math.sin(i), 0.1 * Math.cos(i), 0.05)

function sincrono(): void {
  console.log('\n== A. Sem sinal e camadas desligadas: as regras de antes')
  {
    const frases = [frase('f01', 'Algo acontece no comeco.', ['e01'], 'c0002'), frase('f02', 'Depois vem mais.', ['e02'], 'c0008')]
    const desligado = casar(frases, { camadas: { ...CAMADAS_DESLIGADAS } })
    confere(![...chaves(desligado)].some((k) => LOTE2.includes(k)), 'desligado: nenhum termo do lote 2')
    const semSinal = casar(frases)
    confere(!['imagem', 'sentido', 'tag', 'borrado'].some((k) => chaves(semSinal).has(k)), 'ligado sem motor: nenhum termo de imagem, sentido, etiqueta ou borrado')
    confere(primeira(desligado, 'f01')?.candidato.planoIds[0] === primeira(semSinal, 'f01')?.candidato.planoIds[0], 'sem sinal: a f01 fica no mesmo plano do guloso')
  }

  console.log('\n== B. C5: a conta do roteiro inteiro')
  {
    // Tres frases no mesmo evento, as tres com o MESMO momento: sem repetir, e em frente.
    const frases = [
      frase('f01', 'Primeiro isso.', ['e01'], 'c0003'),
      frase('f02', 'Depois aquilo.', ['e01'], 'c0003'),
      frase('f03', 'E por fim isto.', ['e01'], 'c0003'),
    ]
    const r = casar(frases)
    const ids = r.casadas.map((c) => c.fita[0]!.candidato.planoIds[0])
    confere(new Set(ids).size === 3, 'tres frases no mesmo momento: tres planos diferentes', ids)
    const ins = r.casadas.map((c) => c.fita[0]!.candidato.inSec)
    confere(ins[1]! >= ins[0]! && ins[2]! >= ins[1]!, 'na ordem do episodio (sem voltar no tempo)', ins)
    confere(r.casadas.every((c) => !c.fita[0]!.repetido), 'nenhuma repetida')
    // Ponto fixo: a f02 travada no plano 0002: as outras nao usam o 0002 e a f02 nao e refeita.
    const fixa: EscolhaDaFrase = {
      fraseId: 'f02',
      cenas: [{ candidato: { planoIds: ['0002'], episodioId: EP, inSec: 4, outSec: 8, nota: 0, porque: [], origem: 'usuario', keyframe: null }, palavraInicio: 0 }],
      fita: [],
      confianca: 1,
      travada: true,
      hashTexto: hashDoTexto('Depois aquilo.'),
      duracao: 1,
      avisos: [],
    }
    const comFixa = casar(frases, { fixas: new Map([['f02', fixa]]) })
    confere(!comFixa.casadas.some((c) => c.escolha.fraseId === 'f02'), 'a travada nao e refeita')
    confere(
      comFixa.casadas.every((c) => {
        const k = c.fita[0]!.candidato
        return !k.planoIds.includes('0002') || k.inSec >= 6 - 1e-6
      }),
      'ninguem mostra o trecho da travada (o resto do plano longo ainda serve)',
    )
    const f03 = primeira(comFixa, 'f03')!
    confere(
      f03.termos.some((t) => t.chave === 'cronologia'),
      'a f03 conta a cronologia contra a travada (ponto fixo no caminho)',
      f03.termos.map((t) => t.chave),
    )
    // A conta desligada: o guloso de antes, tambem sem repetir.
    const guloso = casar(frases, { camadas: { conta: false } })
    confere(new Set(guloso.casadas.map((c) => c.fita[0]!.candidato.planoIds[0])).size === 3, 'conta desligada: o guloso tambem nao repete')
  }

  console.log('\n== C. C4: personagem como regra forte')
  {
    // A ancora cai no plano 0001 (sem a Nia); a Nia esta no 0004-0007 e no 0013.
    const r = casar([frase('f01', 'A Nia treina sem parar.', ['e01'], 'c0001')])
    const p = primeira(r, 'f01')!
    confere(p.planos.some((q) => q.rostos.some((x) => x.nome === 'Liston, Nia')), 'com 4+ planos da Nia: a 1a tem o rosto dela', p.candidato.planoIds)
    confere(r.casadas[0]!.fita.some((c) => c.termos.some((t) => t.chave === 'forte')), 'os planos sem a Nia levam o "sem citado"')
    const fraco = casar([frase('f01', 'A Nia treina sem parar.', ['e01'], 'c0001')], { camadas: { personagemForte: false } })
    confere(!fraco.casadas[0]!.fita.some((c) => c.termos.some((t) => t.chave === 'forte')), 'C4 desligado: so a nota de antes')
    // A Lynokis tem 2 planos no episodio: poucos, sem a regra forte.
    const poucos = casar([frase('f01', 'A Lynokis olha.', ['e01'], 'c0001')])
    confere(!poucos.casadas[0]!.fita.some((c) => c.termos.some((t) => t.chave === 'forte')), 'com 2 planos da Lynokis: sem a regra forte')
    // "Ela" herda a Nia.
    const her = casar([frase('f01', 'A Nia acorda cedo.', ['e01'], 'c0004'), frase('f02', 'Ela corre ate o patio.', ['e01'], 'c0001')])
    const f02 = her.casadas.find((c) => c.escolha.fraseId === 'f02')!.fita[0]!
    confere(f02.termos.some((t) => t.chave === 'pessoa' && t.rotulo === 'Nia'), 'o "ela" herda a Nia da frase anterior', f02.termos.map((t) => t.chave))
    // (E03) A regra do casar e a do recorte: quemOMomentoCita (v-regras-e03).
    const semNomes = { nomesDaFicha: new Map<string, Set<string>>(), proprios: new Set<string>() }
    confere(quemOMomentoCita('O dia nasce.', [{ ficha: 'nia', rotulo: 'Nia' }], null, semNomes).citados.length === 0, 'sem pronome nao herda')
    confere(
      quemOMomentoCita('Elas lutam.', [{ ficha: 'nia', rotulo: 'Nia' }, { ficha: 'lynokis', rotulo: 'Lynokis' }], null, semNomes).citados.length === 2,
      '"elas" herda as duas',
    )
    // As duas juntas no 0013.
    const duas = casar([frase('f01', 'A Nia e a Lynokis treinam juntas.', ['e01'], 'c0010')])
    const d = primeira(duas, 'f01')!
    confere(d.candidato.planoIds.includes('0013') && d.termos.some((t) => t.chave === 'juntos'), 'duas pessoas: o plano com as duas', d.candidato.planoIds)
    confere(d.candidato.porque[0] === 'Nia + Lynokis', 'o porque curto diz as duas', d.candidato.porque)
  }

  console.log('\n== D. C2/C3: a imagem parecida e as etiquetas')
  {
    const quadros = new Map<string, QuadroDaVisao[]>()
    indice.planos.forEach((p, i) => {
      const alvo = p.id === '0011' // dentro do e02, longe da ancora (o comeco do evento)
      quadros.set(p.id, [{ k: 1, pos: 0.5, arquivo: `C:/fake/${p.id}_1.jpg`, vetor: alvo ? vet(0, 1, 0, 0) : neutro(i), beleza: 5, nitidez: 500 }])
    })
    const tagsDoPlano = new Map(indice.planos.map((p) => [p.id, p.id === '0012' ? ['punching', 'fighting', '1girl'] : ['1girl', 'indoors', 'standing']]))
    const sinais: SinaisDoCasar = { quadros, imagemDaFrase: new Map([['f01', vet(0, 1, 0, 0)]]), tagsDaFrase: new Map([['f02', ['punching']]]), tagsDoPlano }
    const r = casar([frase('f01', 'Algo grande acontece.', ['e02']), frase('f02', 'E vem o golpe.', ['e02'])], { sinais })
    const f01 = primeira(r, 'f01')!
    confere(f01.candidato.planoIds.includes('0011') && f01.termos.some((t) => t.chave === 'imagem'), 'a imagem parecida (CLIP) leva a f01 para o 0011', f01.candidato.planoIds)
    confere(f01.candidato.porque[0] === 'parecido', 'porque curto: "parecido"', f01.candidato.porque)
    const f02 = primeira(r, 'f02')!
    confere(f02.candidato.planoIds.includes('0012') && f02.termos.some((t) => t.chave === 'tag'), 'a etiqueta "punching" leva a f02 para o 0012', f02.candidato.planoIds)
    confere(f02.candidato.porque[0] === 'soco', 'porque curto em portugues: "soco"', f02.candidato.porque)
    const semCamada = casar([frase('f01', 'Algo grande acontece.', ['e02'])], { sinais, camadas: { imagem: false } })
    confere(!chaves(semCamada).has('imagem'), 'imagem desligada na config: sem o termo')
  }

  console.log('\n== E. C1: a ancora pelo sentido, sem evento')
  {
    const sentidoDaCue = new Map(indice.cues.map((c, i) => [c.id, c.id === 'c0021' ? vet(0, 0, 1, 0) : neutro(i)]))
    const sinais: SinaisDoCasar = { sentidoDaCue, sentidoDaFrase: new Map([['f02', vet(0, 0, 1, 0)]]) }
    const frases = [frase('f01', 'No comeco.', ['e01'], 'c0002'), frase('f02', 'Uma frase de ligacao.', [])]
    const sem = casar(frases)
    confere(sem.casadas[1]!.janela.herdada, 'sem o sentido: a frase sem evento herda a vizinha')
    const com = casar(frases, { sinais })
    const j = com.casadas[1]!.janela
    confere(!j.herdada && j.cueAncora?.id === 'c0021', 'com o sentido: a ancora e a fala de mesmo sentido', j)
    confere(primeira(com, 'f02')!.candidato.planoIds.includes('0021'), 'e a cena e a dessa fala', primeira(com, 'f02')!.candidato.planoIds)
  }

  console.log('\n== F. C7: o melhor trecho e a miniatura')
  {
    // O 0025 (96-100 s) e o parecido da frase (para ser escolhido longe da ancora); o
    // quadro do comeco dele (k0) e borrado e feio, o k2 bonito e nitido.
    const quadros = new Map<string, QuadroDaVisao[]>()
    indice.planos.forEach((p, i) =>
      quadros.set(
        p.id,
        [0, 1, 2].map((k) => ({
          k,
          pos: (k + 1) / 4,
          arquivo: `C:/fake/${p.id}_${k}.jpg`,
          vetor: p.id === '0025' ? vet(0, 1, 0, 0) : neutro(i * 3 + k),
          beleza: p.id === '0025' ? [2, 5, 8][k]! : 5,
          nitidez: p.id === '0025' ? [3, 400, 2000][k]! : 400,
        })),
      ),
    )
    const sinais: SinaisDoCasar = { quadros, imagemDaFrase: new Map([['f01', vet(0, 1, 0, 0)]]) }
    const r = casar([frase('f01', 'Um.', ['e04'])], { sinais })
    const c = r.casadas[0]!.fita.find((x) => x.candidato.planoIds[0] === '0025')
    confere(!!c && c.candidato.inSec > 96.5, 'no 0025 a janela sai do comeco borrado', c?.candidato.inSec)
    confere(c?.candidato.keyframe === 'C:/fake/0025_2.jpg', 'a miniatura e o quadro mais bonito e nitido', c?.candidato.keyframe)
    // A fala do momento dita sobre um plano APAGADO (o 0020: nevoa, sem nitidez e feio):
    // o momento passa para os vizinhos e o apagado nao leva o centro.
    const apagado = new Map(
      [...quadros].map(([id, qs]) => [id, qs.map((q) => (id === '0020' ? { ...q, vetor: null, beleza: 1, nitidez: 1 } : { ...q, vetor: null }))]),
    )
    const comApagado = casar([frase('f01', 'Algo.', ['e04'], 'c0020')], { sinais: { quadros: apagado } })
    const pa = primeira(comApagado, 'f01')!
    confere(!pa.candidato.planoIds.includes('0020') && ['0019', '0021'].includes(pa.candidato.planoIds[0]!), 'momento num plano apagado: fica o vizinho', pa.candidato.planoIds)
    const semC7 = casar([frase('f01', 'Algo.', ['e04'], 'c0020')], { sinais: { quadros: apagado }, camadas: { melhorQuadro: false } })
    confere(primeira(semC7, 'f01')!.candidato.planoIds.includes('0020'), 'C7 desligado: o plano do momento, como antes', primeira(semC7, 'f01')!.termos)
    const sem = casar([frase('f01', 'Um.', ['e04'])], { sinais, camadas: { melhorQuadro: false } })
    const c2 = sem.casadas[0]!.fita.find((x) => x.candidato.planoIds[0] === '0025')
    confere(!!c2 && c2.candidato.inSec === 96, 'C7 desligado: o comeco do plano, como antes', c2?.candidato.inSec)
  }
}

async function juizEDicas(): Promise<void> {
  console.log('\n== G. C6: o juiz (IA falsa)')
  const cand = (id: string) => ({ planoIds: [id], episodioId: EP, inSec: 0, outSec: 4, nota: 1, porque: [], origem: 'sugestao' as const, keyframe: `C:/fake/${id}_1.jpg` })
  const escolha = (fraseId: string): EscolhaDaFrase => ({
    fraseId,
    cenas: [{ candidato: cand(`${fraseId}a`), palavraInicio: 0 }],
    fita: [cand(`${fraseId}a`), cand(`${fraseId}b`), cand(`${fraseId}c`)],
    confianca: 0.5,
    travada: false,
    hashTexto: hashDoTexto(fraseId),
    duracao: 2,
    avisos: [],
  })
  const frases = Array.from({ length: 8 }, (_, i) => ({ id: `f0${i + 1}`, texto: `frase ${i + 1}` }))
  const escolhas = frases.map((f) => escolha(f.id))
  const kf = (c: { keyframe: string | null }): string | null => c.keyframe
  const pedidos = pedidosDoJuiz(frases, new Map(escolhas.map((e) => [e.fraseId, e])), kf)
  confere(pedidos.length === 2 && pedidos[0]!.imagens.length === 18, '8 frases em 2 pedidos (6 + 2), 3 imagens cada')
  const custo = custoDoJuiz(pedidos)
  confere(custo > 0 && custo < 0.02, `custo do Haiku estimado: US$ ${custo.toFixed(4)}`)
  let chamadas = 0
  const falsa: GerarJsonComImagens = async (p) => {
    chamadas += 1
    const ids = [...new Set(p.imagens.map((x) => x.rotulo.split('#')[0]!))]
    return { ok: true, valor: { escolhas: ids.map((fraseId) => ({ fraseId, candidata: 2 })) } }
  }
  const des = await julgar('desligado', frases, escolhas, kf, falsa, { temChave: true, custoConfirmado: true })
  confere(chamadas === 0 && des.pedidos === 0, 'desligado: nenhum pedido')
  const semNucleo = await julgar('gemini', frases, escolhas, kf, null, { temChave: true, custoConfirmado: true })
  confere(semNucleo.nota !== null && chamadas === 0, 'sem imagem no nucleo: nao julga, com recado')
  const semCusto = await julgar('haiku', frases, escolhas, kf, falsa, { temChave: true, custoConfirmado: false })
  confere(chamadas === 0 && semCusto.nota !== null, 'Haiku sem o custo confirmado: nenhum pedido')
  const semChave = await julgar('gemini', frases, escolhas, kf, falsa, { temChave: false, custoConfirmado: true })
  confere(semChave.nota === 'sem chave', 'sem chave: "sem chave"')
  const j = await julgar('gemini', frases, escolhas, kf, falsa, { temChave: true, custoConfirmado: true })
  confere(chamadas === 2 && j.escolhas.every((e) => e.cenas[0]!.candidato.planoIds[0]!.endsWith('b')), 'julgando: 2 pedidos e a candidata 2 vira a cena')
  const travada = aplicarVeredito({ ...escolhas[0]!, travada: true }, 3)
  confere(travada.cenas[0]!.candidato.planoIds[0] === 'f01a', 'escolha travada: o juiz nao mexe')

  console.log('\n== H. As dicas da IA')
  const d = dicasDasCenas({ tags: ['Crying', 'hospital_bed', 'crying', 'a'.repeat(80), 'Night'], visualEn: '  a  small girl\n lying in bed ' })
  confere(JSON.stringify(d.tags) === JSON.stringify(['crying', 'hospital bed', 'night']), 'tags: minusculas, sem sublinhado, sem repetir, sem lixo', d.tags)
  confere(d.visualEn === 'a small girl lying in bed', 'visualEn numa linha', d.visualEn)
  confere(Object.keys(dicasDasCenas({ tags: [], visualEn: '' })).length === 0, 'resposta vazia: sem os campos (roteiro antigo)')
  confere(porqueCurto([{ chave: 'citada', valor: 30, rotulo: 'fala citada' }, { chave: 'pessoa', valor: 20, rotulo: 'Nia' }]) === 'fala citada', 'porque curto: a fala citada ganha')
  confere(porqueCurto([{ chave: 'pessoa', valor: 20, rotulo: 'Nia' }, { chave: 'tag', valor: 6, rotulo: 'soco' }]) === 'Nia + soco', 'porque curto: "Nia + soco"')
}

sincrono()
void juizEDicas().then(() => {
  console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
})
