import {
  PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO,
  preferenciasDaEdicaoRapidaSchema,
  type PreferenciasDaEdicaoRapida,
} from './edicao-rapida'
import type { VozPadrao } from './tipos-da-voz'
import { arrumarVelocidadeNativa, VELOCIDADE_NATIVA_PADRAO } from './voz'

/**
 * [recap] A CONFIGURACAO DO MODULO, em `Settings.modulos.recap` (o nucleo
 * guarda sem ler; quem confere e o coerce daqui).
 *
 * - a biblioteca: a pasta em que o recap GRAVA (os indices dos episodios em
 *   `_indices/`, e na parte 4 as cenas que ele corta). E separada da
 *   libraryDir do Dangai de proposito: aquela pode ser a saida do AnCut ou do
 *   Corte Cenas, que sao so leitura;
 * - a voz padrao (parte 2): a voz que narra, com o MESMO nome e formato do
 *   `vozPadrao` do settings do Studio (a parte 5 migra o dele). As chaves
 *   (elevenlabsApiKey, fishApiKey) NAO moram aqui: sao campos de chave do
 *   modulo, no cofre do nucleo.
 * - a Edicao rapida (parte 3): a pasta de musicas (padrao VAZIO: a do Studio,
 *   `G:/App Resumo/music`, e da maquina do Levi; a parte 5 migra a dele) e as
 *   preferencias (o que ela faz, a caixinha do "Abrir no editor" e o preset
 *   de cor), com os MESMOS nomes do settings do Studio.
 */
export interface ConfigDoRecap {
  /** '' = o padrao, <Documentos>/Dangai/Recap/Biblioteca (separado do Studio). */
  biblioteca: string
  /** A voz que narra o recap. Sem voz escolhida: provedor ''. */
  vozPadrao: Required<VozPadrao>
  /** A pasta de musicas da Edicao rapida (so leitura). '' = nenhuma: sem musica. */
  pastaDeMusicas: string
  edicaoRapidaPadrao: PreferenciasDaEdicaoRapida
}

/** O que a tela ve (o paraRenderer): sem segredo nenhum. */
export interface ConfigDoRecapNaTela extends ConfigDoRecap {
  /** A pasta resolvida: a escolhida ou o padrao. */
  bibliotecaEfetiva: string
  /**
   * A libraryDir do Dangai (so leitura aqui): o assistente sabe se as cenas de
   * um episodio achado estao na Biblioteca do editor sem ler as configuracoes
   * do nucleo.
   */
  bibliotecaDoDangai: string
  /** A pasta de musicas que vale agora ('' = nenhuma, ou a escolhida sumiu). */
  pastaDeMusicasEfetiva: string
}

/** Sem voz: o "sem voz" da parte 1, na velocidade nativa padrao (1,2). */
export const SEM_VOZ: Required<VozPadrao> = { provedor: '', voiceId: '', modelId: '', velocidadeNativa: VELOCIDADE_NATIVA_PADRAO }

export const CONFIG_PADRAO: ConfigDoRecap = {
  biblioteca: '',
  vozPadrao: SEM_VOZ,
  pastaDeMusicas: '',
  edicaoRapidaPadrao: PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO,
}

/** O que veio do disco, conferido campo a campo. Campo errado vale o padrao. */
export function coerceConfig(raw: unknown): ConfigDoRecap {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const biblioteca = typeof r['biblioteca'] === 'string' ? r['biblioteca'].trim() : ''
  const pastaDeMusicas = typeof r['pastaDeMusicas'] === 'string' ? r['pastaDeMusicas'].trim() : ''
  return {
    biblioteca,
    vozPadrao: vozSalva(r['vozPadrao']),
    pastaDeMusicas,
    edicaoRapidaPadrao: preferenciasDaEdicaoRapidaSchema.catch(PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO).parse(r['edicaoRapidaPadrao'] ?? {}),
  }
}

/**
 * O patch da tela por cima da config de agora. Gravar so a voz (escolher outra
 * no select, sem `velocidadeNativa`) mantem a velocidade que ja estava, como o
 * saveSettings do Studio.
 */
export function aplicarPatch(atual: ConfigDoRecap, patch: unknown): ConfigDoRecap {
  const p = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {}
  const voz = p['vozPadrao']
  const comVelocidade =
    voz && typeof voz === 'object' && (voz as Record<string, unknown>)['velocidadeNativa'] === undefined
      ? { ...p, vozPadrao: { ...voz, velocidadeNativa: atual.vozPadrao.velocidadeNativa } }
      : p
  return coerceConfig({ ...atual, ...comVelocidade })
}

/**
 * O id de uma voz, ou ''. Vai parar no caminho da URL do TTS
 * (`/v1/text-to-speech/<id>`) e chega do renderer: so letra, numero, traco e
 * sublinhado. Os do ElevenLabs tem 20 caracteres e os do Fish 32 (hex).
 */
export function idDeVoz(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const id = raw.trim()
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : ''
}

/** O nome de um modelo de TTS, ou o padrao: nome curto, sem espaco nem barra (o nomeDeModelo do Studio). */
export function nomeDeModelo(raw: unknown, padrao: string): string {
  if (typeof raw !== 'string') return padrao
  const nome = raw.trim().replace(/^models\//, '')
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(nome) ? nome : padrao
}

/** A voz padrao conferida: provedor conhecido, id e modelo limpos (o vozSalva do Studio). */
function vozSalva(raw: unknown): Required<VozPadrao> {
  if (typeof raw !== 'object' || raw === null) return { ...SEM_VOZ }
  const value = raw as Record<string, unknown>
  const provedor = value['provedor'] === 'elevenlabs' || value['provedor'] === 'fish' ? value['provedor'] : ''
  return {
    provedor,
    voiceId: provedor ? idDeVoz(value['voiceId']) : '',
    modelId: provedor ? nomeDeModelo(value['modelId'], '') : '',
    // Perfil de antes do campo (ou lixo no arquivo): o padrao 1,2 da decisao de 15/10.
    velocidadeNativa:
      typeof value['velocidadeNativa'] === 'number' ? arrumarVelocidadeNativa(value['velocidadeNativa']) : VELOCIDADE_NATIVA_PADRAO,
  }
}
