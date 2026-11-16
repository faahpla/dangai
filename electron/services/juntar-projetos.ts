import { spawn } from 'node:child_process'
import { existsSync, renameSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { FraseDeLigacaoPronta, PedidoDeJuntar, ResumoDeProjeto } from '@shared/channels'
import type { Word } from '@shared/contract'
import { cadeiaDeAudioSchema, novaEdicao, type CadeiaDeAudio } from '@shared/edicao-de-audio'
import { juntarProjetos, type LigacaoDaJuncao, type ParteDaJuncao } from '@shared/juntar-projetos'
import { semExtensaoDeProjeto } from '@shared/project-file'
import { alinharAoAudio } from './alinhador'
import { analyzeAudio } from './audio'
import { renderizarEdicao } from './edicao-de-audio'
import { ffmpegPath } from './ffmpeg-path'
import { criarProjetoNaPasta, nomeDeArquivo, openProjectFile, pastaDosProjetos } from './project'
import { getSettings } from './settings'

/**
 * JUNTAR PROJETOS, o lado do disco (a conta mora em shared/juntar-projetos.ts):
 * ler os projetos, medir as narracoes, preparar cada FRASE DE LIGACAO com os
 * efeitos que ele escolheu (os mesmos da etapa de Audio: limpeza, EQ,
 * compressor, Fresh Air, velocidade, volume) e sincronizar a legenda dela
 * com o texto que ele digitou, juntar as narracoes num WAV so e gravar o
 * projeto novo na pasta dos projetos. Os projetos de origem so sao lidos.
 */

/** A frase de ligacao com os efeitos dele: o arquivo pronto (no cache da etapa de audio), a URL para ouvir e a duracao. */
export async function prepararFraseDeLigacao(
  arquivo: string,
  cadeia: CadeiaDeAudio,
  onProgress: (m: string) => void,
): Promise<FraseDeLigacaoPronta> {
  if (!existsSync(arquivo)) throw new Error(`A frase não está mais no disco: ${basename(arquivo)}`)
  const bruta = await analyzeAudio(arquivo)
  const edicao = novaEdicao(arquivo, bruta.durationSec, cadeiaDeAudioSchema.parse(cadeia))
  onProgress('Preparando a frase de ligação...')
  // Com a velocidade, como a narracao final ("Pronto"): e assim que ela entra no video.
  const pronta = await renderizarEdicao(edicao, true, onProgress, true)
  return { arquivo: pronta.arquivo, url: pronta.url, duracao: pronta.durationSec }
}

/** O que mostrar de um .dangai na lista (o nome, a duracao e o formato), sem abrir no editor. */
export function resumoDoProjeto(caminho: string): ResumoDeProjeto {
  const { file } = openProjectFile(caminho)
  const ultima = file.plan?.scenes.at(-1)?.end ?? 0
  const palavra = file.transcript?.words.at(-1)?.end ?? 0
  return {
    caminho,
    nome: semExtensaoDeProjeto(basename(caminho)),
    duracaoSec: Math.max(ultima, palavra),
    formato: file.formato,
    cenas: file.plan?.scenes.length ?? 0,
  }
}

export async function juntarProjetosNoDisco(pedido: PedidoDeJuntar, onProgress: (m: string) => void): Promise<string> {
  if (pedido.partes.length < 2) throw new Error('Escolha pelo menos dois projetos para juntar.')
  if (pedido.ligacoes.length !== pedido.partes.length - 1) throw new Error('Cada emenda precisa da sua ligação.')

  // 1) Os projetos e a narracao de cada um, medida no arquivo.
  onProgress('Lendo os projetos...')
  const partes: ParteDaJuncao[] = []
  const narracoes: string[] = []
  for (const caminho of pedido.partes) {
    if (!existsSync(caminho)) throw new Error(`Esse projeto não está mais no disco: ${basename(caminho)}`)
    const { file } = openProjectFile(caminho)
    if (!existsSync(file.audio.path)) {
      throw new Error(`A narração de "${semExtensaoDeProjeto(basename(caminho))}" não está mais no disco (${file.audio.fileName}).`)
    }
    const medida = await analyzeAudio(file.audio.path)
    partes.push({ file, duracao: medida.durationSec })
    narracoes.push(file.audio.path)
  }

  // 2) As ligacoes: a frase com os efeitos e a legenda sincronizada; o som medido.
  const ligacoes: LigacaoDaJuncao[] = []
  const frases: (string | null)[] = []
  for (const [i, l] of pedido.ligacoes.entries()) {
    if (l.tipo === 'som') {
      frases.push(null)
      if (!l.som) {
        ligacoes.push({ tipo: 'som', som: null })
        continue
      }
      if (!existsSync(l.som)) throw new Error(`O som da ligação ${i + 1} não está mais no disco: ${basename(l.som)}`)
      const medido = await analyzeAudio(l.som)
      ligacoes.push({ tipo: 'som', som: { path: l.som, fileName: basename(l.som), durationSec: medido.durationSec, peaks: medido.peaks } })
      continue
    }
    onProgress(`Preparando a frase da ligação ${i + 1}...`)
    const pronta = await prepararFraseDeLigacao(l.arquivo, l.cadeia, onProgress)
    const textos = l.texto.trim().split(/\s+/).filter(Boolean)
    onProgress(`Sincronizando a legenda da ligação ${i + 1}...`)
    const alinhado = textos.length > 0 ? await alinharAoAudio(pronta.arquivo, textos, onProgress).catch(() => null) : null
    const palavras: Word[] = alinhado
      ? textos.map((text, k) => ({ text, start: alinhado.tempos[k]?.start ?? 0, end: alinhado.tempos[k]?.end ?? 0 }))
      : // Sem alinhar (texto que nao bate, ou o modelo indisponivel): as palavras repartem a frase.
        textos.map((text, k) => ({
          text,
          start: (pronta.duracao * k) / textos.length,
          end: (pronta.duracao * (k + 1)) / textos.length,
        }))
    frases.push(pronta.arquivo)
    ligacoes.push({ tipo: 'frase', duracao: pronta.duracao, texto: l.texto, palavras, cena: l.cena ? { path: l.cena } : null })
  }

  // 3) A narracao juntada: parte, frase, parte... num WAV so, ao lado do projeto novo.
  const pasta = pastaDosProjetos(getSettings().pastaDeProjetos)
  const nome = nomeDeArquivo(pedido.nome)
  let wav = join(pasta, `${nome} - narração.wav`)
  for (let k = 2; existsSync(wav); k++) wav = join(pasta, `${nome} - narração (${k}).wav`)
  const ordem: string[] = []
  narracoes.forEach((n, i) => {
    ordem.push(n)
    const f = frases[i]
    if (f) ordem.push(f)
  })
  onProgress('Juntando as narrações...')
  await concatenarAudios(ordem, wav)

  // 4) O projeto novo.
  onProgress('Montando o projeto...')
  const { file } = juntarProjetos(partes, ligacoes, { path: wav, rel: null, fileName: basename(wav) }, pedido.regras)
  return criarProjetoNaPasta(pasta, nome, file)
}

/** Um WAV atras do outro (48 kHz, estereo): nada se perde nem se recomprime de novo. */
function concatenarAudios(arquivos: readonly string[], destino: string): Promise<void> {
  const parcial = `${destino}.part.wav`
  const entradas = arquivos.flatMap((a) => ['-i', a])
  const cadeias = arquivos.map((_, k) => `[${k}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo[a${k}]`)
  const filtro = `${cadeias.join(';')};${arquivos.map((_, k) => `[a${k}]`).join('')}concat=n=${arquivos.length}:v=0:a=1[saida]`
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...entradas, '-filter_complex', filtro, '-map', '[saida]', '-c:a', 'pcm_s16le', parcial],
      { windowsHide: true },
    )
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', (e) => reject(new Error(`FFmpeg falhou: ${e.message}`)))
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Não deu para juntar as narrações: ${stderr.trim().split('\n').slice(-2).join(' ')}`))
        return
      }
      renameSync(parcial, destino)
      resolve()
    })
  })
}
