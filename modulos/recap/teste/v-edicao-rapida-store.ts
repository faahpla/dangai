/**
 * [recap] A EDICAO RAPIDA no store DE VERDADE do Dangai, pela fachada do
 * nucleo (criarNucleo) e com o desfazer DE VERDADE (src/store/undo.ts), e um
 * window.dangai falso que anota as chamadas. Portado do Studio
 * (scripts/teste/v-edicao-rapida-store.ts + v-edicao-rapida-janela.ts):
 *
 * 1. aplica tudo: SFX e musica nas faixas de audio com `modulos.recap.papel`
 *    (uma faixa por papel, depois da dele), url e onda prontas, o `ducking`
 *    do NUCLEO na musica; o rosto em cada bloco (menos o foco que ele pos a
 *    mao, com o recorte novo); a legenda no estilo salvo (pela troca
 *    programatica do nucleo); a camada de cor com `modulos.recap.papel: 'cor'`;
 * 2. UM passo de Ctrl+Z: desfazer volta TUDO e nao sobra outro passo; refazer traz;
 * 3. rodar de novo troca SO o que a Edicao rapida pos (a trilha dele fica) e a musica troca;
 * 4. so a musica, a escolhida no dialogo: os SFX ficam;
 * 5. o som falha: o resto vale; pasta sem musica: a que estava fica; nada muda = nenhum passo;
 * 6. foco mexido a mao ENQUANTO roda: a mao dele ganha;
 * 7. ocupado ou sem narracao: nada roda;
 * 8. o projeto do Studio (papel/corOriginal nos itens, `studio` na raiz) e
 *    convertido ao abrir: `modulos.recap` versao 1, a trava do transcript, e a
 *    Edicao rapida reconhece a camada e a musica dele.
 *
 * Nao escreve nada. Rodar da raiz do projeto (o store precisa dos caminhos do renderer):
 *   npx tsx --tsconfig tsconfig.web.json modulos/recap/teste/v-edicao-rapida-store.ts
 */
import type { AudioAnalysis, CaptionStyle, ImageAsset, Transcript } from '@shared/contract'
import { DUCKING_PADRAO, MOTION_CURVE_DEFAULT } from '@shared/contract'
import type { LoteDeRostos, PedidoDePlanoDeSom, PlanoDeSom, RostosDoLote } from '../shared/edicao-rapida'
import { CONFIG_DA_EDICAO_RAPIDA_PADRAO, PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO } from '../shared/edicao-rapida'
import type { RecapNoProjeto } from '../shared/projeto-do-recap'

// ------------------------------------------------------------- a janela falsa

const chamadas: { metodo: string; args: unknown[] }[] = []
const quantas = (metodo: string): number => chamadas.filter((c) => c.metodo === metodo).length
const ultima = (metodo: string): unknown[] | undefined => [...chamadas].reverse().find((c) => c.metodo === metodo)?.args
const MUSICAS = ['C:/musicas/Afternoon.mp3', 'C:/musicas/Galactico.m4a']
const ESTILO: CaptionStyle = {
  color: '#FFD400',
  y: 0.42,
  scale: 1.2,
  fontNome: 'Minha Fonte',
  animation: 'elastica',
  animationFrames: 9,
  mark: 'tudo',
  shadow: { distancia: 8, desfoque: 4, opacidade: 0.7, angulo: 90 },
  stroke: 4,
}
const respostas = { somOk: true, rostoOk: true, semMusica: false }

function planejarSom(pedido: PedidoDePlanoDeSom): PlanoDeSom {
  const viradas = pedido.secoes.slice(1).map((s) => s.inicio)
  const sfx = !pedido.sfx
    ? []
    : [
        { at: 0, arquivo: 'C:/sfx/impact.mp3', tipo: 'impacto' as const, ganhoDb: -11, inSec: 0, outSec: 1.2, durationSec: 2.5, marcaSec: 0, motivo: 'comeco do Gancho' },
        ...viradas.map((t, k) => ({
          at: Math.max(0, t - 0.5),
          arquivo: 'C:/sfx/whoosh.mp3',
          tipo: 'whoosh' as const,
          ganhoDb: -14,
          inSec: 0,
          outSec: 0.9,
          durationSec: 1.5,
          marcaSec: t,
          motivo: `virada ${k + 1}`,
        })),
      ]
  const livre = MUSICAS.find((m) => !pedido.evitarMusicas.includes(m)) ?? MUSICAS[0]!
  return {
    sfx,
    musica:
      pedido.musica && !respostas.semMusica
        ? { arquivo: pedido.musicaForcada ?? livre, ganhoDb: -23.5, fadeInSec: 1.2, fadeOutSec: 2, ducking: DUCKING_PADRAO, inSec: 0, durationSec: 30, lufsIntegrado: -14.5 }
        : null,
    avisos: pedido.musica && respostas.semMusica ? ['A pasta de musicas esta vazia'] : [],
  }
}

function rostosDosPedacos(lote: LoteDeRostos): RostosDoLote {
  return {
    focos: lote.pedidos.map((p, i) => ({
      chave: p.chave,
      focusX: 0.8 - i * 0.1,
      focusY: 0.25,
      focusAuto: true,
      fonte: 'lbp' as const,
      personagem: null,
      instantesComRosto: 1,
      instantes: 3,
    })),
    fonte: 'lbp',
    comRosto: lote.pedidos.length,
    total: lote.pedidos.length,
    avisos: [],
    ms: 5,
  }
}

type Resposta = { ok: true; value: unknown } | { ok: false; error: string }
const doNucleo: Record<string, (...args: unknown[]) => Resposta> = {
  analyzeAudio: (path) => ({
    ok: true,
    value: {
      path,
      fileName: String(path).split('/').pop(),
      url: `http://127.0.0.1/a/${String(path).split('/').pop()}`,
      durationSec: String(path).includes('musicas') ? 30 : 2,
      peaks: Array.from({ length: 50 }, (_, i) => (i % 10) / 10),
      rms: Array.from({ length: 50 }, () => 0.2),
    },
  }),
  reframeImage: (args) => ({ ok: true, value: `http://127.0.0.1/recorte/${(args as { id: string }).id}` }),
  getSettings: () => ({ ok: true, value: { captionStyle: ESTILO, presetsDeCor: [] } }),
  pickMusic: () => ({ ok: true, value: { path: 'C:/outra/Escolhida.mp3', fileName: 'Escolhida.mp3', url: 'x' } }),
}
const doModulo: Record<string, (...args: unknown[]) => Resposta> = {
  planejarSom: (pedido) => (respostas.somOk ? { ok: true, value: planejarSom(pedido as PedidoDePlanoDeSom) } : { ok: false, error: 'ffmpeg sumiu' }),
  rostosDosPedacos: (lote) => (respostas.rostoOk ? { ok: true, value: rostosDosPedacos(lote as LoteDeRostos) } : { ok: false, error: 'detector caiu' }),
  lerConfig: () => ({ ok: true, value: { edicaoRapidaPadrao: PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO } }),
  registrarMusicaUsada: () => ({ ok: true, value: true }),
}
const anotando = (tabela: Record<string, (...args: unknown[]) => Resposta>) =>
  new Proxy(
    {},
    {
      get(_alvo, nome) {
        if (typeof nome !== 'string') return undefined
        return async (...args: unknown[]) => {
          chamadas.push({ metodo: nome, args })
          const f = tabela[nome]
          return f ? f(...args) : { ok: true, value: null }
        }
      },
    },
  )
const dangai = anotando(doNucleo) as Record<string, unknown>
Reflect.set(globalThis, 'window', { dangai: new Proxy(dangai, { get: (a, n) => (n === 'modulos' ? { recap: anotando(doModulo) } : Reflect.get(a, n)) }) })
Reflect.set(globalThis, 'localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })

// ------------------------------------------------------------------ o teste

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
const secao = (t: string): void => console.log(`\n== ${t}`)
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const AUDIO: AudioAnalysis = { path: 'C:/proj/narracao.wav', fileName: 'narracao.wav', url: 'http://127.0.0.1/n', durationSec: 12, peaks: [] }
function imagem(n: number, kind: 'video' | 'image', foco: { x: number; y: number; auto: boolean }): ImageAsset {
  return {
    id: `img-${n}`,
    path: kind === 'video' ? `C:/shots/${n}.mp4` : `C:/fotos/${n}.png`,
    fileName: `${n}`,
    url: `http://127.0.0.1/i/${n}`,
    urlSource: null,
    width: 1920,
    height: 1080,
    thumbnail: '',
    focusX: foco.x,
    focusY: foco.y,
    focusAuto: foco.auto,
    kind,
    section: null,
    ...(kind === 'video' ? { durationSec: 8 } : {}),
  } as ImageAsset
}
const palavras = ['Senku', 'liga', 'o', 'radio.', 'Todos', 'ouvem.', 'Chrome', 'corre.', 'Fim', 'da', 'parte.']
const TRANSCRIPT: Transcript = {
  source: 'script',
  words: palavras.map((text, i) => ({ text, start: 0.2 + i * 1.05, end: 0.2 + i * 1.05 + 0.8 })),
  segments: [],
  text: palavras.join(' '),
  cutCandidates: [],
  alinhado: true,
}
const RECAP: RecapNoProjeto = {
  versao: 1,
  rascunhoId: 'rc_25d63d4babd6_mv7cxp1z',
  episodioId: `ep_${'a'.repeat(40)}`,
  takeId: 't1',
  roteiroVersao: 3,
  vozAlinhada: true,
  geradoEm: '2026-10-14T18:00:00.000Z',
  secoes: [
    { id: 's1', papel: 'gancho', inicio: 0, fim: 6, frases: [{ id: 'f01', inicio: 0, fim: 6, personagens: ['Senku', 'Kohaku'] }] },
    { id: 's2', papel: 'climax', inicio: 6, fim: 12, frases: [{ id: 'f02', inicio: 6, fim: 12, personagens: ['Chrome'] }] },
  ],
}
const TRILHA_DELE = {
  id: 'dele',
  path: 'C:/meus/ambiente.wav',
  fileName: 'ambiente.wav',
  faixa: 0,
  at: 2,
  durationSec: 5,
  inicioSec: 0,
  usarSec: null,
  gainDb: -8,
  fadeInSec: 0,
  fadeOutSec: 0,
  peaks: [],
  rms: [],
  url: 'http://127.0.0.1/a/amb',
}

async function main(): Promise<void> {
  // Depois da janela falsa: o store le o window.dangai ao carregar.
  const { useProject } = await import('../../../src/store/project')
  const { desfazer, podeDesfazer, refazer, startUndo } = await import('../../../src/store/undo')
  const { criarNucleo } = await import('../../../src/modulos/nucleo')
  const { semSujar } = await import('../../../src/store/quiet')
  const { guardarNucleo } = await import('../src/nucleo')
  const { edicaoRapidaNoProjeto, registrarMusicaDoProjeto, SO_A_MUSICA } = await import('../src/store/edicao-rapida')
  const { converterOAberto, rotuloDoClipe } = await import('../src/projeto')
  const { papelDaSobreposicao, papelDaTrilha, recapDoProjeto } = await import('../shared/projeto-do-recap')
  guardarNucleo(criarNucleo('recap'))
  const { planEqualSplit } = await import('@shared/plan')

  const carregar = (): void => {
    const plano = planEqualSplit(4, 12)
    plano.scenes = plano.scenes.map((s, i) => ({ ...s, sourceStart: 1 + i }))
    useProject.setState({
      audio: AUDIO,
      images: [
        imagem(1, 'video', { x: 0.5, y: 0.5, auto: false }),
        imagem(2, 'video', { x: 0.3, y: 0.5, auto: true }),
        imagem(3, 'video', { x: 0.2, y: 0.7, auto: false }),
        imagem(4, 'image', { x: 0.5, y: 0.5, auto: false }),
      ],
      plan: plano,
      transcript: TRANSCRIPT,
      modulos: { recap: RECAP },
      projectPath: 'C:/proj/teste.dangai',
      formato: 'short',
      fontes: [{ nome: 'Minha Fonte', url: 'http://127.0.0.1/f/minha' }],
      trilhas: [TRILHA_DELE],
      sobreposicoes: [],
      busy: null,
      error: null,
      projectDirty: false,
    })
  }
  const porPapel = (p: string) => useProject.getState().trilhas.filter((t) => papelDaTrilha(t) === p)

  carregar()
  const pararUndo = startUndo()

  secao('1. Edicao rapida inteira')
  const antes = useProject.getState()
  const resumo = await edicaoRapidaNoProjeto(CONFIG_DA_EDICAO_RAPIDA_PADRAO)
  const depois = useProject.getState()
  confere(resumo !== null && resumo.whoosh === 1 && resumo.impacto === 1 && resumo.musica === 'Afternoon.mp3' && resumo.legenda, 'resumo: 1 whoosh, 1 impacto, musica, legenda')
  confere(resumo?.rostos?.comRosto === 3 && resumo.rostos.total === 3 && resumo.rostos.fonte === 'lbp', 'rosto: 3 de 3 pedidos pelo detector antigo')
  const pedido = ultima('planejarSom')?.[0] as PedidoDePlanoDeSom
  confere(JSON.stringify(pedido.cortes) === JSON.stringify([0, 3, 6, 9]) && pedido.duracaoSec === 12, 'pedido de som: os cortes dos blocos e a duracao da voz')
  confere(pedido.secoes.length === 2 && pedido.secoes[0]!.papel === 'gancho' && pedido.secoes[1]!.inicio === 6, 'pedido de som: as partes de modulos.recap.secoes')
  confere(depois.trilhas.find((t) => t.id === 'dele') === antes.trilhas[0], 'a trilha DELE ficou (a mesma referencia)')
  const [musica, whoosh, impacto] = [porPapel('musica'), porPapel('whoosh'), porPapel('impacto')]
  confere(musica.length === 1 && whoosh.length === 1 && impacto.length === 1, 'entrou 1 musica, 1 whoosh, 1 impacto')
  confere(musica[0]!.faixa === 1 && whoosh[0]!.faixa === 2 && impacto[0]!.faixa === 3, 'uma faixa por papel, depois da dele')
  confere(
    [...musica, ...whoosh, ...impacto].every((t) => (t.modulos as { recap?: { papel?: string } } | undefined)?.recap?.papel !== undefined && !('papel' in t)),
    'o papel mora em modulos.recap do trecho (nada de `papel` solto)',
  )
  confere([...musica, ...whoosh, ...impacto].every((t) => t.url.startsWith('http://') && t.peaks.length > 0), 'url e onda prontas')
  confere(musica[0]!.ducking?.abaixoDb === 6 && musica[0]!.fadeInSec > 0, 'musica com o ducking do nucleo (trilha.ducking) e fades')
  const lote = ultima('rostosDosPedacos')?.[0] as LoteDeRostos
  confere(lote.pedidos.length === 3 && !lote.pedidos.some((p) => p.arquivo.includes('/3.mp4')), 'rosto: 3 pedidos, o bloco com foco DELE ficou de fora')
  const p1 = lote.pedidos.find((p) => p.arquivo.endsWith('/1.mp4'))!
  confere(p1.de === 1 && p1.ate === 4 && p1.personagens.join() === 'Senku,Kohaku', 'pedido do bloco 1: o trecho e quem a frase cita')
  const [i1, , i3] = depois.images
  confere(i1!.focusX === 0.8 && i1!.focusAuto && i1!.url === 'http://127.0.0.1/recorte/img-1', 'bloco 1 enquadrado, com o recorte novo')
  confere(i3 === antes.images[2], 'bloco 3 (foco dele) intocado')
  confere(depois.captionColor === ESTILO.color && depois.captionY === ESTILO.y && depois.captionStroke === ESTILO.stroke, 'legenda no estilo salvo')
  confere(depois.captionFont?.nome === 'Minha Fonte', 'fonte pelo nome (a troca programatica do nucleo)')
  const cor = depois.sobreposicoes.filter((o) => papelDaSobreposicao(o) === 'cor')
  confere(cor.length === 1 && cor[0]!.tipo === 'ajuste' && cor[0]!.at === 0 && !('papel' in cor[0]!), 'camada de cor: ajuste no video inteiro, papel em modulos.recap')
  confere(rotuloDoClipe({ tipo: 'video', clipe: cor[0]! }) === 'Cor: Anime vivo', 'rotulo da camada na linha do tempo')
  confere(resumo?.aplicou === true && resumo.cor === 'Anime vivo', 'o resumo sabe que aplicou, com o look')
  confere(quantas('registrarMusicaUsada') === 0, 'aplicar NAO registra a musica')
  registrarMusicaDoProjeto(useProject.getState())
  const reg = ultima('registrarMusicaUsada')
  confere(reg?.[0] === MUSICAS[0] && reg?.[1] === 'C:/proj/teste.dangai', 'ao salvar/renderizar: a musica que o projeto TEM')

  secao('2. Um passo de Ctrl+Z')
  await esperar(500)
  confere(podeDesfazer(), 'ha o que desfazer')
  desfazer()
  const desfeito = useProject.getState()
  confere(
    desfeito.trilhas === antes.trilhas &&
      desfeito.images === antes.images &&
      desfeito.sobreposicoes === antes.sobreposicoes &&
      desfeito.captionColor === antes.captionColor &&
      desfeito.captionFont === antes.captionFont,
    'desfazer: trilhas, imagens, cor e legenda voltam (as mesmas referencias)',
  )
  confere(!podeDesfazer(), 'e nao sobra outro passo: a Edicao rapida inteira era UM')
  refazer()
  confere(useProject.getState().trilhas === depois.trilhas && useProject.getState().captionColor === ESTILO.color, 'refazer traz tudo de volta')

  secao('3. Rodar de novo')
  await esperar(500)
  const r2 = await edicaoRapidaNoProjeto(CONFIG_DA_EDICAO_RAPIDA_PADRAO)
  const p2 = ultima('planejarSom')?.[0] as PedidoDePlanoDeSom
  confere(JSON.stringify(p2.evitarMusicas) === JSON.stringify([MUSICAS[0]]), 'evita a musica que o projeto ja tem')
  confere(r2?.musica === 'Galactico.m4a' && porPapel('musica').every((t) => t.path === MUSICAS[1]), 'a musica trocou')
  confere(useProject.getState().trilhas.filter((t) => papelDaTrilha(t)).length === 3 && useProject.getState().trilhas.some((t) => t.id === 'dele'), 'so as dela foram trocadas')
  confere(porPapel('whoosh').every((t) => t.faixa === 2), 'as faixas continuam as mesmas')
  const cor2 = useProject.getState().sobreposicoes.filter((o) => papelDaSobreposicao(o) === 'cor')
  confere(cor2.length === 1 && cor2[0]!.id === cor[0]!.id, 'a camada de cor intacta foi trocada no lugar (a mesma)')

  secao('4. So a musica, escolhida no dialogo')
  await esperar(500)
  const sfxAntes = useProject.getState().trilhas.filter((t) => papelDaTrilha(t) === 'whoosh' || papelDaTrilha(t) === 'impacto')
  const reframes = quantas('reframeImage')
  const r3 = await edicaoRapidaNoProjeto(SO_A_MUSICA, { musicaForcada: 'C:/outra/Escolhida.mp3' })
  confere(r3?.musica === 'Escolhida.mp3' && porPapel('musica').every((t) => t.path === 'C:/outra/Escolhida.mp3'), 'a musica e a escolhida')
  confere(sfxAntes.every((t) => useProject.getState().trilhas.includes(t)) && quantas('reframeImage') === reframes, 'os SFX e as imagens ficaram')

  secao('5. O som falha / pasta sem musica / nada muda')
  await esperar(500)
  respostas.somOk = false
  const trilhasAntes = useProject.getState().trilhas
  const r4 = await edicaoRapidaNoProjeto(CONFIG_DA_EDICAO_RAPIDA_PADRAO)
  confere(useProject.getState().trilhas === trilhasAntes && r4 !== null && r4.avisos.includes('Sem som: ffmpeg sumiu') && r4.legenda, 'som falhou: trilhas iguais, o resto rodou, aviso')
  respostas.somOk = true
  respostas.semMusica = true
  await esperar(500)
  const r5 = await edicaoRapidaNoProjeto(SO_A_MUSICA)
  confere(porPapel('musica').every((t) => t.path === 'C:/outra/Escolhida.mp3') && r5?.musicaMantida === 'Escolhida.mp3', 'pasta sem musica: a que estava fica')
  confere(r5?.aplicou === false, 'nada mudou: aplicou false')
  respostas.semMusica = false
  await esperar(500)
  const foto = useProject.getState()
  const r5b = await edicaoRapidaNoProjeto({ sfx: false, musica: false, rosto: true, legenda: true, cor: true })
  await esperar(500)
  confere(r5b?.aplicou === false && useProject.getState().images === foto.images && useProject.getState().sobreposicoes === foto.sobreposicoes, 'rosto, legenda e cor iguais: nenhum passo')

  secao('6. Foco mexido a mao enquanto roda')
  pararUndo()
  carregar()
  const rodando = edicaoRapidaNoProjeto({ sfx: false, musica: false, rosto: true, legenda: false, cor: false })
  useProject.getState().setImageFocus('img-1', 0.1, 0.9)
  await rodando
  const s6 = useProject.getState()
  confere(s6.images[0]!.focusX === 0.1 && s6.images[0]!.focusY === 0.9 && !s6.images[0]!.focusAuto, 'o foco que ele pos no meio ficou')
  confere(s6.images[1]!.focusAuto && Math.abs(s6.images[1]!.focusX - 0.7) < 1e-9, 'os outros blocos foram enquadrados')

  secao('7. Ocupado ou sem narracao')
  const n = chamadas.length
  useProject.setState({ busy: 'Analisando...' })
  confere((await edicaoRapidaNoProjeto(CONFIG_DA_EDICAO_RAPIDA_PADRAO)) === null && chamadas.length === n, 'busy: nada roda, nenhum IPC')
  useProject.setState({ busy: null, audio: null })
  confere((await edicaoRapidaNoProjeto(CONFIG_DA_EDICAO_RAPIDA_PADRAO)) === null && chamadas.length === n, 'sem narracao: nada roda')

  secao('8. Projeto do Studio convertido ao abrir')
  carregar()
  const pararUndo8 = startUndo()
  // Como o zod do projeto deixa: o ajuste inteiro (os campos com padrao preenchidos).
  const { ANIME_VIVO } = await import('../shared/edicao-rapida')
  const { studio: _s, ...recapSemVersao } = { studio: 1, ...RECAP }
  const { versao: _v, ...origem } = recapSemVersao
  // Como o openProject deixa: o `studio` nos extras da raiz, `papel`/`corOriginal` soltos nos itens.
  await semSujar(async () => {
    useProject.setState({
      modulos: {},
      extrasDoProjeto: { studio: origem },
      transcriptTravado: false,
      transcript: { ...TRANSCRIPT, alinhado: false },
      trilhas: [
        TRILHA_DELE,
        { ...TRILHA_DELE, id: 'm1', path: 'C:/musicas/Velha.mp3', fileName: 'Velha.mp3', faixa: 1, papel: 'musica', ducking: DUCKING_PADRAO } as typeof TRILHA_DELE,
      ],
      sobreposicoes: [
        {
          id: 'c1', path: '', fileName: 'Cor: Anime vivo', tipo: 'ajuste', faixa: 0, at: 0, durationSec: 3600, inicioSec: 0, usarSec: 12,
          x: 0, y: 0, escala: 1, opacidade: 1, aspecto: 16 / 9, rotacao: 0, efeito: 'nenhum', intensidade: 0.1,
          curva: MOTION_CURVE_DEFAULT, pontosDaCurva: null, cor: ANIME_VIVO, espelhar: false,
          fadeInSec: 0, fadeOutSec: 0, papel: 'cor', corOriginal: ANIME_VIVO, url: '',
        } as never,
      ],
    })
  })
  confere(converterOAberto(), 'converteu')
  const s8 = useProject.getState()
  const r8 = recapDoProjeto(s8.modulos)
  confere(r8?.versao === 1 && r8.vozAlinhada && r8.secoes?.length === 2, 'modulos.recap com versao 1, vozAlinhada e as secoes')
  confere(s8.transcriptTravado && s8.transcript?.alinhado === true, 'vozAlinhada: a transcricao travada pelo nucleo')
  confere(s8.trilhas.every((t) => !('papel' in t)) && papelDaTrilha(s8.trilhas[1]!) === 'musica' && s8.trilhas[1]!.ducking?.abaixoDb === 6, 'o papel da musica foi para modulos.recap; o ducking fica no nucleo')
  const c8 = s8.sobreposicoes[0]!
  confere(papelDaSobreposicao(c8) === 'cor' && !('corOriginal' in c8) && (c8.modulos as { recap?: { corOriginal?: unknown } }).recap?.corOriginal !== undefined, 'papel e corOriginal da camada em modulos.recap')
  confere(!converterOAberto(), 'abrir de novo: nada a converter')
  await esperar(500)
  const r8b = await edicaoRapidaNoProjeto({ sfx: false, musica: true, rosto: false, legenda: false, cor: true })
  const s8b = useProject.getState()
  confere(
    s8b.trilhas.filter((t) => papelDaTrilha(t) === 'musica').length === 1 && s8b.trilhas.every((t) => t.path !== 'C:/musicas/Velha.mp3') && s8b.trilhas.some((t) => t.id === 'dele'),
    'a Edicao rapida reconhece a musica dele (trocou so ela)',
  )
  confere(s8b.sobreposicoes.length === 1 && s8b.sobreposicoes[0]!.id === 'c1' && r8b?.cor === 'Anime vivo', `e reconhece a camada de cor intacta (trocada no lugar) ${r8b?.corMantida ?? ''}`)
  pararUndo8()
}

main()
  .then(() => {
    console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
    process.exit(falhas === 0 ? 0 : 1)
  })
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
