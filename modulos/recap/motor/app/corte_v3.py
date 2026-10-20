"""[recap] Corte v3 (a v3.1 do estudo corte-v3, 20/10/2026): o v2 + o que ganhou no hold-out.

O AdaptiveDetector decide os cortes como sempre; ``refinar_v3`` pos-processa
os cortes dele (como o ``refinar_cortes`` do v2, antes da curta-cola de 0,6 s).
Entra tudo do v2 (corte_v2.py) e mais:

1. **Fade so entre duas imagens** (F_fade): o escuro no meio do video so ganha
   o corte da saida quando separa duas imagens diferentes (a imagem de antes
   nao volta depois, e o quadro do escuro nao e o comeco da imagem de depois).
2. **2a chance pela cor** (C_seg): o candidato da 2a chance tambem vale com a
   cor (matiz x saturacao, 3 quadros antes x 3 depois) mudando >= 0,2, fora do
   escuro; a troca com o corte seguinte compara o maior dos dois (hist ou cor).
3. **Saida do branco** (D_branco): trecho branco liso de ate ~2 s entre duas
   imagens diferentes ganha o corte no 1o quadro com imagem.
4. **Nota aprendida** (A_tira / A_entra / A_troca): uma nota por quadro (cor,
   forma e "a imagem nao volta" da mini 32x18) tira o corte com nota muito
   baixa (z < -3,5), poe o candidato do detector com nota >= -1 onde nao ha
   corte a menos de 15 q, e troca UM corte mais fraco pelo candidato vizinho.

Travas (os 2 ceticos da rodada 1):
- **Piso**: nada tira corte com hd3 >= 0,45, em cartela (o mesmo fundo chapado
  dos dois lados) nem com escuro dos dois lados (a A_tira e a troca da 2a chance).
- **Flash**: candidato dentro de flash nao entra pela A_entra, pela A_troca nem
  pela 2a chance.
- **Borda**: candidato so a >= 15 q do quadro 0 e do fim.
- **Deslocado**: a A_tira que tiraria um corte com uma troca forte a <= 14 q
  (sem outro corte perto) poe o corte na troca; sem lugar, o corte fica.
Fora (mediram e nao ganharam no hold-out, ou poem erro novo): o veto pela
estrutura, a confirmacao pela cor (C_conf_e), a troca forte de cor (C_mover /
C_somar), o clarao longo, a fusao.

Sinais por quadro (do MESMO quadro reduzido da nota, no mesmo passe): nota,
luz e hist16 do v2 + ``hs`` (matiz 8 x saturacao 4 do 128x72, somando 1) +
``mini`` (o quadro em cinza 32x18, uint8). Ver ``sinais_v3``.
Os limiares em quadros sao para ~24 fps e escalam por ``round(x * fps / 24)``.
Medido (regua escalada pelo fps, total = 3 x graves + falsos + deslocados):
hold-out (Bleach TYBW 49, Blue Box S02E03, Cyberpunk Edgerunners S02E01)
v2 272 -> v3 119 (graves 21 -> 4); estudo (BC S02E03, MRM E02, Nia E01)
198 -> 136 (graves 17 -> 13).
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections.abc import Sequence

import numpy as np

from .corte_v2 import HIST_MUDA, SALTO_ENORME, SEGUNDA_FORTE, SEGUNDA_VEZES, _Cadeia, candidatos, dist, quadros

# ------------------------------------------------------------------ limiares (congelados no estudo)
#: 2a chance pela cor: a cor (hs3) que basta, e a luz minima dos dois lados.
COR_SEGUNDA = 0.20
COR_GUARDA_LUZ = 0.08
#: Fade: a imagem de antes volta depois (>= isso) = nao e fade; o quadro escuro
#: pertence a imagem de depois (>= isso) = nao e fade; desvio minimo da mini.
FADE_IGUAL = 0.75
FADE_PERTENCE = 0.60
FADE_SD = 2.5
#: Saida do branco: luz >= isso e desvio da mini < BRANCO_DESVIO; ate BRANCO_MAX q;
#: as duas imagens com correlacao <= BRANCO_NCC.
BRANCO_LUZ = 0.9
BRANCO_DESVIO = 20.0
BRANCO_NCC = 0.35
BRANCO_MAX = 48
#: A nota aprendida (regressao logistica do estudo): pesos e limiares.
PESO_COR = 5.3952
PESO_FORMA = 1.6146
PESO_NAO_VOLTA = 3.3736
VIES = -5.2046
TIRA_ABAIXO = -3.5
ENTRA_DESDE = -1.0
TROCA_MARGEM = 0.5
#: O piso: o corte que nada tira.
PISO_HD3 = 0.45
PISO_ESCURO = 0.10
PISO_CARTELA = 0.65
#: A troca perto do corte que a A_tira tiraria (deslocado).
DESLOC = 14
DESLOC_HD3 = 0.30
DESLOC_Z = 0.0


def sinais_v3(quadro):
    """[recap] luz, hist (os do v2, identicos ao ``_luz_e_hist``), hs e mini de um quadro.

    ``quadro`` e o quadro BGR JA reduzido para a nota (256x144 num video 1080p).
    hs = matiz (8 faixas) x saturacao (4 faixas) do mesmo 128x72 da luz, somando
    1 (float32, 32 valores: faixa = matiz * 4 + saturacao); mini = o quadro em
    cinza levado a 32x18 com INTER_AREA (uint8).
    """
    import cv2

    p = cv2.resize(quadro, (128, 72), interpolation=cv2.INTER_AREA)
    b = p[..., 0].astype(np.uint32)
    g = p[..., 1].astype(np.uint32)
    r = p[..., 2].astype(np.uint32)
    y = (77 * r + 150 * g + 29 * b) >> 8
    luz = float(y.mean()) / 255
    hist = (np.bincount((y >> 4).ravel(), minlength=16) / y.size).astype(np.float32)
    hsv = cv2.cvtColor(p, cv2.COLOR_BGR2HSV)
    k = ((hsv[..., 0].astype(np.int32) * 8) // 180) * 4 + (hsv[..., 1] >> 6)
    hs = (np.bincount(k.ravel(), minlength=32) / k.size).astype(np.float32)
    mini = cv2.resize(cv2.cvtColor(quadro, cv2.COLOR_BGR2GRAY), (32, 18), interpolation=cv2.INTER_AREA)
    return luz, hist, hs, mini


# ------------------------------------------------------------------ a mini em blocos (fade)
def _faixas(a, b):
    """Tira as faixas lisas (letterbox) que os dois quadros tem em comum."""
    h, w = a.shape
    top, bot, lef, rig = 0, h, 0, w
    while top < bot - 4 and a[top].std() < 3 and b[top].std() < 3:
        top += 1
    while bot > top + 4 and a[bot - 1].std() < 3 and b[bot - 1].std() < 3:
        bot -= 1
    while lef < rig - 6 and a[top:bot, lef].std() < 3 and b[top:bot, lef].std() < 3:
        lef += 1
    while rig > lef + 6 and a[top:bot, rig - 1].std() < 3 and b[top:bot, rig - 1].std() < 3:
        rig -= 1
    top, bot = (top + 1 if top else 0), (bot - 1 if bot < h else h)
    lef, rig = (lef + 1 if lef else 0), (rig - 1 if rig < w else w)
    return a[top:bot, lef:rig], b[top:bot, lef:rig]


def _correlacao(a, b, sd_min: float):
    a, b = _faixas(a.astype(np.float32), b.astype(np.float32))
    a = a - a.mean()
    b = b - b.mean()
    sa = float(np.sqrt((a * a).mean()))
    sb = float(np.sqrt((b * b).mean()))
    if sa < sd_min or sb < sd_min:
        return None
    return float((a * b).mean() / (sa * sb))


def _blocos(a, b, sd_min: float, nx: int = 4, ny: int = 3):
    """A mediana da correlacao bloco a bloco (4x3) de duas minis, ou None (lisas demais)."""
    a, b = _faixas(a.astype(np.float32), b.astype(np.float32))
    if a.std() < sd_min or b.std() < sd_min:
        return None
    h, w = a.shape
    ry = [j * h // ny for j in range(ny)]
    rx = [i * w // nx for i in range(nx)]
    cnt = np.add.reduceat(np.add.reduceat(np.ones_like(a), ry, axis=0), rx, axis=1)

    def soma(x):
        return np.add.reduceat(np.add.reduceat(x, ry, axis=0), rx, axis=1) / cnt

    ma, mb = soma(a), soma(b)
    va = soma(a * a) - ma * ma
    vb = soma(b * b) - mb * mb
    cab = soma(a * b) - ma * mb
    ok = (va >= 9.0) & (vb >= 9.0)
    if int(ok.sum()) < 6:
        return _correlacao(a, b, sd_min)
    return float(np.median(cab[ok] / np.sqrt(va[ok] * vb[ok])))


def _ncc(x, y) -> float:
    x = x - x.mean()
    y = y - y.mean()
    nx, ny = float(np.linalg.norm(x)), float(np.linalg.norm(y))
    if nx < 1.0 or ny < 1.0:
        return 0.0
    return float(x @ y) / (nx * ny)


def _desvio(mini) -> np.ndarray:
    """O desvio de cada mini (float32), em blocos de linhas (sem uma copia float do video inteiro)."""
    n = len(mini)
    m = np.asarray(mini).reshape(n, -1)
    out = np.empty(n, dtype=np.float32)
    for i in range(0, n, 4096):
        out[i:i + 4096] = m[i:i + 4096].astype(np.float32).std(axis=1)
    return out


def _brancos(mini, luz, desvio, fps: float) -> list[tuple[int, int]]:
    """[(a, b)]: trecho branco liso [a, b) de ate BRANCO_MAX q entre duas imagens diferentes."""
    n = len(mini)
    m = np.asarray(mini).reshape(n, -1)
    br = (np.asarray(luz) >= BRANCO_LUZ) & (desvio < BRANCO_DESVIO)
    out, i = [], 0
    bmax = quadros(BRANCO_MAX, fps)
    look = quadros(8, fps)
    while i < n:
        if not br[i]:
            i += 1
            continue
        j = i
        while j < n and br[j]:
            j += 1
        if i > 0 and j < n and j - i <= bmax:
            ia = next((x for x in range(i - 1, max(-1, i - 1 - look), -1) if desvio[x] >= BRANCO_DESVIO and luz[x] < 0.75), None)
            ib = next((x for x in range(j, min(n, j + look)) if desvio[x] >= BRANCO_DESVIO and luz[x] < 0.75), None)
            if ia is not None and ib is not None and _ncc(m[ia].astype(np.float32), m[ib].astype(np.float32)) <= BRANCO_NCC:
                out.append((i, j))
        i = j
    return out


def _inserir(cortes, t, a, b, minimo, n, tol=2):
    i = bisect_left(cortes, a - tol)
    if i < len(cortes) and cortes[i] <= b + tol:
        return cortes, False
    k = bisect_left(cortes, t)
    prv = cortes[k - 1] if k > 0 else 0
    nxt = cortes[k] if k < len(cortes) else n
    if t - prv < minimo or nxt - t < minimo:
        return cortes, False
    return cortes[:k] + [t] + cortes[k:], True


class _Nota:
    """A nota aprendida de cada quadro como inicio de plano (z: logit; > 0 = corte)."""

    def __init__(self, hs, mini, fps: float) -> None:
        n = len(hs)
        h = np.asarray(hs, dtype=np.float64).reshape(n, -1)
        h = h / np.maximum(h.sum(1, keepdims=True), 1e-9)
        self.cs = np.concatenate([np.zeros((1, h.shape[1])), np.cumsum(h, 0)])
        self.mini = np.asarray(mini).reshape(n, -1)
        self.n = n
        self.q2, self.q3, self.q8 = quadros(2, fps), quadros(3, fps), quadros(8, fps)
        self._mn: dict[int, np.ndarray] = {}
        self._z: dict[int, float] = {}

    def _linha(self, i: int) -> np.ndarray:
        # A mini sem a media e com norma 1, linha a linha (a mesma conta, por linha,
        # da matriz inteira: mean/norm ao longo da linha).
        v = self._mn.get(i)
        if v is None:
            m = self.mini[i:i + 1].astype(np.float32)
            m = m - m.mean(1, keepdims=True)
            v = (m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-6))[0]
            self._mn[i] = v
        return v

    def _corr(self, i: int, j: int) -> float:
        if not (0 <= i < self.n and 0 <= j < self.n):
            return 1.0
        return float(self._linha(i) @ self._linha(j))

    def cor(self, c: int) -> float:
        a0, a1, b0, b1 = max(0, c - self.q3), c, c, min(self.n, c + self.q3)
        if a1 <= a0 or b1 <= b0:
            return 0.0
        x = (self.cs[a1] - self.cs[a0]) / (a1 - a0)
        y = (self.cs[b1] - self.cs[b0]) / (b1 - b0)
        return float(np.abs(x - y).sum()) / 2

    def forma(self, c: int) -> float:
        return 1.0 - self._corr(c - 1, c) if c > 0 else 0.0

    def nao_volta(self, c: int) -> float:
        ks = range(c + self.q2, min(self.n, c + self.q8 + 1))
        if c <= 0 or not len(ks):
            return self.forma(c)
        return min(1.0 - self._corr(c - 1, k) for k in ks)

    def z(self, c: int) -> float:
        v = self._z.get(c)
        if v is None:
            v = PESO_COR * self.cor(c) + PESO_FORMA * self.forma(c) + PESO_NAO_VOLTA * self.nao_volta(c) + VIES
            self._z[c] = v
        return v


class _CadeiaV3(_Cadeia):
    def __init__(self, nota, luz, hist, hs, mini, fps: float, razao: float, piso: float) -> None:
        super().__init__(nota, luz, hist, fps, razao, piso)
        self.fps = float(fps)
        self.hs = np.asarray(hs, dtype=np.float32).reshape(self.n, -1)
        self.mini = np.asarray(mini)
        if not (len(self.hs) == len(self.mini) == self.n):
            raise ValueError("hs e mini com tamanhos diferentes da nota")
        self.sd = _desvio(self.mini)
        self.N = _Nota(self.hs, self.mini, fps)
        self.cand = candidatos(self.nota, razao, piso)
        self.flashes_cand = self.trechos_de_flash(self.cand)
        self._est: dict = {}
        self._hs3: dict[int, float] = {}

    # ---------------------------------------------------------- sinais
    def est(self, i: int, j: int, sd_min: float):
        if not (0 <= i < self.n and 0 <= j < self.n):
            return None
        k = (i, j, sd_min)
        if k not in self._est:
            self._est[k] = _blocos(self.mini[i], self.mini[j], sd_min)
        return self._est[k]

    def hs3(self, c: int) -> float:
        v = self._hs3.get(c)
        if v is None:
            antes = self.hs[max(0, c - self.raio): c]
            depois = self.hs[c: c + self.raio]
            v = dist(antes.mean(0), depois.mean(0)) if len(antes) and len(depois) else 0.0
            self._hs3[c] = v
        return v

    def luz_lados(self, c: int) -> float:
        a = self.luz[max(0, c - self.raio): c]
        b = self.luz[c: c + self.raio]
        return float(min(a.mean() if len(a) else 0.0, b.mean() if len(b) else 0.0))

    def em_flash(self, k: int) -> bool:
        return any(a <= k <= b for a, b in self.flashes_cand)

    def na_borda(self, k: int) -> bool:
        return k < self.minimo or self.n - k < self.minimo

    # ---------------------------------------------------------- o piso
    def protegido(self, c: int) -> bool:
        if self.hd3(c) >= PISO_HD3:
            return True
        r = self.raio
        a, b = self.luz[max(0, c - r):c], self.luz[c:c + r]
        if len(a) and len(b) and a.mean() < PISO_ESCURO and b.mean() < PISO_ESCURO:
            return True
        ha, hb = self.hist[max(0, c - r):c], self.hist[c:c + r]
        if len(ha) and len(hb):
            ma, mb = ha.mean(0), hb.mean(0)
            if int(ma.argmax()) == int(mb.argmax()) and min(ma.max(), mb.max()) >= PISO_CARTELA:
                return True
        return False

    # ---------------------------------------------------------- o deslocado
    def troca_perto(self, c: int, cortes) -> int | None:
        d = quadros(DESLOC, self.fps)
        melhor = None
        for k in self.cand[bisect_left(self.cand, c - d):bisect_right(self.cand, c + d)]:
            if k == c or self.em_flash(k) or self.na_borda(k):
                continue
            if self.hd3(k) < DESLOC_HD3 or self.N.z(k) < DESLOC_Z:
                continue
            if any(abs(x - k) <= d for x in cortes if x != c):
                continue
            if melhor is None or self.N.z(k) > self.N.z(melhor):
                melhor = k
        return melhor

    def tirar(self, c: int, cortes: list[int], motivo: str) -> list[int]:
        if self.protegido(c):
            self.motivos[c] = f"piso: fica ({motivo})"
            return cortes
        k = self.troca_perto(c, cortes)
        resto = [x for x in cortes if x != c]
        if k is None:
            self.motivos[c] = motivo
            return resto
        i = bisect_left(resto, k)
        a = resto[i - 1] if i > 0 else 0
        b = resto[i] if i < len(resto) else self.n
        if k - a >= self.minimo and b - k >= self.minimo:
            self.motivos[c] = f"{motivo}: vai para a troca {k}"
            self.motivos[k] = f"troca perto de {c} ({k - c:+d})"
            return resto[:i] + [k] + resto[i:]
        self.motivos[c] = f"desloc: fica ({motivo}; troca {k} sem lugar)"
        return cortes

    # ---------------------------------------------------------- 3. fade so entre duas imagens
    def _fade_vale(self, a: int, b: int) -> bool:
        pre, pos = a - 1, b
        igual = self.est(pre, pos, FADE_SD)
        if igual is not None and igual >= FADE_IGUAL:
            return False
        if self.sd[a] >= FADE_SD:
            com_pos = self.est(a, pos, FADE_SD)
            com_pre = self.est(pre, a, FADE_SD)
            if com_pos is not None and com_pos >= FADE_PERTENCE and (com_pre is None or com_pre < FADE_PERTENCE):
                return False
        return True

    def escuros(self):
        return [(a, b) for a, b in super().escuros() if a == 0 or b >= self.n or self._fade_vale(a, b)]

    # ---------------------------------------------------------- 4. 2a chance (cor, flash, borda, piso)
    def _aceita(self, k: int) -> bool:
        if self.hd3(k) >= SEGUNDA_FORTE:
            return True
        return self.hs3(k) >= COR_SEGUNDA and self.luz_lados(k) >= COR_GUARDA_LUZ

    def _peso(self, k: int) -> float:
        return max(self.hd3(k), self.hs3(k))

    def segunda_chance(self, cortes, tirados, cand, protegidos):
        final = sorted(cortes)
        n, minimo = self.n, self.minimo
        flashes = self.trechos_de_flash(cand)
        for r in sorted(tirados):
            i = bisect_left(final, r)
            prv = final[i - 1] if i > 0 else 0
            for k in cand[bisect_right(cand, r):]:
                if k >= r + minimo:
                    break
                if k - prv < minimo or any(a <= k <= b for a, b in flashes) or not self._aceita(k):
                    continue
                if self.em_flash(k) or self.na_borda(k):
                    continue
                j = bisect_right(final, k)
                nxt = final[j] if j < len(final) else n
                if nxt - k >= minimo:
                    if k not in final:
                        final.insert(j, k)
                        self.motivos[k] = f"2a chance de {r} (+{k - r})"
                    break
                nn = final[j + 1] if j + 1 < len(final) else n
                if (nxt not in protegidos and not self.protegido(nxt)
                        and self._peso(k) >= SEGUNDA_VEZES * self._peso(nxt) and nn - k >= minimo):
                    final = [x for x in final if x != nxt]
                    if k not in final:
                        final.insert(bisect_right(final, k), k)
                    self.motivos[k] = f"2a chance de {r} (+{k - r}), no lugar de {nxt}"
                    self.motivos[nxt] = f"trocado por {k}"
                    break
        return final

    # ---------------------------------------------------------- 6. a nota aprendida
    def aprendido(self, cortes):
        n, minimo = self.n, self.minimo
        fade = {c for c in cortes if self.motivos.get(c) == "fade-saida"}
        N = self.N
        final = sorted(cortes)
        for c in sorted(cortes):
            if c in fade or N.z(c) >= TIRA_ABAIXO or c not in final:
                continue
            final = self.tirar(c, final, f"tirado (z {N.z(c):.1f})")
        ja = set(final)
        cand = [k for k in self.cand if 0 < k < n and k not in ja and not self.na_borda(k) and not self.em_flash(k)]
        zs = {k: N.z(k) for k in cand}
        for k in sorted((k for k in cand if zs[k] >= ENTRA_DESDE), key=lambda k: -zs[k]):
            i0, i1 = bisect_left(final, k - minimo + 1), bisect_left(final, k + minimo)
            cam = final[i0:i1]
            if not cam:
                final.insert(i0, k)
                self.motivos[k] = f"entrou (z {zs[k]:.1f})"
                continue
            if len(cam) > 1 or any(c in fade or N.z(c) > zs[k] - TROCA_MARGEM for c in cam):
                continue
            for c in cam:
                self.motivos[c] = f"trocado por {k} (z {N.z(c):.1f} < {zs[k]:.1f})"
            self.motivos[k] = f"entrou no lugar de {cam} (z {zs[k]:.1f})"
            final = final[:i0] + [k] + final[i1:]
        return self.colar(final)

    # ---------------------------------------------------------- 7. saida do branco
    def saida_do_branco(self, cortes):
        cortes = sorted(cortes)
        for a, b in _brancos(self.mini, self.luz, self.sd, self.fps):
            cortes, novo = _inserir(cortes, b, a, b, self.minimo, self.n)
            if novo:
                self.motivos[b] = f"saida do branco {a}-{b}"
        return cortes


def refinar_v3(
    nota: Sequence[float] | np.ndarray,
    luz: Sequence[float] | np.ndarray,
    hist: Sequence[Sequence[float]] | np.ndarray,
    hs: Sequence[Sequence[float]] | np.ndarray,
    mini: np.ndarray,
    cortes: Sequence[int],
    fps: float,
    razao: float = 2.0,
    piso: float = 15.0,
    motivos: dict[int, str] | None = None,
) -> list[int]:
    """Os cortes v3 (indices de quadro, sem o 0) a partir dos cortes do AdaptiveDetector.

    ``nota``, ``luz``, ``hist``, ``hs`` e ``mini`` tem um valor por quadro
    decodificado, na ordem (``sinais_v3``); ``cortes`` sao os indices onde o
    AdaptiveDetector comecou cena nova. Funcao pura.
    """
    cad = _CadeiaV3(nota, luz, hist, hs, mini, fps, razao, piso)
    base = sorted({int(c) for c in cortes if 0 < int(c) < cad.n})
    sem_flash = cad.flash(base)
    confirmados = cad.luz_confirma(sem_flash)
    tirados = sorted(set(base) - set(confirmados))
    com_fade, fades = cad.fade_na_saida(confirmados, cad.trechos_de_flash(base))
    for b in fades:
        cad.motivos[b] = "fade-saida"
    final = cad.segunda_chance(com_fade, tirados, cad.cand, set(fades))
    final = cad.colar(final)
    final = cad.aprendido(final)
    final = cad.saida_do_branco(final)
    if motivos is not None:
        motivos.update(cad.motivos)
    return final
