/**
 * [recap] Os tipos da voz que no Studio moravam em shared/channels.ts. O
 * nucleo do Dangai nao tem voz; o modulo guarda os dele aqui.
 */

export type ProvedorDeVoz = 'elevenlabs' | 'fish'

/**
 * A voz que narra. Uma so, e nao uma por provedor: o que importa e qual voz o
 * recap usa, e o provedor vem junto dela.
 */
export interface VozPadrao {
  /** '' = ainda nao escolhida. */
  provedor: ProvedorDeVoz | ''
  /** O voice_id do ElevenLabs ou o _id do modelo do Fish Audio. */
  voiceId: string
  /** Modelo de TTS (eleven_multilingual_v2, s2.1-pro...). Vazio = o padrao do provedor. */
  modelId: string
  /**
   * A velocidade NATIVA da voz nova (0,7-1,2, shared/voz.ts). O main sempre
   * devolve preenchida (perfil de antes do campo = 1,2); opcional so no envio:
   * gravar so a voz mantem a velocidade que ja estava.
   */
  velocidadeNativa?: number
}

/** Uma voz da conta, como o "Testar" lista para o select. */
export interface VozDoProvedor {
  id: string
  nome: string
  /** Idioma e rotulos curtos ("pt, male"), para reconhecer sem ouvir. '' = nada. */
  detalhe: string
  /** Amostra da voz. null = o provedor nao deu. */
  previewUrl: string | null
}

/**
 * O resultado do "Testar" de uma chave de voz. Testar nao gasta caractere nem
 * credito: so le o plano/saldo e a lista de vozes.
 */
export interface TesteDeVoz {
  provedor: ProvedorDeVoz
  /** O plano da conta (ElevenLabs: o tier). null = nao veio. */
  plano: string | null
  /** ElevenLabs: caracteres usados no periodo e o limite. null no Fish. */
  usados: number | null
  limite: number | null
  /** Fish Audio: saldo da API, como o Fish manda (texto, em dolar). null no ElevenLabs. */
  saldo: string | null
  /** As vozes da conta, as proprias primeiro. */
  vozes: VozDoProvedor[]
  /** A chave vale, mas algo ficou de fora (sem creditos, sem permissao, sem voz). null = tudo certo. */
  aviso: string | null
  /**
   * (21/10) Uma linha NEUTRA, sem cor de erro: "Modelo gratis: nao usa saldo",
   * "a conta nao tem voz propria: escolha uma da biblioteca". null = nada.
   */
  nota?: string | null
}

/**
 * (21/10) As vozes PUBLICAS da biblioteca do Fish Audio (GET /model, sem o
 * self): as mais usadas em portugues, ou o resultado de uma busca por nome.
 * Listar nao gasta nada.
 */
export interface BibliotecaDoFish {
  /** A busca que deu esta lista ('' = as populares). */
  busca: string
  vozes: VozDoProvedor[]
  /** Nada em portugues com esse nome: a lista veio de todas as linguas. */
  todasAsLinguas: boolean
}

/** Os campos de chave do modulo (camposDeChave): os MESMOS nomes do settings do Studio, que a parte 5 migra. */
export const CAMPOS_DE_CHAVE_DA_VOZ = ['elevenlabsApiKey', 'fishApiKey'] as const
export type CampoDeChaveDaVoz = (typeof CAMPOS_DE_CHAVE_DA_VOZ)[number]

/**
 * O que a tela sabe da voz (o PublicSettings do Studio, so a parte da voz): das
 * chaves, so se existe e a dica (o `chaves` do ModuloPublico); nunca a chave.
 */
export interface AjustesDaVoz {
  hasElevenKey: boolean
  elevenKeyHint: string
  hasFishKey: boolean
  fishKeyHint: string
  vozPadrao: Required<VozPadrao>
  /** (01/11) A ultima voz e o modelo de cada provedor (ConfigDoRecap.vozesGuardadas). */
  vozesGuardadas: Record<ProvedorDeVoz, { voiceId: string; modelId: string }>
}
