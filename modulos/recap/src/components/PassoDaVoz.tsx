import { useEffect, useRef } from 'react'
import { ArrowLeft, AudioLines, FileAudio, Fish, Loader2, RotateCcw, Settings2, TriangleAlert, Upload, WandSparkles } from 'lucide-react'
import type { ProvedorDeVoz } from '../../shared/tipos-da-voz'
import { palavrasDoRoteiro, roteiroAtual, type RascunhoDoRecap, type Roteiro } from '../../shared/roteiro'
import {
  MODELOS_ELEVEN,
  ROTULO_DA_ETAPA_DA_VOZ,
  ROTULO_DA_FONTE,
  VELOCIDADE_MAX,
  VELOCIDADE_MIN,
  VELOCIDADE_NATIVA_MAX,
  VELOCIDADE_NATIVA_MIN,
  VELOCIDADE_NATIVA_PADRAO,
  VELOCIDADE_NATIVA_PASSO,
  VELOCIDADE_PASSO,
  avisoDoAlvo,
  custoEmDolar,
  ehBotaoPago,
  focoDepoisDaVoz,
  frasesMudadas,
  modeloEleven,
  situacaoDaVoz,
  takeAtual,
  textoDaEstimativa,
  type ConfigDaVoz,
  type FonteDaVoz,
  type TakeDaVoz,
} from '../../shared/voz'
import { useGerar } from '../store/gerar'
import { roteiroAprovado, useRoteiro } from '../store/gerar-roteiro'
import {
  MODELOS_FISH,
  acaoDaNarracao,
  chaveDaEstimativa,
  custoDeRegravar,
  resumoDaFalhaDaVoz,
  textoDaVelocidade,
  useVoz,
  type AcaoDaNarracao,
  type PedidoDaVoz,
} from '../store/gerar-voz'
import { nucleo } from '../nucleo'
import { useRitmoDaConfig } from '../store/ritmo'
import { Deslizante } from '@/modulos/kit'
import { Barra, useRelogio } from './AndamentoDaAnalise'
import { CartaoDoEpisodio } from './CartaoDoEpisodio'
import { ErrosDoAudio } from './ErrosDoAudio'
import { FrasesDaVoz } from './FrasesDaVoz'
import { PerguntaDeCusto } from './PerguntaDeCusto'
import { TocadorDaVoz } from './TocadorDaVoz'
import { Botao, CAMPO_NORMAL, CLASSE_DO_CAMPO, COR_DE_AVISO, Caixinha, Secao, focarBotao, formatarTempo } from './pecas'

/**
 * O PASSO 3 DO ASSISTENTE: a VOZ do roteiro aprovado. O app PARA aqui: ouvir,
 * regravar uma frase, trocar a voz ou a velocidade, voltar a um take, e so
 * entao "Aprovar voz".
 *
 * Tres fontes (shared/voz.ts): ElevenLabs e Fish Audio (pagos: a estimativa e
 * a pergunta de custo vem SEMPRE antes de gastar) e o audio que ele gravou
 * (Whisper + alinhador com o texto do roteiro, de graca). O texto das palavras
 * e sempre o do roteiro; o audio so da os tempos.
 *
 * O motor e o main (electron/services/voz/); a tela e gerar-voz.ts. O
 * rascunho e o mesmo dos passos 2 e 3 (store do roteiro).
 */
export function PassoDaVoz() {
  const rascunhoId = useRoteiro((s) => s.rascunho?.id ?? null)
  const entrar = useVoz((s) => s.entrar)
  const lerAjustes = useVoz((s) => s.lerAjustes)
  const configuracoesAbertas = nucleo().usar((s) => s.settingsOpen)
  const episodioId = useGerar((s) => s.indice?.id ?? null)
  const doRoteiro = useRoteiro((s) => s.episodioId)

  // Reabriu direto no passo 3 (voltar onde parou): quem abre o rascunho e a store do roteiro, que o passo 2 chamaria.
  useEffect(() => {
    if (episodioId && doRoteiro !== episodioId) void useRoteiro.getState().entrar(episodioId)
  }, [episodioId, doRoteiro])

  useEffect(() => {
    if (rascunhoId) entrar(rascunhoId)
  }, [rascunhoId, entrar])

  // Entrou no passo 3 (do 2, ou reabrindo o assistente): o recado era de antes ("Cancelado." de outra visita).
  useEffect(() => {
    useVoz.getState().limparRecado()
  }, [])

  // Ao abrir e quando as Configuracoes fecham: a chave ou a voz padrao podem ter mudado la.
  useEffect(() => {
    if (!configuracoesAbertas && rascunhoId) void lerAjustes()
  }, [configuracoesAbertas, rascunhoId, lerAjustes])

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-6 py-6">
      <CartaoDoEpisodio />
      <Conteudo />
    </div>
  )
}

function Conteudo() {
  const episodioId = useGerar((s) => s.indice?.id ?? null)
  const doRoteiro = useRoteiro((s) => s.episodioId)
  const abrindo = useRoteiro((s) => s.abrindo)
  const rascunho = useRoteiro((s) => s.rascunho)
  const aprovado = useRoteiro(roteiroAprovado)
  const daVoz = useVoz((s) => s.rascunhoId)

  if (abrindo || (rascunho && daVoz !== rascunho.id)) {
    return (
      <Secao titulo="Narracao">
        <p className="flex items-center gap-2 text-[12px] text-ink-2">
          <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
          Abrindo a voz...
        </p>
      </Secao>
    )
  }
  const roteiro = rascunho ? roteiroAtual(rascunho) : null
  if (!rascunho || !roteiro || doRoteiro !== episodioId || !aprovado) return <SemRoteiroAprovado />
  return <ComRoteiro rascunho={rascunho} roteiro={roteiro} />
}

/** O passo 3 so anda com o roteiro aprovado (a voz narra exatamente ele). */
function SemRoteiroAprovado() {
  const irParaPasso = useGerar((s) => s.irParaPasso)
  return (
    <Secao titulo="Narracao">
      <div className="flex min-h-8 items-center gap-3">
        <p className="min-w-0 flex-1 text-[12px] text-ink-2">Aprove o roteiro antes da voz.</p>
        <Botao onClick={() => irParaPasso(2)} title="Voltar ao roteiro (passo 2)">
          <ArrowLeft size={13} strokeWidth={1.5} />
          Roteiro
        </Botao>
      </div>
    </Secao>
  )
}

function ComRoteiro({ rascunho, roteiro }: { rascunho: RascunhoDoRecap; roteiro: Roteiro }) {
  const pedido = useVoz((s) => s.pedido)
  const cancelado = useVoz((s) => s.pedidoCancelado)
  const ajustes = useVoz((s) => s.ajustes)
  const sincronizar = useVoz((s) => s.sincronizar)
  const take = takeAtual(rascunho)
  const takeId = take?.id ?? null
  const situacao = situacaoDaVoz(rascunho, roteiro)

  // O formulario segue o take atual (take novo, "voltar para este take") e, sem take, a voz padrao.
  useEffect(() => {
    sincronizar()
  }, [rascunho.id, takeId, ajustes, sincronizar])

  // O pedido acabou e o foco estava no Cancelar (que sumiu): vai para o "Aprovar voz" (ou o
  // play), NUNCA para um botao que gasta (focoDepoisDaVoz) -- nem fica num deles.
  const temPedido = pedido !== null
  const tinha = useRef(temPedido)
  useEffect(() => {
    if (tinha.current && !temPedido) {
      requestAnimationFrame(() => {
        const ativo = document.activeElement
        const pago = ativo instanceof HTMLElement && ehBotaoPago(ativo.dataset['foco'] ?? '')
        if (!ativo || ativo === document.body || pago) focarBotao(...focoDepoisDaVoz({ cancelado: false }))
      })
    }
    tinha.current = temPedido
  }, [temPedido])

  const andamento = pedido ?? cancelado

  return (
    <>
      <Narracao rascunho={rascunho} take={take} />
      {andamento && <AndamentoDaVoz pedido={andamento} cancelado={!pedido} />}
      {take && situacao === 'desatualizada' && <RoteiroMudou roteiro={roteiro} take={take} />}
      {take && <TocadorDaVoz rascunho={rascunho} take={take} />}
      {take && <FrasesDaVoz roteiro={roteiro} take={take} />}
    </>
  )
}

// ------------------------------------------------------------- a narracao

/**
 * COMO a narracao e feita: a fonte, a voz e o modelo (pagos), a velocidade e
 * o corte de pausas (o pos, de graca), e a acao -- gerar (com o custo do
 * lado), aplicar so o pos, ou soltar o audio gravado.
 */
function Narracao({ rascunho, take }: { rascunho: RascunhoDoRecap; take: TakeDaVoz | null }) {
  const form = useVoz((s) => s.form)
  const ajustes = useVoz((s) => s.ajustes)
  const pedido = useVoz((s) => s.pedido)
  const pergunta = useVoz((s) => (s.pergunta?.onde === 'narracao' ? s.pergunta : null))
  const estimar = useVoz((s) => s.estimar)
  const abrirAjustesDeVoz = useVoz((s) => s.abrirAjustesDeVoz)
  const acao = acaoDaNarracao(form, take, ajustes)
  const chave = acao.tipo === 'gerar' || acao.tipo === 'de-novo' ? chaveDaEstimativa(rascunho, acao.config) : null
  const travado = pedido !== null

  useEffect(() => {
    if (chave) estimar()
  }, [chave, estimar])

  return (
    <Secao
      titulo="Narracao"
      acao={
        <Botao pequeno onClick={abrirAjustesDeVoz} title="Chaves e voz padrao (Configuracoes > Voz)">
          <Settings2 size={12} strokeWidth={1.5} />
          Configurar
        </Botao>
      }
    >
      <Fontes travado={travado} />
      {form.fonte === 'importado' ? (
        <>
          <AreaDaNarracao take={take} travado={travado} />
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <Pos travado={travado} />
          </div>
          {take?.config.fonte === 'importado' && <ErrosDoAudio rascunhoId={rascunho.id} take={take} />}
        </>
      ) : (
        <CamposDaVoz travado={travado} />
      )}
      {pergunta ? (
        <PerguntaDeCusto
          pergunta={pergunta}
          extra={pergunta.config ? <PrevisaoDaDuracao rascunho={rascunho} config={pergunta.config} take={take} exata={false} /> : null}
        />
      ) : (
        <LinhaDaAcao acao={acao} rascunho={rascunho} take={take} />
      )}
      {take && <AbaixoDoAlvo duracao={take.duracao} rascunho={rascunho} />}
    </Secao>
  )
}

/**
 * O take ficou abaixo do alvo do roteiro ("52 s - abaixo de 1 min"): o Levi
 * nao quer video abaixo de 1 min. Fica aqui, junto da velocidade e do
 * acelerar, que e onde se mexe.
 */
function AbaixoDoAlvo({ duracao, rascunho }: { duracao: number; rascunho: RascunhoDoRecap }) {
  const alvo = roteiroAtual(rascunho)?.alvoSec
  const aviso = alvo ? avisoDoAlvo(duracao, alvo) : null
  if (!aviso) return null
  return (
    <p
      className={`flex min-w-0 items-center gap-1.5 text-[12px] ${COR_DE_AVISO}`}
      title="Mais frases no roteiro (Outra versao) ou menos acelerar"
    >
      <TriangleAlert size={12} strokeWidth={1.75} className="shrink-0" />
      <span className="tnum min-w-0 truncate">{aviso}</span>
    </p>
  )
}

const FONTES: readonly { fonte: FonteDaVoz; rotulo: string; icone: React.ReactNode }[] = [
  { fonte: 'elevenlabs', rotulo: 'ElevenLabs', icone: <AudioLines size={12} strokeWidth={1.5} /> },
  { fonte: 'fish', rotulo: 'Fish Audio', icone: <Fish size={12} strokeWidth={1.5} /> },
  { fonte: 'importado', rotulo: 'Importar audio', icone: <Upload size={12} strokeWidth={1.5} /> },
]

/**
 * As tres fontes, no mesmo seletor dos passos do cabecalho. A paga sem chave
 * fica desligada, e o porque fica escrito ao lado (o tooltip de botao
 * desligado nem sempre aparece).
 */
function Fontes({ travado }: { travado: boolean }) {
  const fonte = useVoz((s) => s.form.fonte)
  const ajustes = useVoz((s) => s.ajustes)
  const escolherFonte = useVoz((s) => s.escolherFonte)
  const temChave = (f: FonteDaVoz): boolean =>
    f === 'importado' || !ajustes || (f === 'elevenlabs' ? ajustes.hasElevenKey : ajustes.hasFishKey)
  // A escolhida sem chave ja tem o recado na linha da acao ("Sem chave do ..."): aqui, so as outras.
  const semChave = FONTES.filter((f) => !temChave(f.fonte) && f.fonte !== fonte).map((f) => f.rotulo)

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <div
        role="radiogroup"
        aria-label="Fonte da narracao"
        className="flex items-center gap-0.5 rounded-sm border border-line bg-elevated p-0.5"
      >
        {FONTES.map((f) => {
          const escolhida = f.fonte === fonte
          const livre = temChave(f.fonte)
          const dica = !livre
            ? `Sem chave do ${f.rotulo}. Configuracoes > Voz.`
            : f.fonte === 'importado'
              ? 'A narracao que voce gravou (.wav, .mp3, .m4a)'
              : `Voz do ${f.rotulo}`
          return (
            // O span segura o tooltip: botao desligado nem sempre mostra o dele.
            <span key={f.fonte} title={dica}>
              <button
                type="button"
                role="radio"
                aria-checked={escolhida}
                onClick={() => escolherFonte(f.fonte)}
                disabled={!livre || (travado && !escolhida)}
                className={[
                  'flex h-7 items-center gap-1.5 rounded-[3px] px-3 text-[12px] transition-colors disabled:cursor-not-allowed',
                  escolhida && livre
                    ? 'bg-accent-dim text-ink ring-1 ring-inset ring-accent'
                    : escolhida
                      ? // Escolhida, mas sem chave: marcada (o anel) e apagada como as desligadas, sem o rosa de "pronta".
                        'text-ink-3 opacity-60 ring-1 ring-inset ring-line-strong'
                      : 'text-ink-2 hover:bg-surface hover:text-ink disabled:text-ink-3 disabled:opacity-40 disabled:hover:bg-transparent',
                ].join(' ')}
              >
                {f.icone}
                {f.rotulo}
              </button>
            </span>
          )
        })}
      </div>
      {semChave.length > 0 && (
        <span className="text-[11px] text-ink-3">
          {semChave.join(' e ')} sem chave
        </span>
      )}
    </div>
  )
}

/** Rotulo pequeno em cima do controle, como os campos do passo 1. */
function Campo({
  rotulo,
  canto,
  className = '',
  children,
}: {
  rotulo: string
  canto?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <div className="flex min-h-4 items-center gap-2">
        <span className="text-[11px] text-ink-3">{rotulo}</span>
        <span className="flex-1" />
        {canto}
      </div>
      {children}
    </div>
  )
}

/** Voz, modelo e velocidade nativa da fonte paga, e o pos. As vozes sao as da conta (o "Testar", que nao gasta). */
function CamposDaVoz({ travado }: { travado: boolean }) {
  const form = useVoz((s) => s.form)
  const vozes = useVoz((s) => s.vozes)
  const vozesErro = useVoz((s) => s.vozesErro)
  const carregandoVozes = useVoz((s) => s.carregandoVozes)
  const carregarVozes = useVoz((s) => s.carregarVozes)
  const mudarForm = useVoz((s) => s.mudarForm)
  if (form.fonte === 'importado') return null
  const provedor: ProvedorDeVoz = form.fonte
  const lado = provedor === 'elevenlabs' ? 'eleven' : 'fish'
  const atual = form[lado]
  const lista = vozes[provedor] ?? []
  const carregando = carregandoVozes[provedor]
  const erro = vozesErro[provedor]
  const salvaFora = atual.voiceId !== '' && !lista.some((v) => v.id === atual.voiceId)
  const modelos = provedor === 'elevenlabs' ? MODELOS_ELEVEN.map((m) => ({ id: m.id, nome: m.nome })) : MODELOS_FISH
  const modeloFora = atual.modelId !== '' && !modelos.some((m) => m.id === atual.modelId)

  const mudar = (patch: Partial<{ voiceId: string; modelId: string }>): void =>
    mudarForm((f) => ({ ...f, [lado]: { ...f[lado], ...patch } }))

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3">
        <Campo
          rotulo="Voz"
          className="min-w-[240px] flex-1"
          canto={
            carregando ? (
              <Loader2 size={11} strokeWidth={1.5} className="animate-spin text-ink-3" aria-label="Carregando as vozes" />
            ) : null
          }
        >
          <select
            aria-label="Voz"
            value={atual.voiceId}
            onChange={(e) => mudar({ voiceId: e.target.value })}
            disabled={travado}
            className={`${CLASSE_DO_CAMPO} ${CAMPO_NORMAL} w-full text-ellipsis pr-7`}
          >
            {atual.voiceId === '' && (
              <option value="" disabled>
                {carregando ? 'Carregando vozes...' : 'Escolha uma voz'}
              </option>
            )}
            {salvaFora && (
              <option value={atual.voiceId}>{carregando ? 'Carregando...' : `${atual.voiceId} (salva)`}</option>
            )}
            {lista.map((v) => (
              <option key={v.id} value={v.id}>
                {v.detalhe ? `${v.nome} (${v.detalhe})` : v.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Modelo" className="w-[200px]">
          <select
            aria-label="Modelo"
            value={atual.modelId}
            onChange={(e) => mudar({ modelId: e.target.value })}
            disabled={travado}
            className={`${CLASSE_DO_CAMPO} ${CAMPO_NORMAL} w-full text-ellipsis pr-7`}
          >
            {modeloFora && <option value={atual.modelId}>{atual.modelId}</option>}
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
        </Campo>
        <VelocidadeNativa travado={travado} />
        <Pos travado={travado} />
      </div>
      {erro && (
        <p className="flex min-w-0 items-center gap-2 text-[11px] text-danger" title={erro}>
          <TriangleAlert size={12} strokeWidth={1.5} className="shrink-0" />
          <span className="min-w-0 truncate">Nao deu para ler as vozes da conta</span>
          <button
            type="button"
            onClick={() => void carregarVozes(provedor)}
            className="shrink-0 text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            Tentar de novo
          </button>
        </p>
      )}
    </div>
  )
}

/**
 * A velocidade NATIVA (so ElevenLabs e Fish): a voz ja e gerada nesse ritmo,
 * pausas inclusive (o 1,2 encurta ~1,3x). Muda o audio, entao trocar e gerar
 * de novo, com a pergunta de custo. O eleven_v4 nao tem speed: fica desligada.
 */
function VelocidadeNativa({ travado }: { travado: boolean }) {
  const nativa = useVoz((s) => s.form.nativa)
  const fonte = useVoz((s) => s.form.fonte)
  const modelId = useVoz((s) => s.form.eleven.modelId)
  const mudarForm = useVoz((s) => s.mudarForm)
  const semSpeed = fonte === 'elevenlabs' && !modeloEleven(modelId).estilo
  const desligada = travado || semSpeed
  return (
    <Campo rotulo="Velocidade" className="w-[180px]">
      <div
        className={['flex h-8 items-center gap-2', desligada ? 'pointer-events-none opacity-40' : ''].join(' ')}
        aria-disabled={desligada}
        title={semSpeed ? 'Este modelo nao tem velocidade' : 'Gerada pela voz. Trocar gera de novo (pago).'}
      >
        <Deslizante
          // Sem speed no modelo a voz sai a 1,0: a bolinha mostra isso, nao a do perfil.
          valor={semSpeed ? 1 : nativa}
          min={VELOCIDADE_NATIVA_MIN}
          max={VELOCIDADE_NATIVA_MAX}
          step={VELOCIDADE_NATIVA_PASSO}
          onChange={(v) => mudarForm((f) => ({ ...f, nativa: v }))}
          texto={textoDaVelocidade(semSpeed ? 1 : nativa)}
          padrao={VELOCIDADE_NATIVA_PADRAO}
        />
      </div>
    </Campo>
  )
}

/** Acelerar e corte de pausas: o pos, que vale para as tres fontes e nao gasta nada. */
function Pos({ travado }: { travado: boolean }) {
  const velocidade = useVoz((s) => s.form.velocidade)
  const cortarPausas = useVoz((s) => s.form.cortarPausas)
  const cortarErros = useVoz((s) => s.form.cortarErros)
  const importado = useVoz((s) => s.form.fonte === 'importado')
  const mudarForm = useVoz((s) => s.mudarForm)
  return (
    <>
      <Campo rotulo="Acelerar" className="w-[180px]">
        <div
          className={['flex h-8 items-center gap-2', travado ? 'pointer-events-none opacity-40' : ''].join(' ')}
          aria-disabled={travado}
          title="Depois de gerar, de graca"
        >
          <Deslizante
            valor={velocidade}
            min={VELOCIDADE_MIN}
            max={VELOCIDADE_MAX}
            step={VELOCIDADE_PASSO}
            onChange={(v) => mudarForm((f) => ({ ...f, velocidade: v }))}
            texto={textoDaVelocidade(velocidade)}
            padrao={1}
          />
        </div>
      </Campo>
      <div className="flex h-8 items-center">
        <Caixinha
          ligada={cortarPausas}
          onChange={(ligada) => mudarForm((f) => ({ ...f, cortarPausas: ligada }))}
          disabled={travado}
          title="Pausas de 0,3 s ou mais viram 0,15 s, sem cortar palavra"
        >
          Cortar pausas
        </Caixinha>
      </div>
      {importado && (
        <div className="flex h-8 items-center">
          <Caixinha
            ligada={cortarErros}
            onChange={(ligada) => mudarForm((f) => ({ ...f, cortarErros: ligada }))}
            disabled={travado}
            title="Repeticao, eee e frase lida 2 vezes saem. Fica a ultima leitura."
          >
            Cortar erros
          </Caixinha>
        </div>
      )}
    </>
  )
}

/**
 * O audio que ele gravou: soltar em qualquer lugar do passo (o GerarRecap
 * pega o drop) ou clicar para escolher. Com um take importado na tela, o nome
 * dele fica em cima.
 */
function AreaDaNarracao({ take, travado }: { take: TakeDaVoz | null; travado: boolean }) {
  const escolherArquivo = useVoz((s) => s.escolherArquivo)
  const nome = take?.config.fonte === 'importado' ? take.config.audio.nome : null
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {nome && (
        <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2" title={nome}>
          <FileAudio size={12} strokeWidth={1.5} className="shrink-0 text-ink-3" />
          <span className="min-w-0 truncate">{nome}</span>
        </p>
      )}
      <button
        type="button"
        data-foco="escolher-audio"
        onClick={() => void escolherArquivo()}
        disabled={travado}
        title="O texto vem do roteiro; o audio so da os tempos"
        className="flex h-[96px] w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line transition-colors duration-200 ease-dangai hover:border-line-strong hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <span className="text-[15px] font-semibold tracking-tight text-ink">
          {nome ? 'Soltar outro audio' : 'Soltar a narracao aqui'}
        </span>
        <span className="text-[11px] text-ink-3">.wav .mp3 .m4a · ou clique para escolher</span>
      </button>
    </div>
  )
}

/** O que fazer com o formulario como esta: o custo de um lado, a acao do outro. */
function LinhaDaAcao({
  acao,
  rascunho,
  take,
}: {
  acao: AcaoDaNarracao
  rascunho: RascunhoDoRecap
  take: TakeDaVoz | null
}) {
  const pedido = useVoz((s) => s.pedido)
  const perguntando = useVoz((s) => s.perguntando)
  const falha = useVoz((s) => s.falha)
  const pedirGeracao = useVoz((s) => s.pedirGeracao)
  const aplicarAjuste = useVoz((s) => s.aplicarAjuste)
  const abrirAjustesDeVoz = useVoz((s) => s.abrirAjustesDeVoz)
  const estimativa = useVoz((s) => s.estimativa)
  const ajustesLidos = useVoz((s) => s.ajustes !== null)
  // Uma pergunta de custo aberta noutro lugar (uma frase, o "roteiro mudou") tambem trava: um gasto de cada vez.
  const outraPergunta = useVoz((s) => s.pergunta !== null)
  const travado = pedido !== null || perguntando !== null || outraPergunta
  const resumo = falha && !pedido ? resumoDaFalhaDaVoz(falha) : null
  const primeira = take === null

  // Sem take e sem os ajustes lidos ainda, nao se sabe a voz padrao: nada de "Escolha uma voz" piscando.
  if (primeira && !ajustesLidos && !resumo) return <div className="min-h-8" aria-hidden />

  let esquerda: React.ReactNode = null
  let botao: React.ReactNode = null
  switch (acao.tipo) {
    case 'importar':
      break
    case 'sem-chave':
      esquerda = <span className="text-[12px] text-ink-2">Sem chave do {ROTULO_DA_FONTE[acao.fonte]}</span>
      botao = (
        <Botao principal={primeira} onClick={abrirAjustesDeVoz} title="Cole a chave em Configuracoes > Voz">
          <Settings2 size={13} strokeWidth={1.5} />
          Configuracoes
        </Botao>
      )
      break
    case 'escolher-voz':
      // O select ja diz "Escolha uma voz": a linha fica so com o botao, no rotulo de sempre.
      botao = (
        <Botao principal={primeira} foco="gerar-voz" onClick={() => undefined} disabled title="Escolha uma voz antes">
          <WandSparkles size={13} strokeWidth={1.5} />
          {primeira ? 'Gerar voz' : 'Gerar com esta voz'}
        </Botao>
      )
      break
    case 'aplicar':
      esquerda = (
        <>
          <span className="shrink-0 text-[12px] text-ink-3">Sem custo</span>
          <PrevisaoDaDuracao rascunho={rascunho} config={acao.config} take={take} exata />
        </>
      )
      botao = (
        <Botao
          foco="aplicar-voz"
          onClick={() => void aplicarAjuste()}
          disabled={travado}
          title="Take novo com este acelerar e corte, a partir do audio do take atual. Nao gasta."
        >
          Aplicar
        </Botao>
      )
      break
    case 'gerar':
    case 'de-novo': {
      const chave = chaveDaEstimativa(rascunho, acao.config)
      const valor = estimativa?.chave === chave ? estimativa.valor : null
      const semSaldo = valor?.suficiente === false
      esquerda = (
        <>
          <Estimativa rascunho={rascunho} config={acao.config} />
          <PrevisaoDaDuracao rascunho={rascunho} config={acao.config} take={take} exata={false} />
        </>
      )
      const deNovo = acao.tipo === 'de-novo'
      botao = (
        <Botao
          principal={primeira}
          foco="gerar-voz"
          onClick={() => void pedirGeracao()}
          disabled={travado || semSaldo}
          title={
            semSaldo
              ? 'O que resta na conta nao cobre o roteiro'
              : deNovo
                ? 'Narracao nova, com a mesma voz. Mostra o custo antes de gastar.'
                : 'Um pedido com o roteiro inteiro. Mostra o custo antes de gastar.'
          }
        >
          {deNovo ? <RotateCcw size={13} strokeWidth={1.5} /> : <WandSparkles size={13} strokeWidth={1.5} />}
          {perguntando === 'narracao'
            ? 'Calculando...'
            : deNovo
              ? 'Gerar tudo de novo'
              : primeira
                ? 'Gerar voz'
                : 'Gerar com esta voz'}
        </Botao>
      )
      break
    }
  }

  if (!resumo && esquerda === null && botao === null) return null
  return (
    <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {resumo ? (
          <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2" title={falha ?? undefined}>
            <TriangleAlert size={12} strokeWidth={1.5} className="shrink-0 text-danger" />
            <span className="min-w-0 truncate">{resumo.curto}</span>
          </p>
        ) : (
          esquerda
        )}
      </div>
      {resumo?.configuracoes && acao.tipo !== 'sem-chave' && (
        <Botao onClick={abrirAjustesDeVoz} title="Chaves de voz (Configuracoes > Voz)">
          <Settings2 size={13} strokeWidth={1.5} />
          Configuracoes
        </Botao>
      )}
      {botao}
    </div>
  )
}

/**
 * A DURACAO PREVISTA do take que o Gerar ou o Aplicar vao fazer, ANTES de
 * gastar ou de aplicar ("~48 s - abaixo de 1 min" em laranja). O aviso do take
 * pronto (AbaixoDoAlvo) so chegava depois de pago.
 * - Aplicar so o acelerar (o corte de pausas igual): exato, o take atual
 *   reescalado (o atempo sai com N/v amostras).
 * - O resto: as palavras do roteiro no ritmo da config do formulario (o mesmo
 *   ritmo aprendido do passo 2).
 */
function PrevisaoDaDuracao({
  rascunho,
  config,
  take,
  exata,
}: {
  rascunho: RascunhoDoRecap
  config: ConfigDaVoz
  take: TakeDaVoz | null
  exata: boolean
}) {
  const roteiro = roteiroAtual(rascunho)
  const reescalado =
    exata && take && take.config.cortarPausas === config.cortarPausas ? (take.duracao * take.config.velocidade) / config.velocidade : null
  const ritmo = useRitmoDaConfig(reescalado === null ? config : null, take?.id ?? null)
  if (!roteiro) return null
  const segundos = reescalado ?? (ritmo ? palavrasDoRoteiro(roteiro) / ritmo : null)
  if (segundos === null || !(segundos > 0)) return null
  const aviso = avisoDoAlvo(segundos, roteiro.alvoSec)
  return (
    <span
      className={['tnum flex min-w-0 shrink items-center gap-1 text-[12px]', aviso ? COR_DE_AVISO : 'text-ink-3'].join(' ')}
      title={reescalado !== null ? 'Duracao do take com este acelerar' : 'Duracao prevista no ritmo desta voz'}
    >
      {aviso && <TriangleAlert size={11} strokeWidth={1.75} className="shrink-0" />}
      <span className="truncate">~{aviso ?? `${Math.round(segundos)} s`}</span>
    </span>
  )
}

/**
 * O custo ao lado do Gerar: a estimativa do main ("1.034 caracteres (~227
 * creditos) · ElevenLabs · restam 9.745 creditos"). Enquanto ela nao chega, so
 * "Conferindo o custo...": a conta da tela nao sabe do cache, e mostrava por um
 * instante um custo que nao existia.
 */
function Estimativa({ rascunho, config }: { rascunho: RascunhoDoRecap; config: ConfigDaVoz }) {
  const estimativa = useVoz((s) => s.estimativa)
  const chave = chaveDaEstimativa(rascunho, config)
  const valida = estimativa?.chave === chave ? estimativa : null
  const e = valida?.valor ?? null
  if (e) {
    const semSaldo = e.suficiente === false
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={['tnum min-w-0 truncate text-[12px]', semSaldo ? 'text-danger' : 'text-ink-2'].join(' ')}
          title={[
            `${e.caracteres.toLocaleString('pt-BR')} caracteres no roteiro${e.doCache ? ' (ja no cache: nao cobra)' : ''}`,
            e.creditos !== null ? `~${Math.ceil(e.creditos).toLocaleString('pt-BR')} creditos pela taxa da conta (do character-cost das chamadas anteriores)` : null,
            e.restam !== null ? `restam ${e.restam.toLocaleString('pt-BR')} creditos no plano${e.plano ? ` (${e.plano})` : ''}` : null,
            e.dolares !== null && e.dolares !== undefined ? `${custoEmDolar(e.dolares)} pelo preco do Fish (US$ 15 por milhao de bytes de texto)` : null,
          ]
            .filter(Boolean)
            .join('\n')}
        >
          {textoDaEstimativa(e)}
          {semSaldo ? ' · saldo insuficiente' : ''}
        </span>
        {e.aviso && (
          <span title={e.aviso} className={`flex min-w-0 items-center gap-1 text-[11px] ${COR_DE_AVISO}`}>
            <TriangleAlert size={11} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">{e.aviso}</span>
          </span>
        )}
      </span>
    )
  }
  if (valida?.erro) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3" title={`Sem a estimativa do servico: ${valida.erro}`}>
        <TriangleAlert size={11} strokeWidth={1.75} className={`shrink-0 ${COR_DE_AVISO}`} />
        <span className="truncate">Custo indisponivel · {ROTULO_DA_FONTE[config.fonte]}</span>
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3" title="Conferindo o cache e o saldo (nao gasta)">
      <Loader2 size={11} strokeWidth={1.5} className="shrink-0 animate-spin" />
      Conferindo o custo...
    </span>
  )
}

// ------------------------------------------------------------- andamento

/**
 * O ANDAMENTO DE UM PEDIDO AO MOTOR: a etapa, o tempo decorrido, a barra (com
 * fracao quando o main sabe) e o Cancelar -- o mesmo cartao do passo 2.
 *
 * O Cancelar e honesto: o que ja foi PAGO nao se perde (vira take so na lista
 * de Takes, sem tomar a tela).
 */
function AndamentoDaVoz({ pedido, cancelado }: { pedido: PedidoDaVoz; cancelado: boolean }) {
  const cancelar = useVoz((s) => s.cancelar)
  const agora = useRelogio(!cancelado)
  const decorrido = Math.max(0, (agora - pedido.inicio) / 1000)
  const n = pedido.fraseIds.length
  const titulo =
    pedido.tipo === 'regravar' && (pedido.etapa === 'gerando' || pedido.etapa === 'preparando')
      ? `Regravando ${n} ${n === 1 ? 'frase' : 'frases'}`
      : pedido.tipo === 'importar' && pedido.etapa === 'preparando'
        ? 'Importando o audio'
        : pedido.tipo === 'ajustar' && pedido.etapa === 'preparando'
          ? 'Ajustando'
          : ROTULO_DA_ETAPA_DA_VOZ[pedido.etapa]
  const frase = cancelado
    ? 'Cancelado.'
    : (pedido.mensagem ?? (pedido.comecou ? 'Comecando...' : 'Esperando o pedido anterior...'))
  const pago = pedido.tipo === 'gerar' || pedido.tipo === 'regravar'

  const cancelarEDevolverFoco = (): void => {
    cancelar()
    // O botao some com o andamento: o foco vai para o play ou o Aprovar, nunca para um que gasta.
    focarBotao(...focoDepoisDaVoz({ cancelado: true }))
  }

  return (
    <Secao
      titulo={titulo}
      acao={
        <div className="flex items-center gap-3">
          <span className="tnum text-[11px] text-ink-3" title="Tempo decorrido">
            {formatarTempo(decorrido)}
          </span>
          {!cancelado && (
            <Botao
              pequeno
              foco="cancelar-voz"
              onClick={cancelarEDevolverFoco}
              title={pago ? 'Para o pedido. Se a voz ja tiver chegado (paga), ela fica em Takes.' : 'Para o pedido.'}
            >
              Cancelar
            </Botao>
          )}
        </div>
      }
    >
      {cancelado ? <div className="h-[3px] w-full rounded-full bg-line-strong" /> : <Barra fracao={pedido.fracao} />}
      <p className="min-w-0 select-text truncate text-[11px] text-ink-2" title={frase} aria-live="polite">
        {frase}
      </p>
    </Secao>
  )
}

// ------------------------------------------------------- o roteiro mudou

/**
 * O roteiro mudou o que se FALA depois da voz (texto de tela e evento nao
 * contam): a voz fica desatualizada e nao pode ser aprovada. O caminho barato
 * e regravar so as frases que mudaram (as removidas saem de graca); no audio
 * importado, gravar e importar de novo.
 */
function RoteiroMudou({ roteiro, take }: { roteiro: Roteiro; take: TakeDaVoz }) {
  const pedido = useVoz((s) => s.pedido)
  const perguntando = useVoz((s) => s.perguntando)
  const pergunta = useVoz((s) => (s.pergunta?.onde === 'mudou' ? s.pergunta : null))
  // A pergunta de custo de OUTRO lugar (o Gerar, uma frase) tambem trava: um gasto de cada vez.
  const outraPergunta = useVoz((s) => s.pergunta !== null && s.pergunta.onde !== 'mudou')
  const pedirRegravar = useVoz((s) => s.pedirRegravar)
  const escolherArquivo = useVoz((s) => s.escolherArquivo)
  const m = frasesMudadas(roteiro, take)
  const n = m.mudadas.length + m.novas.length + m.removidas.length
  const custo = custoDeRegravar(roteiro, take, [])
  const importado = take.config.fonte === 'importado'
  const travado = pedido !== null || perguntando !== null || outraPergunta
  const plural = (q: number, um: string, varios: string): string => `${q} ${q === 1 ? um : varios}`
  const detalhe = [
    m.mudadas.length > 0 ? plural(m.mudadas.length, 'frase mudou', 'frases mudaram') : null,
    m.novas.length > 0 ? plural(m.novas.length, 'frase nova', 'frases novas') : null,
    m.removidas.length > 0 ? plural(m.removidas.length, 'frase removida', 'frases removidas') : null,
    m.ordemMudou ? 'a ordem mudou' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="enter flex min-w-0 flex-col gap-2 rounded-md border border-line bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-2" title={detalhe}>
          <TriangleAlert size={12} strokeWidth={1.75} className={`shrink-0 ${COR_DE_AVISO}`} />
          <span className="min-w-0 truncate">Roteiro mudou · {n > 0 ? plural(n, 'frase', 'frases') : 'ordem'}</span>
        </p>
        {importado ? (
          <Botao
            pequeno
            foco="regravar-mudou"
            onClick={() => void escolherArquivo()}
            disabled={travado}
            title="Grave o roteiro novo e importe o audio"
          >
            <Upload size={12} strokeWidth={1.5} />
            Importar de novo
          </Botao>
        ) : (
          <Botao
            pequeno
            foco="regravar-mudou"
            onClick={() => void pedirRegravar([], 'mudou')}
            disabled={travado || pergunta !== null}
            title={
              custo.caracteres > 0
                ? `Gera so as frases que mudaram, com o contexto das vizinhas (~${custo.creditos} caracteres)`
                : 'Tira as frases removidas e acerta a ordem. Nao gasta.'
            }
          >
            <RotateCcw size={12} strokeWidth={1.5} />
            {perguntando === 'mudou' ? 'Calculando...' : custo.caracteres > 0 ? 'Regravar so o que mudou' : 'Atualizar a voz'}
            {perguntando !== 'mudou' && custo.creditos > 0 && <span className="tnum text-ink-3">~{custo.creditos}</span>}
          </Botao>
        )}
      </div>
      {/* Botoes pequenos, como o "Regravar so o que mudou" deste cartao. */}
      {pergunta && <PerguntaDeCusto pergunta={pergunta} pequeno />}
    </section>
  )
}
