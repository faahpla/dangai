import { Component, useMemo, type ReactNode } from 'react'
import { create } from 'zustand'
import type { ModuloPublico } from '@shared/modulos'
import { MODULOS_DO_RENDERER } from '../../modulos/registro.renderer'
import type { AncoraDasConfiguracoes, ComandoDoModulo, ModuloDoRenderer, PropsDosBotoesDaTelaInicial } from './api'
import { definirModulosAtivos } from './ganchos'
import { criarNucleo, useTelaCheia, type Nucleo } from './nucleo'

/**
 * OS MODULOS NO RENDERER: quem esta ligado, quando cada um inicia, e os
 * encaixes (componentes) que o nucleo poe na tela. Ver ./api.
 *
 * Um modulo so aparece LIGADO -- a lista vem do main (`modulos:listar`), que
 * guarda a escolha nas configuracoes. Todo componente de modulo passa por um
 * <Protegido>: um erro dentro dele some com ele, e nao com o app.
 */

export const useModulos = create<{
  lista: ModuloPublico[]
  carregar(): Promise<void>
  ligar(id: string, ligado: boolean): Promise<string | null>
}>((set) => ({
  lista: [],
  carregar: async () => {
    const r = await window.dangai.listarModulos()
    if (r.ok) set({ lista: r.value })
  },
  ligar: async (id, ligado) => {
    const r = await window.dangai.ligarModulo(id, ligado)
    if (!r.ok) return r.error
    set({ lista: r.value })
    return null
  },
}))

const ligados = (lista: readonly ModuloPublico[]): ModuloDoRenderer[] =>
  MODULOS_DO_RENDERER.filter((m) => lista.some((p) => p.id === m.id && p.ligado && !p.falhou))

definirModulosAtivos(() => ligados(useModulos.getState().lista))

const nucleos = new Map<string, Nucleo>()
export function nucleoDe(id: string): Nucleo {
  let n = nucleos.get(id)
  if (!n) {
    n = criarNucleo(id)
    nucleos.set(id, n)
  }
  return n
}

/** Os modulos ligados agora, para os componentes. */
export function useModulosLigados(): readonly ModuloDoRenderer[] {
  const lista = useModulos((s) => s.lista)
  return useMemo(() => ligados(lista), [lista])
}

/**
 * Le a lista no main e chama o `iniciar` de cada modulo ligado -- e de novo a
 * cada liga/desliga nas Configuracoes. Chamado uma vez pelo App.
 */
export function startModulos(): () => void {
  const limpezas = new Map<string, () => void>()
  const sincronizar = (): void => {
    const ativos = new Set(ligados(useModulos.getState().lista).map((m) => m.id))
    for (const m of MODULOS_DO_RENDERER) {
      if (ativos.has(m.id) && !limpezas.has(m.id)) {
        let limpar: () => void = () => {}
        try {
          const r = m.iniciar?.(nucleoDe(m.id))
          if (typeof r === 'function') limpar = r
        } catch (err) {
          console.error(`[modulo:${m.id}] iniciar falhou:`, err)
        }
        limpezas.set(m.id, limpar)
      } else if (!ativos.has(m.id) && limpezas.has(m.id)) {
        try {
          limpezas.get(m.id)!()
        } catch (err) {
          console.error(`[modulo:${m.id}] a limpeza falhou:`, err)
        }
        limpezas.delete(m.id)
        // Desligado com a tela dele aberta: o resto do app nao pode ficar inerte.
        if (useTelaCheia.getState().de === m.id) useTelaCheia.setState({ de: null })
      }
    }
  }
  const parar = useModulos.subscribe(sincronizar)
  void useModulos.getState().carregar()
  return () => {
    parar()
    for (const limpar of limpezas.values()) limpar()
    limpezas.clear()
  }
}

/** Some com o componente do modulo que lancar, e deixa o resto da tela de pe. */
class Protegido extends Component<{ id: string; children: ReactNode }, { erro: boolean }> {
  override state = { erro: false }
  static getDerivedStateFromError(): { erro: boolean } {
    return { erro: true }
  }
  override componentDidCatch(err: unknown): void {
    console.error(`[modulo:${this.props.id}] um componente quebrou:`, err)
  }
  override render(): ReactNode {
    return this.state.erro ? null : this.props.children
  }
}

/** As telas proprias de cada modulo (o assistente do recap). */
export function TelasDosModulos() {
  const modulos = useModulosLigados()
  return (
    <>
      {modulos.map(({ id, Telas }) =>
        Telas ? (
          <Protegido key={id} id={id}>
            <Telas />
          </Protegido>
        ) : null,
      )}
    </>
  )
}

export function BotoesDosModulosNaTelaInicial(props: PropsDosBotoesDaTelaInicial) {
  const modulos = useModulosLigados()
  return (
    <>
      {modulos.map(({ id, BotoesDaTelaInicial }) =>
        BotoesDaTelaInicial ? (
          <Protegido key={id} id={id}>
            <BotoesDaTelaInicial {...props} />
          </Protegido>
        ) : null,
      )}
    </>
  )
}

export function BotoesDosModulosNaBarraDeRender() {
  const modulos = useModulosLigados()
  return (
    <>
      {modulos.map(({ id, BotoesDaBarraDeRender }) =>
        BotoesDaBarraDeRender ? (
          <Protegido key={id} id={id}>
            <BotoesDaBarraDeRender />
          </Protegido>
        ) : null,
      )}
    </>
  )
}

export function ItensDosModulosNaBarraDeStatus() {
  const modulos = useModulosLigados()
  return (
    <>
      {modulos.map(({ id, ItemDaBarraDeStatus }) =>
        ItemDaBarraDeStatus ? (
          <Protegido key={id} id={id}>
            <ItemDaBarraDeStatus />
          </Protegido>
        ) : null,
      )}
    </>
  )
}

/** As secoes de modulo que entram depois de uma ancora das Configuracoes. */
export function SecoesDosModulos({ depoisDe }: { depoisDe: AncoraDasConfiguracoes }) {
  const modulos = useModulosLigados()
  const secoes = modulos.flatMap((m) =>
    (m.secoesDasConfiguracoes ?? []).filter((s) => s.depoisDe === depoisDe).map((s) => ({ ...s, modulo: m.id })),
  )
  return (
    <>
      {secoes.map(({ id, titulo, Componente, modulo }) => (
        <div key={id} data-secao={id}>
          <div className="my-5 h-px bg-line" />
          <label className="mb-1.5 block text-[11px] font-medium text-ink-2">{titulo}</label>
          <Protegido id={modulo}>
            <Componente />
          </Protegido>
        </div>
      ))}
    </>
  )
}

/** Os comandos dos modulos ligados, para a paleta. */
export function comandosDosModulos(): ComandoDoModulo[] {
  return ligados(useModulos.getState().lista).flatMap((m) => {
    try {
      return m.comandos?.() ?? []
    } catch (err) {
      console.error(`[modulo:${m.id}] comandos falhou:`, err)
      return []
    }
  })
}

/**
 * LIGAR E DESLIGAR os modulos instalados, nas Configuracoes. Sem modulo
 * instalado, nao aparece nada.
 */
export function ModulosNasConfiguracoes() {
  const lista = useModulos((s) => s.lista)
  const ligar = useModulos((s) => s.ligar)
  if (lista.length === 0) return null
  return (
    <div data-secao="modulos">
      <div className="my-5 h-px bg-line" />
      <label className="mb-1.5 block text-[11px] font-medium text-ink-2">Modulos</label>
      <div className="flex flex-col gap-1.5">
        {lista.map((m) => (
          <label
            key={m.id}
            className="flex cursor-pointer items-start gap-2.5 rounded-sm border border-line bg-elevated px-2.5 py-2"
          >
            <input
              type="checkbox"
              checked={m.ligado}
              onChange={(e) => void ligar(m.id, e.target.checked)}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] text-ink">
                {m.nome}
                {m.beta && (
                  <span className="rounded-[3px] border border-line px-1 text-[9px] uppercase tracking-wide text-ink-3">
                    beta
                  </span>
                )}
              </span>
              {m.descricao && <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{m.descricao}</span>}
              {m.falhou && (
                <span className="mt-0.5 block text-[11px] leading-snug text-danger">Nao subiu: {m.falhou}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
