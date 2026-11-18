/**
 * AS PASTAS SOLTAS NA BIBLIOTECA (18/11): video e imagem direto numa pasta,
 * sem o AnCut. `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-pastas-soltas.ts`.
 *
 * "Criei a pasta D:\Animes\BUGs GTA 6 pra fazer um video de GTA, por que isso
 * nao aparece na biblioteca" -- os videos baixados estavam soltos na pasta, e
 * a biblioteca so lia o episodio cortado pelo AnCut.
 *
 * - o video solto entra INTEIRO (a duracao dele), com miniatura, o titulo do
 *   nome do arquivo sem o [codigo] do download, temporada/episodio 0;
 * - a imagem solta entra como imagem (duracao 0);
 * - a serie e a pasta de cima; a subpasta ("Baixados") vai junto;
 * - NAO entra: o episodio do AnCut (continua como sempre), o episodio que o
 *   AnCut ainda esta cortando (shots/ sem o json), a lixeira, arquivo na raiz,
 *   o que nao e video nem imagem;
 * - a segunda leitura sai do cache, e um arquivo novo na pasta entra.
 *
 * Tudo em pastas sinteticas no TEMP. Nenhuma biblioteca real e tocada.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { ffmpegPath } from '../../electron/services/ffmpeg-path.ts'
import { configureLibrary, midiaSoltaEm, pastasSoltasEm, scanLibrary, tituloDoSolto } from '../../electron/services/library.ts'
import { configureSettings } from '../../electron/services/settings.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const tmp = mkdtempSync(join(tmpdir(), 'dangai-pastas-soltas-'))

/** Um mp4 de verdade (o app le a duracao e tira um quadro dele). */
function video(caminho: string, segundos: number): void {
  execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=24:duration=${segundos}`, '-pix_fmt', 'yuv420p', caminho])
}

async function imagem(caminho: string): Promise<void> {
  await sharp({ create: { width: 64, height: 36, channels: 3, background: { r: 200, g: 60, b: 60 } } }).jpeg().toFile(caminho)
}

/** Um episodio do AnCut (shots, keyframe e o json). */
async function episodio(dir: string, comJson = true): Promise<void> {
  for (const sub of ['shots', 'keyframes', 'metadata']) mkdirSync(join(dir, sub), { recursive: true })
  writeFileSync(join(dir, 'shots', '0001.mp4'), 'nao e video')
  await imagem(join(dir, 'keyframes', '0001_1.jpg'))
  if (comJson) {
    writeFileSync(
      join(dir, 'metadata', 'shots.json'),
      JSON.stringify([{ shot_id: '0001', keyframe: 'keyframes/0001_1.jpg', start: 0, end: 2, duration: 2, characters: [], season: 1, episode: 1 }]),
    )
  }
}

async function main(): Promise<void> {
  console.log('\n== o titulo do arquivo baixado')
  ok('o [codigo] e o sublinhado saem', tituloDoSolto('Cae_debajo_del_mapa. [2123017353315188736].mp4') === 'Cae debajo del mapa', tituloDoSolto('Cae_debajo_del_mapa. [2123017353315188736].mp4'))
  ok('nome sem codigo fica como e', tituloDoSolto('HXauRbaXYAAZMXl.jpg') === 'HXauRbaXYAAZMXl')
  ok('o nome cortado com reticencias perde os pontos do fim', tituloDoSolto('El_avion_no_se_rompe... [2123039061166149632].mp4') === 'El avion no se rompe')

  const raiz = join(tmp, 'Animes')
  const gta = join(raiz, 'BUGs GTA 6')
  mkdirSync(gta, { recursive: true })
  video(join(gta, 'Bug_de_la_catapulta. [2123047311479611393].mp4'), 2)
  video(join(gta, 'Motorista_fantasma. [2123050397027684353].mp4'), 3)
  await imagem(join(gta, 'HXauRbaXYAAZMXl.jpg'))
  writeFileSync(join(gta, 'leia-me.txt'), 'nao e midia')
  await episodio(join(raiz, 'Chainsaw Man', 'S01E01'))
  mkdirSync(join(raiz, 'Chainsaw Man', 'Baixados'), { recursive: true })
  video(join(raiz, 'Chainsaw Man', 'Baixados', 'Official Trailer 2 [s8cP1Vt5US8].mp4'), 2)
  // O episodio que o AnCut ainda esta cortando: shots/ sem o json.
  await episodio(join(raiz, 'Chainsaw Man', 'S01E02'), false)
  mkdirSync(join(raiz, '_lixeira'), { recursive: true })
  video(join(raiz, '_lixeira', 'descartado.mp4'), 1)
  video(join(raiz, 'na-raiz.mp4'), 1)

  console.log('\n== quais pastas sao soltas')
  const soltas = [...pastasSoltasEm(raiz, 0)].map((d) => d.slice(raiz.length + 1).replace(/\\/g, '/'))
  ok('a do GTA e a Baixados; nem o episodio, nem o que o AnCut esta cortando, nem a lixeira, nem a raiz', soltas.join('|') === 'BUGs GTA 6|Chainsaw Man/Baixados', soltas.join('|'))
  ok('so video e imagem contam (o .txt fica de fora)', midiaSoltaEm(gta).map((m) => m.nome).join('|') === 'Bug_de_la_catapulta. [2123047311479611393].mp4|HXauRbaXYAAZMXl.jpg|Motorista_fantasma. [2123050397027684353].mp4')

  console.log('\n== na grade')
  const ud = join(tmp, 'ud')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ libraryDir: raiz }))
  configureSettings(ud)
  configureLibrary(ud)
  const indice = await scanLibrary(raiz, (p) => `url:${p}`)
  const doGta = indice.clips.filter((c) => c.anime === 'BUGs GTA 6')
  const catapulta = doGta.find((c) => c.solto?.titulo === 'Bug de la catapulta')
  const foto = doGta.find((c) => c.solto?.imagem)
  ok('os 3 arquivos do GTA entram (2 videos e 1 imagem)', doGta.length === 3, doGta.map((c) => c.solto?.titulo).join(', '))
  ok(
    'o video inteiro: a duracao dele, 0/0, sem personagem, com miniatura',
    !!catapulta && Math.abs(catapulta.duration - 2) < 0.2 && catapulta.season === 0 && catapulta.episode === 0 && catapulta.characters.length === 0 && catapulta.thumbUrl.startsWith('url:') && catapulta.solto?.pasta === null,
    JSON.stringify(catapulta && { d: catapulta.duration, s: catapulta.solto }),
  )
  ok('a imagem: duracao 0 e marcada como imagem', !!foto && foto.duration === 0 && foto.path.endsWith('.jpg'))
  const trailer = indice.clips.find((c) => c.solto && c.anime === 'Chainsaw Man')
  ok('a Baixados: a serie e a de cima, a subpasta vai junto', trailer?.solto?.pasta === 'Baixados' && trailer.solto.titulo === 'Official Trailer 2', JSON.stringify(trailer?.solto))
  const ep = indice.clips.find((c) => c.anime === 'Chainsaw Man' && !c.solto)
  ok('o episodio do AnCut continua como sempre (S01E01)', ep?.season === 1 && ep.episode === 1)
  ok('nada da lixeira, da raiz nem do episodio pela metade', !indice.clips.some((c) => /descartado|na-raiz|S01E02/.test(c.path)))
  ok('na ordem, o solto vem depois dos episodios da serie', indice.clips.filter((c) => c.anime === 'Chainsaw Man').map((c) => (c.solto ? 'solto' : 'ep')).join(',') === 'ep,solto')

  console.log('\n== de novo')
  const denovo = await scanLibrary(raiz, (p) => `url:${p}`)
  ok('a segunda leitura sai do cache (nada relido)', denovo.scanned === 0 && denovo.clips.length === indice.clips.length, `relidos: ${denovo.scanned}`)
  video(join(gta, 'Un_NPC_nadando_de_lado. [2123038968543399936].mp4'), 2)
  const comNovo = await scanLibrary(raiz, (p) => `url:${p}`)
  ok('um video novo na pasta entra (e so ela e relida)', comNovo.clips.filter((c) => c.anime === 'BUGs GTA 6').length === 4 && comNovo.scanned === 1, `relidos: ${comNovo.scanned}`)
}

main()
  .catch((e) => {
    console.error(e)
    falhas++
  })
  .finally(() => {
    rmSync(tmp, { recursive: true, force: true })
    console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo ok')
    process.exit(falhas ? 1 : 0)
  })
