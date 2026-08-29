import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Tags,
  X,
} from 'lucide-react'
import type { LibraryClip } from '@shared/channels'
import { seriesDoRoteiro, sugerirParaBloco } from '@shared/suggest'
import type { SelectionCandidate } from '@shared/selection'
import { TAGS_PT } from '@shared/tags-pt'
import { useProject } from '@/store/project'
import { ScriptColumn } from '@/components/ScriptColumn'
import { Nicknames } from './Nicknames'

/**
 * Busca na biblioteca de cenas que o AnCut HUB ja cortou.
 *
 * Resolve a dor declarada -- "encontrar material manualmente e extremamente
 * demorado" -- sem tocar em nada do que ja funciona: aqui so se ESCOLHE o
 * material. Quando ele sai daqui vira caminho de arquivo e entra pela mesma
 * porta do arraste, com a mesma analise e o mesmo render.
 *
 * Nao existe modelo, download nem GPU nesta tela. Tudo que ela mostra ja estava
 * no disco do usuario antes de o Dangai abrir.
 */

/** Largura alvo de cada miniatura. Define quantas colunas cabem. */
const ITEM_ALVO = 190
const GAP = 10
/** Altura da faixa de texto embaixo da miniatura. */
const RODAPE = 26
/** Linhas desenhadas fora da vista, de cada lado, para o scroll nao piscar. */
const FOLGA = 3

export function Library() {
  const open = useProject((s) => s.libraryOpen)
  const openLibrary = useProject((s) => s.openLibrary)
  const library = useProject((s) => s.library)
  const busy = useProject((s) => s.libraryBusy)
  /*
   * O trabalho GERAL do app, que e o que acontece ao montar: preparar os clipes
   * roda no main e leva dezenas de segundos. `libraryBusy` e outra coisa -- e a
   * varredura da pasta.
   */
  const trabalhando = useProject((s) => s.busy)
  const error = useProject((s) => s.libraryError)
  const syncLibrary = useProject((s) => s.syncLibrary)
  const addFromLibrary = useProject((s) => s.addFromLibrary)
  const images = useProject((s) => s.images)
  const nicknames = useProject((s) => s.nicknames)
  const audio = useProject((s) => s.audio)
  const blocos = useProject((s) => s.scriptBlocks)
  const activeBlock = useProject((s) => s.activeBlock)
  const setActiveBlock = useProject((s) => s.setActiveBlock)
  const blockClips = useProject((s) => s.blockClips)
  const toggleBlockClip = useProject((s) => s.toggleBlockClip)
  const favorites = useProject((s) => s.favorites)
  const toggleFavorite = useProject((s) => s.toggleFavorite)
  const tags = useProject((s) => s.tags)
  const replaceTarget = useProject((s) => s.replaceTarget)
  const replaceSceneWith = useProject((s) => s.replaceSceneWith)
  const taggerBusy = useProject((s) => s.taggerBusy)
  const tagLibrary = useProject((s) => s.tagLibrary)
  const descriptions = useProject((s) => s.descriptions)
  const describeBusy = useProject((s) => s.describeBusy)
  const describeLibrary = useProject((s) => s.describeLibrary)
  const applyBlockClips = useProject((s) => s.applyBlockClips)

  /*
   * Com narracao carregada, marcar cena e marcar cena DE UMA FRASE.
   *
   * Nao ha modo escondido: a coluna do roteiro esta ali do lado, a frase aberta
   * esta destacada, e o cartao marcado mostra o numero dela. Sem narracao nada
   * disso existe e a Biblioteca continua exatamente como era.
   */
  const porRoteiro = audio !== null && blocos !== null

  const [texto, setTexto] = useState('')
  const [anime, setAnime] = useState<string | null>(null)
  /*
   * A pre-selecao acontece uma vez POR ROTEIRO, e nunca depois.
   *
   * A trava e o proprio roteiro, e nao um booleano de abertura: com a
   * Biblioteca aberta ele pode largar outra narracao na janela, e uma trava
   * por abertura deixaria o roteiro novo sem pre-selecao nenhuma -- foi o que
   * o teste pegou. Guardando QUAL roteiro ja foi atendido, trocar de roteiro
   * re-arma sozinho.
   *
   * E continua sendo so ponto de partida: clicar em "Todos" ou em outro
   * episodio vale a partir dali, porque o roteiro nao mudou.
   */
  const preSelecionadoPara = useRef<unknown>(null)
  /*
   * Ja avisou que existem trechos vazios?
   *
   * O aviso e um passo, nao uma janela -- a spec dele nao tem modal fora do
   * ⌘K e das configuracoes. Primeiro clique explica o que vai acontecer,
   * segundo clique monta. Trecho vazio nao trava nada: as vezes ele quer
   * mesmo que a cena anterior estique.
   */
  const [avisouVazios, setAvisouVazios] = useState(false)
  /**
   * Episodio escolhido, como "S17E42".
   *
   * Existe porque a biblioteca dele cresce por EPISODIO -- ele corta um no
   * AnCut e vem montar o recap dele aqui. Sem este nivel, chegar nas 300 cenas
   * do episodio da semana era rolar 13 mil.
   */
  const [episodio, setEpisodio] = useState<string | null>(null)
  const [personagem, setPersonagem] = useState<string | null>(null)
  const [minSec, setMinSec] = useState(0)
  const [maxSec, setMaxSec] = useState(0)
  const [escolhidos, setEscolhidos] = useState<string[]>([])
  const [apelidosAbertos, setApelidosAbertos] = useState(false)
  const [soFavoritos, setSoFavoritos] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void openLibrary(false)
        return
      }

      /*
       * Teclado para andar pelo roteiro sem largar o mouse da grade.
       *
       * Sao ~39 trechos por video, e ate agora trocar de trecho era ir ate a
       * coluna da esquerda e voltar. Com as setas a mao do mouse nunca sai da
       * grade. Nada disso vale quando ele esta digitando na busca, ou o "j"
       * de "jaqueta" viraria um pulo de trecho.
       */
      const alvo = event.target as HTMLElement | null
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return
      if (!porRoteiro || !blocos || blocos.length === 0) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const atual = activeBlock ?? 0
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault()
        setActiveBlock(Math.min(atual + 1, blocos.length - 1))
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault()
        setActiveBlock(Math.max(atual - 1, 0))
      } else if (event.key === 'Tab') {
        /*
         * Tab pula para o proximo trecho AINDA VAZIO, dando a volta no fim.
         *
         * E o gesto que fecha o trabalho: no fim da passada ele aperta Tab e,
         * se nada acontecer, e porque nao falta nenhum.
         */
        event.preventDefault()
        const total = blocos.length
        for (let passo = 1; passo <= total; passo++) {
          const i = (atual + passo) % total
          if ((blockClips[i] ?? []).length === 0) {
            setActiveBlock(i)
            break
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openLibrary, porRoteiro, blocos, activeBlock, blockClips, setActiveBlock])

  /*
   * Fechar zera tudo: escolha e filtros.
   *
   * A tela nao desmonta quando fecha -- ela devolve null e o estado sobreviveria
   * junto. Reabrir com o "ichigo" que o usuario digitou meia hora antes esconde
   * o acervo inteiro atras de um filtro que ele nao lembra de ter posto, e a
   * selecao seria pior ainda: cenas entrando no projeto sem ele ter marcado
   * nesta visita.
   */
  useEffect(() => {
    if (open) return
    setEscolhidos([])
    setApelidosAbertos(false)
    setTexto('')
    setAnime(null)
    preSelecionadoPara.current = null
    setAvisouVazios(false)
    setEpisodio(null)
    setPersonagem(null)
    setMinSec(0)
    setMaxSec(0)
    setSoFavoritos(false)
  }, [open])

  /*
   * O contexto que o motor de sugestao precisa, montado uma vez.
   *
   * Sao os mesmos dados que a montagem automatica usa -- personagens da
   * biblioteca, apelidos dele, o que cada cena mostra --, so que aqui servem
   * para ORDENAR, nunca para decidir.
   */
  const contexto = useMemo(() => {
    if (!porRoteiro || !library || !blocos) return null
    return {
      blocks: blocos,
      clips: library.clips,
      characters: library.characters,
      nicknames: Object.values(nicknames).flat(),
      descriptions,
    }
  }, [porRoteiro, library, blocos, nicknames, descriptions])

  /*
   * Abrir ja no anime que o roteiro cita.
   *
   * Só quando a deducao aponta para UMA serie: roteiro que mistura duas -- ou
   * que nao cita ninguem -- nao pre-seleciona nada, porque escolher errado por
   * ele custaria mais do que nao escolher. E acontece uma vez so, entao clicar
   * em "Todos" ou em outro episodio vale a partir dali.
   */
  useEffect(() => {
    if (!open || !contexto || preSelecionadoPara.current === contexto.blocks) return
    preSelecionadoPara.current = contexto.blocks
    const series = seriesDoRoteiro(contexto)
    if (series.length === 1) setAnime(series[0]!)
  }, [open, contexto])

  const favoritosSet = useMemo(() => new Set(favorites), [favorites])

  /*
   * O texto buscavel de cada cena, montado UMA vez por leva de etiquetas.
   *
   * Sao 13 mil cenas com ~13 etiquetas cada, e cada etiqueta traz ate tres
   * termos em portugues: refazer essa juncao a cada tecla digitada seria meio
   * milhao de concatenacoes por letra.
   */
  const buscavel = useMemo(() => {
    const cache = new Map<string, string>()
    return (id: string): string => {
      const pronto = cache.get(id)
      if (pronto !== undefined) return pronto
      const etiquetas = tags[id] ?? []
      /*
       * As etiquetas e o que a cena MOSTRA entram no MESMO campo de busca.
       *
       * Dois campos separados obrigariam ele a saber de antemao se "tristeza"
       * e etiqueta ou emocao -- que e detalhe de implementacao, nao decisao de
       * edicao. Ele digita a palavra e a cena aparece, venha de onde vier.
       */
      const d = descriptions[id]
      const texto = [
        ...etiquetas.flatMap((e) => [e, ...(TAGS_PT[e] ?? [])]),
        ...(d ? [d.emocao, d.acao, d.cenario, d.plano] : []),
      ]
        .join(' ')
        .toLowerCase()
      cache.set(id, texto)
      return texto
    }
  }, [tags, descriptions])

  const filtrados = useMemo(() => {
    if (!library) return []
    const busca = texto.trim().toLowerCase()
    return library.clips.filter((clip) => {
      if (anime && clip.anime !== anime) return false
      if (episodio && chaveEpisodio(clip) !== episodio) return false
      if (soFavoritos && !favoritosSet.has(clip.id)) return false
      if (personagem && !clip.characters.includes(personagem)) return false
      if (minSec > 0 && clip.duration < minSec) return false
      if (maxSec > 0 && clip.duration > maxSec) return false
      if (!busca) return true
      /*
       * A etiqueta entra na busca junto com o resto, em portugues E em ingles.
       *
       * E o que finalmente alcanca as 8.171 cenas sem personagem: ate agora
       * "floresta" nao achava nada porque cenario nao tem nome no shots.json.
       * O modelo so fala ingles, entao cada etiqueta viaja com os termos que
       * ele digitaria -- ver shared/tags-pt.
       */
      return textoDe(clip).includes(busca) || buscavel(clip.id).includes(busca)
    })
  }, [library, texto, anime, episodio, personagem, minSec, maxSec, soFavoritos, favoritosSet, buscavel])

  /*
   * Quantos favoritos existem NO ANIME em uso, e nao no total.
   *
   * Palavras dele: "Tensura tem seus clipes favoritos, Mushoku Tensei os seus,
   * e Bleach os seus. nao e legal ficar misturado". A separacao ja existe de
   * graca -- o anime esta dentro do id da cena --, entao o que faltava era o
   * numero dizer de qual pilha ele esta falando.
   */
  /** Quantas cenas ja tem etiqueta, para o botao dizer o quanto falta. */
  const etiquetadas = Object.keys(tags).length

  /*
   * Quantas cenas DO ANIME ABERTO ja foram lidas.
   *
   * Do anime e nao do acervo porque a leitura e por anime: sao ~4,9s por cena,
   * um episodio leva meia hora e o acervo inteiro passa de 24. Uma porcentagem
   * do total inteiro ficaria em 3% por semanas e nao diria nada a ele.
   */
  const { lidas, doAnime } = useMemo(() => {
    if (!library) return { lidas: 0, doAnime: 0 }
    const alvo = anime ? library.clips.filter((c) => c.anime === anime) : library.clips
    return { lidas: alvo.filter((c) => descriptions[c.id]).length, doAnime: alvo.length }
  }, [library, anime, descriptions])

  const totalFavoritos = useMemo(() => {
    if (!library) return 0
    return library.clips.filter(
      (clip) => favoritosSet.has(clip.id) && (!anime || clip.anime === anime),
    ).length
  }, [library, favoritosSet, anime])

  // Quantas partes o projeto ja tem, para o botao dizer qual sera a proxima.
  const partesNoProjeto = new Set(
    images.map((image) => image.section).filter((s): s is number => s !== null),
  ).size

  /*
   * Cenas ja gastas em OUTRA frase.
   *
   * Trocar de frase troca o que aparece marcado, entao uma cena usada tres
   * frases atras volta a parecer livre -- e repetir a mesma cena num video
   * curto e o tipo de erro que so aparece depois de renderizar.
   *
   * Fica ANTES do `if (!open) return null`, junto das sugestoes que dependem
   * dela: hook depois de saida antecipada e o que derruba o React inteiro com
   * "Rendered more hooks than during the previous render".
   */
  const usadasEmOutras = useMemo(() => {
    if (!porRoteiro || !library) return new Set<string>()
    const porPath = new Map(library.clips.map((c) => [c.path, c.id]))
    const fora = new Set<string>()
    for (const [chave, paths] of Object.entries(blockClips)) {
      if (Number(chave) === activeBlock) continue
      for (const p of paths) {
        const id = porPath.get(p)
        if (id) fora.add(id)
      }
    }
    return fora
  }, [porRoteiro, library, blockClips, activeBlock])

  /*
   * As cenas mais provaveis para o trecho aberto.
   *
   * Medido no acervo dele (20.693 cenas): 5ms por trecho, entao recalcular a
   * cada troca de trecho e barato. Cena ja marcada em OUTRO trecho sai da
   * frente -- ver no topo o que ele acabou de usar seria convite a repetir.
   */
  /** Trechos sem cena nenhuma. O tempo deles e absorvido pelo anterior. */
  const trechosVazios = blocos
    ? blocos.reduce((n, _, i) => n + ((blockClips[i] ?? []).length === 0 ? 1 : 0), 0)
    : 0

  const sugestoes = useMemo(() => {
    if (!contexto || activeBlock === null || replaceTarget !== null) return []
    return sugerirParaBloco(contexto, activeBlock, usadasEmOutras)
  }, [contexto, activeBlock, replaceTarget, usadasEmOutras])

  if (!open) return null

  const escolher = (id: string): void => {
    /*
     * Substituir vem ANTES de tudo: e um gesto de um clique so, e enquanto ele
     * esta ativo a Biblioteca nao esta montando nada -- esta respondendo uma
     * pergunta especifica ("qual cena vai neste bloco?").
     */
    if (replaceTarget !== null) {
      const path = library?.clips.find((c) => c.id === id)?.path
      if (path) void replaceSceneWith(path)
      return
    }
    if (porRoteiro) {
      const path = library?.clips.find((c) => c.id === id)?.path
      if (path) toggleBlockClip(path)
      return
    }
    setEscolhidos((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    )
  }

  /** Ids marcados na frase aberta, para a grade poder numerar os cartoes. */
  const marcadosNaFrase = (): string[] => {
    if (!porRoteiro || activeBlock === null || !library) return []
    const porPath = new Map(library.clips.map((c) => [c.path, c.id]))
    return (blockClips[activeBlock] ?? [])
      .map((p) => porPath.get(p))
      .filter((id): id is string => id !== undefined)
  }

  const totalMarcado = Object.values(blockClips).reduce((n, c) => n + c.length, 0)


  /**
   * A ordem e a de CLIQUE, e nao a da grade.
   *
   * Vale para os dois usos e por motivos diferentes. Em recap a grade ja esta em
   * ordem cronologica, entao clicar da esquerda para a direita da no mesmo. Em
   * teoria a ordem e a do argumento, que nenhuma ordenacao de acervo conhece --
   * e ali a ordem de clique e a unica informacao que existe.
   */
  const adicionar = (parte?: string): void => {
    if (!library) return
    const porId = new Map(library.clips.map((c) => [c.id, c.path]))
    const caminhos = escolhidos
      .map((id) => porId.get(id))
      .filter((p): p is string => p !== undefined)
    setEscolhidos([])
    void addFromLibrary(caminhos, parte)
  }

  /**
   * O nome da parte sai do filtro em uso.
   *
   * "Kurosaki, Ichigo" diz mais do que "Parte 2" na hora de conferir a barra de
   * status, e nao custa nada: e o que ele acabou de escolher no rail.
   */
  const nomeDaLeva = (): string => {
    const pedacos = [anime, episodio, personagem, texto.trim()].filter((p): p is string => !!p)
    return pedacos.length > 0 ? pedacos.join(' · ') : `${escolhidos.length} cenas`
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex h-[46px] shrink-0 items-center gap-3 border-b border-line px-5">
        <h2 className="text-[15px] font-semibold text-ink">Biblioteca</h2>
        {library && (
          <span className="tnum text-[11px] text-ink-3">
            {library.clips.length.toLocaleString('pt-BR')} cenas · {library.episodes} episodios
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/*
            Aparece so com uma serie escolhida: apelido e por serie, e sem serie
            nao ha lista de personagens para apontar.
          */}
          {anime && (
            <button
              type="button"
              onClick={() => setApelidosAbertos(true)}
              title="Como voce chama esses personagens no roteiro sem usar o nome"
              className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink"
            >
              <Tags size={12} strokeWidth={1.5} />
              Apelidos
              <span className="tnum text-[10px] text-ink-3">
                {(nicknames[anime] ?? []).length}
              </span>
            </button>
          )}
          {/*
            Etiquetar e um botao e nao acontece sozinho: a primeira vez baixa
            379 MB e ocupa a GPU por uns treze minutos. Depois e incremental --
            so o que chegou de novo --, mas quem manda comecar e ele.
          */}
          <button
            type="button"
            onClick={() => void tagLibrary()}
            disabled={taggerBusy || busy !== null}
            title={
              etiquetadas > 0
                ? `${etiquetadas.toLocaleString('pt-BR')} cenas ja descritas. Etiqueta as que faltam.`
                : 'Descobre o que aparece em cada cena (cenario, objetos, acao) para a busca alcancar as cenas sem personagem'
            }
            className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink disabled:opacity-40"
          >
            {taggerBusy ? (
              <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
            ) : (
              <Sparkles size={12} strokeWidth={1.5} className="text-accent" />
            )}
            Etiquetar
            {etiquetadas > 0 && (
              <span className="tnum text-[10px] text-ink-3">
                {Math.round((etiquetadas / Math.max(library?.clips.length ?? 1, 1)) * 100)}%
              </span>
            )}
          </button>
          {/*
            Ler cenas e SEMPRE do anime aberto, nunca do acervo.

            Sao ~4,9s por cena: um episodio leva meia hora, o acervo inteiro
            passa de 24 horas. Um botao que so funcionasse "para tudo" seria um
            botao que ele nunca clicaria. Com o anime aberto ele le o que vai
            usar hoje e monta hoje.
          */}
          <button
            type="button"
            onClick={() => void describeLibrary(anime)}
            disabled={describeBusy || busy !== null || doAnime === 0}
            title={
              anime
                ? `Le emocao, acao e cenario das cenas de ${anime}. ${lidas.toLocaleString('pt-BR')} de ${doAnime.toLocaleString('pt-BR')} ja lidas. Precisa do Ollama aberto.`
                : 'Abra um anime na lista ao lado para ler as cenas dele. Ler o acervo inteiro levaria mais de 24 horas.'
            }
            className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink disabled:opacity-40"
          >
            {describeBusy ? (
              <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
            ) : (
              <Eye size={12} strokeWidth={1.5} className="text-accent" />
            )}
            Ler cenas
            {doAnime > 0 && (
              <span className="tnum text-[10px] text-ink-3">
                {Math.round((lidas / doAnime) * 100)}%
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => void syncLibrary()}
            disabled={busy !== null}
            title="Procura episodios novos na pasta"
            className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
            ) : (
              <RefreshCw size={12} strokeWidth={1.5} />
            )}
            Sincronizar
          </button>
          <button
            type="button"
            onClick={() => void openLibrary(false)}
            aria-label="Fechar"
            className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {/*
        Uma faixa, e nao um modo escondido: entrar aqui pela seta do card e sair
        pelo Escape sao dois caminhos, e sem dizer o que esta acontecendo o
        proximo clique viraria surpresa.
      */}
      {replaceTarget !== null && (
        <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-accent bg-accent-dim px-5">
          <span className="text-[12px] text-ink">
            Escolha a cena que entra no bloco {replaceTarget + 1} — um clique substitui
          </span>
          <button
            type="button"
            onClick={() => void openLibrary(false)}
            className="rounded-sm px-2 py-0.5 text-[11px] text-ink-2 hover:text-ink"
          >
            Cancelar
          </button>
        </div>
      )}

      {error ? (
        <SemBiblioteca mensagem={error} />
      ) : !library ? (
        <div className="grid flex-1 place-items-center text-[13px] text-ink-3">
          <span className="flex items-center gap-2">
            <Loader2 size={14} strokeWidth={1.5} className="animate-spin text-accent" />
            {busy ?? 'Lendo a biblioteca...'}
          </span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {replaceTarget === null && (porRoteiro || audio) ? <ScriptColumn /> : null}
          <Rail
            /*
             * Com o filtro de favoritos ligado, o rail conta FAVORITOS por
             * anime -- que e o que ele pediu: "Tensura tem seus clipes
             * favoritos, Mushoku Tensei os seus". Sem isso o rail diria 3.211
             * cenas de Mushoku enquanto a grade mostra as quatro marcadas.
             */
            clips={soFavoritos ? library.clips.filter((c) => favoritosSet.has(c.id)) : library.clips}
            anime={anime}
            episodio={episodio}
            personagem={personagem}
            /*
             * Trocar de anime limpa o personagem, e escolher um personagem
             * assume o anime dele. Sem isso as duas colunas brigariam: pedir
             * "Tensura" com o Ichigo ainda marcado devolveria zero resultado, e
             * o motivo estaria escondido dois filtros acima.
             */
            onAnime={(serie) => {
              setAnime(serie)
              setPersonagem(null)
              // Trocar de serie zera o episodio: "S17E42" nao quer dizer nada
              // dentro de Tensura.
              setEpisodio(null)
            }}
            onEpisodio={(chave, doAnime) => {
              setEpisodio(chave)
              // Escolher um episodio assume a serie dele, como o personagem ja
              // fazia -- pedir a serie de novo seria pedir duas vezes o mesmo.
              if (chave !== null) setAnime(doAnime)
              setPersonagem(null)
            }}
            onPersonagem={(nome, doAnime) => {
              setPersonagem(nome)
              if (nome !== null) setAnime(doAnime)
            }}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <Filtros
              texto={texto}
              onTexto={setTexto}
              minSec={minSec}
              maxSec={maxSec}
              onFaixa={(min, max) => {
                setMinSec(min)
                setMaxSec(max)
              }}
              favoritos={soFavoritos}
              totalFavoritos={totalFavoritos}
              onFavoritos={() => setSoFavoritos((v) => !v)}
              total={filtrados.length}
            />
            {/*
              As sugestoes ficam ACIMA da grade, nunca no lugar dela.

              O custo do modo manual e varrer 20 mil cenas 39 vezes, uma por
              trecho. Isto corta o palheiro sem tirar nada: a biblioteca
              inteira continua logo abaixo, com todos os filtros de sempre. E
              e sugestao mesmo -- nada entra no video sem ele clicar.
            */}
            {sugestoes.length > 0 && (
              <Sugestoes
                candidatos={sugestoes}
                escolhidos={porRoteiro ? marcadosNaFrase() : escolhidos}
                favoritos={favoritosSet}
                onFavoritar={(id) => void toggleFavorite(id)}
                onEscolher={escolher}
              />
            )}

            <Grade
              clips={filtrados}
              escolhidos={replaceTarget !== null ? [] : porRoteiro ? marcadosNaFrase() : escolhidos}
              usadas={usadasEmOutras}
              favoritos={favoritosSet}
              onFavoritar={(id) => void toggleFavorite(id)}
              onEscolher={escolher}
            />
          </div>
        </div>
      )}

      {/*
        Enquanto prepara as cenas, uma cortina por cima de tudo.
        Preparar doze clipes leva dezenas de segundos de ffmpeg, e ate agora a
        tela ficava igual -- ele achava que o app tinha travado e cogitava
        fechar. A cortina tambem impede um segundo clique em "Montar" no meio
        do trabalho.
      */}
      {trabalhando !== null && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-bg/85">
          <span className="flex items-center gap-2.5 text-[13px] text-ink">
            <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-accent" />
            {trabalhando}
          </span>
        </div>
      )}

      {apelidosAbertos && anime && (
        <Nicknames series={anime} onClose={() => setApelidosAbertos(false)} />
      )}

      {replaceTarget !== null ? null : porRoteiro ? (
        <footer className="flex h-[52px] shrink-0 items-center justify-between border-t border-line px-5">
          <span className="tnum text-[12px] text-ink-2">
            {trechosVazios > 0 && avisouVazios ? (
              <span className="text-accent">
                {trechosVazios} {trechosVazios === 1 ? 'trecho esta' : 'trechos estao'} sem cena — o tempo{' '}
                {trechosVazios === 1 ? 'dele vai' : 'deles vai'} para a cena anterior. Tab pula para{' '}
                {trechosVazios === 1 ? 'ele' : 'o proximo'}.
              </span>
            ) : totalMarcado > 0 ? (
              `${totalMarcado} ${totalMarcado === 1 ? 'cena marcada' : 'cenas marcadas'} em ${Object.values(blockClips).filter((c) => c.length > 0).length} de ${blocos.length} trechos`
            ) : (
              'Escolha um trecho do roteiro e marque as cenas dele'
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={totalMarcado === 0}
              onClick={() => {
                if (trechosVazios > 0 && !avisouVazios) {
                  setAvisouVazios(true)
                  return
                }
                void applyBlockClips()
              }}
              title="Cada frase se divide entre as cenas que voce marcou nela"
              className="lift rounded-sm border border-accent bg-accent-dim px-3.5 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40"
            >
              {trechosVazios > 0 && avisouVazios ? 'Montar assim mesmo' : 'Montar com essas cenas'}
            </button>
          </div>
        </footer>
      ) : (escolhidos.length > 0 || partesNoProjeto > 0) && (
        <footer className="flex h-[52px] shrink-0 items-center justify-between border-t border-line px-5">
          <span className="tnum text-[12px] text-ink-2">
            {escolhidos.length > 0
              ? `${escolhidos.length} ${escolhidos.length === 1 ? 'cena marcada' : 'cenas marcadas'}`
              : 'Nada marcado'}
            {partesNoProjeto > 0 && (
              <span className="ml-2 text-ink-3">
                · {partesNoProjeto} {partesNoProjeto === 1 ? 'parte' : 'partes'} no projeto
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={escolhidos.length === 0}
              onClick={() => setEscolhidos([])}
              className="rounded-sm px-2.5 py-1.5 text-[12px] text-ink-3 hover:text-ink disabled:opacity-40"
            >
              Limpar
            </button>
            {/*
              Duas acoes, e nenhum modo escondido: o botao diz o que faz.
              Parte so existe quando o usuario pede, porque cena vinda da busca
              nao tem pasta para servir de gesto como no arraste.
            */}
            <button
              type="button"
              disabled={escolhidos.length === 0}
              onClick={() => adicionar(nomeDaLeva())}
              title="Vira uma parte do roteiro. A tela fica aberta para voce montar a proxima."
              className="lift rounded-sm border border-line bg-elevated px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink disabled:opacity-40"
            >
              Adicionar como parte {partesNoProjeto + 1}
            </button>
            <button
              type="button"
              disabled={escolhidos.length === 0}
              onClick={() => adicionar()}
              title="Entra no fim da fila, na ordem em que voce marcou"
              className="lift rounded-sm border border-accent bg-accent-dim px-3.5 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40"
            >
              Adicionar ao projeto
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}

/**
 * Tudo que a busca por texto enxerga de uma cena.
 *
 * O titulo do AnCut entra aqui mesmo sem agrupar nada: quem lembra de "Sennen
 * Kessen" ou de "Slime Datta Ken" tem que achar, ainda que a pasta se chame
 * "Bleach - Thousand Year Blood War" ou "Tensura".
 */
function textoDe(clip: LibraryClip): string {
  return `${clip.anime} ${clip.animeTitle} ${clip.characters.join(' ')} s${clip.season}e${clip.episode} ${clip.shot}`.toLowerCase()
}

// ------------------------------------------------------------------ sem pasta

function SemBiblioteca({ mensagem }: { mensagem: string }) {
  const syncLibrary = useProject((s) => s.syncLibrary)

  const escolher = async (): Promise<void> => {
    const result = await window.dangai.pickLibraryDir()
    if (result.ok && result.value) await syncLibrary()
  }

  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="max-w-[420px] text-center">
        <p className="mb-4 text-[13px] leading-relaxed text-ink-2">{mensagem}</p>
        <button
          type="button"
          onClick={() => void escolher()}
          className="lift inline-flex items-center gap-2 rounded-sm border border-line bg-elevated px-3 py-1.5 text-[13px] text-ink"
        >
          <FolderOpen size={13} strokeWidth={1.5} />
          Escolher a pasta da biblioteca
        </button>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          E a pasta onde o AnCut grava, a que contem uma pasta por anime. O Dangai so le: ele
          nunca renomeia, move nem apaga nada la dentro.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------- rail

interface RailProps {
  clips: readonly LibraryClip[]
  anime: string | null
  /** Chave "S17E42", ou null para o anime inteiro. */
  episodio: string | null
  personagem: string | null
  onAnime: (v: string | null) => void
  onEpisodio: (chave: string | null, doAnime: string) => void
  onPersonagem: (nome: string | null, doAnime: string | null) => void
}

/** A etiqueta do episodio, na mesma forma que a pasta do AnCut usa. */
export function chaveEpisodio(clip: LibraryClip): string {
  return `S${pad(clip.season)}E${pad(clip.episode)}`
}

/**
 * Animes, e os personagens DENTRO de cada anime.
 *
 * A lista corrida nao servia: com seis series o rail virava cem nomes em uma
 * coluna so, com Rimuru, Rudeus e Ichigo lado a lado ordenados por contagem. O
 * personagem pertence a uma serie -- a lista tem que dizer isso.
 *
 * A contagem nao e enfeite: e ela que mostra de cara que dois tercos das cenas
 * nao tem personagem nenhum identificado, que e o buraco que so o passo 2 fecha.
 */
function Rail({
  clips,
  anime,
  episodio,
  personagem,
  onAnime,
  onEpisodio,
  onPersonagem,
}: RailProps) {
  // Grupo aberto na mao. O do anime selecionado abre sozinho, entao aqui so
  // entra o que o usuario abriu por conta.
  const [abertos, setAbertos] = useState<readonly string[]>([])
  const [episodiosAbertos, setEpisodiosAbertos] = useState<readonly string[]>([])

  const { animes, porAnime, episodios, semRosto } = useMemo(() => {
    const contagemAnime = new Map<string, number>()
    /** anime -> personagem -> quantas cenas */
    const dentro = new Map<string, Map<string, number>>()
    /** anime -> episodio -> quantas cenas */
    const eps = new Map<string, Map<string, number>>()
    let sem = 0

    for (const clip of clips) {
      contagemAnime.set(clip.anime, (contagemAnime.get(clip.anime) ?? 0) + 1)
      if (clip.characters.length === 0) sem += 1

      const doAnime = dentro.get(clip.anime) ?? new Map<string, number>()
      for (const nome of clip.characters) {
        doAnime.set(nome, (doAnime.get(nome) ?? 0) + 1)
      }
      dentro.set(clip.anime, doAnime)

      const chave = chaveEpisodio(clip)
      const osEps = eps.get(clip.anime) ?? new Map<string, number>()
      osEps.set(chave, (osEps.get(chave) ?? 0) + 1)
      eps.set(clip.anime, osEps)
    }

    const ordenar = (m: Map<string, number>): [string, number][] =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))

    return {
      animes: ordenar(contagemAnime),
      porAnime: new Map([...dentro].map(([serie, nomes]) => [serie, ordenar(nomes)])),
      /*
       * Episodio ordenado do MAIOR para o menor, e nao por contagem.
       *
       * A ordem existe para um uso so, dito por ele: "eu vou fazer o corte dele
       * la e na hora de montar o recap aqui no dangai eu vou ir direto no ep
       * recem cortado". O recem-cortado e sempre o de numero maior, entao ele
       * fica na primeira linha sem depender de nenhuma data.
       */
      episodios: new Map(
        [...eps].map(([serie, mapa]) => [
          serie,
          [...mapa.entries()].sort((a, b) => b[0].localeCompare(a[0], 'en')),
        ]),
      ),
      semRosto: sem,
    }
  }, [clips])

  const alternar = (serie: string): void => {
    setAbertos((atual) =>
      atual.includes(serie) ? atual.filter((s) => s !== serie) : [...atual, serie],
    )
  }

  const alternarEpisodios = (serie: string): void => {
    setEpisodiosAbertos((atual) =>
      atual.includes(serie) ? atual.filter((s) => s !== serie) : [...atual, serie],
    )
  }

  return (
    <nav className="w-[210px] shrink-0 overflow-y-auto border-r border-line p-3">
      <Titulo>Anime</Titulo>
      <Item ativo={anime === null && episodio === null} onClick={() => onAnime(null)} contagem={clips.length}>
        Todos
      </Item>
      {animes.map(([nome, n]) => {
        const eps = episodios.get(nome) ?? []
        /*
         * O anime escolhido abre os episodios sozinho, pelo mesmo motivo do
         * grupo de personagem: escolher a serie e dizer "e daqui que eu quero".
         */
        const aberto = episodiosAbertos.includes(nome) || anime === nome

        return (
          <div key={nome}>
            <div className="flex items-center">
              {/*
                A seta e o nome sao alvos SEPARADOS: abrir a lista de episodios
                e escolher a serie inteira sao duas intencoes, e juntar as duas
                obrigaria a escolher a serie so para dar uma espiada nos
                episodios dela.
              */}
              <button
                type="button"
                onClick={() => alternarEpisodios(nome)}
                aria-label={aberto ? `Fechar os episodios de ${nome}` : `Ver os episodios de ${nome}`}
                className="grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink"
              >
                {aberto ? (
                  <ChevronDown size={11} strokeWidth={1.5} />
                ) : (
                  <ChevronRight size={11} strokeWidth={1.5} />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <Item ativo={anime === nome && episodio === null} onClick={() => onAnime(nome)} contagem={n}>
                  {nome}
                </Item>
              </div>
            </div>

            {aberto &&
              eps.map(([chave, quantas]) => (
                <Item
                  key={`${nome}/${chave}`}
                  ativo={episodio === chave && anime === nome}
                  onClick={() => onEpisodio(episodio === chave && anime === nome ? null : chave, nome)}
                  contagem={quantas}
                  recuado
                >
                  {chave}
                </Item>
              ))}
          </div>
        )
      })}

      <div className="my-3 h-px bg-line" />

      <Titulo>Personagem</Titulo>
      <Item ativo={personagem === null} onClick={() => onPersonagem(null, anime)} contagem={clips.length}>
        Qualquer
      </Item>

      {animes.map(([serie]) => {
        const nomes = porAnime.get(serie) ?? []
        if (nomes.length === 0) return null

        /*
         * O grupo da serie escolhida abre sozinho: escolher o anime e, na
         * pratica, dizer "e daqui que eu quero o personagem". Ter que clicar de
         * novo para expandir seria pedir duas vezes a mesma coisa.
         */
        const aberto = abertos.includes(serie) || anime === serie
        const temEscolhido = nomes.some(([nome]) => nome === personagem)

        return (
          <div key={serie}>
            <button
              type="button"
              onClick={() => alternar(serie)}
              className="flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-[11px] text-ink-2 transition-colors duration-150 hover:text-ink"
            >
              {aberto ? (
                <ChevronDown size={11} strokeWidth={1.5} className="shrink-0 text-ink-3" />
              ) : (
                <ChevronRight size={11} strokeWidth={1.5} className="shrink-0 text-ink-3" />
              )}
              <span className="min-w-0 flex-1 truncate">{serie}</span>
              {/* Ponto quando o personagem escolhido esta num grupo fechado --
                  sem ele o filtro ativo ficaria invisivel. */}
              {!aberto && temEscolhido && <span className="size-1.5 shrink-0 rounded-full bg-accent" />}
              <span className="tnum shrink-0 text-[10px] text-ink-3">{nomes.length}</span>
            </button>

            {aberto &&
              nomes.map(([nome, n]) => (
                <Item
                  key={`${serie}/${nome}`}
                  ativo={personagem === nome}
                  onClick={() => onPersonagem(personagem === nome ? null : nome, serie)}
                  contagem={n}
                  recuado
                >
                  {nome}
                </Item>
              ))}
          </div>
        )
      })}

      <p className="mt-3 px-1.5 text-[10px] leading-relaxed text-ink-3">
        {semRosto.toLocaleString('pt-BR')} cenas sem personagem identificado — cenario, planos
        abertos e detalhes. Chegue nelas pelo episodio, ou buscando o que aparece
        (&ldquo;floresta&rdquo;, &ldquo;noite&rdquo;).
      </p>
    </nav>
  )
}

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 px-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
      {children}
    </h3>
  )
}

function Item({
  ativo,
  onClick,
  contagem,
  recuado = false,
  children,
}: {
  ativo: boolean
  onClick: () => void
  contagem: number
  /** Personagem dentro do grupo do anime. */
  recuado?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2 rounded-sm py-1 pr-1.5 text-left text-[12px] transition-colors duration-150',
        recuado ? 'pl-5' : 'pl-1.5',
        ativo ? 'bg-accent-dim text-ink' : 'text-ink-2 hover:text-ink',
      ].join(' ')}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className="tnum shrink-0 text-[10px] text-ink-3">{contagem}</span>
    </button>
  )
}

// ------------------------------------------------------------------- filtros

interface FiltrosProps {
  /** So favoritos. */
  favoritos: boolean
  /** Quantos favoritos existem no recorte de anime em uso. */
  totalFavoritos: number
  onFavoritos: () => void
  texto: string
  onTexto: (v: string) => void
  minSec: number
  maxSec: number
  onFaixa: (min: number, max: number) => void
  total: number
}

/**
 * As faixas de duracao sao as do uso real: um bloco de narracao tem ~1.3s, e a
 * cena mediana da biblioteca tem 2.3s. "Curta" e "media" e o corte que decide se
 * o clipe cabe no bloco sem congelar o ultimo frame.
 */
const FAIXAS: readonly { nome: string; min: number; max: number }[] = [
  { nome: 'Qualquer', min: 0, max: 0 },
  { nome: 'ate 2s', min: 0, max: 2 },
  { nome: '2 a 5s', min: 2, max: 5 },
  { nome: 'mais de 5s', min: 5, max: 0 },
]

function Filtros({
  texto,
  onTexto,
  minSec,
  maxSec,
  onFaixa,
  favoritos,
  totalFavoritos,
  onFavoritos,
  total,
}: FiltrosProps) {
  return (
    <div className="flex h-[46px] shrink-0 items-center gap-3 border-b border-line px-4">
      <div className="relative min-w-0 flex-1">
        <Search
          size={12}
          strokeWidth={1.5}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <input
          value={texto}
          onChange={(event) => onTexto(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Buscar por anime, personagem ou episodio (ex.: ichigo, s01e42)"
          spellCheck={false}
          className="w-full select-text rounded-sm border border-line bg-elevated py-1.5 pl-7 pr-2.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
        />
      </div>

      {/*
        Uma lista que abre e recolhe, e nao quatro botoes lado a lado.
        Ele so escolhe faixa de vez em quando, e enquanto nao escolhe os quatro
        botoes gastavam largura permanente da barra -- largura que a busca, que
        ele usa o tempo todo, estava perdendo.
      */}
      <button
        type="button"
        onClick={onFavoritos}
        title={favoritos ? 'Mostrando so os favoritos' : 'Mostrar so os favoritos'}
        className={[
          'lift flex shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] transition-colors duration-150',
          favoritos
            ? 'border-accent bg-accent-dim text-ink'
            : 'border-line bg-elevated text-ink-2 hover:text-ink',
        ].join(' ')}
      >
        <Star
          size={12}
          strokeWidth={1.5}
          className={favoritos ? 'fill-accent text-accent' : 'text-ink-3'}
        />
        Favoritos
        <span className="tnum text-[10px] text-ink-3">{totalFavoritos}</span>
      </button>

      <select
        value={`${minSec}-${maxSec}`}
        onChange={(event) => {
          const [min, max] = event.target.value.split('-')
          onFaixa(Number(min), Number(max))
        }}
        title="Duracao da cena"
        className="shrink-0 rounded-sm border border-line bg-elevated px-2 py-1 text-[11px] text-ink-2 focus:border-line-strong focus:outline-none"
      >
        {FAIXAS.map((faixa) => (
          <option key={faixa.nome} value={`${faixa.min}-${faixa.max}`}>
            {faixa.nome}
          </option>
        ))}
      </select>

      <span className="tnum shrink-0 text-[11px] text-ink-3">
        {total.toLocaleString('pt-BR')} {total === 1 ? 'resultado' : 'resultados'}
      </span>
    </div>
  )
}

// --------------------------------------------------------------------- grade

interface GradeProps {
  clips: readonly LibraryClip[]
  escolhidos: readonly string[]
  /** Cenas ja marcadas em OUTRA frase do roteiro. Vazio no uso sem roteiro. */
  usadas?: ReadonlySet<string>
  favoritos: ReadonlySet<string>
  onFavoritar: (id: string) => void
  onEscolher: (id: string) => void
}

/**
 * Grade com janela de rolagem.
 *
 * Nove mil miniaturas de uma vez seriam nove mil nos no DOM e nove mil pedidos
 * ao servidor local. Desenhar so as linhas visiveis mantem isso em algumas
 * dezenas, e o espacador de cima e de baixo faz a barra de rolagem continuar
 * dizendo a verdade sobre o tamanho do acervo.
 */
function Grade({ clips, escolhidos, usadas, favoritos, onFavoritar, onEscolher }: GradeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(0)
  const [altura, setAltura] = useState(0)
  const [scroll, setScroll] = useState(0)

  /*
   * A medida sai antes da pintura, e nao so pelo observador.
   *
   * A primeira entrega do ResizeObserver depende do ciclo de renderizacao do
   * Chrome, e ela ATRASA quando a janela nao esta pintando -- foi medido: a
   * grade ficava vazia porque `largura` seguia zero. Medindo aqui, o primeiro
   * quadro ja sai certo e o observador cuida so do que vier depois.
   */
  useLayoutEffect(() => {
    const alvo = ref.current
    if (!alvo) return
    const medir = (): void => {
      setLargura(alvo.clientWidth)
      setAltura(alvo.clientHeight)
    }
    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(alvo)
    return () => observer.disconnect()
  }, [])

  // Filtro novo devolve a rolagem ao topo: continuar no meio de uma lista que
  // acabou de mudar mostra um pedaco aleatorio do resultado.
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
    setScroll(0)
  }, [clips])

  const colunas = Math.max(2, Math.floor((largura + GAP) / (ITEM_ALVO + GAP)))
  const itemW = colunas > 0 && largura > 0 ? (largura - GAP * (colunas - 1) - 24) / colunas : 0
  const linhaH = Math.round((itemW * 9) / 16) + RODAPE + GAP
  const linhas = Math.ceil(clips.length / colunas)

  const primeira = Math.max(0, Math.floor(scroll / linhaH) - FOLGA)
  const ultima = Math.min(linhas, Math.ceil((scroll + altura) / linhaH) + FOLGA)
  const visiveis = clips.slice(primeira * colunas, ultima * colunas)

  // Posicao de cada escolhida, para o cartao mostrar o numero em vez de so uma
  // borda. Sem o numero visivel, "a ordem e a de clique" e uma promessa que o
  // usuario tem que acreditar; com ele, da para conferir antes de adicionar.
  const ordens = new Map(escolhidos.map((id, i) => [id, i + 1]))

  if (clips.length === 0) {
    return (
      <div className="grid flex-1 place-items-center text-[13px] text-ink-3">
        Nenhuma cena com esses filtros.
      </div>
    )
  }

  return (
    <div
      ref={ref}
      onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
    >
      <div style={{ height: linhas * linhaH, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: primeira * linhaH,
            left: 0,
            right: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))`,
            gap: GAP,
          }}
        >
          {itemW > 0 &&
            visiveis.map((clip) => (
              <Cartao
                key={clip.id}
                clip={clip}
                ordem={ordens.get(clip.id) ?? 0}
                usada={usadas?.has(clip.id) ?? false}
                favorito={favoritos.has(clip.id)}
                onFavoritar={() => onFavoritar(clip.id)}
                onClick={() => onEscolher(clip.id)}
              />
            ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Uma cena na grade.
 *
 * Passar o mouse toca o clipe no lugar da miniatura. E o que separa "ver uma
 * imagem parada" de "saber se a cena serve": num acervo de anime metade das
 * miniaturas de um mesmo plano sao quase iguais, e o movimento e o que
 * distingue uma da outra.
 */
/**
 * A faixa de sugestoes do trecho aberto.
 *
 * Rola na horizontal e usa o MESMO cartao da grade -- prever, favoritar e
 * marcar funcionam igual, e o numero de ordem aparece igual. Um cartao
 * diferente aqui faria parecer outra coisa, e nao e: sao as mesmas cenas da
 * biblioteca, so que ordenadas pelo que o trecho pede.
 */
function Sugestoes({
  candidatos,
  escolhidos,
  favoritos,
  onFavoritar,
  onEscolher,
}: {
  candidatos: readonly SelectionCandidate[]
  escolhidos: readonly string[]
  favoritos: ReadonlySet<string>
  onFavoritar: (id: string) => void
  onEscolher: (id: string) => void
}) {
  const ordens = new Map(escolhidos.map((id, i) => [id, i + 1]))
  return (
    <div className="border-b border-line px-3 pb-3 pt-2">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[11px] uppercase tracking-wide text-ink-3">Sugestoes para este trecho</span>
        <span className="tnum text-[10px] text-ink-3">{candidatos.length}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {candidatos.map((c) => (
          <div key={c.clip.id} className="w-[168px] shrink-0">
            <Cartao
              clip={c.clip}
              ordem={ordens.get(c.clip.id) ?? 0}
              favorito={favoritos.has(c.clip.id)}
              onFavoritar={() => onFavoritar(c.clip.id)}
              onClick={() => onEscolher(c.clip.id)}
            />
            {/* Por que esta cena entrou. Sem isso a faixa e um palpite sem defesa. */}
            <p className="mt-0.5 truncate text-[10px] text-ink-3" title={c.reason}>
              {c.reason}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function Cartao({
  clip,
  ordem,
  usada,
  favorito,
  onFavoritar,
  onClick,
}: {
  clip: LibraryClip
  /** Posicao na fila, comecando em 1. Zero quando nao foi escolhida. */
  ordem: number
  /** Ja foi gasta em outra frase. Nao impede -- so avisa. */
  usada?: boolean
  favorito: boolean
  onFavoritar: () => void
  onClick: () => void
}) {
  const marcado = ordem > 0
  const [url, setUrl] = useState<string | null>(null)
  const [dentro, setDentro] = useState(false)
  const timer = useRef<number | null>(null)

  const entrar = useCallback(() => {
    setDentro(true)
    // A espera evita publicar clipe a cada cena que o mouse atravessa de
    // passagem -- so o que o usuario parou para olhar vira pedido de verdade.
    timer.current = window.setTimeout(() => {
      void window.dangai.libraryClipUrl(clip.path).then((result) => {
        if (result.ok) setUrl(result.value)
      })
    }, 350)
  }, [clip.path])

  const sair = useCallback(() => {
    setDentro(false)
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  /*
   * <div role="button">, e nao <button>.
   *
   * A estrela de favorito e um segundo alvo clicavel dentro do cartao, e
   * elemento interativo dentro de <button> e invalido -- o teclado e o leitor
   * de tela param de enxergar o de dentro. Mesma correcao que a timeline ja
   * tinha precisado ao ganhar o botao de excluir bloco.
   */
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onClick()
      }}
      onMouseEnter={entrar}
      onMouseLeave={sair}
      title={`${clip.animeTitle || clip.anime} · S${pad(clip.season)}E${pad(clip.episode)} · cena ${clip.shot} · ${clip.duration.toFixed(1)}s${usada ? ' · ja usada em outra frase' : ''}`}
      className={[
        'group flex cursor-pointer flex-col overflow-hidden rounded-sm border text-left transition-colors duration-150',
        marcado
          ? 'border-accent'
          : usada
            ? 'border-line opacity-45 hover:opacity-100'
            : 'border-line hover:border-line-strong',
      ].join(' ')}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-elevated">
        <img
          src={clip.thumbUrl}
          alt=""
          loading="lazy"
          draggable={false}
          className="size-full object-cover"
        />
        {dentro && url && (
          <video
            src={url}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <span className="tnum absolute bottom-1 right-1 rounded-sm bg-black/70 px-1 py-0.5 text-[10px] text-white">
          {clip.duration.toFixed(1)}s
        </span>
        {/*
          A estrela mora DENTRO do cartao mas fora do clique dele: marcar
          favorito e escolher a cena para o video sao duas intencoes diferentes,
          e juntar as duas no mesmo alvo faria uma virar acidente da outra.
          Some quando o mouse sai, para nao poluir uma grade de cinquenta
          cartoes -- menos quando ja esta marcada, que e a informacao.
        */}
        <span
          role="button"
          tabIndex={0}
          aria-label={favorito ? 'Desfavoritar esta cena' : 'Favoritar esta cena'}
          title={favorito ? 'Desfavoritar' : 'Favoritar'}
          onClick={(event) => {
            event.stopPropagation()
            onFavoritar()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            onFavoritar()
          }}
          className={[
            'absolute right-1 top-1 grid size-[20px] cursor-pointer place-items-center rounded-sm bg-black/60 transition-opacity duration-150',
            favorito ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          ].join(' ')}
        >
          <Star
            size={12}
            strokeWidth={1.5}
            className={favorito ? 'fill-accent text-accent' : 'text-white'}
          />
        </span>
        {marcado && (
          <>
            <span className="absolute inset-0 border-2 border-accent bg-accent-dim/30" />
            <span className="tnum absolute left-1 top-1 grid size-[18px] place-items-center rounded-full bg-accent text-[10px] font-semibold text-white">
              {ordem}
            </span>
          </>
        )}
        {/*
          Ja usada em outra frase: apagada, nao proibida. Repetir cena as vezes
          e escolha (o mesmo plano voltando fecha uma ideia); repetir sem
          perceber e erro, e so aparece depois de renderizar.
        */}
        {!marcado && usada && (
          <span className="absolute left-1 top-1 grid size-[18px] place-items-center rounded-full bg-black/70 text-[10px] text-white">
            ✓
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <span className="tnum shrink-0 text-[10px] text-ink-3">
          E{pad(clip.episode)}·{clip.shot}
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-ink-2">
          {clip.characters.join(', ')}
        </span>
      </div>
    </div>
  )
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
