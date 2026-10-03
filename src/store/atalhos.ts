import { create } from 'zustand'

/**
 * OS ATALHOS DE TECLADO, configuraveis.
 *
 * "Quero poder configurar atalhos de teclado para executar acoes (assim como o
 * C funciona hoje), e quero configurar o X para excluir o que eu tiver
 * selecionado." Cada acao tem uma lista de combinacoes; trocar e na tela de
 * configuracoes, e o que ele deixar fica no settings.json -- vale para todos
 * os projetos, como as curvas e os estilos guardados.
 *
 * Uma combinacao e escrita como "Ctrl+Shift+Z": modificadores na ordem
 * Ctrl, Alt, Shift, e a tecla no fim. Letras e numeros vem da tecla FISICA
 * (`event.code`), entao o Shift nao transforma "1" em "!" nem o layout do
 * teclado muda o que o atalho significa.
 */

export const ACOES = [
  { id: 'tocar', nome: 'Reproduzir / pausar', grupo: 'Reproducao', padrao: ['Space'] },
  { id: 'quadroAnterior', nome: 'Um quadro para tras', grupo: 'Reproducao', padrao: ['ArrowLeft'] },
  { id: 'quadroSeguinte', nome: 'Um quadro para frente', grupo: 'Reproducao', padrao: ['ArrowRight'] },
  { id: 'corteAnterior', nome: 'Ir ao corte anterior', grupo: 'Reproducao', padrao: ['ArrowUp'] },
  { id: 'corteSeguinte', nome: 'Ir ao proximo corte', grupo: 'Reproducao', padrao: ['ArrowDown'] },
  { id: 'inicio', nome: 'Ir ao comeco', grupo: 'Reproducao', padrao: ['Home'] },
  { id: 'fim', nome: 'Ir ao fim', grupo: 'Reproducao', padrao: ['End'] },
  { id: 'cortar', nome: 'Cortar na agulha (bloco ou clipe escolhido)', grupo: 'Edicao', padrao: ['C'] },
  { id: 'excluir', nome: 'Excluir o que estiver selecionado', grupo: 'Edicao', padrao: ['X', 'Delete', 'Backspace'] },
  { id: 'ima', nome: 'Ligar / desligar o ima', grupo: 'Edicao', padrao: ['N'] },
  { id: 'copiar', nome: 'Copiar o clipe escolhido (faixa)', grupo: 'Edicao', padrao: ['Ctrl+C'] },
  { id: 'colar', nome: 'Colar o clipe na agulha', grupo: 'Edicao', padrao: ['Ctrl+V'] },
  { id: 'desfazer', nome: 'Desfazer', grupo: 'Edicao', padrao: ['Ctrl+Z'] },
  { id: 'refazer', nome: 'Refazer', grupo: 'Edicao', padrao: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'salvar', nome: 'Salvar', grupo: 'Projeto', padrao: ['Ctrl+S'] },
  { id: 'salvarComo', nome: 'Salvar como', grupo: 'Projeto', padrao: ['Ctrl+Shift+S'] },
  { id: 'abrir', nome: 'Abrir projeto', grupo: 'Projeto', padrao: ['Ctrl+O'] },
  { id: 'renderizar', nome: 'Renderizar', grupo: 'Projeto', padrao: ['Ctrl+R'] },
  { id: 'paleta', nome: 'Paleta de comandos', grupo: 'Telas', padrao: ['Ctrl+K'] },
  { id: 'selecao', nome: 'Biblioteca (selecao de cenas)', grupo: 'Telas', padrao: ['Ctrl+B'] },
  { id: 'legendas', nome: 'Editor de legendas', grupo: 'Telas', padrao: [] },
  { id: 'bins', nome: 'Bins', grupo: 'Telas', padrao: [] },
  { id: 'configuracoes', nome: 'Configuracoes', grupo: 'Telas', padrao: ['Ctrl+,'] },
] as const satisfies readonly { id: string; nome: string; grupo: string; padrao: readonly string[] }[]

export type Acao = (typeof ACOES)[number]['id']
export type MapaDeAtalhos = Record<Acao, readonly string[]>

export function atalhosDeFabrica(): MapaDeAtalhos {
  return Object.fromEntries(ACOES.map((a) => [a.id, [...a.padrao]])) as unknown as MapaDeAtalhos
}

const MODIFICADORES = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'])

/** A combinacao de um evento de teclado, ou null se for so um modificador. */
export function comboDoEvento(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (MODIFICADORES.has(e.key)) return null
  let tecla: string
  if (/^Key[A-Z]$/.test(e.code)) tecla = e.code.slice(3)
  else if (/^Digit\d$/.test(e.code)) tecla = e.code.slice(5)
  else if (e.key === ' ') tecla = 'Space'
  else tecla = e.key.length === 1 ? e.key.toUpperCase() : e.key
  const partes: string[] = []
  if (e.ctrlKey || e.metaKey) partes.push('Ctrl')
  if (e.altKey) partes.push('Alt')
  if (e.shiftKey) partes.push('Shift')
  partes.push(tecla)
  return partes.join('+')
}

/** Combinacao sem Ctrl nem Alt: uma letra solta, que num campo de texto e so uma letra. */
export function ehTeclaSolta(combo: string): boolean {
  return !combo.startsWith('Ctrl+') && !combo.includes('Alt+')
}

const NOMES: Record<string, string> = {
  Space: 'Espaco',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Delete: 'Del',
  Backspace: 'Backspace',
  Escape: 'Esc',
  Home: 'Home',
  End: 'End',
}

/** "Ctrl+Shift+Z" para mostrar na tela. */
export function rotuloDoCombo(combo: string): string {
  return combo
    .split('+')
    .map((p) => NOMES[p] ?? p)
    .join('+')
}

/** Confere o que veio do settings.json: acao conhecida, lista de textos. */
function conferir(bruto: Record<string, unknown> | null): MapaDeAtalhos {
  const mapa = atalhosDeFabrica()
  if (!bruto) return mapa
  for (const a of ACOES) {
    const v = bruto[a.id]
    if (Array.isArray(v)) {
      ;(mapa as Record<string, readonly string[]>)[a.id] = v
        .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 40)
        .slice(0, 4)
    }
  }
  return mapa
}

interface EstadoDosAtalhos {
  mapa: MapaDeAtalhos
  carregar: () => Promise<void>
  /** Troca as combinacoes de uma acao. Quem ja usava uma delas perde ela. */
  definir: (acao: Acao, combos: readonly string[]) => void
  restaurar: () => void
}

export const useAtalhos = create<EstadoDosAtalhos>((set, get) => {
  const gravar = (mapa: MapaDeAtalhos): void => {
    set({ mapa })
    void window.dangai.saveSettings({ atalhos: mapa as unknown as Record<string, unknown> })
  }
  return {
    mapa: atalhosDeFabrica(),
    carregar: async () => {
      const r = await window.dangai.getSettings()
      if (r.ok) set({ mapa: conferir(r.value.atalhos) })
    },
    definir: (acao, combos) => {
      const novo = { ...get().mapa } as Record<Acao, readonly string[]>
      // Uma combinacao, uma acao: tirar dos outros e o que faz o "X para
      // excluir" funcionar sem ele ter que procurar quem ja usava o X.
      for (const outra of Object.keys(novo) as Acao[]) {
        if (outra !== acao) novo[outra] = novo[outra].filter((c) => !combos.includes(c))
      }
      novo[acao] = [...new Set(combos)]
      gravar(novo)
    },
    restaurar: () => gravar(atalhosDeFabrica()),
  }
})

/** Qual acao esta combinacao dispara, se alguma. */
export function acaoDoCombo(combo: string): Acao | null {
  const mapa = useAtalhos.getState().mapa
  for (const a of ACOES) if (mapa[a.id].includes(combo)) return a.id
  return null
}

/** O primeiro atalho de uma acao, para dicas na tela ("Ctrl+Z"). */
export function dicaDoAtalho(acao: Acao): string | undefined {
  const c = useAtalhos.getState().mapa[acao][0]
  return c ? rotuloDoCombo(c) : undefined
}
