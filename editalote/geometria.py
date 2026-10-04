"""Cortar, girar e geometria (como a ferramenta Corte e Geometria do Lightroom).

Ordem: girar 90° / espelhar -> perspectiva vertical/horizontal -> endireitar (ângulo fino, com
corte automático das bordas tortas) -> corte escolhido. Tudo em medidas relativas (0..1), então o
mesmo ajuste vale na prévia reduzida e na foto inteira.

Também resolve a orientação da câmera (foto em pé): os pixels são girados de verdade e a etiqueta
Orientation do EXIF vira 1, para todo programa mostrar igual.
"""

from __future__ import annotations

import math
import struct

import numpy as np
from PIL import Image, ImageOps

CAMPOS = ("girar", "espelhar", "endireitar", "perspectiva_v", "perspectiva_h", "corte")


def tem_geometria(a: dict) -> bool:
    return bool((float(a.get("girar", 0) or 0) % 360) or a.get("espelhar")
                or razao_da_proporcao(a.get("proporcao"), 2, 1)
                or float(a.get("endireitar", 0) or 0) or float(a.get("perspectiva_v", 0) or 0)
                or float(a.get("perspectiva_h", 0) or 0) or corte_valido(a.get("corte")))


def corte_valido(corte) -> list[float] | None:
    if not corte or len(corte) != 4:
        return None
    x0, y0, x1, y1 = (min(max(float(v), 0.0), 1.0) for v in corte)
    if x1 - x0 < 0.02 or y1 - y0 < 0.02:
        return None
    if x0 <= 0.0005 and y0 <= 0.0005 and x1 >= 0.9995 and y1 >= 0.9995:
        return None
    return [x0, y0, x1, y1]


def razao_da_proporcao(proporcao, largura: int, altura: int) -> float | None:
    """'4:5' -> largura/altura do corte, virada para combinar com a foto (em pé ou deitada)."""
    if not proporcao or proporcao in ("original", "livre") or ":" not in str(proporcao):
        return None
    a, b = (float(x) for x in str(proporcao).split(":"))
    r = a / b
    if (r > 1) != (largura > altura) and abs(r - 1) > 1e-6:
        r = 1 / r
    return r


def corte_por_proporcao(tamanho, proporcao) -> list[float] | None:
    """Maior corte centralizado com a proporção pedida (para aplicar a mesma em todas as fotos)."""
    w, h = tamanho
    r = razao_da_proporcao(proporcao, w, h)
    if not r:
        return None
    if w / h > r:
        fw = r * h / w
        return corte_valido([(1 - fw) / 2, 0.0, (1 + fw) / 2, 1.0])
    fh = w / (r * h)
    return corte_valido([0.0, (1 - fh) / 2, 1.0, (1 + fh) / 2])


# ------------------------------------------------------------- orientação da câmera

def orientar(img: Image.Image) -> Image.Image:
    """Gira os pixels conforme o EXIF (foto feita em pé)."""
    return ImageOps.exif_transpose(img) if img.getexif().get(0x0112, 1) != 1 else img


def exif_sem_rotacao(exif: bytes) -> bytes:
    """Mesmo EXIF, com Orientation = 1 (os pixels já foram girados). Mexe só nesses 2 bytes."""
    if not exif:
        return exif
    dados = bytearray(exif)
    base = 6 if dados[:6] == b"Exif\x00\x00" else 0
    try:
        ordem = "<" if dados[base:base + 2] == b"II" else ">"
        ifd = struct.unpack_from(ordem + "I", dados, base + 4)[0]
        n = struct.unpack_from(ordem + "H", dados, base + ifd)[0]
        for i in range(n):
            pos = base + ifd + 2 + 12 * i
            if struct.unpack_from(ordem + "H", dados, pos)[0] == 0x0112:
                struct.pack_into(ordem + "H", dados, pos + 8, 1)
                break
    except struct.error:
        return exif
    return bytes(dados)


# --------------------------------------------------------------------- geometria

def _perspectiva(img: Image.Image, v: float, h: float) -> Image.Image:
    """v, h em -100..100. v > 0 abre o topo (prédio/igreja "caindo para trás" fica reto)."""
    w, alt = img.size
    kv, kh = 0.25 * v / 100.0, 0.25 * h / 100.0
    # cantos de ORIGEM (na foto) que vão para os cantos da saída: sup-esq, sup-dir, inf-dir, inf-esq
    tl, tr = [0.0, 0.0], [w, 0.0]
    br, bl = [w, alt], [0.0, alt]
    if kv > 0:   # topo mais estreito na origem = topo esticado na saída
        tl[0] += kv * w; tr[0] -= kv * w
    elif kv < 0:
        bl[0] -= kv * w; br[0] += kv * w
    if kh > 0:   # lado direito
        tr[1] += kh * alt; br[1] -= kh * alt
    elif kh < 0:
        tl[1] -= kh * alt; bl[1] += kh * alt
    destino = [(0, 0), (w, 0), (w, alt), (0, alt)]
    origem = [tl, tr, br, bl]
    a = []
    b = []
    for (x, y), (u, vv) in zip(destino, origem):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        a.append([0, 0, 0, x, y, 1, -vv * x, -vv * y]); b.append(vv)
    coef = np.linalg.solve(np.array(a, dtype=float), np.array(b, dtype=float))
    return img.transform((w, alt), Image.Transform.PERSPECTIVE, tuple(coef), Image.Resampling.BICUBIC)


def _endireitar(img: Image.Image, graus: float) -> Image.Image:
    """Gira o ângulo fino (positivo = horário) e corta as bordas tortas, mantendo a proporção."""
    w, h = img.size
    girada = img.rotate(-graus, resample=Image.Resampling.BICUBIC, expand=False)
    t = math.radians(abs(graus))
    c, s = math.cos(t), math.sin(t)
    escala = min(w / (w * c + h * s), h / (w * s + h * c))
    nw, nh = w * escala, h * escala
    x0, y0 = (w - nw) / 2, (h - nh) / 2
    return girada.crop((round(x0), round(y0), round(x0 + nw), round(y0 + nh)))


def aplicar_geometria(img: Image.Image, a: dict, sem_corte: bool = False) -> Image.Image:
    giro = int(round(float(a.get("girar", 0) or 0) / 90.0)) % 4
    if giro:
        img = img.transpose({1: Image.Transpose.ROTATE_270, 2: Image.Transpose.ROTATE_180,
                             3: Image.Transpose.ROTATE_90}[giro])           # horário
    if int(round(float(a.get("espelhar", 0) or 0))) % 2:
        img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    pv, ph = float(a.get("perspectiva_v", 0) or 0), float(a.get("perspectiva_h", 0) or 0)
    if pv or ph:
        img = _perspectiva(img, pv, ph)
    angulo = float(np.clip(float(a.get("endireitar", 0) or 0), -45, 45))
    if abs(angulo) >= 0.01:
        img = _endireitar(img, angulo)
    corte = None if sem_corte else (corte_valido(a.get("corte"))
                                     or corte_por_proporcao(img.size, a.get("proporcao")))
    if corte:
        w, h = img.size
        img = img.crop((round(corte[0] * w), round(corte[1] * h), round(corte[2] * w), round(corte[3] * h)))
    return img


# -------------------------------------------------------------------- automático

def angulo_automatico(img: Image.Image, detalhes: bool = False):
    """Ângulo (graus, positivo = girar no sentido horário) que deixa horizonte e verticais retos.

    Usa a direção das bordas fortes que estão em regiões de linha reta (blocos coerentes) e procura
    um desvio dominante e concentrado das linhas quase horizontais/verticais. Se as linhas não
    concordam (perspectiva, galhos, cabelo), responde 0: melhor não girar do que girar errado.
    """
    pequeno = img.convert("L")
    pequeno.thumbnail((1000, 1000), Image.Resampling.BILINEAR)
    g = np.asarray(pequeno, dtype=np.float64)
    # Sobel (suaviza na outra direção): ângulo das bordas muito mais preciso que diferença simples
    p = np.pad(g, 1, mode="edge")
    gx = (p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])
    gy = (p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])
    b = 12
    H, W = (g.shape[0] // b) * b, (g.shape[1] // b) * b
    if H < b * 4 or W < b * 4:
        return (0.0, 0.0) if detalhes else 0.0
    gx, gy = gx[:H, :W], gy[:H, :W]
    bloco = lambda m: m.reshape(H // b, b, W // b, b).sum(axis=(1, 3))
    jxx, jyy, jxy = bloco(gx * gx), bloco(gy * gy), bloco(gx * gy)
    coerencia = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / np.maximum(jxx + jyy, 1e-9)
    reto = np.repeat(np.repeat(coerencia > 0.75, b, axis=0), b, axis=1)
    mag = np.hypot(gx, gy)
    forte = reto & (mag > max(np.percentile(mag, 90), 48))
    if forte.sum() < 200:
        return (0.0, 0.0) if detalhes else 0.0
    # direção do gradiente -> quanto a borda desvia de 0°/90° (mesmo valor para os dois)
    desvio = ((np.degrees(np.arctan2(gy[forte], gx[forte])) + 45.0) % 90.0) - 45.0
    pesos = mag[forte]
    perto = np.abs(desvio) < 10
    hist, bordas = np.histogram(desvio[perto], bins=400, range=(-10, 10), weights=pesos[perto])
    hist = np.convolve(hist, np.ones(9) / 9, mode="same")
    pico = int(np.argmax(hist))
    centro = (bordas[pico] + bordas[pico + 1]) / 2
    janela = perto & (np.abs(desvio - centro) < 0.75)
    confianca = float(pesos[janela].sum() / max(pesos[perto].sum(), 1e-9))
    if confianca < 0.12:
        return (0.0, round(confianca, 3)) if detalhes else 0.0
    # gradiente girado no sentido horário na tela (y para baixo) = foto torta no horário
    estimativa = -float(np.median(desvio[janela]))
    angulo = _refinar(pequeno, estimativa)
    angulo = round(angulo, 2) if abs(angulo) >= 0.15 else 0.0
    return (angulo, round(confianca, 3)) if detalhes else angulo


def _refinar(cinza: Image.Image, estimativa: float) -> float:
    """Acerta o ângulo fino: o giro certo deixa as linhas alinhadas às linhas/colunas de pixels,
    o que concentra as bordas em poucas linhas e colunas (perfil de projeção mais "pontudo")."""
    pequeno = cinza.copy()
    pequeno.thumbnail((700, 700), Image.Resampling.BILINEAR)
    w, h = pequeno.size
    margem = int(0.12 * min(w, h))

    def nota(angulo):
        g = np.asarray(pequeno.rotate(-angulo, resample=Image.Resampling.BILINEAR), dtype=np.float64)
        g = g[margem:h - margem, margem:w - margem]
        dy = np.abs(np.diff(g, axis=0)).sum(axis=1)
        dx = np.abs(np.diff(g, axis=1)).sum(axis=0)
        return float(dy.var() / max(dy.mean(), 1e-9) ** 2 + dx.var() / max(dx.mean(), 1e-9) ** 2)

    candidatos = np.arange(estimativa - 1.5, estimativa + 1.51, 0.25)   # só confirma/afina a estimativa
    melhor = max(candidatos, key=nota)
    finos = np.arange(melhor - 0.25, melhor + 0.26, 0.05)
    return float(np.clip(max(finos, key=nota), -15, 15))
