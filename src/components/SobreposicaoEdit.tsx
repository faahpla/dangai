import { useState } from 'react'
import { Expand, FlipHorizontal2, RotateCcw, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { idsEscolhidos, useProject } from '@/store/project'
import { Botaozinho, Deslizante, Grupo, Linha, Segmentos } from './painel'
import { ControleDeRitmo, opcoesDeEfeito } from './SceneEdit'
import { AjusteEdit } from './AjusteEdit'
import { AjusteDaTransicaoCampos, PaletaDeTransicoes } from './EditorDeTransicao'
import { TransformDoClipe } from './TransformDoClipe'

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
  const [lado, setLado] = useState<'entrada' | 'saida'>('entrada')
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
                onClick={() =>
                  ajustar(id, { x: 0, y: 0, escala: 1, rotacao: 0, opacidade: 1, espelhar: false, chaves: undefined })
                }
                title="Volta posição, tamanho, giro e opacidade ao padrão (e tira a animação)"
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
          <TransformDoClipe o={o} alvos={alvos} comPresetsDeGiro />
          <Linha label="Preencher" title="Cobrir a tela inteira (corta o que sobra), ou o arquivo inteiro com bordas">
            <Botaozinho active={!!o.preencher} onClick={() => ajustar(id, { preencher: !o.preencher })}>
              <Expand size={11} strokeWidth={1.5} />
              {o.preencher ? 'Preenchendo a tela' : 'Preencher a tela'}
            </Botaozinho>
          </Linha>
          <Linha label="Espelhar" title="Flip horizontal">
            <Botaozinho active={!!o.espelhar} onClick={() => ajustar(id, { espelhar: !o.espelhar })}>
              <FlipHorizontal2 size={11} strokeWidth={1.5} />
              {o.espelhar ? 'Espelhado' : 'Espelhar horizontal'}
            </Botaozinho>
          </Linha>
          <Linha label="Fade entra" title="A opacidade sobe do zero nesse tempo. Também dá para puxar a alça no canto do clipe.">
            <Deslizante valor={o.fadeInSec ?? 0} min={0} max={Math.max(0.1, toca)} step={0.05} padrao={0}
              texto={`${(o.fadeInSec ?? 0).toFixed(2)}s`} onChange={(v) => ajustar(id, { fadeInSec: v })} />
          </Linha>
          <Linha label="Fade sai" title="A opacidade desce até o zero nesse tempo">
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

        {/*
          A TRANSICAO DO CLIPE: entra e sai com o mesmo motor das emendas,
          revelando o que estiver por baixo. Tambem da para arrastar uma
          transicao ate o clipe na faixa (metade esquerda = entrada).
        */}
        <Grupo titulo="Transição">
          <Linha label="">
            <Segmentos
              opcoes={[
                { valor: 'entrada' as const, rotulo: o.transicaoEntrada && o.transicaoEntrada.tipo !== 'cut' ? 'Entrada ●' : 'Entrada', title: 'Como o clipe aparece' },
                { valor: 'saida' as const, rotulo: o.transicaoSaida && o.transicaoSaida.tipo !== 'cut' ? 'Saída ●' : 'Saída', title: 'Como o clipe some' },
              ]}
              ativo={(l) => l === lado}
              onChange={setLado}
            />
          </Linha>
          {(() => {
            const campo = lado === 'entrada' ? 'transicaoEntrada' : 'transicaoSaida'
            const atual = o[campo]
            return (
              <>
                <PaletaDeTransicoes
                  atual={atual?.tipo ?? 'cut'}
                  onEscolher={(t) => ajustar(id, { [campo]: t === 'cut' ? undefined : { tipo: t, ajuste: atual?.ajuste } })}
                />
                {atual && atual.tipo !== 'cut' && (
                  <div className="mt-2">
                    <AjusteDaTransicaoCampos
                      tipo={atual.tipo}
                      ajuste={atual.ajuste}
                      onChange={(parcial) => ajustar(id, { [campo]: { tipo: atual.tipo, ajuste: { ...atual.ajuste, ...parcial } } })}
                    />
                  </div>
                )}
              </>
            )
          })()}
        </Grupo>
      </div>
    </div>
  )
}
