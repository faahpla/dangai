import type { z } from 'zod'

/**
 * EXPORTAR E IMPORTAR PRESETS: "tudo que tiver opcao de salvar preset, deixar
 * exportar e importar esses presets... inclusive uma configuracao inteira de
 * legenda."
 *
 * Um arquivo por preset, JSON pequeno com o tipo dentro -- importar um preset
 * de cor no lugar de um de legenda da recado, e nao estado quebrado. A
 * extensao diz o que e (".dangai-legenda"), e o import ainda confere tudo
 * pelo schema antes de guardar. As curvas da entrada ja tinham o mesmo
 * esquema (CurvaDaEntrada.tsx) e continuam com o formato delas.
 */

export type TipoDePreset = 'legenda' | 'cor' | 'movimento' | 'transicao'

const INFO: Record<TipoDePreset, { extensao: string; descricao: string; nome: string }> = {
  legenda: { extensao: 'dangai-legenda', descricao: 'Estilo de legenda do Dangai', nome: 'estilo de legenda' },
  cor: { extensao: 'dangai-cor', descricao: 'Preset de cor do Dangai', nome: 'preset de cor' },
  movimento: { extensao: 'dangai-movimento', descricao: 'Curva de movimento do Dangai', nome: 'curva de movimento' },
  transicao: { extensao: 'dangai-transicao', descricao: 'Transicao do Dangai', nome: 'transicao' },
}

const marca = (tipo: TipoDePreset): string => `dangai.${tipo}`

export async function exportarPreset(tipo: TipoDePreset, nome: string, dados: unknown): Promise<string | null> {
  const info = INFO[tipo]
  const r = await window.dangai.exportarTexto({
    titulo: `Exportar ${info.nome}`,
    nome,
    extensao: info.extensao,
    descricao: info.descricao,
    conteudo: JSON.stringify({ tipo: marca(tipo), versao: 1, nome, dados }, null, 2),
  })
  if (!r.ok) return r.error
  return r.value ? `"${nome}" exportado.` : null
}

/**
 * Abre o dialogo e devolve o preset conferido -- ou um recado de erro em
 * texto, ou null se ele cancelou.
 */
export async function importarPreset<T>(
  tipo: TipoDePreset,
  schema: z.ZodType<T>,
): Promise<{ nome: string; dados: T } | { erro: string } | null> {
  const info = INFO[tipo]
  const r = await window.dangai.importarTexto({
    titulo: `Importar ${info.nome}`,
    extensoes: [info.extensao],
    descricao: info.descricao,
  })
  if (!r.ok) return { erro: r.error }
  if (!r.value) return null
  const errado = { erro: `Esse arquivo nao e um ${info.nome} do Dangai.` }
  let bruto: unknown
  try {
    bruto = JSON.parse(r.value.conteudo)
  } catch {
    return errado
  }
  const obj = bruto as { tipo?: unknown; nome?: unknown; dados?: unknown }
  if (obj?.tipo !== marca(tipo)) return errado
  const ok = schema.safeParse(obj.dados)
  if (!ok.success) return errado
  const nome = (typeof obj.nome === 'string' && obj.nome.trim() ? obj.nome.trim() : r.value.nome).slice(0, 36)
  return { nome, dados: ok.data }
}

/** Nome livre entre os que ja existem: "Meu preset (2)". */
export function nomeLivre(base: string, usados: readonly string[]): string {
  const set = new Set(usados)
  let nome = base
  for (let n = 2; set.has(nome); n++) nome = `${base} (${n})`
  return nome
}
