import { z } from 'zod'
import {
  ajusteDeCorSchema,
  duckingSchema,
  duracaoDoTrecho,
  DUCKING_PADRAO,
  FORMATOS,
  MOTION_CURVE_DEFAULT,
  type AjusteDeCor,
  type CaptionStyle,
  type Ducking,
} from '@shared/contract'
import type { ProjectFile } from '@shared/project-file'
// So TIPOS daqui para baixo: cenas.ts importa VALORES deste arquivo, e
// roteiro.ts importa (valor) cenas.ts. Um valor de roteiro ou de
// projeto-do-recap aqui fecharia o ciclo cenas -> edicao-rapida -> roteiro ->
// cenas, e o schema de um deles chegaria undefined na hora de carregar.
// [recap] O `papel`/`corOriginal` dos itens moram em `modulos.recap` no
// Dangai; este arquivo trabalha com o item achatado (projeto-do-recap.ts).
import type {
  ClipeDoRecap as SobreposicaoSalva,
  PapelDaTrilha,
  SecaoNoTempo as SecaoDoStudio,
  TrilhaDoRecap as TrechoDeAudioSalvo,
} from './projeto-do-recap'
import type { Evento, Frase, PapelDaSecao, Roteiro } from './roteiro'
import type { TakeDaVoz } from './voz'

/**
 * A EDICAO RAPIDA (pedido do Levi em 14/10): um botao que faz sozinho o que
 * hoje e manual -- efeitos sonoros no estilo dele, musica de fundo com ducking,
 * enquadramento no rosto pelo detector do motor, a legenda com o estilo salvo
 * e (15/10) a COR: uma camada de ajuste no video inteiro com o look dele.
 * Fica no editor (RenderBar) e vem ligada por padrao no "Abrir no editor" do
 * passo 4, para o projeto ja chegar pronto. Tudo continua editavel, e no editor
 * a Edicao rapida inteira e UM passo de Ctrl+Z.
 *
 * Este arquivo e o CONTRATO dos tres lados (ver a tabela de donos no fim):
 *   (A) som: musica, ducking, SFX e mix (electron/services/som/*, render.ts,
 *       preview do audio);
 *   (B) rosto pelo motor (motor/, electron/services/montar/rostos-motor.ts e
 *       foco.ts);
 *   (C) o botao, a opcao no passo 4, o estilo da legenda e as Configuracoes.
 *
 * ONDE O SOM MORA NO PROJETO: nas FAIXAS DE AUDIO (`trilhas`,
 * trechoDeAudioSchema), e nao no `sfxManual` nem na cama `music`. O Dangai
 * desligou os dois ("pode tirar essa track de SFX e deixar so as de audio";
 * o startRender manda `sfxCues: []` e `music: null`, e o migrarSonsAntigos
 * converte o que um projeto antigo tinha em trilhas ao abrir). Cada trecho que
 * a Edicao rapida poe leva `papel` ('musica' | 'whoosh' | 'impacto'), cada
 * papel numa faixa propria (camadas separadas por tipo), com o ARQUIVO INTEIRO
 * como `durationSec` e o pedaco usado em `inicioSec`/`usarSec` (a sobra fica
 * para ele puxar na linha do tempo). Rodar de novo troca so os trechos com
 * `papel`; os dele ficam.
 *
 * TEMPO: tudo em segundos do VIDEO (= da narracao: o video comeca com ela).
 *
 * Funcoes puras: rodam igual no main, no renderer e nos testes (esbuild | node).
 */

// ===================================================================== config

/** O que a Edicao rapida faz. Cada parte liga e desliga sozinha. */
export const configDaEdicaoRapidaSchema = z.object({
  /** Whoosh nas viradas de parte e impacto no comeco do gancho e do climax. */
  sfx: z.boolean().catch(true).default(true),
  /** Musica de fundo sem repetir entre shorts, com ducking pela voz. */
  musica: z.boolean().catch(true).default(true),
  /** Enquadrar cada bloco no rosto (motor YOLO; reserva: o detector antigo). */
  rosto: z.boolean().catch(true).default(true),
  /** A legenda com o estilo salvo dele (settings.captionStyle). */
  legenda: z.boolean().catch(true).default(true),
  /**
   * A cor: uma camada de ajuste no video inteiro, com o "Anime vivo" ou o
   * preset de cor escolhido (preferencias.corPreset). Ligada por padrao: o
   * settings.json de antes (sem o campo) passa a ter a cor.
   */
  cor: z.boolean().catch(true).default(true),
  /**
   * (18/10) Os TEXTOS NA TELA: o texto de tela de cada frase do roteiro entra
   * animado no video (shared/textos-na-tela.ts), menos o da 1a (esse e o
   * titulo). (19/10) Desligado por padrao: o Levi nao usa texto no alto.
   */
  textos: z.boolean().catch(false).default(false),
  /**
   * (19/10) O TITULO NO GANCHO: o card de gancho do nucleo (hookText), no alto,
   * no comeco -- o texto de tela da 1a frase ou a 1a sugestao de thumb
   * (ganchoDoRoteiro). Desligado por padrao, como os textos.
   */
  titulo: z.boolean().catch(false).default(false),
})
export type ConfigDaEdicaoRapida = z.infer<typeof configDaEdicaoRapidaSchema>

export const CONFIG_DA_EDICAO_RAPIDA_PADRAO: ConfigDaEdicaoRapida = {
  sfx: true,
  musica: true,
  rosto: true,
  legenda: true,
  cor: true,
  textos: false,
  titulo: false,
}

/**
 * O que fica nas Configuracoes (settings.edicaoRapidaPadrao). `.catch` em cada
 * campo: um valor estranho no settings.json volta ao padrao sem levar os
 * outros junto.
 */
export const preferenciasDaEdicaoRapidaSchema = z.object({
  /** A opcao "Edicao rapida" do "Abrir no editor" (passo 4) nasce ligada. */
  aoAbrirNoEditor: z.boolean().catch(true).default(true),
  config: configDaEdicaoRapidaSchema.catch(CONFIG_DA_EDICAO_RAPIDA_PADRAO).default(CONFIG_DA_EDICAO_RAPIDA_PADRAO),
  /**
   * O look da parte "cor": null = o "Anime vivo" (ANIME_VIVO); um nome = o
   * preset de cor salvo dele com esse nome (settings.presetsDeCor, os mesmos
   * do inspetor da camada de ajuste). Preset que sumiu: entra o Anime vivo,
   * e o resumo diz (lookDaCor).
   */
  corPreset: z.string().trim().min(1).max(40).nullable().catch(null).default(null),
})
export type PreferenciasDaEdicaoRapida = z.infer<typeof preferenciasDaEdicaoRapidaSchema>

export const PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO: PreferenciasDaEdicaoRapida = {
  aoAbrirNoEditor: true,
  config: CONFIG_DA_EDICAO_RAPIDA_PADRAO,
  corPreset: null,
}

/**
 * [recap] A pasta de musicas padrao: NENHUMA. A do Studio
 * (`G:/App Resumo/music`) e da maquina do Levi; a parte 5 migra a config
 * dele. Sem pasta escolhida, a Edicao rapida segue sem musica e o resumo diz.
 */
export const PASTA_DE_MUSICAS_PADRAO = ''

// ======================================================================= som

/** Os dois tipos de SFX da Edicao rapida (os papeis 'whoosh' e 'impacto' da trilha). */
export const TIPOS_DE_SFX = ['whoosh', 'impacto'] as const
export const tipoDeSfxSchema = z.enum(TIPOS_DE_SFX)
export type TipoDeSfx = z.infer<typeof tipoDeSfxSchema>

/**
 * O tipo do som PELO NOME do arquivo (a pasta de SFX do app, Configuracoes >
 * Sons de transicao; hoje impact.mp3 e whoosh.mp3). Nome que nao diz o tipo
 * fica de fora: chutar poria um "pop" de interface onde ele quer algo tatil.
 */
const NOME_DE_WHOOSH = /whoosh|woosh|swoosh|swish|swipe|sweep|transi|riser|wind|vento/i
const NOME_DE_IMPACTO = /impact|impacto|hit|boom|thud|punch|slam|stomp|kick|soco|batida|drop/i

export function tipoDoSfxPeloNome(fileName: string): TipoDeSfx | null {
  const nome = nomeDoArquivo(fileName)
  if (NOME_DE_WHOOSH.test(nome)) return 'whoosh'
  if (NOME_DE_IMPACTO.test(nome)) return 'impacto'
  return null
}

/** O nome do arquivo de um caminho (barra normal ou invertida), sem depender de node:path. */
export function nomeDoArquivo(caminho: string): string {
  const partes = caminho.split(/[\\/]/)
  return partes[partes.length - 1] ?? caminho
}

/**
 * O que o main mede de um arquivo de som (ffmpeg ebur128). Nivelar e por
 * LOUDNESS, nunca por pico: dois whooshes com o mesmo pico podem soar 8 dB
 * diferentes.
 */
export interface MedidaDoSom {
  path: string
  /** Duracao do ARQUIVO inteiro, s. */
  durationSec: number
  /** Loudness integrado (LUFS). null = silencio ou curto demais para medir. */
  lufsIntegrado: number | null
  /** O maior loudness MOMENTANEO (janela de 400 ms), LUFS. E por ele que o SFX e nivelado. */
  lufsMomentaneoMax: number | null
  /**
   * O centro da janela de 100 ms mais forte (K-ponderada), s. O whoosh alinha
   * ISTO na virada. 100 ms e nao os 400 do momentaneo: num whoosh de 0,4 s a
   * janela de 400 ms so tem um lugar, e o centro dela nao diz onde o "vush" esta.
   */
  picoSec: number
  /** O primeiro e o ultimo instante audivel (acima do piso), s. O impacto alinha o inicio. */
  inicioSomSec: number
  fimSomSec: number
  /**
   * Canais do arquivo (1 = mono). O preview precisa: o navegador toca mono nos
   * dois alto-falantes em ganho 1 (+3 dB), o render a -3 dB por canal.
   * Ausente = nao se sabe (trata como estereo).
   */
  canais?: number
}

/** Um SFX disponivel para a Edicao rapida: medido e com tipo. */
export interface ArquivoDeSfx extends MedidaDoSom {
  fileName: string
  tipo: TipoDeSfx
  /**
   * Veio da pasta de RESERVA (os sons que vem com o app), porque a pasta dele
   * nao tem nenhum deste tipo. Os da pasta dele sempre ganham.
   */
  reserva: boolean
}

/**
 * Os papeis do roteiro, aqui de novo SO como lista de valores (ver o comentario
 * dos imports): a checagem de tipo abaixo garante que e a mesma lista de
 * papelDaSecaoSchema (shared/roteiro.ts).
 */
const PAPEIS_DO_SOM = ['gancho', 'contexto', 'desenvolvimento', 'virada', 'climax', 'fechamento'] as const
type _MesmosPapeis = [Exclude<PapelDaSecao, (typeof PAPEIS_DO_SOM)[number]>, Exclude<(typeof PAPEIS_DO_SOM)[number], PapelDaSecao>] extends [never, never]
  ? true
  : never
const _papeisConferidos: _MesmosPapeis = true
void _papeisConferidos

/** Uma parte do video para o som: papel (null = nao se sabe) e onde cai. */
export const secaoParaSomSchema = z.object({
  papel: z.enum(PAPEIS_DO_SOM).nullable(),
  inicio: z.number().nonnegative(),
  fim: z.number().nonnegative(),
})
export type SecaoParaSom = z.infer<typeof secaoParaSomSchema>

/**
 * As regras de sound design DO LEVI, das edicoes anteriores:
 *   - nivelar por LOUDNESS (LUFS momentaneo), nunca por pico;
 *   - marcador e efeito BEM BAIXO;
 *   - tatil/organico em vez de "UI pop/click" (a pasta decide; o nome filtra);
 *   - NADA de som em todo corte: no short, whoosh so na virada de PARTE e
 *     impacto so no comeco do gancho e do climax; o resto em silencio;
 *   - nao repetir o mesmo arquivo seguido (rodizio por tipo);
 *   - camadas separadas por tipo (uma faixa por papel);
 *   - deixar SOBRA (arquivo inteiro + in/out).
 *
 * Voz em -14 LUFS integrado e o que o render entrega. Os numeros abaixo foram
 * MEDIDOS no mix final (scripts/teste/v-som-mix.ts: o mesmo
 * muxWithNormalizedAudio do render, a narracao paga do S4-37, a pasta de
 * musicas dele e os SFX do app; ebur128 do ffmpeg e a conta de
 * shared/loudness.ts) -- ver MEDIDO_NO_MIX logo abaixo.
 */
export interface RegrasDeSom {
  /** Loudness integrado da voz no video final (o loudnorm do render). */
  vozLufs: number
  /** Quantos LU o MAXIMO MOMENTANEO de cada tipo fica abaixo da voz. */
  abaixoDaVozLu: Record<TipoDeSfx, number>
  /**
   * A VOZ ALI (a fala em volta do pico do SFX, vozNoSfx): janela de 400 ms
   * mais baixa que isto (abaixo da integrada) e PAUSA, nao fala, e nao conta.
   * SFX caindo num silencio da voz segue o integrado (senao sumia embaixo da
   * musica).
   */
  pisoDaVozLocalLu: number
  /** Ate quantos segundos do pico do SFX a fala conta como "a voz ali". */
  vozEmVoltaSec: number
  /**
   * Com UM arquivo so de um tipo, quantas vezes ele toca no video (as marcas
   * mais importantes): o mesmo whoosh 5 vezes em 64 s e repeticao, contra a
   * regra "nao repetir o mesmo arquivo seguido".
   */
  maximoComUmArquivo: number
  /** Dois SFX do MESMO tipo nunca mais perto que isto (parte curta perde o whoosh). */
  intervaloMinimoSec: number
  /** Sobra depois do ultimo instante audivel, no out do trecho. */
  caudaSec: number
  /** O pico do whoosh cai este tanto ANTES do corte: o som "puxa" para a virada. */
  whooshAntesDoCorteSec: number
  /** A virada gruda no corte de bloco mais perto, ate esta distancia. */
  imaDoCorteSec: number
  /** Ganho de quem nao deu para medir (arquivo silencioso ou curto demais). */
  ganhoSemMedidaDb: number
  musica: {
    /** Quantos LU o integrado da musica fica abaixo da voz SEM voz (nas pausas). */
    abaixoDaVozLu: number
    fadeInSec: number
    fadeOutSec: number
    /** Sob a voz ela desce mais `ducking.abaixoDb`. */
    ducking: Ducking
  }
}

export const REGRAS_DE_SOM_PADRAO: RegrasDeSom = {
  vozLufs: -14,
  /*
   * SFX pelo maximo MOMENTANEO (400 ms). Whoosh 14 LU abaixo da voz (-28): o
   * "bem baixo" da faixa pedida (10-14), porque ele cruza o corte com a voz
   * falando por cima (o passo 3 corta as pausas). Impacto 13 (-27): ele cai
   * na 1a silaba do gancho e no corte do climax, e o momentaneo subestima
   * transiente -- mais que isso e "pancada", nao marca. No long form calmo o
   * Levi usou whoosh em -36 (22 LU abaixo); no short a voz e mais cheia.
   */
  abaixoDaVozLu: { whoosh: 14, impacto: 13 },
  pisoDaVozLocalLu: 20,
  vozEmVoltaSec: 0.2,
  maximoComUmArquivo: 2,
  intervaloMinimoSec: 2.5,
  caudaSec: 0.25,
  whooshAntesDoCorteSec: 0.04,
  imaDoCorteSec: 0.35,
  ganhoSemMedidaDb: -18,
  /*
   * Long form do Levi: musica perto de -42 LUFS. No short ela sobe, mas a voz
   * manda: -30 LUFS nas pausas (16 LU abaixo) e -36 sob a voz (mais 6 dB de
   * ducking), ~22 LU abaixo da voz onde ela fala -- que no short e quase o
   * video inteiro. Rampas curtas (desce em 0,1 s antes da palavra, volta em
   * 0,25 s) para o respiro de 0,15 s entre frases subir ~2,6 dB ("sobe um
   * pouco nas pausas"); com as rampas do DUCKING_PADRAO (0,15/0,6) a subida
   * medida foi de 1,0 dB, nao se ouvia.
   */
  musica: {
    abaixoDaVozLu: 16,
    fadeInSec: 1.2,
    fadeOutSec: 2,
    ducking: { abaixoDb: 6, ataqueSec: 0.1, soltaSec: 0.25, pausaMinSec: 0.5 },
  },
}

/*
 * MEDIDO_NO_MIX (scripts/teste/v-som-mix.ts, 14/10; refeito na correcao da
 * avaliacao, com a voz ali e o limite de UM arquivo por tipo). O MP4 que o
 * render entrega, medido com o ebur128 do ffmpeg (integrado, pico verdadeiro)
 * e com a conta de shared/loudness.ts (momentaneo de 400 ms, passo de 10 ms).
 * SFX = os de fabrica (1 whoosh, 1 impacto: o whoosh entra so nas 2 viradas
 * principais):
 *
 *                              S4-37 (64,4 s)   short sintetico (24,7 s,
 *                                               pausas de 1,6 e 2,0 s)
 *   mix, integrado             -14,2 LUFS       -14,2 LUFS
 *   so a voz (como antes)      -14,3 LUFS       -14,2 LUFS
 *   pico verdadeiro do mix     -3,6 dBTP        -3,6 dBTP
 *   musica sob a fala          -36,1 LUFS       -36,3 LUFS  (~22 LU abaixo)
 *   musica nas pausas longas   (nao ha)         -30,0 LUFS  (ducking 6,0 dB)
 *   respiro de fim de frase    +2,3 dB (16x)    +2,2 dB (3x)
 *   impacto no gancho (M max)  -27,1 LUFS       -27,1  (13 LU abaixo; 12,9 da voz ali)
 *   whoosh contexto>desenv.    -29,4 LUFS       -28,4  (15 LU abaixo; 13,6 da voz ali)
 *   whoosh+impacto no climax   -28,5 LUFS       -28,7  (14 LU abaixo; 11,7 da voz ali)
 *
 * A VOZ ALI (vozNoSfx), S4-37 com 2 arquivos de whoosh (as 5 viradas, como a
 * avaliacao ouviu): sem ela, o whoosh da virada climax > fechamento (61,7 s,
 * frase em volta a -23 LUFS) ficava 5,3 LU abaixo da voz ali (2,8 na pior
 * janela a 60 ms); com ela desce 7,5 dB e fica 12,7 (10,3). Os outros descem
 * de 0 a 2 dB (a frase em volta deles e cheia) e ficam 11,7-14,3 LU abaixo.
 *
 * A outra musica da pasta (phonk, -6,4 LUFS no arquivo, 4,6 LU mais alta que
 * a do Naruto) cai no mesmo lugar: -36,3 sob a fala, -29,3 nas pausas -- o
 * ganho sai do loudness do TRECHO que toca, e nunca passa de 0 dB (musica
 * baixa no arquivo fica abaixo do alvo, com aviso: o preview nao sobe acima
 * do arquivo). O envelope do render bate com ganhoDoEnvelope (o do preview) a
 * 0,3 dB em janelas de 50 ms depois do AAC. Com uma faixa a 0 dB por baixo de
 * proposito (soma acima de 0 dBFS), o MP4 fecha em -2,2 dBTP.
 */

/** O mesmo limite do gainDb do trechoDeAudioSchema. */
const GANHO_MIN_DB = -40
const GANHO_MAX_DB = 12
/**
 * A musica nunca SOBE acima do arquivo: o preview toca pelo <audio>, que nao
 * passa de volume 1, e uma faixa baixa com +10 dB soava mais baixa no preview
 * que no render (quebrava "igual no preview e no render"). Musica baixa demais
 * fica abaixo do alvo, com aviso (ver musicaAbaixoDoAlvoDb).
 */
export const GANHO_MAX_DA_MUSICA_DB = 0

function prenderGanho(db: number, maximo: number = GANHO_MAX_DB): number {
  if (!Number.isFinite(db)) return GANHO_MIN_DB
  // Meio dB: mais fino que isso nao se ouve, e o numero fica legivel na tela.
  return Math.min(Math.max(Math.round(db * 2) / 2, GANHO_MIN_DB), maximo)
}

/**
 * dB sobre o arquivo para o maximo momentaneo dele cair em
 * min(voz integrada, voz ali) - abaixoDaVozLu[tipo]. `vozAli` (vozNoSfx) so
 * ABAIXA: a virada que cai num trecho baixo da voz nao vira "pancada"
 * (avaliacao de 14/10: o whoosh de 61,47 s do S4-37 ficava 3 LU abaixo da voz
 * ali); voz mais alta que a integrada nao sobe o SFX.
 */
export function ganhoDoSfx(
  lufsMomentaneoMax: number | null,
  tipo: TipoDeSfx,
  regras: RegrasDeSom = REGRAS_DE_SOM_PADRAO,
  vozAli: number | null = null,
): number {
  if (lufsMomentaneoMax === null || !Number.isFinite(lufsMomentaneoMax)) return prenderGanho(regras.ganhoSemMedidaDb)
  const voz = vozAli === null || !Number.isFinite(vozAli) ? regras.vozLufs : Math.min(regras.vozLufs, vozAli)
  return prenderGanho(voz - regras.abaixoDaVozLu[tipo] - lufsMomentaneoMax)
}

/** dB sobre o arquivo para o integrado da musica cair em voz - musica.abaixoDaVozLu (nas pausas). */
export function ganhoDaMusica(lufsIntegrado: number | null, regras: RegrasDeSom = REGRAS_DE_SOM_PADRAO): number {
  if (lufsIntegrado === null || !Number.isFinite(lufsIntegrado)) return prenderGanho(regras.ganhoSemMedidaDb - 6, GANHO_MAX_DA_MUSICA_DB)
  return prenderGanho(regras.vozLufs - regras.musica.abaixoDaVozLu - lufsIntegrado, GANHO_MAX_DA_MUSICA_DB)
}

/** Quantos dB a musica fica ABAIXO do alvo por ser baixa no arquivo (0 = no alvo). */
export function musicaAbaixoDoAlvoDb(lufsIntegrado: number | null, regras: RegrasDeSom = REGRAS_DE_SOM_PADRAO): number {
  if (lufsIntegrado === null || !Number.isFinite(lufsIntegrado)) return 0
  const ideal = regras.vozLufs - regras.musica.abaixoDaVozLu - lufsIntegrado
  return Math.max(0, Math.round((ideal - GANHO_MAX_DA_MUSICA_DB) * 2) / 2)
}

/**
 * A NARRACAO para nivelar o SFX pelo instante: os blocos de 400 ms (passo de
 * 100 ms, LoudnessMedido.blocos) da narracao CRUA e quanto o render soma nela
 * (vozLufs - integrado cru; o loudnorm do render e linear).
 */
export interface VozParaNivelar {
  blocos: readonly number[]
  ajusteDb: number
}

/**
 * A VOZ ALI, no video final (LUFS): a fala em volta do pico do SFX -- as
 * janelas de 400 ms da narracao com centro a ate vozEmVoltaSec do pico, so as
 * que tem fala (acima de vozLufs - pisoDaVozLocalLu), em potencia media, com o
 * ajuste do render. E o nivel da FRASE em volta, e nao o do vao entre frases:
 * toda virada cai num vao (o pico do whoosh e 40 ms antes do corte), e o que
 * muda de uma para outra e se a frase em volta e cheia ou baixa. Em volta so
 * pausa: null (vale o integrado). null tambem sem a narracao.
 */
export function vozNoSfx(
  sfx: { picoSec: number },
  at: number,
  inSec: number,
  voz: VozParaNivelar | null | undefined,
  regras: RegrasDeSom = REGRAS_DE_SOM_PADRAO,
): number | null {
  if (!voz || voz.blocos.length === 0) return null
  const pico = at + Math.max(sfx.picoSec - inSec, 0)
  const fala = regras.vozLufs - regras.pisoDaVozLocalLu
  let soma = 0
  let n = 0
  // Bloco j cobre [j*0,1 ; j*0,1 + 0,4]: centro em j*0,1 + 0,2.
  const de = Math.max(Math.ceil((pico - regras.vozEmVoltaSec - 0.2) / 0.1 - 1e-9), 0)
  const ate = Math.min(Math.floor((pico + regras.vozEmVoltaSec - 0.2) / 0.1 + 1e-9), voz.blocos.length - 1)
  for (let j = de; j <= ate; j++) {
    const aqui = voz.blocos[j]! + voz.ajusteDb
    if (!(aqui >= fala)) continue
    soma += 10 ** (aqui / 10)
    n++
  }
  return n === 0 ? null : 10 * Math.log10(soma / n)
}

// -------------------------------------------------------------- plano de som

/** Um SFX planejado: o trecho que vira uma trilha com papel = tipo. */
export const sfxPlanejadoSchema = z.object({
  /** Onde o trecho ENTRA no video (o ponto `inSec` do arquivo toca aqui), s. */
  at: z.number().nonnegative(),
  /** Caminho absoluto do arquivo. */
  arquivo: z.string().min(1),
  tipo: tipoDeSfxSchema,
  /** dB sobre o arquivo (absoluto, como o gainDb da trilha). */
  ganhoDb: z.number().min(GANHO_MIN_DB).max(GANHO_MAX_DB),
  /** O pedaco do arquivo que toca: [inSec, outSec]. */
  inSec: z.number().nonnegative(),
  outSec: z.number().positive(),
  /** Duracao do ARQUIVO inteiro: a sobra fica para ele puxar na linha do tempo. */
  durationSec: z.number().positive(),
  /** O instante do video que o som marca (a virada, o comeco da parte), s. */
  marcaSec: z.number().nonnegative(),
  /** Por que esta ali, ASCII curto ("virada Gancho > Contexto", "comeco do Climax"). */
  motivo: z.string(),
})
export type SfxPlanejado = z.infer<typeof sfxPlanejadoSchema>

export const musicaPlanejadaSchema = z.object({
  arquivo: z.string().min(1),
  /** dB sobre o arquivo SEM voz (nas pausas); sob a voz desce mais ducking.abaixoDb. */
  ganhoDb: z.number().min(GANHO_MIN_DB).max(GANHO_MAX_DB),
  fadeInSec: z.number().min(0).max(60),
  fadeOutSec: z.number().min(0).max(60),
  ducking: duckingSchema,
  /** De que ponto do arquivo a musica parte (pular silencio de comeco), s. */
  inSec: z.number().nonnegative().default(0),
  /** Duracao do ARQUIVO inteiro, s. Mais curta que o video = repete (um trecho por volta). */
  durationSec: z.number().positive(),
  /** O integrado medido do arquivo (documenta o ganho). null = nao deu para medir. */
  lufsIntegrado: z.number().nullable().default(null),
})
export type MusicaPlanejada = z.infer<typeof musicaPlanejadaSchema>

/** O plano de som da Edicao rapida: o que o main devolve e o que vira trilhas. */
export const planoDeSomSchema = z.object({
  musica: musicaPlanejadaSchema.nullable(),
  sfx: z.array(sfxPlanejadoSchema),
  /** Recados ASCII ("Sem musica na pasta", "Sem whoosh: usei o do app"). */
  avisos: z.array(z.string()).default([]),
})
export type PlanoDeSom = z.infer<typeof planoDeSomSchema>

/** O pedido do renderer (ou da montagem) ao main: planejarSom. */
export const pedidoDePlanoDeSomSchema = z.object({
  sfx: z.boolean(),
  musica: z.boolean(),
  duracaoSec: z.number().positive().max(4 * 3600),
  /** O comeco de cada bloco (Scene.start): a virada gruda no corte mais perto. */
  cortes: z.array(z.number().nonnegative()).max(20000),
  /** As partes (secoesParaSom). */
  secoes: z.array(secaoParaSomSchema).max(500),
  /** Caminhos de musica a NAO escolher agora (a que o projeto ja tem, ao rodar de novo). */
  evitarMusicas: z.array(z.string().max(1024)).max(50).default([]),
  /** Forca esta musica (o "trocar" do MusicControl). null = escolhe sem repetir. */
  musicaForcada: z.string().min(1).max(1024).nullable().default(null),
  /**
   * A narracao (o audio do projeto): o SFX e nivelado tambem pela voz NAQUELE
   * instante, nao so pelo integrado. null = so pelo integrado.
   */
  vozPath: z.string().min(1).max(1024).nullable().default(null),
})
export type PedidoDePlanoDeSom = z.infer<typeof pedidoDePlanoDeSomSchema>

/**
 * Onde cada som marca alguma coisa, ANTES de escolher arquivo: as viradas de
 * parte (whoosh) e o comeco do gancho e do climax (impacto). Corrida de papel
 * repetido (dois 'climax' seguidos) marca so a primeira.
 */
function marcasDoSom(
  cortes: readonly number[],
  secoes: readonly SecaoParaSom[],
  regras: RegrasDeSom,
  duracaoSec: number,
): MarcaDoSom[] {
  const ordenadas = [...secoes].filter((s) => Number.isFinite(s.inicio)).sort((a, b) => a.inicio - b.inicio)
  const grudar = (t: number): number => {
    let melhor = t
    let dist = regras.imaDoCorteSec
    for (const c of cortes) {
      const d = Math.abs(c - t)
      if (d <= dist) {
        dist = d
        melhor = c
      }
    }
    return melhor
  }
  const rotulo = (p: SecaoParaSom['papel'], k: number): string =>
    p ? p.charAt(0).toUpperCase() + p.slice(1) : `Parte ${k + 1}`
  const algumPapel = ordenadas.some((s) => s.papel !== null)
  const marcas: MarcaDoSom[] = []
  ordenadas.forEach((s, k) => {
    const t = k === 0 ? 0 : grudar(s.inicio)
    if (t >= duracaoSec - 0.3) return
    const anterior = k > 0 ? ordenadas[k - 1]! : null
    if (anterior) marcas.push({ t, tipo: 'whoosh', motivo: `virada ${rotulo(anterior.papel, k - 1)} > ${rotulo(s.papel, k)}`, peso: PESO_DA_VIRADA[s.papel ?? 'nenhum'] })
    // Sem papel nenhum (projeto do Dangai): a 1a parte faz as vezes de gancho.
    const abre = algumPapel ? s.papel === 'gancho' || s.papel === 'climax' : k === 0
    const repete = anterior !== null && anterior.papel === s.papel
    if (abre && !repete) marcas.push({ t, tipo: 'impacto', motivo: `comeco do ${rotulo(s.papel, k)}`, peso: 0 })
  })
  return marcas.sort((a, b) => a.t - b.t)
}

interface MarcaDoSom {
  t: number
  tipo: TipoDeSfx
  motivo: string
  /** Importancia da marca (0 = a maior): com UM arquivo so, ficam as mais importantes. */
  peso: number
}

/**
 * As viradas que mais pedem som, pela parte que ENTRA: o climax (o pico do
 * short) e o desenvolvimento (sai do contexto e a historia anda) primeiro --
 * as "2 viradas principais" da avaliacao de 14/10. Sem papel: todas iguais
 * (fica a ordem do video).
 */
const PESO_DA_VIRADA: Record<NonNullable<SecaoParaSom['papel']> | 'nenhum', number> = {
  climax: 0,
  desenvolvimento: 1,
  virada: 2,
  fechamento: 3,
  contexto: 4,
  gancho: 5,
  nenhum: 6,
}

/**
 * OS SFX DO SHORT: whoosh nas viradas de PARTE, impacto no comeco do gancho e
 * do climax, o resto em silencio. Puro.
 *
 * - `cenas`: os blocos (so o `start` importa): a virada gruda no corte;
 * - `secoes`: as partes (secoesParaSom);
 * - `arquivos`: os SFX medidos e com tipo; os da pasta dele ganham dos de
 *   reserva, tipo a tipo. Tipo sem arquivo nenhum = sem esse som (o main avisa);
 * - rodizio por tipo: com 2+ arquivos o mesmo nunca toca duas vezes seguidas;
 *   com UM arquivo so, ele toca no maximo `maximoComUmArquivo` vezes, nas
 *   marcas mais importantes (virada para o climax e para o desenvolvimento) --
 *   o mesmo whoosh cinco vezes seguidas era repeticao;
 * - dois do mesmo tipo a menos de `intervaloMinimoSec`: o segundo cai;
 * - `voz` (a narracao): o SFX fica abaixoDaVozLu[tipo] abaixo de
 *   min(voz integrada, voz ali) (vozNoSfx) -- a virada no meio de uma frase
 *   baixa nao vira "pancada";
 * - o whoosh poe o PICO (picoSec) em marca - whooshAntesDoCorteSec; o impacto
 *   poe o INICIO audivel (inicioSomSec) na marca. Antes do zero, o trecho
 *   entra em 0 e pula o comeco do arquivo (inSec);
 * - out = ultimo instante audivel + caudaSec (sem passar do arquivo); o
 *   `durationSec` e o do arquivo inteiro (a sobra).
 */
export function planejarSfx(
  cenas: readonly { start: number }[],
  secoes: readonly SecaoParaSom[],
  arquivos: readonly ArquivoDeSfx[],
  regras: RegrasDeSom = REGRAS_DE_SOM_PADRAO,
  duracaoSec: number = Number.POSITIVE_INFINITY,
  voz: VozParaNivelar | null = null,
): SfxPlanejado[] {
  const cortes = [...new Set(cenas.map((c) => c.start).filter((t) => Number.isFinite(t) && t > 0))].sort((a, b) => a - b)
  const usaveis = (tipo: TipoDeSfx): ArquivoDeSfx[] => {
    const doTipo = arquivos
      .filter((a) => a.tipo === tipo && a.durationSec > 0)
      .sort((a, b) => a.fileName.localeCompare(b.fileName, 'pt-BR'))
    const dele = doTipo.filter((a) => !a.reserva)
    return dele.length > 0 ? dele : doTipo
  }
  const porTipo: Record<TipoDeSfx, ArquivoDeSfx[]> = { whoosh: usaveis('whoosh'), impacto: usaveis('impacto') }
  const ultimoNoTipo: Record<TipoDeSfx, number> = { whoosh: Number.NEGATIVE_INFINITY, impacto: Number.NEGATIVE_INFINITY }
  const vezNoTipo: Record<TipoDeSfx, number> = { whoosh: 0, impacto: 0 }

  // Com UM arquivo so do tipo: as marcas mais importantes, ate o maximo, sem
  // duas perto demais (a escolha e por peso; a ordem do video volta depois).
  let marcas = marcasDoSom(cortes, secoes, regras, duracaoSec)
  for (const tipo of TIPOS_DE_SFX) {
    if (porTipo[tipo].length !== 1) continue
    const doTipo = marcas.filter((m) => m.tipo === tipo)
    if (doTipo.length <= regras.maximoComUmArquivo) continue
    const ficam: MarcaDoSom[] = []
    for (const m of [...doTipo].sort((a, b) => a.peso - b.peso || a.t - b.t)) {
      if (ficam.length >= regras.maximoComUmArquivo) break
      if (ficam.some((f) => Math.abs(f.t - m.t) < regras.intervaloMinimoSec)) continue
      ficam.push(m)
    }
    marcas = marcas.filter((m) => m.tipo !== tipo || ficam.includes(m))
  }

  const saida: SfxPlanejado[] = []
  for (const marca of marcas) {
    const lista = porTipo[marca.tipo]
    if (lista.length === 0) continue
    if (marca.t - ultimoNoTipo[marca.tipo] < regras.intervaloMinimoSec) continue
    const arq = lista[vezNoTipo[marca.tipo] % lista.length]!
    vezNoTipo[marca.tipo] += 1
    ultimoNoTipo[marca.tipo] = marca.t

    const ancora = marca.tipo === 'whoosh' ? arq.picoSec : arq.inicioSomSec
    const alvo = marca.tipo === 'whoosh' ? marca.t - regras.whooshAntesDoCorteSec : marca.t
    let at = alvo - Math.max(ancora, 0)
    let inSec = 0
    if (at < 0) {
      inSec = Math.min(-at, Math.max(arq.durationSec - 0.05, 0))
      at = 0
    }
    const fimAudivel = arq.fimSomSec > 0 ? arq.fimSomSec : arq.durationSec
    let outSec = Math.min(arq.durationSec, fimAudivel + regras.caudaSec)
    if (outSec <= inSec + 0.05) outSec = arq.durationSec
    // O integrado manda; a voz ali (a frase em volta) so pode ABAIXAR.
    saida.push({
      at: arredondar(at),
      arquivo: arq.path,
      tipo: marca.tipo,
      ganhoDb: ganhoDoSfx(arq.lufsMomentaneoMax, marca.tipo, regras, vozNoSfx(arq, at, inSec, voz, regras)),
      inSec: arredondar(inSec),
      outSec: arredondar(outSec),
      durationSec: arq.durationSec,
      marcaSec: arredondar(marca.t),
      motivo: marca.motivo,
    })
  }
  // Whoosh e impacto na MESMA marca (a virada que abre o climax): o whoosh
  // puxa e o impacto bate, mas juntos somavam ~4 LU acima do alvo (medido:
  // -24 LUFS momentaneo). Os sons da mesma marca dividem o alvo em potencia
  // (-3 dB cada um quando sao dois), e o "bem baixo" continua valendo.
  for (const s of saida) {
    const juntos = saida.filter((o) => Math.abs(o.marcaSec - s.marcaSec) < 0.05).length
    if (juntos > 1) s.ganhoDb = prenderGanho(s.ganhoDb - 10 * Math.log10(juntos))
  }
  return saida
}

/** Milissegundo: mais fino nao muda nada no som e polui o .anirecap. */
function arredondar(s: number): number {
  return Math.round(s * 1000) / 1000
}

// ------------------------------------------------------------------- ducking

// [recap] O ducking e do nucleo (shared/ducking.ts, o `ducking` do trecho de
// audio): o mesmo envelope no preview e no render. Reexportado para o codigo
// portado do Studio seguir com os mesmos nomes.
export {
  envelopeDeDucking,
  ganhoDoEnvelope,
  recortarEnvelope,
  RESPIRO_MIN_SEC,
  trilhaParaMixar,
  type PalavraDoDucking,
  type PontoDeGanho,
  type TrilhaParaMixar,
} from '@shared/ducking'

// ------------------------------------------------------- plano -> trilhas

type TrechoNaFaixa = Pick<TrechoDeAudioSalvo, 'faixa' | 'papel' | 'at' | 'durationSec' | 'inicioSec' | 'usarSec'>
type TrechoQueEntra = Pick<TrechoDeAudioSalvo, 'papel' | 'at' | 'durationSec' | 'inicioSec' | 'usarSec'>

const PAPEIS_DA_TRILHA: readonly PapelDaTrilha[] = ['musica', 'whoosh', 'impacto']

/**
 * A faixa de cada papel (camadas separadas por tipo; as dele nunca se misturam
 * com as da Edicao rapida no mesmo trecho de tempo):
 *
 * 1. o papel que ja tem faixa (rodar de novo) FICA nela, a nao ser que la
 *    tenha um clipe dele no mesmo trecho de tempo do que entra -- antes, um
 *    som dele numa faixa abaixo empurrava musica/whoosh/impacto para cima a
 *    cada rodada, deixando faixas vazias (auditoria de 14/10);
 * 2. o resto vai para a primeira faixa LIVRE depois da mais alta dele, em
 *    sequencia, so para os papeis que entram (sem whoosh, o impacto fica logo
 *    abaixo da musica).
 *
 * `trilhas` = as do projeto agora; `entram` = os trechos novos (so papel e
 * tempo importam; ausente = os tres papeis, sem conferir tempo); `trocados` =
 * os papeis cujas trilhas atuais saem (padrao: os de `entram`).
 */
export function faixasDaEdicaoRapida(
  trilhas: readonly TrechoNaFaixa[],
  entram: readonly TrechoQueEntra[] | null = null,
  trocados: ReadonlySet<PapelDaTrilha> | null = null,
): Record<PapelDaTrilha, number> {
  const papeis = entram ? PAPEIS_DA_TRILHA.filter((p) => entram.some((t) => t.papel === p)) : PAPEIS_DA_TRILHA
  const saem = trocados ?? new Set(papeis)
  const ficam = trilhas.filter((t) => !t.papel || !saem.has(t.papel))
  const fim = (t: Pick<TrechoDeAudioSalvo, 'at' | 'durationSec' | 'inicioSec' | 'usarSec'>): number =>
    t.at + duracaoDoTrecho(t)
  const cruza = (faixa: number, papel: PapelDaTrilha): boolean =>
    ficam.some(
      (t) =>
        t.faixa === faixa &&
        // Outro papel da Edicao rapida que fica (so a musica trocada): faixa dele.
        (t.papel ? t.papel !== papel : entram ? entram.some((n) => n.papel === papel && n.at < fim(t) - 1e-3 && t.at < fim(n) - 1e-3) : true),
    )
  const saida: Partial<Record<PapelDaTrilha, number>> = {}
  const usadas = new Set<number>()

  for (const papel of papeis) {
    const antes = trilhas.filter((t) => t.papel === papel).map((t) => t.faixa)
    if (antes.length === 0) continue
    const faixa = maisComum(antes)
    if (usadas.has(faixa) || cruza(faixa, papel)) continue
    saida[papel] = faixa
    usadas.add(faixa)
  }

  const dele = ficam.filter((t) => !t.papel)
  let livre = dele.length > 0 ? Math.max(...dele.map((t) => t.faixa)) + 1 : 0
  const ocupada = (f: number): boolean => usadas.has(f) || ficam.some((t) => t.faixa === f)
  for (const papel of PAPEIS_DA_TRILHA) {
    if (saida[papel] !== undefined) continue
    while (ocupada(livre)) livre++
    saida[papel] = livre
    // So o papel que entra gasta a faixa: o que nao entra nao abre buraco.
    if (papeis.includes(papel)) usadas.add(livre)
  }
  return saida as Record<PapelDaTrilha, number>
}

function maisComum(xs: readonly number[]): number {
  const n = new Map<number, number>()
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0]
}

/** Os trechos novos com a faixa de cada papel (faixasDaEdicaoRapida sobre o projeto de agora). */
export function naFaixaDaEdicaoRapida<T extends TrechoQueEntra & { faixa: number }>(
  trilhas: readonly TrechoNaFaixa[],
  novas: readonly T[],
  trocados: ReadonlySet<PapelDaTrilha> | null = null,
): T[] {
  const faixas = faixasDaEdicaoRapida(trilhas, novas, trocados)
  return novas.map((t) => (t.papel ? { ...t, faixa: faixas[t.papel] } : t))
}

/** As trilhas sem as que a Edicao rapida pos (rodar de novo troca so as dela). */
export function semTrilhasDaEdicaoRapida<T extends Pick<TrechoDeAudioSalvo, 'papel'>>(trilhas: readonly T[]): T[] {
  return trilhas.filter((t) => !t.papel)
}

/**
 * O plano de som vira trechos de trilha (sem `url`: quem poe no store resolve,
 * como o refreshTrilhas). Puro.
 *
 * - SFX: um trecho por som, na faixa do tipo, arquivo inteiro em
 *   `durationSec`, [inSec, outSec] em inicioSec/usarSec (null = ate o fim),
 *   fade de saida de 30 ms so quando corta antes do fim (o mesmo do Dangai);
 * - musica: um trecho por volta do arquivo ate cobrir o video, fade de entrada
 *   no primeiro e de saida no ultimo, `ducking` em todos (o envelope e do
 *   video, entao as voltas emendam sem degrau).
 */
export function trilhasDoPlanoDeSom(
  plano: PlanoDeSom,
  opcoes: { duracaoSec: number; faixas: Record<PapelDaTrilha, number>; prefixoId: string },
): TrechoDeAudioSalvo[] {
  const saida: TrechoDeAudioSalvo[] = []
  plano.sfx.forEach((s, k) => {
    const usar = s.outSec - s.inSec
    const ateOFim = s.outSec >= s.durationSec - 1e-3
    saida.push({
      id: `${opcoes.prefixoId}-${s.tipo}-${k}`,
      path: s.arquivo,
      fileName: nomeDoArquivo(s.arquivo),
      faixa: opcoes.faixas[s.tipo],
      at: s.at,
      durationSec: s.durationSec,
      inicioSec: s.inSec,
      usarSec: ateOFim ? null : arredondar(usar),
      gainDb: s.ganhoDb,
      fadeInSec: 0,
      fadeOutSec: ateOFim ? 0 : 0.03,
      peaks: [],
      rms: [],
      papel: s.tipo,
    })
  })

  const m = plano.musica
  if (m && opcoes.duracaoSec > 0) {
    let at = 0
    let volta = 0
    let inicio = Math.min(m.inSec, Math.max(m.durationSec - 0.5, 0))
    while (at < opcoes.duracaoSec - 0.05 && volta < 1000) {
      const cabe = m.durationSec - inicio
      if (cabe <= 0.05) break
      const toca = Math.min(cabe, opcoes.duracaoSec - at)
      const ultima = at + toca >= opcoes.duracaoSec - 0.05
      saida.push({
        id: `${opcoes.prefixoId}-musica-${volta}`,
        path: m.arquivo,
        fileName: nomeDoArquivo(m.arquivo),
        faixa: opcoes.faixas.musica,
        at: arredondar(at),
        durationSec: m.durationSec,
        inicioSec: arredondar(inicio),
        usarSec: toca < cabe - 1e-3 ? arredondar(toca) : null,
        gainDb: m.ganhoDb,
        fadeInSec: volta === 0 ? m.fadeInSec : 0,
        fadeOutSec: ultima ? m.fadeOutSec : 0,
        peaks: [],
        rms: [],
        papel: 'musica',
        ducking: m.ducking,
      })
      at += toca
      volta += 1
      // As voltas seguintes tocam o arquivo do comeco.
      inicio = 0
    }
  }
  return saida
}

// -------------------------------------------------------- musica sem repetir

/** Uma faixa da pasta de musicas. */
export interface MusicaDaPasta {
  path: string
  fileName: string
  /** null = ainda nao medida (listar nao mede: pasta grande seria lenta). */
  durationSec: number | null
  lufsIntegrado: number | null
  /** ISO da ultima vez que entrou num projeto. null = nunca. */
  usadaEm: string | null
}

/** <userData>/som/musicas-usadas.json: o historico que impede repetir entre shorts. */
export const historicoDeMusicasSchema = z.object({
  versao: z.literal(1),
  usadas: z
    .array(
      z.object({
        path: z.string(),
        fileName: z.string(),
        em: z.string(),
        /** O .anirecap (ou o rascunho) que a usou. null = nao se sabe. */
        projeto: z.string().nullable().default(null),
      }),
    )
    .default([]),
})
export type HistoricoDeMusicas = z.infer<typeof historicoDeMusicasSchema>
export const HISTORICO_DE_MUSICAS_VAZIO: HistoricoDeMusicas = { versao: 1, usadas: [] }

/**
 * A musica da vez, SEM REPETIR: primeiro as nunca usadas (na ordem do nome),
 * depois a usada ha mais tempo. `evitar` (a do projeto, ao rodar de novo) so
 * volta quando nao sobra outra. Puro.
 */
export function musicaSemRepetir<T extends { path: string; fileName: string }>(
  musicas: readonly T[],
  historico: HistoricoDeMusicas,
  evitar: readonly string[] = [],
): T | null {
  if (musicas.length === 0) return null
  const chave = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
  const ultimaVez = new Map<string, string>()
  for (const u of historico.usadas) {
    const k = chave(u.path)
    const antes = ultimaVez.get(k)
    if (!antes || u.em > antes) ultimaVez.set(k, u.em)
  }
  const fora = new Set(evitar.map(chave))
  const ordenar = (lista: readonly T[]): T[] =>
    [...lista].sort((a, b) => {
      const ua = ultimaVez.get(chave(a.path)) ?? ''
      const ub = ultimaVez.get(chave(b.path)) ?? ''
      if (ua !== ub) return ua < ub ? -1 : 1
      return a.fileName.localeCompare(b.fileName, 'pt-BR')
    })
  const livres = musicas.filter((m) => !fora.has(chave(m.path)))
  return ordenar(livres.length > 0 ? livres : musicas)[0] ?? null
}

// ===================================================================== partes

/** Os personagens dos eventos que a frase cita, sem repetir, na ordem dos eventos. */
export function personagensDaFrase(frase: Pick<Frase, 'eventoIds'>, eventos: readonly Pick<Evento, 'id' | 'personagens'>[]): string[] {
  const porId = new Map(eventos.map((e) => [e.id, e]))
  const nomes: string[] = []
  for (const id of frase.eventoIds) {
    for (const nome of porId.get(id)?.personagens ?? []) {
      const limpo = nome.trim()
      if (limpo && !nomes.includes(limpo)) nomes.push(limpo)
    }
  }
  return nomes
}

/**
 * As partes do roteiro no tempo do take, para `studio.secoes` do projeto
 * montado. Frase sem trecho (sem voz) fica de fora; parte sem frase com voz
 * tambem. `inicio` da parte = offset do trecho da 1a frase dela.
 */
export function secoesDoTake(
  roteiro: Pick<Roteiro, 'secoes'>,
  take: Pick<TakeDaVoz, 'trechos' | 'duracao'>,
  eventos: readonly Pick<Evento, 'id' | 'personagens'>[] = [],
  /** (19/10) Quem cada frase cita, na ordem de preferencia (a montagem sabe). Ausente = os dos eventos. */
  nomes?: ReadonlyMap<string, readonly string[]>,
): SecaoDoStudio[] {
  const trechos = new Map(take.trechos.map((t) => [t.fraseId, t]))
  const saida: SecaoDoStudio[] = []
  for (const secao of roteiro.secoes) {
    const frases = secao.frases.flatMap((f) => {
      const t = trechos.get(f.id)
      if (!t) return []
      return [
        {
          id: f.id,
          inicio: arredondar(t.offset),
          fim: arredondar(t.offset + t.duracao),
          personagens: [...(nomes?.get(f.id) ?? personagensDaFrase(f, eventos))],
          // O texto de tela vai junto: a Edicao rapida no editor poe os textos sem o rascunho.
          tela: f.textoDeTela?.replace(/\s+/g, ' ').trim() || null,
        },
      ]
    })
    if (frases.length === 0) continue
    saida.push({
      id: secao.id,
      papel: secao.papel,
      inicio: frases[0]!.inicio,
      fim: frases[frases.length - 1]!.fim,
      frases,
    })
  }
  // A ultima parte vai ate o fim da voz (o trecho final ja cobre, mas por garantia).
  const ultima = saida[saida.length - 1]
  if (ultima && take.duracao > ultima.fim) ultima.fim = arredondar(take.duracao)
  return saida
}

/** O papel pelo rotulo de tela (ROTULO_DO_PAPEL e o papel com maiuscula). */
function papelPeloRotulo(nome: string | undefined): SecaoParaSom['papel'] {
  if (!nome) return null
  const limpo = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
  return (PAPEIS_DO_SOM as readonly string[]).includes(limpo) ? (limpo as SecaoParaSom['papel']) : null
}

/**
 * As partes do video para o som, do melhor dado ao pior:
 *   1. `studio.secoes` (o roteiro aprovado, gravado pela montagem);
 *   2. o `section` das imagens dos blocos (projeto do Studio de antes disto, ou
 *      do Dangai com pastas por parte), papel pelo `sectionName`;
 *   3. os paragrafos do transcript (a linha em branco do roteiro), sem papel;
 *   4. uma parte so, o video inteiro.
 */
export function secoesParaSom(p: {
  studio?: { secoes?: readonly Pick<SecaoDoStudio, 'papel' | 'inicio' | 'fim'>[] } | null
  images?: readonly { section?: number | null; sectionName?: string }[]
  plan?: { scenes: readonly { imageIndex: number; start: number; end: number }[] } | null
  words?: readonly { start: number; end: number; paragraph?: boolean }[]
  duracaoSec: number
}): SecaoParaSom[] {
  const d = p.duracaoSec
  const secoes = p.studio?.secoes ?? []
  if (secoes.length > 0) return secoes.map((s) => ({ papel: s.papel, inicio: s.inicio, fim: Math.min(s.fim, d) }))

  const cenas = [...(p.plan?.scenes ?? [])].sort((a, b) => a.start - b.start)
  if (cenas.length > 0 && p.images) {
    const porBloco: SecaoParaSom[] = []
    let atual: number | null | undefined
    for (const c of cenas) {
      const img = p.images[c.imageIndex]
      const sec = img?.section ?? null
      if (sec === null) continue
      if (sec !== atual) {
        const ultima = porBloco[porBloco.length - 1]
        if (ultima) ultima.fim = c.start
        porBloco.push({ papel: papelPeloRotulo(img?.sectionName), inicio: porBloco.length === 0 ? 0 : c.start, fim: d })
        atual = sec
      }
    }
    if (porBloco.length >= 2) return porBloco
  }

  const words = (p.words ?? []).filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end))
  const viradas: number[] = []
  words.forEach((w, i) => {
    const seguinte = words[i + 1]
    if (w.paragraph && seguinte) viradas.push((w.end + seguinte.start) / 2)
  })
  if (viradas.length > 0) {
    const pontos = [0, ...viradas, d]
    return pontos.slice(0, -1).map((inicio, k) => ({ papel: null, inicio, fim: pontos[k + 1]! }))
  }
  return [{ papel: null, inicio: 0, fim: d }]
}

// ==================================================================== legenda

/**
 * O estilo salvo dele (settings.captionStyle, ja passado pelo
 * captionStyleSchema) nos campos do .anirecap. Campo ausente no estilo fica
 * como esta no arquivo. As REGRAS da legenda nao moram no projeto: o
 * openProject refaz as legendas nao editadas com as regras de quem abre.
 */
export function aplicarEstiloNoProjeto(file: ProjectFile, estilo: CaptionStyle): ProjectFile {
  return {
    ...file,
    ...(estilo.color !== undefined ? { captionColor: estilo.color } : {}),
    ...(estilo.y !== undefined ? { captionY: estilo.y } : {}),
    ...(estilo.scale !== undefined ? { captionScale: estilo.scale } : {}),
    ...(estilo.fontNome !== undefined ? { captionFont: estilo.fontNome } : {}),
    ...(estilo.animation !== undefined ? { captionAnimation: estilo.animation } : {}),
    ...(estilo.animationFrames !== undefined ? { captionAnimationFrames: estilo.animationFrames } : {}),
    ...(estilo.animationCurve !== undefined ? { captionAnimationCurve: estilo.animationCurve } : {}),
    ...(estilo.mark !== undefined ? { captionMark: estilo.mark } : {}),
    ...(estilo.shadow !== undefined ? { captionShadow: estilo.shadow } : {}),
    ...(estilo.stroke !== undefined ? { captionStroke: estilo.stroke } : {}),
  }
}

// ======================================================================== cor

/**
 * "ANIME VIVO", o look padrao da parte "cor" (pedido do Levi em 15/10: "com
 * VIBRANCE mais alta"). Vibrance e o que puxa: satura mais o que tem pouca cor
 * e quase nao mexe no que ja e saturado; contraste leve, os realces um pouco
 * para baixo (o contraste empurra o claro para cima) e um toque de nitidez.
 * Na escala do inspetor: Vibrance +28, Contraste +10, Realces -5, Nitidez 10.
 *
 * MEDIDO nos quadros do Dr. Stone S4-37 (38 quadros, um a cada 8 planos:
 * pele, ceu, verde, explosao amarela, espaco escuro), com o filtro do
 * src/remotion/Ajuste.tsx simulado em 8 bits sRGB primitiva por primitiva:
 * croma x1,25 em media; pele S x1,24 (pior quadro x1,30, sem ficar laranja);
 * ceu S x1,18; canal novo em 255 em 0,07% dos pixels, todo da nitidez na
 * borda do traco (sem ela, 0,01%); banding nenhum (rampa suave de pele, ceu,
 * verde e sombra: degrau maximo de 3 codigos e nenhum trecho plano novo).
 * Vibrance +30 ja deixava a pele x1,28; nitidez 25 dava halo em 0,6%.
 * Conferido no app (preview e MP4 do render, com e sem a camada): croma
 * x1,22 a x1,31 e no maximo 0,28% de canal novo em 255.
 */
export const NOME_DO_ANIME_VIVO = 'Anime vivo'
export const ANIME_VIVO: AjusteDeCor = ajusteDeCorSchema.parse({ vibrance: 0.28, contraste: 0.1, realces: -0.05, nitidez: 0.1 })

/** Um preset de cor salvo (o mesmo PresetDeCor de src/store/presets-de-cor.ts). */
export interface PresetDeCorSalvo {
  nome: string
  cor: AjusteDeCor
}

/**
 * Os presets de cor CRUS das settings (presetsDeCor), conferidos: nome nao
 * vazio (ate 40) e cor pelo ajusteDeCorSchema. O que nao se le fica de fora.
 */
export function presetsDeCorConferidos(bruto: readonly unknown[]): PresetDeCorSalvo[] {
  const ok: PresetDeCorSalvo[] = []
  for (const r of bruto) {
    if (!r || typeof r !== 'object') continue
    const nome = (r as Record<string, unknown>)['nome']
    if (typeof nome !== 'string' || !nome.trim()) continue
    const cor = ajusteDeCorSchema.safeParse((r as Record<string, unknown>)['cor'])
    if (cor.success) ok.push({ nome: nome.trim().slice(0, 40), cor: cor.data })
  }
  return ok
}

/**
 * O look da parte "cor": o preset salvo pelo nome, ou o Anime vivo (null, ou o
 * preset sumiu). `sumiu` = o nome do preset escolhido que nao existe mais: o
 * resumo diz na linha da Cor (um aviso solto ficava escondido atras do "+1").
 */
export function lookDaCor(
  corPreset: string | null,
  presets: readonly PresetDeCorSalvo[],
): { nome: string; cor: AjusteDeCor; sumiu: string | null } {
  if (corPreset === null) return { nome: NOME_DO_ANIME_VIVO, cor: ANIME_VIVO, sumiu: null }
  const achado = presets.find((p) => p.nome === corPreset)
  if (achado) return { nome: achado.nome, cor: achado.cor, sumiu: null }
  return { nome: NOME_DO_ANIME_VIVO, cor: ANIME_VIVO, sumiu: corPreset }
}

type ClipeNaFaixa = Pick<SobreposicaoSalva, 'faixa' | 'at' | 'durationSec' | 'inicioSec' | 'usarSec' | 'papel'>

/**
 * A faixa de video da camada de cor. Ela cobre o video INTEIRO, entao a faixa
 * precisa estar livre de clipe dele em todo [0, duracao]:
 * - a faixa em que a camada da Edicao rapida ja estava (ele pode ter arrastado
 *   para baixo ou para cima dos clipes dele), se continua livre;
 * - senao a MAIS BAIXA livre e nao muda: a camada corrige o que esta embaixo
 *   (cenas e faixas de numero menor), e quanto mais baixa, menos clipe dele
 *   (meme, texto) ela tinge.
 */
export function faixaDaCamadaDeCor(
  sobreposicoes: readonly ClipeNaFaixa[],
  duracaoSec: number,
  mudas: readonly number[] = [],
): number {
  const dele = sobreposicoes.filter((o) => o.papel !== 'cor')
  const ocupada = (f: number): boolean =>
    dele.some((o) => o.faixa === f && o.at < duracaoSec - 1e-3 && o.at + (o.usarSec ?? o.durationSec - o.inicioSec) > 1e-3)
  const antes = sobreposicoes.filter((o) => o.papel === 'cor').map((o) => o.faixa)
  if (antes.length > 0) {
    const faixa = maisComum(antes)
    if (!ocupada(faixa)) return faixa
  }
  let f = 0
  while (ocupada(f) || mudas.includes(f)) f++
  return f
}

/**
 * A camada de ajuste da Edicao rapida: a MESMA do "Camada de ajuste" do
 * editor (addCamadaDeAjuste), cobrindo o video inteiro, sem fade, com
 * `papel: 'cor'` e o nome do look no clipe ("Cor: Anime vivo"). Ele edita
 * depois no inspetor como qualquer outra. Sem `url` (quem poe no store poe
 * url vazia, como a camada do editor).
 */
export function camadaDeCor(e: { cor: AjusteDeCor; nome: string; duracaoSec: number; faixa: number; id: string }): SobreposicaoSalva {
  const usar = Math.max(arredondar(e.duracaoSec), 0.2)
  return {
    id: e.id,
    path: '',
    fileName: `Cor: ${e.nome}`.slice(0, 60),
    tipo: 'ajuste',
    faixa: e.faixa,
    at: 0,
    // O "arquivo" da camada de ajuste e livre: 3600 s como o do editor (ele
    // estica a vontade), ou o video, se for maior.
    durationSec: Math.max(3600, usar),
    inicioSec: 0,
    usarSec: usar,
    x: 0,
    y: 0,
    escala: 1,
    opacidade: 1,
    aspecto: 16 / 9,
    rotacao: 0,
    efeito: 'nenhum',
    intensidade: 0.1,
    curva: MOTION_CURVE_DEFAULT,
    pontosDaCurva: null,
    cor: e.cor,
    espelhar: false,
    fadeInSec: 0,
    fadeOutSec: 0,
    papel: 'cor',
    // O que ela pos: se `cor` sair disto, ele mexeu (camadaDeCorIntacta).
    corOriginal: e.cor,
  }
}

/** O prefixo do nome no clipe ("Cor: Anime vivo"). */
const PREFIXO_DA_CAMADA = 'Cor: '

/**
 * O look que a Edicao rapida pos numa camada dela: o guardado nela
 * (`corOriginal`) ou, na camada de antes do campo existir, o do nome no clipe
 * ("Cor: <nome>", como o lookDaCor). null = nao da para saber.
 */
export function lookDeOrigem(
  o: Pick<SobreposicaoSalva, 'corOriginal' | 'fileName'>,
  presets: readonly PresetDeCorSalvo[],
): AjusteDeCor | null {
  if (o.corOriginal) return o.corOriginal
  if (!o.fileName.startsWith(PREFIXO_DA_CAMADA)) return null
  const nome = o.fileName.slice(PREFIXO_DA_CAMADA.length)
  if (nome === NOME_DO_ANIME_VIVO) return ANIME_VIVO
  return presets.find((p) => p.nome === nome)?.cor ?? null
}

/** Dois valores iguais por conteudo (a ordem das chaves nao importa; ausente = undefined). */
function mesmoValor(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) if (!mesmoValor(ra[k], rb[k])) return false
  return true
}

/**
 * O que pode mudar sem a camada deixar de ser "a da Edicao rapida": a faixa
 * (ele arrastou para cima ou para baixo), o nome, o tamanho do "arquivo" e o
 * quanto ela toca (conferido a parte: cobre o video todo).
 */
const LIVRES_NA_CAMADA = new Set(['id', 'faixa', 'fileName', 'durationSec', 'usarSec', 'corOriginal', 'url'])

/**
 * A camada de cor esta EXATAMENTE como a Edicao rapida pos: o mesmo look, do
 * 0 ao fim do video (ou alem), sem fade, sem transicao, nada mexido -- so a
 * faixa pode ter mudado. So uma camada assim e trocada ao rodar de novo:
 * valores, intensidade, fades e o corte do comeco ou do fim sao trabalho dele.
 */
export function camadaDeCorIntacta(
  o: SobreposicaoSalva,
  duracaoSec: number,
  presets: readonly PresetDeCorSalvo[],
): boolean {
  if (o.papel !== 'cor' || o.tipo !== 'ajuste') return false
  const origem = lookDeOrigem(o, presets)
  if (!origem) return false
  const toca = o.usarSec ?? o.durationSec - o.inicioSec
  // Meio quadro de folga: o usarSec e a duracao arredondada a 1 ms.
  if (o.at + toca < duracaoSec - 0.5 / 30) return false
  const molde: Record<string, unknown> = camadaDeCor({ cor: origem, nome: '', duracaoSec: toca, faixa: o.faixa, id: o.id })
  const dela: Record<string, unknown> = o
  for (const k of new Set([...Object.keys(molde), ...Object.keys(dela)])) {
    if (LIVRES_NA_CAMADA.has(k)) continue
    if (!mesmoValor(dela[k], molde[k])) return false
  }
  return true
}

/**
 * O rotulo do clipe na linha do tempo: a camada da Edicao rapida com a cor
 * mexida diz "Cor (editada)" -- o nome do look ja nao descreve o que ela faz
 * (ele aplicou outro preset no inspetor, ou mudou os valores).
 */
export function rotuloDaSobreposicao(o: Pick<SobreposicaoSalva, 'fileName' | 'papel' | 'cor' | 'corOriginal'>): string {
  if (o.papel === 'cor' && o.corOriginal && !mesmoValor(o.cor, o.corOriginal)) return 'Cor (editada)'
  return o.fileName
}

/** O que a rodada fez com a cor (vai para o resumo). */
export type CorDaRodada =
  /** Posta ou trocada (ou ja igual). `faixaMuda` = a faixa dela esta silenciada: nao aparece. */
  | { acao: 'posta'; nome: string; faixaMuda: number | null }
  /** Ele mexeu na camada ('editada') ou ela virou varias ('varias': cortada ou copiada): ficou tudo como esta. */
  | { acao: 'mantida'; motivo: 'editada' | 'varias' }

/**
 * A faixa de video com a camada de cor da Edicao rapida (pura; o store chama
 * com o estado ATUAL). Nunca apaga trabalho dele:
 * - nenhuma camada com papel 'cor': poe uma, na mais baixa livre e nao muda;
 * - UMA, intacta (camadaDeCorIntacta): troca pelo look de agora com o mesmo
 *   id, no mesmo lugar da lista (o inspetor aberto nela continua aberto, e o
 *   mesmo look nao vira passo de Ctrl+Z) e na faixa em que ela estava;
 * - uma mexida, ou varias (ele cortou ou copiou: os pedacos e as copias levam
 *   o papel junto): fica TUDO como esta, e o resumo diz.
 */
export function trocaDaCamadaDeCor<T extends SobreposicaoSalva>(
  sobreposicoes: readonly T[],
  e: {
    look: { nome: string; cor: AjusteDeCor }
    duracaoSec: number
    mudas: readonly number[]
    presets: readonly PresetDeCorSalvo[]
    /** O id da camada nova (a trocada fica com o dela). */
    id: string
    /** O que a camada leva alem do SobreposicaoSalva (no store, `url: ''`). */
    extra: Omit<T, keyof SobreposicaoSalva>
  },
): { sobreposicoes: T[]; rodada: CorDaRodada } {
  const marcadas = sobreposicoes.filter((o) => o.papel === 'cor')
  if (marcadas.length > 1) return { sobreposicoes: [...sobreposicoes], rodada: { acao: 'mantida', motivo: 'varias' } }
  const antiga = marcadas[0]
  if (antiga && !camadaDeCorIntacta(antiga, e.duracaoSec, e.presets)) {
    return { sobreposicoes: [...sobreposicoes], rodada: { acao: 'mantida', motivo: 'editada' } }
  }
  const faixa = faixaDaCamadaDeCor(sobreposicoes, e.duracaoSec, e.mudas)
  const nova = {
    ...camadaDeCor({ cor: e.look.cor, nome: e.look.nome, duracaoSec: e.duracaoSec, faixa, id: antiga?.id ?? e.id }),
    ...e.extra,
  } as T
  // A faixa dela foi silenciada (ele compara com e sem cor): fica la, e o resumo diz.
  const rodada: CorDaRodada = { acao: 'posta', nome: e.look.nome, faixaMuda: e.mudas.includes(faixa) ? faixa : null }
  if (!antiga) return { sobreposicoes: [...sobreposicoes, nova], rodada }
  return { sobreposicoes: sobreposicoes.map((o) => (o === antiga ? nova : o)), rodada }
}

// ====================================================================== rosto

/**
 * Um pedaco para enquadrar: o trecho [de, ate] (s DENTRO do arquivo) que um
 * bloco toca, e quem a frase cita. A chave e a da montagem (chaveDoPedaco em
 * electron/services/montar/projeto.ts): o mesmo mp4 pode entrar duas vezes.
 */
export const pedidoDeRostoSchema = z.object({
  chave: z.string().min(1).max(2100),
  /** mp4 do plano (ou imagem). So lido. */
  arquivo: z.string().min(1).max(1024),
  de: z.number().nonnegative(),
  ate: z.number().nonnegative(),
  /**
   * Os personagens que a frase cita, em ordem de preferencia (personagensDaFrase,
   * de preferencia os que o indice reconhece no plano primeiro). Vazio = o
   * maior rosto.
   */
  personagens: z.array(z.string().max(120)).max(20).default([]),
  /**
   * (rodada 4) Uma METADE do grid: o foco vale na janela da metade (1080x960,
   * 9:8), nao na do formato -- o foco do 9:16 erra ate 646 px nela. Ausente =
   * tela cheia.
   */
  metade: z.boolean().optional(),
})
export type PedidoDeRosto = z.infer<typeof pedidoDeRostoSchema>

/** UM pedido para todos os pedacos: o motor sobe uma vez (importar o torch custa segundos). */
export const loteDeRostosSchema = z.object({
  pedidos: z.array(pedidoDeRostoSchema).max(5000),
  /** O quadro em que o foco vale (focoDoRosto usa as medidas dele). */
  formato: z.enum(FORMATOS).default('short'),
  /** Para o motor achar o elenco do anime (identificar QUEM e cada rosto). null = so o maior. */
  episodioId: z.string().regex(/^ep_[0-9a-f]{40}$/).nullable().default(null),
  /** Teto da etapa inteira, ms. Passou: o resto fica no centro (ou no detector antigo). */
  tetoMs: z.number().int().positive().max(600_000).default(120_000),
  /** false = pula o motor e usa so o detector antigo (lbpcascade). */
  motor: z.boolean().default(true),
  /**
   * (19/10) Quem o roteiro cita no video inteiro: entra no conjunto fechado de
   * cada pedaco, junto do elenco principal do indice, para o motor dizer QUEM e
   * cada rosto (e nao so "parece com o citado").
   */
  elenco: z.array(z.string().max(120)).max(40).optional(),
})
export type LoteDeRostos = z.infer<typeof loteDeRostosSchema>

export type FonteDoRosto = 'motor' | 'lbp'

/**
 * Os SFX que a Edicao rapida tem para usar (o passo 4 avisa ANTES de abrir):
 * quantos de cada tipo e se sao so os de fabrica (os sintetizados que vem com
 * o app, scripts/make-sfx.ts -- genericos, o contrario de "tatil").
 */
export interface SfxDaEdicaoRapida {
  whoosh: number
  impacto: number
  /** Todos os que entrariam sao os de fabrica (iguais aos do app). */
  deFabrica: boolean
}

/** O enquadramento de um pedido (mesmo sistema do focusX/focusY da imagem). */
export interface FocoDoRosto {
  chave: string
  focusX: number
  focusY: number
  /** Veio de rosto achado (a interface diz que o app enquadrou). false = centro. */
  focusAuto: boolean
  /** Quem achou. null = ninguem (centro). */
  fonte: FonteDoRosto | null
  /** O personagem preferido que foi achado e enquadrado. null = o maior rosto (ou nenhum). */
  personagem: string | null
  /** Em quantos dos instantes olhados houve rosto, e quantos foram olhados. */
  instantesComRosto: number
  instantes: number
}

export interface RostosDoLote {
  /** Um por pedido, na ordem dos pedidos. */
  focos: FocoDoRosto[]
  /** Quem achou: so o motor, so o antigo, os dois (o motor caiu no meio), ou ninguem. */
  fonte: FonteDoRosto | 'misto' | 'nenhum'
  comRosto: number
  total: number
  /** ASCII ("Motor indisponivel: usei o detector antigo"). */
  avisos: string[]
  ms: number
}

/** A chave de um pedaco: igual ao chaveDoPedaco da montagem (e ao chaveDaMetade, com `metade`). */
export function chaveDoPedidoDeRosto(arquivo: string, de: number, metade = false): string {
  return `${arquivo}@${de.toFixed(3)}${metade ? '|metade' : ''}`
}

// ===================================================================== resumo

/** O que a Edicao rapida fez, para o recado da tela (ProjetoMontado.edicaoRapida e o botao do editor). */
export interface ResumoDaEdicaoRapida {
  config: ConfigDaEdicaoRapida
  whoosh: number
  impacto: number
  /** O nome do arquivo da musica posta. null = sem musica. */
  musica: string | null
  rostos: { comRosto: number; total: number; fonte: RostosDoLote['fonte'] } | null
  /** O estilo salvo foi aplicado na legenda. */
  legenda: boolean
  /** O look da camada de cor posta ("Anime vivo" ou o nome do preset). null/ausente = sem cor. */
  cor?: string | null
  /** A camada que estava ficou como esta: ele mexeu nela ('editada') ou ela virou varias ('varias'). */
  corMantida?: 'editada' | 'varias' | null
  /** O preset de cor escolhido que nao existe mais (entrou o Anime vivo). */
  corPresetSumiu?: string | null
  /** A faixa da camada posta esta silenciada (0 = V1): no preview e no render, sem cor. */
  corFaixaMuda?: number | null
  /**
   * Os textos na tela: quantos entraram, quantos ele tinha mexido (ficaram) e
   * em que faixa. null/ausente = a parte nao rodou.
   */
  textos?: { postos: number; mantidos: number; faixa: number | null } | null
  avisos: string[]
  /**
   * A rodada MUDOU o projeto (criou um passo de Ctrl+Z). false = nada mudou: o
   * resumo nao oferece "Desfazer" (desfaria o passo anterior). Ausente = sim
   * (a montagem do passo 4).
   */
  aplicou?: boolean
  /** Sem musica nova (pasta vazia), mas a que ja estava no projeto ficou: o nome. */
  musicaMantida?: string | null
}

/** Nenhuma parte ligada: o botao nao tem o que fazer. */
export function nadaLigado(c: ConfigDaEdicaoRapida): boolean {
  return !c.sfx && !c.musica && !c.rosto && !c.legenda && !c.cor && !c.textos && !c.titulo
}

/** As partes ligadas em ASCII curto ("sons, musica e rosto"), para dicas e titulos. */
export function partesLigadas(c: ConfigDaEdicaoRapida): string {
  const nomes = [c.sfx && 'sons', c.musica && 'musica', c.rosto && 'rosto', c.legenda && 'legenda', c.cor && 'cor', c.titulo && 'titulo', c.textos && 'textos'].filter(
    (x): x is string => typeof x === 'string',
  )
  if (nomes.length <= 1) return nomes[0] ?? ''
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
}

/*
 * ============================================================ DONOS (14/10)
 *
 * Contrato (este arquivo, contract.ts: duckingSchema/papel/ducking na trilha,
 * project-file.ts: studio.secoes, cenas.ts: pedido/resposta da montagem,
 * channels.ts + preload.ts + ipc.ts: os canais, settings.ts: os campos).
 *
 * (A) SOM -- electron/services/som/* (musicas.ts, medir.ts, planejar.ts,
 *     mix.ts: envelope e limitador do ffmpeg), shared/loudness.ts (BS.1770 em
 *     JS), electron/services/render.ts (envelope no mix + limitador final, MP4
 *     conferido em <= -1 dBTP, a voz em -14 LUFS integrado como sempre), a
 *     linha do startRender que monta `trilhas` em src/store/project.ts
 *     (trilhaParaMixar com transcript.words), src/components/Preview.tsx +
 *     som-do-preview.ts (TrilhasPreview aplica ganhoDoEnvelope e DESCONTA a
 *     diferenca entre a narracao crua do preview e a de -14 do render, pelo
 *     canal IPC medirSom), e os numeros de REGRAS_DE_SOM_PADRAO (medidos:
 *     MEDIDO_NO_MIX). Testes: scripts/teste/v-som-mix.ts (sem app) e
 *     v-som-app.ts (preview e render no app, por CDP).
 * (B) ROSTO -- motor/ (modo headless novo e pequeno, em lote, anotado em
 *     motor/STUDIO.md), electron/services/montar/rostos-motor.ts e foco.ts.
 *     Mede no S4-37 quantos pedacos acham rosto antes e depois.
 * (C) BOTAO -- src/components/RenderBar.tsx (botao "Edicao rapida" + o
 *     MusicControl de volta, agora sobre a trilha papel 'musica'),
 *     src/components/Settings.tsx (pasta de musicas + padroes),
 *     src/components/gerar/RodapeDasCenas.tsx e src/store/gerar-cenas.ts (a
 *     opcao no passo 4), electron/services/montar/index.ts e projeto.ts
 *     (montagem com Edicao rapida, studio.secoes, estilo salvo), a action
 *     `edicaoRapida` em src/store/project.ts (codigo em src/store/edicao-rapida.ts).
 * (D) COR (15/10) -- este arquivo (ANIME_VIVO, lookDaCor, camadaDeCor,
 *     faixaDaCamadaDeCor, camadaDeCorIntacta, trocaDaCamadaDeCor), contract.ts
 *     (`papel` e `corOriginal` na sobreposicao), o rotulo "Cor (editada)" na
 *     linha do tempo (rotuloDaSobreposicao em Timeline.tsx), a camada no
 *     store (prepararCor em src/store/edicao-rapida.ts) e na montagem
 *     (corDaMontagem em electron/services/montar/edicao-rapida.ts), e o look
 *     nas Configuracoes (AjustesDaEdicaoRapida.tsx). O filtro e o do Dangai
 *     (src/remotion/Ajuste.tsx), sem mudanca. Teste: v-edicao-rapida-cor.ts.
 */
