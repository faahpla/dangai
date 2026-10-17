import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, TriangleAlert, Users, X } from 'lucide-react'
import {
  descobertaViva,
  mudancasDaDecisao,
  podeReconhecerNaMao,
  resumoDaDecisao,
  textoDasMudancas,
  type MotivoDaDescoberta,
} from '../../shared/descoberta'
import { temPlanos } from '../../shared/episodio'
import { useGerar } from '../store/gerar'
import { opcoesDoResumo, useDescoberta } from '../store/gerar-descoberta'
import { runtimeFora, useMotorRuntime } from '../store/motor-runtime'
import { Barra } from './AndamentoDaAnalise'
import { AbrirPasta, Aviso, Botao, focarBotao, Link } from './pecas'

/**
 * AS PORTAS DO RECONHECER NA MAO no passo 1 (a tela de grupos mora em
 * ReconhecerNaMao.tsx):
 *
 * - BotaoReconhecerNaMao: no "Corte parou" sem fotos do elenco (o principal da
 *   secao) e ao lado do "Reconhecer agora" nas cenas sem personagem.
 * - LinkRevisarPersonagens: discreto, no canto de "Personagens" de um
 *   episodio ja reconhecido.
 * - LinhaDaDescoberta: no lugar dos botoes enquanto ela roda (agrupando,
 *   esperando nomes, salvando), e o resultado depois de confirmar.
 * - AndamentoDaDescoberta: a pilula do cabecalho, em qualquer passo, com a
 *   tela fechada ("Rostos 42%", "Dar nomes").
 *
 * Quando oferecer e regra do contrato (podeReconhecerNaMao); o main confere
 * de novo antes de subir o motor.
 */

/** A descoberta da store e a do episodio da tela (evento de outro episodio nao conta). */
function useDoEpisodio(): boolean {
  const indiceId = useGerar((s) => s.indice?.id ?? null)
  const episodioId = useDescoberta((s) => s.episodioId)
  return indiceId !== null && episodioId === indiceId
}

/** Ha descoberta deste episodio no ar (pedindo, agrupando, esperando nomes, salvando). */
export function useDescobertaViva(): boolean {
  const deste = useDoEpisodio()
  const viva = useDescoberta((s) => s.pedindo || descobertaViva(s.estado))
  return deste && viva
}

const DICA: Record<MotivoDaDescoberta, string> = {
  'anime-nao-encontrado': 'O motor agrupa os rostos do episodio e voce da o nome a cada grupo.',
  'sem-referencias': 'Sem fotos do elenco: o motor agrupa os rostos e voce da o nome. As fotos viram referencia para os proximos episodios.',
  'sem-personagens': 'O motor agrupa os rostos das cenas e voce da o nome. As fotos viram referencia para os proximos episodios.',
  revisar: 'Refaz os personagens do episodio: o motor agrupa os rostos (os conhecidos ja vem com nome) e voce corrige.',
}

/** A oferta para o episodio da tela, ou null (nao pode, ou ja esta rodando). */
function useOferta(): { motivo: MotivoDaDescoberta; desligado: string | null } | null {
  const indice = useGerar((s) => s.indice)
  const corte = useGerar((s) => s.corte)
  const motor = useGerar((s) => s.motor)
  const job = useGerar((s) => s.job)
  const runtime = useMotorRuntime((s) => s.estado)
  const viva = useDescobertaViva()
  if (!indice || viva) return null
  const oferta = podeReconhecerNaMao(indice, corte)
  if (!oferta.pode || !oferta.motivo) return null
  // So o motor do Studio agrupa (o corte pelo AnCut parou no AnCut).
  if (!temPlanos(indice) && corte && corte.motor !== 'studio') return null
  // App instalado sem o motor: o clique abre a tela "Instalar motor" (pedirMotor) e segue depois.
  const desligado =
    job !== null
      ? 'Espere a analise acabar'
      : motor?.studio.pronto !== true && !runtimeFora(runtime)
        ? (motor?.studio.erro ?? 'O motor nao esta pronto')
        : null
  return { motivo: oferta.motivo, desligado }
}

/** [Reconhecer na mao]. Some quando nao pode ou quando ja esta rodando (a LinhaDaDescoberta fala). */
export function BotaoReconhecerNaMao({ principal = false, pequeno = false }: { principal?: boolean; pequeno?: boolean }) {
  const oferta = useOferta()
  const iniciar = useDescoberta((s) => s.iniciar)
  if (!oferta || oferta.motivo === 'revisar') return null
  return (
    <Botao
      principal={principal}
      pequeno={pequeno}
      foco="reconhecer-na-mao"
      onClick={() => void iniciar()}
      disabled={oferta.desligado !== null}
      title={oferta.desligado ?? DICA[oferta.motivo]}
    >
      <Users size={pequeno ? 12 : 13} strokeWidth={1.5} />
      Reconhecer na mao
    </Botao>
  )
}

/** "Revisar personagens": o link discreto de um episodio ja reconhecido. */
export function LinkRevisarPersonagens() {
  const oferta = useOferta()
  const iniciar = useDescoberta((s) => s.iniciar)
  if (!oferta || oferta.motivo !== 'revisar') return null
  return (
    <Link onClick={() => void iniciar()} disabled={oferta.desligado !== null} title={oferta.desligado ?? DICA.revisar}>
      Revisar personagens
    </Link>
  )
}

function porcento(p: number | null): string {
  return p === null ? '' : `${Math.round(p * 100)}%`
}

/**
 * A descoberta deste episodio no passo 1: o andamento, "N grupos para
 * nomear", o porque de ter parado e, depois de confirmar, o resultado. null =
 * nada a dizer.
 */
export function LinhaDaDescoberta() {
  const deste = useDoEpisodio()
  const estado = useDescoberta((s) => s.estado)
  const pronta = useDescoberta((s) => s.pronta)
  const pedindo = useDescoberta((s) => s.pedindo)
  const cancelando = useDescoberta((s) => s.cancelando)
  const aberta = useDescoberta((s) => s.aberta)
  const erro = useDescoberta((s) => s.erro)
  const resultado = useDescoberta((s) => s.resultado)
  const decisao = useDescoberta((s) => s.decisao)
  const abrirTela = useDescoberta((s) => s.abrirTela)
  const cancelar = useDescoberta((s) => s.cancelar)
  const iniciar = useDescoberta((s) => s.iniciar)
  const esquecer = useDescoberta((s) => s.esquecer)
  // Quantos grupos ainda sem nome (a mesma conta do rodape da tela), e nao o total de grupos.
  const semNome = useMemo(
    () => (pronta ? resumoDaDecisao(pronta.grupos, decisao, opcoesDoResumo(pronta)).semNome.length : 0),
    [pronta, decisao],
  )
  // O Cancelar daqui com mudancas pergunta, como o da tela: descartava os nomes
  // calado, num clique. A pergunta e da rodada (jobId) e some ao abrir a tela.
  const mudancas = useMemo(() => mudancasDaDecisao(pronta, decisao), [pronta, decisao])
  const [descartarDe, setDescartarDe] = useState<string | null>(null)
  useEffect(() => {
    if (aberta) setDescartarDe(null)
  }, [aberta])
  if (!deste) return null

  const caixa = 'enter flex min-w-0 flex-col gap-2 rounded-sm border border-line bg-elevated px-3 py-2'

  if (resultado) {
    const n = resultado.personagens.length
    return (
      <div className={caixa} aria-live="polite">
        <div className="flex min-w-0 items-center gap-2">
          <Check size={13} strokeWidth={2} className="shrink-0 text-accent" />
          <span className="tnum min-w-0 flex-1 truncate text-[12px] text-ink-2">
            <span className="text-ink">
              {n} {n === 1 ? 'personagem salvo' : 'personagens salvos'}
            </span>
            {' · '}
            {resultado.cenasComPersonagem.toLocaleString('pt-BR')} de {resultado.totalCenas.toLocaleString('pt-BR')} cenas
            {' · '}
            {resultado.refsSalvas} {resultado.refsSalvas === 1 ? 'foto de referencia' : 'fotos de referencia'}
          </span>
          {resultado.pastaDasReferencias && (
            <AbrirPasta caminho={resultado.pastaDasReferencias} title="As fotos que o motor guardou como referencia" />
          )}
          <button
            type="button"
            onClick={esquecer}
            aria-label="Fechar o resultado"
            title="Fechar"
            className="grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink"
          >
            <X size={12} strokeWidth={1.75} />
          </button>
        </div>
        {resultado.descartados.length > 0 && (
          <Aviso title="O motor tira quem fica com menos de 4 cenas">
            Poucas cenas, ficaram de fora: {resultado.descartados.join(', ')}
          </Aviso>
        )}
        {resultado.avisos.map((a, i) => (
          <Aviso key={i}>{a}</Aviso>
        ))}
      </div>
    )
  }

  const status = estado?.status ?? null
  // Parou antes de subir (motor ocupado, episodio que nao pode): o erro fica aqui quando a tela esta fechada.
  if ((status === 'falhou' || (!estado && erro)) && !aberta) {
    const porque = estado?.erro ?? erro ?? 'Parou sem dizer por que.'
    const detalhe = estado?.detalhe ?? null
    return (
      <div className={caixa}>
        <div className="flex min-w-0 items-center gap-2">
          <TriangleAlert size={13} strokeWidth={1.5} className="shrink-0 text-danger" />
          <span
            className="min-w-0 flex-1 select-text truncate text-[12px] text-danger"
            title={detalhe ? `${porque}\n\nDo motor:\n${detalhe}` : porque}
          >
            Reconhecer na mao parou: {porque}
          </span>
          <Botao pequeno onClick={() => void iniciar()} title="Agrupa de novo (o corte e os rostos ficam em cache; o que voce ja decidiu volta)">
            Tentar de novo
          </Botao>
          <button
            type="button"
            onClick={esquecer}
            aria-label="Fechar o aviso"
            title="Fechar"
            className="grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink"
          >
            <X size={12} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    )
  }

  if (pedindo || status === 'agrupando') {
    // Com a tela fechada, "Cena 52 de 432" sozinho parecia o andamento do corte.
    const msg = estado?.mensagem ?? ''
    const frase = !msg ? 'Agrupando os rostos...' : /^agrupando/i.test(msg) ? msg : `Agrupando rostos · ${msg}`
    return (
      <div className={caixa} aria-live="polite">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={frase}>
            {frase}
          </span>
          {estado?.progresso != null && <span className="tnum shrink-0 text-[11px] text-ink-3">{porcento(estado.progresso)}</span>}
          <Botao pequeno onClick={abrirTela} title="Mostra a tela do Reconhecer na mao">
            Ver
          </Botao>
          <Botao pequeno onClick={() => void cancelar()} disabled={cancelando || !estado?.jobId} title="Para de agrupar. As cenas ficam como estao.">
            {cancelando ? 'Cancelando...' : 'Cancelar'}
          </Botao>
        </div>
        <Barra fracao={estado?.progresso ?? null} />
      </div>
    )
  }

  if (status === 'pronta' && pronta) {
    const n = semNome
    if (descartarDe === pronta.jobId) {
      return (
        <div className={caixa} aria-live="polite">
          <div className="flex min-w-0 items-center gap-2">
            <Users size={13} strokeWidth={1.5} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-danger">Descartar {textoDasMudancas(mudancas)} e parar?</span>
            <Botao pequeno foco="voltar-da-linha" onClick={() => setDescartarDe(null)} title="Continua com os grupos">
              Voltar
            </Botao>
            <Botao
              pequeno
              principal
              onClick={() => {
                setDescartarDe(null)
                void cancelar()
              }}
              disabled={cancelando}
              title="Para a descoberta. As cenas ficam como estao."
            >
              Descartar
            </Botao>
          </div>
        </div>
      )
    }
    return (
      <div className={caixa} aria-live="polite">
        <div className="flex min-w-0 items-center gap-2">
          <Users size={13} strokeWidth={1.5} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
            {n > 0 ? (
              <>
                <span className="tnum text-ink">{n}</span> {n === 1 ? 'grupo sem nome' : 'grupos sem nome'}
              </>
            ) : (
              'Grupos prontos para confirmar'
            )}
          </span>
          <Botao pequeno principal onClick={abrirTela} title="Abre os grupos de rostos">
            Dar nomes
          </Botao>
          <Botao
            pequeno
            onClick={() => {
              if (mudancas.total === 0) {
                void cancelar()
                return
              }
              setDescartarDe(pronta.jobId)
              focarBotao('voltar-da-linha')
            }}
            disabled={cancelando}
            title="Descarta os grupos. As cenas ficam como estao."
          >
            {cancelando ? 'Cancelando...' : 'Cancelar'}
          </Botao>
        </div>
      </div>
    )
  }

  if (status === 'salvando') {
    return (
      <div className={caixa} aria-live="polite">
        <p className="flex items-center gap-2 text-[12px] text-ink-2">
          <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
          Salvando os personagens...
        </p>
      </div>
    )
  }
  return null
}

/**
 * A pilula do cabecalho (ao lado da do corte), com a tela de grupos fechada:
 * em qualquer passo da para ver o andamento e voltar aos grupos. "Dar nomes"
 * fica rosa: o motor esta parado esperando por ele.
 */
export function AndamentoDaDescoberta() {
  const deste = useDoEpisodio()
  const aberta = useDescoberta((s) => s.aberta)
  const estado = useDescoberta((s) => s.estado)
  const pedindo = useDescoberta((s) => s.pedindo)
  const abrirTela = useDescoberta((s) => s.abrirTela)
  if (!deste || aberta) return null
  const status = estado?.status ?? (pedindo ? 'agrupando' : null)
  if (status !== 'agrupando' && status !== 'pronta' && status !== 'salvando' && status !== 'falhou') return null

  const classe = [
    'enter flex h-6 items-center gap-1.5 rounded-sm border px-2 text-[11px] transition-colors hover:text-ink',
    status === 'pronta' ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2',
  ].join(' ')
  const texto =
    status === 'agrupando'
      ? `Rostos ${porcento(estado?.progresso ?? null)}`.trim()
      : status === 'pronta'
        ? 'Dar nomes'
        : status === 'salvando'
          ? 'Salvando'
          : 'Rostos: parou'
  const dica =
    status === 'agrupando'
      ? 'Reconhecer na mao: agrupando os rostos por tras. Clique para ver.'
      : status === 'pronta'
        ? 'Os grupos de rostos estao prontos: o motor espera os nomes.'
        : status === 'salvando'
          ? 'Salvando os personagens.'
          : `Reconhecer na mao parou${estado?.erro ? `: ${estado.erro.replace(/\.$/, '')}` : ''}.`
  return (
    <button type="button" onClick={abrirTela} title={dica} aria-live="polite" className={classe}>
      {status === 'agrupando' || status === 'salvando' ? (
        <Loader2 size={11} strokeWidth={1.75} className="shrink-0 animate-spin text-accent" />
      ) : status === 'pronta' ? (
        <Users size={11} strokeWidth={1.75} className="shrink-0 text-accent" />
      ) : (
        <TriangleAlert size={11} strokeWidth={1.75} className="shrink-0 text-ink-3" />
      )}
      <span className="tnum whitespace-nowrap">{texto}</span>
    </button>
  )
}
