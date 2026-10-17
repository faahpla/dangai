import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { textoParaNarrar, type EtapaDaVoz, type PedidoDeImportacao, type TakeDaVoz } from '../../shared/voz'
import { lerRascunhoDoDisco } from '../gerar/rascunho'
import { alinharPeloAudio } from './alinhamento'
import { chaveDoImportado, guardarAlinhamento, lerAlinhamentoGuardado } from './cache'
import { exigirRoteiroAprovado } from './estimar'
import { trechosDosErros } from './erros'
import { decodificar } from './ffmpeg'
import { brutoPeloSom, montarTake } from './montar'
import { pastaDaVoz } from './pastas'
import { medirEnergia } from './pos'
import { duracaoDoPcm, gravarWavEnderecado } from './wav'

/**
 * O AUDIO GRAVADO PELO LEVI (.wav/.mp3/.m4a...): a fonte 'importado'.
 *
 * A regra do Dangai, inteira: o texto vem do ROTEIRO; o audio so da os tempos.
 *   1. ffmpeg decodifica para WAV PCM 16 bits mono (o bruto, enderecado por
 *      conteudo; o arquivo dele nunca e tocado);
 *   2. Whisper local confere que o audio e deste roteiro e da a reserva;
 *      wav2vec2 (alinhador.ts) da o tempo fino de cada palavra do roteiro;
 *   3. o pos e o mesmo das outras fontes (corte de pausa desligado por padrao:
 *      a pausa de quem gravou costuma ser de proposito);
 *   4. CORTAR ERROS (V1, ligado por padrao): o que o Whisper ouviu e nao e do
 *      roteiro (palavra repetida, "eee", frase lida duas vezes -- fica a
 *      ULTIMA leitura) sai no mesmo pos, como corte extra, na borda do
 *      silencio (casar-fala.ts, erros.ts). Desligar e um ajuste de graca: os
 *      erros ficam guardados no bruto.
 *
 * O alinhamento fica guardado pelo sha256 do arquivo + o texto das frases:
 * importar o mesmo audio de novo (outra velocidade, outro corte) nao roda o
 * Whisper outra vez. Nao ha "regravar frase" aqui: o caminho e gravar de novo
 * e importar.
 */

type Avisar = (etapa: EtapaDaVoz, mensagem: string, fracao?: number | null) => void

async function hashDoArquivo(caminho: string): Promise<string> {
  const h = createHash('sha256')
  await pipeline(createReadStream(caminho), h)
  return h.digest('hex')
}

/** A mensagem do alinhador.ts/whisper.ts na etapa certa da tela. */
function etapaDaMensagem(m: string): EtapaDaVoz {
  return /alinh|sincroniz/i.test(m) ? 'alinhando' : 'transcrevendo'
}

/**
 * As mensagens do Whisper e do alinhador do Dangai na lingua do passo 3, com a
 * fracao para a barra. Ali e a VOZ, nao a legenda ("Sincronizando as
 * legendas... 0%" confundia), e o numero da mensagem tem que mover a barra (a
 * barra solta com "88%" escrito ao lado se contradizia). O alinhador.ts e o
 * whisper.ts ficam como estao.
 */
export function traduzirAndamento(m: string): { etapa: EtapaDaVoz; mensagem: string; fracao: number | null } {
  const etapa = etapaDaMensagem(m)
  const pct = /(\d{1,3})\s*%/.exec(m)
  const mb = /(\d+)\s*\/\s*(\d+)\s*MB/.exec(m)
  const fracao = pct ? Math.min(1, Number(pct[1]) / 100) : mb ? Math.min(1, Number(mb[1]) / Math.max(1, Number(mb[2]))) : null
  if (/baixando o sincronizador/i.test(m)) {
    return { etapa: 'alinhando', mensagem: `Baixando o alinhador (so na primeira vez)...${mb ? ` ${mb[1]}/${mb[2]} MB` : ''}`, fracao }
  }
  if (/sincroniz/i.test(m)) return { etapa: 'alinhando', mensagem: `Alinhando as palavras...${pct ? ` ${pct[1]}%` : ''}`, fracao }
  return { etapa, mensagem: m, fracao }
}

export async function importarAudioDoLevi(
  rascunhoId: string,
  pedido: PedidoDeImportacao,
  avisar: Avisar,
  signal: AbortSignal,
): Promise<TakeDaVoz> {
  avisar('preparando', 'Lendo o audio...')
  const r = lerRascunhoDoDisco(rascunhoId)
  const roteiro = exigirRoteiroAprovado(r)
  const { frases } = textoParaNarrar(roteiro)
  if (frases.length === 0) throw new Error('O roteiro esta sem frase para narrar.')

  const hash = await hashDoArquivo(pedido.caminho)
  const pcm = await decodificar(pedido.caminho, null, signal)
  if (duracaoDoPcm(pcm) < 1) throw new Error('Esse audio e curto demais para este roteiro.')
  /*
   * A DURACAO TEM QUE CABER NO ROTEIRO (v0.1.1). Barato e antes do Whisper: um
   * episodio inteiro ou uma musica de 4 min nao passam 20 min no alinhador para
   * so entao dar errado. Folgado de proposito -- 0,8 palavra/s (lentissimo) + 30
   * s de pausa no maximo, 7 palavras/s no minimo -- porque o corte de pausas
   * cuida do resto e quem grava a propria voz fala no ritmo que quiser.
   */
  const palavras = frases.reduce((n, f) => n + f.palavras.length, 0)
  const duracao = duracaoDoPcm(pcm)
  if (duracao > palavras / 0.8 + 30) {
    throw new Error(
      `Esse audio tem ${Math.round(duracao / 60)} min, e o roteiro da uns ${Math.round(palavras / 2.84)} s. Confira o arquivo.`,
    )
  }
  if (duracao < palavras / 7) throw new Error('Esse audio e curto demais para este roteiro.')
  const bruto = gravarWavEnderecado(pastaDaVoz(rascunhoId), 'bruto', pcm)
  const energia = medirEnergia(pcm)

  const chave = chaveDoImportado(hash, frases)
  let guardado = lerAlinhamentoGuardado(chave)
  if (!guardado) {
    const resultado = await alinharPeloAudio(bruto.caminho, frases, {
      whisper: true,
      erros: { energia },
      signal,
      avisar: (m) => {
        const a = traduzirAndamento(m)
        avisar(a.etapa, a.mensagem, a.fracao)
      },
    })
    guardado = {
      versao: 1,
      palavras: resultado.casadas.palavras,
      ancoradas: resultado.casadas.ancoradas,
      total: resultado.casadas.total,
      score: resultado.score,
      avisos: resultado.avisos,
      erros: resultado.erros,
    }
    guardarAlinhamento(chave, guardado)
  }

  avisar('montando', 'Montando a narracao...')
  // Bordas das palavras e fronteiras das frases pelo SOM (montar.ts).
  const { bruto: montado, avisos: avisosDoSom } = brutoPeloSom(pcm, guardado.palavras, frases)
  // Os erros ficam no bruto (com ou sem o corte): desligar/ligar depois e so o pos.
  montado.erros = trechosDosErros(guardado.erros, montado.palavras, energia, duracao)
  const partes = [
    pedido.cortarErros && montado.erros.some((t) => t.corte) ? 'cortando erros' : null,
    pedido.cortarPausas ? 'cortando pausas' : null,
    pedido.velocidade !== 1 ? `velocidade ${pedido.velocidade.toFixed(2).replace('.', ',')}x` : null]
    .filter(Boolean)
    .join(' e ')
  avisar('ajustando', partes ? `${partes.charAt(0).toUpperCase()}${partes.slice(1)}...` : 'Igualando o volume...')
  return montarTake(
    rascunhoId,
    montado,
    {
      config: {
        fonte: 'importado',
        voiceId: '',
        modelId: '',
        velocidade: pedido.velocidade,
        cortarPausas: pedido.cortarPausas,
        cortarErros: pedido.cortarErros,
        audio: { nome: basename(pedido.caminho).slice(0, 260), hash },
      },
      origem: 'alinhador',
      qualidade: { ancoradas: guardado.ancoradas, total: guardado.total, score: guardado.score },
      caracteres: 0,
      cobrados: 0,
      chamadas: [],
      roteiroVersao: roteiro.versao,
      derivadoDe: null,
      regravadas: [],
      avisos: [...guardado.avisos, ...avisosDoSom],
    },
    signal,
  )
}
