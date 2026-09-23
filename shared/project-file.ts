import { z } from 'zod'
import {
  captionBlockSchema,
  CAPTION_ANIMATION_DEFAULT,
  CAPTION_ANIMATION_FRAMES_DEFAULT,
  CAPTION_MARK_DEFAULT,
  CAPTION_SHADOW_DEFAULT,
  CAPTION_STROKE_DEFAULT,
  CAPTION_COLOR_DEFAULT,
  captionAnimationFramesSchema,
  captionAnimationSchema,
  captionMarkSchema,
  captionShadowSchema,
  captionStrokeSchema,
  captionColorSchema,
  captionScaleSchema,
  captionYSchema,
  END_CARD_SEC_DEFAULT,
  HOOK_SEC_DEFAULT,
  metadataSchema,
  MUSIC_GAIN_DB_DEFAULT,
  PLAN_ORIGINS,
  scenePlanSchema,
  transcriptSchema,
  FORMATOS,
  FORMATO_PADRAO,
} from './contract'

/**
 * O arquivo .dangai -- o projeto salvo.
 *
 * Guarda DECISAO, nunca pixel. Miniatura, recorte 9:16 e URL do servidor de
 * midia ficam de fora de proposito: sao derivados dos arquivos originais e se
 * refazem em segundos ao abrir. Guardados, um projeto de 46 imagens viraria
 * dezenas de megabytes de data URL -- e as URLs do servidor local morrem junto
 * com a sessao, porque a porta e os ids sao sorteados a cada abertura.
 *
 * O que sobra e exatamente o que o usuario nao consegue refazer sozinho: o
 * enquadramento de cada imagem, onde caem os cortes, e o texto das legendas
 * depois de mesclado, dividido e corrigido na mao.
 */

export const PROJECT_FILE_VERSION = 1
export const PROJECT_EXTENSION = 'dangai'

/**
 * Um arquivo do disco referenciado pelo projeto.
 *
 * Carrega os dois caminhos porque eles falham em situacoes diferentes: o
 * absoluto sobrevive a mover o .dangai sozinho, e o relativo sobrevive a mover
 * a pasta inteira -- que e o caso comum de quem trabalha uma pasta por video.
 */
const referenceSchema = z.object({
  path: z.string(),
  /** Relativo a pasta do .dangai, com barra normal. null se o arquivo mora fora dela. */
  rel: z.string().nullable(),
  fileName: z.string(),
})
export type FileReference = z.infer<typeof referenceSchema>

const savedImageSchema = referenceSchema.extend({
  focusX: z.number().min(0).max(1),
  focusY: z.number().min(0).max(1),
  /** Se o enquadramento veio do rosto detectado. Default para projeto antigo abrir. */
  focusAuto: z.boolean().default(false),
  /**
   * A parte do roteiro a que este material pertence.
   *
   * Sem gravar isto, salvar e reabrir perdia as partes em silencio: o plano
   * salvo abria certo, mas a primeira reanalise -- trocar o roteiro, acrescentar
   * material -- redistribuia tudo como se as partes nunca tivessem existido.
   */
  section: z.number().int().nonnegative().nullable().default(null),
  sectionName: z.string().optional(),
})
export type SavedImage = z.infer<typeof savedImageSchema>

/**
 * A escolha EM ANDAMENTO na Biblioteca.
 *
 * Marcar as cenas de um video e o trabalho mais longo do app -- sao ~39
 * trechos de roteiro e uma biblioteca de 20 mil clipes -- e ate aqui ele nao
 * sobrevivia a nada: a lista morava dentro do componente, entao fechar a
 * Biblioteca, salvar o projeto e reabrir jogavam tudo fora. Pedido dele:
 * "quando eu salvar enquanto estiver selecionando cenas na biblioteca eu
 * quero e preciso que salve a ordem que selecionei os clipes".
 *
 * A ORDEM E O CONTEUDO. Ela decide em que sequencia as cenas entram no video
 * (uso sem roteiro) e como o trecho se reparte entre elas (uso com roteiro) --
 * e no modo teoria ela e a unica informacao que existe, porque a ordem do
 * argumento nao esta em nenhuma ordenacao do acervo. Guardar o conjunto sem a
 * ordem seria guardar quase nada.
 */
const bibliotecaSchema = z
  .object({
    /**
     * Uso SEM roteiro: ids de clipe, na ordem de clique.
     *
     * Id e nao caminho absoluto -- o id da biblioteca e o caminho relativo a
     * raiz, que continua valendo se ele mover a pasta do acervo inteira.
     */
    escolhidos: z.array(z.string()).default([]),
    /**
     * As frases do roteiro, como estavam quando ele marcou.
     *
     * Sem isto o resto nao quer dizer nada: `porBloco` e indexado por posicao
     * da frase, e as frases nascem de uma passada do Whisper que nao roda de
     * novo ao abrir o projeto. Guardadas, os indices continuam apontando para
     * as mesmas frases; sem elas, apontariam para o vazio.
     */
    blocos: z
      .array(
        z.object({
          text: z.string(),
          start: z.number(),
          end: z.number(),
          sentence: z.number().int().nonnegative(),
        }),
      )
      .nullable()
      .default(null),
    /** frase -> caminhos das cenas dela, na ordem em que ele marcou. */
    porBloco: z.record(z.string(), z.array(z.string())).default({}),
    /** Quanto cada cena marcada pesa dentro do trecho. */
    pesos: z.record(z.string(), z.array(z.number())).default({}),
    /** Posicoes unidas com a seguinte, em tela dividida. */
    unioes: z.record(z.string(), z.array(z.number().int())).default({}),
    /** Onde ele puxou cada fronteira, em indice de palavra. */
    cortes: z.record(z.string(), z.array(z.number().int())).default({}),
    /** Qual frase estava aberta, para ele voltar onde parou. */
    ativo: z.number().int().nonnegative().nullable().default(null),
  })
  .default({
    escolhidos: [],
    blocos: null,
    porBloco: {},
    pesos: {},
    unioes: {},
    cortes: {},
    ativo: null,
  })
export type BibliotecaSalva = z.infer<typeof bibliotecaSchema>

/**
 * Campo novo entra sempre como opcional com padrao.
 *
 * Um projeto salvo hoje precisa continuar abrindo depois de qualquer versao
 * futura do app -- e o usuario nao tem como saber que a versao mudou o formato.
 */
export const projectFileSchema = z.object({
  version: z.number().int().positive(),
  savedAt: z.string(),
  /**
   * Vertical ou horizontal. Escolhido ao criar o projeto, e guardado aqui.
   *
   * Vem no arquivo e nao nas configuracoes porque e uma propriedade DESTE
   * video: reabrir um projeto horizontal com o app em modo vertical recortaria
   * tudo que ja foi enquadrado. Com default para projeto salvo antes disto --
   * todos eles sao verticais.
   */
  formato: z.enum(FORMATOS).default(FORMATO_PADRAO),
  audio: referenceSchema,
  images: z.array(savedImageSchema),
  script: z.string().nullable(),
  subtitle: referenceSchema.nullable(),
  plan: scenePlanSchema.nullable(),
  planOrigin: z.enum(PLAN_ORIGINS).nullable(),
  planEdited: z.boolean(),
  transcript: transcriptSchema.nullable(),
  captions: z.array(captionBlockSchema),
  captionsEdited: z.boolean(),
  captionsEnabled: z.boolean(),
  /** Cor do marcador de palavra. Default para projeto salvo antes dela existir. */
  captionColor: captionColorSchema.default(CAPTION_COLOR_DEFAULT),
  /** Altura da legenda na tela. Idem: projeto antigo abre nos 420px de sempre. */
  captionY: captionYSchema,
  /** Tamanho da legenda. Projeto antigo abre no tamanho padrao. */
  captionScale: captionScaleSchema,
  /**
   * A fonte escolhida, pelo NOME do arquivo.
   *
   * So o nome: a URL e do servidor local desta sessao e nao significa nada na
   * proxima abertura. Ao abrir o projeto, o nome e reencontrado na pasta -- e
   * se o arquivo nao estiver mais la, volta para a fonte embutida.
   */
  captionFont: z.string().default(''),
  /** Como a legenda entra. Default para projeto salvo antes disto abrir igual. */
  captionAnimation: captionAnimationSchema.default(CAPTION_ANIMATION_DEFAULT),
  /** Velocidade da entrada elastica, em frames. Default para projeto antigo. */
  captionAnimationFrames: captionAnimationFramesSchema.default(
    CAPTION_ANIMATION_FRAMES_DEFAULT,
  ),
  /** Cor na palavra dita ou na legenda toda. Default = o de sempre. */
  captionMark: captionMarkSchema.default(CAPTION_MARK_DEFAULT),
  /** A sombra do texto. Default para projeto salvo antes dela existir. */
  captionShadow: captionShadowSchema.default(CAPTION_SHADOW_DEFAULT),
  /** Espessura do contorno. Default para projeto salvo antes dela existir. */
  captionStroke: captionStrokeSchema.default(CAPTION_STROKE_DEFAULT),
  /**
   * Os SFX postos a mao na faixa. Default vazio para projeto antigo abrir com
   * o rodizio automatico, que era o unico jeito ate aqui.
   */
  sfxManual: z
    .array(
      z.object({
        id: z.string(),
        path: z.string(),
        fileName: z.string(),
        at: z.number().nonnegative(),
        /** Com default para projeto salvo antes do chip ter onda e largura. */
        durationSec: z.number().positive().default(0.5),
        peaks: z.array(z.number().min(0).max(1)).default([]),
        /** Quanto do som toca. null = inteiro. Default para projeto antigo. */
        usarSec: z.number().positive().nullable().default(null),
        /** Ganho sobre o nivel padrao. Zero = como o app sempre fez. */
        gainDb: z.number().default(0),
      }),
    )
    .default([]),
  sfxEnabled: z.boolean(),
  /** Cama de musica. Com default para projeto salvo antes dela existir abrir igual. */
  music: referenceSchema.nullable().default(null),
  musicGainDb: z.number().default(MUSIC_GAIN_DB_DEFAULT),
  /** Gancho e fechamento. Texto vazio significa "sem card". */
  hookText: z.string().default(''),
  hookSec: z.number().default(HOOK_SEC_DEFAULT),
  endText: z.string().default(''),
  endSec: z.number().default(END_CARD_SEC_DEFAULT),
  /** Textos de publicacao ja gerados. Salvos para nao gastar outra chamada. */
  metadata: metadataSchema.nullable().default(null),
  /**
   * A escolha em andamento na Biblioteca. Default vazio: projeto salvo antes
   * disto reabre sem selecao, que e exatamente como ele foi salvo.
   */
  biblioteca: bibliotecaSchema,
})
export type ProjectFile = z.infer<typeof projectFileSchema>

/**
 * O autosave embrulha o projeto para carregar tambem de onde ele veio.
 *
 * Sem isso, recuperar depois de uma queda perderia o vinculo com o .dangai do
 * usuario e o proximo Ctrl+S perguntaria a pasta de novo -- convidando a salvar
 * uma segunda copia ao lado da primeira.
 */
export const autosaveSchema = z.object({
  projectPath: z.string().nullable(),
  file: projectFileSchema,
})
export type Autosave = z.infer<typeof autosaveSchema>

/** O que o main devolve depois de achar os arquivos no disco. */
export interface OpenedProject {
  /** Caminho do .dangai. null quando o projeto nunca foi salvo pelo usuario. */
  path: string | null
  /** Ja com os caminhos reescritos para onde os arquivos estao AGORA. */
  file: ProjectFile
}
