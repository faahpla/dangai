/**
 * QUAL EPISODIO DO index.db DO ANCUT e a pasta da mescla -- no banco de hoje
 * (com output_root) e no antigo (sem a coluna). Bancos sinteticos numa pasta
 * temporaria: o do AnCut de verdade nunca e tocado.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-mesclar-banco.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { episodioNoBanco } from '../../electron/services/mesclar.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const dir = mkdtempSync(join(tmpdir(), 'dangai-mesclar-banco-'))
const pasta = (anime: string, ep: string, fonte?: string): string => {
  const p = join(dir, anime, ep)
  mkdirSync(join(p, 'metadata'), { recursive: true })
  if (fonte) writeFileSync(join(p, 'metadata', 'shot_bounds.json'), JSON.stringify({ source: fonte }))
  return p
}

// Banco ANTIGO: episode sem output_root.
const antigo = new DatabaseSync(join(dir, 'antigo.db'))
antigo.exec(`CREATE TABLE episode (id INTEGER PRIMARY KEY, anime_id INTEGER, season INTEGER, episode INTEGER, source_file TEXT, processed_at TIMESTAMP)`)
antigo.exec(`INSERT INTO episode VALUES (1, 1, 1, 5, 'D:/v/naruto-05.mkv', NULL), (2, 2, 1, 5, 'D:/v/bleach-05.mkv', NULL), (3, 1, 1, 7, 'D:/v/naruto-07.mkv', NULL)`)
const naruto5 = pasta('Naruto', 'S01E05', 'D:/v/naruto-05.mkv')
const bleach5 = pasta('Bleach', 'S01E05', 'D:\\v\\bleach-05.mkv')
const naruto7 = pasta('Naruto', 'S01E07')
const semCache = pasta('Outro', 'S01E05')
ok('antigo: SxxEyy unico acha sem shot_bounds', episodioNoBanco(antigo, naruto7)?.id === 3)
ok('antigo: dois S01E05, o video de origem desempata', episodioNoBanco(antigo, naruto5)?.id === 1)
ok('antigo: barra trocada no caminho ainda casa', episodioNoBanco(antigo, bleach5)?.id === 2)
ok('antigo: dois S01E05 sem nada para desempatar = nao adivinha', episodioNoBanco(antigo, semCache) === null)
ok('antigo: pasta sem SxxEyy = nao acha', episodioNoBanco(antigo, join(dir, 'Naruto', 'extras')) === null)
antigo.close()

// Banco de HOJE: output_root manda; sem ele gravado, cai na regra do nome.
const novo = new DatabaseSync(join(dir, 'novo.db'))
novo.exec(`CREATE TABLE episode (id INTEGER PRIMARY KEY, anime_id INTEGER, season INTEGER, episode INTEGER, source_file TEXT, processed_at TIMESTAMP, output_root TEXT, kind TEXT DEFAULT '')`)
novo.prepare(`INSERT INTO episode VALUES (10, 1, 1, 5, 'x', NULL, ?, ''), (11, 2, 1, 5, 'D:/v/bleach-05.mkv', NULL, NULL, '')`).run(naruto5.replace(/\\/g, '/'))
ok('novo: output_root acha (com barra trocada)', episodioNoBanco(novo, naruto5)?.id === 10)
ok('novo: sem output_root gravado, o nome e o video acham', episodioNoBanco(novo, bleach5)?.id === 11)
novo.close()

rmSync(dir, { recursive: true, force: true })
console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
