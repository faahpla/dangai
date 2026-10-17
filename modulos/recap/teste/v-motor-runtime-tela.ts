/**
 * RUNTIME DO MOTOR, a logica da tela (src/store/motor-runtime.ts) sem
 * Electron: a ponte window.dangai e falsa. Confere o "1o uso" (pedirMotor):
 * abre a tela UMA vez, guarda a acao e roda quando a fase vira 'pronto';
 * "Agora nao" nao reabre; dev e pronto seguem direto; quem quer saber do
 * "pronto" (o gerar.ts conferir o motor) e avisado.
 *
 * Rodar da raiz:
 *   npx tsx --tsconfig tsconfig.web.json modulos/recap/teste/v-motor-runtime-tela.ts
 */
import assert from 'node:assert/strict'
import type { EstadoDoMotorRuntime, FaseDoMotorRuntime } from '../shared/motor-runtime'

function estado(fase: FaseDoMotorRuntime): EstadoDoMotorRuntime {
  return {
    fase,
    pasta: 'C:\\x\\motor-runtime',
    pastaPadrao: true,
    variante: null,
    varianteSugerida: 'cu128',
    gpu: { nome: 'NVIDIA GeForce RTX 5080', driver: '616.92', driverAntigo: false, fonte: 'nvidia-smi' },
    bytesParaBaixar: 2.96e9,
    bytesNoDisco: 5.2e9,
    livreNoDisco: 1.6e12,
    precisaDeLivre: 9.4e9,
    andamento: null,
    erro: null,
    mudancas: null,
    aviso: null,
    log: null,
  }
}

let atual = estado('ausente')
let ouvinte: ((e: EstadoDoMotorRuntime) => void) | null = null
let instalacoes = 0
// [recap] A ponte do modulo: window.dangai.modulos.recap.
Reflect.set(globalThis, 'window', {
  dangai: { modulos: { recap: {
    estadoDoMotorRuntime: async () => ({ ok: true, value: atual }),
    onMotorRuntime: (fn: (e: EstadoDoMotorRuntime) => void) => {
      ouvinte = fn
      return () => {
        ouvinte = null
      }
    },
    instalarMotorRuntime: async () => {
      instalacoes += 1
      atual = { ...estado('instalando'), andamento: { etapa: 'preparar', fracao: 0, mensagem: 'Preparando' } }
      return { ok: true, value: atual }
    },
  } } },
})

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  const { ouvirMotorRuntime, pedirMotor, quandoOMotorFicarPronto, runtimeFora, useMotorRuntime } = await import('../src/store/motor-runtime')
  ouvirMotorRuntime()
  const mandar = (e: EstadoDoMotorRuntime): void => {
    atual = e
    ouvinte?.(e)
  }

  // 1. dev e pronto: segue direto, sem tela
  atual = estado('dev')
  assert.equal(await pedirMotor(() => {}), false)
  assert.equal(useMotorRuntime.getState().aberta, false)
  assert.equal(runtimeFora(atual), false)
  mandar(estado('pronto'))
  assert.equal(await pedirMotor(() => {}), false)
  console.log('ok dev e pronto seguem direto')

  // 2. ausente: abre a tela, guarda a acao; o 2o pedido so troca a acao
  mandar(estado('ausente'))
  let rodou = 0
  assert.equal(await pedirMotor(() => (rodou += 1)), true)
  assert.equal(useMotorRuntime.getState().aberta, true)
  assert.ok(useMotorRuntime.getState().pendente)
  console.log('ok ausente: abre e guarda a acao')

  // 3. instala; o "pronto" fecha a tela e roda a acao (depois de 1,2 s), e avisa quem pediu
  let avisados = 0
  const tirar = quandoOMotorFicarPronto(() => (avisados += 1))
  await useMotorRuntime.getState().instalar()
  assert.equal(instalacoes, 1)
  assert.equal(useMotorRuntime.getState().estado?.fase, 'instalando')
  mandar({ ...estado('instalando'), andamento: { etapa: 'baixar-torch', fracao: 0.4, mensagem: 'Baixando torch' } })
  assert.equal(rodou, 0, 'nada roda enquanto instala')
  mandar(estado('pronto'))
  assert.equal(avisados, 1, 'quandoOMotorFicarPronto avisado')
  assert.equal(useMotorRuntime.getState().pendente, null)
  assert.equal(rodou, 0, 'espera o respiro do "Motor pronto"')
  await esperar(1400)
  assert.equal(rodou, 1, 'a acao que esperava rodou')
  assert.equal(useMotorRuntime.getState().aberta, false, 'a tela fechou sozinha')
  mandar(estado('pronto'))
  assert.equal(avisados, 1, 'pronto -> pronto nao avisa de novo')
  tirar()
  console.log('ok pronto: fecha, roda a acao e avisa')

  // 4. "Agora nao": fecha, esquece a acao e nao reabre sozinha na sessao
  mandar(estado('ausente'))
  assert.equal(await pedirMotor(() => (rodou += 10)), true)
  useMotorRuntime.getState().agoraNao()
  assert.equal(useMotorRuntime.getState().aberta, false)
  assert.equal(useMotorRuntime.getState().pendente, null)
  assert.equal(await pedirMotor(() => (rodou += 100)), false, 'segue (e falha com a frase do motor)')
  assert.equal(useMotorRuntime.getState().aberta, false)
  console.log('ok agora nao: nao reabre')

  // 5. o botao da linha do motor abre de novo, com a acao do "Tentar de novo"
  useMotorRuntime.getState().abrir(() => (rodou += 1000))
  assert.equal(useMotorRuntime.getState().aberta, true)
  mandar(estado('pronto'))
  await esperar(1400)
  assert.equal(rodou, 1001)
  console.log('ok o botao abre de novo e a acao roda no pronto')

  // 6. instalando por tras (atualizacao automatica) mesmo depois do "Agora nao": mostra o andamento
  mandar({ ...estado('instalando'), andamento: { etapa: 'pacotes', fracao: 0.8, mensagem: 'Instalando pacotes' } })
  assert.equal(await pedirMotor(() => (rodou += 1)), true)
  assert.equal(useMotorRuntime.getState().aberta, true)
  console.log('ok instalando: mostra o andamento')

  // 7. a placa na tela (revisao A de 15/10): cu128 que nao rodou a conta na GPU diz "CPU"
  const { textoDaPlaca } = await import('../src/components/motor-runtime/InstalarMotor')
  assert.equal(textoDaPlaca({ ...estado('pronto'), variante: 'cu128', cudaOk: true }), 'RTX 5080')
  assert.match(textoDaPlaca({ ...estado('pronto'), variante: 'cu128', cudaOk: false }), /CPU/)
  assert.equal(textoDaPlaca({ ...estado('ausente'), varianteSugerida: 'cpu', gpu: { ...estado('ausente').gpu!, computeCap: 6.1 } }), 'CPU (sem CUDA)')
  console.log('ok placa: "CPU" quando o cu128 nao roda na GPU')
  console.log('TUDO OK')
  process.exit(0)
}

void main()
