import { useEffect } from 'react'
import { Check, Loader2, Send } from 'lucide-react'
import { useAncut } from '../store/ancut'
import { Botao, COR_DE_AVISO } from './pecas'

/**
 * O botao "Enviar para o AnCut" (L1) do episodio pronto (passo 1), so no
 * episodio cortado pelo recap. Sem o AnCut nesta maquina: "AnCut nao
 * encontrado", apagado. Ja esta la: pergunta substituir ou pular.
 */
export function EnviarAoAncut({ episodioId }: { episodioId: string }) {
  const achado = useAncut((s) => s.achado)
  const envio = useAncut((s) => s.porEpisodio[episodioId] ?? null)
  const conferirAchado = useAncut((s) => s.conferirAchado)
  const enviar = useAncut((s) => s.enviar)
  const responder = useAncut((s) => s.responder)

  useEffect(() => {
    if (achado === null) void conferirAchado()
  }, [achado, conferirAchado])

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
        <Botao pequeno onClick={() => void responder(episodioId, true)} title="Troca o episodio de la por este (o antigo fica no backup)">
          Substituir
        </Botao>
        <Botao pequeno onClick={() => void responder(episodioId, false)} title="Deixa o que esta no AnCut">
          Pular
        </Botao>
      </span>
    )
  }
  const ocupado = envio?.fase === 'conferindo' || envio?.fase === 'enviando'
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
          onClick={() => void enviar(episodioId)}
          disabled={ocupado || achado === null}
          title="Copia as cenas e o banco deste episodio para a biblioteca do AnCut. Feche o AnCut antes."
        >
          {ocupado ? <Loader2 size={12} strokeWidth={1.5} className="animate-spin" /> : <Send size={12} strokeWidth={1.5} />}
          {ocupado ? 'Enviando...' : 'Enviar para o AnCut'}
        </Botao>
      )}
    </span>
  )
}
