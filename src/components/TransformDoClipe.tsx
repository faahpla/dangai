import { ChevronLeft, ChevronRight, Diamond, Trash2 } from 'lucide-react'
import { MOTION_CURVES, type SobreposicaoSalva } from '@shared/contract'
import { chaveEm, ordenadas, type Transform2D } from '@shared/transform'
import { useProject } from '@/store/project'
import {
  TOLERANCIA_DA_CHAVE,
  animado,
  patchDeChaveAqui,
  patchDoTransform,
  patchSemAnimacao,
  patchSemChaveAqui,
  tempoNoClipe,
  transformNaAgulha,
} from '@/store/transform-do-clipe'
import { Botaozinho, Deslizante, Linha, Segmentos } from './painel'

const RITMO: Record<(typeof MOTION_CURVES)[number], string> = {
  'ease-in-out': 'Suave',
  linear: 'Constante',
  'ease-out': 'Freia',
  'ease-in': 'Acelera',
}

/**
 * POSICAO, TAMANHO E GIRO -- e a ANIMACAO deles por quadros-chave.
 *
 * "Coloca uma opcao de transform na adjustment layer, pra eu poder animar o
 * que eu quiser." O mesmo painel serve ao clipe comum e a camada de ajuste
 * (nela, o transform e o de tudo o que esta embaixo). Os valores mostrados sao
 * os da AGULHA: com chaves, eles andam enquanto o video toca, e mexer em
 * qualquer um -- aqui ou na caixa do preview -- grava uma chave ali.
 */
export function TransformDoClipe({
  o,
  alvos,
  comPresetsDeGiro = false,
}: {
  o: SobreposicaoSalva
  /** Os clipes que a mexida alcanca (a selecao). */
  alvos: readonly string[]
  comPresetsDeGiro?: boolean
}) {
  const playhead = useProject((s) => s.playhead)
  const ajustarUm = useProject((s) => s.ajustarSobreposicao)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const v = transformNaAgulha(o, playhead)
  const tem = animado(o)
  const toca = o.usarSec ?? o.durationSec - o.inicioSec
  const t = tempoNoClipe(o, playhead)
  const dentro = playhead >= o.at - 1e-3 && playhead <= o.at + toca + 1e-3
  const naChave = chaveEm(o.chaves, t, TOLERANCIA_DA_CHAVE) >= 0
  const chaves = ordenadas(o.chaves ?? [])

  /** Cada alvo recebe o patch feito com os PROPRIOS valores e chaves. */
  const paraCada = (f: (x: SobreposicaoSalva) => Partial<SobreposicaoSalva>): void => {
    const todos = useProject.getState().sobreposicoes
    for (const id of alvos.length > 0 ? alvos : [o.id]) {
      const x = todos.find((y) => y.id === id)
      if (x) ajustarUm(id, f(x))
    }
  }
  const mudar = (valores: Partial<Transform2D>): void => paraCada((x) => patchDoTransform(x, playhead, valores))
  const irPara = (tc: number): void => setPlayhead(o.at + tc + 1e-4)
  const anterior = [...chaves].reverse().find((c) => c.t < t - TOLERANCIA_DA_CHAVE)
  const proxima = chaves.find((c) => c.t > t + TOLERANCIA_DA_CHAVE)

  return (
    <>
      <Linha label="Posicao X">
        <Deslizante valor={v.x} min={-100} max={100} step={0.5} padrao={0} texto={`${Math.round(v.x)}%`}
          onChange={(x) => mudar({ x })} />
      </Linha>
      <Linha label="Posicao Y">
        <Deslizante valor={v.y} min={-100} max={100} step={0.5} padrao={0} texto={`${Math.round(v.y)}%`}
          onChange={(y) => mudar({ y })} />
      </Linha>
      <Linha label="Tamanho">
        <Deslizante valor={v.escala} min={0.1} max={4} step={0.01} padrao={1}
          texto={`${Math.round(v.escala * 100)}%`} onChange={(escala) => mudar({ escala })} />
      </Linha>
      <Linha label="Rotacao" title="Duplo clique no slider volta para 0°. Com chaves, passa de 180° para dar voltas.">
        <Deslizante valor={v.rotacao} min={tem ? -720 : -180} max={tem ? 720 : 180} step={1} padrao={0}
          texto={`${Math.round(v.rotacao)}°`} onChange={(rotacao) => mudar({ rotacao })} />
      </Linha>
      {comPresetsDeGiro && (
        <Linha label="">
          <Segmentos
            opcoes={[-90, -45, 0, 45, 90, 180].map((g) => ({ valor: g, rotulo: `${g}°`, title: `Girar para ${g}°` }))}
            ativo={(g) => Math.round(v.rotacao) === g}
            onChange={(rotacao) => mudar({ rotacao })}
          />
        </Linha>
      )}

      {/*
        OS QUADROS-CHAVE. A fita mostra o clipe inteiro: cada losango e uma
        chave (clique leva a agulha ate ela), a linha e a agulha.
      */}
      <Linha
        label="Animar"
        title="Grava uma chave na agulha com a posicao, o tamanho e o giro de agora. Com chaves, mexer em qualquer valor grava outra."
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Botaozinho
            active={naChave}
            onClick={() => (naChave ? paraCada((x) => patchSemChaveAqui(x, playhead)) : paraCada((x) => patchDeChaveAqui(x, playhead)))}
            title={
              !dentro
                ? 'Leve a agulha para dentro do clipe'
                : naChave
                  ? 'Tirar a chave da agulha'
                  : tem
                    ? 'Gravar uma chave na agulha'
                    : 'Comecar a animar: a primeira chave fica na agulha'
            }
          >
            <Diamond size={11} strokeWidth={1.75} fill={naChave ? 'currentColor' : 'none'} />
            {naChave ? 'Chave' : tem ? 'Chave aqui' : 'Animar'}
          </Botaozinho>
          {tem && (
            <>
              <button
                type="button"
                disabled={!anterior}
                onClick={() => anterior && irPara(anterior.t)}
                title="Chave anterior"
                aria-label="Chave anterior"
                className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink disabled:opacity-30"
              >
                <ChevronLeft size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                disabled={!proxima}
                onClick={() => proxima && irPara(proxima.t)}
                title="Proxima chave"
                aria-label="Proxima chave"
                className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink disabled:opacity-30"
              >
                <ChevronRight size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => paraCada((x) => patchSemAnimacao(x, playhead))}
                title="Parar de animar: fica o que se ve na agulha, sem chave nenhuma"
                aria-label="Apagar a animacao"
                className="ml-auto grid size-6 place-items-center rounded-sm text-ink-3 hover:text-danger"
              >
                <Trash2 size={12} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </Linha>
      {tem && (
        <>
          <Linha label="">
            <div className="relative h-5 min-w-0 flex-1 rounded-sm border border-line bg-elevated" data-fita-de-chaves>
              {dentro && (
                <span
                  className="pointer-events-none absolute inset-y-0 w-px bg-ink-2"
                  style={{ left: `${Math.min(Math.max(t / Math.max(toca, 1e-3), 0), 1) * 100}%` }}
                />
              )}
              {chaves.map((c, i) => (
                <button
                  key={`${i}-${c.t}`}
                  type="button"
                  onClick={() => irPara(c.t)}
                  title={`Chave em ${c.t.toFixed(2)}s`}
                  className="absolute top-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rotate-45 border border-accent bg-accent/70 hover:bg-accent"
                  style={{ left: `${Math.min(Math.max(c.t / Math.max(toca, 1e-3), 0), 1) * 100}%` }}
                />
              ))}
            </div>
          </Linha>
          <Linha label="Ritmo" title="Como cada passagem de uma chave para a proxima acelera e freia">
            <Segmentos
              opcoes={MOTION_CURVES.map((c) => ({ valor: c, rotulo: RITMO[c] }))}
              ativo={(c) => (o.curvaDasChaves ?? 'ease-in-out') === c}
              onChange={(curvaDasChaves) => paraCada(() => ({ curvaDasChaves }))}
            />
          </Linha>
        </>
      )}
    </>
  )
}
