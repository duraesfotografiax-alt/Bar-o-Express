"""Google Drive: login (OAuth) e as operações da entrega para clientes.

Usa só a permissão "drive.file": o Durães APP enxerga apenas os arquivos e pastas que ele mesmo
criou no Drive, nada do resto. Tudo com a biblioteca padrão do Python (urllib).

Configuração única (feita pelo estúdio): criar um "ID do cliente OAuth" do tipo "App para
computador" no Google Cloud e escolher o arquivo .json baixado no Durães APP. Ver README.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import mimetypes
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("editalote.drive")

# Acesso completo ao Drive: o programa mostra TODAS as pastas (as antigas e as criadas por outros
# programas), não só as que ele mesmo criou.
ESCOPO = "https://www.googleapis.com/auth/drive"
URL_AUTORIZAR = "https://accounts.google.com/o/oauth2/v2/auth"
URL_TOKEN = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/drive/v3"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
PASTA_MIME = "application/vnd.google-apps.folder"
PARTE = 16 * 1024 * 1024  # vídeos sobem em partes de 16 MB (múltiplo de 256 KB, como o Google exige)
ESPERA_INICIAL = 1.0  # segundos antes de tentar de novo quando o Google está instável (dobra a cada vez)


class ErroDrive(Exception):
    pass


def http(metodo: str, url: str, cabecalhos: dict | None = None, corpo: bytes | None = None,
         tempo: float = 120) -> tuple[int, dict, bytes]:
    """Faz uma requisição HTTP. Trocado por um falso nos testes."""
    req = urllib.request.Request(url, data=corpo, method=metodo, headers=cabecalhos or {})
    try:
        with urllib.request.urlopen(req, timeout=tempo) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as erro:
        return erro.code, dict(erro.headers or {}), erro.read()


# --------------------------------------------------------------------- login

def ler_cliente(caminho: str) -> dict:
    """Lê o .json do "ID do cliente OAuth" (tipo App para computador) baixado do Google Cloud."""
    with open(caminho, encoding="utf-8") as f:
        dados = json.load(f)
    cliente = dados.get("installed") or dados.get("web")
    if not cliente or not cliente.get("client_id") or not cliente.get("client_secret"):
        raise ErroDrive("Esse arquivo não é um ID do cliente OAuth do Google. Baixe o .json em "
                        "Google Cloud > APIs e serviços > Credenciais (tipo: App para computador).")
    if "installed" not in dados:
        raise ErroDrive("O ID do cliente precisa ser do tipo \"App para computador\" (Desktop app).")
    return {"client_id": cliente["client_id"], "client_secret": cliente["client_secret"]}


class Login:
    """Login com PKCE e retorno para o próprio Durães APP (http://127.0.0.1:porta/...)."""

    def __init__(self, cliente: dict, redirecionar: str):
        self.cliente = cliente
        self.redirecionar = redirecionar
        self.verificador = secrets.token_urlsafe(64)
        self.estado = secrets.token_urlsafe(16)

    def url(self) -> str:
        desafio = base64.urlsafe_b64encode(hashlib.sha256(self.verificador.encode()).digest()).rstrip(b"=")
        parametros = {
            "client_id": self.cliente["client_id"], "redirect_uri": self.redirecionar,
            "response_type": "code", "scope": ESCOPO, "access_type": "offline",
            "prompt": "consent", "state": self.estado,
            "code_challenge": desafio.decode(), "code_challenge_method": "S256",
        }
        return URL_AUTORIZAR + "?" + urllib.parse.urlencode(parametros)

    def trocar_codigo(self, codigo: str, estado: str) -> dict:
        if estado != self.estado:
            raise ErroDrive("Resposta de login inválida (estado diferente). Tente entrar de novo.")
        corpo = urllib.parse.urlencode({
            "code": codigo, "client_id": self.cliente["client_id"],
            "client_secret": self.cliente["client_secret"], "redirect_uri": self.redirecionar,
            "grant_type": "authorization_code", "code_verifier": self.verificador,
        }).encode()
        status, _, dados = http("POST", URL_TOKEN, {"Content-Type": "application/x-www-form-urlencoded"}, corpo)
        resposta = json.loads(dados or b"{}")
        if status != 200 or "refresh_token" not in resposta:
            raise ErroDrive(f"O Google recusou o login: {resposta.get('error_description') or resposta.get('error') or status}")
        return {"refresh_token": resposta["refresh_token"], "access_token": resposta["access_token"],
                "expira": time.time() + int(resposta.get("expires_in", 3600)) - 60,
                "escopo": resposta.get("scope", ESCOPO)}


# ---------------------------------------------------------------- operações

class Drive:
    def __init__(self, cliente: dict, token: dict, ao_renovar=None):
        self.cliente = cliente
        self.token = dict(token)
        self.ao_renovar = ao_renovar  # grava o token novo no disco

    # -- autenticação
    def _renovar(self):
        corpo = urllib.parse.urlencode({
            "client_id": self.cliente["client_id"], "client_secret": self.cliente["client_secret"],
            "refresh_token": self.token["refresh_token"], "grant_type": "refresh_token",
        }).encode()
        status, _, dados = http("POST", URL_TOKEN, {"Content-Type": "application/x-www-form-urlencoded"}, corpo)
        resposta = json.loads(dados or b"{}")
        if status != 200:
            raise ErroDrive("O acesso ao Google Drive expirou ou foi removido. Entre de novo na aba "
                            f"Clientes. ({resposta.get('error', status)})")
        self.token["access_token"] = resposta["access_token"]
        self.token["expira"] = time.time() + int(resposta.get("expires_in", 3600)) - 60
        if self.ao_renovar:
            self.ao_renovar(self.token)

    def _chamar(self, metodo: str, url: str, cabecalhos: dict | None = None,
                corpo: bytes | None = None, tentativas: int = 5) -> tuple[int, dict, bytes]:
        espera = ESPERA_INICIAL
        for tentativa in range(tentativas):
            if time.time() >= self.token.get("expira", 0):
                self._renovar()
            cab = {"Authorization": f"Bearer {self.token['access_token']}", **(cabecalhos or {})}
            try:
                status, cab_resp, dados = http(metodo, url, cab, corpo)
            except OSError as erro:  # internet caiu: tenta de novo
                log.warning("falha de rede (%s), tentando de novo", erro)
                status, cab_resp, dados = 0, {}, b""
            if status == 401 and tentativa == 0:
                self.token["expira"] = 0
                continue
            if status in (0, 429, 500, 502, 503, 504) and tentativa < tentativas - 1:
                time.sleep(espera)
                espera *= 2
                continue
            return status, cab_resp, dados
        return status, cab_resp, dados

    def _json(self, metodo: str, url: str, corpo: dict | None = None) -> dict:
        dados = json.dumps(corpo).encode() if corpo is not None else None
        cab = {"Content-Type": "application/json; charset=UTF-8"} if dados else {}
        status, _, resposta = self._chamar(metodo, url, cab, dados)
        if status not in (200, 204):
            texto = resposta[:500].decode("utf-8", "ignore")
            log.error("Drive %s %s -> %s: %s", metodo, url.split("?")[0], status, texto)
            try:
                motivo = json.loads(texto)["error"]["message"]
            except (ValueError, KeyError, TypeError):
                motivo = texto[:200]
            raise ErroDrive(f"O Google Drive recusou a operação ({status}: {motivo}). "
                            "Detalhes em duraesapp.log.")
        return json.loads(resposta) if resposta else {}

    # -- conta
    def conta(self) -> str:
        try:
            return self._json("GET", f"{API}/about?fields=user(emailAddress)")["user"]["emailAddress"]
        except (ErroDrive, KeyError):
            return ""

    # -- pastas e compartilhamento
    def criar_pasta(self, nome: str, pai: str | None = None) -> str:
        meta = {"name": nome, "mimeType": PASTA_MIME}
        if pai:
            meta["parents"] = [pai]
        return self._json("POST", f"{API}/files?fields=id", meta)["id"]

    def existe(self, arquivo_id: str) -> bool:
        status, _, dados = self._chamar("GET", f"{API}/files/{arquivo_id}?fields=id,trashed")
        return status == 200 and not json.loads(dados).get("trashed")

    def compartilhar_com_link(self, arquivo_id: str) -> str:
        self._json("POST", f"{API}/files/{arquivo_id}/permissions", {"type": "anyone", "role": "reader"})
        return f"https://drive.google.com/drive/folders/{arquivo_id}?usp=sharing"

    def listar(self, pasta_id: str) -> list[dict]:
        itens, pagina = [], None
        while True:
            q = urllib.parse.quote(f"'{pasta_id}' in parents and trashed=false")
            url = f"{API}/files?q={q}&fields=nextPageToken,files(id,name)&pageSize=1000"
            if pagina:
                url += f"&pageToken={pagina}"
            resp = self._json("GET", url)
            itens += resp.get("files", [])
            pagina = resp.get("nextPageToken")
            if not pagina:
                return itens

    # -- navegação (aba Drive)
    CAMPOS_ITEM = "id,name,mimeType,size,thumbnailLink,modifiedTime,iconLink,webViewLink,shortcutDetails"

    def itens(self, pasta_id: str) -> list[dict]:
        """Pastas e arquivos dentro de uma pasta (pastas primeiro, depois por nome)."""
        itens, pagina = [], None
        while True:
            q = urllib.parse.quote(f"'{pasta_id}' in parents and trashed=false")
            url = (f"{API}/files?q={q}&fields=nextPageToken,files({self.CAMPOS_ITEM})"
                   f"&pageSize=1000&orderBy=folder,name_natural&supportsAllDrives=true")
            if pagina:
                url += f"&pageToken={pagina}"
            resp = self._json("GET", url)
            itens += resp.get("files", [])
            pagina = resp.get("nextPageToken")
            if not pagina:
                return itens

    def info(self, arquivo_id: str) -> dict:
        return self._json("GET", f"{API}/files/{arquivo_id}?fields=id,name,mimeType,parents,webViewLink,"
                                 "ownedByMe&supportsAllDrives=true")

    def caminho(self, pasta_id: str, ate: str | None = None, limite: int = 12) -> list[dict]:
        """[{id, name}, ...] da pasta de cima até esta (para o "você está em")."""
        partes = []
        atual = pasta_id
        for _ in range(limite):
            dados = self.info(atual)
            partes.insert(0, {"id": dados["id"], "name": dados.get("name", "")})
            pais = dados.get("parents") or []
            if atual == ate or not pais:
                break
            atual = pais[0]
        return partes

    def link_publico(self, arquivo_id: str) -> str | None:
        """Link "qualquer pessoa com o link" se já estiver compartilhada, senão None."""
        resp = self._json("GET", f"{API}/files/{arquivo_id}/permissions?fields=permissions(id,type,role)"
                                 "&supportsAllDrives=true")
        if any(p.get("type") == "anyone" for p in resp.get("permissions", [])):
            return f"https://drive.google.com/drive/folders/{arquivo_id}?usp=sharing"
        return None

    def tirar_link(self, arquivo_id: str):
        resp = self._json("GET", f"{API}/files/{arquivo_id}/permissions?fields=permissions(id,type)")
        for p in resp.get("permissions", []):
            if p.get("type") == "anyone":
                self._json("DELETE", f"{API}/files/{arquivo_id}/permissions/{p['id']}")

    def renomear(self, arquivo_id: str, nome: str):
        self._json("PATCH", f"{API}/files/{arquivo_id}", {"name": nome})

    def baixar_miniatura(self, url: str) -> tuple[bytes, str]:
        status, cab, dados = self._chamar("GET", url)
        if status != 200:
            raise ErroDrive(f"miniatura indisponível ({status})")
        return dados, cab.get("Content-Type") or cab.get("content-type") or "image/jpeg"

    def permitir_download(self, arquivo_id: str, permitir: bool):
        """Com download bloqueado, quem tem o link só vê: o Drive esconde baixar/imprimir/copiar."""
        self._json("PATCH", f"{API}/files/{arquivo_id}", {"copyRequiresWriterPermission": not permitir})

    def ler_arquivo(self, arquivo_id: str) -> bytes:
        status, _, dados = self._chamar("GET", f"{API}/files/{arquivo_id}?alt=media")
        if status != 200:
            raise ErroDrive(f"Não consegui ler o arquivo no Drive ({status})")
        return dados

    def trocar_conteudo(self, arquivo_id: str, dados: bytes, tipo: str = "application/json"):
        status, _, _ = self._chamar("PATCH", f"{UPLOAD}/{arquivo_id}?uploadType=media",
                                    {"Content-Type": tipo}, dados)
        if status not in (200, 201):
            raise ErroDrive(f"Não consegui atualizar o arquivo no Drive ({status})")

    def mover_para_lixeira(self, arquivo_id: str):
        self._json("PATCH", f"{API}/files/{arquivo_id}", {"trashed": True})

    # -- envio
    def enviar_foto(self, nome: str, dados: bytes, pasta_id: str, permitir: bool) -> str:
        return self.enviar_arquivo(nome, pasta_id, permitir, dados=dados)

    def enviar_arquivo(self, nome: str, pasta_id: str, permitir: bool, dados: bytes | None = None,
                       caminho: str | None = None) -> str:
        """Envia uma foto (dados na memória) ou um arquivo do disco (vídeo de vários GB) em partes."""
        tipo = mimetypes.guess_type(nome)[0] or "application/octet-stream"
        if nome.lower().endswith((".mts", ".m2ts")):
            tipo = "video/mp2t"
        tamanho = len(dados) if dados is not None else os.path.getsize(caminho)
        meta = json.dumps({"name": nome, "parents": [pasta_id],
                           "copyRequiresWriterPermission": not permitir}).encode()
        status, cab, resposta = self._chamar(
            "POST", f"{UPLOAD}?uploadType=resumable&fields=id",
            {"Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": tipo,
             "X-Upload-Content-Length": str(tamanho)}, meta)
        destino = cab.get("Location") or cab.get("location")
        if status != 200 or not destino:
            raise ErroDrive(f"Não consegui iniciar o envio de {nome} ({status})")
        if dados is not None and tamanho <= PARTE:
            status, _, resposta = self._chamar("PUT", destino, {"Content-Type": tipo}, dados)
            if status not in (200, 201):
                raise ErroDrive(f"Falha ao enviar {nome} ({status})")
            return json.loads(resposta)["id"]
        arquivo = open(caminho, "rb") if dados is None else None
        try:
            inicio = 0
            while True:
                if arquivo is not None:
                    arquivo.seek(inicio)
                    parte = arquivo.read(PARTE)
                else:
                    parte = dados[inicio:inicio + PARTE]
                fim = inicio + len(parte) - 1
                faixa = f"bytes {inicio}-{fim}/{tamanho}" if parte else f"bytes */{tamanho}"
                status, cab, resposta = self._chamar(
                    "PUT", destino, {"Content-Type": tipo, "Content-Range": faixa}, parte)
                if status in (200, 201):
                    return json.loads(resposta)["id"]
                if status != 308:
                    raise ErroDrive(f"Falha ao enviar {nome} ({status})")
                # 308 = parte recebida; o Google diz até onde já tem (continua dali)
                recebido = cab.get("Range") or cab.get("range") or ""
                inicio = int(recebido.rsplit("-", 1)[1]) + 1 if recebido else 0
        finally:
            if arquivo is not None:
                arquivo.close()


def salvar_json(caminho: str, dados: dict):
    temporario = caminho + ".tmp"
    with open(temporario, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)
    os.replace(temporario, caminho)
