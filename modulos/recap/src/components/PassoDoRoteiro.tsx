import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ClipboardPaste, History, Loader2, Palette, Settings2, TriangleAlert, WandSparkles, X } from 'lucide-react'
import {
  ROTULO_DO_PAPEL,
  cuesElegiveis,
  duracaoEstimada,
  ehModeloReserva,
  eventosOrfaos,
  faixaDePalavras,
  frasesParaReligar,
  momentoDaFrase,
  palavrasDoRoteiro,
  type AlvoSec,
  type MomentoDaFrase,
  type ProblemaDoRoteiro,
  type Roteiro,
} from '../../shared/roteiro'
import { marcasNaTela, revisaoDaVersao, type ItemDaRevisao } from '../../shared/revisao'
import { useGerar } from '../store/gerar'
import {
  resumoDaFalha,
  useIndiceDoRoteiro,
  useProblemasDoRoteiro,
  useRoteiro,
  type ModoDoRoteiro,
} from '../store/gerar-roteiro'
import { nucleo } from '../nucleo'
import { useRitmo, useRitmoDaVoz, useSeguirRitmo } from '../store/ritmo'
import { textoDoRitmo } from '../../shared/ritmo'
import { Segmentos, type Segmento } from '@/modulos/kit'
import { AjustesDoRoteiro } from './AjustesDoRoteiro'
import { AndamentoDoRoteiro } from './AndamentoDoRoteiro'
import { PerguntaDoEscritor } from './PerguntaDoEscritor'
import { CartaoDoEpisodio } from './CartaoDoEpisodio'
import { MeuRoteiro } from './MeuRoteiro'
import { PerguntaDoReserva } from './PerguntaDoReserva'
import { RoteiroEmTexto } from './RoteiroEmTexto'
import { SecaoDoRoteiro } from './SecaoDoRoteiro'
import { Aviso, Botao, COR_DE_AVISO, Link, Secao } from './pecas'

/** A cor de "dentro do combinado" do app (a do clipe de audio na timeline). */
const COR_DE_OK = 'text-[#4f9a74]'

const ALVOS: readonly Segmento<AlvoSec>[] = [
  { valor: 60, rotulo: '60 s', title: 'Short de 60 segundos' },
  { valor: 90, rotulo: '90 s', title: 'Short de 90 segundos' },
]

const MODOS: readonly Segmento<ModoDoRoteiro>[] = [
  { valor: 'partes', rotulo: 'Partes', title: 'Uma frase por linha, com o momento do episodio de cada uma' },
  { valor: 'texto', rotulo: 'Texto', title: 'O roteiro inteiro num bloco. Ponto final separa as frases; linha em branco, as partes.' },
]

/** Avisos do roteiro inteiro que a barra mostra (o tamanho ja esta na contagem). */
const AVISOS_DA_BARRA = new Set<ProblemaDoRoteiro['codigo']>(['sem-gancho', 'sem-fechamento', 'muleta'])

/**
 * O PASSO 2 DO ASSISTENTE: o roteiro do short, em partes, para ler, editar,
 * pedir outra versao e aprovar. O app PARA aqui: nada segue sem o "Aprovar".
 *
 * Ao entrar, abre o rascunho do episodio e, sem roteiro, pede a IA uma vez
 * (eventos e roteiro). Tudo o que muda vai sozinho para o disco
 * (gerar-roteiro.ts); fechar e reabrir o app volta aqui.
 *
 * Duas vistas ("Partes | Texto"): uma frase por campo, com o momento de cada
 * uma, ou o roteiro inteiro num bloco (RoteiroEmTexto). "Meu roteiro"
 * (MeuRoteiro) cola um roteiro proprio. Nos dois, as frases novas sao ligadas
 * aos eventos numa chamada so ao sair do bloco; o "Ligar N frases" da barra
 * completa uma ligacao que nao terminou.
 */
export function PassoDoRoteiro() {
  const episodioId = useGerar((s) => s.indice?.id ?? null)
  const entrar = useRoteiro((s) => s.entrar)
  const rascunhoId = useRoteiro((s) => s.rascunho?.id ?? null)
  const takeAtual = useRoteiro((s) => s.rascunho?.voz?.atual ?? null)

  useEffect(() => {
    if (episodioId) void entrar(episodioId)
  }, [episodioId, entrar])

  // O tempo do roteiro e o da voz que vai narrar (o take atual, ou a voz padrao).
  useSeguirRitmo(rascunhoId, takeAtual)

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-6 py-6">
      <CartaoDoEpisodio />
      <Conteudo />
    </div>
  )
}

function Conteudo() {
  const episodioId = useGerar((s) => s.indice?.id ?? null)
  const doRoteiro = useRoteiro((s) => s.episodioId)
  const abrindo = useRoteiro((s) => s.abrindo)
  const rascunho = useRoteiro((s) => s.rascunho)
  const tela = useRoteiro((s) => s.tela)
  const geracao = useRoteiro((s) => s.geracao)
  const cancelada = useRoteiro((s) => s.geracaoCancelada)
  const erro = useRoteiro((s) => s.erro)
  const entrar = useRoteiro((s) => s.entrar)
  const reserva = useRoteiro((s) => s.reserva)
  const modo = useRoteiro((s) => s.modo)
  const colando = useRoteiro((s) => s.colando)
  const estiloAberto = useRoteiro((s) => s.estiloAberto)
  const custo = useRoteiro((s) => s.custo)
  const indice = useIndiceDoRoteiro()

  // O rascunho na store ainda e de outro episodio (a troca esta a caminho).
  if (abrindo || doRoteiro !== episodioId || (!rascunho && !erro)) {
    return (
      <Secao titulo="Roteiro">
        <p className="flex items-center gap-2 text-[12px] text-ink-2">
          <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
          Abrindo o roteiro...
        </p>
      </Secao>
    )
  }

  if (!rascunho) {
    return (
      <Secao titulo="Roteiro">
        <div className="flex min-h-8 items-center gap-3">
          <p className="min-w-0 flex-1 text-[12px] text-ink-2">Nao deu para abrir o roteiro.</p>
          <Botao onClick={() => episodioId && void entrar(episodioId)}>Tentar de novo</Botao>
        </div>
      </Secao>
    )
  }

  const semFalas = rascunho.eventos.length === 0 && indice !== null && cuesElegiveis(indice).length === 0
  // O andamento do roteiro inteiro, ou o do pedido que acabou de ser cancelado
  // (segura o lugar por ~1 s em vez de a lista pular embaixo do cursor).
  const andamento = geracao ?? cancelada
  // O pedido do roteiro inteiro parou antes do modelo reserva: a pergunta fica
  // no lugar do andamento (a do "Refazer" mora na parte).
  const pergunta = !andamento && reserva && reserva.secaoId === null ? reserva : null
  // O escritor pago parou antes de gastar (o "Refazer" pergunta dentro da parte).
  const perguntaDeCusto = !andamento && custo && custo.secaoId === null

  return (
    <>
      {/* Sem roteiro na tela a barra nao tem o que mostrar: o 60/90 mora no cartao "Roteiro". */}
      {tela && <BarraDoRoteiro />}
      {estiloAberto && <PainelDoEstilo />}
      {andamento && andamento.secaoId === null && <AndamentoDoRoteiro geracao={andamento} cancelado={!geracao} />}
      {pergunta && <PerguntaDoReserva pergunta={pergunta} />}
      {perguntaDeCusto && <PerguntaDoEscritor />}
      {colando && <MeuRoteiro />}
      {!tela && !andamento && !pergunta && !perguntaDeCusto && !colando && (semFalas ? <SemFalas /> : <SemRoteiro />)}
      {tela && (modo === 'texto' ? <RoteiroEmTexto /> : <ListaDoRoteiro tela={tela} />)}
    </>
  )
}

/**
 * Os recados do rascunho: o que o abrirRascunho disse e, conferido aqui com o
 * indice do passo 1 (que pode ter relido a legenda), os eventos cujas falas
 * mudaram -- com o caminho para um rascunho novo.
 */
function AvisosDoRascunho() {
  const avisos = useRoteiro((s) => s.avisos)
  const eventos = useRoteiro((s) => s.rascunho?.eventos)
  const geracao = useRoteiro((s) => s.geracao)
  const recomecar = useRoteiro((s) => s.recomecarRascunho)
  const indice = useIndiceDoRoteiro()
  const orfaos = useMemo(() => (eventos && indice ? eventosOrfaos(eventos, indice) : []), [eventos, indice])
  if (avisos.length === 0 && orfaos.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {avisos.map((aviso, i) => (
        <Aviso key={i}>{aviso}</Aviso>
      ))}
      {orfaos.length > 0 && (
        <div className="flex min-w-0 items-center gap-2">
          <Aviso
            title={`${orfaos.length} ${orfaos.length === 1 ? 'evento cita' : 'eventos citam'} falas que mudaram (legenda trocada no passo 1): o momento e as falas de cada frase podem estar errados.`}
          >
            As falas mudaram desde o roteiro
          </Aviso>
          <Link
            onClick={() => void recomecar()}
            disabled={geracao !== null}
            title="Eventos e roteiro novos com as falas de agora. Este rascunho fica salvo no disco."
          >
            Recomecar
          </Link>
        </div>
      )}
    </div>
  )
}

/** O topo: duracao-alvo, contagem, versoes e "Outra versao". Os recados do rascunho embaixo. */
function BarraDoRoteiro() {
  const tela = useRoteiro((s) => s.tela)
  const alvoSemRoteiro = useRoteiro((s) => s.alvoSemRoteiro)
  const geracao = useRoteiro((s) => s.geracao)
  const aprovando = useRoteiro((s) => s.aprovando)
  const trocarAlvo = useRoteiro((s) => s.trocarAlvo)
  const gerar = useRoteiro((s) => s.gerar)
  const modo = useRoteiro((s) => s.modo)
  const trocarModo = useRoteiro((s) => s.trocarModo)
  const colando = useRoteiro((s) => s.colando)
  const abrirColar = useRoteiro((s) => s.abrirColar)
  const ligarFrases = useRoteiro((s) => s.ligarFrases)
  const problemas = useProblemasDoRoteiro()

  const alvo = tela?.alvoSec ?? alvoSemRoteiro
  const travado = geracao !== null
  const noTexto = modo === 'texto'
  const doRoteiro = problemas.filter((p) => !p.secaoId && AVISOS_DA_BARRA.has(p.codigo))
  // Frases sem momento nenhum (ligacao que nao terminou, "+ Frase"): o caminho para ligar.
  const porLigar = tela && !noTexto ? frasesParaReligar(tela).length : 0

  /*
   * relative z-10: o `enter` (animacao com fill `both`) deixa cada cartao com
   * camada propria, e os cartoes de baixo pintavam POR CIMA da lista de
   * Versoes, que mora aqui dentro.
   */
  return (
    <section className="enter relative z-10 flex min-w-0 flex-col gap-2 rounded-md border border-line bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {/* fieldset desligado desliga os botoes de dentro de verdade, e o opacity diz isso. */}
        <fieldset
          disabled={travado}
          aria-label="Duracao do short"
          className={['w-[120px] shrink-0', travado ? 'opacity-40' : ''].join(' ')}
        >
          <Segmentos opcoes={ALVOS} ativo={(v) => v === alvo} onChange={trocarAlvo} />
        </fieldset>
        {tela && (
          <fieldset
            disabled={travado || aprovando}
            aria-label="Ver o roteiro em partes ou em texto"
            className={['w-[124px] shrink-0', travado || aprovando ? 'opacity-40' : ''].join(' ')}
          >
            <Segmentos opcoes={MODOS} ativo={(v) => v === modo} onChange={(m) => void trocarModo(m)} />
          </fieldset>
        )}
        {tela && <Contagem roteiro={tela} travado={travado || aprovando || noTexto} onRefazer={() => void gerar()} />}
        {tela && <ModeloReserva modelo={tela.modelo} />}
        {porLigar > 0 && (
          <Link
            onClick={() => void ligarFrases()}
            disabled={travado || aprovando}
            title="Liga ao momento do episodio as frases que ainda nao tem (IA, uma chamada)"
          >
            Ligar {porLigar} {porLigar === 1 ? 'frase' : 'frases'}
          </Link>
        )}
        {tela && <ResumoDaRevisao travado={travado || aprovando || noTexto} />}
        <span className="flex-1" />
        <BotaoDoEstilo />
        {tela && !colando && (
          <Botao
            pequeno
            foco="meu-roteiro"
            onClick={abrirColar}
            disabled={travado || aprovando}
            title="Colar um roteiro seu no lugar deste. Este fica em Versoes."
          >
            <ClipboardPaste size={12} strokeWidth={1.5} />
            Meu roteiro
          </Botao>
        )}
        <Versoes />
        {tela && (
          <Botao
            pequeno
            foco="outra-versao"
            onClick={() => void gerar()}
            disabled={travado || aprovando || noTexto}
            title={noTexto ? 'Volte para Partes para pedir outra versao' : 'A IA escreve o roteiro inteiro de novo. Este fica em Versoes.'}
          >
            <WandSparkles size={12} strokeWidth={1.5} />
            Outra versao
          </Botao>
        )}
      </div>
      {doRoteiro.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {doRoteiro.map((p) => (
            <Aviso key={p.codigo}>{p.mensagem}</Aviso>
          ))}
        </div>
      )}
      <AvisosDoRascunho />
    </section>
  )
}

/** "Estilo": abre (ou fecha) o painel do "Meu estilo" em cima do roteiro. */
function BotaoDoEstilo() {
  const aberto = useRoteiro((s) => s.estiloAberto)
  const abrir = useRoteiro((s) => s.abrirEstilo)
  const fechar = useRoteiro((s) => s.fecharEstilo)
  return (
    <Botao
      pequeno
      foco="estilo"
      onClick={aberto ? fechar : abrir}
      title="Meu estilo: instrucoes e roteiros de exemplo que a IA segue. Tambem: revisor e quem escreve."
    >
      <Palette size={12} strokeWidth={1.5} className={aberto ? 'text-accent' : undefined} />
      Estilo
    </Botao>
  )
}

/** O painel "Meu estilo" no passo 2: o mesmo das Configuracoes (Roteiro do recap). Esc fecha so ele. */
function PainelDoEstilo() {
  const fechar = useRoteiro((s) => s.fecharEstilo)
  return (
    <div
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        fechar()
      }}
    >
      <Secao
        titulo="Meu estilo"
        acao={
          <button
            type="button"
            onClick={fechar}
            aria-label="Fechar"
            title="Fechar (Esc). Vale no proximo roteiro."
            className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        }
      >
        <AjustesDoRoteiro />
      </Secao>
    </div>
  )
}

/** As marcas da revisao que valem para a tela (frase com o mesmo texto, nao ignorada). */
export function useMarcasDaRevisao(): { marcas: ItemDaRevisao[]; atualizada: boolean; existe: boolean } {
  const tela = useRoteiro((s) => s.tela)
  const roteiros = useRoteiro((s) => s.rascunho?.roteiros)
  const revisoes = useRoteiro((s) => s.rascunho?.revisoes)
  return useMemo(() => {
    if (!tela || !roteiros || !revisoes) return { marcas: [], atualizada: false, existe: false }
    const revisao = revisaoDaVersao({ roteiros, revisoes }, tela.versao)
    return {
      marcas: marcasNaTela(revisao, tela),
      // Revisada DEPOIS da ultima gravacao desta versao: "Revisar" de novo nao tem o que achar.
      atualizada: revisao !== null && revisao.versao === tela.versao && revisao.criadoEm >= tela.criadoEm,
      existe: revisao !== null,
    }
  }, [tela, roteiros, revisoes])
}

/**
 * A REVISAO na barra: "Revisando" enquanto a IA confere; com marcas, quantas
 * e o "Aplicar todas" (versao nova) e o "Ignorar"; sem marca, o "Revisado";
 * e o "Revisar" quando a versao na tela ainda nao foi conferida.
 */
function ResumoDaRevisao({ travado }: { travado: boolean }) {
  const revisando = useRoteiro((s) => s.revisando)
  const revisar = useRoteiro((s) => s.revisar)
  const aplicar = useRoteiro((s) => s.aplicarRevisao)
  const ignorar = useRoteiro((s) => s.ignorarRevisao)
  const { marcas, atualizada, existe } = useMarcasDaRevisao()

  if (revisando) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-3">
        <Loader2 size={11} strokeWidth={1.75} className="animate-spin text-accent" />
        Revisando
      </span>
    )
  }
  const comSugestao = marcas.filter((m) => m.sugestao).length
  return (
    <span className="flex shrink-0 items-center gap-2">
      {marcas.length > 0 ? (
        <>
          <span
            className={`flex items-center gap-1 text-[11px] ${COR_DE_AVISO}`}
            title={marcas.map((m) => `${m.fraseId}: ${m.motivo}`).join('\n')}
          >
            <TriangleAlert size={11} strokeWidth={1.75} />
            Revisao {marcas.length}
          </span>
          {comSugestao > 0 && (
            <Link onClick={() => void aplicar()} disabled={travado} title={`Versao nova com ${comSugestao === 1 ? 'a sugestao' : `as ${comSugestao} sugestoes`}. Esta fica em Versoes.`}>
              Aplicar todas
            </Link>
          )}
          <Link onClick={() => void ignorar(marcas.map((m) => m.fraseId))} disabled={travado} title="Tira todas as marcas">
            Ignorar
          </Link>
        </>
      ) : (
        existe &&
        atualizada && (
          <span className="flex items-center gap-1 text-[11px] text-ink-3" title="A IA conferiu cada frase contra as falas">
            <Check size={11} strokeWidth={2} className={COR_DE_OK} />
            Revisado
          </span>
        )
      )}
      {!atualizada && (
        <Link onClick={() => void revisar()} disabled={travado} title="A IA confere cada frase contra as falas (1 pedido, gratis no Gemini)">
          Revisar
        </Link>
      )}
    </span>
  )
}

/**
 * Palavras e duracao estimada: verde dentro da faixa do alvo, aviso fora. Fora,
 * o caminho fica ao lado: trocar 60/90 so muda a conta, e nada dizia que era
 * preciso pedir o roteiro de novo para o tamanho novo.
 */
function Contagem({ roteiro, travado, onRefazer }: { roteiro: Roteiro; travado: boolean; onRefazer: () => void }) {
  const ritmo = useRitmoDaVoz()
  const deOnde = useRitmo((s) => s.valor?.origem ?? null)
  const palavras = palavrasDoRoteiro(roteiro)
  const faixa = faixaDePalavras(roteiro.alvoSec, ritmo)
  const dentro = palavras >= faixa.min && palavras <= faixa.max
  const segundos = Math.round(duracaoEstimada(palavras, ritmo))
  // O ritmo e o da voz que narra: medido nos takes dela, ou estimado pela velocidade.
  const dica = `Para ${roteiro.alvoSec} s: ${faixa.min} a ${faixa.max} palavras (voz a ~${textoDoRitmo({ ritmo })}${deOnde === 'medido' ? ', medido nos takes' : ''})`
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        title={dentro ? dica : `${palavras < faixa.min ? 'Curto' : 'Longo'}. ${dica}`}
        className={['tnum flex items-center gap-1.5 text-[12px]', dentro ? COR_DE_OK : COR_DE_AVISO].join(' ')}
      >
        {dentro ? <Check size={12} strokeWidth={2} /> : <TriangleAlert size={12} strokeWidth={1.75} />}
        {palavras} palavras · ~{segundos} s
      </span>
      {!dentro && (
        <Link onClick={onRefazer} disabled={travado} title={`A IA escreve o roteiro de novo para ${roteiro.alvoSec} s. Este fica em Versoes.`}>
          Refazer para {roteiro.alvoSec} s
        </Link>
      )}
    </span>
  )
}

/**
 * O roteiro saiu do modelo RESERVA (o "lite", quando os outros estavam sem
 * cota ou lotados): nos roteiros julgados, quase toda gíria vetada, frase
 * partida e fato trocado veio dele. O passo 2 so usa o reserva quando ele
 * aceita (PerguntaDoReserva); a versao continua marcada.
 */
function ModeloReserva({ modelo }: { modelo: string }) {
  if (!ehModeloReserva(modelo)) return null
  return (
    <span
      title={`Escrito pelo ${modelo}, o modelo reserva (os outros estavam sem cota ou lotados). Ele erra mais: revise frase por frase, ou peca outra versao mais tarde.`}
      className={`flex shrink-0 items-center gap-1 text-[11px] ${COR_DE_AVISO}`}
    >
      <TriangleAlert size={11} strokeWidth={1.75} />
      Modelo reserva
    </span>
  )
}

/** "IA", "Editada", "Refeita: Gancho". O pedido inteiro vai no tooltip. */
function origemDaVersao(v: Roteiro): string {
  if (v.origem === 'editado') return 'Editada'
  if (v.revisada) return 'Revisada'
  if (v.pedido?.tipo === 'secao') {
    const papel = v.secoes.find((s) => s.id === v.pedido?.secaoId)?.papel
    return papel ? `Refeita: ${ROTULO_DO_PAPEL[papel]}` : 'Parte refeita'
  }
  return 'IA'
}

/** "14:32" hoje; "12/10 14:32" em outro dia. (O passo 3 usa o mesmo nos Takes.) */
export function quando(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const hoje = new Date()
  const mesmoDia =
    d.getDate() === hoje.getDate() && d.getMonth() === hoje.getMonth() && d.getFullYear() === hoje.getFullYear()
  return mesmoDia ? hora : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`
}

/**
 * O HISTORICO: toda versao que a IA escreveu e toda edicao ficam no rascunho
 * (nada e apagado). Clicar numa volta a ela; o que estava digitado vira uma
 * versao "Editada" antes de sair.
 */
function Versoes() {
  const rascunho = useRoteiro((s) => s.rascunho)
  const sujo = useRoteiro((s) => s.sujo)
  const geracao = useRoteiro((s) => s.geracao)
  const aprovando = useRoteiro((s) => s.aprovando)
  const escolherVersao = useRoteiro((s) => s.escolherVersao)
  const noTexto = useRoteiro((s) => s.modo === 'texto')
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  // Esc fecha a lista, e so ela: sem isto o Esc do app fechava o assistente inteiro.
  useEffect(() => {
    if (!aberto) return
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setAberto(false)
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [aberto])

  /*
   * Clicar fora fecha. Pelo documento, e nao por uma camada `fixed inset-0`:
   * o `enter` da barra deixa nela um transform, e transform vira o bloco de
   * referencia do `fixed` -- a camada ficava do tamanho da barra, e o clique
   * na lista de frases passava direto, com a lista aberta.
   */
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent): void => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('pointerdown', fora, true)
    return () => document.removeEventListener('pointerdown', fora, true)
  }, [aberto])

  // Um pedido a IA comecou com a lista aberta: ela fecha (nao da para trocar agora).
  useEffect(() => {
    if (geracao) setAberto(false)
  }, [geracao])

  if (!rascunho || rascunho.roteiros.length === 0) return null
  const lista = [...rascunho.roteiros].reverse()

  return (
    <div ref={caixa} className="relative">
      <Botao
        pequeno
        onClick={() => setAberto((v) => !v)}
        disabled={geracao !== null || aprovando || noTexto}
        title={noTexto ? 'Volte para Partes para trocar de versao' : 'Voltar a uma versao anterior'}
      >
        <History size={12} strokeWidth={1.5} />
        Versoes
        <span className="tnum text-ink-3">{rascunho.roteiros.length}</span>
      </Botao>
      {aberto && (
        /*
         * Fundo cheio por cima do glass: aqui o blur nao pega (os cartoes de
         * baixo tem camada propria, pelo `enter`), e o texto de uma frase
         * aberta atravessava a lista por baixo dos 72% do glass.
         */
        <ul
          className="glass enter absolute right-0 top-[calc(100%+6px)] z-50 max-h-[320px] w-[380px] overflow-y-auto rounded-md p-1.5"
          style={{ backgroundColor: 'var(--color-elevated)' }}
        >
          {lista.map((v) => {
            const atual = v.versao === rascunho.atual
            const aprovada = atual && rascunho.aprovado && !sujo
            const detalhe = [
              v.origem === 'editado' ? 'Editada a mao' : `Escrita por ${v.modelo || 'IA'}`,
              v.derivadoDe ? `a partir da v${v.derivadoDe}` : null,
              v.pedido?.instrucao ? `pedido: "${v.pedido.instrucao}"` : null,
              atual && sujo ? 'com edicao sendo gravada' : null,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={v.versao}>
                <button
                  type="button"
                  onClick={() => {
                    setAberto(false)
                    void escolherVersao(v.versao)
                  }}
                  title={detalhe}
                  aria-current={atual ? 'true' : undefined}
                  className={[
                    'flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[12px]',
                    atual ? 'bg-accent-dim text-ink' : 'text-ink-2 hover:bg-accent-dim hover:text-ink',
                  ].join(' ')}
                >
                  <span className="tnum w-7 shrink-0 font-medium">v{v.versao}</span>
                  <span className="min-w-0 flex-1 truncate">{origemDaVersao(v)}</span>
                  {/* Um selo so: o check rosa mora nele, e o texto fica neutro. */}
                  {aprovada && (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-2">
                      <Check size={11} strokeWidth={2} className="text-accent" />
                      Aprovada
                    </span>
                  )}
                  <span className="tnum shrink-0 text-[11px] text-ink-3">{palavrasDoRoteiro(v)} pal.</span>
                  <span className="tnum min-w-[36px] shrink-0 text-right text-[11px] text-ink-3">{quando(v.criadoEm)}</span>
                  <span className="grid w-3 shrink-0 place-items-center">
                    {atual && !aprovada && <Check size={12} strokeWidth={2} className="text-accent" />}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Sem roteiro (a primeira geracao falhou ou foi cancelada): o botao assume, com
 * o 60/90 do lado (e ele que o pedido usa). Se falhou, o porque fica escrito
 * aqui -- curto, com a nota inteira no tooltip -- mesmo depois de o erro do
 * rodape ser fechado; e quando o caminho e a chave ou a cota, o botao das
 * Configuracoes vem junto, e repetir deixa de ser a acao principal.
 */
function SemRoteiro() {
  const gerar = useRoteiro((s) => s.gerar)
  const falha = useRoteiro((s) => s.falhaDaGeracao)
  const alvo = useRoteiro((s) => s.alvoSemRoteiro)
  const trocarAlvo = useRoteiro((s) => s.trocarAlvo)
  const abrirColar = useRoteiro((s) => s.abrirColar)
  const resumo = falha ? resumoDaFalha(falha) : null

  return (
    <Secao titulo="Roteiro">
      <div className="flex min-h-8 flex-wrap items-center gap-3">
        <div className="w-[120px] shrink-0" aria-label="Duracao do short">
          <Segmentos opcoes={ALVOS} ativo={(v) => v === alvo} onChange={trocarAlvo} />
        </div>
        {resumo ? (
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-2" title={falha ?? undefined}>
            <TriangleAlert
              size={12}
              strokeWidth={1.5}
              className={`shrink-0 ${resumo.espera ? COR_DE_AVISO : 'text-danger'}`}
            />
            <span className="min-w-0 truncate">{resumo.curto}</span>
          </p>
        ) : (
          <p className="min-w-0 flex-1 text-[12px] text-ink-2">Sem roteiro ainda.</p>
        )}
        {resumo?.configuracoes && (
          <Botao principal onClick={() => nucleo().abrirConfiguracoes('ia')} title="Chave, provedor e modelo da IA (Ctrl+,)">
            <Settings2 size={13} strokeWidth={1.5} />
            Configuracoes
          </Botao>
        )}
        <Botao foco="meu-roteiro" onClick={abrirColar} title="Colar um roteiro seu. Cada frase ganha um momento do episodio.">
          <ClipboardPaste size={13} strokeWidth={1.5} />
          Meu roteiro
        </Botao>
        <Botao
          principal={!resumo?.configuracoes}
          foco="gerar-roteiro"
          onClick={() => void gerar()}
          title="A IA le o episodio e escreve o roteiro"
        >
          <WandSparkles size={13} strokeWidth={1.5} />
          {resumo ? 'Tentar de novo' : 'Gerar roteiro'}
        </Botao>
      </div>
      <AvisosDoRascunho />
    </Secao>
  )
}

/** Indice sem nenhuma fala elegivel: a IA nao teria do que falar. O jeito e o passo 1. */
function SemFalas() {
  const irParaPasso = useGerar((s) => s.irParaPasso)
  return (
    <Secao titulo="Roteiro">
      <div className="flex min-h-8 items-center gap-3">
        <p className="min-w-0 flex-1 text-[12px] text-ink-2">Sem falas neste episodio. Escolha uma legenda no passo 1.</p>
        <Botao onClick={() => irParaPasso(1)}>
          <ArrowLeft size={13} strokeWidth={1.5} />
          Episodio
        </Botao>
      </div>
    </Secao>
  )
}

/**
 * As partes do roteiro. O momento de cada frase (e a miniatura dele) so muda
 * quando muda o evento, o instante escolhido ou a citacao: digitar o texto nao
 * refaz a conta, e as frases que nao mudaram nem redesenham.
 */
function ListaDoRoteiro({ tela }: { tela: Roteiro }) {
  const eventos = useRoteiro((s) => s.rascunho?.eventos)
  const miniaturas = useRoteiro((s) => s.miniaturas)
  const geracao = useRoteiro((s) => s.geracao)
  const pedirMiniaturas = useRoteiro((s) => s.pedirMiniaturas)
  const indice = useIndiceDoRoteiro()
  const problemas = useProblemasDoRoteiro()
  const listaDeEventos = useMemo(() => eventos ?? [], [eventos])

  const assinatura = tela.secoes
    .map((s) => s.frases.map((f) => `${f.id}:${f.eventoIds.join(',')}:${f.cueDoMomento ?? ''}:${f.citacaoCueId ?? ''}`).join(';'))
    .join('|')
  const momentos = useMemo(() => {
    const mapa = new Map<string, MomentoDaFrase | null>()
    for (const secao of tela.secoes) {
      for (const frase of secao.frases) {
        mapa.set(frase.id, indice ? momentoDaFrase(frase, listaDeEventos, indice) : null)
      }
    }
    return mapa
    // A assinatura cobre o que o momento le da tela (eventos, instante e citacao de cada frase).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura, listaDeEventos, indice])

  const planoIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of momentos.values()) if (m?.planoId) ids.add(m.planoId)
    return [...ids]
  }, [momentos])
  // Pede so quando o conjunto de cenas muda; a store ainda pula as ja pedidas.
  const chaveDasCenas = planoIds.join(',')
  useEffect(() => {
    if (planoIds.length > 0) void pedirMiniaturas(planoIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDasCenas])

  const ordem = useMemo(() => tela.secoes.flatMap((s) => s.frases.map((f) => f.id)), [tela])
  const inteiro = geracao !== null && geracao.secaoId === null
  const { marcas } = useMarcasDaRevisao()
  const marcasPorFrase = useMemo(() => new Map(marcas.map((m) => [m.fraseId, m] as const)), [marcas])

  // Todas as partes removidas a mao: o rodape diz o erro, e aqui fica o caminho.
  if (tela.secoes.length === 0) {
    return (
      <Secao titulo="Roteiro">
        <p className="text-[12px] text-ink-2">Sem partes. Peca outra versao ou volte a uma anterior.</p>
      </Secao>
    )
  }

  return (
    <div
      aria-busy={inteiro}
      className={['flex flex-col gap-4 transition-opacity', inteiro ? 'pointer-events-none opacity-40' : ''].join(' ')}
    >
      {tela.secoes.map((secao) => (
        <SecaoDoRoteiro
          key={secao.id}
          secao={secao}
          eventos={listaDeEventos}
          indice={indice}
          momentos={momentos}
          miniaturas={miniaturas}
          problemas={problemas.filter((p) => p.secaoId === secao.id)}
          ordem={ordem}
          geracao={geracao}
          marcas={marcasPorFrase}
        />
      ))}
    </div>
  )
}
