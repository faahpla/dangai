import { z } from 'zod'
import { tokenizeScript } from '@shared/align'
import type { VozPadrao } from './tipos-da-voz'
import type { RascunhoDoRecap, Roteiro } from './roteiro'

/**
 * A VOZ, do jeito que o Studio a entende: o contrato do passo 3 do assistente
 * "Gerar recap" (Episodio -> Roteiro -> Voz -> Cenas).
 *
 * Fonte unica da verdade para os dois lados:
 *   - o motor (electron/services/voz/*): provedor, cache, alinhamento, pos
 *     (corte de pausa e velocidade), arquivos e rascunho;
 *   - a interface (src/components/gerar/*, src/store/gerar*.ts): estimativa,
 *     ouvir, regravar frase, trocar voz/velocidade, takes, aprovar.
 *
 * O caminho: roteiro APROVADO (shared/roteiro.ts) -> um TAKE: a narracao
 * montada (WAV), as palavras com tempo (texto SEMPRE do roteiro) e um trecho
 * por frase. Os takes ficam no rascunho do recap (`voz`), e na parte 4 o take
 * aprovado vira o `audio` + o Transcript (alinhado: true) do projeto.
 *
 * REGRAS DURAS
 *   1. O texto das palavras e o do roteiro (tokenizeScript de cada frase), nunca
 *      o que o provedor ou o Whisper "ouviram". O audio so da os tempos.
 *   2. Tempos em SEGUNDOS, relativos ao inicio do arquivo do take.
 *   3. O pos (corte de pausa e "acelerar") e calculado das pausas do PROPRIO
 *      alinhamento e aplicado em WAV (atrim/concat, atempo), com remapeamento
 *      exato: nada de recalibracao linear pela duracao do arquivo (era a deriva
 *      de 0,1-0,3 s do AniRecap), nada de mp3 reencodado, corte nunca dentro de
 *      palavra.
 *   4. Arquivo de audio e enderecado por conteudo e nunca sobrescrito.
 *   5. Nunca pagar duas vezes pela mesma coisa: o cache do motor e por
 *      sha256 de { fonte, voiceId, modelId, settings, texto, contexto, formato }
 *      (+ velocidadeNativa SO quando diferente de 1: a chave de quem gerou a
 *      1.0 continua identica, e o cache pago antigo vale). O "acelerar" e o
 *      corte de pausa NAO entram na chave: sao pos, e trocar os dois parte do
 *      bruto do take, de graca (ajustarVoz). Era o defeito do AniRecap: o
 *      cache ignorava os voice settings.
 *
 * DUAS VELOCIDADES (decisao do Levi, 15/10):
 *   - NATIVA (velocidadeNativa, 0,7-1,2, padrao 1,2 no perfil): a voz ja e
 *     GERADA nesse ritmo (voice_settings.speed do ElevenLabs, prosody.speed do
 *     Fish). Encolhe tambem as pausas: o 1,2 encurta ~1,3x. Muda o audio, entao
 *     e paga (passa pela pergunta de custo). Takes e rascunhos de antes, sem o
 *     campo, valem 1,0;
 *   - ACELERAR (velocidade, 0,9-1,25, padrao 1): o pos, de graca, pelo atempo
 *     do ffmpeg (o do App Resumo; o rubberband a 1,5 soou robotico).
 *
 * Os tipos saem de z.infer, como em roteiro.ts. channels.ts so importa TIPOS
 * daqui. Este arquivo so importa TIPOS de roteiro.ts (roteiro.ts importa o
 * estadoDaVozSchema daqui: a seta de valor e uma so, sem ciclo).
 *
 * O QUE A DOCUMENTACAO OFICIAL DIZ (conferido em 14/10/2026)
 *
 * ElevenLabs, elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps:
 *   - POST /v1/text-to-speech/{voice_id}/with-timestamps, cabecalho xi-api-key;
 *   - corpo: text, model_id (padrao eleven_multilingual_v2), voice_settings
 *     { stability 0.5, similarity_boost 0.75, style 0, use_speaker_boost true,
 *     speed 1 }, previous_text / next_text (IGNORADOS quando vai o
 *     previous_request_ids / next_request_ids correspondente), previous_request_ids
 *     / next_request_ids (no maximo 3 cada), seed (0..4294967295, determinismo
 *     "best effort"), apply_text_normalization 'auto'|'on'|'off', language_code
 *     (NAO vale no multilingual_v2);
 *   - query output_format: mp3_*, pcm_*, wav_8000..wav_48000 (44,1 kHz em
 *     PCM/WAV pode exigir plano maior -- o motor tenta wav_44100 e cai para
 *     wav_24000 se o plano recusar);
 *   - resposta: audio_base64, alignment (o texto ORIGINAL, caractere a
 *     caractere) e normalized_alignment (o texto normalizado: "37" vira
 *     "trinta e sete"), os dois com characters, character_start_times_seconds,
 *     character_end_times_seconds. Os dois podem vir null.
 *   - costura (request stitching, .../cookbooks/text-to-speech/request-stitching):
 *     o id vem no cabecalho de resposta `request-id`, vale por 2 horas e NAO
 *     funciona no eleven_v3.
 *   - modelos (elevenlabs.io/docs/models): o multilingual_v2 lista
 *     "Portuguese (Brazil, Portugal)", 10.000 caracteres por pedido, "most
 *     stable on long-form"; o eleven_v4 lista "Portuguese (Brazil)" mas so tem
 *     Stability e Similarity (sem Style nem Speed); flash_v2_5 tem 40.000 e nao
 *     normaliza numero por padrao; v3 e a geracao anterior (5.000); turbo_v2_5
 *     esta descontinuado. O padrao do Studio fica no multilingual_v2 (o que o
 *     Levi ja usa e o que a doc indica para narracao longa).
 *
 * Fish Audio, docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech:
 *   - POST https://api.fish.audio/v1/tts, Authorization: Bearer, cabecalho
 *     `model` (s1, s2-pro, s2.1-pro = padrao, s2.1-pro-free);
 *   - corpo: text, reference_id (a voz), format wav|pcm|mp3|opus, sample_rate,
 *     prosody { speed 0.5-2, volume, normalize_loudness }, normalize,
 *     chunk_length, temperature 0.7, top_p 0.7, latency;
 *   - a doc NAO fala de tempo por palavra nem por caractere: o tempo sai do
 *     alinhador do Dangai (wav2vec2 PT) com o texto do roteiro.
 *
 * QUAL ALINHAMENTO VALE (origemDoAlinhamento)
 *   - 'provedor': o `alignment` do ElevenLabs, quando characters.join('') e
 *     IGUAL ao texto mandado. As palavras saem das faixas de caractere de cada
 *     frase (textoParaNarrar), sem adivinhar nada;
 *   - 'normalizado': so veio o normalized_alignment (ou o alignment nao bate):
 *     palavras do normalizado casadas com as do roteiro por alignScript
 *     (shared/align.ts), que tolera "trinta e sete" contra "37";
 *   - 'alinhador': Fish e audio importado: Whisper local (tempos grosseiros) +
 *     alinhamento forcado wav2vec2 (electron/services/alinhador.ts) com as
 *     palavras do roteiro.
 */

// --------------------------------------------------------------- constantes

/** Sobe quando a forma do EstadoDaVoz muda de um jeito que o leitor antigo nao entende. */
export const VOZ_VERSAO = 1 as const

/** Pausa a partir da qual o corte age (entre duas palavras, pelo alinhamento). */
export const PAUSA_LONGA_SEC = 0.3
/** Quanto sobra de uma pausa longa depois do corte. */
export const PAUSA_CURTA_SEC = 0.15

/** O "acelerar" do pos (atempo). Acima de 1,25 a voz fica robotica; abaixo de 0,9, arrastada. */
export const VELOCIDADE_MIN = 0.9
export const VELOCIDADE_MAX = 1.25
export const VELOCIDADE_PASSO = 0.05

/**
 * A velocidade NATIVA (a voz ja gerada nesse ritmo). O ElevenLabs so aceita
 * voice_settings.speed de 0,7 a 1,2 (1,5 deu 400 invalid_voice_settings em
 * 15/10); o Fish aceita prosody.speed de 0,5 a 2, mas fica na mesma faixa para
 * as duas fontes pagas se comportarem igual.
 */
export const VELOCIDADE_NATIVA_MIN = 0.7
export const VELOCIDADE_NATIVA_MAX = 1.2
export const VELOCIDADE_NATIVA_PASSO = 0.05
/** O padrao do perfil (Configuracoes > Voz) e da voz nova. Take e rascunho antigos sem o campo valem 1. */
export const VELOCIDADE_NATIVA_PADRAO = 1.2

/** Folga de comparacao de tempo em conferirTake (o WAV e exato; isto e so arredondamento). */
export const TOLERANCIA_SEC = 0.005

/** Contexto mandado junto ao regravar uma frase (previous_text / next_text), em caracteres. */
export const CONTEXTO_MAX_CARACTERES = 300

/** Separadores do texto que vai ao provedor: frase com frase, e secao com secao. */
export const SEPARADOR_DE_FRASE = ' '
export const SEPARADOR_DE_SECAO = '\n\n'

// ---------------------------------------------------------------- fontes

export const fonteDaVozSchema = z.enum(['elevenlabs', 'fish', 'importado'])
export type FonteDaVoz = z.infer<typeof fonteDaVozSchema>

export const ROTULO_DA_FONTE: Record<FonteDaVoz, string> = {
  elevenlabs: 'ElevenLabs',
  fish: 'Fish Audio',
  importado: 'Audio importado',
}

/** Modelo usado quando a voz padrao tem modelId vazio ('' = o padrao do provedor). */
export const MODELO_PADRAO: Record<Exclude<FonteDaVoz, 'importado'>, string> = {
  elevenlabs: 'eleven_multilingual_v2',
  fish: 's2.1-pro',
}

/** O que o Studio sabe de cada modelo do ElevenLabs (docs de 14/10/2026). */
export interface ModeloDeVoz {
  id: string
  nome: string
  /** Caracteres por pedido. null = a doc nao diz. */
  limite: number | null
  /** Creditos por caractere (Flash/Turbo custam metade). 1 quando a doc nao diz: melhor errar para mais. */
  creditosPorCaractere: number
  /** Aceita previous_request_ids/next_request_ids. */
  costura: boolean
  /** Aceita style (e speed) nos voice_settings. O v4 so tem stability e similarity. */
  estilo: boolean
}

export const MODELOS_ELEVEN: readonly ModeloDeVoz[] = [
  { id: 'eleven_multilingual_v2', nome: 'Multilingual v2', limite: 10_000, creditosPorCaractere: 1, costura: true, estilo: true },
  { id: 'eleven_v4', nome: 'Eleven v4', limite: 10_000, creditosPorCaractere: 1, costura: false, estilo: false },
  { id: 'eleven_flash_v2_5', nome: 'Flash v2.5', limite: 40_000, creditosPorCaractere: 0.5, costura: true, estilo: true },
  { id: 'eleven_v3', nome: 'Eleven v3', limite: 5_000, creditosPorCaractere: 1, costura: false, estilo: true },
]

/** O modelo pelo id; desconhecido = conservador (custa 1, sem costura, sem limite conhecido). */
export function modeloEleven(modelId: string): ModeloDeVoz {
  return (
    MODELOS_ELEVEN.find((m) => m.id === modelId) ?? {
      id: modelId,
      nome: modelId,
      limite: null,
      creditosPorCaractere: 1,
      costura: false,
      estilo: true,
    }
  )
}

// ------------------------------------------------------------- config da voz

/**
 * Voice settings do ElevenLabs, nos nomes do plano (PLANO.md, Narracao.voz).
 * Os padroes sao os do AniRecap (config.py), o som que o Levi ja conhece --
 * nao os da API (0.5/0.75).
 */
export const settingsElevenSchema = z.object({
  stability: z.number().min(0).max(1).default(0.32),
  similarityBoost: z.number().min(0).max(1).default(0.3),
  /** Ignorado pelo eleven_v4 (modeloEleven(...).estilo === false): o motor nao manda. */
  style: z.number().min(0).max(1).default(0),
  speakerBoost: z.boolean().default(true),
})
export type SettingsEleven = z.infer<typeof settingsElevenSchema>

/** O que o Fish aceita e muda o som. A velocidade nativa (prosody.speed) e a `velocidadeNativa` da config. */
export const settingsFishSchema = z.object({
  temperature: z.number().min(0).max(1).default(0.7),
  topP: z.number().min(0).max(1).default(0.7),
})
export type SettingsFish = z.infer<typeof settingsFishSchema>

const velocidadeSchema = z.number().min(VELOCIDADE_MIN).max(VELOCIDADE_MAX).default(1)
/** Default 1 (e nao o 1,2 do perfil): o take de antes do campo foi gerado a 1,0. */
const velocidadeNativaSchema = z.number().min(VELOCIDADE_NATIVA_MIN).max(VELOCIDADE_NATIVA_MAX).default(1)
const cortarPausasSchema = z.boolean().default(true)
/** Seguro para cabecalho e caminho de URL: o voice_id do ElevenLabs e o _id do Fish. */
const idDeVozSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const idDeModeloSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/)
/** sha256 em hex (o conteudo do arquivo importado). */
const hashSchema = z.string().regex(/^[0-9a-f]{16,64}$/)

/**
 * COMO a narracao e feita. As tres fontes dividem `velocidade` (o "acelerar")
 * e `cortarPausas` (o pos, que vale para todas e e de graca); o resto e da
 * fonte. As pagas tem a `velocidadeNativa` (a voz gerada nesse ritmo).
 */
export const configDaVozSchema = z.discriminatedUnion('fonte', [
  z.object({
    fonte: z.literal('elevenlabs'),
    voiceId: idDeVozSchema,
    modelId: idDeModeloSchema,
    /** voice_settings.speed. O eleven_v4 nao tem speed: o motor nao manda (velocidadeNativaEnviada). */
    velocidadeNativa: velocidadeNativaSchema,
    velocidade: velocidadeSchema,
    cortarPausas: cortarPausasSchema,
    settings: settingsElevenSchema,
  }),
  z.object({
    fonte: z.literal('fish'),
    /** reference_id da voz. */
    voiceId: idDeVozSchema,
    /** Cabecalho `model`. */
    modelId: idDeModeloSchema,
    /** prosody.speed. */
    velocidadeNativa: velocidadeNativaSchema,
    velocidade: velocidadeSchema,
    cortarPausas: cortarPausasSchema,
    settings: settingsFishSchema,
  }),
  z.object({
    fonte: z.literal('importado'),
    voiceId: z.literal('').default(''),
    modelId: z.literal('').default(''),
    velocidade: velocidadeSchema,
    cortarPausas: cortarPausasSchema,
    /**
     * CORTAR ERROS (V1): os trechos falados fora do roteiro (palavra repetida,
     * "eee", frase lida duas vezes) saem no pos, na borda do silencio. Padrao
     * false aqui: o take de antes do campo nao tinha corte nenhum. A tela e o
     * pedido de importacao ligam por padrao.
     */
    cortarErros: z.boolean().default(false),
    /**
     * O arquivo que ele soltou: nome (para a tela) e sha256 do conteudo (o
     * cache do audio decodificado e do alinhamento). O caminho original NAO
     * fica: o motor copia o audio para o bruto do take.
     */
    audio: z.object({ nome: z.string().max(260), hash: hashSchema }),
  }),
])
export type ConfigDaVoz = z.infer<typeof configDaVozSchema>
export type ConfigEleven = Extract<ConfigDaVoz, { fonte: 'elevenlabs' }>
export type ConfigFish = Extract<ConfigDaVoz, { fonte: 'fish' }>
export type ConfigImportado = Extract<ConfigDaVoz, { fonte: 'importado' }>

/**
 * A config de partida, da voz padrao das Configuracoes. null = nenhuma voz
 * escolhida ainda (a tela manda para Configuracoes > Voz, ou para "Importar").
 */
export function configPadrao(voz: VozPadrao): ConfigDaVoz | null {
  const velocidadeNativa = velocidadeNativaDoPerfil(voz)
  if (voz.provedor === 'elevenlabs' && voz.voiceId) {
    return {
      fonte: 'elevenlabs',
      voiceId: voz.voiceId,
      modelId: voz.modelId || MODELO_PADRAO.elevenlabs,
      velocidadeNativa,
      velocidade: 1,
      cortarPausas: true,
      settings: settingsElevenSchema.parse({}),
    }
  }
  if (voz.provedor === 'fish' && voz.voiceId) {
    return {
      fonte: 'fish',
      voiceId: voz.voiceId,
      modelId: voz.modelId || MODELO_PADRAO.fish,
      velocidadeNativa,
      velocidade: 1,
      cortarPausas: true,
      settings: settingsFishSchema.parse({}),
    }
  }
  return null
}

/** Na faixa e no passo de 0,05 (o slider soma em ponto flutuante; 1.2000000002 viraria outra chave de cache). */
export function arrumarVelocidadeNativa(v: number): number {
  if (!Number.isFinite(v)) return VELOCIDADE_NATIVA_PADRAO
  const passo = Math.round(v / VELOCIDADE_NATIVA_PASSO) * VELOCIDADE_NATIVA_PASSO
  return Math.round(Math.min(VELOCIDADE_NATIVA_MAX, Math.max(VELOCIDADE_NATIVA_MIN, passo)) * 100) / 100
}

/** A velocidade nativa do perfil: a salva, ou VELOCIDADE_NATIVA_PADRAO (perfil de antes do campo). */
export function velocidadeNativaDoPerfil(voz: Pick<VozPadrao, 'velocidadeNativa'>): number {
  return voz.velocidadeNativa === undefined ? VELOCIDADE_NATIVA_PADRAO : arrumarVelocidadeNativa(voz.velocidadeNativa)
}

/**
 * A velocidade nativa que de fato vai ao provedor: 1 no audio importado e nos
 * modelos sem speed (eleven_v4: modeloEleven(...).estilo === false). E ela que
 * entra na chave do cache, no corpo do pedido e no ritmo.
 */
export function velocidadeNativaEnviada(c: ConfigDaVoz): number {
  if (c.fonte === 'importado') return 1
  if (c.fonte === 'elevenlabs' && !modeloEleven(c.modelId).estilo) return 1
  return c.velocidadeNativa
}

/**
 * As duas configs geram o MESMO bruto (mesma fonte, voz, modelo, settings,
 * velocidade nativa e audio): so o pos muda. A tela usa para escolher entre
 * ajustarVoz (gratis) e gerarVoz (paga, com estimativa).
 */
export function soMudaOPos(a: ConfigDaVoz, b: ConfigDaVoz): boolean {
  return assinaturaSemPos(a) === assinaturaSemPos(b)
}

/**
 * A config sem o pos, com as chaves em ordem (a tela e o zod podem montar o
 * objeto em ordens diferentes). A velocidade nativa entra como a ENVIADA: no
 * eleven_v4 trocar o numero nao muda o audio, e nao pode virar gasto.
 */
function assinaturaSemPos(c: ConfigDaVoz): string {
  const resto: Record<string, unknown> = { ...c }
  delete resto['velocidade']
  delete resto['cortarPausas']
  delete resto['cortarErros']
  if (c.fonte !== 'importado') resto['velocidadeNativa'] = velocidadeNativaEnviada(c)
  return JSON.stringify(emOrdem(resto))
}

function emOrdem(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(emOrdem)
  if (typeof x !== 'object' || x === null) return x
  const obj = x as Record<string, unknown>
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, emOrdem(obj[k])]))
}

// ------------------------------------------------------- palavras e trechos

const fraseIdSchema = z.string().regex(/^f\d{2,}$/)
const segundosSchema = z.number().nonnegative()

/** Uma palavra DO ROTEIRO com o tempo em que ela soa no arquivo do take. */
export const palavraComTempoSchema = z.object({
  /** Token do roteiro (palavrasDaFrase), com a pontuacao: e o que a legenda mostra. */
  texto: z.string().min(1),
  start: segundosSchema,
  end: segundosSchema,
  fraseId: fraseIdSchema,
})
export type PalavraComTempo = z.infer<typeof palavraComTempoSchema>

/**
 * O pedaco do arquivo que pertence a uma frase. Os trechos COBREM o arquivo
 * inteiro, em ordem, sem buraco nem sobreposicao: trechos[0].offset = 0,
 * offset[i+1] = offset[i] + duracao[i], soma = duracao do take. A fronteira cai
 * no MEIO da pausa entre as frases (nunca dentro de palavra). E isso que deixa
 * regravar uma frase trocando so o pedaco dela no bruto, com os tempos
 * seguintes deslocados pela diferenca exata.
 */
export const trechoDaFraseSchema = z.object({
  fraseId: fraseIdSchema,
  offset: segundosSchema,
  duracao: segundosSchema,
  /** hashDoTexto(texto): muda quando o que se FALA na frase muda. */
  hashTexto: z.string().regex(/^[0-9a-f]{16}$/),
  /** O texto falado (textoFalado) quando o trecho foi gravado: a tela mostra "antes". */
  texto: z.string(),
})
export type TrechoDaFrase = z.infer<typeof trechoDaFraseSchema>

/** Nome de arquivo dentro de <userData>/recaps/<rascunhoId>/voz/ (ver electron/services/voz/pastas.ts). */
const arquivoNarracaoSchema = z.string().regex(/^narracao-[0-9a-f]{16,64}\.wav$/)
const arquivoBrutoSchema = z.string().regex(/^bruto-[0-9a-f]{16,64}\.wav$/)

/**
 * Um trecho FALADO que nao e do roteiro (so no audio importado, V1): o Whisper
 * ouviu, o casamento com o roteiro nao achou par, o wav2vec2 deu o tempo.
 *   - 'repeticao': a mesma parte do roteiro dita de novo logo depois (fica a
 *     ULTIMA leitura; esta e a de antes);
 *   - 'hesitacao': "eee", "hum";
 *   - 'sobra': palavras a mais.
 * `corte` = o pedaco que sai (pontas em quadro calado, nunca em palavra do
 * roteiro). null = ficou: `motivo` diz por que.
 */
export const trechoDeErroSchema = z.object({
  /** Onde a fala do trecho soa no bruto. */
  de: segundosSchema,
  ate: segundosSchema,
  corte: z.object({ de: segundosSchema, ate: segundosSchema }).nullable(),
  /** O que o Whisper ouviu (so para a tela). */
  falado: z.string().max(300),
  tipo: z.enum(['repeticao', 'hesitacao', 'sobra']),
  motivo: z.enum(['longo', 'sem-silencio', 'incerto']).nullable().default(null),
})
export type TrechoDeErro = z.infer<typeof trechoDeErroSchema>

/**
 * O audio ANTES do pos: o que o provedor devolveu (ou o importado
 * decodificado), em WAV, sem corte e sem o "acelerar" (na velocidade nativa
 * em que foi gerado), com os tempos dele. E
 * daqui que o pos parte -- sempre --, entao trocar a velocidade ou ligar/desligar
 * o corte nao paga de novo e nao perde frase regravada.
 */
export const audioBrutoSchema = z.object({
  arquivo: arquivoBrutoSchema,
  duracao: segundosSchema,
  palavras: z.array(palavraComTempoSchema),
  trechos: z.array(trechoDaFraseSchema),
  /** Os trechos fora do roteiro achados no importado (V1). Vazio nas outras fontes e nos takes de antes. */
  erros: z.array(trechoDeErroSchema).default([]),
})
export type AudioBruto = z.infer<typeof audioBrutoSchema>

export const origemDoAlinhamentoSchema = z.enum(['provedor', 'normalizado', 'alinhador'])
export type OrigemDoAlinhamento = z.infer<typeof origemDoAlinhamentoSchema>

/** Uma chamada PAGA (ou que seria paga, quando veio do cache) ao provedor. */
export const chamadaAoProvedorSchema = z.object({
  /** Cabecalho `request-id` do ElevenLabs (costura, ate 2 h). null = Fish ou nao veio. */
  requestId: z.string().max(128).nullable(),
  /** Caracteres do `text` (o contexto previous/next nao entra). */
  caracteres: z.number().int().nonnegative(),
  /** Veio do cache do motor: nao cobrou. */
  doCache: z.boolean(),
  /** As frases que esta chamada narrou. */
  fraseIds: z.array(fraseIdSchema),
  /** output_format / format pedido ("wav_44100"). */
  formato: z.string().max(32),
})
export type ChamadaAoProvedor = z.infer<typeof chamadaAoProvedorSchema>

/** Um TAKE: uma narracao inteira, pronta para ouvir. */
export const takeDaVozSchema = z.object({
  /** 't1', 't2'... na ordem de criacao, nunca reaproveitado (proximoTakeId). */
  id: z.string().regex(/^t\d+$/),
  config: configDaVozSchema,
  /** A narracao montada (depois do pos): WAV PCM, nome enderecado por conteudo. */
  arquivo: arquivoNarracaoSchema,
  duracao: segundosSchema,
  /** Todas as palavras do roteiro, em ordem, com tempo NO ARQUIVO do take. */
  palavras: z.array(palavraComTempoSchema),
  /** Um por frase, na ordem do roteiro; cobrem o arquivo inteiro. */
  trechos: z.array(trechoDaFraseSchema),
  /** O mesmo antes do pos (sem o "acelerar", sem corte). */
  bruto: audioBrutoSchema,
  origemDoAlinhamento: origemDoAlinhamentoSchema,
  /**
   * Quanto o alinhamento confia: palavras com tempo medido (o resto foi
   * interpolado) e, no alinhador, o score medio (abaixo de ~0,35 o texto nao e
   * o do audio). null = nao se aplica.
   */
  qualidade: z
    .object({
      ancoradas: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      score: z.number().nullable(),
      /**
       * Palavras cujo tempo o SOM desmente (esticada sobre uma pausa, ou uma
       * "pausa" marcada em cima da fala): nao contam como ancoradas, e uma so
       * ja deixa o alinhamento fraco. 0 nos takes de antes desta conferencia.
       */
      suspeitas: z.number().int().nonnegative().default(0),
    })
    .nullable()
    .default(null),
  /** Caracteres mandados ao provedor para criar ESTE take (o que custaria sem cache). 0 no importado e no ajuste. */
  caracteres: z.number().int().nonnegative(),
  /** Creditos de fato cobrados agora (0 = cache, importado ou ajuste). */
  cobrados: z.number().nonnegative().default(0),
  chamadas: z.array(chamadaAoProvedorSchema).default([]),
  criadoEm: z.string(),
  /** A versao do roteiro (Roteiro.versao) narrada. So informativo: quem diz se esta velho e frasesMudadas. */
  roteiroVersao: z.number().int().positive(),
  /** O take de onde este saiu (regravar, ajustar). null = do zero. */
  derivadoDe: z.string().regex(/^t\d+$/).nullable().default(null),
  /** Frases geradas de novo NESTE take, em relacao ao derivadoDe. Vazio num take do zero ou num ajuste. */
  regravadas: z.array(fraseIdSchema).default([]),
  /** Recados em ASCII ("3 palavras sem tempo medido", "wav_44100 recusado, 24 kHz"). */
  avisos: z.array(z.string()).default([]),
  /**
   * O volume: o loudness MEDIDO na narracao antes do ganho (LUFS) e o ganho
   * aplicado (dB) para chegar a referencia comum (electron/services/voz/volume.ts).
   * null = take de antes disto, ou a medida falhou (a narracao ficou como veio).
   */
  volume: z.object({ lufs: z.number(), ganho: z.number() }).nullable().default(null),
})
export type TakeDaVoz = z.infer<typeof takeDaVozSchema>

// -------------------------------------------------------- estado no rascunho

/**
 * O que o passo 3 guarda no rascunho do recap (RascunhoDoRecap.voz). null no
 * rascunho = o passo 3 nunca rodou (e o que um rascunho v1 le).
 */
export const estadoDaVozSchema = z
  .object({
    versao: z.literal(VOZ_VERSAO).default(VOZ_VERSAO),
    /** Todos os takes, na ordem de criacao ("Takes anteriores"). */
    takes: z.array(takeDaVozSchema),
    /** O take na tela. null = nenhum ainda. */
    atual: z.string().nullable(),
    /** O take `atual` foi aprovado. Novo take ou troca de take desaprova. */
    aprovado: z.boolean(),
    aprovadoEm: z.string().nullable(),
  })
  .superRefine((v, ctx) => {
    const ids = new Set<string>()
    for (const [i, t] of v.takes.entries()) {
      if (ids.has(t.id)) ctx.addIssue({ code: 'custom', path: ['takes', i, 'id'], message: `take repetido: ${t.id}` })
      ids.add(t.id)
    }
    if (v.atual !== null && !ids.has(v.atual)) {
      ctx.addIssue({ code: 'custom', path: ['atual'], message: `take atual inexistente: ${v.atual}` })
    }
    if (v.aprovado && v.atual === null) {
      ctx.addIssue({ code: 'custom', path: ['aprovado'], message: 'voz aprovada sem take' })
    }
  })
export type EstadoDaVoz = z.infer<typeof estadoDaVozSchema>

export const VOZ_VAZIA: EstadoDaVoz = { versao: VOZ_VERSAO, takes: [], atual: null, aprovado: false, aprovadoEm: null }

// ------------------------------------------------------- pedidos (IPC, zod)

const pedidoIdSchema = z.string().min(1).max(64)

/**
 * O que estimar:
 * - 'tudo': o roteiro inteiro com esta config (o "Gerar voz" e o "Gerar tudo
 *   de novo");
 * - 'frases': regravar estas frases sobre o take ATUAL, com a config dele. O
 *   motor soma as que mudaram/entraram no roteiro (frasesParaRegravar).
 */
export const pedidoDeEstimativaSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('tudo'), config: configDaVozSchema }),
  z.object({ tipo: z.literal('frases'), fraseIds: z.array(fraseIdSchema) }),
])
export type PedidoDeEstimativa = z.infer<typeof pedidoDeEstimativaSchema>

/**
 * `confirmado` = os creditos A COBRAR que a tela mostrou e o Levi aceitou
 * (EstimativaDeCusto.aCobrar). O motor recalcula na hora e RECUSA se o custo
 * real passar disso (cache apagado, roteiro mudou no meio). Custo 0 dispensa.
 */
export const pedidoDeGeracaoSchema = z.object({
  config: configDaVozSchema,
  pedidoId: pedidoIdSchema,
  confirmado: z.number().nonnegative(),
})
export type PedidoDeGeracao = z.infer<typeof pedidoDeGeracaoSchema>

/**
 * Regravar frases do take atual, com a mesma config. O take novo segue o
 * roteiro ATUAL: as pedidas + as mudadas + as novas sao geradas (com contexto
 * previous_text/next_text das vizinhas), as removidas saem, o resto reaproveita
 * o bruto do take atual. Lista vazia = "Atualizar a voz" (so o que mudou).
 * So ElevenLabs e Fish: no importado, o caminho e importar de novo.
 */
export const pedidoDeRegravarSchema = z.object({
  fraseIds: z.array(fraseIdSchema),
  pedidoId: pedidoIdSchema,
  confirmado: z.number().nonnegative(),
})
export type PedidoDeRegravar = z.infer<typeof pedidoDeRegravarSchema>

/** Trocar so o pos do take atual (acelerar, corte de pausa): take novo, de graca. A velocidade nativa fica a do take. */
export const pedidoDeAjusteSchema = z.object({
  velocidade: velocidadeSchema,
  cortarPausas: cortarPausasSchema,
  /** So no importado (V1). Ausente = fica o do take. */
  cortarErros: z.boolean().optional(),
  pedidoId: pedidoIdSchema,
})
export type PedidoDeAjuste = z.infer<typeof pedidoDeAjusteSchema>

/** O audio que ele gravou (.wav/.mp3/.m4a...). O pos e opcional como nas outras fontes. */
export const pedidoDeImportacaoSchema = z.object({
  caminho: z.string().min(1).max(1024),
  velocidade: velocidadeSchema,
  /** Padrao false aqui: a pausa de quem gravou costuma ser de proposito. */
  cortarPausas: z.boolean().default(false),
  /** Padrao true: repeticao, "eee" e frase lida duas vezes saem (V1). */
  cortarErros: z.boolean().default(true),
  pedidoId: pedidoIdSchema,
})
export type PedidoDeImportacao = z.infer<typeof pedidoDeImportacaoSchema>

// ---------------------------------------------------- respostas (main -> tela)

/** A resposta do estimarVoz: o que a tela mostra ANTES de gastar. */
export interface EstimativaDeCusto {
  fonte: FonteDaVoz
  /** As frases que seriam geradas, na ordem do roteiro. */
  fraseIds: string[]
  /** Caracteres do texto que iria ao provedor (o `text`; contexto fora). */
  caracteres: number
  /** Desses, os que seriam PAGOS (fora do cache). 0 = nada a pagar. */
  pagos: number
  /**
   * Creditos a cobrar, pela conta CONSERVADORA (caracteres fora do cache x
   * creditosPorCaractere do modelo). 0 = nada a pagar. E a unidade do
   * `confirmado`: o motor recusa se o custo real passar disto.
   */
  aCobrar: number
  /**
   * Os creditos que a conta de fato cobraria, pela taxa APRENDIDA do cabecalho
   * character-cost das chamadas anteriores (a conta payg do Levi cobra ~0,22 por
   * caractere). null = ainda sem taxa aprendida para esta fonte/modelo.
   */
  creditos: number | null
  /** Tudo ja esta no cache (ou e importado/ajuste): nao gasta nada. */
  doCache: boolean
  /** ElevenLabs: limite - usados (GET /v1/user/subscription, que nao gasta). null = nao deu para ler, ou Fish. */
  restam: number | null
  limite: number | null
  plano: string | null
  /** Fish: saldo da API em dolar, como o Fish manda. null no ElevenLabs. */
  saldo: string | null
  /** restam >= aCobrar. null = nao da para saber (Fish, ou o saldo nao veio). */
  suficiente: boolean | null
  /** Recado em ASCII ("Passa do limite do modelo (5.000)"). null = nada. */
  aviso: string | null
}

/** O que gerarVoz / regravarFrases / ajustarVoz / importarAudio devolvem. */
export interface VozGerada {
  /** O rascunho INTEIRO como ficou no disco (a tela troca o dela por ele). */
  rascunho: RascunhoDoRecap
  /** O take novo (ja e o `atual`, menos com `soNoHistorico`). */
  take: TakeDaVoz
  /** Creditos cobrados nesta chamada (0 = cache, importado ou ajuste). */
  cobrados: number
  /**
   * O Cancelar chegou depois de a resposta PAGA voltar: o take entrou so na
   * lista de takes, sem virar o atual nem tirar a aprovacao (mesma regra do
   * cancelarRoteiro). O que foi pago nunca se perde.
   */
  soNoHistorico: boolean
  avisos: string[]
}

/** O audio de um take publicado no servidor de midia local, com a onda para a Waveform. */
export interface AudioDoTake {
  takeId: string
  /** http://127.0.0.1:<porta>/m/<id> -- o media-src da CSP ja libera. */
  url: string
  duracao: number
  /** Picos 0..1 (analyzeAudio), para a Waveform. */
  peaks: number[]
  rms: number[]
  /** O bruto publicado (so o importado com erros, V1): ouvir o trecho que saiu. */
  urlDoBruto?: string
}

export const ROTULO_DA_ETAPA_DA_VOZ = {
  preparando: 'Preparando',
  gerando: 'Gerando a voz',
  transcrevendo: 'Ouvindo o audio',
  alinhando: 'Alinhando as palavras',
  ajustando: 'Ajustando',
  montando: 'Montando a narracao',
} as const
export type EtapaDaVoz = keyof typeof ROTULO_DA_ETAPA_DA_VOZ

/** main -> renderer, varias vezes por chamada lenta. */
export interface ProgressoDaVoz {
  rascunhoId: string
  pedidoId: string
  etapa: EtapaDaVoz
  /** Frase pronta, ASCII: "Pedindo a voz ao ElevenLabs...", "Alinhando 182 palavras...". */
  mensagem: string
  /** 0..1 quando da para medir. null = indeterminado. */
  fracao: number | null
}

// ------------------------------------------------------------ texto falado

/**
 * O que a voz FALA de uma frase: sem marcacao entre colchetes ou parenteses (a
 * mesma regra do tokenizeWithBreaks do Dangai: "[pausa]" nao se narra), sem
 * grifo de markdown (*~`, a regra do semGrifo do readScript) e com espacos
 * normalizados. E o que vai ao provedor, o que conta caractere e o que entra no
 * hash -- e as palavras do take saem DESTE texto, entao a voz nunca fala algo
 * que a legenda nao mostra.
 */
export function textoFalado(texto: string): string {
  return texto
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[*~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** As palavras de uma frase, como a legenda vai mostrar (tokenizeScript do Dangai). */
export function palavrasDaFrase(texto: string): string[] {
  return tokenizeScript(textoFalado(texto))
}

/** Caracteres como o provedor conta (pontos de codigo, NFC). */
export function contarCaracteres(texto: string): number {
  return [...texto.normalize('NFC')].length
}

/**
 * Hash curto (64 bits, hex) do texto falado. NAO e criptografico: serve para
 * saber se a frase mudou, e roda igual no main e no renderer (sem node:crypto).
 * O cache do motor usa sha256.
 */
export function hashDoTexto(texto: string): string {
  const s = textoFalado(texto).normalize('NFC')
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

/** Uma frase dentro do texto que vai ao provedor. */
export interface FraseParaNarrar {
  fraseId: string
  /** textoFalado da frase. */
  texto: string
  hash: string
  /** Faixa [de, ate) em UNIDADES DE STRING do JS dentro de `texto` do take (o alignment do ElevenLabs e por caractere). */
  de: number
  ate: number
  palavras: string[]
}

/**
 * O texto de UM take do roteiro inteiro (prosodia continua): frases da mesma
 * secao separadas por espaco, secoes por linha em branco. Frase sem texto
 * falado fica de fora (validarRoteiro ja barra). `frases` diz onde cada uma
 * esta no texto: e assim que o alignment por caractere vira palavra e trecho.
 */
export function textoParaNarrar(roteiro: Pick<Roteiro, 'secoes'>): { texto: string; frases: FraseParaNarrar[] } {
  let texto = ''
  const frases: FraseParaNarrar[] = []
  for (const secao of roteiro.secoes) {
    let primeiraDaSecao = true
    for (const f of secao.frases) {
      const falado = textoFalado(f.texto)
      if (!falado) continue
      if (texto) texto += primeiraDaSecao ? SEPARADOR_DE_SECAO : SEPARADOR_DE_FRASE
      primeiraDaSecao = false
      const de = texto.length
      texto += falado
      frases.push({ fraseId: f.id, texto: falado, hash: hashDoTexto(falado), de, ate: texto.length, palavras: tokenizeScript(falado) })
    }
  }
  return { texto, frases }
}

/**
 * O contexto para regravar uma frase sozinha (previous_text / next_text): o
 * que vem antes e depois dela no roteiro, cortado em palavra inteira e no
 * maximo `max` caracteres de cada lado.
 */
export function contextoDaFrase(
  roteiro: Pick<Roteiro, 'secoes'>,
  fraseId: string,
  max = CONTEXTO_MAX_CARACTERES,
): { anterior: string; seguinte: string } {
  const { texto, frases } = textoParaNarrar(roteiro)
  const f = frases.find((x) => x.fraseId === fraseId)
  if (!f) return { anterior: '', seguinte: '' }
  const antes = texto.slice(0, f.de).trim()
  const depois = texto.slice(f.ate).trim()
  const anterior = antes.length <= max ? antes : antes.slice(antes.length - max).replace(/^\S*\s+/, '')
  const seguinte = depois.length <= max ? depois : depois.slice(0, max).replace(/\s+\S*$/, '')
  return { anterior, seguinte }
}

// --------------------------------------------------- roteiro x take (puras)

export interface MudancasNaVoz {
  /** Estao nos dois, mas o texto falado mudou. */
  mudadas: string[]
  /** Estao no roteiro e nao no take. */
  novas: string[]
  /** Estao no take e nao no roteiro. */
  removidas: string[]
  /** As que estao nos dois trocaram de ordem. */
  ordemMudou: boolean
}

/**
 * O que mudou no roteiro desde que o take foi gravado, pelo TEXTO FALADO de
 * cada frase (hashTexto). Texto de tela, evento e intencao visual nao contam:
 * a voz nao fala isso. Ids na ordem do roteiro (removidas: na ordem do take).
 */
export function frasesMudadas(roteiro: Pick<Roteiro, 'secoes'>, take: Pick<TakeDaVoz, 'trechos'>): MudancasNaVoz {
  const atuais = textoParaNarrar(roteiro).frases
  const doTake = new Map(take.trechos.map((t) => [t.fraseId, t]))
  const noRoteiro = new Set(atuais.map((f) => f.fraseId))
  const mudadas: string[] = []
  const novas: string[] = []
  for (const f of atuais) {
    const t = doTake.get(f.fraseId)
    if (!t) novas.push(f.fraseId)
    else if (t.hashTexto !== f.hash) mudadas.push(f.fraseId)
  }
  const removidas = take.trechos.filter((t) => !noRoteiro.has(t.fraseId)).map((t) => t.fraseId)
  const comunsRoteiro = atuais.map((f) => f.fraseId).filter((id) => doTake.has(id))
  const comunsTake = take.trechos.map((t) => t.fraseId).filter((id) => noRoteiro.has(id))
  const ordemMudou = comunsRoteiro.join(',') !== comunsTake.join(',')
  return { mudadas, novas, removidas, ordemMudou }
}

export function vozDesatualizada(m: MudancasNaVoz): boolean {
  return m.mudadas.length > 0 || m.novas.length > 0 || m.removidas.length > 0 || m.ordemMudou
}

/**
 * As frases que um "regravar" vai GERAR, na ordem do roteiro: as pedidas + as
 * que mudaram + as novas. Pedida que nao esta no roteiro e ignorada. O
 * estimarVoz ('frases') e o regravarFrases usam esta mesma conta, entao o
 * custo mostrado e o cobrado nunca divergem.
 */
export function frasesParaRegravar(
  roteiro: Pick<Roteiro, 'secoes'>,
  take: Pick<TakeDaVoz, 'trechos'>,
  pedidas: readonly string[],
): string[] {
  const m = frasesMudadas(roteiro, take)
  const queremos = new Set([...pedidas, ...m.mudadas, ...m.novas])
  return textoParaNarrar(roteiro)
    .frases.map((f) => f.fraseId)
    .filter((id) => queremos.has(id))
}

/** Caracteres das frases pedidas (o `text` de cada chamada), pela mesma regra do provedor. */
export function caracteresDasFrases(roteiro: Pick<Roteiro, 'secoes'>, fraseIds: readonly string[]): number {
  const ids = new Set(fraseIds)
  return textoParaNarrar(roteiro)
    .frases.filter((f) => ids.has(f.fraseId))
    .reduce((soma, f) => soma + contarCaracteres(f.texto), 0)
}

/** 60 -> "1 min", 90 -> "1 min 30". */
function textoDoAlvo(alvoSec: number): string {
  const min = Math.floor(alvoSec / 60)
  const seg = alvoSec % 60
  return min === 0 ? `${seg} s` : seg === 0 ? `${min} min` : `${min} min ${seg}`
}

/**
 * O take ficou abaixo do alvo do roteiro ("52 s - abaixo de 1 min"). null =
 * chegou. O Levi nao quer video abaixo de 1 min: o caminho e "Outra versao"
 * no roteiro (mais frases) ou menos acelerar.
 */
export function avisoDoAlvo(duracao: number, alvoSec: number): string | null {
  // Arredondado, como o player mostra (0:47.9 = "48 s"): e o take de referencia
  // do Levi (59,82 s, aprovado) nao vira aviso por 0,2 s.
  const segundos = Math.round(duracao)
  if (!(duracao > 0) || segundos >= alvoSec) return null
  return `${segundos} s - abaixo de ${textoDoAlvo(alvoSec)}`
}

/** A duracao da narracao montada: a soma dos trechos (que cobrem o arquivo). */
export function duracaoTotal(trechos: readonly Pick<TrechoDaFrase, 'duracao'>[]): number {
  return trechos.reduce((soma, t) => soma + t.duracao, 0)
}

/**
 * A palavra acesa no instante `t` (karaoke da tela): a ultima que ja COMECOU.
 * Na pausa depois de uma palavra ela continua acesa. -1 antes da primeira.
 * Busca binaria: chamada a cada quadro enquanto toca.
 */
export function palavraNoTempo(palavras: readonly Pick<PalavraComTempo, 'start'>[], t: number): number {
  let lo = 0
  let hi = palavras.length - 1
  let achou = -1
  while (lo <= hi) {
    const meio = (lo + hi) >> 1
    if (palavras[meio]!.start <= t) {
      achou = meio
      lo = meio + 1
    } else {
      hi = meio - 1
    }
  }
  return achou
}

/** A frase que toca no instante `t`. null = fora do arquivo. */
export function fraseNoTempo(trechos: readonly TrechoDaFrase[], t: number): string | null {
  for (const tr of trechos) {
    if (t >= tr.offset && t < tr.offset + tr.duracao) return tr.fraseId
  }
  return null
}

/**
 * Confere as regras de forma de um take (o motor chama antes de gravar; o zod
 * do rascunho NAO faz isto de proposito: um arredondamento nunca pode impedir
 * o rascunho de abrir). Vazio = tudo certo.
 */
export function conferirTake(take: Pick<TakeDaVoz, 'duracao' | 'palavras' | 'trechos'>): string[] {
  const problemas: string[] = []
  const tol = TOLERANCIA_SEC
  let cursor = 0
  const vistos = new Set<string>()
  for (const tr of take.trechos) {
    if (vistos.has(tr.fraseId)) problemas.push(`frase repetida nos trechos: ${tr.fraseId}`)
    vistos.add(tr.fraseId)
    if (Math.abs(tr.offset - cursor) > tol) problemas.push(`trecho ${tr.fraseId} comeca em ${tr.offset.toFixed(3)}, esperado ${cursor.toFixed(3)}`)
    cursor = tr.offset + tr.duracao
  }
  if (take.trechos.length > 0 && Math.abs(cursor - take.duracao) > tol) {
    problemas.push(`trechos somam ${cursor.toFixed(3)} s, o arquivo tem ${take.duracao.toFixed(3)} s`)
  }
  const porFrase = new Map(take.trechos.map((t) => [t.fraseId, t]))
  let anterior = -Infinity
  for (const [i, p] of take.palavras.entries()) {
    if (p.end < p.start) problemas.push(`palavra ${i} ("${p.texto}") termina antes de comecar`)
    if (p.start < anterior - tol) problemas.push(`palavra ${i} ("${p.texto}") fora de ordem`)
    anterior = p.start
    if (p.end > take.duracao + tol) problemas.push(`palavra ${i} ("${p.texto}") passa do fim do arquivo`)
    const tr = porFrase.get(p.fraseId)
    if (!tr) problemas.push(`palavra ${i} ("${p.texto}") de frase sem trecho: ${p.fraseId}`)
    else if (p.start < tr.offset - tol || p.end > tr.offset + tr.duracao + tol) {
      problemas.push(`palavra ${i} ("${p.texto}") fora do trecho de ${p.fraseId}`)
    }
  }
  return problemas
}

// ------------------------------------------------- transicoes do rascunho

/** O estado da voz do rascunho (VOZ_VAZIA quando o passo 3 nunca rodou). */
export function estadoDaVoz(r: Pick<RascunhoDoRecap, 'voz'>): EstadoDaVoz {
  return r.voz ?? VOZ_VAZIA
}

export function takeAtual(r: Pick<RascunhoDoRecap, 'voz'>): TakeDaVoz | null {
  const v = estadoDaVoz(r)
  if (v.atual === null) return null
  return v.takes.find((t) => t.id === v.atual) ?? null
}

/** 't' + (maior numero + 1). */
export function proximoTakeId(v: Pick<EstadoDaVoz, 'takes'>): string {
  const maior = v.takes.reduce((m, t) => Math.max(m, Number(t.id.slice(1)) || 0), 0)
  return `t${maior + 1}`
}

/**
 * Poe um take NOVO na lista. Vira o atual (e desaprova a voz), menos com
 * `soNoHistorico` (o Cancelar chegou depois da resposta paga): ai so entra na
 * lista. Sem take nenhum ainda, vira o atual de qualquer jeito.
 */
export function adicionarTake(
  r: RascunhoDoRecap,
  take: TakeDaVoz,
  agoraIso: string,
  soNoHistorico = false,
): RascunhoDoRecap {
  const v = estadoDaVoz(r)
  if (v.takes.some((t) => t.id === take.id)) throw new Error(`Take ${take.id} repetido.`)
  const vira = !soNoHistorico || v.atual === null
  return {
    ...r,
    voz: {
      ...v,
      takes: [...v.takes, take],
      atual: vira ? take.id : v.atual,
      aprovado: vira ? false : v.aprovado,
      aprovadoEm: vira ? null : v.aprovadoEm,
    },
    atualizadoEm: agoraIso,
  }
}

/** "Voltar para este take". Trocar de take desaprova a voz. */
export function escolherTake(r: RascunhoDoRecap, takeId: string, agoraIso: string): RascunhoDoRecap {
  const v = estadoDaVoz(r)
  if (!v.takes.some((t) => t.id === takeId)) throw new Error('Esse take nao existe mais.')
  if (v.atual === takeId) return r
  return { ...r, voz: { ...v, atual: takeId, aprovado: false, aprovadoEm: null }, atualizadoEm: agoraIso }
}

export type SituacaoDaVoz = 'sem-voz' | 'desatualizada' | 'pronta' | 'aprovada'

/**
 * Em que pe a voz esta, contra o roteiro ATUAL do rascunho:
 * - 'sem-voz': nenhum take;
 * - 'desatualizada': o roteiro mudou o que se fala (frasesMudadas) -- a
 *   aprovacao guardada nao vale ate atualizar;
 * - 'aprovada' / 'pronta'.
 * `roteiro` = roteiroAtual(r) (passado de fora para nao importar valor de roteiro.ts).
 */
export function situacaoDaVoz(r: Pick<RascunhoDoRecap, 'voz'>, roteiro: Pick<Roteiro, 'secoes'> | null): SituacaoDaVoz {
  const take = takeAtual(r)
  if (!take) return 'sem-voz'
  if (roteiro && vozDesatualizada(frasesMudadas(roteiro, take))) return 'desatualizada'
  return estadoDaVoz(r).aprovado ? 'aprovada' : 'pronta'
}

/**
 * "Aprovar voz". Recusa (com a frase para a tela) sem roteiro aprovado, sem
 * take, ou com a voz desatualizada.
 */
export function marcarVozAprovada(
  r: RascunhoDoRecap,
  roteiro: Pick<Roteiro, 'secoes'> | null,
  agoraIso: string,
): RascunhoDoRecap {
  if (!r.aprovado || !roteiro) throw new Error('Aprove o roteiro antes da voz.')
  const situacao = situacaoDaVoz(r, roteiro)
  if (situacao === 'sem-voz') throw new Error('Gere ou importe a voz antes de aprovar.')
  if (situacao === 'desatualizada') throw new Error('O roteiro mudou depois da voz. Atualize as frases antes de aprovar.')
  const v = estadoDaVoz(r)
  return { ...r, voz: { ...v, aprovado: true, aprovadoEm: agoraIso }, atualizadoEm: agoraIso }
}

export function desmarcarVozAprovada(r: RascunhoDoRecap, agoraIso: string): RascunhoDoRecap {
  const v = estadoDaVoz(r)
  if (!v.aprovado) return r
  return { ...r, voz: { ...v, aprovado: false, aprovadoEm: null }, atualizadoEm: agoraIso }
}

/** O "Proximo: Cenas (parte 4)" so liga com roteiro e voz aprovados e a voz em dia. */
export function podeIrParaCenas(r: RascunhoDoRecap, roteiro: Pick<Roteiro, 'secoes'> | null): boolean {
  return r.aprovado && situacaoDaVoz(r, roteiro) === 'aprovada'
}

/** Creditos gastos com voz neste rascunho (a soma do que cada take cobrou). */
export function creditosGastos(v: Pick<EstadoDaVoz, 'takes'>): number {
  return v.takes.reduce((soma, t) => soma + t.cobrados, 0)
}

// ------------------------------------------------------------- textos (ASCII)

/**
 * "1.034 caracteres (~227 creditos) · ElevenLabs · restam 9.745 creditos", ou
 * "Ja gerado, sem custo". Caractere e credito sao unidades DIFERENTES: o plano
 * conta creditos, e a conta do Levi cobra ~0,22 credito por caractere. Sem a
 * taxa aprendida ainda, so os caracteres.
 */
export function textoDaEstimativa(e: EstimativaDeCusto): string {
  if (e.fonte === 'importado') return 'Audio importado, sem custo'
  if (e.aCobrar === 0) return 'Ja gerado, sem custo'
  const caracteres = `${e.pagos.toLocaleString('pt-BR')} caracteres`
  const partes = [e.creditos !== null ? `${caracteres} (~${Math.ceil(e.creditos).toLocaleString('pt-BR')} creditos)` : caracteres, ROTULO_DA_FONTE[e.fonte]]
  if (e.restam !== null) partes.push(`restam ${e.restam.toLocaleString('pt-BR')} creditos`)
  else if (e.saldo !== null) {
    // O Fish manda o saldo cru ("7.541320"): na tela vai como nas Configuracoes (US$ 7,54).
    const valor = Number(e.saldo)
    const dinheiro = Number.isFinite(valor) ? valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : e.saldo
    partes.push(`saldo US$ ${dinheiro}`)
  }
  return partes.join(' · ')
}
