import { useEffect, useState } from 'react'
import { JUIZES, type ConfigDasCenas, type ConfigDoRecapNaTela, type JuizVisual } from '../../shared/config'
import { Segmentos, type Segmento } from '@/modulos/kit'
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
  const temGemini = config?.escritoresComChave['gemini-pro'] ?? false
  const temClaude = config?.escritoresComChave.claude ?? false
  const juizes: Segmento<JuizVisual>[] = JUIZES.map((id) => {
    const semChave = (id === 'gemini' && !temGemini) || (id === 'haiku' && !temClaude)
    const nome = id === 'desligado' ? 'Desligado' : id === 'gemini' ? 'Gemini' : 'Haiku'
    return {
      valor: id,
      rotulo: semChave ? `${nome} · sem chave` : nome,
      title:
        id === 'desligado'
          ? 'Sem juiz: ficam as notas do passo 4'
          : id === 'gemini'
            ? 'Gemini (gratis): a IA olha as 3 melhores de cada frase. Gasta pedidos da cota gratis (~1 a cada 6 frases)'
            : 'Claude Haiku: a IA olha as 3 melhores de cada frase. Pago: ~US$ 0,01 por video, pergunta o custo antes',
    }
  })

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
      <div className="flex flex-col gap-1.5 pt-1">
        <span className="text-[11px] font-medium text-ink-2" title="Opcional. O nucleo do Dangai ainda nao manda imagem para a IA: por enquanto o juiz nao roda.">
          Juiz visual
        </span>
        <Segmentos opcoes={juizes} ativo={(v) => v === (c?.juiz ?? 'desligado')} onChange={(v) => void salvar({ juiz: v })} />
      </div>
      {aviso && <p className={`text-[11px] ${COR_DE_AVISO}`}>{aviso}</p>}
    </div>
  )
}
