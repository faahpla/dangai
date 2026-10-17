import { makeClipThumbnail } from '../clips'

/**
 * Deixa PRONTAS as miniaturas dos mp4 do projeto antes de o editor abrir.
 *
 * O openProject importa as imagens 3 a 3 em paralelo (IMPORTE_PARALELO do
 * assets.ts), e a miniatura do clipe tem nome fixo por arquivo
 * (thumb-c-<hash>.webp no cache). Com o MESMO mp4 em dois blocos vizinhos (duas
 * frases do mesmo momento -- comum num recap), os dois ffmpeg gravam o mesmo
 * arquivo ao mesmo tempo e o Windows devolve EPERM: "Nao foi possivel ler o
 * clipe", e o projeto nao abre. Medido no S4-37 (0270.mp4 nas frases f09 e
 * f10). Com a miniatura ja no cache, o import so le o arquivo -- e ainda abre
 * mais rapido.
 *
 * Um arquivo por vez (sem corrida aqui), cada um uma vez. Falhar e so perder o
 * adiantamento: o import tenta de novo do jeito dele.
 */
export async function aquecerMiniaturas(arquivos: readonly string[]): Promise<number> {
  let prontas = 0
  for (const arquivo of new Set(arquivos)) {
    try {
      await makeClipThumbnail(arquivo)
      prontas += 1
    } catch {
      // O import do openProject tenta de novo (e diz o erro, se houver).
    }
  }
  return prontas
}
