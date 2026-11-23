"""Repescagem: o personagem que está na cena e ficou sem marcação.

O FAAH (01/11/2026): "tem passado muito personagem sem identificação, até os
principais — cena que é claramente X e o app não tagou". Medido no Cyberpunk
dele (14 episódios): só 28% das cenas com personagem, e 1.442 cenas com
rosto detectado e NINGUÉM marcado — boa parte David, Lucy e Rebecca. A causa
maior é o Modo Descoberta: ele só marca as cenas dos grupos que a pessoa
batizou, e o mesmo personagem partido num grupo sem nome (perfil, outra luz,
outro traço) ficava de fora.

Aqui, depois de tudo decidido, cada cena com rosto e sem ninguém é comparada
com os rostos JÁ MARCADOS do anime — de vários episódios, com prioridade pro
mesmo episódio (mesmo traço, mesma luz) — e quem decide é o CCIP, o modelo
treinado justamente pra "esses dois desenhos são a mesma pessoa?".

Primeira versão comparava só com o mesmo episódio e o CLIP propunha: acertava
98,8%, mas achou só 294 das 1.442 cenas. Personagem com pouca cena marcada no
episódio não tinha banco, e o CLIP não propunha o que o CCIP aceitaria.

O CCIP lê cada rosto em ~0,2 s na CPU. Por isso o vetor de cada rosto lido é
guardado em `metadata/ccip_rostos.npz` do episódio: o banco do anime se
monta uma vez, e repescar de novo não relê nada.

Sem o CCIP instalado não repesca nada: o CLIP sozinho erra demais aqui.
"""

from __future__ import annotations

import json
import random
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

#: Diferença CCIP (média das 2 menores contra o banco) pra aceitar.
ACEITA = 0.12
#: Folga mínima pro segundo personagem mais parecido.
FOLGA = 0.01
#: O CLIP tem que apontar o mesmo personagem (kNN contra o banco).
CLIP_CONCORDA = True
#: Rosto do banco: o da cena marcada que mais parece com o centroide do
#: personagem, se passar disto (senão o rosto marcado pode ser de outro).
NO_BANCO = 0.80
DO_EPISODIO = 8
DE_FORA = 16
#: Quando quem o rosto aponta é quem ESTÁ FALANDO na cena (a legenda da
#: Crunchyroll diz quem fala, ver falas.py), o rosto pode ter menos certeza.
#: As duas provas são independentes — o rosto não sabe da legenda, e a
#: legenda não sabe do rosto. Sozinha a legenda nunca marca: quem fala pode
#: estar fora do quadro (no acervo do FAAH, só 64% a 87% das vezes ele está).
#: Olhado no Black Clover S02E05 e no Apothecary: até 0,16 quase tudo certo;
#: as duvidosas estavam acima disso ou com o CLIP discordando.
ACEITA_FALANDO = 0.16
#: Rosto + fala com o CLIP discordando: só com o rosto bem parecido.
ACEITA_FALANDO_SEM_CLIP = 0.14
#: Palpite (não marca, sugere na lista "Sem personagem"): o corte publicado
#: do CCIP. Nessa faixa ele ainda acerta a maioria, mas não o bastante pra
#: marcar sem alguém olhar.
PALPITE = 0.1784
#: Rostos por cena sem ninguém: os maiores.
ROSTOS_POR_CENA = 2
PAD = 0.25


@dataclass
class Palpite:
    shot_idx: int
    character_id: int
    diferenca: float


@dataclass
class Repescada:
    shot_id: int
    shot_idx: int
    character_id: int
    nome: str
    diferenca: float
    folga: float

    @property
    def score(self) -> float:
        """Confiança pro banco, na escala das outras (0..1, maior = melhor)."""
        return round(max(0.5, 1.0 - self.diferenca), 4)


def _ler(p: Path):
    try:
        return cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_COLOR)
    except OSError:
        return None


def _chave(n: str, b) -> str:
    return n + "|" + ",".join(str(int(v)) for v in b)


class _CacheCcip:
    """Vetores CCIP dos rostos de um episódio, guardados no próprio episódio."""

    def __init__(self, raiz: Path) -> None:
        self.arq = raiz / "metadata" / "ccip_rostos.npz"
        self.vet: dict[str, np.ndarray] = {}
        self.sujo = False
        try:
            with np.load(self.arq, allow_pickle=False) as z:
                chaves = json.loads(str(z["chaves"]))
                for k, v in zip(chaves, z["vetores"]):
                    self.vet[k] = v.astype(np.float32)
        except Exception:
            pass

    def salvar(self) -> None:
        if not self.sujo or not self.vet:
            return
        chaves = list(self.vet)
        tmp = self.arq.with_name("ccip_rostos.tmp.npz")
        try:
            np.savez(tmp, chaves=np.array(json.dumps(chaves)),
                     vetores=np.stack([self.vet[k] for k in chaves]).astype(np.float16))
            tmp.replace(self.arq)
            self.sujo = False
        except OSError:
            pass


@dataclass
class _Episodio:
    id: int
    raiz: Path
    shots: dict[int, int]                 # shot_id -> idx
    tags: dict[int, set[int]]             # shot_id -> {character_id}
    feats: dict[str, tuple[np.ndarray, np.ndarray]]
    tempos: dict[int, tuple[float, float]] | None = None   # shot_id -> (início, fim)
    fonte: str = ""

    def rostos(self, sid: int):
        out = []
        for k in range(3):
            n = f"{self.shots[sid]:04d}_{k}.jpg"
            if n in self.feats:
                for b, e in zip(*self.feats[n]):
                    out.append((n, b, e))
        return out


def _carregar_episodio(db, ep_id: int, raiz: Path) -> _Episodio | None:
    arq = raiz / "metadata" / "face_cache.npz"
    if not arq.is_file():
        return None
    feats: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    try:
        with np.load(arq, allow_pickle=False) as z:
            idx = json.loads(str(z["__meta__"]))["index"]
            for k, ent in idx.items():
                kb, ke = f"a{ent['id']}:boxes", f"a{ent['id']}:embs"
                if kb in z.files and ke in z.files:
                    b, e = z[kb], z[ke]
                    if len(b) and e.size and len(b) == len(e):
                        feats[Path(k).name] = (b, e.astype(np.float32))
    except Exception:
        return None
    with db.connect() as c:
        linhas = c.execute(
            "SELECT id, idx, start, end FROM shot WHERE episode_id=?", (ep_id,)).fetchall()
        shots = {int(r["id"]): int(r["idx"]) for r in linhas}
        tempos = {int(r["id"]): (float(r["start"] or 0), float(r["end"] or 0)) for r in linhas}
        tags: dict[int, set[int]] = defaultdict(set)
        for r in c.execute(
            "SELECT sc.shot_id, sc.character_id FROM shot_character sc "
            "JOIN shot s ON s.id = sc.shot_id WHERE s.episode_id=?", (ep_id,)
        ):
            tags[int(r["shot_id"])].add(int(r["character_id"]))
        fonte = c.execute("SELECT source_file FROM episode WHERE id=?", (ep_id,)).fetchone()
    return _Episodio(ep_id, raiz, shots, tags, feats, tempos, str(fonte[0] or "") if fonte else "")


class Repescador:
    """Um anime: o banco de rostos marcados, montado uma vez, e a repescagem
    episódio a episódio.

    O banco é o retrato de ANTES da repescagem: o que ela marca não entra
    nele, pra um engano não puxar outro.
    """

    def __init__(self, db, anime_id: int, ccip, motores: list | None = None, progresso=None) -> None:
        """`motores`: sessões do CCIP pra embedar em paralelo (a da análise
        tem três). `progresso(feitos, total)`: chamado da thread de quem
        chamou, enquanto os rostos são calculados."""
        from .embedding_engine import from_bytes

        self.db = db
        self.ccip = ccip
        self.motores = [m for m in (motores or []) if m is not None] or [ccip]
        self.progresso = progresso
        with db.connect() as c:
            rows = c.execute(
                "SELECT id, name, embedding FROM character "
                "WHERE anime_id=? AND embedding IS NOT NULL", (anime_id,),
            ).fetchall()
            eps = c.execute(
                "SELECT id, output_root FROM episode "
                "WHERE anime_id=? AND output_root IS NOT NULL", (anime_id,),
            ).fetchall()
        self.nomes: dict[int, str] = {}
        cent: dict[int, np.ndarray] = {}
        for r in rows:
            try:
                cent[int(r["id"])] = from_bytes(r["embedding"]).astype(np.float32)
                self.nomes[int(r["id"])] = str(r["name"])
            except Exception:
                continue
        self.raizes = {int(e["id"]): Path(str(e["output_root"])) for e in eps}

        # Banco: por personagem, a melhor face de cada cena marcada.
        # (ep_id, shot_id, keyframe, box, clip)
        self.candidatos: dict[int, list[tuple[int, int, str, np.ndarray, np.ndarray]]] = defaultdict(list)
        for ep_id, raiz in self.raizes.items():
            ep = _carregar_episodio(db, ep_id, raiz)
            if ep is None:
                continue
            for sid, cids in ep.tags.items():
                if sid not in ep.shots:
                    continue
                R = ep.rostos(sid)
                if not R:
                    continue
                for cid in cids:
                    ct = cent.get(cid)
                    if ct is None or ct.size != R[0][2].size:
                        continue
                    s = [float(e @ ct) for _, _, e in R]
                    j = int(np.argmax(s))
                    if s[j] >= NO_BANCO:
                        self.candidatos[cid].append((ep_id, sid, R[j][0], R[j][1], R[j][2]))
        self._caches: dict[int, _CacheCcip] = {}

    # --- vetores CCIP, com cache em disco ---

    def _cache(self, ep_id: int) -> _CacheCcip:
        if ep_id not in self._caches:
            self._caches[ep_id] = _CacheCcip(self.raizes[ep_id])
        return self._caches[ep_id]

    def _vetores(self, itens: list[tuple[int, str, np.ndarray]]) -> list[np.ndarray | None]:
        """CCIP de cada (ep_id, keyframe, box); lê só o que não está em cache."""
        from .face_detector import crops_from_boxes

        out: list[np.ndarray | None] = [None] * len(itens)
        faltam: list[tuple[int, np.ndarray]] = []
        imgs: dict[tuple[int, str], np.ndarray | None] = {}
        for i, (ep_id, n, b) in enumerate(itens):
            k = _chave(n, b)
            cache = self._cache(ep_id)
            if k in cache.vet:
                out[i] = cache.vet[k]
                continue
            if (ep_id, n) not in imgs:
                imgs[(ep_id, n)] = _ler(self.raizes[ep_id] / "keyframes" / n)
            img = imgs[(ep_id, n)]
            if img is None:
                continue
            cr, _ = crops_from_boxes(img, [tuple(int(v) for v in b)], PAD)
            if cr:
                faltam.append((i, cr[0]))
        if faltam:
            V = self._embed([cr for _, cr in faltam])
            for (i, _), v in zip(faltam, V):
                ep_id, n, b = itens[i]
                cache = self._cache(ep_id)
                cache.vet[_chave(n, b)] = v.astype(np.float32)
                cache.sujo = True
                out[i] = v
        return out

    def _embed(self, crops: list[np.ndarray]) -> list[np.ndarray]:
        """CCIP dos recortes, divididos entre as sessões, um rosto por vez.

        É a receita da análise (`_embed_em_paralelo` no pipeline): no
        processador, lote de 1 é o mais rápido (153 contra 240 ms/rosto no
        de 8, medido) e dá o MESMO vetor de qualquer lote. Antes isto era um
        lote de 8 numa sessão só, e era a "travadinha" dos 98%: 312 rostos,
        76 s, sem a tela mudar.

        O progresso é contado aqui, na thread de quem chamou, a cada meio
        segundo — o callback da análise só pode ser chamado dela.
        """
        import threading
        from concurrent.futures import ThreadPoolExecutor, wait

        total = len(crops)
        saida: list = [None] * total
        feitos = [0]
        trava = threading.Lock()
        grupos = [list(range(k, total, len(self.motores))) for k in range(len(self.motores))]

        def fazer(motor, ids):
            for j in range(0, len(ids), 4):
                parte = ids[j:j + 4]
                V = motor.embed([crops[x] for x in parte], batch=1)
                for x, v in zip(parte, V):
                    saida[x] = v
                with trava:
                    feitos[0] += len(parte)

        with ThreadPoolExecutor(max_workers=len(self.motores)) as pool:
            futuros = [pool.submit(fazer, m, g) for m, g in zip(self.motores, grupos) if g]
            while True:
                prontos, pendentes = wait(futuros, timeout=0.5)
                if self.progresso is not None:
                    self.progresso(feitos[0], total)
                if not pendentes:
                    break
            for f in futuros:
                f.result()  # erro de uma sessão sobe, como antes
        return saida

    def _banco(self, ep_id: int):
        """Banco pro episódio: até DO_EPISODIO rostos dele + DE_FORA de
        outros episódios, alternando entre eles (variedade de traço e luz)."""
        escolha: dict[int, list] = {}
        for cid, lst in self.candidatos.items():
            rnd = random.Random(cid)
            daqui = [x for x in lst if x[0] == ep_id]
            rnd.shuffle(daqui)
            por_ep: dict[int, list] = defaultdict(list)
            for x in lst:
                if x[0] != ep_id:
                    por_ep[x[0]].append(x)
            for v in por_ep.values():
                rnd.shuffle(v)
            fora: list = []
            while len(fora) < DE_FORA and any(por_ep.values()):
                for k in sorted(por_ep):
                    if por_ep[k] and len(fora) < DE_FORA:
                        fora.append(por_ep[k].pop())
            sel = daqui[:DO_EPISODIO] + fora
            if len(sel) >= 3:
                escolha[cid] = sel
        todos = [(cid, x) for cid, sel in escolha.items() for x in sel]
        vets = self._vetores([(x[0], x[2], x[3]) for _, x in todos])
        ccip_b: dict[int, np.ndarray] = {}
        clip_b: dict[int, np.ndarray] = {}
        for cid in escolha:
            par = [(v, x[4]) for (c, x), v in zip(todos, vets) if c == cid and v is not None]
            if len(par) >= 3:
                ccip_b[cid] = np.stack([p[0] for p in par]).astype(np.float32)
                clip_b[cid] = np.stack([p[1] for p in par]).astype(np.float32)
        return ccip_b, clip_b

    def _falantes(self, ep: _Episodio) -> dict[int, dict[int, float]]:
        """{cena: {quem fala nela: segundos de fala}} pela legenda do
        arquivo, se ela diz."""
        if not ep.fonte or not ep.tempos or not self.nomes:
            return {}
        try:
            from ..falas import falantes_por_cena, falas_do_episodio

            falas = falas_do_episodio(ep.fonte, ep.raiz)
            if not falas:
                return {}
            return falantes_por_cena(
                falas, [(sid, a, b) for sid, (a, b) in ep.tempos.items()], self.nomes)
        except Exception as e:  # noqa: BLE001 -- legenda é pista, não pode travar
            print(f"[repescagem] legenda nao lida: {e}", flush=True)
            return {}

    def repescar(
        self, ep_id: int, bloqueados: set[tuple[int, int]] | None = None
    ) -> tuple[list[Repescada], list[Palpite]]:
        """As cenas sem ninguém deste episódio: as que dá pra marcar, e o
        palpite pras que não dá. Não grava no banco — só o cache de vetores
        CCIP no disco.

        `bloqueados`: (idx da cena, character_id) que a pessoa tirou à mão —
        a repescagem não devolve (nem sugere) o que ela tirou.
        """
        bloqueados = bloqueados or set()
        if ep_id not in self.raizes:
            return [], []
        ep = _carregar_episodio(self.db, ep_id, self.raizes[ep_id])
        if ep is None:
            return [], []
        try:
            ccip_b, clip_b = self._banco(ep_id)
            if not ccip_b:
                return [], []
            cids = list(ccip_b)
            tudo = np.concatenate([ccip_b[c] for c in cids])
            dono = np.concatenate([[c] * len(ccip_b[c]) for c in cids])

            falantes = self._falantes(ep)
            alvos: list[tuple[int, str, np.ndarray, np.ndarray]] = []   # sid, keyframe, box, clip
            for sid in ep.shots:
                if ep.tags.get(sid):
                    continue
                R = sorted(ep.rostos(sid), key=lambda r: -(float(r[1][2]) * float(r[1][3])))
                for n, b, e in R[:ROSTOS_POR_CENA]:
                    alvos.append((sid, n, b, e))
            if not alvos and not falantes:
                return [], []
            vets = self._vetores([(ep_id, n, b) for _, n, b, _ in alvos])

            achadas: dict[tuple[int, int], Repescada] = {}
            palpites: dict[int, Palpite] = {}
            for (sid, n, b, f), v in zip(alvos, vets):
                if v is None:
                    continue
                d = self.ccip.diferencas(v[None], tudo)[0]
                sc = sorted(
                    (float(np.sort(d[dono == c])[:2].mean()), c) for c in cids
                    if (ep.shots[sid], c) not in bloqueados
                )
                if not sc:
                    continue
                s1, c1 = sc[0]
                s2 = sc[1][0] if len(sc) > 1 else 1.0
                falam = falantes.get(sid, {})
                if s1 <= PALPITE and (sid not in palpites or s1 < palpites[sid].diferenca):
                    palpites[sid] = Palpite(ep.shots[sid], c1, s1)
                # O palpite prefere quem está falando, se o rosto não descarta
                # essa pessoa (ela está entre as 3 mais parecidas e no corte).
                for s_f, c_f in sc[:3]:
                    if c_f in falam and c_f != c1 and s_f <= PALPITE and (
                        sid not in palpites or palpites[sid].character_id not in falam
                    ):
                        palpites[sid] = Palpite(ep.shots[sid], c_f, s_f)
                        break
                pelo_rosto = s1 <= ACEITA and s2 - s1 >= FOLGA
                # Rosto + fala já são duas provas que não sabem uma da outra:
                # aqui o CLIP não precisa ser a terceira.
                rosto_e_fala = c1 in falam and s1 <= ACEITA_FALANDO and s2 > s1
                if not (pelo_rosto or rosto_e_fala):
                    continue
                if CLIP_CONCORDA and f.size == clip_b[c1].shape[1]:
                    cl = max(
                        (float(np.sort(clip_b[c] @ f)[::-1][:3].mean()), c) for c in cids
                    )
                    if cl[1] != c1 and not (rosto_e_fala and s1 <= ACEITA_FALANDO_SEM_CLIP):
                        continue
                chave = (sid, c1)
                if chave not in achadas or s1 < achadas[chave].diferenca:
                    achadas[chave] = Repescada(sid, ep.shots[sid], c1, self.nomes[c1], s1, s2 - s1)
            # Cena SEM rosto em que alguém do elenco fala (de costas, plano
            # aberto, silhueta): a legenda vira palpite — quem fala mais tempo
            # nela. Nunca marca sozinha: quem fala pode estar fora do quadro.
            com_rosto = {sid for sid, *_ in alvos}
            for sid, falam in falantes.items():
                if sid in palpites or sid in com_rosto or ep.tags.get(sid) or sid not in ep.shots:
                    continue
                for cid, _seg in sorted(falam.items(), key=lambda x: -x[1]):
                    if (ep.shots[sid], cid) not in bloqueados and cid in self.nomes:
                        palpites[sid] = Palpite(ep.shots[sid], cid, 1.0)
                        break
            marcadas = {a.shot_id for a in achadas.values()}
            return (
                sorted(achadas.values(), key=lambda a: a.shot_idx),
                [p for sid, p in palpites.items() if sid not in marcadas],
            )
        finally:
            for c in self._caches.values():
                c.salvar()


def bloqueios(db, episode_id: int) -> set[tuple[int, int]]:
    return {
        (int(o["shot_idx"]), int(o["character_id"]))
        for o in db.manual_overrides(episode_id)
        if o["action"] == "block"
    }


def anime_do_episodio(db, episode_id: int) -> int | None:
    with db.connect() as c:
        r = c.execute("SELECT anime_id FROM episode WHERE id=?", (episode_id,)).fetchone()
    return int(r["anime_id"]) if r else None


def gravar(
    db, episode_id: int, achadas: list[Repescada], palpites: list[Palpite],
    organizar: bool = True,
) -> None:
    """Grava no banco e, com `organizar`, nas pastas `by_character/` e no
    `shots.json` (que é o que o Dangai lê). `organizar=False` é o caminho da
    análise, que monta pastas e json logo depois a partir do banco.

    Palpite não vai pra pasta nem pro json: é só sugestão até alguém aceitar.
    """
    db.gravar_sugestoes(
        episode_id, [(p.shot_idx, p.character_id, p.diferenca) for p in palpites]
    )
    for a in achadas:
        db.assign_character(a.shot_id, a.character_id, a.score)
    if not organizar or not achadas:
        return
    from ..storage.metadata_writer import atualizar_personagens_do_json
    from ..storage.organizer import organize_by_character, organize_by_pair

    with db.connect() as c:
        r = c.execute("SELECT output_root FROM episode WHERE id=?", (episode_id,)).fetchone()
        arquivos = {
            int(s["id"]): str(s["file"] or "")
            for s in c.execute("SELECT id, file FROM shot WHERE episode_id=?", (episode_id,))
        }
    if not r or not r["output_root"]:
        return
    raiz = Path(str(r["output_root"]))
    for a in achadas:
        arq = raiz / arquivos.get(a.shot_id, "")
        if arq.is_file():
            nomes = [str(x["name"]) for x in db.characters_in_shot(a.shot_id)]
            organize_by_character(arq, raiz, [a.nome])
            if len(nomes) > 1:
                organize_by_pair(arq, raiz, nomes)
    atualizar_personagens_do_json(db, episode_id)
