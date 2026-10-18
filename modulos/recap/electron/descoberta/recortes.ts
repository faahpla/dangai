import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import {
  ROSTOS_POR_GRUPO_MAX,
  sugestoesDoMotor,
  type DescobertaPronta,
  type DiscoveryReadyDoMotor,
  type ElencoDaDescoberta,
  type GrupoDeRostos,
} from '../../shared/descoberta'
import { publish, startMediaServer } from '../media-server'

/**
 * Os RECORTES de rosto e as fotos do elenco do Reconhecer na mao, prontos para
 * a tela (URLs do servidor de midia local).
 *
 * RECORTES: o motor grava em <episodeRoot>/metadata/discovery/gNNN_MMM.jpg e
 * apaga os da rodada anterior; os NOMES se repetem a cada rodada. O servidor de
 * midia guarda caminho -> id para sempre (e a URL nao aceita ?v=), entao a
 * mesma URL mostraria o rosto da rodada anterior. Por isso cada job ganha uma
 * COPIA em <dados do motor>/descoberta/<jobId>/, e as de jobs velhos saem no
 * comeco do proximo.
 *
 * ELENCO: o roster do discovery-ready vem SO com nomes. Quando o anime resolveu
 * online, o motor ja baixou 1 foto por personagem para sugerir nomes
 * (<dados>/cache/anime_db/<titulo> [al<id>]/characters/<nome>/), e ela vai junto
 * como miniatura. Sem pasta, a foto e null (a tela mostra so o nome).
 */

const IMAGEM = /\.(jpe?g|png|webp)$/i
/** O mesmo _SAFE de motor/app/references/reference_store.py (_slug). */
const PROIBIDO_NO_NOME = /[<>:"/\\|?*]/g
/** Copias em paralelo: centenas de recortes pequenos, sem travar o main. */
const COPIAS_JUNTAS = 16

/** A pasta das copias de todos os jobs. */
export function pastaDasCopias(dadosDoMotor: string): string {
  return join(dadosDoMotor, 'descoberta')
}

/** Apaga as copias de jobs que nao sao `fica`. So dentro da pasta das copias. */
export async function limparCopiasVelhas(dadosDoMotor: string, fica: string | null): Promise<void> {
  const raiz = pastaDasCopias(dadosDoMotor)
  let nomes: string[] = []
  try {
    nomes = await readdir(raiz)
  } catch {
    return
  }
  for (const nome of nomes) {
    if (nome === fica || !/^job_[0-9a-z_]+$/.test(nome)) continue
    try {
      await rm(join(raiz, nome), { recursive: true, force: true })
    } catch {
      // Arquivo preso (a tela ainda mostrando): sai na proxima.
    }
  }
}

/** O recorte relativo do motor dentro da pasta do episodio, ou null se escapar dela. */
function recorteDoMotor(episodeRoot: string, relativo: string): string | null {
  const base = resolve(episodeRoot)
  const alvo = resolve(base, relativo)
  if (!alvo.toLowerCase().startsWith(`${base.toLowerCase()}${sep}`) || !IMAGEM.test(alvo)) return null
  return alvo
}

async function emLotes<T>(itens: T[], fazer: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < itens.length; i += COPIAS_JUNTAS) {
    await Promise.all(itens.slice(i, i + COPIAS_JUNTAS).map(fazer))
  }
}

/**
 * Os grupos da tela: copia os recortes deste job e publica. Recorte que nao
 * copiou (sumiu do disco) sai da lista -- mas o indice de `removidos` e o do
 * motor, entao a posicao fica guardada em `indices` para a traducao de volta
 * (sempre igual a 0..n-1 quando nada falha, o caso normal).
 */
export async function gruposDaTela(
  ev: DiscoveryReadyDoMotor,
  dadosDoMotor: string,
  jobId: string,
): Promise<{ grupos: GrupoDeRostos[]; faltaram: number }> {
  await startMediaServer()
  const destino = join(pastaDasCopias(dadosDoMotor), jobId)
  await mkdir(destino, { recursive: true })

  const tarefas: { de: string; para: string }[] = []
  const porGrupo = new Map<number, ({ de: string; para: string } | null)[]>()
  for (const g of ev.groups) {
    const lista: ({ de: string; para: string } | null)[] = []
    for (const rel of g.crops.slice(0, ROSTOS_POR_GRUPO_MAX)) {
      const de = recorteDoMotor(ev.episodeRoot, rel)
      if (!de) {
        lista.push(null)
        continue
      }
      const item = { de, para: join(destino, basename(de)) }
      tarefas.push(item)
      lista.push(item)
    }
    porGrupo.set(g.key, lista)
  }

  const falhou = new Set<string>()
  await emLotes(tarefas, async (t) => {
    try {
      await copyFile(t.de, t.para)
    } catch {
      falhou.add(t.para)
    }
  })

  let faltaram = 0
  const grupos: GrupoDeRostos[] = ev.groups.map((g) => {
    const rostos: string[] = []
    for (const item of porGrupo.get(g.key) ?? []) {
      // A posicao importa: o i da tela e o i do motor em `removed`. Copia que
      // falhou serve o original; perdido de vez vira '' em vez de sumir e
      // deslocar os outros (a tela nao desenha '').
      if (item && !falhou.has(item.para)) rostos.push(publish(item.para))
      else if (item && existsSync(item.de)) rostos.push(publish(item.de))
      else {
        faltaram += 1
        rostos.push('')
      }
    }
    const nome = g.suggestedName.trim()
    return {
      key: g.key,
      rostos,
      totalDeRostos: g.faces,
      cenas: g.shots,
      sugestao: nome ? { nome, similaridade: g.suggestedSim } : null,
      // A1: as teclas 1-9. Sem nome repetido, na ordem do motor.
      sugestoes: sugestoesDoMotor(g.suggestions),
      // `known` sem nome nao acontece no motor; se vier, nao preenche nada.
      conhecido: g.known && nome !== '',
      figurante: g.minor && !g.known,
    }
  })
  return { grupos, faltaram }
}

// ------------------------------------------------------------------- elenco

function normal(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * A pasta do banco do anime no motor (anime_db/<titulo> [al<id>]) cujo
 * metadata.json tem este titulo. null = nenhuma (offline, ou o motor nao
 * gravou). So le.
 */
export function pastaDoAnimeNoBanco(dadosDoMotor: string, titulo: string): string | null {
  const raiz = join(dadosDoMotor, 'cache', 'anime_db')
  const alvo = normal(titulo)
  if (!alvo) return null
  let melhor: { pasta: string; quando: number } | null = null
  let nomes: string[] = []
  try {
    nomes = readdirSync(raiz)
  } catch {
    return null
  }
  for (const nome of nomes) {
    const pasta = join(raiz, nome)
    try {
      if (!statSync(pasta).isDirectory()) continue
      const meta = JSON.parse(readFileSync(join(pasta, 'metadata.json'), 'utf8')) as {
        title?: unknown
        title_english?: unknown
      }
      const titulos = [meta.title, meta.title_english].filter((t): t is string => typeof t === 'string').map(normal)
      if (!titulos.includes(alvo)) continue
      const quando = statSync(join(pasta, 'metadata.json')).mtimeMs
      if (!melhor || quando > melhor.quando) melhor = { pasta, quando }
    } catch {
      // Pasta sem metadata.json (banco local da descoberta, sem nome): fica de fora.
    }
  }
  return melhor?.pasta ?? null
}

/** A 1a foto do personagem na pasta do banco: a do catalogo antes da do batismo. */
function fotoDoPersonagem(pastaDoAnime: string, nome: string): string | null {
  const dir = join(pastaDoAnime, 'characters', nome.replace(PROIBIDO_NO_NOME, '_').trim() || 'unknown')
  if (!existsSync(dir)) return null
  let arquivos: string[] = []
  try {
    arquivos = readdirSync(dir).filter((n) => IMAGEM.test(n))
  } catch {
    return null
  }
  arquivos.sort((a, b) => Number(a.startsWith('auto_disc_')) - Number(b.startsWith('auto_disc_')) || a.localeCompare(b))
  for (const n of arquivos) {
    const p = join(dir, n)
    try {
      if (statSync(p).isFile()) return p
    } catch {
      /* sumiu */
    }
  }
  return null
}

/** O roster do motor com a foto quando houver. Nomes EXATOS da fonte, sem repetir. */
export async function elencoDaTela(dadosDoMotor: string, titulo: string, roster: readonly string[]): Promise<ElencoDaDescoberta[]> {
  await startMediaServer()
  const pasta = pastaDoAnimeNoBanco(dadosDoMotor, titulo)
  const vistos = new Set<string>()
  const elenco: ElencoDaDescoberta[] = []
  for (const cru of roster) {
    const nome = cru.trim()
    if (!nome || vistos.has(nome)) continue
    vistos.add(nome)
    const foto = pasta ? fotoDoPersonagem(pasta, nome) : null
    elenco.push({ nome, foto: foto ? publish(foto) : null })
  }
  return elenco
}

/** Monta o DescobertaPronta inteiro (o que vai no evento 'pronta'). */
export async function montarPronta(
  ev: DiscoveryReadyDoMotor,
  base: { episodioId: string; jobId: string; dadosDoMotor: string },
): Promise<{ pronta: DescobertaPronta; faltaram: number }> {
  const [{ grupos, faltaram }, elenco] = await Promise.all([
    gruposDaTela(ev, base.dadosDoMotor, base.jobId),
    elencoDaTela(base.dadosDoMotor, ev.animeTitle, ev.roster),
  ])
  return {
    pronta: {
      episodioId: base.episodioId,
      jobId: base.jobId,
      anime: ev.animeTitle,
      temporada: ev.season,
      episodio: ev.episode,
      online: ev.online,
      totalDeRostos: ev.totalFaces,
      grupos,
      elenco,
      pastaDoEpisodio: ev.episodeRoot,
    },
    faltaram,
  }
}
