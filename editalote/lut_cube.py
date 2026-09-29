"""Leitura e aplicação de LUTs no formato .cube (Adobe/Resolve)."""

from __future__ import annotations

from functools import lru_cache

import numpy as np


class LutCube:
    def __init__(self, tabela: np.ndarray, minimo=(0.0, 0.0, 0.0), maximo=(1.0, 1.0, 1.0)):
        # tabela no formato [r, g, b, canal]
        self.tabela = tabela
        self.tamanho = tabela.shape[0]
        self.minimo = np.asarray(minimo, dtype=np.float64)
        self.maximo = np.asarray(maximo, dtype=np.float64)

    @staticmethod
    @lru_cache(maxsize=8)
    def abrir(caminho: str) -> "LutCube":
        with open(caminho, encoding="utf-8", errors="replace") as f:
            return LutCube.ler(f.read())

    @staticmethod
    def ler(texto: str) -> "LutCube":
        tamanho = None
        minimo, maximo = (0.0, 0.0, 0.0), (1.0, 1.0, 1.0)
        valores: list[list[float]] = []
        for linha in texto.splitlines():
            linha = linha.strip()
            if not linha or linha.startswith("#"):
                continue
            partes = linha.split()
            chave = partes[0].upper()
            if chave == "LUT_3D_SIZE":
                tamanho = int(partes[1])
            elif chave == "DOMAIN_MIN":
                minimo = tuple(float(x) for x in partes[1:4])
            elif chave == "DOMAIN_MAX":
                maximo = tuple(float(x) for x in partes[1:4])
            elif chave in ("TITLE", "LUT_1D_SIZE", "LUT_3D_INPUT_RANGE", "LUT_1D_INPUT_RANGE"):
                if chave == "LUT_1D_SIZE":
                    raise ValueError("LUT 1D não é suportada, use uma LUT 3D (.cube)")
                continue
            else:
                try:
                    valores.append([float(x) for x in partes[:3]])
                except ValueError:
                    continue
        if not tamanho:
            raise ValueError("Arquivo .cube sem LUT_3D_SIZE")
        if len(valores) != tamanho ** 3:
            raise ValueError(f"LUT .cube incompleta: {len(valores)} de {tamanho ** 3} linhas")
        # No .cube o vermelho varia mais rápido: ordem [b, g, r]
        arr = np.array(valores, dtype=np.float64).reshape(tamanho, tamanho, tamanho, 3)
        return LutCube(arr.transpose(2, 1, 0, 3).copy(), minimo, maximo)

    def aplicar(self, rgb: np.ndarray) -> np.ndarray:
        """Interpolação trilinear de um array (..., 3) em 0..1."""
        n = self.tamanho - 1
        x = (rgb - self.minimo) / (self.maximo - self.minimo)
        x = np.clip(x, 0.0, 1.0) * n
        i0 = np.minimum(np.floor(x).astype(np.int64), n - 1)
        f = x - i0
        r0, g0, b0 = i0[..., 0], i0[..., 1], i0[..., 2]
        fr, fg, fb = f[..., 0:1], f[..., 1:2], f[..., 2:3]
        t = self.tabela

        def c(dr, dg, db):
            return t[r0 + dr, g0 + dg, b0 + db]

        c00 = c(0, 0, 0) * (1 - fr) + c(1, 0, 0) * fr
        c10 = c(0, 1, 0) * (1 - fr) + c(1, 1, 0) * fr
        c01 = c(0, 0, 1) * (1 - fr) + c(1, 0, 1) * fr
        c11 = c(0, 1, 1) * (1 - fr) + c(1, 1, 1) * fr
        c0 = c00 * (1 - fg) + c10 * fg
        c1 = c01 * (1 - fg) + c11 * fg
        return c0 * (1 - fb) + c1 * fb
