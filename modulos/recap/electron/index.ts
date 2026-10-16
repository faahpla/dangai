import { registrarRaizDaBiblioteca } from '../../../electron/services/library'
import type { ModuloDoMain } from '../../../electron/modulos'
import { configDoRecap } from './config'
import { guardarContexto } from './contexto'
import { configurarEpisodios } from './episodio/indice'
import { registrarCanais } from './ipc'
import { pastaDaBibliotecaStudio } from './settings'

/**
 * [recap] O GERAR RECAP no main: o assistente do AniRecap Studio como modulo
 * do Dangai. Parte 1: o passo 1 (Episodio: sonda, falas, OP/ED, busca nas
 * bibliotecas) e o passo 2 (Roteiro pela IA do nucleo). O corte das cenas, o
 * motor, a voz e as cenas chegam nas partes seguintes.
 *
 * A biblioteca do recap entra na Biblioteca do Dangai como a raiz `recap:`
 * -- so com o modulo LIGADO: desligado, a grade e a de sempre.
 */
export const recap: ModuloDoMain = {
  id: 'recap',
  nome: 'Gerar recap',
  descricao: 'Do episodio ao roteiro com IA. Voz e cenas: em breve.',
  beta: true,
  config: configDoRecap,

  configurar(ctx) {
    guardarContexto(ctx)
    // O perfil do recap (indices por id, legendas extraidas, rascunhos) mora na
    // pasta de dados do modulo, pedida so quando ele grava algo.
    configurarEpisodios(() => ctx.pasta('dados'))
    registrarRaizDaBiblioteca({
      id: 'recap',
      prefixo: 'recap:',
      raiz: () => (ctx.ligado() ? pastaDaBibliotecaStudio() : null),
    })
  },

  registrarIpc(ctx) {
    registrarCanais(ctx)
  },
}
