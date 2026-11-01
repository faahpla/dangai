import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { CONFIG_DA_EDICAO_RAPIDA_PADRAO, nadaLigado, partesLigadas, type SfxDaEdicaoRapida } from '../../shared/edicao-rapida'
import { useEdicaoRapida } from '../store/edicao-rapida'
import { nucleo } from '../nucleo'
import { ponte } from '../ponte'
import { Caixinha, COR_DE_AVISO } from './pecas'

/**
 * [recap] A caixinha "Edicao rapida" ao lado do "Abrir no editor" (passo 4): ligada,
 * o projeto ja chega com o que as Configuracoes mandam (sons, musica, rosto,
 * legenda). E a MESMA preferencia das Configuracoes ("Ligada ao abrir no
 * editor"): desligar aqui vale para a proxima vez tambem. Ligada por padrao.
 *
 * O AVISO DE SFX vem ANTES de abrir: com a pasta de SFX so com os sons de
 * fabrica (sintetizados, genericos -- o contrario de "tatil") ou com 1 whoosh
 * so, o short sai com o mesmo som repetido. Clicar abre as Configuracoes nos
 * Sons de transicao.
 */
export function CaixinhaDaEdicaoRapida({ disabled }: { disabled?: boolean }) {
  const padrao = useEdicaoRapida((s) => s.padrao)
  const carregarPadrao = useEdicaoRapida((s) => s.carregarPadrao)
  const gravarPadrao = useEdicaoRapida((s) => s.gravarPadrao)
  const settingsOpen = nucleo().usar((s) => s.settingsOpen)
  const [sfx, setSfx] = useState<SfxDaEdicaoRapida | null>(null)

  useEffect(() => {
    if (!useEdicaoRapida.getState().padrao) void carregarPadrao()
  }, [carregarPadrao])

  // Relido ao fechar as Configuracoes e ao voltar para a janela: ele solta os
  // sons na pasta pelo Explorer, fora do app.
  useEffect(() => {
    if (settingsOpen) return
    let vivo = true
    const ler = (): void => {
      void ponte
        .sfxDaEdicaoRapida()
        .then((r) => {
          if (vivo && r.ok) setSfx(r.value)
        })
        .catch(() => undefined)
    }
    ler()
    window.addEventListener('focus', ler)
    return () => {
      vivo = false
      window.removeEventListener('focus', ler)
    }
  }, [settingsOpen])

  const ligada = padrao?.aoAbrirNoEditor ?? true
  const config = padrao?.config ?? CONFIG_DA_EDICAO_RAPIDA_PADRAO
  const nada = nadaLigado(config)
  const aviso = ligada && config.sfx && sfx ? avisoDosSfx(sfx) : null

  return (
    <>
      {aviso && (
        <button
          type="button"
          onClick={() => nucleo().abrirConfiguracoes('sons')}
          disabled={disabled}
          title={`${aviso.longo}\n\nClique para abrir os Sons de transicao.`}
          className={`flex shrink-0 items-center gap-1.5 text-[11px] hover:underline disabled:opacity-40 ${COR_DE_AVISO}`}
        >
          <TriangleAlert size={12} strokeWidth={1.75} className="shrink-0" />
          {aviso.curto}
        </button>
      )}
      <Caixinha
        ligada={ligada}
        disabled={disabled || padrao === null}
        onChange={(v) => {
          if (padrao) void gravarPadrao({ ...padrao, aoAbrirNoEditor: v })
        }}
        title={
          !ligada
            ? 'O projeto chega sem a Edicao rapida (o botao fica no editor).'
            : nada
              ? 'Nada ligado na Edicao rapida (Configuracoes): o projeto chega como sempre.'
              : `O projeto ja chega com ${partesLigadas(config)}. Tudo editavel.`
        }
      >
        Edicao rapida
      </Caixinha>
    </>
  )
}

/** O recado dos SFX (curto na tela, longo no title). null = tudo certo. */
function avisoDosSfx(s: SfxDaEdicaoRapida): { curto: string; longo: string } | null {
  const contagem = `${s.whoosh} whoosh, ${s.impacto} ${s.impacto === 1 ? 'impacto' : 'impactos'}`
  if (s.whoosh === 0 && s.impacto === 0) {
    return { curto: 'Sem SFX', longo: 'A pasta de SFX nao tem whoosh nem impacto (pelo nome do arquivo): o short sai sem sons.' }
  }
  if (s.deFabrica) {
    return {
      curto: 'SFX de fabrica',
      longo: `A pasta de SFX so tem os sons de fabrica do app (${contagem}): sinteticos e genericos, e o whoosh entra so nas 2 viradas principais. Solte 3 ou mais whoosh e 2 ou mais impactos seus (tateis, organicos).`,
    }
  }
  if (s.riser === 0) {
    return {
      curto: 'Sem riser',
      longo: `A pasta de SFX nao tem riser (pelo nome do arquivo): a saida do gancho leva whoosh. Solte um riser (nome com "riser"; "sharp" no nome = o curto, que vai com o impacto do climax).`,
    }
  }
  if (s.whoosh < 2) {
    return {
      curto: s.whoosh === 0 ? 'Sem whoosh' : 'So 1 whoosh',
      longo: `A pasta de SFX tem ${contagem}: ${s.whoosh === 0 ? 'sem whoosh nas viradas' : 'o whoosh entra so nas 2 viradas principais, para nao repetir'}. Solte 3 ou mais whoosh.`,
    }
  }
  return null
}
