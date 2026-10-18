import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, EyeOff, Link2, Unlink, X } from 'lucide-react'
import { chaveDaPessoa, limparNome, NOME_MAX, SIMILARIDADE_FORTE, type ElencoDaDescoberta, type GrupoDeRostos } from '../../shared/descoberta'
import { CAMPO_NORMAL, CAMPO_PEQUENO, CLASSE_DO_CAMPO, COR_DE_AVISO } from './pecas'

/**
 * UM GRUPO DE ROSTOS do Reconhecer na mao (ReconhecerNaMao.tsx): o cartao da
 * grade, o campo do nome com o elenco como sugestao e o grupo ampliado.
 *
 * O cartao segue o da grade do passo 4 (GradeDasCenas, CartaoDaCena): borda
 * neutra, rosa so no que esta escolhido (aqui, selecionado para juntar), os
 * numeros em 11 px e o resto no tooltip. Ignorado fica apagado, como a cena
 * ja usada em outra frase.
 *
 * O nome: os conhecidos (batizados em outro episodio) ja vem preenchidos. O
 * palpite do motor para os outros aparece DENTRO do campo, em CINZA (rosa e
 * "escolhido" no app; o palpite nao conta como nome ate ele aceitar). Palpite
 * FORTE (>= SIMILARIDADE_FORTE): o Enter aceita. Fraco: so a dica "parece X?",
 * e o Enter nao aceita -- na auditoria de 15/10 os palpites errados vinham com
 * 0,90 a 0,94, e aceitar no embalo rotulava errado e gravava referencia errada.
 */

/** Quantos rostos a tira do cartao mostra (o resto no ampliado). */
const ROSTOS_NA_TIRA = 5
/** Quantas linhas a lista do elenco mostra antes de rolar. */
const OPCOES_MAX = 30
/** Abaixo disto de espaco ate o rodape, a lista abre para cima. */
const ESPACO_DA_LISTA = 260

/** "Liston, Nia" (com ou sem acento) -> "liston nia": para casar o que ele digita com o elenco. */
function normal(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

interface Opcao {
  nome: string
  foto: string | null
  /** O palpite do motor para este grupo. */
  sugestao: boolean
  /** Outro grupo ja tem este nome: escolher junta os dois. */
  junta: boolean
}

/**
 * O elenco filtrado pelo que ele digitou. Vazio: o palpite primeiro e o
 * elenco inteiro. Digitando: comeca com > palavra que comeca com > contem.
 */
function opcoesDoElenco(
  elenco: readonly ElencoDaDescoberta[],
  texto: string,
  sugestao: string | null,
  usadosPorOutros: ReadonlySet<string>,
): Opcao[] {
  const q = normal(texto)
  const lista: (ElencoDaDescoberta & { nota: number })[] = []
  const vistos = new Set<string>()
  const pontuar = (nome: string): number | null => {
    if (!q) return 1
    const n = normal(nome)
    if (n.startsWith(q)) return 0
    if (n.split(' ').some((t) => t.startsWith(q))) return 1
    return n.includes(q) ? 2 : null
  }
  if (sugestao) {
    const nota = pontuar(sugestao)
    if (nota !== null) {
      const foto = elenco.find((e) => e.nome === sugestao)?.foto ?? null
      lista.push({ nome: sugestao, foto, nota: -1 })
      vistos.add(sugestao)
    }
  }
  for (const e of elenco) {
    if (vistos.has(e.nome)) continue
    const nota = pontuar(e.nome)
    if (nota === null) continue
    vistos.add(e.nome)
    lista.push({ ...e, nota })
  }
  return lista
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.nota - b.e.nota || a.i - b.i)
    .slice(0, OPCOES_MAX)
    .map(({ e }) => ({
      nome: e.nome,
      foto: e.foto,
      sugestao: e.nome === sugestao,
      junta: usadosPorOutros.has(chaveDaPessoa(e.nome)),
    }))
}

/** A foto pequena do elenco, ou a inicial. */
function Avatar({ foto, nome }: { foto: string | null; nome: string }) {
  const [quebrou, setQuebrou] = useState(false)
  if (foto && !quebrou) {
    return <img src={foto} alt="" draggable={false} onError={() => setQuebrou(true)} className="size-5 shrink-0 rounded-full object-cover" />
  }
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface text-[10px] text-ink-3">
      {nome.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** O palpite do motor e forte o bastante para o Enter aceitar? */
export function palpiteForte(sugestao: GrupoDeRostos['sugestao']): boolean {
  return sugestao !== null && sugestao.similaridade >= SIMILARIDADE_FORTE
}

export interface PropsDoCampo {
  grupoKey: number
  valor: string
  /** O palpite do motor (so dica; o conhecido ja vem em `valor`). */
  sugestao: GrupoDeRostos['sugestao']
  conhecido: boolean
  elenco: readonly ElencoDaDescoberta[]
  /** Pessoa (chaveDaPessoa do nome que vai ao motor) -> quantos grupos tem ela. Escolher uma que outro grupo tem junta os dois. */
  usados: ReadonlyMap<string, number>
  /** A pessoa deste grupo agora (chaveDaPessoa), '' sem nome: conta uma vez a menos em `usados`. */
  proprio: string
  desligado: boolean
  grande?: boolean
  /** Para o Tab/Enter achar o campo do proximo grupo. Sem ela (no ampliado), o campo nao entra na fila. */
  ancora?: boolean
  onNome: (key: number, nome: string) => void
  /** Vai ao campo do grupo seguinte (1) ou anterior (-1). false = nao ha. */
  onProximo: (key: number, direcao: 1 | -1) => boolean
  /** Shift+Enter: o grupo ampliado. */
  onAmpliar?: (key: number) => void
  /**
   * O1 (atalhos): o Enter aceitou o nome. Com ele, o foco vai ao CARTAO
   * seguinte (onde 1-9, I e J valem); sem ele, ao campo seguinte, como antes.
   */
  onAceito?: (key: number) => void
  /** O1: Esc com a lista fechada devolve o foco ao cartao (sem ele, o Esc fecha a tela). */
  onSair?: (key: number) => void
}

/**
 * O CAMPO DO NOME com o elenco como lista (combobox): setas andam, Enter
 * aceita e vai ao proximo grupo, Tab COMPLETA com a opcao marcada (digitar ja
 * marca a melhor) e vai ao proximo, Esc fecha a lista e vale o digitado. O
 * nome escolhido do elenco entra EXATO como a fonte escreve: e por ele que as
 * fotos casam no proximo episodio.
 *
 * A opcao marcada fica em `data-marcada` no campo: o Ctrl+Enter da tela (que
 * pega a tecla antes do campo) aplica ela antes de confirmar, e "lyn" com
 * "Lynette Blanc" marcada nao vira personagem "lyn".
 */
export function CampoDoNome({
  grupoKey,
  valor,
  sugestao,
  conhecido,
  elenco,
  usados,
  proprio,
  desligado,
  grande = false,
  ancora = true,
  onNome,
  onProximo,
  onAmpliar,
  onAceito,
  onSair,
}: PropsDoCampo) {
  const [aberta, setAberta] = useState(false)
  const [marcado, setMarcado] = useState(-1)
  const [paraCima, setParaCima] = useState(false)
  const campo = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLUListElement>(null)
  const palpite = !conhecido && sugestao ? sugestao.nome : null
  const forte = palpite !== null && palpiteForte(sugestao)
  // As pessoas dos OUTROS grupos: a deste grupo conta uma vez a menos.
  const usadosPorOutros = useMemo(() => {
    const outros = new Set<string>()
    for (const [n, c] of usados) if (c - (n === proprio ? 1 : 0) > 0) outros.add(n)
    return outros
  }, [usados, proprio])
  const opcoes = useMemo(() => opcoesDoElenco(elenco, valor, palpite, usadosPorOutros), [elenco, valor, palpite, usadosPorOutros])
  const mostra = aberta && opcoes.length > 0 && !desligado
  const idDaLista = `elenco-${grupoKey}${ancora ? '' : '-amp'}`

  useLayoutEffect(() => {
    if (!mostra || marcado < 0) return
    lista.current?.children[marcado]?.scrollIntoView({ block: 'nearest' })
  }, [mostra, marcado])

  const abrir = (destacar: number): void => {
    const caixa = campo.current?.getBoundingClientRect()
    if (caixa) setParaCima(window.innerHeight - caixa.bottom < ESPACO_DA_LISTA && caixa.top > ESPACO_DA_LISTA)
    setAberta(true)
    setMarcado(destacar)
  }
  const fechar = (): void => {
    setAberta(false)
    setMarcado(-1)
  }
  const escolhida = (): Opcao | null => (mostra && marcado >= 0 ? (opcoes[marcado] ?? null) : null)

  const tocou = valor.trim() === '' && palpite !== null
  const nomeConhecido = conhecido && sugestao !== null && valor.trim() === sugestao.nome
  const pct = Math.round((sugestao?.similaridade ?? 0) * 100)
  const dica = [
    palpite
      ? forte
        ? `Parece ${palpite} (${pct}%). Enter aceita.`
        : `Talvez ${palpite} (${pct}%, palpite fraco). Confira e escolha na lista.`
      : null,
    nomeConhecido ? 'Conhecido de outro episodio.' : null,
    'Enter: aceita e vai ao proximo · Tab: completa e vai ao proximo · Esc: volta ao cartao · Shift+Enter: ver o grupo',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className="relative min-w-0">
      <input
        ref={campo}
        type="text"
        value={valor}
        maxLength={NOME_MAX}
        disabled={desligado}
        data-campo-grupo={ancora ? grupoKey : undefined}
        data-grupo-do-campo={grupoKey}
        data-marcada={escolhida()?.nome ?? undefined}
        role="combobox"
        aria-label="Nome do personagem"
        aria-expanded={mostra}
        aria-controls={idDaLista}
        aria-autocomplete="list"
        aria-activedescendant={mostra && marcado >= 0 ? `${idDaLista}-${marcado}` : undefined}
        placeholder={palpite ? (forte ? palpite : `parece ${palpite}?`) : 'Nome'}
        title={dica}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          const texto = e.target.value
          onNome(grupoKey, texto)
          // Digitando: a melhor do elenco fica marcada (Enter/Tab completam); Esc fecha e vale o digitado.
          abrir(texto.trim() ? 0 : -1)
        }}
        onFocus={(e) => {
          e.currentTarget.select()
          if (!valor.trim()) abrir(-1)
        }}
        onBlur={fechar}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!mostra) abrir(0)
            else setMarcado((m) => Math.min(opcoes.length - 1, m + 1))
          } else if (e.key === 'ArrowUp') {
            if (!mostra) return
            e.preventDefault()
            setMarcado((m) => Math.max(-1, m - 1))
          } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault()
            if (e.shiftKey) {
              fechar()
              onAmpliar?.(grupoKey)
              return
            }
            const o = escolhida()
            if (o) onNome(grupoKey, o.nome)
            // So o palpite FORTE entra com o Enter; o fraco e so dica.
            else if (tocou && palpite && forte) onNome(grupoKey, palpite)
            fechar()
            if (onAceito) onAceito(grupoKey)
            else onProximo(grupoKey, 1)
          } else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const o = escolhida()
            if (o) onNome(grupoKey, o.nome)
            fechar()
            if (onProximo(grupoKey, e.shiftKey ? -1 : 1)) e.preventDefault()
          } else if (e.key === 'Escape' && mostra) {
            e.preventDefault()
            fechar()
          } else if (e.key === 'Escape' && onSair) {
            // O1: Esc no campo volta ao cartao; o segundo Esc fecha a tela.
            e.preventDefault()
            e.stopPropagation()
            onSair(grupoKey)
          }
        }}
        className={[CLASSE_DO_CAMPO, grande ? CAMPO_NORMAL : CAMPO_PEQUENO, 'w-full', (tocou && forte) || nomeConhecido ? 'pr-[68px]' : ''].join(' ')}
      />
      {tocou && forte && !desligado && (
        <span
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-sm border border-line px-1 text-[10px] leading-4 text-ink-3"
          aria-hidden="true"
        >
          Enter
        </span>
      )}
      {nomeConhecido && (
        <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[10px] text-ink-3">
          <Check size={10} strokeWidth={2.25} className="text-accent" />
          conhecido
        </span>
      )}
      {mostra && (
        <ul
          ref={lista}
          id={idDaLista}
          role="listbox"
          aria-label="Elenco"
          className={[
            'absolute inset-x-0 z-30 max-h-[224px] overflow-y-auto rounded-sm border border-line-strong bg-elevated py-1 shadow-lg shadow-black/40',
            paraCima ? 'bottom-full mb-1' : 'top-full mt-1',
          ].join(' ')}
        >
          {opcoes.map((o, i) => (
            <li
              key={o.nome}
              id={`${idDaLista}-${i}`}
              role="option"
              aria-selected={i === marcado}
              // mousedown, e nao click: o blur do campo fecharia a lista antes do clique.
              onMouseDown={(e) => {
                e.preventDefault()
                onNome(grupoKey, o.nome)
                fechar()
              }}
              // So o mouse MEXENDO marca: a lista abre sozinha no foco, e um
              // cursor parado em cima dela (o mouseenter da abertura, sem
              // movimento) marcava uma opcao que o Enter aceitava.
              onMouseMove={(e) => {
                if ((e.movementX !== 0 || e.movementY !== 0) && marcado !== i) setMarcado(i)
              }}
              title={o.junta ? `${o.nome}: outro grupo ja tem este nome (viram um personagem so)` : o.nome}
              className={[
                'flex h-7 cursor-pointer items-center gap-2 px-2 text-[12px]',
                i === marcado ? 'bg-accent-dim text-ink' : 'text-ink-2 hover:bg-surface',
              ].join(' ')}
            >
              <Avatar foto={o.foto} nome={o.nome} />
              <span className="min-w-0 flex-1 truncate">{o.nome}</span>
              {o.sugestao && <span className="shrink-0 text-[10px] text-ink-3">{forte ? 'palpite' : 'parece?'}</span>}
              {o.junta && <Link2 size={11} strokeWidth={1.75} className="shrink-0 text-ink-3" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Um recorte de rosto. Quebrado (arquivo sumiu), fica o fundo. */
function Rosto({
  url,
  removido,
  onClick,
  title,
  grande = false,
}: {
  url: string
  removido: boolean
  onClick: () => void
  title: string
  grande?: boolean
}) {
  const [quebrou, setQuebrou] = useState(false)
  useEffect(() => setQuebrou(false), [url])
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'relative aspect-square w-full overflow-hidden border bg-elevated transition-colors duration-150',
        grande ? 'rounded-sm' : 'rounded-[3px]',
        removido ? 'border-danger/60' : 'border-transparent hover:border-line-strong',
      ].join(' ')}
    >
      {/* '' = recorte que sumiu do disco (o main guarda a posicao, por causa dos removidos): fica o fundo. */}
      {!quebrou && url !== '' && (
        <img
          src={url}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setQuebrou(true)}
          className={['size-full object-cover', removido ? 'opacity-30 grayscale' : ''].join(' ')}
        />
      )}
      {removido && (
        <span className="absolute inset-0 grid place-items-center">
          <X size={grande ? 28 : 14} strokeWidth={2} className="text-danger" />
        </span>
      )}
    </button>
  )
}

/** Um botaozinho do cartao (Ignorar, Separar): o neutro pequeno do app, ligado = o "escolhido". */
function BotaoDoCartao({
  ligado = false,
  onClick,
  title,
  desligado,
  children,
}: {
  ligado?: boolean
  onClick: () => void
  title: string
  desligado?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={desligado}
      aria-pressed={ligado}
      className={[
        'flex h-6 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-[11px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
        ligado ? 'border-line-strong bg-surface text-ink' : 'border-line bg-elevated text-ink-3 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** O conjunto juntado em que o grupo esta, para o cartao. */
export interface JuntoNoCartao {
  /** Quantos grupos no conjunto. */
  total: number
  /** Este e o primeiro do conjunto (o dono do nome). */
  dono: boolean
}

export interface PropsDoGrupo {
  grupo: GrupoDeRostos
  nome: string
  /** O nome que vai ao motor quando difere do digitado (a grafia do elenco), ou null. */
  vira: string | null
  /** A pessoa deste grupo agora (chaveDaPessoa), '' sem nome. */
  proprio: string
  ignorado: boolean
  junto: JuntoNoCartao | null
  /** Outro grupo tem o mesmo nome (sem estar juntado): o motor junta os dois. */
  mesmoNome: boolean
  /** O personagem deste nome fica com menos cenas que o motor aceita. */
  poucasCenas: boolean
  removidos: readonly number[]
  selecionado: boolean
  elenco: readonly ElencoDaDescoberta[]
  usados: ReadonlyMap<string, number>
  desligado: boolean
  onNome: (key: number, nome: string) => void
  onIgnorar: (key: number, ignorar: boolean) => void
  onSeparar: (key: number) => void
  onSelecionar: (key: number) => void
  onAmpliar: (key: number) => void
  onProximo: (key: number, direcao: 1 | -1) => boolean
  /** O1: o cartao com o cursor do teclado (onde 1-9, Enter, I e J valem). */
  atual?: boolean
  /** O1: escolher a sugestao (o chip numerado, ou a tecla). */
  onEscolher?: (key: number, nome: string) => void
  onAceito?: (key: number) => void
  onSair?: (key: number) => void
}

/** O1: as sugestoes numeradas (1-9) do cartao com o cursor: chip com a foto e o numero da tecla. */
function SugestoesNumeradas({
  grupo,
  elenco,
  nome,
  desligado,
  onEscolher,
}: {
  grupo: GrupoDeRostos
  elenco: readonly ElencoDaDescoberta[]
  nome: string
  desligado: boolean
  onEscolher: (key: number, nome: string) => void
}) {
  const lista = grupo.sugestoes.length ? grupo.sugestoes : grupo.sugestao ? [grupo.sugestao] : []
  if (lista.length === 0) return null
  const fotos = new Map(elenco.map((e) => [e.nome, e.foto]))
  return (
    <div className="flex min-w-0 flex-wrap gap-1" role="list" aria-label="Sugestoes">
      {lista.slice(0, 9).map((sug, i) => {
        const escolhido = limparNome(nome) === sug.nome
        return (
          <button
            key={sug.nome}
            type="button"
            role="listitem"
            disabled={desligado}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onEscolher(grupo.key, sug.nome)}
            title={`${sug.nome} (${Math.round(sug.similaridade * 100)}%) - tecla ${i + 1}`}
            className={[
              'flex h-6 max-w-[140px] items-center gap-1 rounded-sm border pl-0.5 pr-1.5 text-[11px] transition-colors duration-150',
              escolhido ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:text-ink',
            ].join(' ')}
          >
            <span className="tnum grid size-4 shrink-0 place-items-center rounded-[3px] bg-surface text-[10px] text-ink-3">{i + 1}</span>
            <Avatar foto={fotos.get(sug.nome) ?? null} nome={sug.nome} />
            <span className="min-w-0 truncate">{sug.nome}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * O CARTAO DE UM GRUPO: a tira de rostos (clicar amplia o grupo inteiro), o
 * nome, as cenas e os rostos, Ignorar e, juntado, Separar. A bolinha no canto
 * seleciona para juntar (2+ selecionados: "Juntar" na barra de cima).
 */
export const CartaoDoGrupo = memo(function CartaoDoGrupo({
  grupo,
  nome,
  vira,
  proprio,
  ignorado,
  junto,
  mesmoNome,
  poucasCenas,
  removidos,
  selecionado,
  elenco,
  usados,
  desligado,
  onNome,
  onIgnorar,
  onSeparar,
  onSelecionar,
  onAmpliar,
  onProximo,
  atual = false,
  onEscolher,
  onAceito,
  onSair,
}: PropsDoGrupo) {
  const tira = grupo.rostos.slice(0, ROSTOS_NA_TIRA)
  const fora = new Set(removidos)
  const nomeado = nome.trim() !== ''
  const escondidos = grupo.rostos.length - tira.length
  return (
    <div
      data-grupo={grupo.key}
      data-cartao-grupo={grupo.key}
      tabIndex={-1}
      aria-current={atual ? 'true' : undefined}
      className={[
        'flex min-w-0 flex-col gap-2 rounded-sm border p-2 outline-none transition-[border-color,background-color,opacity,box-shadow] duration-150',
        selecionado ? 'border-accent bg-accent-dim' : nomeado && !ignorado ? 'border-line-strong bg-surface' : 'border-line bg-surface',
        // O1: o cursor do teclado (1-9, Enter, I, J): um contorno neutro, o rosa e do "escolhido".
        atual ? 'shadow-[0_0_0_1px_var(--color-ink-3)]' : '',
        // So o campo do nome reacende o ignorado: com o foco no botao Ignorar ele apagava so quando o foco saia.
        ignorado && !selecionado ? 'opacity-45 hover:opacity-100 has-[input:focus]:opacity-100' : '',
      ].join(' ')}
    >
      <div className="relative grid grid-cols-5 gap-1">
        {tira.map((url, i) => (
          <Rosto
            key={`${i}-${url}`}
            url={url}
            removido={fora.has(i)}
            onClick={() => onAmpliar(grupo.key)}
            title={fora.has(i) ? 'Fora das referencias. Clique para ver o grupo.' : 'Ver o grupo inteiro'}
          />
        ))}
        {tira.length === 0 && (
          <span className="col-span-5 grid aspect-[5/1] place-items-center rounded-[3px] bg-elevated text-[11px] text-ink-3">sem recorte</span>
        )}
        {escondidos > 0 && (
          <span className="tnum pointer-events-none absolute bottom-1 right-1 rounded-sm bg-black/70 px-1 py-0.5 text-[10px] text-white">
            +{escondidos}
          </span>
        )}
        <button
          type="button"
          role="checkbox"
          aria-checked={selecionado}
          aria-label="Selecionar para juntar"
          onClick={() => onSelecionar(grupo.key)}
          disabled={desligado}
          title={selecionado ? 'Tirar da selecao' : 'Selecionar para juntar com outro grupo'}
          className={[
            'absolute left-1 top-1 grid size-[18px] place-items-center rounded-full border transition-colors duration-150',
            selecionado ? 'border-accent bg-accent text-white' : 'border-white/50 bg-black/45 text-transparent hover:border-white',
          ].join(' ')}
        >
          <Check size={11} strokeWidth={2.5} />
        </button>
      </div>

      <CampoDoNome
        grupoKey={grupo.key}
        valor={nome}
        sugestao={grupo.sugestao}
        conhecido={grupo.conhecido}
        elenco={elenco}
        usados={usados}
        proprio={proprio}
        desligado={desligado}
        onNome={onNome}
        onProximo={onProximo}
        onAmpliar={onAmpliar}
        onAceito={onAceito}
        onSair={onSair}
      />

      {atual && onEscolher && !ignorado && (
        <SugestoesNumeradas grupo={grupo} elenco={elenco} nome={nome} desligado={desligado} onEscolher={onEscolher} />
      )}

      <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-[11px] text-ink-3">
        <span className="shrink-0" title={`${grupo.cenas} ${grupo.cenas === 1 ? 'cena' : 'cenas'} · ${grupo.totalDeRostos} rostos`}>
          <span className="tnum text-ink-2">{grupo.cenas}</span> {grupo.cenas === 1 ? 'cena' : 'cenas'}
        </span>
        {(junto || mesmoNome) && !ignorado && (
          <span
            className="flex shrink-0 items-center gap-1 text-ink-2"
            title={
              junto
                ? `Juntado: ${junto.total} grupos viram um personagem${junto.dono ? ' (este da o nome)' : ''}`
                : 'Outro grupo tem este nome: viram um personagem so'
            }
          >
            <Link2 size={11} strokeWidth={1.75} />
            {junto ? `junto ${junto.total}` : 'junta'}
          </span>
        )}
        {vira && !ignorado && (
          <span className="min-w-0 truncate" title={`Vai salvo como "${vira}" (o nome do elenco, ou o mesmo de outro grupo)`}>
            = {vira}
          </span>
        )}
        {poucasCenas && nomeado && !ignorado && (
          <span className={`shrink-0 ${COR_DE_AVISO}`} title="Menos de 4 cenas: o motor descarta este personagem. Junte com outro grupo dele.">
            poucas
          </span>
        )}
        <span className="flex-1" />
        {junto && (
          <BotaoDoCartao onClick={() => onSeparar(grupo.key)} title="Nao e o mesmo personagem: separa do conjunto" desligado={desligado}>
            <Unlink size={11} strokeWidth={1.75} />
            Separar
          </BotaoDoCartao>
        )}
        <BotaoDoCartao
          ligado={ignorado}
          onClick={() => onIgnorar(grupo.key, !ignorado)}
          title={ignorado ? 'Voltar a considerar este grupo (o nome volta)' : 'Figurante ou rosto errado: fica sem personagem'}
          desligado={desligado}
        >
          <EyeOff size={11} strokeWidth={1.75} />
          {ignorado ? 'Ignorado' : 'Ignorar'}
        </BotaoDoCartao>
      </div>
    </div>
  )
})

/**
 * O GRUPO AMPLIADO: todos os recortes grandes. Clicar num rosto tira (ou
 * devolve) das referencias -- um rosto alheio no grupo estraga o
 * reconhecimento dos proximos episodios. As setas andam entre os grupos. O
 * mesmo fundo do player do passo 4 (preto quase cheio, painel embaixo).
 */
export function GrupoAmpliado({
  grupo,
  posicao,
  total,
  nome,
  proprio,
  ignorado,
  removidos,
  elenco,
  usados,
  desligado,
  onNome,
  onIgnorar,
  onAlternarRosto,
  onIr,
  onFechar,
}: {
  grupo: GrupoDeRostos
  /** 0-based, na ordem da grade. */
  posicao: number
  total: number
  nome: string
  proprio: string
  ignorado: boolean
  removidos: readonly number[]
  elenco: readonly ElencoDaDescoberta[]
  usados: ReadonlyMap<string, number>
  desligado: boolean
  onNome: (key: number, nome: string) => void
  onIgnorar: (key: number, ignorar: boolean) => void
  onAlternarRosto: (key: number, indice: number) => void
  /** Vai ao grupo seguinte (1) ou anterior (-1). false = nao ha. */
  onIr: (direcao: 1 | -1) => boolean
  onFechar: () => void
}) {
  // So indice que existe conta (um removido fora da lista nao tira nada no motor).
  const fora = new Set(removidos.filter((i) => i >= 0 && i < grupo.rostos.length))
  const viram = grupo.rostos.length - fora.size
  const titulo = limparNome(nome) || 'Sem nome'
  // O foco entra aqui (e nao no campo): as setas andam e os numeros tiram rosto; uma letra vai ao nome vazio.
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    caixa.current?.focus()
  }, [])
  return (
    // bg-black/95: com /92 os nomes da grade atras apareciam por baixo do titulo do grupo.
    <div className="fixed inset-0 z-[37] flex flex-col items-center justify-center bg-black/95 p-6" onClick={onFechar}>
      <div
        ref={caixa}
        tabIndex={-1}
        role="dialog"
        aria-label="Grupo ampliado"
        className="flex max-h-full w-full max-w-[980px] flex-col gap-3 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 text-[12px] text-ink-2">
          <span className="min-w-0 flex-1 truncate">
            <span className={nome.trim() && !ignorado ? 'text-ink' : 'text-ink-3'}>{ignorado ? `${titulo} (ignorado)` : titulo}</span>
            <span className="tnum text-ink-3">
              {' '}
              · {grupo.cenas} {grupo.cenas === 1 ? 'cena' : 'cenas'} · {grupo.rostos.length} de {grupo.totalDeRostos} rostos
            </span>
          </span>
          <span className="tnum text-ink-3" title="A posicao do grupo na grade">
            {posicao + 1} de {total}
          </span>
          <button type="button" onClick={onFechar} aria-label="Fechar o grupo" title="Fechar (Esc)" className="text-ink-3 hover:text-ink">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="relative flex min-h-0 items-center justify-center">
          <button
            type="button"
            disabled={posicao <= 0}
            onClick={() => onIr(-1)}
            aria-label="Grupo anterior"
            title="Grupo anterior (seta para a esquerda)"
            className="absolute -left-2 z-10 grid size-10 place-items-center rounded-full bg-black/60 text-white hover:bg-accent disabled:opacity-20"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="grid w-full max-w-[860px] grid-cols-4 gap-2 overflow-y-auto">
            {grupo.rostos.map((url, i) => (
              <Rosto
                key={`${i}-${url}`}
                url={url}
                grande
                removido={fora.has(i)}
                onClick={() => {
                  if (!desligado) onAlternarRosto(grupo.key, i)
                }}
                title={fora.has(i) ? `Devolver as referencias (${i + 1})` : `Nao e dele: tirar das referencias (${i + 1})`}
              />
            ))}
            {grupo.rostos.length === 0 && (
              <span className="col-span-4 grid h-40 place-items-center text-[12px] text-ink-3">Sem recorte neste grupo.</span>
            )}
          </div>
          <button
            type="button"
            disabled={posicao >= total - 1}
            onClick={() => onIr(1)}
            aria-label="Proximo grupo"
            title="Proximo grupo (seta para a direita)"
            className="absolute -right-2 z-10 grid size-10 place-items-center rounded-full bg-black/60 text-white hover:bg-accent disabled:opacity-20"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-md bg-bg px-3 py-3">
          <div className="w-[320px] max-w-full">
            <CampoDoNome
              grupoKey={grupo.key}
              valor={nome}
              sugestao={grupo.sugestao}
              conhecido={grupo.conhecido}
              elenco={elenco}
              usados={usados}
              proprio={proprio}
              desligado={desligado}
              grande
              ancora={false}
              onNome={onNome}
              onProximo={(_key, direcao) => onIr(direcao)}
            />
          </div>
          <BotaoDoCartao
            ligado={ignorado}
            onClick={() => onIgnorar(grupo.key, !ignorado)}
            title={ignorado ? 'Voltar a considerar este grupo (o nome volta)' : 'Figurante ou rosto errado: fica sem personagem'}
            desligado={desligado}
          >
            <EyeOff size={11} strokeWidth={1.75} />
            {ignorado ? 'Ignorado' : 'Ignorar'}
          </BotaoDoCartao>
          <span className="tnum text-[11px] text-ink-3" title="Os recortes que viram foto de referencia (ate 10 por personagem)">
            {viram} de {grupo.rostos.length} viram referencia
          </span>
          <span className="flex-1" />
          <span className="text-[11px] text-ink-3">
            Clique no rosto que nao e dele · 1-{Math.max(1, Math.min(8, grupo.rostos.length))} tira · setas: outro grupo · Esc fecha
          </span>
        </div>
      </div>
    </div>
  )
}
