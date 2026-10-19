/**
 * [recap] OS TEXTOS NA TELA (teste real do Magic Repo Man E02, 18/10): o
 * roteiro marcava "DIVIDA MAGICA", "PAGAMENTO ROTATIVO" e "JUROS ETERNOS" e o
 * video saia sem nenhum; sem texto na 1a frase, nem o card de gancho.
 *
 * Com os tempos de verdade do take do E02 (as palavras do ElevenLabs, copiadas
 * do rascunho dele, so leitura):
 * 1. o card de gancho: a 1a frase sem texto pega a 1a sugestao de thumb
 *    ("DIVIDA INFINITA"); com texto, o dela; sem nenhum, vazio;
 * 2. o tempo de cada texto: entra NA PALAVRA ("divida", "pagamento",
 *    "eternos"), fica ate a frase acabar, dentro de 1,2-2,8 s, nunca por cima
 *    do card de gancho nem do texto seguinte; texto longo fica fora (aviso);
 * 3. o clipe: imagem do tamanho do quadro, o pop pelas chaves do nucleo
 *    (0,6 -> 1,1 -> 1, ease-out, pivo no centro do rotulo), fade de entrada e
 *    de saida, `modulos.recap` = { papel: 'texto', fraseId, marca };
 * 4. rodar de novo: o intacto e trocado (mesmo id), o que ele mexeu fica e a
 *    frase dele nao ganha outro; a faixa fica ACIMA da camada de cor;
 * 5. o lugar: o rotulo nunca encosta na legenda (captionY de 0,08 a 0,55,
 *    escala 0,8 a 1,6) e o PNG de verdade (sharp + Komika Axis) so tem tinta
 *    no alto, dentro da largura util;
 * 6. a etiqueta do roteiro diz a verdade (gancho / no video / so no roteiro).
 *
 * Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-textos-na-tela.ts
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { transformNoTempo } from '@shared/transform'
import { ganchoDaMontagem } from '../electron/montar/projeto'
import { pngsDosTextos, quadroDoTexto } from '../electron/montar/textos'
import { camadaDeCor, ANIME_VIVO } from '../shared/edicao-rapida'
import { clipeParaONucleo, clipeParaOModulo, papelDaSobreposicao } from '../shared/projeto-do-recap'
import {
  centroDoTexto,
  clipeDoTexto,
  destinoDoTextoDeTela,
  faixaDosTextos,
  ganchoDoRoteiro,
  linhasDoRotulo,
  momentosDosTextos,
  textoIntacto,
  trocaDosTextos,
  type PngDoTexto,
} from '../shared/textos-na-tela'

let falhas = 0
function confere(ok: boolean, nome: string): void {
  console.log(`  ${ok ? 'ok ' : 'FALHOU'} ${nome}`)
  if (!ok) falhas++
}
const secao = (nome: string): void => console.log(`\n== ${nome}`)
const perto = (a: number, b: number, tol = 0.002): boolean => Math.abs(a - b) <= tol

const FONTE = join(__dirname, '..', '..', '..', 'assets', 'fonts', 'KomikaAxis.ttf')
const RAIZ = mkdtempSync(join(tmpdir(), 'recap-v-textos-'))

// O take do Magic Repo Man E02 (rascunho rc_cf106c500953_mvehxo6r, take t1): as frases com texto e vizinhas.
type P = [string, number, number]
const FRASES: { id: string; offset: number; duracao: number; tela: string | null; palavras: P[] }[] = [
  { id: 'f01', offset: 0, duracao: 3.125, tela: null, palavras: [['Mano…', 0, 0.43], ['esse', 0.58, 0.733], ['cara', 0.779, 0.988], ['foi', 1.046, 1.163], ['expulso', 1.186, 1.708], ['por', 1.76, 1.859], ['ser', 1.917, 2.033], ['considerado', 2.08, 2.521], ['inútil.', 2.579, 3.032]] },
  { id: 'f02', offset: 3.125, duracao: 2.87, tela: 'DÍVIDA MÁGICA', palavras: [['Só', 3.2, 3.373], ['que', 3.442, 3.523], ['ele', 3.582, 3.698], ['deixou', 3.732, 4.023], ['o', 4.046, 4.069], ['antigo', 4.092, 4.325], ['grupo', 4.359, 4.557], ['com', 4.58, 4.684], ['uma', 4.708, 4.824], ['dívida', 4.893, 5.195], ['impagável.', 5.3, 5.92]] },
  { id: 'f03', offset: 5.995, duracao: 2.925, tela: null, palavras: [['O', 6.07, 6.101], ['Lent', 6.171, 6.426], ['passou', 6.53, 6.728], ['cinco', 6.786, 7.123], ['anos', 7.181, 7.39], ['servindo', 7.413, 7.657], ['apenas', 7.68, 8.005], ['de', 8.028, 8.075], ['bateria', 8.11, 8.423], ['mágica.', 8.47, 8.79]] },
  { id: 'f15', offset: 34.98, duracao: 2.26, tela: 'PAGAMENTO ROTATIVO', palavras: [['Ela', 35.06, 35.202], ['ativou', 35.226, 35.574], ['o', 35.597, 35.632], ['temido', 35.678, 35.911], ['pagamento', 35.934, 36.247], ['rotativo', 36.271, 36.665], ['de', 36.712, 36.781], ['mana!', 36.874, 37.199]] },
  { id: 'f20', offset: 46.885, duracao: 3.17, tela: 'JUROS ETERNOS', palavras: [['Na', 46.96, 47.007], ['prática,', 47.053, 47.459], ['viraram', 47.58, 47.831], ['devedores', 47.866, 48.272], ['eternos', 48.353, 48.818], ['pagando', 48.89, 49.189], ['só', 49.282, 49.491], ['os', 49.526, 49.573], ['juros.', 49.596, 49.909]] },
]
const DURACAO = 61.056
const THUMBS = ['DÍVIDA INFINITA', 'FALÊNCIA TOTAL', 'EXPULSO E VINGADO']
const palavras = FRASES.flatMap((f) => f.palavras.map(([texto, start, end]) => ({ texto, start, end, fraseId: f.id })))
const trechos = FRASES.map((f) => ({ fraseId: f.id, offset: f.offset, duracao: f.duracao }))
const roteiro = {
  secoes: [
    { frases: FRASES.slice(0, 2).map((f) => ({ id: f.id, textoDeTela: f.tela })) },
    { frases: FRASES.slice(2).map((f) => ({ id: f.id, textoDeTela: f.tela })) },
  ],
}

function pngFalso(fraseId: string): PngDoTexto {
  return { fraseId, path: `G:/proj/textos/${fraseId}.png`, centroX: 0.5, centroY: 0.27, aspecto: 1080 / 1920 }
}

async function principal(): Promise<void> {
  // ===================================================================== 1.
  secao('1. O card de gancho')
  const g1 = ganchoDoRoteiro({ textoDeTela: null }, THUMBS)
  confere(g1.texto === 'DÍVIDA INFINITA' && g1.origem === 'thumb', `1a frase sem texto: a 1a thumb ("${g1.texto}")`)
  const g2 = ganchoDoRoteiro({ textoDeTela: '  EXPULSO   INUTIL ' }, THUMBS)
  confere(g2.texto === 'EXPULSO INUTIL' && g2.origem === 'frase', 'com texto na 1a frase: o dela, limpo')
  const g3 = ganchoDoRoteiro({ textoDeTela: null }, ['  ', ''])
  confere(g3.texto === '' && g3.origem === null, 'sem texto e sem thumb: sem card')
  const gm = ganchoDaMontagem(roteiro as never, { trechos } as never, THUMBS)
  confere(gm.texto === 'DÍVIDA INFINITA' && gm.sec === 3.1, `a montagem: "${gm.texto}" por ${gm.sec} s (o tempo da 1a frase)`)
  const curta = ganchoDaMontagem(roteiro as never, { trechos: [{ fraseId: 'f01', offset: 0, duracao: 0.9 }] } as never, THUMBS)
  confere(curta.sec === 1.5, 'frase curta: o card fica o minimo de 1,5 s')

  // ===================================================================== 2.
  secao('2. O tempo de cada texto (take real do E02)')
  const pedidos = FRASES.slice(1).flatMap((f) => (f.tela ? [{ fraseId: f.id, texto: f.tela, inicio: f.offset, fim: f.offset + f.duracao }] : []))
  const m = momentosDosTextos(pedidos, palavras, { duracaoSec: DURACAO, ganchoAteSec: gm.sec })
  const t = new Map(m.textos.map((x) => [x.fraseId, x]))
  console.log(`  ${m.textos.map((x) => `${x.texto} ${x.inicio.toFixed(2)}-${x.fim.toFixed(2)}`).join(' | ')}`)
  confere(m.textos.length === 3 && m.avisos.length === 0, 'os 3 textos do roteiro entram, sem aviso')
  confere(perto(t.get('f02')!.inicio, 4.893 - 0.08), `DIVIDA MAGICA entra em "divida" (${t.get('f02')!.inicio} s), nao no "So que" de 3,2 s`)
  confere(perto(t.get('f15')!.inicio, 35.934 - 0.08), `PAGAMENTO ROTATIVO entra em "pagamento" (${t.get('f15')!.inicio} s)`)
  confere(perto(t.get('f20')!.inicio, 48.353 - 0.08), `JUROS ETERNOS entra em "eternos", a 1a palavra dele dita (${t.get('f20')!.inicio} s)`)
  confere(m.textos.every((x) => x.fim - x.inicio >= 1.2 - 1e-9 && x.fim - x.inicio <= 2.8 + 1e-9), 'cada um fica de 1,2 a 2,8 s')
  confere(perto(t.get('f02')!.fim, 5.995 + 0.3) && perto(t.get('f20')!.fim, 46.885 + 3.17 + 0.3), 'sai 0,3 s depois de a frase acabar')
  confere(m.textos.every((x) => x.inicio >= gm.sec + 0.1 - 1e-9), 'nenhum por cima do card de gancho')
  // Texto na 1a palavra da frase seguinte ao card: espera o card sair.
  const colado = momentosDosTextos([{ fraseId: 'f02', texto: 'SO QUE', inicio: 3.125, fim: 5.995 }], palavras, { duracaoSec: DURACAO, ganchoAteSec: 3.5 })
  confere(colado.textos[0]!.inicio === 3.6, `o texto que cairia no card espera ele sair (${colado.textos[0]!.inicio} s)`)
  // Dois textos colados: o primeiro sai antes do segundo entrar.
  const dois = momentosDosTextos(
    [
      { fraseId: 'a', texto: 'UM', inicio: 10, fim: 10.5 },
      { fraseId: 'b', texto: 'DOIS', inicio: 10.9, fim: 13 },
    ],
    [],
    { duracaoSec: 60, ganchoAteSec: 0 },
  )
  confere(dois.textos.length === 2 && dois.textos[0]!.fim <= dois.textos[1]!.inicio - 0.1 + 1e-9, 'textos seguidos nao se sobrepoem')
  const longo = momentosDosTextos([{ fraseId: 'x', texto: 'ELE PAGOU A DIVIDA INTEIRA DO GRUPO', inicio: 20, fim: 23 }], [], { duracaoSec: 60, ganchoAteSec: 0 })
  confere(longo.textos.length === 0 && longo.avisos.length === 1 && longo.avisos[0]!.includes('palavras demais'), `texto longo fica fora, com aviso ("${longo.avisos[0]}")`)
  const fim = momentosDosTextos([{ fraseId: 'y', texto: 'FIM', inicio: 59.8, fim: 61 }], [], { duracaoSec: 60.2, ganchoAteSec: 0 })
  confere(fim.textos.length === 0 && fim.avisos.length === 1, 'texto que nao caberia nem 0,6 s antes do fim do video fica fora')
  confere(linhasDoRotulo('PAGAMENTO ROTATIVO').join('|') === 'PAGAMENTO|ROTATIVO' && linhasDoRotulo('Juros').join('|') === 'JUROS', 'as linhas do rotulo (caixa alta, 2 linhas quando longo)')

  // ===================================================================== 3.
  secao('3. O clipe: imagem do quadro, pop e fades')
  const c = clipeDoTexto({ id: 'er-texto-f15-1', png: { ...pngFalso('f15'), centroY: 0.2734 }, texto: t.get('f15')!, faixa: 1 })
  confere(c.tipo === 'image' && c.at === t.get('f15')!.inicio && perto(c.usarSec!, t.get('f15')!.fim - t.get('f15')!.inicio) && c.durationSec === 3600, 'imagem, no tempo do texto (o arquivo "infinito" como imagem do nucleo)')
  confere(c.x === 0 && c.y === 0 && c.escala === 1 && perto(c.aspecto, 1080 / 1920), 'do tamanho do quadro: cai onde foi desenhado')
  const ch = c.chaves ?? []
  confere(ch.length === 3 && ch[0]!.escala === 0.6 && ch[1]!.escala === 1.1 && ch[2]!.escala === 1 && ch[2]!.t === 0.3 && c.curvaDasChaves === 'ease-out', 'o pop: 0,6 -> 1,1 -> 1 em 0,3 s, ease-out')
  confere(c.pivo?.x === 0.5 && c.pivo?.y === 0.273, 'o pivo no centro do rotulo (escala no lugar)')
  confere(c.fadeInSec > 0 && c.fadeInSec <= 0.15 && c.fadeOutSec >= 0.2, `entra com fade (${c.fadeInSec} s) e sai limpo (${c.fadeOutSec} s)`)
  const meio = transformNoTempo(c, ch, 0.08, c.curvaDasChaves!)
  const depois = transformNoTempo(c, ch, 1, c.curvaDasChaves!)
  confere(meio.escala > 0.6 && meio.escala < 1.1 && depois.escala === 1, `no meio do pop ${meio.escala.toFixed(2)}x, depois 1x`)
  const nucleo = clipeParaONucleo(c)
  const dados = (nucleo.modulos as { recap?: Record<string, unknown> }).recap ?? {}
  confere(!('papel' in nucleo) && dados['papel'] === 'texto' && dados['fraseId'] === 'f15' && typeof dados['marca'] === 'string', 'papel, frase e marca em modulos.recap')
  confere(papelDaSobreposicao(nucleo) === 'texto' && textoIntacto(nucleo) && textoIntacto(clipeParaOModulo(nucleo)), 'intacto nos dois formatos (nucleo e achatado)')
  confere(!textoIntacto({ ...nucleo, at: nucleo.at + 0.5 }) && !textoIntacto({ ...nucleo, escala: 1.3 }) && !textoIntacto({ ...nucleo, chaves: [] }), 'mexeu (tempo, tamanho, chaves): deixa de ser intacto')
  confere(textoIntacto({ ...nucleo, faixa: 4, id: 'outro', fileName: 'x' }), 'mudar so a faixa, o id ou o nome nao conta como mexer')

  // ===================================================================== 4.
  secao('4. Rodar de novo: troca so os intactos, acima da cor')
  const cor = clipeParaONucleo(camadaDeCor({ cor: ANIME_VIVO, nome: 'Anime vivo', duracaoSec: DURACAO, faixa: 0, id: 'cor' }))
  const novos = m.textos.map((x) => clipeParaONucleo(clipeDoTexto({ id: `n-${x.fraseId}`, png: pngFalso(x.fraseId), texto: x, faixa: 0 })))
  const r1 = trocaDosTextos([cor], novos)
  confere(r1.rodada.postos === 3 && r1.rodada.faixa === 1 && r1.sobreposicoes.filter((o) => o.faixa === 1).length === 3, 'projeto novo: os 3 na V2, acima da cor (V1)')
  const deleMeme = { ...cor, id: 'meme', tipo: 'image' as const, faixa: 1, at: 35, usarSec: 3, modulos: undefined, cor: undefined }
  confere(faixaDosTextos([cor, deleMeme], m.textos) === 2, 'um clipe dele na V2 no tempo de um texto: os textos sobem para a V3')
  confere(faixaDosTextos([cor], m.textos, [1]) === 2, 'faixa muda nao recebe texto')
  // Ele mexeu no PAGAMENTO ROTATIVO (arrastou 1 s) e ha um texto intacto de antes do DIVIDA MAGICA.
  const antigos = r1.sobreposicoes.map((o) => (o.id === 'n-f15' ? { ...o, at: o.at + 1 } : o))
  const outraRodada = m.textos.map((x) => clipeParaONucleo(clipeDoTexto({ id: `z-${x.fraseId}`, png: pngFalso(x.fraseId), texto: x, faixa: 0 })))
  const r2 = trocaDosTextos(antigos, outraRodada)
  const textos2 = r2.sobreposicoes.filter((o) => papelDaSobreposicao(o) === 'texto')
  confere(r2.rodada.postos === 2 && r2.rodada.mantidos === 1, 'o mexido fica; os 2 intactos sao trocados')
  confere(textos2.length === 3 && textos2.filter((o) => (o.modulos as { recap: { fraseId: string } }).recap.fraseId === 'f15').length === 1, 'a frase mexida nao ganha um segundo texto')
  confere(textos2.some((o) => o.id === 'n-f02') && !textos2.some((o) => o.id === 'z-f02'), 'o trocado fica com o mesmo id (o inspetor aberto nele continua)')
  confere(textos2.find((o) => o.id === 'n-f15')!.at === antigos.find((o) => o.id === 'n-f15')!.at, 'o mexido continua onde ele pos')
  confere(r2.sobreposicoes[0]!.id === 'cor', 'a camada de cor intocada')
  const r3 = trocaDosTextos(r2.sobreposicoes, [])
  confere(r3.sobreposicoes.filter((o) => papelDaSobreposicao(o) === 'texto').length === 1 && r3.rodada.mantidos === 1, 'sem textos no roteiro: os intactos saem, o mexido fica')

  // ===================================================================== 5.
  secao('5. O lugar: nunca em cima da legenda')
  let encostou = 0
  for (let cy = 0.08; cy <= 0.551; cy += 0.01) {
    for (const escala of [0.8, 1, 1.3, 1.6]) {
      const alturaRel = 300 / 1920
      const centro = centroDoTexto({ captionY: cy, captionScale: escala, alturaRel, alturaPx: 1920 })
      const baseDoRotulo = centro + alturaRel / 2
      const topoDaLegenda = 1 - cy - (68 * escala * 1.15) / 1920
      if (baseDoRotulo > topoDaLegenda - 0.01 || centro - alturaRel / 2 < 0) encostou++
    }
  }
  confere(encostou === 0, 'legenda de 8% a 55% do rodape, escala 0,8 a 1,6: o rotulo de 2 linhas nunca encosta')
  confere(centroDoTexto({ captionY: 0.355, captionScale: 1, alturaRel: 300 / 1920, alturaPx: 1920 }) === 0.27, 'na legenda padrao, o centro a 27% da altura')
  const t0 = Date.now()
  const q = await quadroDoTexto('PAGAMENTO ROTATIVO', { formato: 'short', captionY: 0.355, captionScale: 1, fonte: FONTE })
  const meta = await sharp(q.png).metadata()
  const { data, info } = await sharp(q.png).raw().toBuffer({ resolveWithObject: true })
  let y0 = info.height
  let y1 = -1
  let x0 = info.width
  let x1 = -1
  let rosa = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4
      if (data[i + 3]! < 16) continue
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      if (data[i]! > 200 && data[i + 1]! < 120 && data[i + 2]! > 90) rosa++
    }
  }
  console.log(`  PNG ${meta.width}x${meta.height} em ${Date.now() - t0} ms; tinta em x ${x0}-${x1}, y ${y0}-${y1}; centro ${q.centroY.toFixed(3)}`)
  confere(meta.width === 1080 && meta.height === 1920 && meta.hasAlpha === true, 'o PNG do tamanho do quadro, com transparencia')
  confere(y0 > 1920 * 0.12 && y1 < 1920 * (1 - 0.355) - 120, 'tinta so no alto: abaixo da interface do app e acima da legenda')
  confere(x0 >= 1080 * 0.08 && x1 <= 1080 * 0.92, 'dentro da largura util (longe dos botoes da direita)')
  confere(rosa > 1000, `a sombra rosa do app (${rosa} px)`)
  confere(perto(q.centroY, (y0 + y1) / 2 / 1920, 0.02), 'o pivo (centro) bate com o centro da tinta')
  const pasta = join(RAIZ, 'projeto')
  const p1 = await pngsDosTextos({ textos: [{ fraseId: 'f02', texto: 'DÍVIDA MÁGICA' }], pasta, formato: 'short', captionY: 0.355, captionScale: 1 }, FONTE)
  const p2 = await pngsDosTextos({ textos: [{ fraseId: 'f02', texto: 'DÍVIDA MÁGICA' }], pasta, formato: 'short', captionY: 0.355, captionScale: 1 }, FONTE)
  confere(p1.pngs.length === 1 && p1.pngs[0]!.path === p2.pngs[0]!.path && p1.pngs[0]!.path.startsWith(join(pasta, 'textos')), 'o PNG em <projeto>/textos, o mesmo arquivo ao rodar de novo')
  confere(readdirSync(join(pasta, 'textos')).length === 1 && /^divida-magica-[0-9a-f]{10}\.png$/.test(readdirSync(join(pasta, 'textos'))[0]!), `o nome diz o texto (${readdirSync(join(pasta, 'textos'))[0]})`)

  // ===================================================================== 6.
  secao('6. A etiqueta do roteiro diz a verdade')
  const d1 = destinoDoTextoDeTela({ primeira: true, textosLigados: false })
  const d2 = destinoDoTextoDeTela({ primeira: false, textosLigados: true })
  const d3 = destinoDoTextoDeTela({ primeira: false, textosLigados: false })
  confere(d1.noVideo && /gancho/.test(d1.dica), '1a frase: card de gancho')
  confere(d2.noVideo && /Vai no video/.test(d2.dica), 'as outras, com Textos na tela: vai no video')
  confere(!d3.noVideo && /so no roteiro/.test(d3.dica), 'Textos na tela desligado: fica so no roteiro')
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
