import { useState } from "react";
import type { PublicSettings } from "@shared/channels";

/**
 * A CHAVE DO GEMINI: campo + Salvar + Testar e a linha do resultado.
 *
 * Fora do Settings.tsx porque tem estado proprio (salvando, testando, o
 * resultado do teste) que nao conversa com o resto das configuracoes. Tambem
 * vai no kit dos modulos (src/modulos/kit.ts): a boas-vindas do recap pede a
 * chave com o MESMO campo e o mesmo teste -- duas copias acabariam divergindo.
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
  testarAoSalvar = false,
  focar = false,
}: {
  settings: PublicSettings | null;
  onSettings: (s: PublicSettings) => void;
  /** Os modelos que o "Testar" trouxe (o select "Modelo do Gemini"). */
  onModelos?: (modelos: string[]) => void;
  /** Depois de salvar uma chave nova (refaz o plano: a IA acabou de ser habilitada). */
  aoSalvar?: () => void;
  /**
   * Fora das Configuracoes (a boas-vindas do recap): o Salvar TESTA a chave
   * digitada antes e so grava se ela valer. Gravada e recusada, ela aparecia
   * como "Salva", e a tela que so abre sem chave nao voltava mais. Desligado,
   * o Salvar grava direto, como sempre.
   */
  testarAoSalvar?: boolean;
  /** O foco nasce no campo (a tela abre por ele). */
  focar?: boolean;
}) {
  const [entrada, setEntrada] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<Resultado | null>(null);

  // Testa a chave digitada, se houver; senao a salva, que fica no main. Devolve o resultado.
  const testar = async (chave: string | null): Promise<Resultado> => {
    setTestando(true);
    setTeste(null);
    const r = await window.dangai.testarGemini(chave);
    setTestando(false);
    let resultado: Resultado;
    if (!r.ok) {
      resultado = { tipo: "erro", texto: r.error };
    } else {
      onModelos?.(r.value.modelos);
      resultado = r.value.aviso
        ? { tipo: "aviso", texto: `A chave vale, mas: ${r.value.aviso}` }
        : { tipo: "ok", texto: `Funcionando com ${r.value.modelo}.` };
    }
    setTeste(resultado);
    return resultado;
  };

  const salvar = async (): Promise<void> => {
    const chave = entrada.trim();
    if (!chave) return;
    setSalvando(true);
    // Com testarAoSalvar, a recusada nao grava: fica no campo, com o porque.
    const testada = testarAoSalvar ? await testar(chave) : null;
    if (testada?.tipo === "erro") {
      setSalvando(false);
      return;
    }
    const r = await window.dangai.saveSettings({ geminiApiKey: chave });
    setSalvando(false);
    if (!r.ok) {
      setTeste({ tipo: "erro", texto: r.error });
      return;
    }
    onSettings(r.value);
    setEntrada("");
    // O resultado do teste de antes fica; sem ele (as Configuracoes), limpa como sempre.
    if (!testada) setTeste(null);
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
          autoFocus={focar}
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
