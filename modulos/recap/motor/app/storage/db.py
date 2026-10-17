from __future__ import annotations

import sqlite3
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


SCHEMA = """
CREATE TABLE IF NOT EXISTS anime (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anilist_id INTEGER UNIQUE,
    mal_id INTEGER,
    title TEXT NOT NULL,
    title_english TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS episode (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    source_file TEXT,
    processed_at TIMESTAMP,
    -- Pasta de saída REAL deste episódio. Guardada porque reconstruí-la
    -- (saída / sanitize(anime) / slug) depende do nome que o usuário digitou,
    -- que não fica em lugar nenhum — era o que impedia reabrir um resultado
    -- antigo sem reanalisar.
    output_root TEXT,
    -- '' = episódio, 'OP' = abertura, 'ED' = encerramento, 'MOVIE' = filme
    -- (que não tem temporada nem episódio: entra como S01E01). Entra na chave
    -- porque a abertura da 2ª temporada NÃO é o episódio 1 dela: sem esta
    -- coluna as duas dividiam a mesma linha e uma apagava os shots da outra.
    kind TEXT NOT NULL DEFAULT '',
    UNIQUE(anime_id, season, episode, kind)
);

CREATE TABLE IF NOT EXISTS character (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anilist_id INTEGER UNIQUE,
    mal_id INTEGER,
    anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT,
    threshold REAL DEFAULT 0.74,
    reference_count INTEGER DEFAULT 0,
    embedding BLOB
);

CREATE TABLE IF NOT EXISTS shot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL REFERENCES episode(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    file TEXT NOT NULL,
    keyframe TEXT,
    start REAL NOT NULL,
    end REAL NOT NULL,
    duration REAL NOT NULL,
    UNIQUE(episode_id, idx)
);

CREATE TABLE IF NOT EXISTS shot_character (
    shot_id INTEGER NOT NULL REFERENCES shot(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE,
    confidence REAL NOT NULL,
    reviewed INTEGER DEFAULT 0,
    approved INTEGER,
    PRIMARY KEY (shot_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_shot_char_shot ON shot_character(shot_id);
CREATE INDEX IF NOT EXISTS idx_shot_char_char ON shot_character(character_id);
CREATE INDEX IF NOT EXISTS idx_character_anime ON character(anime_id);

-- Clipes favoritados pelo usuário.
--
-- A chave inclui o PERSONAGEM porque o favorito é sempre "esta cena, deste
-- personagem": é assim que a Biblioteca monta "Favoritos → Mushoku Tensei →
-- Rudeus". A mesma cena pode ser favorita de dois personagens que aparecem
-- nela, e isso é uma resposta certa, não uma duplicata.
--
-- `character_id = 0` é o favorito feito na visão "Todas as cenas", onde não
-- há personagem em contexto. Zero em vez de NULL porque no SQLite dois NULLs
-- são distintos — a chave primária deixaria favoritar a mesma cena infinitas
-- vezes.
CREATE TABLE IF NOT EXISTS favorite (
    shot_id INTEGER NOT NULL REFERENCES shot(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (shot_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_favorite_shot ON favorite(shot_id);

-- Curadoria manual do usuário (remover/mover/aprovar na aba Resultados).
-- Presa ao NÚMERO da cena (shot_idx), não ao id da linha: a reanálise apaga
-- e recria os shots, mas os números são estáveis (cache de detecção), então
-- as decisões sobrevivem e são reaplicadas no fim de toda análise.
CREATE TABLE IF NOT EXISTS manual_override (
    episode_id INTEGER NOT NULL REFERENCES episode(id) ON DELETE CASCADE,
    shot_idx INTEGER NOT NULL,
    character_id INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK(action IN ('add','block')),
    confidence REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (episode_id, shot_idx, character_id)
);
"""


class Database:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as c:
            c.executescript(SCHEMA)
            self._migrate(c)
            self._limpar_duplicatas(c)

    @staticmethod
    def _limpar_duplicatas(c: sqlite3.Connection) -> None:
        """Apaga a cópia vazia que motor anterior ao 0.14.1 deixou no histórico.

        Cortar (sem rede, anime pelo nome do arquivo) e identificar depois
        (com rede, anime pelo nome do AniList) criava duas linhas pra mesma
        pasta. O 0.14.1 parou de criar; esta limpeza some com as que ficaram
        — inclusive no PC de quem só instala a versão nova, sem ninguém
        precisar mexer no banco à mão.

        Só apaga quando é inequívoco:

        - a mesma pasta, temporada, episódio e tipo têm UMA linha de anime com
          id do AniList — é ela que fica;
        - a que sai é de anime sem id do AniList;
        - e está vazia de trabalho humano: nenhum personagem marcado, nenhum
          favorito, nenhuma curadoria manual. Uma cópia em que alguém mexeu
          não é cópia, e fica.

        Só linhas do banco. A pasta e os clipes são das duas, e não são
        tocados.
        """
        grupos = c.execute(
            "SELECT lower(e.output_root) AS pasta, e.season, e.episode, e.kind "
            "FROM episode e WHERE e.output_root IS NOT NULL "
            "GROUP BY lower(e.output_root), e.season, e.episode, e.kind "
            "HAVING count(*) > 1"
        ).fetchall()
        for g in grupos:
            linhas = c.execute(
                "SELECT e.id, a.anilist_id FROM episode e "
                "LEFT JOIN anime a ON a.id = e.anime_id "
                "WHERE lower(e.output_root)=? AND e.season=? AND e.episode=? "
                "AND e.kind=?",
                (g["pasta"], g["season"], g["episode"], g["kind"]),
            ).fetchall()
            online = [r for r in linhas if r["anilist_id"] is not None]
            if len(online) != 1:
                continue
            for r in linhas:
                if r["anilist_id"] is not None:
                    continue
                eid = r["id"]
                mexido = c.execute(
                    "SELECT "
                    "(SELECT count(*) FROM shot_character sc JOIN shot s "
                    "  ON s.id = sc.shot_id WHERE s.episode_id = :e) + "
                    "(SELECT count(*) FROM favorite f JOIN shot s "
                    "  ON s.id = f.shot_id WHERE s.episode_id = :e) + "
                    "(SELECT count(*) FROM manual_override WHERE episode_id = :e)",
                    {"e": eid},
                ).fetchone()[0]
                if mexido:
                    continue
                c.execute("DELETE FROM shot WHERE episode_id=?", (eid,))
                c.execute("DELETE FROM episode WHERE id=?", (eid,))
                print(
                    f"[CorteCenas] Duplicata removida do histórico: episódio "
                    f"{eid} (S{g['season']:02d}E{g['episode']:02d}, {g['pasta']}) "
                    f"— a pasta continua, com a entrada {online[0]['id']}.",
                    file=sys.stderr,
                    flush=True,
                )

    @staticmethod
    def _migrate(c: sqlite3.Connection) -> None:
        """Migrações aditivas pra bancos que já existem.

        O SCHEMA usa CREATE TABLE IF NOT EXISTS, então coluna nova não chega
        em banco antigo — e o usuário tem análises acumuladas que não podem
        ser perdidas. Só adicionamos colunas anuláveis: bancos antigos seguem
        legíveis por versões antigas do app.
        """
        cols = {r["name"] for r in c.execute("PRAGMA table_info(episode)")}
        if "output_root" not in cols:
            c.execute("ALTER TABLE episode ADD COLUMN output_root TEXT")
        if "kind" not in cols:
            Database._backup_before_rebuild(c)
            Database._migrate_episode_kind(c)

    @staticmethod
    def _backup_before_rebuild(c: sqlite3.Connection) -> None:
        """Cópia do banco antes de reconstruir uma tabela.

        Migração aditiva (ALTER TABLE ADD COLUMN) não precisa disso; derrubar
        e recriar tabela, sim. O acervo do usuário são horas de análise, e um
        arquivo de 2 MB é barato demais pra não fazer.
        """
        import shutil

        origem = Path(
            c.execute("PRAGMA database_list").fetchone()[2] or ""
        )
        if not origem.is_file():
            return
        destino = origem.with_suffix(origem.suffix + ".antes-de-kind.bak")
        if destino.exists():
            return  # já existe de uma tentativa anterior: não sobrescrever
        try:
            shutil.copy2(origem, destino)
        except OSError:
            pass  # sem espaço/permissão: a migração é transacional de todo jeito

    @staticmethod
    def _migrate_episode_kind(c: sqlite3.Connection) -> None:
        """Acrescenta `kind` e troca a chave única de (anime, temporada,
        episódio) para (…, kind).

        Aqui não dá pra usar ALTER TABLE: o SQLite adiciona coluna, mas não
        remove um UNIQUE de tabela. Com o antigo no lugar, gravar a abertura
        da temporada 2 esbarraria no episódio 1 dela. Então é a reconstrução
        documentada pelo SQLite — tabela nova, cópia, troca de nome.

        Os ids são PRESERVADOS na cópia, então `shot` e `manual_override`
        continuam apontando pras mesmas linhas. É por isso que as chaves
        estrangeiras ficam desligadas durante a troca: por um instante a
        tabela `episode` não existe, e com elas ligadas o SQLite apagaria os
        shots em cascata.
        """
        c.execute("PRAGMA foreign_keys = OFF")
        try:
            c.execute("BEGIN IMMEDIATE")
            c.execute(
                """
                CREATE TABLE episode_novo (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
                    season INTEGER NOT NULL,
                    episode INTEGER NOT NULL,
                    source_file TEXT,
                    processed_at TIMESTAMP,
                    output_root TEXT,
                    kind TEXT NOT NULL DEFAULT '',
                    UNIQUE(anime_id, season, episode, kind)
                )
                """
            )
            c.execute(
                "INSERT INTO episode_novo "
                "(id, anime_id, season, episode, source_file, processed_at, "
                " output_root, kind) "
                "SELECT id, anime_id, season, episode, source_file, "
                "       processed_at, output_root, '' FROM episode"
            )
            c.execute("DROP TABLE episode")
            c.execute("ALTER TABLE episode_novo RENAME TO episode")
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise
        finally:
            c.execute("PRAGMA foreign_keys = ON")

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # --- anime / episode ---

    def upsert_anime(
        self,
        anilist_id: int | None,
        title: str,
        mal_id: int | None = None,
        title_english: str | None = None,
    ) -> int:
        with self.connect() as c:
            if anilist_id is not None:
                row = c.execute("SELECT id FROM anime WHERE anilist_id = ?", (anilist_id,)).fetchone()
                if row:
                    c.execute(
                        "UPDATE anime SET title=?, mal_id=?, title_english=? WHERE id=?",
                        (title, mal_id, title_english, row["id"]),
                    )
                    return row["id"]
            row = c.execute("SELECT id FROM anime WHERE title = ? COLLATE NOCASE", (title,)).fetchone()
            if row:
                return row["id"]
            cur = c.execute(
                "INSERT INTO anime(anilist_id, mal_id, title, title_english) VALUES(?,?,?,?)",
                (anilist_id, mal_id, title, title_english),
            )
            return cur.lastrowid

    def upsert_episode(
        self,
        anime_id: int,
        season: int,
        episode: int,
        source: str,
        kind: str = "",
        root: str | None = None,
    ) -> int:
        """A linha deste episódio — reaproveitada quando já existe.

        A identidade é (anime, temporada, episódio, tipo), mas o ANIME não é
        estável entre os modos: "Só cortar" não usa rede e registra pelo nome
        do arquivo ("That Time I Got Reincarnated as a Slime"); identificar
        depois resolve no AniList e registra pelo nome oficial ("Tensei
        Shitara Slime Datta Ken 4th Season"). Anime diferente, chave
        diferente, linha NOVA — duas entradas no histórico apontando pra
        mesma pasta. Aconteceu com o Slime S04E24 cortado pela fila.

        E duplicata aqui não é só feiura: excluir qualquer uma das duas pela
        Biblioteca apaga a pasta, e a pasta é das duas.

        Então `root` entra como segunda identidade: uma pasta no disco é UM
        episódio. Achando uma linha dessa pasta sob outro anime, ela é
        reaproveitada — e se ela era do anime sem rede e este tem id do
        AniList, passa a ser deste. Nunca o contrário: cortar de novo, sem
        rede, um episódio já identificado não pode rebaixar a identidade dele.
        """
        with self.connect() as c:
            # A PASTA vem antes da chave (anime, temporada, episódio, tipo).
            #
            # Em banco que já tem a duplicata — criada por motor anterior ao
            # 0.14.1 —, a chave do anime sem rede casa com a cópia vazia, e
            # recortar sem rede trabalharia nela. Indo pela pasta, e com a
            # linha de id do AniList na frente, a cópia vazia nunca é a linha
            # em uso: é isso que deixa `_limpar_duplicatas` apagá-la a
            # qualquer momento, até com uma análise rodando em paralelo.
            mesma_pasta = None
            if root:
                mesma_pasta = c.execute(
                    "SELECT e.id, a.anilist_id FROM episode e "
                    "LEFT JOIN anime a ON a.id = e.anime_id "
                    "WHERE lower(e.output_root) = lower(?) "
                    "AND e.season=? AND e.episode=? AND e.kind=? "
                    "ORDER BY (a.anilist_id IS NULL), e.id",
                    (root, season, episode, kind),
                ).fetchone()
            if mesma_pasta is None:
                row = c.execute(
                    "SELECT id FROM episode "
                    "WHERE anime_id=? AND season=? AND episode=? AND kind=?",
                    (anime_id, season, episode, kind),
                ).fetchone()
                if row:
                    c.execute(
                        "UPDATE episode SET source_file=?, processed_at=CURRENT_TIMESTAMP WHERE id=?",
                        (source, row["id"]),
                    )
                    return row["id"]
            if root:
                if mesma_pasta:
                    este = c.execute(
                        "SELECT anilist_id FROM anime WHERE id=?", (anime_id,)
                    ).fetchone()
                    # Mesmo episódio do anime online já registrado em OUTRA
                    # pasta: subir esta violaria o UNIQUE da chave. Fica como
                    # está — melhor uma linha sem nome oficial que um erro no
                    # fim de uma análise de vários minutos.
                    ocupada = c.execute(
                        "SELECT 1 FROM episode WHERE anime_id=? AND season=? "
                        "AND episode=? AND kind=? AND id<>?",
                        (anime_id, season, episode, kind, mesma_pasta["id"]),
                    ).fetchone()
                    sobe = (
                        este is not None
                        and este["anilist_id"] is not None
                        and mesma_pasta["anilist_id"] is None
                        and ocupada is None
                    )
                    if sobe:
                        c.execute(
                            "UPDATE episode SET anime_id=?, source_file=?, "
                            "processed_at=CURRENT_TIMESTAMP WHERE id=?",
                            (anime_id, source, mesma_pasta["id"]),
                        )
                    else:
                        c.execute(
                            "UPDATE episode SET source_file=?, "
                            "processed_at=CURRENT_TIMESTAMP WHERE id=?",
                            (source, mesma_pasta["id"]),
                        )
                    return mesma_pasta["id"]
            cur = c.execute(
                "INSERT INTO episode(anime_id, season, episode, source_file, "
                "processed_at, kind) VALUES(?,?,?,?,CURRENT_TIMESTAMP,?)",
                (anime_id, season, episode, source, kind),
            )
            return cur.lastrowid

    def set_episode_root(self, episode_id: int, root: str) -> None:
        """Grava a pasta de saída do episódio (ver comentário no SCHEMA)."""
        with self.connect() as c:
            c.execute(
                "UPDATE episode SET output_root=? WHERE id=?", (str(root), episode_id)
            )

    def toggle_favorite(self, shot_id: int, character_id: int = 0) -> bool:
        """Liga/desliga o favorito da CENA. Devolve o estado NOVO.

        Devolver o estado em vez de void é o que deixa a tela acertar a
        estrela sem ter que perguntar de novo.

        Favoritar grava de quem foi o clique (`character_id`, ou 0 na visão
        "Todas as cenas"). Desfavoritar apaga TODAS as linhas da cena, e é de
        propósito: a estrela é uma só na tela, e o usuário lê "favoritado" ou
        "não". Apagar só a linha daquele personagem deixaria a estrela cheia
        depois do clique que era pra esvaziá-la.
        """
        with self.connect() as c:
            achou = c.execute(
                "SELECT 1 FROM favorite WHERE shot_id=?", (shot_id,)
            ).fetchone()
            if achou:
                c.execute("DELETE FROM favorite WHERE shot_id=?", (shot_id,))
                return False
            c.execute(
                "INSERT INTO favorite(shot_id, character_id) VALUES(?,?)",
                (shot_id, character_id),
            )
            return True

    def favorite_shot_ids(self, character_id: int | None = None) -> set[int]:
        """Ids das cenas favoritas — de um personagem, ou de todos.

        A estrela da grade usa a versão SEM personagem: favoritar é da cena.
        """
        with self.connect() as c:
            if character_id is None:
                rows = c.execute("SELECT DISTINCT shot_id FROM favorite").fetchall()
            else:
                rows = c.execute(
                    "SELECT shot_id FROM favorite WHERE character_id=?",
                    (character_id,),
                ).fetchall()
            return {int(r[0]) for r in rows}

    def shot_context(self, shot_id: int) -> dict | None:
        """A cena com o episódio e o anime dela — o que a marcação precisa.

        Marcar um personagem numa cena mexe em três lugares (banco, disco e a
        decisão que sobrevive à reanálise), e todos pedem peças diferentes:
        `output_root` e `file` pro hardlink, `idx` e `episode_id` pro
        override, `anime_id` pra achar o personagem certo.
        """
        with self.connect() as c:
            r = c.execute(
                "SELECT s.id, s.idx, s.file, s.episode_id, "
                "       e.output_root, e.anime_id "
                "  FROM shot s JOIN episode e ON e.id = s.episode_id "
                " WHERE s.id = ?",
                (shot_id,),
            ).fetchone()
            return dict(r) if r else None

    def character_row(self, character_id: int) -> dict | None:
        with self.connect() as c:
            r = c.execute(
                "SELECT id, name, anime_id FROM character WHERE id = ?",
                (character_id,),
            ).fetchone()
            return dict(r) if r else None

    def characters_of_favorites(self) -> dict[int, list[dict]]:
        """Quem aparece em cada cena favoritada, do mais confiante pro menos.

        Serve pro favorito feito em "Todas as cenas", que grava
        `character_id = 0` — ali o clique não disse de quem era. Quem está na
        cena o banco JÁ sabe, e é a mesma verdade que gerou as pastas
        `by_character/`: um clipe mora na pasta de cada personagem que ele
        tem. Sem isto o favorito cairia no balaio "Sem personagem" mesmo com
        a Roxy identificada com 0,92 de confiança.
        """
        with self.connect() as c:
            rows = c.execute(
                "SELECT sc.shot_id, sc.character_id, sc.confidence, ch.name "
                "  FROM shot_character sc "
                "  JOIN character ch ON ch.id = sc.character_id "
                " WHERE sc.shot_id IN (SELECT shot_id FROM favorite) "
                " ORDER BY sc.shot_id, sc.confidence DESC"
            ).fetchall()
        saida: dict[int, list[dict]] = {}
        for r in rows:
            saida.setdefault(int(r["shot_id"]), []).append({
                "character_id": int(r["character_id"]),
                "name": str(r["name"] or "").strip(),
                "confidence": r["confidence"],
            })
        return saida

    def favorites(self) -> list[dict]:
        """Todo favorito, com a cena, o episódio e o personagem juntos.

        Um JOIN só: a Biblioteca precisa de tudo isso pra agrupar por anime e
        por personagem, e ir buscar peça por peça seria N+1 consultas.
        """
        with self.connect() as c:
            rows = c.execute(
                "SELECT f.shot_id, f.character_id, f.created_at, "
                "       s.idx, s.file, s.keyframe, s.duration, s.episode_id, "
                "       e.output_root, e.season, e.episode, e.kind, "
                "       ch.name AS character_name, "
                "       (SELECT sc.confidence FROM shot_character sc "
                "         WHERE sc.shot_id = s.id AND sc.character_id = f.character_id) "
                "         AS confidence "
                "  FROM favorite f "
                "  JOIN shot s ON s.id = f.shot_id "
                "  JOIN episode e ON e.id = s.episode_id "
                "  LEFT JOIN character ch ON ch.id = f.character_id "
                " WHERE e.output_root IS NOT NULL "
                " ORDER BY e.season, e.episode, s.idx"
            ).fetchall()
            return [dict(r) for r in rows]

    def characters_with_shots(self) -> list[dict]:
        """Personagens que têm ao menos uma cena, do mais presente pro menos.

        A ordem importa pra quem agrupa grafias: processando do maior pro
        menor, o nome que o usuário mais vê é o que vira o nome do grupo.
        `sample` é um keyframe qualquer dele, pra a lista ter rosto.
        """
        with self.connect() as c:
            rows = c.execute(
                "SELECT ch.id, ch.name, ch.anime_id, "
                "       COUNT(DISTINCT sc.shot_id) AS n, "
                # As duas metades do caminho vêm SEPARADAS de propósito.
                #
                # Concatenar aqui custou caro: a barra escrita numa string
                # Python de aspas duplas colapsou pra duas aspas simples,
                # que em SQL é a string VAZIA — a amostra saía
                # "Tensura\S03E10keyframes8_1.jpg", sem separador, e
                # 95 das 97 miniaturas não abriam. Juntar caminho é
                # trabalho do pathlib, não do banco.
                "       (SELECT s2.output_root FROM shot s "
                "          JOIN shot_character x ON x.shot_id = s.id "
                "          JOIN episode s2 ON s2.id = s.episode_id "
                "         WHERE x.character_id = ch.id AND s.keyframe IS NOT NULL "
                "           AND s2.output_root IS NOT NULL "
                "         ORDER BY x.confidence DESC LIMIT 1) AS sample_root, "
                "       (SELECT s.keyframe FROM shot s "
                "          JOIN shot_character x ON x.shot_id = s.id "
                "          JOIN episode s2 ON s2.id = s.episode_id "
                "         WHERE x.character_id = ch.id AND s.keyframe IS NOT NULL "
                "           AND s2.output_root IS NOT NULL "
                "         ORDER BY x.confidence DESC LIMIT 1) AS sample_kf "
                "FROM character ch "
                "JOIN shot_character sc ON sc.character_id = ch.id "
                "GROUP BY ch.id ORDER BY n DESC, ch.name"
            ).fetchall()
            return [dict(r) for r in rows]

    def shot_stats_by_root(self, ids: list[int]) -> list[dict]:
        """Cenas e episódios deste personagem, POR PASTA de episódio.

        A pasta do anime sai daqui em Python, nunca em SQL: juntar ou cortar
        caminho no banco já custou 95 miniaturas quebradas (ver
        `characters_with_shots`).
        """
        if not ids:
            return []
        marcas = ",".join("?" * len(ids))
        with self.connect() as c:
            rows = c.execute(
                "SELECT e.output_root, COUNT(DISTINCT s.id) AS n, "
                "       COUNT(DISTINCT e.id) AS eps "
                "  FROM shot_character sc "
                "  JOIN shot s ON s.id = sc.shot_id "
                "  JOIN episode e ON e.id = s.episode_id "
                f" WHERE sc.character_id IN ({marcas}) AND e.output_root IS NOT NULL "
                " GROUP BY e.output_root",
                ids,
            ).fetchall()
            return [dict(r) for r in rows]

    def shot_stats_for_characters(self, ids: list[int]) -> tuple[int, int, list[str]]:
        """(cenas distintas, episódios distintos, pastas de episódio).

        DISTINCT no shot_id porque duas grafias do mesmo personagem podem
        estar ligadas à MESMA cena — somar por linha contaria duas vezes.
        """
        if not ids:
            return 0, 0, []
        marcas = ",".join("?" * len(ids))
        with self.connect() as c:
            row = c.execute(
                f"SELECT COUNT(DISTINCT s.id) AS cenas, "
                f"       COUNT(DISTINCT s.episode_id) AS eps "
                f"  FROM shot_character sc JOIN shot s ON s.id = sc.shot_id "
                f" WHERE sc.character_id IN ({marcas})",
                tuple(ids),
            ).fetchone()
            raizes = c.execute(
                f"SELECT DISTINCT e.output_root FROM shot_character sc "
                f"  JOIN shot s ON s.id = sc.shot_id "
                f"  JOIN episode e ON e.id = s.episode_id "
                f" WHERE sc.character_id IN ({marcas}) AND e.output_root IS NOT NULL",
                tuple(ids),
            ).fetchall()
            return int(row["cenas"]), int(row["eps"]), [r[0] for r in raizes]

    def shots_for_characters(self, ids: list[int]) -> list[dict]:
        """Cenas desses personagens no acervo inteiro, com o episódio junto."""
        if not ids:
            return []
        marcas = ",".join("?" * len(ids))
        with self.connect() as c:
            rows = c.execute(
                f"SELECT DISTINCT s.id, s.idx, s.file, s.keyframe, s.duration, "
                f"       s.episode_id, e.output_root, e.season, e.episode, e.kind, "
                f"       MAX(sc.confidence) AS confidence "
                f"  FROM shot_character sc "
                f"  JOIN shot s ON s.id = sc.shot_id "
                f"  JOIN episode e ON e.id = s.episode_id "
                f" WHERE sc.character_id IN ({marcas}) "
                f" GROUP BY s.id "
                f" ORDER BY e.season, e.episode, s.idx",
                tuple(ids),
            ).fetchall()
            return [dict(r) for r in rows]

    def episodes_by_ids(self, ids: list[int]) -> list[dict]:
        """Linhas completas de episódio, por id. Usada por quem renomeia."""
        if not ids:
            return []
        marcas = ",".join("?" * len(ids))
        with self.connect() as c:
            rows = c.execute(
                f"SELECT id, anime_id, season, episode, kind, output_root "
                f"FROM episode WHERE id IN ({marcas})",
                tuple(ids),
            ).fetchall()
            return [dict(r) for r in rows]

    def episode_at(self, anime_id: int, season: int, episode: int, kind: str = "") -> int | None:
        """Id do episódio nessa posição, se existir.

        A chave (anime, temporada, episódio, tipo) é única — é ela que o resto
        do app usa pra decidir "é o mesmo episódio". Quem move episódio de
        temporada tem que checar antes, senão cria duas linhas colidindo.
        """
        with self.connect() as c:
            row = c.execute(
                "SELECT id FROM episode WHERE anime_id=? AND season=? AND episode=? AND kind=?",
                (anime_id, season, episode, kind),
            ).fetchone()
            return int(row["id"]) if row else None

    def delete_episode(self, episode_id: int) -> None:
        """Apaga o episódio e tudo que pende dele, numa transação só.

        Ordem de dentro pra fora, senão as chaves estrangeiras (ou, sem elas,
        as linhas órfãs) sobram apontando pro nada. `manual_override` vai junto
        de propósito: a curadoria era daquele episódio e não faz sentido
        sobreviver a ele — pior, reapareceria se o mesmo episódio fosse
        analisado de novo.
        """
        with self.connect() as c:
            c.execute(
                "DELETE FROM shot_character WHERE shot_id IN "
                "(SELECT id FROM shot WHERE episode_id=?)",
                (episode_id,),
            )
            c.execute("DELETE FROM shot WHERE episode_id=?", (episode_id,))
            try:
                c.execute("DELETE FROM manual_override WHERE episode_id=?", (episode_id,))
            except sqlite3.OperationalError:
                pass  # banco anterior a esta tabela
            c.execute("DELETE FROM episode WHERE id=?", (episode_id,))

    def set_episode_season(self, episode_id: int, season: int) -> None:
        with self.connect() as c:
            c.execute("UPDATE episode SET season=? WHERE id=?", (season, episode_id))

    def reclassify_episodes(self, mudancas: list[tuple[int, int, int, str, str]]) -> None:
        """Novo (temporada, número, tipo, pasta) de vários episódios, numa
        transação só.

        Em dois passos: primeiro todos vão pra um número provisório (o próprio
        id, negativo), depois pro definitivo. Direto, um episódio podia
        tentar entrar na chave que outro da mesma lista ainda não liberou, e o
        UNIQUE derrubava a operação no meio.
        """
        if not mudancas:
            return
        with self.connect() as c:
            for eid, *_ in mudancas:
                c.execute("UPDATE episode SET episode=? WHERE id=?", (-eid, eid))
            for eid, season, numero, kind, root in mudancas:
                c.execute(
                    "UPDATE episode SET season=?, episode=?, kind=?, output_root=? WHERE id=?",
                    (season, numero, kind, str(root), eid),
                )

    def all_episode_roots(self) -> list[dict]:
        """Todo episódio que tem pasta gravada — `id` e `output_root`.

        Sem `LIMIT` e sem exigir cenas, ao contrário de `recent_episodes`:
        quem junta pastas precisa reapontar TUDO que morava na origem,
        inclusive episódio antigo que não cabe no histórico da tela e análise
        que ficou sem cena. Deixar um pra trás cria caminho quebrado.
        """
        with self.connect() as c:
            rows = c.execute(
                "SELECT id, output_root FROM episode WHERE output_root IS NOT NULL"
            ).fetchall()
            return [dict(r) for r in rows]

    def recent_episodes(self, limit: int = 0) -> list[dict]:
        """Episódios analisados, do mais recente pro mais antigo.

        **`limit=0` (o padrão) traz TODOS.** O corte existia quando isto
        alimentava uma lista de "recentes"; hoje alimenta a Biblioteca, que é
        o acervo inteiro em árvore. Com um limite, cada análise nova empurrava
        a mais antiga pra fora e o episódio simplesmente desaparecia da tela,
        intacto no disco e no banco. O usuário via isso como perda de dado, e
        não havia mensagem nenhuma explicando.

        Só os que têm `output_root` gravado e ao menos um shot — sem isso a
        lista ofereceria entradas que não abrem (análises anteriores a esta
        coluna, ou runs que morreram no meio).
        """
        sql = (
            "SELECT e.id, e.season, e.episode, e.kind, e.output_root, e.processed_at, "
            "       a.title AS anime_title, "
            "       (SELECT COUNT(*) FROM shot s WHERE s.episode_id = e.id) AS shot_count "
            "FROM episode e JOIN anime a ON a.id = e.anime_id "
            "WHERE e.output_root IS NOT NULL "
            "  AND EXISTS (SELECT 1 FROM shot s WHERE s.episode_id = e.id) "
            "ORDER BY e.processed_at DESC"
        )
        with self.connect() as c:
            if limit and limit > 0:
                rows = c.execute(sql + " LIMIT ?", (limit,)).fetchall()
            else:
                rows = c.execute(sql).fetchall()
            return [dict(r) for r in rows]

    def clear_episode_shots(self, episode_id: int) -> None:
        with self.connect() as c:
            c.execute("DELETE FROM shot WHERE episode_id=?", (episode_id,))

    # --- characters ---

    def upsert_character(
        self,
        anime_id: int,
        name: str,
        anilist_id: int | None,
        mal_id: int | None = None,
        role: str | None = None,
    ) -> int:
        with self.connect() as c:
            if anilist_id is not None:
                row = c.execute(
                    "SELECT id FROM character WHERE anilist_id = ?", (anilist_id,)
                ).fetchone()
                if row:
                    c.execute(
                        "UPDATE character SET name=?, role=?, mal_id=? WHERE id=?",
                        (name, role, mal_id, row["id"]),
                    )
                    return row["id"]
            row = c.execute(
                "SELECT id FROM character WHERE anime_id=? AND name=? COLLATE NOCASE",
                (anime_id, name),
            ).fetchone()
            if row:
                return row["id"]
            # Mesmo personagem escrito de outro jeito ("Tempest, Rimuru" ≡
            # "Rimuru Tempest"; "Rimuru" do batismo quando inambíguo) reusa
            # a linha existente — senão cada formato de fonte criava um
            # personagem próprio no banco e nos Resultados.
            from ..naming import find_token_match
            rows = c.execute(
                "SELECT id, name FROM character WHERE anime_id=?", (anime_id,)
            ).fetchall()
            match = find_token_match(name, [r["name"] for r in rows])
            if match is not None:
                for r in rows:
                    if r["name"] == match:
                        return r["id"]
            cur = c.execute(
                "INSERT INTO character(anilist_id, mal_id, anime_id, name, role) VALUES(?,?,?,?,?)",
                (anilist_id, mal_id, anime_id, name, role),
            )
            return cur.lastrowid

    def set_character_embedding(
        self, character_id: int, embedding_bytes: bytes, reference_count: int
    ) -> None:
        with self.connect() as c:
            c.execute(
                "UPDATE character SET embedding=?, reference_count=? WHERE id=?",
                (embedding_bytes, reference_count, character_id),
            )

    def get_characters_for_anime(self, anime_id: int) -> list[dict]:
        with self.connect() as c:
            rows = c.execute(
                "SELECT id, anilist_id, mal_id, name, role, threshold, reference_count, embedding "
                "FROM character WHERE anime_id=? ORDER BY role, name",
                (anime_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def set_character_threshold(self, character_id: int, threshold: float) -> None:
        with self.connect() as c:
            c.execute("UPDATE character SET threshold=? WHERE id=?", (threshold, character_id))

    # --- shots ---

    def insert_shot(
        self,
        episode_id: int,
        idx: int,
        file: str,
        keyframe: str | None,
        start: float,
        end: float,
    ) -> int:
        with self.connect() as c:
            cur = c.execute(
                "INSERT INTO shot(episode_id, idx, file, keyframe, start, end, duration) "
                "VALUES(?,?,?,?,?,?,?)",
                (episode_id, idx, file, keyframe, start, end, end - start),
            )
            return cur.lastrowid

    def delete_shots(self, shot_ids: list[int]) -> None:
        """Remove shots e, por ON DELETE CASCADE, as atribuições deles."""
        if not shot_ids:
            return
        marks = ",".join("?" for _ in shot_ids)
        with self.connect() as c:
            c.execute(f"DELETE FROM shot WHERE id IN ({marks})", tuple(shot_ids))

    def assign_character(self, shot_id: int, character_id: int, confidence: float) -> None:
        with self.connect() as c:
            c.execute(
                "INSERT OR REPLACE INTO shot_character(shot_id, character_id, confidence) "
                "VALUES(?,?,?)",
                (shot_id, character_id, confidence),
            )

    def shots_for_character(
        self, character_id: int, episode_id: int | None = None
    ) -> list[dict]:
        """Return shots tagged with this character.
        If `episode_id` is set, restricts to that episode (prevents shots
        from other runs from leaking into the current view)."""
        query = (
            "SELECT s.id, s.idx, s.file, s.keyframe, s.start, s.end, s.duration, "
            "sc.confidence, sc.approved "
            "FROM shot s JOIN shot_character sc ON sc.shot_id = s.id "
            "WHERE sc.character_id = ?"
        )
        args: list = [character_id]
        if episode_id is not None:
            query += " AND s.episode_id = ?"
            args.append(episode_id)
        # ORDEM DA CENA, não confiança.
        #
        # Isto ordenava por `sc.confidence DESC`, e a grade de um personagem
        # saía embaralhada: #0360 antes de #0236. Pra quem edita, a ordem que
        # importa é a do episódio — cenas vizinhas são vizinhas na história, e
        # é assim que se acha o corte que ficou partido no meio. A confiança
        # continua visível no selo de cada card, que é onde ela serve.
        query += " ORDER BY s.idx"
        with self.connect() as c:
            rows = c.execute(query, args).fetchall()
            return [dict(r) for r in rows]

    def shots_without_character(self, episode_id: int) -> list[dict]:
        """As cenas do episódio em que NINGUÉM foi reconhecido.

        É o resto: cenário, plano de objeto, silhueta de costas — e também o
        personagem que o reconhecimento perdeu. Ver tudo isso junto é o que
        permite jogar fora o que não serve e resgatar o que serve; espalhado
        entre 400 cenas, nem uma coisa nem outra acontece.
        """
        with self.connect() as c:
            rows = c.execute(
                "SELECT s.id, s.idx, s.file, s.keyframe, s.start, s.end, s.duration "
                "  FROM shot s "
                " WHERE s.episode_id = ? "
                "   AND NOT EXISTS (SELECT 1 FROM shot_character sc "
                "                    WHERE sc.shot_id = s.id) "
                " ORDER BY s.idx",
                (episode_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def count_shots_without_character(self, episode_id: int) -> int:
        with self.connect() as c:
            return int(
                c.execute(
                    "SELECT COUNT(*) FROM shot s WHERE s.episode_id = ? "
                    "AND NOT EXISTS (SELECT 1 FROM shot_character sc "
                    "                 WHERE sc.shot_id = s.id)",
                    (episode_id,),
                ).fetchone()[0]
            )

    def shots_for_episode(self, episode_id: int) -> list[dict]:
        with self.connect() as c:
            rows = c.execute(
                "SELECT id, idx, file, keyframe, start, end, duration FROM shot "
                "WHERE episode_id=? ORDER BY idx",
                (episode_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def characters_in_shot(self, shot_id: int) -> list[dict]:
        with self.connect() as c:
            rows = c.execute(
                """SELECT c.id, c.name, sc.confidence, sc.approved
                   FROM shot_character sc
                   JOIN character c ON c.id = sc.character_id
                   WHERE sc.shot_id = ?
                   ORDER BY sc.confidence DESC""",
                (shot_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def assignments_for_episode(self, episode_id: int) -> dict[int, list[dict]]:
        """Todas as atribuições do episódio de uma vez: {shot_id: [{id, name,
        confidence, approved}, ...]} ordenadas por confiança. Evita 1 query
        por shot na hora de montar as pastas."""
        with self.connect() as c:
            rows = c.execute(
                """SELECT sc.shot_id, c.id, c.name, sc.confidence, sc.approved
                   FROM shot_character sc
                   JOIN character c ON c.id = sc.character_id
                   JOIN shot s ON s.id = sc.shot_id
                   WHERE s.episode_id = ?
                   ORDER BY sc.confidence DESC""",
                (episode_id,),
            ).fetchall()
        out: dict[int, list[dict]] = {}
        for r in rows:
            out.setdefault(r["shot_id"], []).append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "confidence": r["confidence"],
                    "approved": r["approved"],
                }
            )
        return out

    # --- reanálise: substituir vs adicionar ---

    def has_analysis(
        self, source: str, anime_title: str, season: int, episode: int,
        kind: str = "",
    ) -> bool:
        """True se este episódio já tem atribuições salvas (pra UI perguntar
        'substituir ou adicionar?'). Casa por arquivo fonte OU por
        título+temporada+episódio.

        `kind` entra na comparação junto: a abertura da 2ª temporada não é o
        episódio 1 dela, e sem isto analisar a abertura perguntava
        'substituir ou somar?' apontando pro episódio errado."""
        with self.connect() as c:
            row = c.execute(
                """SELECT 1 FROM shot_character sc
                   JOIN shot s ON s.id = sc.shot_id
                   JOIN episode e ON e.id = s.episode_id
                   LEFT JOIN anime a ON a.id = e.anime_id
                   WHERE (e.source_file = ? AND e.kind = ?)
                      OR (a.title = ? COLLATE NOCASE
                          AND e.season = ? AND e.episode = ? AND e.kind = ?)
                   LIMIT 1""",
                (source, kind, anime_title, season, episode, kind),
            ).fetchone()
            return row is not None

    def assignments_snapshot(self, episode_id: int) -> list[dict]:
        """Foto das atribuições atuais POR NÚMERO de cena (sobrevive ao
        clear_episode_shots) — insumo do modo 'adicionar' da reanálise."""
        with self.connect() as c:
            rows = c.execute(
                """SELECT s.idx AS shot_idx, sc.character_id, sc.confidence,
                          sc.reviewed, sc.approved
                   FROM shot_character sc
                   JOIN shot s ON s.id = sc.shot_id
                   WHERE s.episode_id = ?""",
                (episode_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def merge_assignment(
        self,
        shot_id: int,
        character_id: int,
        confidence: float,
        reviewed: int = 0,
        approved: int | None = None,
    ) -> None:
        """Devolve uma atribuição antiga SEM sobrescrever a nova (a análise
        recente ganha quando o par já existe)."""
        with self.connect() as c:
            c.execute(
                "INSERT OR IGNORE INTO shot_character"
                "(shot_id, character_id, confidence, reviewed, approved) "
                "VALUES(?,?,?,?,?)",
                (shot_id, character_id, confidence, reviewed, approved),
            )

    # --- curadoria manual persistente ---

    def record_manual(
        self,
        episode_id: int,
        shot_idx: int,
        character_id: int,
        action: str,
        confidence: float | None = None,
    ) -> None:
        """Grava uma decisão manual ('add' ou 'block') pra cena shot_idx.
        REPLACE: a decisão mais recente pro mesmo par vence (ex.: removeu,
        depois moveu de volta → o 'add' substitui o 'block')."""
        with self.connect() as c:
            c.execute(
                "INSERT OR REPLACE INTO manual_override"
                "(episode_id, shot_idx, character_id, action, confidence) "
                "VALUES(?,?,?,?,?)",
                (episode_id, shot_idx, character_id, action, confidence),
            )

    def manual_overrides(self, episode_id: int) -> list[dict]:
        with self.connect() as c:
            rows = c.execute(
                "SELECT shot_idx, character_id, action, confidence "
                "FROM manual_override WHERE episode_id = ?",
                (episode_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def assign_character_manual(
        self, shot_id: int, character_id: int, confidence: float | None
    ) -> None:
        """Atribuição vinda da curadoria manual: entra revisada e aprovada,
        o que a protege do drop por poucos-shots."""
        with self.connect() as c:
            c.execute(
                "INSERT OR REPLACE INTO shot_character"
                "(shot_id, character_id, confidence, reviewed, approved) "
                "VALUES(?,?,?,1,1)",
                (shot_id, character_id, float(confidence or 1.0)),
            )

    def drop_low_count_character(self, episode_id: int, character_id: int) -> None:
        """Remove as atribuições AUTOMÁTICAS deste personagem no episódio
        (poucos shots = provável ruído). Escopado ao episódio — não mexe em
        outros eps — e poupa linhas aprovadas/manuais."""
        with self.connect() as c:
            c.execute(
                "DELETE FROM shot_character WHERE character_id = ? "
                "AND (approved IS NULL OR approved = 0) "
                "AND shot_id IN (SELECT id FROM shot WHERE episode_id = ?)",
                (character_id, episode_id),
            )

    def set_assignment_review(self, shot_id: int, character_id: int, approved: bool) -> None:
        with self.connect() as c:
            c.execute(
                "UPDATE shot_character SET reviewed=1, approved=? WHERE shot_id=? AND character_id=?",
                (1 if approved else 0, shot_id, character_id),
            )

    def remove_shot_character(self, shot_id: int, character_id: int) -> None:
        with self.connect() as c:
            c.execute(
                "DELETE FROM shot_character WHERE shot_id = ? AND character_id = ?",
                (shot_id, character_id),
            )

    def move_shot_to_character(
        self, shot_id: int, old_character_id: int, new_character_id: int, confidence: float | None = None
    ) -> None:
        """Reassign a shot from one character to another (manual correction).
        Preserves confidence if the new pair already exists."""
        with self.connect() as c:
            c.execute(
                "DELETE FROM shot_character WHERE shot_id = ? AND character_id = ?",
                (shot_id, old_character_id),
            )
            existing = c.execute(
                "SELECT 1 FROM shot_character WHERE shot_id = ? AND character_id = ?",
                (shot_id, new_character_id),
            ).fetchone()
            if existing is None:
                c.execute(
                    "INSERT INTO shot_character(shot_id, character_id, confidence, reviewed, approved) "
                    "VALUES(?,?,?,1,1)",
                    (shot_id, new_character_id, float(confidence or 1.0)),
                )
            else:
                c.execute(
                    "UPDATE shot_character SET reviewed=1, approved=1 "
                    "WHERE shot_id=? AND character_id=?",
                    (shot_id, new_character_id),
                )
