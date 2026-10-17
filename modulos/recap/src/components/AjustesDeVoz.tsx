import { useEffect, useRef, useState } from 'react'
import type { AjustesDaVoz, ProvedorDeVoz, TesteDeVoz, VozDoProvedor, VozPadrao } from '../../shared/tipos-da-voz'
import { ponte } from '../ponte'
import { modeloEleven } from '../../shared/voz'
import { MODELOS_FISH, useVoz } from '../store/gerar-voz'
import { VelocidadeDaVoz } from './VelocidadeDaVoz'

/**
 * A secao "Voz" das Configuracoes: a voz padrao, a velocidade e as chaves do
 * ElevenLabs e do Fish Audio. O desenho copia o da "Inteligencia artificial":
 * a escolha em cima, depois rotulo, campo + Salvar + Testar e uma linha de
 * resultado por chave.
 *
 * Como la, a chave nunca volta do main: so a dica com os quatro ultimos.
 *
 * [recap] No Dangai e a secao "Voz" do modulo (SecaoDaVoz, abaixo): as chaves
 * vao para o cofre do nucleo (camposDeChave) e a voz para a configuracao do
 * modulo. O "Importar do AniRecap" do Studio ficou de fora (lia uma pasta
 * desta maquina so).
 */

/** A secao do modulo: le os ajustes e monta o AjustesDeVoz (o nucleo da o titulo). */
export function SecaoDaVoz() {
  const [settings, setSettings] = useState<AjustesDaVoz | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    void ponte.lerAjustesDaVoz().then((r) => {
      if (!vivo) return
      if (r.ok) setSettings(r.value)
      else setErro(r.error)
    })
    return () => {
      vivo = false
    }
  }, [])
  const trocar = (s: AjustesDaVoz): void => {
    setSettings(s)
    // O passo 3 le de novo (chave nova = vozes novas; voz nova = o form dela).
    void useVoz.getState().lerAjustes()
  }
  return (
    <div>
      {erro && <p className="mb-2 select-text text-[11px] text-danger">{erro}</p>}
      <AjustesDeVoz settings={settings} onSettings={trocar} />
    </div>
  )
}

/**
 * As vozes do ultimo "Testar" de cada provedor. Fora do componente: o modal
 * desmonta ao fechar, e reabrir as Configuracoes nao pode esvaziar o select.
 */
const lembradas: Record<ProvedorDeVoz, VozDoProvedor[]> = { elevenlabs: [], fish: [] }

const NOME: Record<ProvedorDeVoz, string> = { elevenlabs: 'ElevenLabs', fish: 'Fish Audio' }

const LINK_DA_CHAVE: Record<ProvedorDeVoz, string> = {
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
  fish: 'https://fish.audio/app/api-keys/',
}

type Resultado = { tipo: 'ok' | 'erro'; texto: string; aviso: string | null }

const CAMPO =
  'min-w-0 flex-1 select-text rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none'
const BOTAO =
  'lift shrink-0 rounded-sm border border-line bg-elevated px-3 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40'

export function AjustesDeVoz({
  settings,
  onSettings,
  compacto = false,
}: {
  settings: AjustesDaVoz | null
  onSettings: (s: AjustesDaVoz) => void
  /**
   * A boas-vindas: as chaves PRIMEIRO (sem chave a voz e a velocidade nao
   * servem), voz e velocidade so depois de uma chave de voz salva, sem a
   * linha de cima nem as frases de rodape.
   */
  compacto?: boolean
}) {
  const [entrada, setEntrada] = useState<Record<ProvedorDeVoz, string>>({ elevenlabs: '', fish: '' })
  /*
   * As do ultimo "Testar" daqui; sem elas, as que o passo 3 ja leu (o mesmo
   * Testar, com a mesma chave salva). Sem isto o "Configurar" do passo 3 abria
   * com o id cru da voz padrao ("Crm8... (salva)") no lugar do nome.
   */
  const [vozes, setVozes] = useState<Record<ProvedorDeVoz, VozDoProvedor[]>>(() => {
    const doPasso3 = useVoz.getState().vozes
    return {
      elevenlabs: lembradas.elevenlabs.length > 0 ? lembradas.elevenlabs : (doPasso3.elevenlabs ?? []),
      fish: lembradas.fish.length > 0 ? lembradas.fish : (doPasso3.fish ?? []),
    }
  })
  const [testando, setTestando] = useState<ProvedorDeVoz | null>(null)
  const [resultado, setResultado] = useState<Partial<Record<ProvedorDeVoz, Resultado>>>({})
  const [salvando, setSalvando] = useState(false)
  const ancora = useRef<HTMLDivElement>(null)
  // Veio do "Configurar" do passo 3: rola ate esta secao. Guarda ATE QUANDO rolar; 0 = nao rolar.
  const rolarAte = useRef(useVoz.getState().ajustesDeVozPedidos ? Date.now() + 1500 : 0)

  useEffect(() => {
    if (rolarAte.current) useVoz.getState().ajustesDeVozVistos()
  }, [])

  /*
   * Rola na abertura e de novo quando os ajustes chegam (a altura de cima muda
   * com eles), so no primeiro instante -- como o AjustesDoStudio. O scrollTop
   * da caixa, e nao scrollIntoView, que rolaria tambem o app por baixo.
   */
  useEffect(() => {
    if (!settings || Date.now() > rolarAte.current) return
    const alvo = ancora.current
    const caixa = alvo?.closest<HTMLElement>('.overflow-y-auto')
    if (!alvo || !caixa) return
    caixa.scrollTop += alvo.getBoundingClientRect().top - caixa.getBoundingClientRect().top - 8
  }, [settings])

  /*
   * Na boas-vindas, depois de reabrir o app, a voz salva aparecia como o id
   * cru ("Crm8... (salva)"): ninguem tinha testado a chave nesta sessao.
   * Testar e de graca (so le as vozes da conta), entao ja testa a chave da voz
   * salva quando a lista dela esta vazia.
   */
  const testouSozinho = useRef(false)
  useEffect(() => {
    if (!compacto || testouSozinho.current || !settings) return
    const provedor = settings.vozPadrao.provedor
    if (!provedor || !settings.vozPadrao.voiceId) return
    const tem = provedor === 'elevenlabs' ? settings.hasElevenKey : settings.hasFishKey
    if (!tem || vozes[provedor].length > 0) return
    testouSozinho.current = true
    void testar(provedor, null)
    // So na abertura: o resto e o Testar de sempre.
  }, [compacto, settings])

  const mostrar = (provedor: ProvedorDeVoz, r: Resultado | undefined): void =>
    setResultado((atual) => ({ ...atual, [provedor]: r }))

  const lembrar = (provedor: ProvedorDeVoz, lista: VozDoProvedor[]): void => {
    lembradas[provedor] = lista
    setVozes((atual) => ({ ...atual, [provedor]: lista }))
  }

  // Testa a chave digitada, se houver; senao a salva, que fica no main.
  const testar = async (provedor: ProvedorDeVoz, chave: string | null): Promise<void> => {
    setTestando(provedor)
    mostrar(provedor, undefined)
    const r =
      provedor === 'elevenlabs'
        ? await ponte.testarEleven(chave)
        : await ponte.testarFish(chave)
    setTestando(null)
    if (!r.ok) {
      mostrar(provedor, { tipo: 'erro', texto: r.error, aviso: null })
      return
    }
    lembrar(provedor, r.value.vozes)
    mostrar(provedor, { tipo: 'ok', texto: resumoDoTeste(r.value), aviso: r.value.aviso })
  }

  const salvarChave = async (provedor: ProvedorDeVoz): Promise<void> => {
    const chave = entrada[provedor].trim()
    if (!chave) return
    setSalvando(true)
    const r = await ponte.salvarChaveDaVoz(provedor === 'elevenlabs' ? 'elevenlabsApiKey' : 'fishApiKey', chave)
    setSalvando(false)
    if (!r.ok) {
      mostrar(provedor, { tipo: 'erro', texto: r.error, aviso: null })
      return
    }
    onSettings(r.value)
    setEntrada((atual) => ({ ...atual, [provedor]: '' }))
    // A lista era da chave antiga. Testar a nova e de graca e ja enche o select.
    lembrar(provedor, [])
    void testar(provedor, null)
  }

  const gravarVoz = async (voz: VozPadrao): Promise<void> => {
    const r = await ponte.salvarConfig({ vozPadrao: voz })
    if (r.ok && settings) onSettings({ ...settings, vozPadrao: r.value.vozPadrao })
  }

  const escolherVoz = (valor: string): void => {
    if (!valor) {
      void gravarVoz({ provedor: '', voiceId: '', modelId: '' })
      return
    }
    const corte = valor.indexOf(':')
    const provedor = valor.slice(0, corte) as ProvedorDeVoz
    const atual = settings?.vozPadrao
    void gravarVoz({
      provedor,
      voiceId: valor.slice(corte + 1),
      // O modelo e do provedor: trocar de provedor volta ao padrao dele.
      modelId: atual?.provedor === provedor ? atual.modelId : '',
    })
  }

  const voz = settings?.vozPadrao
  const valorDoSelect = voz && voz.provedor && voz.voiceId ? `${voz.provedor}:${voz.voiceId}` : ''
  // A voz salva aparece mesmo antes do Testar (a importada, por exemplo), ou o
  // select mostraria "Nenhuma" mentindo.
  const opcoes = (provedor: ProvedorDeVoz): VozDoProvedor[] =>
    voz?.provedor === provedor && voz.voiceId && !vozes[provedor].some((v) => v.id === voz.voiceId)
      ? [{ id: voz.voiceId, nome: `${voz.voiceId} (salva)`, detalhe: '', previewUrl: null }, ...vozes[provedor]]
      : vozes[provedor]
  const semLista = vozes.elevenlabs.length === 0 && vozes.fish.length === 0

  const blocoDaChave = (provedor: ProvedorDeVoz) => {
    const tem = provedor === 'elevenlabs' ? settings?.hasElevenKey : settings?.hasFishKey
    const dica = provedor === 'elevenlabs' ? settings?.elevenKeyHint : settings?.fishKeyHint
    const digitada = entrada[provedor].trim()
    const r = resultado[provedor]
    return (
      <>
        <div className="mt-4 mb-1.5 flex items-baseline gap-2">
          <label className="block text-[11px] font-medium text-ink-2">Chave do {NOME[provedor]}</label>
          <span className="flex-1" />
          <a
            href={LINK_DA_CHAVE[provedor]}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            Pegar uma chave
          </a>
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={entrada[provedor]}
            onChange={(event) => {
              const valor = event.target.value
              setEntrada((atual) => ({ ...atual, [provedor]: valor }))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void salvarChave(provedor)
              event.stopPropagation()
            }}
            placeholder={tem && dica ? dica : provedor === 'elevenlabs' ? 'sk_...' : 'Cole a chave'}
            spellCheck={false}
            autoComplete="off"
            className={CAMPO}
          />
          <button
            type="button"
            onClick={() => void salvarChave(provedor)}
            disabled={salvando || digitada.length === 0}
            className={BOTAO}
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={() => void testar(provedor, digitada || null)}
            disabled={testando !== null || (digitada.length === 0 && !tem)}
            className={BOTAO}
          >
            {testando === provedor ? 'Testando...' : 'Testar'}
          </button>
        </div>
        {r && (
          <p
            className={[
              'mt-2 select-text text-[11px] leading-relaxed',
              r.tipo === 'ok' ? 'text-ink-2' : 'text-danger',
            ].join(' ')}
          >
            {r.texto}
            {r.aviso && <span className="block text-danger">{r.aviso}</span>}
          </p>
        )}
      </>
    )
  }

  const temChaveDeVoz = !!settings && (settings.hasElevenKey || settings.hasFishKey)
  // Na boas-vindas: sem chave de voz, voz e velocidade nao aparecem.
  const mostrarVoz = !compacto || temChaveDeVoz

  const blocoDaVoz = (
    <>
      <label className={['mb-1.5 block text-[11px] font-medium text-ink-2', compacto ? 'mt-4' : ''].join(' ')}>Voz</label>
      {/* pr-7 + reticencias: as vozes da biblioteca do ElevenLabs tem nome longo
          ("Andrea Wolff - clear, youthful...") e o texto encostava na seta. */}
      <select
        value={valorDoSelect}
        onChange={(event) => escolherVoz(event.target.value)}
        className="w-full text-ellipsis rounded-sm border border-line bg-elevated py-1.5 pr-7 pl-2.5 text-[13px] text-ink"
      >
        <option value="">Nenhuma ainda</option>
        {(['elevenlabs', 'fish'] as const).map((provedor) => {
          const lista = opcoes(provedor)
          if (lista.length === 0) return null
          return (
            <optgroup key={provedor} label={NOME[provedor]}>
              {lista.map((v) => (
                <option key={v.id} value={`${provedor}:${v.id}`}>
                  {v.detalhe ? `${v.nome} (${v.detalhe})` : v.nome}
                </option>
              ))}
            </optgroup>
          )
        })}
      </select>
      {((semLista && !compacto) || (voz?.provedor && voz.modelId)) && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          {semLista && !compacto ? 'Teste uma chave para ver as vozes da conta. ' : ''}
          {voz?.provedor && voz.modelId ? `Modelo ${nomeDoModelo(voz.provedor, voz.modelId)}.` : ''}
        </p>
      )}
      <VelocidadeDaVoz settings={settings} onSettings={onSettings} />
    </>
  )

  if (compacto) {
    // A primeira chave nao precisa do respiro de cima (o cabecalho da linha ja separa).
    return (
      <div ref={ancora} className="[&>div:first-child]:mt-0">
        {blocoDaChave('elevenlabs')}
        {blocoDaChave('fish')}
        {mostrarVoz && blocoDaVoz}
      </div>
    )
  }

  return (
    <>
      <div ref={ancora} />

      {blocoDaVoz}

      {blocoDaChave('elevenlabs')}
      {blocoDaChave('fish')}

      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        Testar nao gasta credito. As chaves ficam so nesta maquina, como as da IA.
      </p>
    </>
  )
}

/** O nome do modelo como o passo 3 mostra ("Multilingual v2"), nao o id cru ("eleven_multilingual_v2"). */
function nomeDoModelo(provedor: 'elevenlabs' | 'fish', modelId: string): string {
  if (provedor === 'elevenlabs') return modeloEleven(modelId).nome
  return MODELOS_FISH.find((m) => m.id === modelId)?.nome ?? modelId
}

/** "Funcionando · 1.234 de 10.000 caracteres (creator)" ou "Funcionando · saldo US$ 4,20". */
function resumoDoTeste(teste: TesteDeVoz): string {
  const partes = ['Funcionando']
  if (teste.usados !== null && teste.limite !== null) {
    partes.push(
      `${teste.usados.toLocaleString('pt-BR')} de ${teste.limite.toLocaleString('pt-BR')} caracteres${
        teste.plano ? ` (${teste.plano})` : ''
      }`,
    )
  }
  if (teste.saldo !== null) {
    const valor = Number(teste.saldo)
    partes.push(
      `saldo US$ ${
        Number.isFinite(valor)
          ? valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : teste.saldo
      }`,
    )
  }
  const n = teste.vozes.length
  partes.push(`${n} ${n === 1 ? 'voz' : 'vozes'}`)
  return partes.join(' · ')
}
