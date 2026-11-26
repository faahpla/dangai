import { ScanFace, Tags } from 'lucide-react'
import type { ModoDoCorte } from '@shared/ancut'
import { Janela } from './RevisarCena'

/**
 * "RECONHECER DE NOVO" PERGUNTA COMO (25/11). Ia direto para o reconhecimento
 * automatico: no One Piece (batizado na mao) o motor baixou o elenco inteiro
 * da internet -- centenas de personagens, uma demora enorme -- e chamou a
 * Robin de "Ain". O que ele queria era o Modo Descoberta. Agora escolhe, com o
 * batizar primeiro: e o que respeita os nomes que ele ja deu.
 */
export function ComoReconhecer({
  aoEscolher,
  aoFechar,
  titulo = 'Reconhecer de novo',
  detalhe,
}: {
  aoEscolher: (modo: Extract<ModoDoCorte, 'batizar' | 'reconhecer'>) => void
  aoFechar: () => void
  titulo?: string
  /** Uma linha antes das opcoes (o "reconhecer os N so cortados" diz o que vai para a fila). */
  detalhe?: string
}) {
  const opcao = 'flex w-full items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors'
  return (
    <Janela titulo={titulo} aoFechar={aoFechar} largura={480}>
      <div className="flex flex-col gap-2 px-4 py-4" data-acervo="como-reconhecer">
        {detalhe && <p className="pb-1 text-[12px] leading-relaxed text-ink-2">{detalhe}</p>}
        <button
          type="button"
          autoFocus
          onClick={() => aoEscolher('batizar')}
          className={`${opcao} border-accent/50 bg-accent-dim hover:border-accent`}
          data-acervo="reconhecer-batizar"
        >
          <Tags size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] font-semibold text-ink">Batizar na mão (Modo Descoberta)</span>
            <span className="text-[11px] leading-relaxed text-ink-3">
              Junta os rostos parecidos e você diz quem é cada um. Quem você já batizou vem com o nome. É o mais certo para anime que você batizou.
            </span>
          </span>
        </button>
        <button type="button" onClick={() => aoEscolher('reconhecer')} className={`${opcao} border-line bg-surface hover:border-line-strong`} data-acervo="reconhecer-sozinho">
          <ScanFace size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-3" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] font-semibold text-ink">Reconhecer sozinho</span>
            <span className="text-[11px] leading-relaxed text-ink-3">
              Pelo elenco da internet, sem perguntar nada. Em anime de elenco enorme (One Piece, Naruto) baixa centenas de personagens: demora e erra mais.
            </span>
          </span>
        </button>
        <p className="pt-1 text-[11px] text-ink-3">O que você marcou na mão continua marcado.</p>
      </div>
    </Janela>
  )
}
