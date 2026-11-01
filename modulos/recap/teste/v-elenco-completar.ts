/**
 * COMPLETAR O ELENCO (31/10): o banco do motor do Studio ja reconhece alguem e
 * o AnCut reconhece quem ele nao. Tudo em pastas temporarias.
 *
 * Confere: quem o Studio ja reconhece fica intocado; quem tem 1 foto ou
 * nenhuma ganha as do AnCut, na pasta da mesma pessoa ("magna swing" ->
 * "Swing, Magna" do elenco); quem so existe no AnCut ganha pasta propria;
 * quem tem 1 foto no AnCut nao vem; rodar de novo nao copia nada; a origem
 * fica igual; o banco vazio continua sendo copiado inteiro.
 *
 * RECAP_TESTE_ELENCO_REAL=1: o ensaio com os dados de verdade (o banco do
 * Black Clover do motor do Studio copiado para o temp, o anime_db do AnCut so
 * lido) e a lista de quem entraria.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-elenco-completar.ts
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reservarElenco } from '../electron/elenco-reserva'

let falhas = 0
let total = 0
function ok(nome: string, cond: boolean, detalhe = ''): void {
  total++
  if (cond) console.log(`  ok   ${nome}${detalhe ? `  (${detalhe})` : ''}`)
  else {
    falhas++
    console.log(`  FALHA ${nome}${detalhe ? `\n        ${detalhe}` : ''}`)
  }
}

const BASE = mkdtempSync(join(process.env['RECAP_TESTE_PASTA'] ?? tmpdir(), 'elenco-completar-'))
const ID = 'al87528'

function banco(pasta: string, nomes: string[], fotos: Record<string, number>): void {
  mkdirSync(join(pasta, 'characters'), { recursive: true })
  writeFileSync(
    join(pasta, 'metadata.json'),
    JSON.stringify({ version: 4, title: 'Black Clover', characters: nomes.map((name) => ({ name, image_urls: [] })) }),
  )
  for (const [quem, n] of Object.entries(fotos)) {
    mkdirSync(join(pasta, 'characters', quem), { recursive: true })
    for (let i = 0; i < n; i++) writeFileSync(join(pasta, 'characters', quem, `auto_disc_${i}.jpg`), `${quem}-${i}`)
  }
}

function fotos(pasta: string): string[] {
  return existsSync(pasta) ? readdirSync(pasta).sort() : []
}

function retrato(raiz: string): string {
  const linhas: string[] = []
  const andar = (p: string, rel: string): void => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`
      if (e.isDirectory()) andar(join(p, e.name), r)
      else linhas.push(`${r}:${readFileSync(join(p, e.name)).length}`)
    }
  }
  andar(raiz, '')
  return linhas.sort().join('\n')
}

async function testes(): Promise<void> {
  console.log('1. completar um banco que ja reconhece alguem')
  const dados = join(BASE, 'motor')
  const studio = join(dados, 'cache', 'anime_db', `Black Clover 2nd Season [${ID}]`)
  banco(studio, ['Asta', 'Swing, Magna', 'Ideale, Zora'], { Asta: 2, 'Ideale, Zora': 1 })
  const ancut = join(BASE, 'ancut', 'anime_db')
  banco(join(ancut, `Black Clover [${ID}]`), ['Asta'], {
    Asta: 3,
    'magna swing': 3,
    'Ideale, Zora': 3,
    'dante zogratis': 2,
    Gauche: 1,
  })
  process.env['ANIRECAP_ELENCO_RESERVA'] = ancut
  const antesDaOrigem = retrato(ancut)

  const r = await reservarElenco(dados, { anime: 'Black Clover', temporada: 2, cacheId: ID })
  const ch = join(studio, 'characters')
  ok('nao copia o banco inteiro (o do Studio fica)', r.reserva === null, r.linha)
  ok('3 personagens completados', r.completados === 3, String(r.completados))
  ok('quem o Studio ja reconhece fica intocado', fotos(join(ch, 'Asta')).join() === 'auto_disc_0.jpg,auto_disc_1.jpg')
  ok(
    'magna swing do AnCut vai para a pasta do nome do elenco (Swing, Magna)',
    fotos(join(ch, 'Swing, Magna')).length === 3 && !existsSync(join(ch, 'magna swing')),
    fotos(join(ch, 'Swing, Magna')).join(),
  )
  ok(
    'a Zora com 1 foto ganha as 3 do AnCut, sem colidir com a dela',
    fotos(join(ch, 'Ideale, Zora')).join() === 'ancut_auto_disc_0.jpg,ancut_auto_disc_1.jpg,ancut_auto_disc_2.jpg,auto_disc_0.jpg' &&
      readFileSync(join(ch, 'Ideale, Zora', 'auto_disc_0.jpg'), 'utf8') === 'Ideale, Zora-0',
    fotos(join(ch, 'Ideale, Zora')).join(),
  )
  ok('quem so existe no AnCut ganha pasta propria', fotos(join(ch, 'dante zogratis')).length === 2)
  ok('quem tem 1 foto no AnCut nao vem', !existsSync(join(ch, 'Gauche')))
  ok('a origem fica igual', retrato(ancut) === antesDaOrigem)

  const antes = retrato(studio)
  const r2 = await reservarElenco(dados, { anime: 'Black Clover', temporada: 2, cacheId: ID })
  ok('rodar de novo nao copia nada', r2.completados === 0 && retrato(studio) === antes, r2.linha)

  console.log('\n2. o banco vazio continua sendo copiado inteiro')
  const dados2 = join(BASE, 'motor-vazio')
  mkdirSync(join(dados2, 'cache', 'anime_db'), { recursive: true })
  const r3 = await reservarElenco(dados2, { anime: 'Black Clover', temporada: 2, cacheId: ID })
  ok('copiado', r3.reserva !== null && existsSync(join(dados2, 'cache', 'anime_db', `Black Clover [${ID}]`, 'characters', 'magna swing')), r3.linha)

  if (process.env['RECAP_TESTE_ELENCO_REAL'] === '1') {
    console.log('\n3. ensaio com os dados de verdade (copia do motor; o AnCut so lido)')
    const local = process.env['LOCALAPPDATA'] ?? ''
    const appdata = process.env['APPDATA'] ?? ''
    const real = join(appdata, 'dangai', 'modulos', 'recap', 'motor', 'cache', 'anime_db', `Black Clover 2nd Season [${ID}]`)
    const doAncut = join(local, 'CorteCenas', 'CorteCenas', 'cache', 'anime_db')
    if (!existsSync(real) || !existsSync(doAncut)) {
      ok('dados de verdade presentes', false, `${real} / ${doAncut}`)
    } else {
      const dados3 = join(BASE, 'motor-real')
      const copia = join(dados3, 'cache', 'anime_db', `Black Clover 2nd Season [${ID}]`)
      cpSync(real, copia, { recursive: true })
      process.env['ANIRECAP_ELENCO_RESERVA'] = doAncut
      const r4 = await reservarElenco(dados3, { anime: 'Black Clover', temporada: 2, cacheId: ID })
      console.log(`     ${r4.linha}`)
      ok('o ensaio completou alguem', (r4.completados ?? 0) > 0, String(r4.completados))
    }
  }
}

testes()
  .catch((err: unknown) => {
    falhas++
    console.log('ERRO', err instanceof Error ? err.stack : err)
  })
  .finally(() => {
    console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`} em ${total} conferencias`)
    rmSync(BASE, { recursive: true, force: true })
    process.exit(falhas === 0 ? 0 : 1)
  })
