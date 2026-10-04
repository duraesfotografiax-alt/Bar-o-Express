"""Remover objeto: pinta-se por cima (pincel) e a área é preenchida com o que está em volta.

- Manchas e objetos pequenos (poeira, fio, interruptor): reconstrução pela vizinhança (Telea),
  direto na resolução da foto — rápido e invisível.
- Objetos maiores: preenchimento por pedaços da própria foto (Shift-Map do OpenCV), que copia
  textura de verdade (parede, toalha, chão) em vez de borrar. Feito numa versão reduzida da região
  e encaixado com borda suave; a textura fina é devolvida com o granulado da vizinhança.

Os traços ficam guardados em medidas relativas (0..1) da foto em pé, antes do corte/giro.
"""

from __future__ import annotations

from collections import OrderedDict
from threading import Lock

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PEQUENO = 0.004      # fração da foto: abaixo disso usa o método rápido
LADO_REGIAO = 800    # lado máximo da região processada pelo Shift-Map

_cache: OrderedDict = OrderedDict()
_trava = Lock()


def mascara(tamanho: tuple[int, int], tracos: list) -> Image.Image:
    w, h = tamanho
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    escala = max(w, h)
    for t in tracos or []:
        r = max(1.0, float(t.get("r", 0.01)) * escala)
        pontos = [(float(x) * w, float(y) * h) for x, y in t.get("p", [])]
        if not pontos:
            continue
        if len(pontos) > 1:
            d.line(pontos, fill=255, width=int(round(2 * r)), joint="curve")
        for x, y in pontos:
            d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    return m


def remover_objetos(img: Image.Image, tracos: list) -> Image.Image:
    if not tracos:
        return img
    chave = (img.size, repr(tracos), img.tobytes()[:4096:97])
    with _trava:
        if chave in _cache:
            _cache.move_to_end(chave)
            return _cache[chave].copy()
    resultado = _remover(img.convert("RGB"), tracos)
    with _trava:
        _cache[chave] = resultado
        while len(_cache) > 8:
            _cache.popitem(last=False)
    return resultado.copy()


def _remover(img: Image.Image, tracos: list) -> Image.Image:
    import cv2

    m_img = mascara(img.size, tracos)
    m = np.asarray(m_img) > 127
    if not m.any():
        return img
    arr = np.asarray(img).copy()
    h, w = m.shape
    ys, xs = np.nonzero(m)
    if m.mean() < PEQUENO:
        raio = max(3, int(max(w, h) * 0.004))
        return Image.fromarray(cv2.inpaint(arr, m.astype(np.uint8) * 255, raio, cv2.INPAINT_TELEA))

    # região em volta do objeto, com margem para achar textura parecida
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    margem = int(max(bw, bh) * 0.9) + 20
    x0, y0 = max(0, xs.min() - margem), max(0, ys.min() - margem)
    x1, y1 = min(w, xs.max() + margem + 1), min(h, ys.max() + margem + 1)
    reg = arr[y0:y1, x0:x1]
    mreg = m[y0:y1, x0:x1]
    escala = min(1.0, LADO_REGIAO / max(reg.shape[:2]))
    if escala < 1.0:
        tam = (max(8, round(reg.shape[1] * escala)), max(8, round(reg.shape[0] * escala)))
        peq = cv2.resize(reg, tam, interpolation=cv2.INTER_AREA)
        mpeq = cv2.resize(mreg.astype(np.uint8) * 255, tam, interpolation=cv2.INTER_NEAREST)
        mpeq = cv2.dilate(mpeq, np.ones((3, 3), np.uint8))
    else:
        peq, mpeq = reg, mreg.astype(np.uint8) * 255
    preenchida = np.zeros_like(peq)
    cv2.xphoto.inpaint(peq, 255 - mpeq, preenchida, cv2.xphoto.INPAINT_SHIFTMAP)
    if escala < 1.0:
        preenchida = cv2.resize(preenchida, (reg.shape[1], reg.shape[0]), interpolation=cv2.INTER_CUBIC)
        # a versão reduzida perde o granulado: devolve um granulado parecido com o da vizinhança
        borda = cv2.dilate(mreg.astype(np.uint8), np.ones((25, 25), np.uint8)).astype(bool) & ~mreg
        if borda.any():
            detalhe = reg.astype(np.float32) - cv2.GaussianBlur(reg, (0, 0), 1.5).astype(np.float32)
            sigma = float(detalhe[borda].std())
            ruido = np.random.default_rng(0).normal(0, sigma * 0.8, preenchida.shape[:2])[..., None]
            preenchida = np.clip(preenchida.astype(np.float32) + ruido, 0, 255).astype(np.uint8)
    # borda suave para não aparecer o recorte
    suave = Image.fromarray(mreg.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5)) \
        .filter(ImageFilter.GaussianBlur(float(max(2, int(max(bw, bh)) * 0.02))))
    alfa = np.maximum(np.asarray(suave, dtype=np.float32) / 255.0, mreg.astype(np.float32))[..., None]
    arr[y0:y1, x0:x1] = (preenchida * alfa + reg * (1 - alfa)).astype(np.uint8)
    return Image.fromarray(arr)
