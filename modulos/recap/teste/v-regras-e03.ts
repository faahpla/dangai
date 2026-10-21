/**
 * [recap] AS REGRAS DO NIA E03 (20/10, a edicao do Levi: 13 de 26 frases
 * mudadas), puro, com um elenco sintetico e os tempos reais dos ganchos:
 *
 *   1. quem a frase retoma sem o nome (quemOMomentoCita, o casar e o
 *      recorte): "essa garotinha" sem sujeito antes e a protagonista (o
 *      gancho do E03, que punha o chefe na frente da Nia); "E a garota aceita
 *      ela" sao duas pessoas (a Nia, depois a Lynokis); "ela viu que a menina"
 *      fica com quem ve; "a garota" depois do Anzel e a protagonista (o
 *      genero pelo artigo do roteiro); "O homem ficou no chao" sem sujeito
 *      nao e a protagonista;
 *   2. o gancho sai com 2 ou 3 cenas, cortado no comeco das palavras de peso
 *      (cortarOGancho): o E03 como o Levi cortou ("Mano... essa garotinha |
 *      invadiu a mafia | so pra arrumar briga."), o Nia E01 e o MRM E02 em 2;
 *      e divide mesmo sem motivo (dividirFrase);
 *   3. o gancho curto demais para dois pedacos de 0,8 s fica inteiro.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-regras-e03.ts
 */
import { elencoDoEpisodio, generosDoRoteiro, prepararPlanos, protagonistaDoRoteiro, quemOMomentoCita, retomaAlguem } from '../electron/cenas/casar'
import { cortarOGancho, corteDaFrase, dividirFrase, DIVISAO_PADRAO, GANCHO_PEDACO_MIN_SEC } from '../shared/divisao'
import type { EpisodeIndex, Plano } from '../shared/episodio'
import type { Evento } from '../shared/roteiro'
import { hashDoTexto, palavrasDaFrase, type TakeDaVoz } from '../shared/voz'

let falhas = 0
function confere(ok: boolean, mensagem: string, extra?: unknown): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}${extra === undefined ? '' : ` -> ${JSON.stringify(extra).slice(0, 400)}`}`)
  }
}

// ------------------------------------------------------------ o elenco

function indice(): Pick<EpisodeIndex, 'id' | 'planos' | 'cues' | 'exclusoes'> {
  const quem = ['Nia Liston', 'Nia Liston', 'Nia Liston', 'Lynokis Funk', 'Lynokis Funk', 'Anzel', 'Anzel', 'Nia Liston']
  const planos: Plano[] = quem.map((nome, i) => ({
    id: String(i + 1).padStart(4, '0'),
    start: i * 4,
    end: i * 4 + 4,
    arquivo: `D:/ep/shots/${String(i + 1).padStart(4, '0')}.mp4`,
    keyframe: null,
    cueIds: [],
    falantes: [],
    personagens: [{ nome, conf: 0.95, fonte: 'ancut' as const }],
  }))
  return { id: `ep_${'e'.repeat(40)}`, planos, cues: [], exclusoes: [] }
}

const ev = (id: string, personagens: string[]): Evento =>
  ({ id, cueIds: [], assinatura: id, t0: 0, t1: 30, resumo: id, personagens, peso: 3 }) as unknown as Evento

/** O roteiro do E03 (o que importa para quem e quem). */
const ROTEIRO = [
  'Mano… essa garotinha invadiu a máfia só pra arrumar briga.',
  'A Nia tinha prometido voltar pra acertar contas com uns capangas.',
  'Aí ele mandou o Anzel dar uma lição na garota.',
  'Naquela noite, a Nia foi direto pro esconderijo deles.',
  'Mas os socos do cara nem fazem a Nia se mover.',
  'Só que a Lynokis tava vigiando tudo de longe.',
  'Por isso, a Lynokis pede pra ser treinada em combate.',
  'E a garota aceita ela como sua primeira aluna.',
]

function regra1(): void {
  console.log('\n== 1. Quem a frase retoma')
  const ind = indice()
  const elenco = elencoDoEpisodio(prepararPlanos(ind), ind, [ev('e12', ['Nia']), ev('e01', ['Anzel'])])
  const prot = protagonistaDoRoteiro(ROTEIRO, elenco)
  confere(prot?.ficha === 'nia', 'a protagonista: a Nia (a mais citada pelo nome)', prot)
  const generos = generosDoRoteiro(ROTEIRO, elenco)
  confere(generos.get('nia') === 'f' && generos.get('lynokis') === 'f' && generos.get('anzel') === 'm', 'o genero pelo artigo ("a Nia", "o Anzel")', [...generos])
  const nia = prot!
  const lyn = { ficha: 'lynokis', rotulo: 'Lynokis' }
  const anzel = { ficha: 'anzel', rotulo: 'Anzel' }
  const fichas = (r: { citados: { ficha: string }[] }): string => r.citados.map((c) => c.ficha).join(',')

  const gancho = quemOMomentoCita(ROTEIRO[0]!, [], nia, elenco, generos)
  confere(fichas(gancho) === 'nia', 'o gancho "Mano... essa garotinha invadiu a mafia": a Nia (o chefe so esta no evento)', gancho)
  confere(fichas(quemOMomentoCita('Mano… essa garotinha', [], nia, elenco, generos)) === 'nia', 'o 1o pedaco do gancho tambem')
  const duas = quemOMomentoCita('E a garota aceita ela como sua primeira aluna.', [lyn], nia, elenco, generos)
  confere(fichas(duas) === 'nia,lynokis', '"E a garota aceita ela": a Nia, depois a Lynokis (o sujeito de antes)', duas)
  const ve = quemOMomentoCita('Mas ali ela viu que a menina era um monstro de forte.', [lyn], nia, elenco, generos)
  confere(fichas(ve) === 'lynokis', '"ela viu que a menina...": fica com quem ve (a Lynokis)', ve)
  const outro = quemOMomentoCita('Só que a garota simplesmente vive pra lutar.', [anzel], nia, elenco, generos)
  confere(fichas(outro) === 'nia', '"a garota" depois do Anzel (outro genero): a protagonista', outro)
  const mesma = quemOMomentoCita('Só que a garota simplesmente vive pra lutar.', [lyn], nia, elenco, generos)
  confere(fichas(mesma) === 'lynokis', '"a garota" depois da Lynokis (mesmo genero): o sujeito de antes, como era', mesma)
  const homem = quemOMomentoCita('O homem ficou no chão implorando pra ser morto.', [], nia, elenco, generos)
  confere(homem.citados.length === 0, '"O homem ficou no chao" sem sujeito: ninguem (nao a Nia)', homem)
  const ele = quemOMomentoCita('Ele achava que ia espancar uma criança indefesa.', [anzel], nia, elenco, generos)
  confere(fichas(ele) === 'anzel', '"Ele achava": o sujeito herdado', ele)
  const pedaco2 = quemOMomentoCita('invadiu a máfia só pra arrumar briga.', [nia], nia, elenco, generos)
  confere(!pedaco2.referente, 'o 2o pedaco sem ninguem: a oracao continua (o casar repete o sujeito do pedaco de antes)', pedaco2)
  confere(retomaAlguem('Mano… esse cara foi expulso') && !retomaAlguem('Foram trinta e oito golpes seguidos.'), 'retomaAlguem: "esse cara" sim, "trinta e oito golpes" nao')
}

// ------------------------------------------------------------ o gancho

/** O take de uma frase so, com os inicios REAIS das palavras (segundos, relativos ao trecho). */
function takeDe(texto: string, inicios: number[], duracao: number): Pick<TakeDaVoz, 'trechos' | 'palavras'> {
  const ws = palavrasDaFrase(texto)
  const palavras = ws.map((w, i) => ({ texto: w, start: inicios[i]!, end: (inicios[i + 1] ?? duracao) - 0.02, fraseId: 'f01' })) as TakeDaVoz['palavras']
  return { palavras, trechos: [{ fraseId: 'f01', offset: 0, duracao, hashTexto: hashDoTexto(texto), texto }] as TakeDaVoz['trechos'] }
}

function regra2(): void {
  console.log('\n== 2. O gancho em 2 ou 3 cenas')
  const casos = [
    {
      nome: 'Nia E03 (3,25 s)',
      texto: 'Mano… essa garotinha invadiu a máfia só pra arrumar briga.',
      inicios: [0.01, 0.61, 0.81, 1.43, 1.83, 1.9, 2.28, 2.5, 2.62, 2.85],
      dur: 3.25,
      cortes: '0,3,6',
    },
    {
      nome: 'Nia E01 (3,54 s): o 3o corte cairia em "de quatro anos", sem peso',
      texto: 'Essa garotinha de quatro anos guarda um segredo bizarro.',
      inicios: [0.04, 0.28, 0.84, 1.01, 1.49, 2.0, 2.39, 2.51, 2.95],
      dur: 3.54,
      cortes: '0,5',
    },
    {
      nome: 'MRM E02 (3,12 s)',
      texto: 'Mano… esse cara foi expulso por ser considerado inútil.',
      inicios: [0, 0.58, 0.78, 1.05, 1.19, 1.76, 1.92, 2.08, 2.58],
      dur: 3.12,
      cortes: '0,3',
    },
  ]
  for (const c of casos) {
    const frase = { id: 'f01', texto: c.texto, citacaoCueId: null }
    const take = takeDe(c.texto, c.inicios, c.dur)
    const corte = corteDaFrase(frase, take, DIVISAO_PADRAO, true)
    const cortes = corte?.pedacos.map((p) => p.palavraInicio).join(',')
    confere(cortes === c.cortes, `${c.nome}: ${corte?.pedacos.map((p) => `"${p.texto}"`).join(' | ')}`, cortes)
    confere(!!corte && corte.pedacos.every((p) => p.fim - p.inicio >= GANCHO_PEDACO_MIN_SEC - 1e-6), `${c.nome}: cada pedaco com 0,8 s ou mais`)
    // Divide sem motivo e sem pedir que um pedaco ganhe (o gancho e a excecao).
    const dv = dividirFrase(frase, take, DIVISAO_PADRAO, { gancho: true, abreOVideo: true, ganha: false })
    confere(dv?.motivos.join() === 'gancho' && dv.pedacos.length === corte?.pedacos.length, `${c.nome}: dividirFrase divide (motivo gancho)`, dv?.motivos)
    // Fora da 1a frase, nada muda: o corte de sempre.
    const fora = dividirFrase(frase, take, DIVISAO_PADRAO, { gancho: true, ganha: false })
    confere(!fora?.motivos.includes('gancho'), `${c.nome}: a 2a frase do gancho divide pelas regras de sempre`, fora?.motivos)
  }
  // 3. Curto demais: 1,5 s nao da dois pedacos de 0,8 s.
  const curto = 'Ela riu de todos eles.'
  const take = takeDe(curto, [0, 0.3, 0.6, 0.9, 1.2], 1.5)
  confere(cortarOGancho({ id: 'f01', texto: curto }, take, 2) === null, '3. o gancho de 1,5 s fica inteiro')
}

regra1()
regra2()
console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
