"""Faxina no Explorer vira curadoria.

O usuário organiza no Windows: abre `by_character/Rimuru/`, vê três clipes
que não são o Rimuru e apaga. Até agora isso não significava nada pro app —
o banco continuava dizendo que aquelas cenas eram do Rimuru, os resultados
continuavam mostrando, e a reanálise seguinte recriava os arquivos.

Aqui a ausência passa a ser lida como decisão:

- **clipe some de `shots/`** → a cena inteira foi descartada;
- **clipe some de `by_character/Fulano/` mas segue em `shots/`** → não é
  "apaga a cena", é "essa cena não é do Fulano". Vira bloqueio lembrado,
  igual ao de remover pela tela;
- **a pasta `by_character/Fulano/` inteira some** → provavelmente "esse
  personagem não está neste episódio". Aqui NÃO se decide sozinho: apagar
  uma pasta com 80 clipes é diferente demais de apagar três, e uma pasta
  pode sumir por acidente (recortar e colar no lugar errado). Vira pergunta.

**Contra o falso positivo.** Se `shots/` ou `by_character/` não existem, ou
se TODOS os clipes sumiram de uma vez, a leitura é abortada. Um HD externo
desconectado, uma pasta movida ou uma sincronização de nuvem no meio do
caminho parecem exatamente com "apaguei tudo" — e a diferença entre as duas
interpretações é o acervo inteiro.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .db import Database
from .organizer import sanitize


@dataclass
class Mudancas:
    """O que mudou no disco desde a última vez que o app olhou."""

    #: Cenas cujo clipe não está mais em `shots/`.
    clipes_sumidos: list[dict] = field(default_factory=list)
    #: Pares (cena, personagem) cujo hardlink sumiu, com a cena ainda viva.
    pares_sumidos: list[dict] = field(default_factory=list)
    #: Personagens cuja pasta inteira sumiu — isto é pergunta, não decisão.
    pastas_sumidas: list[dict] = field(default_factory=list)
    #: Pastas que existem mas cujos arquivos não reconhecemos (renomeados,
    #: copiados em vez de linkados). Ficam de fora da leitura, e isso é dito.
    ilegiveis: list[str] = field(default_factory=list)
    #: False = o disco não está em estado de ser lido. Nada deve ser aplicado.
    seguro: bool = True
    motivo: str = ""

    @property
    def vazio(self) -> bool:
        return not (self.clipes_sumidos or self.pares_sumidos or self.pastas_sumidas)

    def payload(self) -> dict:
        return {
            "safe": self.seguro,
            "reason": self.motivo,
            "missingClips": len(self.clipes_sumidos),
            "unlinkedPairs": [
                {"shotIdx": p["shot_idx"], "character": p["name"]}
                for p in self.pares_sumidos
            ],
            "missingFolders": [
                # O id vai junto porque é ele que a confirmação devolve —
                # nome não serve de chave: dois personagens podem ter o
                # mesmo nome curto depois de um batismo manual.
                {"id": f["id"], "character": f["name"], "shots": f["shots"]}
                for f in self.pastas_sumidas
            ],
            "unreadableFolders": self.ilegiveis,
        }


def ler(episode_root: Path | str, db: Database, episode_id: int) -> Mudancas:
    """Compara o banco com o que está no disco agora."""
    raiz = Path(episode_root)
    m = Mudancas()
    _CACHE_INODES.clear()

    shots_dir = raiz / "shots"
    chars_dir = raiz / "by_character"
    if not shots_dir.is_dir():
        m.seguro = False
        m.motivo = "a pasta shots não está acessível"
        return m

    shots = db.shots_for_episode(episode_id)
    if not shots:
        return m

    presentes = {p.name for p in shots_dir.iterdir() if p.is_file()}
    sumidos = [s for s in shots if Path(s["file"]).name not in presentes]
    if len(sumidos) == len(shots):
        # Nenhum clipe no lugar = disco fora, pasta movida ou sincronização
        # no meio. Ler isso como "apagou tudo" apagaria o episódio inteiro.
        m.seguro = False
        m.motivo = "nenhum clipe foi encontrado na pasta"
        return m
    m.clipes_sumidos = sumidos

    if not chars_dir.is_dir():
        # Sem agrupamento no disco não há o que comparar por personagem. Não
        # é erro: pode ser um episódio cortado sem identificar.
        return m

    ids_sumidos = {s["id"] for s in sumidos}
    vivos = {s["id"]: s for s in shots if s["id"] not in ids_sumidos}
    atribuicoes = db.assignments_for_episode(episode_id)
    por_personagem: dict[str, dict] = {}
    for shot_id, chars in atribuicoes.items():
        shot = vivos.get(shot_id)
        if shot is None:
            continue
        for ch in chars:
            reg = por_personagem.setdefault(
                ch["name"],
                {"id": ch["id"], "name": ch["name"], "total": 0, "faltando": [],
                 "presentes": 0},
            )
            reg["total"] += 1
            pasta = chars_dir / sanitize(ch["name"])
            if not pasta.is_dir():
                reg["sem_pasta"] = True
                continue
            if _mesmo_arquivo(raiz / shot["file"], pasta):
                reg["presentes"] += 1
            else:
                reg["faltando"].append(
                    {
                        "shot_id": shot_id,
                        "shot_idx": shot["idx"],
                        "character_id": ch["id"],
                        "name": ch["name"],
                    }
                )

    for reg in por_personagem.values():
        if reg.get("sem_pasta"):
            m.pastas_sumidas.append({"id": reg["id"], "name": reg["name"],
                                     "shots": reg["total"]})
        elif reg["presentes"] == 0 and reg["faltando"]:
            # Pasta cheia mas NENHUM arquivo reconhecido: isso não é faxina,
            # é uma pasta que não sabemos ler. Acontece de verdade — o
            # usuário renomeia os clipes em lote ("Ramiris Clip - 1.mp4") e o
            # link some da nossa vista sem nada ter sido apagado. Ler isso
            # como "ele tirou o personagem todo" bloquearia o episódio
            # inteiro. Fica de fora — e a interface diz que ficou.
            m.ilegiveis.append(reg["name"])
        else:
            m.pares_sumidos.extend(reg["faltando"])

    return m


def _inodes(pasta: Path) -> set[tuple[int, int]]:
    """(dispositivo, inode) de cada arquivo da pasta, em cache por chamada.

    O clipe em `by_character/` é um HARDLINK pro de `shots/`: o mesmo arquivo
    com outro nome. Então comparar por nome é frágil de um jeito que importa
    — renomear em lote é coisa que o usuário faz — e comparar por identidade
    de arquivo continua valendo depois de qualquer renomeação.
    """
    if pasta in _CACHE_INODES:
        return _CACHE_INODES[pasta]
    achados: set[tuple[int, int]] = set()
    try:
        for p in pasta.iterdir():
            if not p.is_file():
                continue
            try:
                st = p.stat()
                achados.add((st.st_dev, st.st_ino))
            except OSError:
                pass
    except OSError:
        pass
    _CACHE_INODES[pasta] = achados
    return achados


_CACHE_INODES: dict[Path, set[tuple[int, int]]] = {}


def _mesmo_arquivo(clipe: Path, pasta: Path) -> bool:
    """Este clipe está na pasta, com qualquer nome?"""
    try:
        st = clipe.stat()
    except OSError:
        return False
    return (st.st_dev, st.st_ino) in _inodes(pasta)


def aplicar(
    db: Database,
    episode_id: int,
    mudancas: Mudancas,
    incluir_pastas: list[int] | None = None,
) -> dict:
    """Grava as mudanças no banco.

    `incluir_pastas` são os ids dos personagens cuja pasta sumiu e que o
    usuário CONFIRMOU remover. Sem confirmação eles ficam de fora — é a
    parte que este módulo se recusa a decidir sozinho.
    """
    if not mudancas.seguro:
        return {"clips": 0, "pairs": 0, "characters": 0}

    n_clipes = 0
    if mudancas.clipes_sumidos:
        db.delete_shots([s["id"] for s in mudancas.clipes_sumidos])
        n_clipes = len(mudancas.clipes_sumidos)

    for par in mudancas.pares_sumidos:
        # Bloqueio lembrado, não só remoção: sem ele a próxima análise
        # devolveria a mesma cena pro mesmo personagem, e a faxina teria
        # sido em vão.
        db.record_manual(episode_id, par["shot_idx"], par["character_id"], "block")
        db.remove_shot_character(par["shot_id"], par["character_id"])

    confirmados = set(incluir_pastas or [])
    n_chars = 0
    if confirmados:
        idx_por_shot = {s["id"]: s["idx"] for s in db.shots_for_episode(episode_id)}
        atribuicoes = db.assignments_for_episode(episode_id)
        for pasta in mudancas.pastas_sumidas:
            if pasta["id"] not in confirmados:
                continue
            for shot_id, chars in atribuicoes.items():
                if not any(c["id"] == pasta["id"] for c in chars):
                    continue
                idx = idx_por_shot.get(shot_id)
                if idx is not None:
                    db.record_manual(episode_id, idx, pasta["id"], "block")
                db.remove_shot_character(shot_id, pasta["id"])
            n_chars += 1

    return {
        "clips": n_clipes,
        "pairs": len(mudancas.pares_sumidos),
        "characters": n_chars,
    }
