/**
 * "DO MEU JEITO" (shared/meu-jeito.ts): o resumo de um projeto ve o que e
 * abertura, musica e som de corte (e a cor); o perfil tira as regras; o plano
 * poe tudo num video novo sem atropelar som nenhum.
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-meu-jeito.ts`.
 */
import { AJUSTE_DE_COR_PADRAO } from '../../shared/contract.ts'
import {
  cortesDoProjeto,
  episodioDaImagem,
  montarPerfil,
  perfilPronto,
  planejarMeuJeito,
  PREFIXO_DO_MEU_JEITO,
  resumirProjeto,
  type ProjetoParaResumir,
} from '../../shared/meu-jeito.ts'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

const COR = { ...AJUSTE_DE_COR_PADRAO, saturacao: 0.2, contraste: 0.1 }
// Um video de 60 s com um corte a cada 2 s; o episodio troca a cada 10 s.
function projeto(n: number, comCor = true): ProjetoParaResumir {
  const scenes = Array.from({ length: 30 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, imageIndex: i }))
  const images = scenes.map((_, i) => ({ path: `D:\\Animes\\X\\S01E0${Math.floor(i / 5)}\\shots\\${i}.mp4` }))
  return {
    audio: { durationSec: 60 },
    plan: { scenes },
    images,
    trilhas: [
      { path: 'D:\\SFX\\Abertura.mp3', fileName: 'Abertura.mp3', faixa: 0, at: 0, durationSec: 3, usarSec: 2.8, gainDb: -5 },
      { path: 'D:\\SFX\\Musica.mp3', fileName: 'Musica.mp3', faixa: 2, at: 4, durationSec: 120, usarSec: 56, gainDb: -20 },
      // whoosh 0,2 s antes de cortes que trocam de episodio (10, 20, 30 s)
      ...[10, 20, 30].map((t) => ({ path: 'D:\\SFX\\Whoosh.mp3', fileName: 'Whoosh.mp3', faixa: 1, at: t - 0.2, durationSec: 0.8, usarSec: 0.6, gainDb: -5 })),
      // riser que TERMINA num corte
      { path: 'D:\\SFX\\Riser.mp3', fileName: 'Riser.mp3', faixa: 1, at: 50 - 1.8, durationSec: 1.8, usarSec: 1.8, gainDb: -3 },
      // um som que so aparece neste projeto (acaso, nao jeito)
      { path: `D:\\SFX\\Unico${n}.mp3`, fileName: `Unico${n}.mp3`, faixa: 3, at: 33, durationSec: 1, usarSec: 1 },
      // o que o proprio botao pos nao ensina
      { id: `${PREFIXO_DO_MEU_JEITO}x`, path: 'D:\\SFX\\Auto.mp3', fileName: 'Auto.mp3', faixa: 4, at: 12, durationSec: 1, usarSec: 1 },
    ],
    sobreposicoes: comCor ? [{ tipo: 'ajuste', at: 0, usarSec: 60, cor: COR }] : [],
  }
}

ok('episodio: a pasta de cima da shots', episodioDaImagem('D:\\Animes\\X\\S01E06\\shots\\0161.mp4') === 'X/S01E06')
ok('episodio: print solto, a propria pasta', episodioDaImagem('C:\\prints\\Kiwi\\a.png') === 'prints/Kiwi')
const cortes = cortesDoProjeto(projeto(0))
ok('os cortes: um a cada 2 s, sem o comeco', cortes.length === 29 && cortes[0]!.t === 2)
ok('troca de episodio a cada 10 s', cortes.filter((c) => c.trocaDeEpisodio).map((c) => c.t).join(',') === '10,20,30,40,50')

const r = resumirProjeto(projeto(0), 1)!
const whoosh = r.sons.find((s) => s.nome === 'Whoosh.mp3')!
ok('resumo: o whoosh encosta no corte 0,2 s depois do comeco', Math.abs((whoosh.corteNoInicio ?? 0) - 0.2) < 1e-6 && whoosh.trocaDeEpisodio)
ok('resumo: o riser encosta no corte pelo FIM', r.sons.find((s) => s.nome === 'Riser.mp3')!.corteNoFim === 0)
ok('resumo: o que o botao pos fica de fora', !r.sons.some((s) => s.nome === 'Auto.mp3'))
ok('resumo: a camada que cobre o video e a cor', r.cor?.saturacao === 0.2)
ok('resumo: sem duracao gravada, vale o fim do ultimo bloco', resumirProjeto({ ...projeto(0), audio: { path: 'x' } }, 1)?.duracaoSec === 60)

const perfil = montarPerfil([0, 1, 2, 3].map((n) => resumirProjeto(projeto(n), n)!))
ok('perfil: abertura', perfil.abertura.map((s) => s.nome).join() === 'Abertura.mp3')
ok('perfil: musica, comecando onde ele comeca', perfil.musica[0]?.nome === 'Musica.mp3' && Math.abs(perfil.musica[0].comeco - 4 / 60) < 1e-6)
ok('perfil: sons de corte', perfil.cortes.map((s) => s.nome).sort().join() === 'Riser.mp3,Whoosh.mp3')
ok('perfil: o whoosh prefere troca de episodio', perfil.cortes.find((s) => s.nome === 'Whoosh.mp3')!.trocaDeEpisodio === 1)
ok('perfil: o riser ancora pelo fim', perfil.cortes.find((s) => s.nome === 'Riser.mp3')!.ancora === 'fim')
ok('perfil: som de um projeto so nao entra', ![...perfil.abertura, ...perfil.musica, ...perfil.cortes].some((s) => s.nome.startsWith('Unico')))
ok('perfil: volume e faixa de sempre', perfil.musica[0]!.gainDb === -20 && perfil.musica[0]!.faixa === 2)
ok('perfil: a cor, usada em 4', perfil.cor?.usos === 4)
ok('perfil: cor em menos de 3 projetos nao conta', montarPerfil([0, 1, 2].map((n) => resumirProjeto(projeto(n, n === 0), n)!)).cor === null)
ok('pronto com 3 videos com som; nao com 2', perfilPronto(perfil) && !perfilPronto(montarPerfil([0, 1].map((n) => resumirProjeto(projeto(n), n)!))))

// Um video novo de 60 s, cortes a cada 3 s, episodio trocando a cada 12 s, e um som dele em A2 de 20 a 25 s.
const novo = {
  duracaoSec: 60,
  cortes: Array.from({ length: 19 }, (_, i) => ({ t: (i + 1) * 3, trocaDeEpisodio: ((i + 1) * 3) % 12 === 0 })),
  ocupado: [{ faixa: 1, at: 20, fim: 25 }],
  semente: 'narracao.mp3',
}
const plano = planejarMeuJeito(perfil, novo)
const nomes = plano.sons.map((s) => s.nome)
ok('plano: abertura no zero', plano.sons.find((s) => s.papel === 'abertura')?.at === 0)
const mus = plano.sons.find((s) => s.papel === 'musica')!
ok('plano: musica num corte perto de onde ele comeca, ate o fim', mus.at === 3 && Math.abs(mus.at + mus.usarSec - 60) < 1e-6, `${mus.at} + ${mus.usarSec}`)
ok('plano: whooshes e risers na quantidade dele (3 e 1)', nomes.filter((n) => n === 'Whoosh.mp3').length === 3 && nomes.filter((n) => n === 'Riser.mp3').length === 1, nomes.join(','))
const deCorte = plano.sons.filter((s) => s.papel === 'corte')
ok(
  'plano: nenhum som de corte atropela outro',
  deCorte.every((a, i) => deCorte.every((b, j) => i === j || a.at >= b.at + b.usarSec || a.at + a.usarSec <= b.at)),
)
ok('plano: o mesmo som nao volta antes de 6 s', deCorte.filter((s) => s.nome === 'Whoosh.mp3').every((a, i, l) => l.every((b, j) => i === j || Math.abs(a.at - b.at) >= 6)))
ok('plano: whoosh 0,2 s antes do corte', deCorte.filter((s) => s.nome === 'Whoosh.mp3').every((s) => novo.cortes.some((c) => Math.abs(c.t - 0.2 - s.at) < 1e-6)))
ok('plano: riser TERMINA no corte', deCorte.filter((s) => s.nome === 'Riser.mp3').every((s) => novo.cortes.some((c) => Math.abs(c.t - (s.at + s.usarSec)) < 1e-6)))
ok(
  'plano: nao poe nada em cima do som que ja estava em A2',
  plano.sons.every((s) => !(s.faixa === 1 && s.at < 25 && s.at + s.usarSec > 20)),
)
ok('plano: a cor vem junto', plano.cor?.saturacao === 0.2)
ok('plano: a mesma narracao, a mesma escolha', JSON.stringify(planejarMeuJeito(perfil, novo)) === JSON.stringify(plano))
const longo = planejarMeuJeito(perfil, { ...novo, duracaoSec: 120, cortes: Array.from({ length: 39 }, (_, i) => ({ t: (i + 1) * 3, trocaDeEpisodio: false })) })
ok('plano: video com o dobro do tempo, o dobro de sons de corte', longo.sons.filter((s) => s.papel === 'corte').length === 8, String(longo.sons.filter((s) => s.papel === 'corte').length))

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
