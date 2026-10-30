/**
 * [thumb] O MODULO THUMBNAIL sem app e sem navegador (o editor em si -- o
 * preset, a geometria, o enquadramento -- e o v-thumb do recap, que usa o
 * mesmo codigo):
 *
 * - o plano (shared/plano.ts): a cena de origem no instante, com o trecho dela
 *   no arquivo; as cenas sem gancho fora do recap; o trecho do "Quadro dentro
 *   da cena" (alargado para conter o instante; imagem do PC nao tem);
 * - a config: o preset do editor solto vai e volta, sem as imagens;
 * - o main (electron/editor.ts): o render do projeto ao lado da narracao (o
 *   mais novo), as cenas espalhadas, as sugestoes SEM motor (rosto null, a
 *   nitidez medida, o trecho junto), o quadro rapido em JPEG pequeno, o fps,
 *   o salvar onde ele escolheu (so .png 1080x1920) e o motor emprestado
 *   (sem o recap: o motivo);
 * - a loja do editor (src/editor/loja.ts) com uma fonte falsa: o "Quadro
 *   dentro da cena" (arrastando so a previa troca; soltando, o instante novo
 *   fica guardado, o rosto e procurado de novo, o enquadramento automatico se
 *   refaz e o da mao fica);
 * - a tela (SSR): o editor solto e o do projeto, em ASCII.
 *
 * Rodar da raiz:
 *   npx esbuild modulos/thumb/teste/v-thumb-modulo.ts --bundle --platform=node --packages=external --jsx=automatic --tsconfig=tsconfig.web.json --define:import.meta.env.DEV=false --loader:.ttf=empty --log-level=error | node
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
const ascii = (s: string): boolean => [...s].every((c) => c.charCodeAt(0) < 128)
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const PLANO = {
  images: [{ path: 'C:/ep/0360.mp4' }, { path: 'C:/ep/0367.mp4' }, { path: 'C:/ep/0335.mp4' }, { path: 'C:/ep/0336.mp4' }],
  plan: {
    scenes: [
      { imageIndex: 0, imageIndexB: null, start: 0, end: 1.85, sourceStart: 0 },
      { imageIndex: 1, imageIndexB: null, start: 1.85, end: 2.7, sourceStart: 0.25 },
      { imageIndex: 2, imageIndexB: 3, start: 2.7, end: 5, sourceStart: 0.5, sourceStartB: 1 },
    ],
  },
}

async function principal(): Promise<void> {
  const P = await import('../shared/plano')
  const T = await import('../shared/thumb')
  const D = await import('../shared/pedidos')

  console.log('\n== o plano e o trecho da cena')
  const c = P.cenaNoInstante(PLANO, 3.2)
  confere(
    c?.a.arquivo.endsWith('0335.mp4') === true && Math.abs(c.a.de - 0.5) < 1e-9 && Math.abs(c.a.ate - 2.8) < 1e-9 && Math.abs((c.b?.de ?? 0) - 1) < 1e-9,
    'no grid: cada metade com o trecho dela no arquivo (sourceStart + a duracao da cena)',
  )
  const cenas = P.cenasDoPlano(PLANO, null)
  confere(cenas.length === 4 && cenas.every((x) => !x.gancho), 'fora do recap: as cenas do plano, nenhuma do gancho')
  confere(Math.abs(P.duracaoDoPlano(PLANO) - 5) < 1e-9, 'a duracao do plano: o fim da ultima cena')
  const tr = T.trechoDoQuadro({ origem: 'cena', t: 2.1, trecho: { de: 0.5, ate: 1.8 } })
  confere(tr?.de === 0.5 && tr.ate === 2.1, 'o trecho alarga para conter o instante (o keyframe fora do trecho mostrado)')
  confere(T.trechoDoQuadro({ origem: 'arquivo', t: 0, trecho: { de: 0, ate: 3 } }) === null, 'imagem do PC: sem "Quadro dentro da cena"')
  confere(T.imagemDaThumbSchema.safeParse({ origem: 'cena', arquivo: 'a.mp4', t: 1, largura: 10, altura: 10, rostos: null, enquadramento: null }).success, 'thumb antiga (sem trecho) continua valendo')

  console.log('\n== o preset do editor solto')
  const base = T.thumbPadrao(null)
  const mexida = { ...base, linhas: ['cancelou', 'encontro'] as [string, string], cores: ['#ffffff', '#a654f2'] as [string, string], fonte: 'anton' as const, textoY: 0.4, seta: { ligada: false, base: null, ponta: null } }
  const preset = D.presetDe(mexida)
  const volta = D.thumbDoPreset(preset, T.thumbPadrao(null))
  confere(volta.linhas.join('|') === 'cancelou|encontro' && volta.fonte === 'anton' && volta.textoY === 0.4 && !volta.seta.ligada && volta.imagens.every((i) => i === null), 'o preset volta com texto, cores, fonte, altura e seta -- e nunca as imagens')
  confere(D.configDaThumbSchema.safeParse({ versao: 1, preset }).success && !D.configDaThumbSchema.safeParse({ versao: 1, preset: { ...preset, fonte: 'comic' } }).success, 'a config confere o preset')

  console.log('\n== o texto longo')
  const medir = (texto: string, px: number) => ({ largura: texto.length * px * 0.58, cap: px * 0.7 })
  // As 4 combinacoes: cada linha na altura real dela, sem o contorno de uma invadir as letras da outra, o bloco no meio da altura.
  for (const linhas of [['ele despertou o maior poder', 'supremo'], ['poder', 'surpreendentemente'], ['inacreditavelmente', 'surpreendentemente'], ['poder', 'supremo']] as [string, string][]) {
    const g = T.geometriaDaThumb({ layout: 'duas', linhas, textoY: 0.5 }, medir)
    const [a, b] = g.linhas
    const topoB = b!.base - b!.cap
    const semInvadir = topoB - b!.contorno >= a!.base - 0.01 && a!.base + a!.contorno <= topoB + 0.01
    const menor = Math.min(a!.cap, b!.cap)
    const encostado = topoB - a!.base <= Math.max(menor * T.VAO_ENTRE_LINHAS, a!.contorno, b!.contorno) + 0.01
    const meio = Math.abs((g.bloco!.topo + g.bloco!.base) / 2 - 0.5 * T.ALTURA) < 0.01
    confere(semInvadir && encostado && meio, `posicoes "${linhas.join(' / ')}": linha 2 logo abaixo da 1 (vao ${(topoB - a!.base).toFixed(1)} px), contornos sem invadir, bloco no meio`)
  }
  const duasGrandes = T.geometriaDaThumb({ layout: 'duas', linhas: ['poder', 'supremo'], textoY: null }, medir)
  confere(Math.abs(duasGrandes.linhas[1]!.base - duasGrandes.linhas[1]!.cap - duasGrandes.linhas[0]!.base - duasGrandes.linhas[0]!.cap * T.VAO_ENTRE_LINHAS) < 1e-9, 'as duas grandes: o vao das refs, igual a antes')
  for (const linhas of [['poder', 'surpreendentemente'], ['inacreditavelmente', 'surpreendentemente'], ['ele despertou o maior poder', 'supremo']] as [string, string][]) {
    const t = { ...T.thumbPadrao(null), linhas }
    const ef = T.thumbEfetiva(t, medir)
    const cabem = ef.geo.linhas.every((l) => l.largura + 2 * l.contorno <= T.LARGURA * T.LARGURA_UTIL + 0.5)
    const proporcional = ef.geo.linhas.every((l) => Math.abs(l.contorno / l.px - T.CONTORNO_POR_PX) < 1e-9)
    const pequenas = ef.geo.linhas.filter((l) => l.px < T.CORPO_LEGIVEL).map((l) => `${l.linha + 1}:${Math.round(l.px)}px`)
    const curtas = ef.geo.linhas.filter((l) => l.texto.length <= 7).every((l) => l.px === T.CORPO_PX)
    const b = ef.seta!.base
    const naLinha = ef.geo.linhas.some((l) => b.y >= l.base - l.cap - l.contorno && b.y <= l.base + l.contorno && Math.abs(b.x - T.LARGURA / 2) < l.largura / 2 + l.contorno)
    confere(cabem && proporcional && curtas && pequenas.length > 0 && !naLinha, `"${linhas.join(' / ')}": so a longa encolhe (${pequenas.join(', ')}), cabe com margem, contorno proporcional, a cauda da seta fora do texto`)
  }

  console.log('\n== as fontes (pela tinta medida)')
  // Fontes falsas com a tinta em lugares diferentes: subindo mais ou menos, descendo, puxada para um lado (a Komika inclinada).
  const FALSAS = {
    luckiest: { sobe: 0.7, desce: 0.012, esq: 2, larg: 0.58 },
    bangers: { sobe: 0.75, desce: 0.006, esq: -6, larg: 0.45 },
    anton: { sobe: 0.86, desce: 0.006, esq: 1, larg: 0.5 },
    komika: { sobe: 0.88, desce: 0.04, esq: -14, larg: 0.62 },
  } as const
  const centros: number[] = []
  for (const [fonte, f] of Object.entries(FALSAS) as [keyof typeof FALSAS, (typeof FALSAS)[keyof typeof FALSAS]][]) {
    const medirF = (texto: string, px: number) => ({ largura: texto.length * px * f.larg, cap: px * f.sobe, desce: px * f.desce, esquerda: f.esq * (px / 182), direita: texto.length * px * f.larg - f.esq * (px / 182) + 10 * (px / 182) })
    const g = T.geometriaDaThumb({ layout: 'duas', linhas: ['poder', 'supremo'], textoY: 0.5, fonte }, medirF)
    const [a, b] = g.linhas
    const vao = b!.base - b!.cap - (a!.base + a!.desce)
    const esperado = Math.max(Math.min(a!.cap, b!.cap) * T.VAO_ENTRE_LINHAS, a!.contorno, b!.contorno)
    const centrada = g.linhas.every((l) => {
      const m = medirF(l.texto, l.px)
      return Math.abs(l.x + (m.direita - m.esquerda) / 2 - T.LARGURA / 2) < 0.01
    })
    centros.push((g.bloco!.topo + g.bloco!.base) / 2)
    confere(Math.abs(vao - esperado) < 0.01 && centrada && a!.esticada === T.AJUSTE_DA_FONTE[fonte].esticada, `${fonte}: empilhada pela tinta (vao ${vao.toFixed(1)} px), a tinta no meio da largura, esticada ${a!.esticada}`)
  }
  confere(centros.every((c) => Math.abs(c - 0.5 * T.ALTURA) < 0.01), 'com qualquer fonte, o bloco das letras no mesmo lugar do slider')
  confere(T.AJUSTE_DA_FONTE.luckiest.esticada === T.ESTICADA_Y && T.AJUSTE_DA_FONTE.anton.esticada === 1, 'a esticada 1,11 so na Luckiest Guy (a tabela por fonte)')

  await testarMain()
  await testarLoja()
  await testarTela()

  console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`)
  if (falhas > 0) process.exit(1)
}

async function testarMain(): Promise<void> {
  console.log('\n== o main (electron/editor.ts)')
  const pasta = mkdtempSync(join(tmpdir(), 'dangai-v-thumb-modulo-'))
  try {
    const M = await import('../electron/editor')
    const { motivoSemMotor, emprestarMotorDeRostos } = await import('../electron/motor')
    const sharp = (await import('sharp')).default
    const { ffmpegPath } = await import('../../../electron/services/ffmpeg-path')

    // O render ao lado da narracao: o mais novo dos -short*.mp4.
    const audio = join(pasta, 'Meu video.wav')
    writeFileSync(audio, 'x')
    confere(M.videoDoProjeto(audio, null) === null, 'sem render: nenhum video')
    writeFileSync(join(pasta, 'Meu video-short.mp4'), 'a')
    writeFileSync(join(pasta, 'Meu video-short-2.mp4'), 'b')
    writeFileSync(join(pasta, 'Outro-short.mp4'), 'c')
    utimesSync(join(pasta, 'Meu video-short.mp4'), new Date(2026, 0, 1), new Date(2026, 0, 1))
    confere(M.videoDoProjeto(audio, null) === join(pasta, 'Meu video-short-2.mp4'), 'o render mais novo da narracao (nunca o de outro projeto)')
    confere(M.videoDoProjeto(audio, join(pasta, 'Outro-short.mp4')) === join(pasta, 'Outro-short.mp4'), 'o ultimo render da sessao vale antes')
    confere(M.espalhar([...Array(100).keys()], 10).join(',') === '0,10,20,30,40,50,60,70,80,90' && M.espalhar([1, 2], 10).length === 2, 'as cenas espalhadas pelo video inteiro')

    const video = join(pasta, 'cena.mp4')
    spawnSync(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=854x480:rate=24:duration=2', '-pix_fmt', 'yuv420p', video], { windowsHide: true })
    const imagem = join(pasta, 'quadro.png')
    await sharp({ create: { width: 854, height: 480, channels: 3, background: { r: 200, g: 40, b: 60 } } }).png().toFile(imagem)

    // Sem o recap no app: nenhum motor emprestado.
    emprestarMotorDeRostos(null)
    confere((motivoSemMotor() ?? '').includes('Gerar recap'), 'sem o recap: o motivo diz de onde vem o motor')
    const editor = M.criarEditorNoMain({ pasta: () => join(pasta, 'cache'), rotulo: '[teste]', motor: () => null, antigo: null })
    const q = await editor.quadroDaThumb({ arquivo: video, t: 1 })
    confere(q.fps === 24 && q.largura === 854, 'o quadro cheio traz o fps do video (as setas andam 1 quadro)')
    confere((await editor.quadroDaThumb({ arquivo: imagem, t: 0 })).fps === undefined, 'imagem: sem fps')
    const rapido = await M.quadroRapido(video, 1.5)
    const mr = await sharp(Buffer.from(rapido)).metadata()
    confere(rapido[0] === 0xff && rapido[1] === 0xd8 && mr.width === 480, 'o quadro rapido: JPEG de 480 px, sem cache')
    const r = await editor.rostosDasImagens([imagem])
    confere(r.rostos.get(imagem) === null && r.detector === null, 'sem motor: rosto null (a imagem fica no meio), nunca o detector antigo')
    const sug = await editor.sugestoesDasCenas(
      [
        { arquivo: video, de: 0.2, ate: 1.8, ordem: 0, gancho: false },
        { arquivo: imagem, de: 0, ate: 1, ordem: 1, gancho: false },
      ],
      { medirNitidez: true },
    )
    confere(sug.sugestoes.length === 2 && sug.sugestoes.every((s) => s.rostos === null && !s.gancho && ascii(s.rotulo)), 'as sugestoes sem motor: sem rosto e sem gancho')
    confere(sug.sugestoes.find((s) => s.arquivo === video)?.trecho?.de === 0.2, 'cada sugestao leva o trecho da cena')
    const nitida = await M.nitidezDaImagem(imagem)
    const borrada = join(pasta, 'borrada.png')
    await sharp(video.replace('cena.mp4', 'quadro.png')).blur(8).toFile(borrada)
    const detalhe = join(pasta, 'detalhe.png')
    spawnSync(ffmpegPath, ['-v', 'error', '-ss', '1', '-i', video, '-frames:v', '1', detalhe], { windowsHide: true })
    const nd = await M.nitidezDaImagem(detalhe)
    const nb = await M.nitidezDaImagem(borrada)
    confere(nd !== null && nb !== null && nd > nb && nitida !== null, `a nitidez: o quadro com detalhe mede mais que o borrado (${nd?.toFixed(0)} > ${nb?.toFixed(0)})`)

    // Emprestado e pronto: o editor usa o detector dele.
    emprestarMotorDeRostos({ motivoParaNaoRodar: () => null, detector: async () => null, encerrar: () => {} })
    confere(motivoSemMotor() === null, 'com o motor emprestado e instalado: roda')
    emprestarMotorDeRostos({ motivoParaNaoRodar: () => 'O motor de personagens nao esta instalado.', detector: async () => null, encerrar: () => {} })
    confere(motivoSemMotor() === 'O motor de personagens nao esta instalado.', 'emprestado mas sem runtime: o motivo do recap')

    console.log('\n== o salvar onde ele escolheu')
    const png = new Uint8Array(await sharp({ create: { width: 1080, height: 1920, channels: 4, background: '#123456' } }).png().toBuffer())
    const destino = join(pasta, 'saida', 'minha-thumb.png')
    mkdirSync(join(pasta, 'saida'))
    confere((await M.salvarPngEm(destino, png)) === destino && existsSync(destino), 'grava no caminho do dialogo')
    const errado = await M.salvarPngEm(join(pasta, 'saida', 'x.jpg'), png).then(
      () => '',
      (e: Error) => e.message,
    )
    const pequeno = new Uint8Array(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer())
    const torto = await M.salvarPngEm(join(pasta, 'saida', 'p.png'), pequeno).then(
      () => '',
      (e: Error) => e.message,
    )
    confere(errado.includes('.png') && torto.includes('1080x1920'), 'so .png e so 1080x1920')
    confere(readFileSync(destino).length === png.length, 'o PNG inteiro')
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

async function testarLoja(): Promise<void> {
  console.log('\n== a loja: o "Quadro dentro da cena"')
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  let fechados = 0
  Reflect.set(globalThis, 'createImageBitmap', async () => ({ width: 480, height: 270, close: () => (fechados += 1) }))
  Reflect.set(globalThis, 'URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }))
  const { criarLojaDoEditor } = await import('../src/editor/loja')
  const T = await import('../shared/thumb')
  const pedidos: { tipo: string; t: number }[] = []
  let guardada: unknown = null
  const ROSTO_A = { x: 0.4, y: 0.3, w: 0.15, h: 0.27, conf: 0.8 }
  const ROSTO_B = { x: 0.1, y: 0.35, w: 0.2, h: 0.3, conf: 0.8 }
  const L = criarLojaDoEditor({
    chave: () => 'teste',
    lerGuardada: () => null,
    padrao: () => T.thumbPadrao('poder supremo'),
    gravar: (t) => (guardada = JSON.parse(JSON.stringify(t))),
    quadro: async (p) => {
      pedidos.push({ tipo: 'quadro', t: p.t })
      return { ok: true, value: { largura: 854, altura: 480, previa: jpeg, fps: 24 } }
    },
    miniatura: async (p) => {
      pedidos.push({ tipo: 'miniatura', t: p.t })
      return { ok: true, value: jpeg }
    },
    rostos: async (p) => ({ ok: true, value: [p.t < 1 ? ROSTO_B : ROSTO_A] }),
    recorte: async () => ({ ok: false, error: 'nao' }),
    upscale: async () => ({ ok: true, value: true }),
    escolherArquivo: async () => null,
    podeSalvar: () => true,
    salvar: async () => ({ ok: true, value: null }),
  })
  await L.getState().iniciar()
  await L.getState().porImagem(
    { origem: 'cena', arquivo: 'C:/ep/0360.mp4', t: 1.5, largura: 854, altura: 480, rostos: [ROSTO_A], enquadramento: null, trecho: { de: 0, ate: 1.85 } },
    0,
  )
  await esperar(20)
  confere(L.getState().previas[0]?.fps === 24, 'o fps do quadro chega na previa (as setas)')
  const antes = pedidos.length
  L.getState().espiarInstante(0, 1.2)
  L.getState().espiarInstante(0, 1.0)
  L.getState().espiarInstante(0, 0.8)
  await esperar(30)
  const miniaturas = pedidos.slice(antes).filter((p) => p.tipo === 'miniatura')
  confere(miniaturas.length <= 2 && miniaturas.at(-1)?.t === 0.8, 'arrastando: uma miniatura por vez e so o ultimo instante')
  confere(L.getState().previas[0]?.espiando === 0.8 && L.getState().thumb!.imagens[0]!.t === 1.5, 'arrastando, so a previa troca: o projeto continua no quadro de antes')
  await L.getState().mudarInstante(0, 0.6)
  await esperar(20)
  const img = L.getState().thumb!.imagens[0]!
  confere(img.t === 0.6 && pedidos.at(-1)?.tipo === 'quadro', 'soltou: o quadro cheio e limpo do instante novo')
  confere(img.rostos?.[0]?.x === ROSTO_B.x && img.enquadramento === null, 'o rosto do quadro novo, e o enquadramento automatico se refaz por ele')
  L.getState().gravarPendente()
  confere((guardada as { imagens: { t: number }[] }).imagens[0]!.t === 0.6, 'o instante escolhido fica guardado')
  const aMao = { zoom: 2, cx: 0.45, cy: 0.4 }
  L.getState().enquadrar(0, aMao)
  await L.getState().mudarInstante(0, 1.4)
  await esperar(20)
  const depois = L.getState().thumb!.imagens[0]!
  confere(depois.t === 1.4 && JSON.stringify(depois.enquadramento) === JSON.stringify(aMao) && depois.rostos?.[0]?.x === ROSTO_A.x, 'ajustado a mao: o ajuste fica, so o rosto e o quadro mudam (os avisos dizem se saiu da area)')
  confere(fechados > 0, 'as miniaturas soltas fecham (sem vazar bitmap)')
}

async function testarTela(): Promise<void> {
  console.log('\n== a tela (SSR)')
  const blob = new Uint8Array([0xff, 0xd8])
  Reflect.set(globalThis, 'window', {
    devicePixelRatio: 1,
    dangai: {
      revealFile: async () => ({ ok: true, value: undefined }),
      modulos: {
        thumb: {
          quadro: async () => ({ ok: true, value: { largura: 854, altura: 480, previa: blob, fps: 24 } }),
          rostos: async () => ({ ok: true, value: null }),
          upscale: async () => ({ ok: true, value: true }),
          motor: async () => ({ ok: true, value: { pronto: false, motivo: 'O motor de personagens nao esta instalado.' } }),
          videoDoProjeto: async () => ({ ok: true, value: null }),
          sugestoes: async () => ({ ok: true, value: { sugestoes: [], detector: null } }),
        },
      },
    },
  })
  const estado = {
    projectPath: 'C:/proj/Normal.dangai',
    lastOutput: null,
    audio: { path: 'C:/proj/Normal.wav' },
    phase: () => 'editing',
    modulos: {} as Record<string, unknown>,
    ...PLANO,
  }
  const gravacoes: unknown[] = []
  const { guardarNucleo } = await import('../src/nucleo')
  guardarNucleo({
    ler: () => estado,
    usar: <T,>(sel: (s: typeof estado) => T) => sel(estado),
    lerDoProjeto: () => estado.modulos['thumb'],
    gravarNoProjeto: (d: unknown) => {
      gravacoes.push(d)
      estado.modulos = { ...estado.modulos, thumb: d }
    },
    euMesmo: () => ({ config: { versao: 1, preset: null } }),
    telaCheia: () => {},
    assinar: () => () => {},
    haModalPorCima: () => false,
  } as never)
  const { useTela, useDoProjeto, useSolta } = await import('../src/store/tela')
  useTela.getState().abrir('projeto')
  await esperar(50)
  await useDoProjeto.getState().porImagem({ origem: 'video', arquivo: 'C:/ep/0335.mp4', t: 1, largura: 854, altura: 480, rostos: null, enquadramento: null, trecho: { de: 0.5, ate: 2.8 } }, 0)
  await esperar(30)
  useDoProjeto.getState().gravarPendente()
  const gravado = estado.modulos['thumb'] as { versao: number; thumb: unknown }
  confere(gravado?.versao === 1 && T_ok(gravado.thumb), 'modo projeto: a thumb fica em modulos.thumb do projeto (nunca no do recap)')
  confere(useDoProjeto.getState().thumb!.imagens[0]!.rostos === null, 'sem motor: a imagem entra sem rosto (no meio)')
  useTela.getState().abrir('solta')
  await esperar(30)
  confere(useSolta.getState().thumb!.imagens.every((i) => i === null), 'o editor solto abre vazio')

  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { JanelaDaThumb } = await import('../src/components/TelaDaThumb')
  for (const l of [useTela, useSolta, useDoProjeto]) Object.assign(l.getInitialState(), l.getState())
  const solta = renderToStaticMarkup(createElement(JanelaDaThumb))
  useTela.setState({ modo: 'projeto' })
  Object.assign(useTela.getInitialState(), useTela.getState())
  const projeto = renderToStaticMarkup(createElement(JanelaDaThumb))
  const texto = (h: string): string => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  for (const rotulo of ['Thumbnail', 'Imagens soltas', 'De um projeto', 'Escolher imagem...', 'Solte uma imagem aqui', 'Enquadramento automatico precisa do motor de personagens', 'Salvar PNG', 'Abrir pasta', 'Fechar', 'Linha 1', 'Seta vermelha apontando o rosto'])
    confere(texto(solta).includes(rotulo), `solta: "${rotulo}"`)
  for (const rotulo of ['Normal.dangai', 'Trocar projeto...', 'Sugestoes', 'Quadro do projeto', 'Do computador', 'Quadro dentro da cena', 'Sem render ainda'])
    confere(texto(projeto).includes(rotulo), `projeto: "${rotulo}"`)
  confere(ascii(texto(solta)) && ascii(texto(projeto)), 'os textos da tela em ASCII')
  void gravacoes
}

function T_ok(t: unknown): boolean {
  return typeof t === 'object' && t !== null && 'imagens' in t
}

principal().catch((e) => {
  console.error(e)
  process.exit(1)
})
