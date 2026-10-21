import { useEffect, useRef, useState } from 'react'
import { Link2, Loader2, Search } from 'lucide-react'
import type { VozDoProvedor } from '../../shared/tipos-da-voz'
import { useBibliotecaFish } from '../store/biblioteca-fish'
import { CLASSE_DO_CAMPO } from './pecas'

/**
 * (21/10) A busca na biblioteca publica do Fish e o "Colar ID da voz", embaixo
 * do select de voz (Configuracoes > Voz e passo Voz). O resultado entra no
 * proprio select, no grupo "Biblioteca do Fish"; a voz colada e escolhida na
 * hora. So GET: nada aqui gasta saldo.
 */

/** Espera depois da ultima tecla antes de buscar. */
const ESPERA_DA_BUSCA_MS = 450

const CAMPO = `${CLASSE_DO_CAMPO} h-8 w-full pr-2.5 pl-8 text-[12px]`
const ICONE = 'pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3'

export function BibliotecaDoFish({
  escolhida,
  daConta,
  onEscolher,
  travado = false,
}: {
  /** O voiceId do Fish escolhido agora ('' = nenhum). */
  escolhida: string
  /** As vozes da conta. null = ainda nao lidas. */
  daConta: readonly VozDoProvedor[] | null
  onEscolher: (voz: VozDoProvedor) => void
  travado?: boolean
}) {
  const vozes = useBibliotecaFish((s) => s.vozes)
  const avulsas = useBibliotecaFish((s) => s.avulsas)
  const busca = useBibliotecaFish((s) => s.busca)
  const todasAsLinguas = useBibliotecaFish((s) => s.todasAsLinguas)
  const carregando = useBibliotecaFish((s) => s.carregando)
  const erro = useBibliotecaFish((s) => s.erro)
  const carregar = useBibliotecaFish((s) => s.carregar)

  const [texto, setTexto] = useState(busca)
  const [colado, setColado] = useState('')
  const [colando, setColando] = useState(false)
  const [recado, setRecado] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A primeira vez (ou depois de trocar a chave): as populares em portugues.
  useEffect(() => {
    if (vozes === null && !carregando && !erro) void carregar('')
  }, [vozes, carregando, erro, carregar])

  // A voz salva fora das listas (colada noutro dia, achada numa busca): o nome dela, uma vez.
  useEffect(() => {
    if (!escolhida || daConta === null || vozes === null) return
    const conhecida = [...daConta, ...vozes, ...avulsas].some((v) => v.id === escolhida)
    if (!conhecida) useBibliotecaFish.getState().conhecer(escolhida)
  }, [escolhida, daConta, vozes, avulsas])

  useEffect(
    () => () => {
      if (relogio.current) clearTimeout(relogio.current)
    },
    [],
  )

  const buscar = (valor: string, ja = false): void => {
    if (relogio.current) clearTimeout(relogio.current)
    if (ja) {
      void carregar(valor)
      return
    }
    relogio.current = setTimeout(() => void carregar(valor), ESPERA_DA_BUSCA_MS)
  }

  const colar = async (valor: string): Promise<void> => {
    const limpo = valor.trim()
    if (!limpo || colando) return
    setColando(true)
    setRecado(null)
    const r = await useBibliotecaFish.getState().colar(limpo)
    setColando(false)
    if (!r.ok) {
      setRecado({ tipo: 'erro', texto: r.erro })
      return
    }
    setColado('')
    setRecado({ tipo: 'ok', texto: `Voz "${r.voz.nome}" escolhida.` })
    onEscolher(r.voz)
  }

  const n = vozes?.length ?? 0
  const situacao = erro
    ? null
    : carregando
      ? 'Buscando na biblioteca do Fish...'
      : vozes === null
        ? null
        : busca
          ? n === 0
            ? `Nenhuma voz com "${busca}" na Biblioteca do Fish.`
            : `${n} ${n === 1 ? 'voz' : 'vozes'} com "${busca}" na Biblioteca do Fish${todasAsLinguas ? ' (nenhuma em portugues: de todas as linguas)' : ''}, ja na lista de Voz.`
          : `Na lista de Voz: as ${n} vozes mais usadas da Biblioteca do Fish em portugues. Listar nao gasta nada.`

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap gap-2">
        <label className="relative min-w-[200px] flex-1">
          {carregando ? (
            <Loader2 size={13} strokeWidth={1.5} className={`${ICONE} animate-spin`} />
          ) : (
            <Search size={13} strokeWidth={1.5} className={ICONE} />
          )}
          <input
            type="text"
            aria-label="Buscar voz na biblioteca do Fish"
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value)
              buscar(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') buscar(texto, true)
              if (e.key === 'Escape' && texto) {
                setTexto('')
                buscar('', true)
              }
              e.stopPropagation()
            }}
            placeholder="Buscar voz na biblioteca do Fish"
            spellCheck={false}
            autoComplete="off"
            disabled={travado}
            className={CAMPO}
          />
        </label>
        <label className="relative min-w-[200px] flex-1">
          {colando ? (
            <Loader2 size={13} strokeWidth={1.5} className={`${ICONE} animate-spin`} />
          ) : (
            <Link2 size={13} strokeWidth={1.5} className={ICONE} />
          )}
          <input
            type="text"
            aria-label="Colar ID da voz"
            value={colado}
            onChange={(e) => {
              setColado(e.target.value)
              if (recado?.tipo === 'erro') setRecado(null)
            }}
            onPaste={(e) => {
              // Colou o ID ou o link inteiro: ja procura, sem precisar do Enter.
              const valor = e.clipboardData.getData('text')
              if (valor.trim() && !colado.trim()) {
                e.preventDefault()
                setColado(valor.trim())
                void colar(valor)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void colar(colado)
              e.stopPropagation()
            }}
            placeholder="Colar ID da voz ou link fish.audio/m/..."
            spellCheck={false}
            autoComplete="off"
            disabled={travado || colando}
            className={CAMPO}
          />
        </label>
      </div>
      {recado && (
        <p className={['select-text text-[11px] leading-relaxed', recado.tipo === 'ok' ? 'text-ink-2' : 'text-danger'].join(' ')}>
          {recado.texto}
        </p>
      )}
      {erro ? (
        <p className="flex min-w-0 items-center gap-2 text-[11px] text-danger" title={erro}>
          <span className="min-w-0 truncate">Nao deu para ler a biblioteca do Fish: {erro}</span>
          <button
            type="button"
            onClick={() => void carregar(texto)}
            className="shrink-0 text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            Tentar de novo
          </button>
        </p>
      ) : (
        situacao && <p className="text-[11px] leading-relaxed text-ink-3">{situacao}</p>
      )}
    </div>
  )
}

/** O link da voz no site do Fish: la tem as amostras para ouvir antes de gerar. */
export function OuvirNoFish({ voiceId }: { voiceId: string }) {
  if (!voiceId) return null
  return (
    <a
      href={`https://fish.audio/m/${encodeURIComponent(voiceId)}/`}
      target="_blank"
      rel="noreferrer"
      className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
    >
      Ouvir no fish.audio
    </a>
  )
}
