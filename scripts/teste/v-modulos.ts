/**
 * FASE 0 DO MODULO: o nucleo guarda e devolve o que nao entende.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-modulos.ts`.
 *
 * Um projeto do AniRecap Studio (o `studio` na raiz, `papel`/`ducking`/
 * `corOriginal` nos itens) e os dados de modulo (`modulos.recap`) passam por
 * abrir -> gravar -> abrir (arquivo e autosave) sem perder nada. Dado de
 * modulo invalido nao impede o projeto de abrir. A versao vira 2 so com dado
 * de modulo, e versao do futuro e recusada.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  configureProjects,
  openProjectFile,
  readAutosave,
  saveProjectFile,
  writeAutosave,
} from '../../electron/services/project.ts'
import { chavesDesconhecidas, projetoTemModulos } from '../../shared/project-file.ts'
import { classifyFile } from '../../shared/channels.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const dir = mkdtempSync(join(tmpdir(), 'dangai-modulos-'))
const audio = join(dir, 'narracao.mp3')
writeFileSync(audio, 'x')

const trilha = {
  id: 't1', path: audio, fileName: 'musica.mp3', faixa: 0, at: 0, durationSec: 10, inicioSec: 0, usarSec: null,
  gainDb: -20, fadeInSec: 0.5, fadeOutSec: 1, peaks: [], rms: [],
}
const clipe = {
  id: 'o1', path: '', fileName: 'Camada de ajuste', tipo: 'ajuste', faixa: 0, at: 0, durationSec: 3600, inicioSec: 0,
  usarSec: 4, x: 0, y: 0, escala: 1, opacidade: 1, aspecto: 1, rotacao: 0, efeito: 'nenhum', intensidade: 0.1,
  curva: 'ease-in-out', pontosDaCurva: null, espelhar: false, fadeInSec: 0, fadeOutSec: 0,
  chaves: [{ t: 0, x: 0, y: 0, escala: 1, rotacao: 0 }, { t: 2, x: 10, y: 0, escala: 1.5, rotacao: 0 }],
  pivo: { x: 0.4, y: 0.5 },
}
const base = {
  version: 1, savedAt: '2026-10-16T00:00:00.000Z', formato: 'short',
  audio: { path: audio, rel: null, fileName: 'narracao.mp3' }, images: [], script: 'Oi.', subtitle: null,
  plan: null, planOrigin: null, planEdited: false, transcript: null, captions: [], captionsEdited: false,
  captionsEnabled: true, sfxEnabled: false,
}

// 1. O projeto do Studio de hoje: campos que o Dangai nao conhece, na raiz e nos itens.
const studio = { rascunhoId: 'r1', vozAlinhada: true, secoes: [{ nome: 'Gancho', inicio: 0 }] }
const doStudio = {
  ...base,
  studio,
  trilhas: [{ ...trilha, papel: 'musica', ducking: { db: -6 } }],
  sobreposicoes: [{ ...clipe, papel: 'cor', corOriginal: { brilho: 0.1 } }],
}
const anirecap = join(dir, 'video.anirecap')
writeFileSync(anirecap, JSON.stringify(doStudio))
ok('.anirecap e projeto', classifyFile('video.anirecap') === 'project')
const aberto = openProjectFile(anirecap).file as Record<string, any>
ok('abre o .anirecap', aberto.audio.path === audio)
ok('o `studio` da raiz fica', JSON.stringify(aberto.studio) === JSON.stringify(studio))
ok('o store separa o que nao conhece', Object.keys(chavesDesconhecidas(aberto)).join() === 'studio')
ok('papel e ducking do trecho ficam', aberto.trilhas[0].papel === 'musica' && aberto.trilhas[0].ducking?.db === -6)
ok('papel e corOriginal do clipe ficam', aberto.sobreposicoes[0].papel === 'cor' && aberto.sobreposicoes[0].corOriginal?.brilho === 0.1)
ok('quadros-chave e pivo da 1.67 ficam', aberto.sobreposicoes[0].chaves?.length === 2 && aberto.sobreposicoes[0].pivo?.x === 0.4)

// Gravar como .dangai e abrir de novo: identico, e o .anirecap original intacto.
const dangai = join(dir, 'video.dangai')
const antesDoOriginal = readFileSync(anirecap, 'utf8')
saveProjectFile(dangai, aberto as never)
const reaberto = openProjectFile(dangai).file as Record<string, any>
ok('salvo e reaberto: studio', JSON.stringify(reaberto.studio) === JSON.stringify(studio))
ok('salvo e reaberto: itens', reaberto.trilhas[0].ducking?.db === -6 && reaberto.sobreposicoes[0].corOriginal?.brilho === 0.1)
ok('sem dado de modulo continua versao 1', JSON.parse(readFileSync(dangai, 'utf8')).version === 1)
ok('o .anirecap nao foi tocado', readFileSync(anirecap, 'utf8') === antesDoOriginal)

// 2. Dados de modulo de verdade: versao 2, e voltam intactos (arquivo e autosave).
const recap = { versao: 1, rascunhoId: 'r1', secoes: [1, 2, 3] }
const comModulos = {
  ...base,
  modulos: { recap },
  trilhas: [{ ...trilha, modulos: { recap: { versao: 1, papel: 'whoosh' } } }],
  sobreposicoes: [{ ...clipe, modulos: { recap: { versao: 1, papel: 'cor' } } }],
}
const p2 = join(dir, 'com-modulos.dangai')
writeFileSync(p2, JSON.stringify(comModulos))
const m = openProjectFile(p2).file
ok('modulos da raiz lidos', JSON.stringify(m.modulos) === JSON.stringify({ recap }))
ok('modulos dos itens lidos', (m.trilhas[0]!.modulos as any)?.recap?.papel === 'whoosh' && (m.sobreposicoes[0]!.modulos as any)?.recap?.papel === 'cor')
ok('modulos nao sao "desconhecidos"', Object.keys(chavesDesconhecidas(m)).length === 0)
saveProjectFile(p2, m)
ok('com dado de modulo grava versao 2', JSON.parse(readFileSync(p2, 'utf8')).version === 2)
ok('e reabre (o app le ate a 2)', openProjectFile(p2).file.modulos?.['recap'] !== undefined)
const soNoItem = { ...m, modulos: undefined }
ok('dado de modulo so num item ja conta', projetoTemModulos(soNoItem))

configureProjects(dir)
writeAutosave({ ...(doStudio as never), modulos: { recap } }, anirecap)
const recuperado = readAutosave()
ok('autosave recupera o caminho do .anirecap', recuperado?.path === anirecap)
ok('autosave recupera studio e modulos', JSON.stringify((recuperado?.file as any)?.studio) === JSON.stringify(studio) && (recuperado?.file.modulos as any)?.recap?.versao === 1)
ok('autosave recupera os campos dos itens', (recuperado?.file.trilhas[0] as any)?.ducking?.db === -6)

// 3. Dado de modulo invalido: o projeto abre; so o pedaco ruim sai.
const p3 = join(dir, 'invalido.dangai')
writeFileSync(p3, JSON.stringify({ ...comModulos, version: 2, modulos: 'quebrado', trilhas: [{ ...trilha, modulos: [1, 2] }] }))
let abriu = false
try {
  const inv = openProjectFile(p3).file
  abriu = inv.modulos === undefined && inv.trilhas[0]!.modulos === undefined && inv.audio.path === audio
} catch (e) {
  console.log('   ', (e as Error).message)
}
ok('modulos invalidos nao impedem de abrir', abriu)

// 4. Versao do futuro: recusa com recado, nunca abre perdendo coisa.
const p4 = join(dir, 'futuro.dangai')
writeFileSync(p4, JSON.stringify({ ...comModulos, version: 3 }))
let recado = ''
try {
  openProjectFile(p4)
} catch (e) {
  recado = (e as Error).message
}
ok('versao 3 e recusada pedindo para atualizar', /versao mais nova/.test(recado), recado)

rmSync(dir, { recursive: true, force: true })
console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
