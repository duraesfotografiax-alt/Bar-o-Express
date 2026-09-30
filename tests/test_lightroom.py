import numpy as np
from PIL import Image

from editalote.lightroom import aprender, converter, ler_crs
from editalote.processamento import AJUSTES_PADRAO, avaliar_curva, transformar

NEUTRO = {**AJUSTES_PADRAO, "auto_exposicao": 0, "auto_balanco_branco": 0}

# Formato de um preset exportado pelo Lightroom Classic
PRESET = """<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    crs:PresetType="Normal"
    crs:Version="15.0"
    crs:Exposure2012="+0.35"
    crs:Contrast2012="+12"
    crs:Highlights2012="-45"
    crs:Shadows2012="+38"
    crs:Whites2012="+5"
    crs:Blacks2012="-8"
    crs:IncrementalTemperature="+6"
    crs:IncrementalTint="+2"
    crs:Vibrance="+15"
    crs:Saturation="-5"
    crs:Clarity2012="+10"
    crs:ParametricLights="+20"
    crs:SaturationAdjustmentOrange="-10"
    crs:LuminanceAdjustmentBlue="-30"
    crs:Dehaze="+15">
   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">Casamento</rdf:li></rdf:Alt></crs:Name>
   <crs:ToneCurvePV2012>
    <rdf:Seq>
     <rdf:li>0, 12</rdf:li>
     <rdf:li>64, 58</rdf:li>
     <rdf:li>192, 204</rdf:li>
     <rdf:li>255, 250</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012>
   <crs:ToneCurvePV2012Red>
    <rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq>
   </crs:ToneCurvePV2012Red>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"""


def test_ler_preset_xmp(tmp_path):
    arquivo = tmp_path / "Casamento.xmp"
    arquivo.write_text(PRESET, encoding="utf-8")
    ajustes, ignorados = converter(ler_crs(str(arquivo)))
    assert ajustes["exposicao"] == 0.35
    assert ajustes["realces"] == -45
    assert ajustes["sombras"] == 38
    assert ajustes["temperatura"] == 6
    assert ajustes["curva_claros"] == 20
    assert ajustes["curva"] == [[0, 12], [64, 58], [192, 204], [255, 250]]
    assert "curva_r" not in ajustes  # curva reta não é importada
    assert ajustes["claridade"] == 10
    assert ajustes["hsl_sat_laranja"] == -10
    assert ajustes["hsl_lum_azul"] == -30
    assert ignorados == ["Remover névoa"]


def _jpeg_com_xmp(caminho, exposicao, sombras):
    xmp = (PRESET.replace('crs:Exposure2012="+0.35"', f'crs:Exposure2012="{exposicao:+.2f}"')
                 .replace('crs:Shadows2012="+38"', f'crs:Shadows2012="{sombras:+d}"'))
    Image.new("RGB", (64, 48), (120, 110, 100)).save(caminho, "JPEG", xmp=xmp.encode("utf-8"))


def test_aprender_de_um_evento_editado(tmp_path):
    for i, (ev, sombras) in enumerate([(0.2, 30), (0.5, 40), (0.3, 50), (1.5, 45), (0.4, 35)]):
        _jpeg_com_xmp(str(tmp_path / f"IMG_{i}.jpg"), ev, sombras)
    Image.new("RGB", (10, 10)).save(tmp_path / "sem_edicao.jpg")
    resultado = aprender(str(tmp_path))
    assert resultado["fotos"] == 5
    # mediana: uma foto muito clara não puxa o padrão
    assert resultado["ajustes"]["exposicao"] == 0.4
    assert resultado["ajustes"]["sombras"] == 40
    assert len(resultado["ajustes"]["curva"]) == 9


def test_aprender_sem_edicoes_explica_o_que_fazer(tmp_path):
    Image.new("RGB", (10, 10)).save(tmp_path / "a.jpg")
    try:
        aprender(str(tmp_path))
    except ValueError as erro:
        assert "Salvar metadados" in str(erro)
    else:
        raise AssertionError("deveria avisar")


def test_curva_de_pontos():
    x = np.linspace(0, 1, 256)
    assert np.allclose(avaliar_curva([[0, 0], [255, 255]], x), x)
    s = avaliar_curva([[0, 0], [64, 50], [192, 210], [255, 255]], x)
    assert np.all(np.diff(s) >= -1e-12)  # monotônica, sem "ondas"
    assert abs(s[64] - 50 / 255) < 1e-6
    # ponto preto levantado (efeito "matte")
    assert avaliar_curva([[0, 20], [255, 255]], np.array([0.0]))[0] > 0.07


def test_curvas_na_transformacao():
    eixo = np.linspace(0, 1, 64)
    grade = np.stack([eixo] * 3, axis=-1)
    claros = transformar(grade, {**NEUTRO, "curva_claros": 100}, None)
    assert claros[40, 0] > grade[40, 0] + 0.05
    assert np.all(np.diff(claros[:, 0]) >= -1e-9)
    so_vermelho = transformar(grade, {**NEUTRO, "curva_r": [[0, 0], [128, 160], [255, 255]]}, None)
    assert so_vermelho[32, 0] > so_vermelho[32, 1]
    assert np.allclose(so_vermelho[:, 1], eixo, atol=1e-6)


def test_hsl_pele_e_ceu():
    from editalote.processamento import rgb_para_hsv, hsv_para_rgb, pesos_cor

    cores = np.random.default_rng(3).random((500, 3))
    h, s, v = rgb_para_hsv(cores)
    assert np.allclose(hsv_para_rgb(h, s, v), cores, atol=1e-9)
    assert np.allclose(pesos_cor(h).sum(axis=-1), 1.0)

    pele = np.array([[0.85, 0.62, 0.48]])      # laranja
    ceu = np.array([[0.35, 0.55, 0.90]])       # azul
    vestido = np.array([[0.93, 0.93, 0.92]])   # quase branco
    ajustes = {**NEUTRO, "hsl_sat_laranja": -50, "hsl_lum_azul": -60}
    pele2 = transformar(pele, ajustes, None)
    assert np.ptp(pele2) < np.ptp(pele)          # pele menos saturada
    assert transformar(ceu, ajustes, None).sum() < ceu.sum() - 0.1  # céu mais escuro
    assert np.allclose(transformar(ceu, {**NEUTRO, "hsl_sat_laranja": -50}, None), ceu, atol=0.02)
    assert np.allclose(transformar(vestido, ajustes, None), vestido, atol=0.01)


def test_claridade_e_textura():
    from PIL import ImageFilter

    from editalote.processamento import aplicar, completar_ajustes

    desvio = lambda im: np.asarray(im.convert("L"), dtype=float).std()
    ajustes = lambda **extra: completar_ajustes({**NEUTRO, **extra})

    # claridade: contraste de áreas médias
    suave = Image.effect_noise((800, 600), 40).convert("RGB").filter(ImageFilter.GaussianBlur(3))
    neutro = aplicar(suave, ajustes(), None)
    assert desvio(aplicar(suave, ajustes(claridade=80), None)) > desvio(neutro) * 1.2
    assert desvio(aplicar(suave, ajustes(claridade=-80), None)) < desvio(neutro) * 0.8

    # textura: detalhes finos (negativo suaviza, como pele)
    fino = Image.effect_noise((800, 600), 40).convert("RGB")
    neutro = aplicar(fino, ajustes(), None)
    mais = aplicar(fino, ajustes(textura=60), None)
    assert mais.size == fino.size
    assert desvio(mais) > desvio(neutro) * 1.05
    assert desvio(aplicar(fino, ajustes(textura=-80), None)) < desvio(neutro) * 0.95
