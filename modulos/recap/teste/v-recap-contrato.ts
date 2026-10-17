/**
 * [recap] O MODULO NO CONTRATO DO NUCLEO, sem Electron e sem rede: o que o
 * Dangai ve dele (config, raiz da biblioteca, canais, ponte) e o que nao pode
 * mudar com ele desligado.
 *
 * 1. config: coerce, padrao, recusa pasta do AnCut/Corte Cenas e caminho solto;
 * 2. a raiz `recap:` da Biblioteca so existe com o modulo LIGADO (e pasta com
 *    episodio); desligado, a lista de raizes e a do Dangai;
 * 3. canais: todos `recap:<area>:<acao>`, sem repetir, e a ponte chama cada um;
 * 4. o ritmo do "~Xs" sem voz: o inicial calibrado;
 * 5. o perfil do recap mora na pasta de dados do modulo, e so nasce quando grava.
 *
 * Tudo em pastas temporarias. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-recap-contrato.ts
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { raizesDaBiblioteca } from '../../../electron/services/library'
import { configureSettings, saveSettings, type Cofre } from '../../../electron/services/settings'
import { CANAIS } from '../shared/canais'
import { CONFIG_PADRAO, coerceConfig } from '../shared/config'
import { ritmoInicial } from '../shared/ritmo'
import { configDoRecap, configNaTela } from '../electron/config'
import { recap } from '../electron'
import { criarPonteDoRecap } from '../electron/ponte'
import { pastaDosEpisodios } from '../electron/episodio/perfil'
import { ritmoPeloId } from '../electron/voz/ritmo'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
function lancou(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

const temp = mkdtempSync(join(tmpdir(), 'recap-v-contrato-'))
const userData = join(temp, 'perfil')
const biblioteca = join(temp, 'bib')
mkdirSync(userData, { recursive: true })
const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
configureSettings(userData, cofreFalso)
saveSettings({ libraryDir: '' })

let ligado = false
let configDoModulo: unknown = { biblioteca }
const canaisRegistrados: string[] = []
const ctx = {
  id: 'recap',
  prefixo: 'recap:',
  empacotado: false,
  versaoDoApp: 'teste',
  handle: (canal: string) => {
    canaisRegistrados.push(canal)
  },
  enviar: () => {},
  config: () => ({ libraryDir: '', iaProvedor: 'gemini', whisperModel: 'small', modulo: configDoModulo }),
  pasta: (tipo: string) => {
    if (tipo !== 'dados') throw new Error(`pasta ${tipo} nao esperada no teste`)
    const p = join(userData, 'modulos', 'recap')
    mkdirSync(p, { recursive: true })
    return p
  },
  ligado: () => ligado,
} as unknown as ContextoDoModulo

try {
  console.log('\n== 1. Configuracao')
  confere(JSON.stringify(coerceConfig(undefined)) === JSON.stringify(CONFIG_PADRAO), 'sem nada: o padrao')
  confere(CONFIG_PADRAO.vozPadrao.provedor === '' && CONFIG_PADRAO.vozPadrao.velocidadeNativa === 1.2, 'o padrao e sem voz, nativa 1,2')
  confere(coerceConfig({ biblioteca: '  D:\\x  ', outro: 1 }).biblioteca === 'D:\\x', 'apara e ignora campo desconhecido')
  confere(coerceConfig({ biblioteca: 42 }).biblioteca === '', 'tipo errado: o padrao')
  const padrao = configNaTela({ biblioteca: '' })
  confere(/AniRecap Studio[\\/]Biblioteca$/.test(padrao.bibliotecaEfetiva), `padrao do Studio: ${padrao.bibliotecaEfetiva}`)
  const validar = configDoRecap.validarPatch!
  confere(lancou(() => validar({ biblioteca }, { biblioteca: '' })) === null, 'aceita uma pasta qualquer do usuario')
  confere(
    /nao grava/.test(lancou(() => validar({ biblioteca: 'G:\\App Corte Cenas\\Output' }, { biblioteca: '' })) ?? ''),
    'recusa a saida do Corte Cenas (so leitura)',
  )
  confere(/pasta inteira/.test(lancou(() => validar({ biblioteca: 'relativa\\x' }, { biblioteca: '' })) ?? ''), 'recusa caminho sem disco')
  confere((validar({ biblioteca: '' }, { biblioteca }) as { biblioteca: string }).biblioteca === '', "'' volta ao padrao")

  console.log('\n== 2. A raiz recap: da Biblioteca')
  recap.configurar!(ctx)
  const semRecap = (): boolean => !raizesDaBiblioteca().some((r) => r.prefixo === 'recap:')
  confere(semRecap(), 'desligado: nenhuma raiz recap:')
  ligado = true
  confere(semRecap(), 'ligado, mas a pasta sem episodio: nada muda')
  mkdirSync(join(biblioteca, 'Serie', 'S01E01', 'metadata'), { recursive: true })
  writeFileSync(join(biblioteca, 'Serie', 'S01E01', 'metadata', 'shots.json'), '[]')
  const raiz = raizesDaBiblioteca().find((r) => r.prefixo === 'recap:')
  confere(raiz?.raiz === biblioteca, 'ligado e com episodio: a raiz recap: aponta para a biblioteca do recap')
  ligado = false
  confere(semRecap(), 'desligado de novo: some')

  console.log('\n== 3. Canais e ponte')
  const valores = Object.values(CANAIS) as string[]
  confere(valores.every((c) => /^recap:[a-z-]+:[a-z-]+$/.test(c)), 'todos recap:<area>:<acao>')
  confere(new Set(valores).size === valores.length, 'nenhum repetido')
  recap.registrarIpc!(ctx)
  const eventos = [
    CANAIS.indexarProgresso,
    CANAIS.roteiroProgresso,
    CANAIS.vozProgresso,
    CANAIS.montarProgresso,
    // [recap] Parte 4: os eventos do motor.
    CANAIS.analiseProgresso,
    CANAIS.analiseFim,
    CANAIS.corteProgresso,
    CANAIS.descobertaProgresso,
    CANAIS.motorRuntimeEstado,
  ] as string[]
  const pedidos = valores.filter((c) => !eventos.includes(c))
  confere(
    pedidos.every((c) => canaisRegistrados.includes(c)) && canaisRegistrados.every((c) => pedidos.includes(c)),
    `o main registra exatamente os ${pedidos.length} pedidos (os ${eventos.length} eventos so saem)`,
  )
  const chamados: string[] = []
  const ponte = criarPonteDoRecap({
    invocar: async (canal) => {
      chamados.push(canal)
      return { ok: true, value: null as never }
    },
    assinar: (canal) => {
      chamados.push(canal)
      return () => {}
    },
  }) as unknown as Record<string, (...a: unknown[]) => unknown>
  for (const nome of Object.keys(ponte)) ponte[nome]!('rc_x', {})
  confere(
    valores.every((c) => chamados.includes(c)) && chamados.every((c) => c.startsWith('recap:')),
    `a ponte alcanca cada canal (${Object.keys(ponte).length} metodos), so com o prefixo`,
  )

  confere(JSON.stringify(recap.camposDeChave) === '["elevenlabsApiKey","fishApiKey"]', 'as chaves de voz com os nomes do Studio (camposDeChave)')

  console.log('\n== 4. O ritmo do "~Xs" sem voz')
  const r = ritmoPeloId(null)
  confere(r.origem === 'inicial' && Math.abs(r.ritmo - ritmoInicial(1, 1)) < 1e-9, `inicial calibrado: ${r.ritmo.toFixed(2)} palavras/s`)
  confere(Math.round(150 / r.ritmo) === 53, `150 palavras = ~${Math.round(150 / r.ritmo)}s`)

  console.log('\n== 5. O perfil do recap')
  confere(pastaDosEpisodios() === join(userData, 'modulos', 'recap', 'episodios'), 'episodios em <userData>/modulos/recap')
  confere(!existsSync(join(userData, 'modulos', 'recap', 'episodios')), 'so a pasta do modulo existe: nada gravado sem uso')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
