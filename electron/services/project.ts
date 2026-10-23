import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  autosaveSchemaQuePreserva as autosaveSchema,
  projectFileSchemaQuePreserva as projectFileSchema,
  PROJECT_FILE_VERSION,
  versaoParaGravar,
  type FileReference,
  type OpenedProject,
  type ProjectFile,
} from '@shared/project-file'

/**
 * Ler e gravar o .dangai.
 *
 * Duas garantias que valem mais que qualquer recurso daqui:
 *
 *  - gravacao atomica (temporario + rename). Um app que morre no meio de um
 *    save nao pode transformar o projeto salvo em JSON pela metade -- seria
 *    perder o trabalho justamente na hora de protege-lo;
 *  - o arquivo aberto e validado antes de virar estado. JSON editado na mao,
 *    truncado por um pendrive ou vindo de uma versao futura vira erro com
 *    mensagem, nunca um app com plano meio montado.
 */

let autosavePath: string | null = null

export function configureProjects(userDataDir: string): void {
  autosavePath = join(userDataDir, 'autosave.dangai')
}

/**
 * A geracao anterior do autosave, guardada quando a nova PERDE conteudo.
 *
 * Em 12/09/2026 a leitura do roteiro morreu no meio, remontou o plano do zero
 * e deixou o estado com 49 blocos padrao e ZERO legendas. O autosave, fazendo
 * o trabalho dele, gravou isso por cima de um projeto com 48 blocos ajustados,
 * 166 legendas, duas cameras livres, uma tela dividida, doze trechos de clipe
 * movidos e quatro curvas desenhadas a mao. Sem uma copia feita por fora, o
 * trabalho de uma tarde teria acabado ali.
 *
 * O autosave existe para proteger exatamente esse tipo de coisa, e nao pode
 * ser ele o caminho da perda.
 */
function anteriorPath(): string {
  if (!autosavePath) throw new Error('Projetos não configurados')
  return autosavePath.replace(/\.dangai$/, '-anterior.dangai')
}

function lerAnterior(): { projectPath: string | null; file: ProjectFile } | null {
  try {
    const path = anteriorPath()
    if (!existsSync(path)) return null
    const parsed = autosaveSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * O estado novo perdeu conteudo que o usuario nao mandou perder?
 *
 * Conta o que custa CARO refazer: legenda corrigida na mao, bloco ajustado,
 * imagem escolhida. Uma queda nesses numeros sem ninguem ter pedido e o sinal
 * de que uma operacao abortou no meio e levou trabalho junto.
 *
 * O criterio e conservador de proposito -- so dispara com perda GRANDE (mais
 * de um terco, ou tudo). Apagar um bloco, mesclar duas legendas ou tirar uma
 * imagem sao edicoes normais, e nao podem encher o disco de copias.
 */
function perdeuTrabalho(velho: ProjectFile, novo: ProjectFile): boolean {
  const caiuMuito = (antes: number, depois: number): boolean =>
    antes > 0 && (depois === 0 || depois < antes * (2 / 3))

  return (
    caiuMuito(velho.captions.length, novo.captions.length) ||
    caiuMuito(velho.plan?.scenes.length ?? 0, novo.plan?.scenes.length ?? 0) ||
    caiuMuito(velho.images.length, novo.images.length)
  )
}

// ------------------------------------------------------------------- gravar

export function saveProjectFile(path: string, file: ProjectFile): void {
  const base = dirname(path)

  // O `rel` e recalculado aqui e nao no renderer: so aqui se sabe para onde o
  // arquivo esta indo. "Salvar como" numa outra pasta reescreve todos eles.
  const gravado: ProjectFile = {
    ...file,
    version: versaoParaGravar(file),
    savedAt: new Date().toISOString(),
    audio: withRel(file.audio, base),
    subtitle: file.subtitle ? withRel(file.subtitle, base) : null,
    music: file.music ? withRel(file.music, base) : null,
    images: file.images.map((image) => ({ ...image, ...withRel(image, base) })),
  }

  writeAtomic(path, JSON.stringify(gravado, null, 2))
}

/**
 * Salva a rede de seguranca no userData.
 *
 * Sem dialogo, sem nome, sem o usuario pedir: existe para quando o app fecha
 * sozinho, e nesse momento nao ha ninguem para responder um "onde salvo?".
 */
export function writeAutosave(file: ProjectFile, projectPath: string | null): void {
  if (!autosavePath) throw new Error('Projetos não configurados')

  /*
   * Antes de sobrescrever: o que esta saindo valia mais do que o que entra?
   *
   * Preserva, e nao bloqueia. Bloquear exigiria adivinhar a intencao -- e
   * apagar tudo TAMBEM e uma edicao legitima. Guardando a geracao anterior, o
   * autosave continua refletindo o estado atual (que e o contrato dele) e
   * ninguem perde o que tinha.
   *
   * So a ultima geracao boa fica: nao e historico, e uma rede.
   */
  try {
    if (existsSync(autosavePath)) {
      const anterior = autosaveSchema.safeParse(
        JSON.parse(readFileSync(autosavePath, 'utf8')),
      )
      if (anterior.success && perdeuTrabalho(anterior.data.file, file)) {
        /*
         * Quem ja esta guardado tem prioridade.
         *
         * Depois da primeira perda o autosave passa a conter o estado
         * degradado, e uma segunda queda copiaria ESSE por cima do bom --
         * apagando a copia de resgate com a propria coisa da qual ela
         * resgata. Como o autosave regrava a cada 1,2s, isso levaria segundos.
         */
        const guardado = lerAnterior()
        if (!guardado || !perdeuTrabalho(guardado.file, anterior.data.file)) {
          copyFileSync(autosavePath, anteriorPath())
        }
      }
    }
  } catch {
    // Um autosave ilegivel nao pode impedir o proximo de ser gravado: e o novo
    // que tem o trabalho de agora.
  }

  // O `rel` de cada arquivo e calculado contra a pasta do projeto de destino,
  // que aqui pode nem existir ainda. Fica o caminho absoluto, que e o unico que
  // faz sentido para algo guardado no userData.
  const conteudo = {
    projectPath,
    file: { ...file, version: versaoParaGravar(file) },
  }
  writeAtomic(autosavePath, JSON.stringify(conteudo, null, 2))
}

export function clearAutosave(): void {
  if (!autosavePath) return
  rmSync(autosavePath, { force: true })
  // A copia de resgate vai junto: sem o autosave que ela acompanha, ela so
  // teria como ressuscitar um projeto que o usuario ja fechou.
  rmSync(anteriorPath(), { force: true })
}

function writeAtomic(path: string, conteudo: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, conteudo, 'utf8')
  renameSync(temp, path)
}

// --------------------------------------------------------------------- ler

export function openProjectFile(path: string): OpenedProject {
  const file = parse(readFileSync(path, 'utf8'), basename(path))
  const avisos: string[] = []
  return { path, file: relocate(file, dirname(path), basename(path), avisos), avisos }
}

/**
 * Le o autosave, ou null se nao houver nada recuperavel.
 *
 * Nunca lanca: isto roda na abertura do app, e um autosave corrompido nao pode
 * impedir o programa de subir. Na duvida, o app abre vazio.
 */
export function readAutosave(): OpenedProject | null {
  if (!autosavePath || !existsSync(autosavePath)) return null

  try {
    const parsed = autosaveSchema.safeParse(JSON.parse(readFileSync(autosavePath, 'utf8')))
    if (!parsed.success) return null

    /*
     * Havendo uma geracao preservada, RECUPERA A MAIS COMPLETA.
     *
     * O `-anterior` so existe quando uma gravacao perdeu muito conteudo de uma
     * vez, o que nao acontece em edicao normal -- a presenca dele ja e o sinal
     * de que algo abortou no meio. Recuperar o degradado nessa situacao seria
     * oferecer ao usuario justamente o estrago, e deixar o trabalho bom num
     * arquivo que ele nao tem como adivinhar que existe.
     *
     * Quem apagou de proposito e fechou perde pouco: abre com o material de
     * volta e apaga de novo. O contrario -- abrir sem as legendas de uma tarde
     * -- nao tem desfazer.
     */
    const guardado = lerAnterior()
    /*
     * Mesmo `projectPath`: a copia so responde pelo projeto que ela guardou.
     *
     * Sem essa conferencia, uma copia esquecida do projeto A entraria no lugar
     * do projeto B assim que B ficasse menor que A por uma edicao qualquer --
     * e o usuario abriria o app com o video errado na tela.
     */
    if (
      guardado &&
      guardado.projectPath === parsed.data.projectPath &&
      perdeuTrabalho(guardado.file, parsed.data.file)
    ) {
      // Num try proprio: se o material do preservado tiver saido do lugar, o
      // certo e cair para o autosave normal -- e nao subir o app vazio, que
      // seria transformar uma recuperacao possivel em perda total.
      try {
        const base = guardado.projectPath ? dirname(guardado.projectPath) : null
        const avisos: string[] = []
        const recuperado = relocate(guardado.file, base, 'o trabalho recuperado', avisos)
        // Consumida: o trabalho volta ao estado, e dali o autosave normal
        // assume. Manter a copia a faria reaparecer a cada abertura.
        rmSync(anteriorPath(), { force: true })
        return { path: guardado.projectPath, file: recuperado, avisos }
      } catch {
        /* segue para o autosave atual */
      }
    }

    const { projectPath, file } = parsed.data
    // A pasta base e a do .dangai de origem, quando havia um: o autosave em si
    // mora no userData, e resolver relativo a ele apontaria para o nada.
    const base = projectPath ? dirname(projectPath) : null
    const avisos: string[] = []
    return { path: projectPath, file: relocate(file, base, 'o trabalho recuperado', avisos), avisos }
  } catch {
    return null
  }
}

function parse(raw: string, nome: string): ProjectFile {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`"${nome}" não é um projeto do Dangai válido.`)
  }

  /*
   * A versao e conferida ANTES do schema, e nao so quando ele recusa.
   *
   * Um arquivo do futuro costuma continuar validando: campo novo que o schema
   * atual nao conhece simplesmente e ignorado. Aberto assim, ele parece intacto
   * -- e o proximo save regrava sem os campos que o app desta versao nao
   * entende, apagando em silencio trabalho que o usuario nem sabe que tinha.
   * Recusar e a unica saida que nao perde nada.
   */
  const versao = (json as { version?: unknown } | null)?.version
  if (typeof versao === 'number' && versao > PROJECT_FILE_VERSION) {
    throw new Error(
      `"${nome}" foi salvo por uma versão mais nova do Dangai. Atualize o app e abra de novo.`,
    )
  }

  const parsed = projectFileSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`"${nome}" está corrompido e não pode ser aberto.`)
  }

  return parsed.data
}

/**
 * Aponta cada referencia para onde o arquivo esta agora.
 *
 * O relativo vem primeiro de proposito. Quem copia a pasta do projeto para
 * outro disco quer trabalhar com a copia -- se o caminho absoluto antigo ainda
 * existir, ele aponta para o original, e o usuario editaria a pasta errada sem
 * perceber.
 */
function relocate(file: ProjectFile, base: string | null, nome: string, avisos: string[] = []): ProjectFile {
  const faltando: string[] = []

  const achar = (ref: FileReference): FileReference => {
    const encontrado = locate(ref, base)
    if (!encontrado) faltando.push(ref.fileName)
    return encontrado ? { ...ref, path: encontrado } : ref
  }

  /*
   * Um clipe da biblioteca que uma MESCLA tirou do lugar (0011.mp4 virou parte
   * de 0010-0012.mp4) nao pode deixar o projeto sem abrir -- era o que
   * acontecia com todo projeto que usava um pedaco mesclado depois.
   */
  const acharClipe = (ref: FileReference): FileReference => {
    const encontrado = locate(ref, base)
    if (encontrado) return { ...ref, path: encontrado }
    const mesclado = acharDepoisDaMescla(ref, base)
    if (!mesclado) {
      faltando.push(ref.fileName)
      return ref
    }
    if (!mesclado.exato) {
      avisos.push(
        `${ref.fileName} foi mesclado em ${basename(mesclado.path)} e a lixeira do episódio já foi esvaziada: o bloco usa o clipe mesclado, confira o trecho dele.`,
      )
    }
    return { ...ref, path: mesclado.path }
  }

  const audio = achar(file.audio)
  const images = file.images.map((image) => ({ ...image, ...acharClipe(image) }))
  // Legenda .srt e musica sao acessorios: somem sem quebrar o projeto, ao
  // contrario da narracao e das imagens, que o plano referencia por posicao.
  // Voltam como null e a interface mostra o campo vazio -- melhor que recusar
  // o projeto inteiro por causa de uma faixa que o usuario moveu de pasta.
  const subtitle = file.subtitle ? locate(file.subtitle, base) : null
  const music = file.music ? locate(file.music, base) : null

  if (faltando.length > 0) {
    const lista = faltando.slice(0, 4).join(', ')
    const resto = faltando.length > 4 ? ` e mais ${faltando.length - 4}` : ''
    throw new Error(
      `"${nome}" aponta para ${faltando.length} ${faltando.length === 1 ? 'arquivo que não está' : 'arquivos que não estão'} mais no lugar: ${lista}${resto}. Devolva ${faltando.length === 1 ? 'ele' : 'eles'} para a pasta original ou mova o projeto inteiro junto.`,
    )
  }

  return {
    ...file,
    audio,
    images,
    subtitle: subtitle ? { ...file.subtitle!, path: subtitle } : null,
    music: music ? { ...file.music!, path: music } : null,
  }
}

/**
 * ONDE FOI PARAR um NNNN.mp4 que uma mescla tirou do lugar.
 *
 * 1. O mesclado que COMECA nele (0010 dentro de 0010-0012): mesmo inicio, o
 *    trecho do bloco continua certo -- exato.
 * 2. O proprio pedaco na lixeira do episodio (`_lixeira/<data>/shots/`, a da
 *    mescla do Dangai e a do AnCut), o mais novo primeiro -- exato.
 * 3. O mesclado que o contem no meio: o trecho comeca em outro ponto. Abre,
 *    mas com aviso (exato = false).
 */
function acharDepoisDaMescla(ref: FileReference, base: string | null): { path: string; exato: boolean } | null {
  const m = /^(\d+)\.(mp4|mkv|mov|webm|m4v)$/i.exec(ref.fileName)
  if (!m) return null
  const n = Number(m[1])
  const pastas = [...new Set([dirname(ref.path), ...(base && ref.rel ? [dirname(resolve(base, ref.rel))] : [])])]
  let noMeio: string | null = null
  for (const shots of pastas) {
    if (!existsSync(shots)) continue
    let nomes: string[] = []
    try {
      nomes = readdirSync(shots)
    } catch {
      continue
    }
    for (const outro of nomes) {
      const faixa = /^(\d+)-(\d+)\.(mp4|mkv|mov|webm|m4v)$/i.exec(outro)
      if (!faixa) continue
      const a = Number(faixa[1])
      const b = Number(faixa[2])
      if (n === a) return { path: join(shots, outro), exato: true }
      if (n > a && n <= b) noMeio ??= join(shots, outro)
    }
    const lixeira = join(dirname(shots), '_lixeira')
    try {
      for (const vez of readdirSync(lixeira).sort().reverse()) {
        const pedaco = join(lixeira, vez, basename(shots), ref.fileName)
        if (existsSync(pedaco)) return { path: pedaco, exato: true }
      }
    } catch {
      /* sem lixeira */
    }
  }
  return noMeio ? { path: noMeio, exato: false } : null
}

function locate(ref: FileReference, base: string | null): string | null {
  if (base && ref.rel) {
    const candidato = resolve(base, ref.rel)
    if (existsSync(candidato)) return candidato
  }
  return existsSync(ref.path) ? ref.path : null
}

/**
 * Calcula o caminho relativo, mas so para arquivo que mora SOB a pasta do
 * projeto. Um `../../..` atravessando a arvore inteira nao sobrevive a mover a
 * pasta, e guardar isso daria uma falsa sensacao de portabilidade.
 */
function withRel(ref: FileReference, base: string): FileReference {
  const rel = relative(base, ref.path)
  const dentro = rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
  return { ...ref, rel: dentro ? rel.split(sep).join('/') : null }
}
