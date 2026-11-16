import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  Combine,
  FileAudio,
  FolderOpen,
  Library as LibraryIcon,
  Loader2,
  Mic,
  Play,
  TriangleAlert,
  Volume2,
  X,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { classifyFile } from '@shared/channels'
import type { CadeiaDeAudio } from '@shared/edicao-de-audio'
import { useProject } from '@/store/project'
import { useRecentes } from '@/store/recentes'
import { useEscolhaAvulsa } from '@/store/escolha-avulsa'
import { duracaoDaLigacao, useJuntar, type LigacaoNaTela, type ParteNaTela } from '@/store/juntar-projetos'
import { Segmentos } from './painel'
import { Efeitos, Velocidade } from './EtapaDoAudio'

/**
 * JUNTAR PROJETOS (16/11): "eu quero fazer videos de mais ou menos 30 s para
 * ter mais frequencia... e depois juntar para ter um video de 60 s+". A tela:
 * os projetos dele na esquerda (os recentes, ou outro .dangai), a SEQUENCIA
 * na direita -- cada parte inteira, na ordem, e entre elas a LIGACAO: so um
 * som no corte, ou uma frase gravada ("E nao para por ai..."), com os efeitos
 * e a velocidade da etapa de Audio e a cena escolhida na Biblioteca. Embaixo,
 * o total (com o aviso de 1 minuto), o nome e o Juntar.
 */
export function JuntarProjetos() {
  const aberta = useJuntar((s) => s.aberta)
  if (!aberta) return null
  return <Tela />
}

const relogio = (s: number): string => {
  const t = Math.max(0, Math.round(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

function Tela() {
  const { partes, ligacoes, nome, juntando, erro } = useJuntar(
    useShallow((s) => ({ partes: s.partes, ligacoes: s.ligacoes, nome: s.nome, juntando: s.juntando, erro: s.erro })),
  )
  const busy = useProject((s) => s.busy)
  const bibliotecaAberta = useProject((s) => s.libraryOpen)
  const total = partes.reduce((n, p) => n + p.duracaoSec, 0) + ligacoes.reduce((n, l) => n + duracaoDaLigacao(l), 0)

  // Esc fecha (menos com a Biblioteca por cima, que tem o Esc dela, ou juntando).
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || useProject.getState().libraryOpen || useJuntar.getState().juntando) return
      if (document.querySelector('[aria-label="Escolher cor"]')) return
      useJuntar.getState().fechar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-6" aria-hidden={bibliotecaAberta || undefined}>
      <div role="dialog" aria-label="Juntar projetos" className="glass enter flex h-[min(800px,94vh)] w-[min(1180px,96vw)] flex-col overflow-hidden rounded-lg">
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-4">
          <span className="grid size-9 place-items-center rounded-md bg-accent-dim text-accent">
            <Combine size={17} strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-[15px] font-semibold text-ink">Juntar projetos</h2>
            <p className="text-[12px] text-ink-3">Vídeos de ~30 s viram um de 60 s+. Os projetos originais não mudam.</p>
          </div>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => useJuntar.getState().fechar()}
            disabled={juntando}
            aria-label="Fechar"
            className="grid size-8 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink disabled:opacity-40"
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
          <SeusProjetos />
          <section className="min-h-0 overflow-y-auto px-6 py-5" data-juntar="sequencia">
            <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">Sequência</h3>
            {partes.length === 0 ? (
              <div className="grid place-items-center rounded-lg border border-dashed border-line-strong px-6 py-14 text-center">
                <Combine size={22} strokeWidth={1.5} className="mb-2 text-ink-3" />
                <p className="text-[13px] text-ink-2">Clique nos projetos à esquerda, na ordem do vídeo.</p>
                <p className="mt-1 text-[11px] text-ink-3">Entre um e outro você escolhe a ligação: um som, ou uma frase gravada.</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {partes.map((p, i) => (
                  <div key={`${p.caminho}-${i}`} className="flex flex-col">
                    <CartaoDaParte parte={p} i={i} total={partes.length} />
                    {i < ligacoes.length && <Ligacao i={i} ligacao={ligacoes[i]!} />}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-5 py-3">
          <span className="text-[13px] text-ink-2">
            Total <span className="tnum font-semibold text-ink">{relogio(total)}</span>
          </span>
          {partes.length >= 2 &&
            (total >= 60 ? (
              <span className="flex items-center gap-1 text-[12px] text-emerald-300">
                <Check size={13} strokeWidth={2} /> passou de 1 minuto
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[12px] text-[#e8b65c]">
                <TriangleAlert size={13} strokeWidth={1.75} /> faltam {Math.ceil(60 - total)} s para 1 minuto
              </span>
            ))}
          {(erro || (juntando && busy)) && (
            <span className={['min-w-0 truncate text-[12px]', erro ? 'text-danger' : 'text-ink-2'].join(' ')} title={erro ?? busy ?? ''}>
              {erro ?? busy}
            </span>
          )}
          <span className="flex-1" />
          <input
            value={nome}
            onChange={(e) => useJuntar.getState().setNome(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Nome do vídeo novo"
            aria-label="Nome do vídeo novo"
            maxLength={120}
            className="h-9 w-[300px] rounded-sm border border-line bg-elevated px-3 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void useJuntar.getState().juntar()}
            disabled={juntando || partes.length < 2}
            className="flex h-9 items-center gap-2 rounded-sm bg-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {juntando ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : <Combine size={14} strokeWidth={2} />}
            {juntando ? 'Juntando...' : 'Juntar'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** A esquerda: os projetos recentes (um clique poe no fim da sequencia) e "abrir outro". */
function SeusProjetos() {
  const lista = useRecentes((s) => s.lista)
  const existe = useRecentes((s) => s.existe)
  const partes = useJuntar((s) => s.partes)
  const naSequencia = useMemo(() => new Set(partes.map((p) => p.caminho)), [partes])
  const [abrindo, setAbrindo] = useState(false)
  const adicionar = useJuntar((s) => s.adicionar)

  const abrirOutro = async (): Promise<void> => {
    setAbrindo(true)
    const r = await window.dangai.escolherProjetos()
    if (r.ok) {
      for (const caminho of r.value) {
        const resumo = await window.dangai.resumoDoProjeto(caminho)
        if (resumo.ok) adicionar({ caminho, nome: resumo.value.nome, duracaoSec: resumo.value.duracaoSec, capa: null })
      }
    }
    setAbrindo(false)
  }

  return (
    <aside className="flex min-h-0 flex-col border-r border-line" data-juntar="projetos">
      <h3 className="px-4 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">Seus projetos</h3>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {lista.length === 0 && <p className="px-2 py-3 text-[12px] text-ink-3">Nenhum projeto recente. Abra um .dangai abaixo.</p>}
        {lista.map((r) => {
          const dentro = naSequencia.has(r.path)
          const sumiu = existe[r.path] === false
          return (
            <button
              key={r.path}
              type="button"
              disabled={sumiu}
              onClick={() => adicionar({ caminho: r.path, nome: r.nome, duracaoSec: r.duracaoSec, capa: r.capa })}
              title={sumiu ? 'O arquivo não está mais no disco' : dentro ? 'Já está na sequência (clique para pôr de novo)' : 'Pôr no fim da sequência'}
              className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05] disabled:opacity-40"
            >
              <Capa capa={r.capa} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12px] text-ink">{r.nome}</span>
                <span className="tnum text-[11px] text-ink-3">
                  {relogio(r.duracaoSec)} · {r.blocos} blocos
                </span>
              </span>
              {dentro && <Check size={13} strokeWidth={2} className="shrink-0 text-accent" />}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => void abrirOutro()}
        disabled={abrindo}
        className="m-2.5 mt-0 flex items-center justify-center gap-2 rounded-sm border border-line bg-elevated px-3 py-2 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
      >
        {abrindo ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} strokeWidth={1.5} />}
        Abrir outro .dangai
      </button>
    </aside>
  )
}

function Capa({ capa, grande = false }: { capa: string | null; grande?: boolean }) {
  const tam = grande ? 'h-[54px] w-[30px]' : 'h-[44px] w-[25px]'
  return capa ? (
    <img src={capa} alt="" className={`${tam} shrink-0 rounded-[4px] object-cover`} draggable={false} />
  ) : (
    <span className={`${tam} grid shrink-0 place-items-center rounded-[4px] bg-elevated text-ink-3`}>
      <Combine size={11} strokeWidth={1.5} />
    </span>
  )
}

function CartaoDaParte({ parte, i, total }: { parte: ParteNaTela; i: number; total: number }) {
  const mover = useJuntar((s) => s.mover)
  const remover = useJuntar((s) => s.remover)
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface p-2.5 pr-3" data-juntar="parte">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-dim text-[11px] font-semibold text-accent">{i + 1}</span>
      <Capa capa={parte.capa} grande />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium text-ink">{parte.nome}</span>
        <span className="tnum text-[11px] text-ink-3">{relogio(parte.duracaoSec)}</span>
      </span>
      <button type="button" onClick={() => mover(i, i - 1)} disabled={i === 0} aria-label="Subir" title="Subir na ordem"
        className="grid size-7 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink disabled:opacity-30">
        <ArrowUp size={14} strokeWidth={1.75} />
      </button>
      <button type="button" onClick={() => mover(i, i + 1)} disabled={i === total - 1} aria-label="Descer" title="Descer na ordem"
        className="grid size-7 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink disabled:opacity-30">
        <ArrowDown size={14} strokeWidth={1.75} />
      </button>
      <button type="button" onClick={() => remover(i)} aria-label="Tirar da sequência" title="Tirar da sequência"
        className="grid size-7 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-danger">
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  )
}

/** A LIGACAO entre a parte i e a i+1: so som, ou frase gravada. */
function Ligacao({ i, ligacao }: { i: number; ligacao: LigacaoNaTela }) {
  return (
    <div className="ml-[22px] flex flex-col gap-2.5 border-l-2 border-accent/40 py-3 pl-5" data-juntar="ligacao">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-medium text-ink-2">Ligação {i + 1}</span>
        <div className="w-[260px]">
          <Segmentos
            opcoes={[
              { valor: 'som' as const, rotulo: <><Volume2 size={11} strokeWidth={1.75} /> Só som</>, title: 'Um som no corte (o whoosh); a música de cada parte segue' },
              { valor: 'frase' as const, rotulo: <><Mic size={11} strokeWidth={1.75} /> Frase gravada</>, title: 'Uma frase entre as partes ("E não para por aí..."), com legenda e cena' },
            ]}
            ativo={(v) => v === ligacao.tipo}
            onChange={(v) => (v === 'som' ? useJuntar.getState().virarSom(i) : useJuntar.getState().virarFrase(i))}
          />
        </div>
        {ligacao.tipo === 'som' && <EscolherSom i={i} som={ligacao.som} />}
      </div>
      {ligacao.tipo === 'frase' && <Frase i={i} ligacao={ligacao} />}
    </div>
  )
}

const nomeDe = (c: string): string => c.split(/[\\/]/).pop() ?? c

/** A cena da Biblioteca pelo que ele reconhece: "Avatar Seven Havens · S01E01" (e nao "0015.mp4"). */
function nomeDaCena(c: string): string {
  const partes = c.split(/[\\/]/)
  const shots = partes.lastIndexOf('shots')
  return shots >= 2 ? `${partes[shots - 2]} · ${partes[shots - 1]}` : nomeDe(c)
}

function EscolherSom({ i, som }: { i: number; som: string | null }) {
  const sfx = useProject((s) => s.sfxFiles)
  const padrao = useJuntar((s) => s.somPadrao)
  const opcoes = [...new Set([...(padrao ? [padrao] : []), ...(som ? [som] : []), ...sfx])]
  return (
    <div className="flex items-center gap-2">
      <select
        value={som ?? ''}
        onChange={async (e) => {
          const v = e.target.value
          if (v === '__arquivo') {
            const r = await window.dangai.pickFiles()
            const escolhido = r.ok ? r.value.find((p) => classifyFile(p) === 'audio') : undefined
            if (escolhido) useJuntar.getState().mudarLigacao(i, { tipo: 'som', som: escolhido })
            return
          }
          useJuntar.getState().mudarLigacao(i, { tipo: 'som', som: v || null })
        }}
        aria-label={`Som da ligação ${i + 1}`}
        className="h-7 max-w-[300px] rounded-sm border border-line bg-elevated px-2 text-[12px] text-ink focus:border-accent focus:outline-none"
      >
        <option value="">Sem som (só o corte)</option>
        {opcoes.map((p) => (
          <option key={p} value={p}>
            {nomeDe(p)}
            {p === padrao ? ' (o do Pan)' : ''}
          </option>
        ))}
        <option value="__arquivo">Escolher outro arquivo...</option>
      </select>
      {som && <OuvirArquivo caminho={som} />}
    </div>
  )
}

/** Toca um arquivo do disco (o som da ligacao) pelo servidor do app. */
function OuvirArquivo({ caminho }: { caminho: string }) {
  const [tocando, setTocando] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => audio.current?.pause(), [])
  return (
    <button
      type="button"
      onClick={async () => {
        audio.current?.pause()
        const r = await window.dangai.analyzeAudio(caminho)
        if (!r.ok) return
        const a = new Audio(r.value.url)
        audio.current = a
        a.onended = () => setTocando(false)
        setTocando(true)
        void a.play().catch(() => setTocando(false))
      }}
      title="Ouvir o som"
      aria-label="Ouvir o som"
      className="grid size-7 place-items-center rounded-sm border border-line bg-elevated text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
    >
      {tocando ? <AudioLines size={13} strokeWidth={1.75} className="text-accent" /> : <Play size={12} strokeWidth={1.75} />}
    </button>
  )
}

/** A FRASE GRAVADA: o arquivo, o texto (a legenda), a cena, a velocidade e os efeitos, e o ouvir. */
function Frase({ i, ligacao }: { i: number; ligacao: Extract<LigacaoNaTela, { tipo: 'frase' }> }) {
  const mudar = (patch: Partial<Extract<LigacaoNaTela, { tipo: 'frase' }>>): void =>
    useJuntar.getState().mudarLigacao(i, { ...ligacao, ...patch })
  const mudarCadeia = (f: (c: CadeiaDeAudio) => CadeiaDeAudio): void => {
    // Os efeitos mudaram: o que ele ouviu antes nao vale mais.
    const atual = useJuntar.getState().ligacoes[i]
    if (atual?.tipo !== 'frase') return
    useJuntar.getState().mudarLigacao(i, { ...atual, cadeia: f(atual.cadeia), pronta: null })
  }
  const janela = useRef<Promise<void> | null>(null)
  const [efeitos, setEfeitos] = useState(false)
  const [ouvindo, setOuvindo] = useState<'preparando' | 'tocando' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => audio.current?.pause(), [])
  const biblioteca = useProject((s) => s.library)
  const capaDaCena = ligacao.cena ? (biblioteca?.clips.find((c) => c.path === ligacao.cena)?.thumbUrl ?? null) : null

  const escolherArquivo = async (): Promise<void> => {
    const r = await window.dangai.pickFiles()
    const arquivo = r.ok ? r.value.find((p) => classifyFile(p) === 'audio') : undefined
    if (!arquivo) return
    const a = await window.dangai.analyzeAudio(arquivo)
    mudar({ arquivo, duracaoBruta: a.ok ? a.value.durationSec : 0, pronta: null })
    setErro(null)
  }

  const ouvir = async (): Promise<void> => {
    if (!ligacao.arquivo) return
    audio.current?.pause()
    setErro(null)
    let pronta = ligacao.pronta
    if (!pronta) {
      setOuvindo('preparando')
      const r = await window.dangai.prepararFraseDeLigacao(ligacao.arquivo, ligacao.cadeia)
      if (!r.ok) {
        setOuvindo(null)
        setErro(r.error)
        return
      }
      pronta = r.value
      const atual = useJuntar.getState().ligacoes[i]
      if (atual?.tipo === 'frase') useJuntar.getState().mudarLigacao(i, { ...atual, pronta })
    }
    const a = new Audio(pronta.url)
    audio.current = a
    a.onended = () => setOuvindo(null)
    setOuvindo('tocando')
    void a.play().catch(() => setOuvindo(null))
  }

  const buscarCena = (): void => {
    useEscolhaAvulsa.getState().pedir({
      titulo: `Escolha a cena da ligação ${i + 1}`,
      aoEscolher: (caminho) => {
        const atual = useJuntar.getState().ligacoes[i]
        if (atual?.tipo === 'frase') useJuntar.getState().mudarLigacao(i, { ...atual, cena: caminho })
      },
    })
    void useProject.getState().openLibrary(true)
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface p-3.5" data-juntar="frase">
      {/* O ARQUIVO e o TEXTO. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void escolherArquivo()}
          className="flex h-8 max-w-[300px] items-center gap-2 rounded-sm border border-line bg-elevated px-3 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          title="A gravação da frase (crua: os efeitos entram aqui)"
        >
          <FileAudio size={13} strokeWidth={1.5} className={ligacao.arquivo ? 'text-accent' : ''} />
          <span className="truncate">{ligacao.arquivo ? nomeDe(ligacao.arquivo) : 'Escolher a gravação...'}</span>
          {ligacao.arquivo && <span className="tnum shrink-0 text-ink-3">{ligacao.duracaoBruta.toFixed(1)} s</span>}
        </button>
        <input
          value={ligacao.texto}
          onChange={(e) => mudar({ texto: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder='O que você falou: "E não para por aí..."'
          aria-label={`Texto da frase da ligação ${i + 1}`}
          className="h-8 min-w-[220px] flex-1 rounded-sm border border-line bg-elevated px-3 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void ouvir()}
          disabled={!ligacao.arquivo || ouvindo === 'preparando'}
          title="Ouvir a frase com os efeitos e a velocidade"
          className="flex h-8 items-center gap-1.5 rounded-sm border border-line bg-elevated px-3 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
        >
          {ouvindo === 'preparando' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : ouvindo === 'tocando' ? (
            <AudioLines size={13} strokeWidth={1.75} className="text-accent" />
          ) : (
            <Play size={12} strokeWidth={1.75} />
          )}
          {ouvindo === 'preparando' ? 'Preparando...' : 'Ouvir'}
        </button>
      </div>
      {erro && <p className="text-[11px] text-danger">{erro}</p>}

      {/* A CENA. */}
      <div className="flex items-center gap-2.5">
        <span className="w-[68px] shrink-0 text-[11px] text-ink-3">Cena</span>
        {capaDaCena ? (
          <img src={capaDaCena} alt="" className="h-[34px] w-[60px] shrink-0 rounded-[4px] object-cover" />
        ) : (
          <span className="grid h-[34px] w-[60px] shrink-0 place-items-center rounded-[4px] bg-elevated text-ink-3">
            <LibraryIcon size={12} strokeWidth={1.5} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
          {ligacao.cena ? nomeDaCena(ligacao.cena) : 'A primeira cena da parte seguinte'}
        </span>
        <button
          type="button"
          onClick={buscarCena}
          className="flex h-7 items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
        >
          <LibraryIcon size={12} strokeWidth={1.5} />
          Buscar na biblioteca
        </button>
        {ligacao.cena && (
          <button type="button" onClick={() => mudar({ cena: null })} title="Volta para a primeira cena da parte seguinte"
            className="grid size-7 place-items-center rounded-sm text-ink-3 hover:text-ink" aria-label="Tirar a cena escolhida">
            <X size={12} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {/* A VELOCIDADE e os EFEITOS, os da etapa de Audio. */}
      <div className="flex items-center gap-2.5">
        <span className="w-[68px] shrink-0 text-[11px] text-ink-3">Velocidade</span>
        <Velocidade rotulo={false} valor={ligacao.cadeia.velocidade ?? 100} onChange={(v) => mudarCadeia((c) => ({ ...c, velocidade: v }))} />
      </div>
      <button
        type="button"
        onClick={() => setEfeitos((v) => !v)}
        aria-expanded={efeitos}
        className="flex items-center gap-1.5 self-start rounded-sm px-1 py-0.5 text-[12px] text-ink-2 transition-colors hover:text-ink"
      >
        <ChevronDown size={13} strokeWidth={1.75} className={['transition-transform', efeitos ? '' : '-rotate-90'].join(' ')} />
        Efeitos da voz <span className="text-ink-3">(os mesmos da etapa de Áudio; começa com o seu padrão)</span>
      </button>
      {efeitos && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-3">
          <Efeitos
            cadeia={ligacao.cadeia}
            janela={janela}
            mudar={mudarCadeia}
            salvarPadrao={() => void window.dangai.saveSettings({ cadeiaDeAudio: ligacao.cadeia })}
          />
        </div>
      )}
    </div>
  )
}
