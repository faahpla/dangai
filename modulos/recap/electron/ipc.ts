import { dialog } from 'electron'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { ContextoDoModulo } from '../../../electron/modulos'
import { CANAIS as C, type ProvedorDaIa } from '../shared/canais'
import type { ConferenciaDoEnvio, EnvioAutomatico, ResultadoDaVolta, ResultadoDoEnvio } from '../shared/ancut'
import type { ConfigDoRecapNaTela } from '../shared/config'
import {
  indexarEpisodioArgsSchema,
  indexarFalasArgsSchema,
  listaDeExclusoesSchema,
  palpiteDoEpisodioSchema,
  type EpisodeIndex,
  type EpisodioEncontrado,
  type Exclusao,
  type IndexarEpisodioArgs,
  type IndexarFalasArgs,
  type PalpiteDoEpisodio,
  type SondaDoEpisodio,
} from '../shared/episodio'
import {
  pedidoDeReligarSchema,
  pedidoDeRoteiroSchema,
  roteiroSchema,
  type EventosGerados,
  type PedidoDeReligar,
  type PedidoDeRoteiro,
  type ProgressoDoRoteiro,
  type RascunhoAberto,
  type RascunhoDoRecap,
  type ResumoDoRascunho,
  type Roteiro,
  type RoteiroGerado,
  type RoteiroReligado,
} from '../shared/roteiro'
import type { RitmoDaVoz } from '../shared/ritmo'
import {
  configDaVozSchema,
  pedidoDeAjusteSchema,
  pedidoDeEstimativaSchema,
  pedidoDeGeracaoSchema,
  pedidoDeImportacaoSchema,
  pedidoDeRegravarSchema,
  type AudioDoTake,
  type EstimativaDeCusto,
  type PedidoDeAjuste,
  type PedidoDeEstimativa,
  type PedidoDeGeracao,
  type PedidoDeImportacao,
  type PedidoDeRegravar,
  type ProgressoDaVoz,
  type VozGerada,
  type VozInterrompida,
} from '../shared/voz'
import {
  CAMPOS_DE_CHAVE_DA_VOZ,
  type AjustesDaVoz,
  type BibliotecaDoFish,
  type CampoDeChaveDaVoz,
  type TesteDeVoz,
  type VozDoProvedor,
} from '../shared/tipos-da-voz'
import { AUDIO_EXTENSIONS, classifyFile } from '@shared/channels'
import { listarModulos } from '../../../electron/modulos'
import { acharAncut, conferirEnvio, enviarAoAncut, enviarSempreAoAncut, trazerDoAncut, unificarComOAncut } from './ancut/enviar'
import { configNaTela } from './config'
import { indexarFalas } from './episodio/falas'
import { indexarEpisodio, salvarExclusoes } from './episodio/indice'
import { procurarEpisodio } from './episodio/procurar'
import { sondarEpisodio } from './episodio/sondar'
import { gerarEventos } from './gerar/eventos'
import { miniaturasDasCenas } from './gerar/miniaturas'
import {
  abrirRascunho,
  aprovarRoteiro,
  desaprovarRoteiro,
  escolherVersao,
  listarRascunhos,
  salvarRoteiro,
} from './gerar/rascunho'
import { religarRoteiro } from './gerar/religar'
import { cancelarRoteiro, gerarRoteiro } from './gerar/roteiro'
import { lerEstiloNaTela, salvarEstilo } from './gerar/estilo'
import { aplicarRevisao, ignorarRevisao, revisarRoteiro } from './gerar/revisor'
import { NOME_DO_EXEMPLO_MAX, TEXTO_DO_EXEMPLO_MAX, type EstiloNaTela } from '../shared/estilo'
import type { RevisaoFeita } from '../shared/revisao'
import { ritmoDe, ritmoPeloId } from './voz/ritmo'
import { estimarVoz } from './voz/estimar'
import { esperaDaVozFalsa } from './voz/provedor'
import { pedidoInterrompido } from './voz/pedidos'
import { ajustarVoz, cancelarVoz, gerarVoz, importarAudio, regravarFrases } from './voz/gerar'
import { aprovarVoz, audioDoTake, desaprovarVoz, escolherTakeDoRascunho } from './voz/takes'
import { bibliotecaFish, bibliotecaFishFalsa, idDaVozFish, testarEleven, testarFish, testeDeVozFalso, vozDoFishPorId } from './voz-chaves'
import { getSettings } from './settings'
import { z } from 'zod'
import {
  filtrosDeCandidatosSchema,
  listaDeEscolhasSchema,
  pedidoDeMontagemSchema,
  type CandidatosDaFrase,
  type CenasGravadas,
  type EscolhaDaFrase,
  type FiltrosDeCandidatos,
  type PedidoDeMontagem,
  type ProjetoMontado,
} from '../shared/cenas'
import {
  loteDeRostosSchema,
  pedidoDePlanoDeSomSchema,
  type LoteDeRostos,
  type RostosDoLote,
  type MusicaDaPasta,
  type PedidoDePlanoDeSom,
  type PlanoDeSom,
  type SfxDaEdicaoRapida,
} from '../shared/edicao-rapida'
import { candidatosDaFrase, salvarCenas, sugerirCenas } from './cenas'
import { gridDaFrase } from './cenas/grid'
import { mesclasDoEpisodio } from './cenas/mesclas'
import type { PlanoNoMesclado } from '../shared/mesclas'
import { encaixarNaVoz, montagemInterrompida, montarProjeto } from './montar'
import { rostosDosPedacos } from './montar/rostos-motor'
import { pngsDosTextos, telasDoRascunho } from './montar/textos'
import { abrirPosRender, escreverTitulosEThumbs } from './pos-render'
import { pedidoDeTitulosSchema, pedidoDoPosRenderSchema, type TextosDoPosRender, type TitulosNovos } from '../shared/pos-render'
import { pedidoDeTextosSchema, type PedidoDeTextos, type PngDoTexto } from '../shared/textos-na-tela'
import { registrarCanaisDoMotor } from './ipc-motor'
import { registrarCanaisDaMigracao } from './migracao/ipc'
import { escolherMusica, listarMusicas, registrarMusicaUsada } from './som/musicas'
import { planejarSom, sfxDaEdicaoRapida } from './som/planejar'

/**
 * [recap] OS CANAIS DO MODULO no main, os mesmos handlers do ipc.ts do Studio
 * (passos 1 e 2) com o nome novo (`recap:<area>:<acao>`). O que vem do
 * renderer passa pelo zod AQUI: vira arquivo no disco e pedido a IA.
 *
 * Parte 2: o passo 3 (Voz) e as chaves de voz. Parte 3: o passo 4 (Cenas),
 * o "Abrir no editor" e a Edicao rapida. Parte 4: o motor (ipc-motor.ts).
 */
export function registrarCanais(ctx: ContextoDoModulo): void {
  registrarCanaisDoMotor(ctx)
  registrarCanaisDaMigracao(ctx)

  // ------------------------------------------------------------ configuracao

  ctx.handle<[], ConfigDoRecapNaTela>(C.lerConfig, async () => configNaTela(ctx.config().modulo))

  ctx.handle<[unknown], ConfigDoRecapNaTela>(C.salvarConfig, async (patch) => configNaTela(ctx.salvarConfig(patch)))

  ctx.handle<[], string | null>(C.escolherBiblioteca, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Biblioteca do recap',
      properties: ['openDirectory', 'createDirectory'],
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]!
  })

  // A boas-vindas: ha IA para o roteiro? So o nome de quem atende (o nucleo nunca da a chave).
  ctx.handle<[], ProvedorDaIa | null>(C.provedorDaIa, async () => ctx.ia.provedor())

  // ------------------------------------------------- L1: mover para o AnCut
  // A UNICA escrita do recap no AnCut (electron/ancut/enviar.ts), so com o clique.

  ctx.handle<[], boolean>(C.ancutAchado, async () => acharAncut() !== null)

  ctx.handle<[string, boolean], ConferenciaDoEnvio>(C.ancutConferir, async (episodioId, rapido) =>
    conferirEnvio(idDoEpisodio(episodioId), rapido === true),
  )

  ctx.handle<[string, boolean], ResultadoDoEnvio>(C.ancutEnviar, async (episodioId, substituir) =>
    enviarAoAncut(idDoEpisodio(episodioId), substituir === true),
  )

  ctx.handle<[string], ResultadoDoEnvio>(C.ancutUnificar, async (episodioId) => unificarComOAncut(idDoEpisodio(episodioId)))

  ctx.handle<[string], ResultadoDaVolta>(C.ancutTrazer, async (episodioId) => trazerDoAncut(idDoEpisodio(episodioId)))

  ctx.handle<[string, boolean], EnvioAutomatico | null>(C.ancutDepoisDaAnalise, async (episodioId, devolver) =>
    enviarSempreAoAncut(idDoEpisodio(episodioId), { forcar: devolver === true }),
  )

  // ------------------------------------------------------- passo 1 (Episodio)

  ctx.handle<[], string | null>(C.escolherEpisodio, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Escolher o episodio',
      properties: ['openFile'],
      filters: [{ name: 'Episodio', extensions: ['mkv', 'mp4', 'm4v', 'webm', 'mov'] }],
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]!
  })

  ctx.handle<[string], SondaDoEpisodio>(C.sondarEpisodio, async (path) => {
    if (typeof path !== 'string' || !existsSync(path)) throw new Error('Esse arquivo nao esta mais no disco.')
    return sondarEpisodio(path)
  })

  ctx.handle<[string, PalpiteDoEpisodio], EpisodioEncontrado[]>(C.procurarEpisodio, async (path, palpite) =>
    procurarEpisodio(path, palpiteDoEpisodioSchema.parse(palpite)),
  )

  const avisarIndexar = (mensagem: string): void => ctx.enviar(C.indexarProgresso, mensagem)

  ctx.handle<[IndexarEpisodioArgs], EpisodeIndex>(C.indexarEpisodio, async (args) =>
    indexarEpisodio(indexarEpisodioArgsSchema.parse(args), avisarIndexar),
  )

  ctx.handle<[IndexarFalasArgs], EpisodeIndex>(C.indexarFalas, async (args) =>
    indexarFalas(indexarFalasArgsSchema.parse(args), avisarIndexar),
  )

  ctx.handle<[string, Exclusao[]], EpisodeIndex>(C.salvarExclusoes, async (indiceId, exclusoes) =>
    salvarExclusoes(String(indiceId), listaDeExclusoesSchema.parse(exclusoes)),
  )

  // -------------------------------------------------------- passo 2 (Roteiro)
  // Ids viram texto conferido aqui: o rascunhoId vira nome de arquivo no main.

  const progressoDoRoteiro = (p: ProgressoDoRoteiro): void => ctx.enviar(C.roteiroProgresso, p)

  ctx.handle<[string, boolean], RascunhoAberto>(C.abrirRascunho, async (episodioId, novo) =>
    abrirRascunho(idDoEpisodio(episodioId), novo === true),
  )

  ctx.handle<[], ResumoDoRascunho[]>(C.listarRascunhos, () => listarRascunhos())

  ctx.handle<[string], EventosGerados>(C.gerarEventos, async (rascunhoId) =>
    gerarEventos(idDoRascunho(rascunhoId), progressoDoRoteiro),
  )

  ctx.handle<[string, PedidoDeRoteiro], RoteiroGerado>(C.gerarRoteiro, async (rascunhoId, pedido) =>
    gerarRoteiro(idDoRascunho(rascunhoId), pedidoDeRoteiroSchema.parse(pedido), progressoDoRoteiro),
  )

  ctx.handle<[string, string], boolean>(C.cancelarRoteiro, async (rascunhoId, pedidoId) =>
    cancelarRoteiro(idDoRascunho(rascunhoId), String(pedidoId).slice(0, 64)),
  )

  ctx.handle<[string, Roteiro], RascunhoDoRecap>(C.salvarRoteiro, async (rascunhoId, roteiro) =>
    salvarRoteiro(idDoRascunho(rascunhoId), roteiroSchema.parse(roteiro)),
  )

  ctx.handle<[string, number], RascunhoDoRecap>(C.escolherVersao, async (rascunhoId, versao) => {
    if (!Number.isInteger(versao) || versao < 1) throw new Error('Versao invalida.')
    return escolherVersao(idDoRascunho(rascunhoId), versao)
  })

  ctx.handle<[string, Roteiro], RascunhoDoRecap>(C.aprovarRoteiro, async (rascunhoId, roteiro) =>
    aprovarRoteiro(idDoRascunho(rascunhoId), roteiroSchema.parse(roteiro)),
  )

  ctx.handle<[string], RascunhoDoRecap>(C.desaprovarRoteiro, async (rascunhoId) =>
    desaprovarRoteiro(idDoRascunho(rascunhoId)),
  )

  ctx.handle<[string, PedidoDeReligar], RoteiroReligado>(C.religarRoteiro, async (rascunhoId, pedido) =>
    religarRoteiro(idDoRascunho(rascunhoId), pedidoDeReligarSchema.parse(pedido), progressoDoRoteiro),
  )

  // O "Meu estilo" (estilo.ts) e o revisor (revisor.ts), lote 1 das ideias do Levi.
  ctx.handle<[], EstiloNaTela>(C.lerEstilo, async () => lerEstiloNaTela())
  ctx.handle<[unknown], EstiloNaTela>(C.salvarEstilo, async (estilo) => salvarEstilo(estilo))
  ctx.handle<[], { nome: string; texto: string } | null>(C.importarExemplo, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Importar roteiro de exemplo',
      properties: ['openFile'],
      filters: [{ name: 'Texto', extensions: ['txt', 'md'] }],
    })
    const arquivo = r.canceled ? undefined : r.filePaths[0]
    if (!arquivo) return null
    // So texto, e pequeno: um roteiro de 90 s tem uns 1.500 caracteres.
    if (statSync(arquivo).size > 200_000) throw new Error('Arquivo grande demais para um roteiro (mais de 200 KB).')
    const texto = readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '').trim()
    if (!texto) throw new Error('O arquivo esta vazio.')
    return { nome: basename(arquivo, extname(arquivo)).slice(0, NOME_DO_EXEMPLO_MAX), texto: texto.slice(0, TEXTO_DO_EXEMPLO_MAX) }
  })
  ctx.handle<[string, boolean, unknown], RevisaoFeita>(C.revisarRoteiro, async (rascunhoId, automatico, modo) =>
    revisarRoteiro(idDoRascunho(rascunhoId), automatico === true, modo === 'melhorar' ? 'melhorar' : 'corrigir'),
  )
  ctx.handle<[string], RascunhoDoRecap>(C.aplicarRevisao, async (rascunhoId) => aplicarRevisao(idDoRascunho(rascunhoId)))
  ctx.handle<[string, string[]], RascunhoDoRecap>(C.ignorarRevisao, async (rascunhoId, fraseIds) => {
    if (!Array.isArray(fraseIds) || fraseIds.some((id) => typeof id !== 'string' || !/^f\d{2,}$/.test(id))) {
      throw new Error('Lista de frases invalida.')
    }
    return ignorarRevisao(idDoRascunho(rascunhoId), fraseIds)
  })

  ctx.handle<[string, string[]], Record<string, string | null>>(C.miniaturasDasCenas, async (episodioId, planoIds) => {
    if (!Array.isArray(planoIds) || planoIds.some((id) => typeof id !== 'string')) {
      throw new Error('Lista de cenas invalida.')
    }
    return miniaturasDasCenas(idDoEpisodio(episodioId), planoIds)
  })

  // Com a config: o ritmo DELA (a previsao do passo 3). Sem: o do rascunho
  // (o take atual; sem take, o inicial calibrado -- o "~Xs" do roteiro).
  ctx.handle<[string | null, unknown?], RitmoDaVoz>(C.ritmoDaVoz, async (rascunhoId, config) =>
    config
      ? ritmoDe(configDaVozSchema.parse(config))
      : ritmoPeloId(rascunhoId === null ? null : idDoRascunho(rascunhoId)),
  )

  // ---------------------------------------------------------- passo 3 (Voz)
  // Contrato e regras em shared/voz.ts; o motor e electron/voz/. Todo pedido
  // passa pelo zod aqui: vira chamada paga, nome de arquivo e linha de comando
  // do ffmpeg. A chave do provedor fica no main (ctx.chave), nunca vai a tela.

  const progressoDaVoz = (p: ProgressoDaVoz): void => ctx.enviar(C.vozProgresso, p)

  ctx.handle<[string, PedidoDeEstimativa], EstimativaDeCusto>(C.estimarVoz, async (rascunhoId, pedido) =>
    estimarVoz(idDoRascunho(rascunhoId), pedidoDeEstimativaSchema.parse(pedido)),
  )

  ctx.handle<[string, PedidoDeGeracao], VozGerada>(C.gerarVoz, async (rascunhoId, pedido) =>
    gerarVoz(idDoRascunho(rascunhoId), pedidoDeGeracaoSchema.parse(pedido), progressoDaVoz),
  )

  ctx.handle<[string, PedidoDeRegravar], VozGerada>(C.regravarFrases, async (rascunhoId, pedido) =>
    regravarFrases(idDoRascunho(rascunhoId), pedidoDeRegravarSchema.parse(pedido), progressoDaVoz),
  )

  ctx.handle<[string, PedidoDeAjuste], VozGerada>(C.ajustarVoz, async (rascunhoId, pedido) =>
    ajustarVoz(idDoRascunho(rascunhoId), pedidoDeAjusteSchema.parse(pedido), progressoDaVoz),
  )

  ctx.handle<[string, PedidoDeImportacao], VozGerada>(C.importarAudio, async (rascunhoId, pedido) => {
    const conferido = pedidoDeImportacaoSchema.parse(pedido)
    if (classifyFile(conferido.caminho) !== 'audio') {
      throw new Error(`Esse arquivo nao e audio. Use ${AUDIO_EXTENSIONS.join(', ')}.`)
    }
    if (!existsSync(conferido.caminho)) throw new Error('Esse audio nao esta mais no disco.')
    return importarAudio(idDoRascunho(rascunhoId), conferido, progressoDaVoz)
  })

  ctx.handle<[string, string], boolean>(C.cancelarVoz, async (rascunhoId, pedidoId) =>
    cancelarVoz(idDoRascunho(rascunhoId), String(pedidoId).slice(0, 64)),
  )
  // O2: a marca do pedido que o app largou no meio (le e apaga).
  ctx.handle<[string], VozInterrompida | null>(C.vozInterrompida, async (rascunhoId) => pedidoInterrompido(idDoRascunho(rascunhoId)))

  ctx.handle<[string, string], RascunhoDoRecap>(C.escolherTake, async (rascunhoId, takeId) =>
    escolherTakeDoRascunho(idDoRascunho(rascunhoId), idDoTake(takeId)),
  )

  ctx.handle<[string], RascunhoDoRecap>(C.aprovarVoz, async (rascunhoId) => aprovarVoz(idDoRascunho(rascunhoId)))

  ctx.handle<[string], RascunhoDoRecap>(C.desaprovarVoz, async (rascunhoId) => desaprovarVoz(idDoRascunho(rascunhoId)))

  ctx.handle<[string, string], AudioDoTake>(C.urlDoAudio, async (rascunhoId, takeId) =>
    audioDoTake(idDoRascunho(rascunhoId), idDoTake(takeId)),
  )

  ctx.handle<[], string | null>(C.escolherNarracao, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Escolher a narracao gravada',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: [...AUDIO_EXTENSIONS] }],
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]!
  })

  // ------------------------------------------- chaves de voz e voz padrao
  // A chave digitada vem do renderer so para Testar ou Salvar; a salva fica
  // aqui. A tela so ve o `chaves` do ModuloPublico (tem e dica).

  ctx.handle<[], AjustesDaVoz>(C.lerAjustesDaVoz, async () => ajustesDaVoz())

  ctx.handle<[string, string], AjustesDaVoz>(C.salvarChaveDaVoz, async (campo, valor) => {
    if (!CAMPOS_DE_CHAVE_DA_VOZ.includes(campo as CampoDeChaveDaVoz)) throw new Error('Chave desconhecida.')
    const limpa = typeof valor === 'string' ? valor.trim() : ''
    if (limpa.length > 300) throw new Error('Essa chave e grande demais. Confira o que colou.')
    ctx.salvarChave(campo, limpa)
    return ajustesDaVoz()
  })

  // Testar so le plano/saldo e vozes, nao gasta credito.
  ctx.handle<[string | null], TesteDeVoz>(C.testarEleven, async (chave) => {
    // TESTE (O2): com a voz falsa, o plano e as vozes tambem sao falsos (nada sai para a rede).
    if (esperaDaVozFalsa() !== null) return testeDeVozFalso('elevenlabs')
    const usada = (typeof chave === 'string' ? chave.trim() : '') || getSettings().elevenlabsApiKey
    if (!usada) throw new Error('Cole a chave do ElevenLabs antes de testar.')
    return testarEleven(usada)
  })

  ctx.handle<[string | null, string?], TesteDeVoz>(C.testarFish, async (chave, modelo) => {
    if (esperaDaVozFalsa() !== null) return testeDeVozFalso('fish')
    const usada = (typeof chave === 'string' ? chave.trim() : '') || getSettings().fishApiKey
    if (!usada) throw new Error('Cole a chave do Fish Audio antes de testar.')
    return testarFish(usada, typeof modelo === 'string' ? modelo : '')
  })

  // (21/10) A biblioteca publica do Fish e a voz pelo ID: so leitura (GET), com a chave salva.
  const chaveDoFish = (): string => {
    const chave = getSettings().fishApiKey
    if (!chave) throw new Error('Salve a chave do Fish Audio em Configuracoes > Voz.')
    return chave
  }

  ctx.handle<[string], BibliotecaDoFish>(C.bibliotecaFish, async (busca) => {
    const termo = typeof busca === 'string' ? busca : ''
    if (esperaDaVozFalsa() !== null) return bibliotecaFishFalsa(termo)
    return bibliotecaFish(chaveDoFish(), termo)
  })

  ctx.handle<[string], VozDoProvedor>(C.vozDoFish, async (entrada) => {
    const texto = typeof entrada === 'string' ? entrada.slice(0, 300) : ''
    if (esperaDaVozFalsa() !== null) {
      const id = idDaVozFish(texto)
      if (!id) throw new Error('Isso nao parece o ID de uma voz do Fish. Cole o ID (letras e numeros) ou o link fish.audio/m/...')
      return { id, nome: 'Voz colada de teste', detalhe: 'pt', previewUrl: null }
    }
    return vozDoFishPorId(chaveDoFish(), texto)
  })

  // --------------------------------------------------------- passo 4 (Cenas)
  // Contrato em shared/cenas.ts. O casar (cenas/) e por regras, de graca; o
  // encaixe e a montagem moram em montar/.

  ctx.handle<[string, unknown], CenasGravadas>(C.sugerirCenas, async (rascunhoId, variar) => sugerirCenas(idDoRascunho(rascunhoId), variar === true))

  ctx.handle<[string, string, FiltrosDeCandidatos], CandidatosDaFrase>(C.candidatosDaFrase, async (rascunhoId, fraseId, filtros) =>
    candidatosDaFrase(idDoRascunho(rascunhoId), idDaFrase(fraseId), filtrosDeCandidatosSchema.parse(filtros ?? {})),
  )

  ctx.handle<[string, EscolhaDaFrase[]], CenasGravadas>(C.salvarCenas, async (rascunhoId, escolhas) =>
    salvarCenas(idDoRascunho(rascunhoId), listaDeEscolhasSchema.parse(escolhas)),
  )

  ctx.handle<[string], CenasGravadas>(C.encaixarNaVoz, async (rascunhoId) => encaixarNaVoz(idDoRascunho(rascunhoId)))

  ctx.handle<[string, string, boolean, number | undefined], CenasGravadas>(C.gridDaFrase, async (rascunhoId, fraseId, ligar, cena) =>
    gridDaFrase(
      idDoRascunho(rascunhoId),
      idDaFrase(fraseId),
      ligar === true,
      typeof cena === 'number' && Number.isInteger(cena) && cena >= 0 ? cena : undefined,
    ),
  )

  ctx.handle<[string], Record<string, PlanoNoMesclado>>(C.mesclasDoEpisodio, async (episodioId) => mesclasDoEpisodio(idDoEpisodio(episodioId)))

  ctx.handle<[string, PedidoDeMontagem], ProjetoMontado>(C.montarProjeto, async (rascunhoId, pedido) => {
    const id = idDoRascunho(rascunhoId)
    return montarProjeto(id, pedidoDeMontagemSchema.parse(pedido ?? {}), {
      aoAndar: (texto) => ctx.enviar(C.montarProgresso, { rascunhoId: id, texto }),
    })
  })
  ctx.handle<[string], { inicio: string } | null>(C.montagemInterrompida, async (rascunhoId) => montagemInterrompida(idDoRascunho(rascunhoId)))

  // ----------------------------------------------------------- Edicao rapida
  // Contrato em shared/edicao-rapida.ts; o som em som/. O rosto pelo motor
  // (montar/rostos-motor.ts), com o detector antigo do nucleo de reserva.

  ctx.handle<[], MusicaDaPasta[]>(C.listarMusicas, async () => listarMusicas())

  ctx.handle<[string[] | undefined], MusicaDaPasta | null>(C.escolherMusica, async (evitar) =>
    escolherMusica(z.array(z.string().max(1024)).max(50).parse(evitar ?? [])),
  )

  ctx.handle<[string | null, string | null | undefined], true>(C.registrarMusicaUsada, async (path, projeto) =>
    registrarMusicaUsada(
      z.string().min(1).max(1024).nullable().parse(path ?? null),
      z.string().max(1024).nullable().parse(projeto ?? null),
    ),
  )

  ctx.handle<[], SfxDaEdicaoRapida>(C.sfxDaEdicaoRapida, async () => sfxDaEdicaoRapida())

  ctx.handle<[PedidoDePlanoDeSom], PlanoDeSom>(C.planejarSom, async (pedido) => planejarSom(pedidoDePlanoDeSomSchema.parse(pedido)))

  ctx.handle<[LoteDeRostos], RostosDoLote>(C.rostosDosPedacos, async (lote) => rostosDosPedacos(loteDeRostosSchema.parse(lote)))

  // Os textos na tela da Edicao rapida no editor: os PNGs, e os textos de um projeto antigo.
  ctx.handle<[PedidoDeTextos], { pngs: PngDoTexto[]; avisos: string[] }>(C.textosNaTela, async (pedido) =>
    pngsDosTextos(pedidoDeTextosSchema.parse(pedido)),
  )
  ctx.handle<[string, number], Record<string, string | null> | null>(C.telasDoRascunho, async (rascunhoId, versao) =>
    telasDoRascunho(z.string().regex(/^rc_[0-9a-z_]+$/).parse(rascunhoId), z.number().int().positive().parse(versao)),
  )
  // A tela pos-render (a do CapCut): so le o rascunho e publica o video.
  ctx.handle<[unknown], TextosDoPosRender>(C.posRender, async (pedido) => abrirPosRender(pedidoDoPosRenderSchema.parse(pedido)))
  ctx.handle<[unknown], TitulosNovos>(C.titulosDoVideo, async (pedido) => escreverTitulosEThumbs(pedidoDeTitulosSchema.parse(pedido)))
}

/** 'f' + numero, como Frase.id. */
function idDaFrase(valor: unknown): string {
  if (typeof valor !== 'string' || !/^f\d{2,6}$/.test(valor)) throw new Error('Frase invalida.')
  return valor
}

/** O que a tela sabe da voz: das chaves, so o `chaves` do ModuloPublico (tem, dica). */
function ajustesDaVoz(): AjustesDaVoz {
  const chaves = listarModulos().find((m) => m.id === 'recap')?.chaves ?? {}
  // TESTE (O2): com a voz falsa (RECAP_TESTE_VOZ_FALSA) o ElevenLabs aparece com chave; nada sai para a rede.
  const falsa = esperaDaVozFalsa() !== null ? { tem: true, dica: 'teste' } : null
  const eleven = falsa ?? chaves['elevenlabsApiKey'] ?? { tem: false, dica: '' }
  const fish = chaves['fishApiKey'] ?? { tem: false, dica: '' }
  return {
    hasElevenKey: eleven.tem,
    elevenKeyHint: eleven.dica,
    hasFishKey: fish.tem,
    fishKeyHint: fish.dica,
    vozPadrao: getSettings().vozPadrao,
  }
}

/** 't' + numero, como TakeDaVoz.id. */
function idDoTake(valor: unknown): string {
  if (typeof valor !== 'string' || !/^t\d{1,6}$/.test(valor)) throw new Error('Take invalido.')
  return valor
}

/** O id de episodio do indice ('ep_' + sha1). Vira nome de pasta e de arquivo. */
function idDoEpisodio(valor: unknown): string {
  if (typeof valor !== 'string' || !/^ep_[0-9a-f]{40}$/.test(valor)) throw new Error('Episodio invalido.')
  return valor
}

/** O id do rascunho ('rc_...'). Vira nome de arquivo no main. */
function idDoRascunho(valor: unknown): string {
  if (typeof valor !== 'string' || !/^rc_[0-9a-z_]+$/.test(valor)) throw new Error('Rascunho invalido.')
  return valor
}
