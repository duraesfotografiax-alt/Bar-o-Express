"""Núcleo de edição de cor.

Todo o ajuste de cor (auto exposição, balanço de branco, contraste, sombras,
saturação, LUT .cube...) é convertido numa única tabela 3D (LUT de 65 pontos)
calculada em ponto flutuante. O Pillow aplica essa tabela em C, com
interpolação trilinear, sem passar a foto várias vezes por 8 bits. Resultado:
rápido (~1 s por foto de 24 MP) e sem perda acumulada de qualidade.
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageFilter

from .lut_cube import LutCube

TAMANHO_LUT = 65  # máximo aceito pelo Pillow; quanto maior, mais precisa

# Pesos de luminância Rec.709 / sRGB
PESOS_Y = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)

AJUSTES_PADRAO: dict = {
    "nome": "Natural",
    "auto_tom": 0,               # botão Auto (como o do Lightroom): 0 = desligado, 100 = força total
    "realce_pessoas": 0,         # 0..100: clareia e destaca as pessoas (e de leve o cenário)
    "melhorar_qualidade": 0,     # 0..100: tira ruído (ISO alto) e realça os detalhes
    # Cortar, girar e geometria (ver geometria.py)
    "girar": 0,                  # 0, 90, 180, 270 (sentido horário)
    "espelhar": 0,               # 0/1
    "endireitar": 0.0,           # graus, -45..45 (positivo = horário)
    "perspectiva_v": 0,          # -100..100
    "perspectiva_h": 0,          # -100..100
    "corte": None,               # [x0, y0, x1, y1] em 0..1, depois da geometria
    "proporcao": "original",     # só para a tela: proporção travada do corte
    "remover": None,             # traços do pincel "Remover objeto" (ver remover.py)
    "auto_exposicao": 0.7,       # 0 = desligado, 1 = corrige tudo
    "auto_balanco_branco": 0.4,  # 0 = desligado, 1 = neutro total
    "exposicao": 0.0,            # em EV (stops), -2..2
    "contraste": 0,              # -100..100
    "realces": 0,                # -100..100
    "sombras": 0,                # -100..100
    "brancos": 0,                # -100..0 (negativo "apaga" o branco estourado)
    "pretos": 0,                 # -100..100 (positivo = preto "lavado"/matte)
    "temperatura": 0,            # -100 (frio) .. 100 (quente)
    "matiz": 0,                  # -100 (verde) .. 100 (magenta)
    "saturacao": 0,              # -100..100
    "vibracao": 0,               # -100..100 (protege cores já saturadas)
    "nitidez": 0,                # 0..100
    "claridade": 0,              # -100..100 (contraste local, como a Claridade do Lightroom)
    "textura": 0,                # -100..100 (detalhes finos; negativo suaviza a pele)
    # Curva por regiões (igual à curva paramétrica do Lightroom), -100..100
    "curva_sombras": 0,
    "curva_escuros": 0,
    "curva_claros": 0,
    "curva_realces": 0,
    # Curva de pontos (igual à do Lightroom): [[x, y], ...] em 0..255, ou None
    "curva": None,
    "curva_r": None,
    "curva_g": None,
    "curva_b": None,
    # Curva calculada pela IA de referência para cada foto (não aparece na tela)
    "curva_ref": None,
    # Curvas por canal calculadas pela IA de pares para cada foto (não aparecem na tela)
    "curva_par_r": None,
    "curva_par_g": None,
    "curva_par_b": None,
    "lut": None,                 # caminho de arquivo .cube
    "lut_intensidade": 100,      # 0..100
    "estilo_ia": None,           # modelo da IA de estilo (presets/estilos/*.json)
    "ia_forca": 100,             # 0..100: quanto a IA ajusta cada foto
    "cameras": {},               # ajustes finos por câmera (ver ajustes_para_camera)
}

# HSL / Cor: mesmas 8 faixas do Lightroom (centro do matiz em graus)
CORES_HSL = (("vermelho", 0), ("laranja", 30), ("amarelo", 60), ("verde", 120),
             ("aqua", 180), ("azul", 240), ("roxo", 270), ("magenta", 300))
PROPRIEDADES_HSL = ("matiz", "sat", "lum")
for _cor, _ in CORES_HSL:
    for _prop in PROPRIEDADES_HSL:
        AJUSTES_PADRAO[f"hsl_{_prop}_{_cor}"] = 0  # -100..100

CAMPOS_POR_CAMERA = ("exposicao", "temperatura", "matiz", "saturacao")


CAMPOS_ANULAVEIS = ("remover", "corte", "lut", "curva", "curva_r", "curva_g", "curva_b", "curva_ref", "estilo_ia",
                    "curva_par_r", "curva_par_g", "curva_par_b")


def completar_ajustes(ajustes: dict | None) -> dict:
    final = dict(AJUSTES_PADRAO)
    if ajustes:
        final.update({k: v for k, v in ajustes.items() if v is not None or k in CAMPOS_ANULAVEIS})
    return final


def ajustes_para_camera(ajustes: dict, camera: str | None) -> dict:
    """Soma os ajustes finos da câmera (ex.: Sony um pouco mais quente) ao preset."""
    extra = (ajustes.get("cameras") or {}).get(camera or "", {})
    if not extra:
        return ajustes
    final = dict(ajustes)
    for campo in CAMPOS_POR_CAMERA:
        if campo in extra:
            final[campo] = float(final.get(campo, 0)) + float(extra[campo] or 0)
    return final


def chave_foto(caminho: str) -> str:
    """Mesma foto = mesma chave, mesmo com barras ou maiúsculas diferentes (Windows)."""
    return os.path.normcase(os.path.abspath(caminho))


def ajustes_individuais(ajustes: dict, caminho: str) -> dict:
    """Soma os ajustes feitos só nesta foto ("Só esta foto" na tela) aos ajustes de todas."""
    por_foto = ajustes.get("por_foto") or {}
    final = {k: v for k, v in ajustes.items() if k != "por_foto"}
    extra = por_foto.get(chave_foto(caminho)) or por_foto.get(caminho) or {}
    numero = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
    for campo, valor in extra.items():
        if numero(valor) and (numero(final.get(campo, 0)) or final.get(campo) is None):
            final[campo] = float(final.get(campo, 0) or 0) + float(valor)   # controles: diferença
        else:
            final[campo] = valor                                           # corte, proporção: troca
    return final


# ---------------------------------------------------------------- cor básica

def srgb_para_linear(v: np.ndarray) -> np.ndarray:
    v = np.clip(v, 0.0, None)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def linear_para_srgb(v: np.ndarray) -> np.ndarray:
    v = np.clip(v, 0.0, None)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055)


def _suave(a: float, b: float, v: np.ndarray) -> np.ndarray:
    t = np.clip((v - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------- curvas

def avaliar_curva(pontos, x: np.ndarray) -> np.ndarray:
    """Curva monotônica suave (PCHIP) pelos pontos [[x, y], ...] em 0..255."""
    pts = sorted((float(px), float(py)) for px, py in pontos)
    xs, ys = [], []
    for px, py in pts:
        px = min(max(px, 0.0), 255.0) / 255.0
        py = min(max(py, 0.0), 255.0) / 255.0
        if xs and px - xs[-1] < 1e-6:
            ys[-1] = py
        else:
            xs.append(px)
            ys.append(py)
    if len(xs) < 2:
        return x
    xs_a, ys_a = np.array(xs), np.array(ys)
    h = np.diff(xs_a)
    d = np.diff(ys_a) / h
    m = np.empty(len(xs_a))
    m[0], m[-1] = d[0], d[-1]
    for k in range(1, len(xs_a) - 1):
        if d[k - 1] * d[k] <= 0:
            m[k] = 0.0
        else:
            w1, w2 = 2 * h[k] + h[k - 1], h[k] + 2 * h[k - 1]
            m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])
    xc = np.clip(x, xs_a[0], xs_a[-1])
    i = np.clip(np.searchsorted(xs_a, xc, side="right") - 1, 0, len(xs_a) - 2)
    t = (xc - xs_a[i]) / h[i]
    t2, t3 = t * t, t * t * t
    y = ((2 * t3 - 3 * t2 + 1) * ys_a[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
         + (-2 * t3 + 3 * t2) * ys_a[i + 1] + (t3 - t2) * h[i] * m[i + 1])
    # fora dos pontos extremos a curva fica plana (como no Lightroom)
    return np.clip(y, 0.0, 1.0)


def _curva_regioes(a: dict) -> list | None:
    valores = [float(a.get(k, 0) or 0) / 100.0 for k in
               ("curva_sombras", "curva_escuros", "curva_claros", "curva_realces")]
    if not any(valores):
        return None
    xs = (0.125, 0.375, 0.625, 0.875)
    pontos = [[0, 0]] + [[x * 255, (x + 0.12 * v) * 255] for x, v in zip(xs, valores)] + [[255, 255]]
    return pontos


# ------------------------------------------------------------------ HSL / Cor

def rgb_para_hsv(v: np.ndarray):
    maximo = v.max(axis=-1)
    minimo = v.min(axis=-1)
    croma = maximo - minimo
    r, g, b = v[..., 0], v[..., 1], v[..., 2]
    seguro = np.where(croma > 1e-9, croma, 1.0)
    h = np.where(maximo == r, ((g - b) / seguro) % 6,
                 np.where(maximo == g, (b - r) / seguro + 2, (r - g) / seguro + 4)) * 60.0
    h = np.where(croma > 1e-9, h, 0.0)
    s = np.where(maximo > 1e-9, croma / np.where(maximo > 1e-9, maximo, 1.0), 0.0)
    return h, s, maximo


def hsv_para_rgb(h: np.ndarray, s: np.ndarray, v: np.ndarray) -> np.ndarray:
    h = (h % 360.0) / 60.0
    c = v * s
    x = c * (1 - np.abs(h % 2 - 1))
    m = v - c
    setor = np.floor(h).astype(np.int64) % 6
    zero = np.zeros_like(c)
    r = np.choose(setor, [c, x, zero, zero, x, c])
    g = np.choose(setor, [x, c, c, x, zero, zero])
    b = np.choose(setor, [zero, zero, x, c, c, x])
    return np.stack([r + m, g + m, b + m], axis=-1)


def pesos_cor(h: np.ndarray) -> np.ndarray:
    """Quanto cada pixel pertence a cada uma das 8 faixas (soma 1, transição suave)."""
    centros = [c for _, c in CORES_HSL] + [360.0]
    pesos = np.zeros(h.shape + (len(CORES_HSL),))
    for k in range(len(CORES_HSL)):
        c0, c1 = centros[k], centros[k + 1]
        dentro = (h >= c0) & (h < c1)
        t = np.clip((h - c0) / (c1 - c0), 0.0, 1.0)
        t = t * t * (3 - 2 * t)
        pesos[..., k] += np.where(dentro, 1 - t, 0.0)
        pesos[..., (k + 1) % len(CORES_HSL)] += np.where(dentro, t, 0.0)
    return pesos


def _aplicar_hsl(v: np.ndarray, a: dict) -> np.ndarray:
    valores = {p: np.array([float(a.get(f"hsl_{p}_{cor}", 0) or 0) / 100.0 for cor, _ in CORES_HSL])
               for p in PROPRIEDADES_HSL}
    if not any(np.any(x) for x in valores.values()):
        return v
    h, s, brilho = rgb_para_hsv(v)
    pesos = pesos_cor(h)
    h2 = h + (pesos @ valores["matiz"]) * 30.0             # ±100 = ±30°
    s2 = np.clip(s * (1 + pesos @ valores["sat"]), 0.0, 1.0)
    rgb = hsv_para_rgb(h2, s2, brilho)
    # luminância: só em cores saturadas (cinza/branco do vestido não mudam)
    fator = 2.0 ** ((pesos @ valores["lum"]) * 0.8 * s)
    return np.clip(rgb * fator[..., None], 0.0, 1.0)


# ---------------------------------------------------------- análise automática

@dataclass
class Analise:
    """Medições de uma foto usadas pelas correções automáticas e pelo relatório."""

    ganhos_bb: np.ndarray = field(default_factory=lambda: np.ones(3))
    ev_auto: float = 0.0
    nitidez: float = 0.0          # variância do Laplaciano (maior = mais nítida)
    luminancia_media: float = 0.0
    estourada: float = 0.0        # fração de pixels estourados


def carregar_reduzida(caminho: str, lado: int = 1000) -> Image.Image:
    """Abre o JPEG já reduzido (decodificação rápida por 'draft')."""
    from .geometria import orientar

    img = Image.open(caminho)
    img.draft("RGB", (lado, lado))
    img = orientar(img).convert("RGB")      # foto feita em pé aparece em pé
    img.thumbnail((lado, lado), Image.Resampling.BILINEAR)
    return img


def analisar(img: Image.Image) -> Analise:
    arr = np.asarray(img, dtype=np.float32) / np.float32(255.0)
    # tabela de 256 valores em vez de potência pixel a pixel (bem mais rápido)
    tabela_lin = srgb_para_linear(np.arange(256) / 255.0).astype(np.float32)
    lin = tabela_lin[np.asarray(img)]
    pesos = PESOS_Y.astype(np.float32)
    y_lin = lin @ pesos
    y_srgb = arr @ pesos
    maximo = arr.max(axis=2)

    # Balanço de branco "gray world" só nos tons médios não estourados.
    meios = (y_srgb > 0.12) & (y_srgb < 0.88) & (maximo < 0.97)
    if meios.sum() > 500:
        medias = lin[meios].mean(axis=0, dtype=np.float64)
        ganhos = medias[1] / np.maximum(medias, 1e-6)
        ganhos = np.clip(ganhos, 0.75, 1.33)
    else:
        ganhos = np.ones(3)

    # Exposição automática pela média logarítmica (como um fotômetro matricial).
    validos = maximo < 0.99
    base = y_lin[validos] if validos.sum() > 500 else y_lin.ravel()
    media_log = float(np.exp(np.mean(np.log(base + 1e-4), dtype=np.float64)))
    ev = float(np.log2(0.18 / max(media_log, 1e-4)))
    # zona de tolerância: foto até ~1/6 de stop do alvo fica como o fotógrafo fez
    ev = float(np.sign(ev) * max(0.0, abs(ev) - 0.15))
    ev = float(np.clip(ev, -1.0, 1.5))
    if ev > 0:
        # não empurra os realces (vestido de noiva!) além do branco
        p99 = float(np.percentile(y_lin, 99))
        if p99 > 1e-3:
            ev = min(ev, max(0.0, float(np.log2(1.15 / p99))))

    # Nitidez: variância do Laplaciano na imagem em cinza.
    cinza = y_srgb
    lap = (
        -4 * cinza[1:-1, 1:-1]
        + cinza[:-2, 1:-1] + cinza[2:, 1:-1]
        + cinza[1:-1, :-2] + cinza[1:-1, 2:]
    )
    return Analise(
        ganhos_bb=ganhos,
        ev_auto=ev,
        nitidez=float(lap.var(dtype=np.float64) * 1e4),
        luminancia_media=float(y_srgb.mean()),
        estourada=float((maximo >= 0.995).mean()),
    )


# ------------------------------------------------------------- transformação

def _ganhos_temperatura(temperatura: float, matiz: float) -> np.ndarray:
    t = temperatura / 100.0
    m = matiz / 100.0
    return np.array([2 ** (0.25 * t), 2 ** (-0.15 * m), 2 ** (-0.25 * t)])


def _normalizar_ganhos(g: np.ndarray) -> np.ndarray:
    return g / float(g @ PESOS_Y)


def transformar(rgb: np.ndarray, ajustes: dict, analise: Analise | None,
                lut: LutCube | None = None) -> np.ndarray:
    """Aplica todos os ajustes a um array (..., 3) de valores sRGB em 0..1."""
    a = ajustes
    ganhos = np.ones(3)
    ev = float(a.get("exposicao", 0.0))
    if analise is not None:
        forca_bb = float(a.get("auto_balanco_branco", 0))
        ganhos = ganhos * analise.ganhos_bb ** forca_bb
        ev += analise.ev_auto * float(a.get("auto_exposicao", 0))
    ganhos = ganhos * _ganhos_temperatura(float(a.get("temperatura", 0)),
                                          float(a.get("matiz", 0)))
    ganhos = _normalizar_ganhos(ganhos) * (2.0 ** ev)

    # 1) balanço de branco + exposição em luz linear (é como a física funciona)
    lin = srgb_para_linear(rgb) * ganhos
    v = linear_para_srgb(lin)

    # 2) compressão suave dos realces em vez de estourar
    vmax = float(linear_para_srgb(np.array([ganhos.max()]))[0])
    joelho = 0.85
    if vmax > 1.0:
        u = (v - joelho) / (1 - joelho)
        umax = (vmax - joelho) / (1 - joelho)
        c = (umax - 1) / umax
        comprimido = joelho + (1 - joelho) * u / (1 + c * np.maximum(u, 0))
        v = np.where(v > joelho, comprimido, v)
    v = np.clip(v, 0.0, 1.0)

    # 3) curva de tons (por canal, como a curva do Lightroom/Photoshop)
    sombras = float(a.get("sombras", 0)) / 100.0
    if sombras:
        bump = np.where(v < 0.5, 4 * v * (0.5 - v), 0.0)
        v = v + 0.4 * sombras * bump
    realces = float(a.get("realces", 0)) / 100.0
    if realces:
        bump = np.where(v > 0.5, 4 * (v - 0.5) * (1 - v), 0.0)
        v = v + 0.4 * realces * bump
    contraste = float(a.get("contraste", 0)) / 100.0
    if contraste:
        curva_s = v * v * (3 - 2 * v)
        v = v + 0.6 * contraste * (curva_s - v)
    pretos = float(a.get("pretos", 0)) / 100.0
    if pretos > 0:
        m = 0.12 * pretos
        v = m + v * (1 - m)
    elif pretos < 0:
        m = 0.06 * -pretos
        v = np.clip((v - m) / (1 - m), 0.0, 1.0)
    brancos = float(a.get("brancos", 0)) / 100.0
    if brancos < 0:
        v = v * (1 - 0.12 * -brancos)
    elif brancos > 0:
        v = np.clip(v / (1 - 0.06 * brancos), 0.0, 1.0)
    v = np.clip(v, 0.0, 1.0)

    # 3b) curvas: a da IA de referência, depois por regiões e a de pontos (ordem do Lightroom)
    if a.get("curva_ref"):
        v = avaliar_curva(a["curva_ref"], v)
    for canal, chave in enumerate(("curva_par_r", "curva_par_g", "curva_par_b")):
        if a.get(chave):
            v = v.copy()
            v[..., canal] = avaliar_curva(a[chave], v[..., canal])
    regioes = _curva_regioes(a)
    if regioes:
        v = avaliar_curva(regioes, v)
    if a.get("curva"):
        v = avaliar_curva(a["curva"], v)
    for canal, chave in enumerate(("curva_r", "curva_g", "curva_b")):
        if a.get(chave):
            v = v.copy()
            v[..., canal] = avaliar_curva(a[chave], v[..., canal])

    # 4) saturação e vibração
    saturacao = float(a.get("saturacao", 0)) / 100.0
    vibracao = float(a.get("vibracao", 0)) / 100.0
    if saturacao or vibracao:
        y = (v @ PESOS_Y)[..., None]
        sat_atual = (v.max(axis=-1) - v.min(axis=-1))[..., None]
        fator = 1 + saturacao + vibracao * (1 - np.clip(sat_atual * 1.6, 0, 1))
        v = np.clip(y + (v - y) * fator, 0.0, 1.0)

    # 4b) HSL / Cor (pele, grama, céu…)
    v = _aplicar_hsl(v, a)

    # 5) LUT criativa (.cube)
    if lut is not None:
        intensidade = float(a.get("lut_intensidade", 100)) / 100.0
        if intensidade > 0:
            v = v + (lut.aplicar(v) - v) * intensidade

    return np.clip(v, 0.0, 1.0)


def montar_lut(ajustes: dict, analise: Analise | None,
               lut: LutCube | None = None, tamanho: int = TAMANHO_LUT) -> ImageFilter.Color3DLUT:
    eixo = np.linspace(0.0, 1.0, tamanho)
    # Ordem do Pillow: vermelho varia mais rápido -> índices [b, g, r]
    b, g, r = np.meshgrid(eixo, eixo, eixo, indexing="ij")
    grade = np.stack([r, g, b], axis=-1)
    saida = transformar(grade, ajustes, analise, lut).astype(np.float32)
    return ImageFilter.Color3DLUT(tamanho, saida.reshape(-1), channels=3)


def aplicar(img: Image.Image, ajustes: dict, analise: Analise | None,
            lut: LutCube | None = None, tamanho_lut: int = TAMANHO_LUT) -> Image.Image:
    if img.mode != "RGB":
        img = img.convert("RGB")
    from .geometria import aplicar_geometria, tem_geometria

    if ajustes.get("remover"):   # na foto em pé, antes do corte/giro
        from .remover import remover_objetos

        img = remover_objetos(img, ajustes["remover"])
    if tem_geometria(ajustes):   # corta antes: a cor é aplicada só no que fica
        img = aplicar_geometria(img, ajustes, sem_corte=bool(ajustes.get("_sem_corte")))
    saida = img.filter(montar_lut(ajustes, analise, lut, tamanho_lut))
    claridade = float(ajustes.get("claridade", 0) or 0) / 100.0
    if claridade:
        saida = contraste_local(saida, 0.7 * claridade, lado=600, raio_rel=0.01, so_meios_tons=True)
    textura = float(ajustes.get("textura", 0) or 0) / 100.0
    if textura:
        saida = contraste_local(saida, 0.6 * textura, lado=2400, raio_rel=0.002, so_meios_tons=False)
    realce = float(ajustes.get("realce_pessoas", 0) or 0) / 100.0
    if realce > 0:
        from .assunto import realcar

        saida = realcar(saida, realce)
    qualidade = float(ajustes.get("melhorar_qualidade", 0) or 0) / 100.0
    if qualidade > 0:
        from .qualidade import melhorar

        saida = melhorar(saida, qualidade)
    nitidez = float(ajustes.get("nitidez", 0))
    if nitidez > 0:
        # nitidez 3x3 (metade do custo de uma máscara de nitidez gaussiana)
        k = 0.25 * nitidez / 100.0
        saida = saida.filter(ImageFilter.Kernel((3, 3), [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0],
                                                scale=1))
    return saida


_MASCARA_MEIOS = [int(round(255 * np.sin(np.pi * x / 255.0))) for x in range(256)]


def contraste_local(img: Image.Image, forca: float, lado: int, raio_rel: float,
                    so_meios_tons: bool) -> Image.Image:
    """Claridade/Textura: realça (ou suaviza) a diferença entre o pixel e a vizinhança.

    O desfoque é feito numa cópia reduzida e ampliada de volta: fica rápido em 24 MP e o
    tamanho do efeito é o mesmo na prévia e na foto final (raio relativo ao lado maior).
    """
    largura, altura = img.size
    maior = max(largura, altura)
    escala = min(1.0, lado / maior)
    pequeno = img if escala >= 1.0 else img.resize(
        (max(1, round(largura * escala)), max(1, round(altura * escala))), Image.Resampling.BOX)
    raio = max(0.5, raio_rel * max(pequeno.size))
    borrada = pequeno.filter(ImageFilter.GaussianBlur(raio))
    if borrada.size != img.size:
        borrada = borrada.resize(img.size, Image.Resampling.BILINEAR)
    # blend com alfa negativo = img + forca * (img - borrada), calculado em C pelo Pillow
    resultado = Image.blend(img, borrada, -forca)
    if so_meios_tons:
        mascara = img.convert("L").point(_MASCARA_MEIOS)
        resultado = Image.composite(resultado, img, mascara)
    return resultado


def carregar_lut(ajustes: dict) -> LutCube | None:
    caminho = ajustes.get("lut")
    return LutCube.abrir(caminho) if caminho else None


def previa_jpeg(caminho: str, ajustes: dict, lado: int = 1400, so_geometria: bool = False,
                sem_corte: bool = False) -> tuple[bytes, dict]:
    """Prévia reduzida já editada (mesma análise e mesma IA da exportação).

    Retorna (jpeg, ajustes que a IA de estilo acrescentou nesta foto).
    """
    from .estilo_ia import ajustes_da_foto
    from .metadados import ler_info

    ajustes = ajustes_para_camera(ajustes_individuais(completar_ajustes(ajustes), caminho), ler_info(caminho).camera)
    if so_geometria:   # o "antes" com o mesmo corte/giro, para comparar lado a lado
        from .geometria import aplicar_geometria

        reduzida, _ = _reduzida_da_previa(caminho, lado)
        buf = io.BytesIO()
        aplicar_geometria(reduzida, ajustes, sem_corte=sem_corte).save(buf, "JPEG", quality=85)
        return buf.getvalue(), {}
    ajustes = {**ajustes, "_sem_corte": sem_corte}
    ajustes, ajuste_ia = ajustes_da_foto(ajustes, caminho)
    from .auto_tom import aplicar_auto

    ajustes, ajuste_auto = aplicar_auto(ajustes, caminho)
    ajuste_ia = {**ajuste_ia, **ajuste_auto}
    reduzida, analise = _reduzida_da_previa(caminho, lado)
    # LUT de 33 pontos na prévia: 8x mais rápida de montar e sem diferença visível na tela
    editada = aplicar(reduzida, ajustes, analise, carregar_lut(ajustes), tamanho_lut=33)
    buf = io.BytesIO()
    editada.save(buf, "JPEG", quality=88)
    return buf.getvalue(), ajuste_ia


_cache_previa: dict = {}


def _reduzida_da_previa(caminho: str, lado: int) -> tuple[Image.Image, Analise]:
    """Foto reduzida e análise ficam guardadas: mexer num controle não reabre o JPEG do disco."""
    chave = (caminho, os.path.getmtime(caminho), lado)
    if chave not in _cache_previa:
        reduzida = carregar_reduzida(caminho, max(lado, 1000))
        analise = analisar(reduzida)
        reduzida.thumbnail((lado, lado), Image.Resampling.LANCZOS)
        if len(_cache_previa) >= 6:
            _cache_previa.pop(next(iter(_cache_previa)))
        _cache_previa[chave] = (reduzida, analise)
    return _cache_previa[chave]
