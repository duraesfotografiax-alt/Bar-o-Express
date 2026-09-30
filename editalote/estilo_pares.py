"""IA de estilo por pares: aprende comparando a foto ORIGINAL com a mesma foto EDITADA.

É o jeito mais fiel de copiar a edição do estúdio. Para cada par, a IA mede a transformação
exata que o editor aplicou: a curva de tons de cada canal de cor (R, G, B), que junta
exposição, contraste, curva, pretos, brancos e cor. A medida é feita pela distribuição dos tons
(e não pixel a pixel), então funciona mesmo se a foto final foi recortada ou endireitada.

Numa foto nova, a IA procura as fotos originais do treino mais parecidas (brilho, contraste,
cor, ISO) e aplica a média das curvas que o editor usou nelas: foto escura de igreja recebe a
edição das fotos escuras de igreja; foto de festa, a das fotos de festa.
"""

from __future__ import annotations

import json
import logging
import os
import warnings
from concurrent.futures import ProcessPoolExecutor, as_completed

import numpy as np

from .estilo_ia import caracteristicas, ler_iso
from .metadados import ler_info, listar_jpegs
from .processamento import carregar_reduzida

log = logging.getLogger("editalote.ia")

TIPO = "pares"
VIZINHOS = 6
PONTOS = np.linspace(0.0, 1.0, 33)          # onde cada curva é guardada (0..1)
_QUANTIS = np.linspace(0.0, 1.0, 257)


# --------------------------------------------------------------------- pares

def parear(pasta_originais: str, pasta_finais: str) -> tuple[list[tuple[str, str]], dict]:
    """Junta cada foto final com a original: pelo nome do arquivo ou pela data/hora da foto."""
    originais = listar_jpegs(pasta_originais, ignorar=pasta_finais)
    finais = listar_jpegs(pasta_finais, ignorar=pasta_originais)
    por_nome = {os.path.splitext(os.path.basename(p))[0].lower(): p for p in originais}
    pares, sem_par = [], []
    for final in finais:
        nome = os.path.splitext(os.path.basename(final))[0].lower()
        if nome in por_nome:
            pares.append((por_nome.pop(nome), final))
        else:
            sem_par.append(final)
    por_nome_final = len(pares)
    if sem_par and por_nome:
        # nomes diferentes (ex.: renomeados na exportação): usa data/hora + câmera do EXIF
        por_data = {}
        for original in por_nome.values():
            info = ler_info(original)
            if info.data:
                por_data.setdefault((info.data, info.camera), original)
        for final in sem_par[:]:
            info = ler_info(final)
            chave = (info.data, info.camera)
            if info.data and chave in por_data:
                pares.append((por_data.pop(chave), final))
                sem_par.remove(final)
    return pares, {"originais": len(originais), "finais": len(finais), "pares": len(pares),
                   "por_nome": por_nome_final, "sem_par": len(sem_par)}


# ------------------------------------------------------------------- medidas

def _abrir(caminho: str) -> np.ndarray:
    return np.asarray(carregar_reduzida(caminho, 400).convert("RGB"), dtype=np.float64) / 255.0


def curvas_do_par(original: np.ndarray, final: np.ndarray) -> np.ndarray:
    """Curva de cada canal que leva a distribuição de tons da original até a da final."""
    curvas = np.empty((3, len(PONTOS)))
    for c in range(3):
        qo = np.quantile(original[..., c], _QUANTIS)
        qf = np.quantile(final[..., c], _QUANTIS)
        # tons repetidos (ex.: muito preto puro) deixariam a curva ambígua: força subir sempre
        qo = np.maximum.accumulate(qo + np.arange(len(qo)) * 1e-6)
        curvas[c] = np.clip(np.interp(PONTOS, qo, qf), 0.0, 1.0)
        curvas[c] = np.maximum.accumulate(curvas[c])  # nunca inverte tons
    return curvas


def _par(original: str, final: str):
    try:
        rgb_o, rgb_f = _abrir(original), _abrir(final)
        iso = ler_iso(original)
        from PIL import Image

        carac = caracteristicas(Image.fromarray((rgb_o * 255).astype(np.uint8)), iso)
        return {"original": os.path.basename(original), "final": os.path.basename(final),
                "x": carac.round(5).tolist(), "curvas": curvas_do_par(rgb_o, rgb_f).round(4).tolist()}
    except Exception:
        log.exception("não consegui ler o par %s / %s", original, final)
        return None


# -------------------------------------------------------------------- treino

def treinar(pasta_originais: str, pasta_finais: str, nome: str = "Meu estilo",
            limite: int = 2500, progresso=None, minimo: int = 5) -> dict:
    pares, contagem = parear(pasta_originais, pasta_finais)
    pares = pares[:limite]
    diagnostico = (f"Encontrei {contagem['originais']} originais e {contagem['finais']} finais; "
                   f"juntei {contagem['pares']} pares")
    if contagem["sem_par"]:
        diagnostico += f" ({contagem['sem_par']} finais ficaram sem a original correspondente)"
    diagnostico += "."
    log.info("pares: %s", diagnostico)
    if len(pares) < minimo:
        raise ValueError(
            f"{diagnostico} A IA precisa de pelo menos {minimo} pares. As fotos finais precisam ter "
            "o mesmo nome das originais (ex.: IMG_1234.jpg nas duas pastas) ou manter a data/hora "
            "da foto (no Lightroom, exporte com os metadados).")
    itens = []
    processos = min(8, max(1, (os.cpu_count() or 2) - 1))
    with ProcessPoolExecutor(max_workers=processos) as executor:
        futuros = [executor.submit(_par, o, f) for o, f in pares]
        for n, futuro in enumerate(as_completed(futuros), 1):
            item = futuro.result()
            if item:
                itens.append(item)
            if progresso:
                progresso(n, len(pares))
    if len(itens) < minimo:
        raise ValueError(f"{diagnostico} Só consegui ler {len(itens)} pares.")
    x = np.array([i["x"] for i in itens])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        media, desvio = np.nanmean(x, axis=0), np.nanstd(x, axis=0)
    media = np.where(np.isnan(media), 0.0, media)
    desvio = np.where(np.isnan(desvio) | (desvio < 1e-6), 1.0, desvio)
    return {"tipo": TIPO, "versao": 1, "nome": nome, "fotos": len(itens), "itens": itens,
            "media": media.round(5).tolist(), "desvio": desvio.round(5).tolist(),
            "diagnostico": diagnostico}


def salvar(modelo: dict, caminho: str) -> None:
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(modelo, f, ensure_ascii=False, separators=(",", ":"))


# ----------------------------------------------------------------------- uso

class ModeloPares:
    def __init__(self, dados: dict):
        self.x = np.array([i["x"] for i in dados["itens"]])
        self.curvas = np.array([i["curvas"] for i in dados["itens"]])
        self.media = np.array(dados["media"])
        self.desvio = np.array(dados["desvio"])

    def curvas_para(self, carac: np.ndarray) -> np.ndarray:
        z = np.where(np.isnan((self.x - self.media) / self.desvio), 0.0, (self.x - self.media) / self.desvio)
        zc = np.where(np.isnan((carac - self.media) / self.desvio), 0.0, (carac - self.media) / self.desvio)
        d = np.sqrt(((z - zc) ** 2).sum(axis=1))
        k = min(VIZINHOS, len(d))
        idx = np.argsort(d)[:k]
        pesos = 1.0 / (d[idx] + 0.3)
        pesos /= pesos.sum()
        return np.tensordot(pesos, self.curvas[idx], axes=1)

    def ajustar(self, ajustes: dict, rgb: np.ndarray, iso, forca: float) -> tuple[dict, dict]:
        from PIL import Image

        carac = caracteristicas(Image.fromarray((rgb * 255).astype(np.uint8)), iso)
        curvas = self.curvas_para(carac)
        curvas = PONTOS + (curvas - PONTOS) * forca
        final = dict(ajustes)
        for canal, chave in enumerate(("curva_par_r", "curva_par_g", "curva_par_b")):
            final[chave] = [[round(x * 255, 1), round(y * 255, 1)] for x, y in zip(PONTOS, curvas[canal])]
        final["auto_exposicao"] = 0
        final["auto_balanco_branco"] = 0
        # resumo para a tela: quanto clareou/escureceu os meios-tons e quanto esquentou
        meio = len(PONTOS) // 2
        media = curvas[:, meio].mean()
        ev = float(np.log2(max(media, 1e-3) / 0.5) * 2.2)
        quente = float((curvas[0, meio] - curvas[2, meio]) * 100)
        contraste = float(((curvas[:, 24] - curvas[:, 8]).mean() - 0.5) * 200)
        diferencas = {k: round(v, 2) for k, v in (("exposicao", ev), ("temperatura", quente),
                                                  ("contraste", contraste))
                      if abs(v) >= (0.05 if k == "exposicao" else 1)}
        return final, diferencas
