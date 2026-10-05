"""Onde o Durães APP guarda as coisas.

No DuraesApp.exe, configurações, projetos, estilos treinados e presets do estúdio ficam em
%APPDATA%\\DuraesApp — fora da pasta do programa. Assim, atualizar (substituir a pasta do
programa pela versão nova) não apaga nada. Os presets que vêm com o programa são copiados para lá
a cada abertura (são atualizados junto com o programa).
"""

from __future__ import annotations

import logging
import os
import shutil
import sys

log = logging.getLogger("editalote")

CONGELADO = bool(getattr(sys, "frozen", False))
if CONGELADO:
    PROGRAMA = os.path.dirname(sys.executable)
    PASTA_ESTATICA = os.path.join(sys._MEIPASS, "editalote", "estatico")  # type: ignore[attr-defined]
    DADOS = os.environ.get("DURAES_DADOS") or os.path.join(
        os.environ.get("APPDATA") or os.path.expanduser("~"), "DuraesApp")
else:
    PROGRAMA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    PASTA_ESTATICA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "estatico")
    DADOS = PROGRAMA

PASTA_PRESETS = os.path.join(DADOS, "presets")
ARQUIVOS_DO_ESTUDIO = ("google_cliente.json", "google_token.json", "projetos.json", "album.json")


def preparar() -> None:
    """Cria a pasta de dados, traz o que estiver ao lado do programa (versões antigas) e
    atualiza os presets que vêm com o programa."""
    if os.path.normcase(os.path.abspath(DADOS)) == os.path.normcase(os.path.abspath(PROGRAMA)):
        return
    try:
        os.makedirs(PASTA_PRESETS, exist_ok=True)
        # versões antigas guardavam tudo ao lado do .exe: copia uma vez (se ainda não existe aqui)
        for nome in ARQUIVOS_DO_ESTUDIO:
            antigo, novo = os.path.join(PROGRAMA, nome), os.path.join(DADOS, nome)
            if os.path.isfile(antigo) and not os.path.exists(novo):
                shutil.copy2(antigo, novo)
                log.info("configuração trazida da pasta do programa: %s", nome)
        presets_programa = os.path.join(PROGRAMA, "presets")
        if os.path.isdir(presets_programa):
            for raiz, _, nomes in os.walk(presets_programa):
                rel = os.path.relpath(raiz, presets_programa)
                for nome in nomes:
                    if not nome.endswith(".json"):
                        continue
                    origem = os.path.join(raiz, nome)
                    destino = os.path.join(PASTA_PRESETS, rel, nome)
                    os.makedirs(os.path.dirname(destino), exist_ok=True)
                    # os que vêm com o programa (00-, 01-...) sempre na versão nova; os do
                    # estúdio (treinados, salvos) só se ainda não existem
                    if nome[:2].isdigit() and rel == "." or not os.path.exists(destino):
                        shutil.copy2(origem, destino)
    except OSError:
        log.exception("não consegui preparar a pasta de dados %s", DADOS)
