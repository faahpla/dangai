import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Ban,
  BookmarkPlus,
  ClipboardPaste,
  Copy,
  FlipHorizontal2,
  Crosshair,
  Download,
  ScanFace,
  Spline,
  Upload,
  Video,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'
import {
  KEN_BURNS_EFFECTS,
  MOTION_CURVES,
  ROTATIONS,
  VIDEO_FPS,
  curvePointsSchema,
  medidasDo,
  type CurvePoints,
  type ImageAsset,
  type Scene,
  type MotionCurve,
} from '@shared/contract'
import { fonteDaCamera } from '@shared/camera'
import { useProject } from '@/store/project'
import { exportarPreset, importarPreset, nomeLivre } from '@/store/arquivo-de-preset'
import { Botaozinho, Deslizante, Grupo, Linha, Segmentos, type Segmento } from './painel'
import { Framing } from './Framing'
import { Camera } from './Camera'

/**
 * Os controles FINOS do bloco, deitados na area do meio.
 *
 * Ate 07/09 tudo isto morava na coluna de 228px da direita, empilhado e com
 * rolagem. Ele montou um video inteiro assim e resumiu o problema: "ficar
 * scrollando e ruim pq eu acabo confundindo sliders de intensidade com trecho
 * do clipe".
 *
 * A divisao que ele escolheu: a coluna estreita fica com QUAL CENA E ESTA
 * (trocar, buscar na biblioteca, de que ponto do clipe ela parte), e este
 * painel fica com COMO ELA SE COMPORTA. Os dois sliders que ele confundia
 * passaram a viver em telas diferentes.
 *
 * A area reveza com o editor de legendas -- ideia dele tambem: "essa area ai so
 * usamos para edicao de legenda... entao acredito que de pra revezar ne?".
 */
export function SceneEdit() {
  const images = useProject((s) => s.images)
  const plan = useProject((s) => s.plan)
  const index = useProject((s) => s.selectedScene)
  const updateScene = useProject((s) => s.updateScene)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const playhead = useProject((s) => s.playhead)
  const seguirRosto = useProject((s) => s.seguirRosto)
  const rastrear = useProject((s) => s.rastrear)
  const formato = useProject((s) => s.formato)
  const selecionados = useProject((s) => s.selecionados)
  const ajustesCopiados = useProject((s) => s.ajustesCopiados)
  const copiarAjustes = useProject((s) => s.copiarAjustes)
  const colarAjustes = useProject((s) => s.colarAjustes)
  const applyCurveToAll = useProject((s) => s.applyCurveToAll)

  /**
   * O que o "Seguir o rosto" achou, e EM QUE BLOCO.
   *
   * Preso ao bloco de proposito: sem isso o recado de um bloco ficaria na tela
   * ao selecionar outro, dizendo que o rosto foi encontrado num bloco onde o
   * botao nem chegou a rodar.
   */
  const [recado, setRecado] = useState<{ bloco: number; texto: string } | null>(null)

  /**
   * Em que bloco o "usar em todos" esta ARMADO.
   *
   * null = desarmado. Guardar o bloco, e nao um booleano, faz a arma cair
   * sozinha ao trocar de bloco -- ninguem deve chegar num bloco novo com um
   * clique perigoso ja engatilhado.
   */
  const [espalharArmado, setEspalharArmado] = useState<number | null>(null)

  const scene = index === null ? undefined : plan?.scenes[index]
  const image = scene ? images[scene.imageIndex] : undefined

  if (index === null || !scene || !image) return null

  /*
   * A metade de BAIXO, quando o bloco e tela dividida.
   *
   * Ate 10/09 ela nao tinha controle nenhum: o enquadramento e o movimento da
   * tela dividida valiam so para a de cima, e centralizar um rosto na de baixo
   * era impossivel. Palavras dele: "so consigo mexer na primeira".
   */
  const imageB = scene.imageIndexB === null ? undefined : images[scene.imageIndexB]

  /*
   * O que a metade de baixo esta fazendo AGORA.
   *
   * `null` no campo quer dizer "segue a de cima", entao o que a tela mostra e
   * sempre o valor efetivo -- e nao um controle vazio que nao corresponde ao
   * que se ve no preview.
   */
  const efeitoB = scene.effectB ?? scene.effect
  const intensidadeB = scene.intensityB ?? scene.intensity
  /*
   * `!= null` e nao `!== null`: num projeto salvo antes destes campos existirem
   * eles chegam como UNDEFINED, e `undefined !== null` e verdadeiro -- a tela
   * diria "separada" para um bloco que na verdade segue a metade de cima.
   */
  const separada = scene.effectB != null || scene.intensityB != null

  /* O quadro deste projeto: a geometria da camera depende dele. */
  const aspectoDoQuadro = (() => {
    const q = medidasDo(formato)
    return q.width / q.height
  })()

  const total = plan?.scenes.length ?? 0

  /*
   * Em quem uma acao em lote manda.
   *
   * A selecao quando ha uma, e o bloco aberto quando nao ha. Assim os botoes
   * dizem sempre a verdade sobre o que vao atingir, e "colar" nunca surpreende
   * espalhando para um bloco que ele nao marcou.
   */
  const alvos = selecionados.length > 0 ? selecionados : [index]

  /*
   * O recado do rastreador diz ATE ONDE ele chegou, e nao so se rodou.
   *
   * A perseguicao para quando perde o alvo em vez de continuar chutando, e um
   * caminho que morre na metade ainda serve para a primeira metade -- mas so se
   * o usuario souber onde ele morreu. Sem o numero, um rastreio que cobriu 40%
   * do bloco e um que cobriu tudo parecem o mesmo resultado na tela.
   */
  const rastrearAlvo = async (): Promise<void> => {
    const ateOnde = await rastrear(index)
    setRecado({
      bloco: index,
      texto:
        ateOnde === null
          ? 'Nao deu para seguir nada no centro do retangulo. Ele precisa de textura para se agarrar -- ceu liso, parede lisa e desfoque nao dao ponto nenhum. Tente centralizar melhor o alvo, ou fechar mais o retangulo nele.'
          : ateOnde > 0.95
            ? 'Seguiu o alvo pelo bloco inteiro. Confira no preview e ajuste as chaves se precisar.'
            : `Seguiu ate ${Math.round(ateOnde * 100)}% do bloco e perdeu o alvo. Dali ate o fim a camera segura o ultimo enquadramento.`,
    })
  }

  /*
   * O recado do "Seguir o rosto", ate ele mexer em outra coisa.
   *
   * O detector acha ou nao acha, e as duas respostas mudam o que ele deve fazer
   * em seguida: achando nas duas pontas, esta pronto; achando numa, vale
   * conferir a outra; nao achando nenhuma, o jeito e arrastar na mao. Um botao
   * que mexe no enquadramento sem dizer o que fez deixaria as tres parecendo a
   * mesma coisa.
   */
  const procurarRosto = async (): Promise<void> => {
    const achou = await seguirRosto(index)
    setRecado({
      bloco: index,
      texto:
        achou === 'ambos'
          ? 'Rosto encontrado nas duas pontas. Confira e ajuste se precisar.'
          : achou === 'um'
            ? 'Rosto encontrado em uma ponta so -- a outra repetiu esse enquadramento. Confira a que ficou errada.'
          : 'Nenhum rosto reconhecido neste bloco. O detector so enxerga rosto de frente, entao perfil, nuca e plano aberto passam batido -- aqui e na mao.',
    })
  }

  /*
   * QUE QUADRO DO CLIPE cada ponta da camera mostra.
   *
   * Com a agulha DENTRO deste bloco, as duas mostram o mesmo que o preview --
   * e o unico jeito de enquadrar olhando a imagem que vai estar ali. Antes as
   * duas ficavam presas no primeiro quadro do bloco, e andar na timeline para
   * achar o fim da cena nao mudava nada aqui.
   *
   * Com a agulha FORA, cada uma volta a descrever a propria ponta: a de comeco
   * mostra o primeiro quadro, a de fim mostra o ultimo. Sem agulha por perto,
   * e o que os rotulos prometem.
   */
  const inicioNoClipe = scene.sourceStart ?? 0
  const duracao = scene.end - scene.start
  const naAgulha = playhead >= scene.start && playhead < scene.end
  /** O clipe pode acabar antes do bloco; ali o render congela o ultimo quadro. */
  const ateOFim = (t: number): number =>
    image.durationSec === undefined ? t : Math.min(t, Math.max(image.durationSec - 0.05, 0))
  const instanteComeca = ateOFim(naAgulha ? inicioNoClipe + (playhead - scene.start) : inicioNoClipe)
  const instanteTermina = ateOFim(
    naAgulha ? inicioNoClipe + (playhead - scene.start) : inicioNoClipe + duracao,
  )

  // O botao de aplicar em todos so aparece quando ha o que aplicar -- se o
  // video inteiro ja usa esta curva, ele nao faria nada.
  const mesmaCurvaEmTodas =
    plan?.scenes.every(
      (s) =>
        s.curve === scene.curve &&
        JSON.stringify(s.curvePoints ?? null) === JSON.stringify(scene.curvePoints ?? null),
    ) ?? true

  /* Os efeitos com icone: as sete escolhas cabem numa linha so. */
  const efeitos = opcoesDeEfeito(image.kind === 'video')
  const avisoDoClipe = 'Este clipe ja se move: movimento por cima pede pouca intensidade. Confira no preview.'

  /*
   * O ritmo aparece sempre que ALGO se move: um efeito em qualquer metade, ou
   * uma camera livre -- a camera anda no ritmo do bloco, e antes o ritmo sumia
   * com ela ligada se o efeito tivesse ficado em "nenhum".
   */
  const temMovimento =
    scene.effect !== 'nenhum' ||
    scene.camera != null ||
    (imageB !== undefined && (efeitoB !== 'nenhum' || scene.cameraB != null))

  return (
    /*
     * DUAS COLUNAS, CADA UMA ROLANDO SOZINHA, e cada controle numa LINHA.
     *
     * "Ainda acho que a hierarquia desses botoes ta ocupando muito espaco na
     * tela desnecessariamente." Cada escolha era um botao da largura da coluna,
     * com rotulo numa linha e explicacao em outra: o Movimento passava de uma
     * tela. Agora e rotulo na esquerda, seletor colado na direita (os efeitos
     * viraram icones) e as explicacoes moram no tooltip.
     */
    <div className="enter grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-3">
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
        <Grupo titulo="Enquadramento">
          {imageB ? (
            <>
              {/*
                Duas janelas, uma por metade, LADO A LADO e com nome: sao dois
                enquadramentos parecidos, e sem rotulo eles se confundem.
              */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[10px] text-ink-3">Metade de cima</span>
                  <Framing
                    image={image}
                    alturaMax={130}
                    trecho={{ inicio: scene.start, fim: scene.end, entrada: scene.sourceStart ?? 0 }}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[10px] text-ink-3">Metade de baixo</span>
                  <Framing
                    image={imageB}
                    alturaMax={130}
                    trecho={{ inicio: scene.start, fim: scene.end, entrada: scene.sourceStartB ?? 0 }}
                  />
                </div>
              </div>
              <Linha label="Zoom cima" title="Zoom fixo da metade de cima">
                <Deslizante
                  valor={scene.escala ?? 1}
                  min={1}
                  max={3}
                  step={0.05}
                  padrao={1}
                  texto={`${Math.round((scene.escala ?? 1) * 100)}%`}
                  onChange={(v) => updateScene(index, { escala: v })}
                />
              </Linha>
              <PosicaoDoZoom
                escala={scene.escala ?? 1}
                origem={scene.escalaOrigem ?? { x: 0.5, y: 0.5 }}
                onChange={(o) => updateScene(index, { escalaOrigem: o })}
              />
              <Linha label="Espelhar" title="Flip horizontal de cada metade">
                <Botaozinho active={!!scene.espelhar} onClick={() => updateScene(index, { espelhar: !scene.espelhar })}>
                  <FlipHorizontal2 size={11} strokeWidth={1.5} />
                  Cima
                </Botaozinho>
                <Botaozinho active={!!scene.espelharB} onClick={() => updateScene(index, { espelharB: !scene.espelharB })}>
                  <FlipHorizontal2 size={11} strokeWidth={1.5} />
                  Baixo
                </Botaozinho>
              </Linha>
              <Linha label="Zoom baixo" title="Zoom fixo da metade de baixo">
                <Deslizante
                  valor={scene.escalaB ?? 1}
                  min={1}
                  max={3}
                  step={0.05}
                  padrao={1}
                  texto={`${Math.round((scene.escalaB ?? 1) * 100)}%`}
                  onChange={(v) => updateScene(index, { escalaB: v })}
                />
              </Linha>
              <PosicaoDoZoom
                escala={scene.escalaB ?? 1}
                origem={scene.escalaOrigemB ?? { x: 0.5, y: 0.5 }}
                onChange={(o) => updateScene(index, { escalaOrigemB: o })}
              />
            </>
          ) : (
            <>
              {/*
                CAMERA LIVRE LIGADA: ela manda no quadro, e o retangulo daqui
                nao muda nada no video -- "mudo o enquadramento e o preview nao
                muda". Dizer isso na cara, com o atalho para desligar.
              */}
              {scene.camera != null && (scene.rotation ?? 0) !== 90 && (scene.rotation ?? 0) !== 270 && (
                <div className="flex items-start gap-2 rounded-sm border border-accent/50 bg-accent-dim px-2 py-1.5 text-[11px] leading-snug text-ink-2">
                  <Video size={12} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    A camera livre esta ligada e manda no quadro: este enquadramento nao muda o video. Ajuste o
                    comeco e o fim dela ao lado, ou desligue.
                  </span>
                  <button
                    type="button"
                    onClick={() => updateScene(index, { camera: null })}
                    className="shrink-0 rounded-sm border border-line bg-elevated px-1.5 py-0.5 text-[10px] text-ink-2 hover:text-ink"
                  >
                    Desligar
                  </button>
                </div>
              )}
              <Framing
                image={image}
                trecho={{ inicio: scene.start, fim: scene.end, entrada: scene.sourceStart ?? 0 }}
                zoom={{
                  escala: scene.escala ?? 1,
                  origem: scene.escalaOrigem ?? { x: 0.5, y: 0.5 },
                  onOrigem: (o) => updateScene(index, { escalaOrigem: o }),
                }}
              />
              {/*
                O "Scale" dos editores: zoom FIXO no bloco inteiro, centrado no
                enquadramento acima. Duplo clique volta para 100%.
              */}
              <Linha label="Zoom" title="Zoom fixo no bloco inteiro. Duplo clique volta para 100%.">
                <Deslizante
                  valor={scene.escala ?? 1}
                  min={1}
                  max={3}
                  step={0.05}
                  padrao={1}
                  texto={`${Math.round((scene.escala ?? 1) * 100)}%`}
                  onChange={(v) => updateScene(index, { escala: v })}
                />
              </Linha>
              <PosicaoDoZoom
                escala={scene.escala ?? 1}
                origem={scene.escalaOrigem ?? { x: 0.5, y: 0.5 }}
                onChange={(o) => updateScene(index, { escalaOrigem: o })}
              />
              {/*
                Girar existe para o material que chega deitado. Sao os quatro
                angulos retos: o corte continua preenchendo, sem tarja preta.
                Fora da tela dividida, onde girar uma metade giraria a moldura.
              */}
              <Linha label="Girar">
                <Segmentos
                  opcoes={ROTATIONS.map((graus) => ({ valor: graus, rotulo: ROTATION_LABEL[graus] }))}
                  ativo={(graus) => (scene.rotation ?? 0) === graus}
                  onChange={(graus) => updateScene(index, { rotation: graus })}
                />
              </Linha>
              {/* FLIP: espelha o quadro que sai, com movimento e zoom dentro. */}
              <Linha label="Espelhar" title="Flip horizontal">
                <Botaozinho active={!!scene.espelhar} onClick={() => updateScene(index, { espelhar: !scene.espelhar })}>
                  <FlipHorizontal2 size={11} strokeWidth={1.5} />
                  {scene.espelhar ? 'Espelhado' : 'Espelhar horizontal'}
                </Botaozinho>
              </Linha>
            </>
          )}
        </Grupo>

        {/*
          COPIAR E COLAR AJUSTES: o COMO o bloco se comporta -- movimento,
          ritmo, giro e transicao. Fica de fora o que descreve o MATERIAL
          (imagem, ponto de entrada, camera livre): um caminho de camera e
          desenhado contra aquele clipe, e colado noutro enquadraria o nada.
        */}
        <Grupo
          titulo="Ajustes"
          acao={
            <>
              <Botaozinho
                onClick={() => copiarAjustes(index)}
                title="Copia movimento, ritmo, giro e transicao. O enquadramento e a camera ficam, porque sao daquele clipe."
              >
                <Copy size={11} strokeWidth={1.5} />
                Copiar
              </Botaozinho>
              {ajustesCopiados !== null && (
                <Botaozinho
                  onClick={() => colarAjustes(alvos)}
                  title="Marque varios blocos na timeline com Shift ou Ctrl para colar em todos de uma vez."
                >
                  <ClipboardPaste size={11} strokeWidth={1.5} />
                  {alvos.length > 1 ? `Colar nos ${alvos.length}` : 'Colar'}
                </Botaozinho>
              )}
            </>
          }
        />
      </div>

      <div className="min-h-0 overflow-y-auto pr-1">
        <Grupo
          titulo="Movimento"
          acao={
            /*
             * CAMERA LIVRE no canto do titulo: ela desliga os efeitos, entao e
             * o primeiro galho da decisao, e nao mais uma opcao no meio. Na
             * tela dividida cada metade tem a sua, dentro da propria secao.
             */
            !imageB && (
              <Botaozinho
                active={scene.camera != null}
                title="Desenhar a mao o enquadramento do comeco e do fim do bloco"
                onClick={() =>
                  updateScene(index, {
                    camera:
                      scene.camera == null
                        ? // Nasce PARADA em 1.0x, enquadrando o arquivo
                          // inteiro: "quando ativa a camera livre, o primeiro ja
                          // vem com 1.40x, eu quero que venha em 1.0x".
                          { from: { scale: 1, x: 0, y: 0 }, to: { scale: 1, x: 0, y: 0 }, source: true, keys: [] }
                        : null,
                  })
                }
              >
                <Video size={11} strokeWidth={1.5} />
                Camera livre
              </Botaozinho>
            )
          }
        >
          {!imageB && scene.camera != null && (
            <>
              {/*
                RASTREAR vem primeiro porque funciona sempre: o fluxo optico so
                mede para onde os pixels foram. O detector de rosto e frontal e
                perde perfil e nuca -- por isso os dois DIZEM o que acharam.
              */}
              <div className="flex flex-wrap items-center gap-1">
                {image.kind === 'video' && (
                  <Botaozinho
                    onClick={() => void rastrearAlvo()}
                    title="Segue o que estiver no CENTRO do retangulo. Deixe o alvo no meio antes de clicar."
                  >
                    <Crosshair size={11} strokeWidth={1.5} />
                    Rastrear o centro
                  </Botaozinho>
                )}
                <Botaozinho onClick={() => void procurarRosto()} title="Acha o rosto nas duas pontas do bloco">
                  <ScanFace size={11} strokeWidth={1.5} />
                  Seguir o rosto
                </Botaozinho>
                {scene.camera.keys.length > 0 && (
                  <Botaozinho
                    onClick={() => {
                      updateScene(index, { camera: { ...scene.camera!, keys: [] } })
                      setRecado(null)
                    }}
                    title="Apaga as chaves do meio: a camera volta a ir reto de uma ponta a outra"
                  >
                    <X size={11} strokeWidth={1.5} />
                    Linha reta
                  </Botaozinho>
                )}
              </div>
              <p className="text-[10px] leading-snug text-ink-3">
                {(recado?.bloco === index ? recado.texto : null) ??
                  /*
                   * Dizer que o alvo e o CENTRO nao e detalhe: quem poe o rosto
                   * no alto do retangulo fica com o peito no meio, e e o peito
                   * que seria seguido.
                   */
                  (image.kind === 'video'
                    ? 'Arraste o retangulo. Rastrear segue o que estiver no CENTRO dele.'
                    : 'Arraste o retangulo para escolher o que aparece; o slider aproxima.')}
              </p>
              {/*
                Fonte DEITADA empilha (as duas pontas usam a largura inteira, o
                eixo onde o movimento acontece); fonte em pe fica lado a lado.
              */}
              <div
                className={
                  fonteDaCamera(image, scene.camera, aspectoDoQuadro).aspecto > 1
                    ? 'flex flex-col gap-2'
                    : 'grid grid-cols-2 gap-2'
                }
              >
                <Camera
                  image={image}
                  camera={scene.camera}
                  instante={instanteComeca}
                  label="Comeca em"
                  aoMexer={() => setPlayhead(scene.start)}
                  value={scene.camera.from}
                  onChange={(from) => updateScene(index, { camera: { ...scene.camera!, from } })}
                />
                <Camera
                  image={image}
                  camera={scene.camera}
                  instante={instanteTermina}
                  label="Termina em"
                  aoMexer={() => setPlayhead(Math.max(scene.end - 1 / VIDEO_FPS, scene.start))}
                  value={scene.camera.to}
                  onChange={(to) => updateScene(index, { camera: { ...scene.camera!, to } })}
                />
              </div>
            </>
          )}

          {/*
            Na tela dividida, cada metade e uma secao com nome, cima e depois
            baixo -- a mesma ordem do Enquadramento. Sem o nome ele concluiu que
            o controle da de baixo nao existia: "se eu coloco pan esq ele faz
            nas duas".
          */}
          {imageB && <Subtitulo>Metade de cima</Subtitulo>}
          {imageB && <CameraDaMetade index={index} scene={scene} image={image} metade="cima" />}

          {scene.camera == null && (
            <Linha label="Efeito" title={image.kind === 'video' ? avisoDoClipe : undefined}>
              <Segmentos
                opcoes={efeitos}
                ativo={(e) => scene.effect === e}
                onChange={(effect) => updateScene(index, { effect })}
              />
            </Linha>
          )}
          {scene.camera == null && scene.effect !== 'nenhum' && (
            <Linha label="Intensidade">
              <Deslizante
                valor={scene.intensity}
                min={0.04}
                max={0.15}
                step={0.01}
                texto={`${Math.round(scene.intensity * 100)}%`}
                onChange={(v) => updateScene(index, { intensity: v })}
              />
            </Linha>
          )}

          {imageB && (
            <>
              <Subtitulo>Metade de baixo</Subtitulo>
              <CameraDaMetade index={index} scene={scene} image={imageB} metade="baixo" />
              {scene.cameraB == null && (
                <Linha label="Efeito" title={imageB.kind === 'video' ? avisoDoClipe : undefined}>
                  <Segmentos
                    opcoes={[
                      // "Igual" volta os dois campos para null: e a AUSENCIA de
                      // escolha, e nao uma copia -- copiados, eles parariam de
                      // acompanhar a de cima na proxima mudanca.
                      { valor: 'igual' as const, rotulo: 'Igual', title: 'Igual a metade de cima' },
                      ...efeitos,
                    ]}
                    ativo={(e) => (e === 'igual' ? !separada : separada && efeitoB === e)}
                    onChange={(e) =>
                      updateScene(
                        index,
                        e === 'igual' ? { effectB: null, intensityB: null } : { effectB: e },
                      )
                    }
                  />
                </Linha>
              )}
              {scene.cameraB == null && efeitoB !== 'nenhum' && (
                <Linha label="Intensidade">
                  <Deslizante
                    valor={intensidadeB}
                    min={0.04}
                    max={0.15}
                    step={0.01}
                    texto={`${Math.round(intensidadeB * 100)}%`}
                    onChange={(v) => updateScene(index, { intensityB: v })}
                  />
                </Linha>
              )}
              <Subtitulo>O bloco</Subtitulo>
            </>
          )}

          {temMovimento && (
            <>
              {/*
                O ritmo e do BLOCO: vale para as duas metades e para a camera.
                Escolher um preset apaga o desenho -- guardar o desenho por
                baixo faria o clique seguinte em "Curva" ressuscitar algo que
                ele largou.
              */}
              <ControleDeRitmo
                curve={scene.curve}
                curvePoints={scene.curvePoints}
                onChange={(patch) => updateScene(index, patch)}
              />

              {total > 1 && !mesmaCurvaEmTodas && (
                /*
                 * ESPALHAR A CURVA E DISCRETO E EM DOIS PASSOS: era um botao
                 * largo que ele acertava sem querer, trocando o ritmo dos 52
                 * blocos de uma vez. O primeiro clique so ARMA.
                 */
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (espalharArmado !== index) {
                        setEspalharArmado(index)
                        return
                      }
                      // Havendo selecao, ela manda.
                      if (selecionados.length > 1) {
                        for (const i of selecionados) {
                          updateScene(i, { curve: scene.curve, curvePoints: scene.curvePoints })
                        }
                      } else {
                        applyCurveToAll(scene.curve, scene.curvePoints)
                      }
                      setEspalharArmado(null)
                    }}
                    onPointerLeave={() => setEspalharArmado(null)}
                    className={
                      espalharArmado === index
                        ? 'rounded px-1.5 py-0.5 text-[10px] text-accent underline decoration-dotted underline-offset-2'
                        : 'rounded px-1.5 py-0.5 text-[10px] text-ink-3 transition-colors hover:text-ink-2'
                    }
                  >
                    {espalharArmado === index
                      ? `Confirmar: trocar o ritmo de ${alvos.length > 1 ? alvos.length : total} ${
                          alvos.length > 1 ? 'selecionados' : 'blocos'
                        }`
                      : alvos.length > 1
                        ? `Usar este ritmo nos ${alvos.length} selecionados`
                        : `Usar este ritmo em todos os ${total} blocos`}
                  </button>
                </div>
              )}
            </>
          )}
        </Grupo>
      </div>
    </div>
  )
}

/**
 * PARA ONDE O ZOOM APONTA, em X e Y. "Uso o Zoom mas nao posso definir a
 * posicao X e Y." So aparece com zoom acima de 100% -- sem zoom nao ha o que
 * apontar. 0% e a borda esquerda (ou de cima), 100% a direita (ou de baixo).
 * Tambem da para arrastar o retangulo tracejado no enquadramento.
 */
function PosicaoDoZoom({
  escala,
  origem,
  onChange,
}: {
  escala: number
  origem: { x: number; y: number }
  onChange: (o: { x: number; y: number }) => void
}) {
  if (escala <= 1.001) return null
  return (
    <>
      <Linha label="Zoom X" title="Para onde o zoom aponta na horizontal. Duplo clique centraliza.">
        <Deslizante
          valor={origem.x}
          min={0}
          max={1}
          step={0.01}
          padrao={0.5}
          texto={`${Math.round(origem.x * 100)}%`}
          onChange={(x) => onChange({ ...origem, x })}
        />
      </Linha>
      <Linha label="Zoom Y" title="Para onde o zoom aponta na vertical. Duplo clique centraliza.">
        <Deslizante
          valor={origem.y}
          min={0}
          max={1}
          step={0.01}
          padrao={0.5}
          texto={`${Math.round(origem.y * 100)}%`}
          onChange={(y) => onChange({ ...origem, y })}
        />
      </Linha>
    </>
  )
}

/** Os efeitos com icone: as sete escolhas cabem numa linha so. */
export function opcoesDeEfeito(video: boolean): Segmento<Scene['effect']>[] {
  return [
    {
      valor: 'nenhum',
      rotulo: <Ban size={12} strokeWidth={1.5} />,
      title: video ? 'Nenhum (so o movimento do clipe)' : 'Nenhum (parada)',
    },
    ...KEN_BURNS_EFFECTS.map((effect) => {
      const Icone = EFFECT_ICON[effect]
      return { valor: effect, rotulo: <Icone size={12} strokeWidth={1.5} />, title: EFFECT_LABEL[effect] }
    }),
  ]
}

/**
 * O RITMO do movimento: os quatro prontos e a curva desenhada a mao, com os
 * atalhos de curva ao lado do grafico. Serve ao bloco e ao clipe da faixa.
 *
 * Escolher um preset apaga o desenho -- guardar o desenho por baixo faria o
 * clique seguinte em "Curva" ressuscitar algo que ele largou.
 */
export function ControleDeRitmo({
  curve,
  curvePoints,
  onChange,
}: {
  curve: MotionCurve
  curvePoints: CurvePoints | null
  onChange: (patch: { curve?: MotionCurve; curvePoints: CurvePoints | null }) => void
}) {
  const salvas = useProject((s) => s.curvePresets)
  const carregarCurvas = useProject((s) => s.loadCurvePresets)
  const guardarCurva = useProject((s) => s.saveCurvePreset)
  const removerCurva = useProject((s) => s.removeCurvePreset)
  const [recado, setRecado] = useState<string | null>(null)
  useEffect(() => void carregarCurvas(), [carregarCurvas])

  return (
    <>
      <Linha label="Ritmo">
        <Segmentos
          opcoes={[
            ...MOTION_CURVES.map((c) => ({
              valor: c as MotionCurve | 'desenho',
              rotulo: CURVE_LABEL[c],
              title: CURVE_HINT[c],
            })),
            {
              valor: 'desenho' as const,
              rotulo: (
                <>
                  <Spline size={11} strokeWidth={1.5} />
                  Curva
                </>
              ),
              title: 'Desenhar a curva do ritmo a mao',
            },
          ]}
          ativo={(c) => (c === 'desenho' ? curvePoints !== null : curvePoints === null && curve === c)}
          onChange={(c) =>
            onChange(
              c === 'desenho'
                ? { curvePoints: curvePoints === null ? CURVE_AS_BEZIER[curve] : null }
                : { curve: c, curvePoints: null },
            )
          }
        />
      </Linha>

      {curvePoints !== null && (
        /*
         * O GRAFICO AO LADO DOS ATALHOS, e nao embaixo deles: empilhados eram
         * quatro linhas de botoes antes do desenho aparecer.
         */
        <div className="flex gap-2.5">
          <GraficoDeCurva pontos={curvePoints} onChange={(pontos) => onChange({ curvePoints: pontos })} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap gap-1">
              {CURVAS_PRONTAS.map((preset) => (
                <Botaozinho
                  key={preset.nome}
                  active={mesmaCurva(curvePoints, preset.pontos)}
                  onClick={() => onChange({ curvePoints: preset.pontos })}
                >
                  {preset.nome}
                </Botaozinho>
              ))}
              {/* As dele, guardadas nas configuracoes e validas em todo video. */}
              {salvas.map((preset) => (
                <CurvaSalva
                  key={preset.nome}
                  nome={preset.nome}
                  ativa={mesmaCurva(curvePoints, preset.pontos)}
                  onUsar={() => onChange({ curvePoints: preset.pontos })}
                  onEsquecer={() => void removerCurva(preset.nome)}
                  onExportar={() => void exportarPreset('movimento', preset.nome, preset.pontos).then(setRecado)}
                />
              ))}
              <Botaozinho onClick={() => void guardarCurva(curvePoints)} title="Guardar esta curva">
                <BookmarkPlus size={11} strokeWidth={1.5} />
                Salvar
              </Botaozinho>
              <Botaozinho
                onClick={() => void importarCurvaDeMovimento().then(setRecado)}
                title="Importar uma curva de movimento (.dangai-movimento)"
              >
                <Upload size={11} strokeWidth={1.5} />
                Importar
              </Botaozinho>
            </div>
            {recado && <p className="text-[10px] text-ink-3">{recado}</p>}
            <p className="text-[10px] leading-snug text-ink-3">
              Quanto do movimento ja aconteceu ao longo do tempo. Plana e pausa, ingreme e disparada.
            </p>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Ritmos prontos, para nao desenhar do zero toda vez.
 *
 * Sao os quatro que aparecem em recap de anime, nomeados pelo que fazem e nao
 * pela matematica -- "0.2, 0.9, 0.3, 1" nao diz nada a quem esta escolhendo.
 */
const CURVAS_PRONTAS: readonly { nome: string; pontos: CurvePoints }[] = [
  // Dispara e assenta: o movimento acontece quase todo no comeco do bloco.
  { nome: 'Sai voando', pontos: [0, 0.85, 0.15, 1] },
  // Fica parado, e o movimento inteiro cai no fim -- bom para revelar algo.
  { nome: 'Segura e vai', pontos: [0.85, 0, 1, 0.35] },
  // Chega freando: entra rapido e encosta devagar.
  { nome: 'Chega freando', pontos: [0.1, 0.7, 0.35, 1] },
  // Passa do ponto e volta -- o mesmo repique da entrada elastica da legenda.
  { nome: 'Com repique', pontos: [0.3, 1, 0.5, 0.92] },
]

/** Duas curvas sao a mesma quando os quatro numeros batem. */
function mesmaCurva(a: CurvePoints | null, b: CurvePoints): boolean {
  return a !== null && a.every((v, i) => Math.abs(v - b[i]!) < 0.005)
}

/**
 * De onde o desenho PARTE quando ele abre o grafico.
 *
 * Cada preset na forma de bezier, com os mesmos numeros do CSS. Abrir o grafico
 * numa curva qualquer faria o movimento saltar no instante do clique; assim ele
 * comeca exatamente onde estava e so muda o que arrastar.
 */
const CURVE_AS_BEZIER: Record<MotionCurve, CurvePoints> = {
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in': [0.42, 0, 1, 1],
}

/**
 * O grafico da curva: dois pontos de controle arrastaveis.
 *
 * Horizontal e o tempo do bloco, vertical e quanto do movimento ja aconteceu.
 * Trecho plano e uma pausa, trecho ingreme e uma disparada -- e o mesmo desenho
 * de qualquer editor de video, que e onde ele ja sabe ler isto.
 *
 * A CAIXA E O LIMITE, e nao uma sugestao: arrastar para fora nao passa de 0..1.
 * Fora dessa faixa a curva ultrapassaria o fim do movimento e voltaria, e o pan
 * comeria a folga de borda que existe para nunca aparecer tarja preta.
 */
function GraficoDeCurva({
  pontos,
  onChange,
}: {
  pontos: CurvePoints
  onChange: (pontos: CurvePoints) => void
}) {
  const area = useRef<SVGSVGElement>(null)
  const [arrastando, setArrastando] = useState<0 | 1 | null>(null)
  const [x1, y1, x2, y2] = pontos

  const mover = (event: React.PointerEvent, qual: 0 | 1): void => {
    const caixa = area.current?.getBoundingClientRect()
    if (!caixa) return
    const x = presa(emUnidades((event.clientX - caixa.left) / caixa.width))
    // O SVG cresce para baixo e o progresso para cima: o eixo vira aqui.
    const y = presa(1 - emUnidades((event.clientY - caixa.top) / caixa.height))
    onChange(qual === 0 ? [x, y, x2, y2] : [x1, y1, x, y])
  }

  const px = (v: number): number => v * 100
  const py = (v: number): number => 100 - v * 100

  return (
    <div className="flex w-[132px] shrink-0 flex-col gap-0.5">
      <svg
        ref={area}
        viewBox={`${-FOLGA} ${-FOLGA} ${100 + FOLGA * 2} ${100 + FOLGA * 2}`}
        className="w-full touch-none rounded-sm bg-elevated"
        onPointerMove={(event) => arrastando !== null && mover(event, arrastando)}
        onPointerUp={() => setArrastando(null)}
        onPointerLeave={() => setArrastando(null)}
      >
        {/* A caixa desenhada, e nao a borda do elemento: com a folga em volta, a
            borda ficaria longe do limite real e mentiria sobre onde ele esta. */}
        <rect x={0} y={0} width={100} height={100} fill="none" className="stroke-line-strong" strokeWidth={0.8} />

        {/* Referencia: a diagonal e o movimento em ritmo constante. */}
        <line x1={0} y1={100} x2={100} y2={0} className="stroke-line-strong" strokeWidth={0.8} strokeDasharray="3 3" />

        <line x1={0} y1={100} x2={px(x1)} y2={py(y1)} className="stroke-ink-3" strokeWidth={0.8} />
        <line x1={100} y1={0} x2={px(x2)} y2={py(y2)} className="stroke-ink-3" strokeWidth={0.8} />

        <path
          d={`M 0 100 C ${px(x1)} ${py(y1)}, ${px(x2)} ${py(y2)}, 100 0`}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
        />

        {([0, 1] as const).map((qual) => (
          <g key={qual} className="cursor-grab">
            <circle cx={px(qual === 0 ? x1 : x2)} cy={py(qual === 0 ? y1 : y2)} r={4} className="fill-accent" />
            {/* Alvo maior que a bolinha: 4 unidades dao uns 8 pixels na largura
                do card, que e pouco para pegar com o mouse. */}
            <circle
              cx={px(qual === 0 ? x1 : x2)}
              cy={py(qual === 0 ? y1 : y2)}
              r={10}
              fill="transparent"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                setArrastando(qual)
              }}
            />
          </g>
        ))}
      </svg>
      {/* Os quatro numeros: e o que ele repete em outro bloco quando acerta um ritmo. */}
      <p className="tnum text-[10px] text-ink-3">{pontos.map((v) => v.toFixed(2)).join(', ')}</p>
    </div>
  )
}

/**
 * Folga em volta da caixa, em unidades do desenho.
 *
 * A alca de um preset comum cai exatamente em cima do limite -- o ease-in-out
 * poe uma no chao e outra no teto. Sem esta folga, metade da bolinha fica fora
 * do desenho e nao da para pegar.
 */
const FOLGA = 8

/** Fracao do ELEMENTO para unidade do desenho, descontando a folga das bordas. */
function emUnidades(fracao: number): number {
  return (fracao * (100 + FOLGA * 2) - FOLGA) / 100
}

/** Preso entre 0 e 1: a caixa do grafico e o limite do que a curva pode fazer. */
function presa(v: number): number {
  return Math.min(Math.max(v, 0), 1)
}

/**
 * O giro em graus, do jeito que ele pediu: 90, 180 e -90.
 *
 * -90 e 270 sao a mesma volta; o rotulo usa o numero negativo porque e assim
 * que se pensa em "gira para o outro lado", e nao em "gira tres quartos".
 */
const ROTATION_LABEL: Record<(typeof ROTATIONS)[number], string> = {
  0: '0°',
  90: '90°',
  180: '180°',
  270: '-90°',
}

const EFFECT_ICON: Readonly<Record<(typeof KEN_BURNS_EFFECTS)[number], LucideIcon>> = {
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
  'pan-left': ArrowLeft,
  'pan-right': ArrowRight,
  'pan-up': ArrowUp,
  'pan-down': ArrowDown,
}

const EFFECT_LABEL: Readonly<Record<(typeof KEN_BURNS_EFFECTS)[number], string>> = {
  'zoom-in': 'Zoom in',
  'zoom-out': 'Zoom out',
  'pan-left': 'Pan esq.',
  'pan-right': 'Pan dir.',
  'pan-up': 'Pan cima',
  'pan-down': 'Pan baixo',
}

/**
 * Nomeadas pelo que se ve, nao pelo nome tecnico.
 *
 * "ease-out" nao diz nada para quem esta montando um short -- e pior, o nome
 * sugere o contrario do que faz.
 */
const CURVE_LABEL: Readonly<Record<MotionCurve, string>> = {
  'ease-in-out': 'Suave',
  linear: 'Constante',
  'ease-out': 'Desacelera',
  'ease-in': 'Acelera',
}

const CURVE_HINT: Readonly<Record<MotionCurve, string>> = {
  'ease-in-out': 'Parte devagar e para devagar. E o que o app sempre fez.',
  linear: 'Mesma velocidade do inicio ao fim. Num movimento lento, fica menos travado que o suave.',
  'ease-out': 'Parte rapido e pousa. Bom para revelacao.',
  'ease-in': 'Parte devagar e acelera. Cria tensao entrando no corte.',
}

/**
 * A camera livre de UMA metade da tela dividida.
 *
 * "Opcao de camera livre na tela dividida." Cada metade e um quadro proprio --
 * 1080x960 --, e a camera dela enquadra o arquivo ORIGINAL, que e a fonte que
 * a metade ja usa. Ligada, manda no lugar do foco e do efeito daquela metade;
 * a curva (o ritmo) continua sendo a do bloco.
 */
function CameraDaMetade({
  index,
  scene,
  image,
  metade,
}: {
  index: number
  scene: Scene
  image: ImageAsset
  metade: 'cima' | 'baixo'
}) {
  const updateScene = useProject((s) => s.updateScene)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const playhead = useProject((s) => s.playhead)
  const formato = useProject((s) => s.formato)
  const q = medidasDo(formato)
  const aspectoDaMetade = q.width / (q.height / 2)

  const cam = metade === 'cima' ? scene.camera : scene.cameraB
  const gravar = (c: Scene['camera']): void =>
    updateScene(index, metade === 'cima' ? { camera: c } : { cameraB: c })

  const inicio = (metade === 'cima' ? scene.sourceStart : scene.sourceStartB) ?? 0
  const duracao = scene.end - scene.start
  const naAgulha = playhead >= scene.start && playhead < scene.end
  const ateOFim = (t: number): number =>
    image.durationSec === undefined ? t : Math.min(t, Math.max(image.durationSec - 0.05, 0))
  const comeca = ateOFim(naAgulha ? inicio + (playhead - scene.start) : inicio)
  const termina = ateOFim(naAgulha ? inicio + (playhead - scene.start) : inicio + duracao)

  return (
    <>
      <Linha label="Camera" title="Desenhar a mao o enquadramento do comeco e do fim desta metade">
        <Botaozinho
          active={cam != null}
          onClick={() =>
            gravar(
              cam == null
                ? { from: { scale: 1, x: 0, y: 0 }, to: { scale: 1, x: 0, y: 0 }, source: true, keys: [] }
                : null,
            )
          }
        >
          <Video size={11} strokeWidth={1.5} />
          {cam == null ? 'Camera livre' : 'Camera livre ligada'}
        </Botaozinho>
      </Linha>
      {cam != null && (
        <div className="grid grid-cols-2 gap-2">
          <Camera
            image={image}
            camera={{ source: true }}
            instante={comeca}
            label="Comeca em"
            aspectoDoQuadro={aspectoDaMetade}
            aoMexer={() => setPlayhead(scene.start)}
            value={cam.from}
            onChange={(from) => gravar({ ...cam, from })}
          />
          <Camera
            image={image}
            camera={{ source: true }}
            instante={termina}
            label="Termina em"
            aspectoDoQuadro={aspectoDaMetade}
            aoMexer={() => setPlayhead(Math.max(scene.end - 1 / VIDEO_FPS, scene.start))}
            value={cam.to}
            onChange={(to) => gravar({ ...cam, to })}
          />
        </div>
      )}
    </>
  )
}

/** O nome de uma secao dentro do grupo -- as metades da tela dividida. */
function Subtitulo({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[10px] font-medium text-ink-2">{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

/**
 * Uma curva guardada: usar e esquecer no mesmo botao, sem botao dentro de
 * botao -- sao dois, colados.
 */
/** Le um .dangai-movimento e guarda junto das curvas dele (nome repetido ganha numero). */
async function importarCurvaDeMovimento(): Promise<string | null> {
  const r = await importarPreset('movimento', curvePointsSchema)
  if (r === null) return null
  if ('erro' in r) return r.erro
  const atuais = useProject.getState().curvePresets
  const nome = nomeLivre(r.nome, atuais.map((c) => c.nome))
  const proximas = [...atuais, { nome, pontos: r.dados }]
  useProject.setState({ curvePresets: proximas })
  await window.dangai.saveSettings({ curvePresets: proximas })
  return `"${nome}" importada.`
}

function CurvaSalva({
  nome,
  ativa,
  onUsar,
  onEsquecer,
  onExportar,
}: {
  nome: string
  ativa: boolean
  onUsar: () => void
  onEsquecer: () => void
  onExportar: () => void
}) {
  return (
    <div
      className={[
        'flex h-6 max-w-[140px] items-center rounded-sm border text-[11px]',
        ativa ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2',
      ].join(' ')}
    >
      <button type="button" onClick={onUsar} className="min-w-0 truncate pl-2 pr-1 hover:text-ink">
        {nome}
      </button>
      <button
        type="button"
        onClick={onExportar}
        title={`Exportar "${nome}" para um arquivo`}
        aria-label={`Exportar ${nome}`}
        className="grid h-full w-5 shrink-0 place-items-center text-ink-3 hover:text-ink"
      >
        <Download size={10} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onEsquecer}
        title={`Esquecer "${nome}"`}
        aria-label={`Esquecer ${nome}`}
        className="grid h-full w-5 shrink-0 place-items-center text-ink-3 hover:text-danger"
      >
        <X size={10} strokeWidth={2} />
      </button>
    </div>
  )
}