import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Loader2, RefreshCw, RotateCcw, Search } from 'lucide-react'
import {
  legendaTemTexto,
  slugDoEpisodio,
  type FaixaDeLegenda,
  type KindDoEpisodio,
  type SondaDoEpisodio,
} from '../../shared/episodio'
import { useGerar } from '../store/gerar'
import { useRoteiro } from '../store/gerar-roteiro'
import { useVoz } from '../store/gerar-voz'
import { Field } from '@/components/painel'
import { AbrirPasta, Botao, CAMPO_NORMAL, CLASSE_DO_CAMPO, formatarTempo, Secao } from './pecas'

/**
 * (a) A AREA DE SOLTAR do assistente, enquanto nao ha episodio. O mesmo
 * desenho do Dropzone da tela inicial (a tela inteira, borda tracejada, frase
 * de 32 px, uma linha de apoio), para o gesto ser o mesmo: clicar abre o
 * dialogo, soltar o .mkv aqui (ou em qualquer canto do assistente) tambem vale.
 */
export function AreaDeSoltar({ arrastando }: { arrastando: boolean }) {
  const escolherArquivo = useGerar((s) => s.escolherArquivo)
  return (
    <button
      type="button"
      onClick={() => void escolherArquivo()}
      className={[
        'enter flex h-full w-full flex-col items-center justify-center gap-5 rounded-lg border border-dashed transition-colors duration-200 ease-dangai',
        arrastando ? 'border-accent bg-accent-dim' : 'border-line hover:border-line-strong',
      ].join(' ')}
    >
      <motion.div
        animate={{ scale: arrastando ? 1.04 : 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-5"
      >
        <span
          className={[
            'text-[32px] font-semibold tracking-tight transition-colors duration-200',
            arrastando ? 'text-accent' : 'text-ink',
          ].join(' ')}
        >
          Soltar o episodio aqui
        </span>
        <span className="text-[13px] text-ink-3">ou clique para escolher</span>
      </motion.div>
    </button>
  )
}

/** Nome legivel do codigo de idioma do container. Fora da lista, o proprio codigo. */
const IDIOMAS: Record<string, string> = {
  por: 'Portugues',
  pt: 'Portugues',
  eng: 'Ingles',
  en: 'Ingles',
  spa: 'Espanhol',
  es: 'Espanhol',
  jpn: 'Japones',
  ja: 'Japones',
  fre: 'Frances',
  fra: 'Frances',
  ger: 'Alemao',
  deu: 'Alemao',
  ita: 'Italiano',
  rus: 'Russo',
  ara: 'Arabe',
  chi: 'Chines',
  zho: 'Chines',
  kor: 'Coreano',
  ind: 'Indonesio',
  may: 'Malaio',
  msa: 'Malaio',
  tha: 'Tailandes',
  vie: 'Vietnamita',
  pol: 'Polones',
  tur: 'Turco',
  hin: 'Hindi',
}

const CODECS: Record<string, string> = {
  ass: '.ass',
  ssa: '.ssa',
  subrip: '.srt',
  srt: '.srt',
  webvtt: '.vtt',
  mov_text: 'mov_text',
  hdmv_pgs_subtitle: 'PGS',
  dvd_subtitle: 'VobSub',
}

/** "Ingles · English · .ass · padrao". Faixa de imagem diz que nao da falas. */
export function rotuloDaFaixa(faixa: FaixaDeLegenda): string {
  const idioma = IDIOMAS[faixa.idioma.toLowerCase()] ?? (faixa.idioma || 'Sem idioma')
  const partes = [idioma]
  if (faixa.nome && faixa.nome.toLowerCase() !== idioma.toLowerCase()) partes.push(faixa.nome)
  partes.push(CODECS[faixa.codec.toLowerCase()] ?? faixa.codec)
  if (faixa.default) partes.push('padrao')
  if (faixa.forced) partes.push('forcada')
  const texto = partes.join(' · ')
  return legendaTemTexto(faixa) ? texto : `${texto} (imagem, sem falas)`
}

const TIPOS: { valor: KindDoEpisodio; rotulo: string }[] = [
  { valor: '', rotulo: 'Episodio' },
  { valor: 'OP', rotulo: 'Abertura (OP)' },
  { valor: 'ED', rotulo: 'Encerramento (ED)' },
  { valor: 'MOVIE', rotulo: 'Filme' },
]

/** "24:00 · 1920x1080 · 23.976 fps · h264 · 1 legenda" -- o que a sonda leu do arquivo. */
function medidasDaSonda(sonda: SondaDoEpisodio): string {
  return [
    formatarTempo(sonda.duracaoSec),
    `${sonda.largura}x${sonda.altura}`,
    `${Number(sonda.fps.toFixed(3))} fps`,
    sonda.codec,
    sonda.hdr ? 'HDR' : null,
    `${sonda.legendas.length} ${sonda.legendas.length === 1 ? 'legenda' : 'legendas'}`,
    sonda.capitulos.length > 0
      ? `${sonda.capitulos.length} ${sonda.capitulos.length === 1 ? 'capitulo' : 'capitulos'}`
      : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ')
}

/** Trocar de episodio: desligado com analise rodando ou marcacoes nao salvas, e o porque no tooltip. */
function TrocarEpisodio() {
  const temJob = useGerar((s) => s.job !== null)
  const mudasMarcacoes = useGerar((s) => s.exclusoesMudaram)
  const recomecar = useGerar((s) => s.recomecar)
  // Com a IA escrevendo, a resposta seguiria gravando no rascunho deste episodio, fora da vista.
  const temIa = useRoteiro((s) => s.geracao !== null)
  // A voz sendo gerada tambem (passo 3).
  const temVoz = useVoz((s) => s.pedido !== null)
  return (
    <Botao
      pequeno
      onClick={recomecar}
      disabled={temJob || mudasMarcacoes || temIa || temVoz}
      title={
        temJob
          ? 'Cancele a analise antes de trocar de episodio'
          : temIa
            ? 'Cancele a IA antes de trocar de episodio'
            : temVoz
              ? 'Cancele a voz antes de trocar de episodio'
              : mudasMarcacoes
              ? 'Salve ou desfaca as marcacoes de OP/ED antes'
              : 'Escolher outro episodio'
      }
    >
      <RotateCcw size={12} strokeWidth={1.5} />
      Trocar episodio
    </Botao>
  )
}

/**
 * (b) O CARTAO DO ARQUIVO: o que e o arquivo (nome, duracao, resolucao) e o
 * que o Studio acha que ele e (anime, temporada, episodio), com a legenda que
 * vai ser lida.
 *
 * So na escolha ele aparece inteiro, com os campos: o palpite da nome a pasta
 * das cenas, e depois de a analise comecar trocar o nome seria mentir sobre
 * onde elas estao. Dai em diante ele encolhe a UMA linha (CartaoCompacto) --
 * inteiro e desligado, ocupava metade da tela e empurrava a regua de OP/ED,
 * que e o que pede acao, para baixo da dobra.
 */
export function CartaoDoEpisodio() {
  const fase = useGerar((s) => s.fase)
  const arquivo = useGerar((s) => s.arquivo)
  const sonda = useGerar((s) => s.sonda)
  const palpite = useGerar((s) => s.palpite)
  const palpiteDaBusca = useGerar((s) => s.palpiteDaBusca)
  const procurando = useGerar((s) => s.procurando)
  const editarPalpite = useGerar((s) => s.editarPalpite)
  const procurarDeNovo = useGerar((s) => s.procurarDeNovo)

  if (!arquivo) return null
  if (fase === 'analisando' || fase === 'indexando' || fase === 'pronto') return <CartaoCompacto />
  const nome = arquivo.split(/[\\/]/).pop() ?? arquivo

  const chaveAtual = palpite
    ? `${palpite.anime.trim().toLowerCase()}|${palpite.temporada}|${palpite.episodio}|${palpite.kind}`
    : null
  const palpiteMudou = fase === 'escolha' && !procurando && palpiteDaBusca !== null && chaveAtual !== palpiteDaBusca

  return (
    <Secao
      titulo="Episodio"
      acao={
        <div className="flex items-center gap-1.5">
          <AbrirPasta caminho={arquivo} title="Mostrar o video no Explorer" />
          <TrocarEpisodio />
        </div>
      }
    >
      <div className="min-w-0">
        <p className="select-text truncate text-[14px] font-medium text-ink" title={arquivo}>
          {nome}
        </p>
        {sonda ? (
          <p className="tnum mt-0.5 text-[11px] text-ink-3">{medidasDaSonda(sonda)}</p>
        ) : (
          <p className="mt-1 flex items-center gap-2 text-[11px] text-ink-2">
            <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
            Lendo o arquivo...
          </p>
        )}
      </div>

      {sonda && palpite && (
        <>
          {/* items-start: com items-end, o rotulo do campo mais baixo descia. */}
          <div className="grid grid-cols-[minmax(0,1fr)_88px_88px_160px] items-start gap-2">
            <Field label="Anime">
              <input
                type="text"
                value={palpite.anime}
                onChange={(e) => editarPalpite({ anime: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && palpiteMudou) void procurarDeNovo()
                  if (e.key === 'Escape') e.currentTarget.blur()
                }}
                placeholder="Nome do anime"
                spellCheck={false}
                className={`${CLASSE_DO_CAMPO} ${CAMPO_NORMAL} w-full`}
              />
            </Field>
            <Field label="Temporada">
              <CampoInteiro valor={palpite.temporada} onChange={(n) => editarPalpite({ temporada: n })} />
            </Field>
            <Field label={palpite.kind === 'MOVIE' ? 'Ano' : palpite.kind ? 'Numero' : 'Episodio'}>
              <CampoInteiro valor={palpite.episodio} onChange={(n) => editarPalpite({ episodio: n })} />
            </Field>
            <Field label="Tipo">
              <select
                value={palpite.kind}
                onChange={(e) => editarPalpite({ kind: e.target.value as KindDoEpisodio })}
                className={`${CLASSE_DO_CAMPO} ${CAMPO_NORMAL} w-full`}
              >
                {TIPOS.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.rotulo}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex min-h-7 items-center gap-2">
            <p className="min-w-0 flex-1 text-[11px] text-ink-3">Lido do nome do arquivo. Confira.</p>
            {palpiteMudou && (
              <Botao pequeno onClick={() => void procurarDeNovo()} title="Procurar de novo com o nome corrigido (Enter)">
                <Search size={12} strokeWidth={1.5} />
                Procurar de novo
              </Botao>
            )}
          </div>

          <Field label="Legenda">
            <SeletorDeLegenda />
          </Field>
        </>
      )}
    </Secao>
  )
}

/**
 * O cartao encolhido, da analise em diante: o que o episodio e numa linha, o
 * arquivo embaixo, e as duas acoes de sempre no canto. A legenda, que ainda da
 * para trocar depois de pronto, mora no resumo (ResumoDoEpisodio).
 */
function CartaoCompacto() {
  const arquivo = useGerar((s) => s.arquivo)
  const sonda = useGerar((s) => s.sonda)
  const palpite = useGerar((s) => s.palpite)
  if (!arquivo) return null
  const nome = arquivo.split(/[\\/]/).pop() ?? arquivo

  return (
    <section className="enter flex min-w-0 items-center gap-3 rounded-md border border-line bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="select-text truncate text-[14px] font-medium text-ink">
          {palpite
            ? `${palpite.anime.trim() || 'Sem nome'} · ${slugDoEpisodio(palpite.temporada, palpite.episodio, palpite.kind)}`
            : nome}
        </p>
        <p className="tnum mt-0.5 select-text truncate text-[11px] text-ink-3" title={arquivo}>
          {sonda ? `${nome} · ${medidasDaSonda(sonda)}` : nome}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <AbrirPasta caminho={arquivo} title="Mostrar o video no Explorer" />
        <TrocarEpisodio />
      </div>
    </section>
  )
}

/**
 * A faixa de legenda que vai ser lida. Na escolha, so escolhe; no episodio
 * pronto, trocar a faixa oferece "Ler essa legenda", que refaz as falas sobre
 * as mesmas cenas (nao corta nada de novo).
 */
export function SeletorDeLegenda() {
  const fase = useGerar((s) => s.fase)
  const sonda = useGerar((s) => s.sonda)
  const indice = useGerar((s) => s.indice)
  const faixaLegenda = useGerar((s) => s.faixaLegenda)
  const mudasMarcacoes = useGerar((s) => s.exclusoesMudaram)
  const escolherFaixa = useGerar((s) => s.escolherFaixa)
  const reindexar = useGerar((s) => s.reindexar)

  if (!sonda) return null
  // Pronto com outra faixa escolhida: oferece reler a legenda sobre as mesmas cenas.
  const faixaMudou = fase === 'pronto' && indice !== null && (indice.faixaLegenda?.index ?? null) !== faixaLegenda

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <select
          value={faixaLegenda === null ? '' : String(faixaLegenda)}
          disabled={fase === 'analisando' || fase === 'indexando'}
          onChange={(e) => escolherFaixa(e.target.value === '' ? null : Number(e.target.value))}
          aria-label="Legenda"
          className={`${CLASSE_DO_CAMPO} ${CAMPO_NORMAL} min-w-0 flex-1`}
        >
          {sonda.legendas.map((f) => (
            <option key={f.index} value={String(f.index)} disabled={!legendaTemTexto(f)}>
              {rotuloDaFaixa(f)}
              {f.index === sonda.legendaSugerida ? '  (sugerida)' : ''}
            </option>
          ))}
          <option value="">Sem legenda</option>
        </select>
        {faixaMudou && (
          <Botao
            onClick={() => void reindexar()}
            disabled={mudasMarcacoes}
            title={
              mudasMarcacoes
                ? 'Salve ou desfaca as marcacoes de OP/ED antes'
                : 'Le a legenda escolhida e refaz as falas de cada cena. Nao corta nada de novo.'
            }
          >
            <RefreshCw size={13} strokeWidth={1.5} />
            Ler essa legenda
          </Botao>
        )}
      </div>
      {sonda.legendas.length === 0 && (
        <p className="text-[11px] text-ink-3">Sem legenda embutida: as cenas ficam sem falas.</p>
      )}
    </div>
  )
}

/**
 * Numero inteiro sem a briga do input controlado: da para apagar e digitar de
 * novo. Grava enquanto e um numero valido; ao sair, volta ao ultimo valido.
 */
function CampoInteiro({
  valor,
  onChange,
  disabled,
}: {
  valor: number
  onChange: (n: number) => void
  disabled?: boolean
}) {
  const [texto, setTexto] = useState(String(valor))
  useEffect(() => setTexto(String(valor)), [valor])
  return (
    <input
      type="text"
      inputMode="numeric"
      value={texto}
      disabled={disabled}
      onChange={(e) => {
        const limpo = e.target.value.replace(/\D/g, '').slice(0, 4)
        setTexto(limpo)
        if (limpo !== '') onChange(Number(limpo))
      }}
      onBlur={() => setTexto(String(valor))}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur()
      }}
      className={`${CLASSE_DO_CAMPO} ${CAMPO_NORMAL} tnum w-full`}
    />
  )
}
