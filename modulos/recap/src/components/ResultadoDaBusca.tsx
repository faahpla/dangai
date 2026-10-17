import { useEffect, useState } from 'react'
import { Check, Cpu, Loader2, Scissors, Users, X } from 'lucide-react'
import { ROTULO_DA_ORIGEM, type ComoAchou, type EpisodioEncontrado } from '../../shared/episodio'
import { nomeNatural } from '@shared/nomes'
import { useGerar } from '../store/gerar'
import { cortarEReconhecer, usarEReconhecer } from '../store/gerar-descoberta'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { Chip } from '@/modulos/kit'
import { runtimeFora, useMotorRuntime } from '../store/motor-runtime'
import { BotaoDoMotorRuntime, textoDoRuntime } from './motor-runtime/BotaoDoMotor'
import { AbrirPasta, Aviso, Botao, Caixinha, Contagem, gpuCurta, Link, nuvemDoCaminho, resumoDoMotor, Secao } from './pecas'

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
        <Aviso title="So o nome da serie e o numero do episodio batem: pode ser outro release, com os tempos deslocados. Se as falas cairem nas cenas erradas, analise de novo.">
          Pode ser outro release. Confira a pasta antes de usar.
        </Aviso>
      )}
    </div>
  )
}

/**
 * Os botoes do achado: usar o que existe, ou cortar de novo no Studio. Cenas
 * do Studio sem personagem nenhum (o caso do Nia Liston): [Reconhecer na mao]
 * ja aqui -- usa a analise e abre a tela de grupos, sem passar pelo resumo.
 */
function Acoes({ achado }: { achado: EpisodioEncontrado }) {
  const usarAnalise = useGerar((s) => s.usarAnalise)
  const analisar = useGerar((s) => s.analisar)
  const reconhecer = useGerar((s) => s.reconhecer)
  const definirReconhecer = useGerar((s) => s.definirReconhecer)
  const temDescoberta = useGerar((s) => s.descoberta !== null)
  const bloqueio = useBloqueioDoStudio()
  const semPersonagens = achado.origem === 'studio' && achado.personagens.length === 0 && achado.totalCenas > 0

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Botao
          principal={!temDescoberta}
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
        {semPersonagens && (
          <Botao
            onClick={() => void usarEReconhecer(achado)}
            disabled={bloqueio !== null}
            title={bloqueio ?? 'Usa essa analise e o motor agrupa os rostos: voce da o nome a cada grupo'}
          >
            <Users size={13} strokeWidth={1.5} />
            Reconhecer na mao
          </Botao>
        )}
        <Botao
          onClick={() => void analisar('studio')}
          disabled={bloqueio !== null}
          title={bloqueio ?? 'Corta o episodio inteiro de novo, na biblioteca do recap'}
        >
          <Scissors size={13} strokeWidth={1.5} />
          Analisar de novo
        </Botao>
        {/* A caixinha so vale para o "Analisar de novo": fica colada nele. */}
        <span className="ml-1">
          <Caixinha ligada={reconhecer} onChange={definirReconhecer} title="Vale para o Analisar de novo">
            Reconhecer personagens
          </Caixinha>
        </span>
      </div>
      <LinhaDoMotor />
    </div>
  )
}

/** Quanto a analise leva, numa linha, pelo que vai ser feito. */
function tempoEstimado(reconhecer: boolean, jaCortado: boolean): string {
  if (jaCortado) return reconhecer ? 'So falta o elenco' : 'Segundos, sem personagens'
  return reconhecer ? 'Cerca de 5 min (1a vez do anime: +9 min)' : 'Cerca de 1 min, sem personagens'
}

/**
 * O episodio novo nao espera o corte (decisao do Levi, 14/10): as falas saem
 * em segundos e o roteiro libera; as cenas vem por tras.
 */
function tempoSemEsperar(reconhecer: boolean): string {
  return reconhecer ? 'Falas na hora; cenas em ~5 min, por tras' : 'Falas na hora; cenas em ~1 min, por tras'
}

/** (c) sem achado: o episodio e novo e precisa ser cortado. */
function EpisodioNovo() {
  const analisar = useGerar((s) => s.analisar)
  const reconhecer = useGerar((s) => s.reconhecer)
  const definirReconhecer = useGerar((s) => s.definirReconhecer)
  const motor = useGerar((s) => s.motor)
  const temDescoberta = useGerar((s) => s.descoberta !== null)
  const semAnime = useGerar((s) => !s.palpite?.anime.trim())
  const corteSemIndice = useGerar((s) => s.corteSemIndice)
  const nuvem = useNuvemDaBiblioteca()
  /*
   * As falas nao precisam do motor: com ele fora (ou ainda conferindo), o
   * botao le as falas do mesmo jeito e o corte espera, com o porque na secao
   * Cenas. So o nome do anime e obrigatorio (da nome a pasta das cenas).
   */
  const bloqueio = semAnime ? 'Falta o nome do anime' : null

  return (
    <Secao titulo={corteSemIndice ? 'Cenas cortadas' : 'Episodio novo'}>
      {/* O motor cortou e parou no elenco: as cenas existem, so os personagens nao. */}
      <p className="text-[13px] text-ink">
        {corteSemIndice ? 'Faltam os personagens.' : 'Episodio ainda nao cortado.'}
      </p>
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

      {/* A escolha vem antes dos botoes: vale para qualquer um deles. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Caixinha ligada={reconhecer} onChange={definirReconhecer}>
          Reconhecer personagens
        </Caixinha>
        <span className="text-[11px] text-ink-3">
          {corteSemIndice ? tempoEstimado(reconhecer, true) : tempoSemEsperar(reconhecer)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Botao
          principal={!temDescoberta}
          onClick={() => void analisar('studio')}
          disabled={bloqueio !== null}
          title={bloqueio ?? 'Le as falas agora e corta as cenas por tras, na biblioteca do recap'}
        >
          <Scissors size={13} strokeWidth={1.5} />
          Analisar
        </Botao>
        {motor?.ancut.instalado && (
          <Botao
            onClick={() => void analisar('ancut')}
            disabled={semAnime}
            title={
              semAnime
                ? 'Falta o nome do anime'
                : `Le as falas agora e corta por tras com o AnCut HUB instalado${motor.ancut.caminho ? ` (${motor.ancut.caminho})` : ''}. As cenas ficam na biblioteca dele, e o recap le de la.`
            }
          >
            <Scissors size={13} strokeWidth={1.5} />
            Analisar com o AnCut
          </Botao>
        )}
      </div>
      <LinhaDoMotor />
    </Secao>
  )
}

/**
 * Por que o "Analisar no Studio" esta desligado, em texto para o tooltip.
 * null = pode analisar.
 */
function useBloqueioDoStudio(): string | null {
  const motor = useGerar((s) => s.motor)
  const motorErro = useGerar((s) => s.motorErro)
  const semAnime = useGerar((s) => !s.palpite?.anime.trim())
  const runtime = useMotorRuntime((s) => s.estado)
  if (semAnime) return 'Falta o nome do anime'
  // App instalado sem o motor: o clique abre a tela "Instalar motor" (pedirMotor) e segue depois.
  if (runtimeFora(runtime)) return null
  if (motorErro) return `Nao deu para conferir o motor: ${motorErro}`
  if (!motor) return 'Conferindo o motor...'
  if (!motor.studio.pronto) return motor.studio.erro ?? 'O motor nao esta pronto'
  return null
}

/**
 * O servico de nuvem em que a biblioteca do Studio esta (nuvemDoCaminho), ou
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
 * Sonda o motor de novo. O main so guarda a resposta pronta, entao um probe
 * que estourou o tempo (disco frio) ou um venv instalado com o app aberto se
 * resolvem aqui, sem reiniciar.
 */
export function ConferirDeNovo() {
  const conferir = useGerar((s) => s.conferirMotor)
  const conferindo = useGerar((s) => s.conferindoMotor)
  return (
    <Link onClick={() => void conferir()} disabled={conferindo}>
      {conferindo ? 'Conferindo...' : 'Conferir de novo'}
    </Link>
  )
}

/**
 * Uma linha discreta sobre o motor: pronto (e com que GPU) ou por que nao. O
 * detalhe (versao, caminho, a frase inteira) fica no tooltip.
 *
 * No app instalado com o motor fora (runtime ausente, parado, desatualizado ou
 * instalando), a frase vem do runtime e o botao abre a tela "Instalar motor";
 * `depois` roda quando ele ficar pronto.
 */
export function LinhaDoMotor({ depois }: { depois?: () => void } = {}) {
  const motor = useGerar((s) => s.motor)
  const motorErro = useGerar((s) => s.motorErro)
  const runtime = useMotorRuntime((s) => s.estado)
  const r = resumoDoMotor(motor, motorErro)

  if (runtime && runtimeFora(runtime)) {
    const instalando = runtime.fase === 'instalando'
    return (
      <p className={['flex flex-wrap items-center gap-1.5 text-[11px]', instalando ? 'text-ink-3' : 'text-danger'].join(' ')}>
        <Cpu size={12} strokeWidth={1.5} className="shrink-0" />
        <span className="min-w-0 select-text truncate" title={runtime.erro?.mensagem ?? r.detalhe}>
          {textoDoRuntime(runtime)}
        </span>
        <BotaoDoMotorRuntime depois={depois} />
      </p>
    )
  }

  if (r.estado === 'conferindo') {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
        <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
        {r.texto}
      </p>
    )
  }
  if (r.estado === 'fora') {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-danger">
        <Cpu size={12} strokeWidth={1.5} className="shrink-0" />
        <span className="min-w-0 select-text truncate" title={r.detalhe}>
          {r.texto}
        </span>
        <ConferirDeNovo />
      </p>
    )
  }
  const studio = motor!.studio
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-ink-3" title={r.detalhe}>
      <Cpu size={12} strokeWidth={1.5} className="shrink-0" />
      {['Motor pronto', studio.gpu ? gpuCurta(studio.gpu) : 'sem GPU (bem mais lento)', motor!.ancut.instalado ? 'AnCut HUB' : null]
        .filter(Boolean)
        .join(' · ')}
    </p>
  )
}

/**
 * O motor parou pedindo ajuda para achar o elenco ("Analisar de novo" com
 * Reconhecer ligado). O principal e o [Reconhecer na mao] (pedido do Levi,
 * 15/10): corta sem personagens (reaproveita o corte do disco quando o motor
 * ja cortou) e, com as cenas no indice, abre a tela de grupos
 * (cortarEReconhecer). So o motor do Studio agrupa; o do AnCut fica no cortar.
 *
 * Uma frase so: o fato e o que fazer. A frase do motor vai no tooltip (antes
 * eram tres frases dizendo que o anime nao foi achado).
 */
export function PedidoDeDescoberta() {
  const fase = useGerar((s) => s.fase)
  const descoberta = useGerar((s) => s.descoberta)
  const anime = useGerar((s) => s.palpite?.anime ?? '')
  const analisar = useGerar((s) => s.analisar)
  const esquecer = useGerar((s) => s.esquecerDescoberta)
  const bloqueio = useBloqueioDoStudio()

  if (fase !== 'escolha' || !descoberta) return null
  const naMao = descoberta.motor === 'studio'

  return (
    <Secao titulo="Elenco nao encontrado">
      <p className="text-[13px] text-ink" title={descoberta.erro || undefined}>
        {descoberta.motivo === 'anime-nao-encontrado'
          ? `Nao achei "${anime.trim()}" no AniList/MAL. Corrija o nome (em romaji) ou ${naMao ? 'reconheca na mao' : 'corte sem personagens'}.`
          : naMao
            ? `Sem fotos do elenco de "${anime.trim()}". Reconheca na mao: voce da os nomes.`
            : `Sem fotos do elenco de "${anime.trim()}", nem no Corte Cenas. Tente mais tarde ou corte sem personagens.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {naMao && (
          <Botao
            principal
            foco="reconhecer-na-mao"
            onClick={() => void cortarEReconhecer()}
            disabled={bloqueio !== null}
            title={bloqueio ?? 'Corta sem personagens e o motor agrupa os rostos: voce da o nome a cada grupo. As fotos servem para os proximos episodios.'}
          >
            <Users size={13} strokeWidth={1.5} />
            Reconhecer na mao
          </Botao>
        )}
        <Botao principal={!naMao} onClick={() => void analisar(descoberta.motor, false)}>
          <Scissors size={13} strokeWidth={1.5} />
          Cortar sem personagens
        </Botao>
        <Botao onClick={esquecer}>
          <X size={13} strokeWidth={1.5} />
          Agora nao
        </Botao>
      </div>
    </Secao>
  )
}
