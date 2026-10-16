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
