"""Leitura de EXIF: qual câmera fez a foto e em que horário."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime

from PIL import Image

EXTENSOES = {".jpg", ".jpeg"}

_TAG_MARCA = 0x010F
_TAG_MODELO = 0x0110
_TAG_DATA = 0x0132
_IFD_EXIF = 0x8769
_TAG_DATA_ORIGINAL = 0x9003
_TAG_SUBSEG_ORIGINAL = 0x9291
_TAG_SERIE = 0xA431

# Nomes de mercado mais conhecidos no Brasil
APELIDOS = {
    "Canon EOS 250D": "Canon SL3 (250D)",
    "Canon EOS Kiss X10": "Canon SL3 (250D)",
    "Canon EOS REBEL SL3": "Canon SL3 (250D)",
    "Canon EOS 2000D": "Canon T7 (2000D)",
    "Canon EOS Rebel T7": "Canon T7 (2000D)",
    "Canon EOS 1300D": "Canon T6 (1300D)",
    "Canon EOS Rebel T6": "Canon T6 (1300D)",
    "Canon EOS 700D": "Canon T5i (700D)",
    "Canon EOS REBEL T5i": "Canon T5i (700D)",
    "ZV-E10": "Sony ZV-E10",
    "ZV-E10M2": "Sony ZV-E10 II",
}


@dataclass
class InfoFoto:
    caminho: str
    camera: str        # identificador único: modelo + número de série
    nome_camera: str   # nome amigável para a tela
    data: datetime | None


def _texto(v) -> str:
    if isinstance(v, bytes):
        v = v.decode("utf-8", "ignore")
    return str(v or "").strip().strip("\x00").strip()


def ler_info(caminho: str) -> InfoFoto:
    try:
        with Image.open(caminho) as img:
            exif = img.getexif()
            sub = exif.get_ifd(_IFD_EXIF)
    except Exception:
        return InfoFoto(caminho, "desconhecida", "Câmera desconhecida", None)

    modelo = _texto(exif.get(_TAG_MODELO))
    marca = _texto(exif.get(_TAG_MARCA))
    serie = _texto(sub.get(_TAG_SERIE))
    nome = APELIDOS.get(modelo, modelo or "Câmera desconhecida")
    if marca and modelo and not modelo.lower().startswith(marca.split()[0].lower()) and nome == modelo:
        nome = f"{marca.split()[0].title()} {modelo}"
    camera = modelo or "desconhecida"
    if serie:
        camera += f" #{serie}"
        nome += f" (nº …{serie[-4:]})"

    data = None
    bruto = _texto(sub.get(_TAG_DATA_ORIGINAL) or exif.get(_TAG_DATA))
    if bruto:
        try:
            data = datetime.strptime(bruto[:19], "%Y:%m:%d %H:%M:%S")
            subseg = _texto(sub.get(_TAG_SUBSEG_ORIGINAL))
            if subseg.isdigit():
                data = data.replace(microsecond=int(subseg.ljust(6, "0")[:6]))
        except ValueError:
            data = None
    return InfoFoto(caminho, camera, nome, data)


def listar_jpegs(pasta: str, ignorar: str | None = None) -> list[str]:
    ignorar_abs = os.path.abspath(ignorar) if ignorar else None
    encontrados = []
    for raiz, dirs, arquivos in os.walk(pasta):
        if ignorar_abs:
            dirs[:] = [d for d in dirs if os.path.abspath(os.path.join(raiz, d)) != ignorar_abs]
        dirs.sort()
        for nome in sorted(arquivos):
            if nome.startswith("."):
                continue
            if os.path.splitext(nome)[1].lower() in EXTENSOES:
                encontrados.append(os.path.join(raiz, nome))
    return encontrados
