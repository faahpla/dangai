import { useEffect, useState } from 'react'
import { BookOpen, Check, Loader2 } from 'lucide-react'
import { textoDoResumo, type RoteiroDeMangaGuardado, type SerieDoManga } from '@shared/resumo-de-manga'
import { useProject } from '@/store/project'

/*
 * O RESUMO DE MANGA NA ETAPA DO ROTEIRO: "quero tambem um processo semelhante
 * ao padrao do app... arrastar um audio e edita-lo, depois arrastar um roteiro
 * ja pronto de manga, e depois ele ja ir direto na biblioteca para selecionar".
 *
 * Tres jeitos de o roteiro de manga chegar com os quadrinhos:
 * - o .txt que o Resumo de mangá salvou (ou o texto colado): reconhecido sozinho,
 *   mesmo depois de mexido (reconhecerRoteiroDeManga, no store);
 * - um clique num dos roteiros que o Resumo escreveu (aqui embaixo);
 * - roteiro escrito fora: ele escolhe os capitulos e a IA casa cada frase com
 *   os quadrinhos (casarRoteiroComOsQuadrinhos), enquanto a sincronia corre.
 * Em todos, a Biblioteca abre no capitulo com as cenas de cada trecho marcadas.
 */

/** Os capitulos escolhidos para casar um roteiro escrito fora, e o que a IA esta fazendo. */
export function useCasamentoDoManga(): {
  escolhidos: string[]
  alternar: (dir: string) => void
  andamento: string | null
  erro: string | null
} {
  const script = useProject((s) => s.script)
  const resumo = useProject((s) => s.resumoDoManga)
  const aplicar = useProject((s) => s.aplicarResumoDoManga)
  const [escolhidos, setEscolhidos] = useState<string[]>([])
  const [andamento, setAndamento] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [feitoPara, setFeitoPara] = useState<string | null>(null)

  // Roteiro novo sem quadrinhos e capitulos escolhidos: a IA casa (uma vez por roteiro).
  useEffect(() => {
    if (!script || resumo || escolhidos.length === 0 || andamento || feitoPara === script) return
    setFeitoPara(script)
    setErro(null)
    setAndamento('Começando...')
    const parar = window.dangai.onProgressoDoResumo((m) => setAndamento(m))
    void window.dangai
      .casarRoteiroComOsQuadrinhos({ dirs: escolhidos, texto: script })
      .then((r) => {
        if (r.ok) aplicar(r.value)
        else setErro(r.error)
      })
      .finally(() => {
        parar()
        setAndamento(null)
      })
  }, [script, resumo, escolhidos, andamento, feitoPara, aplicar])

  return {
    escolhidos,
    alternar: (dir) => setEscolhidos((atual) => (atual.includes(dir) ? atual.filter((d) => d !== dir) : [...atual, dir])),
    andamento,
    erro,
  }
}

/** A linha que diz que o roteiro e de manga, com de onde vem. */
export function MangaReconhecido() {
  const resumo = useProject((s) => s.resumoDoManga)
  if (!resumo) return null
  const caps = resumo.capitulos.map(nomeDoCapitulo)
  const comQuadros = resumo.frases.filter((f) => f.quadros.length > 0).length
  return (
    <p className="flex items-center gap-2 text-[12px] text-ink-2">
      <BookOpen size={13} strokeWidth={1.5} className="shrink-0 text-accent" />
      <span className="min-w-0 truncate">
        Mangá: {caps.join(', ')} · {comQuadros} {comQuadros === 1 ? 'frase' : 'frases'} com quadrinhos. A Biblioteca abre no capítulo, com as
        cenas marcadas.
      </span>
    </p>
  )
}

/**
 * Embaixo da area de soltar: os roteiros que o Resumo de mangá escreveu, e os
 * capitulos de um roteiro escrito fora.
 */
export function MangaAntesDoRoteiro({
  casamento,
}: {
  casamento: ReturnType<typeof useCasamentoDoManga>
}) {
  const aplicar = useProject((s) => s.aplicarResumoDoManga)
  const [roteiros, setRoteiros] = useState<RoteiroDeMangaGuardado[]>([])
  const [series, setSeries] = useState<SerieDoManga[]>([])
  const [serie, setSerie] = useState<string | null>(null)

  useEffect(() => {
    void window.dangai.roteirosDeManga().then((r) => r.ok && setRoteiros(r.value.slice(0, 4)))
    void window.dangai.seriesDosMangas().then((r) => {
      if (!r.ok) return
      setSeries(r.value)
      setSerie((atual) => atual ?? r.value[0]?.serie ?? null)
    })
  }, [])

  if (roteiros.length === 0 && series.length === 0) return null

  const usar = (r: RoteiroDeMangaGuardado): void => {
    const { id: _id, em: _em, ...resumo } = r
    aplicar(resumo)
    // A sincronia comeca sozinha com o roteiro no lugar (ver EtapaDoRoteiro).
    useProject.setState({ script: textoDoResumo(resumo.frases), captionsEdited: false, scriptNote: null, projectDirty: true })
  }
  const capitulos = series.find((s) => s.serie === serie)?.capitulos ?? []

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <BookOpen size={14} strokeWidth={1.5} className="text-accent" />
        Resumo de mangá
      </h2>

      {roteiros.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-ink-3">Roteiros que o Resumo de mangá escreveu. Um clique usa o roteiro com os quadrinhos de cada frase.</p>
          <div className="grid grid-cols-2 gap-1.5">
            {roteiros.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => usar(r)}
                title={textoDoResumo(r.frases)}
                className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-elevated px-3 py-2 text-left transition-colors hover:border-accent/60"
              >
                <span className="truncate text-[12px] font-medium text-ink">{r.titulo || r.frases[0]?.texto || 'Sem título'}</span>
                <span className="truncate text-[11px] text-ink-3">
                  {r.capitulos.map(nomeDoCapitulo).join(', ')} · {r.frases.length} frases · {quando(r.em)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {series.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-ink-3">
            Escreveu o roteiro fora do Dangai? Marque os capítulos antes de soltar: a IA casa cada frase com os quadrinhos.
          </p>
          <div className="flex flex-wrap gap-1">
            {series.map((s) => (
              <Chip key={s.serie} ativo={s.serie === serie} onClick={() => setSerie(s.serie)}>
                {s.serie}
              </Chip>
            ))}
          </div>
          {capitulos.length > 0 && (
            <div className="flex max-h-[96px] flex-wrap gap-1 overflow-y-auto">
              {capitulos.map((c) => {
                const marcado = casamento.escolhidos.includes(c.dir)
                return (
                  <Chip key={c.dir} ativo={marcado} onClick={() => casamento.alternar(c.dir)} realce>
                    {marcado && <Check size={11} strokeWidth={2} />}
                    {c.capitulo}
                  </Chip>
                )
              })}
            </div>
          )}
          {casamento.escolhidos.length > 0 && (
            <p className="text-[11px] text-accent">
              {casamento.escolhidos.length} {casamento.escolhidos.length === 1 ? 'capítulo marcado' : 'capítulos marcados'}. Agora solte ou cole o
              roteiro.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/** O andamento (ou o erro) da IA casando o roteiro com os quadrinhos. */
export function CasandoOManga({ casamento }: { casamento: ReturnType<typeof useCasamentoDoManga> }) {
  if (casamento.andamento) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-ink-2">
        <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
        Mangá: {casamento.andamento}
      </p>
    )
  }
  if (casamento.erro) return <p className="text-[12px] text-danger">Os quadrinhos não vieram: {casamento.erro}</p>
  return null
}

function Chip({
  ativo,
  realce = false,
  onClick,
  children,
}: {
  ativo: boolean
  realce?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] transition-colors',
        ativo
          ? realce
            ? 'border-accent bg-accent-dim text-ink'
            : 'border-line-strong bg-elevated text-ink'
          : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** "Bleach · Cap. 359" a partir da pasta do capitulo. */
function nomeDoCapitulo(dir: string): string {
  const partes = dir.split(/[\\/]/).filter(Boolean)
  return partes.length >= 2 ? `${partes.at(-2)} · ${partes.at(-1)}` : (partes.at(-1) ?? dir)
}

function quando(ms: number): string {
  if (!ms) return ''
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 60) return `há ${Math.max(1, min)} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}
