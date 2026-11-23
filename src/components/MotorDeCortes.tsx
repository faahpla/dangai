import { useEffect, useState } from 'react'
import { Check, Circle, Cpu, Download, FileText, FolderOpen, HardDrive, Loader2, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import {
  ETAPAS_DA_INSTALACAO,
  ROTULO_DA_ETAPA,
  textoDoTamanho,
  type EstadoDoMotorRuntime,
  type EtapaDaInstalacao,
  type VarianteDoMotor,
} from '@shared/runtime-do-motor'
import { ouvirMotorDeCortes, useMotorDeCortes } from '@/store/motor-de-cortes'

/**
 * O MOTOR DE CORTES (23/11): "deixa como opcao da pessoa baixar se quiser
 * esse motor, igual funciona no modulo recap". O painel que baixa, mostra o
 * andamento, continua de onde parou, atualiza e remove o Python do motor do
 * AnCut (~3 GB uma vez so). Mora dentro do Cortar episodios (quando nao ha
 * motor, ou quando ele quer trocar o do AnCut pelo do Dangai) e nas
 * Configuracoes. Fechar a tela nao para nada: a instalacao continua por tras,
 * e se o app fechar, continua de onde parou.
 */

/** "1,2 GB" / "45 MB". */
export function tamanhoCurto(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1).replace('.', ',')} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

/** "RTX 3060" (sem o "NVIDIA GeForce"). */
function placaCurta(nome: string): string {
  return nome.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '')
}

/** A placa que o motor vai usar, ou o motivo de ir pela CPU. */
export function textoDaPlaca(e: EstadoDoMotorRuntime): string {
  if (!e.gpu) return 'Procurando a placa…'
  const variante: VarianteDoMotor = e.variante ?? e.varianteSugerida
  if (variante === 'cu128' && e.cudaOk === false) return e.gpu.nome ? `${placaCurta(e.gpu.nome)}: pela CPU` : 'Pela CPU'
  if (variante === 'cu128') return e.gpu.nome ? placaCurta(e.gpu.nome) : 'NVIDIA'
  // A cpu com uma NVIDIA: ou ele escolheu a versao leve, ou a placa e velha demais para o torch.
  if (e.gpu.nome) return e.varianteSugerida === 'cu128' ? 'Versão leve, sem a placa (mais lenta)' : 'Pela CPU (a placa é antiga demais)'
  return 'Sem NVIDIA: pela CPU, mais lento'
}

const botao = 'flex h-8 items-center gap-1.5 rounded-sm border border-line bg-elevated px-3 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40'
const principal = 'flex h-8 items-center gap-1.5 rounded-sm bg-accent px-4 text-[12px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-40'

/**
 * O painel inteiro. `compacto` (o do Cortar episodios com o motor do AnCut
 * ja valendo) esconde a explicacao longa.
 */
export function PainelDoMotor({ compacto = false }: { compacto?: boolean }) {
  const estado = useMotorDeCortes((s) => s.estado)
  useEffect(() => {
    ouvirMotorDeCortes()
    void useMotorDeCortes.getState().conferir()
  }, [])
  if (!estado) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-ink-3">
        <Loader2 size={13} className="animate-spin" /> Vendo o motor de cortes…
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3" data-motor={estado.fase}>
      {estado.fase === 'instalando' ? (
        <Instalando estado={estado} />
      ) : estado.fase === 'incompleto' ? (
        <Parou estado={estado} />
      ) : estado.fase === 'desatualizado' ? (
        <Desatualizado estado={estado} />
      ) : estado.fase === 'pronto' ? (
        <Pronto estado={estado} />
      ) : (
        <Ausente estado={estado} compacto={compacto} />
      )}
    </div>
  )
}

/** Placa, disco e pasta: o que a instalacao vai usar. */
function Detalhes({ estado, trocarPasta }: { estado: EstadoDoMotorRuntime; trocarPasta: boolean }) {
  const { escolherPasta } = useMotorDeCortes.getState()
  const falta = estado.livreNoDisco !== null && estado.precisaDeLivre > 0 && estado.livreNoDisco < estado.precisaDeLivre
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="flex h-7 items-center gap-1.5 rounded-sm border border-line bg-elevated px-2 text-[11px] text-ink-2"
          title={estado.gpu?.nome ? `${estado.gpu.nome}${estado.gpu.driver ? ` · driver ${estado.gpu.driver}` : ''}` : undefined}
        >
          <Cpu size={12} strokeWidth={1.5} className="shrink-0 text-ink-3" />
          {textoDaPlaca(estado)}
        </span>
        <span className="flex h-7 items-center gap-1.5 rounded-sm border border-line bg-elevated px-2 text-[11px] text-ink-2" title="Quanto o motor ocupa depois de instalado">
          <HardDrive size={12} strokeWidth={1.5} className="shrink-0 text-ink-3" />
          {tamanhoCurto(estado.bytesNoDisco)} no disco
        </span>
        {estado.livreNoDisco !== null && (
          <span className={['tnum text-[11px]', falta ? 'text-danger' : 'text-ink-3'].join(' ')}>
            {falta ? `Precisa de ${tamanhoCurto(estado.precisaDeLivre)} livres (tem ${tamanhoCurto(estado.livreNoDisco)})` : `Livre: ${tamanhoCurto(estado.livreNoDisco)}`}
          </span>
        )}
      </div>
      {estado.gpu?.driverAntigo && (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-2">
          <TriangleAlert size={12} strokeWidth={1.5} className="shrink-0 text-ink-3" />
          Atualize o driver da NVIDIA (o seu é {estado.gpu.driver}).
        </p>
      )}
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-ink-3">
        <FolderOpen size={12} strokeWidth={1.5} className="shrink-0" />
        <span className="min-w-0 flex-1 select-text truncate" title={estado.pasta}>
          {estado.pasta}
        </span>
        {trocarPasta && (
          <>
            {!estado.pastaPadrao && (
              <button type="button" onClick={() => void escolherPasta(true)} className="shrink-0 underline-offset-2 hover:text-ink hover:underline">
                Usar o padrão
              </button>
            )}
            <button type="button" onClick={() => void escolherPasta()} title="Outro disco (precisa de ~5 GB)" className="shrink-0 underline-offset-2 hover:text-ink hover:underline">
              Trocar
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function ErroDoPedido() {
  const erro = useMotorDeCortes((s) => s.erroDoPedido)
  if (!erro) return null
  return <p className="select-text text-[11px] leading-relaxed text-danger">{erro}</p>
}

function ErroDoEstado({ estado }: { estado: EstadoDoMotorRuntime }) {
  if (!estado.erro) return null
  return (
    <p className="flex items-start gap-1.5 text-[12px] text-danger" title={estado.erro.detalhe}>
      <TriangleAlert size={13} strokeWidth={1.5} className="mt-px shrink-0" />
      <span className="min-w-0 select-text">{estado.erro.mensagem}</span>
    </p>
  )
}

function Barra({ fracao }: { fracao: number | null }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
      {fracao === null ? (
        <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/60" />
      ) : (
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(Math.max(0, Math.min(1, fracao)) * 100)}%` }} />
      )}
    </div>
  )
}

function Ausente({ estado, compacto }: { estado: EstadoDoMotorRuntime; compacto: boolean }) {
  const { instalar } = useMotorDeCortes.getState()
  return (
    <>
      {!compacto && (
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-medium text-ink">Baixe o motor de cortes</p>
          <p className="text-[12px] leading-relaxed text-ink-3">
            É o mesmo motor do AnCut: corta o episódio em cenas e reconhece os personagens. Baixa uma vez só, das fontes oficiais (Python e
            PyTorch), e fica no computador. O histórico, os personagens e a pasta dos animes são os mesmos do AnCut.
          </p>
        </div>
      )}
      <Detalhes estado={estado} trocarPasta />
      <ErroDoEstado estado={estado} />
      <ErroDoPedido />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={principal} onClick={() => void instalar()} disabled={!estado.gpu} data-motor="baixar">
          <Download size={13} strokeWidth={2} />
          Baixar o motor ({textoDoTamanho(Math.max(estado.bytesParaBaixar, 1e6))})
        </button>
        {estado.gpu?.nome && estado.varianteSugerida === 'cu128' && (
          <button
            type="button"
            className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            onClick={() => void instalar({ variante: 'cpu' })}
            title="Sem usar a placa de vídeo: baixa ~250 MB, mas corta e reconhece bem mais devagar"
          >
            Versão leve, sem a placa
          </button>
        )}
      </div>
    </>
  )
}

/** O rotulo do chip: uma palavra (sete chips cabem numa linha). */
const CURTO: Record<EtapaDaInstalacao, string> = {
  preparar: 'Preparar',
  python: 'Python',
  venv: 'Ambiente',
  'baixar-torch': 'Baixar',
  torch: 'Instalar',
  pacotes: 'Pacotes',
  conferir: 'Conferir',
}

function Etapas({ estado }: { estado: EstadoDoMotorRuntime }) {
  const atual = estado.andamento?.etapa ?? 'preparar'
  const iAtual = ETAPAS_DA_INSTALACAO.indexOf(atual)
  const vivo = estado.fase === 'instalando'
  return (
    <ol className="flex gap-1">
      {ETAPAS_DA_INSTALACAO.map((etapa, i) => {
        const eAtual = etapa === atual
        const feita = i < iAtual
        return (
          <li
            key={etapa}
            title={ROTULO_DA_ETAPA[etapa]}
            className={[
              'flex h-7 min-w-0 flex-auto items-center gap-1 rounded-sm border px-1.5',
              eAtual ? (vivo ? 'border-accent bg-accent-dim' : 'border-line-strong bg-elevated') : 'border-line bg-elevated',
            ].join(' ')}
          >
            {eAtual && vivo ? (
              <Loader2 size={10} strokeWidth={1.75} className="shrink-0 animate-spin text-accent" />
            ) : feita ? (
              <Check size={10} strokeWidth={2} className="shrink-0 text-ink-2" />
            ) : eAtual ? (
              <TriangleAlert size={10} strokeWidth={1.75} className="shrink-0 text-ink-3" />
            ) : (
              <Circle size={10} strokeWidth={1.5} className="shrink-0 text-ink-3" />
            )}
            <span className={['min-w-0 truncate text-[10px]', eAtual ? 'text-ink' : feita ? 'text-ink-2' : 'text-ink-3'].join(' ')}>{CURTO[etapa]}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Instalando({ estado }: { estado: EstadoDoMotorRuntime }) {
  const { cancelar } = useMotorDeCortes.getState()
  const [cancelando, setCancelando] = useState(false)
  const a = estado.andamento
  const bytes = a?.baixados !== undefined && a.total ? `${tamanhoCurto(a.baixados)} de ${tamanhoCurto(a.total)}` : null
  const velocidade = a?.bytesPorSegundo ? `${Math.max(0.1, a.bytesPorSegundo / 1e6).toFixed(a.bytesPorSegundo >= 1e7 ? 0 : 1).replace('.', ',')} MB/s` : null
  return (
    <>
      <p className="text-[13px] font-medium text-ink">Baixando o motor de cortes</p>
      <Etapas estado={estado} />
      <Barra fracao={a?.fracao ?? null} />
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 select-text truncate text-[12px] text-ink-2" title={a?.mensagem}>
          {a?.mensagem ?? 'Preparando'}
        </p>
        <span className="tnum shrink-0 text-[11px] text-ink-3">
          {[bytes, velocidade, a?.fracao !== null && a?.fracao !== undefined ? `${Math.round(a.fracao * 100)}%` : null].filter(Boolean).join(' · ')}
        </span>
      </div>
      <p className="text-[11px] text-ink-3">Pode fechar esta janela: continua por trás. Se o Dangai fechar, continua de onde parou.</p>
      <ErroDoPedido />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={botao}
          onClick={() => {
            setCancelando(true)
            void cancelar().finally(() => setCancelando(false))
          }}
          disabled={cancelando}
          title="Para o download. O que já baixou fica para o Continuar."
        >
          {cancelando ? 'Parando…' : 'Parar'}
        </button>
      </div>
    </>
  )
}

function Parou({ estado }: { estado: EstadoDoMotorRuntime }) {
  const { instalar } = useMotorDeCortes.getState()
  const fracao = estado.andamento?.fracao ?? 0
  const etapa = estado.andamento ? ROTULO_DA_ETAPA[estado.andamento.etapa] : null
  const conferencia = estado.erro?.tipo === 'conferencia'
  return (
    <>
      <Etapas estado={estado} />
      <Barra fracao={fracao} />
      <p className="text-[13px] text-ink">
        O download do motor parou em {Math.round(fracao * 100)}%{etapa ? ` (${etapa})` : ''}.
      </p>
      <ErroDoEstado estado={estado} />
      <Detalhes estado={estado} trocarPasta={false} />
      <ErroDoPedido />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={conferencia ? botao : principal} onClick={() => void instalar()} data-motor="continuar">
          Continuar ({textoDoTamanho(Math.max(estado.bytesParaBaixar, 1e6))})
        </button>
        {conferencia && (
          <button type="button" className={principal} onClick={() => void instalar({ recomecar: true })} title="Apaga o que foi instalado e faz do zero">
            <RotateCcw size={12} strokeWidth={1.75} />
            Recomeçar
          </button>
        )}
        {estado.log && (
          <button type="button" className={botao} onClick={() => void window.dangai.revealFile(estado.log!)} title={estado.log}>
            <FileText size={12} strokeWidth={1.75} />
            Abrir o log
          </button>
        )}
      </div>
    </>
  )
}

function Desatualizado({ estado }: { estado: EstadoDoMotorRuntime }) {
  const { instalar } = useMotorDeCortes.getState()
  const m = estado.mudancas
  const oQue = m?.python ? 'Python novo' : m?.torch ? 'PyTorch novo' : m ? `${m.pacotes.length} ${m.pacotes.length === 1 ? 'biblioteca' : 'bibliotecas'}` : null
  return (
    <>
      <p className="text-[13px] text-ink" title={m?.pacotes.join('\n') || undefined}>
        O motor de cortes precisa de uma atualização ({textoDoTamanho(Math.max(estado.bytesParaBaixar, 1e6))}).
      </p>
      {oQue && <p className="text-[11px] text-ink-3">{oQue}. O resto fica.</p>}
      <ErroDoEstado estado={estado} />
      <ErroDoPedido />
      <div className="flex items-center gap-2">
        <button type="button" className={principal} onClick={() => void instalar()}>
          Atualizar o motor
        </button>
      </div>
    </>
  )
}

function Pronto({ estado }: { estado: EstadoDoMotorRuntime }) {
  const { remover } = useMotorDeCortes.getState()
  const [confirmar, setConfirmar] = useState(false)
  return (
    <>
      <p className="flex items-center gap-2 text-[13px] text-ink">
        <Check size={14} strokeWidth={2} className="shrink-0 text-emerald-300" />
        Motor de cortes pronto · {textoDaPlaca(estado)}
      </p>
      <Detalhes estado={estado} trocarPasta={false} />
      <ErroDoPedido />
      <div className="flex items-center gap-2">
        {confirmar ? (
          <>
            <span className="text-[12px] text-ink-2">Apagar o motor ({tamanhoCurto(estado.bytesNoDisco)})? Os animes cortados ficam.</span>
            <button type="button" className={botao} onClick={() => setConfirmar(false)}>
              Não
            </button>
            <button
              type="button"
              className="flex h-8 items-center gap-1.5 rounded-sm bg-danger px-3 text-[12px] font-semibold text-white hover:opacity-90"
              onClick={() => {
                setConfirmar(false)
                void remover()
              }}
            >
              Apagar
            </button>
          </>
        ) : (
          <button type="button" className={botao} onClick={() => setConfirmar(true)} title="Libera o espaço do motor. Dá para baixar de novo quando quiser.">
            <Trash2 size={12} strokeWidth={1.75} />
            Remover o motor
          </button>
        )}
      </div>
    </>
  )
}

/**
 * A SECAO "CORTAR EPISODIOS" DAS CONFIGURACOES (23/11): o motor, a pasta onde
 * as cenas ficam e o que o AnCut deixava ajustar (o mesmo config.json: mudar
 * aqui vale no AnCut tambem).
 */
export function ConfigDoCorte() {
  const [cfg, setCfg] = useState<import('@shared/ancut').ConfigDoMotor | null>(null)
  const [erro, setErro] = useState('')
  const ler = async (): Promise<void> => {
    const r = await window.dangai.ancutConfig()
    if (r.ok) setCfg(r.value.config)
  }
  useEffect(() => {
    void ler()
  }, [])
  const gravar = async (m: Partial<import('@shared/ancut').ConfigDoMotor>): Promise<void> => {
    setErro('')
    const r = await window.dangai.ancutGravarConfig(m)
    if (r.ok) setCfg((c) => ({ ...(c ?? {}), ...r.value }))
    else setErro(r.error)
  }
  const formato = cfg?.render_export_mode === 'off' || cfg?.render_export_mode === 'intra' ? cfg.render_export_mode : 'compat'
  return (
    <div className="flex flex-col gap-3" data-secao="cortar">
      <PainelDoMotor />
      <div>
        <p className="mb-1.5 text-[11px] font-medium text-ink-2">Onde as cenas cortadas ficam</p>
        <button
          type="button"
          onClick={async () => {
            const r = await window.dangai.ancutEscolherSaida()
            if (r.ok && r.value) {
              const s = await window.dangai.getSettings()
              if (s.ok && !s.value.libraryDir) await window.dangai.saveSettings({ libraryDir: r.value })
              await ler()
            }
          }}
          className="lift flex w-full items-center gap-2 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:text-ink"
        >
          <FolderOpen size={13} strokeWidth={1.5} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{cfg?.output_dir || 'Escolher a pasta…'}</span>
        </button>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">A mesma pasta do AnCut: uma pasta por anime, e dentro dela uma por episódio.</p>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={cfg?.pular_capitulos !== false}
          onChange={(e) => void gravar({ pular_capitulos: e.target.checked })}
          className="mt-0.5 accent-[var(--color-accent)]"
        />
        <span className="text-[12px] text-ink-2">
          Pular abertura, encerramento e prévia
          <span className="block text-[11px] leading-relaxed text-ink-3">Quando o vídeo marca os capítulos (OP, ED, prévia), eles não viram cena.</span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={cfg?.use_danbooru === true}
          onChange={(e) => void gravar({ use_danbooru: e.target.checked })}
          className="mt-0.5 accent-[var(--color-accent)]"
        />
        <span className="text-[12px] text-ink-2">
          Usar o Danbooru como fonte extra de fotos
          <span className="block text-[11px] leading-relaxed text-ink-3">
            Tem mais imagens, mas muita fan art com vários personagens juntos, o que atrapalha o reconhecimento. Ligue só se o anime tiver tag boa.
          </span>
        </span>
      </label>
      <div>
        <p className="mb-1.5 text-[11px] font-medium text-ink-2">Formato dos clipes</p>
        <select
          value={formato}
          onChange={(e) => void gravar({ render_export_mode: e.target.value })}
          className="h-8 w-full rounded-sm border border-line bg-elevated px-2 text-[12px] text-ink focus:border-accent focus:outline-none"
          aria-label="Formato dos clipes"
        >
          <option value="compat">Compatível com o render (recomendado)</option>
          <option value="intra">Compatível + pular quadro a quadro rápido (~1,8x o tamanho)</option>
          <option value="off">O formato original do episódio</option>
        </select>
      </div>
      {erro && <p className="text-[11px] text-danger">{erro}</p>}
    </div>
  )
}
