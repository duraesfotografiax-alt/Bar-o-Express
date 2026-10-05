import json

from editalote import caminhos


def test_dados_fora_da_pasta_do_programa(tmp_path, monkeypatch):
    programa, dados = tmp_path / "DuraesApp", tmp_path / "AppData" / "DuraesApp"
    (programa / "presets" / "estilos").mkdir(parents=True)
    (programa / "presets" / "01-natural.json").write_text('{"nome": "Natural novo"}')
    (programa / "presets" / "estilo-duraes.json").write_text('{"nome": "do programa antigo"}')
    (programa / "presets" / "estilos" / "estilo-duraes.json").write_text("{}")
    (programa / "google_token.json").write_text('{"refresh_token": "x"}')
    (dados / "presets").mkdir(parents=True)
    (dados / "presets" / "01-natural.json").write_text('{"nome": "Natural velho"}')
    (dados / "presets" / "estilo-duraes.json").write_text('{"nome": "treinado pelo estúdio"}')
    monkeypatch.setattr(caminhos, "PROGRAMA", str(programa))
    monkeypatch.setattr(caminhos, "DADOS", str(dados))
    monkeypatch.setattr(caminhos, "PASTA_PRESETS", str(dados / "presets"))
    caminhos.preparar()
    ler = lambda p: json.loads(p.read_text())["nome"]
    assert ler(dados / "presets" / "01-natural.json") == "Natural novo"             # vem com o programa: atualiza
    assert ler(dados / "presets" / "estilo-duraes.json") == "treinado pelo estúdio"  # do estúdio: mantém
    assert (dados / "presets" / "estilos" / "estilo-duraes.json").exists()
    assert (dados / "google_token.json").exists()                                    # trouxe a conexão
