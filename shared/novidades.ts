/**
 * O QUE MUDOU, versao por versao, do jeito que quem usa entende.
 *
 * Aparece numa janelinha na primeira vez que o Dangai abre depois de
 * atualizar (src/components/Novidades.tsx). Antes, a versao nova chegava e
 * ninguem sabia o que tinha de diferente.
 *
 * TODA VERSAO PUBLICADA TEM UMA ENTRADA AQUI, a mais nova em cima -- o teste
 * (scripts/teste/v-novidades.ts) confere que a do package.json esta na lista,
 * e o GitHub nao publica sem ele passar. Versao sem nada visivel (so conserto
 * por dentro) entra com `itens: []`: a janelinha nao abre por ela.
 *
 * Escreva para quem usa: o que muda na tela, sem nome de arquivo nem jargao.
 */

export interface Novidade {
  versao: string
  itens: readonly string[]
}

export const NOVIDADES: readonly Novidade[] = [
  {
    versao: '1.80.0',
    itens: [
      'Biblioteca por roteiro: ela já abre no anime do roteiro, mesmo quando um nome de personagem existe em dois animes (a "Lucy" de Cyberpunk e a de Mushoku Tensei). Para ver tudo, clique em "Todos".',
      'Marcou a cena que cobre a frase, o Dangai pula sozinho para a próxima frase vazia. Para pôr mais uma cena na mesma frase, é só clicar de volta nela.',
      'Primeira vez no Dangai: a tela inicial oferece baixar de uma vez o que ele usa no primeiro vídeo (transcrição, sincronizador de legendas e o navegador do render), em vez de parar no meio do trabalho.',
      'O preview não dá mais aquele erro escondido de áudio a cada play.',
    ],
  },
  {
    versao: '1.79.0',
    itens: [
      'Biblioteca: agora dá para favoritar uma cena que já está marcada. Antes, clicar na estrela de uma cena escolhida desmarcava a cena.',
    ],
  },
  {
    versao: '1.78.0',
    itens: [
      'O Dangai agora escreve com acento em todas as telas: Configurações, Seleção, Transição, vídeo, áudio, narração...',
      'O botão de avisos na barra de baixo agora diz "8 avisos", e não só "⚠ 8". Clique nele para ver o que conferir antes de renderizar.',
      'Na linha do tempo, o número do bloco não fica mais em cima do vizinho quando o bloco é estreito: ele some ali e aparece ao passar o mouse.',
    ],
  },
  {
    versao: '1.77.0',
    itens: [
      'Assistir em tela cheia: aperte F (ou o botão no canto do preview) para ver o vídeo grande, do tamanho da tela. Espaço toca e pausa; Esc sai.',
      'Copiar relatório: quando aparecer um erro em vermelho lá embaixo, clique em "Copiar relatório" do lado e cole no Discord. Vai junto o que o app anotou antes do erro, e isso ajuda a consertar bem mais rápido. Nenhuma chave de API vai junto.',
      'Esta janelinha: a cada atualização, ela conta o que mudou.',
    ],
  },
]

/** -1, 0 ou 1, comparando "1.76.0" com "1.77.0" numero a numero. */
export function compararVersoes(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/** No maximo isto de versoes de uma vez: quem pulou muitas ve as ultimas. */
const MAXIMO_DE_VERSOES = 5

/**
 * O que mostrar ao abrir a `atual`, tendo visto por ultimo a `vista`.
 *
 * - `vista` e a ultima versao que ja abriu aqui; o que veio depois dela ate a
 *   atual (inclusive) aparece;
 * - `vista` null e quem nunca viu a janelinha: se ja usava o Dangai (veio de
 *   uma versao de antes dela), mostra so a atual; se e a primeira vez, nada.
 */
export function novidadesParaMostrar(
  atual: string,
  vista: string | null,
  jaUsava: boolean,
  lista: readonly Novidade[] = NOVIDADES,
): Novidade[] {
  const comItens = lista.filter((n) => n.itens.length > 0)
  if (vista === null) return jaUsava ? comItens.filter((n) => compararVersoes(n.versao, atual) === 0) : []
  return comItens
    .filter((n) => compararVersoes(n.versao, vista) > 0 && compararVersoes(n.versao, atual) <= 0)
    .sort((a, b) => compararVersoes(b.versao, a.versao))
    .slice(0, MAXIMO_DE_VERSOES)
}
