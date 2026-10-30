import { useMemo, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import {
  AjustesDaThumb as AjustesDoEditor,
  DoComputador,
  GradeDeSugestoes,
  PreviaDaThumb as PreviaDoEditor,
  ProvedorDoEditor,
  RodapeDaThumb as RodapeDoEditor,
  type FonteDaImagem,
} from '../../../thumb/src/editor/Editor'
import { usePosRender } from '../store/pos-render'
import { cenaNoInstante, useThumb } from '../store/thumb'
import { Botao, formatarTempo } from './pecas'

/**
 * [recap] A PARTE "THUMBNAIL" da tela "Video pronto": o editor de thumbnail
 * em comum (modulos/thumb/src/editor/Editor.tsx, o mesmo do modulo
 * Thumbnail), com a loja do recap (store/thumb.ts) e o que so o recap tem:
 * as sugestoes com o GANCHO, o "Quadro do video" (a barrinha anda no video
 * pronto e o quadro sai limpo da cena de origem), os textos do roteiro e o
 * PNG ao lado do video.
 */

const JEITOS: readonly FonteDaImagem[] = [
  {
    valor: 'sugestoes',
    rotulo: 'Sugestoes',
    title: 'Os melhores quadros das cenas do video (o gancho primeiro)',
    conteudo: () => <GradeDeSugestoes />,
  },
  {
    valor: 'video',
    rotulo: 'Quadro do video',
    title: 'Qualquer instante do video, tirado limpo da cena original (sem legenda)',
    conteudo: () => <QuadroDoVideo />,
  },
  {
    valor: 'arquivo',
    rotulo: 'Do computador',
    title: 'Uma imagem do PC',
    conteudo: ({ nomeDoSlot }) => (
      <DoComputador explicacao={`Vai para ${nomeDoSlot} e e copiada para a pasta do projeto; o rosto e enquadrado sozinho.`} />
    ),
  },
]

/** A previa da thumb, do tamanho do player (9:16), com o arrastar, a rodinha e as guias. */
export function PreviaDaThumb(props: { altura: number; larguraMax: number }) {
  return (
    <ProvedorDoEditor loja={useThumb}>
      <PreviaDoEditor {...props} />
    </ProvedorDoEditor>
  )
}

/** A coluna da direita na parte Thumbnail. */
export function AjustesDaThumb() {
  const thumbsDoRoteiro = usePosRender((s) => s.thumbs)
  return (
    <ProvedorDoEditor loja={useThumb}>
      <AjustesDoEditor fontes={JEITOS} textosProntos={{ rotulo: 'Do roteiro:', textos: thumbsDoRoteiro }} />
    </ProvedorDoEditor>
  )
}

/** O rodape da parte Thumbnail: o "Salvar PNG" (e a pergunta de sobrescrever), "Abrir pasta" e "Fechar". */
export function RodapeDaThumb({ fechar }: { fechar: () => void }) {
  const outputPath = usePosRender((s) => s.outputPath)
  const nome = (c: string): string => c.split(/[\\/]/).pop() ?? c
  return (
    <ProvedorDoEditor loja={useThumb}>
      <RodapeDoEditor
        fechar={fechar}
        destino="1080x1920, ao lado do video."
        tituloDoSalvar={outputPath ? `Grava ${nome(outputPath).replace(/\.[^.]+$/, '')}-thumb.png na pasta do video` : undefined}
        podeSalvar={Boolean(outputPath)}
        alvoDaPasta={outputPath}
      />
    </ProvedorDoEditor>
  )
}

/**
 * Um instante qualquer do video: a barrinha anda no video pronto (para ele
 * achar o momento), mas o quadro sai LIMPO da cena de origem naquele instante
 * (regra do Levi: thumb nunca com legenda) -- o arquivo e o ponto vem do
 * plano do projeto (cenaNoInstante). No grid, ele escolhe a metade.
 */
function QuadroDoVideo() {
  const videoUrl = usePosRender((s) => s.videoUrl)
  const video = useRef<HTMLVideoElement | null>(null)
  const [tempo, setTempo] = useState(0)
  const [duracao, setDuracao] = useState(0)
  const [usando, setUsando] = useState<'a' | 'b' | null>(null)
  const cena = useMemo(() => cenaNoInstante(tempo), [tempo])
  if (!videoUrl) return <p className="text-[12px] text-ink-3">O video pronto nao esta mais na pasta.</p>
  const usar = (metade: 'a' | 'b'): void => {
    setUsando(metade)
    void useThumb
      .getState()
      .usarQuadroDoVideo(video.current?.currentTime ?? tempo, metade)
      .finally(() => setUsando(null))
  }
  const botao = (metade: 'a' | 'b', rotulo: string, title: string) => (
    <Botao disabled={usando !== null || duracao <= 0 || !cena} onClick={() => usar(metade)} title={title}>
      {usando === metade ? <Loader2 size={13} strokeWidth={1.5} className="animate-spin" /> : <Sparkles size={13} strokeWidth={1.5} />}
      {rotulo}
    </Botao>
  )
  return (
    <div className="flex items-start gap-3" data-thumb="quadro-do-video">
      <video
        ref={video}
        src={videoUrl}
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={(e) => setDuracao(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onTimeUpdate={(e) => setTempo(e.currentTarget.currentTime)}
        className="h-[176px] w-[99px] shrink-0 rounded-sm bg-black object-contain"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-1">
        <div className="flex items-center gap-2">
          <span className="tnum w-10 shrink-0 text-right text-[11px] text-ink-3">{formatarTempo(tempo, 1)}</span>
          <input
            type="range"
            min={0}
            max={duracao || 0}
            step={1 / 30}
            value={Math.min(tempo, duracao || 0)}
            onChange={(e) => {
              const v = video.current
              if (!v) return
              v.currentTime = Number(e.target.value)
              setTempo(v.currentTime)
            }}
            aria-label="Instante do video"
            className="dangai-range min-w-0 flex-1"
          />
          <span className="tnum w-10 shrink-0 text-[11px] text-ink-3">{formatarTempo(duracao, 1)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cena?.b ? (
            <>
              {botao('a', 'Metade de cima', `Tira o quadro limpo de ${cena.a.nome} em ${formatarTempo(cena.a.t, 1)}`)}
              {botao('b', 'Metade de baixo', `Tira o quadro limpo de ${cena.b.nome} em ${formatarTempo(cena.b.t, 1)}`)}
            </>
          ) : (
            botao('a', 'Usar este quadro', cena ? `Tira o quadro limpo de ${cena.a.nome} em ${formatarTempo(cena.a.t, 1)}` : '')
          )}
        </div>
        <p className="text-[11px] leading-snug text-ink-3" data-thumb="cena-no-instante">
          {cena
            ? `Sai limpo, sem legenda: ${cena.b ? 'o grid tem duas cenas, escolha a metade' : `da cena ${cena.a.nome.replace(/\.[^.]+$/, '')} em ${formatarTempo(cena.a.t, 1)}`}.`
            : 'Esse instante nao tem cena no plano do projeto.'}
        </p>
      </div>
    </div>
  )
}
