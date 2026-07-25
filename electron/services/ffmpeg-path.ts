import ffmpegStatic from 'ffmpeg-static'

/**
 * ffmpeg-static resolve para dentro de app.asar quando empacotado, e um binario
 * dentro do asar nao pode ser executado. O electron-builder desempacota para
 * app.asar.unpacked; reescrever o caminho aqui e o ajuste padrao.
 */
function resolveFfmpeg(): string {
  if (!ffmpegStatic) {
    throw new Error(
      'Binario do FFmpeg nao encontrado. Rode "npm install" para restaurar as dependencias.',
    )
  }
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
}

export const ffmpegPath = resolveFfmpeg()
