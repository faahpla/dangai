import { useRef } from 'react'
import { Film, ImagePlus, Library as LibraryIcon, Scissors } from 'lucide-react'
import { isVisual } from '@shared/channels'
import { VIDEO_FPS, type ImageAsset, type Scene } from '@shared/contract'
import { useProject, formatTimecode } from '@/store/project'
import { Chip, Field } from './painel'

/**
 * A coluna estreita: QUAL CENA e esta, e de onde ela parte.
 *
 * Trocar por outra, buscar na biblioteca, o ponto de entrada do clipe, inserir
 * imagem em volta. O que o bloco FAZ -- enquadramento, giro, movimento, curva,
 * transicao -- mora no painel largo do meio, em SceneEdit.
 *
 * A divisao e dele, depois de montar um video inteiro rolando esta coluna:
 * "ficar scrollando e ruim pq eu acabo confundindo sliders de intensidade com
 * trecho do clipe". Os dois sliders passaram a viver em telas diferentes.
 */
/**
 * As outras cinco cenas que serviam neste bloco.
 *
 * So aparece no projeto que veio da montagem automatica -- e ali ela e o que
 * torna a proposta revisavel. Sem a fita, discordar de uma escolha voltaria a
 * ser uma busca na biblioteca inteira, e revisar 20 blocos assim custa mais que
 * ter montado na mao.
 *
 * A razao aparece escrita ("Kisuke Urahara, so ele em cena, cobre o bloco")
 * porque ele precisa saber se confia: um motivo fraco e o aviso de que este e
 * um bloco para olhar com atencao.
 */
function Fita({ index }: { index: number }) {
  const blocos = useProject((s) => s.automountBlocks)
  const swapCandidate = useProject((s) => s.swapCandidate)
  const busy = useProject((s) => s.busy)

  if (!blocos) return null

  /*
   * O indice na TIMELINE nao e o indice no roteiro: bloco que ficou sem cena
   * nao virou imagem. Andar pelos blocos uteis e o que liga os dois.
   */
  let restante = index
  const bloco = blocos.find((b) => b.candidates.length > 0 && restante-- === 0)
  const posicao = blocos.indexOf(bloco!)
  if (!bloco || bloco.candidates.length < 2) return null

  return (
    <Field label={`Trocar a cena (${bloco.candidates.length - 1} opcoes)`}>
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] leading-relaxed text-ink-3">{bloco.candidates[0]!.reason}</p>
        <div className="flex flex-wrap gap-1">
          {bloco.candidates.slice(1).map((candidato, i) => (
            <button
              key={candidato.path}
              type="button"
              disabled={busy !== null}
              onClick={() => void swapCandidate(posicao, i + 1)}
              title={`${candidato.label} -- ${candidato.reason}`}
              className="overflow-hidden rounded-sm border border-line transition-colors duration-150 hover:border-accent disabled:opacity-40"
            >
              <img src={candidato.thumbUrl} alt={candidato.label} className="h-[38px] w-[68px] object-cover" />
            </button>
          ))}
        </div>
      </div>
    </Field>
  )
}

export function SceneCard() {
  const images = useProject((s) => s.images)
  const plan = useProject((s) => s.plan)
  const index = useProject((s) => s.selectedScene)
  const updateScene = useProject((s) => s.updateScene)
  const applyCurveToAll = useProject((s) => s.applyCurveToAll)
  const insertImages = useProject((s) => s.insertImages)
  const abrirBiblioteca = useProject((s) => s.openLibraryToReplace)

  const scene = index === null ? undefined : plan?.scenes[index]
  const image = scene ? images[scene.imageIndex] : undefined
  const imageB =
    scene && scene.imageIndexB !== null ? images[scene.imageIndexB] : undefined

  if (index === null || !scene || !image) return null

  const total = plan?.scenes.length ?? 0

  // O botao de aplicar em todos so aparece quando ha o que aplicar -- se o
  // video inteiro ja usa esta curva, ele nao faria nada.
  // Compara o DESENHO junto: com a curva na mao, "todos iguais" so e verdade se
  // os quatro numeros baterem -- senao o botao sumiria com o desenho por
  // espalhar, so porque o preset por baixo coincidia.
  const mesmaCurvaEmTodas =
    plan?.scenes.every(
      (s) =>
        s.curve === scene.curve &&
        JSON.stringify(s.curvePoints ?? null) === JSON.stringify(scene.curvePoints ?? null),
    ) ?? true

  const inserir = async (seconds: number): Promise<void> => {
    const picked = await window.dangai.pickFiles()
    if (!picked.ok) return
    const imagens = picked.value.filter((path) => isVisual(path))
    if (imagens.length > 0) await insertImages(imagens, seconds)
  }

  return (
    <aside className="enter flex w-[228px] shrink-0 flex-col gap-5 overflow-y-auto">
      <header className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink">
          Bloco {index + 1} <span className="text-ink-3">de {total}</span>
        </span>
        <span className="tnum text-[11px] text-ink-3">
          {(scene.end - scene.start).toFixed(1)}s
        </span>
      </header>

      <Fita index={index} />

      <PontoDeEntrada
        index={index}
        scene={scene}
        image={image}
        label={imageB ? 'Trecho do clipe de cima' : 'Trecho do clipe'}
      />

      <Field label={imageB ? 'Trocar a cena de cima' : 'Trocar por outra cena'}>
        {/*
          A fita resolve o caso comum -- discordar e pegar outra das seis. Esta
          porta e para o caso MUITO especifico, quando ele sabe exatamente qual
          cena quer e ela nao esta entre as seis. Fica fora da Fita de proposito:
          vale para qualquer bloco, inclusive nos projetos que nao vieram da
          montagem automatica.
        */}
        <Chip active={false} onClick={() => void abrirBiblioteca(index, 'cima')}>
          <LibraryIcon size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
          Buscar na biblioteca
        </Chip>
      </Field>

      {/*
        A METADE DE BAIXO, com os mesmos controles da de cima.

        Fica logo abaixo dela e nao numa aba separada: as duas cenas estao na
        tela ao mesmo tempo, e escolher uma olhando a outra e o que o bloco
        dividido pede. O enquadramento e o movimento das duas ja moram no painel
        do meio, entao aqui fica o que faltava -- de onde o clipe parte e qual
        cena e.
      */}
      {imageB && (
        <>
          <PontoDeEntrada
            index={index}
            scene={scene}
            image={imageB}
            campo="sourceStartB"
            label="Trecho do clipe de baixo"
          />

          <Field label="Trocar a cena de baixo">
            <Chip active={false} onClick={() => void abrirBiblioteca(index, 'baixo')}>
              <LibraryIcon size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
              Buscar na biblioteca
            </Chip>
            <p className="flex items-baseline gap-1.5 text-[11px] leading-relaxed text-ink-3">
              {imageB.kind === 'video' && (
                <span className="flex items-center gap-1 text-accent">
                  <Film size={11} strokeWidth={1.5} />
                  clipe
                </span>
              )}
              <span className="min-w-0 truncate">{imageB.fileName}</span>
            </p>
          </Field>
        </>
      )}

      <Field label="Entra em">
        <span className="tnum text-[13px] text-ink-2">{formatTimecode(scene.start)}</span>
      </Field>

      <Field label="Inserir imagem">
        <div className="flex flex-col gap-1.5">
          <Chip active={false} onClick={() => void inserir(scene.start)}>
            <ImagePlus size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            Antes deste bloco
          </Chip>
          <Chip active={false} onClick={() => void inserir((scene.start + scene.end) / 2)}>
            <Scissors size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            No meio, cortando ao meio
          </Chip>
          <Chip active={false} onClick={() => void inserir(scene.end)}>
            <ImagePlus size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
            Depois deste bloco
          </Chip>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-3">
          O tempo sai deste bloco, entao o resto da linha do tempo nao se mexe. Arrastar imagens
          direto na timeline faz o mesmo.
        </p>
      </Field>

      <p className="flex items-baseline gap-1.5 text-[11px] leading-relaxed text-ink-3">
        {/* Miniatura de clipe e miniatura de print sao a mesma coisa na tela.
            Sem esta marca nao da para saber qual bloco e qual. */}
        {image.kind === 'video' && (
          <span className="flex items-center gap-1 text-accent">
            <Film size={11} strokeWidth={1.5} />
            clipe
          </span>
        )}
        <span className="min-w-0 truncate">{image.fileName}</span>
      </p>
    </aside>
  )
}

/**
 * De que ponto do clipe este bloco parte.
 *
 * O clipe chega cortado do AnCut, mas o bloco quase nunca tem a duracao dele:
 * uma cena de 6 segundos num bloco de 2 mostrava sempre os dois PRIMEIROS
 * segundos. Palavras dele: "a parte q eu quero e la pro final ou no meio, por
 * padrao ele ta so no inicio certo?". Antes disso a unica saida era procurar
 * outra cena.
 *
 * O SLIDER VARRE O CLIPE INTEIRO, e nao so a parte que cabe no bloco.
 *
 * Ate aqui ele ia de zero ate `duracao do clipe - duracao do bloco`, para
 * garantir que o bloco nunca ficasse sem imagem. A intencao era boa e o
 * resultado, medido no projeto dele (Mushoku S03E13, 37 cenas), era outro:
 *
 *   cena 3   bloco 1,03s   clipe 1,31s   o slider alcancava 22% do clipe
 *   cena 4   bloco 0,84s   clipe 4,50s   alcancava 81%
 *   cena 1   bloco 1,11s   clipe 0,81s   NAO APARECIA
 *
 * Os clipes do AnCut sao curtos -- 0,65s a 4,5s neste episodio -- entao o
 * quanto do clipe dava para alcancar mudava de cena para cena sem nada
 * explicar, e em 2 de 12 cenas o controle sumia. Palavras dele: "o slider nao
 * condiz com o clipe inteiro". Nao condizia mesmo.
 *
 * Agora ele alcanca o clipe todo. Passar do ponto em que o bloco deixa de ser
 * coberto nao quebra nada -- o render ja congela o ultimo frame nesse caso, e
 * sempre congelou. O que faltava era DIZER: o rodape avisa quantos segundos
 * congelam, e o aviso aparece tambem quando o clipe ja e mais curto que o
 * bloco, que antes congelava calado.
 *
 * Serve as DUAS metades da tela dividida. Ate a v1.27 a de baixo partia sempre
 * do zero e nao tinha controle nenhum -- "eu tenho um acesso muito limitado a
 * cena debaixo". Numa tela dividida as duas dividem a atencao por igual, e nao
 * ha motivo para uma ter menos controle que a outra.
 */
function PontoDeEntrada({
  index,
  scene,
  image,
  campo = 'sourceStart',
  label = 'Trecho do clipe',
}: {
  index: number
  scene: Scene
  image: ImageAsset
  campo?: 'sourceStart' | 'sourceStartB'
  label?: string
}) {
  const updateScene = useProject((s) => s.updateScene)
  const setPlayhead = useProject((s) => s.setPlayhead)
  const quadroRef = useRef<HTMLVideoElement | null>(null)

  const bloco = scene.end - scene.start
  const total = image.durationSec ?? 0

  /*
   * Ate onde o ponto de entrada pode ir: o clipe inteiro menos um frame.
   *
   * Um frame, e nao zero: comecar exatamente no fim deixaria o bloco sem
   * imagem nenhuma para congelar.
   */
  const ultimo = Math.max(total - 1 / VIDEO_FPS, 0)
  if (image.kind !== 'video' || ultimo <= 0.05) return null

  const inicio = Math.min(scene[campo] ?? 0, ultimo)
  /** Quanto do bloco fica sem clipe, e portanto congelado no ultimo frame. */
  const congela = Math.max(inicio + bloco - total, 0)

  return (
    <Field label={label}>
      <div className="flex flex-col gap-1.5">
        {/*
          O QUADRO DAQUELE INSTANTE, enquanto ele arrasta.

          O slider sozinho pedia fe: mexer nele mostrava "1,2s - 3,2s de 6,0s" e
          mais nada, entao descobrir se o ponto era o certo exigia dar play e
          esperar o bloco chegar. Escolher onde o clipe comeca olhando numero e
          o que tornava esta parte confusa de usar.

          E um <video> parado servindo de visor: nada toca, so o currentTime
          anda junto com o slider.
        */}
        <video
          ref={quadroRef}
          src={image.url}
          muted
          playsInline
          preload="metadata"
          // O primeiro quadro so pode ser posicionado depois que o navegador
          // sabe a duracao; antes disso, atribuir currentTime nao faz nada.
          onLoadedMetadata={() => {
            if (quadroRef.current) quadroRef.current.currentTime = inicio
          }}
          className="h-[104px] w-full rounded-sm border border-line bg-black object-contain"
        />
        <input
          type="range"
          min={0}
          max={Math.round(ultimo * 10)}
          value={Math.round(inicio * 10)}
          onChange={(event) => {
            const alvo = Number(event.target.value) / 10
            updateScene(index, { [campo]: alvo })
            if (quadroRef.current) quadroRef.current.currentTime = alvo
            /*
             * Leva o preview para o comeco do bloco a cada arrasto.
             *
             * Sem isto ele arrastaria olhando um instante do video que nao tem
             * relacao com o que esta mudando -- e o ponto de entrada so se ve
             * assistindo o bloco.
             */
            setPlayhead(scene.start)
          }}
          className="w-full accent-accent"
          aria-label="De que ponto do clipe este bloco comeca"
        />
        <span className="tnum text-[11px] text-ink-2">
          {inicio.toFixed(1)}s – {Math.min(inicio + bloco, total).toFixed(1)}s
          <span className="text-ink-3"> de {total.toFixed(1)}s</span>
          {/*
            O congelamento sempre existiu; o que nao existia era o aviso.
            Duas das doze cenas medidas no projeto dele congelavam ~0,3s sem
            nada na tela dizer -- e descobrir isso exigia renderizar.
          */}
          {congela > 0.05 && (
            <span className="text-accent"> · congela {congela.toFixed(1)}s no fim</span>
          )}
        </span>
      </div>
    </Field>
  )
}
