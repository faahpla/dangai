import { Component, useMemo, type ComponentType, type ReactNode } from 'react'
import type { ModuloPublico } from '@shared/modulos'
import { MODULOS_DO_RENDERER } from '../../modulos/registro.renderer'
import type { ComandoDoModulo, ModuloDoRenderer, PropsDosBotoesDaTelaInicial } from './api'
import { definirModulosAtivos, emitir } from './ganchos'
import { criarNucleo, useTelaCheia, type Nucleo } from './nucleo'
import { useModulos } from './lista'

export { useModulos }

/**
 * OS MODULOS NO RENDERER: quem esta ligado, quando cada um inicia, e os
 * encaixes (componentes) que o nucleo poe na tela. Ver ./api.
 *
 * Um modulo so aparece LIGADO -- a lista vem do main (`modulos:listar`), que
 * guarda a escolha nas configuracoes. Todo componente de modulo passa por um
 * <Protegido>: um erro dentro dele some com ele, e nao com o app.
 */

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
  // Configuracoes gravadas: relê a lista (config publica, dica das chaves) e avisa.
  const pararDeOuvir = window.dangai.onConfiguracoesMudaram(() => {
    void useModulos
      .getState()
      .carregar()
      .finally(() => emitir('configuracoesMudaram', {}))
  })
  return () => {
    pararDeOuvir()
    parar()
    for (const limpar of limpezas.values()) limpar()
    limpezas.clear()
  }
}

/**
 * Some com o componente do modulo que lancar, e deixa o resto da tela de pe.
 *
 * FICA MONTADO MESMO COM O MODULO DESLIGADO -- so o conteudo de dentro sai.
 * Um erro na LIMPEZA de um componente (o efeito que roda quando ele sai) vai
 * para a fronteira mais proxima que ainda esta na tela; se a fronteira saisse
 * junto com o componente, o erro subia ate a raiz e derrubava a janela
 * inteira. Religar o modulo zera o erro.
 */
class Protegido extends Component<
  { id: string; ativo: boolean; children: ReactNode },
  { erro: boolean; ativo: boolean }
> {
  override state = { erro: false, ativo: this.props.ativo }
  static getDerivedStateFromProps(
    props: { ativo: boolean },
    state: { erro: boolean; ativo: boolean },
  ): { erro: boolean; ativo: boolean } | null {
    if (props.ativo === state.ativo) return null
    return { ativo: props.ativo, erro: props.ativo ? false : state.erro }
  }
  static getDerivedStateFromError(): { erro: boolean } {
    return { erro: true }
  }
  override componentDidCatch(err: unknown): void {
    console.error(`[modulo:${this.props.id}] um componente quebrou:`, err)
  }
  override render(): ReactNode {
    return this.state.erro || !this.props.ativo ? null : this.props.children
  }
}

/**
 * Um encaixe por modulo REGISTRADO (ligado ou nao), cada um no seu
 * <Protegido>, sempre montado. `conteudo` so roda para os ligados.
 */
function Encaixes({ conteudo }: { conteudo: (m: ModuloDoRenderer) => ReactNode }) {
  const ligados = useModulosLigados()
  return (
    <>
      {MODULOS_DO_RENDERER.map((m) => {
        const ativo = ligados.includes(m)
        return (
          <Protegido key={m.id} id={m.id} ativo={ativo}>
            {ativo ? conteudo(m) : null}
          </Protegido>
        )
      })}
    </>
  )
}

/** As telas proprias de cada modulo (o assistente do recap). */
export function TelasDosModulos() {
  return <Encaixes conteudo={({ Telas }) => (Telas ? <Telas /> : null)} />
}

export function BotoesDosModulosNaTelaInicial(props: PropsDosBotoesDaTelaInicial) {
  return <Encaixes conteudo={({ BotoesDaTelaInicial }) => (BotoesDaTelaInicial ? <BotoesDaTelaInicial {...props} /> : null)} />
}

export function BotoesDosModulosNaBarraDeRender() {
  return <Encaixes conteudo={({ BotoesDaBarraDeRender }) => (BotoesDaBarraDeRender ? <BotoesDaBarraDeRender /> : null)} />
}

export function ItensDosModulosNaBarraDeStatus() {
  return <Encaixes conteudo={({ ItemDaBarraDeStatus }) => (ItemDaBarraDeStatus ? <ItemDaBarraDeStatus /> : null)} />
}

/**
 * UMA PAGINA POR MODULO nas Configuracoes (26/11): "organiza essa merda, ta
 * tudo jogado". As secoes de um modulo ficavam espalhadas entre as do nucleo
 * (o roteiro do recap embaixo das chaves da IA, a edicao rapida no meio dos
 * sons); agora cada modulo ligado com secoes ganha a propria pagina, com o
 * nome dele, e as secoes em ordem. O `depoisDe` diz so a ordem antiga.
 */
export interface PaginaDeModulo {
  id: string
  nome: string
  secoes: { id: string; titulo: string }[]
}

export function usePaginasDosModulos(): PaginaDeModulo[] {
  const lista = useModulos((s) => s.lista)
  const ativos = useModulosLigados()
  return useMemo(
    () =>
      ativos
        .filter((m) => (m.secoesDasConfiguracoes ?? []).length > 0)
        .map((m) => ({
          id: m.id,
          nome: lista.find((p) => p.id === m.id)?.nome ?? m.id,
          secoes: (m.secoesDasConfiguracoes ?? []).map(({ id, titulo }) => ({ id, titulo })),
        })),
    [ativos, lista],
  )
}

/** As secoes de UM modulo, cada uma no cartao que o nucleo da. */
export function SecoesDoModulo({
  id,
  Cartao,
}: {
  id: string
  Cartao: ComponentType<{ secao: string; titulo: string; children: ReactNode }>
}) {
  return (
    <Encaixes
      conteudo={(m) =>
        m.id !== id
          ? null
          : (m.secoesDasConfiguracoes ?? []).map(({ id: secao, titulo, Componente }) => (
              <Cartao key={secao} secao={secao} titulo={titulo}>
                <Componente />
              </Cartao>
            ))
      }
    />
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
  if (lista.length === 0) return <p className="text-[12px] text-ink-3">Nenhum módulo instalado.</p>
  return (
    <div>
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
                <span className="mt-0.5 block text-[11px] leading-snug text-danger">Não subiu: {m.falhou}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
