"""
Plugins VST3 para o Dangai (o Fresh Air, da Slate Digital, e qualquer outro).

Programa a parte, empacotado sozinho (ver build.ps1): o Dangai chama, ele
responde e fecha. Quem abre o plugin e o Pedalboard, do Spotify -- GPL-3, e por
isso este programa e GPL-3 tambem, com o codigo aqui no repositorio. O Dangai
so conversa com ele por arquivos; nada do Pedalboard entra no Dangai.

Entrada e saida por ARQUIVO JSON, e nao pelo console: o executavel e de janela
(sem console preto piscando) e, nesse modo, o stdout nao existe.

    vst-host <comando> <pedido.json> <resposta.json>

    listar     -> [{nome, fabricante, caminho}]
    descrever  {caminho, estado?}                   -> {nome, estado, parametros, textos}
    janela     {caminho, estado?, sinal?, titulo?, vivo?} -> igual, depois que a janela do plugin FECHA
                                                       (pelo X, ou quando o arquivo `sinal` aparece);
                                                       aberta, os botoes vao para o arquivo `vivo`
    processar  {entrada, saida, plugins: [{caminho, estado?, parametros?}]} -> {ok: true}

Erro vira {erro: "..."} na resposta, e o codigo de saida e 1.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import traceback


def carregar(pedido: dict):
    from pedalboard import load_plugin

    plugin = load_plugin(pedido["caminho"])
    estado = pedido.get("estado")
    if estado:
        plugin.raw_state = base64.b64decode(estado)
    else:
        for nome, valor in (pedido.get("parametros") or {}).items():
            if nome in plugin.parameters:
                plugin.parameters[nome].raw_value = float(valor)
    return plugin


# Botoes que nao sao som: ninguem quer ver "MIDI" e "Bypass" no painel.
ESCONDIDOS = {"bypass", "midi"}


def descrever(plugin) -> dict:
    parametros = {}
    textos = {}
    for nome, p in plugin.parameters.items():
        if nome in ESCONDIDOS:
            continue
        parametros[nome] = float(p.raw_value)
        # O texto que o proprio plugin mostra ("50 %", "-1.5 dB").
        textos[nome] = str(getattr(plugin, nome, p.raw_value))
    return {
        "nome": plugin.name,
        "estado": base64.b64encode(plugin.raw_state).decode("ascii"),
        "parametros": parametros,
        "textos": textos,
    }


def listar(_pedido: dict) -> list:
    from pedalboard import VST3Plugin, load_plugin

    achados = []
    for caminho in VST3Plugin.installed_plugins:
        try:
            p = load_plugin(caminho)
            if not p.is_effect:
                continue
            achados.append({"nome": p.name, "fabricante": p.manufacturer_name, "caminho": caminho})
        except Exception:
            # Plugin que nao abre (licenca, 32 bits, quebrado) nao derruba a lista.
            continue
    return achados


class JanelaNaTela:
    """
    A janela do plugin NA TELA e na frente. O Pedalboard abre a janela com a
    barra de titulo ACIMA do monitor (medido: topo em y=-31) -- sem o X a vista,
    "eu nao consigo fecha-lo, ele fica aberto ate eu finalizar o video". E o
    plugin se reposiciona sozinho logo depois de abrir, entao mover uma vez nao
    basta: `conferir` roda a cada 0,1 s enquanto a janela esta aberta e so mexe
    quando a barra de titulo esta fora da area util (quem arrasta a janela para
    outro lugar nao briga com ninguem).

    Tambem fica por cima do Dangai (que ocupa a tela toda) e ganha o nome do
    plugin no lugar de "Pedalboard".
    """

    def __init__(self, titulo: str) -> None:
        import ctypes
        from ctypes import wintypes

        self.ctypes = ctypes
        self.wintypes = wintypes
        self.user32 = ctypes.windll.user32
        self.titulo = titulo
        self.hwnd = None
        self.vezes = 0

        class MONITORINFO(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

        self.MONITORINFO = MONITORINFO
        u = self.user32
        u.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
        u.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
        u.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
        u.MonitorFromWindow.restype = wintypes.HMONITOR
        u.GetMonitorInfoW.argtypes = [wintypes.HMONITOR, ctypes.POINTER(MONITORINFO)]
        u.SetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPCWSTR]
        u.SetForegroundWindow.argtypes = [wintypes.HWND]

    def achar(self):
        ctypes, wintypes, u = self.ctypes, self.wintypes, self.user32
        pid = os.getpid()
        achadas = []

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def cada(hwnd, _):
            dono = wintypes.DWORD()
            u.GetWindowThreadProcessId(hwnd, ctypes.byref(dono))
            if dono.value == pid and u.IsWindowVisible(hwnd):
                achadas.append(hwnd)
            return True

        u.EnumWindows(cada, 0)
        return achadas[0] if achadas else None

    def conferir(self) -> None:
        ctypes, wintypes, u = self.ctypes, self.wintypes, self.user32
        if self.hwnd is None:
            self.hwnd = self.achar()
            if self.hwnd is None:
                return
            u.SetWindowTextW(self.hwnd, f"{self.titulo} - Dangai")
        janela = wintypes.RECT()
        u.GetWindowRect(self.hwnd, ctypes.byref(janela))
        info = self.MONITORINFO()
        info.cbSize = ctypes.sizeof(self.MONITORINFO)
        u.GetMonitorInfoW(u.MonitorFromWindow(self.hwnd, 2), ctypes.byref(info))  # 2 = o monitor mais perto
        util = info.rcWork
        # A barra de titulo (uns 30 px do topo) tem que estar dentro da area util.
        fora = janela.top < util.top or janela.top > util.bottom - 40 or janela.right < util.left + 80 or janela.left > util.right - 80
        if not fora and self.vezes > 0:
            return
        largura = janela.right - janela.left
        altura = janela.bottom - janela.top
        x = util.left + max(0, (util.right - util.left - largura) // 2)
        y = util.top + max(0, (util.bottom - util.top - altura) // 2)
        HWND_TOPMOST = wintypes.HWND(-1)
        SWP_NOSIZE, SWP_SHOWWINDOW = 0x0001, 0x0040
        u.SetWindowPos(self.hwnd, HWND_TOPMOST, x, y, 0, 0, SWP_NOSIZE | SWP_SHOWWINDOW)
        if self.vezes == 0:
            u.SetForegroundWindow(self.hwnd)
        self.vezes += 1


def janela(pedido: dict) -> dict:
    """
    A janela do plugin. Fecha pelo X (agora na tela, ver JanelaNaTela) ou quando
    o Dangai cria o arquivo `sinal` -- o botao "Fechar" dele, sair da etapa, fechar
    o Dangai. Nos dois casos o estado do plugin volta para o Dangai.
    """
    import threading
    import time

    plugin = carregar(pedido)
    fechar = threading.Event()
    sinal = pedido.get("sinal")
    vivo = pedido.get("vivo")
    na_tela = JanelaNaTela(pedido.get("titulo") or plugin.name)
    ultimos = {"parametros": None, "quando": 0.0}

    def ao_vivo() -> None:
        """
        OS BOTOES AO VIVO (v4): "to ativando o fresh air e colocando os presets mas
        nao vejo diferenca no audio quando dou play" -- o que ele mexia so chegava
        ao Dangai quando a janela fechava. Agora, a cada 0,3 s, os valores dos
        botoes vao para o arquivo `vivo` quando mudam, e o Dangai refaz o som com
        eles. So LE os parametros (um numero atomico em cada plugin); o estado
        inteiro volta ao fechar, como antes.
        """
        agora = time.monotonic()
        if not vivo or agora - ultimos["quando"] < 0.3:
            return
        ultimos["quando"] = agora
        atuais = {nome: float(p.raw_value) for nome, p in plugin.parameters.items() if nome not in ESCONDIDOS}
        if atuais == ultimos["parametros"]:
            return
        primeira = ultimos["parametros"] is None
        ultimos["parametros"] = atuais
        if primeira:
            return  # o valor de quando abriu: o Dangai ja tem
        parcial = vivo + ".part"
        with open(parcial, "w", encoding="utf-8") as f:
            json.dump(atuais, f)
        os.replace(parcial, vivo)

    def vigiar() -> None:
        while not fechar.is_set():
            try:
                ao_vivo()
            except Exception:
                pass  # ao vivo e conforto: o estado inteiro volta ao fechar
            try:
                na_tela.conferir()
            except Exception:
                if os.environ.get("DANGAI_VST_LOG"):
                    with open(os.environ["DANGAI_VST_LOG"], "a", encoding="utf-8") as f:
                        f.write(traceback.format_exc())
                # arrumar a janela e conforto; nao derruba o plugin
            if sinal and os.path.exists(sinal):
                fechar.set()
                return
            time.sleep(0.1)

    threading.Thread(target=vigiar, daemon=True).start()
    plugin.show_editor(fechar)
    fechar.set()
    return descrever(plugin)


def processar(pedido: dict) -> dict:
    from pedalboard import Pedalboard
    from pedalboard.io import AudioFile

    cadeia = Pedalboard([carregar(p) for p in pedido["plugins"]])
    with AudioFile(pedido["entrada"]) as f:
        taxa = f.samplerate
        audio = f.read(f.frames)
    saida = cadeia(audio, taxa)
    with AudioFile(pedido["saida"], "w", taxa, saida.shape[0], bit_depth=32) as f:
        f.write(saida)
    return {"ok": True}


def acelerar(pedido: dict) -> dict:
    """
    Acelera (ou desacelera) sem mudar o tom: o "Pitch Correction" do Change Clip
    Speed do DaVinci. Rubber Band R3 (high_quality) com os formantes preservados --
    medido na voz dele a 110/115/120%: a F0 mediana fica em 186 Hz como no original
    (o R2 do ffmpeg subia para 189).

    Desde a 1.100 o Dangai NAO chama mais este comando: o tom ficava certo, mas a
    voz saia robotica no Pronto, e a velocidade passou para o atempo do ffmpeg. Fica
    aqui porque o vst-host-2 publicado foi feito com ele (o codigo e o do binario).
    """
    from pedalboard import time_stretch
    from pedalboard.io import AudioFile

    fator = float(pedido["fator"])
    with AudioFile(pedido["entrada"]) as f:
        taxa = f.samplerate
        audio = f.read(f.frames)
    saida = time_stretch(audio, taxa, stretch_factor=fator, high_quality=True, preserve_formants=True)
    with AudioFile(pedido["saida"], "w", taxa, saida.shape[0], bit_depth=32) as f:
        f.write(saida)
    return {"ok": True, "quadros": int(saida.shape[1])}


COMANDOS = {
    "listar": listar,
    "descrever": lambda p: descrever(carregar(p)),
    "janela": janela,
    "processar": processar,
    "acelerar": acelerar,
}


def main(argv: list[str]) -> int:
    if len(argv) != 4 or argv[1] not in COMANDOS:
        return 2
    _, comando, entrada, resposta = argv
    try:
        with open(entrada, encoding="utf-8") as f:
            pedido = json.load(f)
        resultado = COMANDOS[comando](pedido)
        codigo = 0
    except Exception as e:
        resultado = {"erro": f"{type(e).__name__}: {e}", "detalhe": traceback.format_exc()[-2000:]}
        codigo = 1
    with open(resposta, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False)
    return codigo


if __name__ == "__main__":
    sys.exit(main(sys.argv))
