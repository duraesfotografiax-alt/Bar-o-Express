"""Pastas na nuvem (OneDrive, Google Drive, Dropbox) e configuração do EditaLote.

O EditaLote não envia nada pela internet sozinho: ele grava numa pasta que o programa
da nuvem (OneDrive, Google Drive para computador, Dropbox) já sincroniza. Assim os presets
aparecem em todos os computadores do estúdio, e as fotos editadas podem ir direto para a
pasta de entrega.
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import string
import sys

ARQUIVO_CONFIG = "config.json"
SUBPASTA = "EditaLote"


def ler_config(raiz: str) -> dict:
    try:
        with open(os.path.join(raiz, ARQUIVO_CONFIG), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def salvar_config(raiz: str, config: dict) -> None:
    caminho = os.path.join(raiz, ARQUIVO_CONFIG)
    temporario = caminho + ".tmp"
    with open(temporario, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    os.replace(temporario, caminho)


def pasta_presets(raiz: str) -> str:
    """Pasta de presets em uso: a da nuvem, se configurada e acessível; senão a local."""
    escolhida = ler_config(raiz).get("pasta_presets")
    if escolhida and os.path.isdir(escolhida):
        return escolhida
    return os.path.join(raiz, "presets")


def detectar_nuvens() -> list[dict]:
    """Procura as pastas sincronizadas mais comuns neste computador."""
    candidatos: list[tuple[str, str]] = []
    casa = os.path.expanduser("~")
    for var, nome in (("OneDrive", "OneDrive"), ("OneDriveConsumer", "OneDrive"),
                      ("OneDriveCommercial", "OneDrive (empresa)")):
        if os.environ.get(var):
            candidatos.append((nome, os.environ[var]))
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
        base = os.path.basename(pasta)
        if base.startswith("GoogleDrive"):
            for sub in ("Meu Drive", "My Drive"):
                candidatos.append(("Google Drive", os.path.join(pasta, sub)))
        else:
            candidatos.append((base.split("-")[0], pasta))

    vistos, encontrados = set(), []
    for nome, caminho in candidatos:
        try:
            existe = os.path.isdir(caminho)
        except OSError:
            existe = False
        chave = os.path.normcase(os.path.abspath(caminho))
        if existe and chave not in vistos:
            vistos.add(chave)
            encontrados.append({"nome": nome, "caminho": caminho})
    return encontrados


def usar_nuvem_para_presets(raiz: str, pasta_nuvem: str | None) -> str:
    """Passa a guardar os presets em <nuvem>/EditaLote/presets (copiando os atuais).

    Com pasta_nuvem vazio, volta a usar a pasta local. Nunca apaga nem sobrescreve presets.
    """
    atual = pasta_presets(raiz)
    config = ler_config(raiz)
    if not pasta_nuvem:
        config.pop("pasta_presets", None)
        salvar_config(raiz, config)
        return pasta_presets(raiz)
    if not os.path.isdir(pasta_nuvem):
        raise ValueError("Pasta da nuvem não encontrada")
    destino = os.path.join(pasta_nuvem, SUBPASTA, "presets")
    os.makedirs(destino, exist_ok=True)
    if os.path.isdir(atual) and os.path.abspath(atual) != os.path.abspath(destino):
        for nome in os.listdir(atual):
            if nome.endswith(".json") and not os.path.exists(os.path.join(destino, nome)):
                shutil.copy2(os.path.join(atual, nome), os.path.join(destino, nome))
    config["pasta_presets"] = destino
    config["pasta_nuvem"] = pasta_nuvem
    salvar_config(raiz, config)
    return destino


def pasta_entrega(pasta_nuvem: str, nome_evento: str) -> str:
    nome = "".join("_" if c in '<>:"/\\|?*' else c for c in nome_evento).strip() or "Evento"
    return os.path.join(pasta_nuvem, SUBPASTA, "Entregas", nome)
