"""Botão Auto (como o do Lightroom): acerta cada foto sozinha.

Para cada foto: balanço de branco pelo que deveria ser branco/cinza, exposição (sem estourar os
brancos), pretos e brancos no lugar certo (tira o aspecto "lavado"), uma curva em S suave e um
pouco de vibração. Tudo calculado na versão reduzida da foto e aplicado pela mesma LUT 3D.
"""

from __future__ import annotations

import numpy as np

from .estilo_referencia import cor_dos_neutros
from .processamento import AJUSTES_PADRAO, PESOS_Y, carregar_reduzida, srgb_para_linear, transformar

_NEUTRO = {**AJUSTES_PADRAO, "auto_exposicao": 0, "auto_balanco_branco": 0}

MEIO_TOM_ALVO = 0.46      # mediana de brilho de uma foto "bem exposta" (sRGB)
PRETO_ALVO = 0.012        # onde o preto mais escuro deve ficar
BRANCO_ALVO = 0.975       # onde o branco mais claro deve ficar (sem estourar)


def calcular(rgb: np.ndarray) -> dict:
    """Ajustes automáticos para esta foto (rgb 0..1 reduzida)."""
    rgb = rgb.reshape(-1, 3)
    # 1) balanço de branco pela cor do que deveria ser neutro (metade do caminho: preserva o clima)
    neutro = cor_dos_neutros(rgb)
    quente = float(np.log2(neutro[0] / neutro[2]))
    verde = float(np.log2(neutro[1] / np.sqrt(neutro[0] * neutro[2])))
    temperatura = float(np.clip(-0.6 * 200 * (quente - 0.12), -45, 45))   # alvo levemente quente
    matiz = float(np.clip(0.6 * 100 * verde / 0.15, -30, 30))

    # 2) exposição pela mediana, protegendo os brancos
    y = rgb @ PESOS_Y
    p50, p99 = np.percentile(y, [50, 99])
    lin_alvo = float(srgb_para_linear(np.array([MEIO_TOM_ALVO]))[0])
    lin_foto = float(srgb_para_linear(np.array([max(p50, 0.01)]))[0])
    ev = float(np.clip(np.log2(lin_alvo / lin_foto) * 0.8, -1.5, 1.5))
    if ev > 0:
        teto = float(srgb_para_linear(np.array([min(max(p99, 0.05), 1.0)]))[0])
        ev = min(ev, max(0.0, float(np.log2(1.05 / teto))))       # não estoura o vestido

    # 3) pretos e brancos (níveis) + curva em S suave, medidos depois da exposição
    passo = {**_NEUTRO, "exposicao": ev, "temperatura": temperatura, "matiz": matiz}
    y2 = transformar(rgb, passo, None) @ PESOS_Y
    preto, branco = np.percentile(y2, [0.5, 99.5])
    preto_novo = min(preto, PRETO_ALVO) if preto < 0.15 else PRETO_ALVO + (preto - PRETO_ALVO) * 0.35
    branco_novo = BRANCO_ALVO if branco < BRANCO_ALVO else branco
    xs = [0.0, float(preto), 0.25, 0.5, 0.75, float(branco), 1.0]
    escala = lambda v: preto_novo + (v - preto) * (branco_novo - preto_novo) / max(branco - preto, 0.05)
    ys = [0.0, preto_novo, escala(0.25) - 0.015, escala(0.5), escala(0.75) + 0.015, branco_novo, 1.0]
    pontos = sorted({round(x, 4): y for x, y in zip(xs, ys)}.items())
    curva, ultimo_x, ultimo_y = [], -1.0, -1.0
    for x, yv in pontos:
        yv = float(np.clip(yv, 0.0, 1.0))
        if x > ultimo_x + 0.01 or x in (0.0, 1.0):
            yv = max(yv, ultimo_y + 0.001) if curva else yv
            curva.append([round(x * 255, 1), round(min(yv, 1.0) * 255, 1)])
            ultimo_x, ultimo_y = x, yv
    return {"exposicao": ev, "temperatura": temperatura, "matiz": matiz, "curva_ref": curva,
            "vibracao": 12.0}


def aplicar_auto(ajustes: dict, caminho_foto: str, rgb: np.ndarray | None = None) -> tuple[dict, dict]:
    """Soma o Auto aos ajustes do preset, na força escolhida (0–100). Não age se a IA de estilo
    estiver ligada: a IA já faz o papel do Auto, do jeito do estúdio."""
    forca = float(ajustes.get("auto_tom", 0) or 0) / 100.0
    if forca <= 0 or ajustes.get("estilo_ia"):
        return ajustes, {}
    if rgb is None:
        rgb = np.asarray(carregar_reduzida(caminho_foto, 500).convert("RGB"), dtype=np.float64) / 255.0
    auto = calcular(rgb)
    final = dict(ajustes)
    for chave in ("exposicao", "temperatura", "matiz", "vibracao"):
        final[chave] = round(float(final.get(chave, 0) or 0) + auto[chave] * forca, 3)
    final["curva_ref"] = [[x, x + (y - x) * forca] for x, y in auto["curva_ref"]]
    final["auto_exposicao"] = 0
    final["auto_balanco_branco"] = 0
    diferencas = {k: round(auto[k] * forca, 2) for k in ("exposicao", "temperatura", "matiz")
                  if abs(auto[k] * forca) >= (0.05 if k == "exposicao" else 1)}
    return final, diferencas
