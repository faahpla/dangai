import { create } from 'zustand'
import { lerMarcas, type MarcaDagua, type MarcaNoVideo } from '@shared/marca-dagua'
import { useProject } from './project'

/**
 * AS MARCAS D'AGUA dos canais (shared/marca-dagua.ts): a lista vem das
 * configuracoes, com a URL de cada PNG nesta sessao. A escolha de cada video
 * mora no projeto (`marcaDagua`, o id); a ultima escolhida e a do proximo.
 */
export type MarcaComUrl = MarcaDagua & { url: string }

interface EstadoDasMarcas {
  lista: MarcaComUrl[]
  /** A do proximo video novo (a ultima escolhida). '' = nenhuma. */
  padrao: string
}

export const useMarcas = create<EstadoDasMarcas>(() => ({ lista: [], padrao: '' }))

async function comUrl(m: MarcaDagua): Promise<MarcaComUrl> {
  const r = await window.dangai.libraryClipUrl(m.caminho)
  return { ...m, url: r.ok ? r.value : '' }
}

/** Le a lista na abertura do app (e depois de mudar nas Configuracoes). */
export async function carregarMarcas(): Promise<void> {
  const r = await window.dangai.getSettings()
  if (!r.ok) return
  const lista = await Promise.all(lerMarcas(r.value.marcasDagua).map(comUrl))
  const padrao = lista.some((m) => m.id === r.value.marcaDaguaPadrao) ? r.value.marcaDaguaPadrao : ''
  useMarcas.setState({ lista, padrao })
  // Video recem-aberto sem projeto ainda: ja nasce com a do canal.
  const s = useProject.getState()
  if (!s.audio && !s.projectPath && s.marcaDagua === '') useProject.setState({ marcaDagua: padrao })
}

/** Grava a lista (Configuracoes) e rele as URLs. */
export async function gravarMarcas(lista: readonly MarcaDagua[]): Promise<void> {
  const limpa = lista.map(({ id, nome, caminho, modo, opacidade }) => ({ id, nome, caminho, modo, opacidade }))
  const padrao = limpa.some((m) => m.id === useMarcas.getState().padrao) ? useMarcas.getState().padrao : ''
  await window.dangai.saveSettings({ marcasDagua: limpa, marcaDaguaPadrao: padrao })
  useMarcas.setState({ lista: await Promise.all(limpa.map(comUrl)), padrao })
}

/** Escolhe a marca DESTE video, e ela vira a do proximo. */
export function escolherMarca(id: string): void {
  useProject.setState({ marcaDagua: id })
  useMarcas.setState({ padrao: id })
  void window.dangai.saveSettings({ marcaDaguaPadrao: id })
}

/** O que vai para o video: a marca do projeto, se ela existir nesta maquina. */
export function marcaNoVideo(id: string, lista: readonly MarcaComUrl[]): MarcaNoVideo | null {
  const m = id ? lista.find((x) => x.id === id) : undefined
  return m && m.url ? { url: m.url, modo: m.modo, opacidade: m.opacidade } : null
}
