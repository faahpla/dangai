import { slugDoEpisodio, type Cue, type EpisodeIndex } from '../../shared/episodio'
import {
  cueExcluida,
  cuesDoEvento,
  EVENTOS_MAX,
  EVENTOS_MIN,
  faixaDePalavras,
  formatarTempo,
  frasesPorPapel,
  ORDEM_DO_SHORT,
  PAPEIS,
  palavrasDoRoteiro,
  type AlvoSec,
  type Evento,
  type PapelDaSecao,
  type Roteiro,
} from '../../shared/roteiro'
import { acertarNome, nomesDoElenco, type Elenco } from './nomes'

/**
 * Os PROMPTS do passo 2, portados do AniRecap do Levi
 * (fusao/anirecap/core/script.py: SUMMARY_PROMPT v7 e SHORT_SCRIPT_PROMPT v5).
 *
 * O texto daqueles prompts e o ativo: cada regra anti-alucinacao saiu de um
 * erro real (vitima trocada, verbo escalado, pronome ambiguo, falante chutado).
 * O que mudou:
 * - a saida e ESTRUTURADA (gerarJson + zod): eventos presos a trechos de
 *   falas, roteiro em secoes com papel e frases com evento, momento, intencao
 *   visual e citacao. A estrutura gancho/contexto/.../fechamento, que no
 *   AniRecap ficava "so na cabeca do LLM", agora e o formato;
 * - SAIRAM os exemplos de serie (o Witch Hat Atelier inteiro: Coco, Agathe,
 *   Carn, "lagarta-pincel"...). Exemplo de serie vaza para o roteiro de outra
 *   serie; ficaram as regras e moldes genericos;
 * - o resumo em texto corrido virou EVENTOS com cueIds: o tempo sai das cues
 *   (montarEventos), nunca do LLM.
 *
 * Regras novas de 13/10/2026, cada uma de um erro dos roteiros julgados
 * contra as falas (S4-37 e S04E24): o pronome que passa de uma frase para a
 * outra; a hipotese de um personagem que vira plano do grupo; o "X from NASA"
 * traduzido como "X coopera com a NASA"; nome que nao esta nas falas ("Reino
 * da Ciencia"); o salto "A Few Years Later" perdido (placas iam fora); falas
 * salteadas (o evento agora e um TRECHO); intencao visual de logo, flashback e
 * duas opcoes; tamanho de 90 s que saia curto (agora o pedido e em FRASES).
 *
 * O texto vai COM acento: e conteudo para o modelo, e a narracao que volta
 * tem que vir em portugues do Brasil com acento (vira legenda e voz).
 * Mudou uma regra? O cache se ajusta sozinho: a chave e o prompt inteiro.
 */

// ------------------------------------------------------------------ comum

/** "Dr STONE S04E24": o titulo do rascunho e o cabecalho dos prompts. */
export function tituloDoEpisodio(indice: Pick<EpisodeIndex, 'anime' | 'temporada' | 'episodio' | 'kind'>): string {
  return `${indice.anime} ${slugDoEpisodio(indice.temporada, indice.episodio, indice.kind)}`
}

/** `[c0123 12:03] (Senku) texto` -- sem falante, sem parenteses. */
export function linhaDaFala(cue: Pick<Cue, 'id' | 'start' | 'texto' | 'falante'>, comTempo = true): string {
  const falante = cue.falante?.trim() ? `(${cue.falante.trim()}) ` : ''
  const texto = cue.texto.replace(/\s+/g, ' ').trim()
  return comTempo ? `[${cue.id} ${formatarTempo(cue.start)}] ${falante}${texto}` : `[${cue.id}] ${falante}${texto}`
}

function linhaDoElenco(elenco: Elenco): string {
  const nomes = nomesDoElenco(elenco)
  return nomes.length > 0 ? nomes.join(', ') : '(a legenda nao traz nomes; use os nomes que aparecem nas falas)'
}

// ------------------------------------------------------------------ placas

/**
 * Placa que nao conta a historia: creditos de traducao, aviso de "obra de
 * ficcao", "proximo episodio", agradecimento do autor. Fica fora do prompt.
 */
const PLACA_DE_CREDITO =
  /\b(translat\w*|timing|typeset\w*|editing|edited by|quality check|encod\w*|subtitle\w*|subbed|original work|work of fiction|do not attempt|dangerous and illegal|thank you for|next episode|next time|preview|directed by|produced by)\b/i

/** Placa que marca salto no tempo ("A Few Years Later"). */
const PLACA_DE_TEMPO =
  /\b(later|after|ago|earlier|before|years?|months?|weeks?|days?|hours?|time skip|depois|antes|anos?|meses|semanas?|dias?|horas?)\b/i

/** Quantos itens de uma mesma placa (o quadro com 28 nomes de pecas) entram no prompt. */
const ITENS_POR_PLACA = 6

/** Uma placa (ou as varias do mesmo segundo, juntas) que serve de contexto. */
export interface PlacaDeContexto {
  start: number
  textos: string[]
  /** Salto no tempo: o roteirista tem que dizer ("anos depois"). */
  tempo: boolean
}

/**
 * As PLACAS que servem de contexto: texto de tela fora de OP/ED e fora dos
 * creditos, as do mesmo segundo juntas. Antes elas sumiam do prompt inteiras,
 * e com elas o "A Few Years Later": o roteiro tratava acontecimentos de anos
 * depois como simultaneos ("enquanto isso"). Nao sao citaveis: vao sem id.
 */
export function placasDeContexto(indice: Pick<EpisodeIndex, 'cues' | 'exclusoes'>): PlacaDeContexto[] {
  const placas: PlacaDeContexto[] = []
  for (const cue of indice.cues) {
    if (cue.tipo !== 'placa' || cueExcluida(cue, indice.exclusoes)) continue
    const texto = cue.texto.replace(/\s+/g, ' ').trim()
    if (!texto || PLACA_DE_CREDITO.test(texto)) continue
    const ultima = placas[placas.length - 1]
    if (ultima && Math.abs(cue.start - ultima.start) < 1) {
      if (!ultima.textos.includes(texto)) ultima.textos.push(texto)
      ultima.tempo ||= PLACA_DE_TEMPO.test(texto)
    } else placas.push({ start: cue.start, textos: [texto], tempo: PLACA_DE_TEMPO.test(texto) })
  }
  return placas
}

function textoDaPlaca(p: PlacaDeContexto): string {
  const mostrados = p.textos.slice(0, ITENS_POR_PLACA).join(' / ')
  return p.textos.length > ITENS_POR_PLACA ? `${mostrados} / ... (${p.textos.length} itens)` : mostrados
}

// ------------------------------------------------------------------ eventos

export const SISTEMA_EVENTOS = `Você é um analista de animes. Você recebe as falas da legenda de um episódio, numeradas, e lista os ACONTECIMENTOS do episódio em ordem, cada um preso ao TRECHO de falas que o prova.

OBJETIVO:
Entender completamente o que aconteceu — personagens, relações, acontecimentos em ordem, reviravoltas, revelações, romance, comédia, tensão, momentos emocionais — para depois um roteirista escrever um short a partir da sua lista. Cada acontecimento aponta o trecho de onde ele sai: é assim que o editor acha a cena no vídeo.

O QUE DEVOLVER:
- eventos: de ${EVENTOS_MIN} a ${EVENTOS_MAX} acontecimentos, em ordem cronológica, cobrindo o episódio do começo ao fim, sem pular trecho que tenha trama.
- cueIds: a PRIMEIRA e a ÚLTIMA fala do trecho que prova o acontecimento, copiadas da lista (ex.: ["c0123", "c0131"]); trecho de uma fala só leva só aquele id. O trecho é contínuo — a mesma cena ou conversa, de poucas falas até cerca de um minuto — e o editor pega TODAS as falas entre a primeira e a última. Termine onde a frase termina: se a legenda quebrou uma frase em duas linhas, a última fala do trecho é a que fecha a frase. Nunca invente id; nunca use id que não está na lista.
- resumo: 1 ou 2 frases neutras em português do Brasil, com acentos, dizendo o que acontece. Linguagem clara e descritiva — NÃO estilo viral, NÃO estilo shorts. Preserve os detalhes que permitam recontar a história com graça depois (o que está em jogo, quem quer o quê, o que muda).
- personagens: quem participa do acontecimento, com o nome escrito como no ELENCO.
- peso: de 1 a 5. 5 = o momento que segura o episódio (revelação pesada, reviravolta, morte, traição, sacrifício, clímax); 4 = virada importante; 3 = passo da trama; 2 = contexto; 1 = detalhe. Poucos eventos com peso 5 (de 1 a 3).
- Um acontecimento por passo da trama: não junte o episódio inteiro num evento só, nem quebre uma conversa em dez eventos.

PLACAS:
- Linhas "[placa 11:31] texto" são texto escrito na tela (letreiro, cartela, nome de lugar), não fala. São contexto e NÃO têm id: nunca entram em cueIds.
- Placa de tempo ("A Few Years Later", "Two Weeks Earlier") separa os acontecimentos: o primeiro acontecimento depois dela diz o salto no resumo ("Anos depois, ..."). Nunca trate o que vem antes e o que vem depois como simultâneo.

FIDELIDADE FACTUAL (CRÍTICO):
- Para CADA afirmação do resumo, as falas do trecho têm que sustentá-la. Na dúvida, OMITA.
- NÃO invente descrições físicas de ações que não estão claramente nas falas. A legenda é só o que se ouve: o que só aparece na imagem você não viu.
- Se uma habilidade é abstrata ou metafórica (som, magia, telepatia, tecnologia), preserve a abstração. Não force interpretação física literal.
- NÃO ESCALE AÇÕES — os verbos das falas são preservados, não amplificados:
  "sugere" ≠ "convence" ou "manipula"; "aceita" ≠ "cede" ou "é forçado"; "menciona" ≠ "revela" (a menos que seja revelação de fato); "observa" ≠ "descobre"; "comenta que viu antes" ≠ "examina de novo"; "pedir" ou "perguntar" ≠ "enfrentar" ou "confrontar"; "estudar" ≠ "entender".
- HIPÓTESE ≠ FATO: "maybe", "might", "could", "would", "if", "I think", "what if" nas falas = o personagem COGITA, SUGERE ou PROPÕE. No resumo: "X cogita que...", "X sugere que dá para...", "X propõe...". Plano, proposta ou medo continua sendo isso: nunca vira decisão nem fato consumado.
- IDEIA TEM DONO: o que um personagem disse é dele. Não junte as ideias de duas pessoas num fato só e não dê ao grupo ("eles querem") o que um só propôs. O objetivo de um personagem, ou de um grupo, é dele: não troque de quem é o problema.
- NÃO LIGUE FATOS POR CONTA PRÓPRIA: "como X, então Y", "por isso", "e assim" só quando a fala liga os dois.
- NÃO INVENTE EVENTOS NÃO VISTOS: se alguém conta o que fez ou viu antes (flashback verbal), o acontecimento é "conta que fez", não "faz de novo agora". Distinga a ação atual da referência ao passado.
- SÓ NOMES QUE ESTÃO NAS FALAS: não use nome, grupo, título, lugar ou termo que não aparece nas falas listadas nem no ELENCO — nada do que você sabe da obra. Na dúvida, descreva ("o grupo", "os cientistas").
- LEIA O INGLÊS COM CUIDADO: "X from NASA" é X, que é da NASA ("you get Dr. X from NASA's full cooperation" = o Dr. X, da NASA, vai cooperar por inteiro), e não "X coopera com a NASA".
- DESAMBIGUE PRONOMES: com mais de um personagem do mesmo gênero na frase, repita o nome ("a irmã do X", nunca "a irmã dela" quando "dela" pode ser outra pessoa).
- Relação entre personagens pouco clara nas falas: OMITA a relação em vez de inventar (não diga "irmã" sem ter certeza).

QUEM FALA E QUEM AGE:
- Linhas com (NOME) antes do texto: esse é o falante, vindo direto do campo Name da legenda. É uma dica confiável: atribua a fala a ele. Linhas sem (NOME) entre linhas com nome: mantenha o último falante conhecido como referência até aparecer outro nome.
- Legenda sem nenhum (NOME): ela não diz quem fala. Não chute o falante pelo personagem em foco nem pelo que você sabe da obra; atribua só quando for inequívoco (alguém é chamado pelo nome e responde, alguém se apresenta) ou escreva sem atribuir ("alguém avisa que...", "o grupo descobre que...").
- Quem FALA não é necessariamente quem AGE. Ação física (chute, soco, queda, abraço, beijo, empurrão) sem agente claro: use voz passiva ("X leva um soco"), sujeito genérico ("alguém derruba X na confusão") ou omita o detalhe. Nunca escolha o personagem em foco da cena anterior como agente.

NOMES:
- Escreva os nomes exatamente como no ELENCO (é a grafia da legenda): nada de grafia alternativa, apelido trocado ou nome completo quando o elenco usa o primeiro nome.
- Tire os honoríficos japoneses (-kun, -chan, -san, -sama, -senpai, -sensei, -dono). Exceção: quando o honorífico é o próprio nome ou apelido fixo do personagem.

TERMOS DO MUNDO (criaturas, itens, técnicas, máquinas, organizações):
- Termo descritivo em inglês (palavra composta com sentido) vira português natural de falante brasileiro: "Fire Seal" → "selo de fogo", "Sky Ship" → "navio voador".
- Nome próprio cunhado pela obra, sem tradução clara, fica como está.
- A legenda pode estar em inglês: o resumo sai sempre em português do Brasil.`

export interface EntradaDosEventos {
  indice: Pick<EpisodeIndex, 'anime' | 'temporada' | 'episodio' | 'kind' | 'cues' | 'exclusoes'>
  /** So as cuesElegiveis (fala, fora de OP/ED), em ordem. */
  falas: readonly Cue[]
  elenco: Elenco
  /** Recado de uma nova tentativa ("sua resposta anterior nao citou fala valida"). */
  aviso?: string | null
}

export function promptDeEventos(e: EntradaDosEventos): string {
  const linhas = [
    `EPISÓDIO: ${tituloDoEpisodio(e.indice)}`,
    `ELENCO (grafia da legenda, do mais presente ao menos): ${linhaDoElenco(e.elenco)}`,
  ]
  if (!e.elenco.comFalante) {
    linhas.push(
      'ATENÇÃO: a legenda deste episódio NÃO diz quem fala (nenhuma linha tem (NOME)). Então:',
      '- atribua uma fala ou decisão a alguém SÓ quando as próprias falas deixam isso inequívoco (alguém é chamado pelo nome e responde, alguém diz o próprio nome). O protagonista NÃO é o falante padrão;',
      '- nos outros casos, escreva sem dono: "o grupo decide...", "alguém lembra que...", "surge a ideia de...", "a conclusão é que...";',
      '- em personagens, liste só quem é nomeado nas falas citadas ou de quem elas claramente falam.',
    )
  }
  // As placas entram no meio das falas, no tempo delas, sem id (nao sao citaveis).
  const placas = placasDeContexto(e.indice)
  const corpo: string[] = []
  let p = 0
  for (const cue of e.falas) {
    while (p < placas.length && placas[p]!.start <= cue.start) corpo.push(`[placa ${formatarTempo(placas[p]!.start)}] ${textoDaPlaca(placas[p++]!)}`)
    corpo.push(linhaDaFala(cue))
  }
  while (p < placas.length) corpo.push(`[placa ${formatarTempo(placas[p]!.start)}] ${textoDaPlaca(placas[p++]!)}`)
  linhas.push(
    '',
    `FALAS (${e.falas.length}; abertura, encerramento e letras de música já foram tiradas; [placa] = texto escrito na tela, só contexto):`,
    ...corpo,
  )
  if (e.aviso) linhas.push('', `AVISO SOBRE A SUA RESPOSTA ANTERIOR: ${e.aviso}`)
  return linhas.join('\n')
}

// ------------------------------------------------------------------ roteiro

/*
 * O ROTEIRISTA em blocos (18/10, pedidos A3 e A4 do Levi). Quem manda em que:
 * - REGRAS FIXAS, com qualquer estilo: fidelidade (REGRA ZERO, HIPOTESE !=
 *   FATO, IDEIA TEM DONO, palavras vigiadas), nomes e pronomes, o formato de
 *   cada frase, titulo e thumb e a saida. So o que nao pode quebrar;
 * - ESTILO DO EDITOR (shared/estilo.ts, blocoDoEstilo): com ele, o TOM e a
 *   ESTRUTURA sao os DELE. Vai logo depois do papel, antes de tudo, e o mapa
 *   das secoes diz como a estrutura dele (HOOK, BUILD, MOMENTO CHAVE,
 *   FECHAMENTO) cai nos papeis do app. No lote 1 o estilo ia no fim e as
 *   regras do app venciam (o "Mano" dele era banido aqui);
 * - ESTRUTURA DE SHORT e TOM PADRAO: o jeito do app sem estilo. Saiu do
 *   roteiro do Magic Repo Man E01, que virou "lista de acontecimentos" (13
 *   frases iguais no meio, a virada aos ~40 s, um bau sem consequencia): agora
 *   e gancho -> injustica com emocao -> virada antes da metade -> resultado ->
 *   gancho final, com o exemplo ruim x bom (nomes mascarados). Com estilo, so
 *   ficam as regras de tom que nao brigam com o dele, e DEPOIS dele.
 */

const PAPEL_DO_ROTEIRISTA = `Você é um roteirista de shorts virais de anime. Você recebe os ACONTECIMENTOS de um episódio (cada um com as falas da legenda que o provam) e escreve a NARRAÇÃO de um short em português do Brasil FALADO, dividida em SEÇÕES com papel e em FRASES.`

/** O processo e a estrutura do app: so sem estilo (com estilo, a estrutura e a dele). */
const ESTRUTURA_DE_SHORT = `PROCESSO OBRIGATÓRIO — siga NA ORDEM, em silêncio, antes de escrever uma palavra:
1. Leia todos os acontecimentos. Ache O ÂNGULO: o centro emocional ou absurdo do episódio (a injustiça, a revelação, o absurdo). O short conta UMA história com esse ângulo, nunca um resumo de tudo.
2. Escolha O GANCHO por esta HIERARQUIA ESTRITA — pare no primeiro nível que existir no episódio, não desça se há um maior:
   NÍVEL 1 — ACUSAÇÃO ou REVELAÇÃO pesada sobre um personagem (um segredo do passado, quem ele é de verdade, o que ele fez).
   NÍVEL 2 — TWIST de identidade, lealdade ou motivação (o aliado era o traidor, o plano era outro o tempo todo).
   NÍVEL 3 — MORTE, TRAIÇÃO ou SACRIFÍCIO de personagem relevante.
   NÍVEL 4 — ABSURDO cômico ou situacional impossível de ignorar.
   NÍVEL 5 — EVENTO de impacto visual (algo gigante aparece, uma explosão, alguém some). Só se os níveis 1 a 4 não existem: impacto visual qualquer episódio tem; o que é ÚNICO deste episódio prende mais.
   NÍVEL 6 — evento comum (alguém viajou, treinou, aprendeu, conversou). NUNCA, se existe algo de 1 a 5. Isso é preguiça.
3. AUTO-CHECK interno: o gancho é do nível mais alto disponível? Se é 5 ou 6 e existe algo de 1 a 4, escolha de novo. Nada desse raciocínio (nível, "gancho escolhido", explicação) aparece na saída.
4. Monte a ESTRUTURA DE SHORT, nesta ordem de seções:
   - gancho (1 ou 2 frases): o momento mais forte, sem contexto. Cria uma pergunta na cabeça de quem assiste.
   - contexto (3 ou 4 frases): a INJUSTIÇA ou o que está em jogo, com emoção: por que a gente torce, sofre ou ri. Não é o currículo do personagem.
   - virada: a reviravolta, ANTES DA METADE do roteiro. Se o episódio só vira no fim, comece a contar mais perto dela e corte o caminho até lá.
   - desenvolvimento (1 a 3 seções): o que a virada causa, a tensão subindo, com micro-ganchos no meio ("Só que aí veio o pior.").
   - climax: o RESULTADO, que entrega o que o gancho prometeu sem repetir as palavras dele.
   - fechamento (1 ou 2 frases): o gancho final: consequência, pergunta ou "e agora?".
   A primeira seção é sempre o gancho e a última é sempre o fechamento. Se o episódio não tiver uma virada clara, não invente uma: as frases dela vão para o desenvolvimento.
5. CORTE IMPIEDOSO: fica só o que tem CONSEQUÊNCIA depois ou gera curiosidade, tensão, humor, choque ou romance. Detalhe que aparece e some (um objeto, um lugar, um personagem que não pesa no desfecho) sai. Não precisa usar todos os acontecimentos.`

/** Uma regra do tom padrao. `brigaComEstilo`: sai quando ha estilo (a regra dele vale). */
interface RegraDoTom {
  texto: string
  brigaComEstilo: boolean
}

/** O TOM PADRAO do app: inteiro sem estilo; com estilo, so as regras que nao brigam com ele. */
export const TOM_PADRAO: readonly RegraDoTom[] = [
  {
    texto: 'Escreva como quem conta o episódio pra um amigo, não como quem lê um resumo. NÃO copie o resumo do acontecimento: reconte com as suas palavras.',
    brigaComEstilo: false,
  },
  { texto: 'Português FALADO do Brasil: "pra" (nunca "para"), "tá", e artigo antes do nome ("o X", "a Y").', brigaComEstilo: false },
  {
    texto: 'Frases CURTAS: de 5 a 12 palavras, média de umas 9, e VARIE o tamanho: uma curtinha de impacto ("Ele não tinha chance.") no meio das outras. Frase com vírgula atrás de vírgula vira duas.',
    brigaComEstilo: true,
  },
  {
    texto: 'PROIBIDO "LISTA DE ACONTECIMENTOS": nunca 5 ou mais frases seguidas no mesmo molde (sujeito + verbo + fato, do mesmo tamanho, sem virada nem emoção). Costure com conectivos de virada ("mas", "só que", "até que", "e aí"), uma pergunta ou uma frase curta de impacto.',
    brigaComEstilo: false,
  },
  {
    texto: 'Conectivos de fala ao longo do roteiro (uns 5 a 8 no total), sem repetir o mesmo toda hora: "mas", "só que", "até que", "e aí", "aí", "então", "e o pior", "olha só". "Mano" ou "cara" de vocativo: no máximo UM no roteiro inteiro.',
    brigaComEstilo: true,
  },
  { texto: 'Vocabulário otaku moderno quando couber, SEM FORÇAR: "plot twist", "tá gamada", "otaku raiz".', brigaComEstilo: true },
  {
    texto: 'NÃO use expressões regionais obscuras ou datadas ("entrega o ouro", "bagunçar o coreto", "largou a braba", "tankou"). Qualquer gíria que precise de explicação está PROIBIDA.',
    brigaComEstilo: false,
  },
  { texto: 'Nada de pedido ao espectador ("comenta", "curte", "se inscreve", "segue"): o fechamento é sobre o episódio.', brigaComEstilo: true },
  { texto: 'Nada de aspas de ênfase nem CAIXA ALTA de ênfase.', brigaComEstilo: true },
  {
    texto: 'Nome na PRIMEIRA menção de cada seção; depois, onde não houver dúvida, pronome ou referência curta ("o cara", "o velho") para não soar robótico.',
    brigaComEstilo: false,
  },
]

const GANCHO_PADRAO = `GANCHO — ATENÇÃO:
- BANIDO abrir com reação ou apresentação: "Chat, acabei de assistir...", "Eu vi esse ep...", "Gente, deixa eu contar...", "Nesse episódio...", "Hoje vamos ver...", e qualquer variação.
- BANIDO abrir com "Mano" ou "Cara": a primeira palavra já é do fato.
- A primeira frase já está DENTRO do conflito, do absurdo ou do twist: uma imagem chocante, uma revelação direta, uma pergunta provocativa.
- Moldes (adapte ao episódio, nunca copie palavra por palavra): "Esse cara acabou de [fato chocante do episódio]." / "Imagina [situação absurda do episódio]." / "Ela descobriu que [revelação do episódio]." / "[Personagem] fez [ação] e ninguém esperava o que veio depois."`

/**
 * O EXEMPLO RUIM x BOM do A3: o meio chapado do roteiro do Magic Repo Man E01
 * (v1 do rascunho do Levi, 18/10) e a mesma historia como short, com os nomes
 * mascarados como no estilo e o termo da serie trocado ("mana" -> energia).
 */
export const EXEMPLO_RUIM_E_BOM = `EXEMPLO DE FORMA (de OUTRO episódio, com os nomes trocados por [PERSONAGEM n]). Mostra só o JEITO: nunca copie dele fatos, termos nem frases.
RUIM — lista de acontecimentos: todas as frases no mesmo molde, a virada só depois da metade e um baú que aparece e nunca mais volta:
"A [PERSONAGEM 3] entrou pro grupo e eles venciam monstros fortes. O [PERSONAGEM 1] bancava golpes pesados com a energia dele. Dois anos depois, os outros três compraram armaduras novas. Eles até zombavam das roupas velhas do [PERSONAGEM 1]. Mesmo assim, ele quase esgotou a energia contra o chefão. No fundo da sala tinha um baú valioso. Na estalagem, o [PERSONAGEM 2] anunciou a expulsão do [PERSONAGEM 1]."
BOM — a mesma história como short: gancho, a injustiça com emoção, a virada cedo, o resultado e o gancho final:
"O [PERSONAGEM 1] carregou o time nas costas por anos. E foi chutado no dia em que acharam um substituto. A energia dele bancava cada golpe do grupo. Em troca? Piada com as roupas velhas dele. Até que três braceletes fizeram o trabalho dele de graça. Pronto: ele virou peso morto. Quando implorou pra ficar, ainda apanhou. Só que, largado no chão, ele gritou pra ter tudo de volta. E aí um raio caiu bem em cima dele. O poder dele virou infinito. E agora quem tá devendo é o time inteiro."`

/** Com estilo: como a estrutura dele cai nos papeis das secoes do app. */
export const MAPA_DAS_SECOES = `AS SEÇÕES DO APP RECEBEM A ESTRUTURA DELE. Siga a estrutura do estilo dele e dê a cada bloco o papel que corresponde:
- HOOK → gancho (a primeira seção, sempre);
- CONTEXTO → contexto;
- BUILD (BUILD 1, BUILD 2...), CONFLITO, DESENVOLVIMENTO → desenvolvimento (um bloco por seção);
- PLOT TWIST, REVELAÇÃO, VIRADA → virada;
- MOMENTO CHAVE, CLÍMAX → climax;
- FECHAMENTO, CTA → fechamento (a última seção, sempre).
O "formato de saída" dele (cabeçalhos, emoji, negrito, tempos como "0–3s") vira estas seções: nada disso entra no texto das frases.`

const REGRA_ZERO = `REGRA ZERO — FIDELIDADE FACTUAL (CRÍTICO, não negociável):
- Tudo o que você afirmar TEM que estar nos acontecimentos ou nas falas listadas. NÃO EXAGERE, NÃO TROQUE VÍTIMAS, NÃO INVENTE AÇÕES, MOTIVOS NEM RELAÇÕES.
  "X se machucou" ≠ "X machucou o amigo". "X gritou com Y" ≠ "X bateu em Y". "X viu o monstro" ≠ "o monstro atacou X". "sugere" ≠ "convence". "menciona" ≠ "revela". "pedir" ≠ "enfrentar". "estudar" ≠ "entender".
- HIPÓTESE TEM DONO E CONTINUA HIPÓTESE: acontecimento com "cogita", "sugere", "propõe" ou "acha" vira frase com "o X acha que dá pra...", "a ideia do X é...", "talvez". Nunca "eles querem" para a ideia de um só, nunca plano decidido, e nunca junte as ideias de duas pessoas numa frase.
- O objetivo de um personagem é dele: não troque de quem é o problema (o medo de um grupo não vira a missão do outro).
- Não junte dois acontecimentos num fato novo, nem ligue os dois com causa ("por isso", "então") que eles não dizem.
- SALTO DE TEMPO: entre dois acontecimentos separados por "-- SALTO DE TEMPO --", a narração diz o salto ("anos depois..."). Nunca "enquanto isso" para o que veio depois.
- PALAVRAS VIGIADAS: "em choque", "chorou", "surtou", "secreto", "escondido", "proibido", "convenceu", "traidor", "manipulou" — só se o acontecimento citado diz exatamente isso. Também não invente reação nem emoção que os acontecimentos não dizem.
- Acontecimento sem dono ("o grupo decide", "alguém sugere") continua sem dono: não dê a ação ao protagonista.
- Pode dramatizar o TOM ("e o pior", "caraca"), NUNCA os FATOS. Na dúvida, omita o detalhe.
- Não diga o que só a imagem mostraria (cor, roupa, cenário) se os acontecimentos não dizem.`

export const SEGURANCA_DA_PLATAFORMA = `SEGURANÇA DA PLATAFORMA (o YouTube e o TikTok derrubam ou desmonetizam o short por isso, mesmo sendo anime):
- NUNCA descreva violência contra criança: nada de "criança", "bebê", "menor", "garotinha" ou "menininha" junto de bater, espancar, socar, chutar, machucar, matar, torturar ou abusar. Luta com personagem criança se conta pelo nome e pela luta em si, sem a criança como alvo da agressão. Ex.: "Ele achava que ia espancar uma criança indefesa" → "Ele achava que a luta ia ser fácil".
- NUNCA pedido de morte, suicídio ou automutilação ("implorando pra ser morto", "queria se matar"): diga o resultado sem isso ("ele ficou no chão, derrotado").
- Nada de gore explícito (sangue jorrando, partes do corpo), nada sexual com personagem menor de idade, nada de droga como coisa boa.
- Isso vale mesmo quando o episódio mostra: reescreva o jeito de dizer, sem mudar o que aconteceu.`

const NOMES_E_PRONOMES = `NOMES E PRONOMES:
- Escreva os nomes exatamente como no ELENCO (é a grafia da legenda). Sem honoríficos japoneses (-kun, -chan, -san, -sama, -senpai, -sensei), a menos que seja o próprio apelido fixo do personagem.
- Cada item é UMA frase, e o espectador ouve uma de cada vez: "ele", "ela", "o cara", "a garota" só retomam o SUJEITO da frase ANTERIOR. Se a frase anterior cita dois personagens, ou se o sujeito muda, repita o nome. Ambiguidade é pior que repetição.
- Ação sem dono nos acontecimentos nunca vira "ele": diga quem fez como os acontecimentos dizem ("o grupo", "cientistas do mundo todo") ou omita.`

const FORMATO_DA_FRASE = `FORMATO DE CADA FRASE:
- texto: UMA frase falada, com UM ponto final (ou exclamação, ou interrogação) só no fim — no editor, o ponto final encerra a frase e a cena. Duas frases = dois itens. Reticências no meio NÃO fecham a frase: continue em minúscula ("Mano… esse cara"). Nada de reticências partindo uma ideia em dois itens ("...e aí ele foi"). Português do Brasil com acentos.
- Nada de markdown, hashtag, asterisco, emoji, cabeçalho ou rótulo de seção ("HOOK", "BUILD") dentro do texto: ele vai direto para a voz e para a legenda.
- eventoIds: os ids dos acontecimentos de onde vem a informação da frase (ex.: ["e07"]). O PRIMEIRO é o que a tela mostra enquanto a frase é dita. Toda frase com fato da história cita pelo menos um. Lista vazia só para frase de ligação ou pergunta ao espectador. Acontecimento marcado "(sem cena no episódio)" não pode ser a única fonte de uma frase.
- cueDoMomento: o id da fala ("c0123") do INSTANTE que a tela deve mostrar enquanto a frase é dita, escolhido entre as falas do primeiro acontecimento citado (ou dos outros citados). Frases seguidas sobre o mesmo acontecimento escolhem falas diferentes, na ordem. null só em frase sem acontecimento.
- intencaoVisual: o que aparece na tela, a partir do acontecimento citado e do "em cena" dele — personagem que está em cena + ação ou expressão ("close no X assustado", "Y e Z discutindo"), ou objeto que as falas citam. UMA opção só (nada de "X ou Y"). Nada de logo, mapa, gráfico, diagrama, flashback, céu, planeta inteiro ou imagem genérica: a cena tem que existir no episódio.
- textoDeTela: 1 ou 2 palavras DE CONTEÚDO queimadas na tela (artigo e preposição não contam: "MÁQUINA DO TEMPO" conta 2), SÓ nas frases de maior impacto (no máximo 4 no roteiro todo, quase sempre no gancho, na virada e no clímax). Um rótulo, nunca a frase falada. null nas outras.
- citacaoCueId: só quando o texto da frase TRAZ, entre aspas, a fala de um personagem traduzida (ex.: E ele solta: "eu não vou desistir!"), o id dessa fala ("c0123"), que tem que ser de um dos acontecimentos citados; null nas outras. Use pouco (0 a 3 no roteiro todo).
- tags: de 2 a 5 etiquetas do Danbooru, em INGLÊS e minúsculas, do que a tela mostra: ação, objeto, lugar, hora, emoção ("crying", "punching", "sword", "night", "explosion", "hospital bed"). Nada de nome de personagem, cor de cabelo ou "1girl".
- visualEn: a intencaoVisual em INGLÊS, curta e concreta, como legenda de imagem ("a small girl lying weak in a hospital bed", "two men shaking hands on a ship deck"). Sem nome de personagem: descreva quem é ("a white-haired boy").`

export const TITULO_E_THUMB = `TÍTULO E THUMB (junto do roteiro):
- titulos: 3 títulos do short, curtos (até uns 60 caracteres), chamativos e com curiosidade, sobre o ângulo do roteiro, com as palavras principais em maiúscula — o jeito de "Ele Despertou o Maior Poder da História". Nada de título genérico ("Resumo do episódio 5", "Anime muito bom"). Fiel: o título não promete o que não aconteceu.
- textosDeThumb: 3 textos de thumbnail, de 2 a 5 palavras, em CAIXA ALTA, fortes e fáceis de ler — o jeito de "ELE DESPERTOU" ou "DUAS GAROTAS?!". Não precisam explicar: precisam gerar clique.
- Nomes, se usar, como no ELENCO. Sem emoji nem hashtag.`

const REVISAO_FINAL = `REVISÃO FINAL (em silêncio, antes de devolver): releia frase por frase contra os acontecimentos que ela cita. Tudo o que a frase afirma está lá? Cada "ele"/"ela" tem dono claro? Conte as frases e ajuste ao tamanho pedido.`

/** O tom padrao: inteiro (com o gancho e o exemplo) sem estilo; so o que nao briga, com estilo. */
function tomPadrao(comEstilo: boolean): string {
  if (comEstilo) {
    const regras = TOM_PADRAO.filter((r) => !r.brigaComEstilo).map((r) => `- ${r.texto}`)
    return ['TOM PADRÃO DO APP — só onde o estilo dele não disser nada (o estilo dele vem antes e manda):', ...regras].join('\n')
  }
  return [['VOZ FALADA — CRÍTICO:', ...TOM_PADRAO.map((r) => `- ${r.texto}`)].join('\n'), GANCHO_PADRAO, EXEMPLO_RUIM_E_BOM].join('\n\n')
}

/** As regras que valem com qualquer estilo. `comTitulos`: o roteiro inteiro (o "Refazer esta parte" nao tem titulo). */
function regrasFixas(comTitulos: boolean): string {
  return [
    'REGRAS FIXAS — valem com qualquer estilo. Só cuidam do que não pode quebrar (fidelidade, nomes e formato); nada aqui é sobre tom.',
    REGRA_ZERO,
    SEGURANCA_DA_PLATAFORMA,
    NOMES_E_PRONOMES,
    FORMATO_DA_FRASE,
    ...(comTitulos ? [TITULO_E_THUMB] : []),
    REVISAO_FINAL,
  ].join('\n\n')
}

/** O comeco do sistema: o papel e, com estilo, o estilo DELE (antes de tudo) e o mapa das secoes. */
function comecoDoSistema(estilo: string | null): string[] {
  return estilo ? [PAPEL_DO_ROTEIRISTA, estilo, MAPA_DAS_SECOES, tomPadrao(true)] : [PAPEL_DO_ROTEIRISTA, ESTRUTURA_DE_SHORT, tomPadrao(false)]
}

/**
 * O sistema do roteiro inteiro. `estilo` = o bloco do "Meu estilo"
 * (blocoDoEstilo); null = o jeito do app. Mudou o estilo, muda o sistema --
 * e a chave do cache, que e o pedido inteiro.
 */
export function sistemaDoRoteiro(estilo: string | null = null): string {
  return [
    ...comecoDoSistema(estilo),
    regrasFixas(true),
    'SAÍDA: o roteiro inteiro em seções, na ordem em que será narrado, mais os títulos e os textos de thumb. A primeira palavra da primeira frase já é a primeira palavra do gancho. Nenhum cabeçalho, rótulo, preâmbulo ou explicação dentro dos textos.',
  ].join('\n\n')
}

/** O sistema do "Refazer esta parte" (com o mesmo estilo). */
export function sistemaDaSecao(estilo: string | null = null): string {
  return [
    ...comecoDoSistema(estilo),
    regrasFixas(false),
    'TAREFA DESTA VEZ: reescrever UMA PARTE (uma seção) de um roteiro que já existe. As outras seções continuam como estão. A parte nova tem que cumprir o papel da seção, costurar com a frase que vem antes e levar para a que vem depois, sem repetir fato nem palavra do que as outras seções já dizem.',
    'SAÍDA: só as frases da seção nova, na ordem em que serão narradas.',
  ].join('\n\n')
}

/** Os sistemas sem estilo (o jeito do app). */
export const SISTEMA_ROTEIRO = sistemaDoRoteiro(null)
export const SISTEMA_SECAO = sistemaDaSecao(null)

/** O papel como o prompt escreve (com acento, em minusculas). */
const PAPEL_NO_PROMPT: Record<PapelDaSecao, string> = {
  gancho: 'gancho',
  contexto: 'contexto',
  desenvolvimento: 'desenvolvimento',
  virada: 'virada',
  climax: 'clímax',
  fechamento: 'fechamento',
}

/**
 * Total de frases pedidas para o alvo no ritmo da voz (soma de frasesPorPapel).
 * `ritmo` = palavras por segundo do take final (shared/ritmo.ts): a voz nativa
 * a 1,2 fala ~3,8 p/s, e o mesmo minuto pede mais frases.
 */
export function frasesDoAlvo(alvoSec: AlvoSec, ritmo?: number): number {
  const porPapel = frasesPorPapel(alvoSec, ritmo)
  return PAPEIS.reduce((n, p) => n + porPapel[p], 0)
}

function linhaDoTamanho(alvoSec: AlvoSec, ritmo?: number): string {
  const f = faixaDePalavras(alvoSec, ritmo)
  const frases = frasesDoAlvo(alvoSec, ritmo)
  return `DURAÇÃO DO SHORT: ${alvoSec} s → ALVO de ${f.alvo} palavras faladas no total (mínimo ${f.min}, máximo ${f.max}), em umas ${frases} frases de ~${Math.round(f.alvo / frases)} palavras. Você não precisa contar palavras: siga o NÚMERO DE FRASES da divisão abaixo.`
}

/**
 * A divisao em frases por secao. Sem estilo, na ordem da estrutura de short
 * (a virada antes da metade). Com estilo, so o total: a divisao e a dele (o
 * guia dele diz o tempo de cada bloco), e o mapa das secoes diz os papeis.
 */
function linhaDaDivisao(alvoSec: AlvoSec, ritmo: number | undefined, comEstilo: boolean): string {
  if (comEstilo) {
    return `DIVISÃO: umas ${frasesDoAlvo(alvoSec, ritmo)} frases no total, na estrutura do estilo dele (cada bloco com o papel do mapa das seções). O gancho abre e o fechamento fecha.`
  }
  const porPapel = frasesPorPapel(alvoSec, ritmo)
  const partes = ORDEM_DO_SHORT.map((p) => `${PAPEL_NO_PROMPT[p]} ${porPapel[p]}`)
  return `DIVISÃO (frases por seção, nesta ordem): ${partes.join(', ')}. Sem virada clara, as frases dela vão para o desenvolvimento.`
}

/** O lembrete do fim do pedido, com estilo: o estilo mora no sistema, e o pedido e longo. */
const LEMBRETE_DO_ESTILO =
  'LEMBRETE: o tom e a estrutura são os do ESTILO DO EDITOR (no começo das instruções); os fatos, só destes acontecimentos; os nomes, só do ELENCO.'

/** Ate quanto em volta do trecho uma cena ainda conta como "em cena" (a mesma folga do momento). */
const FOLGA_DA_CENA_SEC = 3
/** O reconhecimento abaixo disto erra demais para virar instrucao ao roteirista. */
const CONFIANCA_DO_ROSTO = 0.6
/** Quantos nomes o "em cena" lista. */
const NOMES_EM_CENA = 6

/**
 * Quem esta EM CENA no trecho do evento: os falantes das falas e os
 * personagens reconhecidos nas cenas do trecho (confianca >= 0,6), na grafia
 * do elenco, do mais presente ao menos. null = nenhuma cena cobre o trecho
 * (no Corte Cenas do S4 - 37 nao ha cena antes de 88 s). O roteirista so via
 * falas e pedia na tela quem nem estava ali.
 */
function emCena(
  evento: Pick<Evento, 't0' | 't1'>,
  cues: readonly Cue[],
  indice: Pick<EpisodeIndex, 'planos'>,
  elenco: Elenco,
): string[] | null {
  const planos = indice.planos.filter((p) => p.end > evento.t0 - FOLGA_DA_CENA_SEC && p.start < evento.t1 + FOLGA_DA_CENA_SEC)
  if (indice.planos.length > 0 && planos.length === 0) return null
  const contagem = new Map<string, number>()
  const somar = (nome: string): void => {
    const n = acertarNome(nome, elenco)
    if (n) contagem.set(n, (contagem.get(n) ?? 0) + 1)
  }
  for (const c of cues) if (c.falante?.trim()) somar(c.falante)
  for (const p of planos) for (const q of p.personagens) if (q.conf >= CONFIANCA_DO_ROSTO) somar(q.nome)
  return [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, NOMES_EM_CENA).map(([n]) => n)
}

/**
 * Os eventos no formato que os dois prompts de roteiro usam: o cabecalho, quem
 * esta em cena (ou "sem cena no episodio"), TODAS as falas do trecho, e as
 * placas no tempo delas -- a de salto no tempo marcada.
 */
export function blocoDosEventos(
  eventos: readonly Evento[],
  indice: Pick<EpisodeIndex, 'cues' | 'exclusoes' | 'planos'>,
  elenco: Elenco,
): string {
  const placas = placasDeContexto(indice)
  const linhas: string[] = []
  let p = 0
  const placa = (pl: PlacaDeContexto): string =>
    pl.tempo
      ? `-- SALTO DE TEMPO: placa na tela (${formatarTempo(pl.start)}) "${textoDaPlaca(pl)}" --`
      : `-- placa na tela (${formatarTempo(pl.start)}): "${textoDaPlaca(pl)}" (não é fala) --`
  for (const ev of eventos) {
    while (p < placas.length && placas[p]!.start < ev.t0) linhas.push(placa(placas[p++]!))
    const nomes = ev.personagens.length > 0 ? ev.personagens.join(', ') : '-'
    const cues = cuesDoEvento(ev, indice)
    const cena = emCena(ev, cues, indice, elenco)
    linhas.push(`${ev.id} [${formatarTempo(ev.t0)}-${formatarTempo(ev.t1)}] peso ${ev.peso} | ${nomes}: ${ev.resumo}`)
    linhas.push(cena === null ? '   (sem cena no episódio)' : cena.length > 0 ? `   em cena: ${cena.join(', ')}` : '   em cena: (ninguém reconhecido)')
    for (const cue of cues) linhas.push(`   ${linhaDaFala(cue, false)}`)
  }
  while (p < placas.length) linhas.push(placa(placas[p++]!))
  return linhas.join('\n')
}

/** O roteiro em texto, secao por secao, com os eventos de cada frase (para o refazer e para o ajuste). */
export function blocoDoRoteiro(
  roteiro: Pick<Roteiro, 'secoes'>,
  marcar?: { secaoId: string; rotulo: string },
): string {
  const linhas: string[] = []
  for (const s of roteiro.secoes) {
    const alvo = marcar?.secaoId === s.id
    const palavras = palavrasDoRoteiro({ secoes: [s] })
    linhas.push(`${alvo ? '>>> ' : ''}[${s.id} · ${s.papel}]${alvo ? ` ← ${marcar!.rotulo} (hoje com ${palavras} palavras)` : ''}`)
    for (const f of s.frases) {
      const evs = f.eventoIds.length > 0 ? ` (${f.eventoIds.join(', ')})` : ''
      linhas.push(`  - ${f.texto}${evs}`)
    }
  }
  return linhas.join('\n')
}

type IndiceDoPrompt = Pick<EpisodeIndex, 'anime' | 'temporada' | 'episodio' | 'kind' | 'cues' | 'exclusoes' | 'planos'>

export interface EntradaDoRoteiro {
  indice: IndiceDoPrompt
  eventos: readonly Evento[]
  alvoSec: AlvoSec
  /** Palavras por segundo da voz que vai narrar (ritmoDoRascunho). Ausente = o 2,7 de antes. */
  ritmo?: number
  elenco: Elenco
  instrucao?: string | null
  /** A primeira frase das versoes anteriores: a versao nova tem que sair diferente. */
  ganchosAnteriores?: readonly string[]
  /**
   * Nova tentativa: a resposta anterior (ja como roteiro) e o que estava errado.
   * O modelo ajusta em vez de comecar do zero -- mantem a estrutura.
   */
  ajuste?: { anterior: Pick<Roteiro, 'secoes'>; motivo: string } | null
  /**
   * O bloco do "Meu estilo" (shared/estilo.ts, blocoDoEstilo). Ele mesmo vai no
   * SISTEMA (sistemaDoRoteiro); aqui so muda a divisao (a dele) e o lembrete.
   * null/ausente = o jeito do app.
   */
  estilo?: string | null
}

export function promptDoRoteiro(e: EntradaDoRoteiro): string {
  const linhas = [
    `EPISÓDIO: ${tituloDoEpisodio(e.indice)}`,
    linhaDoTamanho(e.alvoSec, e.ritmo),
    linhaDaDivisao(e.alvoSec, e.ritmo, !!e.estilo),
    `ELENCO (grafia da legenda): ${linhaDoElenco(e.elenco)}`,
    '',
    'ACONTECIMENTOS (id [início-fim] peso | personagens: resumo; embaixo, quem está em cena e as falas do trecho):',
    blocoDosEventos(e.eventos, e.indice, e.elenco),
  ]
  const ganchos = (e.ganchosAnteriores ?? []).filter((g) => g.trim())
  if (ganchos.length > 0) {
    linhas.push(
      '',
      'VERSÕES ANTERIORES começaram assim. Escreva uma versão DIFERENTE: outro gancho (outro acontecimento ou outro ângulo do mesmo, com outras palavras) e outra costura, com a mesma fidelidade:',
      ...ganchos.map((g) => `- ${g}`),
    )
  }
  if (e.estilo) linhas.push('', LEMBRETE_DO_ESTILO)
  if (e.instrucao?.trim()) {
    linhas.push('', `PEDIDO DO EDITOR: ${e.instrucao.trim()} (siga o pedido sem quebrar a fidelidade nem o formato)`)
  }
  if (e.ajuste) {
    linhas.push(
      '',
      `SUA RESPOSTA ANTERIOR (abaixo) precisa de ajuste: ${e.ajuste.motivo}`,
      'Reescreva o roteiro inteiro corrigindo isso, mantendo a estrutura e a fidelidade.',
      blocoDoRoteiro(e.ajuste.anterior),
    )
  }
  return linhas.join('\n')
}

export interface EntradaDaSecao {
  indice: IndiceDoPrompt
  eventos: readonly Evento[]
  alvoSec: AlvoSec
  /** Palavras por segundo da voz que vai narrar. Ausente = o 2,7 de antes. */
  ritmo?: number
  elenco: Elenco
  roteiro: Pick<Roteiro, 'secoes'>
  secaoId: string
  /** Quantas palavras pedir para a parte nova. */
  palavrasDaSecao: number
  instrucao?: string | null
  /** Nova tentativa depois de uma resposta sem frase valida (ou com termo vetado). */
  aviso?: string | null
  /** O bloco do "Meu estilo" (vai no sistema, sistemaDaSecao; aqui, o lembrete). null/ausente = o jeito do app. */
  estilo?: string | null
}

export function promptDaSecao(e: EntradaDaSecao): string {
  const i = e.roteiro.secoes.findIndex((s) => s.id === e.secaoId)
  const secao = e.roteiro.secoes[i]
  if (!secao) throw new Error(`Secao ${e.secaoId} nao existe nesta versao.`)
  const antes = e.roteiro.secoes[i - 1]?.frases.at(-1)?.texto ?? null
  const depois = e.roteiro.secoes[i + 1]?.frases[0]?.texto ?? null
  // O que as OUTRAS partes ja contam: "Refazer" com "mais forte" repetia na
  // parte nova o fato de outra ("a chave da vida eterna", duas vezes).
  const usados = [...new Set(e.roteiro.secoes.filter((s) => s.id !== e.secaoId).flatMap((s) => s.frases.flatMap((f) => f.eventoIds)))]
  const frases = Math.max(1, Math.round(e.palavrasDaSecao / 9.5))
  const linhas = [
    `EPISÓDIO: ${tituloDoEpisodio(e.indice)}`,
    linhaDoTamanho(e.alvoSec, e.ritmo),
    `ELENCO (grafia da legenda): ${linhaDoElenco(e.elenco)}`,
    '',
    'ACONTECIMENTOS (id [início-fim] peso | personagens: resumo; embaixo, quem está em cena e as falas do trecho):',
    blocoDosEventos(e.eventos, e.indice, e.elenco),
    '',
    'ROTEIRO ATUAL:',
    blocoDoRoteiro(e.roteiro, { secaoId: e.secaoId, rotulo: 'REFAZER ESTA PARTE' }),
    '',
    `TAREFA: reescreva SÓ a seção ${secao.id} (papel: ${PAPEL_NO_PROMPT[secao.papel]}), com umas ${e.palavrasDaSecao} palavras (~${frases} ${frases === 1 ? 'frase' : 'frases'}).`,
    antes ? `Ela vem logo depois de: "${antes}"` : 'Ela abre o roteiro: a primeira frase é a primeira coisa que o espectador ouve.',
    depois ? `E leva para: "${depois}"` : 'Ela fecha o roteiro: a última frase é a última coisa que o espectador ouve.',
    usados.length > 0
      ? `JÁ CONTADO NAS OUTRAS PARTES (não repita estes fatos nem as palavras deles): acontecimentos ${usados.join(', ')}.`
      : 'As outras partes ainda não contam nenhum acontecimento.',
    'Diga de um jeito novo: não reaproveite as frases de hoje desta parte.',
  ]
  if (e.estilo) linhas.push(LEMBRETE_DO_ESTILO)
  if (e.instrucao?.trim()) {
    linhas.push(`PEDIDO DO EDITOR: ${e.instrucao.trim()} (manda sobre o tamanho e o tom desta parte, sem quebrar a fidelidade)`)
  }
  if (e.aviso) linhas.push(`AVISO SOBRE A SUA RESPOSTA ANTERIOR: ${e.aviso}`)
  return linhas.join('\n')
}
