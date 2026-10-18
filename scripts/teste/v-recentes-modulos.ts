/**
 * A ETIQUETA DO MODULO NOS "PROJETOS RECENTES".
 * `npx tsx --tsconfig tsconfig.web.json scripts/teste/v-recentes-modulos.ts`
 * (o web: o card e .tsx e usa o `@/`).
 *
 * - modulosDoProjeto: os ids com `modulos.<id>` nao vazio na raiz ou num item
 *   (trecho de audio, clipe); projeto sem dado de modulo da lista vazia;
 * - rotulosDoRecente: so os modulos LIGADOS com dado no projeto; entrada
 *   antiga (sem `modulos`) e modulo desligado nao mostram nada;
 * - o card: sem etiqueta e o de sempre; com etiqueta, a etiqueta e a UNICA
 *   diferenca, dentro do botao (apaga junto quando o arquivo sumiu).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { modulosDoProjeto } from '../../shared/project-file.ts'
import { CartaoRecente, rotulosDoRecente } from '../../src/components/CartaoRecente.tsx'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}
const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// ------------------------------------------------- quais modulos tem dado
console.log('modulosDoProjeto')
const recap = { versao: 1, episodio: 'S01E01' }
const semNada = { trilhas: [{}, { modulos: undefined }], sobreposicoes: [{}] }
ok('projeto do Dangai (sem modulos) -> []', igual(modulosDoProjeto(semNada), []))
ok('modulos vazio na raiz -> []', igual(modulosDoProjeto({ ...semNada, modulos: {} }), []))
ok(
  'modulos.recap vazio ({}, [], null, "") -> []',
  igual(modulosDoProjeto({ modulos: { recap: {} }, trilhas: [{ modulos: { recap: [] } }], sobreposicoes: [{ modulos: { recap: null, outro: '' } }] }), []),
)
ok('modulos.recap na raiz -> [recap]', igual(modulosDoProjeto({ ...semNada, modulos: { recap } }), ['recap']))
ok(
  'dado so num trecho de audio -> [recap]',
  igual(modulosDoProjeto({ modulos: {}, trilhas: [{}, { modulos: { recap: { papel: 'musica' } } }], sobreposicoes: [] }), ['recap']),
)
ok(
  'dado so num clipe da faixa de video -> [recap]',
  igual(modulosDoProjeto({ trilhas: [], sobreposicoes: [{}, { modulos: { recap: { papel: 'cor' } } }] }), ['recap']),
)
ok(
  'raiz e itens juntos: cada id uma vez, em ordem',
  igual(
    modulosDoProjeto({
      modulos: { recap },
      trilhas: [{ modulos: { recap: { papel: 'voz' } } }, { modulos: { outro: 1 } }],
      sobreposicoes: [{ modulos: { recap: { papel: 'cor' } } }],
    }),
    ['outro', 'recap'],
  ),
)

// ------------------------------------------------- as etiquetas do card
console.log('rotulosDoRecente')
const moduloRecap = { id: 'recap', rotuloDoProjeto: { texto: 'Recap' } }
ok('ligado e com dado -> [Recap]', igual(rotulosDoRecente({ modulos: ['recap'] }, [moduloRecap]), ['Recap']))
ok('desligado (fora dos ligados) -> []', igual(rotulosDoRecente({ modulos: ['recap'] }, []), []))
ok('entrada antiga, sem o campo -> []', igual(rotulosDoRecente({}, [moduloRecap]), []))
ok('projeto sem dado deste modulo -> []', igual(rotulosDoRecente({ modulos: ['outro'] }, [moduloRecap]), []))
ok('modulo ligado sem rotuloDoProjeto -> []', igual(rotulosDoRecente({ modulos: ['recap'] }, [{ id: 'recap' }]), []))
ok(
  'dois modulos: na ordem do registro',
  igual(
    rotulosDoRecente({ modulos: ['outro', 'recap'] }, [moduloRecap, { id: 'outro', rotuloDoProjeto: { texto: 'Outro' } }]),
    ['Recap', 'Outro'],
  ),
)

// ------------------------------------------------- o card desenhado
console.log('CartaoRecente')
const recente = {
  path: 'G:\\x\\Nia Liston S01E01.dangai',
  nome: 'Nia Liston S01E01',
  capa: 'data:image/webp;base64,AAAA',
  // em 0 = sem o "ha N min": o texto nao depende do relogio.
  em: 0,
  blocos: 27,
  duracaoSec: 81,
}
const desenhar = (rotulos: string[], sumiu = false): string =>
  renderToStaticMarkup(
    createElement(CartaoRecente, { recente, sumiu, rotulos, abrir: () => {}, esquecer: () => {} }),
  )
const etiquetas = (html: string): number => html.split('data-rotulo-do-projeto').length - 1
const semEtiqueta = (html: string): string =>
  html.replace(/<span class="absolute left-1\.5 top-1\.5 flex gap-1">(<span [^>]*>[^<]*<\/span>)+<\/span>/, '')

const sem = desenhar([])
const com = desenhar(['Recap'])
ok('sem etiqueta: nada de rotulo', etiquetas(sem) === 0 && !sem.includes('>Recap<'))
ok('o card de sempre: nome, blocos e duracao', sem.includes('Nia Liston S01E01') && sem.includes('27 blocos · 1:21'))
ok('com etiqueta: um "Recap"', etiquetas(com) === 1 && com.includes('>Recap<'))
ok('a etiqueta e a unica diferenca', semEtiqueta(com) === sem)
ok('a etiqueta fica dentro do botao que abre', com.indexOf('data-rotulo-do-projeto') < com.indexOf('</button>'))
const sumiu = desenhar(['Recap'], true)
ok(
  'arquivo sumido: a etiqueta continua dentro do botao apagado',
  etiquetas(sumiu) === 1 && sumiu.includes('disabled=""') && sumiu.includes('arquivo nao encontrado'),
)
ok('dois modulos: duas etiquetas', etiquetas(desenhar(['Recap', 'Outro'])) === 2)

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
