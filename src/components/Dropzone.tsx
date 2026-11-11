import { motion } from "motion/react";
import {
  ArrowRight,
  AudioWaveform,
  BookOpen,
  Captions,
  Clapperboard,
  FolderOpen,
  History,
  Library as LibraryIcon,
  Loader2,
  Mic,
  Puzzle,
  RectangleHorizontal,
  RectangleVertical,
  Sparkles,
  Tv,
  X,
} from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { BotoesDosModulosNaTelaInicial, useModulosLigados } from "@/modulos";
import { useProject } from "@/store/project";
import { classifyFile } from "@shared/channels";
import { useRecentes } from "@/store/recentes";
import { FORMATOS, medidasDo, type Formato } from "@shared/contract";
import { CartaoRecente, rotulosDoRecente } from "./CartaoRecente";
import { PrepararODangai } from "./PrepararODangai";
import { useResumoDeManga } from "@/store/resumo-de-manga";

interface DropzoneProps {
  isDragging: boolean;
}

/**
 * A TELA INICIAL. "Tem como melhorar essa interface de inicio do programa?
 * Talvez separar as coisas por nichos e deixar mais intuitivo, com uma
 * hierarquia melhor... to sentindo muito confuso e atropelado."
 *
 * A hierarquia, de cima para baixo:
 * 1. a acao principal -- soltar a narracao (a janela inteira aceita o arquivo;
 *    a area grande so mostra onde). E o comeco de anime E de manga;
 * 2. os NICHOS, cada um no seu cartao, com o que so ele tem: Anime (a
 *    Biblioteca), Mangá (o Resumo com IA), Vídeo pronto (legendar, upscale) e
 *    os Módulos ligados;
 * 3. os projetos recentes.
 * O formato (Short ou Long form) fica no cabecalho: e uma escolha de antes de
 * comecar, que vale para qualquer nicho.
 */
export function Dropzone({ isDragging }: DropzoneProps) {
  const busy = useProject((s) => s.busy);
  // Um botao de modulo (o "Gerar recap") com o arquivo em cima dele: a area
  // de soltar do nucleo se apaga, para nao parecer que vai cair nela.
  const [alvoDeModulo, setAlvoDeModulo] = useState(false);
  const destaque = isDragging && !alvoDeModulo;
  useEffect(() => {
    if (!isDragging) setAlvoDeModulo(false);
  }, [isDragging]);

  return (
    <div className="relative h-full w-full">
      <div className="h-full w-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col gap-6 pb-2">
          <header className="flex shrink-0 items-center gap-4">
            <div className="flex min-w-0 flex-col">
              <span className="text-[20px] font-semibold tracking-tight text-ink">Dangai</span>
              <span className="text-[12px] text-ink-3">Do material bruto ao vídeo pronto</span>
            </div>
            <span className="flex-1" />
            {busy === null && <EscolhaDeFormato />}
          </header>

          <Recuperar />

          <AreaDeSoltar destaque={destaque} />

          {busy === null && (
            <section className="enter flex shrink-0 flex-col gap-3">
              <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Por onde começar</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <NichoAnime />
                <NichoManga />
                <NichoVideoPronto />
                <NichoModulos arrastando={isDragging} definirAlvo={setAlvoDeModulo} />
              </div>
            </section>
          )}

          <Recentes />
        </div>
      </div>
      <PrepararODangai />
    </div>
  );
}

/** As etapas do caminho de sempre, para ele saber o que vem depois de soltar. */
const ETAPAS = ["Áudio", "Roteiro", "Cenas", "Edição"] as const;

/**
 * A ACAO PRINCIPAL: soltar a narracao. Clicar abre o dialogo; soltar em
 * qualquer lugar da janela tambem vale (useFileDrop) -- aqui so se mostra onde.
 */
function AreaDeSoltar({ destaque }: { destaque: boolean }) {
  const ingest = useProject((s) => s.ingest);
  const busy = useProject((s) => s.busy);

  const pick = async () => {
    const result = await window.dangai.pickFiles();
    if (result.ok && result.value.length > 0) await ingest(result.value, undefined, "dialogo");
  };

  return (
    <button
      type="button"
      onClick={pick}
      disabled={busy !== null}
      className={[
        "group relative flex min-h-[200px] w-full shrink-0 flex-col items-center justify-center gap-4 overflow-hidden rounded-lg px-6 py-8",
        "border border-dashed transition-colors duration-200 ease-dangai",
        destaque ? "border-accent bg-accent-dim" : "border-line-strong bg-surface hover:border-accent/50",
        busy !== null ? "flex-1" : "",
      ].join(" ")}
    >
      {/* O brilho do fundo: o que puxa o olho primeiro na tela. */}
      <span
        aria-hidden
        className={[
          "pointer-events-none absolute -top-24 left-1/2 h-64 w-[640px] -translate-x-1/2 rounded-full blur-3xl transition-opacity duration-300",
          destaque ? "opacity-100" : "opacity-60 group-hover:opacity-90",
        ].join(" ")}
        style={{ background: "radial-gradient(closest-side, var(--color-accent-glow), transparent)" }}
      />
      <motion.div
        animate={{ scale: destaque ? 1.03 : 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex flex-col items-center gap-4"
      >
        {busy !== null ? (
          <span className="flex items-center gap-3 text-[20px] font-medium text-ink">
            <Loader2 size={20} className="animate-spin text-accent" />
            {busy}
          </span>
        ) : (
          <>
            <span
              className={[
                "grid size-12 place-items-center rounded-full border transition-colors duration-200",
                destaque ? "border-accent bg-accent text-white" : "border-accent/40 bg-accent-dim text-accent",
              ].join(" ")}
            >
              <AudioWaveform size={22} strokeWidth={1.75} />
            </span>
            <span className="flex flex-col items-center gap-1.5">
              <span className={["text-[26px] font-semibold tracking-tight transition-colors", destaque ? "text-accent" : "text-ink"].join(" ")}>
                {destaque ? "Pode soltar" : "Solte a narração para começar"}
              </span>
              <span className="text-[13px] text-ink-3">
                Ou clique para escolher. Imagens, clipes e o roteiro (.txt) também entram por aqui.
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              {ETAPAS.map((e, i) => (
                <Fragment key={e}>
                  {i > 0 && <ArrowRight size={11} strokeWidth={1.75} className="text-ink-3/60" />}
                  <span className="rounded-full border border-line bg-elevated px-2.5 py-0.5 text-[11px] text-ink-2">
                    {i + 1}. {e}
                  </span>
                </Fragment>
              ))}
            </span>
          </>
        )}
      </motion.div>
    </button>
  );
}

/** O dialogo de escolher arquivos, com o mesmo caminho de soltar (a narracao abre a etapa de Audio). */
function useEscolherNarracao(): () => Promise<void> {
  const ingest = useProject((s) => s.ingest);
  return async () => {
    const result = await window.dangai.pickFiles();
    if (result.ok && result.value.length > 0) await ingest(result.value, undefined, "dialogo");
  };
}

/** Um nicho: o icone com a cor dele, o nome, para que serve e o que da para fazer. */
function Nicho({
  icone: Icone,
  cor,
  titulo,
  subtitulo,
  children,
  rodape,
}: {
  icone: typeof Tv;
  /** Classes de cor do icone (texto e fundo). */
  cor: string;
  titulo: string;
  subtitulo: string;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <div className="flex items-center gap-3">
        <span className={["grid size-9 shrink-0 place-items-center rounded-md", cor].join(" ")}>
          <Icone size={17} strokeWidth={1.75} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[14px] font-semibold text-ink">{titulo}</span>
          <span className="truncate text-[12px] text-ink-3">{subtitulo}</span>
        </span>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
      {rodape && <p className="mt-auto text-[11px] leading-snug text-ink-3">{rodape}</p>}
    </div>
  );
}

/** Um botao de dentro do cartao: o principal (cheio) ou os outros. */
function Acao({
  icone: Icone,
  principal = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icone: typeof Tv; principal?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={[
        "flex w-full items-center gap-2 rounded-sm border px-3 py-2 text-left text-[12px] transition-colors duration-150 disabled:opacity-40",
        principal
          ? "border-accent/60 bg-accent-dim text-ink hover:bg-accent/20"
          : "border-line bg-elevated text-ink-2 hover:border-line-strong hover:text-ink",
      ].join(" ")}
    >
      <Icone size={14} strokeWidth={1.5} className={principal ? "shrink-0 text-accent" : "shrink-0 text-ink-3"} />
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
    </button>
  );
}

/** ANIME: curiosidades e recaps -- a narracao dele com as cenas da Biblioteca. */
function NichoAnime() {
  const openLibrary = useProject((s) => s.openLibrary);
  const escolher = useEscolherNarracao();
  return (
    <Nicho
      icone={Tv}
      cor="bg-accent-dim text-accent"
      titulo="Anime"
      subtitulo="Curiosidades e recaps"
      rodape="Você edita o áudio, sincroniza o roteiro e escolhe as cenas de cada frase."
    >
      <Acao icone={FolderOpen} principal onClick={() => void escolher()} title="Escolher a narração (e, se quiser, o roteiro .txt)">
        Começar com a narração
      </Acao>
      <Acao icone={LibraryIcon} onClick={() => void openLibrary(true)} title="Procurar cenas na biblioteca (Ctrl+B)">
        Biblioteca de cenas
      </Acao>
    </Nicho>
  );
}

/**
 * MANGA: o Resumo de mangá (a IA le os capitulos e escreve) e, para quem ja tem
 * o roteiro, o caminho de sempre -- a etapa do Roteiro reconhece o .txt.
 */
function NichoManga() {
  const abrir = useResumoDeManga((s) => s.abrir);
  const temRascunho = useResumoDeManga((s) => s.resumo !== null);
  const escolher = useEscolherNarracao();
  return (
    <Nicho
      icone={BookOpen}
      cor="bg-sky-400/10 text-sky-300"
      titulo="Mangá"
      subtitulo="Resumos de capítulos"
      rodape="Já tem o roteiro? Solte a narração; na etapa do Roteiro, solte o .txt do resumo e os quadrinhos vêm junto."
    >
      <Acao
        icone={Sparkles}
        principal
        onClick={() => void abrir()}
        title={temRascunho ? "Continuar o resumo de mangá que ficou no meio" : "A IA lê os capítulos e escreve o roteiro, com os quadrinhos de cada frase"}
      >
        {temRascunho ? "Continuar o resumo" : "Escrever resumo com IA"}
        {temRascunho && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-accent" />}
      </Acao>
      <Acao icone={Mic} onClick={() => void escolher()} title="Já gravou o resumo: escolha a narração. Na etapa do Roteiro, o .txt do resumo traz os quadrinhos.">
        Já gravei: começar com a narração
      </Acao>
    </Nicho>
  );
}

/** VIDEO PRONTO: o que da para fazer com um MP4 que ja existe. */
function NichoVideoPronto() {
  return (
    <Nicho icone={Clapperboard} cor="bg-emerald-400/10 text-emerald-300" titulo="Vídeo pronto" subtitulo="Legendar e melhorar um MP4">
      <LegendarVideoPronto />
      <MelhorarVideoPronto />
    </Nicho>
  );
}

/** OS MODULOS LIGADOS (o Gerar recap, a Thumbnail): os botoes deles, num cartao so. */
function NichoModulos({ arrastando, definirAlvo }: { arrastando: boolean; definirAlvo: (alvo: boolean) => void }) {
  const ligados = useModulosLigados();
  if (!ligados.some((m) => m.BotoesDaTelaInicial)) return null;
  return (
    <Nicho
      icone={Puzzle}
      cor="bg-amber-400/10 text-amber-300"
      titulo="Módulos"
      subtitulo="Ferramentas extras"
      rodape="Para ligar ou desligar um módulo: Configurações > Módulos."
    >
      <div className="flex flex-wrap gap-2 [&_button]:max-w-full">
        <BotoesDosModulosNaTelaInicial arrastando={arrastando} definirAlvo={definirAlvo} />
      </div>
    </Nicho>
  );
}

/**
 * OS PROJETOS RECENTES, embaixo de tudo. "Na pagina inicial quero que tenha um
 * historico de projetos recentes." Um clique abre; o X tira da lista (o arquivo
 * fica onde esta).
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
    <section className="enter flex shrink-0 flex-col gap-3">
      <h2 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">
        <History size={12} strokeWidth={1.75} />
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

  const rotulo: Record<Formato, { nome: string; dica: string }> = {
    short: { nome: "Short", dica: "vertical, para Shorts, Reels e TikTok" },
    long: { nome: "Long form", dica: "horizontal, para o YouTube" },
  };

  return (
    <div className="flex items-center gap-1 rounded-md border border-line bg-surface p-1" role="radiogroup" aria-label="Formato do vídeo">
      {FORMATOS.map((f) => {
        const medidas = medidasDo(f);
        const ativo = formato === f;
        const Icone = f === "long" ? RectangleHorizontal : RectangleVertical;
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => void definirFormato(f)}
            title={rotulo[f].dica}
            className={[
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 py-1.5 text-[12px] transition-colors",
              ativo ? "bg-accent-dim text-ink ring-1 ring-inset ring-accent/60" : "text-ink-3 hover:text-ink-2",
            ].join(" ")}
          >
            <Icone size={13} strokeWidth={1.5} className={ativo ? "text-accent" : ""} />
            {rotulo[f].nome}
            <span className="tnum text-[11px] text-ink-3">
              {medidas.width}x{medidas.height}
            </span>
          </button>
        );
      })}
    </div>
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
    <div className="enter flex shrink-0 items-center gap-3 rounded-md border border-accent/30 bg-accent-dim px-4 py-2.5">
      <History size={15} strokeWidth={1.5} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-[13px] text-ink-2">Ficou um trabalho da última vez, sem salvar.</span>
      <button
        type="button"
        onClick={() => void restoreAutosave()}
        title="Reabre a narração, as imagens, os cortes e as legendas como estavam"
        className="rounded-sm border border-accent/60 bg-bg px-3 py-1.5 text-[12px] text-ink transition-colors duration-150 hover:bg-accent/20"
      >
        Continuar de onde parou
      </button>
      <button
        type="button"
        onClick={() => void discardAutosave()}
        aria-label="Descartar o trabalho anterior"
        title="Descartar"
        className="grid size-[30px] place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
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

  return (
    <Acao
      icone={Captions}
      principal
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
    >
      Legendar vídeo pronto
    </Acao>
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

  return (
    <Acao
      icone={Sparkles}
      onClick={() => void melhorar()}
      disabled={rodando}
      title="Escolhe um MP4 pronto e passa pelo upscale. Sai ao lado, com o dobro da resolução."
    >
      Upscale (dobro da resolução)
    </Acao>
  );
}
