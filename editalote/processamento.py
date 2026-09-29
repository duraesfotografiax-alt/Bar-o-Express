"""Núcleo de edição de cor.

Todo o ajuste de cor (auto exposição, balanço de branco, contraste, sombras,
saturação, LUT .cube...) é convertido numa única tabela 3D (LUT de 65 pontos)
calculada em ponto flutuante. O Pillow aplica essa tabela em C, com
interpolação trilinear, sem passar a foto várias vezes por 8 bits. Resultado:
rápido (~1 s por foto de 24 MP) e sem perda acumulada de qualidade.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageFilter

from .lut_cube import LutCube

TAMANHO_LUT = 65  # máximo aceito pelo Pillow; quanto maior, mais precisa

# Pesos de luminância Rec.709 / sRGB
PESOS_Y = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)

AJUSTES_PADRAO: dict = {
    "nome": "Natural",
    "auto_exposicao": 0.5,       # 0 = desligado, 1 = corrige tudo
    "auto_balanco_branco": 0.4,  # 0 = desligado, 1 = neutro total
    "exposicao": 0.0,            # em EV (stops), -2..2
    "contraste": 0,              # -100..100
    "realces": 0,                # -100..100
    "sombras": 0,                # -100..100
    "brancos": 0,                # -100..0 (negativo "apaga" o branco estourado)
    "pretos": 0,                 # -100..100 (positivo = preto "lavado"/matte)
    "temperatura": 0,            # -100 (frio) .. 100 (quente)
    "matiz": 0,                  # -100 (verde) .. 100 (magenta)
    "saturacao": 0,              # -100..100
    "vibracao": 0,               # -100..100 (protege cores já saturadas)
    "nitidez": 0,                # 0..100
    "lut": None,                 # caminho de arquivo .cube
    "lut_intensidade": 100,      # 0..100
    "cameras": {},               # ajustes finos por câmera (ver ajustes_para_camera)
}

CAMPOS_POR_CAMERA = ("exposicao", "temperatura", "matiz", "saturacao")


def completar_ajustes(ajustes: dict | None) -> dict:
    final = dict(AJUSTES_PADRAO)
    if ajustes:
        final.update({k: v for k, v in ajustes.items() if v is not None or k == "lut"})
    return final


def ajustes_para_camera(ajustes: dict, camera: str | None) -> dict:
    """Soma os ajustes finos da câmera (ex.: Sony um pouco mais quente) ao preset."""
    extra = (ajustes.get("cameras") or {}).get(camera or "", {})
    if not extra:
        return ajustes
    final = dict(ajustes)
    for campo in CAMPOS_POR_CAMERA:
        if campo in extra:
            final[campo] = float(final.get(campo, 0)) + float(extra[campo] or 0)
    return final


# ---------------------------------------------------------------- cor básica

def srgb_para_linear(v: np.ndarray) -> np.ndarray:
    v = np.clip(v, 0.0, None)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def linear_para_srgb(v: np.ndarray) -> np.ndarray:
    v = np.clip(v, 0.0, None)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055)


def _suave(a: float, b: float, v: np.ndarray) -> np.ndarray:
    t = np.clip((v - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------- análise automática

@dataclass
class Analise:
    """Medições de uma foto usadas pelas correções automáticas e pelo relatório."""

    ganhos_bb: np.ndarray = field(default_factory=lambda: np.ones(3))
    ev_auto: float = 0.0
    nitidez: float = 0.0          # variância do Laplaciano (maior = mais nítida)
    luminancia_media: float = 0.0
    estourada: float = 0.0        # fração de pixels estourados


def carregar_reduzida(caminho: str, lado: int = 1000) -> Image.Image:
    """Abre o JPEG já reduzido (decodificação rápida por 'draft')."""
    img = Image.open(caminho)
    img.draft("RGB", (lado, lado))
    img = img.convert("RGB")
    img.thumbnail((lado, lado), Image.Resampling.BILINEAR)
    return img


def analisar(img: Image.Image) -> Analise:
    arr = np.asarray(img, dtype=np.float32) / np.float32(255.0)
    # tabela de 256 valores em vez de potência pixel a pixel (bem mais rápido)
    tabela_lin = srgb_para_linear(np.arange(256) / 255.0).astype(np.float32)
    lin = tabela_lin[np.asarray(img)]
    pesos = PESOS_Y.astype(np.float32)
    y_lin = lin @ pesos
    y_srgb = arr @ pesos
    maximo = arr.max(axis=2)

    # Balanço de branco "gray world" só nos tons médios não estourados.
    meios = (y_srgb > 0.12) & (y_srgb < 0.88) & (maximo < 0.97)
    if meios.sum() > 500:
        medias = lin[meios].mean(axis=0, dtype=np.float64)
        ganhos = medias[1] / np.maximum(medias, 1e-6)
        ganhos = np.clip(ganhos, 0.75, 1.33)
    else:
        ganhos = np.ones(3)

    # Exposição automática pela média logarítmica (como um fotômetro matricial).
    validos = maximo < 0.99
    base = y_lin[validos] if validos.sum() > 500 else y_lin.ravel()
    media_log = float(np.exp(np.mean(np.log(base + 1e-4), dtype=np.float64)))
    ev = float(np.log2(0.18 / max(media_log, 1e-4)))
    # zona de tolerância: foto até ~1/3 de stop do alvo fica como o fotógrafo fez
    ev = float(np.sign(ev) * max(0.0, abs(ev) - 0.3))
    ev = float(np.clip(ev, -1.0, 1.5))
    if ev > 0:
        # não empurra os realces (vestido de noiva!) além do branco
        p99 = float(np.percentile(y_lin, 99))
        if p99 > 1e-3:
            ev = min(ev, max(0.0, float(np.log2(1.15 / p99))))

    # Nitidez: variância do Laplaciano na imagem em cinza.
    cinza = y_srgb
    lap = (
        -4 * cinza[1:-1, 1:-1]
        + cinza[:-2, 1:-1] + cinza[2:, 1:-1]
        + cinza[1:-1, :-2] + cinza[1:-1, 2:]
    )
    return Analise(
        ganhos_bb=ganhos,
        ev_auto=ev,
        nitidez=float(lap.var(dtype=np.float64) * 1e4),
        luminancia_media=float(y_srgb.mean()),
        estourada=float((maximo >= 0.995).mean()),
    )


# ------------------------------------------------------------- transformação

def _ganhos_temperatura(temperatura: float, matiz: float) -> np.ndarray:
    t = temperatura / 100.0
    m = matiz / 100.0
    return np.array([2 ** (0.25 * t), 2 ** (-0.15 * m), 2 ** (-0.25 * t)])


def _normalizar_ganhos(g: np.ndarray) -> np.ndarray:
    return g / float(g @ PESOS_Y)


def transformar(rgb: np.ndarray, ajustes: dict, analise: Analise | None,
                lut: LutCube | None = None) -> np.ndarray:
    """Aplica todos os ajustes a um array (..., 3) de valores sRGB em 0..1."""
    a = ajustes
    ganhos = np.ones(3)
    ev = float(a.get("exposicao", 0.0))
    if analise is not None:
        forca_bb = float(a.get("auto_balanco_branco", 0))
        ganhos = ganhos * analise.ganhos_bb ** forca_bb
        ev += analise.ev_auto * float(a.get("auto_exposicao", 0))
    ganhos = ganhos * _ganhos_temperatura(float(a.get("temperatura", 0)),
                                          float(a.get("matiz", 0)))
    ganhos = _normalizar_ganhos(ganhos) * (2.0 ** ev)

    # 1) balanço de branco + exposição em luz linear (é como a física funciona)
    lin = srgb_para_linear(rgb) * ganhos
    v = linear_para_srgb(lin)

    # 2) compressão suave dos realces em vez de estourar
    vmax = float(linear_para_srgb(np.array([ganhos.max()]))[0])
    joelho = 0.85
    if vmax > 1.0:
        u = (v - joelho) / (1 - joelho)
        umax = (vmax - joelho) / (1 - joelho)
        c = (umax - 1) / umax
        comprimido = joelho + (1 - joelho) * u / (1 + c * np.maximum(u, 0))
        v = np.where(v > joelho, comprimido, v)
    v = np.clip(v, 0.0, 1.0)

    # 3) curva de tons (por canal, como a curva do Lightroom/Photoshop)
    sombras = float(a.get("sombras", 0)) / 100.0
    if sombras:
        bump = np.where(v < 0.5, 4 * v * (0.5 - v), 0.0)
        v = v + 0.4 * sombras * bump
    realces = float(a.get("realces", 0)) / 100.0
    if realces:
        bump = np.where(v > 0.5, 4 * (v - 0.5) * (1 - v), 0.0)
        v = v + 0.4 * realces * bump
    contraste = float(a.get("contraste", 0)) / 100.0
    if contraste:
        curva_s = v * v * (3 - 2 * v)
        v = v + 0.6 * contraste * (curva_s - v)
    pretos = float(a.get("pretos", 0)) / 100.0
    if pretos > 0:
        m = 0.12 * pretos
        v = m + v * (1 - m)
    elif pretos < 0:
        m = 0.06 * -pretos
        v = np.clip((v - m) / (1 - m), 0.0, 1.0)
    brancos = float(a.get("brancos", 0)) / 100.0
    if brancos < 0:
        v = v * (1 - 0.12 * -brancos)
    elif brancos > 0:
        v = np.clip(v / (1 - 0.06 * brancos), 0.0, 1.0)
    v = np.clip(v, 0.0, 1.0)

    # 4) saturação e vibração
    saturacao = float(a.get("saturacao", 0)) / 100.0
    vibracao = float(a.get("vibracao", 0)) / 100.0
    if saturacao or vibracao:
        y = (v @ PESOS_Y)[..., None]
        sat_atual = (v.max(axis=-1) - v.min(axis=-1))[..., None]
        fator = 1 + saturacao + vibracao * (1 - np.clip(sat_atual * 1.6, 0, 1))
        v = np.clip(y + (v - y) * fator, 0.0, 1.0)

    # 5) LUT criativa (.cube)
    if lut is not None:
        intensidade = float(a.get("lut_intensidade", 100)) / 100.0
        if intensidade > 0:
            v = v + (lut.aplicar(v) - v) * intensidade

    return np.clip(v, 0.0, 1.0)


def montar_lut(ajustes: dict, analise: Analise | None,
               lut: LutCube | None = None, tamanho: int = TAMANHO_LUT) -> ImageFilter.Color3DLUT:
    eixo = np.linspace(0.0, 1.0, tamanho)
    # Ordem do Pillow: vermelho varia mais rápido -> índices [b, g, r]
    b, g, r = np.meshgrid(eixo, eixo, eixo, indexing="ij")
    grade = np.stack([r, g, b], axis=-1)
    saida = transformar(grade, ajustes, analise, lut).astype(np.float32)
    return ImageFilter.Color3DLUT(tamanho, saida.reshape(-1), channels=3)


def aplicar(img: Image.Image, ajustes: dict, analise: Analise | None,
            lut: LutCube | None = None) -> Image.Image:
    if img.mode != "RGB":
        img = img.convert("RGB")
    saida = img.filter(montar_lut(ajustes, analise, lut))
    nitidez = float(ajustes.get("nitidez", 0))
    if nitidez > 0:
        # nitidez 3x3 (metade do custo de uma máscara de nitidez gaussiana)
        k = 0.25 * nitidez / 100.0
        saida = saida.filter(ImageFilter.Kernel((3, 3), [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0],
                                                scale=1))
    return saida


def carregar_lut(ajustes: dict) -> LutCube | None:
    caminho = ajustes.get("lut")
    return LutCube.abrir(caminho) if caminho else None


def previa_jpeg(caminho: str, ajustes: dict, lado: int = 1400) -> bytes:
    """Gera uma prévia reduzida já editada (mesma análise usada na exportação)."""
    from .metadados import ler_info

    ajustes = ajustes_para_camera(completar_ajustes(ajustes), ler_info(caminho).camera)
    reduzida = carregar_reduzida(caminho)
    analise = analisar(reduzida)
    reduzida.thumbnail((lado, lado), Image.Resampling.LANCZOS)
    editada = aplicar(reduzida, ajustes, analise, carregar_lut(ajustes))
    buf = io.BytesIO()
    editada.save(buf, "JPEG", quality=90)
    return buf.getvalue()
