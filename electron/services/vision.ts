/**
 * O OpenCV, carregado uma vez e compartilhado.
 *
 * Existe porque duas coisas precisam dele por motivos diferentes -- a deteccao
 * de rosto e a perseguicao por fluxo optico -- e o WASM sao 17 MB. Carregar uma
 * copia para cada uma dobraria a memoria e o tempo de subida para entregar
 * exatamente o mesmo modulo.
 *
 * Carga preguicosa: a maioria das sessoes abre um projeto salvo, que ja tem o
 * enquadramento decidido e nunca chega aqui.
 */

export interface CvMat {
  data: Uint8Array
  data32F: Float32Array
  rows: number
  cols: number
  delete: () => void
}

export interface CvRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CvRectVector {
  size: () => number
  get: (indice: number) => CvRect
  delete: () => void
}

export interface CvCascade {
  load: (nome: string) => boolean
  empty: () => boolean
  detectMultiScale: (
    imagem: CvMat,
    saida: CvRectVector,
    escala: number,
    vizinhos: number,
    bandeiras: number,
    minimo: unknown,
    maximo: unknown,
  ) => void
}

export interface Cv {
  Mat: new (linhas: number, colunas: number, tipo: number) => CvMat
  RectVector: new () => CvRectVector
  Size: new (largura: number, altura: number) => unknown
  TermCriteria: new (tipo: number, maximo: number, epsilon: number) => unknown
  CascadeClassifier: new () => CvCascade
  CV_8UC1: number
  CV_32FC1: number
  CV_32FC2: number
  TERM_CRITERIA_EPS: number
  TERM_CRITERIA_COUNT: number
  goodFeaturesToTrack: (
    imagem: CvMat,
    saida: CvMat,
    maximo: number,
    qualidade: number,
    distanciaMinima: number,
    mascara: CvMat,
    tamanhoDoBloco: number,
    harris: boolean,
    k: number,
  ) => void
  calcOpticalFlowPyrLK: (
    anterior: CvMat,
    proxima: CvMat,
    pontosAntes: CvMat,
    pontosDepois: CvMat,
    estado: CvMat,
    erro: CvMat,
    janela: unknown,
    niveis: number,
    criterio: unknown,
  ) => void
  FS_createDataFile: (
    pasta: string,
    nome: string,
    dados: Buffer,
    ler: boolean,
    escrever: boolean,
    procurar: boolean,
  ) => void
}

let carregando: Promise<Cv | null> | null = null

export function carregarOpenCv(): Promise<Cv | null> {
  if (carregando) return carregando

  carregando = (async () => {
    try {
      /*
       * O `?? default` nao e paranoia: o opencv-wasm e CommonJS, e import()
       * dinamico de CJS entrega os exports embrulhados em `default`. Em
       * desenvolvimento o Vite faz o interop e `modulo.cv` funciona; no app
       * empacotado o import e real e `modulo.cv` vem undefined.
       *
       * Isso ja custou um build: a deteccao falhava em silencio no instalador,
       * e todas as imagens saiam centralizadas como antes -- sem erro nenhum na
       * tela, porque a falha aqui e proposital e silenciosa para o usuario.
       */
      const modulo = (await import('opencv-wasm')) as unknown as {
        cv?: Cv
        default?: { cv?: Cv }
      }
      const cv = modulo.cv ?? modulo.default?.cv
      if (!cv?.Mat) {
        console.error('[visao] opencv carregou sem o modulo de imagem')
        return null
      }
      return cv
    } catch (err) {
      // Visao indisponivel nao pode impedir ninguem de trabalhar: sem ela o app
      // so volta a enquadrar pelo centro e a nao oferecer perseguicao. Mas o
      // motivo vai para o stderr do main -- silencio total ja custou um ciclo
      // inteiro de empacotamento para descobrir o que tinha quebrado.
      console.error('[visao] opencv indisponivel:', err)
      return null
    }
  })()

  return carregando
}
