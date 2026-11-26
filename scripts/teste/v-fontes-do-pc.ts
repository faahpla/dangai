/**
 * AS FONTES DO PC NA LEGENDA (26/11).
 * `npx tsx --tsconfig tsconfig.node.json scripts/teste/v-fontes-do-pc.ts`.
 *
 * - ler familia e estilo de dentro do arquivo (tabelas `name` e `OS/2`), com
 *   o nome do estilo de reserva quando nao ha OS/2, e as fontes de simbolo
 *   marcadas;
 * - juntar os arquivos por familia (normal, negrito, italico, negrito italico),
 *   a do usuario ganhando da do sistema;
 * - qual arquivo a legenda carrega para o estilo pedido, e o que se faz
 *   na marra (forcar negrito, italico sem arquivo italico);
 * - achar a fonte pelo nome ("pc:Arial", sem diferenca de maiusculas);
 * - projeto e estilo antigos abrem sem o estilo da fonte;
 * - no Windows de verdade (aqui e no GitHub), a Arial com os quatro arquivos.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  agruparPorFamilia,
  esquecerFontesDoPc,
  fontesDoPc,
  lerDadosDaFonte,
  pastasDeFontes,
} from '../../electron/services/fontes-do-pc'
import {
  captionStyleSchema,
  ESTILO_DA_FONTE_PADRAO,
  fonteDaLegenda,
  nomeDaFonteNaTela,
  type EstiloDaFonte,
  type FonteEscolhida,
} from '../../shared/contract'
import { projectFileSchema } from '../../shared/project-file'
import { resolverFonte } from '../../src/store/projeto/estilo'

let falhas = 0
const ok = (nome: string, c: boolean, d = ''): void => {
  console.log((c ? '  ok    ' : '  FALHA ') + nome + (d ? `  -- ${d}` : ''))
  if (!c) falhas++
}

// ------------------------------------------------- uma fonte minima, na mao

/**
 * Um arquivo sfnt com so as tabelas `name` (familia = id 1, estilo = id 2) e,
 * se pedida, `OS/2` com o fsSelection. E tudo o que o leitor olha.
 */
function fonte(o: { familia: string; estilo: string; sel?: number; simbolo?: boolean; mac?: boolean }): Uint8Array {
  const registros: { plataforma: number; cod: number; lingua: number; id: number; bytes: number[] }[] = []
  for (const [id, texto] of [[1, o.familia], [2, o.estilo]] as const) {
    if (o.mac) registros.push({ plataforma: 1, cod: 0, lingua: 0, id, bytes: [...texto].map((c) => c.charCodeAt(0)) })
    else
      registros.push({
        plataforma: 3,
        cod: o.simbolo ? 0 : 1,
        lingua: 0x409,
        id,
        bytes: [...texto].flatMap((c) => [0, c.charCodeAt(0)]),
      })
  }
  const textos = registros.flatMap((r) => r.bytes)
  const name: number[] = []
  const u16 = (a: number[], v: number): void => {
    a.push((v >> 8) & 0xff, v & 0xff)
  }
  u16(name, 0)
  u16(name, registros.length)
  u16(name, 6 + registros.length * 12)
  let off = 0
  for (const r of registros) {
    for (const v of [r.plataforma, r.cod, r.lingua, r.id, r.bytes.length, off]) u16(name, v)
    off += r.bytes.length
  }
  name.push(...textos)
  const tabelas: [string, number[]][] = [['name', name]]
  if (o.sel !== undefined) {
    const os2 = new Array(78).fill(0)
    os2[62] = (o.sel >> 8) & 0xff
    os2[63] = o.sel & 0xff
    tabelas.push(['OS/2', os2])
  }
  const cab: number[] = [0, 1, 0, 0]
  u16(cab, tabelas.length)
  u16(cab, 0)
  u16(cab, 0)
  u16(cab, 0)
  let pos = 12 + tabelas.length * 16
  const corpo: number[] = []
  for (const [tag, dados] of tabelas) {
    cab.push(...[...tag].map((c) => c.charCodeAt(0)))
    cab.push(0, 0, 0, 0)
    const u32 = (v: number): void => {
      cab.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
    }
    u32(pos)
    u32(dados.length)
    corpo.push(...dados)
    pos += dados.length
  }
  return new Uint8Array([...cab, ...corpo])
}

console.log('ler a fonte')
const r = lerDadosDaFonte(fonte({ familia: 'Minha Fonte', estilo: 'Regular', sel: 1 << 6 }))
ok('normal: familia e estilo', r?.familia === 'Minha Fonte' && !r.negrito && !r.italico, JSON.stringify(r))
const b = lerDadosDaFonte(fonte({ familia: 'Minha Fonte', estilo: 'Bold', sel: 1 << 5 }))
ok('negrito pelo fsSelection', b?.negrito === true && !b.italico)
const bi = lerDadosDaFonte(fonte({ familia: 'Minha Fonte', estilo: 'Bold Italic', sel: (1 << 5) | 1 }))
ok('negrito italico', bi?.negrito === true && bi.italico === true)
const obliquo = lerDadosDaFonte(fonte({ familia: 'X', estilo: 'Oblique', sel: 1 << 9 }))
ok('obliquo conta como italico', obliquo?.italico === true)
const semOs2 = lerDadosDaFonte(fonte({ familia: 'Velha', estilo: 'Bold Italic' }))
ok('sem OS/2: o nome do estilo decide', semOs2?.negrito === true && semOs2.italico === true)
const mac = lerDadosDaFonte(fonte({ familia: 'Do Mac', estilo: 'Italic', mac: true }))
ok('nome so na tabela do Mac', mac?.familia === 'Do Mac' && mac.italico === true)
ok('fonte de simbolo marcada', lerDadosDaFonte(fonte({ familia: 'Wingdings', estilo: 'Regular', simbolo: true }))?.simbolo === true)
ok('lixo nao e fonte', lerDadosDaFonte(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])) === null)

console.log('juntar por familia')
const familias = agruparPorFamilia([
  { familia: 'Arial', negrito: false, italico: false, arquivo: 'sis/arial.ttf' },
  { familia: 'Arial', negrito: true, italico: false, arquivo: 'sis/arialbd.ttf' },
  { familia: 'arial', negrito: true, italico: true, arquivo: 'sis/arialbi.ttf' },
  { familia: 'Bebas Neue', negrito: false, italico: false, arquivo: 'sis/bebas.ttf' },
  { familia: 'Bebas Neue', negrito: false, italico: false, arquivo: 'usuario/BebasNeue.ttf' },
])
ok('duas familias, em ordem', familias.map((f) => f.familia).join() === 'Arial,Bebas Neue')
ok('Arial com normal, negrito e negrito italico', Object.keys(familias[0]!.arquivos).sort().join() === 'b,bi,r')
ok('a do usuario ganha da do sistema', familias[1]!.arquivos.r === 'usuario/BebasNeue.ttf')

console.log('o arquivo e a sintese para cada estilo')
const e = (p: Partial<EstiloDaFonte>): EstiloDaFonte => ({ ...ESTILO_DA_FONTE_PADRAO, ...p })
const arial: FonteEscolhida = { nome: 'pc:Arial', url: 'u/r', variantes: { r: 'u/r', b: 'u/b', i: 'u/i', bi: 'u/bi' } }
const impact: FonteEscolhida = { nome: 'pc:Impact', url: 'u/impact', variantes: { r: 'u/impact' } }
const normal = fonteDaLegenda(arial, e({}))
ok('normal: o arquivo normal, sem sintese', normal.font?.url === 'u/r' && !normal.sintese.negrito && !normal.sintese.italico)
const neg = fonteDaLegenda(arial, e({ negrito: true }))
ok('negrito: o arquivo negrito de verdade', neg.font?.url === 'u/b' && !neg.sintese.negrito)
const negIt = fonteDaLegenda(arial, e({ negrito: true, italico: true }))
ok('negrito + italico: o negrito italico', negIt.font?.url === 'u/bi' && !negIt.sintese.italico)
ok('cada arquivo e uma familia CSS propria', new Set([normal, neg, negIt].map((x) => x.font?.family)).size === 3)
const impactNeg = fonteDaLegenda(impact, e({ negrito: true }))
ok('sem negrito na fonte: fica a normal e nao engrossa sozinha', impactNeg.font?.url === 'u/impact' && !impactNeg.sintese.negrito)
const impactForcado = fonteDaLegenda(impact, e({ forcarNegrito: true }))
ok('forcar negrito: engrossa na marra', impactForcado.sintese.negrito)
ok('forcar por cima do negrito de verdade', fonteDaLegenda(arial, e({ negrito: true, forcarNegrito: true })).sintese.negrito)
const impactIt = fonteDaLegenda(impact, e({ italico: true }))
ok('italico sem arquivo italico: o Chrome inclina', impactIt.sintese.italico)
ok('italico com arquivo italico: nao inclina de novo', !fonteDaLegenda(arial, e({ italico: true })).sintese.italico)
const komika = fonteDaLegenda(null, e({ italico: true, forcarNegrito: true }))
ok('a embutida: sem arquivo, mas com a sintese', komika.font === null && komika.sintese.negrito && komika.sintese.italico)
const daPasta = fonteDaLegenda({ nome: 'Bangers.ttf', url: 'u/bangers' }, e({}))
ok('a da pasta: a familia de sempre (o nome do arquivo)', daPasta.font?.family === 'Bangers' && daPasta.font.url === 'u/bangers')
ok('nome na tela sem prefixo nem extensao', nomeDaFonteNaTela('pc:Arial') === 'Arial' && nomeDaFonteNaTela('Bangers.ttf') === 'Bangers')
ok('sem URL ainda (projeto abrindo): a embutida', fonteDaLegenda({ nome: 'pc:Arial', url: '' }, e({})).font === null)

console.log('achar pelo nome')
const lista = [{ familia: 'Arial', variantes: { r: 'u/r', b: 'u/b' } }, { familia: 'Só Negrito', variantes: { b: 'u/sb' } }]
ok('pc:arial acha a Arial (sem maiusculas)', resolverFonte('pc:arial', [], lista)?.nome === 'pc:Arial')
ok('familia so com negrito: a url e o negrito', resolverFonte('pc:Só Negrito', [], lista)?.url === 'u/sb')
ok('desinstalada: null', resolverFonte('pc:Sumiu', [], lista) === null)
ok('lista do PC ainda nao lida: null', resolverFonte('pc:Arial', [], null) === null)
ok('a da pasta continua pelo arquivo', resolverFonte('Bangers.ttf', [{ nome: 'Bangers.ttf', url: 'u/x' }], lista)?.url === 'u/x')

console.log('projeto e estilo antigos')
const velho = projectFileSchema.shape.captionFontEstilo.safeParse(undefined)
ok('projeto sem o estilo da fonte abre sem negrito nem italico', velho.success && JSON.stringify(velho.data) === JSON.stringify(ESTILO_DA_FONTE_PADRAO))
const estiloQuebrado = captionStyleSchema.parse({ fontNome: 'pc:Arial', fontEstilo: { negrito: 'sim' } })
ok('estilo com lixo cai no padrao campo a campo', estiloQuebrado.fontEstilo?.negrito === false && estiloQuebrado.fontNome === 'pc:Arial')

console.log('no Windows de verdade')
const sistema = pastasDeFontes()[0]
if (sistema && existsSync(join(sistema, 'arial.ttf'))) {
  void (async () => {
    esquecerFontesDoPc()
    const t = Date.now()
    const todas = await fontesDoPc()
    const a = todas.find((f) => f.familia === 'Arial')
    ok('a Arial com os quatro arquivos', Object.keys(a?.arquivos ?? {}).sort().join() === 'b,bi,i,r', JSON.stringify(a?.arquivos))
    ok('sem Wingdings nem os icones do Windows', !todas.some((f) => /wingdings|webdings|marlett|mdl2|fluent icons/i.test(f.familia)))
    ok('rapido (menos de 5 s)', Date.now() - t < 5000, `${Date.now() - t} ms, ${todas.length} familias`)
    fim()
  })()
} else {
  console.log('  (sem C:\\Windows\\Fonts\\arial.ttf aqui: pulado)')
  fim()
}

function fim(): void {
  if (falhas > 0) {
    console.log(`\n${falhas} falha(s)`)
    process.exit(1)
  }
  console.log('\ntudo ok')
}
