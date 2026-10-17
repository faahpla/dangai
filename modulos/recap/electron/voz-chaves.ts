import type { ProvedorDeVoz, TesteDeVoz, VozDoProvedor } from '../shared/tipos-da-voz'
import { idDeVoz } from '../shared/config'

/**
 * As chaves de voz: o "Testar" do ElevenLabs e do Fish Audio, e o "Importar do
 * AniRecap", que traz a chave e a voz do app antigo do Levi.
 *
 * Testar NUNCA gasta: so le o plano/saldo e a lista de vozes (GET). Gerar uma
 * frase de teste custaria caractere/credito a cada clique no botao.
 *
 * A chave nunca entra em mensagem de erro nem em log: as notas daqui vao para a
 * tela e para o console.error do handle() do ipc.ts.
 */

const ELEVEN_API = 'https://api.elevenlabs.io/v1'
/** Base da API do Fish Audio (docs.fish.audio, autenticacao Bearer). */
const FISH_API = 'https://api.fish.audio'
const TEMPO_LIMITE_MS = 20_000

const NOME: Record<ProvedorDeVoz, string> = { elevenlabs: 'ElevenLabs', fish: 'Fish Audio' }

interface Falha {
  /** null = nem chegou resposta (rede, tempo). */
  status: number | null
  codigo: string
  mensagem: string
}

type Resposta = { ok: true; json: unknown } | { ok: false; falha: Falha }

async function pedirJson(url: string, cabecalhos: Record<string, string>): Promise<Resposta> {
  let resposta: Response
  try {
    // A chave vai no cabecalho, nunca na URL: URL aparece em log e em erro.
    resposta = await fetch(url, { headers: cabecalhos, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) })
  } catch (err) {
    const e = err as { name?: unknown; cause?: { code?: unknown } } | null
    const codigo =
      e?.name === 'TimeoutError' ? 'TIMEOUT' : typeof e?.cause?.code === 'string' ? e.cause.code : 'REDE'
    return { ok: false, falha: { status: null, codigo, mensagem: '' } }
  }

  const texto = await resposta.text().catch(() => '')
  let json: unknown = null
  try {
    json = texto ? JSON.parse(texto) : null
  } catch {
    json = null
  }
  if (!resposta.ok) return { ok: false, falha: { status: resposta.status, ...lerErro(json, texto) } }
  if (json === null) {
    return { ok: false, falha: { status: resposta.status, codigo: 'SEM_JSON', mensagem: texto.slice(0, 200) } }
  }
  return { ok: true, json }
}

/**
 * O erro nos formatos que os dois mandam.
 *
 * ElevenLabs: `{ detail: { status, code?, message } }` (o 422 traz `detail` como
 * lista). Fish Audio: `{ status, message, reason }`, ou o `{ detail }` do
 * FastAPI quando o erro e de validacao.
 */
function lerErro(json: unknown, texto: string): { codigo: string; mensagem: string } {
  const corpo = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
  let codigo = ''
  let mensagem = ''
  const detalhe = corpo['detail']
  if (typeof detalhe === 'object' && detalhe !== null && !Array.isArray(detalhe)) {
    const d = detalhe as Record<string, unknown>
    codigo = textoDe(d['code']) || textoDe(d['status'])
    mensagem = textoDe(d['message'])
  } else if (typeof detalhe === 'string') {
    mensagem = detalhe
  } else if (Array.isArray(detalhe) && typeof detalhe[0] === 'object' && detalhe[0] !== null) {
    mensagem = textoDe((detalhe[0] as Record<string, unknown>)['msg'])
  }
  if (!codigo) codigo = textoDe(corpo['reason'])
  if (!mensagem) mensagem = textoDe(corpo['message']) || (json === null ? texto.slice(0, 200) : '')
  return { codigo, mensagem }
}

function textoDe(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : ''
}

function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null
}

/** Tira a chave de um texto que veio do provedor, por garantia: ele vai para a tela. */
function semChave(texto: string, chave: string): string {
  return chave && texto.includes(chave) ? texto.split(chave).join('••••') : texto
}

/** "sem creditos" fica igual nos dois: e o que ele procura ao bater o olho. */
function semCreditos(provedor: ProvedorDeVoz, detalhe: string): string {
  return `Sem creditos no ${NOME[provedor]}: ${detalhe}`
}

/** A nota para a interface, em portugues e dizendo o que fazer. */
export function notaDaFalha(provedor: ProvedorDeVoz, falha: Falha, chave: string): string {
  const nome = NOME[provedor]
  const codigo = falha.codigo.toLowerCase()
  if (falha.status === null) {
    return falha.codigo === 'TIMEOUT'
      ? `O ${nome} demorou demais para responder. Tente de novo em instantes.`
      : `Sem internet, ou o ${nome} nao respondeu. Confira a conexao e tente de novo.`
  }
  if (falha.status === 402 || codigo.includes('quota_exceeded') || codigo.includes('insufficient')) {
    return semCreditos(
      provedor,
      provedor === 'fish'
        ? 'o saldo da API acabou. Recarregue em fish.audio para gerar a voz.'
        : 'os caracteres do plano acabaram. Renove ou troque de plano em elevenlabs.io.',
    )
  }
  if (codigo === 'detected_unusual_activity') {
    return 'O ElevenLabs bloqueou o plano gratis desta conta (atividade incomum). So volta com um plano pago.'
  }
  if (codigo === 'missing_permissions') {
    return `A chave vale, mas nao tem permissao para isso. Libere a leitura (User e Voices) na chave, no site do ${nome}.`
  }
  if (falha.status === 401 || falha.status === 403) {
    return `Chave invalida: o ${nome} recusou. Confira se colou a chave inteira, sem espaco.`
  }
  if (falha.status === 429) return `Muitos pedidos seguidos ao ${nome}. Espere um minuto e teste de novo.`
  if (falha.status >= 500) {
    return `O ${nome} esta fora do ar agora (erro ${falha.status}). Tente de novo em alguns minutos.`
  }
  const mensagem = semChave(falha.mensagem, chave).slice(0, 160)
  return `O ${nome} recusou (erro ${falha.status})${mensagem ? `: ${mensagem}` : '.'}`
}

// ------------------------------------------------------------------ ElevenLabs

/**
 * Confere a chave do ElevenLabs: o plano e os caracteres (GET /v1/user) e as
 * vozes (GET /v1/voices). Lanca Error com a nota pronta se a chave nao vale.
 */
export async function testarEleven(chave: string): Promise<TesteDeVoz> {
  const avisos: string[] = []
  let plano: string | null = null
  let usados: number | null = null
  let limite: number | null = null

  const usuario = await pedirJson(`${ELEVEN_API}/user`, { 'xi-api-key': chave })
  if (usuario.ok) {
    const assinatura = (usuario.json as { subscription?: Record<string, unknown> }).subscription ?? {}
    plano = textoDe(assinatura['tier']) || null
    usados = numero(assinatura['character_count'])
    limite = numero(assinatura['character_limit'])
    // Plano por uso (payg) ou com extensao ligada passa do limite e cobra a
    // parte: ali "acabou" seria mentira.
    const estica = plano === 'payg' || assinatura['can_extend_character_limit'] === true
    if (usados !== null && limite !== null && usados >= limite && !estica) {
      const renova = dataCurta(numero(assinatura['next_character_count_reset_unix']))
      avisos.push(
        semCreditos(
          'elevenlabs',
          `os ${limite.toLocaleString('pt-BR')} caracteres do plano acabaram${renova ? ` (renova em ${renova})` : ''}.`,
        ),
      )
    }
    if (assinatura['status'] === 'free_disabled') {
      avisos.push('O plano gratis desta conta esta desligado pelo ElevenLabs.')
    }
  } else if (usuario.falha.codigo.toLowerCase() === 'missing_permissions') {
    // Chave restrita sem "User: Read": ela autentica, so nao deixa ver o plano.
    avisos.push('A chave nao pode ler o plano (libere User como leitura na chave, em elevenlabs.io).')
  } else {
    throw new Error(notaDaFalha('elevenlabs', usuario.falha, chave))
  }

  let vozes: VozDoProvedor[] = []
  try {
    vozes = await listarVozesEleven(chave)
  } catch (err) {
    avisos.push(`As vozes nao vieram. ${err instanceof Error ? err.message : String(err)}`)
  }

  return { provedor: 'elevenlabs', plano, usados, limite, saldo: null, vozes, aviso: avisos.join(' ') || null }
}

/** Unix (s) -> "03/11". '' quando nao veio. */
function dataCurta(unix: number | null): string {
  if (unix === null || unix <= 0) return ''
  const data = new Date(unix * 1000)
  return `${String(data.getDate()).padStart(2, '0')}/${String(data.getMonth() + 1).padStart(2, '0')}`
}

/**
 * As vozes que a chave enxerga: as da conta (clonadas, geradas, da biblioteca)
 * primeiro, depois as prontas do ElevenLabs. Lanca Error com a nota pronta.
 */
export async function listarVozesEleven(chave: string): Promise<VozDoProvedor[]> {
  const r = await pedirJson(`${ELEVEN_API}/voices`, { 'xi-api-key': chave })
  if (!r.ok) throw new Error(notaDaFalha('elevenlabs', r.falha, chave))

  const lista = (r.json as { voices?: unknown }).voices
  if (!Array.isArray(lista)) return []
  const vozes: (VozDoProvedor & { propria: boolean })[] = []
  for (const item of lista) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    const id = idDeVoz(v['voice_id'])
    if (!id) continue
    const rotulos =
      typeof v['labels'] === 'object' && v['labels'] !== null ? (v['labels'] as Record<string, unknown>) : {}
    const verificados = Array.isArray(v['verified_languages']) ? (v['verified_languages'] as unknown[]) : []
    const primeiro =
      typeof verificados[0] === 'object' && verificados[0] !== null
        ? (verificados[0] as Record<string, unknown>)
        : {}
    const ajuste =
      typeof v['fine_tuning'] === 'object' && v['fine_tuning'] !== null
        ? (v['fine_tuning'] as Record<string, unknown>)
        : {}
    const idioma = textoDe(rotulos['language']) || textoDe(primeiro['language']) || textoDe(ajuste['language'])
    vozes.push({
      id,
      nome: textoDe(v['name']) || id,
      detalhe: detalheCurto([idioma, textoDe(rotulos['gender']), textoDe(rotulos['accent'])]),
      previewUrl: urlOuNull(v['preview_url']),
      propria: v['category'] !== 'premade',
    })
  }
  vozes.sort((a, b) => Number(b.propria) - Number(a.propria) || a.nome.localeCompare(b.nome))
  return vozes.map(({ propria: _propria, ...voz }) => voz)
}

function detalheCurto(partes: string[]): string {
  const vistas = new Set<string>()
  const unicas = partes.filter((p) => {
    const chave = p.toLowerCase()
    if (!p || vistas.has(chave)) return false
    vistas.add(chave)
    return true
  })
  return unicas.join(', ').slice(0, 60)
}

function urlOuNull(valor: unknown): string | null {
  return typeof valor === 'string' && /^https:\/\//.test(valor) ? valor : null
}

// ------------------------------------------------------------------ Fish Audio

/**
 * Confere a chave do Fish Audio: o saldo da API (GET /wallet/self/api-credit)
 * e as vozes proprias (GET /model?self=true). Lanca Error com a nota pronta se
 * a chave nao vale.
 */
export async function testarFish(chave: string): Promise<TesteDeVoz> {
  const avisos: string[] = []
  const credito = await pedirJson(`${FISH_API}/wallet/self/api-credit`, { Authorization: `Bearer ${chave}` })
  if (!credito.ok) throw new Error(notaDaFalha('fish', credito.falha, chave))

  // O Fish manda o saldo como TEXTO ("12.3400"), em dolar.
  const bruto = (credito.json as { credit?: unknown }).credit
  const saldo = typeof bruto === 'string' || typeof bruto === 'number' ? String(bruto).trim() || null : null
  if (saldo !== null && Number.isFinite(Number(saldo)) && Number(saldo) <= 0) {
    avisos.push(semCreditos('fish', 'o saldo da API esta zerado. Recarregue em fish.audio para gerar a voz.'))
  }

  let vozes: VozDoProvedor[] = []
  try {
    vozes = await listarVozesFish(chave)
    if (vozes.length === 0) avisos.push('A conta ainda nao tem voz propria no Fish Audio. Crie ou clone uma em fish.audio.')
  } catch (err) {
    avisos.push(`As vozes nao vieram. ${err instanceof Error ? err.message : String(err)}`)
  }

  return { provedor: 'fish', plano: null, usados: null, limite: null, saldo, vozes, aviso: avisos.join(' ') || null }
}

/**
 * Os modelos de voz da propria conta, ja treinados. O `self=true` deixa de fora
 * o catalogo publico (milhares de vozes): a voz do canal e a que ele criou.
 */
export async function listarVozesFish(chave: string): Promise<VozDoProvedor[]> {
  const vozes: VozDoProvedor[] = []
  const porPagina = 100
  // Cinco paginas de cem e mais voz propria do que alguem tem; o teto so
  // impede laco infinito se a API repetir a mesma pagina.
  for (let pagina = 1; pagina <= 5; pagina++) {
    const consulta = `self=true&page_size=${porPagina}&page_number=${pagina}&sort_by=created_at`
    const r = await pedirJson(`${FISH_API}/model?${consulta}`, { Authorization: `Bearer ${chave}` })
    if (!r.ok) throw new Error(notaDaFalha('fish', r.falha, chave))

    const corpo = r.json as { items?: unknown; total?: unknown; has_more?: unknown }
    const itens = Array.isArray(corpo.items) ? (corpo.items as unknown[]) : []
    for (const item of itens) {
      if (typeof item !== 'object' || item === null) continue
      const m = item as Record<string, unknown>
      if (m['type'] !== undefined && m['type'] !== 'tts') continue
      if (m['state'] !== undefined && m['state'] !== 'trained') continue
      const id = idDeVoz(m['_id'])
      if (!id) continue
      const idiomas = Array.isArray(m['languages'])
        ? (m['languages'] as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const amostras = Array.isArray(m['samples']) ? (m['samples'] as unknown[]) : []
      const amostra =
        typeof amostras[0] === 'object' && amostras[0] !== null ? (amostras[0] as Record<string, unknown>) : {}
      vozes.push({
        id,
        nome: textoDe(m['title']) || id,
        detalhe: detalheCurto(idiomas),
        previewUrl: urlOuNull(amostra['audio']),
      })
    }
    const total = numero(corpo.total)
    if (itens.length < porPagina || corpo.has_more === false || (total !== null && pagina * porPagina >= total)) break
  }
  return vozes
}
