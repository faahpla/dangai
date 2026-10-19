import { X } from "lucide-react";
import type { ModuloDoRenderer } from "@/modulos/api";
import type { Recente } from "@/store/recentes";

/**
 * As etiquetas de um card dos recentes: a de cada modulo LIGADO que tem dado
 * no projeto, na ordem do registro. Modulo desligado, projeto sem dado de
 * modulo ou entrada antiga (sem `modulos`): nenhuma -- o card de sempre.
 */
export function rotulosDoRecente(
  recente: Pick<Recente, "modulos">,
  ligados: readonly Pick<ModuloDoRenderer, "id" | "rotuloDoProjeto">[],
): string[] {
  const comDado = recente.modulos;
  if (!comDado || comDado.length === 0) return [];
  return ligados.flatMap((m) => {
    const texto = m.rotuloDoProjeto?.texto;
    return typeof texto === "string" && texto !== "" && comDado.includes(m.id) ? [texto] : [];
  });
}

interface PropsDoCartaoRecente {
  recente: Recente;
  /** O arquivo nao existe mais: o card fica apagado e sem clique. */
  sumiu: boolean;
  /** As etiquetas dos modulos (rotulosDoRecente). Vazio = o card de sempre. */
  rotulos: readonly string[];
  abrir: () => void;
  esquecer: () => void;
}

/**
 * UM PROJETO RECENTE: a miniatura, o nome e "27 blocos · 1:21 · ha 1 min". Um
 * clique abre; o X tira da lista (o arquivo fica onde esta). A etiqueta do
 * modulo ("Recap") fica no canto de cima da miniatura, dentro do botao: some
 * junto quando o arquivo sumiu e sobe junto no hover.
 */
export function CartaoRecente({ recente: r, sumiu, rotulos, abrir, esquecer }: PropsDoCartaoRecente) {
  return (
    <div className="group/recente relative w-[168px] shrink-0">
      <button
        type="button"
        disabled={sumiu}
        onClick={abrir}
        title={sumiu ? `Nao encontrado: ${r.path}` : r.path}
        className="lift flex w-full flex-col overflow-hidden rounded-md border border-line bg-surface text-left transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-45"
      >
        <div className="relative h-[86px] w-full bg-elevated">
          {r.capa && (
            <img
              src={r.capa}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          )}
          {rotulos.length > 0 && (
            <span className="absolute left-1.5 top-1.5 flex gap-1">
              {rotulos.map((texto, i) => (
                <span
                  key={i}
                  data-rotulo-do-projeto=""
                  className="max-w-[96px] truncate rounded-[3px] bg-accent px-1.5 text-[10px] font-semibold leading-4 text-white"
                >
                  {texto}
                </span>
              ))}
            </span>
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
        onClick={esquecer}
        aria-label={`Tirar ${r.nome} dos recentes`}
        title="Tirar da lista (o arquivo continua onde esta)"
        className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-sm bg-bg/80 text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover/recente:opacity-100"
      >
        <X size={11} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function duracao(seg: number): string {
  // Arredonda o TOTAL primeiro: 59,6 s e 1:00, e nao "0:60".
  const total = Math.round(seg);
  const m = Math.floor(total / 60);
  const s = total % 60;
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
