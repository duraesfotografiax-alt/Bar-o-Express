"""Teste do Remover objeto com o modelo LaMa (roda no CI, que consegue baixar o modelo).

Gera imagens antes/depois em resultados/ para conferir a qualidade.
"""
import os
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from editalote.remover import remover_objetos, sessao_ia  # noqa: E402

os.makedirs("resultados", exist_ok=True)
s = sessao_ia()
print("modelo carregado:", s is not None)
if s is not None:
    print("entradas:", [(e.name, e.shape, e.type) for e in s.get_inputs()])
    print("saídas:", [(o.name, o.shape, o.type) for o in s.get_outputs()])


def cena():
    rng = np.random.default_rng(1)
    img = Image.new("RGB", (1600, 1067), (200, 190, 175))
    d = ImageDraw.Draw(img)
    for x in range(0, 1600, 80):                       # parede listrada
        d.rectangle([x, 0, x + 40, 700], fill=(170, 195, 220))
    d.rectangle([0, 700, 1600, 1067], fill=(225, 205, 180))   # mesa
    d.ellipse([700, 520, 900, 760], fill=(200, 160, 30))       # "coroa" dourada
    arr = np.asarray(img, dtype=np.float32) + rng.normal(0, 4, (1067, 1600, 3))
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


img = cena()
tracos = [{"p": [[800 / 1600, y / 1067] for y in range(530, 760, 20)], "r": 0.07}]
t = time.time()
r = remover_objetos(img, tracos)
print(f"tempo: {time.time() - t:.2f}s")
Image.fromarray(np.hstack([np.asarray(img), np.asarray(r)])).resize((1600, 534)).save("resultados/cena.jpg", quality=88)
for f in sorted(os.listdir("fotos_teste")) if os.path.isdir("fotos_teste") else []:
    pass
