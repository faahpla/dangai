"""[recap] Corte v2: o que vem DEPOIS do AdaptiveDetector (a cadeia do aniFlow, ajustada).

O AdaptiveDetector (razao 2,0, piso 15, minimo de 15 quadros) continua decidindo
os cortes como sempre. Esta funcao so pos-processa a lista dele, com tres sinais
por quadro:

- ``nota``: a nota do proprio detector (a diferenca HSV do quadro 256x144 para o
  anterior, ContentDetector._calculate_frame_score);
- ``luz``: a luma media / 255 do quadro reduzido para 128x72, com luma =
  (77R + 150G + 29B) >> 8;
- ``hist``: o histograma dessa luma em 16 faixas (luma >> 4), somando 1.

Os passos, na ordem (medidos no Black Clover S02E03, no Magic Repo Man E02 e no
Nia Liston E01, quadro a quadro, em 19/10):

1. **Flash**: a luz se afasta >= 0,2 do quadro antes do corte nos 7 quadros
   seguintes e VOLTA (diferenca < 0,07, histograma < 0,18) DEPOIS do pico: tudo
   que caiu dentro sai. A regra do documento do aniFlow procurava a volta a
   partir do quadro seguinte ao corte, sem exigir o pico antes, e confundia "a
   luz ainda nao mudou" com "a luz voltou": 12 dos 23 cortes que ela tirava eram
   troca de camera de verdade.
2. **Luz**: o corte so fica com salto enorme (nota >= 38) ou com o histograma
   medio dos 3 quadros antes e dos 3 depois diferindo >= 0,06. Tira 82-94% de
   cortes falsos certos (movimento, efeito, o contador do MRM E02).
3. **Fade na saida do escuro**: trecho com luz < 0,035 no meio do video ganha o
   corte no 1o quadro com imagem (o corte que caiu na entrada do escuro muda para
   la). Fica fora do passo 2 (os dois lados do meio do preto tem o mesmo
   histograma) e de dentro de flash.
4. **2a chance**: o corte de hoje que a luz ou o flash tiraram costuma estar
   adiantado (a troca real vinha 3-14 quadros depois, travada pelo minimo de 15).
   O 1o candidato do proprio detector (razao >= 2 e nota >= piso, sem o minimo)
   nos 15 quadros seguintes, com histograma mudando >= 0,2 e fora de flash, vira o
   corte; se o corte seguinte estiver a menos de 15, so troca quando o novo for
   >= 2x mais forte.
5. **Colar**: trecho com menos de 15 quadros cola no anterior.

Sem dissolve: 34 dos 50 que a regra do aniFlow punha eram inventados (pan, tilt,
efeito crescendo).

Os limiares em quadros sao para ~24 fps e escalam por ``round(x * fps / 24)``.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections.abc import Sequence

import numpy as np

#: A luz se afasta isso (ou mais) do quadro antes do corte: pode ser flash.
FLASH_LUZ = 0.2
#: ...e volta para perto: diferenca de luz menor que isso...
FLASH_VOLTA_LUZ = 0.07
#: ...com o histograma parecido com o de antes (distancia menor que isso).
FLASH_VOLTA_HIST = 0.18
#: Nota (diferenca HSV) que passa sempre na confirmacao pela luz.
SALTO_ENORME = 38.0
#: Distancia minima entre o histograma de antes e o de depois do corte.
HIST_MUDA = 0.06
#: Luz media abaixo disso = quadro escuro (fade para o preto).
ESCURO = 0.035
#: Distancia de histograma minima para a 2a chance virar corte.
SEGUNDA_FORTE = 0.2
#: A 2a chance so tira o corte seguinte (a menos do minimo) se for isso vezes mais forte.
SEGUNDA_VEZES = 2.0


def quadros(x: float, fps: float) -> int:
    """Um limiar de ``x`` quadros a 24 fps, no fps do video."""
    return max(1, int(round(x * float(fps) / 24.0)))


def dist(a: np.ndarray, b: np.ndarray) -> float:
    """Distancia entre dois histogramas que somam 1: 0 (igual) a 1 (nada em comum)."""
    return float(np.abs(a - b).sum()) / 2


def candidatos(nota: np.ndarray, razao: float = 2.0, piso: float = 15.0, janela: int = 2) -> list[int]:
    """Todo quadro que o AdaptiveDetector cortaria se nao houvesse o minimo entre cortes.

    A mesma conta dele: a nota do quadro contra a media das ``janela`` notas de
    cada lado (sem a do proprio quadro), razao limitada a 255 e media zero com
    nota >= piso = 255.
    """
    n = len(nota)
    if n < 2 * janela + 1:
        return []
    soma = np.zeros(n - 2 * janela, dtype=np.float64)
    for k in range(-janela, janela + 1):
        if k == 0:
            continue
        soma = soma + nota[janela + k : n - janela + k]
    media = soma / (2.0 * janela)
    alvo = nota[janela : n - janela]
    zero = np.abs(media) < 0.00001
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.where(zero, np.where(alvo >= piso, 255.0, 0.0), np.minimum(alvo / np.where(zero, 1.0, media), 255.0))
    ok = (r >= razao) & (alvo >= piso)
    return [int(i) + janela for i in np.nonzero(ok)[0]]


class _Cadeia:
    def __init__(self, nota, luz, hist, fps: float, razao: float, piso: float) -> None:
        self.nota = np.asarray(nota, dtype=np.float64)
        self.luz = np.asarray(luz, dtype=np.float64)
        # float32 como o documento do aniFlow (bincount / tamanho .astype(float32)): as
        # medias e distancias saem nas mesmas contas, quadro a quadro.
        self.hist = np.asarray(hist, dtype=np.float32)
        self.n = len(self.nota)
        if not (len(self.luz) == len(self.hist) == self.n):
            raise ValueError("nota, luz e hist com tamanhos diferentes")
        self.minimo = quadros(15, fps)
        self.janela_flash = quadros(7, fps)
        self.raio = quadros(3, fps)
        self.q1, self.q2, self.q3 = quadros(1, fps), quadros(2, fps), quadros(3, fps)
        self.razao, self.piso = razao, piso
        self._hd: dict[int, float] = {}
        self.motivos: dict[int, str] = {}

    # ---------------------------------------------------------------- sinais
    def hd3(self, c: int) -> float:
        """Distancia entre o histograma medio dos ``raio`` quadros antes de c e o dos ``raio`` a partir de c."""
        v = self._hd.get(c)
        if v is None:
            antes = self.hist[max(0, c - self.raio) : c]
            depois = self.hist[c : c + self.raio]
            v = dist(np.mean(antes, axis=0), np.mean(depois, axis=0)) if len(antes) and len(depois) else 0.0
            self._hd[c] = v
        return v

    def _flash_de(self, c: int) -> int | None:
        """O ultimo quadro do flash que comeca em c (a luz volta depois do pico), ou None."""
        n, luz, hist, j = self.n, self.luz, self.hist, self.janela_flash
        if c < 2 or c + j + 1 >= n:
            return None
        antes = luz[c - 1]
        exc = np.abs(luz[c : c + j] - antes)
        kp = int(np.argmax(exc))
        if exc[kp] < FLASH_LUZ:
            return None
        for fim in range(c + kp + 1, c + j + 1):
            if abs(luz[fim] - antes) < FLASH_VOLTA_LUZ and dist(hist[c - 1], hist[fim]) < FLASH_VOLTA_HIST:
                return fim
        return None

    def trechos_de_flash(self, cortes: Sequence[int]) -> list[tuple[int, int]]:
        out = []
        for c in cortes:
            fim = self._flash_de(c)
            if fim is not None:
                out.append((c, fim))
        return out

    def escuros(self) -> list[tuple[int, int]]:
        """Trechos [a, b) com luz < ESCURO."""
        e = self.luz < ESCURO
        out, ini = [], -1
        for i in range(self.n + 1):
            esc = i < self.n and bool(e[i])
            if esc and ini < 0:
                ini = i
            if not esc and ini >= 0:
                out.append((ini, i))
                ini = -1
        return out

    # ---------------------------------------------------------------- passos
    def flash(self, cortes: list[int]) -> list[int]:
        fora: set[int] = set()
        for c, fim in self.trechos_de_flash(cortes):
            for x in cortes:
                if c <= x <= fim and x not in fora:
                    fora.add(x)
                    self.motivos.setdefault(x, f"flash {c}->{fim}")
        return [c for c in cortes if c not in fora]

    def luz_confirma(self, cortes: list[int]) -> list[int]:
        out = []
        for c in cortes:
            if self.nota[c] >= SALTO_ENORME or self.hd3(c) >= HIST_MUDA:
                out.append(c)
            else:
                self.motivos.setdefault(c, "luz")
        return out

    def fade_na_saida(self, cortes: list[int], flashes: list[tuple[int, int]]) -> tuple[list[int], list[int]]:
        cs = sorted(cortes)
        feitos: list[int] = []
        n, minimo = self.n, self.minimo
        for a, b in self.escuros():
            if a == 0 or b >= n:
                continue
            if any(x <= a <= y + self.q1 or x <= b <= y + self.q1 for x, y in flashes):
                continue
            i = bisect_left(cs, b - self.q1)
            if i < len(cs) and cs[i] <= b + self.q2:
                continue
            k = bisect_left(cs, b)
            h = cs[k - 1] if k > 0 else 0
            nx = cs[k] if k < len(cs) else n
            if nx - b < minimo:
                continue
            if k > 0 and h >= a - self.q3:
                hh = cs[k - 2] if k > 1 else 0
                if b - hh >= minimo:
                    del cs[k - 1]
                    cs.insert(k - 1, b)
                    feitos.append(b)
                    self.motivos[h] = f"fade: vai para {b}"
            elif b - h >= minimo:
                cs.insert(k, b)
                feitos.append(b)
        for b in feitos:
            self.motivos[b] = "fade-saida"
        return cs, feitos

    def segunda_chance(self, cortes: list[int], tirados: list[int], cand: list[int], protegidos: set[int]) -> list[int]:
        final = sorted(cortes)
        n, minimo = self.n, self.minimo
        flashes = self.trechos_de_flash(cand)
        for r in sorted(tirados):
            i = bisect_left(final, r)
            prv = final[i - 1] if i > 0 else 0
            for k in cand[bisect_right(cand, r):]:
                if k >= r + minimo:
                    break
                if k - prv < minimo or any(a <= k <= b for a, b in flashes) or self.hd3(k) < SEGUNDA_FORTE:
                    continue
                j = bisect_right(final, k)
                nxt = final[j] if j < len(final) else n
                if nxt - k >= minimo:
                    if k not in final:
                        final.insert(j, k)
                        self.motivos[k] = f"2a chance de {r} (+{k - r})"
                    break
                nn = final[j + 1] if j + 1 < len(final) else n
                if nxt not in protegidos and self.hd3(k) >= SEGUNDA_VEZES * self.hd3(nxt) and nn - k >= minimo:
                    final = [x for x in final if x != nxt]
                    if k not in final:
                        final.insert(bisect_right(final, k), k)
                    self.motivos[k] = f"2a chance de {r} (+{k - r}), no lugar de {nxt}"
                    self.motivos[nxt] = f"trocado por {k}"
                    break
        return final

    def colar(self, cortes: list[int]) -> list[int]:
        bordas = [0] + [c for c in sorted(cortes) if 0 < c < self.n] + [self.n]
        out: list[list[int]] = []
        for a, b in zip(bordas, bordas[1:]):
            if b - a < self.minimo and out:
                out[-1][1] = b
            else:
                out.append([a, b])
        return [a for a, _ in out[1:]]


def refinar_cortes(
    nota: Sequence[float] | np.ndarray,
    luz: Sequence[float] | np.ndarray,
    hist: Sequence[Sequence[float]] | np.ndarray,
    cortes: Sequence[int],
    fps: float,
    razao: float = 2.0,
    piso: float = 15.0,
    motivos: dict[int, str] | None = None,
) -> list[int]:
    """Os cortes v2 (indices de quadro, sem o 0) a partir dos cortes do AdaptiveDetector.

    ``nota``, ``luz`` e ``hist`` tem um valor por quadro decodificado, na ordem;
    ``cortes`` sao os indices onde o AdaptiveDetector comecou cena nova. Funcao
    pura: os mesmos numeros dao sempre os mesmos cortes. ``motivos`` (opcional)
    recebe o porque de cada corte que saiu, mudou ou entrou.
    """
    cad = _Cadeia(nota, luz, hist, fps, razao, piso)
    base = sorted({int(c) for c in cortes if 0 < int(c) < cad.n})
    sem_flash = cad.flash(base)
    confirmados = cad.luz_confirma(sem_flash)
    tirados = sorted(set(base) - set(confirmados))
    com_fade, fades = cad.fade_na_saida(confirmados, cad.trechos_de_flash(base))
    cand = candidatos(cad.nota, razao, piso)
    final = cad.colar(cad.segunda_chance(com_fade, tirados, cand, set(fades)))
    if motivos is not None:
        motivos.update(cad.motivos)
    return final
