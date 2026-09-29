import os
from datetime import datetime

import numpy as np
import pytest
from PIL import Image, ImageFilter

from editalote.lote import Trabalho, planejar
from editalote.lut_cube import LutCube
from editalote.metadados import ler_info
from editalote.processamento import (
    AJUSTES_PADRAO,
    aplicar,
    analisar,
    ajustes_para_camera,
    completar_ajustes,
    transformar,
)

NEUTRO = {**AJUSTES_PADRAO, "auto_exposicao": 0, "auto_balanco_branco": 0}


def foto_teste(caminho, modelo="Canon EOS 250D", serie="111", data="2026:09:20 18:00:00",
               brilho=1.0, tamanho=(600, 400), desfocar=0, orientacao=1):
    rng = np.random.default_rng(abs(hash((caminho, brilho))) % 2**32)
    x = np.linspace(0, 1, tamanho[0])[None, :, None]
    y = np.linspace(0, 1, tamanho[1])[:, None, None]
    base = np.concatenate([x * 0.9 + 0.05 + 0 * y, y * 0.8 + 0.1 + 0 * x, (x + y) / 2 + 0 * x], axis=2)
    ruido = rng.random((tamanho[1], tamanho[0], 1)) > 0.5
    arr = np.clip(base * brilho + ruido * 0.25 - 0.1, 0, 1)
    img = Image.fromarray((arr * 255).astype(np.uint8))
    if desfocar:
        img = img.filter(ImageFilter.GaussianBlur(desfocar))
    exif = Image.Exif()
    exif[0x010F] = modelo.split()[0]
    exif[0x0110] = modelo
    exif[0x0112] = orientacao
    sub = exif.get_ifd(0x8769)
    sub[0x9003] = data
    sub[0xA431] = serie
    img.save(caminho, "JPEG", quality=97, exif=exif.tobytes())
    return caminho


def diferenca_media(a, b):
    return np.abs(np.asarray(a, dtype=float) - np.asarray(b, dtype=float)).mean()


def test_ajustes_neutros_nao_alteram_a_foto(tmp_path):
    caminho = foto_teste(str(tmp_path / "a.jpg"))
    original = Image.open(caminho).convert("RGB")
    editada = aplicar(original, completar_ajustes(NEUTRO), None)
    assert diferenca_media(original, editada) < 0.8


def test_transformar_identidade_e_monotonia():
    eixo = np.linspace(0, 1, 50)
    grade = np.stack([eixo, eixo, eixo], axis=-1)
    assert np.allclose(transformar(grade, NEUTRO, None), grade, atol=1e-6)
    forte = {**NEUTRO, "contraste": 100, "sombras": 100, "realces": -100, "exposicao": 1.5}
    saida = transformar(grade, forte, None)
    assert np.all(np.diff(saida[:, 1]) >= -1e-9)  # nunca inverte tons
    assert saida.max() <= 1.0 and saida.min() >= 0.0


def test_auto_exposicao_clareia_foto_escura(tmp_path):
    caminho = foto_teste(str(tmp_path / "escura.jpg"), brilho=0.35)
    img = Image.open(caminho).convert("RGB")
    analise = analisar(img)
    assert analise.ev_auto > 0.3
    ajustes = completar_ajustes({"auto_exposicao": 1, "auto_balanco_branco": 0})
    editada = aplicar(img, ajustes, analise)
    assert np.asarray(editada).mean() > np.asarray(img).mean() + 10


def test_ajuste_por_camera_soma_ao_preset():
    ajustes = completar_ajustes({"temperatura": 10, "cameras": {"ZV-E10 #9": {"temperatura": 5}}})
    assert ajustes_para_camera(ajustes, "ZV-E10 #9")["temperatura"] == 15
    assert ajustes_para_camera(ajustes, "outra")["temperatura"] == 10


def test_lut_cube_identidade():
    n = 5
    eixo = np.linspace(0, 1, n)
    linhas = [f"{r} {g} {b}" for b in eixo for g in eixo for r in eixo]
    lut = LutCube.ler("TITLE \"id\"\nLUT_3D_SIZE 5\n" + "\n".join(linhas))
    cores = np.random.default_rng(1).random((100, 3))
    assert np.allclose(lut.aplicar(cores), cores, atol=1e-9)

    # uma LUT que troca vermelho por azul
    linhas = [f"{b} {g} {r}" for b in eixo for g in eixo for r in eixo]
    troca = LutCube.ler("LUT_3D_SIZE 5\n" + "\n".join(linhas))
    assert np.allclose(troca.aplicar(np.array([[1.0, 0.0, 0.0]])), [[0.0, 0.0, 1.0]])


def test_leitura_exif_e_ordem_por_horario_com_ajuste(tmp_path):
    a = foto_teste(str(tmp_path / "canon1.jpg"), data="2026:09:20 18:00:00")
    b = foto_teste(str(tmp_path / "canon2.jpg"), data="2026:09:20 18:10:00")
    # Sony com relógio 7 minutos atrasado: 18:01 real aparece como 17:54
    c = foto_teste(str(tmp_path / "sony.jpg"), modelo="ZV-E10", serie="999",
                   data="2026:09:20 17:54:00")
    info = ler_info(a)
    assert info.nome_camera.startswith("Canon SL3")
    assert info.data == datetime(2026, 9, 20, 18, 0, 0)

    sem_ajuste = planejar([a, b, c], {"prefixo": "Teste"})
    assert [os.path.basename(i.info.caminho) for i in sem_ajuste] == ["sony.jpg", "canon1.jpg", "canon2.jpg"]

    com_ajuste = planejar([a, b, c], {"prefixo": "Teste", "ajuste_horario": {"ZV-E10 #999": 7 * 60}})
    assert [os.path.basename(i.info.caminho) for i in com_ajuste] == ["canon1.jpg", "sony.jpg", "canon2.jpg"]
    assert [i.nome_saida for i in com_ajuste] == ["Teste_0001.jpg", "Teste_0002.jpg", "Teste_0003.jpg"]


def test_lote_completo(tmp_path):
    entrada = tmp_path / "evento"
    (entrada / "fotografo2").mkdir(parents=True)
    for i in range(12):
        foto_teste(str(entrada / f"IMG_{i:04d}.jpg"), data=f"2026:09:20 18:{i:02d}:00",
                   orientacao=6 if i == 0 else 1)
    foto_teste(str(entrada / "fotografo2" / "DSC0001.jpg"), modelo="ZV-E10", serie="9",
               data="2026:09:20 18:05:30")
    foto_teste(str(entrada / "IMG_9999.jpg"), data="2026:09:20 19:00:00", desfocar=6)
    (entrada / "corrompida.jpg").write_bytes(b"isto nao e um jpeg")
    saida = tmp_path / "saida"

    t = Trabalho(str(entrada), str(saida), {"nome": "x"},
                 {"prefixo": "Casamento Ana", "versao_web": True})
    t.executar(processos=2)
    s = t.status()
    assert s["estado"] == "concluido", s
    assert s["total"] == 15
    assert s["qtd_erros"] == 1  # só a corrompida
    assert s["desfocadas"] == 1

    arquivos = sorted(p.name for p in saida.glob("*.jpg"))
    assert len(arquivos) == 13
    assert arquivos[0] == "Casamento_Ana_0001.jpg"
    assert (saida / "_revisar_desfocadas").exists()
    assert len(list((saida / "_revisar_desfocadas").glob("*.jpg"))) == 1
    assert (saida / "relatorio.csv").exists()
    assert len(list((saida / "web").glob("*.jpg"))) == 13
    assert not list(saida.glob("*.parcial"))

    # A primeira foto (18:00, orientação 6) mantém resolução e EXIF
    primeira = Image.open(saida / "Casamento_Ana_0001.jpg")
    assert primeira.size == (600, 400)
    exif = primeira.getexif()
    assert exif[0x0110] == "Canon EOS 250D"
    assert exif[0x0112] == 6
    # A Sony de 18:05:30 fica entre as Canon de 18:05 e 18:06
    assert ler_info(str(saida / "Casamento_Ana_0007.jpg")).camera == "ZV-E10 #9"


def test_saida_igual_entrada_e_recusada(tmp_path):
    foto_teste(str(tmp_path / "a.jpg"))
    t = Trabalho(str(tmp_path), str(tmp_path), {}, {})
    t.executar(processos=1)
    assert t.estado == "erro"


@pytest.mark.parametrize("preset", sorted(os.listdir(os.path.join(os.path.dirname(__file__), "..", "presets"))))
def test_presets_validos(preset, tmp_path):
    import json

    with open(os.path.join(os.path.dirname(__file__), "..", "presets", preset), encoding="utf-8") as f:
        ajustes = completar_ajustes(json.load(f))
    caminho = foto_teste(str(tmp_path / "a.jpg"))
    img = Image.open(caminho).convert("RGB")
    editada = aplicar(img, ajustes, analisar(img))
    assert editada.size == img.size
