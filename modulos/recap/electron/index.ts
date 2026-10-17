import { registrarRaizDaBiblioteca } from '../../../electron/services/library'
import type { ModuloDoMain } from '../../../electron/modulos'
import { CAMPOS_DE_CHAVE_DA_VOZ } from '../shared/tipos-da-voz'
import { configDoRecap } from './config'
import { guardarContexto } from './contexto'
import { configurarEpisodios } from './episodio/indice'
import { registrarCanais } from './ipc'
import { pastaDaBibliotecaStudio } from './settings'

/**
 * [recap] O GERAR RECAP no main: o assistente do AniRecap Studio como modulo
 * do Dangai. Parte 1: o passo 1 (Episodio: sonda, falas, OP/ED, busca nas
 * bibliotecas) e o passo 2 (Roteiro pela IA do nucleo). Parte 2: o passo 3
 * (Voz: ElevenLabs, Fish Audio ou audio importado), com as chaves de voz no
 * cofre do nucleo (camposDeChave, os MESMOS nomes do Studio). O corte das
 * cenas, o motor e o passo 4 chegam nas partes seguintes.
 *
 * A biblioteca do recap entra na Biblioteca do Dangai como a raiz `recap:`
 * -- so com o modulo LIGADO: desligado, a grade e a de sempre.
 */
export const recap: ModuloDoMain = {
  id: 'recap',
  nome: 'Gerar recap',
  descricao: 'Do episodio ao roteiro e a voz. Cenas: em breve.',
  beta: true,
  config: configDoRecap,
  camposDeChave: [...CAMPOS_DE_CHAVE_DA_VOZ],

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
