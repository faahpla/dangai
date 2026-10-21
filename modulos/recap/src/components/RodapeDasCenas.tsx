import { useEffect, useMemo } from 'react'
import { ArrowLeft, ArrowRight, Clapperboard, RotateCcw, TriangleAlert } from 'lucide-react'
import { temPlanos } from '../../shared/episodio'
import { roteiroAtual } from '../../shared/roteiro'
import { podeIrParaCenas, takeAtual } from '../../shared/voz'
import { useGerar } from '../store/gerar'
import { useRoteiro } from '../store/gerar-roteiro'
import { avisosDasFrases, cenasNaTela, resumoDasCenas, useCenas, useIndiceDasCenas } from '../store/gerar-cenas'
import { nucleo } from '../nucleo'
import { Botao, COR_DE_AVISO, focarBotao, Link } from './pecas'
import { CaixinhaDaEdicaoRapida } from './CaixinhaDaEdicaoRapida'
import { SeloSemPersonagens } from './AvisoDeReconhecer'
import { esquecerSemPersonagens } from '../store/aviso-reconhecer'

/**
 * A BARRA DE BAIXO do passo 4: voltar a voz, o recado do momento, "Sugerir de
 * novo" (todas as frases que ele nao mexeu) e a acao principal, "Abrir no
 * editor" -- que monta o projeto (.anirecap) e abre no editor, fechando o
 * assistente.
 *
 * O meio, por prioridade: a pergunta do "Abrir" (frase sem cena, projeto
 * aberto por salvar); o erro (curto; inteiro no tooltip; clicar fecha); o que
 * esta rodando (montando, sugerindo, encaixando na voz); o recado; e, sem
 * nada disso, o resumo ("12 de 14 frases com cena · 1 repetida").
 */
export function RodapeDasCenas() {
  const irParaPasso = useGerar((s) => s.irParaPasso)
  const rascunho = useRoteiro((s) => s.rascunho)
  const indice = useIndiceDasCenas()
  const pendentes = useCenas((s) => s.pendentes)
  const erro = useCenas((s) => s.erro)
  const recado = useCenas((s) => s.recado)
  const avisosDoMain = useCenas((s) => s.avisos)
  const sugerindo = useCenas((s) => s.sugerindo)
  const encaixando = useCenas((s) => s.encaixando)
  const montando = useCenas((s) => s.montando)
  const etapaDaMontagem = useCenas((s) => s.etapaDaMontagem)
  const confirmando = useCenas((s) => s.confirmando)
  const limparErro = useCenas((s) => s.limparErro)
  const limparRecado = useCenas((s) => s.limparRecado)
  const sugerirDeNovo = useCenas((s) => s.sugerirDeNovo)
  const abrirNoEditor = useCenas((s) => s.abrirNoEditor)
  const desistirDeAbrir = useCenas((s) => s.desistirDeAbrir)

  const roteiro = rascunho ? roteiroAtual(rascunho) : null
  const vozPronta = rascunho !== null && roteiro !== null && podeIrParaCenas(rascunho, roteiro)
  const comPlanos = indice !== null && temPlanos(indice)
  const pronto = vozPronta && comPlanos
  const resumo = useMemo(() => {
    if (!rascunho || !roteiro) return null
    const cenas = cenasNaTela(rascunho, roteiro, pendentes)
    return {
      ...resumoDasCenas(avisosDasFrases(roteiro, cenas, takeAtual(rascunho))),
      escolhas: cenas.escolhas.length,
    }
  }, [rascunho, roteiro, pendentes])

  const ocupado = montando || (sugerindo !== null && sugerindo !== 'auto')
  const semNada = !resumo || resumo.escolhas === 0 || resumo.semCena === resumo.total
  const podeAbrir = pronto && !ocupado && !semNada
  const porqueNao = !vozPronta
    ? 'Aprove a voz antes'
    : !comPlanos
      ? 'Espere o corte das cenas'
      : semNada
        ? 'Escolha as cenas antes'
        : ocupado
          ? 'Espere terminar'
          : 'Monta o projeto e abre no editor'

  // Esc fecha so a pergunta (sem isto, o Esc do app fechava o assistente).
  useEffect(() => {
    if (!confirmando) return
    const tecla = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || nucleo().ler().settingsOpen || useCenas.getState().previa) return
      e.stopPropagation()
      desistirDeAbrir()
      focarBotao('abrir-no-editor')
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [confirmando, desistirDeAbrir])

  useEffect(() => {
    if (confirmando) focarBotao('abrir-mesmo-assim')
  }, [confirmando])

  const pergunta =
    confirmando === 'sem-cena' && resumo
      ? `${resumo.semCena} ${resumo.semCena === 1 ? 'frase sem cena' : 'frases sem cena'}. Abrir assim?`
      : confirmando === 'nao-salvo'
        ? 'O projeto aberto nao esta salvo. Abrir assim?'
        : null

  return (
    <footer className="flex h-[52px] shrink-0 items-center gap-3 border-t border-line px-5">
      <Botao onClick={() => irParaPasso(3)} disabled={montando} title="Voltar a voz (passo 3). As cenas ficam salvas.">
        <ArrowLeft size={13} strokeWidth={1.5} />
        Voltar
      </Botao>

      <div className="flex min-w-0 flex-1 items-center gap-2" aria-live="polite">
        {pergunta ? (
          <span className={`flex min-w-0 items-center gap-1.5 text-[11px] ${COR_DE_AVISO}`}>
            <TriangleAlert size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="min-w-0 truncate">{pergunta}</span>
          </span>
        ) : erro ? (
          <button
            type="button"
            onClick={limparErro}
            title={`${erro}\n\nClique para fechar o aviso.`}
            className="min-w-0 truncate text-left text-[11px] text-danger"
          >
            {erro.split(/(?<=[.!?])\s/)[0]}
          </button>
        ) : montando ? (
          <span className="min-w-0 truncate text-[11px] text-ink-3">{etapaDaMontagem ?? 'Montando o projeto...'}</span>
        ) : sugerindo !== null ? (
          <span className="min-w-0 truncate text-[11px] text-ink-3">Sugerindo as cenas...</span>
        ) : encaixando ? (
          <span className="min-w-0 truncate text-[11px] text-ink-3">Encaixando na voz...</span>
        ) : recado ? (
          <button
            type="button"
            onClick={limparRecado}
            title={`${recado}\n\nClique para fechar o recado.`}
            className="min-w-0 truncate text-left text-[11px] text-ink-2"
          >
            {recado}
          </button>
        ) : resumo && resumo.total > 0 ? (
          <span
            className="tnum min-w-0 truncate text-[11px] text-ink-3"
            title={avisosDoMain.length > 0 ? avisosDoMain.join('\n') : undefined}
          >
            {resumo.total - resumo.semCena} de {resumo.total} frases com cena
            {resumo.repetidas > 0 && (
              <span className={COR_DE_AVISO}>
                {' '}
                · {resumo.repetidas} {resumo.repetidas === 1 ? 'repetida' : 'repetidas'}
              </span>
            )}
          </span>
        ) : null}
      </div>

      {/* (21/10) Seguiu sem reconhecer: o selo com o [Reconhecer]; reconhecido depois, o lembrete do Sugerir de novo. */}
      {pronto && !confirmando && <SeloSemPersonagens />}
      {pronto && !confirmando && (
        <Botao
          onClick={() => {
            // (21/10) Reconhecido depois das cenas: o lembrete do selo sai.
            if (indice) esquecerSemPersonagens(indice.id)
            void sugerirDeNovo(null)
          }}
          disabled={ocupado}
          title="Sugere de novo as frases que voce nao mexeu"
        >
          <RotateCcw size={13} strokeWidth={1.5} />
          Sugerir de novo
        </Botao>
      )}
      {confirmando ? (
        <>
          <Link
            onClick={() => {
              desistirDeAbrir()
              focarBotao('abrir-no-editor')
            }}
            title="Nao abre (Esc)"
          >
            Cancelar
          </Link>
          <Botao
            principal
            foco="abrir-mesmo-assim"
            onClick={() => void abrirNoEditor(true)}
            disabled={!podeAbrir}
            title="Monta o projeto e abre no editor"
          >
            <Clapperboard size={13} strokeWidth={1.5} />
            Abrir assim mesmo
          </Botao>
        </>
      ) : (
        <>
          {/* A Edicao rapida junto da montagem: o projeto ja chega pronto. */}
          <CaixinhaDaEdicaoRapida disabled={montando} />
          <Botao principal foco="abrir-no-editor" onClick={() => void abrirNoEditor()} disabled={!podeAbrir} title={porqueNao}>
            <Clapperboard size={13} strokeWidth={1.5} />
            {montando ? 'Abrindo...' : 'Abrir no editor'}
            <ArrowRight size={13} strokeWidth={1.5} />
          </Botao>
        </>
      )}
    </footer>
  )
}
