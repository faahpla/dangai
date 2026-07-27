import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  autosaveSchema,
  projectFileSchema,
  PROJECT_FILE_VERSION,
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

// ------------------------------------------------------------------- gravar

export function saveProjectFile(path: string, file: ProjectFile): void {
  const base = dirname(path)

  // O `rel` e recalculado aqui e nao no renderer: so aqui se sabe para onde o
  // arquivo esta indo. "Salvar como" numa outra pasta reescreve todos eles.
  const gravado: ProjectFile = {
    ...file,
    version: PROJECT_FILE_VERSION,
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
  if (!autosavePath) throw new Error('Projetos nao configurados')

  // O `rel` de cada arquivo e calculado contra a pasta do projeto de destino,
  // que aqui pode nem existir ainda. Fica o caminho absoluto, que e o unico que
  // faz sentido para algo guardado no userData.
  const conteudo = {
    projectPath,
    file: { ...file, version: PROJECT_FILE_VERSION },
  }
  writeAtomic(autosavePath, JSON.stringify(conteudo, null, 2))
}

export function clearAutosave(): void {
  if (!autosavePath) return
  rmSync(autosavePath, { force: true })
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
  return { path, file: relocate(file, dirname(path), basename(path)) }
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

    const { projectPath, file } = parsed.data
    // A pasta base e a do .dangai de origem, quando havia um: o autosave em si
    // mora no userData, e resolver relativo a ele apontaria para o nada.
    const base = projectPath ? dirname(projectPath) : null
    return { path: projectPath, file: relocate(file, base, 'o trabalho recuperado') }
  } catch {
    return null
  }
}

function parse(raw: string, nome: string): ProjectFile {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`"${nome}" nao e um projeto do Dangai valido.`)
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
      `"${nome}" foi salvo por uma versao mais nova do Dangai. Atualize o app e abra de novo.`,
    )
  }

  const parsed = projectFileSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`"${nome}" esta corrompido e nao pode ser aberto.`)
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
function relocate(file: ProjectFile, base: string | null, nome: string): ProjectFile {
  const faltando: string[] = []

  const achar = (ref: FileReference): FileReference => {
    const encontrado = locate(ref, base)
    if (!encontrado) faltando.push(ref.fileName)
    return encontrado ? { ...ref, path: encontrado } : ref
  }

  const audio = achar(file.audio)
  const images = file.images.map((image) => ({ ...image, ...achar(image) }))
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
      `"${nome}" aponta para ${faltando.length} ${faltando.length === 1 ? 'arquivo que nao esta' : 'arquivos que nao estao'} mais no lugar: ${lista}${resto}. Devolva ${faltando.length === 1 ? 'ele' : 'eles'} para a pasta original ou mova o projeto inteiro junto.`,
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
