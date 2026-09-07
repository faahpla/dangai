import { Film, ImagePlus, Library as LibraryIcon, Scissors } from 'lucide-react'
import { isVisual } from '@shared/channels'
import { type ImageAsset, type Scene } from '@shared/contract'
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

      <PontoDeEntrada index={index} scene={scene} image={image} />

      <Field label="Trocar por outra cena">
        {/*
          A fita resolve o caso comum -- discordar e pegar outra das seis. Esta
          porta e para o caso MUITO especifico, quando ele sabe exatamente qual
          cena quer e ela nao esta entre as seis. Fica fora da Fita de proposito:
          vale para qualquer bloco, inclusive nos projetos que nao vieram da
          montagem automatica.
        */}
        <Chip active={false} onClick={() => void abrirBiblioteca(index)}>
          <LibraryIcon size={11} strokeWidth={1.5} className="mr-1 inline align-[-1px]" />
          Buscar na biblioteca
        </Chip>
      </Field>

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
 * So aparece em clipe que SOBRA. Print nao tem de onde partir, e clipe que ja
 * cabe justo nao tem para onde correr -- oferecer um controle que nao muda nada
 * e pior que nao oferecer.
 */
function PontoDeEntrada({
  index,
  scene,
  image,
}: {
  index: number
  scene: Scene
  image: ImageAsset
}) {
  const updateScene = useProject((s) => s.updateScene)
  const setPlayhead = useProject((s) => s.setPlayhead)

  const bloco = scene.end - scene.start
  const total = image.durationSec ?? 0
  const sobra = total - bloco
  if (image.kind !== 'video' || sobra <= 0.05) return null

  const inicio = Math.min(scene.sourceStart ?? 0, sobra)

  return (
    <Field label="Trecho do clipe">
      <div className="flex flex-col gap-1.5">
        <input
          type="range"
          min={0}
          max={Math.round(sobra * 10)}
          value={Math.round(inicio * 10)}
          onChange={(event) => {
            updateScene(index, { sourceStart: Number(event.target.value) / 10 })
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
          {inicio.toFixed(1)}s – {(inicio + bloco).toFixed(1)}s
          <span className="text-ink-3"> de {total.toFixed(1)}s</span>
        </span>
      </div>
    </Field>
  )
}
