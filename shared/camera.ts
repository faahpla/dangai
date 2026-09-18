import { VIDEO_HEIGHT, VIDEO_WIDTH, type CameraFrame } from './contract'

/**
 * A geometria da camera livre, num lugar so.
 *
 * O preview desenha um retangulo, o render aplica um transform, e os dois
 * PRECISAM concordar -- se divergirem, o retangulo mente sobre o video e o
 * usuario enquadra no escuro. Ja aconteceu, e por isso a conta mora aqui e nao
 * em cada ponta.
 *
 * O SISTEMA DE COORDENADAS e o do arquivo de origem, sempre: fracoes de 0 a 1
 * sobre a largura e a altura da fonte, com `x`/`y` medindo o afastamento do
 * centro em porcento. Ate a v1.27 a camera enxergava apenas o recorte 9:16 que
 * a importacao gera, e nao havia como chegar nos dois tercos laterais de um
 * clipe 16:9 -- um personagem na ponta direita simplesmente nao existia no
 * arquivo que o render consumia. Passando o ORIGINAL e o aspecto dele, a mesma
 * conta cobre o quadro inteiro.
 *
 * Uma fonte que ja e 9:16 tem aspecto igual ao do quadro, e ai tudo abaixo
 * degenera exatamente no que o app sempre fez -- e o motivo de nao existirem
 * dois caminhos.
 */

const ASPECTO_DO_QUADRO = VIDEO_WIDTH / VIDEO_HEIGHT

function preso(valor: number, minimo: number, maximo: number): number {
  return Math.min(Math.max(valor, minimo), maximo)
}

/**
 * Quanto da fonte cabe no quadro com `object-fit: cover`, antes do zoom.
 *
 * Cover amplia ate cobrir e joga fora o resto: numa fonte mais LARGA que o
 * quadro sobra largura (um 16:9 mostra 31,6% dela), e numa mais ALTA sobra
 * altura. O que sobra e exatamente a folga por onde a camera pode passear.
 */
export function coberturaDaFonte(aspectoDaFonte: number): { largura: number; altura: number } {
  const a = Number.isFinite(aspectoDaFonte) && aspectoDaFonte > 0 ? aspectoDaFonte : ASPECTO_DO_QUADRO
  return {
    largura: a > ASPECTO_DO_QUADRO ? ASPECTO_DO_QUADRO / a : 1,
    altura: a < ASPECTO_DO_QUADRO ? a / ASPECTO_DO_QUADRO : 1,
  }
}

/**
 * De que arquivo esta camera parte, e com que aspecto.
 *
 * Uma decisao so, consultada pelo plano E pela tela de enquadrar -- se as duas
 * escolhessem por conta propria, o retangulo passaria a apontar para um arquivo
 * diferente do que o render abre, que e a forma mais silenciosa de errar isto.
 *
 * Camera antiga (`source` falso) fica no recorte 9:16 onde foi desenhada: o
 * numero guardado vale naquele quadro, e passar o original por baixo dela
 * mudaria o enquadramento de um video ja pronto sem ninguem pedir.
 */
export function fonteDaCamera(
  image: { url: string; urlSource?: string | null; width: number; height: number },
  camera: { source?: boolean } | null | undefined,
): { url: string; aspecto: number } {
  const noOriginal = camera?.source === true && !!image.urlSource && image.height > 0
  return noOriginal
    ? { url: image.urlSource!, aspecto: image.width / image.height }
    : { url: image.url, aspecto: ASPECTO_DO_QUADRO }
}

/**
 * O retangulo que a camera ve, em fracoes da FONTE.
 *
 * E o que o preview desenha por cima da midia. `x` positivo mostra o que esta
 * a esquerda: o numero guardado desloca a IMAGEM, e nao a janela -- convencao
 * que vem do transform e que nao pode mudar sem mexer em projeto salvo.
 */
export function janelaDaCamera(
  frame: CameraFrame,
  aspectoDaFonte: number,
): { left: number; top: number; width: number; height: number } {
  const cobertura = coberturaDaFonte(aspectoDaFonte)
  const width = cobertura.largura / frame.scale
  const height = cobertura.altura / frame.scale
  return {
    left: 0.5 - frame.x / 100 - width / 2,
    top: 0.5 - frame.y / 100 - height / 2,
    width,
    height,
  }
}

/**
 * O quanto a camera pode sair do centro sem deixar entrar borda preta.
 *
 * Numa fonte 9:16 com escala 1 nao ha folga nenhuma, e o limite e zero -- foi
 * sempre assim. Numa 16:9 a mesma escala 1 ja da 34% para cada lado, que e o
 * caminho de um personagem na ponta esquerda ate um na ponta direita.
 */
export function folgaDaCamera(
  scale: number,
  aspectoDaFonte: number,
): { x: number; y: number } {
  const cobertura = coberturaDaFonte(aspectoDaFonte)
  return {
    x: 50 * (1 - cobertura.largura / scale),
    y: 50 * (1 - cobertura.altura / scale),
  }
}

/** Reaperta um enquadramento na folga da propria escala. */
export function naFolga(frame: CameraFrame, aspectoDaFonte: number): CameraFrame {
  const folga = folgaDaCamera(frame.scale, aspectoDaFonte)
  return {
    scale: frame.scale,
    x: preso(frame.x, -folga.x, folga.x),
    y: preso(frame.y, -folga.y, folga.y),
  }
}

/**
 * O CSS que poe esse retangulo na tela.
 *
 * Duas pecas, porque uma so nao alcanca:
 *
 *  - `object-position` escolhe QUE PEDACO da fonte o cover mantem. E a unica
 *    peca que chega na largura descartada de um 16:9 -- o transform sozinho
 *    move um quadro que ja foi cortado no centro, e por isso a camera antiga
 *    esbarrava numa parede invisivel;
 *  - `transform: scale(...) translate(...)` aproxima e acerta o que sobrou. O
 *    object-position so alcanca ate a borda da fonte; passado esse ponto, com
 *    zoom a janela cabe mais para o canto do que ele sabe expressar, e o
 *    translate cobre a diferenca.
 *
 * Numa fonte 9:16 o object-position nao tem folga para mexer, cai em 50% 50% e
 * o transform vira `scale(s) translate(x%, y%)` -- exatamente o que o app
 * sempre gerou.
 */
export function estiloDaCamera(
  frame: CameraFrame,
  aspectoDaFonte: number,
): { objectPosition: string; transform: string } {
  const cobertura = coberturaDaFonte(aspectoDaFonte)

  // O centro que se quer ver, em fracoes da fonte.
  const cx = 0.5 - frame.x / 100
  const cy = 0.5 - frame.y / 100

  // Onde o object-position consegue por o centro, antes do zoom.
  const px =
    cobertura.largura < 1
      ? preso((cx - cobertura.largura / 2) / (1 - cobertura.largura), 0, 1)
      : 0.5
  const py =
    cobertura.altura < 1
      ? preso((cy - cobertura.altura / 2) / (1 - cobertura.altura), 0, 1)
      : 0.5

  const centroX = cobertura.largura < 1 ? px * (1 - cobertura.largura) + cobertura.largura / 2 : 0.5
  const centroY = cobertura.altura < 1 ? py * (1 - cobertura.altura) + cobertura.altura / 2 : 0.5

  /*
   * O que faltou vai no translate.
   *
   * Ele desloca a imagem em porcento da CAIXA, e a caixa mostra `cobertura` da
   * fonte -- dividir por ela e o que traduz de "fracao da fonte" para "porcento
   * da caixa". Sinal trocado porque mover a imagem para um lado e mover a
   * janela para o outro.
   */
  const tx = (-(cx - centroX) / cobertura.largura) * 100
  const ty = (-(cy - centroY) / cobertura.altura) * 100

  /*
   * Cinco casas, e nao tres.
   *
   * O object-position e lido sobre a SOBRA da fonte, entao o arredondamento
   * dele e amplificado: em tres casas o retangulo do preview e o quadro do
   * render divergiam 1,6e-6 da fonte. E invisivel na tela, mas e uma divergencia
   * de verdade entre as duas pontas -- e a unica forma de garantir que elas
   * concordam e nao deixar nenhuma folga entre as contas.
   */
  return {
    objectPosition: `${(px * 100).toFixed(5)}% ${(py * 100).toFixed(5)}%`,
    transform: `scale(${frame.scale}) translate(${tx.toFixed(5)}%, ${ty.toFixed(5)}%)`,
  }
}
