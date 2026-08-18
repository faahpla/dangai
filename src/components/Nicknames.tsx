import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Sparkles, X } from 'lucide-react'
import type { Nickname, NicknameSuggestion } from '@shared/channels'
import { useProject } from '@/store/project'

/**
 * Como o Kintay chama cada personagem quando escreve o roteiro.
 *
 * O leitor de roteiro acha nome escrito ("o Rimuru") e resolve pronome ("ele")
 * sozinho. O que ele nao alcanca e o apelido: "o slime" e o Rimuru, "uma Lorde
 * Demonio" e a Luminous -- isso nao esta no texto, e conhecimento da serie.
 *
 * Medido no roteiro de teoria dele, 16 frases com personagem: so nome escrito
 * acertava 9; com o arrasto de pronome, 14; com dois apelidos cadastrados, 16.
 * Duas linhas fecharam o buraco.
 *
 * Fica na Biblioteca, e por serie, porque e ali que a lista de personagens
 * existe -- e porque cadastrar isto e parte de "acabei de por uma serie nova".
 */
export function Nicknames({ series, onClose }: { series: string; onClose: () => void }) {
  const library = useProject((s) => s.library)
  const guardados = useProject((s) => s.nicknames)
  const salvar = useProject((s) => s.saveNicknames)
  const ocupado = useProject((s) => s.nicknamesBusy)

  const [termo, setTermo] = useState('')
  const [personagem, setPersonagem] = useState('')
  const [sugestoes, setSugestoes] = useState<NicknameSuggestion[] | null>(null)
  const [sugerindo, setSugerindo] = useState(false)
  const [avisoSugestao, setAvisoSugestao] = useState<string | null>(null)

  const lista = guardados[series] ?? []

  /** Os personagens desta serie, na grafia ja unificada da Biblioteca. */
  const personagens = useMemo(() => {
    const nomes = new Set<string>()
    for (const clip of library?.clips ?? []) {
      if (clip.anime !== series) continue
      for (const p of clip.characters) nomes.add(p)
    }
    return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [library, series])

  useEffect(() => {
    setPersonagem((atual) => (personagens.includes(atual) ? atual : (personagens[0] ?? '')))
  }, [personagens])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const acrescentar = (item: Nickname): void => {
    void salvar(series, [...lista, item])
  }

  const remover = (term: string): void => {
    void salvar(
      series,
      lista.filter((n) => n.term !== term),
    )
  }

  const sugerir = async (): Promise<void> => {
    setSugerindo(true)
    setAvisoSugestao(null)
    const result = await window.dangai.suggestNicknames(series, personagens)
    setSugerindo(false)
    if (!result.ok) {
      setAvisoSugestao(result.error)
      return
    }
    // Ja cadastrado nao volta como sugestao -- ele acabou de decidir sobre ele.
    const jaTem = new Set(lista.map((n) => n.term.toLowerCase()))
    const novas = result.value.filter((s) => !jaTem.has(s.term.toLowerCase()))
    setSugestoes(novas)
    if (novas.length === 0) setAvisoSugestao('O modelo nao sugeriu nada novo.')
  }

  const podeAcrescentar = termo.trim().length >= 3 && personagem.length > 0

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6"
      onPointerDown={onClose}
    >
      <div
        onPointerDown={(event) => event.stopPropagation()}
        className="glass enter flex max-h-[80vh] w-full max-w-[520px] flex-col rounded-lg p-5"
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-ink">Apelidos · {series}</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
              Como voce chama os personagens no roteiro sem usar o nome. O app ja entende nome
              escrito e "ele/ela" sozinho — isto e so para apelido.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </header>

        {personagens.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-ink-2">
            Esta serie ainda nao tem nenhum personagem identificado na biblioteca, entao nao ha a
            que apontar um apelido.
          </p>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {lista.length === 0 ? (
                <p className="py-3 text-[12px] text-ink-3">
                  Nada cadastrado ainda. Exemplo: <span className="text-ink-2">slime</span> aponta
                  para <span className="text-ink-2">Tempest, Rimuru</span>.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {lista.map((n) => {
                    const orfao = !personagens.includes(n.character)
                    return (
                      <li
                        key={n.term}
                        className="flex items-center gap-2 rounded-sm border border-line bg-elevated px-2.5 py-1.5"
                      >
                        <span className="shrink-0 text-[12px] text-ink">{n.term}</span>
                        <span className="shrink-0 text-[11px] text-ink-3">aponta para</span>
                        <span
                          className={[
                            'min-w-0 flex-1 truncate text-[12px]',
                            orfao ? 'text-danger' : 'text-accent',
                          ].join(' ')}
                          title={
                            orfao
                              ? 'Este personagem nao existe mais na biblioteca desta serie'
                              : undefined
                          }
                        >
                          {n.character}
                          {orfao && ' (nao existe mais)'}
                        </span>
                        <button
                          type="button"
                          onClick={() => remover(n.term)}
                          aria-label={`Remover o apelido ${n.term}`}
                          className="grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-danger"
                        >
                          <X size={11} strokeWidth={1.5} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              {sugestoes && sugestoes.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
                    Sugestoes do modelo local
                  </h3>
                  {/*
                    O modelo sugere, ele decide. Medido: acerta o apelido famoso
                    e erra o menos famoso -- chegou a dizer que "Lorde Demonio"
                    era a Chloe quando e a Luminous. Errar sugerindo nao custa
                    nada porque ele esta olhando; errar decidindo custaria o video.
                  */}
                  <ul className="flex flex-col gap-1">
                    {sugestoes.map((s) => (
                      <li
                        key={s.term}
                        className="flex items-center gap-2 rounded-sm border border-dashed border-line px-2.5 py-1.5"
                      >
                        <span className="shrink-0 text-[12px] text-ink-2">{s.term}</span>
                        <span className="shrink-0 text-[11px] text-ink-3">aponta para</span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
                          {s.character}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            acrescentar({ term: s.term, character: s.character })
                            setSugestoes((atual) => (atual ?? []).filter((x) => x.term !== s.term))
                          }}
                          title="Aceitar esta sugestao"
                          className="grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-accent"
                        >
                          <Plus size={12} strokeWidth={1.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSugestoes((atual) => (atual ?? []).filter((x) => x.term !== s.term))
                          }
                          aria-label={`Descartar a sugestao ${s.term}`}
                          className="grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink"
                        >
                          <X size={11} strokeWidth={1.5} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
              <div className="flex gap-2">
                <input
                  value={termo}
                  onChange={(event) => setTermo(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'Enter' && podeAcrescentar) {
                      acrescentar({ term: termo.trim(), character: personagem })
                      setTermo('')
                    }
                  }}
                  placeholder="slime"
                  spellCheck={false}
                  className="min-w-0 flex-1 select-text rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
                />
                <select
                  value={personagem}
                  onChange={(event) => setPersonagem(event.target.value)}
                  className="min-w-0 flex-1 rounded-sm border border-line bg-elevated px-2 py-1.5 text-[12px] text-ink focus:border-line-strong focus:outline-none"
                >
                  {personagens.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!podeAcrescentar || ocupado}
                  onClick={() => {
                    acrescentar({ term: termo.trim(), character: personagem })
                    setTermo('')
                  }}
                  className="lift shrink-0 rounded-sm border border-accent bg-accent-dim px-3 py-1.5 text-[12px] font-medium text-ink disabled:opacity-40"
                >
                  Adicionar
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={sugerindo}
                  onClick={() => void sugerir()}
                  title="Usa um modelo rodando na sua maquina pelo Ollama. Opcional."
                  className="lift flex shrink-0 items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40"
                >
                  {sugerindo ? (
                    <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
                  ) : (
                    <Sparkles size={12} strokeWidth={1.5} />
                  )}
                  Sugerir com o modelo local
                </button>
                {avisoSugestao && (
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3" title={avisoSugestao}>
                    {avisoSugestao}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
