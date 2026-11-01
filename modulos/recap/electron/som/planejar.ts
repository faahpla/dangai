import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import {
  ganhoDaMusica,
  musicaAbaixoDoAlvoDb,
  planejarSfx,
  REGRAS_DE_SOM_PADRAO,
  sfxPeloNome,
  TEMAS_DE_SFX,
  tipoDoSfxPeloNome,
  type ArquivoDeSfx,
  type MusicaPlanejada,
  type PedidoDePlanoDeSom,
  type PlanoDeSom,
  type RegrasDeSom,
  type SfxDaEdicaoRapida,
  type SfxPlanejado,
  type TipoDeSfx,
  type VozParaNivelar,
} from '../../shared/edicao-rapida'
import { integradoNoTrecho } from '@shared/loudness'
import { listSfx, sfxDir } from '../sfx'
import { golpesDoSom } from './golpes'
import { medirSomDetalhado, pastaDeReservaDeSfx } from './medir'
import { escolherMusica, estadoDaPastaDeMusicas } from './musicas'

/**
 * O PLANO DE SOM da Edicao rapida. Nao grava nada e nao registra a musica
 * (quem GRAVA ou RENDERIZA o projeto chama registrarMusicaUsada).
 *
 * 1. SFX (pedido.sfx): os arquivos da pasta de SFX do app (Configuracoes > Sons
 *    de transicao), tipo pelo NOME (sfxPeloNome: whoosh, impacto, cartoon pop
 *    so na abertura, riser, riser curto, temas como espada; "click" de
 *    interface fica de fora), RESERVA nos sons que vem com o app so quando a
 *    pasta dele nao tem whoosh ou impacto; cada um medido por loudness
 *    (./medir.ts), o arquivo de TEMA com varios golpes separado golpe a golpe
 *    pela onda (./golpes.ts), e posto pela regra pura planejarSfx (abertura,
 *    riser na saida do gancho, viradas, climax, tema pela fala em
 *    pedido.palavras), nivelado tambem pela narracao NAQUELE instante
 *    (pedido.vozPath).
 * 2. Musica (pedido.musica): a forcada ou a da vez SEM REPETIR; o ganho sai do
 *    integrado do TRECHO que toca (uma musica com introducao calma e refrao
 *    forte seria nivelada errado pelo arquivo inteiro); fades e ducking das
 *    regras.
 * 3. Avisos ASCII do que faltou. Falha de uma parte vira aviso, nunca excecao:
 *    o projeto sai de qualquer jeito.
 *
 * A montagem (electron/services/montar/index.ts) chama direto; o editor, pelo
 * IPC planejarSom.
 */
export async function planejarSom(pedido: PedidoDePlanoDeSom, regras: RegrasDeSom = REGRAS_DE_SOM_PADRAO): Promise<PlanoDeSom> {
  const avisos: string[] = []
  let sfx: SfxPlanejado[] = []
  let musica: MusicaPlanejada | null = null

  if (pedido.sfx) {
    try {
      const { arquivos, avisos: a } = await sfxDisponiveis()
      avisos.push(...a)
      sfx = planejarSfx(
        pedido.cortes.map((start) => ({ start })),
        pedido.secoes,
        arquivos,
        regras,
        pedido.duracaoSec,
        await vozParaNivelar(pedido.vozPath, regras),
        pedido.palavras,
        sementeDoVideo(pedido.vozPath, pedido.duracaoSec),
      )
      // Um arquivo so de um tipo: ele entra so nas marcas mais importantes.
      for (const tipo of ['whoosh', 'impacto'] as const) {
        const usados = sfx.filter((s) => s.tipo === tipo)
        const doTipo = arquivos.filter((x) => x.tipo === tipo && !x.soNaAbertura)
        const dele = doTipo.filter((x) => !x.reserva)
        if (usados.length > 0 && (dele.length > 0 ? dele : doTipo).length === 1) {
          avisos.push(tipo === 'whoosh' ? 'So 1 whoosh na pasta: so nas 2 viradas principais' : `So 1 ${ROTULO[tipo]} na pasta de SFX`)
        }
      }
      // Partes do roteiro sao o que pede whoosh e riser: sem elas, so a abertura.
      if (pedido.secoes.length <= 1 && sfx.length > 0) avisos.push('Sem partes do roteiro: so o som da abertura')
    } catch (err) {
      console.warn('[som] SFX da Edicao rapida falharam:', err)
      avisos.push('Sem SFX: nao deu para ler a pasta de sons')
    }
  }

  if (pedido.musica) {
    try {
      musica = await planejarMusica(pedido, regras, avisos)
    } catch (err) {
      console.warn('[som] musica da Edicao rapida falhou:', err)
      avisos.push('Sem musica: nao deu para ler a faixa')
    }
  }

  return { musica, sfx, avisos }
}

const ROTULO: Record<TipoDeSfx, string> = { whoosh: 'whoosh', impacto: 'impacto', riser: 'riser', tema: 'som de tema' }
const EXTENSOES = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']

/** Muda de video para video (a abertura com varios pops nao e sempre a mesma), igual ao rodar de novo. */
function sementeDoVideo(vozPath: string | null, duracaoSec: number): number {
  let h = Math.round(duracaoSec * 1000)
  for (const c of vozPath ?? '') h = (h * 31 + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

interface Candidato {
  path: string
  fileName: string
  reserva: boolean
  nome: NonNullable<ReturnType<typeof sfxPeloNome>>
}

/**
 * Os SFX com tipo e medida: os da pasta dele; os do app so no whoosh ou
 * impacto que faltar. Riser e tema so da pasta dele (o app nao tem).
 */
async function sfxDisponiveis(): Promise<{ arquivos: ArquivoDeSfx[]; avisos: string[] }> {
  const avisos: string[] = []
  let pastaDele: string | null = null
  let nomesDele: string[] = []
  try {
    pastaDele = sfxDir()
    nomesDele = listSfx()
  } catch {
    pastaDele = null
  }
  const reserva = pastaDeReservaDeSfx()
  let nomesReserva: string[] = []
  if (reserva) {
    try {
      nomesReserva = readdirSync(reserva)
        .filter((n) => EXTENSOES.includes(extname(n).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    } catch {
      nomesReserva = []
    }
  }

  const deles: Candidato[] = []
  if (pastaDele) {
    for (const n of nomesDele) {
      const nome = sfxPeloNome(n)
      if (nome) deles.push({ path: join(pastaDele, n), fileName: n, reserva: false, nome })
    }
  }
  const candidatos: Candidato[] = [...deles]
  for (const tipo of ['whoosh', 'impacto'] as const) {
    if (deles.some((c) => c.nome.tipo === tipo)) continue
    const doApp: Candidato[] = []
    if (reserva) {
      for (const n of nomesReserva) {
        const nome = sfxPeloNome(n)
        if (nome?.tipo === tipo) doApp.push({ path: join(reserva, n), fileName: n, reserva: true, nome })
      }
    }
    if (doApp.length > 0) {
      candidatos.push(...doApp)
      avisos.push(`Sem ${ROTULO[tipo]} na pasta de SFX: usei o do app`)
    } else {
      avisos.push(`Sem ${ROTULO[tipo]} na pasta de SFX`)
    }
  }
  if (!deles.some((c) => c.nome.tipo === 'riser')) avisos.push("Sem riser na pasta de SFX (nome com 'riser'): whoosh na saida do gancho")

  const arquivos: ArquivoDeSfx[] = []
  for (const c of candidatos) {
    if (!existsSync(c.path)) continue
    try {
      const m = await medirSomDetalhado(c.path)
      const arq: ArquivoDeSfx = {
        path: m.path,
        durationSec: m.durationSec,
        lufsIntegrado: m.lufsIntegrado,
        lufsMomentaneoMax: m.lufsMomentaneoMax,
        picoSec: m.picoSec,
        inicioSomSec: m.inicioSomSec,
        fimSomSec: m.fimSomSec,
        fileName: c.fileName,
        tipo: c.nome.tipo,
        reserva: c.reserva,
        ...(c.nome.tema ? { tema: c.nome.tema } : {}),
        ...(c.nome.soNaAbertura ? { soNaAbertura: true } : {}),
        ...(c.nome.riserCurto ? { riserCurto: true } : {}),
      }
      // NO MOMENTO CERTO PELA ONDA (todos os sons): o ataque e o pico pela
      // onda fina de 10 ms (golpes.ts), mais precisos que as janelas de 100 ms
      // do loudness. O pacote de golpes (as 9 espadadas num mp3) vira um
      // ArquivoDeSfx por golpe, com o pico DELE e o nivel dele contra o mais
      // forte. O riser nunca se divide: e uma subida so.
      const golpes = await golpesDoSom(c.path).catch(() => [])
      const forte = golpes.find((g) => g.relativoDb === 0) ?? golpes[0]
      if (forte) {
        arq.inicioSomSec = golpes[0]!.inicioSec
        arq.picoSec = forte.picoSec
      }
      if (golpes.length >= 2 && c.nome.tipo !== 'riser') {
        golpes.forEach((g, k) => {
          arquivos.push({
            ...arq,
            fileName: `${c.fileName} #${k + 1}`,
            picoSec: g.picoSec,
            inicioSomSec: g.inicioSec,
            fimSomSec: g.fimSec,
            lufsMomentaneoMax: arq.lufsMomentaneoMax === null ? null : arq.lufsMomentaneoMax + g.relativoDb,
            recorte: { de: Math.max(g.inicioSec - 0.02, 0), ate: g.ateSec },
          })
        })
      } else {
        arquivos.push(arq)
      }
    } catch (err) {
      console.warn('[som] SFX ilegivel:', c.fileName, err)
      avisos.push(`SFX ilegivel: ${c.fileName}`)
    }
  }
  return { arquivos, avisos }
}

/**
 * A narracao medida (blocos de 400 ms) e quanto o render sobe ela (o loudnorm
 * linear leva o integrado a vozLufs). null = sem narracao ou ilegivel: o SFX
 * segue so o integrado.
 */
async function vozParaNivelar(vozPath: string | null, regras: RegrasDeSom): Promise<VozParaNivelar | null> {
  if (!vozPath || !existsSync(vozPath)) return null
  try {
    const m = await medirSomDetalhado(vozPath)
    if (m.lufsIntegrado === null || m.blocos.length === 0) return null
    return { blocos: m.blocos, ajusteDb: regras.vozLufs - m.lufsIntegrado }
  } catch (err) {
    console.warn('[som] narracao ilegivel para nivelar os SFX:', err)
    return null
  }
}

/**
 * Quantos SFX de cada tipo a Edicao rapida tem e se sao so os de fabrica (o
 * passo 4 avisa antes de abrir). "De fabrica" = mesmo nome e mesmo tamanho de
 * um som que vem com o app (o Dangai copia os dele para a pasta do perfil).
 */
export function sfxDaEdicaoRapida(): SfxDaEdicaoRapida {
  let pastaDele: string | null = null
  let nomesDele: string[] = []
  try {
    pastaDele = sfxDir()
    nomesDele = listSfx()
  } catch {
    pastaDele = null
  }
  const reserva = pastaDeReservaDeSfx()
  const tamanhoNaReserva = (nome: string): number | null => {
    if (!reserva) return null
    try {
      return statSync(join(reserva, nome)).size
    } catch {
      return null
    }
  }
  let nomesReserva: string[] = []
  try {
    nomesReserva = reserva ? readdirSync(reserva).filter((n) => EXTENSOES.includes(extname(n).toLowerCase())) : []
  } catch {
    nomesReserva = []
  }
  const saida: SfxDaEdicaoRapida = { whoosh: 0, impacto: 0, deFabrica: true }
  // Riser, abertura e temas so da pasta dele (o app nao tem).
  if (pastaDele) {
    const nomes = nomesDele.map((n) => sfxPeloNome(n))
    saida.riser = nomes.filter((n) => n?.tipo === 'riser').length
    saida.abertura = nomes.filter((n) => n?.soNaAbertura).length
    saida.temas = TEMAS_DE_SFX.filter((t) => nomes.some((n) => n?.tema === t.id)).map((t) => t.rotulo)
  }
  for (const tipo of ['whoosh', 'impacto'] as const) {
    const dele = pastaDele ? nomesDele.filter((n) => tipoDoSfxPeloNome(n) === tipo) : []
    if (dele.length > 0) {
      saida[tipo] = dele.length
      for (const n of dele) {
        let tamanho: number | null = null
        try {
          tamanho = statSync(join(pastaDele!, n)).size
        } catch {
          tamanho = null
        }
        if (tamanho === null || tamanho !== tamanhoNaReserva(n)) saida.deFabrica = false
      }
    } else {
      saida[tipo] = nomesReserva.filter((n) => tipoDoSfxPeloNome(n) === tipo).length
    }
  }
  if (saida.whoosh + saida.impacto === 0) saida.deFabrica = false
  return saida
}

/** A musica da vez, medida no trecho que toca. null (com aviso) = nenhuma. */
async function planejarMusica(pedido: PedidoDePlanoDeSom, regras: RegrasDeSom, avisos: string[]): Promise<MusicaPlanejada | null> {
  let caminho = pedido.musicaForcada
  if (caminho && !existsSync(caminho)) {
    avisos.push('A musica escolhida sumiu: escolhi outra')
    caminho = null
  }
  if (!caminho) {
    const vez = await escolherMusica(pedido.evitarMusicas)
    if (!vez) {
      const estado = estadoDaPastaDeMusicas()
      avisos.push(
        estado === 'vazia'
          ? 'A pasta de musicas esta vazia'
          : estado === 'sumiu'
            ? 'A pasta de musicas nao foi encontrada'
            : estado === 'sem-pasta'
              ? 'Sem pasta de musicas: escolha nas Configuracoes'
              : 'Nenhuma musica da pasta deu para ler',
      )
      return null
    }
    caminho = vez.path
  }

  const m = await medirSomDetalhado(caminho)
  if (!(m.durationSec > 1)) {
    avisos.push('Sem musica: a faixa e curta demais')
    return null
  }
  // Pula o silencio do comeco do arquivo (nunca mais que metade dele).
  const inSec = Math.min(Math.max(m.inicioSomSec - 0.05, 0), m.durationSec / 2)
  const toca = Math.min(pedido.duracaoSec, m.durationSec - inSec)
  // Mais curta que o video: ela volta do comeco, entao vale o arquivo inteiro.
  const lufs = toca < pedido.duracaoSec - 0.05 ? m.lufsIntegrado : (integradoNoTrecho(m.blocos, inSec, inSec + toca) ?? m.lufsIntegrado)
  const lufsArred = lufs === null ? null : Math.round(lufs * 10) / 10
  // Musica baixa no arquivo nao sobe acima dele (preview = render): fica abaixo do alvo.
  const falta = musicaAbaixoDoAlvoDb(lufsArred, regras)
  if (falta >= 1) avisos.push(`Musica baixa no arquivo: ${falta} dB abaixo do alvo`)
  return {
    arquivo: caminho,
    ganhoDb: ganhoDaMusica(lufsArred, regras),
    fadeInSec: regras.musica.fadeInSec,
    fadeOutSec: regras.musica.fadeOutSec,
    ducking: regras.musica.ducking,
    inSec: Math.round(inSec * 1000) / 1000,
    durationSec: m.durationSec,
    lufsIntegrado: lufsArred,
  }
}
