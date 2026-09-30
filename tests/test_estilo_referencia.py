import numpy as np
import pytest
from PIL import Image, ImageFilter

from editalote import estilo_referencia as er
from editalote.estilo_ia import _carregar, ajustes_da_foto
from editalote.processamento import aplicar, completar_ajustes


def cena_final(semente):
    """Foto "entregue": parede/vestido branco levemente quente, cores da cena variadas."""
    rng = np.random.default_rng(semente)
    luz = np.linspace(1.0, 0.55, 120)[:, None, None] * np.linspace(0.8, 1.0, 80)[None, :, None]
    base = luz * np.array([0.95, 0.92, 0.87])                                # branco quente com luz
    base = base * (1 + rng.normal(0, 0.04, (120, 80, 1)))                    # textura
    for _ in range(6):                                                         # objetos coloridos
        y, x = rng.integers(0, 100), rng.integers(0, 60)
        base[y:y + 20, x:x + 20] = rng.random(3) * 0.7 + 0.1
    base[80:] *= 0.35                                                          # chão escuro
    img = Image.fromarray((base * 255).astype(np.uint8)).resize((400, 600)).filter(ImageFilter.GaussianBlur(3))
    return img


def estragar(img, ev, ganhos):
    lin = er.srgb_para_linear(np.asarray(img, dtype=float) / 255) * 2 ** ev * np.array(ganhos)
    return Image.fromarray((np.clip(lin, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8))


@pytest.fixture
def modelo(tmp_path):
    pasta = tmp_path / "entregues"
    pasta.mkdir()
    for i in range(12):
        cena_final(i).save(pasta / f"final_{i}.jpg", quality=95)
    dados = er.treinar(str(pasta), "Durães")
    er.salvar(dados, str(tmp_path / "estilos" / "duraes.json"))
    _carregar.cache_clear()
    return str(tmp_path / "estilos" / "duraes.json"), dados


def test_treina_com_fotos_finais(modelo):
    _, dados = modelo
    assert dados["tipo"] == "referencia" and dados["fotos"] == 12
    assert "usei 12 como referência" in dados["diagnostico"]


# A cor é corrigida de propósito só até metade do caminho (errar a cor estraga mais a foto),
# então no caso "só a cor errada" a melhora esperada é menor.
@pytest.mark.parametrize("ev,ganhos,melhora", [((-1.0), (0.85, 1.0, 1.2), 0.6),
                                               (0.8, (1.0, 1.0, 1.0), 0.6),
                                               (0.0, (1.15, 1.0, 0.8), 0.8)])
def test_leva_a_foto_ate_o_estilo(modelo, tmp_path, ev, ganhos, melhora):
    caminho_modelo, _ = modelo
    final = cena_final(99)
    original = estragar(final, ev, ganhos)
    original.save(tmp_path / "nova.jpg", quality=95)
    ajustes = completar_ajustes({"estilo_ia": caminho_modelo, "ia_forca": 100,
                                 "auto_exposicao": 0, "auto_balanco_branco": 0})
    final_aj, diferencas = ajustes_da_foto(ajustes, str(tmp_path / "nova.jpg"))
    assert final_aj["curva_ref"] and diferencas
    xs = [p[0] for p in final_aj["curva_ref"]]
    ys = [p[1] for p in final_aj["curva_ref"]]
    assert xs == sorted(xs) and ys == sorted(ys)                 # curva nunca inverte tons
    editada = aplicar(original, final_aj, None)
    erro_antes = np.abs(np.asarray(original, float) - np.asarray(final, float)).mean()
    erro_depois = np.abs(np.asarray(editada, float) - np.asarray(final, float)).mean()
    assert erro_depois < erro_antes * melhora


def test_forca_zero_nao_mexe(modelo, tmp_path):
    caminho_modelo, _ = modelo
    cena_final(5).save(tmp_path / "a.jpg")
    ajustes = completar_ajustes({"estilo_ia": caminho_modelo, "ia_forca": 0})
    final, dif = ajustes_da_foto(ajustes, str(tmp_path / "a.jpg"))
    assert final is ajustes and dif == {}


def test_cor_da_luz_nao_confunde_com_cor_da_cena():
    # mesma luz neutra, cena laranja: a medida da luz deve continuar neutra
    arr = np.ones((200, 200, 3)) * 0.8
    arr[:, 100:] = [0.85, 0.45, 0.15]
    neutro = er.cor_dos_neutros(arr)
    assert abs(np.log2(neutro[0] / neutro[2])) < 0.1


def test_poucas_fotos(tmp_path):
    cena_final(1).save(tmp_path / "a.jpg")
    with pytest.raises(ValueError, match="pelo menos 3 fotos finais"):
        er.treinar(str(tmp_path))
