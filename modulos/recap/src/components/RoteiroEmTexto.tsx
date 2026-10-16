import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ROTULO_DO_PAPEL, redividirRoteiro, type PapelDaSecao } from '../../shared/roteiro'
import { useRoteiro } from '../store/gerar-roteiro'
import { Secao } from './pecas'

/**
 * Onde cada parte comeca no texto: o primeiro caractere que nao e espaco
 * depois de cada linha em branco. Espelha partesDoTexto (shared/roteiro.ts):
 * a mesma separacao, e parte so de espaco nao conta -- a k-esima posicao daqui
 * e a k-esima secao do redividirRoteiro.
 */
export function inicioDasPartes(texto: string): number[] {
  const inicios: number[] = []
  const separador = /\n[ \t]*\n/g
  let pos = 0
  const pedacos: [number, number][] = []
  for (let m = separador.exec(texto); m; m = separador.exec(texto)) {
    pedacos.push([pos, m.index])
    pos = m.index + m[0].length
  }
  pedacos.push([pos, texto.length])
  for (const [de, ate] of pedacos) {
    const k = texto.slice(de, ate).search(/\S/)
    if (k >= 0) inicios.push(de + k)
  }
  return inicios
}

/**
 * As classes que o campo e o espelho dividem. Qualquer diferenca de fonte,
 * respiro ou borda entre os dois desalinha o papel da margem.
 */
const TEXTO = 'rounded-sm border px-3 py-2.5 text-[13px] leading-[22px]'

/**
 * O MODO TEXTO do passo 2: o roteiro inteiro num bloco so, como um .txt do
 * Dangai. Ponto final separa as frases (cada uma vira uma cena); linha em
 * branco separa as partes. O papel de cada parte (Gancho, Contexto...) fica
 * discreto na margem, na altura da primeira linha dela.
 *
 * Cada tecla re-divide e grava sozinha (gerar-roteiro.ts). Ao voltar para
 * Partes (ou aprovar), as frases novas sao ligadas aos eventos numa chamada
 * so; as que nao mudaram mantem o momento e as cenas.
 *
 * A margem se acha por um ESPELHO: um bloco invisivel com o mesmo texto e as
 * mesmas medidas do campo, com uma marca no comeco de cada parte. A altura
 * da marca e a da linha onde a parte comeca, com quebra de linha e tudo.
 */
export function RoteiroEmTexto() {
  const texto = useRoteiro((s) => s.textoDoModo)
  const base = useRoteiro((s) => s.baseDoTexto)
  const geracao = useRoteiro((s) => s.geracao)
  const digitar = useRoteiro((s) => s.digitarTexto)
  const travado = geracao !== null

  const redivisao = useMemo(() => (base ? redividirRoteiro(base, texto) : null), [base, texto])
  const papeis: PapelDaSecao[] = useMemo(() => redivisao?.secoes.map((s) => s.papel) ?? [], [redivisao])
  const frases = redivisao?.frases.length ?? 0
  const novas = redivisao?.religar.length ?? 0
  const inicios = useMemo(() => inicioDasPartes(texto), [texto])

  const espelho = useRef<HTMLDivElement>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const [topos, setTopos] = useState<number[]>([])
  const [largura, setLargura] = useState(0)

  // A largura muda a quebra das linhas (janela, painel): mede de novo.
  useEffect(() => {
    const el = caixa.current
    if (!el) return
    const obs = new ResizeObserver(() => setLargura(el.clientWidth))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useLayoutEffect(() => {
    const el = espelho.current
    if (!el) return
    const marcas = Array.from(el.querySelectorAll<HTMLElement>('[data-parte]'))
    const novos = marcas.map((m) => m.offsetTop)
    setTopos((velhos) => (velhos.length === novos.length && velhos.every((v, i) => v === novos[i]) ? velhos : novos))
  }, [texto, largura])

  // O espelho: o texto em pedacos, com uma marca vazia no comeco de cada parte.
  const pedacos: React.ReactNode[] = []
  let antes = 0
  inicios.forEach((inicio, k) => {
    pedacos.push(texto.slice(antes, inicio), <span key={k} data-parte={k} />)
    antes = inicio
  })
  // O espaco de largura zero segura a ultima linha quando o texto acaba em quebra.
  pedacos.push(`${texto.slice(antes)}​`)

  return (
    <Secao
      titulo="Roteiro"
      acao={
        <span className="tnum text-[11px] text-ink-3" title="Cada frase vira uma cena. Frase nova ganha o momento do episodio ao voltar para Partes.">
          {frases} {frases === 1 ? 'frase' : 'frases'} · {papeis.length} {papeis.length === 1 ? 'parte' : 'partes'}
          {novas > 0 && ` · ${novas} ${novas === 1 ? 'nova' : 'novas'}`}
        </span>
      }
    >
      <div className={['flex min-w-0 gap-3 transition-opacity', travado ? 'opacity-40' : ''].join(' ')}>
        {/* A margem: o papel de cada parte na altura da primeira linha dela. */}
        <div className="relative w-[108px] shrink-0" aria-hidden>
          {topos.map((topo, k) => {
            const papel = papeis[k]
            if (!papel) return null
            return (
              <span
                key={k}
                // +1: o offsetTop conta de dentro da borda do espelho, e a borda tem 1 px.
                style={{ top: topo + 1 }}
                className="absolute right-0 flex h-[22px] items-center whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-ink-3"
              >
                {ROTULO_DO_PAPEL[papel]}
              </span>
            )
          })}
        </div>
        <div ref={caixa} className="relative min-w-0 flex-1">
          <div
            ref={espelho}
            aria-hidden
            className={`${TEXTO} pointer-events-none invisible absolute inset-x-0 top-0 whitespace-pre-wrap border-transparent [overflow-wrap:break-word]`}
          >
            {pedacos}
          </div>
          <textarea
            value={texto}
            autoFocus
            readOnly={travado}
            onChange={(e) => digitar(e.target.value)}
            aria-label="Roteiro em texto"
            placeholder="Escreva o roteiro. Ponto final separa as frases; linha em branco, as partes."
            spellCheck={false}
            className={[
              TEXTO,
              'field-sizing-content block min-h-[240px] w-full resize-none select-text whitespace-pre-wrap border-line bg-elevated text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none [overflow-wrap:break-word]',
              travado ? 'cursor-default' : '',
            ].join(' ')}
          />
        </div>
      </div>
      <p className="text-[11px] text-ink-3">Ponto final separa as frases. Linha em branco separa as partes.</p>
    </Secao>
  )
}
