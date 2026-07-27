import {
  Play,
  Pause,
  FolderOpen,
  Volume2,
  VolumeX,
  Captions,
  CaptionsOff,
  FileText,
  Pencil,
  Music,
  X,
  TriangleAlert,
  Type,
  Hash,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useProject } from '@/store/project'
import {
  CAPTION_COLOR_HEX,
  CAPTION_COLORS,
  CAPTION_Y_DEFAULT,
  CAPTION_Y_MAX,
  CAPTION_Y_MIN,
  MUSIC_GAIN_DB_MAX,
  MUSIC_GAIN_DB_MIN,
} from '@shared/contract'
import { dedupe, preflight } from '@shared/preflight'

/**
 * Transporte e acao. Um botao primario so -- renderizar, que vira cancelar
 * durante o render. O rosa mora no preenchimento da timeline nesse momento,
 * entao aqui o botao fica cinza.
 */
export function RenderBar() {
  const audio = useProject((s) => s.audio)
  const images = useProject((s) => s.images)
  const playing = useProject((s) => s.playing)
  const render = useProject((s) => s.render)
  const lastOutput = useProject((s) => s.lastOutput)
  const sfxEnabled = useProject((s) => s.sfxEnabled)
  const sfxCount = useProject((s) =>
    s.plan && s.sfxFiles.length > 0 ? Math.ceil((s.plan.scenes.length - 1) / 2) : 0,
  )
  const toggleSfx = useProject((s) => s.toggleSfx)
  const captionsEnabled = useProject((s) => s.captionsEnabled)
  const captionCount = useProject((s) => s.captions.length)
  const toggleCaptions = useProject((s) => s.toggleCaptions)
  const script = useProject((s) => s.script)
  const openScript = useProject((s) => s.openScript)
  const captionsOpen = useProject((s) => s.captionsOpen)
  const openCaptions = useProject((s) => s.openCaptions)
  const togglePlay = useProject((s) => s.togglePlay)
  const startRender = useProject((s) => s.startRender)
  const cancelRender = useProject((s) => s.cancelRender)

  const isRendering = render !== null
  const canRender = Boolean(audio) && images.length > 0

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={togglePlay}
        disabled={!canRender || isRendering}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
        className="lift grid size-8 place-items-center rounded-sm border border-line bg-elevated text-ink-2 hover:text-ink disabled:opacity-40"
      >
        {playing ? <Pause size={14} strokeWidth={1.5} /> : <Play size={14} strokeWidth={1.5} />}
      </button>

      {!isRendering && (
        <button
          type="button"
          onClick={() => openScript(true)}
          title={
            script
              ? 'Roteiro carregado — o texto das legendas vem dele'
              : 'Cole o roteiro para as legendas sairem sem erro de escrita'
          }
          className={[
            'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
            script
              ? 'border-accent bg-accent-dim text-ink'
              : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
          ].join(' ')}
        >
          <FileText size={12} strokeWidth={1.5} />
          Roteiro
        </button>
      )}

      {captionCount > 0 && !isRendering && (
        <button
          type="button"
          onClick={() => openCaptions(!captionsOpen)}
          title="Mesclar e dividir legendas"
          className={[
            'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
            captionsOpen
              ? 'border-line-strong bg-elevated text-ink'
              : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
          ].join(' ')}
        >
          <Pencil size={12} strokeWidth={1.5} />
          Editar
        </button>
      )}

      {captionCount > 0 && !isRendering && (
        <button
          type="button"
          onClick={toggleCaptions}
          title={captionsEnabled ? 'Legendas queimadas no video' : 'Sem legendas'}
          className={[
            'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
            captionsEnabled
              ? 'border-accent bg-accent-dim text-ink'
              : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
          ].join(' ')}
        >
          {captionsEnabled ? (
            <Captions size={12} strokeWidth={1.5} />
          ) : (
            <CaptionsOff size={12} strokeWidth={1.5} />
          )}
          Legendas
        </button>
      )}

      {captionCount > 0 && captionsEnabled && !isRendering && <EstiloControl />}

      {sfxCount > 0 && !isRendering && (
        <button
          type="button"
          onClick={toggleSfx}
          title={sfxEnabled ? `${sfxCount} SFX no video` : 'SFX mutados'}
          className={[
            'lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[11px]',
            sfxEnabled ? 'text-ink-2 hover:text-ink' : 'text-ink-3',
          ].join(' ')}
        >
          {sfxEnabled ? (
            <Volume2 size={12} strokeWidth={1.5} />
          ) : (
            <VolumeX size={12} strokeWidth={1.5} />
          )}
          <span className="tnum">{sfxCount} SFX</span>
        </button>
      )}

      {!isRendering && <CardsControl />}

      {!isRendering && <Publicacao />}

      {!isRendering && <MusicControl />}

      {!isRendering && <Preflight />}

      {lastOutput && !isRendering && (
        <button
          type="button"
          onClick={() => void window.dangai.revealFile(lastOutput)}
          className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[11px] text-ink-2 hover:text-ink"
        >
          <FolderOpen size={12} strokeWidth={1.5} />
          Abrir pasta
        </button>
      )}

      <div className="flex-1" />

      {isRendering ? (
        <div className="flex items-center gap-3">
          <span className="tnum text-[11px] text-ink-2">
            {render.message ?? `${Math.round(render.progress * 100)}%`}
          </span>
          <button
            type="button"
            onClick={() => void cancelRender()}
            className="lift rounded-sm border border-line bg-elevated px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:text-ink"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void startRender()}
          disabled={!canRender}
          className="lift rounded-sm border border-line bg-elevated px-3.5 py-1.5 text-[13px] font-medium text-ink hover:bg-[#1d1d21] disabled:opacity-40"
        >
          Renderizar
        </button>
      )}
    </div>
  )
}

/**
 * Titulo, descricao e hashtags para subir o video.
 *
 * O app ja tem o roteiro inteiro, entao isto custa uma chamada e poupa o
 * trabalho manual que hoje acontece depois de cada render. Fica salvo no
 * projeto: reabrir nao gasta outra chamada.
 */
function Publicacao() {
  const metadata = useProject((s) => s.metadata)
  const script = useProject((s) => s.script)
  const transcript = useProject((s) => s.transcript)
  const busy = useProject((s) => s.busy)
  const generate = useProject((s) => s.generateMetadata)
  const [aberto, setAberto] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)

  const temTexto = (script?.trim().length ?? 0) >= 40 || (transcript?.text?.trim().length ?? 0) >= 40

  const copiar = (chave: string, texto: string): void => {
    void window.dangai.copyText(texto)
    setCopiado(chave)
    window.setTimeout(() => setCopiado((atual) => (atual === chave ? null : atual)), 1400)
  }

  if (!temTexto) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title="Titulo, descricao e hashtags a partir do roteiro"
        className={[
          'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
          metadata
            ? 'border-accent bg-accent-dim text-ink'
            : aberto
              ? 'border-line-strong bg-elevated text-ink'
              : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
        ].join(' ')}
      >
        <Hash size={12} strokeWidth={1.5} />
        Publicacao
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={() => setAberto(false)} />
          <div className="glass enter absolute bottom-[calc(100%+6px)] left-0 z-50 max-h-[360px] w-[420px] overflow-y-auto rounded-md p-3">
            {!metadata ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-[12px] leading-snug text-ink-3">
                  Escrevo tres titulos, a descricao e as hashtags a partir do seu roteiro. So o
                  texto sai da sua maquina.
                </p>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void generate()}
                  className="lift rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[12px] text-ink disabled:opacity-40"
                >
                  {busy ? 'Escrevendo...' : 'Escrever'}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-ink-3">Titulos</span>
                  {metadata.titles.map((titulo, index) => (
                    <button
                      key={titulo}
                      type="button"
                      onClick={() => copiar(`t${index}`, titulo)}
                      className="flex items-start gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] leading-snug text-ink-2 hover:bg-accent-dim hover:text-ink"
                    >
                      <span className="flex-1">{titulo}</span>
                      <span className="tnum shrink-0 text-[10px] text-ink-3">
                        {copiado === `t${index}` ? 'copiado' : `${titulo.length}`}
                      </span>
                    </button>
                  ))}
                </div>

                <Copiavel
                  rotulo="Descricao"
                  texto={metadata.description}
                  copiado={copiado === 'desc'}
                  onCopiar={() => copiar('desc', metadata.description)}
                />

                <Copiavel
                  rotulo="Hashtags"
                  texto={metadata.hashtags.map((tag) => `#${tag}`).join(' ')}
                  copiado={copiado === 'tags'}
                  onCopiar={() => copiar('tags', metadata.hashtags.map((tag) => `#${tag}`).join(' '))}
                />

                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void generate()}
                  className="self-start text-[11px] text-ink-3 hover:text-accent disabled:opacity-40"
                >
                  {busy ? 'Escrevendo...' : 'Escrever de novo'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Copiavel({
  rotulo,
  texto,
  copiado,
  onCopiar,
}: {
  rotulo: string
  texto: string
  copiado: boolean
  onCopiar: () => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-ink-3">{rotulo}</span>
        <span className="text-[10px] text-ink-3">{copiado ? 'copiado' : ''}</span>
      </div>
      <button
        type="button"
        onClick={onCopiar}
        className="rounded-sm px-2 py-1.5 text-left text-[12px] leading-snug text-ink-2 hover:bg-accent-dim hover:text-ink"
      >
        {texto}
      </button>
    </div>
  )
}

/**
 * A aparencia da legenda: cor do marcador e altura na tela.
 *
 * So aparece com as legendas ligadas -- controle que nao faz nada e pior que
 * controle nenhum.
 *
 * As amostras sao os tons de verdade, nao aproximacoes: vem do mesmo
 * CAPTION_COLOR_HEX que a composicao usa. O corpo da legenda continua branco em
 * todas: sobre print de anime, branco com contorno preto e o unico par que se le
 * em qualquer fundo, e trocar isso seria trocar legibilidade por gosto.
 *
 * A altura fecha o popover so no soltar do mouse, e nao a cada passo: arrastar
 * o controle com o preview aberto e justamente como se escolhe a altura.
 */
function EstiloControl() {
  const captionColor = useProject((s) => s.captionColor)
  const setCaptionColor = useProject((s) => s.setCaptionColor)
  const captionY = useProject((s) => s.captionY)
  const setCaptionY = useProject((s) => s.setCaptionY)
  const [aberto, setAberto] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label="Estilo da legenda"
        title="Cor da palavra marcada e altura da legenda"
        className={[
          'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
          aberto
            ? 'border-line-strong bg-elevated text-ink'
            : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
        ].join(' ')}
      >
        <span
          className="size-3 rounded-full"
          style={{ backgroundColor: CAPTION_COLOR_HEX[captionColor] }}
        />
        Estilo
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={() => setAberto(false)} />
          <div className="glass enter absolute bottom-[calc(100%+6px)] left-0 z-50 w-[248px] rounded-md p-3">
            <span className="text-[10px] uppercase tracking-wide text-ink-3">Cor da palavra</span>
            <div className="mt-1.5 flex gap-1">
              {CAPTION_COLORS.map((cor) => (
                <button
                  key={cor}
                  type="button"
                  onClick={() => setCaptionColor(cor)}
                  title={cor}
                  aria-label={cor}
                  aria-pressed={cor === captionColor}
                  className={[
                    'grid size-7 place-items-center rounded-sm border',
                    cor === captionColor ? 'border-ink-2' : 'border-transparent hover:border-line',
                  ].join(' ')}
                >
                  <span
                    className="size-4 rounded-full"
                    style={{ backgroundColor: CAPTION_COLOR_HEX[cor] }}
                  />
                </button>
              ))}
            </div>

            <div className="my-3 h-px bg-line" />

            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-wide text-ink-3">Altura</span>
              <button
                type="button"
                onClick={() => setCaptionY(CAPTION_Y_DEFAULT)}
                disabled={captionY === CAPTION_Y_DEFAULT}
                className="text-[10px] text-ink-3 hover:text-ink-2 disabled:opacity-0"
              >
                voltar ao padrao
              </button>
            </div>
            <input
              type="range"
              aria-label="Altura da legenda"
              min={CAPTION_Y_MIN}
              max={CAPTION_Y_MAX}
              step={0.005}
              value={captionY}
              onChange={(event) => setCaptionY(Number(event.target.value))}
              className="dangai-range mt-1.5 w-full"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              {captionY < CAPTION_Y_DEFAULT - 0.02
                ? 'Abaixo do padrao: no TikTok e no Reels a faixa de baixo fica coberta pela interface do app.'
                : captionY > 0.45
                  ? 'Perto do meio da tela, onde o card de fechamento aparece.'
                  : 'Fora da area que a interface do TikTok e do Reels cobre.'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Gancho e fechamento: dois campos de texto e o tempo de cada um.
 *
 * Os cards entram POR CIMA da imagem que ja estava ali -- nao esticam o video.
 * A narracao e continua e os blocos ja estao distribuidos sobre ela; abrir
 * espaco no comeco jogaria tudo que vem depois para fora de sincronia.
 */
function CardsControl() {
  const hookText = useProject((s) => s.hookText)
  const hookSec = useProject((s) => s.hookSec)
  const endText = useProject((s) => s.endText)
  const endSec = useProject((s) => s.endSec)
  const setCard = useProject((s) => s.setCard)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const durationSec = useProject((s) => s.audio?.durationSec ?? 0)
  const [aberto, setAberto] = useState(false)

  const ativos = (hookText.trim() ? 1 : 0) + (endText.trim() ? 1 : 0)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title="Texto grande no comeco e no fim do video"
        className={[
          'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
          ativos > 0
            ? 'border-accent bg-accent-dim text-ink'
            : aberto
              ? 'border-line-strong bg-elevated text-ink'
              : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
        ].join(' ')}
      >
        <Type size={12} strokeWidth={1.5} />
        Cards
        {ativos > 0 && <span className="tnum">{ativos}</span>}
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={() => setAberto(false)} />
          <div className="glass enter absolute bottom-[calc(100%+6px)] left-0 z-50 w-[340px] rounded-md p-3">
            <CardField
              rotulo="Gancho"
              dica="Aparece no alto, nos primeiros segundos"
              text={hookText}
              seconds={hookSec}
              onText={(text) => setCard('hook', { text })}
              onSeconds={(seconds) => setCard('hook', { seconds })}
              onVer={() => setPlayhead(0)}
            />
            <div className="my-3 h-px bg-line" />
            <CardField
              rotulo="Fechamento"
              dica="Aparece no centro, no fim do video"
              text={endText}
              seconds={endSec}
              onText={(text) => setCard('end', { text })}
              onSeconds={(seconds) => setCard('end', { seconds })}
              onVer={() => setPlayhead(Math.max(durationSec - endSec / 2, 0))}
            />
          </div>
        </>
      )}
    </div>
  )
}

function CardField({
  rotulo,
  dica,
  text,
  seconds,
  onText,
  onSeconds,
  onVer,
}: {
  rotulo: string
  dica: string
  text: string
  seconds: number
  onText: (text: string) => void
  onSeconds: (seconds: number) => void
  onVer: () => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-ink-2">{rotulo}</span>
        {text.trim().length > 0 && (
          <button
            type="button"
            onClick={onVer}
            className="text-[10px] text-ink-3 hover:text-accent"
          >
            ver no preview
          </button>
        )}
      </div>

      <input
        value={text}
        spellCheck={false}
        placeholder={dica}
        onChange={(event) => onText(event.target.value)}
        // Sem isso os atalhos globais disparam por baixo enquanto ele digita:
        // um espaco no texto viraria play/pause.
        onKeyDown={(event) => event.stopPropagation()}
        className="w-full select-text rounded-sm border border-line bg-surface px-2 py-1.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
      />

      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0.5}
          max={8}
          step={0.5}
          value={seconds}
          onChange={(event) => onSeconds(Number(event.target.value))}
          aria-label={`Duracao do ${rotulo.toLowerCase()}`}
          className="dangai-range flex-1"
        />
        <span className="tnum w-[34px] shrink-0 text-right text-[11px] text-ink-3">
          {seconds.toFixed(1)}s
        </span>
      </div>
    </div>
  )
}

/**
 * O que o app percebe de errado antes de gastar um minuto renderizando.
 *
 * Nunca bloqueia o render: um bloco de meio segundo pode ser exatamente o que
 * ele quis. So nao pode acontecer de ele descobrir assistindo o MP4 pronto.
 *
 * Some quando nao ha nada a dizer -- um "tudo certo" permanente vira ruido e
 * ensina o olho a ignorar o canto da tela onde os avisos aparecem.
 */
function Preflight() {
  const plan = useProject((s) => s.plan)
  const images = useProject((s) => s.images)
  const captions = useProject((s) => s.captions)
  const captionsEnabled = useProject((s) => s.captionsEnabled)
  const durationSec = useProject((s) => s.audio?.durationSec ?? 0)
  const selectScene = useProject((s) => s.selectScene)
  const [aberto, setAberto] = useState(false)

  const avisos = useMemo(
    () => dedupe(preflight({ plan, images, captions, captionsEnabled, durationSec })),
    [plan, images, captions, captionsEnabled, durationSec],
  )

  if (avisos.length === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title="Coisas que talvez voce queira ver antes de renderizar"
        className={[
          'lift flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px]',
          aberto
            ? 'border-line-strong bg-elevated text-ink'
            : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
        ].join(' ')}
      >
        <TriangleAlert size={12} strokeWidth={1.5} />
        <span className="tnum">{avisos.length}</span>
      </button>

      {aberto && (
        <>
          {/* Fecha ao clicar fora sem virar modal: nao escurece nem prende o foco. */}
          <div className="fixed inset-0 z-40" onPointerDown={() => setAberto(false)} />
          <ul className="glass enter absolute bottom-[calc(100%+6px)] left-0 z-50 max-h-[240px] w-[380px] overflow-y-auto rounded-md p-1.5">
            {avisos.map((aviso, index) => (
              <li key={`${aviso.tipo}-${index}`}>
                <button
                  type="button"
                  disabled={aviso.scene === undefined}
                  onClick={() => {
                    if (aviso.scene === undefined) return
                    selectScene(aviso.scene)
                    setAberto(false)
                  }}
                  className={[
                    'w-full rounded-sm px-2.5 py-2 text-left text-[12px] leading-snug text-ink-2',
                    aviso.scene === undefined ? 'cursor-default' : 'hover:bg-accent-dim hover:text-ink',
                  ].join(' ')}
                >
                  {aviso.texto}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * Cama de musica: escolher a faixa e regular o quanto ela fica abaixo da voz.
 *
 * O deslizante so aparece depois que ha faixa -- antes disso ele nao controla
 * nada. O numero em dB fica a mostra porque e a unica forma de repetir o mesmo
 * equilibrio no proximo video sem depender do ouvido.
 */
function MusicControl() {
  const music = useProject((s) => s.music)
  const gainDb = useProject((s) => s.musicGainDb)
  const pickMusic = useProject((s) => s.pickMusic)
  const clearMusic = useProject((s) => s.clearMusic)
  const setMusicGain = useProject((s) => s.setMusicGain)

  if (!music) {
    return (
      <button
        type="button"
        onClick={() => void pickMusic()}
        title="Uma faixa por baixo da narracao, em volume bem menor"
        className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[11px] text-ink-3 hover:text-ink-2"
      >
        <Music size={12} strokeWidth={1.5} />
        Musica
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-sm border border-accent bg-accent-dim px-2.5 py-1.5">
      <Music size={12} strokeWidth={1.5} className="shrink-0 text-accent" />
      <button
        type="button"
        onClick={() => void pickMusic()}
        title={`${music.fileName} — clique para trocar`}
        className="max-w-[130px] truncate text-[11px] text-ink"
      >
        {music.fileName.replace(/\.[^.]+$/, '')}
      </button>

      <input
        type="range"
        min={MUSIC_GAIN_DB_MIN}
        max={MUSIC_GAIN_DB_MAX}
        step={1}
        value={gainDb}
        onChange={(event) => setMusicGain(Number(event.target.value))}
        aria-label="Volume da musica"
        title="Quanto a musica fica abaixo da narracao"
        className="dangai-range w-[68px]"
      />
      <span className="tnum w-[38px] shrink-0 text-right text-[11px] text-ink-3">{gainDb} dB</span>

      <button
        type="button"
        onClick={clearMusic}
        aria-label="Tirar a musica"
        title="Tirar a musica"
        className="grid size-4 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink"
      >
        <X size={11} strokeWidth={1.5} />
      </button>
    </div>
  )
}
