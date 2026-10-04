"""Remover objeto: pinta-se por cima (pincel) e a área é preenchida com o que está em volta.

- Com o modelo de IA LaMa (modelos/lama_fp32.onnx, vai junto no DuraesApp): a IA "imagina" o
  que estava atrás do objeto (parede, toalha, chão, decoração), como o Remover do Lightroom.
- Manchas e objetos pequenos (poeira, fio, interruptor): reconstrução pela vizinhança (Telea),
  direto na resolução da foto — rápido e invisível.
- Sem o modelo: objetos maiores são preenchidos suavemente pela vizinhança (fica liso).

Os traços ficam guardados em medidas relativas (0..1) da foto em pé, antes do corte/giro.
"""

from __future__ import annotations

from collections import OrderedDict
from threading import Lock

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PEQUENO = 0.002      # fração da foto: abaixo disso usa o método rápido
LADO_REGIAO = 400    # lado da região no preenchimento sem IA
LADO_IA = 512        # o LaMa trabalha em 512x512

_sessao = None
_sessao_tentada = False


def caminho_modelo() -> str | None:
    import os
    import sys

    candidatos = [os.environ.get("DURAES_MODELO_LAMA", "")]
    bases = [os.path.dirname(sys.executable), os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
             os.getcwd()]
    candidatos += [os.path.join(b, "modelos", "lama_fp32.onnx") for b in bases]
    return next((c for c in candidatos if c and os.path.isfile(c)), None)


def sessao_ia():
    """Sessão do onnxruntime com o LaMa, ou None se o modelo não está disponível."""
    global _sessao, _sessao_tentada
    with _trava:
        if _sessao_tentada:
            return _sessao
        _sessao_tentada = True
        caminho = caminho_modelo()
        if not caminho:
            return None
        try:
            import onnxruntime as ort

            opcoes = ort.SessionOptions()
            opcoes.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            _sessao = ort.InferenceSession(caminho, opcoes, providers=["CPUExecutionProvider"])
        except Exception:
            import logging

            logging.getLogger("editalote.remover").exception("não consegui abrir o modelo LaMa")
            _sessao = None
        return _sessao

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
    sessao = sessao_ia()
    if m.mean() < PEQUENO and (sessao is None or m.sum() < 400):
        raio = max(3, int(max(w, h) * 0.004))
        return Image.fromarray(cv2.inpaint(arr, m.astype(np.uint8) * 255, raio, cv2.INPAINT_TELEA))
    if sessao is not None:
        return Image.fromarray(_com_ia(sessao, arr, m))

    # região em volta do objeto, com margem para achar textura parecida
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    margem = int(max(bw, bh) * 0.5) + 20
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
    cv2.xphoto.inpaint(peq, 255 - mpeq, preenchida, cv2.xphoto.INPAINT_FSR_FAST)
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


def _com_ia(sessao, arr: np.ndarray, m: np.ndarray) -> np.ndarray:
    """LaMa numa janela quadrada em volta de cada grupo de traços."""
    import cv2

    h, w = m.shape
    qtd, rotulos, stats, _ = cv2.connectedComponentsWithStats(
        cv2.dilate(m.astype(np.uint8), np.ones((15, 15), np.uint8)), connectivity=8)
    for i in range(1, qtd):
        x, y, bw, bh = stats[i, :4]
        grupo = m & (rotulos == i)
        if not grupo.any():
            continue
        lado = int(min(max(w, h), max(LADO_IA, max(bw, bh) * 2.2)))
        cx, cy = x + bw / 2, y + bh / 2
        x0 = int(np.clip(cx - lado / 2, 0, max(0, w - lado)))
        y0 = int(np.clip(cy - lado / 2, 0, max(0, h - lado)))
        x1, y1 = min(w, x0 + lado), min(h, y0 + lado)
        reg = arr[y0:y1, x0:x1]
        mreg = grupo[y0:y1, x0:x1]
        entrada = cv2.resize(reg, (LADO_IA, LADO_IA), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        mascara_ia = cv2.resize(mreg.astype(np.uint8), (LADO_IA, LADO_IA), interpolation=cv2.INTER_NEAREST)
        mascara_ia = cv2.dilate(mascara_ia, np.ones((5, 5), np.uint8)).astype(np.float32)
        nomes = [e.name for e in sessao.get_inputs()]
        img_t = entrada.transpose(2, 0, 1)[None]
        mask_t = mascara_ia[None, None]
        feed = {nomes[0]: img_t, nomes[1]: mask_t} if "mask" not in nomes[0].lower() \
            else {nomes[0]: mask_t, nomes[1]: img_t}
        saida = sessao.run(None, feed)[0][0].transpose(1, 2, 0)
        if saida.max() > 2.0:
            saida = saida / 255.0
        saida = np.clip(saida * 255.0, 0, 255).astype(np.uint8)
        preenchida = cv2.resize(saida, (reg.shape[1], reg.shape[0]), interpolation=cv2.INTER_CUBIC)
        if reg.shape[0] > LADO_IA * 1.3:   # região grande foi reduzida: devolve o granulado
            borda = cv2.dilate(mreg.astype(np.uint8), np.ones((25, 25), np.uint8)).astype(bool) & ~mreg
            if borda.any():
                detalhe = reg.astype(np.float32) - cv2.GaussianBlur(reg, (0, 0), 1.5).astype(np.float32)
                sigma = float(detalhe[borda].std())
                ruido = np.random.default_rng(0).normal(0, sigma * 0.8, preenchida.shape[:2])[..., None]
                preenchida = np.clip(preenchida.astype(np.float32) + ruido, 0, 255).astype(np.uint8)
        raio = float(max(2, int(max(bw, bh)) * 0.015))
        suave = Image.fromarray(mreg.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5)) \
            .filter(ImageFilter.GaussianBlur(raio))
        alfa = np.maximum(np.asarray(suave, dtype=np.float32) / 255.0, mreg.astype(np.float32))[..., None]
        arr[y0:y1, x0:x1] = (preenchida * alfa + reg * (1 - alfa)).astype(np.uint8)
    return arr
