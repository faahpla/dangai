import { readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { isVisual } from '@shared/channels'

/**
 * Pasta solta no app vira PARTE do roteiro.
 *
 * O gesto escolhe o modo, e nao um botao: soltar arquivos continua funcionando
 * exatamente como antes (recap, material ja cronologico), e soltar pastas passa
 * a dizer "este material pertence a esta parte". Antes disso pasta era ignorada
 * no drop, entao isto so soma -- nao ha caminho antigo mudando de comportamento.
 */

export interface Section {
  /** Nome da pasta, so para a interface conseguir dizer qual e. */
  name: string
  files: string[]
}

export interface Expanded {
  /** Arquivos sem parte. E o caminho de sempre. */
  files: string[]
  /** Partes na ordem das pastas. Vazio quando o usuario nao soltou pasta. */
  sections: Section[]
}

/**
 * Ordena como uma pessoa espera, entendendo o numero em vez de comparar letra
 * a letra.
 *
 * Sem isso "10" viria antes de "2", que e exatamente o erro que aparece quando
 * alguem numera as pastas com um digito so. Numerar com dois digitos resolveria,
 * mas depender disso seria transformar um detalhe de arrumacao em requisito.
 */
function naturalmente(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })
}

function ehPasta(caminho: string): boolean {
  try {
    return statSync(caminho).isDirectory()
  } catch {
    return false
  }
}

/** Arquivos visuais diretamente dentro da pasta, em ordem natural. */
function visuaisEm(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((nome) => isVisual(nome))
      .sort(naturalmente)
      .map((nome) => join(dir, nome))
  } catch {
    return []
  }
}

function subpastas(dir: string): string[] {
  try {
    return readdirSync(dir)
      .map((nome) => join(dir, nome))
      .filter(ehPasta)
      .sort(naturalmente)
  } catch {
    return []
  }
}

/**
 * Resolve o que o usuario soltou em arquivos e partes.
 *
 * Tres formas de soltar, todas com o mesmo resultado:
 *  - a pasta de cima, que contem as subpastas numeradas
 *  - as subpastas selecionadas de uma vez
 *  - arquivos soltos, que e o caminho de sempre e nao gera parte nenhuma
 *
 * Pasta sem subpasta vira arquivos soltos: quem arrasta uma pasta de prints de
 * um episodio quer o comportamento de recap, nao uma parte de uma so.
 */
export function expandDrop(paths: readonly string[]): Expanded {
  const files: string[] = []
  const sections: Section[] = []

  const pastas = paths.filter(ehPasta)
  const soltos = paths.filter((p) => !ehPasta(p) && isVisual(p))

  // Uma pasta so, e ela contem subpastas: as subpastas sao as partes.
  if (pastas.length === 1 && soltos.length === 0) {
    const dentro = subpastas(pastas[0]!)
    const comMaterial = dentro
      .map((dir) => ({ name: basename(dir), files: visuaisEm(dir) }))
      .filter((s) => s.files.length > 0)

    if (comMaterial.length > 0) return { files: [], sections: comMaterial }

    // Pasta simples de arquivos: comportamento de sempre.
    return { files: visuaisEm(pastas[0]!), sections: [] }
  }

  // Varias pastas soltas de uma vez: cada uma e uma parte.
  if (pastas.length > 1) {
    for (const dir of [...pastas].sort(naturalmente)) {
      const proprios = visuaisEm(dir)
      // Pasta que so tem subpasta ainda conta, achatada: o usuario claramente
      // apontou para ela, e devolver parte vazia so daria erro mais adiante.
      const netos = proprios.length > 0 ? proprios : subpastas(dir).flatMap(visuaisEm)
      if (netos.length > 0) sections.push({ name: basename(dir), files: netos })
    }
    if (sections.length > 0) return { files: soltos, sections }
  }

  // Nenhuma pasta, ou pasta misturada com arquivo: tudo vira arquivo solto.
  for (const dir of pastas) files.push(...visuaisEm(dir))
  return { files: [...soltos, ...files], sections: [] }
}
