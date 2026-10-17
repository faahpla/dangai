import { useEffect, useRef, useState } from 'react'
import { ClipboardPaste, FileText, Trash2 } from 'lucide-react'
import {
  APRENDIDOS_OPCOES,
  EXEMPLOS_MAX,
  INSTRUCOES_MAX,
  NOME_DO_EXEMPLO_MAX,
  TEXTO_DO_EXEMPLO_MAX,
  novoIdDeExemplo,
  type EstiloDoRecap,
  type EstiloNaTela,
} from '../../shared/estilo'
import { ESCRITORES, ESCRITORES_IDS, type Escritor } from '../../shared/escritor'
import { contarPalavras } from '../../shared/roteiro'
import type { ConfigDoRecapNaTela } from '../../shared/config'
import { Segmentos, type Segmento } from '@/modulos/kit'
import { ponte } from '../ponte'
import { Botao, Caixinha, CAMPO_PEQUENO, CLASSE_DO_CAMPO, COR_DE_AVISO, Link } from './pecas'

/** Espera depois da ultima tecla antes de gravar o estilo. */
const ESPERA_MS = 600

/**
 * [recap] O ROTEIRO DO RECAP: o "Meu estilo" (instrucoes, exemplos,
 * aprender), o revisor e quem escreve. O MESMO componente nas Configuracoes
 * (secao "Roteiro do recap") e no painel "Estilo" do passo 2.
 *
 * O estilo grava sozinho (espera curta, como o roteiro); a medida do que vai
 * ao prompt (tokens dos exemplos, quem ficou de fora pelo teto) vem do main
 * a cada gravacao. Pouco texto: o porque mora nos tooltips.
 */
export function AjustesDoRoteiro() {
  const [estilo, setEstilo] = useState<EstiloDoRecap | null>(null)
  const [medida, setMedida] = useState<Omit<EstiloNaTela, 'estilo'> | null>(null)
  const [config, setConfig] = useState<ConfigDoRecapNaTela | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  const [novo, setNovo] = useState<{ nome: string; texto: string } | null>(null)
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendente = useRef<EstiloDoRecap | null>(null)

  useEffect(() => {
    let vivo = true
    void ponte.lerEstilo().then((r) => {
      if (!vivo) return
      if (r.ok) {
        setEstilo(r.value.estilo)
        setMedida(r.value)
      } else setAviso(r.error)
    })
    void ponte.lerConfig().then((r) => {
      if (vivo && r.ok) setConfig(r.value)
    })
    return () => {
      vivo = false
      // Fechou com tecla no relogio: grava ja.
      if (relogio.current) clearTimeout(relogio.current)
      if (pendente.current) void ponte.salvarEstilo(pendente.current)
    }
  }, [])

  const gravar = async (e: EstiloDoRecap): Promise<void> => {
    pendente.current = null
    const r = await ponte.salvarEstilo(e)
    if (r.ok) {
      setMedida(r.value)
      setAviso(null)
    } else setAviso(r.error)
  }

  const mudar = (fn: (e: EstiloDoRecap) => EstiloDoRecap, ja = false): void => {
    if (!estilo) return
    const e = fn(estilo)
    setEstilo(e)
    pendente.current = e
    if (relogio.current) clearTimeout(relogio.current)
    if (ja) void gravar(e)
    else relogio.current = setTimeout(() => void gravar(e), ESPERA_MS)
  }

  const salvarConfig = async (patch: { revisarAoGerar?: boolean; escritor?: Escritor; modeloGeminiPro?: string }): Promise<void> => {
    const r = await ponte.salvarConfig(patch)
    if (r.ok) setConfig(r.value)
    else setAviso(r.error)
  }

  const adicionar = (nome: string, texto: string): void => {
    const limpo = texto.trim().slice(0, TEXTO_DO_EXEMPLO_MAX)
    if (!limpo) return
    mudar(
      (e) => ({
        ...e,
        exemplos: [
          ...e.exemplos,
          { id: novoIdDeExemplo(), nome: nome.trim().slice(0, NOME_DO_EXEMPLO_MAX) || `Exemplo ${e.exemplos.length + 1}`, texto: limpo, origem: 'meu', criadoEm: new Date().toISOString() },
        ],
      }),
      true,
    )
  }

  const importar = async (): Promise<void> => {
    const r = await ponte.importarExemplo()
    if (!r.ok) setAviso(r.error)
    else if (r.value) adicionar(r.value.nome, r.value.texto)
  }

  if (!estilo) return <p className="text-[11px] text-ink-3">{aviso ?? 'Abrindo...'}</p>

  const meus = estilo.exemplos.filter((e) => e.origem === 'meu').length
  const cheio = meus >= EXEMPLOS_MAX
  const usados = new Set(medida?.usados ?? [])
  const tokens = medida?.tokensDosExemplos ?? 0

  const escritores: Segmento<Escritor>[] = ESCRITORES_IDS.map((id) => {
    const semChave = config ? !config.escritoresComChave[id] : false
    const d = ESCRITORES[id]
    return {
      valor: id,
      // Curto: nas Configuracoes a linha tem ~380 px para as tres opcoes.
      rotulo: semChave ? `${id === 'claude' ? 'Claude' : 'Gemini Pro'} · sem chave` : d.rotulo,
      title:
        id === 'gemini'
          ? 'O provedor padrao das Configuracoes, sem custo'
          : semChave
            ? `Sem a chave do ${id === 'claude' ? 'Anthropic' : 'Gemini'} nas Configuracoes > IA: escreve o gratis`
            : `Pago, so a escrita (US$ ${d.entrada}/${d.saida} por 1M tokens). Pergunta o custo antes`,
    }
  })

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-ink-2">Instrucoes</span>
        <textarea
          value={estilo.instrucoes}
          onChange={(ev) => mudar((e) => ({ ...e, instrucoes: ev.target.value.slice(0, INSTRUCOES_MAX) }))}
          rows={3}
          placeholder="Tom, girias, como abrir, como fechar, o que evitar"
          aria-label="Instrucoes do estilo"
          spellCheck={false}
          className={`${CLASSE_DO_CAMPO} min-h-[64px] resize-y px-2.5 py-2 text-[12px] leading-relaxed`}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex min-h-7 flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-ink-2">Exemplos</span>
          <span
            className="tnum text-[11px] text-ink-3"
            title={`Entram no prompt so como TOM e RITMO, com os nomes trocados por [PERSONAGEM n]. Teto de ~${(medida?.teto ?? 6000).toLocaleString('pt-BR')} tokens: passou, os mais antigos ficam de fora.`}
          >
            {meus}/{EXEMPLOS_MAX} · ~{tokens.toLocaleString('pt-BR')} tokens
          </span>
          <span className="flex-1" />
          <Botao pequeno onClick={() => setNovo({ nome: '', texto: '' })} disabled={cheio || novo !== null} title={cheio ? `No maximo ${EXEMPLOS_MAX}` : 'Colar um roteiro que voce gosta'}>
            <ClipboardPaste size={12} strokeWidth={1.5} />
            Colar
          </Botao>
          <Botao pequeno onClick={() => void importar()} disabled={cheio} title={cheio ? `No maximo ${EXEMPLOS_MAX}` : 'Um roteiro de um arquivo .txt'}>
            <FileText size={12} strokeWidth={1.5} />
            Importar .txt
          </Botao>
        </div>

        {novo && (
          <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-elevated p-2">
            <input
              value={novo.nome}
              onChange={(ev) => setNovo({ ...novo, nome: ev.target.value })}
              placeholder="Nome curto"
              aria-label="Nome do exemplo"
              maxLength={NOME_DO_EXEMPLO_MAX}
              className={`${CLASSE_DO_CAMPO} ${CAMPO_PEQUENO}`}
            />
            <textarea
              value={novo.texto}
              autoFocus
              onChange={(ev) => setNovo({ ...novo, texto: ev.target.value })}
              rows={6}
              placeholder="Cole o roteiro aqui"
              aria-label="Texto do exemplo"
              spellCheck={false}
              className={`${CLASSE_DO_CAMPO} resize-y px-2.5 py-2 text-[12px] leading-relaxed`}
            />
            <div className="flex items-center justify-end gap-2">
              <Botao pequeno onClick={() => setNovo(null)}>Cancelar</Botao>
              <Botao
                pequeno
                principal
                onClick={() => {
                  adicionar(novo.nome, novo.texto)
                  setNovo(null)
                }}
                disabled={!novo.texto.trim()}
              >
                Adicionar
              </Botao>
            </div>
          </div>
        )}

        {estilo.exemplos.length === 0 && !novo ? (
          <p className="text-[11px] text-ink-3">Nenhum ainda. 3 a 10 roteiros que voce gosta.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {estilo.exemplos.map((ex) => {
              const fora = medida !== null && !usados.has(ex.id)
              const editando = aberto === ex.id
              return (
                <li key={ex.id} className="flex flex-col gap-1.5 rounded-sm border border-line bg-elevated px-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      value={ex.nome}
                      onChange={(ev) =>
                        mudar((e) => ({ ...e, exemplos: e.exemplos.map((x) => (x.id === ex.id ? { ...x, nome: ev.target.value.slice(0, NOME_DO_EXEMPLO_MAX) } : x)) }))
                      }
                      aria-label="Nome do exemplo"
                      className="min-w-0 flex-1 bg-transparent text-[12px] text-ink focus:outline-none"
                    />
                    {ex.origem === 'aprendido' && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-accent" title="Aprovado depois de editado">
                        aprendido
                      </span>
                    )}
                    {fora && (
                      <span className={`shrink-0 text-[10px] ${COR_DE_AVISO}`} title="Passou do teto de tokens: fica fora do prompt (o mais antigo sai primeiro)">
                        fora
                      </span>
                    )}
                    <span className="tnum shrink-0 text-[11px] text-ink-3">{contarPalavras(ex.texto)} pal.</span>
                    <Link onClick={() => setAberto(editando ? null : ex.id)}>{editando ? 'Fechar' : 'Editar'}</Link>
                    <button
                      type="button"
                      onClick={() => mudar((e) => ({ ...e, exemplos: e.exemplos.filter((x) => x.id !== ex.id) }), true)}
                      aria-label="Remover o exemplo"
                      title="Remover o exemplo"
                      className="grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-danger"
                    >
                      <Trash2 size={12} strokeWidth={1.5} />
                    </button>
                  </div>
                  {editando && (
                    <textarea
                      value={ex.texto}
                      onChange={(ev) =>
                        mudar((e) => ({ ...e, exemplos: e.exemplos.map((x) => (x.id === ex.id ? { ...x, texto: ev.target.value.slice(0, TEXTO_DO_EXEMPLO_MAX) } : x)) }))
                      }
                      rows={8}
                      aria-label="Texto do exemplo"
                      spellCheck={false}
                      className={`${CLASSE_DO_CAMPO} resize-y px-2.5 py-2 text-[12px] leading-relaxed`}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex min-h-7 flex-wrap items-center gap-3">
          <Caixinha
            ligada={estilo.aprender}
            onChange={(v) => mudar((e) => ({ ...e, aprender: v }), true)}
            title="O roteiro aprovado depois de editado vira exemplo (sem repetir; so os mais recentes)"
          >
            Aprender com as minhas edicoes
          </Caixinha>
          {estilo.aprender && (
            <span className="flex items-center gap-2 text-[11px] text-ink-3">
              guardar
              <span className="w-[96px]">
                <Segmentos
                  opcoes={APRENDIDOS_OPCOES.map((n) => ({ valor: n, rotulo: String(n), title: `Os ${n} mais recentes` }))}
                  ativo={(n) => n === estilo.aprendidosMax}
                  onChange={(n) => mudar((e) => ({ ...e, aprendidosMax: n }), true)}
                />
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <Caixinha
          ligada={config?.revisarAoGerar ?? true}
          onChange={(v) => void salvarConfig({ revisarAoGerar: v })}
          disabled={!config}
          title="Depois de gerar, a IA confere cada frase contra as falas (1 pedido a mais, gratis no Gemini). Sem cota, so pula."
        >
          Revisar depois de gerar
        </Caixinha>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-ink-2" title="So a escrita do roteiro. Eventos e revisao ficam no gratis.">
            Quem escreve
          </span>
          <Segmentos opcoes={escritores} ativo={(v) => v === (config?.escritor ?? 'gemini')} onChange={(v) => void salvarConfig({ escritor: v })} />
        </div>
        {config?.escritor === 'gemini-pro' && (
          <div className="flex items-center gap-2">
            <span className="w-[88px] shrink-0 text-[11px] text-ink-3">Modelo</span>
            <input
              defaultValue={config.modeloGeminiPro}
              placeholder={config.modeloGeminiProEfetivo}
              onBlur={(ev) => void salvarConfig({ modeloGeminiPro: ev.target.value.trim() })}
              aria-label="Modelo do Gemini Pro"
              title="Vazio = o apelido do pro atual do Google"
              className={`${CLASSE_DO_CAMPO} ${CAMPO_PEQUENO} w-[220px]`}
            />
          </div>
        )}
        {config && config.escritor !== 'gemini' && (
          <p className="text-[11px] text-ink-3">Pago so na escrita. Pergunta o custo antes (~US$ 0,15 por episodio).</p>
        )}
      </div>
      {aviso && <p className="select-text text-[11px] text-danger">{aviso}</p>}
    </div>
  )
}
