/**
 * O PASSO 3 DO B-ROLL (shared/visao.ts): a consulta de cada trecho, as notas
 * de destaque do comparador e o peso delas na escolha de cena -- sem Ollama,
 * com notas prontas, para o teste rodar em qualquer maquina.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-visao.ts`.
 */
import type { LibraryClip, SceneDescription } from '../../shared/channels.ts'
import { buildScriptIndex, readScript } from '../../shared/script-reader.ts'
import { selectClips } from '../../shared/selection.ts'
import { consultasDosTrechos, cosseno, duracaoLegivel, notasDeDestaque, tempoDeLeitura } from '../../shared/visao.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}
const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

console.log('consulta de cada trecho')
{
  const blocos = [
    { text: 'Seis meses depois, ', sentence: 0 },
    { text: 'um nobre chamado Tokinada tentou criar outro Rei das Almas.', sentence: 0 },
  ]
  // Medido: o trecho sozinho acha mais que a frase inteira (shared/visao.ts).
  ok('cada trecho e a propria consulta, sem a frase inteira', igual(consultasDosTrechos(blocos), ['Seis meses depois,', 'um nobre chamado Tokinada tentou criar outro Rei das Almas.']))
}

console.log('notas de destaque')
{
  // Nove cenas na media e uma bem acima: so ela passa.
  const sims = new Map<string, number>([...Array.from({ length: 9 }, (_, k) => [`c${k}`, 0.4 + (k % 3) * 0.01] as [string, number]), ['certa', 0.62]])
  const notas = notasDeDestaque(sims)
  ok('so a que se destaca volta', igual(Object.keys(notas), ['certa']), JSON.stringify(notas))
  ok('a nota e em desvios acima da media', (notas.certa ?? 0) > 2.5, String(notas.certa))
  ok('tudo igual nao destaca ninguem', igual(notasDeDestaque(new Map([['a', 0.5], ['b', 0.5]])), {}))
  ok('uma cena so nao tem media', igual(notasDeDestaque(new Map([['a', 0.9]])), {}))
  ok('cosseno de vetores iguais e 1', Math.abs(cosseno([1, 2, 3], [2, 4, 6]) - 1) < 1e-9)
  ok('cosseno com vetor zerado e 0', cosseno([0, 0], [1, 1]) === 0)
}

console.log('tempo de leitura')
{
  ok('minutos', duracaoLegivel(35 * 60000) === '35 min', duracaoLegivel(35 * 60000))
  ok('horas e minutos', duracaoLegivel(80 * 60000) === '1h 20min', duracaoLegivel(80 * 60000))
  ok('hora cheia', duracaoLegivel(120 * 60000) === '2h')
  ok('menos de um minuto', duracaoLegivel(20000) === 'menos de 1 min')
  ok('estimativa: 403 cenas (um episodio) levam ~23 min', tempoDeLeitura(403) === '23 min', tempoDeLeitura(403))
}

console.log('a escolha de cena com o que a imagem mostra')
{
  const clip = (id: string, characters: string[], start: number): LibraryClip => ({
    id: `Bleach/S01E50/${id}`,
    path: `D:/Animes/Bleach/S01E50/shots/${id}.mp4`,
    thumb: '',
    keyframe: '',
    anime: 'Bleach',
    animeTitle: 'Bleach',
    season: 1,
    episode: 50,
    shot: id,
    start,
    duration: 4,
    characters,
  })
  const descricao = (cena: string): SceneDescription => ({ cena, emocao: '', acao: '', cenario: '', plano: 'medio' })
  const clips = [
    clip('rua', ['Abarai, Renji'], 10),
    clip('casamento', [], 200),
    clip('festa', ['Abarai, Renji', 'Kuchiki, Rukia'], 300),
    clip('ceu', [], 400),
  ]
  const descricoes = {
    [clips[0]!.id]: descricao('homem de cabelo vermelho anda na rua'),
    [clips[1]!.id]: descricao('casal em trajes de casamento diante de um altar'),
    [clips[2]!.id]: descricao('casal de noivos sorri numa festa'),
    [clips[3]!.id]: descricao('ceu azul com nuvens'),
  }
  const index = buildScriptIndex(['Abarai, Renji', 'Kuchiki, Rukia'], [
    { term: 'Renji', character: 'Abarai, Renji' },
    { term: 'Rukia', character: 'Kuchiki, Rukia' },
  ])
  const frase = 'Rukia e Renji se casaram.'
  const [lida] = readScript([frase], index)
  const linhas = [{ ...lida!, text: frase, start: 0, end: 3 }]
  const ordem = (visao?: Record<string, number>): string[] =>
    selectClips(linhas, clips, { mode: 'theory', fita: 6, descriptions: descricoes, visao: visao ? [visao] : undefined })[0]!.candidates.map(
      (c) => c.clip.shot,
    )

  ok('sem comparacao, cena sem etiqueta nao entra numa frase com nome', !ordem().includes('casamento'), ordem().join(','))
  const comImagem = ordem({ [clips[1]!.id]: 3.2, [clips[2]!.id]: 1.5 })
  ok('com a imagem batendo, a cena sem etiqueta entra', comImagem.includes('casamento'), comImagem.join(','))
  ok('a cena com os dois nomes e a imagem batendo continua na frente', comImagem[0] === 'festa', comImagem.join(','))
  ok('ceu sem destaque continua de fora', !comImagem.includes('ceu'), comImagem.join(','))
  const motivo = selectClips(linhas, clips, { mode: 'theory', descriptions: descricoes, visao: [{ [clips[1]!.id]: 3.2 }] })[0]!.candidates.find(
    (c) => c.clip.shot === 'casamento',
  )?.reason
  ok('o motivo diz o que a imagem mostra', /casamento diante de um altar/.test(motivo ?? ''), motivo)
}

if (falhas > 0) {
  console.log(`\n${falhas} FALHA(S)`)
  process.exit(1)
}
console.log('\nTUDO PASSOU')
