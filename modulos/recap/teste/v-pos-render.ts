/**
 * [recap] A TELA POS-RENDER (a do CapCut) sem app e sem navegador:
 *
 * - os textos: hashtags "#a #b" (sem # dobrado nem vazias) e o "Copiar tudo"
 *   com um bloco por rotulo, so os que tem algo;
 * - o main (electron/pos-render.ts): o video publicado no servidor local, os
 *   titulos/thumbs da versao do roteiro (a editada usa os da versao de
 *   origem), o video de mesmo nome na pasta do projeto que mudou de lugar,
 *   rascunho sumido ou arquivo que nao e video sem quebrar, o rascunho intacto;
 * - o "Escrever de novo" dos titulos e thumbs com a IA FALSA (nada sai para a
 *   rede): um pedido para os dois, com as regras do roteiro (TITULO E THUMB,
 *   SEGURANCA DA PLATAFORMA), o roteiro e os de agora no pedido; o que repetiu
 *   os de agora sai; cota/rede = recado curto;
 * - o store: so abre em projeto do recap (`modulos.recap`) e com arquivo;
 *   projeto normal do Dangai nao abre nem chama o main; o render anotado no
 *   projeto (sem passo de Ctrl+Z, projeto "nao salvo") e o "Video pronto"
 *   reabrindo sem gerar nada; a resposta de um render antigo nao cai por cima;
 *   fechar no meio nao reabre; o "Escrever descricao e hashtags" pelo
 *   gerarMetadata do nucleo; o "Escrever de novo" dos titulos: um clique so,
 *   resultado no projeto e valendo ao reabrir, erro mantem os de antes;
 * - a janela: video, 3 titulos com a contagem (n/100), thumbs em CAIXA ALTA,
 *   descricao e hashtags com copiar, "Escrever de novo" nas duas secoes,
 *   "Copiar tudo", "Abrir pasta", "Fechar"; sem metadata, o botao de escrever;
 *   video que sumiu: o recado; o "Video pronto" so com render anotado.
 *
 * Nao substitui o print do app. Rodar da raiz:
 *   npx esbuild modulos/recap/teste/v-pos-render.ts --bundle --platform=node --packages=external --jsx=automatic --tsconfig=tsconfig.web.json --define:import.meta.env.DEV=false --log-level=error | node
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Metadata } from '@shared/contract'
import type { Nucleo } from '@/modulos/nucleo'
import type { ContextoDoModulo } from '../../../electron/modulos'
import type { PedidoDeTitulos, PedidoDoPosRender, TextosDoPosRender, TitulosNovos } from '../shared/pos-render'

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
type Resultado<T> = { ok: true; value: T } | { ok: false; error: string }

// O esbuild manda um pedaco so pelo stdin: o caminho vem da raiz do repo.
const FIXTURE = join(process.cwd(), 'modulos', 'recap', 'teste', 'fixture')

const RECAP = {
  versao: 1,
  rascunhoId: 'rc_25d63d4babd6_mv78ssvg',
  episodioId: `ep_${'a'.repeat(40)}`,
  takeId: 't1',
  roteiroVersao: 7,
  vozAlinhada: true,
  geradoEm: '2026-10-20T10:00:00.000Z',
}
const TITULOS = ['Ele Despertou o Maior Poder da Historia', 'O Reino de Pedra Acordou', 'Senku Contra o Mundo Inteiro']
const THUMBS = ['ELE DESPERTOU', 'DUAS GAROTAS?!', 'O FIM DA PEDRA']
const ROTEIRO = 'Senku acordou depois de 3700 anos de pedra. E o pior: o mundo inteiro tinha virado floresta. Agora ele quer reconstruir a civilizacao do zero.'

// ---------------------------------------------------------- o main falso
const pedidos: PedidoDoPosRender[] = []
const pedidosDeTitulos: PedidoDeTitulos[] = []
let respostaDoMain: (p: PedidoDoPosRender) => Promise<Resultado<TextosDoPosRender>> = async () => ({
  ok: true,
  value: { videoUrl: 'http://127.0.0.1:1/m/x', videoPath: null, titulos: TITULOS, thumbs: THUMBS },
})
let respostaDosTitulos: (p: PedidoDeTitulos) => Promise<Resultado<TitulosNovos>> = async () => ({ ok: false, error: 'sem' })
Reflect.set(globalThis, 'window', {
  dangai: {
    revealFile: async () => ({ ok: true, value: undefined }),
    modulos: {
      recap: {
        posRender: async (p: PedidoDoPosRender) => {
          pedidos.push(p)
          return respostaDoMain(p)
        },
        titulosDoVideo: async (p: PedidoDeTitulos) => {
          pedidosDeTitulos.push(p)
          return respostaDosTitulos(p)
        },
      },
    },
  },
})

/** O zustand desenha o estado INICIAL no servidor: antes, ele recebe o de agora. */
function desenhar(lojas: { getState: () => object; getInitialState: () => object }[], render: () => string): string {
  for (const loja of lojas) Object.assign(loja.getInitialState(), loja.getState())
  return render()
}

async function principal(): Promise<void> {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { hashtagsEmTexto, textoDeCopiarTudo } = await import('../shared/pos-render')
  const { guardarNucleo } = await import('../src/nucleo')
  const { guardarORender, renderDoProjeto, usePosRender } = await import('../src/store/pos-render')
  const { BotaoVideoPronto, comandoDoVideoPronto, JanelaDoPosRender } = await import('../src/components/PosRender')

  console.log('\n== os textos')
  confere(hashtagsEmTexto(['anime', '#drstone', ' recap ', '', '##shorts']) === '#anime #drstone #recap #shorts', 'hashtags: "#a #b", sem # dobrado nem vazias')
  const tudo = textoDeCopiarTudo({ titulos: TITULOS, thumbs: ['ele despertou'], descricao: ' Senku acorda. ', hashtags: ['drstone', 'recap'] })
  confere(
    tudo ===
      'TITULOS\n1. Ele Despertou o Maior Poder da Historia\n2. O Reino de Pedra Acordou\n3. Senku Contra o Mundo Inteiro\n\n' +
        'TEXTO DA THUMBNAIL\n1. ELE DESPERTOU\n\nDESCRICAO\nSenku acorda.\n\nHASHTAGS\n#drstone #recap',
    'copiar tudo: um bloco por rotulo, na ordem da tela, thumb em CAIXA ALTA',
  )
  confere(textoDeCopiarTudo({ titulos: ['A'], thumbs: [], descricao: null, hashtags: [] }) === 'TITULOS\n1. A', 'so o que tem algo (sem os rotulos vazios)')
  confere(textoDeCopiarTudo({ titulos: [], thumbs: [], descricao: '  ', hashtags: [] }) === '', 'nada = texto vazio (o botao apaga)')

  console.log('\n== o main (electron/pos-render.ts)')
  const userData = mkdtempSync(join(tmpdir(), 'dangai-v-pos-render-'))
  try {
    const { configurarEpisodios } = await import('../electron/episodio/perfil')
    const { guardarContexto } = await import('../electron/contexto')
    const { pastaDosRascunhos } = await import('../electron/gerar/rascunho')
    const { trocarIaParaTeste } = await import('../electron/gerar/ia')
    const { startMediaServer } = await import('../../../electron/services/media-server')
    const { abrirPosRender, escreverTitulosEThumbs } = await import('../electron/pos-render')
    configurarEpisodios(userData)
    // Sem provedor no contexto: o cache de IA fica de fora (a IA e a falsa, abaixo).
    guardarContexto({ id: 'recap', ia: { provedor: () => null } } as unknown as ContextoDoModulo)
    await startMediaServer()
    mkdirSync(pastaDosRascunhos(), { recursive: true })
    const arquivoDoRascunho = join(pastaDosRascunhos(), `${RECAP.rascunhoId}.json`)
    copyFileSync(join(FIXTURE, 'rascunho-s4e37.json'), arquivoDoRascunho)
    const cru = JSON.parse(readFileSync(arquivoDoRascunho, 'utf8')) as { roteiros: { versao: number; sugestoes?: unknown }[] }
    // A versao 6 trouxe as sugestoes; a 7 saiu dela (derivadoDe: 6), editada.
    const v6 = cru.roteiros.find((v) => v.versao === 6)
    if (v6) v6.sugestoes = { titulos: TITULOS, thumbs: THUMBS }
    writeFileSync(arquivoDoRascunho, JSON.stringify(cru))
    const antes = readFileSync(arquivoDoRascunho, 'utf8')
    const video = join(userData, 'Recap pronto.mp4')
    writeFileSync(video, Buffer.alloc(64))

    const r7 = abrirPosRender({ outputPath: video, rascunhoId: RECAP.rascunhoId, roteiroVersao: 7 })
    confere(/^http:\/\/127\.0\.0\.1:\d+\/m\/[0-9a-f-]{36}$/.test(r7.videoUrl ?? '') && r7.videoPath === video, `o video publicado no servidor local (${r7.videoUrl})`)
    confere(r7.titulos.join('|') === TITULOS.join('|') && r7.thumbs.join('|') === THUMBS.join('|'), 'versao editada (7): os titulos e thumbs da versao de origem (6)')
    const r4 = abrirPosRender({ outputPath: video, rascunhoId: RECAP.rascunhoId, roteiroVersao: 4 })
    confere(r4.titulos.length === 0 && r4.thumbs.length === 0 && r4.videoUrl !== null, 'versao sem sugestoes: listas vazias, o video toca')
    const sumiu = abrirPosRender({ outputPath: video, rascunhoId: 'rc_nao_existe', roteiroVersao: 7 })
    confere(sumiu.titulos.length === 0 && sumiu.videoUrl !== null, 'rascunho que sumiu: sem sugestoes, sem quebrar')
    const mudou = abrirPosRender({
      outputPath: 'D:\\pasta velha\\Recap pronto.mp4',
      rascunhoId: null,
      roteiroVersao: null,
      projetoPath: join(userData, 'Recap.dangai'),
    })
    confere(mudou.videoPath === video && mudou.videoUrl !== null, 'a pasta do projeto mudou de lugar: o video de mesmo nome ao lado do .dangai')
    const txt = join(userData, 'nota.txt')
    writeFileSync(txt, 'x')
    confere(abrirPosRender({ outputPath: txt, rascunhoId: null, roteiroVersao: null }).videoUrl === null, 'arquivo que nao e video: nao publica')
    const semVideo = abrirPosRender({ outputPath: join(userData, 'sumiu.mp4'), rascunhoId: null, roteiroVersao: null, projetoPath: join(userData, 'x.dangai') })
    confere(semVideo.videoUrl === null && semVideo.videoPath === null, 'video que sumiu (nem na pasta do projeto): null')
    confere(readFileSync(arquivoDoRascunho, 'utf8') === antes, 'o rascunho fica intacto no disco (so le)')

    console.log('\n== escrever de novo: titulos e thumbs (IA falsa)')
    const chamadas: { etapa: string; sistema: string; prompt: string }[] = []
    let respostaDaIa: () => unknown = () => ({
      ok: true,
      valor: {
        titulos: ['O Cientista Que Acordou Depois do Fim', TITULOS[0], '**A Pedra Nao Segurou o Senku**'],
        textosDeThumb: ['acordou na pedra', 'DUAS GAROTAS?!', 'curto', 'O MUNDO VIROU FLORESTA'],
      },
      provedor: 'gemini',
      modelo: 'gemini-falso',
    })
    const desfazer = trocarIaParaTeste((async (pedido: { etapa: string; sistema: string; prompt: string }) => {
      chamadas.push(pedido)
      return respostaDaIa()
    }) as never)
    try {
      const novos = await escreverTitulosEThumbs({ roteiro: ROTEIRO, rascunhoId: RECAP.rascunhoId, roteiroVersao: 7, atuais: { titulos: TITULOS, thumbs: THUMBS } })
      const c = chamadas[0]
      confere(chamadas.length === 1 && c?.etapa === 'titulos-do-video', 'um pedido so para titulos e thumbs')
      confere(!!c && c.sistema.includes('SEGURANÇA DA PLATAFORMA') && c.sistema.includes('TÍTULO E THUMB'), 'as regras do roteiro: SEGURANCA DA PLATAFORMA e TITULO E THUMB')
      confere(!!c && c.prompt.includes(ROTEIRO), 'o roteiro do projeto vai no pedido')
      confere(!!c && TITULOS.every((t) => c.prompt.includes(`- ${t}`)) && THUMBS.every((t) => c.prompt.includes(`- ${t}`)) && c.prompt.includes('DIFERENTES'), 'os de agora vao no pedido, pedindo DIFERENTES')
      confere(
        novos.titulos.join('|') === 'O Cientista Que Acordou Depois do Fim|A Pedra Nao Segurou o Senku',
        `titulos limpos e sem os repetidos: ${novos.titulos.join(' | ')}`,
      )
      confere(novos.thumbs.join('|') === 'ACORDOU NA PEDRA|O MUNDO VIROU FLORESTA', `thumbs em CAIXA ALTA, 2 a 5 palavras, sem os repetidos: ${novos.thumbs.join(' | ')}`)
      chamadas.length = 0
      await escreverTitulosEThumbs({ roteiro: '', rascunhoId: RECAP.rascunhoId, roteiroVersao: 7, atuais: { titulos: [], thumbs: [] } })
      confere(chamadas[0]?.prompt.includes('ROTEIRO NARRADO') === true && (chamadas[0]?.prompt.length ?? 0) > 200, 'sem script no projeto: o texto da versao do rascunho')
      respostaDaIa = () => ({ ok: false, nota: 'A cota gratis do Gemini acabou por hoje. Ela volta amanha cedo; ate la, use outra chave ou espere. Detalhes tecnicos: 429 RESOURCE_EXHAUSTED ' + 'x'.repeat(300), bruto: '' })
      const erro = await escreverTitulosEThumbs({ roteiro: ROTEIRO, rascunhoId: null, roteiroVersao: null, atuais: { titulos: [], thumbs: [] } }).then(
        () => '',
        (e: Error) => e.message,
      )
      confere(erro === 'A cota gratis do Gemini acabou por hoje.', `cota: o recado curto ("${erro}")`)
      respostaDaIa = () => ({ ok: true, valor: { titulos: TITULOS, textosDeThumb: THUMBS }, provedor: 'gemini', modelo: 'x' })
      const repetiu = await escreverTitulosEThumbs({ roteiro: ROTEIRO, rascunhoId: null, roteiroVersao: null, atuais: { titulos: TITULOS, thumbs: THUMBS } }).then(
        () => '',
        (e: Error) => e.message,
      )
      confere(repetiu.includes('nada novo'), 'a IA so repetiu: recado, nada trocado')
      const semRoteiro = await escreverTitulosEThumbs({ roteiro: 'curto', rascunhoId: null, roteiroVersao: null, atuais: { titulos: [], thumbs: [] } }).then(
        () => '',
        (e: Error) => e.message,
      )
      confere(semRoteiro.includes('Sem roteiro'), 'sem roteiro: nem chama a IA')
    } finally {
      desfazer()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }

  console.log('\n== o store (so projeto do recap)')
  const estado = {
    modulos: {} as Record<string, unknown>,
    metadata: null as Metadata | null,
    error: null as string | null,
    projectPath: 'C:\\Projetos\\Recap.dangai' as string | null,
    script: ROTEIRO as string | null,
  }
  let gerarMetadata: () => Promise<void> = async () => {}
  let metadataPedidos = 0
  const gravacoes: { dados: unknown; quieto: boolean }[] = []
  let quieto = false
  let sujo = 0
  guardarNucleo({
    ler: () => estado,
    usar: <T>(sel: (s: typeof estado) => T) => sel(estado),
    gerarMetadata: () => {
      metadataPedidos += 1
      return gerarMetadata()
    },
    gravarNoProjeto: (dados: unknown) => {
      gravacoes.push({ dados, quieto })
      estado.modulos = { ...estado.modulos, recap: dados }
    },
    semSujar: async <T>(fn: () => T) => {
      quieto = true
      try {
        return await fn()
      } finally {
        quieto = false
      }
    },
    marcarSujo: () => {
      sujo += 1
    },
  } as unknown as Nucleo)
  const s = () => usePosRender.getState()

  confere((await s().abrir('C:/v/normal.mp4')) === false && !s().aberta && pedidos.length === 0, 'projeto normal do Dangai: nao abre e nao chama o main')
  confere((await guardarORender('C:/v/normal.mp4')) === false && gravacoes.length === 0, 'projeto normal: o render nao e anotado')
  estado.modulos = { recap: { versao: 1, lixo: true } }
  confere((await s().abrir('C:/v/normal.mp4')) === false && !s().aberta, '`modulos.recap` que nao confere: nao abre')
  estado.modulos = { recap: RECAP }
  confere((await s().abrir(null)) === false && !s().aberta, 'render sem arquivo: nao abre')
  confere((await s().reabrir()) === false && renderDoProjeto(estado.modulos) === null, 'sem render anotado: o "Video pronto" nao tem o que abrir')
  confere((await s().abrir('C:/v/Recap.mp4')) === true && s().aberta, 'projeto do recap: abre')
  const ultimo = pedidos[pedidos.length - 1]
  confere(
    ultimo?.outputPath === 'C:/v/Recap.mp4' && ultimo.rascunhoId === RECAP.rascunhoId && ultimo.roteiroVersao === 7 && ultimo.projetoPath === estado.projectPath,
    'pede ao main o arquivo, o rascunho, a versao do roteiro e o projeto',
  )
  confere(s().videoUrl === 'http://127.0.0.1:1/m/x' && s().titulos.length === 3 && s().thumbs.length === 3 && !s().carregando, 'o video e os textos chegam')

  console.log('\n== o render anotado e o "Video pronto"')
  confere((await guardarORender('C:/v/Recap.mp4')) === true, 'projeto do recap: o render e anotado')
  const g = gravacoes[gravacoes.length - 1]
  const gravado = g?.dados as { render?: { arquivo: string }; rascunhoId?: string } | undefined
  confere(g?.quieto === true && sujo === 1, 'sem passo de Ctrl+Z (semSujar) e o projeto fica "nao salvo"')
  confere(gravado?.render?.arquivo === 'C:/v/Recap.mp4' && gravado.rascunhoId === RECAP.rascunhoId, 'no modulos.recap, junto do resto (o rascunho fica)')
  confere(renderDoProjeto(estado.modulos)?.arquivo === 'C:/v/Recap.mp4', 'o projeto relido sabe do render')
  s().fechar()
  const antesDoReabrir = pedidos.length
  metadataPedidos = 0
  confere((await s().reabrir()) === true && s().aberta && pedidos[antesDoReabrir]?.outputPath === 'C:/v/Recap.mp4', '"Video pronto": reabre com o render anotado')
  confere(metadataPedidos === 0 && pedidosDeTitulos.length === 0, 'reabrir nao gera nada (nem descricao, nem titulos)')
  confere(comandoDoVideoPronto().length === 1 && comandoDoVideoPronto()[0]?.label === 'Video pronto', 'a paleta tem o "Video pronto"')
  confere(texto(renderToStaticMarkup(createElement(BotaoVideoPronto))).includes('Video pronto'), 'a barra de status tem o "Video pronto"')
  respostaDoMain = async (p) => ({
    ok: true,
    value: { videoUrl: 'http://127.0.0.1:1/m/x', videoPath: p.outputPath.replace('C:/v/', 'D:/novo/'), titulos: TITULOS, thumbs: THUMBS },
  })
  await s().reabrir()
  confere(s().outputPath === 'D:/novo/Recap.mp4', 'o video achado em outro lugar vira o do "Abrir pasta"')

  // Dois renders seguidos: a resposta lenta do primeiro nao cai por cima do segundo.
  let soltar: () => void = () => {}
  respostaDoMain = (p) =>
    p.outputPath.endsWith('lento.mp4')
      ? new Promise((r) => {
          soltar = () => r({ ok: true, value: { videoUrl: 'http://127.0.0.1:1/m/velho', videoPath: null, titulos: ['velho'], thumbs: [] } })
        })
      : Promise.resolve({ ok: true, value: { videoUrl: 'http://127.0.0.1:1/m/novo', videoPath: null, titulos: ['novo'], thumbs: [] } })
  const lento = s().abrir('C:/v/lento.mp4')
  await s().abrir('C:/v/novo.mp4')
  soltar()
  await lento
  confere(s().videoUrl === 'http://127.0.0.1:1/m/novo' && s().titulos[0] === 'novo' && s().outputPath === 'C:/v/novo.mp4', 'a resposta de um render antigo nao cai por cima do novo')
  const pendente = s().abrir('C:/v/lento.mp4')
  s().fechar()
  soltar()
  await pendente
  confere(!s().aberta && s().videoUrl === null, 'fechar no meio: a resposta que chega depois nao reabre')
  respostaDoMain = async () => ({ ok: false, error: 'Rascunho invalido.' })
  await s().abrir('C:/v/Recap.mp4')
  confere(s().aberta && s().erro === 'Rascunho invalido.' && !s().carregando, 'o main recusou: abre com o recado')

  console.log('\n== escrever descricao e hashtags (o gerarMetadata do nucleo)')
  gerarMetadata = async () => {
    await esperar(5)
    estado.metadata = { titles: ['T1', 'T2', 'T3'], description: 'Senku acorda depois de 3700 anos.', hashtags: ['drstone', 'recap'] }
  }
  const escrevendo = s().escreverTextos()
  confere(s().escrevendo, 'escrevendo... enquanto o nucleo responde')
  await s().escreverTextos()
  confere(metadataPedidos === 1, 'dois cliques seguidos: uma chamada so')
  await escrevendo
  confere(!s().escrevendo && s().erroDosTextos === null, 'pronto: sem recado')
  gerarMetadata = async () => {
    estado.error = 'Configure a chave do Gemini.'
  }
  await s().escreverTextos()
  confere(s().erroDosTextos === 'Configure a chave do Gemini.', 'o nucleo nao escreveu: o erro dele aparece na tela')
  estado.error = null

  console.log('\n== escrever de novo: titulos e thumbs (o store)')
  respostaDoMain = async () => ({ ok: true, value: { videoUrl: 'http://127.0.0.1:1/m/x', videoPath: null, titulos: TITULOS, thumbs: THUMBS } })
  await s().abrir('C:/v/Recap.mp4')
  let soltarTitulos: () => void = () => {}
  respostaDosTitulos = () =>
    new Promise((r) => {
      soltarTitulos = () => r({ ok: true, value: { titulos: ['Novo 1', 'Novo 2', 'Novo 3'], thumbs: [] } })
    })
  const gravacoesAntes = gravacoes.length
  const clique = s().escreverTitulos('thumbs')
  confere(s().escrevendoTitulos === 'thumbs', '"Escrevendo..." na secao do clique')
  await s().escreverTitulos('titulos')
  confere(pedidosDeTitulos.length === 1, 'dois cliques seguidos: um pedido so')
  const p0 = pedidosDeTitulos[0]
  confere(
    p0?.roteiro === ROTEIRO && p0.rascunhoId === RECAP.rascunhoId && p0.atuais.titulos.join('|') === TITULOS.join('|') && p0.atuais.thumbs.join('|') === THUMBS.join('|'),
    'o pedido leva o roteiro do projeto e os de agora',
  )
  soltarTitulos()
  await clique
  confere(s().escrevendoTitulos === null && s().titulos.join('|') === 'Novo 1|Novo 2|Novo 3', 'os titulos novos na tela')
  confere(s().thumbs.join('|') === THUMBS.join('|'), 'a IA nao trouxe thumb nova: ficam as de antes')
  const gt = gravacoes[gravacoes.length - 1]
  const comSugestoes = gt?.dados as { sugestoesDoVideo?: { titulos: string[]; thumbs: string[] }; render?: unknown } | undefined
  confere(
    gravacoes.length === gravacoesAntes + 1 && gt?.quieto === false && comSugestoes?.sugestoesDoVideo?.titulos[0] === 'Novo 1' && comSugestoes.render !== undefined,
    'gravado no projeto (um passo de Ctrl+Z), sem perder o render anotado',
  )
  s().fechar()
  const pedidosAntes = pedidosDeTitulos.length
  await s().reabrir()
  confere(s().titulos[0] === 'Novo 1' && s().thumbs.join('|') === THUMBS.join('|') && pedidosDeTitulos.length === pedidosAntes, 'reabrir: os do projeto no lugar dos do roteiro, sem gerar de novo')
  respostaDosTitulos = async () => ({ ok: false, error: 'A cota gratis do Gemini acabou por hoje.' })
  await s().escreverTitulos('titulos')
  confere(
    s().erroDosTitulos?.secao === 'titulos' && s().erroDosTitulos?.texto.includes('cota') === true && s().titulos[0] === 'Novo 1',
    'cota: o recado na secao do clique, e os textos de antes ficam',
  )

  console.log('\n== a janela')
  respostaDoMain = async () => ({ ok: true, value: { videoUrl: 'http://127.0.0.1:1/m/x', videoPath: null, titulos: TITULOS, thumbs: THUMBS.map((t) => t.toLowerCase()) } })
  estado.modulos = { recap: RECAP }
  estado.metadata = { titles: ['T1', 'T2', 'T3'], description: 'Senku acorda depois de 3700 anos.', hashtags: ['drstone', 'recap'] }
  await s().abrir('C:\\Videos\\Recap pronto.mp4')
  const html = desenhar([usePosRender], () => renderToStaticMarkup(createElement(JanelaDoPosRender)))
  const t = texto(html)
  confere(html.includes('<video') && html.includes('src="http://127.0.0.1:1/m/x"'), 'o video do servidor local')
  confere(/aspect-ratio:0\.5625/.test(html.replace(/\s/g, '')), 'a caixa do player na proporcao do video (9:16 ate o arquivo dizer)')
  confere(html.includes('aria-label="Tocar"') && html.includes('type="range"'), 'o player: play/pause e a barra')
  confere(TITULOS.every((x) => t.includes(x)), 'os 3 titulos')
  confere(TITULOS.every((x) => t.includes(`${[...x].length}/100`)), `a contagem de cada titulo (${TITULOS.map((x) => [...x].length).join(', ')}/100)`)
  confere((html.match(/aria-label="Copiar o titulo"/g) ?? []).length === 3, 'um copiar por titulo')
  confere(THUMBS.every((x) => t.includes(x)) && (html.match(/aria-label="Copiar o texto da thumb"/g) ?? []).length === 3, 'os 3 textos de thumb em CAIXA ALTA, cada um com copiar')
  confere((t.match(/Escrever de novo/g) ?? []).length === 3, '"Escrever de novo" nos titulos, nas thumbs e na descricao')
  confere(t.includes('Senku acorda depois de 3700 anos.') && html.includes('aria-label="Copiar a descricao"'), 'a descricao com copiar')
  confere(t.includes('#drstone #recap') && html.includes('aria-label="Copiar as hashtags"'), 'as hashtags com copiar')
  confere(t.includes('Copiar tudo') && t.includes('Abrir pasta') && t.includes('Fechar'), '"Copiar tudo", "Abrir pasta" e "Fechar"')
  confere(t.includes('Recap pronto.mp4') && t.includes('Video pronto'), 'o nome do arquivo no alto')
  confere(ascii(t.replace(/Senku acorda depois de 3700 anos\./, '')), 'a interface em ASCII')

  usePosRender.setState({ escrevendoTitulos: 'titulos' })
  const escrevendoHtml = texto(desenhar([usePosRender], () => renderToStaticMarkup(createElement(JanelaDoPosRender))))
  confere((escrevendoHtml.match(/Escrevendo\.\.\./g) ?? []).length === 2, 'escrevendo: "Escrevendo..." nos dois (um pedido so)')
  usePosRender.setState({ escrevendoTitulos: null })

  estado.metadata = null
  const semMetadata = texto(desenhar([usePosRender], () => renderToStaticMarkup(createElement(JanelaDoPosRender))))
  confere(semMetadata.includes('Escrever descricao e hashtags') && !semMetadata.includes('#drstone'), 'sem metadata: o botao de escrever')

  estado.metadata = { titles: ['Do metadata 1', 'Do metadata 2', 'Do metadata 3'], description: 'd', hashtags: [] }
  usePosRender.setState({ titulos: [] })
  const semTitulos = texto(desenhar([usePosRender], () => renderToStaticMarkup(createElement(JanelaDoPosRender))))
  confere(semTitulos.includes('Do metadata 1') && semTitulos.includes('13/100'), 'roteiro sem titulos: os do metadata, com a contagem')

  usePosRender.setState({ videoUrl: null, carregando: false, erro: null })
  const semVideoHtml = desenhar([usePosRender], () => renderToStaticMarkup(createElement(JanelaDoPosRender)))
  confere(texto(semVideoHtml).includes('O video nao esta mais na pasta.') && !semVideoHtml.includes('<video'), 'video que sumiu: o recado no lugar do player')
  confere(semVideoHtml.includes('Mostra o projeto no Explorer') && semVideoHtml.includes('Recap.dangai'), 'video que sumiu: o "Abrir pasta" mostra o projeto')
  confere(texto(semVideoHtml).includes('Do metadata 1'), 'video que sumiu: os textos ficam')

  estado.modulos = {}
  confere(renderToStaticMarkup(createElement(BotaoVideoPronto)) === '' && comandoDoVideoPronto().length === 0, 'projeto sem render: sem o "Video pronto" na barra e na paleta')

  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
}

principal().catch((err) => {
  console.error(err)
  process.exit(1)
})
