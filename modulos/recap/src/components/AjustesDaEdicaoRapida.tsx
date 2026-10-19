import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { ConfigDoRecapNaTela } from '../../shared/config'
import {
  NOME_DO_ANIME_VIVO,
  presetsDeCorConferidos,
  type ConfigDaEdicaoRapida,
  type MusicaDaPasta,
  type PreferenciasDaEdicaoRapida,
} from '../../shared/edicao-rapida'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { useEdicaoRapida } from '../store/edicao-rapida'
import { Caixinha, CAMPO_NORMAL, CLASSE_DO_CAMPO, Link, meioDoCaminho } from './pecas'

/**
 * [recap] A EDICAO RAPIDA nas Configuracoes (a secao do modulo, depois dos
 * Sons de transicao do nucleo), portada do Studio: o que ela faz (sons,
 * musica, rosto, legenda, cor), o look da cor (o Anime vivo ou um preset de
 * cor salvo no inspetor da camada de ajuste), se vem ligada no "Abrir no
 * editor" do passo 4, e a PASTA DE MUSICAS -- so leitura: o app lista e toca,
 * nunca grava la (o historico de "ja usada" mora no perfil do modulo).
 *
 * Padrao da pasta: NENHUMA (a do Studio e da maquina do Levi; a parte 5
 * migra a dele). O rotulo e a linha de cima sao do nucleo.
 */

const PARTES: readonly { campo: keyof ConfigDaEdicaoRapida; nome: string; dica: string }[] = [
  { campo: 'sfx', nome: 'Sons', dica: 'Whoosh nas viradas de parte e impacto no gancho e no climax, bem baixos' },
  { campo: 'musica', nome: 'Musica', dica: 'Uma da pasta, sem repetir entre videos, abaixando quando a voz fala' },
  { campo: 'rosto', nome: 'Rosto', dica: 'Cada bloco centralizado no rosto' },
  { campo: 'legenda', nome: 'Legenda', dica: 'A legenda no seu estilo salvo' },
  { campo: 'cor', nome: 'Cor', dica: 'Uma camada de ajuste no video inteiro, com o look escolhido abaixo' },
  {
    campo: 'textos',
    nome: 'Textos na tela',
    dica: 'O texto de tela de cada frase do roteiro entra animado no alto, na palavra dita (o da 1a frase vira o card de gancho)',
  },
]

/** Quantas musicas a lista curta mostra. */
const NA_LISTA = 4

export function AjustesDaEdicaoRapida() {
  const gravarPadrao = useEdicaoRapida((s) => s.gravarPadrao)
  const lerDaConfig = useEdicaoRapida((s) => s.lerDaConfig)
  const [config, setConfig] = useState<ConfigDoRecapNaTela | null>(null)
  const [musicas, setMusicas] = useState<MusicaDaPasta[] | null>(null)
  const [erroDaLista, setErroDaLista] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  // Os presets de cor do nucleo (os do inspetor da camada de ajuste), so os nomes.
  const [presets, setPresets] = useState<string[] | null>(null)

  useEffect(() => {
    let vivo = true
    void ponte.lerConfig().then((r) => {
      if (!vivo) return
      if (r.ok) {
        setConfig(r.value)
        lerDaConfig(r.value)
      } else setAviso(r.error)
    })
    void window.dangai.getSettings().then((r) => {
      if (vivo) setPresets(r.ok ? presetsDeCorConferidos(r.value.presetsDeCor ?? []).map((p) => p.nome) : [])
    })
    return () => {
      vivo = false
    }
  }, [lerDaConfig])

  // A lembranca da store vem primeiro: a caixinha responde na hora (gravarPadrao
  // e otimista) e dois cliques seguidos nao desfazem um ao outro.
  const daLoja = useEdicaoRapida((s) => s.padrao)
  const prefs: PreferenciasDaEdicaoRapida | null = daLoja ?? config?.edicaoRapidaPadrao ?? null
  const efetiva = config?.pastaDeMusicasEfetiva ?? ''
  const escolhida = config?.pastaDeMusicas ?? ''
  // A escolhida sumiu (disco fora, pasta apagada): diz qual, em vez de "Escolher a pasta...".
  const sumiu = escolhida !== '' && efetiva === ''
  const presetSumiu = presets !== null && prefs?.corPreset != null && !presets.includes(prefs.corPreset)

  // A lista curta: relida quando a pasta muda. So lista (sem medir): rapido.
  useEffect(() => {
    if (!config) return
    let vivo = true
    void ponte.listarMusicas().then((r) => {
      if (!vivo) return
      if (r.ok) {
        setMusicas(r.value)
        setErroDaLista(null)
      } else {
        setMusicas(null)
        setErroDaLista(r.error)
      }
    })
    return () => {
      vivo = false
    }
  }, [config, efetiva])

  if (!prefs) return aviso ? <p className="select-text text-[11px] text-danger">{aviso}</p> : null
  const atuais = (): PreferenciasDaEdicaoRapida => useEdicaoRapida.getState().padrao ?? prefs

  const gravarPrefs = async (p: PreferenciasDaEdicaoRapida): Promise<void> => {
    const c = await gravarPadrao(p)
    if (c) setConfig(c)
  }

  const gravarPasta = async (pasta: string): Promise<void> => {
    setSalvando(true)
    const r = await ponte.salvarConfig({ pastaDeMusicas: pasta })
    setSalvando(false)
    if (r.ok) {
      setConfig(r.value)
      setAviso(null)
    } else {
      setAviso(r.error)
    }
  }

  const escolher = async (): Promise<void> => {
    const r = await window.dangai.escolherPasta('Pasta de musicas')
    if (!r.ok) {
      setAviso(r.error)
      return
    }
    if (r.value) await gravarPasta(r.value)
  }

  const lista = musicas ?? []
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {PARTES.map((p) => (
          <Caixinha
            key={p.campo}
            ligada={prefs.config[p.campo]}
            title={p.dica}
            onChange={(v) => void gravarPrefs({ ...atuais(), config: { ...atuais().config, [p.campo]: v } })}
          >
            {p.nome}
          </Caixinha>
        ))}
      </div>
      <div className="mt-2.5">
        <Caixinha
          ligada={prefs.aoAbrirNoEditor}
          title="A caixinha Edicao rapida do Abrir no editor (passo 4) vem ligada"
          onChange={(v) => void gravarPrefs({ ...atuais(), aoAbrirNoEditor: v })}
        >
          Ligada ao abrir no editor
        </Caixinha>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        O botao Edicao rapida do editor faz tudo de uma vez. Continua editavel, e Ctrl+Z desfaz.
      </p>

      <label htmlFor="cor-da-edicao-rapida" className="mt-4 mb-1.5 block text-[11px] font-medium text-ink-2">
        Cor
      </label>
      <select
        id="cor-da-edicao-rapida"
        value={prefs.corPreset ?? ''}
        disabled={!prefs.config.cor}
        onChange={(e) => void gravarPrefs({ ...atuais(), corPreset: e.target.value || null })}
        title={prefs.config.cor ? 'O look da camada de cor: o Anime vivo ou um preset de cor seu' : 'Ligue a Cor acima'}
        className={`${CLASSE_DO_CAMPO} ${CAMPO_NORMAL} w-full text-ellipsis pr-7`}
      >
        <option value="">{NOME_DO_ANIME_VIVO}</option>
        {(presets ?? []).map((nome) => (
          <option key={nome} value={nome}>
            {nome}
          </option>
        ))}
        {prefs.corPreset && !(presets ?? []).includes(prefs.corPreset) && (
          <option value={prefs.corPreset}>{presetSumiu ? `${prefs.corPreset} (apagado)` : prefs.corPreset}</option>
        )}
      </select>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        {presetSumiu ? 'Esse preset foi apagado: entra o Anime vivo.' : 'Camada de ajuste no video todo; os presets sao os do inspetor de cor.'}
      </p>

      <div className="mt-4 mb-1.5 flex items-baseline gap-2">
        <label className="block text-[11px] font-medium text-ink-2">Pasta de musicas (so leitura)</label>
        <span className="flex-1" />
        {escolhida !== '' && (
          <Link onClick={() => void gravarPasta('')} disabled={salvando}>
            Sem pasta
          </Link>
        )}
      </div>
      <button
        type="button"
        onClick={() => void escolher()}
        disabled={salvando}
        title={efetiva || undefined}
        className="lift flex w-full items-center gap-2 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:text-ink disabled:opacity-40"
      >
        <FolderOpen size={13} strokeWidth={1.5} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {efetiva ? meioDoCaminho(efetiva) : sumiu ? meioDoCaminho(escolhida) : 'Escolher a pasta...'}
        </span>
        {sumiu ? (
          <span className="shrink-0 text-[11px] text-danger">nao encontrada</span>
        ) : (
          musicas &&
          efetiva && (
            <span className="tnum shrink-0 text-[11px] text-ink-3">
              {musicas.length} {musicas.length === 1 ? 'faixa' : 'faixas'}
            </span>
          )
        )}
      </button>
      {aviso && <p className="mt-2 select-text text-[11px] leading-relaxed text-danger">{aviso}</p>}
      {lista.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {lista.slice(0, NA_LISTA).map((m) => (
            <li key={m.path} className="flex items-center gap-2 text-[11px]" title={m.path}>
              <span className="min-w-0 flex-1 truncate text-ink-2">{m.fileName.replace(/\.[^.]+$/, '')}</span>
              {m.usadaEm && <span className="tnum shrink-0 text-ink-3">usada {dataCurta(m.usadaEm)}</span>}
            </li>
          ))}
          {lista.length > NA_LISTA && <li className="text-[11px] text-ink-3">e mais {lista.length - NA_LISTA}</li>}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        {erroDaLista
          ? erroDaLista
          : sumiu
            ? 'A pasta escolhida nao foi encontrada: escolha outra.'
            : !efetiva
              ? 'Sem pasta: a Edicao rapida segue sem musica.'
              : musicas && musicas.length === 0
                ? 'Pasta vazia: a Edicao rapida segue sem musica.'
                : 'Uma por video, sem repetir. O app so le essa pasta.'}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
        Os whoosh e impactos saem dos{' '}
        <Link onClick={() => nucleo().abrirConfiguracoes('sons')}>Sons de transicao</Link>.
      </p>
    </div>
  )
}

/** "2026-10-14T..." -> "14/10". */
function dataCurta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
