import { useEffect } from 'react'
import { Check, FolderInput, Loader2, Merge } from 'lucide-react'
import type { EpisodeIndex } from '../../shared/episodio'
import { useAncut } from '../store/ancut'
import { Botao, COR_DE_AVISO } from './pecas'

/**
 * O botao "Mover para o AnCut" (L1) do episodio pronto (passo 1), so no
 * episodio cortado pelo recap. MOVE: depois dele fica uma copia so, a do
 * AnCut, e aqui aparece "No AnCut". Sem o AnCut nesta maquina: "AnCut nao
 * encontrado", apagado. Ja esta la diferente: pergunta substituir ou pular.
 * Ja esta la IGUAL (a versao antiga copiava): o botao vira "Unificar".
 */
export function EnviarAoAncut({ indice }: { indice: EpisodeIndex }) {
  const episodioId = indice.id
  const noAncut = indice.biblioteca.origem === 'ancut' && indice.biblioteca.movidoDoRecap === true
  const achado = useAncut((s) => s.achado)
  const envio = useAncut((s) => s.porEpisodio[episodioId] ?? null)
  const conferirAchado = useAncut((s) => s.conferirAchado)
  const conferirRotulo = useAncut((s) => s.conferirRotulo)
  const enviar = useAncut((s) => s.enviar)
  const responder = useAncut((s) => s.responder)
  const unificar = useAncut((s) => s.unificar)

  useEffect(() => {
    if (achado === null) void conferirAchado()
  }, [achado, conferirAchado])

  // O rotulo: "Unificar" quando a copia antiga ja esta igual la (sem olhar o processo do AnCut).
  useEffect(() => {
    if (achado === true && !noAncut) void conferirRotulo(episodioId)
  }, [achado, noAncut, episodioId, conferirRotulo])

  if (noAncut) {
    return (
      <span className="flex items-center gap-2" data-ancut={envio?.fase === 'trazendo' ? 'trazendo' : 'no-ancut'}>
        {envio?.fase === 'trazendo' ? (
          <span className="flex items-center gap-1 text-[11px] text-ink-2">
            <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
            Trazendo...
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-ink-2" title="Uma copia so, na biblioteca do AnCut">
            <Check size={12} strokeWidth={1.75} className="text-accent" />
            No AnCut
          </span>
        )}
        {envio?.fase === 'recusado' && (
          <span className={`max-w-[260px] truncate text-[11px] ${COR_DE_AVISO}`} title={envio.mensagem}>
            {envio.mensagem}
          </span>
        )}
      </span>
    )
  }
  if (achado === false && envio?.fase !== 'feito') {
    return (
      <span className="text-[11px] text-ink-3" title="Sem a config e o banco do AnCut HUB neste PC" data-ancut="nao-encontrado">
        AnCut nao encontrado
      </span>
    )
  }
  if (envio?.fase === 'perguntando') {
    return (
      <span className="flex items-center gap-2 text-[11px] text-ink-2" data-ancut="perguntando">
        Ja esta no AnCut
        <Botao pequeno onClick={() => void responder(episodioId, true)} title="Troca o episodio de la por este (o antigo vai para a Lixeira)">
          Substituir
        </Botao>
        <Botao pequeno onClick={() => void responder(episodioId, false)} title="Deixa o que esta no AnCut">
          Pular
        </Botao>
      </span>
    )
  }
  const ocupado = envio?.fase === 'conferindo' || envio?.fase === 'enviando' || envio?.fase === 'unificando' || envio?.fase === 'trazendo'
  const unificavel = envio?.fase === 'unificavel'
  return (
    <span className="flex items-center gap-2" data-ancut={envio?.fase ?? 'pronto'}>
      {envio?.fase === 'feito' && (
        <span className="flex items-center gap-1 text-[11px] text-ink-2" title={envio.mensagem}>
          <Check size={12} strokeWidth={1.75} className="text-accent" />
          No AnCut
        </span>
      )}
      {envio?.fase === 'recusado' && (
        <span className={`max-w-[260px] truncate text-[11px] ${COR_DE_AVISO}`} title={envio.mensagem}>
          {envio.mensagem}
        </span>
      )}
      {envio?.fase !== 'feito' && (
        <Botao
          pequeno
          onClick={() => void (unificavel ? unificar(episodioId) : enviar(episodioId))}
          disabled={ocupado || achado === null}
          title={
            unificavel
              ? 'Ja esta igual no AnCut: o recap passa a usar a de la, e a daqui vai para a Lixeira.'
              : 'Move as cenas e o banco deste episodio para a biblioteca do AnCut. Fica uma copia so. Feche o AnCut antes.'
          }
        >
          {ocupado ? (
            <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
          ) : unificavel ? (
            <Merge size={12} strokeWidth={1.5} />
          ) : (
            <FolderInput size={12} strokeWidth={1.5} />
          )}
          {envio?.fase === 'unificando' ? 'Unificando...' : ocupado ? 'Movendo...' : unificavel ? 'Unificar' : 'Mover para o AnCut'}
        </Botao>
      )}
    </span>
  )
}
