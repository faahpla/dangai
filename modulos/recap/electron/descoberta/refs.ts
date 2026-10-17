import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fichasDoNome } from '@shared/nomes'

/**
 * As fotos do Reconhecer na mao no reconhecimento AUTOMATICO seguinte.
 *
 * O batismo grava auto_disc_NN.jpg na pasta do personagem no banco do motor
 * (commit_discovery). No episodio seguinte o motor soma essas fotos as do
 * catalogo e passa do minimo de 2 -- e e por isso que o anime sem fotos passa
 * a reconhecer sozinho. Mas medido no E02 do Nia Liston (15/10), o personagem
 * que so tinha as fotos do batismo errou muito (Bendelio 2/8, Neil 1/4), entao
 * a tela pede para conferir: este modulo diz se algum reconhecido dependeu
 * delas (menos de 2 fotos de catalogo). So le.
 */

const IMAGEM = /\.(jpe?g|png|webp)$/i
/** O motor exige 2 fotos por personagem (config.min_references_per_character). */
const MINIMO_DO_CATALOGO = 2

function chave(nome: string): string {
  return fichasDoNome(nome).join(' ')
}

/**
 * Algum dos `nomes` (identifiedCharacters do done) so foi reconhecido gracas
 * as fotos do batismo? `refsDir` e a pasta characters/ do anime no banco (o
 * refsDir do done). Nunca lanca: na duvida, false (a tela so nao avisa).
 */
export function dependeDoBatismo(refsDir: string | null | undefined, nomes: readonly string[]): boolean {
  if (!refsDir || nomes.length === 0) return false
  let pastas: string[]
  try {
    pastas = readdirSync(refsDir).filter((n) => !n.startsWith('_'))
  } catch {
    return false
  }
  // A pasta do personagem pode ter outra grafia ("Liston, Nia"): casa pelas palavras.
  const porChave = new Map<string, string>()
  for (const p of pastas) porChave.set(chave(p), p)
  for (const nome of nomes) {
    const pasta = porChave.get(chave(nome))
    if (!pasta) continue
    let arquivos: string[]
    try {
      arquivos = readdirSync(join(refsDir, pasta)).filter((n) => IMAGEM.test(n))
    } catch {
      continue
    }
    const batismo = arquivos.filter((n) => n.startsWith('auto_disc_')).length
    if (batismo === 0) continue
    const catalogo = arquivos.filter((n) => {
      if (n.startsWith('auto_disc_')) return false
      try {
        return statSync(join(refsDir, pasta, n)).size > 0
      } catch {
        return false
      }
    }).length
    if (catalogo < MINIMO_DO_CATALOGO) return true
  }
  return false
}
