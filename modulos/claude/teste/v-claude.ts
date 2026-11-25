/**
 * [claude] O MODULO CLAUDE (MCP) sem app:
 *
 * - aplicarLote: foco proprio por cena (a imagem dividida com outra cena nao
 *   muda junto), entrada, efeito, zoom fixo, camera desligada, troca de clipe,
 *   grid; sons na primeira faixa livre e imagens por cima sem se sobrepor;
 *   legenda so com campos de estilo; erro derruba o lote inteiro; as imagens
 *   que o lote deixou sem uso saem e os indices sao refeitos, as que ja
 *   estavam sem uso ficam;
 * - com um projeto real do PC (se existir): o resultado passa no esquema;
 * - o JSON-RPC (initialize, tools/list, tools/call com erro virando isError,
 *   notificacao sem resposta) e o HTTP de verdade (senha, origem, 202).
 *
 * npx esbuild modulos/claude/teste/v-claude.ts --bundle --platform=node --packages=external \
 *   --tsconfig=tsconfig.node.json --outfile=modulos/claude/teste/_v-claude.cjs && node modulos/claude/teste/_v-claude.cjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { projectFileSchema } from '../../../shared/project-file'
import { aplicarLote, cameraDosPontos, resumoDasCenas, type ArquivoDoProjeto } from '../shared/ferramentas'
import { responderRpc, subirServidor } from '../electron/servidor'
import { escolherFaixa, lerSrt, procurarNasFalas } from '../electron/legendas'

let falhas = 0
function ok(cond: unknown, msg: string): void {
  if (cond) console.log('  ok', msg)
  else {
    falhas++
    console.log('  FALHOU', msg)
  }
}

function projeto(): ArquivoDoProjeto {
  return {
    images: [
      { path: 'C:/a/0001.mp4', rel: null, fileName: '0001.mp4', focusX: 0.5, focusY: 0.5, focusAuto: true },
      { path: 'C:/a/0002.mp4', rel: null, fileName: '0002.mp4', focusX: 0.3, focusY: 0.5, focusAuto: false },
      { path: 'C:/a/sobrando.png', rel: null, fileName: 'sobrando.png', focusX: 0.5, focusY: 0.5, focusAuto: false },
    ],
    plan: {
      scenes: [
        { imageIndex: 0, imageIndexB: null, start: 0, end: 1.2, effect: 'zoom-in', intensity: 0.1, sourceStart: 0, camera: null },
        { imageIndex: 1, imageIndexB: null, start: 1.2, end: 2.5, effect: 'pan-left', intensity: 0.1, sourceStart: 0.4, camera: { from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.08, x: 2, y: 0 } } },
        { imageIndex: 0, imageIndexB: null, start: 2.5, end: 3.4, effect: 'zoom-out', intensity: 0.1, sourceStart: 2 },
      ],
    },
    trilhas: [{ id: 'm1', path: 'C:/m.mp3', fileName: 'm.mp3', faixa: 1, at: 0, durationSec: 60, inicioSec: 0, usarSec: null, gainDb: -20 }],
    sobreposicoes: [],
    captionFont: 'Inter',
  }
}

console.log('aplicarLote')
{
  const p = projeto()
  const { arquivo: n, feito } = aplicarLote(
    p,
    {
      cenas: [
        { cena: 1, focoX: 0.8, entrada: 0.5 },
        { cena: 2, efeito: 'zoom-in', camera: 'desligar', zoomFixo: 1.3, origemDoZoom: { x: 0.5, y: 0.2 } },
      ],
      sons: { adicionar: [{ arquivo: 'C:/ping.mp3', em: 1, ganhoDb: -10 }] },
      imagens: { adicionar: [{ arquivo: 'C:/seta.png', em: 1, duracao: 1.2, escala: 0.32, rotacao: 105 }] },
      legenda: { captionFont: 'Bangers' },
    },
    { duracao: { 'C:/ping.mp3': 1.4 }, aspecto: { 'C:/seta.png': 1.5 } },
  )
  ok(p.images.length === 3 && (p.images[0]!['focusX'] as number) === 0.5, 'o original nao muda')
  const s = n.plan.scenes
  ok((n.images[s[0]!['imageIndex'] as number]!['focusX'] as number) === 0.8, 'cena 1 com focoX 0,8')
  ok((n.images[s[2]!['imageIndex'] as number]!['focusX'] as number) === 0.5, 'cena 3 (dividia a imagem) continua 0,5')
  ok(n.images[s[0]!['imageIndex'] as number]!['focusAuto'] === false, 'foco da mao desliga o automatico')
  ok(s[0]!['sourceStart'] === 0.5, 'entrada')
  ok(s[1]!['effect'] === 'zoom-in' && s[1]!['camera'] === null, 'efeito e camera desligada')
  ok(s[1]!['escala'] === 1.3 && (s[1]!['escalaOrigem'] as { y: number }).y === 0.2, 'zoom fixo com origem')
  ok(n.images.length === 4, `imagens: 0001 (cena 3), 0001 copia (cena 1), 0002, sobrando = 4 (veio ${n.images.length})`)
  ok(n.images.some((i) => i['fileName'] === 'sobrando.png'), 'a imagem que ja estava sem uso fica')
  const ping = n.trilhas!.find((t) => t['fileName'] === 'ping.mp3')!
  ok(ping && ping['faixa'] === 2 && ping['gainDb'] === -10 && ping['durationSec'] === 1.4, 'som na A3 (a A2 tem a musica)')
  const seta = n.sobreposicoes![0]!
  ok(seta['tipo'] === 'image' && seta['usarSec'] === 1.2 && seta['rotacao'] === 105 && seta['aspecto'] === 1.5 && seta['faixa'] === 0, 'seta por cima')
  ok(n['captionFont'] === 'Bangers', 'legenda')
  ok(feito.length === 5, `feito: ${feito.length} linhas`)
}
{
  const p = projeto()
  const { arquivo: n } = aplicarLote(p, { cenas: [{ cena: 3, clipe: 'C:/b/0099.mp4', entrada: 1, focoX: 0.2 }] }, { duracao: {}, aspecto: {} })
  const s = n.plan.scenes
  ok(n.images[s[2]!['imageIndex'] as number]!['path'] === 'C:/b/0099.mp4' && s[2]!['sourceStart'] === 1, 'troca de clipe com entrada')
  ok(n.images[s[0]!['imageIndex'] as number]!['path'] === 'C:/a/0001.mp4', 'a cena 1 segue com o 0001')
  const { arquivo: g } = aplicarLote(n, { cenas: [{ cena: 1, grid: { clipe: 'C:/b/0100.mp4', entrada: 0.3 } }] }, { duracao: {}, aspecto: {} })
  ok(g.images[g.plan.scenes[0]!['imageIndexB'] as number]!['path'] === 'C:/b/0100.mp4' && g.plan.scenes[0]!['sourceStartB'] === 0.3, 'grid')
  const { arquivo: sem } = aplicarLote(g, { cenas: [{ cena: 1, grid: 'desligar' }] }, { duracao: {}, aspecto: {} })
  ok(sem.plan.scenes[0]!['imageIndexB'] === null && sem.images.length === g.images.length - 1, 'desligar o grid tira a imagem dele')
}
{
  const erros: string[] = []
  for (const lote of [{ cenas: [{ cena: 9 }] }, { cenas: [{ cena: 1, efeito: 'giro' }] }, { legenda: { captions: [] } }, { sons: { adicionar: [{ arquivo: 'x.mp3', em: 0 }] } }])
    try {
      aplicarLote(projeto(), lote as never, { duracao: {}, aspecto: {} })
    } catch (e) {
      erros.push(String(e))
    }
  ok(erros.length === 4, `4 lotes errados recusados (${erros.length})`)
  const { arquivo: m } = aplicarLote(projeto(), { textos: { titulos: ['Nia DESTRUIU o campeao'], descricao: 'oi', hashtags: ['anime', '#nia'] } }, { duracao: {}, aspecto: {} })
  const meta = m['metadata'] as { titles: string[]; hashtags: string[] }
  ok(meta.titles[0] === 'Nia DESTRUIU o campeao' && meta.hashtags.join(' ') === '#anime #nia', 'titulo e hashtags')
  const r = resumoDasCenas(projeto())
  ok(r.length === 3 && r[1]!['camera'] && r[0]!['focoAutomatico'] === true, 'listar_cenas')
}

// Um projeto real do PC do Levi (fora do CI): o resultado passa no esquema do Dangai.
const REAL = 'G:/tmp-medida/nia-referencia-final.dangai'
if (existsSync(REAL)) {
  console.log('projeto real')
  const p = JSON.parse(readFileSync(REAL, 'utf8')) as ArquivoDoProjeto
  const clipe = String(p.images[0]!['path'])
  const { arquivo: n } = aplicarLote(
    p,
    {
      cenas: [
        { cena: 2, focoX: 0.31, entrada: 0.2, efeito: 'zoom-out' },
        { cena: 5, camera: 'desligar', zoomFixo: 1.2 },
        { cena: 7, grid: { clipe, entrada: 0 } },
      ],
      sons: { adicionar: [{ arquivo: 'C:/ping.mp3', em: 3, ganhoDb: -10 }] },
      imagens: { adicionar: [{ arquivo: 'C:/seta.png', em: 3, duracao: 1, escala: 0.32, rotacao: 105 }] },
      textos: { titulos: ['a'], descricao: 'b', hashtags: ['c'] },
    },
    { duracao: { 'C:/ping.mp3': 1 }, aspecto: { 'C:/seta.png': 1 } },
  )
  const v = projectFileSchema.safeParse(n)
  ok(v.success, v.success ? 'passa no projectFileSchema' : JSON.stringify(v.error.issues.slice(0, 3)))
}

console.log('JSON-RPC')
const chamar = async (nome: string): Promise<{ type: 'text'; text: string }[]> => {
  if (nome === 'estado') return [{ type: 'text', text: 'ok' }]
  throw new Error('quebrou de proposito')
}
void (async () => {
  const ini = (await responderRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, '9.9.9', chamar))!
  const r = ini['result'] as { protocolVersion: string; serverInfo: { name: string } }
  ok(r.protocolVersion === '2025-06-18' && r.serverInfo.name === 'dangai', 'initialize')
  ok((await responderRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, '9', chamar)) === null, 'notificacao sem resposta')
  const lista = (await responderRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, '9', chamar))!
  ok(((lista['result'] as { tools: unknown[] }).tools.length ?? 0) >= 9, 'tools/list')
  const erro = (await responderRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'editar', arguments: {} } }, '9', chamar))!
  ok((erro['result'] as { isError: boolean }).isError === true, 'erro da ferramenta vira isError')
  const nao = (await responderRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'apagar_tudo' } }, '9', chamar))!
  ok((nao['error'] as { code: number }).code === -32602, 'ferramenta desconhecida')

  console.log('HTTP')
  const s = await subirServidor(47391, () => 'segredo', '9', chamar)
  const url = `http://127.0.0.1:${s.porta}/mcp`
  const post = (corpo: unknown, h: Record<string, string> = {}): Promise<Response> =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer segredo', ...h }, body: JSON.stringify(corpo) })
  ok((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: 'Bearer errada' })).status === 401, 'senha errada = 401')
  ok((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://site.com' })).status === 403, 'origem de fora = 403')
  ok((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status === 202, 'notificacao = 202')
  const r2 = await post({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'estado', arguments: {} } })
  const j = (await r2.json()) as { id: number; result: { content: { text: string }[] } }
  ok(r2.status === 200 && j.id === 7 && j.result.content[0]!.text === 'ok', 'tools/call pelo HTTP')
  const s2 = await subirServidor(s.porta, () => 'x', '9', chamar)
  ok(s2.porta === s.porta + 1, 'porta ocupada -> a proxima')
  await s2.fechar()
  await s.fechar()


  // Camera livre pelo assunto (cx/cy): a conta do nucleo (enquadrar) e a borda presa.
  const c1 = cameraDosPontos([{ t: 0, cx: 0.3 }, { t: 0.5, cx: 0.5, zoom: 1.3 }, { t: 1, cx: 0.7 }], 16 / 9, 9 / 16)
  ok(c1.camera.from.x === 20 && c1.camera.to.x === -20 && c1.camera.keys.length === 1 && c1.camera.keys[0]!.scale === 1.3 && c1.camera.source === true && c1.presos === 0, 'camera: cx 0,3 -> x 20, cx 0,7 -> x -20, chave do meio com zoom')
  const c2 = cameraDosPontos([{ t: 0, cx: 0.02 }, { t: 1, cx: 0.98 }], 16 / 9, 9 / 16)
  ok(Math.abs(c2.camera.from.x - 34.18) < 0.05 && Math.abs(c2.camera.to.x + 34.18) < 0.05 && c2.presos === 2, 'camera: assunto na beirada para na folga (34,2%), sem tarja')
  const pc = projeto()
  const rc = aplicarLote(pc, { cenas: [{ cena: 1, camera: { pontos: [{ t: 0, cx: 0.4 }, { t: 1, cx: 0.6 }] }, curva: 'chega-rapido' }] }, { duracao: {}, aspecto: { [String(pc.images[pc.plan.scenes[0]!['imageIndex'] as number]!['path'])]: 16 / 9 } })
  const s0 = rc.arquivo.plan.scenes[0]!
  ok((s0['camera'] as { from: { x: number } }).from.x === 10 && s0['curve'] === 'ease-out' && JSON.stringify(s0['curvePoints']) === '[0,0,0.052,0.964]', 'editar grava camera livre e a curva chega-rapido')
  const lido = resumoDasCenas(rc.arquivo, 1, 1)[0] as { camera: { pontos: { cx: number }[] }; curva: string }
  ok(lido.camera.pontos[0]!.cx === 0.4 && lido.camera.pontos[1]!.cx === 0.6 && lido.curva === 'chega-rapido', 'listar_cenas devolve a camera na mesma lingua (cx) e o nome da curva')
  // buscar_fala: o SRT do ffmpeg, a faixa em portugues e a busca sem acento.
  const srt = '1\n00:20:28,780 --> 00:20:30,100\n{\\an8}Não dá! Gastei\\Ntodo meu dinheiro!\n\n2\n00:20:31,100 --> 00:20:32,200\nEu empresto <i>500 milhões</i>!\n'
  const falas = lerSrt(srt)
  ok(falas.length === 2 && falas[0]!.inicio === 1228.78 && falas[0]!.texto === 'Não dá! Gastei todo meu dinheiro!', 'lerSrt tira as marcas do ASS e le o tempo')
  const faixas = 'Stream #0:2(eng): Subtitle: ass\nStream #0:3(por): Subtitle: ass\nStream #0:4(jpn): Subtitle: hdmv_pgs_subtitle'
  ok(escolherFaixa(faixas) === 1 && escolherFaixa(faixas, 'eng') === 0 && escolherFaixa('Stream #0:1(jpn): Subtitle: hdmv_pgs_subtitle') === null, 'faixa: portugues primeiro, imagem nao conta')
  const a = procurarNasFalas('C:/x/Anime.S01E07.mkv', falas, 'empresto 500 milhoes')
  ok(a.length === 1 && a[0]!.episodio === 'S01E07' && a[0]!.em === 1231.1, 'acha sem acento, episodio pelo nome')
  ok(procurarNasFalas('ep.mkv', falas, 'dinheiro empresto').length === 1, 'palavras em duas falas seguidas')

  console.log(falhas ? `\n${falhas} FALHARAM` : '\ntudo ok')
  process.exitCode = falhas ? 1 : 0
})()
