/**
 * O REGISTRO e o "Copiar relatorio" (electron/services/registro.ts): o console
 * vai para logs/dangai.log, uma entrada gigante e encurtada, o arquivo grande
 * vira o "anterior", e o relatorio junta tudo SEM as chaves de API e sem o nome
 * do usuario do Windows.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-relatorio.ts`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encerrarRegistro, iniciarRegistro, limpar, montarRelatorio, registrar } from '../../electron/services/registro.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  process.stdout.write((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : '') + '\n')
  if (!c) falhas++
}
const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function principal(): Promise<void> {
  // --- limpar
  const casa = 'C:\\Users\\ajk'
  const sujo = [
    'abrindo C:\\Users\\ajk\\Documents\\video.dangai e c:/users/ajk/Music/x.mp3',
    'gemini AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
    'anthropic sk-ant-api03-abcdefghijklmnopqrstu',
    'elevenlabs sk_0123456789abcdef0123456789abcdef0123456789abcdef',
    'fish 0123456789abcdef0123456789abcdef',
    'url ...?key=abcdefghijklmnop1234 e Authorization: Bearer abcdefghijklmnop1234',
    'Renderizando 59 blocos, 1:08, Por que a Kiwi usa mascara',
  ].join('\n')
  const limpo = limpar(sujo, casa)
  ok('a pasta do usuario vira ~ (as duas barras, qualquer caixa)', !/ajk/i.test(limpo) && limpo.includes('~\\Documents') && limpo.includes('~/Music'), limpo.split('\n')[0])
  ok('chave do Gemini some', !limpo.includes('AIzaSy'))
  ok('chave da Anthropic some', !limpo.includes('sk-ant-api03'))
  ok('chave do ElevenLabs some', !limpo.includes('sk_0123'))
  ok('chave hexadecimal (Fish) some', !limpo.includes('0123456789abcdef0123'))
  ok('key= e Bearer somem', !limpo.includes('abcdefghijklmnop1234'), limpo.split('\n')[5])
  ok('o texto comum fica', limpo.includes('Renderizando 59 blocos, 1:08, Por que a Kiwi usa mascara'))

  // --- registro
  const dir = mkdtempSync(join(tmpdir(), 'dangai-registro-'))
  const log = join(dir, 'logs', 'dangai.log')
  iniciarRegistro(dir, '9.9.9')
  console.log('[teste] uma linha do main')
  console.error('[teste] um erro do main:', new Error('quebrou'))
  registrar('warn', '[janela] um recado da tela')
  registrar('error', `[teste] gigante ${'x'.repeat(20_000)}`)
  await espera(300)
  const texto = readFileSync(log, 'utf8')
  ok('o arquivo existe em logs/dangai.log', existsSync(log))
  ok('a abertura fica marcada com a versao', /Dangai 9\.9\.9 aberto em/.test(texto))
  ok('o console.log do main vai para o arquivo', texto.includes('[teste] uma linha do main'))
  ok('o console.error vai com a pilha', texto.includes('um erro do main: Error: quebrou'))
  ok('o que vem da janela tambem', texto.includes('[janela] um recado da tela'))
  ok('a entrada gigante e encurtada', texto.length < 10_000 && texto.includes('caracteres ...]'), `${texto.length} caracteres`)

  const rel = montarRelatorio({
    versao: '9.9.9',
    modulos: ['recap'],
    configuracoes: { ia: 'gemini (chaves: gemini)', whisper: 'small' },
    tela: { erro: 'O arquivo "meme.mp4" nao tem imagem de video', projeto: '59 blocos, 1:08' },
  })
  ok('o relatorio tem versao, modulos e configuracoes', rel.includes('versão: 9.9.9') && rel.includes('módulos ligados: recap') && rel.includes('whisper: small'))
  ok('o relatorio tem a maquina', /sistema: .+ nucleos .+ de RAM/.test(rel))
  ok('o relatorio tem o que estava na tela', rel.includes('erro: O arquivo "meme.mp4"') && rel.includes('projeto: 59 blocos'))
  ok('o relatorio tem o fim do registro', rel.includes('[teste] uma linha do main') && rel.includes('[janela] um recado da tela'))

  // --- o arquivo grande vira o anterior, e o relatorio ainda le o fim dele
  writeFileSync(log, `${'linha velha\n'.repeat(250_000)}a ultima linha da sessao passada\n`)
  iniciarRegistro(dir, '9.9.10')
  console.log('[teste] primeira linha da sessao nova')
  await espera(300)
  ok('o grande vira dangai-anterior.log', existsSync(join(dir, 'logs', 'dangai-anterior.log')) && readFileSync(log, 'utf8').length < 1000)
  const rel2 = montarRelatorio({ versao: '9.9.10', modulos: [], configuracoes: {}, tela: {} })
  ok('o relatorio completa com o fim do anterior', rel2.includes('a ultima linha da sessao passada') && rel2.includes('primeira linha da sessao nova'))
  ok('sem modulo: "nenhum"', rel2.includes('módulos ligados: nenhum'))
  ok('uma linha por chamada (o console nao e embrulhado duas vezes)', readFileSync(log, 'utf8').split('primeira linha da sessao nova').length === 2)

  encerrarRegistro() // solta o arquivo antes de apagar a pasta
  await espera(100)
  rmSync(dir, { recursive: true, force: true })
  process.stdout.write(falhas === 0 ? '\nTUDO PASSOU\n' : `\n${falhas} FALHA(S)\n`)
  process.exit(falhas === 0 ? 0 : 1)
}
void principal()
