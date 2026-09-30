"""IA de estilo por referência: aprende só com as fotos FINAIS que o estúdio já entregou.

Não precisa da foto original nem das configurações do Lightroom. A IA mede o "jeito" das fotos
entregues (brilho, curva de contraste, quanto são quentes, saturação) e, em cada foto nova,
calcula o ajuste que leva aquela foto até esse jeito. Foto escura sobe, foto clara desce, foto
fria esquenta: todas terminam no padrão do estúdio.

Para respeitar a cena (a festa à noite não deve ficar clara como a externa ao meio-dia), a IA
compara cada foto com as fotos de referência mais parecidas em conteúdo e usa o jeito delas.
"""

from __future__ import annotations

import json
import logging
import os
import warnings
from concurrent.futures import ProcessPoolExecutor, as_completed

import numpy as np
from PIL import Image

from .metadados import EXTENSOES
from .processamento import (
    AJUSTES_PADRAO,
    PESOS_Y,
    carregar_reduzida,
    srgb_para_linear,
    transformar,
)

log = logging.getLogger("editalote.ia")

TIPO = "referencia"
VIZINHOS = 5
PERCENTIS = (1, 5, 25, 50, 75, 95, 99)
_NEUTRO = {**AJUSTES_PADRAO, "auto_exposicao": 0, "auto_balanco_branco": 0}


# ------------------------------------------------------------------- medidas

def cor_dos_neutros(rgb: np.ndarray) -> np.ndarray:
    """Cor média (linear) do que deveria ser branco/cinza: vestido, terno, parede clara.

    É assim que se mede a cor da LUZ sem confundir com a cor da CENA (um vestido laranja ou uma
    parede de pedra deixam a média da foto quente, mas a luz pode estar neutra). Começa pelos
    pixels menos coloridos da foto, tira a dominante que eles mostram, acha os pixels quase sem
    cor e mede a cor deles na foto original; repete para refinar.
    """
    rgb = rgb.reshape(-1, 3)
    lin = srgb_para_linear(rgb) + 1e-5
    y = rgb @ PESOS_Y
    utilizavel = (y > 0.25) & (lin.max(axis=1) < 0.95)
    if utilizavel.sum() < 100:
        utilizavel = np.ones(len(rgb), dtype=bool)
    candidatos = lin[utilizavel]
    croma_bruto = (candidatos.max(axis=1) - candidatos.min(axis=1)) / candidatos.max(axis=1)
    menos_coloridos = croma_bruto <= np.percentile(croma_bruto, 25)
    estimativa = candidatos[menos_coloridos].mean(axis=0)
    for _ in range(3):
        corrigida = lin / estimativa
        croma = (corrigida.max(axis=1) - corrigida.min(axis=1)) / corrigida.max(axis=1)
        for limite in (0.10, 0.18, 0.30):
            neutros = utilizavel & (croma < limite)
            if neutros.sum() >= max(200, 0.01 * len(rgb)):
                break
        else:
            return estimativa  # foto sem nada neutro: fica a média da foto
        estimativa = lin[neutros].mean(axis=0)
    return estimativa


def _medidas(rgb: np.ndarray) -> dict:
    """Como a foto está: rgb (…, 3) em 0..1 (sRGB)."""
    rgb = rgb.reshape(-1, 3)
    y = rgb @ PESOS_Y
    neutro = cor_dos_neutros(rgb)
    return {
        "p": np.percentile(y, PERCENTIS).tolist(),
        "quente": float(np.log2(neutro[0] / neutro[2])),                 # vermelho x azul
        "matiz": float(np.log2(neutro[1] / np.sqrt(neutro[0] * neutro[2]))),  # verde x magenta
        "sat": float((rgb.max(axis=1) - rgb.min(axis=1)).mean()),
    }


def _cena(rgb: np.ndarray) -> np.ndarray:
    """Do que a foto é feita, sem depender do brilho nem da cor da luz (para achar parecidas)."""
    rgb = rgb.reshape(-1, 3)
    lin = srgb_para_linear(rgb)
    y_log = np.log2(lin @ PESOS_Y + 1e-4)
    q = np.percentile(y_log, [5, 25, 50, 75, 95])
    # tira a cor da luz (gray world) antes de olhar as cores da cena
    neutro = lin / (lin.mean(axis=0) + 1e-6)
    croma = neutro.max(axis=1) - neutro.min(axis=1)
    r, g, b = neutro[:, 0], neutro[:, 1], neutro[:, 2]
    matiz = (np.degrees(np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)) + 360) % 360
    hist, _ = np.histogram(matiz, bins=6, range=(0, 360), weights=croma)
    hist = hist / (hist.sum() + 1e-6)
    return np.array([q[4] - q[0], q[2] - q[1], q[3] - q[2], float(croma.mean()), *hist])


def _abrir(caminho: str) -> np.ndarray:
    return np.asarray(carregar_reduzida(caminho, 500).convert("RGB"), dtype=np.float64) / 255.0


def _referencia(caminho: str):
    try:
        rgb = _abrir(caminho)
        return {"arquivo": os.path.basename(caminho), "cena": _cena(rgb).round(5).tolist(),
                **_medidas(rgb)}
    except Exception:
        log.exception("não consegui ler %s", caminho)
        return None


# -------------------------------------------------------------------- treino

def treinar(pasta: str, nome: str = "Meu estilo", limite: int = 1500, progresso=None,
            minimo: int = 3) -> dict:
    arquivos = []
    for raiz, _, nomes in os.walk(pasta):
        arquivos += [os.path.join(raiz, n) for n in sorted(nomes)
                     if os.path.splitext(n)[1].lower() in EXTENSOES]
    arquivos = arquivos[:limite]
    refs = []
    processos = min(8, max(1, (os.cpu_count() or 2) - 1))
    with ProcessPoolExecutor(max_workers=processos) as executor:
        futuros = [executor.submit(_referencia, c) for c in arquivos]
        for n, futuro in enumerate(as_completed(futuros), 1):
            r = futuro.result()
            if r:
                refs.append(r)
            if progresso:
                progresso(n, len(arquivos))
    diagnostico = f"Encontrei {len(arquivos)} fotos JPEG e usei {len(refs)} como referência."
    log.info("referência em %s: %s", pasta, diagnostico)
    if len(refs) < minimo:
        raise ValueError(f"{diagnostico} Escolha uma pasta com pelo menos 3 fotos finais "
                         "(o ideal são 30 a 100, de momentos diferentes do evento).")
    cenas = np.array([r["cena"] for r in refs])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        media, desvio = cenas.mean(axis=0), cenas.std(axis=0)
    desvio = np.where(desvio < 1e-6, 1.0, desvio)
    brilhos = [r["p"][3] for r in refs]
    return {
        "tipo": TIPO, "versao": 1, "nome": nome, "fotos": len(refs), "refs": refs,
        "media": media.round(5).tolist(), "desvio": desvio.round(5).tolist(),
        "diagnostico": diagnostico,
        "resumo": {"brilho_medio": round(float(np.median(brilhos)), 3),
                   "quente": round(float(np.median([r["quente"] for r in refs])), 3),
                   "saturacao": round(float(np.median([r["sat"] for r in refs])), 3)},
    }


# ----------------------------------------------------------------------- uso

class ModeloReferencia:
    def __init__(self, dados: dict):
        self.refs = dados["refs"]
        self.cenas = np.array([r["cena"] for r in self.refs])
        self.media = np.array(dados["media"])
        self.desvio = np.array(dados["desvio"])

    def alvo(self, cena: np.ndarray) -> dict:
        """O jeito das fotos de referência mais parecidas com esta cena."""
        z = (self.cenas - self.media) / self.desvio
        zc = (cena - self.media) / self.desvio
        d = np.sqrt(((z - zc) ** 2).sum(axis=1))
        k = min(VIZINHOS, len(self.refs))
        idx = np.argsort(d)[:k]
        pesos = 1.0 / (d[idx] + 0.5)
        pesos /= pesos.sum()
        escolhidas = [self.refs[i] for i in idx]
        return {
            "p": np.sum([np.array(r["p"]) * w for r, w in zip(escolhidas, pesos)], axis=0),
            "quente": float(sum(r["quente"] * w for r, w in zip(escolhidas, pesos))),
            "matiz": float(sum(r["matiz"] * w for r, w in zip(escolhidas, pesos))),
            "sat": float(sum(r["sat"] * w for r, w in zip(escolhidas, pesos))),
        }

    def ajustar(self, ajustes: dict, rgb: np.ndarray, forca: float) -> tuple[dict, dict]:
        antes = _medidas(rgb)
        alvo = self.alvo(_cena(rgb))

        # 1) exposição: guiada principalmente pelos tons claros (vestido, terno, parede), que é o
        # que define o estilo num casamento; o tom médio depende demais do que há na cena
        ev = 0.0
        for indice, peso in ((3, 0.2), (4, 0.3), (5, 0.5)):  # p50, p75, p95
            lin_alvo = float(srgb_para_linear(np.array([alvo["p"][indice]]))[0])
            lin_foto = float(srgb_para_linear(np.array([max(antes["p"][indice], 0.01)]))[0])
            ev += peso * np.log2(lin_alvo / lin_foto)
        ev = float(np.clip(ev, -2.0, 2.0)) * forca
        # cor: metade do caminho e com limite. Errar a cor estraga mais a foto do que errar um
        # pouco o brilho, e a cor do "branco" medida pela IA ainda é uma estimativa
        temperatura = float(np.clip(0.5 * 200 * (alvo["quente"] - antes["quente"]), -40, 40)) * forca
        matiz = float(np.clip(0.5 * -100 * (alvo["matiz"] - antes["matiz"]) / 0.15, -25, 25)) * forca
        passo1 = {**_NEUTRO, "exposicao": ev, "temperatura": temperatura, "matiz": matiz}
        depois1 = _medidas(transformar(rgb, passo1, None))

        # 2) curva de tons: leva os PRETOS e os BRANCOS até onde a referência deixa (preto lavado,
        # branco sem estourar) e os tons médios só um pouco: a posição deles depende mais da
        # composição de cada foto do que do estilo.
        xs, ys = [0.0], [0.0]
        peso_tom = (0.7, 0.7, 0.3, 0.3, 0.3, 0.7, 0.7)  # p1 p5 p25 p50 p75 p95 p99
        for x, y_alvo, peso in zip(depois1["p"], alvo["p"], peso_tom):
            y = x + (y_alvo - x) * peso * forca
            if x > xs[-1] + 0.01 and 0.0 < x < 1.0:
                xs.append(float(x))
                ys.append(float(np.clip(max(y, ys[-1] + 0.002), 0.0, 0.999)))
        xs.append(1.0)
        ys.append(1.0 if ys[-1] < 1.0 else ys[-1])
        curva = [[round(x * 255, 1), round(y * 255, 1)] for x, y in zip(xs, ys)]

        # 3) saturação: mesma "força de cor" da referência
        passo2 = {**passo1, "curva_ref": curva}
        depois2 = _medidas(transformar(rgb, passo2, None))
        fator = alvo["sat"] / max(depois2["sat"], 1e-3)
        # meio caminho e com limite: a saturação depende muito do que há na cena
        saturacao = float(np.clip((fator - 1) * 50, -15, 15)) * forca

        final = dict(ajustes)
        final["exposicao"] = round(float(final.get("exposicao", 0) or 0) + ev, 3)
        final["temperatura"] = round(float(np.clip(float(final.get("temperatura", 0) or 0) + temperatura, -100, 100)), 2)
        final["matiz"] = round(float(np.clip(float(final.get("matiz", 0) or 0) + matiz, -100, 100)), 2)
        final["saturacao"] = round(float(np.clip(float(final.get("saturacao", 0) or 0) + saturacao, -100, 100)), 2)
        final["curva_ref"] = curva
        final["auto_exposicao"] = 0
        final["auto_balanco_branco"] = 0
        diferencas = {k: round(v, 2) for k, v in
                      (("exposicao", ev), ("temperatura", temperatura), ("matiz", matiz),
                       ("saturacao", saturacao))
                      if abs(v) >= (0.05 if k == "exposicao" else 1)}
        return final, diferencas


def salvar(modelo: dict, caminho: str) -> None:
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(modelo, f, ensure_ascii=False, separators=(",", ":"))


def rgb_da_foto(caminho: str, reduzida: Image.Image | None = None) -> np.ndarray:
    if reduzida is not None:
        img = reduzida.copy()
        img.thumbnail((500, 500))
        return np.asarray(img.convert("RGB"), dtype=np.float64) / 255.0
    return _abrir(caminho)

