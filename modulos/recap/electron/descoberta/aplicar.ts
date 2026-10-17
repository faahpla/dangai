import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { anexarPlanos, episodeIndexSchema, temPlanos, type EpisodeIndex } from '../../shared/episodio'
import { abrirIndicePorId } from '../episodio/abrir-indice'
import {
  avisosDeTempo,
  caminhoDoIndice,
  guardarAnterior,
  lerIndiceDoDisco,
  mesmoCaminho,
  montarPlanos,
  reconhecimentoDaPasta,
} from '../episodio/indice'
import { AVISO_DE_OUTRO_ARQUIVO, lerPastaDoEpisodio } from '../episodio/pasta-do-episodio'
import { gravarJsonAtomico, lembrarIndice } from '../episodio/perfil'
import { garantirGravavel } from '../episodio/protegidas'

/**
 * O FIM do Reconhecer na mao no indice: o motor regravou o shots.json com os
 * personagens batizados, e os planos do indice ganham esses nomes pelo MESMO
 * caminho do fim de um corte (corte-fundo.ts, `anexar`):
 *
 *   lerPastaDoEpisodio -> montarPlanos (cues do indice lido AGORA) ->
 *   anexarPlanos -> <pasta do episodio>/episodio.json (o anterior fica ao lado
 *   com carimbo, nunca apagado; o de _indices tambem, quando era la) ->
 *   lembrarIndice.
 *
 * Id, fonte, cues, exclusoes (a regua mexida) e o nome ficam como estavam: o
 * roteiro e as escolhas de cena citam essas cues e os ids dos planos, que sao
 * os nomes dos mp4 (iguais antes e depois).
 *
 * `corte.reconhecer` vira true: anexarPlanos manteria o false do "Cortar sem
 * personagens", e a tela continuaria oferecendo "Reconhecer agora".
 *
 * Sincrono de proposito: le, aplica e grava sem await no meio (como o
 * corte-fundo), para nada gravar o indice entre a leitura e a escrita. Lanca
 * com a frase para a tela.
 */
export function aplicarNoIndice(episodioId: string, pastaDoEpisodio: string, agoraIso: string): EpisodeIndex {
  const dados = lerPastaDoEpisodio(pastaDoEpisodio)
  if (!dados || dados.cenas.length === 0) {
    throw new Error('O motor salvou os personagens, mas a pasta do episodio nao tem cenas legiveis.')
  }
  // abrirIndicePorId corrige em memoria um indice cuja pasta mudou de lugar.
  const aberto = abrirIndicePorId(episodioId)
  const atual = aberto.indice
  const planos = montarPlanos(dados, atual.cues)
  // Mesma pasta, mesmo indice ja conferido: o .mkv em outro caminho nao vira
  // aviso de "outro arquivo" so porque a descoberta regravou o shots.json.
  const conferido =
    temPlanos(atual) &&
    mesmoCaminho(atual.biblioteca.pasta, pastaDoEpisodio) &&
    !atual.avisos.some((a) => a.startsWith(AVISO_DE_OUTRO_ARQUIVO))
  const anexado = anexarPlanos(
    atual,
    {
      planos,
      biblioteca: { origem: 'studio', pasta: pastaDoEpisodio },
      reconhecimento: reconhecimentoDaPasta(dados, planos),
      avisos: avisosDeTempo(atual.fonte, dados, atual.fonte.path, conferido),
    },
    agoraIso,
  )
  const novo = episodeIndexSchema.parse({ ...anexado, corte: { ...anexado.corte!, reconhecer: true } })

  const destino = caminhoDoIndice('studio', pastaDoEpisodio, episodioId)
  garantirGravavel(pastaDoEpisodio)
  garantirGravavel(dirname(destino))
  guardarAnterior(destino, existsSync(destino) ? lerIndiceDoDisco(destino) : null)
  gravarJsonAtomico(destino, novo)
  if (!mesmoCaminho(aberto.caminho, destino) && existsSync(aberto.caminho)) guardarAnterior(aberto.caminho, atual)
  lembrarIndice(episodioId, destino)
  return novo
}

/** Quem aparece no indice e em quantas cenas, do mais frequente ao menos. */
export function personagensDoIndice(indice: Pick<EpisodeIndex, 'planos'>): { nome: string; cenas: number }[] {
  const conta = new Map<string, number>()
  for (const p of indice.planos) {
    for (const nome of new Set(p.personagens.map((x) => x.nome))) conta.set(nome, (conta.get(nome) ?? 0) + 1)
  }
  return [...conta.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([nome, cenas]) => ({ nome, cenas }))
}
