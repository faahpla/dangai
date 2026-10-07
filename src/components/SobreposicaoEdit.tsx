import { FlipHorizontal2, RotateCcw, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { idsEscolhidos, useProject } from '@/store/project'
import { Botaozinho, Deslizante, Grupo, Linha, Segmentos } from './painel'
import { ControleDeRitmo, opcoesDeEfeito } from './SceneEdit'
import { AjusteEdit } from './AjusteEdit'

/**
 * O INSPETOR do clipe escolhido na faixa de video -- seta, imagem, .mov.
 *
 * "Quero poder configurar rotacao dela tambem, alem de posicao, tamanho e
 * opacidade. E tambem quero poder ativar as opcoes de movimento que temos no
 * clipe." Ocupa a area do meio enquanto o clipe estiver escolhido, no lugar
 * dos controles do bloco, com as mesmas pecas: o movimento e o mesmo dos
 * blocos, rodando dentro da posicao, do tamanho e do giro do clipe.
 */
export function SobreposicaoEdit({ id }: { id: string }) {
  const o = useProject((s) => s.sobreposicoes.find((x) => x.id === id))
  const ajustarUm = useProject((s) => s.ajustarSobreposicao)
  const selecionar = useProject((s) => s.selecionarClipe)
  const sobreposicoes = useProject((s) => s.sobreposicoes)
  const escolhidos = useProject(useShallow((s) => idsEscolhidos(s, 'video')))
  if (!o) return null
  if (o.tipo === 'ajuste') return <AjusteEdit id={id} />

  /*
   * VARIOS ESCOLHIDOS: cada mexida vale para todos os clipes comuns da
   * selecao (as camadas de ajuste ficam de fora -- elas tem painel proprio).
   * O painel mostra os valores do principal.
   */
  const alvos = escolhidos.filter((x) => {
    const y = sobreposicoes.find((z) => z.id === x)
    return y !== undefined && y.tipo !== 'ajuste'
  })
  const ajustar = (_id: string, patch: Parameters<typeof ajustarUm>[1]): void => {
    for (const alvo of alvos.length > 0 ? alvos : [id]) ajustarUm(alvo, patch)
  }

  const toca = o.usarSec ?? o.durationSec - o.inicioSec

  return (
    <div className="enter grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-3">
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
        <Grupo
          titulo={`Clipe V${o.faixa + 1}`}
          acao={
            <>
              <Botaozinho
                onClick={() => ajustar(id, { x: 0, y: 0, escala: 1, rotacao: 0, opacidade: 1, espelhar: false })}
                title="Volta posicao, tamanho, giro e opacidade ao padrao"
              >
                <RotateCcw size={11} strokeWidth={1.5} />
                Resetar
              </Botaozinho>
              <button
                type="button"
                onClick={() => selecionar(null)}
                aria-label="Fechar o clipe e voltar ao bloco"
                title="Voltar aos controles do bloco"
                className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink"
              >
                <X size={12} strokeWidth={1.75} />
              </button>
            </>
          }
        >
          <p className="truncate text-[11px] text-ink-2" title={o.path}>
            {alvos.length > 1 ? `${alvos.length} clipes escolhidos -- mexer aqui muda todos` : o.fileName}
            {alvos.length <= 1 && <span className="tnum ml-2 text-ink-3">{toca.toFixed(2)}s</span>}
          </p>
          <Linha label="Posicao X">
            <Deslizante valor={o.x} min={-60} max={60} step={1} padrao={0} texto={`${Math.round(o.x)}%`}
              onChange={(v) => ajustar(id, { x: v })} />
          </Linha>
          <Linha label="Posicao Y">
            <Deslizante valor={o.y} min={-60} max={60} step={1} padrao={0} texto={`${Math.round(o.y)}%`}
              onChange={(v) => ajustar(id, { y: v })} />
          </Linha>
          <Linha label="Tamanho">
            <Deslizante valor={o.escala} min={0.1} max={3} step={0.05} padrao={1}
              texto={`${Math.round(o.escala * 100)}%`} onChange={(v) => ajustar(id, { escala: v })} />
          </Linha>
          <Linha label="Rotacao" title="Duplo clique no slider volta para 0°">
            <Deslizante valor={o.rotacao} min={-180} max={180} step={1} padrao={0}
              texto={`${Math.round(o.rotacao)}°`} onChange={(v) => ajustar(id, { rotacao: v })} />
          </Linha>
          <Linha label="">
            <Segmentos
              opcoes={[-90, -45, 0, 45, 90, 180].map((g) => ({ valor: g, rotulo: `${g}°`, title: `Girar para ${g}°` }))}
              ativo={(g) => Math.round(o.rotacao) === g}
              onChange={(g) => ajustar(id, { rotacao: g })}
            />
          </Linha>
          <Linha label="Espelhar" title="Flip horizontal">
            <Botaozinho active={!!o.espelhar} onClick={() => ajustar(id, { espelhar: !o.espelhar })}>
              <FlipHorizontal2 size={11} strokeWidth={1.5} />
              {o.espelhar ? 'Espelhado' : 'Espelhar horizontal'}
            </Botaozinho>
          </Linha>
          <Linha label="Fade entra" title="A opacidade sobe do zero nesse tempo. Tambem da para puxar a alca no canto do clipe.">
            <Deslizante valor={o.fadeInSec ?? 0} min={0} max={Math.max(0.1, toca)} step={0.05} padrao={0}
              texto={`${(o.fadeInSec ?? 0).toFixed(2)}s`} onChange={(v) => ajustar(id, { fadeInSec: v })} />
          </Linha>
          <Linha label="Fade sai" title="A opacidade desce ate o zero nesse tempo">
            <Deslizante valor={o.fadeOutSec ?? 0} min={0} max={Math.max(0.1, toca)} step={0.05} padrao={0}
              texto={`${(o.fadeOutSec ?? 0).toFixed(2)}s`} onChange={(v) => ajustar(id, { fadeOutSec: v })} />
          </Linha>
          <Linha label="Opacidade">
            <Deslizante valor={o.opacidade} min={0} max={1} step={0.05} padrao={1}
              texto={`${Math.round(o.opacidade * 100)}%`} onChange={(v) => ajustar(id, { opacidade: v })} />
          </Linha>
        </Grupo>
      </div>

      <div className="min-h-0 overflow-y-auto pr-1">
        <Grupo titulo="Movimento">
          <Linha label="Efeito">
            <Segmentos
              opcoes={opcoesDeEfeito(o.tipo === 'video')}
              ativo={(e) => o.efeito === e}
              onChange={(efeito) => ajustar(id, { efeito })}
            />
          </Linha>
          {o.efeito !== 'nenhum' && (
            <>
              {/*
                Mais folga que no bloco (ate 60%): uma seta solta no quadro nao
                tem borda para mostrar, e um pan que se ve de verdade pede mais
                que os 15% de um fundo.
              */}
              <Linha label="Intensidade">
                <Deslizante valor={o.intensidade} min={0.02} max={0.6} step={0.01} padrao={0.1}
                  texto={`${Math.round(o.intensidade * 100)}%`} onChange={(v) => ajustar(id, { intensidade: v })} />
              </Linha>
              <ControleDeRitmo
                curve={o.curva}
                curvePoints={o.pontosDaCurva}
                onChange={(patch) =>
                  ajustar(id, {
                    ...(patch.curve ? { curva: patch.curve } : {}),
                    pontosDaCurva: patch.curvePoints,
                  })
                }
              />
            </>
          )}
        </Grupo>
      </div>
    </div>
  )
}
