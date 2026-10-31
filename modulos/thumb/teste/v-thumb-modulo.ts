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
 * - o divisor e o tamanho do texto: desligado/100% por padrao (e nas thumbs
 *   salvas antes), salvos e lidos de volta, as camadas na ordem (imagens ->
 *   divisor -> seta e texto, com um canvas falso que anota), o recolorir dos
 *   PNGs de verdade sem mudar o alpha, e o tamanho com a largura como teto;
 * - a seta automatica sempre grande (a ref "PODER SUPREMO" como minimo): ao
 *   lado da 1a linha quando ha espaco, por cima do texto (a ref "FALTOU" do
 *   Faah) ou por tras dele (a ref "CANCELOU") quando nao ha, dentro do quadro e
 *   fora das faixas proibidas, a cabeca fora do texto e sem cobrir o rosto --
 *   com o texto reto e girado;
 * - a FORMA da seta: sempre a seta.png (so escala uniforme, giro e espelho,
 *   conferido por similaridade), a automatica e a arrastada;
 * - a rotacao do texto: guardada (as de antes = 0), cabe na largura girada, a
 *   caixa do bloco cobre o texto girado, o canvas gira e a sombra nao;
 * - a inclinacao da emenda: guardada (as de antes = 0), a mascara sem fundo nem
 *   lado trocado (rasterizada), cada imagem cobrindo o trapezio, o divisor
 *   girado de borda a borda e o rosto do lado certo da reta no x dele;
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

  await testarDivisoresETamanho(T, D)
  testarSeta(T)
  testarFormaDaSeta(T)
  await testarRotacao(T, D)
  await testarInclinacao(T, D)
  await testarCobrirEBarras(T)
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

    // As barras pretas embutidas saem do quadro em cache, do quadro rapido e do keyframe de fora.
    const comBarras = join(pasta, 'com-barras.png')
    const listras = Buffer.alloc(854 * 480 * 3)
    for (let y = 73; y < 407; y++) for (let x = 0; x < 854; x++) listras.fill((x * 3 + y * 5) % 200 + 40, (y * 854 + x) * 3, (y * 854 + x) * 3 + 3)
    await sharp(listras, { raw: { width: 854, height: 480, channels: 3 } }).png().toFile(comBarras)
    const semBarra = await sharp(await editor.quadroEmCache(comBarras, 0)).metadata()
    const qb = await editor.quadroDaThumb({ arquivo: comBarras, t: 0 })
    const rb = await sharp(Buffer.from(await M.quadroRapido(comBarras, 0))).metadata()
    const keyframe = await editor.imagemSemBarras(comBarras)
    const kb = await sharp(keyframe).metadata()
    confere(
      semBarra.width === 854 && semBarra.height === 334 && qb.altura === 334 && rb.width === 480 && Math.abs((rb.height ?? 0) - 188) <= 2 && keyframe !== comBarras && kb.height === 334,
      `com letterbox: o quadro em cache, a previa, o quadro rapido e o keyframe saem sem as barras (${semBarra.width}x${semBarra.height}, rapido ${rb.width}x${rb.height})`,
    )
    confere((await editor.imagemSemBarras(imagem)) === imagem, 'sem barra: o keyframe e ele mesmo (nada copiado)')

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

  // A MESMA imagem de novo no slot (soltar de novo): a previa nao recarrega, o tamanho e o rosto ficam.
  await L.getState().porImagem({ origem: 'arquivo', arquivo: 'C:/pc/a.png', t: 0, largura: 1920, altura: 1080, rostos: null, enquadramento: null }, 1)
  await esperar(20)
  const primeira = L.getState().thumb!.imagens[1]!
  const quadrosAntes = pedidos.filter((p) => p.tipo === 'quadro').length
  await L.getState().porImagem({ origem: 'arquivo', arquivo: 'C:/pc/a.png', t: 0, largura: 1920, altura: 1080, rostos: null, enquadramento: null }, 1)
  await esperar(20)
  const denovo = L.getState().thumb!.imagens[1]!
  confere(
    primeira.largura === 854 && denovo.largura === 854 && denovo.altura === 480 && denovo.rostos?.length === 1 && pedidos.filter((p) => p.tipo === 'quadro').length === quadrosAntes,
    'a mesma imagem de novo no slot: sem recarregar, fica com o tamanho medido e o rosto (o PNG recorta igual a previa)',
  )
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
  for (const rotulo of ['Thumbnail', 'Imagens soltas', 'De um projeto', 'Escolher imagem...', 'Solte uma imagem aqui', 'Enquadramento automatico precisa do motor de personagens', 'Salvar PNG', 'Abrir pasta', 'Fechar', 'Linha 1', 'Seta vermelha apontando o rosto', 'Tamanho', 'Divisor entre as imagens', 'Inclinacao da emenda', '= texto'])
    confere(texto(solta).includes(rotulo), `solta: "${rotulo}"`)
  for (const rotulo of ['Normal.dangai', 'Trocar projeto...', 'Sugestoes', 'Quadro do projeto', 'Do computador', 'Quadro dentro da cena', 'Sem render ainda'])
    confere(texto(projeto).includes(rotulo), `projeto: "${rotulo}"`)
  confere(ascii(texto(solta)) && ascii(texto(projeto)), 'os textos da tela em ASCII')
  void gravacoes
}

async function testarDivisoresETamanho(T: typeof import('../shared/thumb'), D: typeof import('../shared/pedidos')): Promise<void> {
  console.log('\n== o divisor')
  const padrao = T.thumbPadrao('PODER SUPREMO')
  const medir = (texto: string, px: number) => ({ largura: texto.length * px * 0.58, cap: px * 0.7 })
  confere(padrao.divisor.ligado === false && T.thumbEfetiva(padrao, medir).divisor === null, 'o padrao: divisor DESLIGADO (as thumbs de antes nao mudam)')
  // Uma thumb gravada antes do divisor e do tamanho: abre com os dois no padrao.
  const { tamanho: _t, divisor: _d, ...antiga } = padrao
  const lida = T.thumbDoProjeto(JSON.parse(JSON.stringify(antiga)))
  confere(lida !== null && lida.tamanho === 1 && lida.divisor.ligado === false && lida.divisor.modelo === 'rasgo-brilho' && lida.divisor.cor === null, 'thumb salva antes (sem divisor e sem tamanho): abre com 100% e divisor desligado')
  const ligado = { ...padrao, divisor: { ligado: true, modelo: 'slash' as const, cor: '#2fb4ff', contorno: true, inclinacao: -6 }, tamanho: 1.3 }
  const volta = T.thumbDoProjeto(JSON.parse(JSON.stringify(ligado)))
  confere(volta !== null && JSON.stringify(volta.divisor) === JSON.stringify(ligado.divisor) && volta.tamanho === 1.3, 'o estado (ligado, modelo, cor, tamanho) e salvo e lido de volta')
  confere(T.thumbDoProjeto({ ...ligado, divisor: { ...ligado.divisor, modelo: 'raio' } }) === null && T.thumbDoProjeto({ ...ligado, tamanho: 3 }) === null, 'modelo desconhecido ou tamanho fora da faixa: nao passa')
  const preset = D.presetDe(ligado)
  const doPreset = D.thumbDoPreset(D.presetDaThumbSchema.parse(JSON.parse(JSON.stringify(preset))), T.thumbPadrao(null))
  confere(doPreset.divisor.modelo === 'slash' && doPreset.divisor.cor === '#2fb4ff' && doPreset.tamanho === 1.3, 'o editor solto lembra o divisor e o tamanho (preset)')
  const { tamanho: _pt, divisor: _pd, ...presetAntigo } = preset
  const pa = D.presetDaThumbSchema.safeParse(presetAntigo)
  confere(pa.success && pa.data.tamanho === 1 && !pa.data.divisor.ligado, 'preset de antes: 100% e divisor desligado')
  const ef = T.thumbEfetiva(ligado, medir)
  confere(ef.divisor?.modelo === 'slash' && T.thumbEfetiva({ ...ligado, layout: 'uma' }, medir).divisor === null, 'ligado: entra na emenda; com 1 imagem, nao')

  console.log('\n== as camadas (imagens -> divisor -> seta e texto)')
  const chamadas: string[] = []
  const fontes = { cima: { nome: 'cima' }, baixo: { nome: 'baixo' }, divisor: { nome: 'divisor' } }
  const guardado: Record<string | symbol, unknown> = {}
  const ctx = new Proxy(guardado, {
    get(alvo, prop) {
      if (prop in alvo) return alvo[prop]
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} })
      return (...args: unknown[]) => {
        const f = args[0] as { nome?: string } | undefined
        chamadas.push(prop === 'drawImage' ? `drawImage:${f?.nome ?? '?'}` : String(prop))
      }
    },
    set(alvo, prop, valor) {
      alvo[prop] = valor
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  const { desenharThumb } = await import('../src/editor/desenho')
  const desenhar = (divisor: import('../src/editor/desenho').DivisorPronto | null, layout: 'uma' | 'duas' = 'duas'): string[] => {
    chamadas.length = 0
    const t = { ...ligado, layout }
    const e = T.thumbEfetiva(t, medir)
    desenharThumb(ctx, {
      thumb: t,
      geo: e.geo,
      paineis: [
        { fonte: fontes.cima as unknown as CanvasImageSource, sx: 0, sy: 0, sw: 10, sh: 10 },
        layout === 'duas' ? { fonte: fontes.baixo as unknown as CanvasImageSource, sx: 0, sy: 0, sw: 10, sh: 10 } : null,
      ],
      seta: e.seta,
      divisor,
      escala: 1,
      guias: null,
    })
    return [...chamadas]
  }
  const ordem = desenhar({ tipo: 'imagem', fonte: fontes.divisor as unknown as CanvasImageSource, largura: 1080, altura: 1920, centro: 974 })
  const i = (nome: string): number => ordem.indexOf(nome)
  const primeiroTexto = Math.min(i('strokeText'), i('fillText'))
  confere(
    i('drawImage:cima') >= 0 && i('drawImage:cima') < i('drawImage:baixo') && i('drawImage:baixo') < i('drawImage:divisor') && i('drawImage:divisor') < i('stroke') && i('stroke') < primeiroTexto,
    'a ordem: imagem de cima, imagem de baixo, DIVISOR, seta, texto',
  )
  const linha = desenhar({ tipo: 'linha', cor: '#ffffff', contorno: true })
  const ultimaImagem = linha.lastIndexOf('drawImage:baixo')
  const retangulos = linha.map((n, k) => (n === 'fillRect' ? k : -1)).filter((k) => k > ultimaImagem && k < linha.indexOf('stroke'))
  confere(retangulos.length === 2, 'a Linha: o contorno e a linha depois das imagens e antes da seta')
  confere(!desenhar(null).includes('drawImage:divisor') && !desenhar({ tipo: 'imagem', fonte: fontes.divisor as unknown as CanvasImageSource, largura: 1080, altura: 1920, centro: 974 }, 'uma').includes('drawImage:divisor'), 'sem divisor, ou com 1 imagem: nada entre as imagens e o texto')

  console.log('\n== recolorir (a forma nao muda)')
  const sharp = (await import('sharp')).default
  const pasta = join(process.cwd(), 'modulos', 'thumb', 'assets', 'divisores')
  const ler = async (nome: string): Promise<import('../shared/thumb').PixelsRgba> => {
    const { data, info } = await sharp(join(pasta, nome)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { largura: info.width, altura: info.height, dados: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) }
  }
  const forma = await ler(T.PNG_DA_FORMA_DO_RASGO)
  for (const modelo of ['rasgo-brilho', 'rasgo', 'slash'] as const) {
    const png = await ler(T.PNG_DO_DIVISOR[modelo])
    // O centro da forma confere com o arquivo (a media dos pixels opacos).
    let soma = 0
    let n = 0
    for (let k = 3; k < png.dados.length; k += 4) {
      if (png.dados[k]! > 200) {
        soma += Math.floor(k / 4 / png.largura)
        n += 1
      }
    }
    confere(png.largura === 1080 && png.altura === 1920 && Math.abs(soma / n - T.CENTRO_DO_DIVISOR[modelo]) < 1, `${modelo}: 1080x1920, o centro da forma em y ${T.CENTRO_DO_DIVISOR[modelo]} (medido ${(soma / n).toFixed(1)})`)
    for (const cor of ['#2fb4ff', '#ff2b2b', '#ffffff']) {
      const novo = T.recolorirDivisor(modelo, cor, png, forma)
      let alphaIgual = true
      let mudou = 0
      let pretoFicou = true
      for (let k = 0; k < novo.length; k += 4) {
        if (novo[k + 3] !== png.dados[k + 3]) alphaIgual = false
        if (novo[k] !== png.dados[k] || novo[k + 1] !== png.dados[k + 1] || novo[k + 2] !== png.dados[k + 2]) mudou += 1
        // O contorno e a sombra do Slash (pretos) continuam pretos.
        if (modelo === 'slash' && png.dados[k + 3]! > 0 && png.dados[k]! + png.dados[k + 1]! + png.dados[k + 2]! === 0 && novo[k]! + novo[k + 1]! + novo[k + 2]! !== 0) pretoFicou = false
      }
      confere(alphaIgual && mudou > 1000 && pretoFicou, `${modelo} em ${cor}: o alpha igual pixel a pixel (a forma, o brilho e a sombra), a cor mudou${modelo === 'slash' ? ', o contorno e a sombra pretos' : ''}`)
    }
  }
  // O degrade do Slash e o do texto: topo mais claro, base mais escura.
  const slash = await ler(T.PNG_DO_DIVISOR.slash)
  const azul = T.recolorirDivisor('slash', '#2fb4ff', slash)
  const luz = (k: number): number => azul[k]! + azul[k + 1]! + azul[k + 2]!
  const coluna = (x: number): number[] => {
    const ys: number[] = []
    for (let y = 0; y < 1920; y++) {
      const k = (y * 1080 + x) * 4
      if (slash.dados[k + 3]! > 250 && slash.dados[k]! > 200) ys.push(k)
    }
    return ys
  }
  const col = coluna(900)
  confere(col.length > 10 && luz(col[0]!) > luz(col[col.length - 1]!), 'Slash recolorido: o topo da faixa mais claro que a base (como o texto)')
  const rasgo = T.recolorirDivisor('rasgo', '#ff2b2b', await ler(T.PNG_DO_DIVISOR.rasgo))
  const k540 = (y: number): number => (y * 1080 + 540) * 4
  confere(rasgo[k540(1000)]! > 200 && rasgo[k540(1000) + 1]! < 120, 'Rasgo em vermelho: a forma vira a cor')
  const brilho = T.recolorirDivisor('rasgo-brilho', '#ff2b2b', await ler(T.PNG_DO_DIVISOR['rasgo-brilho']), forma)
  const kb = k540(1060)
  confere(brilho[kb + 3]! > 0 && brilho[kb]! > 150 && brilho[kb + 2]! < 120, 'Rasgo com brilho em vermelho: o brilho em volta vira um tom da cor (era azul)')

  console.log('\n== o tamanho do texto')
  for (const [nome, linhas] of [
    ['curto', ['poder', 'supremo']],
    ['longo', ['ele despertou', 'surpreendentemente']],
  ] as [string, [string, string]][]) {
    for (const tamanho of [0.8, 1, 1.4]) {
      const g = T.geometriaDaThumb({ layout: 'duas', linhas, textoY: 0.5, tamanho }, medir)
      const [a, b] = g.linhas
      const cabem = g.linhas.every((l) => l.largura + 2 * l.contorno <= T.LARGURA * T.LARGURA_UTIL + 0.5)
      const semSobrepor = b!.base - b!.cap - b!.contorno >= a!.base - 0.01
      const proporcional = g.linhas.every((l) => Math.abs(l.contorno / l.px - T.CONTORNO_POR_PX) < 1e-9)
      const certo = g.linhas.every((l) => (l.noMaximo ? l.px < T.CORPO_PX * tamanho : Math.abs(l.px - T.CORPO_PX * tamanho) < 1e-9))
      confere(cabem && semSobrepor && proporcional && certo, `${nome} a ${Math.round(tamanho * 100)}%: ${g.linhas.map((l) => `${Math.round(l.px)}px${l.noMaximo ? ' (no maximo)' : ''}`).join(' / ')}, cabe, sem sobrepor, contorno junto`)
    }
  }
  const media80 = T.geometriaDaThumb({ layout: 'duas', linhas: ['poder', 'encontro'], textoY: 0.5, tamanho: 0.8 }, medir).linhas[1]!
  const media140 = T.geometriaDaThumb({ layout: 'duas', linhas: ['poder', 'encontro'], textoY: 0.5, tamanho: 1.4 }, medir).linhas[1]!
  confere(!media80.noMaximo && media140.noMaximo && media140.px > media80.px && media140.px < T.CORPO_PX * 1.4, `linha comprida: a 80% cabe (${Math.round(media80.px)}px); a 140% so cresce ate caber (${Math.round(media140.px)}px, no maximo da largura)`)
  const curta140 = T.geometriaDaThumb({ layout: 'duas', linhas: ['poder', 'supremo'], textoY: null, tamanho: 1.4 }, medir).linhas[0]!
  confere(Math.abs(curta140.px - T.CORPO_PX * 1.4) < 1e-9 && !curta140.noMaximo, 'linha curta a 140%: cresce 1,4x (contorno e sombra pelo corpo)')
}

function testarSeta(T: typeof import('../shared/thumb')): void {
  console.log('\n== a seta grande (ao lado, por cima ou por tras do texto)')
  const medir = (texto: string, px: number) => ({ largura: texto.length * px * 0.58, cap: px * 0.7 })
  const topoProibido = T.ZONA_PROIBIDA_TOPO * T.ALTURA
  const baseProibida = T.ZONA_PROIBIDA_BASE * T.ALTURA
  type G = import('../shared/thumb').GeometriaDaThumb
  // O rosto de cima: colado no texto (o enquadramento automatico poe a cabeca logo acima dele), longe, a esquerda
  // (espelha) e o close grande que encosta no texto (a ref "FALTOU" do Faah).
  const rostos = {
    colado: (g: G) => ({ x1: 420, y1: g.bloco!.topo - 230, x2: 640, y2: g.bloco!.topo - 30 }),
    alto: () => ({ x1: 520, y1: 420, x2: 720, y2: 640 }),
    esquerda: () => ({ x1: 60, y1: 560, x2: 300, y2: 820 }),
    close: (g: G) => ({ x1: 360, y1: g.bloco!.topo - 420, x2: 900, y2: g.bloco!.topo + 60 }),
  }
  /** Como a seta saiu: a vista (ao lado da 1a linha ou por cima do texto) ou por tras dele. */
  const jeito = (g: G, s: import('../shared/thumb').SetaNoQuadro): 'a vista' | 'por tras' => (s.base.y > g.bloco!.base ? 'por tras' : 'a vista')
  for (const [nome, linhas] of [
    ['curto', ['poder', 'supremo']],
    ['longo', ['cancelou', 'encontro magico']],
    ['cancelou', ['cancelou', 'encontro']],
  ] as [string, [string, string]][]) {
    for (const tamanho of [0.8, 1, 1.4]) {
      for (const rotacao of [0, -5]) {
        for (const [qual, rosto] of Object.entries(rostos)) {
          const g = T.geometriaDaThumb({ layout: 'duas', linhas, textoY: null, tamanho, rotacao }, medir)
          const r = rosto(g)
          const s = T.setaSozinha(g, r)!
          const L = Math.hypot(s.ponta.x - s.base.x, s.ponta.y - s.base.y)
          const c = T.caixaDaSeta(s)
          const dentro = c.x1 >= 0 && c.x2 <= T.LARGURA && c.y1 >= topoProibido - 0.5 && c.y2 <= baseProibida + 0.5
          const l1 = g.linhas[0]!
          const livre = (T.LARGURA - l1.largura) / 2 - l1.contorno
          const j = jeito(g, s)
          const contorno = T.contornoDaSetaPx(s)
          const cabecaFora = T.cabecaDaSeta(s).every((p) => !T.pontoNoTexto(g, p, contorno))
          // Sem espaco ao lado da 1a linha, ela nunca fica espremida em cima das letras: a vista, o corpo inteiro
          // fora do texto (por cima dele); por tras, so a cauda e a cabeca precisam aparecer.
          const corpoFora = j === 'por tras' || T.contornoDaSeta(s).every((p) => !T.pontoNoTexto(g, p, contorno * 0.5))
          const cobre = T.rostoCobertoPelaSeta(s, r)
          const tamanhoOk = L >= T.SETA_MINIMA - 1 && L <= T.SETA_MAXIMA + 1
          confere(
            tamanhoOk && dentro && s.ponta.y < g.bloco!.topo && cabecaFora && corpoFora && cobre <= 0.03 && (qual === 'esquerda' ? s.lado === -1 : true),
            `${nome} ${Math.round(tamanho * 100)}%${rotacao ? ` girado ${rotacao}` : ''}, rosto ${qual}: ${j} (livre ${Math.round(livre)} px), corda ${Math.round(L)} px, no quadro e fora das faixas, cabeca acima e fora do texto, cobre ${Math.round(cobre * 100)}% do rosto`,
          )
        }
      }
    }
  }
  // O close colado no texto largo, sem espaco em cima (a ref "CANCELOU"): a cauda embaixo, do lado, e a seta
  // sobe pela beirada passando por tras da letra da ponta; so a beirada se esconde.
  const larga = T.geometriaDaThumb({ layout: 'duas', linhas: ['cancelou', 'encontro'], textoY: null }, medir)
  const close = { x1: 240, y1: larga.bloco!.topo - 500, x2: 640, y2: larga.bloco!.topo + 40 }
  const s = T.setaSozinha(larga, close)!
  const escondido = T.contornoDaSeta(s).filter((p) => T.pontoNoTexto(larga, p))
  confere(
    s.lado === 1 && s.base.x <= larga.bloco!.esquerda + 40 && s.base.y > larga.bloco!.base && s.ponta.y < larga.bloco!.topo && escondido.length > 0 && escondido.every((p) => p.x < larga.bloco!.esquerda + 300) && T.rostoCobertoPelaSeta(s, close) <= 0.03,
    '"CANCELOU": o close sem espaco em cima -- nasce embaixo a esquerda, sobe por tras da 1a letra (so a beirada se esconde) e a cabeca sai acima das letras',
  )
  const espelhada = T.setaSozinha(larga, { x1: 60, y1: 560, x2: 300, y2: 820 })!
  confere(espelhada.lado === -1 && espelhada.base.x > espelhada.ponta.x && T.caixaDaSeta(espelhada).x2 <= T.LARGURA, 'o rosto a esquerda: espelhada, sai da direita')
}

/**
 * A FORMA DA SETA (pedido do Levi, 31/10): sempre a seta.png dele -- a mesma
 * silhueta, so escala UNIFORME, rotacao e espelho. Para qualquer par de pontas
 * (a automatica ou as bolinhas arrastadas), o poligono e o da forma padrao
 * levado por uma similaridade (o erro e zero); e o SVG guardado e o mesmo dos passos.
 */
function testarFormaDaSeta(T: typeof import('../shared/thumb')): void {
  console.log('\n== a forma da seta (a seta.png, so escala, giro e espelho)')
  const padrao = T.contornoDaSeta({ base: { x: 0, y: 0 }, ponta: { x: 1, y: 0 }, lado: 1 })
  /** O erro da melhor similaridade (com espelho quando `lado` -1) que leva a forma padrao ao poligono. */
  const erroDaSimilaridade = (poli: { x: number; y: number }[], lado: 1 | -1): number => {
    const a = padrao.map((p) => ({ x: p.x, y: lado * p.y }))
    const n = a.length
    const ma = a.reduce((m, p) => ({ x: m.x + p.x / n, y: m.y + p.y / n }), { x: 0, y: 0 })
    const mb = poli.reduce((m, p) => ({ x: m.x + p.x / n, y: m.y + p.y / n }), { x: 0, y: 0 })
    // Minimos quadrados de b = z*a + t com z complexo (escala uniforme + rotacao).
    let num = { re: 0, im: 0 }
    let den = 0
    a.forEach((p, i) => {
      const ax = p.x - ma.x
      const ay = p.y - ma.y
      const bx = poli[i]!.x - mb.x
      const by = poli[i]!.y - mb.y
      num = { re: num.re + bx * ax + by * ay, im: num.im + by * ax - bx * ay }
      den += ax * ax + ay * ay
    })
    const z = { re: num.re / den, im: num.im / den }
    const escala = Math.hypot(z.re, z.im)
    return (
      Math.max(
        ...a.map((p, i) => {
          const ax = p.x - ma.x
          const ay = p.y - ma.y
          return Math.hypot(z.re * ax - z.im * ay + mb.x - poli[i]!.x, z.im * ax + z.re * ay + mb.y - poli[i]!.y)
        }),
      ) / escala
    )
  }
  const casos: import('../shared/thumb').SetaNoQuadro[] = [
    { base: { x: 100, y: 900 }, ponta: { x: 420, y: 640 }, lado: 1 },
    { base: { x: 950, y: 1300 }, ponta: { x: 600, y: 500 }, lado: -1 },
    { base: { x: 300, y: 700 }, ponta: { x: 310, y: 300 }, lado: 1 },
    { base: { x: 500, y: 500 }, ponta: { x: 1000, y: 520 }, lado: -1 },
  ]
  for (const s of casos) {
    const poli = T.contornoDaSeta(s)
    const erro = erroDaSimilaridade(poli, s.lado)
    const L = Math.hypot(s.ponta.x - s.base.x, s.ponta.y - s.base.y)
    confere(erro < 1e-9 && Math.abs(T.contornoDaSetaPx(s) / L - T.CONTORNO_DA_SETA) < 1e-12, `corda ${Math.round(L)} px, lado ${s.lado}: a forma padrao so escalada, girada${s.lado === -1 ? ' e espelhada' : ''} (erro ${erro.toExponential(1)}), o contorno na mesma proporcao`)
  }
  // Uma deformacao (a de antes: a curva esticada) NAO passa no teste: ele pega a forma diferente.
  const torta = T.contornoDaSeta(casos[0]!).map((p, i) => (i > 10 && i < 20 ? { x: p.x + 15, y: p.y } : p))
  confere(erroDaSimilaridade(torta, 1) > 1e-3, 'uma curva esticada a mao seria pega (o teste nao e de enfeite)')
  // A automatica e a arrastada usam a mesma forma.
  const medir = (texto: string, px: number) => ({ largura: texto.length * px * 0.58, cap: px * 0.7 })
  const t = { ...T.thumbPadrao('PODER SUPREMO'), seta: { ligada: true, base: { x: 980, y: 1200 }, ponta: { x: 500, y: 700 } } }
  const arrastada = T.thumbEfetiva(t, medir).seta!
  confere(arrastada.lado === -1 && erroDaSimilaridade(T.contornoDaSeta(arrastada), -1) < 1e-9, 'as bolinhas arrastadas (a ponta a esquerda da cauda): a mesma forma, espelhada')
  // O SVG guardado (para quem le) e os passos (para o canvas) sao a mesma seta.
  const numerosDoSvg = (T.SETA_PADRAO_SVG.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
  const numerosDosPassos = T.FORMA_DA_SETA.flatMap((p) => (p.tipo === 'C' ? [p.c1.x, p.c1.y, p.c2.x, p.c2.y, p.p.x, p.p.y] : [p.p.x, p.p.y]))
  confere(numerosDoSvg.length === numerosDosPassos.length && numerosDoSvg.every((v, i) => Math.abs(v - numerosDosPassos[i]!) < 1e-9), 'o SETA_PADRAO_SVG e os passos do canvas sao a mesma seta')
  const ponta = T.FORMA_DA_SETA[0]!.p
  const cauda = T.contornoDaSeta({ base: { x: 0, y: 0 }, ponta: { x: 1, y: 0 }, lado: 1 })
  confere(ponta.x === 1 && ponta.y === 0 && cauda.some((p) => Math.hypot(p.x, p.y) < 0.01), 'a ponta da cabeca em (1,0) e a cauda em (0,0): as bolinhas ficam nas pontas de verdade')
}

/**
 * A ROTACAO DO TEXTO (pedido do Faah, a ref "FALTOU EXPLICAR!" uns -5 graus):
 * o bloco inteiro gira em volta do meio, a 0 nada muda, girado ainda cabe na
 * largura util (encolhe se precisar), a caixa do bloco e a do texto girado,
 * thumb e preset de antes abrem com 0, e no desenho o canvas gira mas a sombra
 * continua para baixo.
 */
async function testarRotacao(T: typeof import('../shared/thumb'), D: typeof import('../shared/pedidos')): Promise<void> {
  console.log('\n== a rotacao do texto')
  const medir = (texto: string, px: number) => ({ largura: texto.length * px * 0.58, cap: px * 0.7 })
  const padrao = T.thumbPadrao('FALTOU EXPLICAR!')
  confere(padrao.rotacao === 0, 'o padrao: reto (0)')
  const { rotacao: _r, ...antiga } = padrao
  confere(T.thumbDoProjeto(JSON.parse(JSON.stringify(antiga)))?.rotacao === 0, 'thumb salva antes (sem rotacao): abre com 0')
  confere(T.thumbDoProjeto({ ...padrao, rotacao: -5 })?.rotacao === -5 && T.thumbDoProjeto({ ...padrao, rotacao: 20 }) === null, 'o estado guarda a rotacao; fora de -15..15 nao passa')
  const preset = D.presetDe({ ...padrao, rotacao: -5 })
  const volta = D.thumbDoPreset(D.presetDaThumbSchema.parse(JSON.parse(JSON.stringify(preset))), T.thumbPadrao(null))
  const { rotacao: _pr, ...presetAntigo } = preset
  confere(volta.rotacao === -5 && D.presetDaThumbSchema.parse(presetAntigo).rotacao === 0, 'o editor solto lembra a rotacao; preset de antes = 0')
  const linhas = ['faltou', 'explicar!'] as [string, string]
  const reta = T.geometriaDaThumb({ layout: 'duas', linhas, textoY: null }, medir)
  const zero = T.geometriaDaThumb({ layout: 'duas', linhas, textoY: null, rotacao: 0 }, medir)
  confere(JSON.stringify(reta) === JSON.stringify(zero) && reta.rotacao === 0, 'a 0: a geometria igual a de antes')
  for (const [nome, ls, tamanho, rotacao] of [
    ['FALTOU EXPLICAR!', linhas, 1, -5],
    ['FALTOU EXPLICAR! 140%', linhas, 1.4, -5],
    ['CANCELOU ENCONTRO', ['cancelou', 'encontro'], 1, 12],
    ['texto longo a -15', ['inacreditavelmente', 'surpreendentemente'], 1, -15],
  ] as [string, [string, string], number, number][]) {
    const g = T.geometriaDaThumb({ layout: 'duas', linhas: ls, textoY: null, tamanho, rotacao }, medir)
    const meia = (T.LARGURA * T.LARGURA_UTIL) / 2
    let cabe = true
    let naCaixa = true
    for (const l of g.linhas) {
      for (const [dx, dy, f] of [
        [-1, -1, l.contorno],
        [1, -1, l.contorno],
        [1, 1, l.contorno],
        [-1, 1, l.contorno],
      ] as const) {
        const local = { x: T.LARGURA / 2 + dx * (l.largura / 2 + f), y: dy < 0 ? l.base - l.cap - f : l.base + l.desce + f }
        const p = T.paraATela(g, local)
        if (Math.abs(p.x - T.LARGURA / 2) > meia + 0.5) cabe = false
        const tinta = T.paraATela(g, { x: T.LARGURA / 2 + dx * (l.largura / 2), y: dy < 0 ? l.base - l.cap : l.base + l.desce })
        if (tinta.x < g.bloco!.esquerda - 0.01 || tinta.x > g.bloco!.direita + 0.01 || tinta.y < g.bloco!.topo - 0.01 || tinta.y > g.bloco!.base + 0.01) naCaixa = false
      }
    }
    const pivo = Math.abs(g.pivo.y - T.textoYPadrao('duas') * T.ALTURA) < 1e-9 && g.pivo.x === T.LARGURA / 2 && g.emenda === Math.round(g.pivo.y)
    const encolheu = g.linhas.filter((l) => l.noMaximo).map((l) => `${l.linha + 1}:${Math.round(l.px)}px`)
    confere(cabe && naCaixa && pivo && g.rotacao === rotacao, `${nome} girado ${rotacao}: com o contorno, cabe na largura util${encolheu.length ? ` (encolheu ${encolheu.join(', ')})` : ''}; a caixa do bloco cobre o texto girado; gira em volta do meio e a emenda fica`)
  }
  // Gira -5: a ponta direita sobe, a esquerda desce (a ref do Faah).
  const g5 = T.geometriaDaThumb({ layout: 'duas', linhas, textoY: null, rotacao: -5 }, medir)
  const l = g5.linhas[0]!
  const esq = T.paraATela(g5, { x: T.LARGURA / 2 - l.largura / 2, y: l.base })
  const dir = T.paraATela(g5, { x: T.LARGURA / 2 + l.largura / 2, y: l.base })
  confere(dir.y < esq.y - 10, `-5 graus: o texto sobe para a direita (${Math.round(esq.y - dir.y)} px)`)
  confere(T.pontoNoTexto(g5, T.paraATela(g5, { x: T.LARGURA / 2, y: l.base - l.cap / 2 })) && !T.pontoNoTexto(g5, { x: T.LARGURA / 2, y: g5.bloco!.topo - 40 }), 'o "ponto no texto" segue o texto girado')

  // O desenho: o canvas gira em volta do pivo; a sombra (offset e desfoque) e a mesma do texto reto.
  const { desenharThumb } = await import('../src/editor/desenho')
  const registrar = (rotacao: number): { giros: number[]; sombras: number[]; desfoques: number[] } => {
    const giros: number[] = []
    const sombras: number[] = []
    const desfoques: number[] = []
    const guardado: Record<string | symbol, unknown> = {}
    const ctx = new Proxy(guardado, {
      get(alvo, prop) {
        if (prop in alvo && typeof alvo[prop] !== 'function') return alvo[prop]
        if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} })
        return (...args: unknown[]) => {
          if (prop === 'rotate') giros.push(args[0] as number)
          if (prop === 'strokeText' && alvo.shadowColor !== 'transparent') {
            sombras.push(alvo.shadowOffsetY as number)
            desfoques.push(alvo.shadowBlur as number)
          }
        }
      },
      set(alvo, prop, valor) {
        alvo[prop] = valor
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    // PODER SUPREMO cabe girado sem encolher: a sombra de cada linha pode ser comparada com a reta.
    const t = { ...T.thumbPadrao('PODER SUPREMO'), rotacao }
    const e = T.thumbEfetiva(t, medir)
    desenharThumb(ctx, { thumb: t, geo: e.geo, paineis: [null, null], seta: null, escala: 0.5, guias: null })
    return { giros, sombras, desfoques }
  }
  const r0 = registrar(0)
  const r5 = registrar(-5)
  confere(r0.giros.length === 0 && r5.giros.length === 2 && r5.giros.every((a) => Math.abs(a - (-5 * Math.PI) / 180) < 1e-12), 'no canvas: as duas linhas giram -5 graus (reto: nenhum giro)')
  confere(r5.sombras.length === 2 && JSON.stringify(r5.sombras) === JSON.stringify(r0.sombras) && JSON.stringify(r5.desfoques) === JSON.stringify(r0.desfoques), `a sombra continua caindo para baixo: o mesmo deslocamento (${r5.sombras.map((x) => x.toFixed(1)).join(', ')} px na tela) e desfoque do texto reto`)
}

/**
 * A IMAGEM SEMPRE COBRE O SLOT (pedido de 30/10): nenhum enquadramento -- o
 * automatico (rosto na beira), o da mao (zoom abaixo do minimo, centro fora)
 * -- abre buraco, com imagem deitada, em pe ou 16:9; e as barras pretas
 * EMBUTIDAS no quadro (o letterbox da cena do Yami no Black Clover S02E04,
 * ~15% em cima e embaixo, que aparecia como faixa preta no topo da previa)
 * saem do quadro antes de tudo, sem comer cena escura.
 */
async function testarCobrirEBarras(T: typeof import('../shared/thumb')): Promise<void> {
  console.log('\n== a imagem cobre o slot e as barras pretas saem')
  const medir = (texto: string, px: number) => ({ largura: texto.length * px * 0.58, cap: px * 0.7 })
  const IMAGENS = { deitada: { largura: 3000, altura: 600 }, 'em pe': { largura: 600, altura: 2400 }, '16:9': { largura: 854, altura: 480 }, '9:16': { largura: 1080, altura: 1920 } }
  const NA_MAO = [
    { zoom: 1, cx: 0, cy: 0 },
    { zoom: 4, cx: 1, cy: 1 },
    { zoom: 0.3, cx: 0.5, cy: 0.5 },
    { zoom: 1.7, cx: -2, cy: 3 },
  ]
  const BEIRAS = [
    { x: 0.45, y: 0, w: 0.1, h: 0.2, conf: 0.9 },
    { x: 0.45, y: 0.8, w: 0.1, h: 0.2, conf: 0.9 },
    { x: 0, y: 0.4, w: 0.08, h: 0.2, conf: 0.9 },
  ]
  for (const [nome, tam] of Object.entries(IMAGENS)) {
    let buracos = 0
    let casos = 0
    for (const layout of ['uma', 'duas'] as const) {
      for (const rosto of [null, ...BEIRAS]) {
        for (const enq of [null, ...NA_MAO]) {
          const img = { origem: 'arquivo' as const, arquivo: 'x.png', t: 0, ...tam, rostos: rosto ? [rosto] : null, enquadramento: enq }
          const t = { ...T.thumbPadrao(null), layout, linhas: ['poder', 'supremo'] as [string, string], imagens: [img, img] as T.ThumbDoProjeto['imagens'] }
          const ef = T.thumbEfetiva(t, medir)
          ef.geo.paineis.forEach((painel, i) => {
            casos++
            const r = T.recorteDaImagem(painel, tam, ef.enquadramentos[i] ?? null)
            const dentro = r.sx >= -1e-6 && r.sy >= -1e-6 && r.sx + r.sw <= tam.largura + 1e-6 && r.sy + r.sh <= tam.altura + 1e-6
            const cobre = r.sw * r.escala >= T.LARGURA - 1e-6 && r.sh * r.escala >= painel.y1 - painel.y0 - 1e-6
            if (!dentro || !cobre) buracos++
          })
        }
      }
    }
    confere(buracos === 0, `${nome} (${tam.largura}x${tam.altura}): ${casos} enquadramentos (automatico com o rosto em cada beira, e a mao fora do limite), todos dentro da imagem e cobrindo o slot`)
  }
  // Sem como tirar o rosto da faixa: cobre o slot e avisa (nunca abre buraco para empurrar o rosto).
  const colada = { origem: 'arquivo' as const, arquivo: 'x.png', t: 0, largura: 854, altura: 480, rostos: [BEIRAS[0]!], enquadramento: null }
  const efColada = T.thumbEfetiva({ ...T.thumbPadrao(null), linhas: ['poder', 'supremo'], imagens: [colada, null] }, medir)
  confere(efColada.avisos.some((a) => a.texto.includes('faixa proibida de cima')), 'a cabeca colada no topo da imagem: o slot coberto e o aviso da faixa proibida')

  const { areaSemBarras } = await import('../shared/barras')
  const quadro = (w: number, h: number, preto: (x: number, y: number) => boolean): Uint8Array => {
    const c = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c[y * w + x] = preto(x, y) ? 6 : 60 + ((x * 7 + y * 13) % 150)
    return c
  }
  const letterbox = quadro(854, 480, (_x, y) => y < 73 || y >= 407)
  // Um pouco de ruido (e um logo pequeno) dentro da barra: continua barra.
  for (let i = 0; i < 3; i++) letterbox[10 * 854 + 400 + i] = 255
  confere(JSON.stringify(areaSemBarras(letterbox, 854, 480)) === JSON.stringify({ x: 0, y: 73, largura: 854, altura: 334 }), 'letterbox (a cena do Yami): as duas barras saem, a cena inteira fica')
  confere(JSON.stringify(areaSemBarras(quadro(640, 480, (x) => x < 80 || x >= 560), 640, 480)) === JSON.stringify({ x: 80, y: 0, largura: 480, altura: 480 }), 'pillarbox (4:3 no 16:9): as barras do lado saem')
  confere(areaSemBarras(quadro(854, 480, (_x, y) => y < 90), 854, 480).altura === 480, 'ceu escuro so em cima (sem a barra de baixo): nada sai')
  confere(areaSemBarras(quadro(854, 480, (_x, y) => y < 40 || y >= 400), 854, 480).altura === 480, 'barras de espessuras bem diferentes: nada sai')
  confere(areaSemBarras(quadro(854, 480, () => true), 854, 480).altura === 480, 'quadro todo preto (fade): nada sai')
  // A vinheta escura dos lados (o porco do Magic Repo Man, a cena noturna do Cyberpunk): escura, mas nao lisa.
  const vinheta = quadro(854, 480, () => false)
  for (let y = 0; y < 480; y++) for (let x = 0; x < 854; x++) if (x < 60 || x >= 794) vinheta[y * 854 + x] = Math.round(4 + (32 * Math.abs(y - 240)) / 240)
  confere(areaSemBarras(vinheta, 854, 480).largura === 854, 'vinheta escura nos lados (escura, mas nao lisa): nada sai')
  confere(areaSemBarras(quadro(854, 480, (_x, y) => y < 4 || y >= 476), 854, 480).altura === 480, 'borda fina de encode (< 2%): fica')
}

/**
 * A INCLINACAO DA EMENDA (pedido do Levi, 31/10; a ref "FALTOU EXPLICAR!" do
 * Faah, o slash subindo para a direita): guardada (as de antes = 0, preset
 * junto), a 0 nada muda; inclinada, a MASCARA -- com um canvas falso que
 * anota recortes e retangulos, rasterizado pixel a pixel -- nao deixa nenhum
 * pixel de fundo e cada lado da reta e da sua imagem, em varios angulos; cada
 * imagem cobre a caixa do seu trapezio; o divisor (os 4 modelos) gira com o
 * angulo e cobre de borda a borda sem mudar a espessura; o rosto de cima fica
 * acima da emenda NO X DELE e o de baixo abaixo; o painel do ponto segue a reta.
 */
async function testarInclinacao(T: typeof import('../shared/thumb'), D: typeof import('../shared/pedidos')): Promise<void> {
  console.log('\n== a inclinacao da emenda')
  const medir = (texto: string, px: number) => ({ largura: texto.length * px * 0.58, cap: px * 0.7 })
  const padrao = T.thumbPadrao('FALTOU EXPLICAR!')
  confere(padrao.divisor.inclinacao === 0, 'o padrao: emenda reta (0)')
  const { inclinacao: _i, ...divisorAntigo } = padrao.divisor
  confere(T.thumbDoProjeto(JSON.parse(JSON.stringify({ ...padrao, divisor: divisorAntigo })))?.divisor.inclinacao === 0, 'thumb salva antes (divisor sem inclinacao): abre com 0')
  const inclinada = { ...padrao, divisor: { ...padrao.divisor, ligado: true, modelo: 'slash' as const, inclinacao: -6 }, rotacao: -5 }
  confere(T.thumbDoProjeto(JSON.parse(JSON.stringify(inclinada)))?.divisor.inclinacao === -6, 'o estado guarda a inclinacao')
  confere(T.thumbDoProjeto({ ...inclinada, divisor: { ...inclinada.divisor, inclinacao: 16 } }) === null, 'fora de -15..15: nao passa')
  const preset = D.presetDe(inclinada)
  const volta = D.thumbDoPreset(D.presetDaThumbSchema.parse(JSON.parse(JSON.stringify(preset))), T.thumbPadrao(null))
  const { inclinacao: _pi, ...presetDivisorAntigo } = preset.divisor
  confere(volta.divisor.inclinacao === -6 && D.presetDaThumbSchema.parse({ ...preset, divisor: presetDivisorAntigo }).divisor.inclinacao === 0, 'o editor solto lembra a inclinacao; preset de antes = 0')

  const linhas = ['faltou', 'explicar!'] as [string, string]
  const reta = T.geometriaDaThumb({ layout: 'duas', linhas, textoY: null }, medir)
  const zero = T.geometriaDaThumb({ layout: 'duas', linhas, textoY: null, divisor: { inclinacao: 0 } }, medir)
  confere(
    JSON.stringify(reta) === JSON.stringify(zero) && reta.paineis[0]!.y1 === reta.emenda && reta.paineis[1]!.y0 === reta.emenda && reta.inclinacao === 0,
    'a 0: a geometria de antes (cima 0..emenda, baixo emenda..1920)',
  )
  confere(T.geometriaDaThumb({ layout: 'uma', linhas, textoY: null, divisor: { inclinacao: -10 } }, medir).inclinacao === 0, 'com 1 imagem: sem inclinacao')

  // ---- a mascara: um canvas falso com a matriz, os recortes e os retangulos desenhados
  type M = [number, number, number, number, number, number]
  const vezes = (a: M, b: M): M => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
  const aplicar = (m: M, x: number, y: number): { x: number; y: number } => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })
  type Desenho = { nome: string; cantos: { x: number; y: number }[]; recortes: { x: number; y: number }[][] }
  const anotar = (): { ctx: CanvasRenderingContext2D; desenhos: Desenho[] } => {
    const desenhos: Desenho[] = []
    let m: M = [1, 0, 0, 1, 0, 0]
    let recortes: { x: number; y: number }[][] = []
    let caminho: { x: number; y: number }[] = []
    const pilha: { m: M; recortes: { x: number; y: number }[][] }[] = []
    const guardado: Record<string | symbol, unknown> = {}
    const retangulo = (x: number, y: number, w: number, h: number) => [aplicar(m, x, y), aplicar(m, x + w, y), aplicar(m, x + w, y + h), aplicar(m, x, y + h)]
    const funcoes: Record<string, (...a: never[]) => unknown> = {
      save: () => pilha.push({ m: [...m] as M, recortes: [...recortes] }),
      restore: () => {
        const p = pilha.pop()
        if (p) ({ m, recortes } = p)
      },
      setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => (m = [a, b, c, d, e, f]),
      translate: (x: number, y: number) => (m = vezes(m, [1, 0, 0, 1, x, y])),
      rotate: (a: number) => (m = vezes(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0])),
      scale: (x: number, y: number) => (m = vezes(m, [x, 0, 0, y, 0, 0])),
      beginPath: () => (caminho = []),
      moveTo: (x: number, y: number) => caminho.push(aplicar(m, x, y)),
      lineTo: (x: number, y: number) => caminho.push(aplicar(m, x, y)),
      closePath: () => {},
      rect: (x: number, y: number, w: number, h: number) => caminho.push(...retangulo(x, y, w, h)),
      clip: () => (recortes = [...recortes, caminho]),
      drawImage: (...a: never[]) => {
        const n = a as unknown as [{ nome?: string }, ...number[]]
        const [x, y, w, h] = n.length === 9 ? (n.slice(5) as number[]) : (n.slice(1) as number[])
        desenhos.push({ nome: n[0]?.nome ?? '?', cantos: retangulo(x!, y!, w!, h!), recortes })
      },
      fillRect: (x: number, y: number, w: number, h: number) => desenhos.push({ nome: String(guardado.fillStyle ?? 'fill'), cantos: retangulo(x, y, w, h), recortes }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
    }
    const ctx = new Proxy(guardado, {
      get(alvo, prop) {
        if (typeof prop === 'string' && funcoes[prop]) return funcoes[prop]
        if (prop in alvo) return alvo[prop]
        return () => {}
      },
      set(alvo, prop, valor) {
        alvo[prop] = valor
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    return { ctx, desenhos }
  }
  const dentro = (p: { x: number; y: number }, poli: { x: number; y: number }[]): boolean => {
    let d = false
    for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
      const a = poli[i]!
      const b = poli[j]!
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) d = !d
    }
    return d
  }
  const { desenharThumb } = await import('../src/editor/desenho')
  const fontes = { cima: { nome: 'cima' }, baixo: { nome: 'baixo' }, divisor: { nome: 'divisor' } }
  const ANGULOS = [-15, -12, -6, -0.5, 0, 3, 12, 15]
  let fundo = 0
  let trocados = 0
  let cortados = 0
  let pixels = 0
  for (const graus of ANGULOS) {
    for (const textoY of [null, 0.32, 0.7]) {
      const t = { ...padrao, textoY, rotacao: -5, divisor: { ...padrao.divisor, inclinacao: graus } }
      const ef = T.thumbEfetiva(t, medir)
      const { ctx, desenhos } = anotar()
      desenharThumb(ctx, {
        thumb: t,
        geo: ef.geo,
        paineis: [
          { fonte: fontes.cima as unknown as CanvasImageSource, sx: 0, sy: 0, sw: 10, sh: 10 },
          { fonte: fontes.baixo as unknown as CanvasImageSource, sx: 0, sy: 0, sw: 10, sh: 10 },
        ],
        seta: null,
        divisor: null,
        escala: 1,
        guias: null,
      })
      const imagens = desenhos.filter((d) => d.nome === 'cima' || d.nome === 'baixo')
      const corte = ef.geo.paineis[1]!.corte!
      let fundoAqui = 0
      // Cada pixel (o centro dele): coberto por alguma imagem (dentro do recorte E do retangulo desenhado) e, longe
      // da reta (> 0,75 px), a ULTIMA que cobre e a do lado certo.
      // Todas as linhas em volta da emenda (onde a mascara trabalha) e, no resto, uma linha a cada 16.
      const de = Math.floor(Math.min(T.emendaNoX(corte, 0), T.emendaNoX(corte, T.LARGURA))) - 4
      const ate = Math.ceil(Math.max(T.emendaNoX(corte, 0), T.emendaNoX(corte, T.LARGURA))) + 4
      for (let y = 0; y < T.ALTURA; y++) {
        if ((y < de || y > ate) && y % 16 !== 0 && y !== T.ALTURA - 1) continue
        for (let x = 0; x < T.LARGURA; x++) {
          const p = { x: x + 0.5, y: y + 0.5 }
          let ultima: string | null = null
          for (const d of imagens) if (dentro(p, d.cantos) && d.recortes.every((r) => dentro(p, r))) ultima = d.nome
          pixels++
          if (!ultima) {
            fundoAqui++
            continue
          }
          const lado = (p.y - T.emendaNoX(corte, p.x)) * Math.cos(Math.atan(corte.tan))
          if ((lado < -0.75 && ultima !== 'cima') || (lado > 0.75 && ultima !== 'baixo')) trocados++
          // A borda suavizada da de baixo cai sobre a de cima, nunca sobre o fundo: o pixel que a reta corta (o
          // quadradinho dele) fica inteiro dentro da de cima.
          const ya = T.emendaNoX(corte, x)
          const yb = T.emendaNoX(corte, x + 1)
          if (Math.min(ya, yb) < y + 1 && Math.max(ya, yb) > y) {
            const cantos = [
              { x: x + 0.001, y: y + 0.001 },
              { x: x + 0.999, y: y + 0.999 },
            ]
            if (!cantos.every((q) => imagens.some((d) => d.nome === 'cima' && dentro(q, d.cantos) && d.recortes.every((r) => dentro(q, r))))) cortados++
          }
        }
      }
      fundo += fundoAqui
    }
  }
  if (fundo + trocados + cortados > 0) console.log(`      fundo ${fundo}, lado trocado ${trocados}, borda sem a de cima por baixo ${cortados}`)
  confere(fundo === 0 && trocados === 0 && cortados === 0, `a mascara em ${ANGULOS.length} angulos x 3 alturas (${(pixels / 1e6).toFixed(1)} M pixels: todas as linhas da emenda, 1 a cada 16 no resto): nenhum pixel de fundo, cada lado da reta com a sua imagem, a borda da de baixo sempre sobre a de cima`)

  // A emenda passa pelo meio da emenda reta e sobe para a direita com o angulo negativo.
  const g6 = T.geometriaDaThumb({ layout: 'duas', linhas, textoY: null, divisor: { inclinacao: -6 } }, medir)
  const c6 = g6.paineis[1]!.corte!
  confere(
    Math.abs(T.emendaNoX(c6, T.LARGURA / 2) - g6.emenda!) < 1e-9 && T.emendaNoX(c6, T.LARGURA) < T.emendaNoX(c6, 0) - 100 && Math.abs(Math.atan(c6.tan) * (180 / Math.PI) + 6) < 1e-9,
    `-6 graus: a reta passa pelo meio da emenda e sobe ${Math.round(T.emendaNoX(c6, 0) - T.emendaNoX(c6, T.LARGURA))} px para a direita`,
  )
  confere(T.painelNoPonto(g6, { x: 1000, y: g6.emenda! - 20 }) === 1 && T.painelNoPonto(g6, { x: 80, y: g6.emenda! + 20 }) === 0, 'o painel do ponto (arrastar, rodinha, soltar) segue a reta: na direita, 20 px acima do meio ja e a de baixo')

  // Cada imagem cobre a CAIXA do trapezio (o zoom minimo e o arrastar contam a ponta mais funda).
  let buracos = 0
  let casos = 0
  const IMAGENS = [
    { largura: 854, altura: 480 },
    { largura: 1080, altura: 1920 },
    { largura: 600, altura: 2400 },
  ]
  for (const graus of [-15, -6, 12]) {
    for (const tam of IMAGENS) {
      for (const enq of [null, { zoom: 1, cx: 0, cy: 0 }, { zoom: 1, cx: 1, cy: 1 }, { zoom: 2.5, cx: 0.2, cy: 0.9 }]) {
        const img = { origem: 'arquivo' as const, arquivo: 'x.png', t: 0, ...tam, rostos: null, enquadramento: enq }
        const t = { ...padrao, divisor: { ...padrao.divisor, inclinacao: graus }, imagens: [img, img] as T.ThumbDoProjeto['imagens'] }
        const ef = T.thumbEfetiva(t, medir)
        ef.geo.paineis.forEach((painel, i) => {
          casos++
          const regiao = T.regiaoDoPainel(painel)
          const r = T.recorteDaImagem(painel, tam, ef.enquadramentos[i] ?? null)
          const cobre = r.sw * r.escala >= T.LARGURA - 1e-6 && r.sh * r.escala >= painel.y1 - painel.y0 - 1e-6
          const caixa = regiao.every((q) => q.y >= painel.y0 - 1e-6 && q.y <= painel.y1 + 1e-6)
          if (!cobre || !caixa) buracos++
        })
      }
    }
  }
  confere(buracos === 0, `${casos} paineis inclinados (16:9, 9:16, em pe; automatico e a mao nas beiras): a imagem cobre a caixa inteira do trapezio`)

  // ---- o divisor inclinado: os 4 modelos de borda a borda, a espessura igual
  const sharp = (await import('sharp')).default
  const pasta = join(process.cwd(), 'modulos', 'thumb', 'assets', 'divisores')
  for (const modelo of ['rasgo-brilho', 'rasgo', 'slash'] as const) {
    const { data, info } = await sharp(join(pasta, T.PNG_DO_DIVISOR[modelo])).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const f = T.FAIXA_DO_DIVISOR[modelo]
    const linhaTemAlpha = (y: number): boolean => {
      for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3]! > 0) return true
      return false
    }
    confere(linhaTemAlpha(f.de) && linhaTemAlpha(f.ate) && !linhaTemAlpha(f.de - 1) && !linhaTemAlpha(f.ate + 1), `${modelo}: a faixa ${f.de}-${f.ate} do PNG e a forma inteira em volta do centro (alpha 0 logo fora)`)
  }
  const PRONTOS: [string, import('../src/editor/desenho').DivisorPronto][] = [
    ...(['rasgo-brilho', 'rasgo', 'slash'] as const).map(
      (m): [string, import('../src/editor/desenho').DivisorPronto] => [m, { tipo: 'imagem', fonte: fontes.divisor as unknown as CanvasImageSource, largura: 1080, altura: 1920, centro: T.CENTRO_DO_DIVISOR[m], faixa: T.FAIXA_DO_DIVISOR[m] }],
    ),
    ['linha', { tipo: 'linha', cor: '#ffffff', contorno: true }],
  ]
  for (const [nome, d] of PRONTOS) {
    const resumo: string[] = []
    let ok = true
    for (const graus of [-15, -12, -6, 6, 12, 15]) {
      const t = { ...padrao, divisor: { ...padrao.divisor, ligado: true, inclinacao: graus } }
      const ef = T.thumbEfetiva(t, medir)
      const { ctx, desenhos } = anotar()
      desenharThumb(ctx, { thumb: t, geo: ef.geo, paineis: [null, null], seta: null, divisor: d, escala: 1, guias: null })
      const faixas = desenhos.filter((x) => x.nome === 'divisor' || x.nome === '#ffffff' || x.nome === 'rgba(0,0,0,0.85)')
      for (const fx of faixas) {
        const [a, b, c, e] = fx.cantos as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
        // As duas quinas de cada ponta passam da borda; o lado curto (a espessura) com o comprimento de antes; o angulo e o da emenda.
        const passa = Math.max(a.x, e.x) <= -0.5 && Math.min(b.x, c.x) >= T.LARGURA + 0.5
        const angulo = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
        const espessura = Math.hypot(e.x - a.x, e.y - a.y)
        const esperada = d.tipo === 'imagem' ? d.faixa!.ate + 1 - d.faixa!.de : nome === 'linha' && fx.nome === '#ffffff' ? T.ESPESSURA_DA_LINHA : T.ESPESSURA_DA_LINHA + 2 * T.CONTORNO_DA_LINHA
        // Esticada: o comprimento >= largura / cos (a regra) -- a sobra e a das quinas.
        const comprido = Math.hypot(b.x - a.x, b.y - a.y) >= T.LARGURA / Math.cos((Math.abs(graus) * Math.PI) / 180)
        if (!passa || !comprido || Math.abs(angulo - graus) > 1e-6 || Math.abs(espessura - esperada) > 1e-6) ok = false
      }
      if (faixas.length === 0) ok = false
      resumo.push(`${graus > 0 ? '+' : ''}${graus}`)
    }
    confere(ok, `${nome} inclinado (${resumo.join(', ')}): gira com a emenda, as quinas passam das duas bordas e a espessura nao muda (so estica na largura)`)
  }
  // O centro da forma fica no meio da emenda: girando o PNG em volta de (540, emenda), o y do centro vai para la.
  {
    const t = { ...padrao, divisor: { ...padrao.divisor, ligado: true, modelo: 'slash' as const, inclinacao: -6 } }
    const ef = T.thumbEfetiva(t, medir)
    const { ctx, desenhos } = anotar()
    const d = PRONTOS[2]![1] as Extract<import('../src/editor/desenho').DivisorPronto, { tipo: 'imagem' }>
    desenharThumb(ctx, { thumb: t, geo: ef.geo, paineis: [null, null], seta: null, divisor: d, escala: 1, guias: null })
    const fx = desenhos.find((x) => x.nome === 'divisor')!
    const [a, b, c, e] = fx.cantos as { x: number; y: number }[]
    // O ponto do PNG (540, centro) = a fracao (centro - de)/(ate+1-de) da altura, no meio da largura.
    const fr = (d.centro - d.faixa!.de) / (d.faixa!.ate + 1 - d.faixa!.de)
    const topoMeio = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }
    const baseMeio = { x: (e!.x + c!.x) / 2, y: (e!.y + c!.y) / 2 }
    const centro = { x: topoMeio.x + fr * (baseMeio.x - topoMeio.x), y: topoMeio.y + fr * (baseMeio.y - topoMeio.y) }
    confere(Math.hypot(centro.x - T.LARGURA / 2, centro.y - ef.geo.emenda!) < 1e-6, 'o centro da forma (o y medido no PNG) fica no meio da emenda inclinada')
    // Reto: o desenho de antes (o PNG inteiro, sem giro).
    const r = anotar()
    const t0 = { ...t, divisor: { ...t.divisor, inclinacao: 0 } }
    desenharThumb(r.ctx, { thumb: t0, geo: T.thumbEfetiva(t0, medir).geo, paineis: [null, null], seta: null, divisor: d, escala: 1, guias: null })
    const reto = r.desenhos.find((x) => x.nome === 'divisor')!
    confere(reto.cantos[0]!.x === 0 && reto.cantos[2]!.y - reto.cantos[0]!.y === 1920 && reto.cantos[0]!.y === T.thumbEfetiva(t0, medir).geo.emenda! - d.centro, 'reto: o divisor como antes (o PNG inteiro, 1 px = 1 px)')
  }

  // ---- o rosto e a emenda inclinada
  // Rostos que cabem JUSTOS (a emenda e o limite que segura, a poucos px): o automatico os poe do lado certo
  // da reta NO X DELES -- a cabeca de cima acima do lado em que a emenda sobe, a de baixo abaixo do lado em
  // que ela desce. Sem texto (a reta e o unico limite) e com o texto girado.
  const ROSTO_CIMA = { x: 0.6, y: 0.2, w: 0.09, h: 0.2, conf: 0.9 }
  const ROSTO_BAIXO = { x: 0.3, y: 0.2, w: 0.126, h: 0.28, conf: 0.9 }
  for (const [nome, ls, rot] of [
    ['sem texto', ['', ''], 0],
    ['FALTOU EXPLICAR! a -5', linhas, -5],
  ] as [string, [string, string], number][]) {
    for (const graus of [-12, 12]) {
      const cima = { origem: 'arquivo' as const, arquivo: 'c.png', t: 0, largura: 854, altura: 480, rostos: [ROSTO_CIMA], enquadramento: null }
      const baixo = { ...cima, arquivo: 'b.png', rostos: [ROSTO_BAIXO] }
      const t = { ...padrao, linhas: ls, rotacao: rot, divisor: { ...padrao.divisor, inclinacao: graus }, imagens: [cima, baixo] as T.ThumbDoProjeto['imagens'] }
      const ef = T.thumbEfetiva(t, medir)
      const corte = ef.geo.paineis[1]!.corte!
      const caixas = ef.geo.paineis.map((painel, i) => T.cabecaNoQuadro(painel, t.imagens[i]!, ef.enquadramentos[i]!, t.imagens[i]!.rostos![0]!))
      const [cc, cb] = caixas
      const acima = !!cc && cc.y2 <= Math.min(T.emendaNoX(corte, cc.x1), T.emendaNoX(corte, cc.x2)) + 0.5
      const abaixo = !!cb && cb.y1 >= Math.max(T.emendaNoX(corte, cb.x1), T.emendaNoX(corte, cb.x2)) - 0.5
      const semAvisoNovo = ef.avisos.every((a) => a.tipo !== 'topo' && a.tipo !== 'base')
      confere(
        acima && abaixo && semAvisoNovo,
        `${nome}, ${graus > 0 ? '+' : ''}${graus}: a cabeca de cima acima da emenda no x dela (base ${Math.round(cc?.y2 ?? 0)}, emenda ${Math.round(Math.min(T.emendaNoX(corte, cc?.x1 ?? 0), T.emendaNoX(corte, cc?.x2 ?? 0)))}), a de baixo abaixo (topo ${Math.round(cb?.y1 ?? 0)}, emenda ${Math.round(Math.max(T.emendaNoX(corte, cb?.x1 ?? 0), T.emendaNoX(corte, cb?.x2 ?? 0)))})`,
      )
    }
  }
  // Os avisos de sempre: a cabeca arrastada para a faixa proibida avisa igual, inclinada.
  {
    const colada = { origem: 'arquivo' as const, arquivo: 'x.png', t: 0, largura: 854, altura: 480, rostos: [{ x: 0.45, y: 0, w: 0.1, h: 0.2, conf: 0.9 }], enquadramento: null }
    const ef = T.thumbEfetiva({ ...padrao, divisor: { ...padrao.divisor, inclinacao: -8 }, imagens: [colada, null] }, medir)
    confere(ef.avisos.some((a) => a.texto.includes('faixa proibida de cima')), 'inclinada: a cabeca colada no topo ainda avisa a faixa proibida (os avisos de hoje)')
  }
}

function T_ok(t: unknown): boolean {
  return typeof t === 'object' && t !== null && 'imagens' in t
}

principal().catch((e) => {
  console.error(e)
  process.exit(1)
})
