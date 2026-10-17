"""Régua do reconhecimento: episódios-gabarito, medidos sempre igual.

O problema que isto resolve: toda mudança em reconhecimento — trocar um
threshold, acrescentar um segundo modelo, mexer na segunda passada — parece
melhor enquanto se olha um caso. A pergunta "melhorou mesmo?" só tem resposta
com um conjunto fixo de episódios cuja identificação correta é conhecida.

**De onde vem o gabarito.** Não de rotulagem nova: da curadoria que o usuário
JÁ fez. Quando ele remove um clipe de um personagem ou move pro certo na aba
Resultados, está dizendo que o motor errou. Quando ele termina de arrumar um
episódio, o estado daquele episódio É a verdade. `snapshot` congela esse
estado num banco separado (`benchmark.db`), e congelar é essencial: uma
reanálise apaga `shot_character` e levaria a régua junto.

**Por que o modo de medição ignora a curadoria.** A rodada do benchmark chama
`Pipeline.run(benchmark=True)`, que não aplica bloqueios nem adições manuais.
Se aplicasse, estaria copiando a resposta da prova — 100% em toda rodada,
qualquer que fosse o motor.

**O que não é medido.** O corte e as features saem de cache: a rodada mede
DECISÃO, não velocidade. Tempo tem outro instrumento (`metadata/timings.json`).
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

from .config import Config
from .storage.db import Database
from .video_ingest import EpisodeInfo

BENCH_SCHEMA = """
CREATE TABLE IF NOT EXISTS bench_case (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL UNIQUE,
    anime_title TEXT NOT NULL,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT '',
    source_file TEXT,
    output_root TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- O UNIVERSO de cenas do gabarito. Precisa existir separado da verdade
-- porque cena SEM personagem também é resposta: é ela que transforma uma
-- identificação inventada em falso positivo. E delimitar o universo protege
-- de uma diferença boba: se a rodada de medição não repetir o "pular
-- abertura" do dia original, ela produz cenas a mais — que aqui são
-- simplesmente ignoradas em vez de contarem como erro.
CREATE TABLE IF NOT EXISTS bench_shot (
    case_id INTEGER NOT NULL REFERENCES bench_case(id) ON DELETE CASCADE,
    shot_idx INTEGER NOT NULL,
    PRIMARY KEY (case_id, shot_idx)
);

-- Apelidos: "o motor chamou de X, no gabarito isso é Y".
--
-- Existe porque nem toda divergência de nome é erro de reconhecimento. Um
-- personagem batizado à mão no Modo Descoberta ganha o nome que o USUÁRIO
-- deu ("Keigetsu Shu"); a rodada seguinte pega o elenco oficial e chama a
-- mesma pessoa de outro jeito ("Shu, Gabi" — leitura diferente do mesmo
-- kanji). O casamento por palavras não resolve isso, e não deveria mesmo:
-- adivinhar que dois nomes sem palavra em comum são a mesma pessoa juntaria
-- personagens diferentes. Quem afirma isso é uma pessoa, uma vez.
CREATE TABLE IF NOT EXISTS bench_alias (
    case_id INTEGER NOT NULL REFERENCES bench_case(id) ON DELETE CASCADE,
    previsto TEXT NOT NULL,
    verdadeiro TEXT NOT NULL,
    PRIMARY KEY (case_id, previsto)
);

-- Verdade por NOME, não por id: o id é de um banco que pode ser
-- reconstruído; o nome é o que sobrevive e é o que um humano consegue ler
-- pra conferir se o gabarito faz sentido.
CREATE TABLE IF NOT EXISTS bench_truth (
    case_id INTEGER NOT NULL REFERENCES bench_case(id) ON DELETE CASCADE,
    shot_idx INTEGER NOT NULL,
    character_name TEXT NOT NULL,
    PRIMARY KEY (case_id, shot_idx, character_name)
);
"""


@dataclass
class BenchCase:
    id: int
    label: str
    anime_title: str
    season: int
    episode: int
    kind: str
    source_file: str
    output_root: str
    shot_count: int = 0
    truth_count: int = 0
    created_at: str = ""

    @property
    def slug(self) -> str:
        if self.kind:
            return f"S{self.season:02d}-{self.kind}{self.episode}"
        return f"S{self.season:02d}E{self.episode:02d}"


@dataclass
class CharScore:
    name: str
    tp: int = 0
    fp: int = 0
    fn: int = 0

    @property
    def precision(self) -> float:
        d = self.tp + self.fp
        return self.tp / d if d else 0.0

    @property
    def recall(self) -> float:
        d = self.tp + self.fn
        return self.tp / d if d else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if (p + r) else 0.0

    @property
    def in_truth(self) -> bool:
        return self.tp + self.fn > 0


@dataclass
class CaseResult:
    label: str
    chars: list[CharScore] = field(default_factory=list)
    seconds: float = 0.0
    error: str = ""
    shots_scored: int = 0

    @property
    def macro_f1(self) -> float:
        """Média simples do F1 por personagem.

        Entram TODOS os personagens citados por qualquer um dos lados,
        inclusive os que só a máquina viu. Um personagem inventado entra com
        F1 zero e puxa a média pra baixo — que é o comportamento certo:
        alucinar não pode sair de graça numa métrica de reconhecimento.
        """
        if not self.chars:
            return 0.0
        return sum(c.f1 for c in self.chars) / len(self.chars)

    @property
    def micro(self) -> CharScore:
        m = CharScore(name="TOTAL")
        for c in self.chars:
            m.tp += c.tp
            m.fp += c.fp
            m.fn += c.fn
        return m

    @property
    def ghosts(self) -> list[str]:
        """Personagens que a máquina viu e o gabarito não conhece."""
        return sorted(c.name for c in self.chars if not c.in_truth)


class BenchmarkStore:
    """Banco próprio, em `cache/benchmark.db`.

    Separado do `index.db` de propósito: o índice é apagado e reescrito a
    cada reanálise, e a régua não pode viver num lugar que o objeto medido
    tem permissão de destruir.
    """

    def __init__(self, cache_dir: Path | str) -> None:
        self.path = Path(cache_dir) / "benchmark.db"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as c:
            c.executescript(BENCH_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    # --- gabaritos ---

    def snapshot(
        self, index_db: Path | str, episode_id: int, label: str = "",
        notes: str = "",
    ) -> BenchCase:
        """Congela o estado atual de um episódio como gabarito.

        Sobrescreve um gabarito de mesmo rótulo — é o caminho normal: o
        usuário arruma mais um pedaço do episódio e regrava a régua.
        """
        src = sqlite3.connect(index_db)
        src.row_factory = sqlite3.Row
        try:
            ep = src.execute(
                "SELECT e.id, e.season, e.episode, e.kind, e.source_file, "
                "       e.output_root, a.title AS anime_title "
                "FROM episode e JOIN anime a ON a.id = e.anime_id "
                "WHERE e.id = ?",
                (episode_id,),
            ).fetchone()
            if ep is None:
                raise ValueError(f"episódio {episode_id} não existe no índice")
            shots = [
                int(r["idx"])
                for r in src.execute(
                    "SELECT idx FROM shot WHERE episode_id=? ORDER BY idx",
                    (episode_id,),
                )
            ]
            truth = [
                (int(r["idx"]), str(r["name"]))
                for r in src.execute(
                    "SELECT s.idx, c.name FROM shot_character sc "
                    "JOIN shot s ON s.id = sc.shot_id "
                    "JOIN character c ON c.id = sc.character_id "
                    "WHERE s.episode_id = ?",
                    (episode_id,),
                )
            ]
        finally:
            src.close()

        if not shots:
            raise ValueError(
                "esse episódio não tem cenas gravadas — analise antes de "
                "marcar como gabarito"
            )

        label = label or f"{ep['anime_title']} {_slug(ep)}"
        with self._connect() as c:
            c.execute("DELETE FROM bench_case WHERE label = ?", (label,))
            cur = c.execute(
                "INSERT INTO bench_case(label, anime_title, season, episode, "
                "kind, source_file, output_root, notes) VALUES(?,?,?,?,?,?,?,?)",
                (
                    label, ep["anime_title"], ep["season"], ep["episode"],
                    ep["kind"] or "", ep["source_file"] or "",
                    ep["output_root"] or "", notes,
                ),
            )
            case_id = cur.lastrowid
            c.executemany(
                "INSERT INTO bench_shot(case_id, shot_idx) VALUES(?,?)",
                [(case_id, i) for i in shots],
            )
            c.executemany(
                "INSERT OR IGNORE INTO bench_truth(case_id, shot_idx, "
                "character_name) VALUES(?,?,?)",
                [(case_id, i, n) for i, n in truth],
            )
            c.commit()

        return BenchCase(
            id=case_id, label=label, anime_title=ep["anime_title"],
            season=ep["season"], episode=ep["episode"], kind=ep["kind"] or "",
            source_file=ep["source_file"] or "", output_root=ep["output_root"] or "",
            shot_count=len(shots), truth_count=len(truth),
        )

    def cases(self) -> list[BenchCase]:
        with self._connect() as c:
            rows = c.execute(
                "SELECT b.*, "
                " (SELECT COUNT(*) FROM bench_shot s WHERE s.case_id=b.id) AS shot_count, "
                " (SELECT COUNT(*) FROM bench_truth t WHERE t.case_id=b.id) AS truth_count "
                "FROM bench_case b ORDER BY b.anime_title, b.season, b.episode"
            ).fetchall()
        return [
            BenchCase(
                id=r["id"], label=r["label"], anime_title=r["anime_title"],
                season=r["season"], episode=r["episode"], kind=r["kind"],
                source_file=r["source_file"] or "", output_root=r["output_root"] or "",
                shot_count=r["shot_count"], truth_count=r["truth_count"],
                created_at=str(r["created_at"] or ""),
            )
            for r in rows
        ]

    def remove(self, label: str) -> bool:
        with self._connect() as c:
            cur = c.execute("DELETE FROM bench_case WHERE label = ?", (label,))
            c.commit()
            return cur.rowcount > 0

    def set_alias(self, case_id: int, previsto: str, verdadeiro: str) -> None:
        with self._connect() as c:
            c.execute(
                "INSERT OR REPLACE INTO bench_alias(case_id, previsto, "
                "verdadeiro) VALUES(?,?,?)",
                (case_id, previsto, verdadeiro),
            )
            c.commit()

    def aliases(self, case_id: int) -> dict[str, str]:
        with self._connect() as c:
            return {
                str(r["previsto"]): str(r["verdadeiro"])
                for r in c.execute(
                    "SELECT previsto, verdadeiro FROM bench_alias WHERE case_id=?",
                    (case_id,),
                )
            }

    def truth(self, case_id: int) -> tuple[set[int], dict[int, set[str]]]:
        """(universo de cenas, {shot_idx: {nomes}})."""
        with self._connect() as c:
            universe = {
                int(r["shot_idx"])
                for r in c.execute(
                    "SELECT shot_idx FROM bench_shot WHERE case_id=?", (case_id,)
                )
            }
            truth: dict[int, set[str]] = {}
            for r in c.execute(
                "SELECT shot_idx, character_name FROM bench_truth WHERE case_id=?",
                (case_id,),
            ):
                truth.setdefault(int(r["shot_idx"]), set()).add(str(r["character_name"]))
        return universe, truth


def _slug(ep) -> str:
    if ep["kind"]:
        return f"S{ep['season']:02d}-{ep['kind']}{ep['episode']}"
    return f"S{ep['season']:02d}E{ep['episode']:02d}"


# --- medição -------------------------------------------------------------


def _canonicalize(
    pred: dict[int, set[str]],
    truth_names: set[str],
    aliases: dict[str, str] | None = None,
) -> dict[int, set[str]]:
    """Traduz os nomes da previsão para os nomes do gabarito.

    Sem isto o benchmark mede formatação de string, não reconhecimento. O
    banco do usuário guarda "Elmesia" e "Gazel" (nomes que ele viu e às
    vezes renomeou); uma rodada nova pega do MyAnimeList "El-Ru Sarion,
    Elmesia" e "Dwargo, Gazel". São a mesma pessoa, e o motor ACERTOU — mas
    comparadas como texto viram um fantasma e uma falta, de uma vez.

    A regra é a MESMA que o banco usa pra não duplicar personagem
    (`naming.find_token_match`): conjunto de palavras igual, ou subconjunto
    quando só um candidato casa. Nome que não casa com ninguém fica como
    está — e continua contando como fantasma, que é o certo.
    """
    from .naming import find_token_match

    alvos = sorted(truth_names)
    memo: dict[str, str] = {}
    aliases = aliases or {}

    def canon(n: str) -> str:
        if n not in memo:
            # O apelido declarado à mão ganha: ele é afirmação, o casamento
            # por palavras é dedução.
            memo[n] = aliases.get(n) or find_token_match(n, alvos) or n
        return memo[n]

    return {idx: {canon(n) for n in ns} for idx, ns in pred.items()}


def score(
    universe: set[int],
    truth: dict[int, set[str]],
    pred: dict[int, set[str]],
    aliases: dict[str, str] | None = None,
) -> list[CharScore]:
    """Compara verdade e previsão dentro do universo de cenas do gabarito."""
    truth_names = {n for idx, ns in truth.items() if idx in universe for n in ns}
    pred = _canonicalize(pred, truth_names, aliases)

    names: set[str] = set()
    for d in (truth, pred):
        for idx, ns in d.items():
            if idx in universe:
                names |= ns

    out: list[CharScore] = []
    for name in sorted(names):
        s = CharScore(name=name)
        for idx in universe:
            t = name in truth.get(idx, ())
            p = name in pred.get(idx, ())
            if t and p:
                s.tp += 1
            elif p:
                s.fp += 1
            elif t:
                s.fn += 1
        out.append(s)
    return out


def _predictions(db_path: Path, episode_id: int) -> dict[int, set[str]]:
    """Lê do banco-cópia o que a rodada de medição decidiu.

    Pelo `episode_id` que a própria rodada devolveu, e não por
    (título, temporada, episódio). A diferença não é estilo: o mesmo arquivo
    resolvido de novo pode cair num OUTRO registro de anime — a franquia
    Tensura tem várias linhas, e a busca online devolveu a da 2ª temporada
    pra um episódio da 3ª. Procurando por título, a leitura encontrava o
    registro ANTIGO, intacto, e o benchmark dava nota 1,000 medindo o
    gabarito contra ele mesmo.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT s.idx, c.name FROM shot_character sc "
            "JOIN shot s ON s.id = sc.shot_id "
            "JOIN character c ON c.id = sc.character_id "
            "WHERE s.episode_id = ?",
            (episode_id,),
        ).fetchall()
    finally:
        conn.close()
    pred: dict[int, set[str]] = {}
    for r in rows:
        pred.setdefault(int(r["idx"]), set()).add(str(r["name"]))
    return pred


def run_case(
    store: BenchmarkStore,
    case: BenchCase,
    cfg: Config,
    on_status=None,
) -> CaseResult:
    """Roda o reconhecimento neste gabarito e devolve a nota.

    O banco vai pra uma cópia descartável; a pasta de saída continua sendo a
    REAL, porque é lá que moram as cenas já cortadas e o `face_cache.npz` —
    reaproveitar isso é o que faz uma rodada custar segundos em vez de
    minutos. Nada é escrito lá: `benchmark=True` desliga a organização.
    """
    from .pipeline import Pipeline  # import tardio: carrega torch

    say = on_status or (lambda m: None)
    universe, truth = store.truth(case.id)

    src = Path(case.source_file)
    if not src.is_file():
        return CaseResult(
            label=case.label,
            error=f"arquivo de origem sumiu: {case.source_file}",
        )

    t0 = time.monotonic()
    tmp = Path(tempfile.mkdtemp(prefix="ancut-bench-"))
    try:
        sandbox_db = tmp / "index.db"
        shutil.copy2(Path(cfg.cache_dir) / "index.db", sandbox_db)

        pipe = Pipeline(cfg)
        # A única coisa isolada é o BANCO. Refs, features e cenas cortadas
        # seguem compartilhadas — são cache, e é o cache que torna a medição
        # barata o bastante pra rodar antes de cada release.
        pipe.db = Database(sandbox_db)

        info = EpisodeInfo(
            source=src,
            anime=case.anime_title,
            season=case.season,
            episode=case.episode,
            kind=case.kind,
        )
        say(f"[{case.label}] rodando o reconhecimento...")
        res = pipe.run(
            info,
            on_progress=lambda stage, frac, msg: say(f"  {stage}: {msg}"),
            benchmark=True,
        )
        pred = _predictions(sandbox_db, res.episode_id)
    except Exception as e:  # noqa: BLE001 — um caso quebrado não derruba a suíte
        return CaseResult(
            label=case.label,
            error=f"{type(e).__name__}: {e}",
            seconds=time.monotonic() - t0,
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    return CaseResult(
        label=case.label,
        chars=score(universe, truth, pred, store.aliases(case.id)),
        seconds=time.monotonic() - t0,
        shots_scored=len(universe),
    )


def run_all(
    cfg: Config, labels: list[str] | None = None, on_status=None
) -> list[CaseResult]:
    store = BenchmarkStore(cfg.cache_dir)
    cases = store.cases()
    if labels:
        wanted = {l.lower() for l in labels}
        cases = [c for c in cases if c.label.lower() in wanted]
    return [run_case(store, c, cfg, on_status) for c in cases]


# --- relatório -----------------------------------------------------------


def format_report(results: list[CaseResult], detail: bool = True) -> str:
    linhas: list[str] = []
    for r in results:
        linhas.append("")
        linhas.append(f"=== {r.label} ===")
        if r.error:
            linhas.append(f"  FALHOU: {r.error}")
            continue
        if detail:
            linhas.append(
                f"  {'personagem':<28} {'P':>6} {'R':>6} {'F1':>6} "
                f"{'acerto':>7} {'sobra':>6} {'falta':>6}"
            )
            for c in sorted(r.chars, key=lambda c: (-c.f1, c.name)):
                marca = "" if c.in_truth else "  (fantasma)"
                linhas.append(
                    f"  {c.name[:28]:<28} {c.precision:6.2f} {c.recall:6.2f} "
                    f"{c.f1:6.2f} {c.tp:7d} {c.fp:6d} {c.fn:6d}{marca}"
                )
        m = r.micro
        linhas.append(
            f"  MACRO F1 {r.macro_f1:.3f} | micro P {m.precision:.2f} "
            f"R {m.recall:.2f} F1 {m.f1:.2f} | {r.shots_scored} cenas | "
            f"{r.seconds:.1f}s"
        )
        if r.ghosts:
            linhas.append(f"  fantasmas: {', '.join(r.ghosts)}")

    validos = [r for r in results if not r.error]
    if len(validos) > 1:
        media = sum(r.macro_f1 for r in validos) / len(validos)
        linhas.append("")
        linhas.append(f"### MACRO F1 médio: {media:.3f} ({len(validos)} gabaritos)")
    return "\n".join(linhas)


def report_payload(results: list[CaseResult]) -> dict:
    """Mesma coisa em JSON — pra guardar e comparar entre versões."""
    return {
        "cases": [
            {
                "label": r.label,
                "error": r.error,
                "macro_f1": round(r.macro_f1, 4),
                "seconds": round(r.seconds, 1),
                "shots": r.shots_scored,
                "ghosts": r.ghosts,
                "characters": [
                    {
                        "name": c.name,
                        "precision": round(c.precision, 4),
                        "recall": round(c.recall, 4),
                        "f1": round(c.f1, 4),
                        "tp": c.tp, "fp": c.fp, "fn": c.fn,
                    }
                    for c in sorted(r.chars, key=lambda c: c.name)
                ],
            }
            for r in results
        ],
    }


# --- linha de comando ----------------------------------------------------


def _cli(argv: list[str]) -> int:
    import argparse

    ap = argparse.ArgumentParser(prog="python -m app.benchmark")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="lista os gabaritos")
    p_add = sub.add_parser("add", help="congela um episódio como gabarito")
    p_add.add_argument("episode_id", type=int)
    p_add.add_argument("--label", default="")
    p_add.add_argument("--notes", default="")
    p_al = sub.add_parser("alias", help="declara que dois nomes são a mesma pessoa")
    p_al.add_argument("label")
    p_al.add_argument("previsto", help="como o motor chama")
    p_al.add_argument("verdadeiro", help="como o gabarito chama")
    p_rm = sub.add_parser("remove", help="apaga um gabarito")
    p_rm.add_argument("label")
    p_run = sub.add_parser("run", help="mede o reconhecimento nos gabaritos")
    p_run.add_argument("labels", nargs="*")
    p_run.add_argument("--json", default="", help="grava o relatório aqui")
    p_run.add_argument("--quiet", action="store_true")

    args = ap.parse_args(argv)
    cfg = Config.load()
    store = BenchmarkStore(cfg.cache_dir)

    if args.cmd == "list":
        cs = store.cases()
        if not cs:
            print("nenhum gabarito. use: add <episode_id>")
            return 0
        for c in cs:
            print(
                f"{c.label:<45} {c.shot_count:4d} cenas  "
                f"{c.truth_count:4d} identificações  {c.created_at}"
            )
        return 0

    if args.cmd == "add":
        case = store.snapshot(
            Path(cfg.cache_dir) / "index.db", args.episode_id,
            label=args.label, notes=args.notes,
        )
        print(
            f"gabarito '{case.label}': {case.shot_count} cenas, "
            f"{case.truth_count} identificações"
        )
        return 0

    if args.cmd == "alias":
        alvos = [c for c in store.cases() if c.label.lower() == args.label.lower()]
        if not alvos:
            print("não achei esse gabarito")
            return 1
        store.set_alias(alvos[0].id, args.previsto, args.verdadeiro)
        print(f"'{args.previsto}' = '{args.verdadeiro}' em {alvos[0].label}")
        return 0

    if args.cmd == "remove":
        print("apagado" if store.remove(args.label) else "não achei esse rótulo")
        return 0

    say = (lambda m: None) if args.quiet else (lambda m: print(m, flush=True))
    results = run_all(cfg, args.labels or None, on_status=say)
    if not results:
        print("nenhum gabarito pra rodar.")
        return 1
    print(format_report(results))
    if args.json:
        Path(args.json).write_text(
            json.dumps(report_payload(results), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(_cli(sys.argv[1:]))
