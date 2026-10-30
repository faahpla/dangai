import { recapDoProjeto } from '../../shared/projeto-do-recap'
import { thumbDoProjeto, thumbPadrao, type CenaDoVideo } from '../../shared/thumb'
import { cenaNoInstante as cenaDoPlanoNoInstante, cenasDoPlano, type CenaNoInstante } from '../../../thumb/shared/plano'
import { criarLojaDoEditor, medidor, type FonteDoEditor } from '../../../thumb/src/editor/loja'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { usePosRender } from './pos-render'

export { medidor, type EstadoDoEditor as EstadoDaThumb, type ImagemNaPrevia, type ResultadoDoPng, type SugestaoNaTela } from '../../../thumb/src/editor/loja'

/**
 * [recap] O GERADOR DE THUMBNAIL na tela "Video pronto". A loja e a do editor
 * em comum (modulos/thumb/src/editor/loja.ts, a mesma do modulo Thumbnail);
 * aqui so o que e do recap (FonteDoEditor):
 *
 * - o que ele mexe fica no projeto, em `modulos.recap.thumb` (gravarNoProjeto,
 *   juntando os toques seguidos num passo so): reabrir a tela continua de onde
 *   parou;
 * - primeira vez no projeto: o texto vem da 1a sugestao de thumb do roteiro
 *   (quebrado em 2 linhas) e as imagens das sugestoes -- em cima a cena do
 *   gancho com o rosto mais forte, embaixo a melhor das outras;
 * - as sugestoes, o quadro, os rostos e o salvar pelos canais `recap:thumb:*`
 *   (o PNG ao lado do video pronto).
 */

/** As cenas que entraram no video (o plano do projeto), com o trecho de cada uma e quem e do gancho. */
export function cenasDoVideo(): CenaDoVideo[] {
  const e = nucleo().ler()
  const scenes = e.plan?.scenes ?? []
  const recap = recapDoProjeto(e.modulos)
  // O gancho e a 1a frase do roteiro (2 ou 3 cenas); sem as secoes, as 2 primeiras cenas.
  const frase = recap?.secoes?.[0]?.frases?.[0] ?? null
  const gancho = frase ? { de: frase.inicio, ate: frase.fim } : { de: 0, ate: scenes[1]?.end ?? scenes[0]?.end ?? 0 }
  return cenasDoPlano(e, gancho)
}

/**
 * A cena que o video mostra no instante `t` (o plano do projeto): o arquivo
 * de ORIGEM e o ponto dentro dele. No grid, as duas metades. O quadro sai
 * dali, sem a legenda que o render queimou. null = fora do plano.
 */
export function cenaNoInstante(t: number): CenaNoInstante | null {
  return cenaDoPlanoNoInstante(nucleo().ler(), t)
}

/** O que ja esta em `modulos.recap` (a thumb mora dentro dele). */
function recapCru(): Record<string, unknown> | null {
  const cru = nucleo().ler().modulos?.recap
  return cru && typeof cru === 'object' ? (cru as Record<string, unknown>) : null
}

const daAba: FonteDoEditor = {
  chave: () => {
    const e = nucleo().ler()
    return `${e.projectPath ?? ''}|${recapDoProjeto(e.modulos)?.rascunhoId ?? ''}`
  },
  lerGuardada: () => {
    const cru = recapCru()
    return cru ? thumbDoProjeto(cru['thumb']) : null
  },
  padrao: () => thumbPadrao(usePosRender.getState().thumbs[0] ?? null),
  gravar: (thumb) => {
    const cru = recapCru()
    if (!cru) return
    if (JSON.stringify(cru['thumb']) === JSON.stringify(thumb)) return
    nucleo().gravarNoProjeto({ ...cru, thumb })
  },
  quadro: (p) => ponte.quadroDaThumb(p),
  rostos: async (p) => {
    const r = await ponte.rostosDaThumb(p)
    return r.ok ? { ok: true, value: r.value.rostos } : r
  },
  recorte: (p) => ponte.recorteDaThumb(p),
  upscale: () => ponte.upscaleDaThumb(),
  sugestoes: () => {
    const recap = recapDoProjeto(nucleo().ler().modulos)
    return ponte.sugestoesDaThumb({
      episodioId: recap?.episodioId ?? null,
      rascunhoId: recap?.rascunhoId ?? null,
      cenas: cenasDoVideo(),
    })
  },
  inicioDaCena: (ordem) => nucleo().ler().plan?.scenes[ordem]?.start ?? null,
  cenaNoInstante,
  escolherArquivo: async () => {
    const pr = usePosRender.getState()
    const base = pr.projetoPath ?? pr.outputPath
    const pasta = base ? base.replace(/[\\/][^\\/]*$/, '') : null
    const r = await ponte.escolherImagemDaThumb(pasta).catch(() => null)
    return r?.ok && r.value ? r.value : null
  },
  podeSalvar: () => Boolean(usePosRender.getState().outputPath),
  salvar: (png, modo) => ponte.salvarThumb({ video: usePosRender.getState().outputPath ?? '', png, modo }),
}

export const useThumb = criarLojaDoEditor(daAba)

/** Grava o que estiver pendente agora (a tela fechando). */
export function gravarThumbPendente(): void {
  useThumb.getState().gravarPendente()
}
