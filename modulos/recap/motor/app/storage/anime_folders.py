"""Uma pasta por anime, mesmo quando o nome é digitado de outro jeito.

O problema é real e mensurável: no acervo do usuário havia **14 pastas para
cerca de 6 animes**. Tensura sozinho ocupava quatro — "Tensura", "Tensei
Shitara Slime Datta Ken", "That Time I Got Reincarnated as a Slime" e uma
quarta com sufixo de OAD. São o mesmo anime; o que muda é o que ele digitou
naquele dia, e o nome digitado é o que vira nome de pasta.

**Por que não adivinhar sozinho.** "Tensura" e "That Time I Got Reincarnated
as a Slime" não se parecem em nada como texto — nenhuma medida de
similaridade junta as duas. O que junta é a IDENTIDADE: as duas resolvem pra
mesma franquia. Só que a resolução acontece online, depois que a pasta já
precisou existir.

**Como isto resolve.** Duas memórias, ambas alimentadas no fim de cada
análise, quando os dois fatos já são conhecidos:

- `nomes`: nome digitado → pasta. Responde instantâneo e sem rede. Cobre o
  caso mais comum, que é o usuário repetir uma grafia que já usou.
- `franquias`: id da franquia → pasta. É o que faz "Tensura" de hoje cair na
  pasta de "That Time I Got Reincarnated as a Slime" de outro dia, assim que
  a resolução confirmar que são a mesma coisa.

E a decisão nunca é tomada em silêncio: quem escolhe é o usuário, uma vez,
e a escolha fica guardada. Adivinhar errado espalharia clipes por pastas
erradas, que é pior do que o problema.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .organizer import sanitize

# Tudo que não é letra, número ou espaço — mais o sublinhado, que o `\w`
# deixaria passar.
_PONTUACAO = re.compile(r"[^\w\s]|_", re.UNICODE)

# Marcador de temporada no FIM do nome, já sem pontuação e em minúsculas:
# "4th season", "season 2", "2nd cour", "part 2", "s3", "ii"/"iii".
# Só no fim, e um por vez, pra "Mushoku Tensei II" não perder o "II" que é
# parte de como ele nomeia as pastas.
_SUFIXO_TEMPORADA = re.compile(
    r"\s+(?:\d+(?:st|nd|rd|th)\s+(?:season|cour)"
    r"|(?:season|cour|part|parte)\s+\d+"
    r"|s\d{1,2}"
    r"|final\s+season)$",
    re.IGNORECASE,
)


def base_do_nome(typed: str) -> str:
    """A chave normalizada de um nome digitado. Mesma regra do
    `AnimeProvider._atalho_chave`: os dois leem o MESMO arquivo."""
    return re.sub(r"[^a-z0-9]+", " ", (typed or "").lower()).strip()


def resolver_franquia(dados: dict, typed: str, season: int) -> str:
    """A franquia deste nome, dentro do que o cache de buscas já respondeu.

    Só serve pra nome que ele já analisou antes — grafia inédita não tem
    resposta local, e aí não há o que fazer sem consultar a fonte.
    """
    if not isinstance(dados, dict):
        return ""
    base = base_do_nome(typed)
    if not base:
        return ""
    valor = dados.get(f"{base}|s{season}")
    if isinstance(valor, str) and valor:
        return valor
    # Sem a temporada exata, qualquer uma serve: a franquia é a mesma.
    por_base: dict[str, str] = {}
    for chave, v in dados.items():
        if isinstance(v, str) and v:
            por_base.setdefault(str(chave).split("|")[0], v)
    if base in por_base:
        return por_base[base]

    # Marcador de temporada no fim não muda a franquia.
    #
    # Os arquivos de fansub trazem isso o tempo todo — "Re Zero kara
    # Hajimeru Isekai Seikatsu 4th Season" é o mesmo anime que "Re Zero
    # kara Hajimeru Isekai Seikatsu", que é o que está guardado. Sem
    # aparar, toda temporada nova chega como anime desconhecido.
    aparado = base
    while True:
        novo = _SUFIXO_TEMPORADA.sub("", aparado).strip()
        if novo == aparado or not novo:
            break
        aparado = novo
        if aparado in por_base:
            return por_base[aparado]

    # Último recurso: SUBTÍTULO a mais (ou a menos).
    #
    # "Mushoku Tensei Jobless Reincarnation" é o mesmo anime que "Mushoku
    # Tensei", que é o que estava guardado — e sem esta regra ele chegava
    # como anime desconhecido: pasta nova, personagens zerados e nenhuma
    # sugestão de nome no batismo, tudo por causa de duas palavras a mais no
    # nome do arquivo. Um dos dois tem que ser o começo do outro, em palavra
    # inteira; entre vários, vence o mais específico.
    #
    # Só quando a fonte online não respondeu: com rede, a identidade de
    # verdade decide, e ela sempre vence este palpite.
    candidatos = [
        b for b in por_base
        # 5 caracteres é o piso que impede um prefixo curto e genérico
        # ("one", "re") de sequestrar franquia alheia.
        if len(b) >= 5 and (base.startswith(b + " ") or b.startswith(base + " "))
    ]
    if candidatos:
        return por_base[max(candidatos, key=len)]
    return ""


class AnimeFolderStore:
    """Arquivo em `<cache>/pastas_de_anime.json`."""

    def __init__(self, cache_root: Path | str) -> None:
        self.path = Path(cache_root) / "pastas_de_anime.json"

    # --- leitura/escrita cruas ---

    def _load(self) -> dict:
        if not self.path.exists():
            return {"nomes": {}, "franquias": {}}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {"nomes": {}, "franquias": {}}
        data.setdefault("nomes", {})
        data.setdefault("franquias", {})
        data["nomes"] = _rechavear(data["nomes"])
        return data

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    # --- consulta ---

    def folder_for_name(self, typed: str) -> str | None:
        """Pasta já combinada pra este nome digitado. Sem rede."""
        return self._load()["nomes"].get(_chave(typed))

    def folder_for_franchise(self, franchise_key: str) -> str | None:
        if not franchise_key:
            return None
        return self._load()["franquias"].get(str(franchise_key))

    def franchise_for_name(self, typed: str, season: int, cache_root: Path | str) -> str:
        """Franquia deste nome segundo o cache LOCAL de buscas. Sem rede.

        O `busca_resolvida.json` guarda o que a busca online já respondeu uma
        vez — exatamente o par que falta aqui: nome digitado → franquia. Ler
        dele é o que permite os modos offline ("Só cortar") saberem a
        identidade sem tocar na rede.
        """
        atalho = Path(cache_root) / "anime_db" / "busca_resolvida.json"
        try:
            dados = json.loads(atalho.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return ""
        return resolver_franquia(dados, typed, season)


    def decide(
        self, *, typed: str, explicit: str = "", franchise_key: str = ""
    ) -> str:
        """Em que pasta este episódio vai cair. Um lugar só, pros três modos.

        **A identidade vence o apelido.** Esta ordem já foi ao contrário, e
        custou caro: o nome digitado era consultado primeiro, então bastava
        uma análise gravar "Re Zero" como apelido pra que TODA análise
        seguinte fosse pra lá — inclusive as que sabiam perfeitamente que
        aquilo era a franquia `al21355`, já com pasta própria. O apelido é
        como ele chamou o anime num dia; a franquia é o que o anime É.

        A pasta digitada à mão continua acima das duas: é instrução direta
        dele, não memória minha.
        """
        if explicit:
            return sanitize(explicit)
        por_franquia = self.folder_for_franchise(franchise_key)
        if por_franquia:
            return por_franquia
        por_nome = self.folder_for_name(typed)
        if por_nome:
            return por_nome
        return sanitize(typed) if typed else "unknown"

    def remember(
        self, typed: str, folder: str, franchise_key: str = ""
    ) -> None:
        """Grava a escolha. O nome sempre; a franquia quando ela é conhecida.

        A pasta da franquia NÃO é sobrescrita depois de definida: se ela
        mudasse a cada análise, as temporadas voltariam a se espalhar — que
        é exatamente o que isto existe pra impedir.
        """
        if not typed or not folder:
            return
        data = self._load()
        data["nomes"][_chave(typed)] = folder
        if franchise_key:
            canonica = data["franquias"].setdefault(str(franchise_key), folder)
            # Apelido que discorda da franquia é apelido velho, de antes de a
            # identidade ser conhecida. Deixá-lo apontando pro lugar errado
            # faria ele vencer de novo em toda análise futura — foi assim que
            # "Re Zero" continuou puxando episódio pra fora da pasta certa
            # mesmo depois de a franquia estar sabida.
            if canonica != folder:
                data["nomes"][_chave(typed)] = canonica
        self._save(data)

    def repoint(self, de: str, para: str) -> int:
        """Toda memória que apontava pra pasta `de` passa a apontar pra `para`.

        Chamado depois de juntar duas pastas. Sem isto a junção duraria até a
        próxima análise: o apelido continuaria mandando pra pasta que acabou
        de sumir, e ela nasceria de novo — dando a impressão de que juntar não
        funciona.

        Mexe nas duas memórias. A da franquia é sobrescrita de propósito, ao
        contrário do `remember`: aqui a mudança de pasta é ordem explícita
        dele, não palpite meu.
        """
        if not de or not para or de == para:
            return 0
        data = self._load()
        n = 0
        for chave, pasta in list(data["nomes"].items()):
            if pasta == de:
                data["nomes"][chave] = para
                n += 1
        for chave, pasta in list(data["franquias"].items()):
            if pasta == de:
                data["franquias"][chave] = para
                n += 1
        if n:
            self._save(data)
        return n

    def forget(self, typed: str) -> None:
        data = self._load()
        if data["nomes"].pop(_chave(typed), None) is not None:
            self._save(data)


    # --- semeadura a partir do que já existe ---

    def seed_from_history(self, cache_root: Path | str, output_dir: Path | str) -> int:
        """Aproveita o histórico pra a memória já nascer cheia. Roda uma vez.

        Sem isto o agrupamento só valeria daqui pra frente, e as pastas que já
        estão espalhadas continuariam recebendo episódio novo. A matéria-prima
        é o atalho de busca (`cache/anime_db/busca_resolvida.json`), que guarda
        exatamente o par que interessa: **nome digitado → franquia**. As pastas
        de saída são os mesmos nomes digitados, então o cruzamento fecha sem
        rede nenhuma.

        Quando a mesma franquia tem várias pastas, ganha a que tem MAIS
        episódios dentro. É a que ele mais usa, e é o palpite que move menos
        coisa de lugar. Nada é movido de qualquer forma — a escolha só vale
        pros episódios seguintes.
        """
        data = self._load()
        if data.get("semeado"):
            return 0

        atalho = Path(cache_root) / "anime_db" / "busca_resolvida.json"
        try:
            resolvidas = json.loads(atalho.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            resolvidas = {}

        raiz = Path(output_dir)
        candidatas: dict[str, list[tuple[int, str]]] = {}
        nomes_da_franquia: dict[str, list[str]] = {}
        for chave, cache_id in resolvidas.items():
            digitado = str(chave).split("|")[0]
            nomes_da_franquia.setdefault(str(cache_id), []).append(digitado)
            pasta = _pasta_existente(raiz, digitado)
            if pasta is None:
                continue
            candidatas.setdefault(str(cache_id), []).append(
                (_conta_episodios(raiz / pasta), pasta)
            )

        gravadas = 0
        for cache_id, opcoes in candidatas.items():
            if cache_id in data["franquias"]:
                continue
            # O nome desempata, pra a escolha não depender da ordem do JSON.
            _, escolhida = max(opcoes, key=lambda o: (o[0], o[1]))
            data["franquias"][cache_id] = escolhida
            # TODAS as grafias da franquia passam a apontar pra pasta
            # escolhida. Mapear cada grafia pra pasta dela seria congelar a
            # bagunça: continuaria existindo uma pasta por jeito de escrever,
            # que é o problema. Nada é movido — os episódios que já estão em
            # cada pasta ficam onde estão; muda o destino dos próximos.
            for digitado in nomes_da_franquia.get(cache_id, []):
                data["nomes"][_chave(digitado)] = escolhida
            gravadas += 1

        data["semeado"] = True
        self._save(data)
        return gravadas


def _pasta_existente(raiz: Path, digitado: str) -> str | None:
    """A pasta de saída que corresponde a este nome digitado, se existir.

    Compara sem caixa: o nome vira pasta por `sanitize`, que não mexe em
    maiúsculas, mas o Windows não distingue as duas.
    """
    from .organizer import sanitize

    alvo = sanitize(digitado).lower()
    try:
        for p in raiz.iterdir():
            if p.is_dir() and p.name.lower() == alvo:
                return p.name
    except OSError:
        pass
    return None


def _conta_episodios(pasta: Path) -> int:
    try:
        return sum(1 for p in pasta.iterdir() if p.is_dir())
    except OSError:
        return 0


def _chave(nome: str) -> str:
    """Caixa, espaços e PONTUAÇÃO não distinguem um anime de outro.

    A pontuação entrou depois de custar caro. O mesmo anime chega com
    pontuação diferente conforme a origem do nome:

        "Mushoku Tensei III: Isekai Ittara Honki Dasu"   <- título da fonte
        "Mushoku Tensei III - Isekai Ittara Honki Dasu"  <- nome do arquivo

    Comparando só caixa e espaço, os dois são nomes diferentes — e o episódio
    foi parar numa pasta nova, sozinho. Pior: o acerto é gravado no fim da
    análise, então a pasta errada virava a escolha oficial e toda análise
    seguinte ia atrás dela.

    Trocar por espaço em vez de apagar é de propósito: "Fate/Zero" tem que
    virar "fate zero", e não "fatezero".
    """
    sem_pontuacao = _PONTUACAO.sub(" ", (nome or "").lower())
    return " ".join(sem_pontuacao.split())


def _rechavear(nomes: dict) -> dict:
    """Passa as chaves gravadas pela regra ATUAL, na leitura.

    Sem isto, a mudança do `_chave` seria uma amnésia: todo mapeamento
    gravado com a regra antiga (que guardava a pontuação) viraria inalcançável
    de uma vez, e cada anime voltaria a inventar pasta na análise seguinte.

    **Empate**: duas chaves velhas podem virar a mesma nova apontando pra
    pastas diferentes — é justamente o sintoma que a mudança conserta. Vence a
    PRIMEIRA, que é a mais antiga do arquivo: a pasta nova nasceu do erro, e a
    velha é a que tem os episódios.
    """
    saida: dict[str, str] = {}
    for nome, pasta in (nomes or {}).items():
        saida.setdefault(_chave(nome), pasta)
    return saida


def existing_folders(output_dir: Path | str) -> list[str]:
    """Pastas de anime que já existem na saída, em ordem alfabética.

    Serve pro campo de nome sugerir o que já está lá — o jeito mais barato
    de evitar a 15ª grafia é mostrar as 14 anteriores antes de digitar.
    """
    root = Path(output_dir)
    if not root.is_dir():
        return []
    try:
        return sorted(
            (p.name for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")),
            key=str.lower,
        )
    except OSError:
        return []
