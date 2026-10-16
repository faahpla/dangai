import { useEffect, useState } from 'react'
import { Check, FileText, Loader2, Scissors } from 'lucide-react'
import { ROTULO_DA_ORIGEM, type ComoAchou, type EpisodioEncontrado } from '../../shared/episodio'
import { nomeNatural } from '@shared/nomes'
import { useGerar } from '../store/gerar'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { Chip } from '@/components/painel'
import { AbrirPasta, Aviso, Botao, Contagem, EmBreve, Link, nuvemDoCaminho, Secao } from './pecas'

/** Como a busca achou, em poucas palavras. O jargao (impressao digital, indice) fica de fora. */
const COMO_ACHOU: Record<ComoAchou, string> = {
  source: 'Mesmo arquivo',
  impressao: 'Mesmo arquivo (mudou de pasta)',
  nome: 'Mesmo nome de arquivo',
  'anime+episodio': 'So o nome bate',
}

/** Quantos personagens cabem em chips no achado antes do "e mais N". */
const PERSONAGENS_DO_ACHADO = 12

function quando(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * (c) O RESULTADO DA BUSCA nas bibliotecas e a decisao que ele pede.
 *
 * Achou: o mais forte vem na frente, com o que ja existe (cenas, personagens)
 * e dois caminhos -- usar o que esta la, que e de graca, ou cortar de novo no
 * Studio. Nao achou: analisar, no Studio ou no AnCut HUB quando ele esta
 * instalado.
 *
 * UMA acao principal por tela: com o pedido de descoberta aberto em cima
 * (PedidoDeDescoberta), o principal e o dele, e os daqui ficam neutros.
 */
export function ResultadoDaBusca() {
  const fase = useGerar((s) => s.fase)
  const busca = useGerar((s) => s.busca)
  const procurando = useGerar((s) => s.procurando)
  const sonda = useGerar((s) => s.sonda)
  const [escolhido, setEscolhido] = useState(0)

  // Busca nova, escolha nova: o indice velho apontaria para outro achado.
  useEffect(() => setEscolhido(0), [busca])

  if (fase !== 'escolha' || !sonda) return null

  if (procurando || busca === null) {
    return (
      <Secao titulo="Bibliotecas">
        <p className="flex items-center gap-2 text-[12px] text-ink-2">
          <Loader2 size={13} strokeWidth={1.5} className="animate-spin text-accent" />
          Procurando nas bibliotecas...
        </p>
      </Secao>
    )
  }

  if (busca.length === 0) return <EpisodioNovo />

  const achado = busca[Math.min(escolhido, busca.length - 1)]!
  return (
    <Secao
      titulo="Ja analisado"
      acao={
        <AbrirPasta
          caminho={achado.pasta}
          title={
            achado.origem === 'studio' ? 'Mostrar no Explorer' : 'Mostrar no Explorer (so leitura: o recap nao mexe nela)'
          }
        />
      }
    >
      <Achado achado={achado} />

      {busca.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium text-ink-2">Achado em</span>
          {busca.map((b, i) => (
            <Chip key={`${b.origem}:${b.pasta}`} active={i === escolhido} onClick={() => setEscolhido(i)}>
              <span title={b.pasta}>
                {ROTULO_DA_ORIGEM[b.origem]} · <span className="tnum">{b.totalCenas}</span> cenas
                {b.comoAchou === 'anime+episodio' ? ' · so o nome' : ''}
              </span>
            </Chip>
          ))}
        </div>
      )}

      <Acoes achado={achado} />
    </Secao>
  )
}

function Achado({ achado }: { achado: EpisodioEncontrado }) {
  const data = quando(achado.analisadoEm)
  const fraco = achado.comoAchou === 'anime+episodio'
  // Duas grafias que viram o mesmo nome na tela ("Saionji, Ukyou" e "Ukyo
  // Saionji") contam como uma, com a maior contagem -- como no ResumoDoEpisodio.
  const porNome = new Map<string, number>()
  for (const p of achado.personagens) {
    const nome = nomeNatural(p.nome)
    porNome.set(nome, Math.max(porNome.get(nome) ?? 0, p.cenas))
  }
  const personagens = [...porNome].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n)
  const sobram = personagens.length - PERSONAGENS_DO_ACHADO
  return (
    <div className="flex flex-col gap-2.5">
      <p className="tnum text-[13px] text-ink">
        {ROTULO_DA_ORIGEM[achado.origem]} · {achado.totalCenas.toLocaleString('pt-BR')} cenas ·{' '}
        {personagens.length === 0
          ? 'sem personagens'
          : `${personagens.length} ${personagens.length === 1 ? 'personagem' : 'personagens'}`}
      </p>
      {personagens.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {personagens.slice(0, PERSONAGENS_DO_ACHADO).map((p) => (
            <Contagem key={p.nome} nome={p.nome} n={p.n} unidade={['cena', 'cenas']} />
          ))}
          {sobram > 0 && <span className="px-1 py-1 text-[11px] text-ink-3">e mais {sobram}</span>}
        </div>
      )}
      <p className="text-[11px] text-ink-3">
        {[
          COMO_ACHOU[achado.comoAchou],
          data ? `analisado em ${data}` : null,
          achado.fotosDoElenco ? `fotos do elenco: ${achado.fotosDoElenco}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="select-text truncate text-[11px] text-ink-3" title={achado.pasta}>
        {achado.pasta}
      </p>
      {fraco && (
        <Aviso title="So o nome da serie e o numero do episodio batem: pode ser outro release, com os tempos deslocados. Se as falas cairem nas cenas erradas, confira a pasta.">
          Pode ser outro release. Confira a pasta antes de usar.
        </Aviso>
      )}
    </div>
  )
}

/**
 * Os botoes do achado: usar o que existe. [recap] Cortar de novo e reconhecer
 * personagens rodam o motor (parte 4): no lugar deles, a linha "em breve".
 */
function Acoes({ achado }: { achado: EpisodioEncontrado }) {
  const usarAnalise = useGerar((s) => s.usarAnalise)

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Botao
          principal
          onClick={() => void usarAnalise(achado)}
          title={
            achado.origem === 'studio'
              ? 'Usa as cenas que ja estao cortadas e le a legenda'
              : `Usa as cenas do ${ROTULO_DA_ORIGEM[achado.origem]} sem mexer nelas (so leitura) e le a legenda`
          }
        >
          <Check size={13} strokeWidth={1.5} />
          Usar essa analise
        </Botao>
      </div>
      <EmBreve icone={<Scissors size={12} strokeWidth={1.5} className="shrink-0" />}>Cortar de novo</EmBreve>
    </div>
  )
}

/**
 * (c) sem achado: o episodio e novo. As falas nao precisam do motor e saem em
 * segundos; o roteiro libera com elas (decisao do Levi, 14/10).
 *
 * [recap] Parte 1: o corte das cenas por tras ainda nao existe, entao o botao
 * so le as falas ("Ler as falas"), e a linha de baixo diz que o corte vem.
 */
function EpisodioNovo() {
  const analisar = useGerar((s) => s.analisar)
  const semAnime = useGerar((s) => !s.palpite?.anime.trim())
  const nuvem = useNuvemDaBiblioteca()
  // So o nome do anime e obrigatorio (da nome a pasta do indice).
  const bloqueio = semAnime ? 'Falta o nome do anime' : null

  return (
    <Secao titulo="Episodio novo">
      <p className="text-[13px] text-ink">Ainda nao cortado.</p>
      {nuvem && (
        <Aviso title="Cada episodio cortado (cenas e keyframes, perto de 1 GB) entra na sincronizacao da nuvem.">
          Biblioteca no {nuvem} (~1 GB por episodio).{' '}
          <Link
            onClick={() => useGerar.getState().abrirAjustesDoStudio()}
            title="Abre as Configuracoes na Biblioteca do recap (Ctrl+,)"
          >
            Trocar pasta
          </Link>
        </Aviso>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Botao
          principal
          onClick={() => void analisar('studio')}
          disabled={bloqueio !== null}
          title={bloqueio ?? 'Le as falas e sugere a abertura e o encerramento'}
        >
          <FileText size={13} strokeWidth={1.5} />
          Ler as falas
        </Botao>
      </div>
      <EmBreve icone={<Scissors size={12} strokeWidth={1.5} className="shrink-0" />}>Cortar cenas</EmBreve>
    </Secao>
  )
}

/**
 * O servico de nuvem em que a biblioteca do recap esta (nuvemDoCaminho), ou
 * null. Le de novo quando as Configuracoes fecham: o "Trocar pasta" abre elas
 * por cima do assistente, e o aviso tem que sumir quando a pasta mudou.
 */
function useNuvemDaBiblioteca(): string | null {
  const [nuvem, setNuvem] = useState<string | null>(null)
  const configuracoesAbertas = nucleo().usar((s) => s.settingsOpen)
  useEffect(() => {
    if (configuracoesAbertas) return
    let vivo = true
    void ponte.lerConfig().then((r) => {
      if (vivo && r.ok) setNuvem(nuvemDoCaminho(r.value.bibliotecaEfetiva))
    })
    return () => {
      vivo = false
    }
  }, [configuracoesAbertas])
  return nuvem
}

/**
 * O motor parou pedindo ajuda para achar o elenco. [recap] Sem motor (parte
 * 4), ele nunca para assim: nada a mostrar.
 */
export function PedidoDeDescoberta() {
  return null
}
