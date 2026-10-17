import { useEffect, useState } from 'react'
import { FolderOpen, RotateCcw, Trash2 } from 'lucide-react'
import { textoDoTamanho } from '../../../shared/motor-runtime'
import { useMotorRuntime } from '../../store/motor-runtime'
import { Botao, Link, meioDoCaminho } from '../pecas'
import { BotaoDoMotorRuntime } from './BotaoDoMotor'
import { tamanhoCurto } from './InstalarMotor'

/**
 * O motor de personagens nas Configuracoes (AjustesDoStudio), so no app
 * instalado: onde esta, quanto ocupa, instalar/continuar/atualizar,
 * reinstalar e remover. Em dev (fase 'dev') nao aparece: o motor e o
 * motor/.venv.
 *
 * Reinstalar e Remover pedem um 2o clique (o botao vira "Confirmar..." por
 * alguns segundos): um clique perdido nao pode apagar 5 GB nem baixar 3 GB.
 */
export function ConfigDoMotorRuntime() {
  const estado = useMotorRuntime((s) => s.estado)
  const erro = useMotorRuntime((s) => s.erroDoPedido)
  const [confirmar, setConfirmar] = useState<'remover' | 'reinstalar' | null>(null)

  useEffect(() => {
    void useMotorRuntime.getState().conferir()
  }, [])
  useEffect(() => {
    if (!confirmar) return
    const t = setTimeout(() => setConfirmar(null), 4000)
    return () => clearTimeout(t)
  }, [confirmar])

  if (!estado || estado.fase === 'dev') return null
  const { instalar, remover, escolherPasta, abrir } = useMotorRuntime.getState()
  const instalado = estado.fase === 'pronto' || estado.fase === 'desatualizado' || estado.fase === 'incompleto'

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-ink-3">
        <FolderOpen size={12} strokeWidth={1.5} className="shrink-0" />
        <span className="min-w-0 select-text truncate" title={estado.pasta}>
          {meioDoCaminho(estado.pasta, 52)}
        </span>
        {(estado.fase === 'pronto' || estado.fase === 'desatualizado') && (
          <span className="tnum shrink-0">{tamanhoCurto(estado.bytesNoDisco)}</span>
        )}
        <span className="flex-1" />
        {instalado && <Link onClick={() => void window.dangai.revealFile(estado.pasta)}>Abrir</Link>}
        {estado.fase === 'ausente' && (
          <>
            {!estado.pastaPadrao && <Link onClick={() => void escolherPasta(true)}>Usar o padrao</Link>}
            <Link onClick={() => void escolherPasta()} title="Outro disco (precisa de ~5 GB)">
              Trocar pasta
            </Link>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <BotaoDoMotorRuntime />
        {instalado && (
          <Botao
            pequeno
            onClick={() => {
              if (confirmar !== 'reinstalar') return setConfirmar('reinstalar')
              setConfirmar(null)
              abrir()
              void instalar({ recomecar: true })
            }}
            title="Apaga o ambiente do motor e instala de novo, das fontes oficiais"
          >
            <RotateCcw size={12} strokeWidth={1.5} />
            {confirmar === 'reinstalar' ? `Confirmar: baixar de novo (${textoDoTamanho(estado.variante === 'cpu' ? 3.2e8 : 3e9)})` : 'Reinstalar'}
          </Botao>
        )}
        {instalado && (
          <Botao
            pequeno
            onClick={() => {
              if (confirmar !== 'remover') return setConfirmar('remover')
              setConfirmar(null)
              void remover()
            }}
            title="Apaga o Python e o torch do motor (a pasta motor-runtime). Os episodios cortados ficam."
          >
            <Trash2 size={12} strokeWidth={1.5} />
            {confirmar === 'remover' ? `Confirmar: apagar ${tamanhoCurto(estado.bytesNoDisco)}` : 'Remover motor'}
          </Botao>
        )}
      </div>
      {erro && <p className="select-text text-[11px] leading-relaxed text-danger">{erro}</p>}
      {estado.apagando && (
        <p className="text-[11px] text-ink-3" title="Fechar o app agora espera terminar de apagar">
          Apagando o motor antigo...
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-ink-3">Python e torch do motor, baixados no 1o uso. Ficam fora da pasta do app.</p>
    </div>
  )
}
