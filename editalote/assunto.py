"""Encontra as pessoas na foto (pele + centro da imagem) para medir a luz nelas e realçá-las.

Sem rede neural: a pele humana, de qualquer tom, cai numa faixa estreita de cor (Cb/Cr do
YCbCr). Junto com o peso do centro da foto (onde o fotógrafo põe o assunto), isso dá uma
máscara suave das pessoas — rosto, braços, colo — usada para:
  - medir a exposição pelas pessoas (e não pelo fundo escuro da festa);
  - clarear e dar destaque às pessoas e, mais de leve, ao cenário em volta.
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter

LADO = 320


def pele(rgb: np.ndarray) -> np.ndarray:
    """Probabilidade (0..1) de cada pixel ser pele. rgb 0..1, formato (..., 3)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 0.5 + (b - y) * 0.564
    cr = 0.5 + (r - y) * 0.713
    # faixa clássica da pele em Cb/Cr (escala 0..1), com borda suave
    d_cb = np.abs(cb - 0.40) / 0.085
    d_cr = np.abs(cr - 0.60) / 0.07
    p = np.clip(1.4 - np.sqrt(d_cb ** 2 + d_cr ** 2), 0.0, 1.0)
    # pele tem cor, mas não é cor viva: tira pedra/areia bege e vestido laranja
    mx, mn = rgb.max(axis=-1), rgb.min(axis=-1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    p *= np.clip((sat - 0.13) / 0.06, 0, 1) * np.clip((0.68 - sat) / 0.08, 0, 1)
    p *= np.clip((y - 0.04) / 0.06, 0, 1)            # nem preto puro
    p *= np.clip((0.97 - y) / 0.05, 0, 1)            # nem branco estourado
    p *= (r > g) & (g >= b * 0.85)                    # pele: R > G > B
    return p


def centro(altura: int, largura: int) -> np.ndarray:
    yy, xx = np.mgrid[0:altura, 0:largura]
    dy = (yy / max(altura - 1, 1) - 0.45) / 0.42       # um pouco acima do meio (rostos)
    dx = (xx / max(largura - 1, 1) - 0.5) / 0.38
    return np.exp(-(dx ** 2 + dy ** 2) * 1.2)


def mascara(img: Image.Image) -> tuple[np.ndarray, float]:
    """Máscara suave das pessoas (0..1, no tamanho reduzido) e quanto de pele foi achado (0..1)."""
    pequeno = img.convert("RGB")
    pequeno.thumbnail((LADO, LADO), Image.Resampling.BILINEAR)
    rgb = np.asarray(pequeno, dtype=np.float32) / 255.0
    c = centro(*rgb.shape[:2])
    p = pele(rgb) * (0.15 + 0.85 * c)
    quanto = float((p > 0.4).mean())
    # espalha da pele para a pessoa inteira (cabelo, roupa) e suaviza a borda
    m = Image.fromarray((np.clip(p, 0, 1) * 255).astype(np.uint8))
    lado = max(rgb.shape[:2])
    m = m.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(lado * 0.06))
    m = np.asarray(m, dtype=np.float32) / 255.0
    if m.max() > 0:
        m = m / max(m.max(), 0.35)
    # sempre um pouco do centro (assunto) e um pouquinho do cenário inteiro
    m = np.clip(np.maximum(m, 0.55 * c), 0.25, 1)
    return m, quanto


def luz_das_pessoas(rgb: np.ndarray) -> float | None:
    """Brilho (sRGB 0..1) da pele achada, mais peso no centro; None se não há gente visível."""
    if rgb.ndim == 2:
        return None
    p = pele(rgb) * (0.3 + 0.7 * centro(*rgb.shape[:2]))
    sel = p > 0.35
    if sel.mean() < 0.003:
        return None
    y = rgb[sel] @ np.array([0.2126, 0.7152, 0.0722])
    pesos = p[sel]
    ordem = np.argsort(y)
    acumulado = np.cumsum(pesos[ordem])
    return float(y[ordem][np.searchsorted(acumulado, acumulado[-1] / 2)])


def realcar(img: Image.Image, forca: float) -> Image.Image:
    """Clareia e destaca as pessoas (e, de leve, o cenário). forca 0..1."""
    if forca <= 0:
        return img
    m, _ = mascara(img)
    k = 0.55 * forca
    # clareia meios-tons e sombras sem estourar os brancos (gama), um pouco mais de vida na pele
    tabela = [int(round(255 * (i / 255) ** (1 / (1 + k)))) for i in range(256)]
    clara = img.point(tabela * 3)
    alfa = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8)).resize(img.size, Image.Resampling.BILINEAR)
    return Image.composite(clara, img, alfa)
