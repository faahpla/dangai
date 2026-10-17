import { Download, Loader2 } from 'lucide-react'
import { textoDoTamanho, type EstadoDoMotorRuntime } from '../../../shared/motor-runtime'
import { runtimeFora, useMotorRuntime } from '../../store/motor-runtime'
import { Botao } from '../pecas'

/**
 * As entradas da tela "Instalar motor" fora do 1o uso: a linha do motor do
 * assistente (LinhaDoMotor) e as Configuracoes. So aparecem no app instalado
 * com o motor fora (ausente, parado, desatualizado, instalando); em dev e com
 * o motor pronto, nada.
 */

/** A frase curta do motor pelo runtime (no lugar da do statusDoMotor, que pode estar velha). */
export function textoDoRuntime(estado: EstadoDoMotorRuntime): string {
  switch (estado.fase) {
    case 'instalando':
      return 'Instalando o motor'
    case 'incompleto':
      return 'Instalacao do motor parou'
    case 'desatualizado':
      return 'Motor precisa de atualizacao'
    default:
      return 'Motor nao instalado'
  }
}

/** O rotulo do botao pela fase: "Instalar motor (~3 GB)", "Continuar instalacao", "Atualizar motor", "Instalando 43%". */
function rotulo(estado: EstadoDoMotorRuntime): string {
  switch (estado.fase) {
    case 'instalando': {
      const f = estado.andamento?.fracao
      return f === null || f === undefined ? 'Instalando...' : `Instalando ${Math.round(f * 100)}%`
    }
    case 'incompleto':
      return 'Continuar instalacao'
    case 'desatualizado':
      return 'Atualizar motor'
    default:
      return `Instalar motor (${textoDoTamanho(Math.max(estado.bytesParaBaixar, 1e6))})`
  }
}

/**
 * Abre a tela "Instalar motor". `depois` roda quando o motor ficar pronto (o
 * "Tentar de novo" do corte que parou por falta dele).
 */
export function BotaoDoMotorRuntime({ depois, principal = false }: { depois?: () => void; principal?: boolean }) {
  const estado = useMotorRuntime((s) => s.estado)
  if (!estado || !runtimeFora(estado)) return null
  return (
    <Botao
      pequeno
      principal={principal}
      onClick={() => useMotorRuntime.getState().abrir(depois)}
      title="Python e torch do motor de personagens, baixados das fontes oficiais. Uma vez so."
    >
      {estado.fase === 'instalando' ? (
        <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
      ) : (
        <Download size={12} strokeWidth={1.5} />
      )}
      {rotulo(estado)}
    </Botao>
  )
}

/**
 * A linha da Edicao rapida quando o rosto saiu do detector antigo porque o
 * motor nao esta instalado (app instalado): o que aconteceu e o link. Com o
 * motor pronto, ou em dev, nada.
 */
export function RostoSemMotor({ fonte }: { fonte: string | null | undefined }) {
  const estado = useMotorRuntime((s) => s.estado)
  if (fonte !== 'lbp' || !estado || !runtimeFora(estado)) return null
  return (
    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-2">
      <span className="min-w-0 truncate">Rosto pelo detector antigo: sem o motor.</span>
      <button
        type="button"
        onClick={() => useMotorRuntime.getState().abrir()}
        className="shrink-0 text-ink-3 underline-offset-2 hover:text-ink hover:underline"
      >
        {estado.fase === 'instalando' ? 'Ver instalacao' : 'Instalar motor'}
      </button>
    </p>
  )
}
