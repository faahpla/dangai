import type { CriarPonte } from '../../../shared/modulos'
import { CANAIS_DA_THUMB as C, type PonteDaThumb } from '../shared/canais'

/**
 * [thumb] A PONTE do modulo Thumbnail: `window.dangai.modulos.thumb`. Roda no
 * preload (sandbox): so tipos e as constantes dos canais. O `invocar` do
 * nucleo ja vem preso ao prefixo `thumb:`.
 */
export const criarPonteDaThumb = (({ invocar }) => {
  const ponte: PonteDaThumb = {
    quadro: (p) => invocar(C.quadro, p),
    miniatura: (p) => invocar(C.miniatura, p),
    rostos: (p) => invocar(C.rostos, p),
    recorte: (p) => invocar(C.recorte, p),
    upscale: () => invocar(C.upscale),
    motor: () => invocar(C.motor),
    sugestoes: (cenas) => invocar(C.sugestoes, cenas),
    escolherImagem: (p) => invocar(C.escolherImagem, p),
    copiarImagem: (p) => invocar(C.copiarImagem, p),
    escolherProjeto: (pasta) => invocar(C.escolherProjeto, pasta),
    videoDoProjeto: (p) => invocar(C.videoDoProjeto, p),
    salvarAoLado: (p) => invocar(C.salvarAoLado, p),
    salvarComo: (p) => invocar(C.salvarComo, p),
    salvarPreset: (preset) => invocar(C.salvarPreset, preset),
  }
  return ponte
}) satisfies CriarPonte
