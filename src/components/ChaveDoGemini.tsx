import { useState } from "react";
import type { PublicSettings } from "@shared/channels";

/**
 * A CHAVE DO GEMINI: campo + Salvar + Testar e a linha do resultado.
 *
 * Fora do Settings.tsx porque tem estado proprio (salvando, testando, o
 * resultado do teste) que nao conversa com o resto das configuracoes.
 *
 * A chave nunca volta do main por inteiro: so a dica com os quatro ultimos
 * caracteres, que vira o placeholder do campo.
 */

/** Onde o Google da a chave gratis. */
export const LINK_DA_CHAVE_DO_GEMINI = "https://aistudio.google.com/apikey";

type Resultado = { tipo: "ok" | "aviso" | "erro"; texto: string };

const BOTAO =
  "lift shrink-0 rounded-sm border border-line bg-elevated px-3 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40";

export function ChaveDoGemini({
  settings,
  onSettings,
  onModelos,
  aoSalvar,
}: {
  settings: PublicSettings | null;
  onSettings: (s: PublicSettings) => void;
  /** Os modelos que o "Testar" trouxe (o select "Modelo do Gemini"). */
  onModelos?: (modelos: string[]) => void;
  /** Depois de salvar uma chave nova (refaz o plano: a IA acabou de ser habilitada). */
  aoSalvar?: () => void;
}) {
  const [entrada, setEntrada] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<Resultado | null>(null);

  // Testa a chave digitada, se houver; senao a salva, que fica no main.
  const testar = async (chave: string | null): Promise<void> => {
    setTestando(true);
    setTeste(null);
    const r = await window.dangai.testarGemini(chave);
    setTestando(false);
    if (!r.ok) {
      setTeste({ tipo: "erro", texto: r.error });
      return;
    }
    onModelos?.(r.value.modelos);
    setTeste(
      r.value.aviso
        ? { tipo: "aviso", texto: `A chave vale, mas: ${r.value.aviso}` }
        : { tipo: "ok", texto: `Funcionando com ${r.value.modelo}.` },
    );
  };

  const salvar = async (): Promise<void> => {
    const chave = entrada.trim();
    if (!chave) return;
    setSalvando(true);
    const r = await window.dangai.saveSettings({ geminiApiKey: chave });
    setSalvando(false);
    if (!r.ok) {
      setTeste({ tipo: "erro", texto: r.error });
      return;
    }
    onSettings(r.value);
    setEntrada("");
    setTeste(null);
    aoSalvar?.();
  };

  return (
    <>
      <div className="flex gap-2">
        <input
          type="password"
          value={entrada}
          onChange={(event) => setEntrada(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void salvar();
            event.stopPropagation();
          }}
          placeholder={settings?.hasGeminiKey ? settings.geminiKeyHint : "AIza..."}
          spellCheck={false}
          autoComplete="off"
          aria-label="Chave do Gemini"
          className="min-w-0 flex-1 select-text rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={salvando || testando || entrada.trim().length === 0}
          className={BOTAO}
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={() => void testar(entrada.trim() || null)}
          disabled={
            testando ||
            salvando ||
            (entrada.trim().length === 0 && !settings?.hasGeminiKey)
          }
          className={BOTAO}
        >
          {testando ? "Testando..." : "Testar"}
        </button>
      </div>
      {teste && (
        <p
          className={[
            "mt-2 select-text text-[11px] leading-relaxed",
            teste.tipo === "ok" ? "text-ink-2" : "text-danger",
          ].join(" ")}
        >
          {teste.texto}
        </p>
      )}
    </>
  );
}
