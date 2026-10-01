"""IA automática (botão Auto): analisa cada foto e edita sozinha até o "jeito" do estúdio.

Para cada foto a IA mede o brilho, os pretos, os brancos, o contraste, a cor da luz e a saturação,
e calcula os ajustes que levam essa foto até o alvo:
  - balanço de branco pelo que deveria ser branco/cinza (vestido, terno, parede);
  - exposição pelos meios-tons, sem estourar o vestido (cenas noturnas ficam noturnas);
  - pretos e brancos no lugar certo (tira o aspecto "lavado"/esbranquiçado);
  - contraste medido: a curva em S é escolhida para chegar no contraste do alvo;
  - vibração até a saturação do alvo (foto sem cor ganha cor; foto já colorida não estoura).

O alvo padrão foi medido nas fotos finais da Durães Fotografia. Um preset pode trazer outro alvo
("auto_alvo"), medido de outras fotos prontas (ver medir_estilo).
"""

from __future__ import annotations

import os
from collections import OrderedDict
from threading import Lock

import numpy as np

from .assunto import luz_das_pessoas
from .estilo_referencia import cor_dos_neutros
from .processamento import AJUSTES_PADRAO, PESOS_Y, carregar_reduzida, srgb_para_linear, transformar

_NEUTRO = {**AJUSTES_PADRAO, "auto_exposicao": 0, "auto_balanco_branco": 0}

# Medido nas fotos finais da Durães (claras, pretos firmes, brancos limpos, levemente quentes)
ALVO_DURAES = {"meio": 0.56, "preto": 0.045, "branco": 0.965, "desvio": 0.265,
               "saturacao": 0.125, "quente": 0.12, "pele": 0.62}
PONTOS_CURVA = np.linspace(0.0, 1.0, 17)
_AMOSTRAS = 40000


def _sat(rgb: np.ndarray) -> float:
    return float((rgb.max(axis=1) - rgb.min(axis=1)).mean())


def _neutros(rgb: np.ndarray) -> tuple[float, float]:
    neutro = cor_dos_neutros(rgb)
    quente = float(np.log2(neutro[0] / neutro[2]))
    verde = float(np.log2(neutro[1] / np.sqrt(neutro[0] * neutro[2])))
    return quente, verde


def medir_estilo(fotos_rgb: list[np.ndarray]) -> dict:
    """Mede o "jeito" de fotos já prontas (o alvo da IA automática)."""
    medidas = []
    for foto in fotos_rgb:
        rgb = foto.reshape(-1, 3)
        y = rgb @ PESOS_Y
        p1, p50, p99 = np.percentile(y, [1, 50, 99])
        medidas.append({"meio": p50, "preto": p1, "branco": p99, "desvio": y.std(),
                        "saturacao": _sat(rgb), "quente": _neutros(rgb)[0],
                        "pele": luz_das_pessoas(foto) if foto.ndim == 3 else None})
    alvo = {}
    for k in ALVO_DURAES:
        valores = [m[k] for m in medidas if m[k] is not None]
        alvo[k] = float(np.median(valores)) if valores else ALVO_DURAES[k]
    # limites de segurança: um alvo exagerado (foto P&B, foto muito escura) não pode estragar tudo
    limites = {"meio": (0.38, 0.86), "preto": (0.0, 0.25), "branco": (0.85, 0.99),
               "desvio": (0.12, 0.32), "saturacao": (0.03, 0.25), "quente": (-0.1, 0.35),
               "pele": (0.45, 0.75)}
    return {k: round(float(np.clip(v, *limites[k])), 4) for k, v in alvo.items()}


def _curva_s(v: np.ndarray, s: float) -> np.ndarray:
    """S que mantém 0, meio e 1 no lugar: s > 0 dá contraste, s < 0 suaviza."""
    return v - s * np.sin(2 * np.pi * v) / (2 * np.pi)


def calcular(rgb: np.ndarray, alvo: dict | None = None) -> dict:
    """Ajustes automáticos para esta foto (rgb 0..1 reduzida)."""
    alvo = {**ALVO_DURAES, **(alvo or {})}
    rgb_cena = rgb if rgb.ndim == 3 else None
    rgb = rgb.reshape(-1, 3)
    if len(rgb) > _AMOSTRAS:
        rgb = rgb[np.linspace(0, len(rgb) - 1, _AMOSTRAS).astype(int)]

    # 1) cor da luz pelo que deveria ser neutro (70% do caminho: preserva o clima da cena)
    quente, verde = _neutros(rgb)
    temperatura = float(np.clip(-0.7 * 200 * (quente - alvo["quente"]), -50, 50))
    matiz = float(np.clip(0.7 * 100 * verde / 0.15, -30, 30))

    # 2) exposição pelos meios-tons e, quando há gente, pela luz nas pessoas
    y = rgb @ PESOS_Y
    p50, p99 = np.percentile(y, [50, 99])
    meio_alvo = alvo["meio"]
    if p50 < 0.18 and p99 > 0.75:       # festa com luzes: clareia bem, mas sem virar dia
        meio_alvo = min(meio_alvo, 0.47)
    lin = lambda v: float(srgb_para_linear(np.array([min(max(v, 0.01), 1.0)]))[0])
    ev_cena = float(np.log2(lin(meio_alvo) / lin(p50)))
    luz_pessoas = luz_das_pessoas(rgb_cena) if rgb_cena is not None else None
    if luz_pessoas is not None:         # quem importa é a pessoa: mede por ela
        ev_pessoas = float(np.log2(lin(alvo["pele"]) / lin(luz_pessoas)))
        ev = 0.65 * ev_pessoas + 0.35 * ev_cena
    else:
        ev = ev_cena
    ev = float(np.clip(ev * 0.85, -1.5, 2.0))
    if ev > 0:
        # luzes da festa e janelas podem estourar um pouco (a curva segura); a pessoa não
        teto = lin(np.percentile(y, 97 if luz_pessoas is not None else 99))
        ev = min(ev, max(0.0, float(np.log2(1.25 / teto))))

    # 3) medidas depois da exposição/cor
    passo = {**_NEUTRO, "exposicao": ev, "temperatura": temperatura, "matiz": matiz}
    v2 = transformar(rgb, passo, None)
    y2 = v2 @ PESOS_Y
    preto, meio, branco = np.percentile(y2, [1, 50, 99])

    # 3a) níveis: pretos firmes e brancos limpos (é o que tira o "esbranquiçado")
    if alvo["preto"] > 0.08:               # estilo claro e suave (pretos "leitosos"): sobe os pretos
        preto_novo = preto + (alvo["preto"] - preto) * 0.5
    else:
        preto_novo = min(preto, alvo["preto"]) if preto < 0.2 else alvo["preto"] + (preto - alvo["preto"]) * 0.3
        preto_novo = preto + (preto_novo - preto) * 0.75   # nunca afunda tudo de uma vez
    if branco < alvo["branco"]:
        branco_novo = alvo["branco"]
    else:                                  # brancos estourando: recupera um pouco (vestido)
        branco_novo = alvo["branco"] + (branco - alvo["branco"]) * 0.5
    faixa = max(branco - preto, 0.05)

    def niveis(v):
        return np.clip(preto_novo + (v - preto) * (branco_novo - preto_novo) / faixa, 0.0, 1.0)

    # 3b) meios-tons no alvo (gama suave), sem mexer em pretos e brancos
    m = float(niveis(np.array([meio]))[0])
    gama = float(np.clip(np.log(meio_alvo) / np.log(np.clip(m, 0.05, 0.95)), 0.7, 1.4)) if 0.02 < m < 0.98 else 1.0
    gama = 1.0 + (gama - 1.0) * 0.6

    def base(v):
        return niveis(v) ** gama

    # 3c) contraste: anda METADE do caminho até o contraste do alvo, com teto. Cena clara de
    # tons pastel (aniversário, balões) tem pouco contraste por natureza e não pode virar "dura".
    yb = base(y2)
    desvio_alvo = yb.std() + (alvo["desvio"] - yb.std()) * 0.5
    s_baixo, s_alto = -0.3, 0.6
    for _ in range(18):
        s = (s_baixo + s_alto) / 2
        if _curva_s(yb, s).std() < desvio_alvo:
            s_baixo = s
        else:
            s_alto = s
    s = float(np.clip((s_baixo + s_alto) / 2, -0.1, 0.22))

    ys = np.clip(_curva_s(base(PONTOS_CURVA), s), 0.0, 1.0)
    ys[0] = min(ys[0], 0.0 + preto_novo)
    ys = np.maximum.accumulate(ys)
    curva = [[round(float(x) * 255, 1), round(float(yv) * 255, 1)] for x, yv in zip(PONTOS_CURVA, ys)]

    # 4) saturação: mede depois da curva e completa com vibração até o alvo
    v3 = transformar(rgb, {**passo, "curva_ref": curva}, None)
    sat = _sat(v3)
    vibracao = float(np.clip((alvo["saturacao"] / max(sat, 0.01) - 1) * 50, -15, 25))
    contraste_mostrado = float((np.interp(0.75, PONTOS_CURVA, ys) - np.interp(0.25, PONTOS_CURVA, ys) - 0.5) * 200)
    return {"exposicao": ev, "temperatura": temperatura, "matiz": matiz, "curva_ref": curva,
            "vibracao": vibracao, "contraste": contraste_mostrado}


# cache: mexer num controle não recalcula a análise da foto
_cache: OrderedDict = OrderedDict()
_trava = Lock()


def calcular_foto(caminho_foto: str, alvo: dict | None = None) -> dict:
    try:
        chave = (caminho_foto, os.path.getmtime(caminho_foto), repr(sorted((alvo or {}).items())))
    except OSError:
        chave = None
    with _trava:
        if chave in _cache:
            _cache.move_to_end(chave)
            return _cache[chave]
    rgb = np.asarray(carregar_reduzida(caminho_foto, 500).convert("RGB"), dtype=np.float64) / 255.0
    auto = calcular(rgb, alvo)
    if chave is not None:
        with _trava:
            _cache[chave] = auto
            while len(_cache) > 64:
                _cache.popitem(last=False)
    return auto


def aplicar_auto(ajustes: dict, caminho_foto: str, rgb: np.ndarray | None = None) -> tuple[dict, dict]:
    """Soma a IA automática aos ajustes do preset, na força escolhida (0–100).

    Os controles do preset continuam valendo por cima (ex.: +10 de contraste = um pouco mais que o
    alvo). Não age junto com uma IA treinada: as duas fariam o mesmo trabalho.
    """
    forca = float(ajustes.get("auto_tom", 0) or 0) / 100.0
    if forca <= 0 or (ajustes.get("estilo_ia") and float(ajustes.get("ia_forca", 100) or 0) > 0):
        return ajustes, {}
    alvo = ajustes.get("auto_alvo") or None
    auto = calcular(rgb, alvo) if rgb is not None else calcular_foto(caminho_foto, alvo)
    final = dict(ajustes)
    for chave in ("exposicao", "temperatura", "matiz", "vibracao"):
        final[chave] = round(float(final.get(chave, 0) or 0) + auto[chave] * forca, 3)
    final["curva_ref"] = [[x, round(x + (y - x) * forca, 1)] for x, y in auto["curva_ref"]]
    final["auto_exposicao"] = 0
    final["auto_balanco_branco"] = 0
    diferencas = {k: round(auto[k] * forca, 2) for k in ("exposicao", "contraste", "temperatura", "vibracao")
                  if abs(auto[k] * forca) >= (0.05 if k == "exposicao" else 1)}
    return final, diferencas
