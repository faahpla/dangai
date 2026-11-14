"""[recap] A CONTINUIDADE (13/11/2026): tira do corte v3 o corte no meio de um plano que continua.

"olha a cena 232 e 231, sao a mesma mas o app dividiu e ficou dificil de usar". No
The Apothecary Diaries S03E07, 10 dos 400 cortes do v3 caiam no meio de um plano: a
camera descendo das maos para o balde, a Maomao virando, o homem caindo para tras,
a chuva de moedas, a roupa vermelha passando na frente. O v3 nao ve continuidade:
os sinais dele (cor, forma, "a imagem nao volta") so olham a mini 32x18 e o
histograma, e nesses casos a cor e a forma MUDAM.

O que separa: o FUNDO que continua. Para cada corte FRACO do v3 (fora do piso e com
a nota aprendida baixa), o video e lido em volta dele (224x126) e o fluxo otico
(DIS) do quadro de antes para os de depois diz quanto dos pixels COM TEXTURA ele
explica, com o contraste igualado (cena escura nao "casa" por ser lisa). Explicou
>= CONTINUA_DESDE do quadro de depois (do 3o antes para o 2o, 5o e 8o depois: o que
passou na frente ja saiu): e o mesmo plano, o corte sai.

Medido (regua do estudo corte-v3, escalada pelo fps; total = 3 x graves + falsos +
deslocados): estudo (BC S02E03, MRM E02, Nia E01) 136 -> 124; hold-out (Bleach
TYBW 49, Blue Box S02E03, Cyber S02E01) 119 -> 110; soma 255 -> 234, falsos
141 -> 110, graves 17 -> 22. Apotecaria S03E07: 6 dos 10 falsos saem, nenhum
verdadeiro dos 12 conferidos. Os limiares sao os do estudo (_capturas/corte-v3/cont).

Tudo e melhor esforco: video que nao abre, quadro que nao encaixa na mini do passe
(o seek do ffmpeg caiu longe) ou qualquer erro = o corte FICA.
"""
from __future__ import annotations

import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor

import numpy as np

#: A nota aprendida do v3 (z) abaixo disto e o piso desligado: so corte fraco e olhado.
Z_MAX = 1.0
#: Fracao dos pixels com textura explicada pelo fluxo para o corte sair.
CONTINUA_DESDE = 0.55
#: O quadro precisa de contraste (desvio da luma /255) e nao estourado no branco.
DESVIO_MIN = 0.06
LUZ_MAX = 0.92
#: Leitura em volta do corte: 224x126 (o tamanho das miniaturas do estudo).
LARG, ALT = 224, 126
#: Quadros lidos (de c-12 a c+19) e o maior erro medio (0-255) da mini para aceitar o encaixe.
JANELA_ANTES, JANELA = 12, 32
ENCAIXE_MAX = 8.0
DESLOC_MAX = 6
#: Leituras ao mesmo tempo.
PARALELO = 4


def _cv2():
    import cv2

    return cv2


def _mini(q, cv2):
    """A mini 32x18 do passe (sinais_v3: 256x144 LINEAR -> 32x18 AREA, em cinza)."""
    g = cv2.cvtColor(q, cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, (256, 144), interpolation=cv2.INTER_LINEAR)
    return cv2.resize(g, (32, 18), interpolation=cv2.INTER_AREA).astype(np.float32)


def _ler(ffmpeg: str, video: str, t: float, q0: int, mini: np.ndarray) -> dict[int, np.ndarray] | None:
    """Os quadros de q0 em diante (pelo tempo t), ENCAIXADOS pela mini do passe: o
    seek do ffmpeg pode cair um ou dois quadros fora; o corte dentro da janela ancora."""
    cv2 = _cv2()
    cmd = [ffmpeg, "-v", "error", "-ss", f"{max(t - 0.001, 0.0):.4f}", "-i", video, "-an", "-sn", "-dn",
           "-frames:v", str(JANELA), "-vf", f"scale={LARG}:{ALT}", "-pix_fmt", "bgr24", "-f", "rawvideo", "-"]
    r = subprocess.run(cmd, capture_output=True, timeout=60)
    n = len(r.stdout) // (LARG * ALT * 3)
    if n < 8:
        return None
    fr = np.frombuffer(r.stdout[: n * LARG * ALT * 3], np.uint8).reshape(n, ALT, LARG, 3)
    ms = [_mini(f, cv2) for f in fr]
    melhor, desloc = None, 0
    for o in range(-DESLOC_MAX, DESLOC_MAX + 1):
        e, k = 0.0, 0
        for i, m in enumerate(ms):
            q = q0 + i + o
            if 0 <= q < len(mini):
                e += float(np.abs(m - mini[q]).mean())
                k += 1
        if k >= 8 and (melhor is None or e / k < melhor):
            melhor, desloc = e / k, o
    if melhor is None or melhor > ENCAIXE_MAX:
        return None
    return {q0 + i + desloc: f for i, f in enumerate(fr)}


_DIS = None


def _cinza(q, cv2):
    return cv2.resize(cv2.cvtColor(q, cv2.COLOR_BGR2GRAY), (112, 63), interpolation=cv2.INTER_AREA)


def _normal(g):
    g = g.astype(np.float32)
    s = g.std()
    return np.clip((g - g.mean()) / max(s, 4.0) * 40 + 128, 0, 255).astype(np.uint8)


def _explicado(a, b, cv2) -> float:
    """Fracao dos pixels com textura de b que o fluxo a->b explica (residuo < 14/255), sem 6 px de borda."""
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    fl = dis.calc(b, a, None)
    h, w = a.shape
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    puxado = cv2.remap(a, gx + fl[..., 0], gy + fl[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    g = cv2.magnitude(cv2.Sobel(b, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(b, cv2.CV_32F, 0, 1, ksize=3))
    m = (slice(6, -6), slice(6, -6))
    t = (g > 40)[m]
    if t.sum() < 50:
        return 0.0
    r = np.abs(b.astype(np.float32) - puxado)[m]
    return float((r[t] < 14).mean())


def continua(quadros: dict[int, np.ndarray], c: int) -> bool:
    """O corte c (entre c-1 e c) cai no meio de um plano que continua."""
    cv2 = _cv2()
    precisa = [c - 3, c - 1, c, c + 2, c + 5, c + 8]
    if any(q not in quadros for q in precisa):
        return False
    a = _cinza(quadros[c - 1], cv2)
    b = _cinza(quadros[c], cv2)
    if min(a.std(), b.std()) / 255 < DESVIO_MIN or min(a.mean(), b.mean()) / 255 > LUZ_MAX:
        return False
    a3 = _normal(_cinza(quadros[c - 3], cv2))
    e3 = max(_explicado(a3, _normal(_cinza(quadros[c + k], cv2)), cv2) for k in (2, 5, 8))
    return e3 >= CONTINUA_DESDE


def tirar_continuos(video: str, cortes: list[int], segundos: list[float], fracos: list[int], mini: np.ndarray,
                    motivos: dict | None = None) -> list[int]:
    """Os `cortes` (indices de quadro) sem os `fracos` que caem num plano que continua.
    `segundos[i]` e o tempo do quadro i como o passe o leu (o PTS)."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or not fracos:
        return list(cortes)
    n = len(mini)

    def olhar(c: int) -> bool:
        try:
            q0 = max(c - JANELA_ANTES, 0)
            quadros = _ler(ffmpeg, video, float(segundos[q0]), q0, mini)
            return bool(quadros) and continua(quadros, c)
        except Exception:  # noqa: BLE001 -- melhor esforco: o corte fica
            return False

    alvo = [c for c in fracos if 15 <= c <= n - 15]
    with ThreadPoolExecutor(max_workers=PARALELO) as ex:
        saem = {c for c, sai in zip(alvo, ex.map(olhar, alvo)) if sai}
    if motivos is not None:
        for c in saem:
            motivos[c] = "continua: o fundo segue do outro lado (fluxo)"
    return [c for c in cortes if c not in saem]


def fracos_do_v3(nota, luz, hist, hs, mini, cortes: list[int], fps: float, razao: float, piso: float) -> list[int]:
    """Os cortes do v3 fora do piso e com a nota aprendida abaixo de Z_MAX: os unicos que a continuidade olha."""
    from .corte_v3 import _CadeiaV3

    cadeia = _CadeiaV3(nota, luz, hist, hs, mini, fps, razao, piso)
    return [c for c in cortes if not cadeia.protegido(c) and cadeia.N.z(c) < Z_MAX]
