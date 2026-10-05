import { useId, useMemo } from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { rampaDoFade, type AjusteDeCor } from '@shared/contract'
import { ajusteNeutro, tabelasDoAjuste } from '@shared/cor'

/**
 * A CAMADA DE AJUSTE: tudo o que vem como `children` (as cenas e as faixas de
 * video de baixo) passa por um filtro SVG enquanto a agulha estiver dentro do
 * trecho dela. Fora do trecho o filtro sai, e o conteudo passa limpo.
 *
 * A arvore NAO muda de forma com o tempo -- so o `filter` liga e desliga. Se
 * a camada entrasse e saisse da arvore, as cenas de baixo seriam remontadas
 * nas duas pontas, e os <video> piscariam.
 */
export function CamadaDeAjuste({
  from,
  durationInFrames,
  fadeInFrames = 0,
  fadeOutFrames = 0,
  cor: corDoClipe,
  children,
}: {
  from: number
  durationInFrames: number
  fadeInFrames?: number
  fadeOutFrames?: number
  cor: AjusteDeCor | undefined
  children: React.ReactNode
}) {
  const frame = useCurrentFrame()
  const id = `ajuste-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  // O fade da camada e a INTENSIDADE subindo e descendo: a correcao entra e
  // sai aos poucos, em vez de cortar seco.
  const fade = rampaDoFade(frame - from, durationInFrames, fadeInFrames, fadeOutFrames)
  const cor = useMemo(
    () => (corDoClipe && fade < 1 ? { ...corDoClipe, intensidade: corDoClipe.intensidade * fade } : corDoClipe),
    [corDoClipe, fade],
  )
  const ativo = cor !== undefined && frame >= from && frame < from + durationInFrames && !ajusteNeutro(cor)
  return (
    <AbsoluteFill>
      {ativo && <FiltroDeCor id={id} cor={cor} />}
      <AbsoluteFill style={{ filter: ativo ? `url(#${id})` : undefined, backgroundColor: '#000' }}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

/**
 * O filtro em si. Ordem: tom (tabela por canal) -> saturacao -> vibrance ->
 * nitidez -> mistura com o original pela intensidade.
 */
function FiltroDeCor({ id, cor }: { id: string; cor: AjusteDeCor }) {
  const tabelas = useMemo(() => tabelasDoAjuste(cor), [cor])
  const valores = (t: number[]): string => t.map((v) => v.toFixed(4)).join(' ')
  const a = cor.nitidez * 0.8
  let ultimo = 'tom'
  const passos: React.ReactNode[] = []

  if (cor.saturacao !== 0) {
    passos.push(<feColorMatrix key="sat" in={ultimo} type="saturate" values={String(1 + cor.saturacao)} result="sat" />)
    ultimo = 'sat'
  }

  /*
   * VIBRANCE: satura mais o que tem POUCA cor, e quase nao mexe no que ja e
   * saturado (pele, ceu forte). O peso de cada pixel e 1 menos o croma dele --
   * max(R,G,B) - min(R,G,B), que o SVG tira assim: |R-G| + |G-B| + |B-R| e o
   * dobro do croma, e o modulo de cada diferenca sai de uma tabela em V.
   */
  if (cor.vibrance !== 0) {
    const base = ultimo
    passos.push(
      <feColorMatrix
        key="dif"
        in={base}
        type="matrix"
        values="0.5 -0.5 0 0 0.5  0 0.5 -0.5 0 0.5  -0.5 0 0.5 0 0.5  0 0 0 0 1"
        result="dif"
      />,
      <feComponentTransfer key="abs" in="dif" result="abs">
        <feFuncR type="table" tableValues="1 0 1" />
        <feFuncG type="table" tableValues="1 0 1" />
        <feFuncB type="table" tableValues="1 0 1" />
      </feComponentTransfer>,
      // peso = 1 - croma = 1 - (|R-G| + |G-B| + |B-R|) / 2, igual nos tres canais
      <feColorMatrix
        key="peso"
        in="abs"
        type="matrix"
        values="-0.5 -0.5 -0.5 0 1  -0.5 -0.5 -0.5 0 1  -0.5 -0.5 -0.5 0 1  0 0 0 0 1"
        result="peso"
      />,
      <feComponentTransfer key="inv" in="peso" result="inv">
        <feFuncR type="linear" slope="-1" intercept="1" />
        <feFuncG type="linear" slope="-1" intercept="1" />
        <feFuncB type="linear" slope="-1" intercept="1" />
      </feComponentTransfer>,
      <feColorMatrix key="vsat" in={base} type="saturate" values={String(1 + cor.vibrance * 1.2)} result="vsat" />,
      <feComposite key="v1" in="vsat" in2="peso" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="v1" />,
      <feComposite key="v2" in={base} in2="inv" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="v2" />,
      <feComposite key="vib" in="v1" in2="v2" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="vib" />,
    )
    ultimo = 'vib'
  }

  if (a > 0) {
    passos.push(
      <feConvolveMatrix
        key="nit"
        in={ultimo}
        order="3"
        kernelMatrix={`0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0`}
        edgeMode="duplicate"
        preserveAlpha="true"
        result="nit"
      />,
    )
    ultimo = 'nit'
  }

  if (cor.intensidade < 1) {
    passos.push(
      <feComposite
        key="mix"
        in={ultimo}
        in2="SourceGraphic"
        operator="arithmetic"
        k1="0"
        k2={String(cor.intensidade)}
        k3={String(1 - cor.intensidade)}
        k4="0"
        result="mix"
      />,
    )
  }

  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <filter id={id} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
          <feComponentTransfer in="SourceGraphic" result="tom">
            <feFuncR type="table" tableValues={valores(tabelas.r)} />
            <feFuncG type="table" tableValues={valores(tabelas.g)} />
            <feFuncB type="table" tableValues={valores(tabelas.b)} />
          </feComponentTransfer>
          {passos}
        </filter>
      </defs>
    </svg>
  )
}
