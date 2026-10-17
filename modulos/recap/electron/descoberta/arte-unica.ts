import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { fichasDoNome } from '@shared/nomes'
import { carregarOpenCv, type CvMat } from '../../../../electron/services/vision'

/**
 * Quem foi reconhecido com UMA arte so, contada duas vezes.
 *
 * O motor exige 2 fotos por personagem (min_references_per_character) e conta
 * ARQUIVOS. No anime novo a galeria do MyAnimeList tem uma foto (o proprio
 * retrato), e o elenco ganha o retrato do MAL e o da AniList, que quase sempre
 * sao a MESMA arte oficial em dois recortes. Passa do minimo com uma imagem so.
 * Medido no Nia Liston (15/10): 11 personagens com 2 fotos, 9 deles com a mesma
 * arte duas vezes; no E02 o Anzel errou 7 de 13 cenas (capangas, orfaos) e o
 * Gandolf 2 de 4. Como a analise termina 'done', ninguem revisava. Este modulo
 * diz quem, dos reconhecidos, so tinha uma arte, e a tela pede para conferir.
 * So le; nunca lanca.
 *
 * COMO: ORB + razao de Lowe + homografia RANSAC (o OpenCV em WASM que o app ja
 * carrega para o rosto, vision.ts). A mesma arte em outro recorte ou escala casa
 * centenas de pontos pela mesma homografia; arte diferente do mesmo personagem
 * quase nenhum. Medido em 696 pares do elenco de Nia Liston, Bocchi e Dr. Stone:
 * arte diferente ate 30 pontos, mesma arte de 177 para cima.
 */

const IMAGEM = /\.(jpe?g|png|webp)$/i
/** Lado maior na comparacao. As fotos do elenco tem ~230x345; o dobro da pontos de sobra ao ORB. */
const LADO = 480
const PONTOS = 1000
/** Razao de Lowe: o melhor par precisa ser bem melhor que o segundo. */
const RAZAO = 0.75
/** Erro de reprojecao do RANSAC, em px no LADO acima. */
const REPROJECAO = 5
/** Pontos na mesma homografia para dizer "mesma arte" (o vao medido vai de 30 a 177). */
export const MESMA_ARTE = 80
/** Fotos de catalogo olhadas por personagem: basta UMA diferente da primeira. */
const MAXIMO_DE_FOTOS = 8
/** O fim da analise espera por isto: passou do prazo, avisa so o que ja mediu. */
const PRAZO_MS = 15_000

// O pedaco do opencv.js que este modulo usa (vision.ts so tipa o do rosto e do fluxo).
interface CvKeyPointVector {
  size(): number
  get(i: number): { pt: { x: number; y: number } }
  delete(): void
}
interface CvDMatchVector {
  size(): number
  get(i: number): { queryIdx: number; trainIdx: number; distance: number }
  delete(): void
}
interface CvDMatchVectorVector {
  size(): number
  get(i: number): CvDMatchVector
  delete(): void
}
interface CvOrb {
  detectAndCompute(imagem: CvMat, mascara: CvMat, pontos: CvKeyPointVector, descritores: CvMat): void
  delete(): void
}
interface CvBf {
  knnMatch(a: CvMat, b: CvMat, saida: CvDMatchVectorVector, k: number): void
  delete(): void
}
interface CvDoOrb {
  Mat: new (...args: number[]) => CvMat
  ORB: new (pontos: number) => CvOrb
  BFMatcher: new (norma: number, cruzado: boolean) => CvBf
  KeyPointVector: new () => CvKeyPointVector
  DMatchVectorVector: new () => CvDMatchVectorVector
  matFromArray(linhas: number, colunas: number, tipo: number, dados: number[]): CvMat
  findHomography(a: CvMat, b: CvMat, metodo: number, limiar: number, mascara: CvMat): CvMat
  countNonZero(m: CvMat): number
  CV_8UC1: number
  CV_32FC2: number
  NORM_HAMMING: number
  RANSAC: number
}

interface Assinatura {
  pontos: CvKeyPointVector
  descritores: CvMat
}

function chave(nome: string): string {
  return fichasDoNome(nome).join(' ')
}

function soltarAssinatura(a: Assinatura | null): void {
  if (!a) return
  a.pontos.delete()
  a.descritores.delete()
}

/** null = nao deu para ler a imagem (fica de fora da conta). */
async function assinatura(cv: CvDoOrb, orb: CvOrb, arquivo: string): Promise<Assinatura | null> {
  try {
    // Buffer e nao caminho: o libvips segura o arquivo aberto (o porque esta no tracker.ts).
    const { data, info } = await sharp(readFileSync(arquivo))
      .greyscale()
      .resize({ width: LADO, height: LADO, fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    const mat = new cv.Mat(info.height, info.width, cv.CV_8UC1)
    mat.data.set(data.subarray(0, info.width * info.height))
    const mascara = new cv.Mat()
    const pontos = new cv.KeyPointVector()
    const descritores = new cv.Mat()
    try {
      orb.detectAndCompute(mat, mascara, pontos, descritores)
    } finally {
      mat.delete()
      mascara.delete()
    }
    return { pontos, descritores }
  } catch {
    return null
  }
}

/** Quantos pontos casam pela mesma homografia (0 = nada em comum). */
function pontosEmComum(cv: CvDoOrb, bf: CvBf, a: Assinatura, b: Assinatura): number {
  if (a.pontos.size() < 8 || b.pontos.size() < 8) return 0
  const pares = new cv.DMatchVectorVector()
  const pa: number[] = []
  const pb: number[] = []
  try {
    bf.knnMatch(a.descritores, b.descritores, pares, 2)
    for (let i = 0; i < pares.size(); i++) {
      const v = pares.get(i)
      try {
        if (v.size() < 2) continue
        const m = v.get(0)
        if (m.distance < RAZAO * v.get(1).distance) {
          const ka = a.pontos.get(m.queryIdx).pt
          const kb = b.pontos.get(m.trainIdx).pt
          pa.push(ka.x, ka.y)
          pb.push(kb.x, kb.y)
        }
      } finally {
        v.delete()
      }
    }
  } finally {
    pares.delete()
  }
  const n = pa.length / 2
  if (n < 8) return 0
  const A = cv.matFromArray(n, 1, cv.CV_32FC2, pa)
  const B = cv.matFromArray(n, 1, cv.CV_32FC2, pb)
  const mascara = new cv.Mat()
  try {
    const H = cv.findHomography(A, B, cv.RANSAC, REPROJECAO, mascara)
    H.delete()
    return mascara.rows > 0 ? cv.countNonZero(mascara) : 0
  } finally {
    A.delete()
    B.delete()
    mascara.delete()
  }
}

/** As fotos de catalogo sao TODAS a mesma arte? (2+ fotos legiveis; basta uma diferente para nao.) */
async function todasAMesma(cv: CvDoOrb, orb: CvOrb, bf: CvBf, arquivos: string[]): Promise<boolean> {
  let primeira: Assinatura | null = null
  let comparadas = 0
  try {
    for (const arquivo of arquivos) {
      const a = await assinatura(cv, orb, arquivo)
      if (!a) continue
      if (!primeira) {
        primeira = a
        continue
      }
      try {
        if (pontosEmComum(cv, bf, primeira, a) < MESMA_ARTE) return false
        comparadas++
      } finally {
        soltarAssinatura(a)
      }
    }
    return comparadas > 0
  } finally {
    soltarAssinatura(primeira)
  }
}

/**
 * Dos `nomes` (identifiedCharacters do done), quem so tinha UMA arte nas fotos
 * de catalogo da pasta characters/ do anime (`refsDir`). Fica de fora quem tem
 * foto do batismo (auto_disc_*: o refs.ts cuida) e quem tem menos de 2 fotos.
 * Nunca lanca: na duvida, ninguem (a tela so nao avisa).
 */
export async function soUmaArte(refsDir: string | null | undefined, nomes: readonly string[]): Promise<string[]> {
  if (!refsDir || nomes.length === 0) return []
  const limite = Date.now() + PRAZO_MS
  let pastas: string[]
  try {
    pastas = readdirSync(refsDir).filter((n) => !n.startsWith('_'))
  } catch {
    return []
  }
  // A pasta do personagem pode ter outra grafia ("Liston, Nia"): casa pelas palavras.
  const porChave = new Map<string, string>()
  for (const p of pastas) porChave.set(chave(p), p)

  const aConferir: Array<{ nome: string; arquivos: string[] }> = []
  for (const nome of nomes) {
    const pasta = porChave.get(chave(nome))
    if (!pasta) continue
    let arquivos: string[]
    try {
      arquivos = readdirSync(join(refsDir, pasta)).filter((n) => IMAGEM.test(n))
    } catch {
      continue
    }
    if (arquivos.some((n) => n.startsWith('auto_disc_'))) continue
    const catalogo = arquivos
      .filter((n) => {
        try {
          return statSync(join(refsDir, pasta, n)).size > 0
        } catch {
          return false
        }
      })
      .sort()
      .slice(0, MAXIMO_DE_FOTOS)
      .map((n) => join(refsDir, pasta, n))
    if (catalogo.length >= 2) aConferir.push({ nome, arquivos: catalogo })
  }
  if (aConferir.length === 0) return []

  try {
    const visao = await carregarOpenCv()
    if (!visao) return []
    const cv = visao.cv as unknown as CvDoOrb
    const orb = new cv.ORB(PONTOS)
    const bf = new cv.BFMatcher(cv.NORM_HAMMING, false)
    try {
      const saida: string[] = []
      for (const { nome, arquivos } of aConferir) {
        if (Date.now() > limite) break
        if (await todasAMesma(cv, orb, bf, arquivos)) saida.push(nome)
      }
      return saida
    } finally {
      orb.delete()
      bf.delete()
    }
  } catch (e) {
    console.error('[arte-unica] conferencia falhou:', e)
    return []
  }
}
