import { useMemo } from 'react'
import { ClipboardPaste, X } from 'lucide-react'
import { partesDoTexto } from '../../shared/roteiro'
import { useRoteiro } from '../store/gerar-roteiro'
import { Botao, CLASSE_DO_CAMPO, focarBotao, Secao } from './pecas'

/**
 * "USAR MEU ROTEIRO": colar um roteiro proprio no lugar do da IA. Passa pela
 * mesma regra do modo Texto -- ponto final separa as frases, linha em branco
 * separa as partes -- e cada frase e ligada a um momento do episodio numa
 * chamada so (religarRoteiro). Vira uma versao nova "Editada"; a de agora
 * fica em Versoes.
 *
 * O texto colado mora na store ate o roteiro novo existir: um Cancelar antes
 * de o main receber o pedido traz o cartao de volta com ele.
 */
export function MeuRoteiro() {
  const texto = useRoteiro((s) => s.textoColado)
  const temRoteiro = useRoteiro((s) => s.tela !== null)
  const geracao = useRoteiro((s) => s.geracao)
  const aprovando = useRoteiro((s) => s.aprovando)
  const digitar = useRoteiro((s) => s.digitarColado)
  const fechar = useRoteiro((s) => s.fecharColar)
  const usar = useRoteiro((s) => s.usarMeuRoteiro)

  const partes = useMemo(() => partesDoTexto(texto), [texto])
  const frases = partes.reduce((n, p) => n + p.length, 0)
  const travado = geracao !== null || aprovando

  const fecharEDevolverFoco = (): void => {
    fechar()
    focarBotao('meu-roteiro', 'gerar-roteiro')
  }

  return (
    <div
      onKeyDown={(e) => {
        // Esc fecha so o cartao, nunca o assistente.
        if (e.key !== 'Escape') return
        e.stopPropagation()
        fecharEDevolverFoco()
      }}
    >
      <Secao
        titulo="Meu roteiro"
        acao={
          <button
            type="button"
            onClick={fecharEDevolverFoco}
            aria-label="Fechar"
            title="Fechar (Esc)"
            className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        }
      >
        <textarea
          value={texto}
          autoFocus
          readOnly={travado}
          onChange={(e) => digitar(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl+Enter usa, como o Enter de um campo de uma linha.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !travado && texto.trim()) {
              e.preventDefault()
              void usar()
            }
          }}
          aria-label="Roteiro colado"
          placeholder="Cole o roteiro aqui"
          spellCheck={false}
          className={`${CLASSE_DO_CAMPO} field-sizing-content block max-h-[52vh] min-h-[180px] w-full resize-none px-3 py-2.5 text-[13px] leading-[22px]`}
        />
        <div className="flex min-h-8 flex-wrap items-center gap-3">
          <span className="tnum min-w-0 flex-1 truncate text-[11px] text-ink-3">
            {frases > 0
              ? `${frases} ${frases === 1 ? 'frase' : 'frases'} · ${partes.length} ${partes.length === 1 ? 'parte' : 'partes'}`
              : 'Ponto final separa as frases. Linha em branco separa as partes.'}
          </span>
          <Botao onClick={fecharEDevolverFoco} title="Fechar sem usar (Esc)">
            Cancelar
          </Botao>
          <Botao
            principal
            foco="usar-meu-roteiro"
            onClick={() => void usar()}
            disabled={travado || !texto.trim()}
            title={
              temRoteiro
                ? 'Cada frase ganha um momento do episodio (IA, uma chamada). O roteiro de agora fica em Versoes. (Ctrl+Enter)'
                : 'Cada frase ganha um momento do episodio (IA, uma chamada). (Ctrl+Enter)'
            }
          >
            <ClipboardPaste size={13} strokeWidth={1.5} />
            Usar este roteiro
          </Botao>
        </div>
      </Secao>
    </div>
  )
}
