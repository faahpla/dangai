import { WandSparkles, Zap } from 'lucide-react'
import type { ModuloDoRenderer } from '@/modulos/api'
import { AjustesDaEdicaoRapida } from './components/AjustesDaEdicaoRapida'
import { AjustesDoRecap } from './components/AjustesDoRecap'
import { AjustesDoRoteiro } from './components/AjustesDoRoteiro'
import { AjustesDasCenas } from './components/AjustesDasCenas'
import { SecaoDaVoz } from './components/AjustesDeVoz'
import { BoasVindas, boasVindasAoLigar, gerarRecap } from './components/BoasVindas'
import { BotaoGerarRecap } from './components/BotaoGerarRecap'
import { ControleDaMusica } from './components/ControleDaMusica'
import { BotaoDaEdicaoRapida, rodarEdicaoRapida } from './components/EdicaoRapida'
import { NaBarraDeStatus } from './components/NaBarraDeStatus'
import { GerarRecap } from './components/GerarRecap'
import { InstalarMotor } from './components/motor-runtime/InstalarMotor'
import { SecaoDoMotor } from './components/SecaoDoMotor'
import { perguntarSeEpisodio, PerguntaDoEpisodio } from './components/PerguntaDoEpisodio'
import { guardarNucleo, nucleo } from './nucleo'
import { ouvirOProjeto, rotuloDoClipe } from './projeto'
import { useBoasVindas } from './store/boas-vindas'
import { useGerar } from './store/gerar'
import { partesLigadas, nadaLigado, CONFIG_DA_EDICAO_RAPIDA_PADRAO } from '../shared/edicao-rapida'
import { useEdicaoRapida } from './store/edicao-rapida'

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
 *   recap" ou "Usar como clipe";
 * - parte 3: a Edicao rapida (o botao e a musica na barra do Renderizar, o
 *   comando na paleta, a secao nas Configuracoes depois dos Sons de
 *   transicao), o andamento na barra de status, o rotulo da camada de cor na
 *   linha do tempo e os eventos do projeto (converter o do Studio, anotar a
 *   musica depois de salvar/renderizar);
 * - parte 4: o motor de personagens -- a tela "Instalar motor" (o runtime no
 *   1o uso), a secao dele nas Configuracoes, o corte por tras e o Reconhecer
 *   na mao (dentro do assistente).
 * - a boas-vindas (18/10): ligar o modulo, ou clicar "Gerar recap", sem
 *   chave de IA abre a tela que pede a do Gemini (BoasVindas), na tela inicial.
 */
export const recap: ModuloDoRenderer = {
  id: 'recap',

  iniciar(n) {
    guardarNucleo(n)
    const pararDeOuvir = ouvirOProjeto()
    // Ligou (abrindo o app ou nas Configuracoes) sem chave de IA: a boas-vindas.
    boasVindasAoLigar()
    return () => {
      pararDeOuvir()
      // Desligar e ligar de novo e outra sessao do modulo: ligar volta a perguntar.
      useBoasVindas.getState().reiniciar()
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
      <BoasVindas />
      <InstalarMotor />
    </>
  ),

  secoesDasConfiguracoes: [
    { id: 'recap-roteiro', titulo: 'Roteiro do recap', depoisDe: 'ia', Componente: AjustesDoRoteiro },
    { id: 'recap-voz', titulo: 'Voz do recap', depoisDe: 'ia', Componente: SecaoDaVoz },
    { id: 'recap-cenas', titulo: 'Cenas do recap', depoisDe: 'ia', Componente: AjustesDasCenas },
    { id: 'recap-edicao-rapida', titulo: 'Edicao rapida', depoisDe: 'sons', Componente: AjustesDaEdicaoRapida },
    { id: 'recap-biblioteca', titulo: 'Biblioteca do recap', depoisDe: 'biblioteca', Componente: AjustesDoRecap },
    { id: 'recap-motor', titulo: 'Motor de personagens', depoisDe: 'biblioteca', Componente: SecaoDoMotor },
  ],

  comandos: () => [
    {
      id: 'recap-gerar',
      label: 'Gerar recap',
      hint: 'Novo recap ou continuar um',
      icon: WandSparkles,
      // Sem chave de IA, a boas-vindas antes (so na tela inicial).
      run: () => void gerarRecap(),
    },
    comandoDaEdicaoRapida(),
  ],

  // A Edicao rapida e a musica, antes do Renderizar (so com o projeto pronto para renderizar).
  BotoesDaBarraDeRender: () => {
    const pronto = nucleo().usar(
      (s) =>
        s.audio !== null &&
        s.plan !== null &&
        s.images.length > 0 &&
        !(s.render !== null && ['bundling', 'rendering', 'muxing'].includes(s.render.stage)),
    )
    if (!pronto) return null
    return (
      <>
        <BotaoDaEdicaoRapida />
        <ControleDaMusica />
      </>
    )
  },

  ItemDaBarraDeStatus: NaBarraDeStatus,

  rotuloDoClipe,

  // A etiqueta no card de "Projetos recentes": projeto com `modulos.recap`.
  rotuloDoProjeto: { texto: 'Recap' },

  /*
   * Como no Studio: so na TELA INICIAL (nada aberto) um video longo pergunta.
   * Com um projeto aberto, o video segue sendo clipe, sem pergunta.
   */
  async interceptarArquivos(caminhos) {
    if (nucleo().ler().phase() !== 'empty') return []
    return (await perguntarSeEpisodio(caminhos)) ? caminhos : []
  },
}

/** "Edicao rapida" na paleta: apagado sem projeto pronto ou com tudo desligado. */
function comandoDaEdicaoRapida() {
  const e = nucleo().ler()
  const pronto = e.audio !== null && e.plan !== null && e.images.length > 0 && e.busy === null
  const config = useEdicaoRapida.getState().padrao?.config ?? CONFIG_DA_EDICAO_RAPIDA_PADRAO
  const nada = nadaLigado(config)
  return {
    id: 'recap-edicao-rapida',
    label: 'Edicao rapida',
    hint: nada ? 'Nada ligado (Configuracoes)' : partesLigadas(config),
    icon: Zap,
    disabled: !pronto || nada || useEdicaoRapida.getState().rodando !== null,
    run: () => void rodarEdicaoRapida(),
  }
}
