import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  FolderOpen,
  Keyboard,
  Puzzle,
  Scissors,
  Sparkles,
  Stamp,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { PublicSettings } from "@shared/channels";
import { useProject } from "@/store/project";
import { tocarSomDePronto } from "@/store/som-de-pronto";
import { Atalhos } from "./Atalhos";
import { ChaveDoGemini, LINK_DA_CHAVE_DO_GEMINI } from "./ChaveDoGemini";
import { ModulosNasConfiguracoes, SecoesDoModulo, usePaginasDosModulos } from "@/modulos";
import { ConfigDoCorte } from "./MotorDeCortes";
import { MarcasDagua } from "./MarcasDagua";

/**
 * AS CONFIGURACOES EM PAGINAS (26/11): "organiza essa merda, ta tudo jogado,
 * nao da pra se encontrar, ta tudo encavalado e nada intuitivo".
 *
 * Era uma coluna so, de 440 px, com tudo um embaixo do outro -- e as secoes do
 * recap enfiadas no meio das do nucleo (o roteiro do recap logo abaixo das
 * chaves da IA). Agora: um menu na esquerda com poucas paginas de nome claro,
 * e cada coisa num cartao com titulo e uma frase do que faz.
 *
 * - Inteligencia artificial: quem responde, as chaves, o modelo e o Whisper;
 * - Sons: a pasta de SFX, o som do Pan e o aviso do render;
 * - Pastas: projetos, biblioteca, mangas e filmes;
 * - Cortar episodios: o motor de cortes;
 * - Atalhos de teclado;
 * - Modulos: ligar e desligar, e uma pagina por modulo ligado (o Gerar recap
 *   com o roteiro, a voz, as cenas... tudo junto).
 *
 * "Abrir numa secao" (`openSettings(true, 'recap-voz')`) acha a pagina que tem
 * a secao, abre nela e rola ate o cartao.
 */

type IdDaPagina = "ia" | "sons" | "pastas" | "cortar" | "marca" | "atalhos" | "modulos" | `modulo:${string}`;

interface Pagina {
  id: IdDaPagina;
  rotulo: string;
  icone: LucideIcon;
  /** Uma frase no alto da pagina. */
  sobre?: string;
  /** As secoes (data-secao) que moram nela, para o "abrir numa secao". */
  secoes: string[];
}

const PAGINAS_DO_NUCLEO: Pagina[] = [
  {
    id: "ia",
    rotulo: "Inteligência artificial",
    icone: Sparkles,
    sobre: "Quem escreve e analisa (Gemini ou Anthropic) e quem transcreve a narração.",
    secoes: ["ia", "gemini", "anthropic", "whisper"],
  },
  {
    id: "sons",
    rotulo: "Sons",
    icone: Volume2,
    sobre: "Os efeitos que entram nas transições e o aviso de render pronto.",
    secoes: ["sons", "som-do-pan", "som-do-render"],
  },
  {
    id: "pastas",
    rotulo: "Pastas",
    icone: FolderOpen,
    sobre: "Onde o Dangai guarda os projetos e de onde ele lê as cenas.",
    secoes: ["projetos", "biblioteca", "mangas", "filmes"],
  },
  {
    id: "cortar",
    rotulo: "Cortar episódios",
    icone: Scissors,
    sobre: "O motor que corta os episódios em cenas e reconhece os personagens.",
    secoes: ["cortar"],
  },
  {
    id: "marca",
    rotulo: "Marca d'água",
    icone: Stamp,
    sobre: "A marca de cada canal, por cima de tudo no vídeo. No editor, o botão “Marca” escolhe qual vai em cada vídeo.",
    secoes: ["marca-dagua"],
  },
  { id: "atalhos", rotulo: "Atalhos de teclado", icone: Keyboard, secoes: ["atalhos"] },
];

const PAGINA_DOS_MODULOS: Pagina = {
  id: "modulos",
  rotulo: "Ligar e desligar",
  icone: Puzzle,
  sobre: "Os módulos são partes extras do Dangai. Ligado, cada um ganha a sua página aqui no menu.",
  secoes: ["modulos"],
};

/** A ultima pagina aberta, nesta sessao: reabrir volta para ela. */
let ultimaPagina: IdDaPagina = "ia";

export function Settings() {
  const open = useProject((s) => s.settingsOpen);
  const openSettings = useProject((s) => s.openSettings);
  const analyze = useProject((s) => s.analyze);
  const sfxFiles = useProject((s) => s.sfxFiles);
  const refreshSfx = useProject((s) => s.refreshSfx);
  const paginasDosModulos = usePaginasDosModulos();

  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  // A lista vem do "Testar": o main so conhece os modelos depois de falar com
  // o Google usando a chave.
  const [modelos, setModelos] = useState<string[]>([]);
  const [pagina, setPaginaDeVerdade] = useState<IdDaPagina>(ultimaPagina);
  const setPagina = (p: IdDaPagina): void => {
    ultimaPagina = p;
    setPaginaDeVerdade(p);
  };
  /** A pasta dos projetos de verdade (a escolhida, ou a padrao nos Documentos). */
  const [pastaDosProjetos, setPastaDosProjetos] = useState("");
  const conteudo = useRef<HTMLDivElement | null>(null);

  const paginas: Pagina[] = [
    ...PAGINAS_DO_NUCLEO,
    PAGINA_DOS_MODULOS,
    ...paginasDosModulos.map((m) => ({
      id: `modulo:${m.id}` as const,
      rotulo: m.nome,
      icone: Puzzle,
      secoes: m.secoes.map((s) => s.id),
    })),
  ];
  // Desligou o modulo com a pagina dele aberta: volta para a primeira.
  const atual = paginas.find((p) => p.id === pagina) ?? paginas[0]!;

  /*
   * ABRIR NUMA SECAO: "abrir as Configuracoes ja na do motor", por exemplo.
   * Vai para a pagina que tem a secao e rola ate o cartao dela.
   */
  const secao = useProject((s) => s.settingsSecao);
  const [rolarPara, setRolarPara] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !secao) return;
    const dona = paginas.find((p) => p.secoes.includes(secao));
    if (dona) setPagina(dona.id);
    setRolarPara(secao);
    // A lista de paginas dos modulos chega depois de ligar: refaz quando ela muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, secao, paginasDosModulos.length]);
  useLayoutEffect(() => {
    if (!rolarPara) return;
    // Imediato, e de novo depois que a pagina assenta: as secoes dos modulos
    // leem a config ao montar e crescem, e o cartao saia do lugar no meio da
    // rolagem suave.
    const ir = (): void => {
      conteudo.current?.querySelector(`[data-secao="${CSS.escape(rolarPara)}"]`)?.scrollIntoView({ block: "start" });
    };
    const quadro = requestAnimationFrame(ir);
    const depois = setTimeout(() => {
      ir();
      setRolarPara(null);
    }, 350);
    return () => {
      cancelAnimationFrame(quadro);
      clearTimeout(depois);
    };
  }, [rolarPara, pagina]);

  // Trocou de pagina: comeca do alto.
  useEffect(() => {
    if (!rolarPara) conteudo.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina]);

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
    void window.dangai.pastaDosProjetos().then((r) => {
      if (r.ok) setPastaDosProjetos(r.value);
    });
  }, [open, settings?.pastaDeProjetos]);

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

  const paginaDoModulo = atual.id.startsWith("modulo:") ? paginasDosModulos.find((m) => `modulo:${m.id}` === atual.id) : undefined;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6"
      onPointerDown={() => openSettings(false)}
    >
      <div
        onPointerDown={(event) => event.stopPropagation()}
        className="glass enter flex h-[min(720px,88vh)] w-full max-w-[880px] overflow-hidden rounded-lg"
      >
        {/* O MENU: poucas paginas, de nome claro. */}
        <nav aria-label="Seções das configurações" className="flex w-[210px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line p-3">
          <h2 className="mb-3 px-2 pt-1 text-[15px] font-semibold text-ink">Configurações</h2>
          {PAGINAS_DO_NUCLEO.map((p) => (
            <ItemDoMenu key={p.id} pagina={p} ativa={atual.id === p.id} onClick={() => setPagina(p.id)} />
          ))}
          <span className="mt-4 mb-1 px-2 text-[10px] uppercase tracking-wide text-ink-3">Módulos</span>
          <ItemDoMenu pagina={PAGINA_DOS_MODULOS} ativa={atual.id === "modulos"} onClick={() => setPagina("modulos")} />
          {paginasDosModulos.map((m) => {
            const id = `modulo:${m.id}` as const;
            return (
              <ItemDoMenu
                key={id}
                pagina={{ id, rotulo: m.nome, icone: Puzzle, secoes: [] }}
                ativa={atual.id === id}
                onClick={() => setPagina(id)}
              />
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-start gap-3 border-b border-line px-6 pt-5 pb-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-[16px] font-semibold text-ink">{atual.rotulo}</h3>
              {atual.sobre && <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{atual.sobre}</p>}
              {/* Pagina de modulo com varias secoes: atalhos para cada uma. */}
              {paginaDoModulo && paginaDoModulo.secoes.length > 1 && (
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {paginaDoModulo.secoes.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setRolarPara(s.id)}
                      className="rounded-full border border-line bg-elevated px-2.5 py-0.5 text-[11px] text-ink-2 hover:border-line-strong hover:text-ink"
                    >
                      {s.titulo}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => openSettings(false)}
              aria-label="Fechar"
              title="Fechar (Esc)"
              className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 hover:bg-elevated hover:text-ink"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </header>

          <div ref={conteudo} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="flex flex-col gap-3 pb-6">
              {atual.id === "ia" && (
                <>
                  <Cartao secao="ia" titulo="Quem responde" sobre="Escreve o roteiro, escolhe as cenas e o título. O Gemini tem cota grátis.">
                    <Escolha
                      opcoes={[
                        ["gemini", "Gemini (grátis)"],
                        ["anthropic", "Anthropic"],
                      ]}
                      valor={settings?.iaProvedor}
                      onChange={(qual) => void save({ iaProvedor: qual })}
                    />
                    {settings && emUso !== null && emUso !== settings.iaProvedor && (
                      <Nota>
                        {emUso === "anthropic"
                          ? "Sem a chave do Gemini, usa a da Anthropic."
                          : "Sem a chave da Anthropic, usa a do Gemini."}
                      </Nota>
                    )}
                    {settings && emUso === null && (
                      <Nota>Sem nenhuma chave, as cenas são distribuídas pelas pausas da narração.</Nota>
                    )}
                  </Cartao>

                  <Cartao
                    secao="gemini"
                    titulo="Gemini"
                    acao={
                      <a
                        href={LINK_DA_CHAVE_DO_GEMINI}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                      >
                        Pegar chave grátis
                      </a>
                    }
                  >
                    <Rotulo>Chave</Rotulo>
                    {/* Chave nova refaz o plano: o usuario acabou de habilitar a IA,
                        como na da Anthropic. */}
                    <ChaveDoGemini
                      settings={settings}
                      onSettings={setSettings}
                      onModelos={setModelos}
                      aoSalvar={() => void analyze()}
                    />
                    <Rotulo className="mt-4">Modelo</Rotulo>
                    <select
                      value={settings?.geminiModelo ?? ""}
                      onChange={(event) => void save({ geminiModelo: event.target.value })}
                      className="w-full rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[13px] text-ink"
                    >
                      <option value="">Automático</option>
                      {opcoesDeModelo.map((modelo) => (
                        <option key={modelo} value={modelo}>
                          {modelo}
                        </option>
                      ))}
                    </select>
                    <Nota>
                      {modelos.length === 0 ? "Teste a chave para ver a lista. " : ""}
                      No automático, usa o melhor flash e troca sozinho se lotar.
                    </Nota>
                  </Cartao>

                  <Cartao secao="anthropic" titulo="Anthropic (Claude)">
                    <Rotulo>Chave da API</Rotulo>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={keyInput}
                        onChange={(event) => setKeyInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveKey();
                          event.stopPropagation();
                        }}
                        placeholder={settings?.hasApiKey ? settings.apiKeyHint : "sk-ant-..."}
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
                    <Nota>
                      As chaves ficam só nesta máquina{settings?.chavesProtegidas ? ", cifradas" : ""}.
                    </Nota>
                  </Cartao>

                  <Cartao
                    secao="whisper"
                    titulo="Transcrição da narração (Whisper)"
                    sobre="Roda no seu PC e serve só para os tempos das palavras: o texto da legenda vem sempre do roteiro."
                  >
                    <Escolha
                      opcoes={[
                        ["base", "base"],
                        ["small", "small"],
                        ["medium", "medium"],
                      ]}
                      valor={settings?.whisperModel}
                      onChange={(model) => void save({ whisperModel: model })}
                    />
                    <Nota>Baixado uma vez na primeira transcrição. Maior transcreve melhor e mais devagar.</Nota>
                  </Cartao>
                </>
              )}

              {atual.id === "sons" && (
                <>
                  <Cartao
                    secao="sons"
                    titulo="Sons de transição"
                    sobre="Solte os seus .mp3 ou .wav na pasta. Eles entram em rodízio, uma transição sim e outra não — som em todo corte vira ruído de fundo."
                  >
                    <BotaoDePasta
                      onClick={() => {
                        void window.dangai.openSfxDir();
                        // A pasta abre fora do app; quando ele voltar, a lista ja esta certa.
                        void refreshSfx();
                      }}
                      texto="Abrir a pasta de SFX"
                      lado={`${sfxFiles.length} ${sfxFiles.length === 1 ? "som" : "sons"}`}
                    />
                  </Cartao>

                  <Cartao
                    secao="som-do-pan"
                    titulo="Som da transição Pan"
                    sobre="Pôs a transição Pan numa emenda, este som entra sozinho na faixa de SFX, com o ponto mais forte bem no corte. Dá para mover ou apagar como os outros; tirar o Pan tira o som."
                  >
                    <div className="flex gap-1.5">
                      <BotaoDePasta
                        onClick={async () => {
                          const r = await window.dangai.pickFiles();
                          const som = r.ok ? r.value.find((c) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(c)) : undefined;
                          if (som) await save({ somDoPan: som });
                        }}
                        texto={settings?.somDoPan ? (settings.somDoPan.split(/[\\/]/).pop() ?? "") : "Nenhum (escolher...)"}
                        title="Trocar o som"
                      />
                      {settings?.somDoPan && (
                        <BotaoPequeno onClick={() => void save({ somDoPan: "" })}>Nenhum</BotaoPequeno>
                      )}
                    </div>
                  </Cartao>

                  <Cartao secao="som-do-render" titulo="Quando o render termina">
                    <Escolha
                      opcoes={[
                        [true, "Tocar um som"],
                        [false, "Em silêncio"],
                      ]}
                      valor={settings?.somAoRenderizar ?? true}
                      onChange={(ligado) => {
                        void save({ somAoRenderizar: ligado });
                        // Ligar ja toca: ele ouve o que escolheu.
                        if (ligado) tocarSomDePronto();
                      }}
                    />
                  </Cartao>
                </>
              )}

              {atual.id === "pastas" && (
                <>
                  <Cartao
                    secao="projetos"
                    titulo="Projetos"
                    sobre="Soltou a narração, o Dangai pergunta o nome e cria o projeto aqui. Daí em diante ele se salva sozinho. Depois do render, os arquivos de trabalho são apagados e fica só o projeto."
                  >
                    <div className="flex gap-1.5">
                      <BotaoDePasta
                        onClick={async () => {
                          const r = await window.dangai.escolherPasta("Escolher a pasta dos projetos");
                          if (r.ok && r.value) await save({ pastaDeProjetos: r.value });
                        }}
                        texto={pastaDosProjetos || "..."}
                        title="Trocar a pasta"
                      />
                      <BotaoPequeno onClick={() => void window.dangai.abrirPastaDosProjetos()}>Abrir</BotaoPequeno>
                    </div>
                    {settings?.pastaDeProjetos && (
                      <Voltar onClick={() => void save({ pastaDeProjetos: "" })}>Voltar para a padrão (Documentos)</Voltar>
                    )}
                  </Cartao>

                  <Cartao
                    secao="biblioteca"
                    titulo="Biblioteca de cenas"
                    sobre="A pasta onde o AnCut grava as cenas. O Dangai só lê: nunca renomeia, move nem apaga nada aí dentro. Ctrl+B abre a busca."
                  >
                    <BotaoDePasta onClick={() => void escolherBiblioteca()} texto={settings?.libraryDir || "Escolher a pasta..."} />
                  </Cartao>

                  <Cartao
                    secao="mangas"
                    titulo="Mangás"
                    sobre="Uma pasta por anime e, dentro dela, uma por capítulo, com as páginas do jeito que você baixa. O Dangai recorta os quadrinhos sozinho; a sua pasta fica como está."
                  >
                    <BotaoDePasta
                      onClick={async () => {
                        const r = await window.dangai.escolherPasta("Escolher a pasta dos mangás");
                        if (r.ok && r.value) await save({ mangaDir: r.value });
                      }}
                      texto={settings?.mangaDir || "Automática: a pasta “Mangás” ao lado da biblioteca"}
                    />
                    {settings?.mangaDir && <Voltar onClick={() => void save({ mangaDir: "" })}>Voltar para a automática</Voltar>}
                  </Cartao>

                  <Cartao
                    secao="filmes"
                    titulo="Filmes cortados"
                    sobre="Os filmes que o AnCut cortou: uma pasta por filme e, dentro dela, a “Filme (ano)”. As cenas aparecem na Biblioteca junto das dos animes (busque pelo nome do filme ou por “filme”)."
                  >
                    <BotaoDePasta
                      onClick={async () => {
                        const r = await window.dangai.escolherPasta("Escolher a pasta dos filmes cortados");
                        if (r.ok && r.value) await save({ filmesDir: r.value });
                      }}
                      texto={settings?.filmesDir || "Automática: a pasta “Filmes\\Corte de Filmes” ao lado da biblioteca"}
                    />
                    {settings?.filmesDir && <Voltar onClick={() => void save({ filmesDir: "" })}>Voltar para a automática</Voltar>}
                  </Cartao>
                </>
              )}

              {atual.id === "cortar" && (
                <Cartao titulo="Motor de cortes">
                  <ConfigDoCorte />
                </Cartao>
              )}

              {atual.id === "marca" && (
                <Cartao
                  secao="marca-dagua"
                  titulo="Canais"
                  sobre="O PNG do tamanho do vídeo, com a marca já no lugar e o resto transparente. Overlay mistura a marca com a imagem (clareia e escurece) em vez de tampar."
                >
                  <MarcasDagua />
                </Cartao>
              )}

              {atual.id === "atalhos" && (
                <Cartao secao="atalhos" titulo="Atalhos" sobre="Clique no + de uma ação e aperte a tecla que quer usar.">
                  <Atalhos />
                </Cartao>
              )}

              {atual.id === "modulos" && (
                <Cartao secao="modulos" titulo="Módulos instalados">
                  <ModulosNasConfiguracoes />
                </Cartao>
              )}

              {paginaDoModulo && <SecoesDoModulo id={paginaDoModulo.id} Cartao={Cartao} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemDoMenu({ pagina, ativa, onClick }: { pagina: Pagina; ativa: boolean; onClick: () => void }) {
  const Icone = pagina.icone;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativa ? "page" : undefined}
      className={[
        "flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-[13px]",
        ativa ? "bg-accent-dim text-ink ring-1 ring-inset ring-accent/40" : "text-ink-2 hover:bg-elevated hover:text-ink",
      ].join(" ")}
    >
      <Icone size={14} strokeWidth={1.6} className={["shrink-0", ativa ? "text-accent" : "text-ink-3"].join(" ")} />
      <span className="min-w-0 flex-1 truncate">{pagina.rotulo}</span>
    </button>
  );
}

/** Um assunto: titulo, uma frase do que faz, e os controles. */
function Cartao({
  secao,
  titulo,
  sobre,
  acao,
  children,
}: {
  secao?: string;
  titulo: string;
  sobre?: string;
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-secao={secao} className="scroll-mt-3 rounded-md border border-line bg-surface p-4">
      <div className="flex items-baseline gap-2">
        <h4 className="text-[13px] font-semibold text-ink">{titulo}</h4>
        <span className="flex-1" />
        {acao}
      </div>
      {sobre && <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{sobre}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Rotulo({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <label className={`mb-1.5 block text-[11px] font-medium text-ink-2 ${className}`}>{children}</label>;
}

function Nota({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{children}</p>;
}

/** Botoes lado a lado, um aceso: o jeito de escolher uma entre poucas opcoes. */
function Escolha<T extends string | boolean>({
  opcoes,
  valor,
  onChange,
}: {
  opcoes: readonly (readonly [T, string])[];
  valor: T | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {opcoes.map(([v, nome]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={valor === v}
          className={[
            "lift flex-1 rounded-sm border px-2 py-1.5 text-[13px]",
            valor === v ? "border-accent bg-accent-dim text-ink" : "border-line bg-elevated text-ink-2",
          ].join(" ")}
        >
          {nome}
        </button>
      ))}
    </div>
  );
}

function BotaoDePasta({
  onClick,
  texto,
  lado,
  title,
}: {
  onClick: () => void;
  texto: string;
  lado?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="lift flex w-full min-w-0 flex-1 items-center gap-2 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:text-ink"
    >
      <FolderOpen size={13} strokeWidth={1.5} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{texto}</span>
      {lado && <span className="tnum ml-auto shrink-0 text-[11px] text-ink-3">{lado}</span>}
    </button>
  );
}

function BotaoPequeno({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="lift shrink-0 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[13px] text-ink-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

function Voltar({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="mt-2 text-[11px] text-ink-3 underline underline-offset-2 hover:text-ink">
      {children}
    </button>
  );
}
