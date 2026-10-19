/**
 * [recap] A FADINHA COM DOIS NOMES (teste real do Magic Repo Man E02, 18/10):
 * o reconhecimento (AniList) diz "Empee"; a legenda, "MP" e "MP<ponto do
 * meio>Yggdrasil". Ela virava dois chips no filtro, o roteiro que dizia "a
 * fadinha MP" nao achava as cenas dela e o elenco da IA tinha os dois nomes.
 *
 * 1. a sigla soletrada: "MP" = "Empee" / "Em-pee" / "Emu Pi"; "CC" =
 *    "Cee-cee"; e o que NAO junta ("AI" e "Ai", "MP" e "Mp3", sigla de 1 letra);
 * 2. os apelidos do episodio com os nomes de verdade do E02 (rostos, falantes,
 *    eventos): "MP", "MP<ponto>Yggdrasil" e "Yggdrasil" -> "Empee"; o resto fica;
 * 3. "Quem mais fala": MP 181 + 4 + 1 = 186, uma linha so;
 * 4. o casar: a fala do "MP" e do personagem "Empee" (fichas); "a fadinha MP"
 *    cita a Empee; o filtro tem UM chip dela (com as cenas em que so fala);
 * 5. o elenco da IA (gerar/nomes.ts): um personagem "MP" com as cenas do rosto,
 *    e os nomes que a IA escrever ("Empee", "Yggdrasil"...) viram "MP".
 *
 * Rodar da raiz do projeto:
 *   npx tsx --tsconfig tsconfig.node.json modulos/recap/teste/v-apelidos.ts
 */
import { apelidosDoIndice, citadosNoTexto, elencoDoEpisodio, prepararPlanos } from '../electron/cenas/casar'
import { personagensDoEpisodio } from '../electron/cenas/index'
import { acertarNome, elencoDoEpisodio as elencoDaIa, nomesDoElenco } from '../electron/gerar/nomes'
import { apelidosDoElenco, falantesUnidos, mesmaSigla, partesDoNome } from '../shared/apelidos'
import type { Cue, EpisodeIndex, Plano } from '../shared/episodio'

let falhas = 0
function confere(ok: boolean, nome: string): void {
  console.log(`  ${ok ? 'ok ' : 'FALHOU'} ${nome}`)
  if (!ok) falhas++
}
const secao = (nome: string): void => console.log(`\n== ${nome}`)

const PONTO_JAPONES = String.fromCharCode(0x30fb)
const MP_YGG = `MP${PONTO_JAPONES}Yggdrasil`

// Os falantes do E02 (episodio.json da biblioteca dele, so lido) com quantas falas cada um tem.
const FALANTES: [string, number][] = [
  ['Lent', 105], ['Voz do Sistema', 2], ['MP', 181], ['Guy', 28], ['Elle/Misa', 1], ['AldeaoA', 2], ['Misa', 12],
  ['Elle', 5], ['Dono', 2], [MP_YGG, 4], ['Yggdrasil', 1], ['Porquinho', 1], ['Cliente', 1],
]
const ROSTOS: [string, number][] = [['Lent', 96], ['Empee', 121], ['Guy', 58], ['Misa', 36], ['Elle', 31]]

/** Um indice pequeno com os nomes do E02: planos com rosto e/ou falante, e as cues. */
function indiceDoE02(): EpisodeIndex {
  const cues: Cue[] = []
  const planos: Plano[] = []
  let n = 0
  const plano = (rosto: string | null, falante: string | null): void => {
    const start = n * 4
    const cueIds: string[] = []
    if (falante) {
      const id = `c${String(cues.length + 1).padStart(4, '0')}`
      cues.push({ id, start: start + 0.5, end: start + 2.5, texto: 'Fala de teste.', falante, estilo: 'Default', tipo: 'fala' })
      cueIds.push(id)
    }
    planos.push({
      id: String(n + 1).padStart(4, '0'),
      start,
      end: start + 4,
      arquivo: `G:/teste/shots/${String(n + 1).padStart(4, '0')}.mp4`,
      keyframe: null,
      cueIds,
      falantes: falante ? [falante] : [],
      personagens: rosto ? [{ nome: rosto, conf: 0.9, fonte: 'ancut' }] : [],
    })
    n++
  }
  for (let i = 0; i < 6; i++) plano('Empee', 'MP') // ela, com rosto, falando
  for (let i = 0; i < 4; i++) plano(null, 'MP') // so a voz dela (rosto fora do quadro)
  for (let i = 0; i < 3; i++) plano(null, MP_YGG) // o apelido na legenda
  plano(null, 'Yggdrasil')
  for (let i = 0; i < 5; i++) plano('Lent', 'Lent')
  for (let i = 0; i < 3; i++) plano('Guy', 'Guy')
  plano('Misa', 'Elle/Misa')
  return {
    versao: 1,
    id: `ep_${'c'.repeat(40)}`,
    anime: 'Magic Repo Man Dumped by My Party Ill Cash In With a Cute Support Fairy to Become the Strongest',
    temporada: 1,
    episodio: 2,
    kind: '',
    cues,
    exclusoes: [],
    planos,
  } as unknown as EpisodeIndex
}

function principal(): void {
  // ===================================================================== 1.
  secao('1. A sigla soletrada')
  confere(mesmaSigla('MP', 'Empee') && mesmaSigla('Empee', 'MP'), '"MP" e "Empee" (nos dois sentidos)')
  confere(mesmaSigla('MP', 'Em-pee') && mesmaSigla('MP', 'Emu Pi') && mesmaSigla('M.P.', 'Empee'), '"Em-pee", "Emu Pi" e "M.P." tambem')
  confere(mesmaSigla('CC', 'Cee-cee') && mesmaSigla('CC', 'Shiishii') && mesmaSigla('DJ', 'Deejay'), '"CC" = "Cee-cee"; "DJ" = "Deejay"')
  confere(!mesmaSigla('AI', 'Ai') && !mesmaSigla('MP', 'Mp3') && !mesmaSigla('M', 'Em') && !mesmaSigla('Mp', 'Empee'), 'nao junta: "AI"/"Ai", "Mp3", 1 letra, sigla em minuscula')
  confere(!mesmaSigla('MP', 'Emily') && !mesmaSigla('LR', 'Elle'), 'nao junta nome parecido ("Emily", "Elle")')
  confere(partesDoNome(MP_YGG).join('|') === 'MP|Yggdrasil' && partesDoNome('MP \u00b7 Yggdrasil').join('|') === 'MP|Yggdrasil' && partesDoNome('Elle/Misa').length === 1, 'as partes do apelido (ponto japones e ponto do meio)')

  // ===================================================================== 2.
  secao('2. Os apelidos do E02')
  const eventos = [{ personagens: ['Lent', 'MP'] }, { personagens: [MP_YGG, 'Lent'] }, { personagens: ['Yggdrasil'] }, { personagens: ['Guy', 'Misa'] }]
  const ap = apelidosDoElenco(
    ROSTOS.map(([n]) => n),
    [...FALANTES.map(([n]) => n), ...eventos.flatMap((e) => e.personagens)],
  )
  console.log(`  ${[...ap].map(([a, b]) => `${a} -> ${b}`).join(', ')}`)
  confere(ap.get('MP') === 'Empee' && ap.get(MP_YGG) === 'Empee' && ap.get('Yggdrasil') === 'Empee', '"MP", "MP<ponto>Yggdrasil" e "Yggdrasil" -> "Empee"')
  confere(!ap.has('Lent') && !ap.has('Guy') && !ap.has('Elle/Misa') && !ap.has('Voz do Sistema') && ap.size === 3, 'o resto fica como esta (so 3 apelidos)')
  const semRosto = apelidosDoElenco([], ['MP', MP_YGG, 'Yggdrasil', 'Lent'])
  confere(semRosto.get(MP_YGG) === 'MP' && semRosto.get('Yggdrasil') === 'MP' && !semRosto.has('MP'), 'sem rosto (o elenco da IA): as partes viram o "MP"')
  const doIndice = apelidosDoIndice(indiceDoE02(), eventos)
  confere(doIndice.get('MP') === 'Empee' && doIndice.get('Yggdrasil') === 'Empee', 'apelidosDoIndice (rostos, falantes e eventos) igual')

  // ===================================================================== 3.
  secao('3. Quem mais fala')
  const unidos = falantesUnidos(FALANTES.map(([nome, falas]) => ({ nome, falas })), ap)
  confere(unidos[0]!.nome === 'MP' && unidos[0]!.falas === 186 && unidos[0]!.grafias.length === 3, `uma linha so: ${unidos[0]!.nome} (${unidos[0]!.falas})`)
  confere(unidos[1]!.nome === 'Lent' && unidos.filter((f) => /Ygg/.test(f.nome)).length === 0, 'o "Yggdrasil" nao aparece de novo')

  // ===================================================================== 4.
  secao('4. O casar e o filtro')
  const indice = indiceDoE02()
  const todos = prepararPlanos(indice)
  const soAVoz = todos.find((p) => p.plano.falantes[0] === 'MP' && p.plano.personagens.length === 0)!
  confere(soAVoz.falas[0]!.fichas.join() === 'empee', `a fala do "MP" tem as fichas da Empee (${soAVoz.falas[0]!.fichas.join()})`)
  const apelido = todos.find((p) => p.plano.falantes[0] === MP_YGG)!
  confere(apelido.falas[0]!.fichas.join() === 'empee', 'a do "MP<ponto>Yggdrasil" tambem')
  const elenco = elencoDoEpisodio(todos, indice, eventos)
  const citados = citadosNoTexto('O poder do Lent evolui pro rank SSS junto da fadinha MP.', elenco)
  confere(citados.some((c) => c.ficha === 'empee' && c.rotulo === 'MP') && citados.some((c) => c.ficha === 'lent'), `"a fadinha MP" cita a Empee (${citados.map((c) => `${c.rotulo}=${c.ficha}`).join(', ')})`)
  confere(citadosNoTexto('E a Yggdrasil sorriu.', elenco).map((c) => c.ficha).join() === 'empee', '"Yggdrasil" no texto tambem e ela')
  confere(citadosNoTexto('Ele foi ao MP3 da loja.', elenco).length === 0, '"MP3" nao e ela')
  const chips = personagensDoEpisodio(indice, todos)
  console.log(`  chips: ${chips.map((c) => `${c.nome} ${c.cenas}`).join(', ')}`)
  const dela = chips.filter((c) => /Empee|MP|Ygg/.test(c.nome))
  confere(dela.length === 1 && dela[0]!.nome === 'Empee' && dela[0]!.cenas === 14, 'UM chip dela ("Empee"), com as 14 cenas (rosto, voz e apelido)')

  // ===================================================================== 5.
  secao('5. O elenco da IA')
  const ia = elencoDaIa(indice)
  const nomes = nomesDoElenco(ia)
  console.log(`  elenco: ${nomes.join(', ')}`)
  const mp = ia.personagens.find((p) => p.nome === 'MP')
  confere(!!mp && mp.cenas === 6 && mp.doIndice.includes('Empee'), 'um personagem "MP" com as cenas do rosto "Empee"')
  confere(!nomes.includes('Empee') && !nomes.includes('Yggdrasil') && !nomes.some((n) => n.includes(PONTO_JAPONES)), 'sem "Empee", "Yggdrasil" ou o apelido como outra pessoa')
  confere(acertarNome('Empee', ia) === 'MP' && acertarNome(MP_YGG, ia) === 'MP' && acertarNome('Yggdrasil', ia) === 'MP', 'o nome que a IA escrever vira "MP"')
  confere(acertarNome('Lent', ia) === 'Lent' && acertarNome('Guy', ia) === 'Guy', 'os outros ficam')
}

try {
  principal()
  console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
} catch (err) {
  console.error(err)
  process.exit(1)
}
