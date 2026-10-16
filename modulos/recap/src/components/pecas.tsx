import { useEffect, useRef, useState } from 'react'
import { Check, FolderOpen, TriangleAlert } from 'lucide-react'
import type { StatusDoMotor } from '../../shared/episodio'

/**
 * As pecas pequenas do assistente "Gerar recap": cartao de secao, botoes,
 * caixinha de marcar, campo de tempo e os avisos. Seguem os mesmos tokens e
 * classes do resto do app (painel.tsx, Settings, Biblioteca) para o assistente
 * parecer parte dele, e nao um enxerto.
 */

/** 89.5 -> "1:29.5"; 3725 -> "1:02:05". `decimais` 0 arredonda para o segundo. */
export function formatarTempo(seg: number, decimais = 0): string {
  const s = Math.max(0, seg)
  const fator = 10 ** decimais
  const arredondado = Math.round(s * fator) / fator
  const h = Math.floor(arredondado / 3600)
  const m = Math.floor((arredondado % 3600) / 60)
  const resto = arredondado - h * 3600 - m * 60
  const inteiro = Math.floor(resto)
  const frac = decimais > 0 ? (resto - inteiro).toFixed(decimais).slice(1) : ''
  const ss = `${String(inteiro).padStart(2, '0')}${frac === '.0' ? '' : frac}`
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * O inverso, tolerante: "1:29", "1:29.5", "89", "89,5", "0:01:29". null quando
 * nao da para ler -- o campo volta ao valor anterior em vez de inventar um.
 */
export function lerTempo(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.')
  if (!limpo) return null
  const partes = limpo.split(':')
  if (partes.length > 3) return null
  let total = 0
  for (const parte of partes) {
    if (!/^\d+(\.\d+)?$/.test(parte)) return null
    total = total * 60 + Number(parte)
  }
  return Number.isFinite(total) ? total : null
}

/** 90 -> "1m30s"; 42 -> "42s". Para duracoes de trecho, onde "1:30" confundiria com posicao. */
export function duracaoCurta(seg: number): string {
  const s = Math.round(Math.max(0, seg))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r}s`
  return r === 0 ? `${m}min` : `${m}m${String(r).padStart(2, '0')}s`
}

/**
 * Um bloco do passo: borda, titulo pequeno em caixa alta e o conteudo. O mesmo
 * desenho do Grupo do painel (painel.tsx), so com mais respiro: borda neutra e
 * titulo sem icone. Rosa fica para o que esta escolhido e para a UMA acao
 * principal da tela -- secao rosa ao lado de botao rosa era rosa demais.
 */
export function Secao({
  titulo,
  acao,
  children,
}: {
  titulo: string
  /** Controles no canto do titulo. */
  acao?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="enter flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <header className="flex min-h-7 items-center gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{titulo}</h3>
        <span className="flex-1" />
        {acao}
      </header>
      {children}
    </section>
  )
}

/** O rotulo de um pedaco dentro da secao ("Personagens", "Legenda"), com o canto opcional. */
export function Subtitulo({
  icone,
  children,
  canto,
}: {
  icone: React.ReactNode
  children: React.ReactNode
  canto?: React.ReactNode
}) {
  return (
    <div className="flex min-h-5 items-center gap-1.5">
      <span className="text-ink-3">{icone}</span>
      <span className="text-[11px] font-medium text-ink-2">{children}</span>
      <span className="flex-1" />
      {canto}
    </div>
  )
}

/**
 * Os botoes do assistente. `principal` e o rosa apagado que o app usa para a
 * acao que leva adiante ("Adicionar ao projeto") -- um por tela. O resto e o
 * neutro.
 *
 * Desligado PARECE desligado: cai no neutro apagado, sem borda rosa e sem o
 * `lift` (subir 1px no hover diz "clique aqui"). O principal tambem nao usa o
 * `lift`, que troca a borda pela cinza no hover: o hover dele reforca o rosa.
 *
 * Altura fixa (h-8 / h-7), a mesma dos campos (CAMPO_NORMAL / CAMPO_PEQUENO):
 * botao e campo na mesma linha ficam na mesma reta.
 */
export function Botao({
  onClick,
  disabled,
  title,
  principal = false,
  pequeno = false,
  foco,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  principal?: boolean
  pequeno?: boolean
  /** Nome para devolver o foco do teclado a este botao depois de uma acao (focarBotao). */
  foco?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-foco={foco}
      className={[
        'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border font-medium',
        pequeno ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3.5 text-[13px]',
        disabled
          ? 'cursor-not-allowed border-line bg-elevated text-ink-2 opacity-40'
          : principal
            ? 'border-accent bg-accent-dim text-ink transition-colors duration-150 hover:bg-accent-glow'
            : 'lift border-line bg-elevated text-ink-2 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/**
 * O link discreto das Configuracoes ("Pegar uma chave gratis"): para acao de
 * canto que nao merece botao ("Conferir de novo", "Trocar pasta").
 */
export function Link({
  onClick,
  disabled,
  title,
  foco,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  /** Nome para devolver o foco do teclado a este link depois de uma acao (focarBotao). */
  foco?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-foco={foco}
      className="shrink-0 text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
    >
      {children}
    </button>
  )
}

/**
 * Devolve o foco do teclado ao primeiro botao com `data-foco` de um dos
 * nomes (o primeiro que existir e estiver ligado), depois de a tela redesenhar.
 * O botao que tinha o foco sumiu (Aprovar virou "Aprovado", o Cancelar
 * desmontou): sem isto o foco caia no body e o proximo Tab recomecava do topo.
 */
export function focarBotao(...nomes: string[]): void {
  requestAnimationFrame(() => {
    for (const nome of nomes) {
      const alvo = document.querySelector<HTMLButtonElement>(`[data-foco="${nome}"]:not(:disabled)`)
      if (alvo) {
        alvo.focus()
        return
      }
    }
  })
}

/**
 * Uma caixinha de marcar com o texto ao lado. Ligada, o mesmo "escolhido" do
 * resto do app (fundo rosa apagado, borda e check rosa), e nao o rosa cheio,
 * que gritava mais que o botao principal ao lado.
 */
export function Caixinha({
  ligada,
  onChange,
  disabled,
  title,
  children,
}: {
  ligada: boolean
  onChange: (ligada: boolean) => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ligada}
      onClick={() => onChange(!ligada)}
      disabled={disabled}
      title={title}
      className="flex shrink-0 items-center gap-2 text-left text-[12px] text-ink-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={[
          'grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors',
          ligada ? 'border-accent bg-accent-dim text-accent' : 'border-line-strong bg-elevated',
        ].join(' ')}
      >
        {ligada && <Check size={11} strokeWidth={2.25} />}
      </span>
      {children}
    </button>
  )
}

/** As classes do campo de texto do app (as mesmas das Configuracoes), sem o tamanho. */
export const CLASSE_DO_CAMPO =
  'min-w-0 select-text rounded-sm border border-line bg-elevated text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-40'

/**
 * O tamanho do campo. Altura fixa, e nao padding: input e select com o mesmo
 * py ficavam com 33,5 e 32 px, e o rotulo do select descia na grade.
 */
export const CAMPO_NORMAL = 'h-8 px-2.5 text-[13px]'
export const CAMPO_PEQUENO = 'h-7 px-2 text-[12px]'

/**
 * Campo de tempo em m:ss. Grava ao sair do campo ou no Enter; Esc desiste.
 * Texto que nao se le como tempo volta ao valor de antes.
 */
export function CampoDeTempo({
  valor,
  onChange,
  disabled,
  rotulo,
}: {
  valor: number
  /**
   * Recebe o tempo lido. Devolve uma frase quando RECUSA (fim antes do inicio,
   * inicio depois do fim do episodio): o campo volta ao valor de antes e fica
   * com a borda vermelha, com a frase no tooltip, ate o proximo foco. Antes
   * ele aceitava calado, e o trecho virava 1 s ou ia parar em cima do ED.
   */
  onChange: (seg: number) => string | null
  disabled?: boolean
  /** Para leitor de tela e tooltip: "Inicio", "Fim". */
  rotulo: string
}) {
  const [texto, setTexto] = useState(() => formatarTempo(valor, 1))
  const [editando, setEditando] = useState(false)
  const [recusa, setRecusa] = useState<string | null>(null)
  /*
   * O Esc desiste pelo blur, e o blur e o mesmo que grava -- rodando NA HORA,
   * com o `texto` digitado ainda no closure (o setTexto do Esc so vale no
   * proximo render). Sem esta marca, Esc gravava igual ao Enter.
   */
  const desistiu = useRef(false)

  // Arrastar na regua muda o valor por fora: o campo acompanha quando nao esta sendo digitado.
  useEffect(() => {
    if (!editando) setTexto(formatarTempo(valor, 1))
  }, [valor, editando])

  // A regua mexeu no trecho: a recusa antiga ja nao fala do valor de agora.
  useEffect(() => setRecusa(null), [valor])

  const gravar = (): void => {
    setEditando(false)
    if (desistiu.current) {
      desistiu.current = false
      setTexto(formatarTempo(valor, 1))
      return
    }
    const lido = lerTempo(texto)
    if (lido === null) {
      setTexto(formatarTempo(valor, 1))
      return
    }
    if (Math.abs(lido - valor) <= 0.0005) return
    const porque = onChange(lido)
    if (porque) {
      setRecusa(porque)
      setTexto(formatarTempo(valor, 1))
    }
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={texto}
      disabled={disabled}
      aria-label={rotulo}
      aria-invalid={recusa !== null}
      title={recusa ?? `${rotulo} (m:ss, aceita decimos: 1:29.5)`}
      onFocus={(e) => {
        setEditando(true)
        setRecusa(null)
        e.currentTarget.select()
      }}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={gravar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          desistiu.current = true
          e.currentTarget.blur()
        }
      }}
      // Troca a borda, em vez de somar: no CSS gerado o border-danger vem antes
      // do border-line, e com as duas classes a recusa ficava com a borda cinza.
      className={[
        CLASSE_DO_CAMPO.replace(' border-line ', recusa ? ' border-danger ' : ' border-line '),
        CAMPO_PEQUENO,
        'tnum w-[76px] shrink-0',
      ].join(' ')}
    />
  )
}

/**
 * A cor de "fora do combinado" do app (a do ponto escolhido na curva): aviso,
 * nao erro. Mora aqui para a pergunta do modelo reserva usar sem importar a
 * SecaoDoRoteiro (que importa a pergunta).
 */
export const COR_DE_AVISO = 'text-[#f6a23c]'

/**
 * Um aviso dentro da secao ("Pode ser outro release"). Icone e texto neutros,
 * como as notas da StatusBar: em rosa, o aviso parecia botao ou selecao.
 */
export function Aviso({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-2" title={title}>
      <TriangleAlert size={12} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-3" />
      <span className="min-w-0 select-text">{children}</span>
    </p>
  )
}

/**
 * A pasta de sincronizacao em que o caminho esta, ou null. O Windows costuma
 * redirecionar Documentos para o OneDrive, e a biblioteca padrao do Studio mora
 * em Documentos: cada episodio cortado (~1 GB de mp4 e keyframes) iria para a
 * nuvem sem ninguem pedir.
 */
export function nuvemDoCaminho(caminho: string): string | null {
  const m = /[\\/](OneDrive(?: - [^\\/]+)?|Dropbox|Google Drive|iCloudDrive)(?:[\\/]|$)/i.exec(caminho)
  if (!m) return null
  const pasta = m[1]!.toLowerCase()
  if (pasta.startsWith('onedrive')) return 'OneDrive'
  if (pasta === 'dropbox') return 'Dropbox'
  if (pasta === 'google drive') return 'Google Drive'
  return 'iCloud'
}

/**
 * Caminho longo cortado NO MEIO: "C:\...\AniRecap Studio\Biblioteca". Cortado
 * no fim, como o truncate faz, ele escondia justamente a pasta final -- a que
 * diz onde as cenas vao parar. O inteiro vai no tooltip.
 */
export function meioDoCaminho(caminho: string, maximo = 46): string {
  if (caminho.length <= maximo) return caminho
  const sep = caminho.includes('\\') ? '\\' : '/'
  const partes = caminho.split(/[\\/]+/).filter(Boolean)
  if (partes.length < 3) return caminho
  const inicio = partes[0]!
  // Das pastas finais, quantas couberem (sempre pelo menos a ultima).
  const fim: string[] = [partes[partes.length - 1]!]
  for (let i = partes.length - 2; i > 0; i--) {
    const tentativa = [partes[i]!, ...fim]
    if (`${inicio}${sep}...${sep}${tentativa.join(sep)}`.length > maximo) break
    fim.unshift(partes[i]!)
  }
  return `${inicio}${sep}...${sep}${fim.join(sep)}`
}

/**
 * "Senku 120": um nome com a contagem, no estilo dos chips do app. O que o
 * numero conta vai no tooltip ("23 cenas"), e nao numa frase embaixo.
 */
export function Contagem({
  nome,
  n,
  unidade,
  aviso,
}: {
  nome: string
  n: number
  unidade: readonly [string, string]
  /** Frase do tooltip quando o numero merece conferencia; o nome fica na cor de aviso. */
  aviso?: string
}) {
  return (
    <span
      title={`${nome}: ${n} ${n === 1 ? unidade[0] : unidade[1]}${aviso ? `. ${aviso}` : ''}`}
      className="flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2 py-1 text-[11px] text-ink-2"
    >
      <span className={`max-w-[160px] truncate ${aviso ? COR_DE_AVISO : ''}`}>{nome}</span>
      <span className="tnum text-ink-3">{n}</span>
    </span>
  )
}

/** "A (n), B (n), C (n) e mais 4" -- a linha curta de uma lista longa. */
export function listaCurta(itens: readonly { nome: string; n: number }[], maximo: number): string {
  const vistos = itens.slice(0, maximo).map((i) => `${i.nome} (${i.n})`)
  const resto = itens.length - vistos.length
  return resto > 0 ? `${vistos.join(', ')} e mais ${resto}` : vistos.join(', ')
}

/** "NVIDIA GeForce RTX 5080" -> "RTX 5080". A marca inteira so cabe no tooltip. */
export function gpuCurta(gpu: string): string {
  return gpu.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '').trim()
}

/**
 * O estado do motor numa frase curta para a tela, com o detalhe (versao,
 * caminho do venv, a frase inteira do main) para o tooltip. Usado na linha do
 * motor do assistente e nas Configuracoes, para os dois dizerem o mesmo.
 */
export function resumoDoMotor(
  motor: StatusDoMotor | null,
  motorErro: string | null,
): { estado: 'conferindo' | 'pronto' | 'fora'; texto: string; detalhe: string | undefined } {
  if (motorErro) return { estado: 'fora', texto: 'Nao deu para conferir o motor', detalhe: motorErro }
  if (!motor) return { estado: 'conferindo', texto: 'Conferindo o motor...', detalhe: undefined }
  const s = motor.studio
  if (!s.pronto) {
    const erro = s.erro ?? ''
    // As frases do main (motor.ts e o runtime do app instalado, motor-runtime/index.ts).
    const texto = /nao esta instalado|falta o python/i.test(erro)
      ? 'Motor nao instalado'
      : /esta sendo instalado/i.test(erro)
        ? 'Motor instalando'
        : /nao terminou/i.test(erro)
          ? 'Instalacao do motor parou'
          : /precisa de uma atualizacao/i.test(erro)
            ? 'Motor precisa de atualizacao'
            : /so roda no windows/i.test(erro)
              ? 'Motor so no Windows'
              : /ffmpeg/i.test(erro)
                ? 'Motor sem ffmpeg'
                : /nao respondeu/i.test(erro)
                  ? 'O motor nao respondeu'
                  : 'Motor fora do ar'
    return { estado: 'fora', texto, detalhe: erro || undefined }
  }
  return {
    estado: 'pronto',
    texto: ['Pronto', s.gpu ? gpuCurta(s.gpu) : 'sem GPU (bem mais lento)'].join(' · '),
    detalhe: [s.versao ? `Motor ${s.versao}` : null, s.gpu].filter(Boolean).join(' · ') || undefined,
  }
}

/**
 * "Abrir pasta": o MESMO botao em todo lugar que mostra algo no Explorer. Eram
 * tres jeitos ("Abrir pasta", um link "Abrir", "Abrir a pasta das cenas") para
 * a mesma acao. O que ele abre vai no tooltip.
 */
export function AbrirPasta({ caminho, title }: { caminho: string; title: string }) {
  return (
    <Botao pequeno onClick={() => void window.dangai.revealFile(caminho)} title={`${title}\n${caminho}`}>
      <FolderOpen size={12} strokeWidth={1.5} />
      Abrir pasta
    </Botao>
  )
}

/**
 * [recap] O que ainda vai chegar no modulo (o corte das cenas, a voz): uma
 * linha apagada no lugar do botao, para nao haver botao que nao faz nada.
 */
export function EmBreve({ children, icone }: { children: React.ReactNode; icone?: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
      {icone}
      {children}: em breve
    </p>
  )
}
