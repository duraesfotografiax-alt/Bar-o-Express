import numpy as np
import pytest
from PIL import Image, ImageFilter

from editalote import estilo_ia
from editalote.processamento import AJUSTES_PADRAO, completar_ajustes

XMP = """<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    crs:Exposure2012="{ev:+.2f}" crs:IncrementalTemperature="{temp:+d}"
    crs:Shadows2012="+30" crs:Contrast2012="+10"/>
 </rdf:RDF>
</x:xmpmeta>"""


def cena(brilho, cast, semente):
    rng = np.random.default_rng(semente)
    base = rng.random((60, 90, 3)) * 0.6 + 0.2
    img = Image.fromarray((base * 255).astype(np.uint8)).resize((360, 240)).filter(ImageFilter.GaussianBlur(2))
    arr = np.asarray(img, dtype=float) / 255.0
    lin = arr ** 2.2 * brilho * np.array([cast, 1.0, 1.0 / cast])
    return Image.fromarray((np.clip(lin, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8))


def edicao_do_fotografo(brilho, cast):
    """O "estilo" que a IA tem de descobrir sozinha."""
    return round(-np.log2(brilho) * 0.9 + 0.2, 2), int(round(-40 * np.log2(cast)))


def evento(pasta, n, semente, com_xmp=True, sidecar=False):
    rng = np.random.default_rng(semente)
    fotos = []
    for i in range(n):
        brilho, cast = float(rng.uniform(0.25, 1.6)), float(rng.uniform(0.8, 1.3))
        ev, temp = edicao_do_fotografo(brilho, cast)
        caminho = pasta / f"IMG_{i:04d}.jpg"
        xmp = XMP.format(ev=ev, temp=temp).encode()
        if com_xmp and not sidecar:
            cena(brilho, cast, semente * 1000 + i).save(caminho, "JPEG", quality=92, xmp=xmp)
        else:
            cena(brilho, cast, semente * 1000 + i).save(caminho, "JPEG", quality=92)
            if com_xmp:
                (pasta / f"IMG_{i:04d}.xmp").write_bytes(xmp)
        fotos.append((caminho, ev, temp))
    return fotos


@pytest.mark.parametrize("sidecar", [False, True])
def test_ia_aprende_o_estilo_foto_a_foto(tmp_path, sidecar):
    treino = tmp_path / "treino"
    treino.mkdir()
    evento(treino, 80, semente=1, sidecar=sidecar)
    modelo = estilo_ia.treinar(str(treino), "Teste")
    assert modelo["fotos"] == 80
    assert set(modelo["chaves"]) >= {"exposicao", "temperatura", "sombras"}
    assert modelo["base"]["sombras"] == 30
    # a IA precisa errar bem menos que usar um valor fixo para todas as fotos
    p = modelo["precisao"]["exposicao"]
    assert p["erro_ia"] < p["erro_sem_ia"] * 0.5

    caminho_modelo = tmp_path / "estilos" / "teste.json"
    estilo_ia.salvar(modelo, str(caminho_modelo))

    novas = tmp_path / "novas"
    novas.mkdir()
    erros_ev, erros_temp = [], []
    ajustes = completar_ajustes({**modelo["base"], "estilo_ia": str(caminho_modelo)})
    for caminho, ev, temp in evento(novas, 20, semente=2, com_xmp=False):
        final, diferencas = estilo_ia.ajustes_da_foto(ajustes, str(caminho))
        erros_ev.append(abs(final["exposicao"] - ev))
        erros_temp.append(abs(final["temperatura"] - temp))
        assert final["auto_exposicao"] == 0 and final["sombras"] == 30
    assert np.mean(erros_ev) < 0.25          # stops
    assert np.mean(erros_temp) < 5


def test_forca_zero_desliga_a_ia(tmp_path):
    evento(tmp_path, 12, semente=3)
    modelo = estilo_ia.treinar(str(tmp_path))
    estilo_ia.salvar(modelo, str(tmp_path / "m.json"))
    ajustes = {**AJUSTES_PADRAO, "exposicao": 0.5, "estilo_ia": str(tmp_path / "m.json"), "ia_forca": 0}
    final, diferencas = estilo_ia.ajustes_da_foto(ajustes, str(tmp_path / "IMG_0000.jpg"))
    assert final is ajustes and diferencas == {}


def test_poucas_fotos_explica_o_que_fazer(tmp_path):
    evento(tmp_path, 3, semente=4)
    with pytest.raises(ValueError, match="Original \\+ configurações"):
        estilo_ia.treinar(str(tmp_path))
