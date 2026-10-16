/**
 * [recap] A CONFIGURACAO DO MODULO, em `Settings.modulos.recap` (o nucleo
 * guarda sem ler; quem confere e o coerce daqui).
 *
 * Por enquanto so a biblioteca: a pasta em que o recap GRAVA (os indices dos
 * episodios em `_indices/`, e na parte 4 as cenas que ele corta). E separada
 * da libraryDir do Dangai de proposito: aquela pode ser a saida do AnCut ou do
 * Corte Cenas, que sao so leitura.
 */
export interface ConfigDoRecap {
  /** '' = o padrao, <Documentos>/AniRecap Studio/Biblioteca (o mesmo do Studio). */
  biblioteca: string
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
}

export const CONFIG_PADRAO: ConfigDoRecap = { biblioteca: '' }

/** O que veio do disco, conferido campo a campo. Campo errado vale o padrao. */
export function coerceConfig(raw: unknown): ConfigDoRecap {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const biblioteca = typeof r['biblioteca'] === 'string' ? r['biblioteca'].trim() : ''
  return { biblioteca }
}
