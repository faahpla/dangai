import { binSchema, type Bin } from '@shared/contract'
import { useProject } from './project'

/**
 * As Power Bins: o acervo de arquivos que ele arrasta para a linha do tempo.
 *
 * Ficam nas CONFIGURACOES, como as curvas e os presets de legenda: sao dele,
 * nao de um video. Toda mudanca grava na hora -- uma bin montada com quarenta
 * SFX nao pode sumir porque o app fechou antes de um "salvar".
 */

/** Le as bins guardadas, uma vez, na abertura do app. */
export async function carregarBins(): Promise<void> {
  const r = await window.dangai.getSettings()
  if (!r.ok) return
  const bins = (r.value.bins ?? []).flatMap((b) => {
    const ok = binSchema.safeParse(b)
    return ok.success ? [ok.data] : []
  })
  useProject.setState({ bins })
}

function gravar(bins: Bin[]): void {
  useProject.setState({ bins })
  void window.dangai.saveSettings({ bins })
}

const novoId = (): string => `bin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export function criarBin(nome: string): string | null {
  const limpo = nome.trim().slice(0, 40)
  if (!limpo) return null
  const bin: Bin = { id: novoId(), nome: limpo, pasta: null, arquivos: [] }
  gravar([...useProject.getState().bins, bin])
  return bin.id
}

export function renomearBin(id: string, nome: string): void {
  const limpo = nome.trim().slice(0, 40)
  if (!limpo) return
  gravar(useProject.getState().bins.map((b) => (b.id === id ? { ...b, nome: limpo } : b)))
}

export function apagarBin(id: string): void {
  gravar(useProject.getState().bins.filter((b) => b.id !== id))
}

/** Acrescenta arquivos soltos, sem repetir os que ja estao. */
export function adicionarArquivos(id: string, caminhos: readonly string[]): void {
  gravar(
    useProject.getState().bins.map((b) =>
      b.id === id ? { ...b, arquivos: [...new Set([...b.arquivos, ...caminhos])] } : b,
    ),
  )
}

export function tirarArquivo(id: string, caminho: string): void {
  gravar(
    useProject.getState().bins.map((b) =>
      b.id === id ? { ...b, arquivos: b.arquivos.filter((a) => a !== caminho) } : b,
    ),
  )
}

/** Liga a bin a uma pasta escolhida no dialogo. false = ele fechou sem escolher. */
export async function ligarPasta(id: string): Promise<boolean> {
  const r = await window.dangai.escolherPasta('Escolher a pasta desta bin')
  if (!r.ok || !r.value) return false
  const pasta = r.value
  gravar(useProject.getState().bins.map((b) => (b.id === id ? { ...b, pasta } : b)))
  return true
}

export function desligarPasta(id: string): void {
  gravar(useProject.getState().bins.map((b) => (b.id === id ? { ...b, pasta: null } : b)))
}
