import { join } from 'node:path'
import { registrarRaizDaBiblioteca } from '../../../electron/services/library'
import type { ModuloDoMain } from '../../../electron/modulos'
import { CAMPOS_DE_CHAVE_DA_VOZ } from '../shared/tipos-da-voz'
import { configDoRecap } from './config'
import { guardarContexto } from './contexto'
import { configurarEpisodios } from './episodio/indice'
import { registrarCanais } from './ipc'
import { encerrarRostosDoMotor, rostosRodando } from './montar/rostos-motor'
import { encerrarVisao, visaoRodando } from './cenas/visao'
import { configurarMotor, encerrarMotor, motorRodando } from './motor'
import {
  cancelarMotorRuntime,
  configurarMotorRuntime,
  encerrarMotorRuntime,
  iniciarMotorRuntime,
  instalandoMotorRuntime,
  remocaoEmAndamento,
} from './motor-runtime'
import { trazendoDoStudio } from './migracao/ipc'
import { configurarSom } from './som/medir'
import { pastaDaBibliotecaStudio } from './settings'

/**
 * [recap] O GERAR RECAP no main: o assistente do AniRecap Studio como modulo
 * do Dangai. Parte 1: o passo 1 (Episodio: sonda, falas, OP/ED, busca nas
 * bibliotecas) e o passo 2 (Roteiro pela IA do nucleo). Parte 2: o passo 3
 * (Voz: ElevenLabs, Fish Audio ou audio importado), com as chaves de voz no
 * cofre do nucleo (camposDeChave, os MESMOS nomes do Studio). Parte 3: o
 * passo 4 (Cenas, sobre um indice ja cortado), o "Abrir no editor" (.dangai
 * com `modulos.recap`) e a Edicao rapida. Parte 4: o MOTOR de personagens
 * (corte em segundo plano, reconhecimento, Reconhecer na mao, rosto da
 * Edicao rapida) e o runtime dele, instalado pela tela no 1o uso.
 * Parte 5: o "Trazer do AniRecap Studio" (migracao/), que so le o perfil do
 * Studio e junta no do modulo sem sobrescrever.
 *
 * A biblioteca do recap entra na Biblioteca do Dangai como a raiz `recap:`
 * -- so com o modulo LIGADO: desligado, a grade e a de sempre.
 *
 * Desligado, nada do motor sobe nem baixa: o `configurar` so guarda caminhos
 * (sem criar pasta), e o runtime so e lido/instalado a pedido da tela.
 */
export const recap: ModuloDoMain = {
  id: 'recap',
  nome: 'Gerar recap',
  descricao: 'Do episodio ao roteiro, a voz, as cenas e a Edicao rapida, com o motor de personagens.',
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
    // O motor: os dados dele (config, index.db, fotos do elenco, logs) em
    // <dados>/motor; o codigo em modulos/recap/motor (no instalado,
    // resources/modulos/recap/motor); o runtime em %LOCALAPPDATA%/Dangai/recap.
    // Getters: a pasta de dados so e criada quando alguem pede.
    configurarMotor({
      get userData() {
        return ctx.pasta('dados')
      },
      get appPath() {
        return ctx.pasta('app')
      },
      empacotado: ctx.empacotado,
    })
    configurarMotorRuntime({
      get userData() {
        return ctx.pasta('dados')
      },
      get appPath() {
        return ctx.pasta('app')
      },
      resourcesPath: process.resourcesPath,
      empacotado: ctx.empacotado,
      versaoDoApp: ctx.versaoDoApp,
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

  // Depois da janela, so ligado: restos de um Remover, a conta na GPU de um
  // driver novo e, no instalado, a atualizacao sozinha dos pacotes.
  ligar() {
    iniciarMotorRuntime()
  },

  // Desligado nas Configuracoes: nada do motor fica rodando (a instalacao para
  // e continua de onde parou quando ele ligar e pedir de novo).
  async desligar() {
    encerrarMotor()
    encerrarRostosDoMotor()
    encerrarVisao()
    await cancelarMotorRuntime()
  },

  /**
   * A saida: o motor e o lote de rostos morrem (o torch na GPU nao pode sobrar
   * depois da janela), a instalacao guarda a retomada, e o app ESPERA um
   * "Remover" que esteja apagando ~5 GB por tras (cortado no meio, sobraria
   * um motor-runtime.apagar-* para tras). O nucleo poe o teto de 11 min.
   */
  async antesDeSair() {
    encerrarMotor()
    encerrarRostosDoMotor()
    encerrarVisao()
    encerrarMotorRuntime()
    await remocaoEmAndamento()?.catch(() => {})
  },

  motivoParaNaoAtualizar() {
    if (instalandoMotorRuntime()) return 'O motor de personagens esta instalando. Espere ou cancele.'
    if (remocaoEmAndamento()) return 'O motor de personagens esta sendo removido.'
    if (motorRodando()) return 'O motor de personagens esta cortando. Espere terminar.'
    if (rostosRodando()) return 'O motor esta procurando os rostos.'
    if (visaoRodando()) return 'O motor esta vendo as cenas. Espere terminar.'
    if (trazendoDoStudio()) return 'Trazendo os dados do AniRecap Studio. Espere terminar.'
    return null
  },
}
