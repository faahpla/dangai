import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AudioLines, Check, ChevronDown, ChevronUp, Cpu, Download, ExternalLink, KeyRound, Loader2, WandSparkles, X } from 'lucide-react'
import { ChaveDoGemini, LINK_DA_CHAVE_DO_GEMINI } from '@/modulos/kit'
import { textoDoTamanho, type EstadoDoMotorRuntime } from '../../shared/motor-runtime'
import type { AjustesDaVoz, ProvedorDeVoz } from '../../shared/tipos-da-voz'
import { usePrenderFoco } from '../hooks/usePrenderFoco'
import { nucleo } from '../nucleo'
import { instalarMotorAgora, motorPronto, useBoasVindas } from '../store/boas-vindas'
import { useGerar } from '../store/gerar'
import { useVoz } from '../store/gerar-voz'
import { useMotorRuntime } from '../store/motor-runtime'
import { AjustesDeVoz } from './AjustesDeVoz'
import { Botao, focarBotao, Link } from './pecas'

/**
 * [recap] A BOAS-VINDAS DO RECAP: quem liga o "Gerar recap" sem chave de IA
 * (ou clica nele sem chave) cai aqui, e nao no "Sem chave de IA" do passo 2.
 * A tela do AniRecap Studio (BoasVindas.tsx, 15/10), na tela cheia do modulo.
 *
 * RECOMENDA a chave do Gemini (gratis): sem IA o roteiro nao sai. A voz e o
 * motor de personagens aparecem como opcionais, cada um numa linha. Nada aqui
 * e novo por dentro:
 *
 * - a chave do Gemini e o ChaveDoGemini do kit, o MESMO campo/teste das
 *   Configuracoes (com `testarAoSalvar`: a recusada nao grava);
 * - a voz e o AjustesDeVoz da secao do modulo, no modo compacto;
 * - o motor abre a tela "Motor de personagens" (InstalarMotor) e instala pelo
 *   canal do motor-runtime.
 *
 * Quando abre mora em ../store/boas-vindas. Fica ABAIXO da tela do motor
 * (z-55), da pergunta do episodio e da escolha (z-45) e das Configuracoes
 * (z-50), que abrem por cima dela.
 */

/** Na tela inicial, sem nada aberto que seja "sair dela": projeto, Biblioteca, o assistente, a escolha. */
export function naTelaInicial(): boolean {
  const e = nucleo().ler()
  const g = useGerar.getState()
  return e.phase() === 'empty' && !e.libraryOpen && !g.aberto && g.escolha === null
}

/** A decisao da boas-vindas sem nunca lancar: falhou, segue como se nao abrisse. */
function decidirSemLancar(): Promise<boolean> {
  return useBoasVindas
    .getState()
    .decidir(naTelaInicial)
    .catch((err: unknown) => {
      console.error('[recap] boas-vindas:', err)
      return false
    })
}

/** O modulo ligou (abrindo o app ou nas Configuracoes): sem IA, a boas-vindas. */
export function boasVindasAoLigar(): void {
  void decidirSemLancar()
}

/**
 * O "Gerar recap" (o botao da tela inicial e a paleta): sem IA, a boas-vindas
 * vem ANTES, uma vez por sessao, e o "Comecar" dela segue para o assistente.
 * Com chave (ou ja vista), o de sempre.
 */
export async function gerarRecap(): Promise<void> {
  if (await decidirSemLancar()) return
  await useGerar.getState().abrirOuEscolher()
}

export function BoasVindas() {
  const aberta = useBoasVindas((s) => s.momento === 'aberta')
  const naInicial = nucleo().usar((s) => s.phase() === 'empty' && !s.libraryOpen)
  const noAssistente = useGerar((s) => s.aberto || s.escolha !== null)
  const configAberta = nucleo().usar((s) => s.settingsOpen)

  // Projeto aberto (Abrir, recentes, arquivo solto), a Biblioteca ou o
  // assistente: ela nunca fica por cima, nem volta nesta sessao.
  useEffect(() => {
    if (!naInicial || noAssistente) useBoasVindas.getState().saiuDaTelaInicial()
  }, [naInicial, noAssistente])

  // As Configuracoes abrem por cima (Ctrl+,), ou ja estavam abertas quando ele
  // ligou o modulo la: quando fecham, o que ele salvou la aparece aqui e o foco
  // volta para a tela. Reler antes, com elas abertas, puxava o foco para tras.
  useEffect(() => {
    if (configAberta || useBoasVindas.getState().momento !== 'aberta') return
    void useBoasVindas.getState().reler().then(focarNoCartao)
  }, [configAberta])

  // A tela cheia do modulo: o resto da janela inerte e os atalhos quietos.
  useEffect(() => {
    if (!aberta) return
    nucleo().telaCheia(true)
    // O "Comecar" abre o assistente na mesma hora: a tela cheia passa para ele.
    return () => nucleo().telaCheia(useGerar.getState().aberto)
  }, [aberta])

  useEffect(() => {
    if (!aberta) return
    const tecla = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      // Com algo por cima dela, o Esc e de quem esta em cima.
      if (nucleo().haModalPorCima() || useMotorRuntime.getState().aberta) return
      ev.stopPropagation()
      useBoasVindas.getState().depois()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [aberta])

  if (!aberta) return null
  return createPortal(
    <div
      className="fixed inset-0 z-[44] grid place-items-center bg-black/45"
      onPointerDown={() => useBoasVindas.getState().depois()}
      // Arquivo solto por cima: vale o arquivo (o drop da janela decide o que fazer com ele).
      onDrop={() => useBoasVindas.getState().depois()}
    >
      <CartaoDeBoasVindas />
    </div>,
    document.body,
  )
}

/** O foco na tela: o "Comecar" com chave, o campo da chave sem. */
function focarNoCartao(): void {
  const s = useBoasVindas.getState().settings
  if (s && (s.hasGeminiKey || s.hasApiKey)) {
    focarBotao('boas-vindas-fim')
    return
  }
  requestAnimationFrame(() =>
    document.querySelector<HTMLInputElement>('[aria-label="Boas-vindas do recap"] input[aria-label="Chave do Gemini"]')?.focus(),
  )
}

/** O cartao em si, fora do portal: o teste sem interface desenha so ele. */
export function CartaoDeBoasVindas() {
  const settings = useBoasVindas((s) => s.settings)
  const voz = useBoasVindas((s) => s.voz)
  const campo = useBoasVindas((s) => s.campo)
  const estado = useMotorRuntime((s) => s.estado)
  const [vozAberta, setVozAberta] = useState(false)
  // Aberta por baixo das Configuracoes (ligou o modulo la): o foco fica nelas ate fecharem.
  const [focarNaChave] = useState(() => !nucleo().haModalPorCima())
  const { depois, receber } = useBoasVindas.getState()
  // O Tab fica no cartao: atras do fundo escuro o Enter abria o "Gerar recap".
  const caixa = useRef<HTMLDivElement>(null)
  usePrenderFoco(caixa)
  // A mesma conta do provedor() do nucleo: Gemini ou, sem ela, a Anthropic.
  const temChave = !!settings && (settings.hasGeminiKey || settings.hasApiKey)

  // A chave chegou (salvou aqui ou nas Configuracoes): o foco vai para o "Comecar".
  useEffect(() => {
    if (temChave) focarBotao('boas-vindas-fim')
  }, [temChave])

  const receberVoz = (v: AjustesDaVoz): void => {
    useBoasVindas.getState().receberVoz(v)
    // O passo 3 le de novo (chave nova = vozes novas), como na secao das Configuracoes.
    void useVoz.getState().lerAjustes()
  }

  const comecar = (): void => {
    depois()
    void useGerar.getState().abrirOuEscolher()
  }

  return (
    <div
      ref={caixa}
      role="dialog"
      aria-modal="true"
      aria-label="Boas-vindas do recap"
      onPointerDown={(ev) => ev.stopPropagation()}
      // Fundo cheio por cima do glass: o titulo grande da tela inicial atravessava.
      style={{ backgroundColor: 'var(--color-elevated)' }}
      className="glass enter flex max-h-[88vh] w-[480px] max-w-[calc(100%-32px)] flex-col rounded-lg"
    >
      <header className="flex min-w-0 shrink-0 items-center gap-3 px-5 pt-5 pb-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-md border border-accent/40 bg-accent-dim text-accent">
          <WandSparkles size={18} strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-ink">Gerar recap</h2>
          <p className="truncate text-[12px] text-ink-3">{temChave ? 'Pronto para comecar.' : 'Comece pela chave da IA.'}</p>
        </div>
        <button
          type="button"
          onClick={depois}
          aria-label="Fechar"
          title="Depois (Esc)"
          className="grid size-7 shrink-0 place-items-center self-start rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
        >
          <X size={13} strokeWidth={1.5} />
        </button>
      </header>

      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-5">
        <Item
          icone={<KeyRound size={13} strokeWidth={1.5} />}
          titulo="Chave do Gemini"
          detalhe="gratis, recomendada"
          destaque={!settings?.hasGeminiKey}
          canto={
            settings?.hasGeminiKey ? (
              <Pronto texto="Salva" />
            ) : (
              // A acao mais importante de quem chega sem chave: rosa, com o icone de fora do app.
              <a
                href={LINK_DA_CHAVE_DO_GEMINI}
                target="_blank"
                rel="noreferrer"
                title="Abre o Google AI Studio no navegador"
                className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent underline-offset-2 hover:underline"
              >
                Pegar chave gratis
                <ExternalLink size={11} strokeWidth={1.75} />
              </a>
            )
          }
        >
          <div>
            {/* A chave mudou nas Configuracoes por cima: o campo recomeca limpo (key). */}
            <ChaveDoGemini key={campo} settings={settings} onSettings={receber} testarAoSalvar focar={focarNaChave} />
          </div>
        </Item>

        <Item
          icone={<AudioLines size={13} strokeWidth={1.5} />}
          titulo="Narracao"
          detalhe="opcional"
          canto={
            <>
              <EstadoDaVoz voz={voz} />
              <Link onClick={() => setVozAberta((v) => !v)}>
                <span className="flex items-center gap-1">
                  {vozAberta ? 'Ocultar' : 'Configurar'}
                  {vozAberta ? <ChevronUp size={11} strokeWidth={1.5} /> : <ChevronDown size={11} strokeWidth={1.5} />}
                </span>
              </Link>
            </>
          }
        >
          {vozAberta ? (
            // O AjustesDeVoz da secao do modulo, no modo compacto: as chaves
            // primeiro, voz e velocidade so com uma chave de voz salva.
            <AjustesDeVoz settings={voz} onSettings={receberVoz} compacto />
          ) : (
            // Com uma chave de voz salva, o canto ja diz tudo.
            !voz?.hasElevenKey &&
            !voz?.hasFishKey && <p className="text-[11px] text-ink-3">ElevenLabs ou Fish Audio. Ou importe o audio depois.</p>
          )}
        </Item>

        <Item
          icone={<Cpu size={13} strokeWidth={1.5} />}
          titulo="Motor de personagens"
          // O "~3 GB" e o que falta baixar; antes de o main responder, o tamanho da instalacao cheia.
          detalhe={motorPronto(estado) ? 'opcional' : `opcional, ${textoDoTamanho(Math.max(estado?.bytesParaBaixar || 3e9, 1e6))}`}
          canto={<EstadoDoMotor estado={estado} />}
        >
          {!motorPronto(estado) && <p className="text-[11px] text-ink-3">Corta as cenas e reconhece os personagens.</p>}
        </Item>
      </div>

      <footer className="mt-4 flex shrink-0 items-center gap-2 border-t border-line px-5 py-4">
        {!temChave && (
          <Link onClick={() => void useBoasVindas.getState().naoPerguntarMais()} title="Nao abrir mais esta tela">
            Nao perguntar mais
          </Link>
        )}
        <span className="flex-1" />
        {temChave ? (
          <Botao principal foco="boas-vindas-fim" onClick={comecar} title="Abre o Gerar recap">
            Comecar
          </Botao>
        ) : (
          <Botao foco="boas-vindas-fim" onClick={depois} title="Fecha. Volta na proxima vez que abrir o app.">
            Depois
          </Botao>
        )}
      </footer>
    </div>
  )
}

/** Uma linha da tela: icone, nome, o detalhe curto e o canto (estado ou acao). */
function Item({
  icone,
  titulo,
  detalhe,
  destaque = false,
  canto,
  children,
}: {
  icone: React.ReactNode
  titulo: string
  detalhe?: string
  /** A recomendada: borda e icone rosa (so a chave do Gemini, enquanto falta). */
  destaque?: boolean
  canto?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <section
      className={[
        'flex min-w-0 flex-col gap-2.5 rounded-md border bg-surface p-3.5',
        destaque ? 'border-accent/40' : 'border-line',
      ].join(' ')}
    >
      <header className="flex min-h-7 min-w-0 items-center gap-2">
        <span className={['shrink-0', destaque ? 'text-accent' : 'text-ink-3'].join(' ')}>{icone}</span>
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{titulo}</span>
        {detalhe && <span className="shrink-0 text-[11px] text-ink-3">{detalhe}</span>}
        <span className="flex-1" />
        {canto}
      </header>
      {children}
    </section>
  )
}

function Pronto({ texto }: { texto: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-2">
      <Check size={12} strokeWidth={2} className="text-accent" />
      {texto}
    </span>
  )
}

const NOME_DA_VOZ: Record<ProvedorDeVoz, string> = { elevenlabs: 'ElevenLabs', fish: 'Fish Audio' }

/** O provedor da voz padrao, se a chave dele estiver salva; so a chave, "Chave salva"; nada, nada. */
function EstadoDaVoz({ voz }: { voz: AjustesDaVoz | null }) {
  if (!voz) return null
  const provedor = voz.vozPadrao.provedor
  const temDele = provedor === 'elevenlabs' ? voz.hasElevenKey : provedor === 'fish' ? voz.hasFishKey : false
  if (provedor && temDele) return <Pronto texto={NOME_DA_VOZ[provedor]} />
  if (voz.hasElevenKey || voz.hasFishKey) return <Pronto texto="Chave salva" />
  return null
}

/** Pronto, ou o botao que leva a tela do motor (e ja instala, quando da). */
function EstadoDoMotor({ estado }: { estado: EstadoDoMotorRuntime | null }) {
  if (!estado) return null
  if (motorPronto(estado)) return <Pronto texto="Pronto" />
  if (estado.fase === 'instalando') {
    const f = estado.andamento?.fracao
    return (
      <Botao pequeno onClick={() => useMotorRuntime.getState().abrir()} title="Ver a instalacao">
        <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
        {f === null || f === undefined ? 'Instalando...' : `Instalando ${Math.round(f * 100)}%`}
      </Botao>
    )
  }
  const rotulo = estado.fase === 'incompleto' ? 'Continuar' : estado.fase === 'desatualizado' ? 'Atualizar' : 'Instalar agora'
  return (
    <Botao pequeno onClick={instalarMotorAgora} title="Python e torch do motor, das fontes oficiais. Uma vez so.">
      <Download size={12} strokeWidth={1.5} />
      {rotulo}
    </Botao>
  )
}
