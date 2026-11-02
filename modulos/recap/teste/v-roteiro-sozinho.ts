/**
 * [recap] O "GERAR ROTEIRO SOZINHO" (02/11) no store DE VERDADE do passo 2,
 * com um window.dangai falso que anota as chamadas:
 *
 * 1. desligado (o padrao): entrar num episodio sem roteiro NAO chama a IA --
 *    o passo fica com "Meu roteiro" e "Gerar roteiro"; o botao ainda gera;
 * 2. ligado: entrar chama a IA uma vez (eventos), e reentrar nao chama de novo;
 * 3. ligado, mas com o "Meu roteiro" aberto antes da config chegar: nao chama.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx esbuild modulos/recap/teste/v-roteiro-sozinho.ts --bundle --platform=node --packages=external --jsx=automatic --tsconfig=tsconfig.web.json --define:import.meta.env.DEV=false --log-level=error | node
 */

type Resposta = { ok: true; value: unknown } | { ok: false; error: string }

const chamadas: string[] = []
let sozinho = false
let atrasoDaConfigMs = 0

function rascunho(episodioId: string): unknown {
  return {
    id: `rc_${episodioId}`,
    episodioId,
    roteiros: [],
    atual: null,
    eventos: [],
    alvoSec: 60,
  }
}
function indice(episodioId: string): unknown {
  return {
    id: episodioId,
    cues: [{ id: 'c0001', tipo: 'fala', inicio: 1, fim: 2, texto: 'Ola.' }],
    exclusoes: [],
    planos: [],
  }
}

const doModulo: Record<string, (...args: unknown[]) => Resposta | Promise<Resposta>> = {
  abrirRascunho: (episodioId) => ({ ok: true, value: { rascunho: rascunho(String(episodioId)), indice: indice(String(episodioId)), avisos: [] } }),
  lerConfig: async () => {
    if (atrasoDaConfigMs) await new Promise((r) => setTimeout(r, atrasoDaConfigMs))
    return { ok: true, value: { gerarRoteiroSozinho: sozinho } }
  },
  lerEstilo: () => ({ ok: true, value: { estilo: { instrucoes: '', exemplos: [] } } }),
  // A IA: so anota (nunca responde, o teste so conta quem pediu).
  gerarEventos: () => new Promise<Resposta>(() => {}),
  gerarRoteiro: () => new Promise<Resposta>(() => {}),
  listarRascunhos: () => ({ ok: true, value: [] }),
}
const anotando = (tabela: Record<string, (...args: unknown[]) => Resposta | Promise<Resposta>>) =>
  new Proxy(
    {},
    {
      get(_alvo, nome) {
        if (typeof nome !== 'string') return undefined
        if (nome.startsWith('on')) return () => () => {}
        return async (...args: unknown[]) => {
          chamadas.push(nome)
          const f = tabela[nome]
          return f ? f(...args) : { ok: true, value: null }
        }
      },
    },
  )
const dangai = anotando({}) as Record<string, unknown>
Reflect.set(globalThis, 'window', { dangai: new Proxy(dangai, { get: (a, n) => (n === 'modulos' ? { recap: anotando(doModulo) } : Reflect.get(a, n)) }) })
Reflect.set(globalThis, 'localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const pediuIa = (): number => chamadas.filter((c) => c === 'gerarEventos' || c === 'gerarRoteiro').length

async function main(): Promise<void> {
  const { CONFIG_PADRAO } = await import('../shared/config')
  const { useRoteiro } = await import('../src/store/gerar-roteiro')

  console.log('\n== desligado (o padrao)')
  confere(CONFIG_PADRAO.gerarRoteiroSozinho === false, 'o padrao e desligado')
  await useRoteiro.getState().entrar('ep_a')
  await esperar(50)
  confere(useRoteiro.getState().rascunho?.atual === null, 'o rascunho abriu sem roteiro')
  confere(pediuIa() === 0 && useRoteiro.getState().geracao === null, 'entrar nao chama a IA')
  await useRoteiro.getState().entrar('ep_a')
  await esperar(50)
  confere(pediuIa() === 0, 'reentrar tambem nao')
  void useRoteiro.getState().gerar()
  await esperar(50)
  confere(chamadas.includes('gerarEventos'), 'o botao "Gerar roteiro" ainda gera')
  useRoteiro.getState().cancelarGeracao()

  console.log('\n== ligado')
  sozinho = true
  chamadas.length = 0
  await useRoteiro.getState().entrar('ep_b')
  await esperar(50)
  confere(pediuIa() === 1, 'entrar chama a IA uma vez')
  useRoteiro.getState().cancelarGeracao()
  await esperar(50)
  chamadas.length = 0
  await useRoteiro.getState().entrar('ep_b')
  await esperar(50)
  confere(pediuIa() === 0, 'reentrar no mesmo rascunho nao chama de novo')

  console.log('\n== ligado, com o "Meu roteiro" aberto antes da config chegar')
  chamadas.length = 0
  atrasoDaConfigMs = 80
  await useRoteiro.getState().entrar('ep_c')
  useRoteiro.getState().abrirColar()
  await esperar(150)
  confere(pediuIa() === 0, 'colando: nao chama a IA')

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK')
  process.exit(falhas ? 1 : 0)
}

void main()
