/**
 * MANGA NA BIBLIOTECA (1.89): os quadrinhos de cada pagina, achados pela
 * sarjeta branca (electron/services/quadros.ts), e a pasta de mangas lida ao
 * lado da do AnCut (electron/services/manga.ts).
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-manga.ts`.
 *
 * Paginas sinteticas no TEMP. Com o capitulo de Bleach que ele mandou no disco
 * (D:\Mangás\Bleach\Cap. Especial - No Breaths From Hell), confere tambem
 * paginas de verdade; sem ele (no GitHub), essa parte e pulada.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { acharQuadros, recortarQuadro } from '../../electron/services/quadros.ts'
import { configureManga, ehDoManga, lerMangas, numeroDoCapitulo, pastaDosMangas } from '../../electron/services/manga.ts'
import { configureLibrary, escanearRaizes, raizesDaBiblioteca } from '../../electron/services/library.ts'
import { configureSettings, saveSettings } from '../../electron/services/settings.ts'
import { alternarInteira, importImages, montarInteira, reframeImage } from '../../electron/services/assets.ts'
import { configureClips } from '../../electron/services/clips.ts'
import { medidasAtuais } from '../../electron/services/formato.ts'
import { startMediaServer } from '../../electron/services/media-server.ts'
import { clipeNoAlvo } from '../../shared/broll.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

// ------------------------------------------------------------ paginas sinteticas

const W = 600
const H = 900
type Cor = [number, number, number]

/** Pagina branca; cada quadro e uma regiao com borda preta e cor propria. */
function pagina(quadros: { dentro: (x: number, y: number) => boolean; cor: Cor }[]): Uint8Array {
  const px = new Uint8Array(W * H * 3).fill(255)
  for (const q of quadros) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!q.dentro(x, y)) continue
        // Borda: algum vizinho a 3px fora da regiao.
        const borda = !q.dentro(x - 3, y) || !q.dentro(x + 3, y) || !q.dentro(x, y - 3) || !q.dentro(x, y + 3)
        const o = (y * W + x) * 3
        const c: Cor = borda ? [0, 0, 0] : q.cor
        px[o] = c[0]
        px[o + 1] = c[1]
        px[o + 2] = c[2]
      }
    }
  }
  return px
}
const ret = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1

const VERMELHO: Cor = [200, 40, 40]
const AZUL: Cor = [40, 40, 200]
const VERDE: Cor = [40, 160, 40]

// Grade: um quadro deitado em cima, dois embaixo.
const grade = pagina([
  { dentro: ret(30, 30, 570, 300), cor: VERMELHO },
  { dentro: ret(30, 330, 290, 870), cor: AZUL },
  { dentro: ret(310, 330, 570, 870), cor: VERDE },
])
// Corte inclinado: a sarjeta desce de (30,400) a (570,300), com 14px.
const linha = (x: number): number => 400 - ((x - 30) * 100) / 540
const inclinada = pagina([
  { dentro: (x, y) => ret(30, 30, 570, 870)(x, y) && y < linha(x) - 7, cor: VERMELHO },
  { dentro: (x, y) => ret(30, 30, 570, 870)(x, y) && y > linha(x) + 7, cor: AZUL },
])
// Capa: um quadro so, quase a pagina toda.
const capa = pagina([{ dentro: ret(8, 8, 592, 892), cor: AZUL }])
// Grade com sujeira na sarjeta (um "!" solto de 10px): nao vira quadro.
const comSujeira = pagina([
  { dentro: ret(30, 30, 570, 440), cor: VERMELHO },
  { dentro: ret(30, 470, 570, 870), cor: AZUL },
  { dentro: ret(295, 448, 305, 462), cor: [0, 0, 0] },
])

console.log('os quadrinhos de uma pagina (acharQuadros)')
{
  const lida = acharQuadros(grade, W, H, 3)
  ok('grade: tres quadros', lida.quadros.length === 3, String(lida.quadros.length))
  ok('grade: nao e pagina inteira', !lida.inteira)
  const ordem = lida.quadros.map((q) => `${q.x},${q.y}`).join(' ')
  ok('ordem de manga: o de cima, depois o da DIREITA, depois o da esquerda', ordem === '30,30 310,330 30,330', ordem)

  const diagonal = acharQuadros(inclinada, W, H, 3)
  ok('corte inclinado: dois quadros', diagonal.quadros.length === 2, String(diagonal.quadros.length))
  const [cima, baixo] = diagonal.quadros
  ok('os retangulos se sobrepoem (por isso o recorte pinta o vizinho)', !!cima && !!baixo && cima.y + cima.altura > baixo.y)
  if (cima) {
    const recorte = recortarQuadro(inclinada, W, 3, diagonal, cima)
    let azuis = 0
    let vermelhos = 0
    for (let i = 0; i < recorte.length; i += 3) {
      if (recorte[i + 2]! > 150 && recorte[i]! < 100) azuis++
      if (recorte[i]! > 150 && recorte[i + 2]! < 100) vermelhos++
    }
    ok('o recorte do de cima nao leva nada do de baixo', azuis === 0 && vermelhos > 1000, `${azuis} azuis, ${vermelhos} vermelhos`)
  }

  const splash = acharQuadros(capa, W, H, 3)
  ok('capa de um quadro so: pagina inteira, sem recorte', splash.inteira && splash.quadros.length === 0)

  const suja = acharQuadros(comSujeira, W, H, 3)
  ok('sujeira na sarjeta nao vira quadro', suja.quadros.length === 2, String(suja.quadros.length))

  // RGBA (png com transparencia) le igual.
  const rgba = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = grade[i * 3]!
    rgba[i * 4 + 1] = grade[i * 3 + 1]!
    rgba[i * 4 + 2] = grade[i * 3 + 2]!
    rgba[i * 4 + 3] = 255
  }
  ok('quatro canais: os mesmos tres quadros', acharQuadros(rgba, W, H, 4).quadros.length === 3)
}

console.log('o numero do capitulo pelo nome da pasta')
{
  const casos: [string, number | null][] = [
    ['Capítulo 45', 45],
    ['Cap. 12 - O Retorno', 12],
    ['cap 7', 7],
    ['Ch 101', 101],
    ['Chapter 3', 3],
    ['045', 45],
    ['Cap. Especial - No Breaths From Hell', null],
  ]
  for (const [nome, esperado] of casos) {
    ok(`"${nome}" -> ${esperado}`, numeroDoCapitulo(nome) === esperado, String(numeroDoCapitulo(nome)))
  }
}

// ------------------------------------------------------------ a pasta de mangas

const tmp = mkdtempSync(join(tmpdir(), 'dangai-manga-'))
const salvar = (px: Uint8Array, arquivo: string) =>
  sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile(arquivo)

async function main(): Promise<void> {
  const ud = join(tmp, 'perfil')
  const animes = join(tmp, 'Animes')
  const mangas = join(tmp, 'Mangás')
  mkdirSync(ud, { recursive: true })
  configureSettings(ud)
  configureLibrary(ud)
  configureManga(ud)

  // Um episodio do AnCut, para a grade juntar os dois.
  const ep = join(animes, 'Bleach TYBW', 'S01E01')
  for (const sub of ['shots', 'keyframes', 'metadata']) mkdirSync(join(ep, sub), { recursive: true })
  writeFileSync(join(ep, 'shots', '0001.mp4'), 'nao e video')
  await sharp({ create: { width: 64, height: 36, channels: 3, background: { r: 90, g: 90, b: 160 } } })
    .jpeg()
    .toFile(join(ep, 'keyframes', '0001_1.jpg'))
  writeFileSync(
    join(ep, 'metadata', 'shots.json'),
    JSON.stringify([{ shot_id: '0001', keyframe: 'keyframes/0001_1.jpg', start: 0, end: 2, duration: 2, characters: [] }]),
  )

  const cap2 = join(mangas, 'Bleach', 'Capítulo 2')
  const cap10 = join(mangas, 'Bleach', 'Capítulo 10')
  mkdirSync(cap2, { recursive: true })
  mkdirSync(cap10, { recursive: true })
  // Nome de pagina como o site baixa: numero sem zero na frente e um hash.
  await salvar(grade, join(cap2, '10-abc.png'))
  await salvar(capa, join(cap2, '9-def.png'))
  await salvar(inclinada, join(cap10, '1.png'))
  saveSettings({ libraryDir: animes, mangaDir: '' })

  console.log('a pasta dos mangas')
  ok('sem escolher, e a "Mangás" ao lado da biblioteca', pastaDosMangas() === mangas, String(pastaDosMangas()))

  const recados: string[] = []
  const itens = await lerMangas((p) => `url:${p}`, (m) => recados.push(m))
  const ids = itens.map((c) => c.id)
  ok('capitulo 2: pagina 9 inteira, depois a 10 e seus tres quadros', ids.filter((id) => id.includes('Capítulo 2/')).join(' ') ===
    'manga:Bleach/Capítulo 2/01 manga:Bleach/Capítulo 2/02 manga:Bleach/Capítulo 2/02-1 manga:Bleach/Capítulo 2/02-2 manga:Bleach/Capítulo 2/02-3',
    ids.join(' '))
  ok('capitulo 10: a pagina e os dois quadros inclinados', ids.filter((id) => id.includes('Capítulo 10/')).length === 3)
  const quadro = itens.find((c) => c.id.endsWith('/02-2'))!
  ok('o quadro sabe capitulo, pagina e posicao', quadro.manga?.capitulo === 'Capítulo 2' && quadro.manga.pagina === 2 && quadro.manga.quadro === 2)
  ok('o numero do capitulo vira o episodio', quadro.episode === 2 && itens.some((c) => c.episode === 10))
  ok('o recorte mora no perfil, nao na pasta dele', quadro.path.startsWith(join(ud, 'manga')) && existsSync(quadro.path))
  ok('a pasta dele continua so com as paginas', readdirSync(cap2).sort().join(' ') === '10-abc.png 9-def.png')
  ok('a pagina inteira aponta para o arquivo dele', itens.find((c) => c.id.endsWith('2/01'))!.path === join(cap2, '9-def.png'))
  ok('miniatura publicada', quadro.thumbUrl.startsWith('url:') && existsSync(quadro.thumbPath))
  ok('avisou que estava recortando', recados.some((r) => r.includes('Recortando o mangá Bleach')))

  ok('recorte e pagina sao "do manga"; o resto nao', ehDoManga(quadro.path) && ehDoManga(join(cap2, '9-def.png')) && !ehDoManga(join(ep, 'keyframes', '0001_1.jpg')))
  ok('manga nunca cai num alvo de episodio do B-roll', !clipeNoAlvo(quadro, [{ temporada: null, episodio: 2 }]))

  console.log('o cache')
  recados.length = 0
  const denovo = await lerMangas((p) => `url:${p}`, (m) => recados.push(m))
  ok('segunda leitura nao recorta de novo', recados.length === 0 && denovo.length === itens.length, recados.join(' | '))
  await salvar(capa, join(cap10, '2.png'))
  recados.length = 0
  const comNova = await lerMangas((p) => `url:${p}`, (m) => recados.push(m))
  ok('pagina nova: so o capitulo dela e recortado', recados.length > 0 && recados.every((r) => r.includes('Capítulo 10')), recados.join(' | '))
  ok('...e ela aparece', comNova.some((c) => c.id === 'manga:Bleach/Capítulo 10/02'))

  console.log('na grade, junto do AnCut')
  const indice = await escanearRaizes(raizesDaBiblioteca(), (p) => `url:${p}`)
  ok('a serie do manga aparece entre os animes', indice.animes.join(' + ') === 'Bleach + Bleach TYBW', indice.animes.join(' + '))
  const ordem = indice.clips.filter((c) => c.manga && c.manga.quadro === null).map((c) => `${c.manga!.capitulo}/${c.manga!.pagina}`)
  ok('capitulos pelo numero (2 antes do 10), paginas em ordem', ordem.join(' ') === 'Capítulo 2/1 Capítulo 2/2 Capítulo 10/1 Capítulo 10/2', ordem.join(' '))
  ok('a cena do AnCut continua la', indice.clips.some((c) => c.id === 'Bleach TYBW/S01E01/0001'))

  console.log('na timeline: o quadrinho deitado entra inteiro')
  configureClips(join(tmp, 'cache'))
  await startMediaServer()
  const deitado = itens.find((c) => c.id.endsWith('2/02-1'))! // 541x271: em 9:16 sobrariam 28%
  const paginaEmPe = itens.find((c) => c.id.endsWith('2/01'))! // a capa 600x900: sobram 84%
  const printSolto = join(tmp, 'print.png')
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: { r: 30, g: 120, b: 30 } } }).png().toFile(printSolto)
  const [a, b, c] = await importImages([deitado.path, paginaEmPe.path, printSolto])
  const { renderWidth, renderHeight } = medidasAtuais()
  ok('quadrinho deitado: inteiro, e a cena e a montagem (1,5x o quadro)', a!.inteira === true && a!.width === renderWidth * 1.5 && a!.height === renderHeight * 1.5, `${a!.inteira} ${a!.width}x${a!.height}`)
  ok('...com o caminho dele (e por ele que a Biblioteca o reconhece)', a!.path === deitado.path)
  ok('pagina em pe: cobre a tela, como um print', !b!.inteira && b!.width === 600)
  ok('print de fora do manga: cobre, como sempre', !c!.inteira && c!.width === 1280)

  const montagem = await montarInteira(deitado.path)
  const { data, info } = await sharp(montagem.caminho).raw().toBuffer({ resolveWithObject: true })
  const px = (x: number, y: number): number[] => {
    const o = (Math.round(y) * info.width + Math.round(x)) * info.channels
    return [data[o]!, data[o + 1]!, data[o + 2]!]
  }
  const meio = px(info.width / 2, info.height / 2)
  const canto = px(10, 10)
  ok('no meio, o quadrinho nitido (vermelho)', meio[0]! > 150 && meio[2]! < 100, meio.join(','))
  ok('no alto, o fundo desfocado e escurecido', canto[0]! < 150 && canto[0]! > 20, canto.join(','))

  const coberto = await alternarInteira(a!, false)
  ok('desligar: volta a cobrir, com as medidas do quadrinho', !coberto.inteira && coberto.width === 541, `${coberto.width}`)
  const inteiraDeNovo = await alternarInteira(b!, true)
  ok('ligar numa pagina: inteira', inteiraDeNovo.inteira === true && inteiraDeNovo.path === paginaEmPe.path)
  const [reaberto] = await importImages([deitado.path], [{ focusX: 0.5, focusY: 0.5, inteira: false }])
  ok('projeto reaberto manda: salvo coberto, volta coberto', !reaberto!.inteira)
  const [reabertoInteiro] = await importImages([printSolto], [{ focusX: 0.5, focusY: 0.5, inteira: true }])
  ok('...e salvo inteiro, volta inteiro', reabertoInteiro!.inteira === true)
  ok('reenquadrar uma inteira recorta da montagem', /\/m\//.test(await reframeImage(a!.id, deitado.path, 0.5, 0.5, true)))

  saveSettings({ mangaDir: join(tmp, 'nao-existe') })
  const semPasta = await escanearRaizes(raizesDaBiblioteca(), (p) => `url:${p}`)
  ok('pasta de manga que nao existe: a grade e so a do AnCut', semPasta.clips.length === 1 && !semPasta.clips[0]!.manga)
}

/** O capitulo dele, se estiver no disco: as paginas que conferi de olho em 11/2026. */
async function paginasDeVerdade(): Promise<void> {
  const dir = 'D:\\Mangás\\Bleach\\Cap. Especial - No Breaths From Hell'
  if (!existsSync(dir)) {
    console.log('(capitulo de Bleach fora do disco: paginas de verdade puladas)')
    return
  }
  console.log('paginas de verdade (Bleach, cap. especial)')
  const ler = async (prefixo: string) => {
    const nome = readdirSync(dir).find((n) => n.startsWith(`${prefixo}-`))!
    const { data, info } = await sharp(join(dir, nome)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    return acharQuadros(data, info.width, info.height, info.channels)
  }
  const p20 = await ler('20')
  ok('pagina 20 (grade com baloes): 5 quadros', p20.quadros.length === 5, String(p20.quadros.length))
  const p45 = await ler('45')
  ok('pagina 45 (cortes inclinados): 4 quadros', p45.quadros.length === 4, String(p45.quadros.length))
  const p15 = await ler('15')
  ok('pagina 15 (capa dupla): inteira', p15.inteira)
}

main()
  .then(paginasDeVerdade)
  .catch((err) => {
    console.error(err)
    falhas++
  })
  .finally(() => {
    rmSync(tmp, { recursive: true, force: true })
    console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
    process.exit(falhas === 0 ? 0 : 1)
  })
