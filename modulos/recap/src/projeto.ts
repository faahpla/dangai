import { rotuloDaSobreposicao } from '../shared/edicao-rapida'
import { textoIntacto } from '../shared/textos-na-tela'
import { clipeParaOModulo, converterDoStudio, papelDaSobreposicao, recapDoProjeto } from '../shared/projeto-do-recap'
import type { ClipeDaFaixa } from '@/modulos/api'
import { nucleo } from './nucleo'
import { registrarMusicaDoProjeto, temEdicaoRapida } from './store/edicao-rapida'

/**
 * [recap] O MODULO E O PROJETO ABERTO: os eventos do nucleo que o recap ouve.
 *
 * - abrirProjeto: um projeto que passou pelo AniRecap Studio (o `studio` na
 *   raiz, `papel`/`corOriginal` nos itens) vai para o lugar do modulo
 *   (`modulos.recap`, versao 1) e, se a voz era a do take alinhado
 *   (`vozAlinhada`), a transcricao fica travada pelo nucleo. Um passo so de
 *   Ctrl+Z. Assim os projetos do Studio do Levi continuam valendo aqui.
 *   O `studio` velho da raiz fica nos extras do nucleo (volta ao arquivo como
 *   veio): a fachada nao deixa o modulo tirar um campo da raiz.
 * - depoisDeSalvar / depoisDeRenderizar: a musica que o projeto TEM vai para o
 *   historico de "ja usada" (o proximo short nao repete). Nunca ao aplicar.
 */
export function ouvirOProjeto(): () => void {
  const n = nucleo()
  const tirar = [
    n.ao('abrirProjeto', () => converterOAberto()),
    n.ao('depoisDeSalvar', () => anotarAMusica()),
    n.ao('depoisDeRenderizar', () => anotarAMusica()),
  ]
  return () => {
    for (const t of tirar) t()
  }
}

/** Converte o projeto aberto, se veio do Studio. Devolve se mudou algo. */
export function converterOAberto(): boolean {
  const n = nucleo()
  const estado = n.ler()
  const arquivo = n.paraArquivo() as { studio?: unknown } | null
  const conv = converterDoStudio({
    modulos: estado.modulos,
    trilhas: estado.trilhas,
    sobreposicoes: estado.sobreposicoes,
    studio: arquivo?.studio,
  })
  if (!conv) {
    // Projeto ja do modulo com a voz alinhada e a trava solta (um nucleo mais velho gravou): trava de novo.
    if (recapDoProjeto(estado.modulos)?.vozAlinhada && !estado.transcriptTravado && estado.transcript) {
      n.travarTranscript(true)
      return true
    }
    return false
  }
  n.aplicarNoDocumento(() => {
    // A trava pelo nucleo, dentro da mesma receita: o mesmo passo de Ctrl+Z.
    if (conv.travar && !n.ler().transcriptTravado) n.travarTranscript(true)
    return { modulos: conv.modulos, trilhas: conv.trilhas, sobreposicoes: conv.sobreposicoes }
  })
  return true
}

function anotarAMusica(): void {
  const estado = nucleo().ler()
  // So projeto do recap (ou com o que a Edicao rapida pos): projeto do Dangai nao mexe no historico.
  if (recapDoProjeto(estado.modulos) === null && !temEdicaoRapida(estado)) return
  registrarMusicaDoProjeto(estado)
}

/**
 * O nome no clipe da linha do tempo: a camada de cor mexida diz "Cor
 * (editada)"; o texto na tela mexido, "Texto: X (editado)" -- a Edicao rapida
 * nao troca mais esse.
 */
export function rotuloDoClipe(c: ClipeDaFaixa): string | null {
  if (c.tipo !== 'video') return null
  const papel = papelDaSobreposicao(c.clipe)
  if (papel === 'texto') return textoIntacto(c.clipe) ? null : `${c.clipe.fileName} (editado)`
  if (papel !== 'cor') return null
  return rotuloDaSobreposicao(clipeParaOModulo(c.clipe))
}
