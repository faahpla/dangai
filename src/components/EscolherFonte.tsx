import { useMemo, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import {
  ehFonteDoPc,
  nomeDaFonteNaTela,
  PREFIXO_DA_FONTE_DO_PC,
  temItalicoDeVerdade,
  temNegritoDeVerdade,
} from '@shared/contract'
import { useProject } from '@/store/project'

/**
 * A FONTE DA LEGENDA (26/11): as instaladas no Windows, com busca, e o
 * negrito/italico.
 *
 * "Nunca vi eu ter que colar um .ttf nessa bomba pra conseguir; pq nao busca
 * as fontes que estao instaladas na maquina? igual no modulo de thumbnail" e
 * "quero escolher se quero ela bold ou nao, italic ou nao, e ativar o bold
 * mesmo que ela nao tenha".
 *
 * A lista mostra cada nome NA PROPRIA FONTE (a janela do Dangai enxerga as
 * fontes do Windows pelo nome; o render, nao -- por isso a legenda carrega o
 * arquivo, ver fonteDaLegenda). A pasta de fontes do Dangai continua valendo
 * para quem ja tinha fonte la.
 */

/** Quantas aparecem de uma vez: o resto vem pela busca. */
const NA_LISTA = 120

export function EscolherFonte() {
  const captionFont = useProject((s) => s.captionFont)
  const estilo = useProject((s) => s.captionFontEstilo)
  const setCaptionFont = useProject((s) => s.setCaptionFont)
  const setEstilo = useProject((s) => s.setCaptionFontEstilo)
  const fontes = useProject((s) => s.fontes)
  const fontesDoPc = useProject((s) => s.fontesDoPc)
  const openFontesDir = useProject((s) => s.openFontesDir)
  const [aberta, setAberta] = useState(false)
  const [busca, setBusca] = useState('')

  const termo = busca.trim().toLowerCase()
  const daPasta = useMemo(
    () => fontes.filter((f) => !termo || nomeDaFonteNaTela(f.nome).toLowerCase().includes(termo)),
    [fontes, termo],
  )
  const doPc = useMemo(
    () =>
      (fontesDoPc ?? []).filter(
        // A Komika instalada e a mesma que vem no app: aparece uma vez so, no alto.
        (f) => f.familia.toLowerCase() !== 'komika axis' && (!termo || f.familia.toLowerCase().includes(termo)),
      ),
    [fontesDoPc, termo],
  )
  const komikaAparece = !termo || 'komika axis'.includes(termo)

  const nomeAtual = captionFont ? nomeDaFonteNaTela(captionFont.nome) : 'Komika Axis'
  const temNegrito = temNegritoDeVerdade(captionFont)
  const temItalico = temItalicoDeVerdade(captionFont)

  const escolher = (nome: string | null): void => {
    setCaptionFont(nome)
    setAberta(false)
    setBusca('')
  }

  const primeira = (): string | null | undefined => {
    if (komikaAparece) return null
    if (daPasta[0]) return daPasta[0].nome
    if (doPc[0]) return PREFIXO_DA_FONTE_DO_PC + doPc[0].familia
    return undefined
  }

  return (
    <div data-estilo="fonte">
      <span className="text-[10px] uppercase tracking-wide text-ink-3">Fonte</span>

      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        title="Trocar a fonte da legenda"
        className="mt-1.5 flex w-full items-center gap-2 rounded-sm border border-line bg-elevated px-2 py-1.5 text-left hover:border-line-strong"
      >
        <span className="min-w-0 flex-1 truncate text-[14px] text-ink" style={{ fontFamily: familiaNaTela(nomeAtual) }}>
          {nomeAtual}
        </span>
        {!captionFont && <span className="shrink-0 text-[10px] text-ink-3">vem no app</span>}
        <ChevronDown size={13} strokeWidth={1.75} className={['shrink-0 text-ink-3 transition-transform', aberta ? 'rotate-180' : ''].join(' ')} />
      </button>

      {aberta && (
        <div className="mt-1 overflow-hidden rounded-sm border border-line bg-elevated">
          <label className="flex items-center gap-1.5 border-b border-line px-2">
            <Search size={12} strokeWidth={1.75} className="shrink-0 text-ink-3" />
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                // Letra digitada aqui nao e atalho do editor.
                e.stopPropagation()
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setAberta(false)
                } else if (e.key === 'Enter') {
                  const n = primeira()
                  if (n !== undefined) escolher(n)
                }
              }}
              placeholder="Buscar fonte instalada"
              aria-label="Buscar fonte"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] text-ink placeholder:text-ink-3 focus:outline-none"
            />
          </label>
          <div role="listbox" aria-label="Fontes" className="max-h-[230px] overflow-y-auto py-1">
            {komikaAparece && (
              <ItemDaFonte
                nome="Komika Axis"
                detalhe="vem no app"
                ativa={captionFont === null}
                onClick={() => escolher(null)}
              />
            )}

            {daPasta.length > 0 && <Grupo>Na pasta de fontes</Grupo>}
            {daPasta.map((f) => (
              <ItemDaFonte
                key={f.nome}
                nome={nomeDaFonteNaTela(f.nome)}
                ativa={captionFont?.nome === f.nome}
                onClick={() => escolher(f.nome)}
              />
            ))}

            <Grupo>Instaladas no PC</Grupo>
            {fontesDoPc === null && <Aviso>Lendo as fontes do PC...</Aviso>}
            {fontesDoPc !== null && doPc.length === 0 && (
              <Aviso>{termo ? 'Nenhuma fonte instalada com esse nome.' : 'Nenhuma fonte .ttf ou .otf instalada.'}</Aviso>
            )}
            {doPc.slice(0, NA_LISTA).map((f) => {
              const nome = PREFIXO_DA_FONTE_DO_PC + f.familia
              const n = Boolean(f.variantes.b || f.variantes.bi)
              const i = Boolean(f.variantes.i || f.variantes.bi)
              return (
                <ItemDaFonte
                  key={f.familia}
                  nome={f.familia}
                  detalhe={n && i ? 'negrito e itálico' : n ? 'negrito' : i ? 'itálico' : undefined}
                  ativa={captionFont !== null && ehFonteDoPc(captionFont.nome) && captionFont.nome.toLowerCase() === nome.toLowerCase()}
                  onClick={() => escolher(nome)}
                />
              )
            })}
            {doPc.length > NA_LISTA && <Aviso>Mais {doPc.length - NA_LISTA}: busque pelo nome.</Aviso>}
          </div>
          <p className="border-t border-line px-2 py-1.5 text-[10px] leading-snug text-ink-3">
            Não achou? Instale a fonte no Windows (dois cliques no .ttf → Instalar) e abra o Estilo de novo.{' '}
            <button type="button" onClick={() => void openFontesDir()} className="underline-offset-2 hover:text-ink-2 hover:underline">
              Pasta de fontes do Dangai
            </button>
          </p>
        </div>
      )}

      <div className="mt-1.5 flex gap-1">
        <BotaoDeEstilo
          ativo={estilo.negrito && temNegrito}
          desligado={!temNegrito}
          onClick={() => setEstilo({ negrito: !estilo.negrito })}
          title={temNegrito ? 'Negrito (o da própria fonte)' : 'Esta fonte não tem negrito: use "Forçar negrito"'}
        >
          <span className="font-bold">N</span>
        </BotaoDeEstilo>
        <BotaoDeEstilo
          ativo={estilo.italico}
          onClick={() => setEstilo({ italico: !estilo.italico })}
          title={temItalico ? 'Itálico (o da própria fonte)' : 'Itálico (esta fonte não tem: o Dangai inclina a letra)'}
        >
          <span className="font-serif italic">I</span>
        </BotaoDeEstilo>
        <BotaoDeEstilo
          largo
          ativo={estilo.forcarNegrito}
          onClick={() => setEstilo({ forcarNegrito: !estilo.forcarNegrito })}
          title="Engrossa a letra mesmo que a fonte não tenha negrito (e por cima do negrito, se tiver)"
        >
          Forçar negrito
        </BotaoDeEstilo>
      </div>
      {!temNegrito && !estilo.forcarNegrito && (
        <p className="mt-1 text-[10px] leading-snug text-ink-3">
          Esta fonte não tem negrito próprio: o “Forçar negrito” engrossa mesmo assim.
        </p>
      )}
    </div>
  )
}

/** O nome da fonte como familia CSS da janela (que enxerga as do Windows). */
function familiaNaTela(nome: string): string {
  return `"${nome.replace(/"/g, '')}", "Inter Variable", sans-serif`
}

function ItemDaFonte({
  nome,
  detalhe,
  ativa,
  onClick,
}: {
  nome: string
  detalhe?: string
  ativa: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={ativa}
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-[var(--color-surface)]',
        ativa ? 'text-accent' : 'text-ink',
      ].join(' ')}
    >
      <span className="grid size-3 shrink-0 place-items-center">{ativa && <Check size={11} strokeWidth={2.25} />}</span>
      <span className="min-w-0 flex-1 truncate text-[14px] leading-tight" style={{ fontFamily: familiaNaTela(nome) }}>
        {nome}
      </span>
      {detalhe && <span className="shrink-0 text-[10px] text-ink-3">{detalhe}</span>}
    </button>
  )
}

function Grupo({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block px-2 pt-1 pb-0.5 text-[9px] uppercase tracking-wide text-ink-3">{children}</span>
}

function Aviso({ children }: { children: React.ReactNode }) {
  return <span className="block px-2 py-1 text-[11px] text-ink-3">{children}</span>
}

function BotaoDeEstilo({
  ativo,
  desligado,
  largo,
  onClick,
  title,
  children,
}: {
  ativo: boolean
  desligado?: boolean
  largo?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desligado}
      aria-pressed={ativo}
      title={title}
      className={[
        'grid h-7 place-items-center rounded-sm border text-[12px] disabled:cursor-not-allowed disabled:opacity-35',
        largo ? 'flex-1 px-2 text-[11px]' : 'w-8',
        ativo ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
