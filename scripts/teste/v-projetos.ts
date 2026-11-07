/**
 * A pasta dos projetos, o auto save no proprio arquivo e a faxina (1.98):
 *
 *  - o nome digitado vira um nome de arquivo que o Windows aceita;
 *  - criar nunca grava por cima de outro projeto ("<nome> (2)");
 *  - o auto save nao grava por cima uma perda grande (fica para o Ctrl+S);
 *  - a faxina apaga o que esta sessao gerou com id, e so sobras velhas de outras;
 *  - depois do render, o trabalho da etapa de audio desta gravacao sai do cache.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/teste/v-projetos.ts
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  configureProjects,
  criarProjetoNaPasta,
  gravarProjetoSozinho,
  nomeDeArquivo,
  pastaDosProjetos,
} from '../../electron/services/project.ts'
import { configurarFaxina, idNovo, limparAoSair, varrerSobras } from '../../electron/services/faxina.ts'
import { configureEdicaoDeAudio, limparTrabalhoDaEdicao } from '../../electron/services/edicao-de-audio.ts'
import { novaEdicao, CADEIA_PADRAO } from '../../shared/edicao-de-audio.ts'
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import type { ProjectFile } from '../../shared/project-file.ts'

let falhas = 0
function conferir(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) {
    console.log(`  ok   ${nome}`)
  } else {
    falhas += 1
    console.log(`  FALHA ${nome}\n        obtido:   ${a}\n        esperado: ${b}`)
  }
}

const raiz = mkdtempSync(join(tmpdir(), 'v-projetos-'))
try {
  // ------------------------------------------------------------ nome
  console.log('nome do arquivo')
  conferir('nome comum fica igual', nomeDeArquivo('Frieren ep 12'), 'Frieren ep 12')
  conferir('sinais proibidos viram espaco', nomeDeArquivo('Ep 1: "Teste"/fim?'), 'Ep 1 Teste fim')
  conferir('ponto e espaco no fim saem', nomeDeArquivo('recap...  '), 'recap')
  conferir('nome reservado do Windows', nomeDeArquivo('con'), 'con (projeto)')
  conferir('vazio vira Projeto', nomeDeArquivo('  ?? '), 'Projeto')

  // ------------------------------------------------------------ pasta
  console.log('pasta dos projetos')
  const userData = join(raiz, 'userData')
  const documentos = join(raiz, 'Documentos')
  configureProjects(userData, documentos)
  const padrao = pastaDosProjetos('')
  conferir('padrao nos Documentos', padrao, join(documentos, 'Dangai', 'Projetos'))
  conferir('padrao criada', existsSync(padrao), true)
  const escolhida = join(raiz, 'Minha pasta')
  conferir('a escolhida vale', pastaDosProjetos(escolhida), escolhida)

  // ------------------------------------------------------------ criar
  console.log('criar projeto')
  const narracao = join(raiz, 'narracao.wav')
  writeFileSync(narracao, 'x')
  const projeto = (cenas: number, legendas: number): ProjectFile =>
    ({
      version: 1,
      audio: { path: narracao, rel: null },
      images: [],
      trilhas: [],
      sobreposicoes: [],
      captions: Array.from({ length: legendas }, (_, i) => ({ id: `c${i}` })),
      plan: { scenes: Array.from({ length: cenas }, (_, i) => ({ id: `s${i}` })) },
    }) as unknown as ProjectFile
  const a = criarProjetoNaPasta(padrao, 'Frieren', projeto(10, 30))
  const b = criarProjetoNaPasta(padrao, 'Frieren', projeto(10, 30))
  const c = criarProjetoNaPasta(padrao, 'Frieren', projeto(10, 30))
  conferir('primeiro com o nome', a, join(padrao, 'Frieren.dangai'))
  conferir('segundo nao grava por cima', b, join(padrao, 'Frieren (2).dangai'))
  conferir('terceiro', c, join(padrao, 'Frieren (3).dangai'))

  // ------------------------------------------------------------ auto save
  console.log('auto save no arquivo')
  conferir('edicao normal grava', gravarProjetoSozinho(a, projeto(10, 28)), true)
  const lido = JSON.parse(readFileSync(a, 'utf8')) as { captions: unknown[] }
  conferir('o arquivo tem o estado novo', lido.captions.length, 28)
  conferir('perda grande nao grava', gravarProjetoSozinho(a, projeto(10, 0)), false)
  conferir('o arquivo continua com o que tinha', (JSON.parse(readFileSync(a, 'utf8')) as { captions: unknown[] }).captions.length, 28)
  conferir('.anirecap nunca e regravado', gravarProjetoSozinho(join(raiz, 'x.anirecap'), projeto(1, 1)), false)
  const novo = join(raiz, 'nao-existia.dangai')
  conferir('arquivo que ainda nao existe grava', gravarProjetoSozinho(novo, projeto(1, 1)), true)

  // ------------------------------------------------------------ faxina
  console.log('faxina por sessao')
  const cache = join(raiz, 'render-cache')
  const upscale = join(raiz, 'upscale')
  mkdirSync(cache)
  mkdirSync(upscale)
  configurarFaxina([cache, upscale])
  const minha = idNovo()
  const deOutraJanela = '0a1b2c3d-1111-2222-3333-444455556666'
  const velhaDeOutra = '9f8e7d6c-1111-2222-3333-444455556666'
  const arquivo = (pasta: string, nome: string): string => {
    const p = join(pasta, nome)
    writeFileSync(p, 'x'.repeat(100))
    return p
  }
  const meuRecorte = arquivo(cache, `${minha}-500-500.jpg`)
  const meuUpscale = arquivo(upscale, `${minha}-v5-short-500-500.mp4`)
  const recorteDeOutra = arquivo(cache, `${deOutraJanela}-500-500.jpg`)
  const miniatura = arquivo(cache, 'thumb-c-abc123.webp')
  const sobraVelha = arquivo(upscale, `${velhaDeOutra}-v5-short-500-500.mp4`)
  const tresDiasAtras = new Date(Date.now() - 3 * 86_400_000)
  utimesSync(sobraVelha, tresDiasAtras, tresDiasAtras)

  varrerSobras()
  conferir('sobra velha de outra sessao sai na abertura', existsSync(sobraVelha), false)
  conferir('o de outra janela, recente, fica', existsSync(recorteDeOutra), true)
  conferir('o desta sessao fica enquanto ela vive', existsSync(meuRecorte), true)

  const liberado = limparAoSair()
  conferir('ao sair: o recorte desta sessao sai', existsSync(meuRecorte), false)
  conferir('ao sair: o upscale desta sessao sai', existsSync(meuUpscale), false)
  conferir('ao sair: o de outra janela fica', existsSync(recorteDeOutra), true)
  conferir('ao sair: a miniatura (chave pelo conteudo) fica', existsSync(miniatura), true)
  conferir('bytes liberados', liberado, 200)

  // ------------------------------------------------------------ depois do render
  console.log('depois do render: o trabalho da etapa de audio')
  const ud2 = join(raiz, 'ud2')
  configureEdicaoDeAudio(ud2)
  const bruto = join(raiz, 'gravacao.mp3')
  const outra = join(raiz, 'outra-gravacao.mp3')
  writeFileSync(bruto, 'gravacao')
  writeFileSync(outra, 'outra')
  const identidade = (caminho: string): string => {
    const st = statSync(caminho)
    return createHash('sha1').update(`${caminho}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 16)
  }
  const id = identidade(bruto)
  const idOutra = identidade(outra)
  const trabalho = join(ud2, 'audio-editado')
  for (const sub of ['base', 'limpa', 'processado', 'render', 'ferramentas']) mkdirSync(join(trabalho, sub), { recursive: true })
  const meus = [
    arquivo(join(trabalho, 'base'), `${id}.wav`),
    arquivo(join(trabalho, 'limpa'), `${id}-a100.wav`),
    arquivo(join(trabalho, 'processado'), `${id}-abcdef.wav`),
    arquivo(join(trabalho, 'render'), `${id}-123456.wav`),
    arquivo(join(trabalho, 'render'), `${id}-123456.json`),
  ]
  const dela = arquivo(join(trabalho, 'base'), `${idOutra}.wav`)
  const ferramenta = arquivo(join(trabalho, 'ferramentas'), `${id}-nao-e-cache.exe`)
  const edicao = novaEdicao(bruto, 30, CADEIA_PADRAO)
  const saiu = limparTrabalhoDaEdicao(edicao)
  conferir('o trabalho desta gravacao sai', meus.map(existsSync), [false, false, false, false, false])
  conferir('o de outra gravacao fica', existsSync(dela), true)
  conferir('a pasta das ferramentas nao e tocada', existsSync(ferramenta), true)
  conferir('bytes', saiu, 500)
  conferir('a gravacao continua no disco', existsSync(bruto), true)
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

if (falhas > 0) {
  console.log(`\n${falhas} falha(s)`)
  process.exit(1)
}
console.log('\ntudo certo')
