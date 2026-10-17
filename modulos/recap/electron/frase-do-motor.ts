import { nomeNatural } from '@shared/nomes'

/**
 * A FRASE DO MOTOR NA TELA.
 *
 * O pipeline (motor/app/pipeline.py e os providers) narra o que faz em frases
 * de log: "⚠️ AniList indisponivel (RuntimeError). Usando MyAnimeList (sem
 * agrupamento de temporadas)...", "31/78 shots", "Analisando mudancas de
 * cena... 41%". Na linha de andamento do assistente isso vira ruido: emoji fora
 * da paleta, nome de excecao, ingles e o % repetido (a tela ja mostra a fracao
 * ao lado).
 *
 * Aqui cada frase conhecida vira uma curta, em ASCII; a desconhecida passa
 * limpa (sem emoji, sem excecao, sem % no fim, "shots" -> "cenas"). O motor nao
 * muda: e copia do ancut-hub-engine, e mexer no texto dele so criaria diff.
 */

/** Interface em ASCII, como o resto do app: a frase do motor vem com acento. */
export function ascii(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[—–]/g, '-')
    .replace(/…/g, '...')
    .replace(/→/g, '->')
}

/**
 * O ERRO do motor que tem frase clara (o `failed`, nao o andamento). null = o
 * de sempre ("O motor parou com erro: ...").
 *
 * Os modelos (CLIP, YOLO de rosto, CCIP) baixam do HuggingFace na 1a analise.
 * Sem rede, o YOLO falha e o detector cai na reserva do upstream, o
 * cv2.CascadeClassifier, que o OpenCV 5 do lock nem tem: o erro saia como
 * "module 'cv2' has no attribute 'CascadeClassifier'".
 */
export function fraseDoErroDoMotor(mensagem: string, detalhe = ''): string | null {
  const tudo = `${mensagem}\n${detalhe}`
  const rede =
    /LocalEntryNotFound|huggingface\.co|hf_hub|ConnectTimeout|ConnectionError|NameResolution|getaddrinfo|Max retries|offline mode|Cannot reach|Network is unreachable/i
  if (/CascadeClassifier/.test(tudo) || (/hf_hub_download|huggingface/i.test(tudo) && rede.test(tudo))) {
    return rede.test(tudo)
      ? 'Sem internet para baixar os modelos do motor (~1 GB, so na 1a vez). Confira a conexao e tente de novo.'
      : 'O detector de rostos do motor nao carregou. Veja o log da analise.'
  }
  return null
}

/** Uma regra: o padrao (sobre o texto ja em ASCII) e a frase da tela. */
type Regra = [RegExp, (m: RegExpExecArray) => string]

const plural = (n: string, um: string, varios: string): string => `${n} ${Number(n) === 1 ? um : varios}`

const REGRAS: Regra[] = [
  // parse
  [/^Preparando ambiente de analise/i, () => 'Preparando o motor...'],
  // fetch_characters (pipeline e anime_provider)
  [/^Consultando (.+?)\.*$/i, (m) => `Consultando ${m[1]}...`],
  [/^AniList indisponivel/i, () => 'AniList fora do ar; usando o MyAnimeList'],
  [/^AniList sem resultado/i, () => 'Nada no AniList; tentando o MyAnimeList'],
  [/^Elenco veio da Kitsu \((\d+) personagens\)/i, (m) => `Elenco da Kitsu (${m[1]} personagens)`],
  [/^Buscando '(.+)' na AniList/i, (m) => `Procurando "${m[1]}" no AniList...`],
  [/^Resolvido: '.*' -> (.+)$/i, (m) => `Achado: ${m[1]}`],
  [/^Reusando banco cacheado \((\d+) personagens\)/i, (m) => `Elenco ja baixado (${m[1]} personagens)`],
  [/^Mapeando temporadas/i, () => 'Juntando as temporadas...'],
  [/^Modo MyAnimeList/i, () => 'Usando o MyAnimeList'],
  [/^Franquia: (\d+) temporadas/i, (m) => `${plural(m[1]!, 'temporada', 'temporadas')} na franquia`],
  [/^Baixando personagens de (\d+) temporada/i, (m) => `Baixando o elenco de ${plural(m[1]!, 'temporada', 'temporadas')}...`],
  [/^MyAnimeList OK: (\d+) personagens/i, (m) => `${m[1]} personagens no MyAnimeList`],
  [/^AniList: \+1 foto pra (\d+) personagens/i, (m) => `+1 foto para ${m[1]} personagens (AniList)`],
  [/^Kitsu: \+1 foto pra (\d+) personagens/i, (m) => `+1 foto para ${m[1]} personagens (Kitsu)`],
  [/^Completando (\d+) galerias/i, (m) => `Completando ${m[1]} galerias de fotos...`],
  [/^Coletando imagens \((\d+)\/(\d+)\)/i, (m) => `Fotos do elenco: ${m[1]} de ${m[2]}`],
  [/^(\d+) personagens$/i, (m) => `${m[1]} personagens no elenco`],
  // download_refs
  [/^Baixando imagens de personagens/i, () => 'Baixando as fotos do elenco...'],
  [/^Refs prontas/i, () => 'Fotos prontas'],
  // "Refs (13/81): Amaryllis = 1 (1 do catalogo)": a contagem por personagem e do log.
  [/^Refs \((\d+)\/(\d+)\)/i, (m) => `Fotos do elenco: ${m[1]} de ${m[2]}`],
  [/^\+(\d+) personagens de pastas locais/i, (m) => `+${m[1]} personagens de pastas locais`],
  // embed_refs
  [/^Embeddando: (.+)$/i, (m) => `Lendo as fotos: ${nomeNatural(m[1]!)}`],
  [/^(\d+) personagens com embedding/i, (m) => `${m[1]} personagens prontos`],
  [/^Baixando modelo CLIP/i, () => 'Baixando o modelo de rostos (~890 MB, so na 1a vez)...'],
  [/^Carregando (modelo CLIP|reconhecimento facial|detector de rosto)/i, () => 'Carregando o modelo de rostos...'],
  [/^IA pronta/i, () => 'Modelo pronto'],
  // detect_shots
  [/^Analisando mudancas de cena/i, () => 'Achando os cortes...'],
  [/^(\d+) shots \(cache\)/i, (m) => `${m[1]} cortes (ja achados antes)`],
  [/^(\d+) shots detectados/i, (m) => `${m[1]} cortes achados`],
  // cut_shots e analyze_shots
  [/^(\d+)\/(\d+) shots/i, (m) => `Cena ${m[1]} de ${m[2]}`],
  [/^(?:AI )?Shot (\d+)\/(\d+)/i, (m) => `Cena ${m[1]} de ${m[2]}`],
  // second_pass e ai_review
  [/^Comparando cenas sem dono/i, () => 'Segunda passada nas cenas sem ninguem...'],
  // organize
  [/^Concluido/i, () => 'Concluido'],
]

/**
 * A frase do evento `stage` do motor -> a frase da linha de andamento.
 * '' quando a frase nao diz nada ("—", o marcador de etapa pulada): a tela
 * mostra o nome da etapa no lugar.
 */
export function fraseDoMotor(mensagem: string): string {
  const limpa = ascii(mensagem)
    // Emoji e simbolos que sobram depois do ASCII (o "⚠️" dos avisos de fonte).
    .replace(/[^\x20-\x7e]/g, '')
    // Nome de excecao entre parenteses: "(RuntimeError)", "(HTTPError)".
    .replace(/\s*\([A-Za-z]*(?:Error|Exception|Timeout)[A-Za-z]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^[-.\s]*$/.test(limpa)) return ''
  for (const [padrao, frase] of REGRAS) {
    const m = padrao.exec(limpa)
    if (m) return frase(m)
  }
  return limpa
    .replace(/\s*\d{1,3}%$/, '')
    .replace(/\bshots\b/gi, 'cenas')
    .replace(/\bshot\b/gi, 'cena')
    .trim()
}
