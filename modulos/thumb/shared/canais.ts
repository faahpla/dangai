import type { IpcResult } from '@shared/channels'
import type {
  CenaDoVideo,
  PedidoDeQuadro,
  PedidoDeRecorte,
  PedidoDeSalvar,
  QuadroDaThumb,
  RecorteDaThumb,
  ResultadoDoSalvar,
  RostoDaThumb,
  SugestoesDaThumb,
} from './thumb'
import type { ConfigDaThumb, PedidoDeCopia, PedidoDeImagem, PedidoDeSalvarComo, PedidoDoVideo, PresetDaThumb } from './pedidos'

/**
 * [thumb] O CONTRATO DO MODULO THUMBNAIL entre o main, a ponte e a tela. Os
 * canais todos com o prefixo `thumb:` (o nucleo recusa outro). A ponte
 * (electron/ponte.ts) roda no sandbox: daqui ela so leva as constantes e os
 * tipos (os schemas moram em pedidos.ts).
 */
export const CANAIS_DA_THUMB = {
  quadro: 'thumb:quadro',
  miniatura: 'thumb:miniatura',
  rostos: 'thumb:rostos',
  recorte: 'thumb:recorte',
  upscale: 'thumb:upscale',
  motor: 'thumb:motor',
  sugestoes: 'thumb:sugestoes',
  escolherImagem: 'thumb:escolher-imagem',
  copiarImagem: 'thumb:copiar-imagem',
  escolherProjeto: 'thumb:escolher-projeto',
  videoDoProjeto: 'thumb:video-do-projeto',
  salvarAoLado: 'thumb:salvar-ao-lado',
  salvarComo: 'thumb:salvar-como',
  salvarPreset: 'thumb:salvar-preset',
} as const

export interface MotorDaThumb {
  /** O detector de rostos do motor de personagens roda agora. */
  pronto: boolean
  /** Por que nao (frase curta). */
  motivo: string | null
}

export interface PonteDaThumb {
  quadro(p: PedidoDeQuadro): Promise<IpcResult<QuadroDaThumb>>
  /** Um JPEG pequeno do instante (o arrastar do "Quadro dentro da cena"). */
  miniatura(p: PedidoDeQuadro): Promise<IpcResult<Uint8Array>>
  /** Os rostos; null = sem o motor (a imagem fica no meio). */
  rostos(p: PedidoDeQuadro): Promise<IpcResult<RostoDaThumb[] | null>>
  recorte(p: PedidoDeRecorte): Promise<IpcResult<RecorteDaThumb>>
  upscale(): Promise<IpcResult<boolean>>
  motor(): Promise<IpcResult<MotorDaThumb>>
  sugestoes(cenas: CenaDoVideo[]): Promise<IpcResult<SugestoesDaThumb>>
  escolherImagem(p: PedidoDeImagem): Promise<IpcResult<string | null>>
  copiarImagem(p: PedidoDeCopia): Promise<IpcResult<string>>
  escolherProjeto(pasta: string | null): Promise<IpcResult<string | null>>
  videoDoProjeto(p: PedidoDoVideo): Promise<IpcResult<string | null>>
  salvarAoLado(p: PedidoDeSalvar): Promise<IpcResult<ResultadoDoSalvar>>
  salvarComo(p: PedidoDeSalvarComo): Promise<IpcResult<ResultadoDoSalvar | null>>
  salvarPreset(preset: PresetDaThumb): Promise<IpcResult<ConfigDaThumb>>
}
