import { useEffect, useState } from 'react'
import type { ConfigDasCenas, ConfigDoRecapNaTela } from '../../shared/config'
import { LIMIAR_DE_DIVISAO_PADRAO_SEC, LIMIARES_DE_DIVISAO, MINIMO_NA_TELA_PADRAO_SEC, MINIMOS_NA_TELA } from '../../shared/divisao'
import { Segmentos } from '@/modulos/kit'
import { ponte } from '../ponte'
import { Caixinha, COR_DE_AVISO } from './pecas'

/**
 * [recap] CENAS (lote 2 das ideias, 17/10): o que o passo 4 usa alem das
 * regras. Pouco texto: o porque mora nos tooltips.
 */
export function AjustesDasCenas() {
  const [config, setConfig] = useState<ConfigDoRecapNaTela | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void ponte.lerConfig().then((r) => {
      if (!vivo) return
      if (r.ok) setConfig(r.value)
      else setAviso(r.error)
    })
    return () => {
      vivo = false
    }
  }, [])

  const salvar = async (cenas: Partial<ConfigDasCenas>): Promise<void> => {
    const r = await ponte.salvarConfig({ cenas })
    if (r.ok) setConfig(r.value)
    else setAviso(r.error)
  }

  const c = config?.cenas
  // (19/10) O juiz visual saiu da tela: ninguem quer por enquanto. A config
  // `juiz` continua no settings (desligado), sem opcao para ligar.

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Caixinha
        ligada={c?.visao ?? true}
        onChange={(v) => void salvar({ visao: v })}
        disabled={!config}
        title="Pelo motor: a imagem parecida com a frase (CLIP), a fala com o mesmo sentido e o quadro mais bonito e nitido. Mede o episodio uma vez, depois do corte."
      >
        Busca pela imagem e pelo sentido
      </Caixinha>
      <Caixinha
        ligada={c?.etiquetas ?? true}
        onChange={(v) => void salvar({ etiquetas: v })}
        disabled={!config}
        title="As etiquetas de cada cena (choro, soco, espada, noite) do etiquetador do Dangai. Baixa o modelo (379 MB) no 1o uso."
      >
        Etiquetas das cenas
      </Caixinha>
      <Caixinha
        ligada={c?.conta ?? true}
        onChange={(v) => void salvar({ conta: v })}
        disabled={!config}
        title="Escolhe as cenas do roteiro inteiro de uma vez: ordem do episodio, sem repetir, variedade. Desligado: frase a frase, como antes."
      >
        Conta do roteiro inteiro
      </Caixinha>
      <Caixinha
        ligada={c?.duasCenas ?? true}
        onChange={(v) => void salvar({ duasCenas: v })}
        disabled={!config}
        title="Frase longa, com duas acoes ou dois personagens ganha 2 cenas (3 so se for muito longa), cortadas na virgula, no 'e' ou no 'mas'. Cada cena casa com as palavras do pedaco dela. As frases que voce mexeu ficam como estao."
      >
        Ate 2 cenas por frase
      </Caixinha>
      {(c?.duasCenas ?? true) && (
        <div className="flex items-center gap-2 pl-6">
          <span className="shrink-0 text-[11px] text-ink-3" title="Frase mais longa que isto (no tempo da voz) ganha 2 cenas">
            Acima de
          </span>
          <Segmentos
            opcoes={LIMIARES_DE_DIVISAO.map((v) => ({
              valor: v,
              rotulo: `${String(v).replace('.', ',')}s`,
              title: `Divide a frase com mais de ${String(v).replace('.', ',')} s de voz`,
            }))}
            ativo={(v) => v === (c?.limiarDuasCenas ?? LIMIAR_DE_DIVISAO_PADRAO_SEC)}
            onChange={(v) => void salvar({ limiarDuasCenas: v })}
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 text-[11px] text-ink-3"
          title="Nenhuma cena escolhida sozinha fica menos que isto na tela: pedaco curto volta a ser uma cena so, e emenda curta nao entra. As que voce escolheu ficam como estao."
        >
          Minimo na tela
        </span>
        <Segmentos
          opcoes={MINIMOS_NA_TELA.map((v) => ({
            valor: v,
            rotulo: `${String(v).replace('.', ',')}s`,
            title: `Cada cena fica pelo menos ${String(v).replace('.', ',')} s`,
          }))}
          ativo={(v) => v === (c?.minimoNaTela ?? MINIMO_NA_TELA_PADRAO_SEC)}
          onChange={(v) => void salvar({ minimoNaTela: v })}
        />
      </div>
      {aviso && <p className={`text-[11px] ${COR_DE_AVISO}`}>{aviso}</p>}
    </div>
  )
}
