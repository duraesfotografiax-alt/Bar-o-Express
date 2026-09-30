import os

import numpy as np
from PIL import Image

from editalote import estilo_pares as ep
from editalote.auto_tom import aplicar_auto, calcular
from editalote.estilo_ia import _carregar, ajustes_da_foto, treinar_e_salvar
from editalote.processamento import aplicar, completar_ajustes
from tests.test_estilo_referencia import cena_final


def editar(img):
    """A "edição do estúdio": mais contraste (curva em S), um pouco mais claro e mais quente."""
    v = np.asarray(img, dtype=float) / 255
    v = np.clip(v * 1.08, 0, 1)
    v = v + 0.35 * (v - 0.5) * (1 - np.abs(2 * v - 1))                    # S
    v = v * np.array([1.04, 1.0, 0.93])
    return Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8))


def lavar(img):
    """Original "esbranquiçada": pretos levantados e pouco contraste."""
    v = np.asarray(img, dtype=float) / 255
    return Image.fromarray(((0.18 + v * 0.7) * 255).astype(np.uint8))


def criar_pares(tmp_path, n=10, renomear=False):
    orig, fin = tmp_path / "originais", tmp_path / "finais"
    orig.mkdir(); fin.mkdir()
    for i in range(n):
        o = cena_final(i)
        o.save(orig / f"IMG_{i:04d}.jpg", quality=95)
        editar(o).save(fin / (f"Casamento-{i}.jpg" if renomear else f"IMG_{i:04d}.jpg"), quality=95)
    return str(orig), str(fin)


def test_pareia_pelo_nome(tmp_path):
    orig, fin = criar_pares(tmp_path, 6)
    pares, contagem = ep.parear(orig, fin)
    assert contagem["pares"] == 6 and contagem["sem_par"] == 0
    assert all(os.path.basename(o) == os.path.basename(f) for o, f in pares)


def test_curva_do_par_aprende_contraste():
    rng = np.random.default_rng(1)
    o = rng.random((50, 50, 3))
    f = np.clip(0.5 + (o - 0.5) * 1.4, 0, 1)
    curvas = ep.curvas_do_par(o, f)
    meio = len(ep.PONTOS) // 2
    assert abs(curvas[0, meio] - 0.5) < 0.05
    assert curvas[0, 8] < ep.PONTOS[8] and curvas[0, 24] > ep.PONTOS[24]   # sombras descem, luzes sobem


def test_treina_e_repete_a_edicao(tmp_path):
    orig, fin = criar_pares(tmp_path, 10)
    presets = tmp_path / "presets"
    presets.mkdir()
    r = treinar_e_salvar(orig, "Durães", str(presets), "duraes", modo="pares", pasta_finais=fin)
    _carregar.cache_clear()
    preset = completar_ajustes({"estilo_ia": str(presets / "estilos" / "duraes.json"), "ia_forca": 100})
    nova = cena_final(99)
    caminho = tmp_path / "nova.jpg"
    nova.save(caminho, quality=95)
    ajustes, dif = ajustes_da_foto(preset, str(caminho))
    assert ajustes.get("curva_par_r")
    saida = np.asarray(aplicar(nova, ajustes, None), dtype=float)
    alvo = np.asarray(editar(nova), dtype=float)
    antes = np.abs(np.asarray(nova, dtype=float) - alvo).mean()
    depois = np.abs(saida - alvo).mean()
    assert depois < antes * 0.5, (antes, depois)


def test_auto_tira_o_aspecto_lavado(tmp_path):
    lavada = lavar(cena_final(3))
    caminho = tmp_path / "lavada.jpg"
    lavada.save(caminho, quality=95)
    ajustes, dif = aplicar_auto(completar_ajustes({"auto_tom": 100}), str(caminho))
    assert ajustes["curva_ref"] and ajustes["auto_exposicao"] == 0
    antes = np.asarray(lavada, dtype=float) / 255
    depois = np.asarray(aplicar(lavada, ajustes, None), dtype=float) / 255
    assert np.percentile(depois, 1) < np.percentile(antes, 1) - 0.08      # pretos de verdade
    assert depois.std() > antes.std() * 1.2                                # mais contraste


def test_auto_desligado_ou_com_ia_nao_mexe(tmp_path):
    caminho = tmp_path / "f.jpg"
    cena_final(1).save(caminho)
    base = completar_ajustes({})
    assert aplicar_auto(base, str(caminho)) == (base, {})
    com_ia = {**base, "auto_tom": 100, "estilo_ia": "estilos/x.json"}
    assert aplicar_auto(com_ia, str(caminho))[1] == {}
    assert "curva_ref" in calcular(np.asarray(cena_final(1), dtype=float) / 255)


def test_auto_segue_o_alvo_das_fotos_prontas(tmp_path):
    from editalote.auto_tom import medir_estilo

    escura = Image.fromarray((np.asarray(cena_final(5), dtype=float) * 0.45).astype(np.uint8))
    caminho = tmp_path / "escura.jpg"
    escura.save(caminho, quality=95)
    clara = medir_estilo([np.asarray(cena_final(i), dtype=float) / 255 for i in range(3)])
    clara["meio"] = 0.6
    ajustes, _ = aplicar_auto(completar_ajustes({"auto_tom": 100, "auto_alvo": clara}), str(caminho))
    saida = np.asarray(aplicar(escura, ajustes, None), dtype=float) / 255
    assert np.median(saida @ [0.2126, 0.7152, 0.0722]) > 0.45
