"""Entrega na nuvem: acha as pastas do OneDrive, Google Drive e Dropbox deste computador.

O Durães APP não envia nada pela internet sozinho. Ele salva as fotos editadas numa pasta que o
programa da nuvem já sincroniza, e o próprio OneDrive/Google Drive/Dropbox faz o envio.
"""

from __future__ import annotations

import glob
import os
import string
import sys


def detectar_nuvens() -> list[dict]:
    """Procura as pastas sincronizadas mais comuns neste computador."""
    casa = os.path.expanduser("~")
    candidatos: list[tuple[str, str]] = []
    for var in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial"):
        if os.environ.get(var):
            candidatos.append(("OneDrive", os.environ[var]))
    candidatos.append(("OneDrive", os.path.join(casa, "OneDrive")))
    if sys.platform.startswith("win"):
        # Google Drive para computador cria uma unidade (normalmente G:) com "Meu Drive"
        for letra in string.ascii_uppercase[3:]:
            for pasta in ("Meu Drive", "My Drive"):
                candidatos.append(("Google Drive", f"{letra}:\\{pasta}"))
    for pasta in ("Google Drive", "Meu Drive", "My Drive"):
        candidatos.append(("Google Drive", os.path.join(casa, pasta)))
    candidatos.append(("Dropbox", os.path.join(casa, "Dropbox")))
    # Mac: ~/Library/CloudStorage/GoogleDrive-conta/Meu Drive, OneDrive-..., Dropbox
    for pasta in sorted(glob.glob(os.path.join(casa, "Library", "CloudStorage", "*"))):
        nome = os.path.basename(pasta)
        if nome.startswith("GoogleDrive"):
            candidatos += [("Google Drive", os.path.join(pasta, sub)) for sub in ("Meu Drive", "My Drive")]
        else:
            candidatos.append((nome.split("-")[0], pasta))

    vistos, encontrados = set(), []
    for nome, caminho in candidatos:
        chave = os.path.normcase(os.path.abspath(caminho))
        if chave not in vistos and os.path.isdir(caminho):
            vistos.add(chave)
            encontrados.append({"nome": nome, "caminho": caminho})
    return encontrados


def pasta_entrega(pasta_nuvem: str, nome_evento: str) -> str:
    """<nuvem>/Durães APP/Entregas/<evento>, com um nome de pasta válido no Windows."""
    nome = "".join("_" if c in '<>:"/\\|?*' else c for c in nome_evento).strip() or "Evento"
    return os.path.join(pasta_nuvem, "Durães APP", "Entregas", nome)
