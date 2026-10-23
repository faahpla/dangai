import { motion } from "motion/react";
import {
  Clapperboard,
  History,
  Library as LibraryIcon,
  RectangleHorizontal,
  RectangleVertical,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { BotoesDosModulosNaTelaInicial, useModulosLigados } from "@/modulos";
import { useProject } from "@/store/project";
import { classifyFile } from "@shared/channels";
import { useRecentes } from "@/store/recentes";
import { FORMATOS, medidasDo, type Formato } from "@shared/contract";
import { CartaoRecente, rotulosDoRecente } from "./CartaoRecente";

interface DropzoneProps {
  isDragging: boolean;
}

/**
 * Estado vazio: ocupa a tela, uma frase so, um convite para agir. Clicar abre o
 * dialogo nativo -- soltar os arquivos e o caminho principal.
 */
export function Dropzone({ isDragging }: DropzoneProps) {
  const ingest = useProject((s) => s.ingest);
  const busy = useProject((s) => s.busy);
  // Um botao de modulo (o "Gerar recap") com o arquivo em cima dele: a area
  // de soltar do nucleo se apaga, para nao parecer que vai cair nela.
  const [alvoDeModulo, setAlvoDeModulo] = useState(false);
  const destaque = isDragging && !alvoDeModulo;
  useEffect(() => {
    if (!isDragging) setAlvoDeModulo(false);
  }, [isDragging]);

  const pick = async () => {
    const result = await window.dangai.pickFiles();
    if (result.ok && result.value.length > 0) await ingest(result.value, undefined, "dialogo");
  };

  return (
    <div className="flex h-full w-full flex-col gap-4">
      <div className="relative min-h-0 w-full flex-1">
        <button
          type="button"
          onClick={pick}
          disabled={busy !== null}
          className={[
            "group relative flex h-full w-full flex-col items-center justify-center gap-5 rounded-lg",
            "border border-dashed transition-colors duration-200 ease-dangai",
            destaque
              ? "border-accent bg-accent-dim"
              : "border-line hover:border-line-strong",
          ].join(" ")}
        >
          <motion.div
            animate={{ scale: destaque ? 1.04 : 1 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center gap-5"
          >
            <span
              className={[
                "text-[32px] font-semibold tracking-tight transition-colors duration-200",
                destaque ? "text-accent" : "text-ink",
              ].join(" ")}
            >
              {busy ?? "Soltar áudio e imagens aqui"}
            </span>
            <span className="text-[13px] text-ink-3">
              A ordem em que você solta as imagens e a ordem no vídeo
            </span>
            <span className="text-[11px] text-ink-3">
              Solte o roteiro em .txt junto e as legendas saem com o texto exato
            </span>
          </motion.div>
        </button>

        {/*
          A LINHA DE CIMA, uma so: os botoes dos modulos (o "Gerar recap") a
          esquerda, o formato no meio e os atalhos na direita -- o desenho do
          AniRecap Studio. Antes eram blocos soltos e absolutos por cima da
          area de soltar, e os atalhos ja cobriam o "Long form" em 1280 px,
          mesmo sem modulo; com o "Gerar recap" junto, ate em 1440.

          Com espaco, grade 1fr|auto|1fr: o formato fica no centro da TELA, em
          cima do titulo, como sempre. Sem espaco para os dois lados iguais
          (linha < 1312 px: a direita tem ~480 px, o formato ~304, e 16 px de
          folga de cada lado), vira flex: o formato no meio do vao, longe dos
          dois. Os botoes dos modulos ficam no fluxo, nunca por cima de nada.
          O @container/topo tambem tira as medidas dos chips quando nem o flex
          tem espaco (janela minima). Sem modulo, a esquerda fica vazia.
        */}
        <div className="@container/topo pointer-events-none absolute inset-x-6 top-6 z-10">
          <div className="flex items-center gap-2 whitespace-nowrap @min-[1312px]/topo:grid @min-[1312px]/topo:grid-cols-[1fr_auto_1fr]">
            <div className="pointer-events-auto flex shrink-0 items-center gap-2 justify-self-start">
              <BotoesDosModulosNaTelaInicial arrastando={isDragging} definirAlvo={setAlvoDeModulo} />
            </div>
            <div className="flex min-w-0 flex-1 justify-center">
              <EscolhaDeFormato />
            </div>
            <div className="pointer-events-auto flex shrink-0 items-center gap-2 justify-self-end">
              <LegendarVideoPronto />
              <MelhorarVideoPronto />
              <AbrirBiblioteca />
            </div>
          </div>
        </div>
        <Recuperar />
      </div>
      <Recentes />
    </div>
  );
}

/**
 * OS PROJETOS RECENTES, embaixo da area de soltar. "Na pagina inicial quero que
 * tenha um historico de projetos recentes." Um clique abre; o X tira da lista
 * (o arquivo fica onde esta).
 */
function Recentes() {
  const lista = useRecentes((s) => s.lista);
  const existe = useRecentes((s) => s.existe);
  const carregar = useRecentes((s) => s.carregar);
  const esquecer = useRecentes((s) => s.esquecer);
  const openProject = useProject((s) => s.openProject);
  const busy = useProject((s) => s.busy);
  // A etiqueta de um modulo ("Recap") so aparece com ele ligado.
  const ligados = useModulosLigados();

  useEffect(() => void carregar(), [carregar]);

  if (lista.length === 0 || busy !== null) return null;

  return (
    <section className="enter flex shrink-0 flex-col gap-2">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
        Projetos recentes
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {lista.map((r) => (
          <CartaoRecente
            key={r.path}
            recente={r}
            sumiu={existe[r.path] === false}
            rotulos={rotulosDoRecente(r, ligados)}
            abrir={() => void openProject(r.path)}
            esquecer={() => void esquecer(r.path)}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Vertical ou horizontal, escolhido antes de soltar o material.
 *
 * Fica na TELA VAZIA, e nao numa janela na abertura do app. Uma janela na
 * abertura pergunta cedo demais: ela apareceria tambem quando ele so quer
 * reabrir um projeto salvo, e ai a resposta ja esta no arquivo. Aqui a pergunta
 * so existe enquanto nao ha projeto -- que e exatamente quando ela cabe.
 *
 * E some assim que o primeiro arquivo entra. Trocar o formato depois de
 * importar significaria reenquadrar tudo que ja foi enquadrado, entao a escolha
 * acontece antes de haver o que perder.
 */
function EscolhaDeFormato() {
  const formato = useProject((s) => s.formato);
  const definirFormato = useProject((s) => s.definirFormato);
  const busy = useProject((s) => s.busy);

  if (busy !== null) return null;

  const rotulo: Record<Formato, { nome: string; dica: string }> = {
    short: { nome: "Short", dica: "vertical, para Shorts, Reels e TikTok" },
    long: { nome: "Long form", dica: "horizontal, para o YouTube" },
  };

  return (
    <div className="pointer-events-auto flex gap-1.5">
      {FORMATOS.map((f) => {
        const medidas = medidasDo(f);
        const ativo = formato === f;
        const Icone = f === "long" ? RectangleHorizontal : RectangleVertical;
        return (
          <button
            key={f}
            type="button"
            onClick={() => void definirFormato(f)}
            title={rotulo[f].dica}
            className={[
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2.5 py-1.5 text-[11px] transition-colors",
              ativo
                ? "border-accent bg-accent-dim text-ink"
                : "border-line bg-elevated text-ink-3 hover:text-ink-2",
            ].join(" ")}
          >
            <Icone size={12} strokeWidth={1.5} />
            {rotulo[f].nome}
            <span className="tnum text-ink-3 @max-[920px]/topo:hidden">
              {medidas.width}x{medidas.height}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Atalho para a biblioteca no canto da tela vazia.
 *
 * Fica aqui porque e aqui que a duvida aparece: "que material eu uso neste
 * video?". Discreto de proposito -- soltar arquivo continua sendo o caminho
 * principal, e quem nunca apontou uma pasta de biblioteca nao perde nada
 * ignorando este botao.
 */
function AbrirBiblioteca() {
  const openLibrary = useProject((s) => s.openLibrary);
  const busy = useProject((s) => s.busy);

  if (busy !== null) return null;

  return (
    <button
      type="button"
      onClick={() => void openLibrary(true)}
      title="Procurar cenas na biblioteca (Ctrl+B)"
      className="flex items-center gap-2 rounded-sm border border-line bg-bg px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink"
    >
      <LibraryIcon size={13} strokeWidth={1.5} className="text-accent" />
      Biblioteca
    </button>
  );
}

/**
 * O convite para retomar o que sobrou da sessao anterior.
 *
 * Fica aqui e nao num modal de propostito: a spec so admite dois, e perguntar
 * "quer recuperar?" antes de o app abrir seria uma parede na frente de quem
 * talvez so queira comecar outro video. Aqui e uma oferta, nao um pedagio --
 * e o X ao lado deixa recusar sem pensar duas vezes.
 */
function Recuperar() {
  const hasAutosave = useProject((s) => s.hasAutosave);
  const busy = useProject((s) => s.busy);
  const restoreAutosave = useProject((s) => s.restoreAutosave);
  const discardAutosave = useProject((s) => s.discardAutosave);

  if (!hasAutosave || busy !== null) return null;

  return (
    <div className="enter absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1">
      <button
        type="button"
        onClick={() => void restoreAutosave()}
        title="Reabre a narração, as imagens, os cortes e as legendas como estavam"
        className="flex items-center gap-2 rounded-sm border border-line bg-bg px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink"
      >
        <History size={13} strokeWidth={1.5} className="text-accent" />
        Continuar de onde parou
      </button>
      <button
        type="button"
        onClick={() => void discardAutosave()}
        aria-label="Descartar o trabalho anterior"
        title="Descartar"
        className="grid size-[30px] place-items-center rounded-sm border border-line bg-bg text-ink-3 transition-colors duration-150 hover:border-line-strong hover:text-ink"
      >
        <X size={13} strokeWidth={1.5} />
      </button>
    </div>
  );
}

/**
 * VIDEO PRONTO VIRA PROJETO: "importar um video pronto so pra fazer a legenda
 * ou algum ajuste como corte e etc". A fala do video vira a narracao e a
 * imagem um bloco so -- ver legendarVideoPronto no store.
 */
function LegendarVideoPronto() {
  const legendar = useProject((s) => s.legendarVideoPronto);
  const busy = useProject((s) => s.busy);

  if (busy !== null) return null;

  return (
    <button
      type="button"
      onClick={() => void legendar()}
      // Soltar o video EM CIMA do botao tambem vale -- e nao cai na area de
      // soltar de baixo, que trataria o video como clipe de um projeto novo.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        // O video e, se vier junto, o roteiro: a legenda sai com o texto dele.
        const caminhos = Array.from(event.dataTransfer.files).map((f) => window.dangai.pathForFile(f));
        const video = caminhos.find((p) => classifyFile(p) === "video");
        if (!video) return;
        event.preventDefault();
        event.stopPropagation();
        void legendar(video, caminhos.find((p) => classifyFile(p) === "script") ?? null);
      }}
      title="Abre um vídeo já editado para legendar, cortar, por transição, zoom, cor ou SFX. A fala dele vira a narração. Mande o roteiro (.txt) junto e a legenda sai com o texto dele. (Clique e escolha os dois, ou solte os dois aqui.)"
      className="flex items-center gap-2 rounded-sm border border-line bg-bg px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink"
    >
      <Clapperboard size={13} strokeWidth={1.5} className="text-accent" />
      Legendar vídeo pronto
    </button>
  );
}

/**
 * Upscale de um MP4 que ja esta pronto, fora de qualquer projeto.
 *
 * "Deixar importar video pronto em mp4 pra dar upscale." Fica na tela vazia
 * porque nao depende de projeto: escolhe o arquivo, e o melhorado sai ao lado
 * dele com "-upscale" no nome. O andamento e o cancelar ficam na barra de
 * baixo, como o de toda tarefa longa.
 */
function MelhorarVideoPronto() {
  const melhorar = useProject((s) => s.melhorarVideoPronto);
  const rodando = useProject((s) => s.videoPronto !== null);
  const busy = useProject((s) => s.busy);

  if (busy !== null) return null;

  return (
    <button
      type="button"
      onClick={() => void melhorar()}
      disabled={rodando}
      title="Escolhe um MP4 pronto e passa pelo upscale. Sai ao lado, com o dobro da resolução."
      className="flex items-center gap-2 rounded-sm border border-line bg-bg px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink disabled:opacity-40"
    >
      <Sparkles size={13} strokeWidth={1.5} className="text-accent" />
      Upscale de vídeo pronto
    </button>
  );
}
