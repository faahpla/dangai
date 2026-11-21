/**
 * O ANCUT DENTRO DO DANGAI (20/11): as contas puras de shared/ancut.ts.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-ancut.ts`.
 *
 * O corte e o do proprio AnCut (o motor instalado); aqui so o que o Dangai
 * decide sozinho:
 * - o pedido que vai ao motor: "Só cortar" nao reconhece ninguem; "Cortar e
 *   reconhecer" soma por cima do que ja existe; B-roll e sempre so corte, com
 *   episodio 0 (o motor escolhe o numero) e o titulo/link de onde veio; as
 *   opcoes que faltam saem das configuracoes do AnCut, com os padroes dele;
 * - o evento que volta: etapa em portugues, o pronto com a pasta e as cenas,
 *   a pergunta do motor (anime nao achado, faltam fotos) vira falha com o que
 *   fazer -- nunca uma fila girando para sempre;
 * - o andamento geral nao volta para tras e chega a 1 no fim;
 * - o rotulo do item e o titulo do video baixado.
 *
 * Nada aqui roda o motor nem toca o disco.
 */
import {
  andamentoGeral,
  ETAPAS_DO_CORTE,
  eventoDoMotor,
  pedidoParaOMotor,
  rotuloDaEtapa,
  rotuloDoEpisodio,
  tituloDoArquivoBaixado,
  type PedidoDeCorte,
} from '../../shared/ancut.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

console.log('o pedido ao motor')
const episodio: PedidoDeCorte = {
  video: 'D:\\Downloads\\[SubsPlease] Kusuriya no Hitorigoto - 30.mkv',
  anime: '  Kusuriya no Hitorigoto ',
  temporada: 2,
  episodio: 30,
  tipo: '',
  modo: 'cortar',
}
const so = pedidoParaOMotor(episodio, {}, 'D:\\Animes')
ok('so cortar: cutOnly, sem somar por cima', so['cutOnly'] === true && so['mergePrevious'] === false)
ok('o anime vai sem espaco sobrando', so['anime'] === 'Kusuriya no Hitorigoto')
ok('temporada e episodio do pedido', so['season'] === 2 && so['episode'] === 30)
ok('a saida e a pasta do anime (vazia = o motor decide)', so['outputDir'] === 'D:\\Animes' && so['outputFolder'] === '')
ok('nunca abre o Modo Descoberta nem a revisao por IA', so['discovery'] === false && so['aiReview'] === false)
const p = so['params'] as Record<string, number>
ok('sem configuracao: os padroes do AnCut', p['threshold'] === 0.8 && p['margin'] === 0.03 && p['minShots'] === 3 && p['padding'] === 0.25 && p['credit'] === 0.55)
ok('sem configuracao: pula capitulos, sem danbooru, anime, compat', so['skipChapters'] === true && so['useDanbooru'] === false && so['mediaKind'] === 'anime' && so['renderExportMode'] === 'compat')

const rec = pedidoParaOMotor({ ...episodio, modo: 'reconhecer' }, { default_threshold: 0.7, use_danbooru: true, pular_capitulos: false, media_kind: 'live', render_export_mode: 'intra' }, 'D:\\Animes')
ok('reconhecer: analisa e soma por cima do que ja existe', rec['cutOnly'] === false && rec['mergePrevious'] === true)
ok('as configuracoes do AnCut valem', (rec['params'] as Record<string, number>)['threshold'] === 0.7 && rec['useDanbooru'] === true && rec['skipChapters'] === false && rec['mediaKind'] === 'live' && rec['renderExportMode'] === 'intra')
const lixo = pedidoParaOMotor(episodio, { default_threshold: Number.NaN, render_export_mode: 'qualquer' }, 'D:\\Animes')
ok('configuracao estragada volta ao padrao', (lixo['params'] as Record<string, number>)['threshold'] === 0.8 && lixo['renderExportMode'] === 'compat')
const tortos = pedidoParaOMotor({ ...episodio, temporada: 0, episodio: -3.7 }, {}, 'D:\\Animes')
ok('temporada no minimo 1, episodio no minimo 0', tortos['season'] === 1 && tortos['episode'] === 0)

const broll = pedidoParaOMotor(
  { ...episodio, tipo: 'BROLL', modo: 'reconhecer', temporada: 4, episodio: 12, titulo: 'Official Trailer', origem: 'https://youtu.be/x', pastaDoAnime: 'GTA 6' },
  {},
  'D:\\Animes',
)
ok('B-roll: sempre so corte, mesmo pedindo reconhecer', broll['cutOnly'] === true && broll['mergePrevious'] === false)
ok('B-roll: temporada 1, episodio 0 (o motor numera)', broll['season'] === 1 && broll['episode'] === 0 && broll['kind'] === 'BROLL')
ok('B-roll: titulo, link e pasta do anime', broll['titulo'] === 'Official Trailer' && broll['origem'] === 'https://youtu.be/x' && broll['outputFolder'] === 'GTA 6')

console.log('o evento do motor')
const etapa = eventoDoMotor({ type: 'stage', stage: 'cut_shots', fraction: 0.4, message: 'clipe 10/25' })
ok('etapa em portugues', etapa?.tipo === 'etapa' && etapa.rotulo === 'Cortando os clipes' && etapa.fracao === 0.4 && etapa.mensagem === 'clipe 10/25')
const semFracao = eventoDoMotor({ type: 'stage', stage: 'detect_shots' })
ok('etapa sem fracao = -1 (nao sabe quanto falta)', semFracao?.tipo === 'etapa' && semFracao.fracao === -1)
ok('etapa desconhecida (motor mais novo) vai como veio', rotuloDaEtapa('nova_etapa') === 'nova_etapa')
const pronto = eventoDoMotor({
  type: 'done',
  result: { episodeId: 42, episodeRoot: 'D:\\Animes\\Kusuriya\\S02E30', totalShots: 310, identifiedCharacters: ['Maomao', 7, 'Jinshi'], animeTitle: 'Kusuriya', season: 2, episode: 30 },
})
ok(
  'pronto: pasta, cenas e personagens (so os nomes)',
  pronto?.tipo === 'pronto' && pronto.episodioId === 42 && pronto.pasta === 'D:\\Animes\\Kusuriya\\S02E30' && pronto.cenas === 310 && pronto.personagens.join() === 'Maomao,Jinshi',
)
const prontoVazio = eventoDoMotor({ type: 'done' })
ok('pronto sem resultado nao quebra', prontoVazio?.tipo === 'pronto' && prontoVazio.cenas === 0 && prontoVazio.pasta === '')
const falhou = eventoDoMotor({ type: 'failed', message: 'ffmpeg saiu com 1' })
ok('falha com a mensagem do motor', falhou?.tipo === 'falhou' && falhou.mensagem === 'ffmpeg saiu com 1')
const falhouMudo = eventoDoMotor({ type: 'failed' })
ok('falha sem mensagem ainda diz algo', falhouMudo?.tipo === 'falhou' && falhouMudo.mensagem.length > 0)
ok('cancelado', eventoDoMotor({ type: 'cancelled' })?.tipo === 'cancelado')
const semAnime = eventoDoMotor({ type: 'needs-input', kind: 'anime-not-found' })
ok('anime nao achado vira falha com o que fazer', semAnime?.tipo === 'falhou' && semAnime.mensagem.includes('Só cortar'))
const semFotos = eventoDoMotor({ type: 'needs-input', kind: 'refs-missing' })
ok('faltam fotos vira falha com o que fazer', semFotos?.tipo === 'falhou' && semFotos.mensagem.includes('Só cortar'))
ok('outra pergunta tambem vira falha', eventoDoMotor({ type: 'needs-input', kind: 'outra' })?.tipo === 'falhou')
ok('Modo Descoberta (nunca pedido) vira falha, nao gira para sempre', eventoDoMotor({ type: 'discovery-ready' })?.tipo === 'falhou')
ok('log e tempos ficam de fora', eventoDoMotor({ type: 'log', message: 'x' }) === null && eventoDoMotor({ type: 'timings' }) === null)
ok('lixo nao quebra', eventoDoMotor(null) === null && eventoDoMotor('texto') === null && eventoDoMotor(3) === null)

console.log('o andamento geral')
for (const modo of ['cortar', 'reconhecer'] as const) {
  const conta = ETAPAS_DO_CORTE.filter((e) => modo === 'reconhecer' || e.soCorte)
  const pontos: number[] = []
  for (const e of conta) for (const f of [0, 0.5, 1]) pontos.push(andamentoGeral(e.id, f, modo))
  const sobe = pontos.every((v, i) => i === 0 || v >= pontos[i - 1]! - 1e-9)
  ok(`${modo}: nunca volta para tras`, sobe, pontos.map((v) => v.toFixed(2)).join(' '))
  ok(`${modo}: comeca em 0 e chega a 1`, pontos[0] === 0 && Math.abs(pontos[pontos.length - 1]! - 1) < 1e-9)
}
ok('so cortar: a etapa de reconhecer nao conta', andamentoGeral('analyze_shots', 0.5, 'cortar') === 0)
ok('fracao desconhecida conta como metade', andamentoGeral('detect_shots', -1, 'cortar') === andamentoGeral('detect_shots', 0.5, 'cortar'))
ok('fracao fora de 0..1 fica dentro', andamentoGeral('cut_shots', 7, 'cortar') === andamentoGeral('cut_shots', 1, 'cortar'))
ok('etapa desconhecida = 0', andamentoGeral('nova', 0.5, 'cortar') === 0)

console.log('os rotulos')
ok('episodio: S02E30', rotuloDoEpisodio({ tipo: '', temporada: 2, episodio: 30 }) === 'S02E30')
ok('episodio torto nao sai negativo', rotuloDoEpisodio({ tipo: '', temporada: 1, episodio: -2 }) === 'S01E00')
ok('B-roll com titulo', rotuloDoEpisodio({ tipo: 'BROLL', temporada: 1, episodio: 0, titulo: 'Teaser' }) === 'B-roll · Teaser')
ok('B-roll sem titulo', rotuloDoEpisodio({ tipo: 'BROLL', temporada: 1, episodio: 0 }) === 'B-roll')
ok('video baixado: sem o [codigo] e a extensao', tituloDoArquivoBaixado('D:\\Animes\\GTA 6\\Baixados\\Official Trailer [abc123def45].mp4') === 'Official Trailer')
ok('video baixado sem codigo: so tira a extensao', tituloDoArquivoBaixado('/tmp/Gameplay.webm') === 'Gameplay')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo ok')
process.exit(falhas ? 1 : 0)
