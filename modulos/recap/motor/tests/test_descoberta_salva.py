"""[recap] O1/O2: a descoberta gravada no disco (descoberta_salva.py).

- gravar -> ler -> evento: o mesmo discovery-ready de sempre, com o caminho
  do arquivo (`saved`) e a assinatura do corte (sha1 do shot_bounds.json);
- para_resultado (o commit lendo do disco, sem o processo da descoberta):
  as cenas voltam ao banco, os recortes do disco e os centroides do npy
  EXATAMENTE iguais aos de antes;
- usada() tira a descoberta de cena; somar_batismo() conta os commits (a
  descoberta gravada antes de um batismo fica velha).

Sem rede, sem GPU, sem torch. Rodar da pasta do motor:
    python -m unittest discover -s tests -p "test_descoberta_salva.py"
"""
from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np

from app import descoberta_salva as ds
from app.pipeline_types import DiscoveredGroup, DiscoveryResult, DiscoveryShot
from app.storage.db import Database


def _disc(root: Path) -> DiscoveryResult:
    (root / "metadata").mkdir(parents=True)
    (root / "shots").mkdir()
    (root / "keyframes").mkdir()
    (root / "metadata" / "shot_bounds.json").write_text(json.dumps({"shots": [[0, 1.5], [1.5, 4.0], [4.0, 6.0]]}), encoding="utf-8")
    shots = []
    for i in range(3):
        f = root / "shots" / f"shot_{i:04d}.mp4"
        f.write_bytes(b"mp4")
        kfs = [root / "keyframes" / f"shot_{i:04d}_{k}.jpg" for k in range(3)]
        for k in kfs:
            k.write_bytes(b"jpg")
        shots.append(DiscoveryShot(pos=i, shot_id=100 + i, idx=i, file=str(f), keyframes=[str(k) for k in kfs],
                                   start=float(i * 2), end=float(i * 2 + 1.5)))
    rng = np.random.default_rng(7)
    grupos = []
    for key in range(2):
        cent = rng.standard_normal(768).astype(np.float32)
        grupos.append(DiscoveredGroup(
            key=key, n_faces=9 - key, n_shots=2, thumbs_jpg=[], ref_crops_jpg=[f"rosto{key}{j}".encode() for j in range(3)],
            shot_ids=[100, 101 + key], shot_positions=[0, 1 + key], shot_conf={0: 0.91, 1 + key: 0.88},
            centroid_bytes=ds.para_bytes(cent), suggested_name="Elle" if key == 0 else "", suggested_sim=0.93 if key == 0 else 0.0,
            known=key == 0, minor=False, suggestions=[("Elle", 0.93), ("Misa", 0.81)] if key == 0 else [],
        ))
    return DiscoveryResult(anime_title="Kashita Maryoku", season=1, episode=1, anime_id=1, episode_id=1, episode_root=root,
                           cache_id="al202250", shots=shots, groups=grupos, total_faces=17, online=True,
                           roster=["Elle", "Misa", "Lent"])


class TestDescobertaSalva(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="descoberta-"))
        self.root = self.dir / "Anime" / "S01E01"
        self.cache = self.dir / "cache"
        self.disc = _disc(self.root)

    def tearDown(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_gravar_ler_evento(self):
        caminho = ds.gravar(self.disc, self.cache, "C:/x/ep.mkv", "", anime_digitado="Magic Repo Man")
        self.assertTrue(caminho.exists())
        self.assertFalse((caminho.parent / "descoberta.json.tmp").exists(), "o temporario vira o arquivo")
        dados = ds.ler(self.root)
        self.assertIsNotNone(dados)
        sha = hashlib.sha1((self.root / "metadata" / "shot_bounds.json").read_bytes()).hexdigest()
        self.assertEqual(dados["assinaturaDoCorte"], sha)
        self.assertEqual(dados["animeDigitado"], "Magic Repo Man")
        self.assertEqual(dados["batismos"], 0)
        ev = ds.evento(dados)
        self.assertEqual(ev["type"], "discovery-ready")
        self.assertEqual(ev["saved"], str(caminho))
        self.assertEqual([g["key"] for g in ev["groups"]], [0, 1])
        self.assertEqual(ev["groups"][0]["suggestions"], [{"name": "Elle", "sim": 0.93}, {"name": "Misa", "sim": 0.81}])
        self.assertEqual(ev["groups"][0]["crops"][0], "metadata/discovery/g000_000.jpg")
        # So o formato de sempre sai no evento (as posicoes ficam no disco).
        self.assertNotIn("shotPositions", ev["groups"][0])
        # De outra versao: nao vale.
        dados["versao"] = 99
        caminho.write_text(json.dumps(dados), encoding="utf-8")
        self.assertIsNone(ds.ler(self.root))

    def test_commit_le_igual_do_disco(self):
        ds.gravar(self.disc, self.cache, "C:/x/ep.mkv")
        db = Database(self.dir / "banco.db")
        anime_id = db.upsert_anime(anilist_id=202250, mal_id=62922, title="Kashita Maryoku", title_english=None)
        res = ds.para_resultado(ds.ler(self.root), db, "al202250", anime_id, True, ["Elle", "Misa", "Lent"])
        self.assertEqual(len(res.shots), 3)
        self.assertEqual([s.idx for s in res.shots], [0, 1, 2])
        self.assertEqual(len(db.shots_for_episode(res.episode_id)), 3)
        for antes, depois in zip(self.disc.groups, res.groups):
            self.assertEqual(antes.key, depois.key)
            self.assertEqual(antes.ref_crops_jpg, depois.ref_crops_jpg)
            self.assertEqual(antes.shot_positions, depois.shot_positions)
            self.assertEqual(antes.shot_conf, depois.shot_conf)
            self.assertTrue(np.array_equal(ds.de_bytes(antes.centroid_bytes), ds.de_bytes(depois.centroid_bytes)))
            self.assertEqual((antes.known, antes.suggested_name), (depois.known, depois.suggested_name))
        # As cenas do grupo apontam para os ids NOVOS do banco.
        ids = {s.pos: s.shot_id for s in res.shots}
        self.assertEqual(res.groups[1].shot_ids, sorted({ids[0], ids[2]}))

    def test_elenco_escolhido_fica_na_descoberta(self):
        """A1: escolher o anime no "Buscar elenco" grava as sugestoes novas na
        descoberta: reabrindo, as teclas 1-9 continuam as do anime escolhido."""
        from app.elenco_escolhido import _gravar_na_descoberta

        ds.gravar(self.disc, self.cache, "C:/x/ep.mkv")
        antes = ds.ler(self.root)
        _gravar_na_descoberta(self.root, {"1": [{"nome": "Rinka", "sim": 0.9123}]}, ["Elle", "Misa", "Lent", "Rinka"])
        depois = ds.ler(self.root)
        self.assertEqual(depois["groups"][1]["suggestions"], [{"name": "Rinka", "sim": 0.9123}])
        self.assertEqual(depois["groups"][0]["suggestions"], antes["groups"][0]["suggestions"], "grupo sem sugestao nova fica")
        self.assertEqual(depois["roster"], ["Elle", "Misa", "Lent", "Rinka"])
        for campo in ("assinaturaDoCorte", "batismos", "online", "cacheId", "shots"):
            self.assertEqual(depois[campo], antes[campo])
        self.assertEqual(ds.evento(depois)["groups"][1]["suggestions"][0]["name"], "Rinka")

    def test_usada_e_batismos(self):
        ds.gravar(self.disc, self.cache, "C:/x/ep.mkv")
        self.assertEqual(ds.contador_de_batismos(self.cache), 0)
        ds.somar_batismo(self.cache)
        ds.somar_batismo(self.cache)
        self.assertEqual(ds.contador_de_batismos(self.cache), 2)
        ds.usada(self.root)
        self.assertIsNone(ds.ler(self.root))
        self.assertTrue((ds.pasta(self.root) / "descoberta.usada.json").exists())


if __name__ == "__main__":
    unittest.main()
