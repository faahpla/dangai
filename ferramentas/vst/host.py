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
    janela     {caminho, estado?}                   -> igual, depois que ele FECHA a janela do plugin
    processar  {entrada, saida, plugins: [{caminho, estado?, parametros?}]} -> {ok: true}

Erro vira {erro: "..."} na resposta, e o codigo de saida e 1.
"""

from __future__ import annotations

import base64
import json
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


def janela(pedido: dict) -> dict:
    plugin = carregar(pedido)
    plugin.show_editor()
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
