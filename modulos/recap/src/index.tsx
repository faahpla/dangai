import { WandSparkles } from 'lucide-react'
import type { ModuloDoRenderer } from '@/modulos/api'
import { AjustesDoRecap } from './components/AjustesDoRecap'
import { SecaoDaVoz } from './components/AjustesDeVoz'
import { BotaoGerarRecap } from './components/BotaoGerarRecap'
import { GerarRecap } from './components/GerarRecap'
import { perguntarSeEpisodio, PerguntaDoEpisodio } from './components/PerguntaDoEpisodio'
import { guardarNucleo, nucleo } from './nucleo'
import { useGerar } from './store/gerar'

/**
 * [recap] O GERAR RECAP no renderer: o assistente do AniRecap Studio dentro do
 * Dangai, so com o modulo ligado (Configuracoes > Modulos).
 *
 * - "Gerar recap" na tela inicial (ao lado de "Abrir projeto"), e na paleta;
 * - o assistente em tela cheia (GerarRecap), com a escolha "Novo recap |
 *   Continuar" e a pergunta do video longo (PerguntaDoEpisodio);
 * - a Voz (chaves, voz padrao, velocidade) nas Configuracoes, depois da IA, e
 *   a Biblioteca do recap, depois da Biblioteca do Dangai;
 * - um episodio longo solto (ou escolhido) na tela inicial pergunta "Gerar
 *   recap" ou "Usar como clipe".
 */
export const recap: ModuloDoRenderer = {
  id: 'recap',

  iniciar(n) {
    guardarNucleo(n)
    return () => {
      // Desligado com a tela aberta: ela fecha (o nucleo ja solta o inerte).
      // A fachada fica guardada: a limpeza das telas (o telaCheia(false) ao
      // desmontar) ainda fala com ela, e um erro numa limpeza de componente
      // que esta saindo derruba a janela inteira, fora do <Protegido>.
      useGerar.setState({ aberto: false, escolha: null })
    }
  },

  BotoesDaTelaInicial: ({ arrastando, definirAlvo }) => (
    <BotaoGerarRecap arrastando={arrastando} aoAcender={definirAlvo} />
  ),

  Telas: () => (
    <>
      <GerarRecap />
      <PerguntaDoEpisodio />
    </>
  ),

  secoesDasConfiguracoes: [
    { id: 'recap-voz', titulo: 'Voz do recap', depoisDe: 'ia', Componente: SecaoDaVoz },
    { id: 'recap-biblioteca', titulo: 'Biblioteca do recap', depoisDe: 'biblioteca', Componente: AjustesDoRecap },
  ],

  comandos: () => [
    {
      id: 'recap-gerar',
      label: 'Gerar recap',
      hint: 'Novo recap ou continuar um',
      icon: WandSparkles,
      run: () => void useGerar.getState().abrirOuEscolher(),
    },
  ],

  /*
   * Como no Studio: so na TELA INICIAL (nada aberto) um video longo pergunta.
   * Com um projeto aberto, o video segue sendo clipe, sem pergunta.
   */
  async interceptarArquivos(caminhos) {
    if (nucleo().ler().phase() !== 'empty') return []
    return (await perguntarSeEpisodio(caminhos)) ? caminhos : []
  },
}
