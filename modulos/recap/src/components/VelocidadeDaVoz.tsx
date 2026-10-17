import type { AjustesDaVoz } from '../../shared/tipos-da-voz'
import {
  VELOCIDADE_NATIVA_MAX,
  VELOCIDADE_NATIVA_MIN,
  VELOCIDADE_NATIVA_PADRAO,
  VELOCIDADE_NATIVA_PASSO,
  velocidadeNativaDoPerfil,
} from '../../shared/voz'
import { ponte } from '../ponte'

/**
 * A velocidade NATIVA da voz padrao (Configuracoes > Voz): a voz nova ja e
 * gerada nesse ritmo (decisao do Levi, 15/10: 1,2 por padrao). Vale para o
 * PROXIMO take; o passo 3 deixa trocar por recap. Mora fora do AjustesDeVoz
 * pelo mesmo motivo dele: o arquivo central ganha uma linha so.
 *
 * Um select, como o resto da secao: gravar a cada passo de um slider
 * reescreveria o settings.json a cada pixel.
 */

const OPCOES: number[] = (() => {
  const lista: number[] = []
  for (let v = VELOCIDADE_NATIVA_MIN; v <= VELOCIDADE_NATIVA_MAX + 1e-9; v += VELOCIDADE_NATIVA_PASSO) {
    lista.push(Math.round(v * 100) / 100)
  }
  return lista
})()

function rotulo(v: number): string {
  const x = `${v.toFixed(2).replace('.', ',')}x`
  return v === VELOCIDADE_NATIVA_PADRAO ? `${x} (padrao)` : x
}

export function VelocidadeDaVoz({
  settings,
  onSettings,
}: {
  settings: AjustesDaVoz | null
  onSettings: (s: AjustesDaVoz) => void
}) {
  const voz = settings?.vozPadrao
  if (!voz) return null
  const atual = velocidadeNativaDoPerfil(voz)

  const gravar = async (velocidadeNativa: number): Promise<void> => {
    // [recap] A voz padrao mora na configuracao do modulo.
    const r = await ponte.salvarConfig({ vozPadrao: { ...voz, velocidadeNativa } })
    if (r.ok && settings) onSettings({ ...settings, vozPadrao: r.value.vozPadrao })
  }

  return (
    <>
      <label className="mt-4 mb-1.5 block text-[11px] font-medium text-ink-2">Velocidade</label>
      <select
        value={String(atual)}
        onChange={(event) => void gravar(Number(event.target.value))}
        title="A voz ja sai gerada neste ritmo. O roteiro mira o tempo nele."
        className="w-full rounded-sm border border-line bg-elevated py-1.5 pr-7 pl-2.5 text-[13px] text-ink"
      >
        {OPCOES.map((v) => (
          <option key={v} value={String(v)}>
            {rotulo(v)}
          </option>
        ))}
      </select>
    </>
  )
}
