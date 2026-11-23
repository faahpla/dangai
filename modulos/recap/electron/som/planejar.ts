import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import {
  ganhoDaMusica,
  grudarNoCorte,
  musicaAbaixoDoAlvoDb,
  planejarSfx,
  saidaDoGancho,
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
  type TrocaDeMusica,
  type VozParaNivelar,
} from '../../shared/edicao-rapida'
import {
  CLIMAS_CALMOS,
  fimUtilDaMusica,
  inicioParaODrop,
  musicaDoClima,
  trechosDaTrilha,
  type Clima,
  type ParteComClima,
  type TrechoDaTrilha,
} from '../../shared/trilha-sonora'
import { COMBO_DO_GANCHO, entradaDoGuia, musicaDoGuia, servePeloAnime } from '../../shared/guia-de-musicas'
import { integradoNoTrecho } from '@shared/loudness'
import { listSfx, sfxDir } from '../sfx'
import { climasDasMusicas, climasDasPartes } from './clima'
import { entradasDaMusica } from './entradas'
import { golpesDoSom } from './golpes'
import { medirSomDetalhado, pastaDeReservaDeSfx } from './medir'
import { estadoDaPastaDeMusicas, listarMusicas } from './musicas'

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
 * 2. Musica (pedido.musica), ANTES dos SFX (01/11, a trilha sonora,
 *    shared/trilha-sonora.ts): o clima de cada parte (./clima.ts) divide o
 *    video em trechos, cada um com uma musica daquele clima SEM REPETIR, e
 *    cada musica comeca de um jeito que um ponto de ENTRADA dela
 *    (./entradas.ts, pela onda) caia no corte: a saida do gancho (o trecho
 *    calmo antes do drop toca sob o gancho) ou a troca. A forcada (o
 *    "trocar") vale o video inteiro, com o drop na saida do gancho. O ganho
 *    sai do integrado do TRECHO que toca; fades e ducking das regras. As
 *    trocas viram marcas dos SFX (riser curto + impacto, ou tape stop).
 * 3. Avisos ASCII do que faltou. Falha de uma parte vira aviso, nunca excecao:
 *    o projeto sai de qualquer jeito.
 *
 * A montagem (electron/services/montar/index.ts) chama direto; o editor, pelo
 * IPC planejarSom.
 */
export async function planejarSom(pedido: PedidoDePlanoDeSom, regras: RegrasDeSom = REGRAS_DE_SOM_PADRAO): Promise<PlanoDeSom> {
  const avisos: string[] = []
  let sfx: SfxPlanejado[] = []
  let musicas: MusicaPlanejada[] = []
  let trocas: TrocaDeMusica[] = []

  if (pedido.musica) {
    try {
      const t = await planejarTrilha(pedido, regras, avisos)
      musicas = t.musicas
      trocas = t.trocas
    } catch (err) {
      console.warn('[som] musica da Edicao rapida falhou:', err)
      avisos.push('Sem musica: nao deu para ler a faixa')
    }
  }

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
        trocas,
      )
      // Um arquivo so de um tipo: ele entra so nas marcas mais importantes.
      for (const tipo of ['whoosh', 'impacto'] as const) {
        const usados = sfx.filter((s) => s.tipo === tipo)
        const doTipo = arquivos.filter((x) => x.tipo === tipo && !x.soNaAbertura && !x.parada)
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

  return { musica: musicas[0] ?? null, musicas, sfx, avisos }
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

/**
 * A TRILHA: os trechos por clima, a musica de cada um e o ponto do arquivo
 * que poe o drop no corte. Vazio (com aviso) = nenhuma musica.
 */
async function planejarTrilha(
  pedido: PedidoDePlanoDeSom,
  regras: RegrasDeSom,
  avisos: string[],
): Promise<{ musicas: MusicaPlanejada[]; trocas: TrocaDeMusica[] }> {
  const cenas = pedido.cortes.map((start) => ({ start }))
  const gancho = saidaDoGancho(cenas, pedido.secoes, regras, pedido.duracaoSec)
  const cortes = [...new Set(pedido.cortes.filter((t) => t > 0))].sort((a, b) => a - b)
  const grudar = (t: number): number => grudarNoCorte(cortes, t, regras)

  let forcada = pedido.musicaForcada
  if (forcada && !existsSync(forcada)) {
    avisos.push('A musica escolhida sumiu: escolhi outra')
    forcada = null
  }
  // A forcada (o "trocar"): uma so, o video inteiro, com o drop na saida do gancho.
  if (forcada) {
    const m = await musicaNoTrecho(forcada, { at: 0, ate: pedido.duracaoSec, drop: gancho ?? 0, clima: 'acao' }, true, true, regras, avisos, {
      entradaSec: entradaDoGuia(musicaDoGuia(forcada), 'acao'),
    })
    return { musicas: m ? comOGanchoAberto({ ...m, clima: null }, gancho, pedido.duracaoSec) : [], trocas: [] }
  }

  const todas = await listarMusicas()
  if (todas.length === 0) {
    const estado = estadoDaPastaDeMusicas()
    avisos.push(
      estado === 'vazia'
        ? 'A pasta de musicas esta vazia'
        : estado === 'sumiu'
          ? 'A pasta de musicas nao foi encontrada'
          : 'Sem pasta de musicas: escolha nas Configuracoes',
    )
    return { musicas: [], trocas: [] }
  }

  // O clima de cada parte (a fala dela) e o de cada musica.
  const ordenadas = [...pedido.secoes].sort((a, b) => a.inicio - b.inicio)
  const textos = ordenadas.map((sec) =>
    pedido.palavras
      .filter((p) => p.t >= sec.inicio - 0.05 && p.t < sec.fim)
      .map((p) => p.texto)
      .join(' '),
  )
  const { climas } = await climasDasPartes(ordenadas.map((sec, i) => ({ papel: sec.papel, texto: textos[i] ?? '' })))
  const partes: ParteComClima[] = ordenadas.map((sec, i) => ({ inicio: sec.inicio, fim: sec.fim, papel: sec.papel, clima: climas[i] ?? 'acao' }))
  const trechos = trechosDaTrilha(partes, gancho, pedido.duracaoSec, grudar)
  const climaDaMusica = await climasDasMusicas(todas)

  // A ordem do "sem repetir": nunca usadas, depois a usada ha mais tempo; as de agora por ultimo.
  const evitar = new Set(pedido.evitarMusicas.map((p) => p.replace(/\\/g, '/').toLowerCase()))
  // (22/11) A abertura de um anime (Haruka Mirai) so no video dele, e nele ela vem primeiro.
  const doVideo = (m: { fileName: string }): boolean => servePeloAnime(musicaDoGuia(m.fileName), pedido.vozPath)
  const daquiPrimeiro = (m: { fileName: string }): number => (musicaDoGuia(m.fileName)?.doAnime && doVideo(m) ? 0 : 1)
  const ordem = [...todas]
    .filter(doVideo)
    .sort((a, b) => {
      const pa = daquiPrimeiro(a)
      const pb = daquiPrimeiro(b)
      if (pa !== pb) return pa - pb
      const ea = evitar.has(a.path.replace(/\\/g, '/').toLowerCase()) ? 1 : 0
      const eb = evitar.has(b.path.replace(/\\/g, '/').toLowerCase()) ? 1 : 0
      if (ea !== eb) return ea - eb
      const ua = a.usadaEm ?? ''
      const ub = b.usadaEm ?? ''
      if (ua !== ub) return ua < ub ? -1 : 1
      return a.fileName.localeCompare(b.fileName, 'pt-BR')
    })
    .map((m) => {
      // (22/11) O guia do Levi manda no clima (shared/guia-de-musicas.ts).
      const guia = musicaDoGuia(m.fileName)
      return {
        ...m,
        guia,
        clima: guia?.climas[0] ?? climaDaMusica.get(m.path) ?? null,
        climas: guia?.climas,
        especifica: guia?.especifica,
        soNoGancho: guia?.soNoGancho,
      }
    })
  const doGuia = (id: string): (typeof ordem)[number] | undefined => ordem.find((m) => m.guia?.id === id)

  const musicas: MusicaPlanejada[] = []
  const usadas = new Set<string>()
  const ruins = new Set<string>()
  for (const [k, trecho] of trechos.entries()) {
    let feita: MusicaPlanejada | null = null
    for (let tentativa = 0; tentativa < 4 && !feita; tentativa++) {
      const vez = musicaDoClima(trecho.clima, ordem.filter((m) => !ruins.has(m.path)), usadas, k === 0, trecho.ate - trecho.at)
      if (!vez) break
      const ultima = k === trechos.length - 1
      const falhou = (err: unknown): null => {
        console.warn('[som] musica ilegivel, tentando a proxima:', vez.fileName, err)
        return null
      }
      // (22/11) O COMBO DO GANCHO do Levi ("a que mais gosto"): a Montagem Batchi slowed sob o gancho e,
      // na virada, a instrumental (0:25 da slowed = 0:19 da instrumental, no corte).
      const slowed = doGuia(COMBO_DO_GANCHO.gancho)
      const instrumental = doGuia(COMBO_DO_GANCHO.depois)
      const ehCombo = vez.guia?.id === COMBO_DO_GANCHO.gancho || vez.guia?.id === COMBO_DO_GANCHO.depois
      if (k === 0 && gancho !== null && gancho > 0.5 && ehCombo && slowed && instrumental && !ruins.has(slowed.path) && !ruins.has(instrumental.path)) {
        const noGancho = await musicaNoTrecho(slowed.path, { ...trecho, ate: gancho, drop: gancho }, true, false, regras, avisos, {
          entradaSec: COMBO_DO_GANCHO.corteNoGanchoSec,
        }).catch(falhou)
        const depois = await musicaNoTrecho(instrumental.path, { ...trecho, at: gancho, drop: gancho }, false, ultima, regras, avisos, {
          entradaSec: COMBO_DO_GANCHO.entradaDepoisSec,
        }).catch(falhou)
        if (noGancho && depois) {
          musicas.push({ ...noGancho, ducking: null, fadeInSec: 0.05, emenda: true }, { ...depois, fadeInSec: 0 })
          usadas.add(slowed.path)
          usadas.add(instrumental.path)
          feita = null
          break
        }
        if (!noGancho) ruins.add(slowed.path)
        if (!depois) ruins.add(instrumental.path)
        continue
      }
      // A slowed sem o par (ou fora do gancho): fica de fora.
      if (vez.guia?.id === COMBO_DO_GANCHO.gancho) {
        ruins.add(vez.path)
        continue
      }
      feita = await musicaNoTrecho(vez.path, trecho, k === 0, ultima, regras, avisos, {
        entradaSec: entradaDoGuia(vez.guia, trecho.clima),
        comecoSec: vez.guia?.comecoSec ?? null,
      }).catch(falhou)
      if (!feita) ruins.add(vez.path)
      else {
        usadas.add(vez.path)
        const serve = vez.clima === trecho.clima || !!vez.climas?.includes(trecho.clima)
        if (!serve) avisos.push(`Sem musica de ${trecho.clima}: usei ${vez.clima ?? 'outra'}`)
        // (22/11) O gancho com musica que se ouve: ate a saida dele, sem abaixar sob a voz e sem o
        // fade lento ("parece que comeca sem musica"); do drop em diante, a mesma faixa seguindo.
        if (k === 0) {
          musicas.push(...comOGanchoAberto(feita, gancho, trecho.ate))
          feita = null
          break
        }
      }
    }
    if (feita) musicas.push(feita)
  }
  if (musicas.length === 0) avisos.push('Nenhuma musica da pasta deu para ler')
  // As trocas: o comeco de cada musica depois da primeira.
  // A emenda (a mesma faixa seguindo, o combo do gancho) nao e troca: ali ja tem o riser do gancho.
  const trocas = musicas
    .slice(1)
    .map((m, i) => ({ m, antes: musicas[i]! }))
    .filter(({ antes }) => !antes.emenda)
    .map(({ m, antes }) => ({
      t: m.at,
      calma: CLIMAS_CALMOS.has(m.clima as Clima) && !CLIMAS_CALMOS.has(antes.clima as Clima),
    }))
  return { musicas, trocas }
}

/**
 * (22/11) O GANCHO COM MUSICA QUE SE OUVE ("parece que comeca sem musica", o
 * Levi no Overgeared S01E09): a 1a musica vira dois pedacos da mesma faixa,
 * emendados -- ate a saida do gancho sem ducking e sem o fade lento; dali em
 * diante a mesma faixa seguindo (o drop cai ali), com o ducking de sempre.
 * Sem gancho (ou gancho que nao cabe no trecho): a musica como veio.
 */
function comOGanchoAberto(m: MusicaPlanejada, gancho: number | null, fimDoTrecho: number): MusicaPlanejada[] {
  if (gancho === null || !(gancho > 0.5) || gancho > fimDoTrecho - 0.5 || m.at > 0.01) return [m]
  const g = Math.round(gancho * 1000) / 1000
  return [
    { ...m, ate: g, ducking: null, fadeInSec: 0.05, emenda: true, dropSec: null },
    { ...m, at: g, inSec: Math.round((m.inSec + gancho) * 1000) / 1000, fadeInSec: 0 },
  ]
}

/** Uma musica num trecho: o ponto do arquivo que poe o drop no corte, o ganho do pedaco que toca. */
async function musicaNoTrecho(
  caminho: string,
  trecho: TrechoDaTrilha,
  primeira: boolean,
  ultima: boolean,
  regras: RegrasDeSom,
  avisos: string[],
  /**
   * (22/11) O guia do Levi: `entradaSec` = o drop que ele usa (manda no
   * detector, se couber); `comecoSec` = de onde ela toca (CLIMA LINDO 0:10,
   * River's End 1:20), sem procurar drop.
   */
  doGuia: { entradaSec?: number | null; comecoSec?: number | null } = {},
): Promise<MusicaPlanejada | null> {
  const m = await medirSomDetalhado(caminho)
  if (!(m.durationSec > 1)) {
    avisos.push('Sem musica: a faixa e curta demais')
    return null
  }
  const entradas = await entradasDaMusica(caminho).catch(() => ({ durationSec: m.durationSec, entradas: [] }))
  // (17/11) Onde ela comeca a sumir: o trecho nao entra no fade do fim.
  const fimUtilSec = fimUtilDaMusica(m.blocos, m.lufsIntegrado, m.durationSec, m.fimSomSec)
  const daMusica = { durationSec: m.durationSec, inicioSomSec: m.inicioSomSec, fimUtilSec }
  let escolha: { inSec: number; entrada: { t: number; forca: number } | null } | null = null
  if (typeof doGuia.comecoSec === 'number' && doGuia.comecoSec < fimUtilSec - 2) {
    escolha = { inSec: doGuia.comecoSec, entrada: null }
  } else if (typeof doGuia.entradaSec === 'number' && doGuia.entradaSec < fimUtilSec - 1) {
    const r = inicioParaODrop({ ...daMusica, entradas: [{ t: doGuia.entradaSec, forca: 100 }] }, trecho)
    if (r.entrada) escolha = r
  }
  const { inSec: bruto, entrada } = escolha ?? inicioParaODrop({ ...daMusica, entradas: entradas.entradas }, trecho)
  const inSec = Math.min(bruto, Math.max(m.durationSec - 1, 0))
  const dura = trecho.ate - trecho.at
  const toca = Math.min(dura, fimUtilSec - inSec)
  // Mais curta que o trecho: ela volta do comeco, entao vale o arquivo inteiro.
  const lufs = toca < dura - 0.05 ? m.lufsIntegrado : (integradoNoTrecho(m.blocos, inSec, inSec + toca) ?? m.lufsIntegrado)
  const lufsArred = lufs === null ? null : Math.round(lufs * 10) / 10
  // Musica baixa no arquivo nao sobe acima dele (preview = render): fica abaixo do alvo.
  const falta = musicaAbaixoDoAlvoDb(lufsArred, regras)
  if (falta >= 1) avisos.push(`Musica baixa no arquivo: ${falta} dB abaixo do alvo`)
  return {
    arquivo: caminho,
    ganhoDb: ganhoDaMusica(lufsArred, regras),
    // A primeira sobe devagar (o trecho calmo do gancho); a da troca entra no drop.
    fadeInSec: primeira ? regras.musica.fadeInSec : 0.05,
    fadeOutSec: regras.musica.fadeOutSec,
    ducking: regras.musica.ducking,
    inSec: Math.round(inSec * 1000) / 1000,
    durationSec: m.durationSec,
    inicioSomSec: Math.round(m.inicioSomSec * 1000) / 1000,
    fimUtilSec: Math.round(fimUtilSec * 1000) / 1000,
    lufsIntegrado: lufsArred,
    at: Math.round(trecho.at * 1000) / 1000,
    ate: ultima ? null : Math.round(trecho.ate * 1000) / 1000,
    clima: trecho.clima,
    dropSec: entrada ? Math.round(trecho.drop * 1000) / 1000 : null,
  }
}
