import { useEffect, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import type { PublicSettings } from "@shared/channels";
import { useProject } from "@/store/project";
import { Atalhos } from "./Atalhos";
import { ChaveDoGemini, LINK_DA_CHAVE_DO_GEMINI } from "./ChaveDoGemini";
import { ModulosNasConfiguracoes, SecoesDosModulos } from "@/modulos";

/**
 * Um campo que importa: a chave da IA. O resto e escolha rara.
 *
 * A chave nunca volta do main por inteiro -- so um hint com os quatro ultimos
 * caracteres, o suficiente para reconhecer qual chave esta salva.
 *
 * O Gemini vem primeiro porque tem cota gratis; quem ja tem a chave da
 * Anthropic continua nela sem mexer em nada (o main cai na que tiver chave).
 */
export function Settings() {
  const open = useProject((s) => s.settingsOpen);
  const openSettings = useProject((s) => s.openSettings);
  const analyze = useProject((s) => s.analyze);
  const sfxFiles = useProject((s) => s.sfxFiles);
  const refreshSfx = useProject((s) => s.refreshSfx);

  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  // A lista vem do "Testar": o main so conhece os modelos depois de falar com
  // o Google usando a chave.
  const [modelos, setModelos] = useState<string[]>([]);
  const [aba, setAba] = useState<"geral" | "atalhos">("geral");

  /*
   * ABRIR NUMA SECAO: "abrir as Configuracoes ja na do motor", por exemplo.
   * Vai para a aba Geral e rola ate a secao, que tem o `data-secao` dela.
   */
  const secao = useProject((s) => s.settingsSecao);
  useEffect(() => {
    if (!open || !secao) return;
    setAba("geral");
    const quadro = requestAnimationFrame(() =>
      document
        .querySelector(`[data-secao="${CSS.escape(secao)}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(quadro);
  }, [open, secao]);

  useEffect(() => {
    if (!open) return;
    setKeyInput("");
    void window.dangai.getSettings().then((result) => {
      if (result.ok) setSettings(result.value);
    });
    void refreshSfx();
  }, [open, refreshSfx]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        openSettings(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openSettings]);

  if (!open) return null;

  const save = async (
    patch: Parameters<typeof window.dangai.saveSettings>[0],
  ) => {
    setSaving(true);
    const result = await window.dangai.saveSettings(patch);
    if (result.ok) setSettings(result.value);
    setSaving(false);
    return result.ok;
  };

  // A pasta e gravada no main junto com o dialogo -- ele ja sabe o caminho
  // escolhido, e devolve-lo so para o renderer regravar seria dar duas chances
  // de as duas versoes discordarem.
  const escolherBiblioteca = async () => {
    const result = await window.dangai.pickLibraryDir();
    if (!result.ok || !result.value) return;
    const atual = await window.dangai.getSettings();
    if (atual.ok) setSettings(atual.value);
  };

  const saveKey = async () => {
    const trimmed = keyInput.trim();
    if (trimmed.length === 0) return;
    if (await save({ anthropicApiKey: trimmed })) {
      setKeyInput("");
      // Com chave nova, refaz o plano: o usuario acabou de habilitar a IA.
      void analyze();
    }
  };

  // Quem atende de verdade: a preferida so se tiver chave, como no main.
  const emUso = !settings
    ? null
    : settings.iaProvedor === "gemini"
      ? settings.hasGeminiKey
        ? "gemini"
        : settings.hasApiKey
          ? "anthropic"
          : null
      : settings.hasApiKey
        ? "anthropic"
        : settings.hasGeminiKey
          ? "gemini"
          : null;

  // O modelo salvo aparece mesmo antes de testar, ou o select mostraria
  // "Automatico" mentindo.
  const opcoesDeModelo =
    settings?.geminiModelo && !modelos.includes(settings.geminiModelo)
      ? [settings.geminiModelo, ...modelos]
      : modelos;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6"
      onPointerDown={() => openSettings(false)}
    >
      <div
        onPointerDown={(event) => event.stopPropagation()}
        className={[
          "glass enter flex max-h-[88vh] w-full flex-col rounded-lg p-5",
          aba === "atalhos" ? "max-w-[560px]" : "max-w-[440px]",
        ].join(" ")}
      >
        <header className="mb-4 flex shrink-0 items-center gap-3">
          <h2 className="text-[15px] font-semibold text-ink">Configuracoes</h2>
          <div className="flex gap-0.5 rounded-sm border border-line bg-elevated p-0.5">
            {(["geral", "atalhos"] as const).map((qual) => (
              <button
                key={qual}
                type="button"
                onClick={() => setAba(qual)}
                className={[
                  "rounded-[3px] px-2.5 py-0.5 text-[11px]",
                  aba === qual
                    ? "bg-accent-dim text-ink ring-1 ring-inset ring-accent"
                    : "text-ink-3 hover:text-ink-2",
                ].join(" ")}
              >
                {qual === "geral" ? "Geral" : "Atalhos de teclado"}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => openSettings(false)}
            aria-label="Fechar"
            className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto pr-1">
          {aba === "atalhos" ? (
            <Atalhos />
          ) : (
            <>
              <label data-secao="ia" className="mb-1.5 block text-[11px] font-medium text-ink-2">
                Inteligencia artificial
              </label>
              <div className="flex gap-1.5">
                {(
                  [
                    ["gemini", "Gemini (gratis)"],
                    ["anthropic", "Anthropic"],
                  ] as const
                ).map(([qual, nome]) => (
                  <button
                    key={qual}
                    type="button"
                    onClick={() => void save({ iaProvedor: qual })}
                    className={[
                      "lift flex-1 rounded-sm border px-2 py-1.5 text-[13px]",
                      settings?.iaProvedor === qual
                        ? "border-accent bg-accent-dim text-ink"
                        : "border-line bg-elevated text-ink-2",
                    ].join(" ")}
                  >
                    {nome}
                  </button>
                ))}
              </div>
              {settings && emUso !== null && emUso !== settings.iaProvedor && (
                <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                  {emUso === "anthropic"
                    ? "Sem a chave do Gemini, usa a da Anthropic."
                    : "Sem a chave da Anthropic, usa a do Gemini."}
                </p>
              )}

              <div className="mt-4 mb-1.5 flex items-baseline gap-2">
                <label className="block text-[11px] font-medium text-ink-2">
                  Chave do Gemini
                </label>
                <span className="flex-1" />
                <a
                  href={LINK_DA_CHAVE_DO_GEMINI}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                >
                  Pegar chave gratis
                </a>
              </div>
              {/* Chave nova refaz o plano: o usuario acabou de habilitar a IA,
                  como na da Anthropic. */}
              <ChaveDoGemini
                settings={settings}
                onSettings={setSettings}
                onModelos={setModelos}
                aoSalvar={() => void analyze()}
              />

              <label className="mt-4 mb-1.5 block text-[11px] font-medium text-ink-2">
                Modelo do Gemini
              </label>
              <select
                value={settings?.geminiModelo ?? ""}
                onChange={(event) =>
                  void save({ geminiModelo: event.target.value })
                }
                className="w-full rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[13px] text-ink"
              >
                <option value="">Automatico</option>
                {opcoesDeModelo.map((modelo) => (
                  <option key={modelo} value={modelo}>
                    {modelo}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                {modelos.length === 0
                  ? "Teste a chave para ver a lista. "
                  : ""}
                No automatico, usa o melhor flash e troca sozinho se lotar.
              </p>

              <label className="mt-4 mb-1.5 block text-[11px] font-medium text-ink-2">
                Chave da API da Anthropic
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveKey();
                    event.stopPropagation();
                  }}
                  placeholder={
                    settings?.hasApiKey ? settings.apiKeyHint : "sk-ant-..."
                  }
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1 select-text rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void saveKey()}
                  disabled={saving || keyInput.trim().length === 0}
                  className="lift shrink-0 rounded-sm border border-line bg-elevated px-3 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40"
                >
                  Salvar
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                As chaves ficam so nesta maquina
                {settings?.chavesProtegidas ? ", cifradas" : ""}. Sem nenhuma,
                as cenas sao distribuidas pelas pausas da narracao.
              </p>
              <SecoesDosModulos depoisDe="ia" />

              <div className="my-5 h-px bg-line" />

              <label data-secao="whisper" className="mb-1.5 block text-[11px] font-medium text-ink-2">
                Modelo do Whisper
              </label>
              <div className="flex gap-1.5">
                {(["base", "small", "medium"] as const).map((model) => (
                  <button
                    key={model}
                    type="button"
                    onClick={() => void save({ whisperModel: model })}
                    className={[
                      "lift flex-1 rounded-sm border px-2 py-1.5 text-[13px]",
                      settings?.whisperModel === model
                        ? "border-accent bg-accent-dim text-ink"
                        : "border-line bg-elevated text-ink-2",
                    ].join(" ")}
                  >
                    {model}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                Baixado uma vez na primeira transcricao. Maior transcreve melhor
                e mais devagar.
              </p>
              <SecoesDosModulos depoisDe="whisper" />

              <div className="my-5 h-px bg-line" />

              <label data-secao="sons" className="mb-1.5 block text-[11px] font-medium text-ink-2">
                Sons de transicao
              </label>
              <button
                type="button"
                onClick={() => {
                  void window.dangai.openSfxDir();
                  // A pasta abre fora do app; quando ele voltar, a lista ja esta certa.
                  void refreshSfx();
                }}
                className="lift flex w-full items-center gap-2 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[13px] text-ink-2 hover:text-ink"
              >
                <FolderOpen size={13} strokeWidth={1.5} />
                Abrir a pasta de SFX
                <span className="tnum ml-auto text-[11px] text-ink-3">
                  {sfxFiles.length} {sfxFiles.length === 1 ? "som" : "sons"}
                </span>
              </button>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                Solte os seus .mp3 ou .wav ai dentro. Eles entram em rodizio,
                uma transicao sim e outra nao — som em todo corte vira ruido de
                fundo.
              </p>
              <SecoesDosModulos depoisDe="sons" />

              <div className="my-5 h-px bg-line" />

              <label data-secao="biblioteca" className="mb-1.5 block text-[11px] font-medium text-ink-2">
                Biblioteca de cenas
              </label>
              <button
                type="button"
                onClick={() => void escolherBiblioteca()}
                className="lift flex w-full items-center gap-2 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:text-ink"
              >
                <FolderOpen size={13} strokeWidth={1.5} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {settings?.libraryDir || "Escolher a pasta..."}
                </span>
              </button>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                A pasta onde o AnCut grava as cenas. O Dangai so le: nunca
                renomeia, move nem apaga nada ai dentro. Ctrl+B abre a busca.
              </p>
              <SecoesDosModulos depoisDe="biblioteca" />
              <SecoesDosModulos depoisDe="fim" />
              <ModulosNasConfiguracoes />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
