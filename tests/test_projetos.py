"""Entrega para clientes, testada contra um Google Drive simulado."""

import json
import time
import urllib.parse

import pytest
from PIL import Image

from editalote import drive as drive_mod
from editalote.drive import ErroDrive, Login, ler_cliente
from editalote.projetos import Projetos

CLIENTE = {"installed": {"client_id": "id-123.apps.googleusercontent.com", "client_secret": "segredo"}}


class DriveFalso:
    """Imita as respostas da API do Google Drive usadas pelo Durães APP."""

    def __init__(self):
        self.arquivos = {}          # id -> {name, parents, mime, trashed, copyRequiresWriterPermission, tamanho}
        self.permissoes = {}        # id -> [perm]
        self.sessoes = {}
        self.proximo = 0
        self.falhar_nomes = set()   # nomes que sempre falham no envio
        self.falhas_temporarias = 0  # próximas N chamadas respondem 503
        self.token_valido = "tk-1"
        self.chamadas = 0

    def _novo_id(self):
        self.proximo += 1
        return f"arq{self.proximo}"

    def __call__(self, metodo, url, cabecalhos=None, corpo=None, tempo=120):
        self.chamadas += 1
        u = urllib.parse.urlparse(url)
        if u.netloc == "oauth2.googleapis.com":
            dados = dict(urllib.parse.parse_qsl(corpo.decode()))
            self.token_valido = f"tk-{self.chamadas}"
            resp = {"access_token": self.token_valido, "expires_in": 3600}
            if dados["grant_type"] == "authorization_code":
                resp["refresh_token"] = "refresh-abc"
            return 200, {}, json.dumps(resp).encode()
        if (cabecalhos or {}).get("Authorization") != f"Bearer {self.token_valido}":
            return 401, {}, b'{"error":"invalid_token"}'
        if self.falhas_temporarias:
            self.falhas_temporarias -= 1
            return 503, {}, b"{}"
        q = dict(urllib.parse.parse_qsl(u.query))
        partes = u.path.split("/")
        if u.path.endswith("/about"):
            return 200, {}, json.dumps({"user": {"emailAddress": "duraes@gmail.com"}}).encode()
        if u.path == "/upload/drive/v3/files" and metodo == "POST":
            sessao = f"https://www.googleapis.com/upload/sessao/{self._novo_id()}"
            self.sessoes[sessao] = json.loads(corpo)
            return 200, {"Location": sessao}, b""
        if u.path.startswith("/upload/sessao/") and metodo == "PUT":
            meta = self.sessoes[url]  # como no Google, a sessão aceita nova tentativa
            if meta["name"] in self.falhar_nomes:
                return 500, {}, b"{}"
            del self.sessoes[url]
            fid = self._novo_id()
            self.arquivos[fid] = {**meta, "trashed": False, "tamanho": len(corpo)}
            return 200, {}, json.dumps({"id": fid}).encode()
        if u.path == "/drive/v3/files" and metodo == "POST":
            meta = json.loads(corpo)
            fid = self._novo_id()
            self.arquivos[fid] = {**meta, "trashed": False}
            return 200, {}, json.dumps({"id": fid}).encode()
        if u.path == "/drive/v3/files" and metodo == "GET":
            pai = q["q"].split("'")[1]
            itens = [{"id": i, "name": a["name"]} for i, a in self.arquivos.items()
                     if pai in a.get("parents", []) and not a["trashed"]]
            return 200, {}, json.dumps({"files": itens}).encode()
        if len(partes) >= 6 and partes[5] == "permissions":
            self.permissoes.setdefault(partes[4], []).append(json.loads(corpo))
            return 200, {}, b'{"id":"p1"}'
        fid = partes[4]
        if fid not in self.arquivos:
            return 404, {}, b"{}"
        if metodo == "GET":
            return 200, {}, json.dumps({"id": fid, "trashed": self.arquivos[fid]["trashed"]}).encode()
        if metodo == "PATCH":
            self.arquivos[fid].update(json.loads(corpo))
            return 200, {}, json.dumps({"id": fid}).encode()
        return 400, {}, b"{}"

    def fotos_em(self, pasta):
        return [a for a in self.arquivos.values() if pasta in a.get("parents", []) and not a["trashed"]]


@pytest.fixture
def ambiente(tmp_path, monkeypatch):
    falso = DriveFalso()
    monkeypatch.setattr(drive_mod, "http", falso)
    monkeypatch.setattr(drive_mod, "ESPERA_INICIAL", 0)
    (tmp_path / "cliente.json").write_text(json.dumps(CLIENTE))
    fotos = tmp_path / "Casamento Ana e João"
    (fotos / "_revisar_desfocadas").mkdir(parents=True)
    for i in range(7):
        Image.new("RGB", (4000, 3000), (200, 150 + i, 100)).save(fotos / f"Casamento_{i:04d}.jpg", quality=80)
    Image.new("RGB", (10, 10)).save(fotos / "_revisar_desfocadas" / "tremida.jpg")
    pj = Projetos(str(tmp_path))
    pj.configurar_cliente(str(tmp_path / "cliente.json"))
    pj.salvar_token({"access_token": "tk-1", "refresh_token": "refresh-abc", "expira": time.time() + 3000})
    return pj, falso, fotos


def esperar(pj):
    for _ in range(500):
        s = pj.status_envio()
        if s["estado"] != "enviando":
            return s
        time.sleep(0.01)
    raise AssertionError("envio não terminou")


def test_projeto_completo(ambiente):
    pj, falso, fotos = ambiente
    projeto = pj.criar("Casamento Ana e João", str(fotos), permitir=False)
    assert projeto["total"] == 7                      # a pasta de revisão fica de fora
    pj.enviar(projeto["id"])
    s = esperar(pj)
    assert s["estado"] == "concluido", s
    projeto = pj.obter(projeto["id"])
    assert projeto["link"].startswith("https://drive.google.com/drive/folders/")
    pasta = projeto["drive_pasta"]
    assert falso.arquivos[pasta]["name"] == "Casamento Ana e João"
    raiz = falso.arquivos[pasta]["parents"][0]
    assert falso.arquivos[raiz]["name"] == "Durães APP · Clientes"
    assert falso.permissoes[pasta] == [{"type": "anyone", "role": "reader"}]
    enviadas = falso.fotos_em(pasta)
    assert len(enviadas) == 7
    assert all(a["copyRequiresWriterPermission"] for a in enviadas)   # só visualizar

    pj.alterar_download(projeto["id"], True)
    assert not any(a["copyRequiresWriterPermission"] for a in falso.fotos_em(pasta))
    assert falso.arquivos[pasta]["copyRequiresWriterPermission"] is False
    assert pj.obter(projeto["id"])["permitir_download"] is True


def test_retoma_envio_e_recupera_de_falhas(ambiente):
    pj, falso, fotos = ambiente
    falso.falhar_nomes = {"Casamento_0003.jpg"}
    falso.falhas_temporarias = 2                     # o Google instável no começo
    projeto = pj.criar("Aniversário", str(fotos))
    pj.enviar(projeto["id"])
    s = esperar(pj)
    assert s["estado"] == "erro" and s["qtd_erros"] == 1
    assert len(pj.obter(projeto["id"])["enviadas"]) == 6

    falso.falhar_nomes = set()
    pj.enviar(projeto["id"])                         # "Enviar" de novo: só manda a que faltou
    assert esperar(pj)["estado"] == "concluido"
    assert len(falso.fotos_em(pj.obter(projeto["id"])["drive_pasta"])) == 7


def test_renova_o_acesso_quando_expira(ambiente):
    pj, falso, fotos = ambiente
    falso.token_valido = "outro"                    # o Google invalidou o token atual
    projeto = pj.criar("Ensaio", str(fotos))
    pj.enviar(projeto["id"])
    assert esperar(pj)["estado"] == "concluido"


def test_versao_leve_e_exclusao(ambiente):
    pj, falso, fotos = ambiente
    projeto = pj.criar("Leve", str(fotos), tamanho="leve")
    pj.enviar(projeto["id"])
    esperar(pj)
    pasta = pj.obter(projeto["id"])["drive_pasta"]
    maior = max(a["tamanho"] for a in falso.fotos_em(pasta))
    assert maior < (fotos / "Casamento_0000.jpg").stat().st_size
    pj.excluir(projeto["id"], apagar_do_drive=True)
    assert falso.arquivos[pasta]["trashed"] is True
    assert pj.listar() == []


def test_validacoes(tmp_path):
    (tmp_path / "web.json").write_text(json.dumps({"web": CLIENTE["installed"]}))
    with pytest.raises(ErroDrive, match="App para computador"):
        ler_cliente(str(tmp_path / "web.json"))
    (tmp_path / "outro.json").write_text("{}")
    with pytest.raises(ErroDrive, match="ID do cliente OAuth"):
        ler_cliente(str(tmp_path / "outro.json"))
    pj = Projetos(str(tmp_path))
    with pytest.raises(ValueError, match="nome"):
        pj.criar(" ", str(tmp_path))
    with pytest.raises(ErroDrive, match="Configure"):
        pj.drive()


def test_login_com_pkce(monkeypatch):
    falso = DriveFalso()
    monkeypatch.setattr(drive_mod, "http", falso)
    login = Login(CLIENTE["installed"], "http://127.0.0.1:5000/api/drive/retorno")
    url = urllib.parse.urlparse(login.url())
    q = dict(urllib.parse.parse_qsl(url.query))
    assert q["scope"] == "https://www.googleapis.com/auth/drive.file"
    assert q["code_challenge_method"] == "S256" and q["redirect_uri"].startswith("http://127.0.0.1:")
    with pytest.raises(ErroDrive, match="estado"):
        login.trocar_codigo("codigo", "estado-errado")
    token = login.trocar_codigo("codigo", q["state"])
    assert token["refresh_token"] == "refresh-abc"


def test_rotas_do_servidor(ambiente, monkeypatch):
    from editalote import servidor

    pj, falso, fotos = ambiente
    monkeypatch.setattr(servidor, "projetos", pj)
    abertos = []
    monkeypatch.setattr(servidor.webbrowser, "open", abertos.append)
    cliente = servidor.app.test_client()
    assert cliente.get("/api/drive/estado").json["conectado"] is True
    assert cliente.post("/api/drive/entrar", json={}).status_code == 200
    estado = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(abertos[0]).query))["state"]
    pagina = cliente.get(f"/api/drive/retorno?code=abc&state={estado}").get_data(as_text=True)
    assert "Google Drive conectado" in pagina
    assert pj.conexao()["conta"] == "duraes@gmail.com"
    r = cliente.post("/api/projetos", json={"nome": "Casamento", "pasta": str(fotos)})
    assert r.status_code == 200
    esperar(pj)
    assert len(cliente.get("/api/projetos").json) == 1
    assert cliente.post("/api/abrir-link", json={"url": "https://exemplo.com"}).status_code == 400
    assert cliente.post("/api/abrir-link", json={"url": "https://wa.me/?text=oi"}).status_code == 200
