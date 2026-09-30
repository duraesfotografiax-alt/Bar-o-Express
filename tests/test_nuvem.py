import json
import os

from editalote import nuvem
from editalote.lightroom import presets_instalados


def test_presets_vao_para_a_nuvem_sem_sobrescrever(tmp_path):
    raiz = tmp_path / "app"
    (raiz / "presets").mkdir(parents=True)
    (raiz / "presets" / "natural.json").write_text('{"nome": "Natural"}', encoding="utf-8")
    (raiz / "presets" / "meu.json").write_text('{"nome": "Meu"}', encoding="utf-8")
    drive = tmp_path / "OneDrive"
    (drive / "EditaLote" / "presets").mkdir(parents=True)
    # preset já sincronizado de outro computador não pode ser sobrescrito
    (drive / "EditaLote" / "presets" / "meu.json").write_text('{"nome": "Do outro PC"}', encoding="utf-8")

    assert nuvem.pasta_presets(str(raiz)) == str(raiz / "presets")
    destino = nuvem.usar_nuvem_para_presets(str(raiz), str(drive))
    assert destino == str(drive / "EditaLote" / "presets")
    assert nuvem.pasta_presets(str(raiz)) == destino
    assert sorted(os.listdir(destino)) == ["meu.json", "natural.json"]
    assert json.loads((drive / "EditaLote" / "presets" / "meu.json").read_text())["nome"] == "Do outro PC"

    # se o OneDrive sumir (desconectado), volta para os presets locais em vez de quebrar
    os.rename(drive, tmp_path / "offline")
    assert nuvem.pasta_presets(str(raiz)) == str(raiz / "presets")
    os.rename(tmp_path / "offline", drive)

    nuvem.usar_nuvem_para_presets(str(raiz), None)
    assert nuvem.pasta_presets(str(raiz)) == str(raiz / "presets")


def test_detecta_onedrive_pela_variavel(tmp_path, monkeypatch):
    monkeypatch.setenv("OneDrive", str(tmp_path))
    assert {"nome": "OneDrive", "caminho": str(tmp_path)} in nuvem.detectar_nuvens()


def test_pasta_de_entrega_limpa_o_nome(tmp_path):
    caminho = nuvem.pasta_entrega(str(tmp_path), 'Casamento Ana: "João"')
    assert caminho == os.path.join(str(tmp_path), "EditaLote", "Entregas", "Casamento Ana_ _João_")


def test_lista_presets_instalados_do_lightroom(tmp_path):
    from test_lightroom import PRESET

    pasta = tmp_path / "Settings" / "User Presets"
    pasta.mkdir(parents=True)
    (pasta / "Casamento.xmp").write_text(PRESET, encoding="utf-8")
    (pasta / "vazio.xmp").write_text("<x:xmpmeta></x:xmpmeta>", encoding="utf-8")
    lista = presets_instalados([str(tmp_path / "Settings")])
    assert [p["nome"] for p in lista] == ["Casamento"]
