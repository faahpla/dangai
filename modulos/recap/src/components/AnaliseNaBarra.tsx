import { Loader2, TriangleAlert } from 'lucide-react'
import { ROTULO_DA_ETAPA } from '../../shared/episodio'
import { ROTULO_DA_ETAPA_DO_ROTEIRO } from '../../shared/roteiro'
import { useGerar } from '../store/gerar'
import { useRoteiro } from '../store/gerar-roteiro'
import { corteVivo, textoCurtoDoCorte } from './AndamentoDoCorte'

/**
 * A analise do "Gerar recap" na barra de status, com o assistente fechado --
 * igual ao upscale de video pronto: o andamento e o caminho de volta ("Ver").
 *
 * A analise leva minutos e continua com o assistente fechado; antes, o unico
 * sinal dela era um spinner de 13 px no botao da tela inicial, e no editor nao
 * havia sinal nenhum. Com o assistente aberto ele cobre a barra, e isto nao
 * aparece.
 *
 * O roteiro do passo 2 tambem: a IA leva 1 a 3 min e continua com o
 * assistente fechado. "Ver" volta ao assistente, no passo em que ele estava.
 *
 * E o CORTE EM SEGUNDO PLANO (shared/episodio.ts, corte): as cenas do episodio
 * sendo cortadas por tras, ou o corte que parou -- o deste episodio ou o de
 * outro que ficou rodando quando ele trocou de episodio. Junto do roteiro,
 * cabe na mesma linha ("Roteiro ... · Cenas 42%").
 */
export function AnaliseNaBarra() {
  const job = useGerar((s) => s.job)
  const indexando = useGerar((s) => s.fase === 'indexando')
  const progresso = useGerar((s) => s.progresso)
  const abrir = useGerar((s) => s.abrir)
  const roteiro = useRoteiro((s) => s.geracao)
  const corteDaTela = useGerar((s) => s.corte)
  const corteDeOutro = useGerar((s) => s.corteDeOutro)

  // O da tela manda; o de outro episodio so quando ele esta vivo.
  const corte = corteDaTela && corteDaTela.status !== 'pronto' ? corteDaTela : corteDeOutro?.estado ?? null
  const corteMostra = corte !== null && (corteVivo(corte) || corte.status === 'falhou')

  if (!job && !indexando && !roteiro && !corteMostra) return null

  let texto: string
  let girando = true
  if (job || indexando) {
    const etapa = indexando ? 'Lendo as falas' : ROTULO_DA_ETAPA[progresso?.etapa ?? 'preparando']
    const fracao = !indexando && progresso?.fracao != null ? ` ${Math.round(progresso.fracao * 100)}%` : ''
    texto = job?.cancelando ? 'Cancelando a analise...' : `Analisando episodio · ${etapa}${fracao}`
  } else {
    const partes: string[] = []
    if (roteiro) partes.push(`Roteiro · ${ROTULO_DA_ETAPA_DO_ROTEIRO[roteiro.etapa]}`)
    if (corte && corteMostra) partes.push(corte.status === 'falhou' ? 'Corte das cenas parou' : textoCurtoDoCorte(corte))
    texto = partes.join(' · ')
    girando = Boolean(roteiro) || (corte !== null && corteVivo(corte))
  }

  return (
    <span className="flex min-w-0 shrink items-center gap-2 text-[11px] text-ink-2">
      {girando ? (
        <Loader2 size={12} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
      ) : (
        <TriangleAlert size={12} strokeWidth={1.5} className="shrink-0 text-ink-3" />
      )}
      <span className="tnum truncate">{texto}</span>
      <button
        type="button"
        onClick={() => abrir()}
        title="Abrir o Gerar recap"
        className="shrink-0 rounded-sm border border-line bg-elevated px-2 py-0.5 text-[11px] text-ink-2 hover:text-ink"
      >
        Ver
      </button>
    </span>
  )
}
