/**
 * B-ROLL DO ANCUT na biblioteca: trailer, gameplay e teaser que o AnCut HUB
 * baixa por link e grava em "<serie>/B-roll 03 - Titulo/".
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-broll-ancut.ts`.
 *
 * Antes desta mudanca o "B-roll 01" chegava como S01E01 (o json dizia
 * temporada 1, episodio 1) e o recap, que escolhe cena pelo episodio citado
 * no roteiro, podia usar cena de trailer como se fosse do episodio 1.
 *
 * - B-roll sai com temporada/episodio 0 e a marca `broll` (titulo e numero);
 * - vale a marca do json (`kind: "BROLL"`) E o nome da pasta, pra B-roll de
 *   AnCut anterior a marca;
 * - episodio comum nao muda;
 * - "episodio 1" do roteiro nao acha cena de B-roll;
 * - na ordem, o B-roll vem depois dos episodios da serie.
 *
 * Tudo em pastas sinteticas no TEMP. Nenhuma biblioteca real e tocada.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { configureLibrary, scanLibrary } from '../../electron/services/library.ts'
import { configureSettings } from '../../electron/services/settings.ts'
import { clipeNoAlvo } from '../../shared/broll.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const tmp = mkdtempSync(join(tmpdir(), 'dangai-broll-ancut-'))

async function pasta(
  raiz: string,
  serie: string,
  nome: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const dir = join(raiz, serie, nome)
  for (const sub of ['shots', 'keyframes', 'metadata']) mkdirSync(join(dir, sub), { recursive: true })
  writeFileSync(join(dir, 'shots', '0001.mp4'), 'nao e video')
  await sharp({ create: { width: 64, height: 36, channels: 3, background: { r: 90, g: 90, b: 160 } } })
    .jpeg()
    .toFile(join(dir, 'keyframes', '0001_1.jpg'))
  writeFileSync(
    join(dir, 'metadata', 'shots.json'),
    JSON.stringify([
      {
        shot_id: '0001',
        file: 'shots/0001.mp4',
        keyframe: 'keyframes/0001_1.jpg',
        start: 0,
        end: 2,
        duration: 2,
        characters: [{ name: 'Lucy' }],
        anime: serie,
        season: 1,
        episode: 1,
        ...extra,
      },
    ]),
  )
}

async function main(): Promise<void> {
  const raiz = join(tmp, 'lib')
  await pasta(raiz, 'Cyberpunk Edgerunners', 'S01E01')
  // AnCut 1.38.3+: a marca no json.
  await pasta(raiz, 'Cyberpunk Edgerunners', 'B-roll 02 - Watson (clipe)', {
    kind: 'BROLL',
    titulo: 'Petite Meller — Watson (clipe)',
  })
  // AnCut 1.38.0–1.38.2: só a pasta diz.
  await pasta(raiz, 'Cyberpunk Edgerunners', 'B-roll 01 - Official Trailer')

  const ud = join(tmp, 'ud')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ libraryDir: raiz }))
  configureSettings(ud)
  configureLibrary(ud)

  const indice = await scanLibrary(raiz, (p) => `url:${p}`)
  const porPasta = (trecho: string) => indice.clips.find((c) => c.path.includes(trecho))
  const ep = porPasta('S01E01')
  const comMarca = porPasta('B-roll 02')
  const soPasta = porPasta('B-roll 01')

  ok('episodio comum continua S01E01', ep?.season === 1 && ep?.episode === 1 && !ep?.broll)
  ok(
    'B-roll com marca: 0/0 e o titulo do json',
    comMarca?.season === 0 && comMarca?.episode === 0 && comMarca?.broll?.titulo === 'Petite Meller — Watson (clipe)' && comMarca?.broll?.numero === 2,
    JSON.stringify(comMarca?.broll),
  )
  ok(
    'B-roll sem marca (AnCut antigo): reconhecido pela pasta',
    soPasta?.season === 0 && soPasta?.episode === 0 && soPasta?.broll?.titulo === 'Official Trailer' && soPasta?.broll?.numero === 1,
    JSON.stringify(soPasta?.broll),
  )
  const alvoEp1 = [{ episodio: 1, temporada: null }]
  ok(
    '"episodio 1" do roteiro acha o episodio, nao o B-roll',
    !!ep && clipeNoAlvo(ep, alvoEp1) && !!comMarca && !clipeNoAlvo(comMarca, alvoEp1) && !!soPasta && !clipeNoAlvo(soPasta, alvoEp1),
  )
  const ordem = indice.clips.map((c) => (c.broll ? `B${c.broll.numero}` : `S${c.season}E${c.episode}`))
  ok('ordem: episodios, depois B-roll 01, 02', ordem.join(',') === 'S1E1,B1,B2', ordem.join(','))
  ok('o personagem do B-roll continua lá pra busca', comMarca?.characters.includes('Lucy') === true)
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
