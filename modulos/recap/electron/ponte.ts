import type { CriarPonte } from '../../../shared/modulos'
import { CANAIS as C, type PonteDoRecap } from '../shared/canais'

/**
 * [recap] A PONTE do modulo: `window.dangai.modulos.recap`. Roda no preload
 * (sandbox): so tipos e as constantes dos canais. O `invocar`/`assinar` do
 * nucleo ja vem preso ao prefixo `recap:`.
 */
export const criarPonteDoRecap = (({ invocar, assinar }) => {
  const ponte: PonteDoRecap = {
    lerConfig: () => invocar(C.lerConfig),
    salvarConfig: (patch) => invocar(C.salvarConfig, patch),
    escolherBiblioteca: () => invocar(C.escolherBiblioteca),

    escolherEpisodio: () => invocar(C.escolherEpisodio),
    sondarEpisodio: (path) => invocar(C.sondarEpisodio, path),
    procurarEpisodio: (path, palpite) => invocar(C.procurarEpisodio, path, palpite),
    indexarEpisodio: (args) => invocar(C.indexarEpisodio, args),
    indexarFalas: (args) => invocar(C.indexarFalas, args),
    salvarExclusoes: (indiceId, exclusoes) => invocar(C.salvarExclusoes, indiceId, exclusoes),
    onIndexarProgresso: (ouvinte) => assinar(C.indexarProgresso, ouvinte),

    abrirRascunho: (episodioId, novo) => invocar(C.abrirRascunho, episodioId, novo === true),
    listarRascunhos: () => invocar(C.listarRascunhos),
    gerarEventos: (rascunhoId) => invocar(C.gerarEventos, rascunhoId),
    gerarRoteiro: (rascunhoId, pedido) => invocar(C.gerarRoteiro, rascunhoId, pedido),
    cancelarRoteiro: (rascunhoId, pedidoId) => invocar(C.cancelarRoteiro, rascunhoId, pedidoId),
    salvarRoteiro: (rascunhoId, roteiro) => invocar(C.salvarRoteiro, rascunhoId, roteiro),
    escolherVersao: (rascunhoId, versao) => invocar(C.escolherVersao, rascunhoId, versao),
    aprovarRoteiro: (rascunhoId, roteiro) => invocar(C.aprovarRoteiro, rascunhoId, roteiro),
    desaprovarRoteiro: (rascunhoId) => invocar(C.desaprovarRoteiro, rascunhoId),
    religarRoteiro: (rascunhoId, pedido) => invocar(C.religarRoteiro, rascunhoId, pedido),
    miniaturasDasCenas: (episodioId, planoIds) => invocar(C.miniaturasDasCenas, episodioId, planoIds),
    ritmoDaVoz: (rascunhoId, config) => invocar(C.ritmoDaVoz, rascunhoId, config ?? null),
    onRoteiroProgresso: (ouvinte) => assinar(C.roteiroProgresso, ouvinte),
  }
  return ponte
}) satisfies CriarPonte
