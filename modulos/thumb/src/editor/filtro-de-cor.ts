import type { AjusteDeCor } from '@shared/contract'
import { ajusteNeutro, tabelasDoAjuste } from '@shared/cor'

/**
 * [thumb] A COR DA THUMB (05/11, pedido do Levi: "fazer cc, ou puxar a cc que
 * ja ta no adjustment layer"): o MESMO filtro SVG da camada de ajuste do video
 * (src/remotion/Ajuste.tsx, FiltroDeCor) -- tom por tabela, saturacao,
 * vibrance, nitidez e a mistura pela intensidade --, montado no DOM para o
 * canvas usar (`ctx.filter = 'url(#id)'`). A cor puxada do projeto sai na thumb
 * como sai no video.
 *
 * Um <svg> escondido no body com um <filter> por ajuste diferente (chave = o
 * JSON do ajuste), poucos guardados. Sem DOM (o teste): nada, e o desenho fica
 * sem a cor.
 */

const NS = 'http://www.w3.org/2000/svg'
const MAXIMO = 6
const prontos = new Map<string, string>()
let raiz: SVGSVGElement | null = null
let contador = 0

function el(nome: string, atributos: Record<string, string>, filhos: Element[] = []): Element {
  const e = document.createElementNS(NS, nome)
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v)
  for (const f of filhos) e.appendChild(f)
  return e
}

function montar(id: string, cor: AjusteDeCor): Element {
  const t = tabelasDoAjuste(cor)
  const valores = (v: number[]): string => v.map((x) => x.toFixed(4)).join(' ')
  const passos: Element[] = [
    el('feComponentTransfer', { in: 'SourceGraphic', result: 'tom' }, [
      el('feFuncR', { type: 'table', tableValues: valores(t.r) }),
      el('feFuncG', { type: 'table', tableValues: valores(t.g) }),
      el('feFuncB', { type: 'table', tableValues: valores(t.b) }),
    ]),
  ]
  let ultimo = 'tom'
  if (cor.saturacao !== 0) {
    passos.push(el('feColorMatrix', { in: ultimo, type: 'saturate', values: String(1 + cor.saturacao), result: 'sat' }))
    ultimo = 'sat'
  }
  if (cor.vibrance !== 0) {
    // O vibrance do video: satura mais o que tem pouca cor (peso = 1 - croma).
    const base = ultimo
    passos.push(
      el('feColorMatrix', { in: base, type: 'matrix', values: '0.5 -0.5 0 0 0.5  0 0.5 -0.5 0 0.5  -0.5 0 0.5 0 0.5  0 0 0 0 1', result: 'dif' }),
      el('feComponentTransfer', { in: 'dif', result: 'abs' }, [
        el('feFuncR', { type: 'table', tableValues: '1 0 1' }),
        el('feFuncG', { type: 'table', tableValues: '1 0 1' }),
        el('feFuncB', { type: 'table', tableValues: '1 0 1' }),
      ]),
      el('feColorMatrix', { in: 'abs', type: 'matrix', values: '-0.5 -0.5 -0.5 0 1  -0.5 -0.5 -0.5 0 1  -0.5 -0.5 -0.5 0 1  0 0 0 0 1', result: 'peso' }),
      el('feComponentTransfer', { in: 'peso', result: 'inv' }, [
        el('feFuncR', { type: 'linear', slope: '-1', intercept: '1' }),
        el('feFuncG', { type: 'linear', slope: '-1', intercept: '1' }),
        el('feFuncB', { type: 'linear', slope: '-1', intercept: '1' }),
      ]),
      el('feColorMatrix', { in: base, type: 'saturate', values: String(1 + cor.vibrance * 1.2), result: 'vsat' }),
      el('feComposite', { in: 'vsat', in2: 'peso', operator: 'arithmetic', k1: '1', k2: '0', k3: '0', k4: '0', result: 'v1' }),
      el('feComposite', { in: base, in2: 'inv', operator: 'arithmetic', k1: '1', k2: '0', k3: '0', k4: '0', result: 'v2' }),
      el('feComposite', { in: 'v1', in2: 'v2', operator: 'arithmetic', k1: '0', k2: '1', k3: '1', k4: '0', result: 'vib' }),
    )
    ultimo = 'vib'
  }
  const a = cor.nitidez * 0.8
  if (a > 0) {
    passos.push(
      el('feConvolveMatrix', {
        in: ultimo,
        order: '3',
        kernelMatrix: `0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0`,
        edgeMode: 'duplicate',
        preserveAlpha: 'true',
        result: 'nit',
      }),
    )
    ultimo = 'nit'
  }
  if (cor.intensidade < 1) {
    passos.push(
      el('feComposite', {
        in: ultimo,
        in2: 'SourceGraphic',
        operator: 'arithmetic',
        k1: '0',
        k2: String(cor.intensidade),
        k3: String(1 - cor.intensidade),
        k4: '0',
        result: 'mix',
      }),
    )
  }
  return el('filter', { id, x: '0', y: '0', width: '1', height: '1', 'color-interpolation-filters': 'sRGB' }, passos)
}

/**
 * O `url(#id)` do filtro deste ajuste, pronto no DOM. null = sem cor (nenhuma,
 * ajuste neutro ou sem DOM).
 */
export function filtroDaCor(cor: AjusteDeCor | null | undefined): string | null {
  if (!cor || ajusteNeutro(cor) || typeof document === 'undefined') return null
  const chave = JSON.stringify(cor)
  const ja = prontos.get(chave)
  if (ja && document.getElementById(ja)) return `url(#${ja})`
  if (!raiz || !raiz.isConnected) {
    raiz = document.createElementNS(NS, 'svg') as SVGSVGElement
    raiz.setAttribute('width', '0')
    raiz.setAttribute('height', '0')
    raiz.setAttribute('aria-hidden', 'true')
    raiz.style.position = 'absolute'
    raiz.appendChild(document.createElementNS(NS, 'defs'))
    document.body.appendChild(raiz)
    prontos.clear()
  }
  const id = `thumb-cor-${++contador}`
  raiz.firstChild!.appendChild(montar(id, cor))
  prontos.set(chave, id)
  // Poucos guardados: o mais antigo sai (o slider cria um por arrastar).
  while (prontos.size > MAXIMO) {
    const [k, velho] = prontos.entries().next().value as [string, string]
    prontos.delete(k)
    document.getElementById(velho)?.remove()
  }
  return `url(#${id})`
}
