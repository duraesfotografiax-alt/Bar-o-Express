import numpy as np
from PIL import Image, ImageDraw

from editalote.geometria import (_endireitar, angulo_automatico, aplicar_geometria, corte_valido,
                                 exif_sem_rotacao)
from editalote.processamento import aplicar, ajustes_individuais, chave_foto, completar_ajustes


def cena_com_linhas():
    img = Image.new("RGB", (1200, 800), (120, 110, 100))
    d = ImageDraw.Draw(img)
    for y in range(100, 800, 120):
        d.rectangle([0, y, 1200, y + 30], fill=(220, 210, 200))
    for x in range(150, 1200, 200):
        d.rectangle([x, 0, x + 20, 800], fill=(40, 40, 40))
    return img


def test_girar_espelhar_e_cortar():
    img = Image.new("RGB", (300, 200), (0, 0, 0))
    img.putpixel((0, 0), (255, 0, 0))                          # canto superior esquerdo vermelho
    g = aplicar_geometria(img, {"girar": 90})
    assert g.size == (200, 300) and g.getpixel((199, 0)) == (255, 0, 0)   # horário: vai para a direita
    e = aplicar_geometria(img, {"espelhar": 1})
    assert e.getpixel((299, 0)) == (255, 0, 0)
    c = aplicar_geometria(img, {"corte": [0.0, 0.0, 0.5, 0.5]})
    assert c.size == (150, 100)
    assert corte_valido([0, 0, 1, 1]) is None


def test_endireitar_automatico_acha_o_angulo():
    torta = _endireitar(cena_com_linhas(), -3.0)               # gira 3° no anti-horário
    angulo = angulo_automatico(torta)
    assert abs(angulo - 3.0) < 0.3
    reta = aplicar_geometria(torta, {"endireitar": angulo})
    assert abs(angulo_automatico(reta)) < 0.3
    assert angulo_automatico(cena_com_linhas()) == 0.0
    assert angulo_automatico(Image.new("RGB", (800, 600), (90, 90, 90))) == 0.0   # sem linhas: não gira


def test_perspectiva_mantem_tamanho_e_muda_a_imagem():
    img = cena_com_linhas()
    p = aplicar_geometria(img, {"perspectiva_v": 40})
    assert p.size == img.size
    assert np.abs(np.asarray(p, float) - np.asarray(img, float)).mean() > 5


def test_corte_so_desta_foto_e_aplicar(tmp_path):
    a = str(tmp_path / "a.jpg")
    ajustes = completar_ajustes({"auto_exposicao": 0, "auto_balanco_branco": 0,
                                 "por_foto": {chave_foto(a): {"corte": [0.1, 0.1, 0.6, 0.9], "girar": 90}}})
    final = ajustes_individuais(ajustes, a)
    assert final["corte"] == [0.1, 0.1, 0.6, 0.9] and final["girar"] == 90
    saida = aplicar(Image.new("RGB", (1000, 500), (128, 128, 128)), final, None)
    assert saida.size == (250, 800)   # girou (500x1000) e cortou 50% x 80%
    assert ajustes_individuais(ajustes, str(tmp_path / "b.jpg"))["corte"] is None


def test_exif_sem_rotacao():
    img = Image.new("RGB", (10, 10))
    exif = img.getexif()
    exif[0x0112] = 6
    exif[0x0110] = "Canon"
    novo = exif_sem_rotacao(exif.tobytes())
    lido = Image.Exif()
    lido.load(novo)
    assert lido[0x0112] == 1 and lido[0x0110] == "Canon"
