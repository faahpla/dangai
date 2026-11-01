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
    versao: '1.87.5',
    itens: [
      'Configurações > Voz do recap: escolha primeiro ElevenLabs ou Fish Audio, depois a voz e o modelo daquele serviço (Multilingual v2, Eleven v4, Flash v2.5, Eleven v3; S2.1 Pro, S2.1 Pro grátis, S2 Pro, S1). Cada um lembra a sua voz: trocar de um para o outro e voltar devolve a que estava.',
      'A lista de vozes carrega sozinha ao abrir, sem precisar clicar em "Testar".',
      'Saiu o "Trazer do AniRecap Studio".',
    ],
  },
  {
    versao: '1.87.4',
    itens: [
      'Gerar recap: todos os personagens ganham as fotos da galeria do MyAnimeList, e não só os 18 principais. No Black Clover, a Vanessa foi de 1 para 7 fotos e a Zora de 1 para 6. Os elencos já guardados buscam essas fotos uma vez, na próxima análise (no Black Clover, uns 2 minutos).',
      'O filtro de mangá não joga mais fora a arte colorida com fundo branco (como a imagem oficial do personagem). As que ele tinha descartado por engano voltam sozinhas. Página de mangá continua de fora.',
    ],
  },
  {
    versao: '1.87.3',
    itens: [
      'Gerar recap: o elenco e as fotos do MyAnimeList vêm direto do site dele. O Jikan, que parou de funcionar, saiu, e a análise não fica mais esperando por ele.',
      'Mais personagens reconhecidos: cada um ganha também a foto da AniList, procurada em todas as temporadas e filmes do anime, e não só no primeiro. No Black Clover, os personagens com uma foto só (abaixo do mínimo para reconhecer) caíram de 71 para 13. Os elencos já guardados ganham essas fotos sozinhos na próxima análise.',
    ],
  },
  {
    versao: '1.87.2',
    itens: [
      'Gerar recap: quem você já reconheceu no AnCut passa a ser reconhecido também nos episódios cortados pelo motor do Dangai. A cada corte, o Dangai pega do AnCut as fotos de quem ele ainda não conhecia. Quem ele já reconhecia continua igual.',
    ],
  },
  {
    versao: '1.87.1',
    itens: [
      'Gerar recap: quando o corte pelo AnCut para por falta de fotos do elenco, aparece o botão "Reconhecer na mão". O recap corta o episódio de novo na biblioteca dele, junta os rostos parecidos e você dá o nome de cada personagem. Antes o botão sumia e não tinha o que fazer.',
    ],
  },
  {
    versao: '1.87.0',
    itens: [
      'Legenda: botão "centralizar" ao lado do "voltar ao padrão" da Altura. Põe a legenda bem no meio da tela, sem precisar arrastar no olho.',
      'Thumbnail: "Rotação" do texto (de -15 a +15 graus). As duas linhas giram juntas, e a sombra continua caindo reta, como no Photoshop.',
      'Thumbnail: a seta tem sempre o formato da seta padrão (corpo grosso e ponta larga). O app só aumenta, gira ou espelha, nunca estica.',
      'Thumbnail: "Inclinação" da emenda e do divisor. A imagem de cima e a de baixo passam a se encontrar numa linha inclinada, e o divisor acompanha de ponta a ponta. O botão "= texto" usa o mesmo ângulo do texto.',
    ],
  },
  {
    versao: '1.86.0',
    itens: [
      'Thumbnail: divisor entre a imagem de cima e a de baixo (Rasgo com brilho, Rasgo, Slash ou Linha), com a cor que você quiser. Ele fica por cima das imagens e por baixo do texto.',
      'Thumbnail: "Tamanho do texto" de 70% a 150%. A linha longa cresce até o limite da largura e avisa quando chegou lá.',
      'Thumbnail: a seta fica sempre grande; quando o texto é largo, ela passa por trás da primeira letra e aponta para o rosto.',
      'Thumbnail: quadros com faixa preta de cinema perdem a faixa, e a imagem sempre cobre o espaço inteiro, sem sobrar fundo preto.',
    ],
  },
  {
    versao: '1.85.0',
    itens: [
      'Thumbnail: novo botão na tela inicial (ligue em Configurações > Módulos). Faz a capa 1080x1920 sem precisar do Gerar recap: suba as imagens do computador, ou escolha um projeto e pegue os quadros das cenas, sempre sem legenda.',
      'Na thumbnail, a barra "Quadro dentro da cena" deixa escolher qualquer quadro do mesmo clipe, quadro a quadro.',
      'Texto longo na thumbnail: a linha comprida encolhe sozinha sem passar por cima da outra, e as quatro fontes ficam alinhadas no mesmo lugar.',
    ],
  },
  {
    versao: '1.84.0',
    itens: [
      'Ler cenas do B-roll: com um B-roll aberto, o botão "Ler cenas do B-roll" (em cima, na Biblioteca) faz uma IA olhar cada cena dos episódios dele e escrever o que acontece nela. Roda no seu PC, de graça, pelo Ollama.',
      'Com as cenas lidas, as sugestões e o "Montar tudo" acham a cena certa dentro do episódio, e não só o episódio certo: "Uryu virou médico" traz a cena do consultório. Passe o mouse numa sugestão para ver o que a IA viu nela.',
      'A leitura leva uns 3 segundos por cena (um episódio, uns 25 minutos) e só é feita uma vez: o que foi lido fica guardado. O mesmo botão para a leitura, e na próxima vez ela continua de onde parou.',
    ],
  },
  {
    versao: '1.83.1',
    itens: [
      'Gerar recap: a tela "Vídeo pronto" ganhou a aba Thumbnail. Uma ou duas imagens (em cima e embaixo, com o botão ⇅ para inverter), texto em duas linhas na fonte Luckiest Guy com contorno e sombra, seta apontando o rosto, e "Salvar PNG" em 1080x1920 ao lado do vídeo.',
      'As imagens vêm das cenas do vídeo (as do gancho primeiro), de qualquer quadro do vídeo (sempre sem a legenda) ou do seu computador. Cada uma já entra enquadrada pelo rosto, fora das faixas que o TikTok cobre; dá para ajustar com zoom e arrastando.',
      'Você muda o texto, as cores, a fonte e a altura do texto. O PNG passa pelo upscale do Dangai e fica nítido. Tudo fica salvo no projeto.',
    ],
  },
  {
    versao: '1.82.0',
    itens: [
      'B-roll: solte o .txt do B-roll junto da narração e do roteiro (qualquer nome). O Dangai lê de que episódio sai cada parte do vídeo, e o "Montar tudo", o "Montar recap" e as sugestões da Biblioteca passam a preferir as cenas desses episódios.',
      'Na Biblioteca, cada frase mostra o episódio que o B-roll dá para ela, e o botão "Episódio 48 do B-roll" abre o episódio inteiro na grade. Para tirar o B-roll, clique no X ao lado dele.',
      'Se o B-roll pedir um episódio que ainda não foi cortado no AnCut, o Dangai avisa qual é.',
      'Marcar uma cena na Biblioteca não pula mais sozinho para a próxima frase. Para ir à próxima frase vazia, aperte Tab.',
    ],
  },
  {
    versao: '1.81.0',
    itens: [
      '"Do meu jeito" (barra de baixo): o Dangai aprendeu com os seus vídeos como você edita o som e a cor, e faz igual com um clique: a abertura (Illuminati / Return By Death), a música de fundo, os whooshes, stingers, shutters e risers nos cortes, e a sua camada de cor. Tudo editável, e Ctrl+Z desfaz tudo de uma vez.',
      'Ele continua aprendendo: cada vídeo que você salva entra na conta. Passe o mouse no botão para ver o que ele aprendeu.',
      '"Montar tudo": solte a narração e o roteiro e clique uma vez. Ele escolhe uma cena para cada frase e já põe os sons e a cor do seu jeito. Você só revisa.',
      'Uma cena da Biblioteca que não abre (vídeo preto ou estragado) não derruba mais a montagem: ele usa a próxima sugestão no lugar e avisa qual foi.',
    ],
  },
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
