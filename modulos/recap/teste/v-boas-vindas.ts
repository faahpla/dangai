/**
 * [recap] A BOAS-VINDAS DO RECAP sem app e sem navegador -- o
 * scripts/teste/v-boas-vindas.tsx do AniRecap Studio, adaptado ao modulo:
 *
 * - config: o "Nao perguntar mais" (naoPerguntarChave) nasce false, grava pelo
 *   patch, volta do disco e lixo no arquivo vale false;
 * - quem ve (pedeBoasVindas): sem IA nenhuma pelo provedor() do nucleo e sem
 *   o "Nao perguntar mais";
 * - a decisao (store/boas-vindas.ts): abre sem chave na tela inicial; com
 *   chave (Gemini ou Anthropic) nao; com projeto aberto nao, e o proximo
 *   "Gerar recap" na tela inicial pergunta; projeto aberto enquanto a resposta
 *   vinha nao deixa abrir; uma vez por sessao ("Depois" nao grava nada e nao
 *   volta); "Nao perguntar mais" grava SO naoPerguntarChave na config do
 *   modulo; desligar e ligar o modulo pergunta de novo; o main sem resposta
 *   nao abre; dois gatilhos juntos perguntam uma vez so;
 * - o "Gerar recap" (gerarRecap): sem chave abre a boas-vindas e NAO o
 *   assistente; depois do "Depois", o assistente; com chave ou com projeto
 *   aberto (a paleta), o assistente direto;
 * - o "Instalar agora": abre a tela do motor e so comeca quando ela nao tem
 *   nada a dizer antes;
 * - o cartao: cada linha e botao com o texto curto certo, em ASCII, nos
 *   estados da chave, da voz e do motor.
 *
 * Nao substitui o print do app. Rodar da raiz:
 *   npx esbuild modulos/recap/teste/v-boas-vindas.ts --bundle --platform=node --packages=external --jsx=automatic --tsconfig=tsconfig.web.json --define:import.meta.env.DEV=false --log-level=error | node
 */
import type { PublicSettings } from '@shared/channels'
import type { Nucleo } from '@/modulos/nucleo'
import type { ConfigDoRecapNaTela } from '../shared/config'
import type { EstadoDoMotorRuntime, FaseDoMotorRuntime } from '../shared/motor-runtime'
import type { AjustesDaVoz } from '../shared/tipos-da-voz'
import type { ProvedorDaIa } from '../shared/canais'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
const texto = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const ascii = (s: string): boolean => [...s].every((c) => c.charCodeAt(0) < 128)
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------- a janela falsa

function semChave(): PublicSettings {
  return {
    iaProvedor: 'gemini',
    geminiModelo: '',
    anthropicModelo: '',
    whisperModel: 'small',
    sfxDir: '',
    libraryDir: '',
    hasApiKey: false,
    apiKeyHint: '',
    hasGeminiKey: false,
    geminiKeyHint: '',
    chavesProtegidas: true,
    curvePresets: [],
    captionStyle: null,
    captionPresets: [],
    bins: [],
    curvasDeEntrada: [],
    atalhos: null,
    recentes: [],
    presetsDeCor: [],
    presetsDeTransicao: [],
  }
}
const vozSemChave = (): AjustesDaVoz => ({
  hasElevenKey: false,
  elevenKeyHint: '',
  hasFishKey: false,
  fishKeyHint: '',
  vozPadrao: { provedor: '', voiceId: '', modelId: '', velocidadeNativa: 1.2 },
  vozesGuardadas: { elevenlabs: { voiceId: '', modelId: '' }, fish: { voiceId: '', modelId: '' } },
})

function motor(fase: FaseDoMotorRuntime, extra: Partial<EstadoDoMotorRuntime> = {}): EstadoDoMotorRuntime {
  return {
    fase,
    pasta: 'C:\\x\\motor-runtime',
    pastaPadrao: true,
    variante: null,
    varianteSugerida: 'cu128',
    gpu: { nome: 'NVIDIA GeForce RTX 5080', driver: '616.92', driverAntigo: false, fonte: 'nvidia-smi' },
    bytesParaBaixar: fase === 'pronto' || fase === 'dev' ? 0 : 2.96e9,
    bytesNoDisco: 5.2e9,
    livreNoDisco: 1.6e12,
    precisaDeLivre: fase === 'pronto' || fase === 'dev' ? 0 : 9.4e9,
    andamento: null,
    erro: null,
    mudancas: null,
    aviso: null,
    log: null,
    ...extra,
  }
}

/** O que o main responde agora. `segurar` atrasa a resposta (o projeto abrindo no meio). */
const main = {
  provedor: null as ProvedorDaIa | null,
  naoPerguntarChave: false,
  provedorFalha: false,
  settings: semChave(),
  voz: vozSemChave(),
  motor: motor('ausente') as EstadoDoMotorRuntime,
  segurar: null as Promise<void> | null,
}
const chamadas: { metodo: string; args: unknown[] }[] = []
const quantas = (metodo: string): number => chamadas.filter((c) => c.metodo === metodo).length
const ultima = (metodo: string): unknown[] | undefined => [...chamadas].reverse().find((c) => c.metodo === metodo)?.args
const anotar = (metodo: string, args: unknown[]): void => void chamadas.push({ metodo, args })
const ok = <T>(value: T) => ({ ok: true as const, value })

Reflect.set(globalThis, 'window', {
  dangai: {
    getSettings: async () => {
      anotar('getSettings', [])
      return ok(main.settings)
    },
    modulos: {
      recap: {
        provedorDaIa: async () => {
          anotar('provedorDaIa', [])
          if (main.segurar) await main.segurar
          return main.provedorFalha ? { ok: false as const, error: 'sem main' } : ok(main.provedor)
        },
        lerConfig: async () => {
          anotar('lerConfig', [])
          return ok({ naoPerguntarChave: main.naoPerguntarChave } as ConfigDoRecapNaTela)
        },
        salvarConfig: async (patch: { naoPerguntarChave?: boolean }) => {
          anotar('salvarConfig', [patch])
          if (patch.naoPerguntarChave !== undefined) main.naoPerguntarChave = patch.naoPerguntarChave
          return ok({ naoPerguntarChave: main.naoPerguntarChave } as ConfigDoRecapNaTela)
        },
        lerAjustesDaVoz: async () => ok(main.voz),
        estadoDoMotorRuntime: async () => ok(main.motor),
        onMotorRuntime: () => () => {},
        instalarMotorRuntime: async () => {
          anotar('instalarMotorRuntime', [])
          return ok(main.motor)
        },
      },
    },
  },
})

/** O zustand desenha o estado INICIAL no servidor: antes, ele recebe o de agora (ver v-edicao-rapida-tela do Studio). */
function desenhar(lojas: { getState: () => object; getInitialState: () => object }[], render: () => string): string {
  for (const loja of lojas) Object.assign(loja.getInitialState(), loja.getState())
  return render()
}

async function principal(): Promise<void> {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { CONFIG_PADRAO, aplicarPatch, coerceConfig } = await import('../shared/config')
  const { guardarNucleo } = await import('../src/nucleo')
  const { useGerar } = await import('../src/store/gerar')
  const { useMotorRuntime } = await import('../src/store/motor-runtime')
  const { instalarMotorAgora, motorPronto, pedeBoasVindas, useBoasVindas } = await import('../src/store/boas-vindas')
  const { CartaoDeBoasVindas, gerarRecap, naTelaInicial } = await import('../src/components/BoasVindas')

  // A fachada falsa: so o que a boas-vindas le (a fase, a Biblioteca e um modal do nucleo por cima).
  const tela = { fase: 'empty' as 'empty' | 'editing', biblioteca: false, modalPorCima: false }
  guardarNucleo({
    ler: () => ({ phase: () => tela.fase, libraryOpen: tela.biblioteca }),
    haModalPorCima: () => tela.modalPorCima,
  } as unknown as Nucleo)
  let assistente = 0
  useGerar.setState({
    abrirOuEscolher: async () => {
      assistente += 1
    },
  })

  const reiniciar = (): void => {
    useBoasVindas.getState().reiniciar()
    Object.assign(main, { provedor: null, naoPerguntarChave: false, provedorFalha: false, segurar: null })
    tela.fase = 'empty'
    tela.biblioteca = false
  }
  const decidir = (): Promise<boolean> => useBoasVindas.getState().decidir(naTelaInicial)
  const aberta = (): boolean => useBoasVindas.getState().momento === 'aberta'

  console.log('\n== config: naoPerguntarChave')
  confere(CONFIG_PADRAO.naoPerguntarChave === false && coerceConfig(undefined).naoPerguntarChave === false, 'sem nada: false (quem chega ve a tela)')
  confere(coerceConfig({ naoPerguntarChave: true }).naoPerguntarChave === true, 'true volta do disco')
  confere(coerceConfig({ naoPerguntarChave: 'sim' }).naoPerguntarChave === false, 'lixo no arquivo vale false')
  const comVoz = coerceConfig({ biblioteca: 'D:\\bib', vozPadrao: { provedor: 'fish', voiceId: 'abc', modelId: '' } })
  const depoisDoPatch = aplicarPatch(comVoz, { naoPerguntarChave: true })
  confere(
    depoisDoPatch.naoPerguntarChave && depoisDoPatch.biblioteca === 'D:\\bib' && depoisDoPatch.vozPadrao.voiceId === 'abc',
    'o patch grava so ele: biblioteca e voz ficam',
  )
  confere(aplicarPatch(depoisDoPatch, { escritor: 'gemini' }).naoPerguntarChave === true, 'outro patch nao apaga')

  console.log('\n== Quem ve a tela')
  confere(pedeBoasVindas({ provedor: null, naoPerguntarChave: false }), 'sem IA nenhuma: ve')
  confere(!pedeBoasVindas({ provedor: 'gemini', naoPerguntarChave: false }), 'com a do Gemini: nao ve')
  confere(!pedeBoasVindas({ provedor: 'anthropic', naoPerguntarChave: false }), 'so com a da Anthropic (o nucleo usa ela): nao ve')
  confere(!pedeBoasVindas({ provedor: null, naoPerguntarChave: true }), '"Nao perguntar mais": nao ve')

  console.log('\n== A decisao (ligar o modulo)')
  reiniciar()
  confere((await decidir()) && aberta(), 'sem chave, na tela inicial: abre')
  confere(useBoasVindas.getState().settings?.hasGeminiKey === false && useBoasVindas.getState().voz !== null, 'e guarda as configuracoes e a voz para a tela')
  confere(quantas('provedorDaIa') === 1, 'pergunta a IA pelo canal do modulo (o provedor() do nucleo)')

  reiniciar()
  main.provedor = 'gemini'
  confere(!(await decidir()) && !aberta(), 'com a chave do Gemini salva: nao abre')
  main.provedor = 'anthropic'
  confere(!(await decidir()) && !aberta(), 'com a da Anthropic: nao abre')

  reiniciar()
  main.naoPerguntarChave = true
  confere(!(await decidir()) && !aberta(), '"Nao perguntar mais" na config: nao abre')

  reiniciar()
  main.provedorFalha = true
  confere(!(await decidir()) && !aberta(), 'o main sem resposta: na duvida, nao abre')

  reiniciar()
  tela.fase = 'editing'
  const antesFora = quantas('provedorDaIa')
  confere(!(await decidir()) && !aberta() && quantas('provedorDaIa') === antesFora, 'projeto aberto: nao abre (nem pergunta ao main)')
  tela.fase = 'empty'
  confere((await decidir()) && aberta(), '...e de volta a tela inicial, o proximo gatilho abre (nada se gastou)')

  reiniciar()
  tela.biblioteca = true
  confere(!(await decidir()) && !aberta(), 'com a Biblioteca aberta: nao abre')

  reiniciar()
  let soltar: () => void = () => {}
  main.segurar = new Promise<void>((r) => (soltar = r))
  const decisao = decidir()
  tela.fase = 'editing'
  useBoasVindas.getState().saiuDaTelaInicial()
  soltar()
  confere(!(await decisao) && !aberta(), 'projeto abriu enquanto a resposta vinha: nao abre')

  reiniciar()
  main.segurar = new Promise<void>((r) => (soltar = r))
  const antesDuas = quantas('provedorDaIa')
  const a = decidir()
  const b = decidir()
  soltar()
  const [ra, rb] = await Promise.all([a, b])
  confere(ra && rb && aberta() && quantas('provedorDaIa') - antesDuas === 1, 'dois gatilhos juntos (o app abrindo e o clique): uma pergunta so')

  reiniciar()
  await decidir()
  const salvasAntes = quantas('salvarConfig')
  useBoasVindas.getState().depois()
  confere(!aberta() && quantas('salvarConfig') === salvasAntes, '"Depois": fecha e nao grava nada')
  confere(!(await decidir()) && !aberta(), '...e nao volta nesta sessao')

  reiniciar()
  await decidir()
  useBoasVindas.getState().saiuDaTelaInicial()
  confere(!aberta(), 'aberta e saiu da tela inicial: fecha')
  confere(!(await decidir()), '...e nao volta nesta sessao')

  reiniciar()
  await decidir()
  await useBoasVindas.getState().naoPerguntarMais()
  confere(!aberta(), '"Nao perguntar mais": fecha')
  confere(JSON.stringify(ultima('salvarConfig')) === JSON.stringify([{ naoPerguntarChave: true }]), 'e grava so naoPerguntarChave: true na config do modulo')
  useBoasVindas.getState().reiniciar()
  confere(!(await decidir()) && !aberta(), 'desligar e ligar (ou reabrir o app): nao volta')

  reiniciar()
  await decidir()
  useBoasVindas.getState().depois()
  useBoasVindas.getState().reiniciar()
  confere((await decidir()) && aberta(), 'desligar e ligar o modulo depois do "Depois": pergunta de novo')

  console.log('\n== O "Gerar recap"')
  reiniciar()
  assistente = 0
  await gerarRecap()
  confere(aberta() && assistente === 0, 'sem chave: a boas-vindas, e o assistente nao abre por baixo')
  useBoasVindas.getState().depois()
  await gerarRecap()
  confere(!aberta() && assistente === 1, 'depois do "Depois": o assistente, sem a boas-vindas')

  reiniciar()
  assistente = 0
  main.provedor = 'gemini'
  await gerarRecap()
  confere(!aberta() && assistente === 1, 'com chave: o assistente direto')

  reiniciar()
  assistente = 0
  tela.fase = 'editing'
  await gerarRecap()
  confere(!aberta() && assistente === 1, 'com projeto aberto (a paleta): o assistente, nunca a boas-vindas por cima')

  reiniciar()
  assistente = 0
  main.naoPerguntarChave = true
  await gerarRecap()
  confere(!aberta() && assistente === 1, '"Nao perguntar mais": o assistente direto')

  console.log('\n== Instalar agora (motor)')
  const casos: { nome: string; estado: EstadoDoMotorRuntime; instala: boolean }[] = [
    { nome: 'ausente, placa lida, disco ok', estado: motor('ausente'), instala: true },
    { nome: 'incompleto (Continuar)', estado: motor('incompleto', { andamento: { etapa: 'baixar-torch', fracao: 0.4, mensagem: 'x' } }), instala: true },
    { nome: 'desatualizado (Atualizar)', estado: motor('desatualizado'), instala: true },
    { nome: 'placa ainda sendo lida', estado: motor('ausente', { gpu: null }), instala: false },
    { nome: 'falta disco', estado: motor('ausente', { livreNoDisco: 2e9 }), instala: false },
    { nome: 'parou na conferencia (Continuar ou Recomecar)', estado: motor('incompleto', { erro: { tipo: 'conferencia', mensagem: 'x' } }), instala: false },
    { nome: 'instalando', estado: motor('instalando'), instala: false },
  ]
  for (const caso of casos) {
    useMotorRuntime.setState({ estado: caso.estado, aberta: false })
    main.motor = caso.estado
    const n = quantas('instalarMotorRuntime')
    instalarMotorAgora()
    await esperar(5)
    const instalou = quantas('instalarMotorRuntime') - n
    confere(
      useMotorRuntime.getState().aberta && instalou === (caso.instala ? 1 : 0),
      `${caso.nome}: abre a tela do motor${caso.instala ? ' e ja instala' : ', sem comecar'}`,
    )
  }
  confere(
    motorPronto(motor('pronto')) && motorPronto(motor('dev')) && !motorPronto(motor('ausente')) && !motorPronto(null),
    'pronto e dev contam como prontos',
  )

  console.log('\n== O cartao')
  const lojas = [useBoasVindas, useMotorRuntime] as unknown as { getState: () => object; getInitialState: () => object }[]
  const cartao = (): string => desenhar(lojas, () => renderToStaticMarkup(createElement(CartaoDeBoasVindas)))
  const com = (patch: Partial<PublicSettings>): PublicSettings => ({ ...semChave(), ...patch })
  useMotorRuntime.setState({ estado: motor('ausente'), aberta: false })
  useBoasVindas.setState({ momento: 'aberta', settings: semChave(), voz: vozSemChave() })
  let html = cartao()
  let t = texto(html)
  console.log(`  ${t.trim()}`)
  confere(
    ['Gerar recap', 'Chave do Gemini', 'Pegar chave gratis', 'Salvar', 'Testar', 'Narracao', 'Configurar', 'Motor de personagens', 'Instalar agora', '~3 GB', 'Nao perguntar mais', 'Depois'].every((x) =>
      t.includes(x),
    ),
    'sem chave: Gemini (pegar, salvar, testar), voz, motor, "Nao perguntar mais" e "Depois"',
  )
  confere(!t.includes('Comecar'), 'sem chave, sem "Comecar"')
  confere(html.includes('href="https://aistudio.google.com/apikey"') && html.includes('target="_blank"'), '"Pegar chave gratis" abre o AI Studio no navegador')
  confere(/<input[^>]*autofocus=""/i.test(html), 'o foco nasce no campo da chave')
  tela.modalPorCima = true
  confere(!/autofocus/i.test(cartao()), 'aberta por baixo das Configuracoes (ligou o modulo la): o foco fica nelas')
  tela.modalPorCima = false
  confere(html.includes('border-accent/40'), 'a chave do Gemini e a destacada (recomendada)')
  confere(html.includes('aria-modal="true"'), 'e um modal (o Tab fica nele)')
  confere(ascii(t), 'texto da tela em ASCII')
  const palavras = t.trim().split(' ').length
  confere(palavras < 60, `pouco texto (${palavras} palavras)`)

  useBoasVindas.setState({ settings: com({ hasGeminiKey: true, geminiKeyHint: '\u2022\u2022\u2022\u2022abcd' }) })
  t = texto(cartao())
  confere(
    t.includes('Salva') && t.includes('Comecar') && !t.includes('Nao perguntar mais') && !t.includes('Pegar chave gratis') && !t.includes('Depois'),
    'com a chave salva: "Salva", "Comecar", sem "Nao perguntar mais" nem "Depois"',
  )
  useBoasVindas.setState({ settings: com({ hasApiKey: true }) })
  t = texto(cartao())
  confere(t.includes('Comecar') && t.includes('Pegar chave gratis'), 'so a da Anthropic salva: "Comecar" (o nucleo usa ela), o Gemini segue oferecido')

  useBoasVindas.setState({
    settings: semChave(),
    voz: { ...vozSemChave(), hasElevenKey: true, vozPadrao: { provedor: 'elevenlabs', voiceId: 'v1', modelId: '', velocidadeNativa: 1.2 } },
  })
  t = texto(cartao())
  confere(t.includes('ElevenLabs') && !t.includes('Chave salva') && !t.includes('importe o audio'), 'voz padrao com a chave dela: o nome do provedor, sem a frase')
  useBoasVindas.setState({ voz: { ...vozSemChave(), hasFishKey: true } })
  t = texto(cartao())
  confere(t.includes('Chave salva') && !t.includes('importe o audio'), 'so a chave da voz, sem voz escolhida: "Chave salva"')
  useBoasVindas.setState({ voz: vozSemChave() })
  t = texto(cartao())
  confere(t.includes('ElevenLabs ou Fish Audio. Ou importe o audio depois.'), 'sem chave de voz: ElevenLabs ou Fish, ou importar depois')

  for (const [fase, esperado, nao] of [
    ['pronto', 'Pronto', 'Instalar agora'],
    ['dev', 'Pronto', 'Instalar agora'],
    ['incompleto', 'Continuar', 'Instalar agora'],
    ['desatualizado', 'Atualizar', 'Instalar agora'],
  ] as const) {
    useMotorRuntime.setState({ estado: motor(fase) })
    t = texto(cartao())
    confere(t.includes(esperado) && !t.includes(nao), `motor ${fase}: "${esperado}"`)
  }
  useMotorRuntime.setState({ estado: motor('pronto') })
  t = texto(cartao())
  confere(!t.includes('~3 GB') && !t.includes('Corta as cenas'), 'motor pronto: sem tamanho e sem a frase')
  useMotorRuntime.setState({ estado: motor('instalando', { andamento: { etapa: 'baixar-torch', fracao: 0.43, mensagem: 'Baixando torch' } }) })
  t = texto(cartao())
  confere(t.includes('Instalando 43%'), 'motor instalando: "Instalando 43%"')
  useMotorRuntime.setState({ estado: null })
  t = texto(cartao())
  confere(!t.includes('Instalar agora') && t.includes('~3 GB'), 'motor ainda sem resposta do main: nada de botao, o tamanho da instalacao cheia')

  console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
  process.exit(falhas === 0 ? 0 : 1)
}

void principal().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
