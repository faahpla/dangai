/**
 * [recap] A PONTE VISUAL (19/10, 4a rodada, a edicao do Levi no Nia E01): o
 * que o roteiro (PT) pede que se VEJA, nas etiquetas do WD-Tagger dos planos, e
 * o tipo de frase (acao fisica ou nao). Puro, sem dependencias: o casar
 * (electron/cenas/casar.ts) usa e o teste confere.
 *
 * Por que existe: sem as dicas da IA (a `visualEn` e as `tags` de cada frase,
 * completarDicas), o casar so tinha o instante da fala para escolher -- e
 * mostrava a fala SOBRE a acao ("Hand it to me" no lugar da Nia com a espada).
 * As etiquetas dos planos ja estao medidas (visao.json); faltava a frase dizer
 * quais pedir. A intencao visual ("Nia segurando a espada cerimonial") e o
 * texto viram etiquetas por um mapa curto e FIXO (como a PONTE_PT_EN do
 * casar): so palavra que se ve, so etiqueta do vocabulario do WD-Tagger.
 * Com as dicas da IA, as delas descrevem a intencao; a ponte so traduz as
 * palavras do proprio texto (o pedaco da frase dividida diz as dele).
 */

/** Sem acento, minusculas, so letras e numeros. */
export function palavrasSemAcento(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * PT (sem acento) -> etiquetas do WD-Tagger (como o normalizarTag deixa:
 * minusculas, espaco no lugar do _). Cada lista e o que a palavra poe na tela.
 */
export const PONTE_PT_TAGS: Readonly<Record<string, readonly string[]>> = {
  espada: ['sword', 'holding sword', 'weapon', 'holding weapon', 'katana'],
  espadas: ['sword', 'holding sword', 'weapon', 'holding weapon', 'katana'],
  lamina: ['sword', 'holding sword', 'weapon', 'knife', 'blade'],
  arma: ['weapon', 'holding weapon', 'sword', 'gun'],
  armas: ['weapon', 'holding weapon', 'sword', 'gun'],
  faca: ['knife', 'holding knife', 'weapon'],
  escudo: ['shield', 'holding shield'],
  armadura: ['armor'],
  arco: ['bow (weapon)', 'arrow (projectile)'],
  lanca: ['polearm', 'spear', 'holding polearm'],
  machado: ['axe', 'holding axe'],
  martelo: ['hammer', 'holding hammer'],
  oficina: ['hammer', 'holding hammer', 'anvil', 'apron', 'goggles', 'workshop'],
  ferreiro: ['hammer', 'holding hammer', 'anvil', 'apron', 'goggles'],
  ferreiros: ['hammer', 'holding hammer', 'anvil', 'apron', 'goggles'],
  artesao: ['hammer', 'holding hammer', 'apron', 'goggles', 'old man'],
  artesaos: ['hammer', 'holding hammer', 'apron', 'goggles'],
  cama: ['bed', 'on bed', 'lying', 'pillow', 'bedroom'],
  deitada: ['lying', 'on back', 'bed', 'pillow'],
  deitado: ['lying', 'on back', 'bed', 'pillow'],
  dormindo: ['sleeping', 'closed eyes', 'lying'],
  quarto: ['bedroom', 'bed', 'indoors'],
  criada: ['maid', 'maid headdress', 'maid apron'],
  criadas: ['maid', 'maid headdress', 'maid apron'],
  empregada: ['maid', 'maid headdress', 'maid apron'],
  servo: ['maid', 'butler', 'maid headdress'],
  servos: ['maid', 'butler', 'maid headdress'],
  criados: ['maid', 'butler', 'maid headdress'],
  empregados: ['maid', 'butler', 'maid headdress'],
  mordomo: ['butler'],
  cadeira: ['chair', 'sitting'],
  pais: ['family', 'mother and daughter', 'father and daughter'],
  familia: ['family', 'mother and daughter', 'father and daughter'],
  cartas: ['letter', 'envelope', 'paper', 'holding paper'],
  carta: ['letter', 'envelope', 'paper', 'holding paper'],
  convite: ['letter', 'envelope', 'paper', 'holding paper'],
  transmissao: ['microphone', 'holding microphone', 'camera', 'television'],
  microfone: ['microphone', 'holding microphone'],
  camera: ['camera', 'holding camera'],
  televisao: ['television', 'screen'],
  palco: ['stage', 'spotlight', 'microphone'],
  teatro: ['stage', 'spotlight', 'theater'],
  capital: ['city', 'cityscape', 'castle', 'building', 'town'],
  cidade: ['city', 'cityscape', 'building', 'town', 'street'],
  castelo: ['castle'],
  magia: ['magic', 'magic circle', 'glowing', 'aura', 'light particles'],
  feitico: ['magic', 'magic circle', 'glowing'],
  alma: ['glowing', 'light particles', 'ghost'],
  energia: ['glowing', 'aura', 'light particles', 'energy'],
  chi: ['glowing', 'aura', 'light particles'],
  aura: ['aura', 'glowing'],
  escuridao: ['dark', 'silhouette', 'darkness'],
  sombra: ['dark', 'silhouette', 'shadow'],
  cadaver: ['corpse', 'death', 'blood'],
  sangue: ['blood', 'blood on clothes', 'injury'],
  fogo: ['fire', 'flame'],
  explosao: ['explosion', 'smoke'],
  golpe: ['motion lines', 'motion blur', 'sword', 'weapon', 'fighting stance'],
  // (5a rodada) O VERBO que se ve, sem as dicas da IA: pegar/erguer/segurar e o braco para cima
  // segurando (o 0315 do Nia E01, a Nia erguendo a espada, que o Levi pos na f14).
  pega: ['holding', 'arms up', 'arm up'],
  pegou: ['holding', 'arms up', 'arm up'],
  pegar: ['holding', 'arms up', 'arm up'],
  ergue: ['arms up', 'arm up', 'holding'],
  ergueu: ['arms up', 'arm up', 'holding'],
  levanta: ['arms up', 'arm up', 'holding'],
  levantou: ['arms up', 'arm up', 'holding'],
  segura: ['holding'],
  segurando: ['holding'],
  empunha: ['holding', 'fighting stance'],
  demonstracao: ['motion lines', 'motion blur', 'arms up', 'holding', 'fighting stance'],
  corte: ['sword', 'motion lines', 'motion blur', 'weapon', 'holding sword'],
  soco: ['punching', 'motion lines', 'fist'],
  chute: ['kicking', 'motion lines'],
  luta: ['fighting stance', 'fighting', 'battle', 'weapon'],
  batalha: ['battle', 'fighting', 'weapon', 'explosion'],
  maos: ['hand focus', 'hands', 'own hands together'],
  mao: ['hand focus', 'hands'],
  rosto: ['close-up', 'portrait', 'face'],
  sorrindo: ['smile', ':d', 'happy'],
  sorriso: ['smile', ':d', 'happy'],
  comemorando: ['smile', ':d', 'happy', 'cheering', 'arms up'],
  comemora: ['smile', ':d', 'happy', 'cheering', 'arms up'],
  chorando: ['crying', 'tears', 'crying with eyes open'],
  lagrimas: ['crying', 'tears'],
  surpresa: ['surprised', ':o', 'wide-eyed'],
  surpreso: ['surprised', ':o', 'wide-eyed'],
  desdem: ['smug', 'smirk', 'half-closed eyes'],
  comida: ['food', 'eating'],
  comendo: ['food', 'eating'],
  dinheiro: ['money', 'coin', 'gold'],
  livro: ['book', 'holding book'],
  livros: ['book', 'holding book'],
  pergaminho: ['scroll', 'holding scroll', 'paper'],
  espelho: ['mirror', 'reflection'],
  jardim: ['garden', 'flower', 'plant'],
  floresta: ['forest', 'tree', 'nature'],
  multidao: ['crowd', 'audience'],
  publico: ['crowd', 'audience'],
  rei: ['king', 'crown', 'throne'],
  rainha: ['queen', 'crown', 'throne'],
  trono: ['throne'],
  carruagem: ['carriage', 'horse'],
  navio: ['ship', 'boat', 'watercraft'],
  noite: ['night', 'night sky', 'moon'],
  fada: ['fairy', 'fairy wings', 'minigirl'],
  fadinha: ['fairy', 'fairy wings', 'minigirl'],
}

/** Expressoes de duas palavras (a 1a sem a 2a nao vale): "cadeira de rodas", "de olhos fechados". */
const PONTE_PT_TAGS_DUPLAS: readonly { de: readonly string[]; tags: readonly string[] }[] = [
  { de: ['cadeira', 'rodas'], tags: ['wheelchair', 'sitting'] },
  { de: ['olhos', 'fechados'], tags: ['closed eyes'] },
  { de: ['braco', 'erguido'], tags: ['arms up', 'arm up'] },
  { de: ['bracos', 'erguidos'], tags: ['arms up'] },
]

/**
 * As etiquetas que um texto pede (na ordem das palavras, sem repetir). Vazio =
 * nenhuma palavra da ponte.
 */
export function tagsDoTexto(texto: string): string[] {
  const ws = palavrasSemAcento(texto)
  const saida: string[] = []
  const por = (ts: readonly string[]): void => {
    for (const t of ts) if (!saida.includes(t)) saida.push(t)
  }
  for (const d of PONTE_PT_TAGS_DUPLAS) {
    const i = ws.indexOf(d.de[0]!)
    if (i >= 0 && ws.slice(i + 1, i + 4).includes(d.de[1]!)) {
      por(d.tags)
      // "cadeira de rodas" e a cadeira de rodas, nao uma cadeira qualquer.
      ws.splice(i, 1)
    }
  }
  for (const w of ws) {
    const ts = PONTE_PT_TAGS[w]
    if (ts) por(ts)
  }
  return saida
}

/** (4a rodada) Quantas etiquetas, no maximo, entram na consulta de imagem. */
const CONSULTA_MAX = 8

/**
 * (4a rodada) A CONSULTA DE IMAGEM (o CLIP, em ingles) que as palavras do texto
 * pedem pela ponte: "anime screenshot, glowing, light particles, ghost" para
 * "pra enfiar outra alma nela". O CLIP olha os 3 keyframes do plano (as
 * etiquetas so o do meio): as maos brilhando do 0057 do Nia E01 estao no
 * primeiro. null = nenhuma palavra da ponte.
 */
export function consultaVisual(texto: string): string | null {
  const tags = tagsDoTexto(texto)
  return tags.length > 0 ? `anime screenshot, ${tags.slice(0, CONSULTA_MAX).join(', ')}` : null
}

/**
 * O tipo de acao que a tela mostra acontecendo:
 *   'impacto': o golpe, o corte, a explosao -- o pico de movimento e a cena;
 *   'gesto': pegar, erguer, visitar, demonstrar -- o que se ve e o gesto, e a
 *     fala do momento costuma ser SOBRE ele (o pedido, o anuncio).
 * Formas conjugadas da narracao (presente e passado), sem acento. O infinitivo
 * fica de fora de proposito: "ensina o irmao a fatiar" e ensinar (a fala da
 * Nia junto do gesto, f10 do Nia E01), nao o corte acontecendo. E o verbo que
 * a narracao usa no figurado tambem ("os parceiros jogaram ele na rua", "foi
 * expulso do grupo", MRM E02): ali a cena e quem fala, nao um gesto.
 */
const IMPACTO = new Set([
  'golpeia', 'golpeou', 'corta', 'cortou', 'fatia', 'fatiou', 'partiu', 'parte', 'quebra', 'quebrou', 'destroi',
  'destruiu', 'despedaca', 'despedacou', 'racha', 'rachou', 'ataca', 'atacou', 'chuta', 'chutou', 'soca', 'socou',
  'acerta', 'acertou', 'derruba', 'derrubou', 'esmaga', 'esmagou', 'explode', 'explodiu', 'dispara', 'disparou',
  'atira', 'atirou', 'arremessa', 'arremessou', 'crava', 'cravou', 'perfura', 'perfurou', 'lutou',
])
const GESTO = new Set([
  'pega', 'pegou', 'pegam', 'pegaram', 'agarra', 'agarrou', 'empunha', 'empunhou', 'ergue', 'ergueu', 'saca', 'sacou',
  'empurra', 'empurrou', 'puxa', 'puxou', 'arranca', 'arrancou', 'salta', 'saltou', 'pula', 'pulou', 'voa', 'voou',
  'foge', 'fugiu', 'demonstra', 'demonstrou', 'invoca', 'invocou', 'conjura', 'conjurou', 'sufoca', 'sufocou',
  'asfixia', 'asfixiou', 'estrangula', 'estrangulou', 'abraca', 'abracou', 'beija', 'beijou', 'visita', 'visitou',
])
/** O substantivo de acao com quem faz ("faz uma demonstracao", "com um corte limpo", "da um golpe"). */
const SUBSTANTIVOS: Readonly<Record<string, 'impacto' | 'gesto'>> = {
  golpe: 'impacto',
  corte: 'impacto',
  ataque: 'impacto',
  soco: 'impacto',
  chute: 'impacto',
  explosao: 'impacto',
  demonstracao: 'gesto',
}
/** Antes do verbo, o que tira a acao da tela: desejo, hipotese, capacidade ("queria morrer lutando"). */
const MODAIS = new Set([
  'queria', 'quer', 'querem', 'sonha', 'sonhava', 'deseja', 'desejava', 'capaz', 'poderia', 'podia', 'pode', 'iria',
  'vai', 'tenta', 'tentou', 'pensa', 'sabe', 'acha', 'derrotaria', 'nunca', 'sem', 'nao',
])
/** O que faz do "parte" um verbo com objeto ("parte um escudo"; "a primeira parte" nao). */
const OBJETO = new Set(['um', 'uma', 'o', 'a', 'os', 'as', 'ao', 'seu', 'sua', 'em', 'pra', 'para', 'ele', 'ela'])
/** Quem faz o substantivo de acao. */
const QUEM_FAZ = new Set(['faz', 'fez', 'com', 'da', 'deu', 'num', 'numa', 'solta', 'soltou', 'aplica', 'aplicou'])

export type AcaoDaFrase = 'impacto' | 'gesto'

/**
 * A frase descreve uma ACAO FISICA que a tela pode mostrar (regra 2 da 4a
 * rodada: mostrar a acao, nao a fala sobre ela). O verbo da lista sem desejo
 * ou hipotese logo antes, ou o substantivo de acao com quem faz. Com as duas
 * coisas, vale o impacto. null = nao e frase de acao.
 */
export function acaoFisica(texto: string): AcaoDaFrase | null {
  const ws = palavrasSemAcento(texto)
  let achada: AcaoDaFrase | null = null
  const marcar = (a: AcaoDaFrase): void => {
    if (achada !== 'impacto') achada = a
  }
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!
    const antes = ws.slice(Math.max(0, i - 3), i)
    if (antes.some((x) => MODAIS.has(x))) continue
    if (IMPACTO.has(w) || GESTO.has(w)) {
      // "parte" tambem e substantivo ("a primeira parte"): so com objeto logo depois.
      if (w === 'parte' && !OBJETO.has(ws[i + 1] ?? '')) continue
      marcar(IMPACTO.has(w) ? 'impacto' : 'gesto')
      continue
    }
    const s = SUBSTANTIVOS[w]
    if (s && antes.some((x) => QUEM_FAZ.has(x))) marcar(s)
  }
  return achada
}
