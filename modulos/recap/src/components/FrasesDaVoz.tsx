import { memo, useMemo } from 'react'
import { Loader2, Pause, Play, RotateCcw } from 'lucide-react'
import { ROTULO_DO_PAPEL, type Frase, type Roteiro } from '../../shared/roteiro'
import { frasesMudadas, textoFalado, type TakeDaVoz, type TrechoDaFrase } from '../../shared/voz'
import { custoDeRegravar, segundosCurtos, tocador, useTocador, useVoz } from '../store/gerar-voz'
import { PerguntaDeCusto } from './PerguntaDeCusto'
import { palavrasPorFrase, type PalavraIndexada } from './TocadorDaVoz'
import { Botao, COR_DE_AVISO, Secao } from './pecas'

type EstadoDaLinha = 'ok' | 'mudou' | 'nova'

/**
 * AS FRASES DA NARRACAO, nas mesmas partes do passo 2 (Gancho, Contexto...):
 * cada uma com o play so do trecho dela, a duracao e o "Regravar" com o
 * custo. A frase que toca fica marcada e as palavras dela acendem, como no
 * tocador.
 *
 * A lista segue o roteiro ATUAL. Frase que mudou depois da voz ("Mudou")
 * mostra o texto novo -- o audio ainda e o antigo, no tooltip --; frase nova
 * ("Nova") nao tem audio ainda.
 */
export function FrasesDaVoz({ roteiro, take }: { roteiro: Roteiro; take: TakeDaVoz }) {
  const mudancas = useMemo(() => frasesMudadas(roteiro, take), [roteiro, take])
  const porFrase = useMemo(() => palavrasPorFrase(take.palavras), [take.palavras])
  const trechos = useMemo(() => new Map(take.trechos.map((t) => [t.fraseId, t])), [take.trechos])
  const custos = useMemo(() => {
    const mapa = new Map<string, { creditos: number; extras: number }>()
    for (const secao of roteiro.secoes) {
      for (const f of secao.frases) {
        if (!textoFalado(f.texto)) continue
        const c = custoDeRegravar(roteiro, take, [f.id])
        mapa.set(f.id, { creditos: c.creditos, extras: c.extras })
      }
    }
    return mapa
  }, [roteiro, take])
  const importado = take.config.fonte === 'importado'

  return (
    <div className="flex flex-col gap-4">
      {roteiro.secoes.map((secao) => {
        const frases = secao.frases.filter((f) => textoFalado(f.texto))
        if (frases.length === 0) return null
        const total = frases.reduce((soma, f) => soma + (trechos.get(f.id)?.duracao ?? 0), 0)
        return (
          <Secao
            key={secao.id}
            titulo={ROTULO_DO_PAPEL[secao.papel]}
            acao={
              <span className="tnum text-[11px] text-ink-3" title="Duracao desta parte na narracao">
                {segundosCurtos(total)}
              </span>
            }
          >
            <ol className="flex flex-col gap-1.5">
              {frases.map((f) => {
                const estado: EstadoDaLinha = mudancas.novas.includes(f.id)
                  ? 'nova'
                  : mudancas.mudadas.includes(f.id)
                    ? 'mudou'
                    : 'ok'
                const custo = custos.get(f.id) ?? { creditos: 0, extras: 0 }
                return (
                  <LinhaDaFrase
                    key={f.id}
                    frase={f}
                    trecho={trechos.get(f.id) ?? null}
                    palavras={porFrase.get(f.id) ?? null}
                    estado={estado}
                    creditos={custo.creditos}
                    extras={custo.extras}
                    importado={importado}
                  />
                )
              })}
            </ol>
          </Secao>
        )
      })}
    </div>
  )
}

const LinhaDaFrase = memo(function LinhaDaFrase({
  frase,
  trecho,
  palavras,
  estado,
  creditos,
  extras,
  importado,
}: {
  frase: Frase
  trecho: TrechoDaFrase | null
  palavras: PalavraIndexada[] | null
  estado: EstadoDaLinha
  creditos: number
  extras: number
  importado: boolean
}) {
  // -2 = a agulha nao esta nesta frase (cada linha so redesenha quando ela entra, sai ou a palavra muda).
  const acesa = useTocador((s) => (s.usado && s.frase === frase.id ? s.palavra : -2))
  const tocandoEsta = useTocador((s) => s.trecho === frase.id && s.tocando)
  const pronto = useTocador((s) => s.chave !== null)
  // Primitivos: o andamento do motor chega varias vezes por segundo e nao deve redesenhar as 17 linhas.
  const regravando = useVoz((s) => s.pedido?.tipo === 'regravar' && s.pedido.fraseIds.includes(frase.id))
  // Uma pergunta de custo aberta noutro lugar tambem trava: um gasto de cada vez.
  const travado = useVoz((s) => s.pedido !== null || s.perguntando !== null || (s.pergunta !== null && s.pergunta.onde !== frase.id))
  const calculando = useVoz((s) => s.perguntando === frase.id)
  const pergunta = useVoz((s) => (s.pergunta?.onde === frase.id ? s.pergunta : null))
  const pedirRegravar = useVoz((s) => s.pedirRegravar)

  const ativa = acesa !== -2
  const falado = textoFalado(frase.texto)
  /*
   * O Regravar aparece no hover/foco (17 botoes iguais de uma vez era ruido):
   * por cima do fim da linha, sem guardar lugar -- a duracao fica encostada na
   * direita, como as marcas do passo 2. Fica sempre (no fluxo) na frase que
   * toca e na que mudou. Com a pergunta dela aberta, ele sai: o "Regravar" e o
   * da pergunta, embaixo.
   */
  const fixo = ativa || estado !== 'ok' || calculando

  const rotulo = estado === 'nova' ? 'Gravar' : 'Regravar'
  const dicaDoRegravar = `${estado === 'nova' ? 'Gera esta frase' : 'Gera so esta frase de novo'}, com o contexto das vizinhas (~${creditos} caracteres)${
    extras > 0 ? `. Inclui ${extras} ${extras === 1 ? 'frase que mudou' : 'frases que mudaram'} no roteiro.` : ''
  }`
  const botaoDeRegravar = (
    <Botao
      pequeno
      foco={`regravar-${frase.id}`}
      onClick={() => void pedirRegravar([frase.id], frase.id)}
      disabled={travado}
      title={dicaDoRegravar}
    >
      <RotateCcw size={12} strokeWidth={1.5} />
      {calculando ? 'Calculando...' : rotulo}
      {!calculando && creditos > 0 && <span className="tnum text-ink-3">~{creditos}</span>}
    </Botao>
  )

  return (
    <li
      data-frase={frase.id}
      className={[
        'enter group/frase flex min-w-0 flex-col rounded-sm border transition-colors',
        // Regravando: a linha inteira diz, nao so um spinner de 12 px (o cartao do andamento fica la em cima).
        regravando ? 'border-accent bg-accent-dim' : ativa ? 'border-accent bg-elevated' : 'border-line bg-elevated focus-within:border-ink-3',
      ].join(' ')}
    >
      <div className="relative flex min-w-0 items-center gap-2 px-2 py-1">
        <button
          type="button"
          onClick={() => tocador.tocarTrecho(frase.id)}
          disabled={!trecho || !pronto}
          aria-label={tocandoEsta ? 'Pausar a frase' : 'Ouvir esta frase'}
          title={!trecho ? 'Sem audio ainda' : tocandoEsta ? 'Pausar' : 'Ouvir so esta frase'}
          className={[
            'grid size-7 shrink-0 place-items-center rounded-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
            tocandoEsta ? 'text-accent' : 'text-ink-2 hover:text-ink',
          ].join(' ')}
        >
          {tocandoEsta ? <Pause size={13} strokeWidth={1.5} /> : <Play size={13} strokeWidth={1.5} />}
        </button>

        <p
          className="min-w-0 flex-1 select-text py-[6px] text-[13px] leading-[22px]"
          title={estado === 'mudou' && trecho ? `Na voz: ${trecho.texto}` : undefined}
        >
          {estado === 'ok' && palavras ? (
            palavras.map((p) => (
              <span
                key={p.i}
                className={
                  !ativa ? 'text-ink' : p.i > acesa ? 'text-ink-3' : p.i === acesa ? 'text-accent' : 'text-ink'
                }
              >
                {p.texto}{' '}
              </span>
            ))
          ) : (
            <span className="text-ink-2">{falado}</span>
          )}
        </p>

        {estado !== 'ok' && (
          <span
            title={estado === 'mudou' ? 'O texto mudou depois da voz' : 'Frase nova: ainda sem voz'}
            className={[
              'shrink-0 rounded-[3px] border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              estado === 'mudou' ? `border-[#f6a23c] ${COR_DE_AVISO}` : 'border-line text-ink-2',
            ].join(' ')}
          >
            {estado === 'mudou' ? 'Mudou' : 'Nova'}
          </span>
        )}

        {/* No audio importado nao ha o que regravar aqui: o caminho e gravar e importar de novo (cartao de cima). */}
        {regravando ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-2" aria-live="polite">
            <Loader2 size={12} strokeWidth={1.75} className="animate-spin text-accent" />
            Regravando...
          </span>
        ) : (
          !importado &&
          !pergunta &&
          (fixo ? (
            <span className="flex shrink-0">{botaoDeRegravar}</span>
          ) : (
            // Por cima do fim do texto, com o fundo da linha (o degrade esconde a palavra que fica embaixo).
            <span
              className="pointer-events-none absolute inset-y-0 right-[58px] flex items-center pl-6 opacity-0 transition-opacity group-hover/frase:pointer-events-auto group-hover/frase:opacity-100 group-focus-within/frase:pointer-events-auto group-focus-within/frase:opacity-100"
              style={{ background: 'linear-gradient(to right, transparent, var(--color-elevated) 1.25rem)' }}
            >
              {botaoDeRegravar}
            </span>
          ))
        )}

        <span className="tnum w-[44px] shrink-0 text-right text-[11px] text-ink-3" title="Duracao na narracao">
          {trecho ? segundosCurtos(trecho.duracao) : '--'}
        </span>
      </div>

      {pergunta && (
        <div className="border-t border-line px-3 py-2">
          <PerguntaDeCusto pergunta={pergunta} pequeno />
        </div>
      )}
    </li>
  )
})
