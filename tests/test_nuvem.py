import os

from editalote import nuvem
from editalote.lightroom import presets_instalados


def test_detecta_onedrive_pela_variavel(tmp_path, monkeypatch):
    monkeypatch.setenv("OneDrive", str(tmp_path))
    assert {"nome": "OneDrive", "caminho": str(tmp_path)} in nuvem.detectar_nuvens()


def test_ignora_pasta_que_nao_existe(tmp_path, monkeypatch):
    monkeypatch.setenv("OneDrive", str(tmp_path / "nao_existe"))
    assert all(p["caminho"] != str(tmp_path / "nao_existe") for p in nuvem.detectar_nuvens())


def test_pasta_de_entrega_limpa_o_nome(tmp_path):
    caminho = nuvem.pasta_entrega(str(tmp_path), 'Casamento Ana: "João"')
    assert caminho == os.path.join(str(tmp_path), "Durães APP", "Entregas", "Casamento Ana_ _João_")


def test_lista_presets_instalados_do_lightroom(tmp_path):
    from test_lightroom import PRESET

    pasta = tmp_path / "Settings" / "User Presets"
    pasta.mkdir(parents=True)
    (pasta / "Casamento.xmp").write_text(PRESET, encoding="utf-8")
    (pasta / "vazio.xmp").write_text("<x:xmpmeta></x:xmpmeta>", encoding="utf-8")
    lista = presets_instalados([str(tmp_path / "Settings")])
    assert [p["nome"] for p in lista] == ["Casamento"]
