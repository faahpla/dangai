import { useEffect, useMemo, useState } from 'react'
import { Check, Plus, Save, Subtitles, Trash2, Undo2, Users } from 'lucide-react'
import {
  ROTULO_DA_ORIGEM,
  ROTULO_DO_MOTIVO,
  resumirIndice,
  temPlanos,
  type Exclusao,
  type MotivoDaExclusao,
  type ResumoDoIndice,
} from '../../shared/episodio'
import { nomeNatural } from '@shared/nomes'
import { nomesDeUmaArte, ORIGEM_DO_BATISMO, podeReconhecerNaMao } from '../../shared/descoberta'
import { TRECHO_MINIMO, useGerar } from '../store/gerar'
import { useDescoberta } from '../store/gerar-descoberta'
import { SecaoDoCorte } from './AndamentoDoCorte'
import { BotaoReconhecerNaMao, LinhaDaDescoberta, LinkRevisarPersonagens, useDescobertaViva } from './EntradaDaDescoberta'
import { SeletorDeLegenda } from './CartaoDoEpisodio'
import { LISTRADO, ReguaDoEpisodio } from './ReguaDoEpisodio'
import {
  AbrirPasta,
  Aviso,
  Botao,
  CAMPO_NORMAL,
  CAMPO_PEQUENO,
  CampoDeTempo,
  CLASSE_DO_CAMPO,
  Contagem,
  COR_DE_AVISO,
  duracaoCurta,
  formatarTempo,
  listaCurta,
  Secao,
  Subtitulo,
} from './pecas'

/** Quantos personagens cabem em chips antes do "+N". */
const PERSONAGENS_VISIVEIS = 24

/**
 * Os avisos do indice que falam da legenda ("Legenda .srt nao diz quem fala").
 * O resumo ja diz isso no cartao de Falas: repetido aqui, o mesmo fato
 * aparecia tres vezes na tela.
 */
function avisoDaLegenda(aviso: string): boolean {
  return /^(Legenda |Sem legenda|A legenda )/.test(aviso)
}

/**
 * (e) O EPISODIO PRONTO: o que o indice sabe (cenas, falas, quem fala, quem
 * aparece) e a regua de OP/ED para confirmar.
 *
 * O resumo vem de resumirIndice (shared), o mesmo que qualquer outra tela vai
 * usar -- o numero que aparece aqui e o numero que o roteiro vai enxergar. So
 * os NOMES mudam na tela: no formato natural ("Senku Ishigami", e nao o
 * "Ishigami, Senkuu" do MyAnimeList), com a grafia da legenda (nomeNatural).
 */
export function ResumoDoEpisodio() {
  const fase = useGerar((s) => s.fase)
  const indice = useGerar((s) => s.indice)
  const ultimaAnalise = useGerar((s) => s.ultimaAnalise)
  const fotosDoElenco = useGerar((s) => s.fotosDoElenco)
  const corte = useGerar((s) => s.corte)
  // Reconhecer na mao deste episodio: rodando, ou o resultado ainda na tela.
  const descobrindo = useDescobertaViva()
  const comResultado = useDescoberta((s) => s.resultado !== null && s.episodioId === indice?.id)

  const resumo = useMemo(() => (indice ? resumirIndice(indice) : null), [indice])
  const personagens = useMemo(() => {
    if (!resumo) return []
    const falantes = resumo.falantes.map((f) => f.nome)
    // Duas grafias que viram o mesmo nome natural contam como uma: fica a maior contagem.
    const porNome = new Map<string, number>()
    for (const p of resumo.personagens) {
      const nome = nomeNatural(p.nome, falantes)
      porNome.set(nome, Math.max(porNome.get(nome) ?? 0, p.cenas))
    }
    return [...porNome.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n)
  }, [resumo])
  // Reconhecidos com uma arte so (arte-unica.ts), no nome natural dos chips.
  const umaArte = useMemo(() => {
    const nomes = nomesDeUmaArte(fotosDoElenco)
    if (!nomes || !resumo) return null
    const falantes = resumo.falantes.map((f) => f.nome)
    return [...new Set(nomes.map((n) => nomeNatural(n, falantes)))]
  }, [fotosDoElenco, resumo])

  if (fase !== 'pronto' || !indice || !resumo) return null

  const avisos = indice.avisos.filter((a) => !avisoDaLegenda(a))
  const personagensSobram = personagens.length - PERSONAGENS_VISIVEIS

  const podeReconhecer = indice.reconhecimento === 'pulado' && indice.biblioteca.origem === 'studio'
  // Indice so com as falas: as cenas estao sendo cortadas por tras (SecaoDoCorte).
  const comCenas = temPlanos(indice)
  // Sem cenas, a porta do Reconhecer na mao e o "Corte parou" (SecaoDoCorte); aqui, so com cenas.
  const naMao = comCenas && (podeReconhecerNaMao(indice, corte).pode || descobrindo || comResultado)

  return (
    <>
      <Secao
        titulo={comCenas ? 'Episodio pronto' : 'Falas prontas'}
        acao={
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-ink-3">
              <span title="De onde vem as cenas">{ROTULO_DA_ORIGEM[indice.biblioteca.origem]}</span>
              {ultimaAnalise && (
                <span
                  className="tnum"
                  title={
                    ultimaAnalise.rodadas > 1
                      ? `Tempo do motor neste episodio, somando ${ultimaAnalise.rodadas} rodadas`
                      : 'Tempo do motor neste episodio'
                  }
                >
                  {' '}
                  · {duracaoCurta(ultimaAnalise.segundos)}
                </span>
              )}
            </span>
            {/* Sem cenas ainda, a pasta do indice so tem o episodio.json: nada a ver no Explorer. */}
            {comCenas && (
              <AbrirPasta
                caminho={indice.biblioteca.pasta}
                title={
                  indice.biblioteca.origem === 'studio'
                    ? 'Mostrar as cenas no Explorer'
                    : 'Mostrar as cenas no Explorer (so leitura: o recap nao mexe nela)'
                }
              />
            )}
          </div>
        }
      >
        <Numeros resumo={resumo} />

        {(personagens.length > 0 || podeReconhecer || naMao) && (
          <div className="flex flex-col gap-2">
            <Subtitulo
              icone={<Users size={12} strokeWidth={1.5} />}
              canto={
                <span className="flex items-center gap-3">
                  {fotosDoElenco === ORIGEM_DO_BATISMO ? (
                    // Reconhecido com as fotos do batismo de outro episodio: no E02 do Nia Liston
                    // os de poucas fotos erraram muito. Pede para conferir (o link ao lado refaz).
                    <span
                      className={`text-[11px] ${COR_DE_AVISO}`}
                      title="Algum personagem so foi reconhecido com as fotos do Reconhecer na mao de outro episodio. Confira os personagens; se errou, Revisar personagens corrige."
                    >
                      Confira: fotos do Reconhecer na mao
                    </span>
                  ) : umaArte ? (
                    // O retrato do MAL e o da AniList eram a mesma arte: passou do minimo com uma
                    // foto so, e no E02 do Nia Liston o Anzel errou 7 de 13 cenas.
                    <span
                      className={`text-[11px] ${COR_DE_AVISO}`}
                      title={`${umaArte.join(', ')}: reconhecidos com uma imagem so do elenco (a mesma arte em dois recortes). Costuma confundir com figurantes parecidos. Confira as cenas deles; se errou, Revisar personagens corrige.`}
                    >
                      {umaArte.length <= 2
                        ? `Confira: ${umaArte.join(' e ')} (uma foto so)`
                        : `Confira: ${umaArte.length} personagens com uma foto so`}
                    </span>
                  ) : (
                    fotosDoElenco && (
                      <span
                        className="text-[11px] text-ink-3"
                        title={`As fotos do elenco que reconheceram os personagens vieram do ${fotosDoElenco} (copiadas; a pasta de la nao muda).`}
                      >
                        Fotos do elenco: {fotosDoElenco}
                      </span>
                    )
                  )}
                  {comCenas && !descobrindo && <LinkRevisarPersonagens />}
                </span>
              }
            >
              Personagens
            </Subtitulo>
            {personagens.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {personagens.slice(0, PERSONAGENS_VISIVEIS).map((p) => (
                  <Contagem
                    key={p.nome}
                    nome={p.nome}
                    n={p.n}
                    unidade={['cena', 'cenas']}
                    aviso={umaArte?.includes(p.nome) ? 'Uma foto so do elenco: confira as cenas' : undefined}
                  />
                ))}
                {personagensSobram > 0 && (
                  <span className="px-1 py-1 text-[11px] text-ink-3">e mais {personagensSobram}</span>
                )}
              </div>
            ) : descobrindo ? null : (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {podeReconhecer && <ReconhecerAgora />}
                {comCenas && <BotaoReconhecerNaMao />}
              </div>
            )}
            {comCenas && <LinhaDaDescoberta />}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Subtitulo icone={<Subtitles size={12} strokeWidth={1.5} />}>Legenda</Subtitulo>
          <SeletorDeLegenda />
          {resumo.falantes.length > 0 && (
            <p className="text-[11px] text-ink-3">
              Quem mais fala:{' '}
              {listaCurta(
                resumo.falantes.map((f) => ({ nome: f.nome, n: f.falas })),
                5,
              )}
            </p>
          )}
        </div>

        {avisos.length > 0 && (
          <div className="flex flex-col gap-1">
            {avisos.map((aviso, i) => (
              <Aviso key={i}>{aviso}</Aviso>
            ))}
          </div>
        )}
      </Secao>

      <SecaoDoCorte />

      <AberturaEEncerramento />
    </>
  )
}

/**
 * Depois de um "so cortar": roda a analise completa sobre o mesmo episodio. O
 * motor reaproveita os cortes (vem do cache), entao o custo e o elenco e o
 * reconhecimento. As marcacoes CONFIRMADAS da regua passam para o indice novo.
 *
 * O nome do anime fica editavel AQUI, ao lado do botao: e ele que o motor usa
 * para achar o elenco, e quando a busca falha ("nao achei no AniList/MAL") o
 * jeito e corrigir e tentar de novo. A pasta das cenas nao muda (o store manda
 * a pasta do anime junto, ver `analisar`).
 *
 * Neutro: o rosa da tela e o "Proximo: Roteiro" do rodape (ou o Salvar, com
 * marcacao por salvar). Reconhecer e opcional; o roteiro e o caminho. Com
 * mudancas, ele desliga.
 */
function ReconhecerAgora() {
  const analisar = useGerar((s) => s.analisar)
  const mudaram = useGerar((s) => s.exclusoesMudaram)
  const motor = useGerar((s) => s.motor)
  const anime = useGerar((s) => s.palpite?.anime ?? '')
  const editarPalpite = useGerar((s) => s.editarPalpite)
  const pronto = motor?.studio.pronto === true
  const semAnime = !anime.trim()
  const reconhecer = (): void => {
    if (!mudaram && pronto && !semAnime) void analisar('studio', true)
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <input
        type="text"
        value={anime}
        onChange={(e) => editarPalpite({ anime: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') reconhecer()
          if (e.key === 'Escape') e.currentTarget.blur()
        }}
        aria-label="Anime"
        title="O nome usado para achar o elenco no AniList e no MyAnimeList. A pasta das cenas nao muda."
        placeholder="Nome do anime"
        spellCheck={false}
        className={`${CLASSE_DO_CAMPO} ${CAMPO_NORMAL} w-[260px]`}
      />
      <Botao
        onClick={reconhecer}
        disabled={mudaram || !pronto || semAnime}
        title={
          mudaram
            ? 'Salve ou desfaca as marcacoes de OP/ED antes'
            : !pronto
              ? (motor?.studio.erro ?? 'O motor nao esta pronto')
              : semAnime
                ? 'Falta o nome do anime'
                : 'Busca o elenco e reconhece os personagens nas cenas que ja estao cortadas'
        }
      >
        <Users size={13} strokeWidth={1.5} />
        Reconhecer agora
      </Botao>
    </div>
  )
}

/** Os quatro numeros do episodio, em cartoes. "Fora do recap" segue a regua, salva ou nao. */
function Numeros({ resumo }: { resumo: ResumoDoIndice }) {
  const indice = useGerar((s) => s.indice)
  const exclusoes = useGerar((s) => s.exclusoes)
  const corte = useGerar((s) => s.corte)
  if (!indice) return null

  const fora = exclusoes.reduce((s, e) => s + Math.max(0, e.end - e.start), 0)
  const pendentes = exclusoes.filter((e) => !e.confirmada).length
  const faixa = indice.faixaLegenda
  const srt = faixa !== null && /^(subrip|srt)$/i.test(faixa.codec)
  // Sem cenas ainda: o cartao diz em que pe esta o corte, e nao "0 cenas".
  const esperando = !temPlanos(indice)
  const cortando = esperando && corte?.status === 'cortando'

  return (
    <div className="grid grid-cols-4 gap-2">
      {esperando ? (
        <Numero
          titulo="Cenas"
          valor={cortando && corte.progresso !== null ? `${Math.round(corte.progresso * 100)}%` : '-'}
          detalhe={
            cortando ? 'cortando' : corte?.status === 'falhou' ? 'corte parou' : corte?.mensagem === 'Na fila' ? 'na fila' : 'por cortar'
          }
        />
      ) : (
        <Numero titulo="Cenas" valor={resumo.totalCenas.toLocaleString('pt-BR')} detalhe={`${resumo.cenasComFala} com fala`} />
      )}
      <Numero
        titulo="Falas"
        valor={resumo.totalFalas.toLocaleString('pt-BR')}
        detalhe={
          !faixa
            ? 'sem legenda'
            : resumo.falantes.length > 0
              ? `${resumo.falantes.length} ${resumo.falantes.length === 1 ? 'falante' : 'falantes'}`
              : resumo.totalFalas > 0
                ? `sem nome de quem fala${srt ? ' (.srt)' : ''}`
                : 'so placas ou musica'
        }
      />
      <Numero
        titulo="Personagens"
        valor={esperando ? '-' : String(resumo.personagens.length)}
        detalhe={
          esperando
            ? corte && !corte.reconhecer
              ? 'sem reconhecer'
              : 'com as cenas'
            : indice.reconhecimento === 'pulado'
              ? 'so corte'
              : indice.reconhecimento === 'desconhecido'
                ? 'sem informacao'
                : resumo.personagens.length > 0
                  ? 'pelo rosto'
                  : 'ninguem reconhecido'
        }
      />
      <Numero
        titulo="Fora do recap"
        valor={formatarTempo(fora)}
        detalhe={exclusoes.length === 0 ? 'nada marcado' : pendentes > 0 ? `${pendentes} a confirmar` : 'tudo confirmado'}
        alerta={pendentes > 0}
      />
    </div>
  )
}

function Numero({
  titulo,
  valor,
  detalhe,
  alerta = false,
}: {
  titulo: string
  valor: string
  detalhe: string
  alerta?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-sm border border-line bg-elevated px-3 py-2">
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-3">{titulo}</span>
      <span className="tnum text-[20px] font-semibold leading-tight text-ink">{valor}</span>
      <span className={['truncate text-[11px]', alerta ? 'text-ink-2' : 'text-ink-3'].join(' ')} title={detalhe}>
        {detalhe}
      </span>
    </div>
  )
}

/**
 * A REGUA DE OP/ED com a lista dos trechos. O Studio sugere (tracejado), o
 * usuario confirma (cheio), remove, ajusta ou marca outro trecho. Nada vai para
 * o disco ate "Salvar": o indice so muda quando ele decide.
 *
 * Uma acao principal: o Salvar, rosa so quando ha o que salvar. O Confirmar de
 * cada linha e neutro -- duas sugestoes eram dois botoes rosa e mais o Salvar.
 */
function AberturaEEncerramento() {
  const indice = useGerar((s) => s.indice)
  const sonda = useGerar((s) => s.sonda)
  const exclusoes = useGerar((s) => s.exclusoes)
  const mudaram = useGerar((s) => s.exclusoesMudaram)
  const salvando = useGerar((s) => s.salvando)
  const salvoEm = useGerar((s) => s.salvoEm)
  const confirmar = useGerar((s) => s.confirmarExclusao)
  const confirmarTodas = useGerar((s) => s.confirmarTodas)
  const remover = useGerar((s) => s.removerExclusao)
  const ajustar = useGerar((s) => s.ajustarExclusao)
  const marcarTrecho = useGerar((s) => s.marcarTrecho)
  const descartar = useGerar((s) => s.descartarMudancas)
  const salvar = useGerar((s) => s.salvarExclusoes)
  const [selecionada, setSelecionada] = useState<number | null>(null)

  const falas = useMemo(
    () => (indice?.cues ?? []).filter((c) => c.tipo === 'fala').map((c) => ({ start: c.start, end: c.end })),
    [indice],
  )
  // Inicio de cada cena e o fim da ultima: os pontos onde a borda gruda.
  const cortes = useMemo(() => {
    const planos = indice?.planos ?? []
    const pontos = new Set<number>()
    for (const p of planos) pontos.add(Math.round(p.start * 1000) / 1000)
    const ultimo = planos[planos.length - 1]
    if (ultimo) pontos.add(Math.round(ultimo.end * 1000) / 1000)
    return [...pontos].sort((a, b) => a - b)
  }, [indice])

  // Trecho removido (ou lista trocada): a escolha que apontava para ele some.
  useEffect(() => {
    if (selecionada !== null && selecionada >= exclusoes.length) setSelecionada(null)
  }, [exclusoes.length, selecionada])

  if (!indice) return null
  const duracao = indice.fonte.duracaoSec
  const pendentes = exclusoes.filter((e) => !e.confirmada).length

  const marcarManual = (): void => {
    const largura = Math.min(30, duracao)
    const depoisDe = selecionada !== null ? exclusoes[selecionada]?.end : undefined
    const base = depoisDe !== undefined ? depoisDe + 5 : duracao / 2 - largura / 2
    const start = Math.min(Math.max(0, base), Math.max(0, duracao - largura))
    setSelecionada(marcarTrecho(start, start + largura))
  }

  // Quem cai em cima de quem: a linha avisa, em vez de um trecho sumir debaixo do outro.
  const sobrepoe = exclusoes.map((ex, i) => {
    const outro = exclusoes.find((o, j) => j !== i && o.start < ex.end && ex.start < o.end)
    return outro ? ROTULO_DO_MOTIVO[outro.motivo] : null
  })

  return (
    <Secao
      titulo="Abertura e encerramento"
      acao={
        <span className="text-[11px] text-ink-3">
          {mudaram ? 'Mudancas nao salvas' : salvoEm ? 'Salvo' : pendentes > 0 ? `${pendentes} para confirmar` : ''}
        </span>
      }
    >
      <p className="text-[11px] text-ink-3">Marcado = fora do recap.</p>

      <ReguaDoEpisodio
        duracao={duracao}
        exclusoes={exclusoes}
        selecionada={selecionada}
        onSelecionar={setSelecionada}
        onAjustar={ajustar}
        onMarcar={marcarTrecho}
        falas={falas}
        cortes={cortes}
        capitulos={sonda?.capitulos ?? []}
      />
      <Legenda />

      {exclusoes.length === 0 ? (
        <p className="text-[12px] text-ink-2">Nada sugerido. Arraste na regua para marcar.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {exclusoes.map((ex, i) => (
            <LinhaDaExclusao
              key={i}
              ex={ex}
              duracao={duracao}
              sobrepoe={sobrepoe[i] ?? null}
              escolhida={i === selecionada}
              onEscolher={() => setSelecionada(i)}
              onConfirmar={() => confirmar(i)}
              onRemover={() => {
                remover(i)
                setSelecionada(null)
              }}
              onAjustar={(patch) => ajustar(i, patch)}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Botao pequeno onClick={marcarManual} title="Acrescenta um trecho de 30 s para ajustar (ou arraste na regua)">
          <Plus size={12} strokeWidth={1.75} />
          Marcar trecho
        </Botao>
        {pendentes > 1 && (
          <Botao pequeno onClick={confirmarTodas}>
            <Check size={12} strokeWidth={1.75} />
            Confirmar todas ({pendentes})
          </Botao>
        )}
        <span className="flex-1" />
        {mudaram && (
          <Botao onClick={descartar} disabled={salvando} title="Volta as marcacoes ao que esta salvo">
            <Undo2 size={13} strokeWidth={1.5} />
            Desfazer
          </Botao>
        )}
        <Botao
          principal
          onClick={() => void salvar()}
          disabled={!mudaram || salvando}
          title={mudaram ? 'Grava as marcacoes no episodio' : 'Nada para salvar'}
        >
          <Save size={13} strokeWidth={1.5} />
          {salvando ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </Secao>
  )
}

/** A legenda da regua, em uma linha. */
function Legenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-3">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[3px] border border-dashed border-accent" style={{ backgroundImage: LISTRADO }} />
        Sugerida
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[3px] border border-accent bg-accent/30" />
        Confirmada
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-4 rounded-[2px] bg-ink-2/60" />
        Fala
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-px bg-white/30" />
        Corte de cena
      </span>
    </div>
  )
}

const MOTIVOS = Object.entries(ROTULO_DO_MOTIVO) as [MotivoDaExclusao, string][]

/** Uma fonte que concorda com a sugestao ("1m49s sem fala") -> duas palavras. */
function apoioCurto(apoio: string): string | null {
  if (/sem fala/i.test(apoio)) return 'sem fala'
  if (/musica/i.test(apoio)) return 'musica'
  if (/corte cenas/i.test(apoio)) return 'Corte Cenas'
  const serie = /confirmado no (\S+)/i.exec(apoio)
  if (serie) return `como no ${serie[1]}`
  if (/capitulo/i.test(apoio)) return 'capitulo'
  return null
}

/**
 * O "porque" da sugestao em poucas palavras: "Capitulo Intro, sem fala", "Sem
 * fala no comeco". O porque inteiro (shared/oped.ts) repete os tempos que ja
 * estao nos campos e saia cortado com reticencias: ele vai no tooltip.
 */
export function porqueCurto(ex: Exclusao): string {
  const [principal = '', apoios = ''] = ex.porque.split('; bate com: ')
  if (ex.origem === 'usuario') return principal ? 'Ajustado por voce' : 'Marcado por voce'
  let curto: string
  switch (ex.origem) {
    case 'capitulo': {
      const m = /Capitulo "([^"]*)"/.exec(principal)
      curto = m?.[1] ? `Capitulo ${m[1]}` : 'Capitulo do arquivo'
      break
    }
    case 'estilo':
      curto = 'Letra de musica'
      break
    case 'vao':
      curto = /fim/.test(principal) ? 'Sem fala no fim' : 'Sem fala no comeco'
      break
    case 'skip_ranges':
      curto = 'Pulo do Corte Cenas'
      break
    case 'serie': {
      const m = /confirmado no (\S+)/.exec(principal)
      curto = m ? `Como no ${m[1]}` : 'Como na serie'
      break
    }
    case 'audio':
      curto = 'Audio da abertura'
      break
    default:
      curto = principal
  }
  const extras = [...new Set(apoios.split(', ').map(apoioCurto))].filter((x): x is string => x !== null)
  return [curto, ...extras.slice(0, 2)].join(', ')
}

/** Uma linha da lista: motivo, inicio e fim em m:ss, por que, e confirmar/remover. */
function LinhaDaExclusao({
  ex,
  duracao,
  sobrepoe,
  escolhida,
  onEscolher,
  onConfirmar,
  onRemover,
  onAjustar,
}: {
  ex: Exclusao
  duracao: number
  /** O motivo do outro trecho que cai em cima deste, ou null. */
  sobrepoe: string | null
  escolhida: boolean
  onEscolher: () => void
  onConfirmar: () => void
  onRemover: () => void
  onAjustar: (patch: Partial<Pick<Exclusao, 'start' | 'end' | 'motivo'>>) => void
}) {
  /*
   * Inicio e fim fora de ordem sao RECUSADOS, com o porque no campo. Antes o
   * normalizar aceitava calado: fim antes do inicio virava um trecho de 1 s, e
   * inicio depois do fim do episodio jogava a OP para cima do ED.
   */
  const novoInicio = (start: number): string | null => {
    if (start >= duracao) return 'O inicio passa do fim do episodio'
    if (start > ex.end - TRECHO_MINIMO) return 'O inicio tem que vir antes do fim'
    onAjustar({ start })
    return null
  }
  const novoFim = (end: number): string | null => {
    if (end < ex.start + TRECHO_MINIMO) return 'O fim tem que vir depois do inicio'
    // Depois do fim do episodio vale como "ate o fim".
    onAjustar({ end: Math.min(end, duracao) })
    return null
  }

  return (
    <li
      onPointerDown={onEscolher}
      className={[
        'flex min-w-0 items-center gap-2 rounded-sm border px-2 py-1.5 transition-colors',
        escolhida ? 'border-accent bg-accent-dim' : 'border-line bg-elevated',
      ].join(' ')}
    >
      <span
        className={[
          'h-3 w-3 shrink-0 rounded-[3px] border border-accent',
          ex.confirmada ? 'bg-accent/40' : 'border-dashed',
        ].join(' ')}
        style={ex.confirmada ? undefined : { backgroundImage: LISTRADO }}
        aria-hidden
      />
      <select
        value={ex.motivo}
        onChange={(e) => onAjustar({ motivo: e.target.value as MotivoDaExclusao })}
        aria-label="Motivo"
        className={`${CLASSE_DO_CAMPO} ${CAMPO_PEQUENO} w-[136px] shrink-0`}
      >
        {MOTIVOS.map(([valor, rotulo]) => (
          <option key={valor} value={valor}>
            {rotulo}
          </option>
        ))}
      </select>
      <CampoDeTempo valor={ex.start} rotulo="Inicio" onChange={novoInicio} />
      <span className="text-[11px] text-ink-3">ate</span>
      <CampoDeTempo valor={ex.end} rotulo="Fim" onChange={novoFim} />
      <span className="tnum w-[52px] shrink-0 text-[11px] text-ink-3">{duracaoCurta(ex.end - ex.start)}</span>
      {sobrepoe ? (
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2" title={ex.porque || undefined}>
          Sobrepoe: {sobrepoe}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3" title={ex.porque || undefined}>
          {porqueCurto(ex)}
        </span>
      )}
      {ex.confirmada ? (
        <span className="flex h-7 shrink-0 items-center gap-1 text-[11px] text-ink-2">
          <Check size={12} strokeWidth={2} className="text-accent" />
          Confirmada
        </span>
      ) : (
        <Botao pequeno onClick={onConfirmar} title="Fica fora do recap">
          <Check size={12} strokeWidth={1.75} />
          Confirmar
        </Botao>
      )}
      <button
        type="button"
        onClick={onRemover}
        aria-label="Remover o trecho"
        title="Remover (o trecho volta para o recap)"
        className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-danger"
      >
        <Trash2 size={13} strokeWidth={1.5} />
      </button>
    </li>
  )
}
