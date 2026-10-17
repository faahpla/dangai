import { join } from 'node:path'
import { registrarRaizDaBiblioteca } from '../../../electron/services/library'
import type { ModuloDoMain } from '../../../electron/modulos'
import { CAMPOS_DE_CHAVE_DA_VOZ } from '../shared/tipos-da-voz'
import { configDoRecap } from './config'
import { guardarContexto } from './contexto'
import { configurarEpisodios } from './episodio/indice'
import { registrarCanais } from './ipc'
import { configurarSom } from './som/medir'
import { pastaDaBibliotecaStudio } from './settings'

/**
 * [recap] O GERAR RECAP no main: o assistente do AniRecap Studio como modulo
 * do Dangai. Parte 1: o passo 1 (Episodio: sonda, falas, OP/ED, busca nas
 * bibliotecas) e o passo 2 (Roteiro pela IA do nucleo). Parte 2: o passo 3
 * (Voz: ElevenLabs, Fish Audio ou audio importado), com as chaves de voz no
 * cofre do nucleo (camposDeChave, os MESMOS nomes do Studio). Parte 3: o
 * passo 4 (Cenas, sobre um indice ja cortado), o "Abrir no editor" (.dangai
 * com `modulos.recap`) e a Edicao rapida. O corte das cenas e o motor chegam
 * na parte 4.
 *
 * A biblioteca do recap entra na Biblioteca do Dangai como a raiz `recap:`
 * -- so com o modulo LIGADO: desligado, a grade e a de sempre.
 */
export const recap: ModuloDoMain = {
  id: 'recap',
  nome: 'Gerar recap',
  descricao: 'Do episodio ao roteiro, a voz, as cenas e a Edicao rapida. Corte das cenas: em breve.',
  beta: true,
  config: configDoRecap,
  camposDeChave: [...CAMPOS_DE_CHAVE_DA_VOZ],

  configurar(ctx) {
    guardarContexto(ctx)
    // O perfil do recap (indices por id, legendas extraidas, rascunhos) mora na
    // pasta de dados do modulo, pedida so quando ele grava algo.
    configurarEpisodios(() => ctx.pasta('dados'))
    // A Edicao rapida: o cache de medidas e o historico de musicas em
    // <dados>/som; a reserva de SFX sao os sons que vem com o Dangai.
    configurarSom({
      userData: () => ctx.pasta('dados'),
      reservaDeSfx: () => (ctx.empacotado ? join(process.resourcesPath, 'sfx') : join(ctx.pasta('app'), 'assets', 'sfx')),
    })
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
