import type { ErroDaInstalacao, TipoDeErroDaInstalacao } from '../../shared/motor-runtime'

/**
 * O ERRO de uma etapa da instalacao, com o tipo que a tela entende.
 *
 * DONO: agente A. As frases sao ASCII, curtas e dizem o que fazer; o detalhe
 * (cauda do log do uv, codigo, caminho) vai para o tooltip.
 */
export class FalhaDaInstalacao extends Error {
  constructor(
    readonly tipo: TipoDeErroDaInstalacao,
    mensagem: string,
    readonly detalhe?: string,
  ) {
    super(mensagem)
    this.name = 'FalhaDaInstalacao'
  }
}

/** A instalacao foi cancelada (pelo Levi, ou o app fechando). Nao e erro para a tela. */
export class InstalacaoCancelada extends Error {
  constructor() {
    super('Instalacao cancelada.')
    this.name = 'InstalacaoCancelada'
  }
}

/** Frases prontas por tipo (quem lanca pode trocar por uma mais precisa). */
export const FRASE_DO_ERRO: Record<TipoDeErroDaInstalacao, string> = {
  'sem-internet': 'Sem internet. Confira a conexao e clique em Continuar.',
  'sem-espaco': 'Falta espaco no disco. Libere espaco e clique em Continuar.',
  'arquivo-corrompido': 'O download veio corrompido. Clique em Continuar para baixar de novo.',
  uv: 'A instalacao dos pacotes falhou. Veja o log e clique em Continuar.',
  conferencia: 'O motor instalou, mas nao respondeu. Clique em Recomecar.',
  ocupado: 'Outra janela do app ja esta instalando o motor.',
  pasta: 'Nao deu para gravar na pasta do motor. Escolha outra pasta.',
  'uv-ausente': 'O instalador do motor (uv) nao confere. Clique em Continuar para baixar de novo.',
  assinatura: 'O Python baixado nao tem a assinatura oficial. Nada foi instalado.',
  antivirus: 'O antivirus bloqueou o instalador do motor. Libere e clique em Continuar.',
  demorou: 'O motor demorou para responder (antivirus examinando?). Clique em Continuar.',
  sistema: 'O motor de personagens so roda no Windows 64 bits.',
}

/**
 * O processo nao chegou a rodar: spawn recusado (EPERM, EACCES, UNKNOWN: o
 * Smart App Control ou o antivirus barrando um exe nao assinado, como o uv).
 */
export function ehBloqueio(texto: string): boolean {
  return /spawn\s+\S*\s*(EPERM|EACCES|UNKNOWN)|\b(EPERM|EACCES)\b.*spawn|operation not permitted|blocked by|bloqueado/i.test(texto)
}

/**
 * Arquivo preso no meio (o antivirus segurando uma DLL recem-extraida):
 * "os error 32" (em uso por outro processo) e "os error 5" (acesso negado).
 */
export function ehArquivoPreso(texto: string): boolean {
  return /os error (32|5)\b|being used by another process|sendo usado por outro processo|access is denied|acesso negado/i.test(texto)
}

export function falha(tipo: TipoDeErroDaInstalacao, detalhe?: string, mensagem?: string): FalhaDaInstalacao {
  return new FalhaDaInstalacao(tipo, mensagem ?? FRASE_DO_ERRO[tipo], detalhe)
}

/** Disco cheio no meio (ENOSPC no Node, "os error 112" no uv). */
export function ehSemEspaco(e: unknown): boolean {
  const codigo = (e as { code?: unknown } | null)?.code
  if (codigo === 'ENOSPC') return true
  const texto = e instanceof Error ? e.message : String(e)
  return /ENOSPC|not enough space|os error 112|espa[cç]o insuficiente/i.test(texto)
}

/**
 * Erro de rede, do fetch do Node (undici: "fetch failed" com a causa) ou do
 * net.fetch do Electron ("net::ERR_INTERNET_DISCONNECTED"), ou do uv.
 */
export function ehDeRede(e: unknown): boolean {
  const causa = (e as { cause?: { code?: unknown; message?: unknown } } | null)?.cause
  const codigo = String((e as { code?: unknown } | null)?.code ?? causa?.code ?? '')
  if (/^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|UND_ERR_\w+)$/.test(codigo)) return true
  const texto = `${e instanceof Error ? e.message : String(e)} ${String(causa?.message ?? '')}`
  return /fetch failed|net::ERR_|socket hang up|network|terminated|timed? ?out|dns error|tcp connect|connection (reset|refused|closed)|error sending request|failed to download|request failed after/i.test(
    texto,
  )
}

/** Para o estado.json e a tela. */
export function paraErroDaInstalacao(e: unknown): ErroDaInstalacao {
  if (e instanceof FalhaDaInstalacao) {
    return { tipo: e.tipo, mensagem: e.message, ...(e.detalhe ? { detalhe: e.detalhe.slice(0, 1500) } : {}) }
  }
  const texto = e instanceof Error ? e.message : String(e)
  if (ehSemEspaco(e)) return { tipo: 'sem-espaco', mensagem: FRASE_DO_ERRO['sem-espaco'], detalhe: texto.slice(0, 1500) }
  if (ehDeRede(e)) return { tipo: 'sem-internet', mensagem: FRASE_DO_ERRO['sem-internet'], detalhe: texto.slice(0, 1500) }
  const codigo = (e as { code?: unknown } | null)?.code
  // EPERM/EBUSY dentro do venv e o motor rodando (uma .pyd carregada), nao a pasta.
  if ((codigo === 'EPERM' || codigo === 'EBUSY') && /[\\/]venv[\\/]/i.test(texto)) {
    return { tipo: 'ocupado', mensagem: 'O motor esta em uso. Espere a analise terminar e tente de novo.', detalhe: texto.slice(0, 1500) }
  }
  if (codigo === 'EPERM' || codigo === 'EACCES') {
    return { tipo: 'pasta', mensagem: FRASE_DO_ERRO.pasta, detalhe: texto.slice(0, 1500) }
  }
  return { tipo: 'uv', mensagem: 'A instalacao do motor parou. Veja o log e clique em Continuar.', detalhe: texto.slice(0, 1500) }
}
