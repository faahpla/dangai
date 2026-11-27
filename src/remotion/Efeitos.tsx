import { useId } from 'react'
import { AbsoluteFill, useVideoConfig } from 'remotion'
import {
  areaNoQuadro,
  desvioDoDesfoque,
  efeitosAtivos,
  ladoDoMosaico,
  type EfeitoDoClipe,
} from '@shared/efeitos'

/**
 * OS EFEITOS DE UM CLIPE (desfoque, mosaico, tarja), por um filtro SVG -- o
 * mesmo caminho da camada de ajuste, que ja sai igual na previa e no render.
 *
 * O filtro trabalha em px do QUADRO (o elemento filtrado cobre o quadro
 * inteiro, antes da escala do player), e cada efeito so desenha dentro da
 * area dele (o "subregion" da primitiva) e e colado por cima do que ja havia.
 * Varios efeitos se empilham, na ordem da lista.
 *
 * A arvore e sempre a mesma, com ou sem efeito: so o `filter` liga e desliga.
 * Remontar o que esta dentro faria o <video> piscar.
 *
 * `opaco`: o bloco e a camada de ajuste sao opacos -- o desfoque da tela toda
 * puxaria o transparente de fora do quadro e escureceria as bordas, entao o
 * alfa volta a 1. O insert (PNG vazado) guarda o alfa dele.
 */
export function ComEfeitos({
  efeitos,
  opaco,
  ligado = true,
  children,
}: {
  efeitos: readonly EfeitoDoClipe[] | undefined
  opaco: boolean
  /** A camada de ajuste so filtra dentro do trecho dela. */
  ligado?: boolean
  children: React.ReactNode
}) {
  const id = `efeitos-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const { width: W, height: H } = useVideoConfig()
  const ativos = ligado ? efeitosAtivos(efeitos) : []
  return (
    <AbsoluteFill>
      {ativos.length > 0 && <FiltroDosEfeitos id={id} efeitos={ativos} W={W} H={H} opaco={opaco} />}
      <AbsoluteFill style={{ filter: ativos.length > 0 ? `url(#${id})` : undefined }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  )
}

function FiltroDosEfeitos({
  id,
  efeitos,
  W,
  H,
  opaco,
}: {
  id: string
  efeitos: readonly EfeitoDoClipe[]
  W: number
  H: number
  opaco: boolean
}) {
  const passos: React.ReactNode[] = []
  let atual = 'SourceGraphic'
  efeitos.forEach((e, i) => {
    const a = areaNoQuadro(e.area)
    // A area em px, inteira (o mosaico alinha os quadradinhos pelo canto do quadro).
    const r = {
      x: Math.round(a.x * W),
      y: Math.round(a.y * H),
      width: Math.max(1, Math.round(a.w * W)),
      height: Math.max(1, Math.round(a.h * H)),
    }
    const saida = `ef${i}`
    if (e.tipo === 'desfoque') {
      passos.push(
        <feGaussianBlur key={`b${i}`} in={atual} stdDeviation={desvioDoDesfoque(e.forca, W)} {...r} result={`${saida}b`} />,
      )
      if (opaco) {
        passos.push(
          <feComponentTransfer key={`a${i}`} in={`${saida}b`} {...r} result={saida}>
            <feFuncA type="table" tableValues="1 1" />
          </feComponentTransfer>,
        )
      } else {
        passos.push(<feMerge key={`n${i}`} {...r} result={saida}><feMergeNode in={`${saida}b`} /></feMerge>)
      }
    } else if (e.tipo === 'mosaico') {
      /*
       * MOSAICO: um ponto no meio de cada quadradinho (um pontinho opaco
       * repetido em grade), a imagem so nesses pontos, e cada ponto esticado
       * ate encher o quadradinho (dilate). O canto da grade e o do quadro.
       */
      const lado = ladoDoMosaico(e.forca, W)
      const meio = Math.floor(lado / 2)
      passos.push(
        <feFlood key={`f${i}`} x={meio} y={meio} width={1} height={1} floodColor="#fff" floodOpacity={1} result={`${saida}p`} />,
        <feComposite key={`c${i}`} in={`${saida}p`} in2={`${saida}p`} operator="over" x={0} y={0} width={lado} height={lado} result={`${saida}c`} />,
        <feTile key={`t${i}`} in={`${saida}c`} {...r} result={`${saida}g`} />,
        <feComposite key={`i${i}`} in={atual} in2={`${saida}g`} operator="in" {...r} result={`${saida}s`} />,
        <feMorphology key={`m${i}`} in={`${saida}s`} operator="dilate" radius={meio} {...r} result={saida} />,
      )
    } else {
      passos.push(
        <feFlood key={`f${i}`} floodColor={e.cor ?? '#000000'} floodOpacity={1} {...r} result={saida} />,
      )
    }
    // O efeito por cima do que ja havia: fora da area, tudo como estava.
    passos.push(
      <feMerge key={`j${i}`} result={`junto${i}`}>
        <feMergeNode in={atual} />
        <feMergeNode in={saida} />
      </feMerge>,
    )
    atual = `junto${i}`
  })

  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <filter id={id} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x={0} y={0} width={W} height={H} colorInterpolationFilters="sRGB">
          {passos}
        </filter>
      </defs>
    </svg>
  )
}
