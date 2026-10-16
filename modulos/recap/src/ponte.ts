import type { IpcResult } from '@shared/channels'
import type { PonteDoRecap } from '../shared/canais'
import type {
  EstadoDoCorte,
  EventoDoCorte,
  FimDaAnalise,
  PedidoDeAnalise,
  PedidoDeCorte,
  ProgressoDaAnalise,
  StatusDoMotor,
} from '../shared/episodio'

/**
 * [recap] A PONTE no renderer: `window.dangai.modulos.recap` (shared/canais.ts)
 * com os nomes do Studio, para as stores portadas ficarem iguais as de la.
 *
 * O MOTOR (corte das cenas e personagens) chega na parte 4. Ate la, o que as
 * stores perguntam a ele responde aqui mesmo, sem ir ao main: "sem motor", e
 * nenhum corte. A tela nao mostra botao que dependa dele.
 */
const EM_BREVE = 'Cortar cenas: em breve.'
const naoHaMotor = async <T,>(): Promise<IpcResult<T>> => ({ ok: false, error: EM_BREVE })
const semEscuta = (): (() => void) => () => {}

const motorEmBreve = {
  statusDoMotor: async (): Promise<IpcResult<StatusDoMotor>> => ({
    ok: true,
    value: {
      studio: { pronto: false, versao: null, gpu: null, erro: EM_BREVE },
      ancut: { instalado: false, caminho: null },
    },
  }),
  analisarEpisodio: (_pedido: PedidoDeAnalise) => naoHaMotor<string>(),
  cancelarAnalise: (_jobId: string) => naoHaMotor<null>(),
  onAnaliseProgresso: (_ouvinte: (p: ProgressoDaAnalise) => void) => semEscuta(),
  onAnaliseFim: (_ouvinte: (f: FimDaAnalise) => void) => semEscuta(),
  iniciarCorte: (_pedido: PedidoDeCorte) => naoHaMotor<EstadoDoCorte>(),
  estadoDoCorte: async (_episodioId: string): Promise<IpcResult<EstadoDoCorte | null>> => ({ ok: true, value: null }),
  cancelarCorte: async (_episodioId: string): Promise<IpcResult<boolean>> => ({ ok: true, value: false }),
  onCorteProgresso: (_ouvinte: (e: EventoDoCorte) => void) => semEscuta(),
}

/** O main do modulo, pedido na hora (a ponte so existe com o preload carregado). */
const doMain = (): PonteDoRecap => window.dangai.modulos.recap

export const ponte = new Proxy({} as PonteDoRecap & typeof motorEmBreve, {
  get: (_alvo, nome: string) =>
    nome in motorEmBreve ? motorEmBreve[nome as keyof typeof motorEmBreve] : doMain()[nome as keyof PonteDoRecap],
})
