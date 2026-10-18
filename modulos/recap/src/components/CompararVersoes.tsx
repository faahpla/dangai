import { useMemo } from 'react'
import { X } from 'lucide-react'
import { ROTULO_DO_PAPEL, palavrasDoRoteiro, type Roteiro } from '../../shared/roteiro'
import { compararVersoes } from '../../shared/revisao'
import { useRoteiro } from '../store/gerar-roteiro'
import { CAMPO_PEQUENO, CLASSE_DO_CAMPO, Link, Secao } from './pecas'

/** "IA", "Editada", "Revisada", "Melhorada", "Refeita: Gancho" (o Versoes e o Comparar). */
export function origemDaVersao(v: Pick<Roteiro, 'origem' | 'revisada' | 'melhorada' | 'pedido' | 'secoes'>): string {
  if (v.origem === 'editado') return 'Editada'
  if (v.melhorada) return 'Melhorada'
  if (v.revisada) return 'Revisada'
  if (v.pedido?.tipo === 'secao') {
    const papel = v.secoes.find((s) => s.id === v.pedido?.secaoId)?.papel
    return papel ? `Refeita: ${ROTULO_DO_PAPEL[papel]}` : 'Parte refeita'
  }
  return 'IA'
}

/**
 * [recap, A2] O "COMPARAR": duas versoes lado a lado, frase por frase (pelo
 * id). A direita e a da tela; a esquerda ele escolhe (abre na de onde a da
 * tela saiu: a de antes do revisor). A frase que mudou fica com o fundo rosa
 * apagado; a igual, apagada. "Ficar com a vN" volta para a da esquerda (a
 * mesma escolha do Versoes).
 */
export function CompararVersoes() {
  const rascunho = useRoteiro((s) => s.rascunho)
  const tela = useRoteiro((s) => s.tela)
  const comparando = useRoteiro((s) => s.comparando)
  const abrirComparar = useRoteiro((s) => s.abrirComparar)
  const fechar = useRoteiro((s) => s.fecharComparar)
  const escolherVersao = useRoteiro((s) => s.escolherVersao)
  const geracao = useRoteiro((s) => s.geracao)
  const aprovando = useRoteiro((s) => s.aprovando)
  const esquerda = rascunho?.roteiros.find((v) => v.versao === comparando) ?? null
  const linhas = useMemo(() => (esquerda && tela ? compararVersoes(esquerda, tela) : []), [esquerda, tela])

  if (!rascunho || !tela || !esquerda) return null
  const mudadas = linhas.filter((l) => !l.igual).length
  const outras = [...rascunho.roteiros].reverse().filter((v) => v.versao !== tela.versao)

  return (
    <div
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        fechar()
      }}
    >
      <Secao
        titulo="Comparar"
        acao={
          <span className="flex items-center gap-3">
            <span className="tnum text-[11px] text-ink-3">
              {mudadas === 0 ? 'Iguais' : `${mudadas} ${mudadas === 1 ? 'frase mudou' : 'frases mudaram'}`}
            </span>
            <button
              type="button"
              onClick={fechar}
              aria-label="Fechar"
              title="Fechar (Esc)"
              className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
            >
              <X size={13} strokeWidth={1.5} />
            </button>
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <select
              value={esquerda.versao}
              onChange={(e) => abrirComparar(Number(e.target.value))}
              aria-label="Versao da esquerda"
              className={`${CLASSE_DO_CAMPO} ${CAMPO_PEQUENO} w-[200px]`}
            >
              {outras.map((v) => (
                <option key={v.versao} value={v.versao}>
                  {`v${v.versao} · ${origemDaVersao(v)} · ${palavrasDoRoteiro(v)} pal.`}
                </option>
              ))}
            </select>
            <Link
              onClick={() => {
                fechar()
                void escolherVersao(esquerda.versao)
              }}
              disabled={geracao !== null || aprovando}
              title={`Volta para a v${esquerda.versao}. A da tela fica em Versoes.`}
            >
              Ficar com a v{esquerda.versao}
            </Link>
          </div>
          <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2">
            <span className="tnum font-medium text-ink">v{tela.versao}</span>
            <span className="truncate">· {origemDaVersao(tela)} · na tela</span>
          </p>
        </div>
        <div className="flex max-h-[56vh] flex-col overflow-y-auto pr-1">
          {linhas.map((l, i) => (
            <div key={`${l.fraseId}-${l.esquerda === null ? 'd' : l.direita === null ? 'e' : 'x'}`} className="flex flex-col">
              {l.abreParte && (
                <p className={['pb-1 text-[10px] font-medium uppercase tracking-wide text-ink-3', i === 0 ? '' : 'pt-3'].join(' ')}>{ROTULO_DO_PAPEL[l.papel]}</p>
              )}
              <div
                className={[
                  'grid grid-cols-2 gap-4 rounded-sm px-2.5 py-1.5 text-[12px] leading-[20px]',
                  l.igual ? 'text-ink-3' : 'bg-accent-dim text-ink',
                ].join(' ')}
              >
                <p className={['min-w-0 select-text', l.esquerda === null ? 'text-ink-3' : ''].join(' ')}>{l.esquerda ?? '—'}</p>
                <p className={['min-w-0 select-text', l.direita === null ? 'text-ink-3' : ''].join(' ')}>{l.direita ?? '—'}</p>
              </div>
            </div>
          ))}
        </div>
      </Secao>
    </div>
  )
}
