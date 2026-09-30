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


# ------------------------------------------------ formatos reais do Lightroom

def _jpeg_com_xmp_estendido(caminho, ev, temp):
    """JPEG como o Lightroom grava quando a edição passa de 64 KB: XMP principal + estendido."""
    import hashlib
    import io

    buf = io.BytesIO()
    cena(0.6, 1.0, 5).save(buf, "JPEG", quality=90)
    jpeg = buf.getvalue()
    enchimento = "".join(f'<rdf:li>{i}, {i}</rdf:li>' for i in range(9000))  # força > 64 KB
    estendido = (
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" '
        f'crs:Exposure2012="{ev:+.2f}" crs:IncrementalTemperature="{temp:+d}" crs:Shadows2012="+30">'
        f'<crs:MaskGroupBasedCorrections><rdf:Seq>{enchimento}</rdf:Seq></crs:MaskGroupBasedCorrections>'
        '<crs:Look><rdf:Description crs:Name="Perfil"><crs:Parameters><rdf:Description '
        'crs:Exposure2012="+3.00"/></crs:Parameters></rdf:Description></crs:Look>'
        '</rdf:Description></rdf:RDF></x:xmpmeta>').encode()
    guid = hashlib.md5(estendido).hexdigest().upper().encode()
    principal = (
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description rdf:about="" xmlns:xmpNote="http://ns.adobe.com/xmp/note/" '
        f'xmpNote:HasExtendedXMP="{guid.decode()}"/></rdf:RDF></x:xmpmeta>').encode()
    segmentos = b""
    corpo = b"http://ns.adobe.com/xap/1.0/\x00" + principal
    segmentos += b"\xff\xe1" + (len(corpo) + 2).to_bytes(2, "big") + corpo
    for inicio in range(0, len(estendido), 60000):
        parte = estendido[inicio:inicio + 60000]
        corpo = (b"http://ns.adobe.com/xmp/extension/\x00" + guid + len(estendido).to_bytes(4, "big")
                 + inicio.to_bytes(4, "big") + parte)
        segmentos += b"\xff\xe1" + (len(corpo) + 2).to_bytes(2, "big") + corpo
    open(caminho, "wb").write(jpeg[:2] + segmentos + jpeg[2:])
    return len(estendido)


def test_le_xmp_estendido_e_ignora_look(tmp_path):
    from editalote.lightroom import ler_crs

    tamanho = _jpeg_com_xmp_estendido(tmp_path / "IMG_1.jpg", 0.65, -12)
    assert tamanho > 65535
    crs = ler_crs(str(tmp_path / "IMG_1.jpg"))
    assert crs["Exposure2012"] == "+0.65"          # não o +3.00 que está dentro do "Look"
    assert crs["IncrementalTemperature"] == "-12"
    assert "MaskGroupBasedCorrections" in crs
    Image.open(tmp_path / "IMG_1.jpg").load()     # o JPEG continua válido


def test_sidecar_com_nomes_diferentes(tmp_path):
    rng = np.random.default_rng(9)
    for i in range(12):
        brilho, cast = float(rng.uniform(0.3, 1.5)), float(rng.uniform(0.85, 1.2))
        ev, temp = edicao_do_fotografo(brilho, cast)
        cena(brilho, cast, 900 + i).save(tmp_path / f"DSC_{i}.JPG", "JPEG")
        # metade "DSC_1.XMP", metade "DSC_1.JPG.xmp"
        nome = f"DSC_{i}.XMP" if i % 2 else f"DSC_{i}.JPG.xmp"
        (tmp_path / nome).write_text(XMP.format(ev=ev, temp=temp), encoding="utf-8")
    modelo = estilo_ia.treinar(str(tmp_path))
    assert modelo["fotos"] == 12
    assert "12 com edição" in modelo["diagnostico"]


def test_explica_quando_as_fotos_ja_foram_exportadas_editadas(tmp_path):
    xmp = XMP.replace('crs:Contrast2012="+10"', 'crs:Contrast2012="+10" crs:AlreadyApplied="True"')
    for i in range(12):
        cena(0.8, 1.0, 950 + i).save(tmp_path / f"IMG_{i}.jpg", "JPEG",
                                     xmp=xmp.format(ev=0.3, temp=5).encode())
    with pytest.raises(ValueError) as erro:
        estilo_ia.treinar(str(tmp_path))
    assert "12 já exportadas com a edição aplicada" in str(erro.value)
    assert "originais" in str(erro.value)


def test_pasta_sem_nada_diz_o_que_achou(tmp_path):
    for i in range(3):
        cena(0.8, 1.0, i).save(tmp_path / f"IMG_{i}.jpg", "JPEG")
    with pytest.raises(ValueError, match="Encontrei 3 fotos JPEG, 0 arquivos .xmp, 0 com edição"):
        estilo_ia.treinar(str(tmp_path))


def test_comando_aprender(tmp_path, monkeypatch):
    from editalote import __main__ as cli
    from editalote import servidor

    (tmp_path / "exportado").mkdir()
    evento(tmp_path / "exportado", 15, semente=12)
    monkeypatch.setattr(servidor, "PASTA_PRESETS", str(tmp_path / "presets"))
    monkeypatch.setattr(servidor, "RAIZ", str(tmp_path))
    assert cli.main(["aprender", str(tmp_path / "exportado"), "--nome", "Estilo Durães"]) == 0
    assert (tmp_path / "presets" / "estilo-duraes.json").is_file()
    assert (tmp_path / "presets" / "estilos" / "estilo-duraes.json").is_file()
