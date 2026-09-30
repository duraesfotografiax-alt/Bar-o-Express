"""IA de estilo: aprende como o estúdio edita cada tipo de foto e repete foto a foto.

Treino: fotos ORIGINAIS com a edição do Lightroom junto (exportação "Original + configurações").
Para cada foto guardamos (a) como ela é — brilho, contraste, cor, ISO — e (b) o que o fotógrafo
fez nela no Lightroom (exposição, temperatura, realces, sombras…).

Uso: numa foto nova, procuramos as fotos de treino mais parecidas (vizinhos mais próximos) e
fazemos a média ponderada do que foi feito nelas. Foto escura de igreja recebe o ajuste que
vocês deram nas fotos escuras de igreja; foto de festa ao ar livre, o das fotos de festa.
"""

from __future__ import annotations

import json
import logging
import os
import statistics
import warnings
from concurrent.futures import ProcessPoolExecutor, as_completed
from functools import lru_cache

import numpy as np
from PIL import Image

from .lightroom import _curva_mediana, converter, ja_aplicada, ler_crs
from .metadados import EXTENSOES
from .processamento import PESOS_Y, carregar_reduzida, srgb_para_linear

log = logging.getLogger("editalote.ia")

VERSAO = 1
VIZINHOS = 8
NOMES_CARACTERISTICAS = [
    "lum_p1", "lum_p5", "lum_p25", "lum_p50", "lum_p75", "lum_p95", "lum_p99",
    "cor_vermelho", "cor_azul", "saturacao", "estourada", "iso",
]
# Ajustes que o modelo prevê foto a foto; o resto do preset fica fixo
FAIXAS = {
    "exposicao": (-4.0, 4.0), "contraste": (-100, 100), "realces": (-100, 100),
    "sombras": (-100, 100), "brancos": (-100, 100), "pretos": (-100, 100),
    "temperatura": (-100, 100), "matiz": (-100, 100), "vibracao": (-100, 100),
    "saturacao": (-100, 100), "claridade": (-100, 100), "textura": (-100, 100),
}
_TABELA_LIN = srgb_para_linear(np.arange(256) / 255.0).astype(np.float32)


# ------------------------------------------------------------ características

def ler_iso(caminho: str) -> float | None:
    try:
        with Image.open(caminho) as img:
            iso = img.getexif().get_ifd(0x8769).get(0x8827)
    except Exception:
        return None
    if isinstance(iso, (tuple, list)):
        iso = iso[0] if iso else None
    try:
        return float(iso) if iso else None
    except (TypeError, ValueError):
        return None


def caracteristicas(img: Image.Image, iso: float | None) -> np.ndarray:
    """Resumo numérico de como a foto é (antes de editar)."""
    bruto = np.asarray(img.convert("RGB"))
    arr = bruto.astype(np.float32) / 255.0
    lin = _TABELA_LIN[bruto]
    y_lin = lin @ PESOS_Y.astype(np.float32)
    log_y = np.log2(y_lin + 1e-4)
    percentis = np.percentile(log_y, [1, 5, 25, 50, 75, 95, 99])
    y = arr @ PESOS_Y.astype(np.float32)
    meios = (y > 0.12) & (y < 0.88)
    if meios.sum() > 200:
        medias = lin[meios].mean(axis=0, dtype=np.float64) + 1e-4
    else:
        medias = lin.reshape(-1, 3).mean(axis=0, dtype=np.float64) + 1e-4
    saturacao = float((arr.max(axis=2) - arr.min(axis=2)).mean())
    estourada = float((arr.max(axis=2) >= 0.995).mean())
    iso_log = float(np.log2(iso)) if iso else np.nan
    return np.array([*percentis, np.log2(medias[0] / medias[1]), np.log2(medias[2] / medias[1]),
                     saturacao, estourada, iso_log], dtype=np.float64)


def caracteristicas_arquivo(caminho: str) -> np.ndarray:
    return caracteristicas(carregar_reduzida(caminho, 500), ler_iso(caminho))


# ----------------------------------------------------------------- treino

def _sidecar(caminho: str, arquivos_da_pasta: dict[str, str]) -> str | None:
    """Acha o .xmp da foto: IMG_1.xmp, IMG_1.XMP ou IMG_1.JPG.xmp (qualquer maiúscula/minúscula)."""
    nome = os.path.basename(caminho).lower()
    for candidato in (os.path.splitext(nome)[0] + ".xmp", nome + ".xmp"):
        if candidato in arquivos_da_pasta:
            return arquivos_da_pasta[candidato]
    return None


class Diagnostico:
    """O que foi encontrado na pasta, para explicar quando o treino não acha edições."""

    def __init__(self):
        self.jpegs = self.xmps = self.com_edicao = self.ja_editadas = self.sem_edicao = 0
        self.ilegiveis = 0

    def texto(self) -> str:
        partes = [f"{self.jpegs} fotos JPEG", f"{self.xmps} arquivos .xmp",
                  f"{self.com_edicao} com edição do Lightroom"]
        if self.ja_editadas:
            partes.append(f"{self.ja_editadas} já exportadas com a edição aplicada (não servem)")
        if self.ilegiveis:
            partes.append(f"{self.ilegiveis} que não consegui abrir")
        return "Encontrei " + ", ".join(partes) + "."


def _pares(pasta: str, limite: int, diag: Diagnostico):
    for raiz, _, nomes in os.walk(pasta):
        arquivos = {n.lower(): os.path.join(raiz, n) for n in nomes}
        diag.xmps += sum(1 for n in arquivos if n.endswith(".xmp"))
        for nome in sorted(nomes):
            if os.path.splitext(nome)[1].lower() not in EXTENSOES:
                continue
            diag.jpegs += 1
            caminho = os.path.join(raiz, nome)
            try:
                crs = ler_crs(caminho)
                if not crs or not converter(crs)[0]:
                    sidecar = _sidecar(caminho, arquivos)
                    if sidecar:
                        crs = ler_crs(sidecar)
            except OSError:
                crs = {}
            if crs and ja_aplicada(crs):
                diag.ja_editadas += 1
                continue
            ajustes, ignorados = converter(crs) if crs else ({}, [])
            if not ajustes:
                diag.sem_edicao += 1
                continue
            diag.com_edicao += 1
            yield caminho, ajustes, ignorados
            limite -= 1
            if limite <= 0:
                return


def _caracteristicas_seguro(caminho: str):
    try:
        return caracteristicas_arquivo(caminho)
    except Exception:  # foto corrompida: fica de fora do treino
        logging.getLogger("editalote.ia").exception("não consegui ler %s", caminho)
        return None


def _normalizar(x: np.ndarray, media: np.ndarray, desvio: np.ndarray) -> np.ndarray:
    z = (x - media) / desvio
    return np.where(np.isnan(z), 0.0, z)


def _prever_matriz(xz_treino, y_treino, xz, k, excluir_proprio=False, bloco=256):
    """Média ponderada dos k vizinhos mais próximos (em blocos para não estourar a memória)."""
    k = min(k, xz_treino.shape[0] - (1 if excluir_proprio else 0))
    saida = np.empty((xz.shape[0], y_treino.shape[1]))
    for inicio in range(0, xz.shape[0], bloco):
        parte = xz[inicio:inicio + bloco]
        d = np.sqrt(((parte[:, None, :] - xz_treino[None, :, :]) ** 2).sum(axis=2))
        if excluir_proprio:
            linhas = np.arange(parte.shape[0])
            d[linhas, inicio + linhas] = np.inf
        idx = np.argpartition(d, k - 1, axis=1)[:, :k]
        dist = np.take_along_axis(d, idx, axis=1)
        pesos = 1.0 / (dist + 0.25)
        pesos /= pesos.sum(axis=1, keepdims=True)
        saida[inicio:inicio + bloco] = (y_treino[idx] * pesos[..., None]).sum(axis=1)
    return saida


def treinar(pasta: str, nome: str = "Meu estilo", limite: int = 2500,
            progresso=None) -> dict:
    """Lê as fotos originais + edições do Lightroom e monta o modelo de estilo."""
    amostras, ignorados = [], set()
    diag = Diagnostico()
    pares = list(_pares(pasta, limite, diag))
    log.info("treino em %s: %s", pasta, diag.texto())
    processos = min(8, max(1, (os.cpu_count() or 2) - 1))
    with ProcessPoolExecutor(max_workers=processos) as executor:
        futuros = {executor.submit(_caracteristicas_seguro, c): (a, ign) for c, a, ign in pares}
        for n, futuro in enumerate(as_completed(futuros), 1):
            carac = futuro.result()
            ajustes, ign = futuros[futuro]
            if carac is not None:
                amostras.append((carac, ajustes))
                ignorados.update(ign)
            else:
                diag.ilegiveis += 1
            if progresso:
                progresso(n, len(pares))
    if len(amostras) < 10:
        dica = ("No Lightroom, selecione as fotos editadas > Exportar > tipo "
                "\"Original + configurações\" e escolha a pasta exportada.")
        if diag.ja_editadas:
            dica = ("Essas fotos foram exportadas já editadas (JPG). A IA precisa das originais: "
                    + dica)
        raise ValueError(f"{diag.texto()} A IA precisa de pelo menos 10 fotos originais com a "
                         f"edição do Lightroom. {dica}")

    x = np.array([a[0] for a in amostras])
    edicoes = [a[1] for a in amostras]
    chaves = sorted(c for c in FAIXAS if any(c in e for e in edicoes))
    y = np.array([[float(e.get(c, 0)) for c in chaves] for e in edicoes])

    with warnings.catch_warnings():  # coluna toda vazia (ex.: fotos sem ISO) vira 0 abaixo
        warnings.simplefilter("ignore", RuntimeWarning)
        media = np.nanmean(x, axis=0)
        desvio = np.nanstd(x, axis=0)
    media = np.where(np.isnan(media), 0.0, media)
    desvio = np.where(np.isnan(desvio) | (desvio < 1e-6), 1.0, desvio)
    xz = _normalizar(x, media, desvio)

    # Padrão fixo do estilo (o que não muda de foto para foto): mediana de tudo
    base: dict = {}
    for chave in {k for e in edicoes for k in e}:
        valores = [e[chave] for e in edicoes if chave in e]
        if chave.startswith("curva") and isinstance(valores[0], list):
            base[chave] = valores[0] if len(valores) == 1 else _curva_mediana(valores)
        elif isinstance(valores[0], (int, float)):
            base[chave] = round(statistics.median([e.get(chave, 0) for e in edicoes]), 2)

    # Quanto a IA acerta: deixa cada foto de fora e prevê pelas outras
    previsto = _prever_matriz(xz, y, xz, VIZINHOS, excluir_proprio=True)
    precisao = {}
    for i, chave in enumerate(chaves):
        erro_ia = float(np.mean(np.abs(previsto[:, i] - y[:, i])))
        erro_fixo = float(np.mean(np.abs(np.median(y[:, i]) - y[:, i])))
        precisao[chave] = {"erro_ia": round(erro_ia, 3), "erro_sem_ia": round(erro_fixo, 3)}

    return {
        "versao": VERSAO, "nome": nome, "fotos": len(amostras),
        "caracteristicas": NOMES_CARACTERISTICAS, "chaves": chaves,
        "media": media.round(5).tolist(), "desvio": desvio.round(5).tolist(),
        "x": xz.round(4).tolist(), "y": y.round(3).tolist(),
        "base": base, "precisao": precisao, "ignorados": sorted(ignorados),
        "diagnostico": diag.texto(),
    }


def treinar_e_salvar(pasta: str, nome: str, pasta_presets: str, arquivo: str,
                     progresso=None, modo: str = "referencia", pasta_finais: str = "") -> dict:
    """Treina e grava o modelo (presets/estilos/<arquivo>.json) e o preset que o usa.

    modo "referencia": aprende das fotos finais entregues (não precisa do Lightroom).
    modo "lightroom": aprende das originais + configurações do Lightroom.
    """
    if modo == "pares":
        from . import estilo_pares

        modelo = estilo_pares.treinar(pasta, pasta_finais, nome, progresso=progresso)
        estilo_pares.salvar(modelo, os.path.join(pasta_presets, "estilos", f"{arquivo}.json"))
        preset = {"nome": nome, "estilo_ia": f"estilos/{arquivo}.json", "ia_forca": 100,
                  "auto_exposicao": 0, "auto_balanco_branco": 0}
        os.makedirs(pasta_presets, exist_ok=True)
        with open(os.path.join(pasta_presets, f"{arquivo}.json"), "w", encoding="utf-8") as f:
            json.dump(preset, f, ensure_ascii=False, indent=2)
        log.info("estilo %r aprendido de %d pares", nome, modelo["fotos"])
        return {"arquivo": f"{arquivo}.json", "fotos": modelo["fotos"], "modo": modo,
                "diagnostico": modelo["diagnostico"], "precisao": {}, "ignorados": []}
    if modo == "referencia":
        from . import estilo_referencia

        modelo = estilo_referencia.treinar(pasta, nome, progresso=progresso)
        estilo_referencia.salvar(modelo, os.path.join(pasta_presets, "estilos", f"{arquivo}.json"))
        preset = {"nome": nome, "estilo_ia": f"estilos/{arquivo}.json", "ia_forca": 100,
                  "auto_exposicao": 0, "auto_balanco_branco": 0}
        with open(os.path.join(pasta_presets, f"{arquivo}.json"), "w", encoding="utf-8") as f:
            json.dump(preset, f, ensure_ascii=False, indent=2)
        log.info("estilo %r aprendido de %d fotos finais", nome, modelo["fotos"])
        return {"arquivo": f"{arquivo}.json", "fotos": modelo["fotos"], "modo": modo,
                "diagnostico": modelo["diagnostico"], "precisao": {}, "ignorados": []}
    modelo = treinar(pasta, nome, progresso=progresso)
    salvar(modelo, os.path.join(pasta_presets, "estilos", f"{arquivo}.json"))
    preset = {**modelo["base"], "nome": nome, "estilo_ia": f"estilos/{arquivo}.json",
              "ia_forca": 100, "auto_exposicao": 0, "auto_balanco_branco": 0}
    os.makedirs(pasta_presets, exist_ok=True)
    with open(os.path.join(pasta_presets, f"{arquivo}.json"), "w", encoding="utf-8") as f:
        json.dump(preset, f, ensure_ascii=False, indent=2)
    log.info("estilo %r treinado com %d fotos", nome, modelo["fotos"])
    return {"arquivo": f"{arquivo}.json", "fotos": modelo["fotos"], "modo": modo,
            "diagnostico": modelo.get("diagnostico", ""),
            "precisao": modelo["precisao"], "ignorados": modelo["ignorados"]}


def salvar(modelo: dict, caminho: str) -> None:
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(modelo, f, ensure_ascii=False, separators=(",", ":"))


# ------------------------------------------------------------------- uso

class Modelo:
    def __init__(self, dados: dict):
        self.chaves = dados["chaves"]
        self.media = np.array(dados["media"])
        self.desvio = np.array(dados["desvio"])
        self.x = np.array(dados["x"])
        self.y = np.array(dados["y"])
        self.base = dados["base"]

    def prever(self, carac: np.ndarray) -> dict:
        z = _normalizar(carac[None, :], self.media, self.desvio)
        linha = _prever_matriz(self.x, self.y, z, VIZINHOS)[0]
        return dict(zip(self.chaves, linha.tolist()))


@lru_cache(maxsize=4)
def _carregar(caminho: str, _mtime: float):
    from .estilo_pares import TIPO as TIPO_PARES, ModeloPares
    from .estilo_referencia import TIPO, ModeloReferencia

    with open(caminho, encoding="utf-8") as f:
        dados = json.load(f)
    if dados.get("tipo") == TIPO_PARES:
        return ModeloPares(dados)
    return ModeloReferencia(dados) if dados.get("tipo") == TIPO else Modelo(dados)


def carregar(caminho: str):
    return _carregar(caminho, os.path.getmtime(caminho))


def ajustes_da_foto(ajustes: dict, caminho_foto: str, reduzida: Image.Image | None = None) -> tuple[dict, dict]:
    """Soma ao preset a diferença que a IA prevê para ESTA foto.

    Os controles da tela mostram o padrão do estilo (mediana). A IA acrescenta só o quanto esta
    foto precisa ser diferente do padrão, multiplicado pela força escolhida. Retorna
    (ajustes finais, diferenças aplicadas).
    """
    caminho_modelo = ajustes.get("estilo_ia")
    forca = float(ajustes.get("ia_forca", 100) or 0) / 100.0
    if not caminho_modelo or forca <= 0 or not os.path.isfile(caminho_modelo):
        return ajustes, {}
    modelo = carregar(caminho_modelo)
    from .estilo_pares import ModeloPares
    from .estilo_referencia import rgb_da_foto

    if isinstance(modelo, ModeloPares):  # IA por pares (original x editada)
        rgb = np.asarray(carregar_reduzida(caminho_foto, 400).convert("RGB"), dtype=np.float64) / 255.0
        return modelo.ajustar(ajustes, rgb, ler_iso(caminho_foto), forca)
    if not isinstance(modelo, Modelo):  # IA por referência (aprendeu das fotos finais)
        return modelo.ajustar(ajustes, rgb_da_foto(caminho_foto), forca)
    img = reduzida if reduzida is not None else carregar_reduzida(caminho_foto, 500)
    previsto = modelo.prever(caracteristicas(img, ler_iso(caminho_foto)))
    final = dict(ajustes)
    diferencas = {}
    for chave, valor in previsto.items():
        delta = (valor - float(modelo.base.get(chave, 0))) * forca
        minimo, maximo = FAIXAS[chave]
        valor_final = float(np.clip(float(final.get(chave, 0) or 0) + delta, minimo, maximo))
        final[chave] = round(valor_final, 3 if chave == "exposicao" else 2)
        if abs(delta) >= (0.05 if chave == "exposicao" else 1):
            diferencas[chave] = round(delta, 2)
    # a IA já faz o papel do "Auto" do Lightroom: desliga o automático próprio
    final["auto_exposicao"] = 0
    final["auto_balanco_branco"] = 0
    return final, diferencas
