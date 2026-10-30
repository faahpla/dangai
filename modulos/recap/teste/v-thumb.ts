/**
 * [recap] O GERADOR DE THUMBNAIL sem app e sem navegador:
 *
 * - o puro (shared/thumb.ts): as 2 linhas, os degrades do PSD (branco e
 *   roxo exatos), a geometria (corpo 182, esticada, a linha comprida encolhe
 *   SO ela, a emenda no meio do bloco, as faixas 19-81%), o enquadramento
 *   automatico (cabeca fora das faixas proibidas e o texto fora dos olhos,
 *   com o rosto real do Black Clover S02E04), os avisos, a seta (acima do
 *   texto, comprida como nas refs), as sugestoes (o GANCHO sempre primeiro,
 *   uma por cena, ~8) e o padrao (gancho com o rosto mais forte em cima);
 * - o main (electron/thumb.ts): o quadro em cache (imagem e video, pelo
 *   ffmpeg), o recorte do painel no tamanho exato (lanczos e, com o modelo
 *   do nucleo, o upscale 4x antes de reduzir), o salvar que nunca sobrescreve
 *   sem perguntar (PNG torto ou de outro tamanho recusado), o upload copiado
 *   para a pasta do projeto, os rostos pelo motor (falso) com cache, e as
 *   sugestoes sem indice;
 * - o store (src/store/thumb.ts): o padrao vindo do roteiro e das sugestoes,
 *   o projeto gravado em `modulos.recap.thumb`, reabrir continuando, o
 *   quadro do video LIMPO (a cena de origem, nao o MP4 com legenda), o
 *   inverter (reenquadra as duas e a seta volta ao rosto);
 * - a tela (SSR): abas, botoes e textos em ASCII.
 *
 * Nao substitui o print do app. Rodar da raiz:
 *   npx esbuild modulos/recap/teste/v-thumb.ts --bundle --platform=node --packages=external --jsx=automatic --tsconfig=tsconfig.web.json --define:import.meta.env.DEV=false --loader:.ttf=empty --log-level=error | node
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Nucleo } from '@/modulos/nucleo'
import type { ContextoDoModulo } from '../../../electron/modulos'

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

/** O rosto que o motor achou no 0360.mp4 do Black Clover S02E04 (o close do Asta no gancho). */
const ROSTO_ASTA = { x: 0.3904, y: 0.2523, w: 0.1431, h: 0.2671, conf: 0.83 }
/** O do 0334.mp4 (o Licht, rosto medio). */
const ROSTO_LICHT = { x: 0.4028, y: 0.2592, w: 0.2007, h: 0.3, conf: 0.67 }
/** O close enorme do 0353.mp4 (o rosto passa de metade do quadro). */
const ROSTO_ENORME = { x: 0.394, y: 0.241, w: 0.3056, h: 0.606, conf: 0.8 }
const QUADRO = { largura: 854, altura: 480 }

/** O medidor falso: a Luckiest Guy tem a maiuscula em ~70% do corpo e letras de ~0,58 corpo. */
const medir = (texto: string, px: number) => ({ largura: texto.length * px * 0.58, cap: px * 0.7 })

async function principal(): Promise<void> {
  const T = await import('../shared/thumb')

  console.log('\n== o texto e as cores')
  confere(T.partirEmDuasLinhas('fusao demoniaca').join('|') === 'FUSAO|DEMONIACA', 'duas palavras: uma por linha, em CAIXA ALTA')
  confere(T.partirEmDuasLinhas('ele despertou o maior poder').join('|') === 'ELE DESPERTOU|O MAIOR PODER', 'a quebra que deixa as linhas parecidas')
  confere(T.partirEmDuasLinhas('ASTA').join('|') === 'ASTA|' && T.partirEmDuasLinhas('  ').join('|') === '|', 'uma palavra: linha 2 vazia; nada: vazias')
  const branco = T.degradeDaCor('#ffffff')
  confere(branco.map((p) => `${p.em}:${p.cor}`).join(' ') === '0:#ffffff 0.81:#f3f3f3 1:#e7e7e7', 'branco: o degrade do PSD (255 / 243 a 19% de baixo / 231)')
  const roxo = T.degradeDaCor('#A654F2')
  confere(roxo.map((p) => p.cor).join(' ') === '#cfa8ff #a654f2 #7d00e5', 'roxo: o degrade do PSD (207,168,255 / 166,84,242 / 125,0,229)')
  const verde = T.degradeDaCor('#39f05a')
  const luz = (hex: string): number => {
    const n = Number.parseInt(hex.slice(1), 16)
    return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)
  }
  confere(verde.length === 3 && luz(verde[0]!.cor) > luz('#39f05a') && luz(verde[2]!.cor) < luz('#39f05a'), 'cor a mao: topo mais claro, base mais escura')
  confere(T.degradeDaCor('lixo')[0]?.cor === '#ffffff', 'cor torta: o branco')

  console.log('\n== a geometria')
  const geo2 = T.geometriaDaThumb({ layout: 'duas', linhas: ['poder', 'supremo'], textoY: null }, medir)
  const [l1, l2] = geo2.linhas
  confere(l1?.px === T.CORPO_PX && l2?.px === T.CORPO_PX, 'as duas linhas no corpo do PSD (182) quando cabem')
  confere(Math.abs((l1?.cap ?? 0) - 182 * 0.7 * T.ESTICADA_Y) < 0.01, 'a esticada vertical de 1,11x na altura da letra')
  const centro = geo2.bloco ? (geo2.bloco.topo + geo2.bloco.base) / 2 : 0
  confere(Math.abs(centro - 0.515 * T.ALTURA) < 0.5 && geo2.emenda === Math.round(centro), 'duas imagens: o bloco em 52% e a emenda no meio dele')
  const [cima, baixo] = geo2.paineis
  confere(
    !!cima && !!baixo && cima.faixa.de === 0.19 * T.ALTURA && cima.faixa.ate < geo2.bloco!.topo && baixo.faixa.de > geo2.bloco!.base && Math.abs(baixo.faixa.ate - 0.81 * T.ALTURA) < 0.01,
    'as faixas do rosto: 16%+3% ate o texto (cima), do texto ate 84%-3% (baixo)',
  )
  const longa = T.geometriaDaThumb({ layout: 'duas', linhas: ['cancelou', 'encontro magico'], textoY: 0.5 }, medir)
  confere(
    longa.linhas[0]!.px === T.CORPO_PX && longa.linhas[1]!.px < T.CORPO_PX && longa.linhas[1]!.largura + 2 * longa.linhas[1]!.contorno <= T.LARGURA * T.LARGURA_UTIL + 0.5,
    'linha comprida: SO ela encolhe, ate caber na largura util',
  )
  const uma = T.geometriaDaThumb({ layout: 'uma', linhas: ['poder', ''], textoY: 0.6 }, medir)
  confere(uma.paineis.length === 1 && uma.emenda === null && uma.linhas.length === 1, 'uma imagem: um painel, sem emenda; linha vazia nao desenha')
  confere(T.geometriaDaThumb({ layout: 'duas', linhas: ['', ''], textoY: null }, medir).bloco === null, 'sem texto: sem bloco')

  console.log('\n== o enquadramento automatico (rostos reais do S02E04)')
  const proibidoTopo = T.ZONA_PROIBIDA_TOPO * T.ALTURA
  const proibidoBase = T.ZONA_PROIBIDA_BASE * T.ALTURA
  const naThumb = (img: { rostos: typeof ROSTO_ASTA[] }, layout: 'uma' | 'duas', slot: 0 | 1, textoY: number | null = null) => {
    const imagens: [T.ImagemDaThumb | null, T.ImagemDaThumb | null] = [null, null]
    imagens[slot] = { origem: 'cena', arquivo: 'x.mp4', t: 0, ...QUADRO, rostos: img.rostos, enquadramento: null }
    const t = { ...T.thumbPadrao('PODER SUPREMO'), layout, imagens, textoY }
    const ef = T.thumbEfetiva(t, medir)
    const painel = ef.geo.paineis[slot]!
    const r = img.rostos[0]!
    const c = T.cabecaNoQuadro(painel, { ...QUADRO }, ef.enquadramentos[slot]!, r)!
    const h = c.rosto.y2 - c.rosto.y1
    return { ef, c, olhos: c.rosto.y1 + 0.6 * h, painel }
  }
  const a = naThumb({ rostos: [ROSTO_ASTA] }, 'duas', 0)
  confere(a.c.y1 >= proibidoTopo && a.olhos < a.ef.geo.bloco!.topo, `o close do Asta em cima: cabeca abaixo de 13% (${Math.round(a.c.y1)}) e olhos acima do texto`)
  confere(a.ef.avisos.length === 0, 'nenhum aviso')
  const b = naThumb({ rostos: [ROSTO_LICHT] }, 'duas', 1)
  confere(b.c.y1 >= b.ef.geo.bloco!.base - 1 && b.c.rosto.y2 <= proibidoBase, `o Licht embaixo: abaixo do texto e acima de 87% (${Math.round(b.c.y1)}-${Math.round(b.c.rosto.y2)})`)
  const enorme = naThumb({ rostos: [ROSTO_ENORME] }, 'duas', 1)
  confere(enorme.ef.avisos.some((x) => x.tipo === 'base'), 'o close enorme embaixo nao cabe: o aviso da faixa de baixo (nao esconde)')
  const semRosto = T.enquadrarSozinho(a.painel, QUADRO, [], 'cima')
  confere(semRosto.zoom === 1 && semRosto.cx === 0.5 && semRosto.cy === 0.5, 'sem rosto: o meio da imagem, sem zoom')
  const preso = T.enquadramentoPreso(a.painel, QUADRO, { zoom: 1, cx: 0, cy: 0 })
  const rec = T.recorteDaImagem(a.painel, QUADRO, preso)
  confere(rec.sx === 0 && rec.sy === 0 && rec.sw <= QUADRO.largura && rec.sh <= QUADRO.altura, 'o enquadramento preso: a imagem sempre cobre o painel')
  // Ele arrasta a imagem de cima para cima: a cabeca entra na faixa proibida.
  const arrastada = { ...T.thumbPadrao('PODER SUPREMO'), imagens: [{ origem: 'cena' as const, arquivo: 'x', t: 0, ...QUADRO, rostos: [ROSTO_ASTA], enquadramento: { zoom: 1, cx: 0.5, cy: 1 } }, null] as T.ThumbDoProjeto['imagens'] }
  const avisos = T.thumbEfetiva(arrastada, medir).avisos
  confere(avisos.some((x) => x.tipo === 'topo' && x.texto.includes('0-13%')) && avisos.every((x) => ascii(x.texto)), 'arrastou a cabeca para o topo: o aviso da faixa de cima (ASCII)')

  console.log('\n== a seta')
  const seta = a.ef.seta!
  const L = Math.hypot(seta.ponta.x - seta.base.x, seta.ponta.y - seta.base.y)
  confere(seta.ponta.y < a.ef.geo.bloco!.topo && seta.base.x < (T.LARGURA - a.ef.geo.linhas[0]!.largura) / 2, 'sai da esquerda do texto e a ponta fica ACIMA dele')
  confere(L >= 300 && seta.lado === 1, `comprida como nas refs (${Math.round(L)} px), curvando para a esquerda`)
  const contorno = T.contornoDaSeta(seta)
  confere(contorno.length === 2 * 29 + 3 && contorno.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), 'o contorno: corpo curvo + cabeca (61 pontos)')
  const desligada = T.thumbEfetiva({ ...arrastada, seta: { ligada: false, base: null, ponta: null } }, medir)
  confere(desligada.seta === null, 'desligada: sem seta')
  const movida = T.thumbEfetiva({ ...arrastada, seta: { ligada: true, base: { x: 900, y: 900 }, ponta: { x: 600, y: 500 } } }, medir).seta
  confere(movida?.base.x === 900 && movida.ponta.y === 500 && movida.lado === -1, 'as pontas que ele arrastou valem (e a curva espelha)')

  console.log('\n== as sugestoes')
  const cand = (plano: string, ordem: number, gancho: boolean, rostos: (typeof ROSTO_ASTA)[] | null, beleza = 5): T.CandidatoDaThumb => ({
    chave: `${plano}|${ordem}`,
    plano,
    ordem,
    gancho,
    rostos,
    beleza,
    nitidez: 100,
    expressao: false,
    noTrecho: true,
  })
  const lista = [
    cand('0360', 0, true, [{ ...ROSTO_ASTA, w: 0.05 }], 3),
    cand('0367', 1, true, null, 2),
    ...Array.from({ length: 10 }, (_, i) => cand(`1${i}`, i + 2, false, [{ ...ROSTO_LICHT, w: 0.05 + i * 0.02 }], 5 + (i % 3))),
    cand('10', 30, false, [{ ...ROSTO_LICHT, w: 0.3 }], 9),
  ]
  const escolhidas = T.escolherSugestoes(lista)
  confere(escolhidas.length === 8, '~8 sugestoes')
  confere(escolhidas[0]?.candidato.plano === '0360' && escolhidas[1]?.candidato.plano === '0367', 'as cenas do GANCHO primeiro, na ordem do video, mesmo sem rosto e com nota baixa')
  confere(new Set(escolhidas.map((e) => e.candidato.plano)).size === 8, 'uma vez por cena')
  const resto = escolhidas.slice(2).map((e) => e.nota)
  confere(resto.every((n, i) => i === 0 || n <= resto[i - 1]!), 'o resto da maior nota para a menor')
  confere(escolhidas.find((e) => e.candidato.plano === '10')?.candidato.ordem === 30, 'a cena repetida vale pelo melhor quadro dela')
  const ganchoDepois = T.escolherSugestoes([cand('A', 5, false, [ROSTO_LICHT], 9), cand('A', 0, true, null, 1)])
  confere(ganchoDepois[0]?.candidato.gancho === true && ganchoDepois[0].candidato.ordem === 0, 'a cena do gancho que aparece de novo depois: vale como gancho')
  const [pCima, pBaixo] = T.imagensPadrao([
    { candidato: cand('G1', 0, true, [{ ...ROSTO_ASTA, w: 0.1 }]), nota: 3 },
    { candidato: cand('G2', 1, true, [ROSTO_ASTA]), nota: 2 },
    { candidato: cand('E', 2, false, [ROSTO_ENORME]), nota: 9 },
    { candidato: cand('M', 3, false, [ROSTO_LICHT]), nota: 5 },
  ])
  confere(pCima?.candidato.plano === 'G2', 'padrao em cima: a cena do gancho com o rosto mais forte')
  confere(pBaixo?.candidato.plano === 'M', 'padrao embaixo: a melhor das outras cujo rosto cabe (o close enorme fica de fora)')

  console.log('\n== o projeto')
  const padrao = T.thumbPadrao('Sacrificio total')
  confere(T.thumbDoProjeto(padrao) !== null && padrao.linhas.join('|') === 'SACRIFICIO|TOTAL' && padrao.cores.join('|') === '#ffffff|#fffd00', 'o padrao: texto do roteiro em 2 linhas, branco e amarelo')
  confere(padrao.fonte === 'luckiest' && padrao.layout === 'duas' && padrao.seta.ligada, 'Luckiest Guy, 2 imagens, seta ligada')
  confere(T.thumbDoProjeto({ ...padrao, versao: 2 }) === null && T.thumbDoProjeto({ ...padrao, cores: ['red', '#fff'] }) === null, 'thumb que nao confere: null (a tela comeca do padrao)')
  const { recapDoProjeto } = await import('../shared/projeto-do-recap')
  const recapComThumbTorta = recapDoProjeto({ recap: { ...RECAP, thumb: { lixo: 1 } } })
  confere(recapComThumbTorta !== null, 'uma thumb torta nao derruba o resto do recap no projeto')
  confere(T.nomeDaThumb('C:\\v\\X S02E04-short.mp4') === 'C:\\v\\X S02E04-short-thumb.png' && T.nomeDaThumb('/v/a.b.mp4', 3) === '/v/a.b-thumb-3.png', 'o nome: <video>-thumb.png (e -thumb-N.png)')

  await testarMain(T)
  await testarStore(T)
  console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`)
  process.exit(falhas === 0 ? 0 : 1)
}

const RECAP = {
  versao: 1,
  rascunhoId: 'rc_74f1eb9c0520_mvmn3ube',
  episodioId: `ep_${'7'.repeat(40)}`,
  takeId: 't1',
  roteiroVersao: 1,
  vozAlinhada: true,
  geradoEm: '2026-10-30T10:00:00.000Z',
  secoes: [{ id: 's1', papel: 'gancho', inicio: 0, fim: 6, frases: [{ id: 'f1', inicio: 0, fim: 2.7, personagens: [] }] }],
}

async function testarMain(T: typeof import('../shared/thumb')): Promise<void> {
  console.log('\n== o main (electron/thumb.ts)')
  const pasta = mkdtempSync(join(tmpdir(), 'dangai-v-thumb-'))
  try {
    const { guardarContexto } = await import('../electron/contexto')
    guardarContexto({ id: 'recap', pasta: () => join(pasta, 'local') } as unknown as ContextoDoModulo)
    const M = await import('../electron/thumb')
    const sharp = (await import('sharp')).default
    const { ffmpegPath } = await import('../electron/ffmpeg-path')

    // Uma imagem 16:9 e um video de 2 s (o ffmpeg do app).
    const imagem = join(pasta, 'quadro.png')
    await sharp({ create: { width: 854, height: 480, channels: 3, background: { r: 200, g: 40, b: 60 } } }).png().toFile(imagem)
    const video = join(pasta, 'cena.mp4')
    spawnSync(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=854x480:rate=24:duration=2', '-pix_fmt', 'yuv420p', video], { windowsHide: true })
    confere(existsSync(video), 'o video de teste (ffmpeg)')

    const q = await M.quadroDaThumb({ arquivo: video, t: 1 })
    confere(q.largura === 854 && q.altura === 480 && q.previa[0] === 0xff && q.previa[1] === 0xd8, 'o quadro do video: o tamanho de verdade e a previa em JPEG')
    const depoisDoFim = await M.quadroEmCache(video, 5)
    confere(existsSync(depoisDoFim), 'instante depois do fim: tenta antes (nao quebra)')
    const qi = await M.quadroDaThumb({ arquivo: imagem, t: 7 })
    confere(qi.largura === 854 && qi.altura === 480, 'imagem: ela mesma (o t nao importa)')
    confere((await M.quadroEmCache(imagem, 0)) === (await M.quadroEmCache(imagem, 3)), 'a mesma imagem: o mesmo quadro em cache')
    const sumiu = await M.quadroEmCache(join(pasta, 'sumiu.mp4'), 0).then(
      () => '',
      (e: Error) => e.message,
    )
    confere(sumiu.includes('nao esta mais no lugar'), 'arquivo que sumiu: o recado')

    console.log('\n== o recorte do painel (lanczos e upscale)')
    const r1 = await M.recorteDaThumb({ arquivo: imagem, t: 0, sx: 100, sy: 0, sw: 541, sh: 480, largura: 1080, altura: 960 })
    const m1 = await sharp(Buffer.from(r1.png)).metadata()
    confere(m1.width === 1080 && m1.height === 960, 'o painel sai no tamanho exato (1080x960)')
    const { configureUpscale } = await import('../../../electron/services/upscale')
    const modelo = join(process.cwd(), 'assets', 'upscale')
    if (existsSync(join(modelo, 'realesr-animevideov3.onnx'))) {
      confere(r1.ampliado === false && M.temUpscale() === false, 'sem o modelo configurado: so o lanczos')
      configureUpscale(modelo)
      const inicio = Date.now()
      const r2 = await M.recorteDaThumb({ arquivo: imagem, t: 0, sx: 300, sy: 200, sw: 135, sh: 120, largura: 540, altura: 480 })
      const m2 = await sharp(Buffer.from(r2.png)).metadata()
      confere(r2.ampliado === true && m2.width === 540 && m2.height === 480, `com o modelo do nucleo: upscale 4x e depois reduz (${Date.now() - inicio} ms)`)
      const r3 = await M.recorteDaThumb({ arquivo: imagem, t: 0, sx: 0, sy: 0, sw: 854, sh: 480, largura: 540, altura: 304 })
      confere(r3.ampliado === false, 'o painel menor que a janela da fonte: so reduz (sem o modelo)')
    } else {
      console.log('  (sem assets/upscale: o teste do modelo fica de fora)')
    }

    console.log('\n== o salvar')
    const pronto = join(pasta, 'Recap-short.mp4')
    writeFileSync(pronto, Buffer.alloc(16))
    const png = new Uint8Array(await sharp({ create: { width: 1080, height: 1920, channels: 4, background: '#123456' } }).png().toBuffer())
    const s1 = await M.salvarThumb({ video: pronto, png, modo: 'perguntar' })
    confere('salvo' in s1 && s1.salvo === join(pasta, 'Recap-short-thumb.png') && existsSync(s1.salvo), 'grava <video>-thumb.png ao lado do video')
    const s2 = await M.salvarThumb({ video: pronto, png, modo: 'perguntar' })
    confere('existe' in s2, 'ja existe: NAO sobrescreve, pergunta')
    const s3 = await M.salvarThumb({ video: pronto, png, modo: 'novo' })
    confere('salvo' in s3 && s3.salvo.endsWith('Recap-short-thumb-2.png'), '"Salvar outra": -thumb-2.png')
    writeFileSync(join(pasta, 'Recap-short-thumb.png'), 'velho')
    const s4 = await M.salvarThumb({ video: pronto, png, modo: 'substituir' })
    confere('salvo' in s4 && readFileSync(s4.salvo).length === png.length, '"Substituir": grava por cima')
    const torto = await M.salvarThumb({ video: pronto, png: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), modo: 'substituir' }).then(
      () => '',
      (e: Error) => e.message,
    )
    const pequeno = new Uint8Array(await sharp({ create: { width: 100, height: 100, channels: 3, background: '#000' } }).png().toBuffer())
    const outro = await M.salvarThumb({ video: pronto, png: pequeno, modo: 'substituir' }).then(
      () => '',
      (e: Error) => e.message,
    )
    confere(torto.includes('PNG') && outro.includes('1080x1920'), 'nao PNG ou outro tamanho: recusa')

    console.log('\n== o upload vai para a pasta do projeto')
    const projeto = join(pasta, 'projeto')
    mkdirSync(projeto)
    const fora = join(pasta, 'fora', 'minha imagem.png')
    mkdirSync(join(pasta, 'fora'))
    writeFileSync(fora, readFileSync(imagem))
    const c1 = M.copiarParaOProjeto(fora, projeto)
    confere(c1 === join(projeto, 'thumb', 'minha imagem.png') && existsSync(c1), 'copiada para <projeto>/thumb')
    confere(M.copiarParaOProjeto(fora, projeto) === c1, 'a mesma imagem de novo: a mesma copia')
    writeFileSync(fora, 'outra')
    confere(M.copiarParaOProjeto(fora, projeto) === join(projeto, 'thumb', 'minha imagem-2.png'), 'outra com o mesmo nome: -2')
    confere(M.copiarParaOProjeto(fora, null) === fora, 'sem pasta de projeto: o caminho original')

    console.log('\n== os rostos (motor falso) e as sugestoes sem indice')
    let chamadas = 0
    const motorFalso = (async (itens: { chave: string }[]) => {
      chamadas += 1
      return {
        resultados: new Map(
          itens.map((it) => [
            it.chave,
            {
              largura: 854,
              altura: 480,
              quadros: [{ t: 0, ok: true, rostos: [{ x: 333, y: 121, w: 122, h: 128, conf: 0.83, tipo: 'rosto', personagem: null, pessoa: null, sim: null, quem: null }, { x: 10, y: 10, w: 50, h: 50, conf: 0.9, tipo: 'cabeca', personagem: null, pessoa: null, sim: null, quem: null }] }],
            },
          ]),
        ),
        falha: null,
      }
    }) as never
    const achou = await M.rostosDasImagens([imagem], motorFalso)
    const r = achou.rostos.get(imagem)
    confere(achou.detector === 'motor' && r?.length === 1 && Math.abs(r[0]!.x - 333 / 854) < 1e-6, 'o motor: so os ROSTOS (a cabeca sem rosto fica de fora), em fracao')
    await M.rostosDasImagens([imagem], motorFalso)
    confere(chamadas === 1, 'a segunda vez vem do cache (o motor nao roda de novo)')
    const sug = await M.sugestoesDaThumb(
      {
        episodioId: null,
        rascunhoId: null,
        cenas: [
          { arquivo: video, de: 0, ate: 1, ordem: 0, gancho: true },
          { arquivo: imagem, de: 0, ate: 1, ordem: 1, gancho: false },
          { arquivo: join(pasta, 'sumiu.mp4'), de: 0, ate: 1, ordem: 2, gancho: false },
        ],
      },
      motorFalso,
    )
    confere(sug.sugestoes.length === 2 && sug.sugestoes[0]?.gancho === true && sug.sugestoes[0].arquivo === video, 'sem indice: o quadro do meio de cada cena, o gancho primeiro; a que sumiu fica de fora')
    confere(sug.sugestoes.every((s) => s.miniatura.length > 100 && s.rostos?.length === 1 && ascii(s.rotulo)), 'cada uma com a miniatura e os rostos')
    void T
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

async function testarStore(T: typeof import('../shared/thumb')): Promise<void> {
  console.log('\n== o store e a tela')
  const blob = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  const pedidosDeQuadro: { arquivo: string; t: number }[] = []
  let sugestoesPedidas = 0
  const sugestoes = [
    { arquivo: 'C:/ep/shots/0360.mp4', t: 1.5, largura: 854, altura: 480, rostos: [ROSTO_ASTA], gancho: true, nota: 3, ordem: 0, miniatura: blob, rotulo: 'Cena 0360' },
    { arquivo: 'C:/ep/shots/0367.mp4', t: 0.5, largura: 854, altura: 480, rostos: [], gancho: true, nota: 1, ordem: 1, miniatura: blob, rotulo: 'Cena 0367' },
    { arquivo: 'C:/ep/shots/0353.mp4', t: 1, largura: 854, altura: 480, rostos: [ROSTO_ENORME], gancho: false, nota: 6, ordem: 5, miniatura: blob, rotulo: 'Cena 0353' },
    { arquivo: 'C:/ep/shots/0334.mp4', t: 2, largura: 854, altura: 480, rostos: [ROSTO_LICHT], gancho: false, nota: 5, ordem: 7, miniatura: blob, rotulo: 'Cena 0334' },
  ]
  Reflect.set(globalThis, 'window', {
    devicePixelRatio: 1,
    dangai: {
      revealFile: async () => ({ ok: true, value: undefined }),
      modulos: {
        recap: {
          sugestoesDaThumb: async () => {
            sugestoesPedidas += 1
            return { ok: true, value: { sugestoes, detector: 'motor' } }
          },
          quadroDaThumb: async (p: { arquivo: string; t: number }) => {
            pedidosDeQuadro.push(p)
            return { ok: true, value: { largura: 854, altura: 480, previa: blob } }
          },
          rostosDaThumb: async () => ({ ok: true, value: { rostos: [ROSTO_LICHT], detector: 'motor' } }),
          upscaleDaThumb: async () => ({ ok: true, value: true }),
        },
      },
    },
  })
  // Sem DOM: o createImageBitmap falha (a previa fica sem bitmap) e o resto segue.
  Reflect.set(globalThis, 'createImageBitmap', async () => {
    throw new Error('sem DOM')
  })
  const { guardarNucleo } = await import('../src/nucleo')
  const { usePosRender } = await import('../src/store/pos-render')
  const { useThumb, cenaNoInstante, gravarThumbPendente } = await import('../src/store/thumb')
  const gravacoes: unknown[] = []
  const estado = {
    projectPath: 'C:/proj/Recap.dangai',
    modulos: { recap: RECAP } as Record<string, unknown>,
    images: [
      { path: 'C:/ep/shots/0360.mp4' },
      { path: 'C:/ep/shots/0367.mp4' },
      { path: 'C:/ep/shots/0335.mp4' },
      { path: 'C:/ep/shots/0336.mp4' },
    ],
    plan: {
      scenes: [
        { imageIndex: 0, imageIndexB: null, start: 0, end: 1.85, sourceStart: 0 },
        { imageIndex: 1, imageIndexB: null, start: 1.85, end: 2.7, sourceStart: 0.25 },
        { imageIndex: 2, imageIndexB: 3, start: 2.7, end: 5, sourceStart: 0.5, sourceStartB: 1 },
      ],
    },
  }
  guardarNucleo({
    ler: () => estado,
    usar: <T>(sel: (s: typeof estado) => T) => sel(estado),
    gravarNoProjeto: (dados: unknown) => {
      gravacoes.push(dados)
      estado.modulos = { ...estado.modulos, recap: dados }
    },
  } as unknown as Nucleo)
  usePosRender.setState({ aberta: true, outputPath: 'C:/proj/Recap-short.mp4', projetoPath: 'C:/proj/Recap.dangai', thumbs: ['Sacrificio total', 'Asta chegou?!'] })
  const s = () => useThumb.getState()

  await s().iniciar()
  await esperar(50)
  const t0 = s().thumb!
  confere(t0.linhas.join('|') === 'SACRIFICIO|TOTAL', 'sem thumb no projeto: o 1o texto de thumb do roteiro, em 2 linhas')
  confere(sugestoesPedidas === 1 && s().sugestoes?.length === 4 && s().sugestoes?.[0]?.noVideo === 0, 'as sugestoes chegam com o instante delas no video')
  confere(t0.imagens[0]?.arquivo.endsWith('0360.mp4') === true && t0.imagens[0]?.gancho === true, 'em cima: a cena do gancho com o rosto mais forte')
  confere(t0.imagens[1]?.arquivo.endsWith('0334.mp4') === true, 'embaixo: a melhor das outras que cabe (nao o close enorme)')
  gravarThumbPendente()
  const gravada = (estado.modulos.recap as { thumb?: unknown }).thumb
  confere(T.thumbDoProjeto(gravada) !== null && (estado.modulos.recap as { rascunhoId: string }).rascunhoId === RECAP.rascunhoId, 'fica no projeto (modulos.recap.thumb), sem perder o resto do recap')

  s().mudar({ linhas: ['poder', 'supremo'] })
  s().mudar({ cores: ['#ffffff', '#a654f2'] })
  s().mudar({ textoY: 0.5 })
  const antes = gravacoes.length
  gravarThumbPendente()
  confere(gravacoes.length === antes + 1, 'os toques seguidos viram UM passo de Ctrl+Z')

  // O quadro do video: a cena de ORIGEM no instante (nunca o MP4 com a legenda).
  const c1 = cenaNoInstante(1)
  const c2 = cenaNoInstante(3.2)
  confere(c1?.a.arquivo.endsWith('0360.mp4') === true && c1.a.t === 1 && c1.b === null, 'instante 1 s: o 0360.mp4 em 1 s')
  confere(c2?.a.arquivo.endsWith('0335.mp4') === true && Math.abs(c2.a.t - 1) < 1e-9 && c2.b?.arquivo.endsWith('0336.mp4') === true && Math.abs(c2.b.t - 1.5) < 1e-9, 'no grid: as duas metades, cada uma com o ponto dela')
  s().escolherSlot(1)
  await s().usarQuadroDoVideo(3.2, 'b')
  await esperar(20)
  const doVideo = s().thumb!.imagens[1]!
  confere(doVideo.arquivo.endsWith('0336.mp4') && !doVideo.arquivo.includes('Recap-short') && doVideo.origem === 'video', 'o quadro vem da cena de origem, nao do video pronto')
  confere(pedidosDeQuadro.some((p) => p.arquivo.endsWith('0336.mp4')), 'o main tira o quadro da cena')
  confere(doVideo.rostos?.length === 1, 'e procura o rosto dele')

  // Inverter: cada uma reenquadra na metade nova e a seta volta ao rosto.
  s().enquadrar(0, { zoom: 2, cx: 0.4, cy: 0.4 })
  s().mudar({ seta: { ligada: true, base: { x: 100, y: 900 }, ponta: { x: 400, y: 500 } } })
  const [ca, cb] = s().thumb!.imagens
  s().inverter()
  const inv = s().thumb!
  confere(inv.imagens[0]?.arquivo === cb?.arquivo && inv.imagens[1]?.arquivo === ca?.arquivo, 'inverter: a de baixo sobe, a de cima desce')
  confere(inv.imagens[0]?.enquadramento === null && inv.imagens[1]?.enquadramento === null, 'as duas voltam ao enquadramento automatico da metade nova')
  confere(inv.seta.base === null && inv.seta.ponta === null && inv.seta.ligada, 'a seta volta a apontar o rosto da nova de cima')
  gravarThumbPendente()

  // Reabrir o mesmo projeto: continua; outro projeto: comeca do padrao do dele.
  const salvo = JSON.stringify(s().thumb)
  s().limpar()
  await s().iniciar()
  await esperar(20)
  confere(JSON.stringify(s().thumb) === salvo, 'reabrir a tela: a thumb do projeto, como estava')

  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { AjustesDaThumb, RodapeDaThumb } = await import('../src/components/Thumbnail')
  // O zustand desenha o estado INICIAL no servidor: antes, ele recebe o de agora.
  Object.assign(useThumb.getInitialState(), useThumb.getState())
  Object.assign(usePosRender.getInitialState(), usePosRender.getState())
  const html = renderToStaticMarkup(createElement('div', null, createElement(AjustesDaThumb), createElement(RodapeDaThumb, { fechar: () => {} })))
  const textoDaTela = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  for (const rotulo of ['1 imagem', '2 imagens', 'Imagem de cima', 'Imagem de baixo', 'Sugestoes', 'Quadro do video', 'Do computador', 'Linha 1', 'Linha 2', 'Fonte', 'Altura', 'Seta vermelha apontando o rosto', 'Salvar PNG', 'Abrir pasta', 'Fechar', 'Enquadrar sozinho'])
    confere(textoDaTela.includes(rotulo), `a tela tem "${rotulo}"`)
  confere(html.includes('aria-label="Inverter cima e baixo"'), 'o botao de inverter')
  confere(ascii(textoDaTela.replace(/SACRIF.CIO|AT.|CHEGOU\?!/g, '')), 'os textos da tela em ASCII')
}

principal().catch((e) => {
  console.error(e)
  process.exit(1)
})
