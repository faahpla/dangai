import { useEffect } from 'react'
import { Cpu, Loader2 } from 'lucide-react'
import { useGerar } from '../store/gerar'
import { runtimeFora, useMotorRuntime } from '../store/motor-runtime'
import { textoDoRuntime } from './motor-runtime/BotaoDoMotor'
import { ConfigDoMotorRuntime } from './motor-runtime/ConfigDoMotor'
import { ConferirDeNovo } from './ResultadoDaBusca'
import { resumoDoMotor } from './pecas'

/**
 * [recap] O MOTOR DE PERSONAGENS nas Configuracoes (a secao do modulo, depois
 * da Biblioteca do recap): o pedaco "Motor de personagens" do AjustesDoStudio
 * -- se responde, com que GPU (ou o porque nao) -- e o runtime dele (pasta,
 * Instalar, Reinstalar, Remover: ConfigDoMotorRuntime). O rotulo e a linha de
 * cima sao do nucleo (SecoesDosModulos).
 *
 * Abrir confere o motor de novo quando ele nao estava pronto (pode ter sido
 * instalado depois); pronto, a resposta e o cache do main.
 */
export function SecaoDoMotor() {
  const motor = useGerar((s) => s.motor)
  const motorErro = useGerar((s) => s.motorErro)
  const conferirMotor = useGerar((s) => s.conferirMotor)
  const runtime = useMotorRuntime((s) => s.estado)
  const foraDoRuntime = runtimeFora(runtime)

  useEffect(() => {
    if (!useGerar.getState().motor?.studio.pronto) void conferirMotor()
  }, [conferirMotor])

  const estado = resumoDoMotor(motor, motorErro)
  return (
    <div className="pb-2">
      <p className="flex items-center gap-2 text-[12px]">
        {estado.estado === 'conferindo' ? (
          <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
        ) : (
          <Cpu size={13} strokeWidth={1.5} className="shrink-0 text-ink-3" />
        )}
        <span
          className={[
            'min-w-0 flex-1 select-text truncate',
            runtime && foraDoRuntime ? (runtime.fase === 'instalando' ? 'text-ink-2' : 'text-danger') : estado.estado === 'fora' ? 'text-danger' : 'text-ink-2',
          ].join(' ')}
          title={estado.detalhe}
        >
          {/* Sem o runtime: a frase dele (a sondagem pode ser de antes de um Remover). */}
          {runtime && foraDoRuntime ? textoDoRuntime(runtime) : estado.texto}
        </span>
        {estado.estado === 'fora' && !foraDoRuntime && <ConferirDeNovo />}
      </p>
      <ConfigDoMotorRuntime />
    </div>
  )
}
