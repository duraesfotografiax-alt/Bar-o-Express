"""Melhorar qualidade: tira o ruído (foto de festa com ISO alto) e realça os detalhes.

Mede o ruído da própria foto e decide quanto limpar:
  - ruído de cor (manchinhas coloridas no escuro): some quase todo, sem perder detalhe;
  - ruído de brilho (granulado): suavizado na medida do ruído medido;
  - nitidez nos detalhes com limiar, para afiar cílios/cabelo/tecido sem afiar o granulado.
Funciona igual na prévia e na foto final (tudo proporcional ao tamanho da foto).
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageChops, ImageFilter


def medir_ruido(img: Image.Image) -> float:
    """Desvio do ruído de brilho (0..255) medido nas áreas lisas da foto."""
    pequeno = img.convert("L")
    pequeno.thumbnail((1200, 1200), Image.Resampling.BOX)
    a = np.asarray(pequeno, dtype=np.float32)
    residuo = np.abs(a - np.asarray(pequeno.filter(ImageFilter.MedianFilter(3)), dtype=np.float32))
    return float(np.percentile(residuo, 50) * 2.4)   # calibrado: ruído gaussiano σ=7 mede ~7


def melhorar(img: Image.Image, forca: float) -> Image.Image:
    """forca 0..1."""
    if forca <= 0:
        return img
    escala = max(img.size) / 2000.0
    ruido = medir_ruido(img)
    y, cb, cr = img.convert("YCbCr").split()

    # 1) ruído de cor: desfoca só a cor (o olho não vê perda de detalhe na cor)
    raio_cor = max(0.6, (1.0 + 2.5 * forca) * escala)
    cb, cr = cb.filter(ImageFilter.GaussianBlur(raio_cor)), cr.filter(ImageFilter.GaussianBlur(raio_cor))

    # 2) ruído de brilho: mistura com uma versão limpa, na medida do ruído medido
    limpeza = float(np.clip((ruido - 1.0) / 5.0, 0.0, 0.7)) * forca
    if limpeza > 0.02:
        limpa = y.filter(ImageFilter.MedianFilter(3))
        if escala > 1.5:
            limpa = limpa.filter(ImageFilter.GaussianBlur(0.5 * escala))
        y = Image.blend(y, limpa, limpeza)

    # 3) nitidez nos detalhes: o limiar ignora variações do tamanho do ruído
    limiar = int(np.clip(ruido * 2.0, 2, 12))
    y = y.filter(ImageFilter.UnsharpMask(radius=max(0.8, 1.2 * escala), percent=int(60 + 90 * forca),
                                         threshold=limiar))
    return Image.merge("YCbCr", (y, cb, cr)).convert("RGB")
