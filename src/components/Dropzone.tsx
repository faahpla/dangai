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
import { useEffect } from "react";
import { useProject } from "@/store/project";
import { classifyFile } from "@shared/channels";
import { useRecentes } from "@/store/recentes";
import { FORMATOS, medidasDo, type Formato } from "@shared/contract";

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

  const pick = async () => {
    const result = await window.dangai.pickFiles();
    if (result.ok && result.value.length > 0) await ingest(result.value);
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
            isDragging
              ? "border-accent bg-accent-dim"
              : "border-line hover:border-line-strong",
          ].join(" ")}
        >
          <motion.div
            animate={{ scale: isDragging ? 1.04 : 1 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center gap-5"
          >
            <span
              className={[
                "text-[32px] font-semibold tracking-tight transition-colors duration-200",
                isDragging ? "text-accent" : "text-ink",
              ].join(" ")}
            >
              {busy ?? "Soltar audio e imagens aqui"}
            </span>
            <span className="text-[13px] text-ink-3">
              A ordem em que voce solta as imagens e a ordem no video
            </span>
            <span className="text-[11px] text-ink-3">
              Solte o roteiro em .txt junto e as legendas saem com o texto exato
            </span>
          </motion.div>
        </button>

        <EscolhaDeFormato />
        <div className="absolute right-6 top-6 flex items-center gap-2">
          <LegendarVideoPronto />
          <MelhorarVideoPronto />
          <AbrirBiblioteca />
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

  useEffect(() => void carregar(), [carregar]);

  if (lista.length === 0 || busy !== null) return null;

  return (
    <section className="enter flex shrink-0 flex-col gap-2">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
        Projetos recentes
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {lista.map((r) => {
          const sumiu = existe[r.path] === false;
          return (
            <div
              key={r.path}
              className="group/recente relative w-[168px] shrink-0"
            >
              <button
                type="button"
                disabled={sumiu}
                onClick={() => void openProject(r.path)}
                title={sumiu ? `Nao encontrado: ${r.path}` : r.path}
                className="lift flex w-full flex-col overflow-hidden rounded-md border border-line bg-surface text-left transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-45"
              >
                <div className="h-[86px] w-full bg-elevated">
                  {r.capa && (
                    <img
                      src={r.capa}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 px-2.5 py-2">
                  <span className="line-clamp-2 text-[12px] leading-snug text-ink">
                    {r.nome}
                  </span>
                  <span className="tnum text-[10px] text-ink-3">
                    {sumiu
                      ? "arquivo nao encontrado"
                      : [
                          r.blocos > 0 ? `${r.blocos} blocos` : null,
                          r.duracaoSec > 0 ? duracao(r.duracaoSec) : null,
                          quando(r.em),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => void esquecer(r.path)}
                aria-label={`Tirar ${r.nome} dos recentes`}
                title="Tirar da lista (o arquivo continua onde esta)"
                className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-sm bg-bg/80 text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover/recente:opacity-100"
              >
                <X size={11} strokeWidth={1.75} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function duracao(seg: number): string {
  const m = Math.floor(seg / 60);
  const s = Math.round(seg % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "ha 5 min", "ontem", "ha 3 dias" -- ou a data, depois de uma semana. */
function quando(ms: number): string {
  if (!ms) return "";
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `ha ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `ha ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "ontem";
  if (d < 7) return `ha ${d} dias`;
  return new Date(ms).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
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
    <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 gap-1.5">
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
              "pointer-events-auto flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] transition-colors",
              ativo
                ? "border-accent bg-accent-dim text-ink"
                : "border-line bg-elevated text-ink-3 hover:text-ink-2",
            ].join(" ")}
          >
            <Icone size={12} strokeWidth={1.5} />
            {rotulo[f].nome}
            <span className="tnum text-ink-3">
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
        title="Reabre a narracao, as imagens, os cortes e as legendas como estavam"
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
      title="Abre um video ja editado para legendar, cortar, por transicao, zoom, cor ou SFX. A fala dele vira a narracao. Mande o roteiro (.txt) junto e a legenda sai com o texto dele. (Clique e escolha os dois, ou solte os dois aqui.)"
      className="flex items-center gap-2 rounded-sm border border-line bg-bg px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink"
    >
      <Clapperboard size={13} strokeWidth={1.5} className="text-accent" />
      Legendar video pronto
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
      title="Escolhe um MP4 pronto e passa pelo upscale. Sai ao lado, com o dobro da resolucao."
      className="flex items-center gap-2 rounded-sm border border-line bg-bg px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink disabled:opacity-40"
    >
      <Sparkles size={13} strokeWidth={1.5} className="text-accent" />
      Upscale de video pronto
    </button>
  );
}
