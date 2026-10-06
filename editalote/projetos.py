"""Projetos de entrega: um por cliente, com as fotos no Google Drive e um link para mandar.

Tudo que o estúdio precisa guardar fica em arquivos ao lado do programa:
  projetos.json        lista de projetos (nome, pasta, link, download liberado, fotos enviadas)
  google_cliente.json  o "ID do cliente OAuth" escolhido na configuração
  google_token.json    o acesso à conta Google (criado no login; apagar = sair da conta)
"""

from __future__ import annotations

import io
import logging
import os
import secrets
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from PIL import Image

from .drive import Drive, ErroDrive, ler_cliente, salvar_json
from .metadados import EXTENSOES, EXTENSOES_VIDEO

log = logging.getLogger("editalote.projetos")

PASTA_RAIZ_DRIVE = "Durães APP · Clientes"
EMPRESAS = {"duraes": "Durães Fotografia", "elite": "Elite Marketing Digital"}
EMPRESAS = {"duraes": "Durães Fotografia", "elite": "Elite Marketing Digital"}
LADO_LEVE = 3000
PASTA_ALBUM = "Álbum (seleção do cliente)"
ARQUIVO_SELECAO = "selecao_album.json"
IGNORAR_PASTAS = {"_revisar_desfocadas", "web", PASTA_ALBUM}


def _ler(caminho: str, padrao):
    import json

    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return padrao


def eh_video(caminho: str) -> bool:
    return os.path.splitext(caminho)[1].lower() in EXTENSOES_VIDEO


def fotos_da_pasta(pasta: str) -> list[str]:
    """Fotos e vídeos para entregar: os da pasta (e subpastas), menos os de revisão e a versão web."""
    fotos = []
    for raiz, dirs, nomes in os.walk(pasta):
        dirs[:] = sorted(d for d in dirs if d not in IGNORAR_PASTAS)
        fotos += [os.path.join(raiz, n) for n in sorted(nomes)
                  if os.path.splitext(n)[1].lower() in EXTENSOES | EXTENSOES_VIDEO
                  and not n.startswith(".")]
    return fotos


def bytes_para_envio(caminho: str, tamanho: str) -> bytes:
    if tamanho != "leve":
        with open(caminho, "rb") as f:
            return f.read()
    with Image.open(caminho) as img:
        extras = {k: img.info[k] for k in ("exif", "icc_profile") if img.info.get(k)}
        img = img.convert("RGB")
        img.thumbnail((LADO_LEVE, LADO_LEVE), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90, **extras)
    return buf.getvalue()


class Projetos:
    def __init__(self, raiz: str):
        self.raiz = raiz
        self.arquivo = os.path.join(raiz, "projetos.json")
        self.arquivo_cliente = os.path.join(raiz, "google_cliente.json")
        self.arquivo_token = os.path.join(raiz, "google_token.json")
        self.arquivo_album = os.path.join(raiz, "album.json")
        self._trava = threading.RLock()
        self._envio: Envio | None = None

    # ---------------------------------------------------------------- conexão
    def configurar_cliente(self, caminho_json: str):
        ler_cliente(caminho_json)  # valida antes de copiar
        shutil.copyfile(caminho_json, self.arquivo_cliente)

    def cliente(self) -> dict | None:
        return ler_cliente(self.arquivo_cliente) if os.path.isfile(self.arquivo_cliente) else None

    def salvar_token(self, token: dict):
        salvar_json(self.arquivo_token, token)

    def sair(self):
        if os.path.isfile(self.arquivo_token):
            os.remove(self.arquivo_token)

    def drive(self) -> Drive:
        cliente, token = self.cliente(), _ler(self.arquivo_token, None)
        if not cliente:
            raise ErroDrive("Configure o Google Drive primeiro (arquivo do ID do cliente).")
        if not token:
            raise ErroDrive("Entre com a conta Google primeiro.")
        return Drive(cliente, token, ao_renovar=self.salvar_token)

    def conexao(self) -> dict:
        try:
            configurado = self.cliente() is not None
        except (ErroDrive, ValueError, OSError):
            configurado = False
        conectado = configurado and os.path.isfile(self.arquivo_token)
        dados = self._dados()
        token = _ler(self.arquivo_token, {}) if conectado else {}
        # login antigo (só as pastas criadas pelo programa): pede para entrar de novo
        acesso_total = conectado and "auth/drive.file" not in str(token.get("escopo", "auth/drive.file"))
        return {"configurado": configurado, "conectado": conectado, "conta": dados.get("conta", ""),
                "acesso_total": acesso_total}

    # ---------------------------------------------------------------- dados
    def _dados(self) -> dict:
        return _ler(self.arquivo, {"projetos": []})

    def _gravar(self, dados: dict):
        salvar_json(self.arquivo, dados)

    def listar(self) -> list[dict]:
        with self._trava:
            return self._dados()["projetos"]

    def obter(self, pid: str) -> dict:
        for p in self.listar():
            if p["id"] == pid:
                return p
        raise KeyError(pid)

    def _atualizar(self, pid: str, **campos) -> dict:
        with self._trava:
            dados = self._dados()
            for p in dados["projetos"]:
                if p["id"] == pid:
                    p.update(campos)
                    self._gravar(dados)
                    return p
        raise KeyError(pid)

    def lembrar_conta(self, conta: str):
        with self._trava:
            dados = self._dados()
            dados["conta"] = conta
            self._gravar(dados)

    def listar_empresa(self, empresa: str) -> list[dict]:
        return [p for p in self.listar() if p.get("empresa", "duraes") == empresa]

    def criar(self, nome: str, pasta: str, tamanho: str = "original", permitir: bool = False,
              empresa: str = "duraes", drive_pasta: str = "", pai: str = "") -> dict:
        nome = nome.strip()
        if not nome:
            raise ValueError("Dê um nome ao projeto (ex.: Casamento Ana e João)")
        if pasta or not drive_pasta:
            if not os.path.isdir(pasta):
                raise ValueError("Pasta das fotos não encontrada")
            if not fotos_da_pasta(pasta):
                raise ValueError("Não há fotos nem vídeos nessa pasta")
        projeto = {
            "id": secrets.token_hex(4), "nome": nome, "pasta": pasta,
            "empresa": empresa if empresa in EMPRESAS else "duraes", "pai": pai,
            "tamanho": "leve" if tamanho == "leve" else "original",
            "permitir_download": bool(permitir), "criado": datetime.now().strftime("%d/%m/%Y %H:%M"),
            "drive_pasta": drive_pasta, "link": "", "enviadas": [],
            "total": len(fotos_da_pasta(pasta)) if pasta else 0,
        }
        with self._trava:
            dados = self._dados()
            dados["projetos"].insert(0, projeto)
            self._gravar(dados)
        return projeto

    def alterar_download(self, pid: str, permitir: bool) -> dict:
        projeto = self._atualizar(pid, permitir_download=bool(permitir))
        if projeto.get("drive_pasta"):
            # a opção vale para cada FOTO; o Google recusa (erro 400) essa opção em pastas
            drive = self.drive()
            itens = drive.listar(projeto["drive_pasta"])
            with ThreadPoolExecutor(max_workers=4) as ex:
                list(ex.map(lambda item: drive.permitir_download(item["id"], permitir), itens))
        return projeto

    def excluir(self, pid: str, apagar_do_drive: bool):
        projeto = self.obter(pid)
        if self._envio and self._envio.pid == pid and self._envio.estado == "enviando":
            raise ValueError("Espere o envio deste projeto terminar (ou cancele) antes de excluir")
        if apagar_do_drive and projeto.get("drive_pasta"):
            self.drive().mover_para_lixeira(projeto["drive_pasta"])
        with self._trava:
            dados = self._dados()
            dados["projetos"] = [p for p in dados["projetos"] if p["id"] != pid]
            self._gravar(dados)

    # ---------------------------------------------------------------- álbum
    # O cliente escolhe as fotos numa página do Google Apps Script (seletor_album.gs, publicado na
    # conta do estúdio). A escolha fica em selecao_album.json, que o Durães APP cria na pasta do
    # cliente (por isso consegue ler, mesmo só com a permissão drive.file).
    def url_seletor(self) -> str:
        return _ler(self.arquivo_album, {}).get("url", "")

    def configurar_seletor(self, url: str):
        url = url.strip()
        if url and not (url.startswith("https://script.google.com/") and "/exec" in url):
            raise ValueError("Cole a \"URL do app da Web\" do Apps Script (começa com "
                             "https://script.google.com/ e termina com /exec).")
        salvar_json(self.arquivo_album, {"url": url.split("?")[0]})

    def ativar_album(self, pid: str, limite: int) -> dict:
        projeto = self.obter(pid)
        if not projeto.get("drive_pasta"):
            raise ValueError("Envie as fotos para o Drive antes de liberar a seleção do álbum")
        drive = self.drive()
        arquivo = projeto.get("album_arquivo")
        if not arquivo or not drive.existe(arquivo):
            arquivo = drive.enviar_arquivo(ARQUIVO_SELECAO, projeto["drive_pasta"], True, dados=b"{}")
        return self._atualizar(pid, album_arquivo=arquivo, album_limite=max(0, int(limite or 0)))

    def link_album(self, projeto: dict) -> str:
        url = self.url_seletor()
        if not url or not projeto.get("album_arquivo"):
            return ""
        import urllib.parse

        return url + "?" + urllib.parse.urlencode({
            "p": projeto["drive_pasta"], "s": projeto["album_arquivo"], "n": projeto["nome"],
            "l": projeto.get("album_limite") or 0})

    def selecao_album(self, pid: str) -> dict:
        import json

        projeto = self.obter(pid)
        if not projeto.get("album_arquivo"):
            return {"fotos": [], "finalizado": False}
        try:
            dados = json.loads(self.drive().ler_arquivo(projeto["album_arquivo"]) or b"{}")
        except ValueError:
            dados = {}
        selecao = {"fotos": [str(n) for n in dados.get("fotos", [])], "finalizado": bool(dados.get("finalizado")),
                   "obs": str(dados.get("obs", "")), "atualizado": dados.get("atualizado", "")}
        self._atualizar(pid, album_selecao=selecao)
        return selecao

    def reabrir_album(self, pid: str) -> dict:
        import json

        selecao = {**self.selecao_album(pid), "finalizado": False}
        self.drive().trocar_conteudo(self.obter(pid)["album_arquivo"], json.dumps(selecao).encode())
        self._atualizar(pid, album_selecao=selecao)
        return selecao

    def separar_album(self, pid: str, nomes: list[str] | None = None, pasta_local: str = "") -> dict:
        """Copia as fotos escolhidas (pelo nome) para a pasta "Álbum (seleção do cliente)"."""
        if pasta_local:
            if not os.path.isdir(pasta_local):
                raise ValueError("Pasta das fotos não encontrada")
            self._atualizar(pid, pasta=pasta_local)
        projeto = self.obter(pid)
        if not projeto.get("pasta"):
            raise ValueError("Escolha a pasta do computador onde estão as fotos deste cliente")
        if nomes is None:
            nomes = (projeto.get("album_selecao") or {}).get("fotos", [])
        nomes = [os.path.basename(n.strip()) for n in nomes if n and n.strip()]
        por_nome = {os.path.basename(f).lower(): f for f in fotos_da_pasta(projeto["pasta"])}
        destino = os.path.join(projeto["pasta"], PASTA_ALBUM)
        os.makedirs(destino, exist_ok=True)
        copiadas, faltando = 0, []
        for n, nome in enumerate(nomes, 1):
            origem = por_nome.get(nome.lower())
            if not origem:
                faltando.append(nome)
                continue
            # numera na ordem da escolha do cliente, mantendo o nome original
            shutil.copy2(origem, os.path.join(destino, f"{n:03d}_{os.path.basename(origem)}"))
            copiadas += 1
        return {"pasta": destino, "copiadas": copiadas, "faltando": faltando}

    # ---------------------------------------------------------------- envio
    def _pasta_raiz(self, drive: Drive, empresa: str = "duraes") -> str:
        """Pasta principal da empresa no Drive (escolhida na aba Drive, ou criada com o nome dela)."""
        raiz = self.raiz_empresa(empresa)
        if raiz and drive.existe(raiz):
            return raiz
        raiz = drive.criar_pasta(EMPRESAS.get(empresa, EMPRESAS["duraes"]))
        self.definir_raiz(empresa, raiz)
        return raiz

    def raiz_empresa(self, empresa: str) -> str:
        dados = self._dados()
        return (dados.get("raizes") or {}).get(empresa) or (dados.get("drive_raiz") if empresa == "duraes" else "") or ""

    def definir_raiz(self, empresa: str, pasta_id: str):
        with self._trava:
            dados = self._dados()
            dados.setdefault("raizes", {})[empresa] = pasta_id
            self._gravar(dados)

    def projeto_da_pasta(self, drive_pasta: str) -> dict | None:
        return next((p for p in self.listar() if p.get("drive_pasta") == drive_pasta), None)

    def vincular(self, drive_pasta: str, nome: str, empresa: str) -> dict:
        """Projeto para uma pasta que já existe no Drive (aba Drive): para enviar arquivos ou o álbum."""
        return self.projeto_da_pasta(drive_pasta) or self.criar(nome, "", empresa=empresa, drive_pasta=drive_pasta)

    def enviar_para_pasta(self, drive_pasta: str, nome: str, empresa: str, pasta_local: str,
                          tamanho: str = "original", permitir: bool = False) -> "Envio":
        if not os.path.isdir(pasta_local) or not fotos_da_pasta(pasta_local):
            raise ValueError("Escolha uma pasta do computador com fotos ou vídeos")
        projeto = self.vincular(drive_pasta, nome, empresa)
        mesma = bool(projeto.get("pasta")) and os.path.normcase(os.path.abspath(projeto["pasta"])) == \
            os.path.normcase(os.path.abspath(pasta_local))
        self._atualizar(projeto["id"], pasta=pasta_local, total=len(fotos_da_pasta(pasta_local)),
                        tamanho="leve" if tamanho == "leve" else "original", permitir_download=bool(permitir),
                        enviadas=projeto.get("enviadas", []) if mesma else [])
        return self.enviar(projeto["id"])

    def enviar(self, pid: str, processos: int = 3) -> "Envio":
        with self._trava:
            if self._envio and self._envio.estado == "enviando":
                raise ValueError("Já tem um envio em andamento")
            self.obter(pid)
            self._envio = Envio(self, pid, processos)
        threading.Thread(target=self._envio.executar, daemon=True).start()
        return self._envio

    def status_envio(self) -> dict:
        return self._envio.status() if self._envio else {"estado": "parado"}

    def cancelar_envio(self):
        if self._envio:
            self._envio.cancelar.set()


class Envio:
    def __init__(self, projetos: Projetos, pid: str, processos: int):
        self.projetos, self.pid, self.processos = projetos, pid, processos
        self.estado, self.mensagem = "enviando", "Preparando…"
        self.feitas = self.total = 0
        self.erros: list[str] = []
        self.inicio = time.time()
        self.cancelar = threading.Event()

    def status(self) -> dict:
        decorrido = time.time() - self.inicio
        restante = decorrido / self.feitas * (self.total - self.feitas) if self.feitas else None
        return {"estado": self.estado, "mensagem": self.mensagem, "projeto": self.pid,
                "feitas": self.feitas, "total": self.total, "erros": self.erros[-5:],
                "qtd_erros": len(self.erros), "restante": round(restante) if restante else None}

    def executar(self):
        try:
            self._executar()
        except (ErroDrive, OSError, KeyError) as erro:
            log.exception("envio falhou")
            self.estado, self.mensagem = "erro", str(erro)

    def _executar(self):
        pj = self.projetos
        drive = pj.drive()
        projeto = pj.obter(self.pid)
        if not projeto.get("drive_pasta") or not drive.existe(projeto["drive_pasta"]):
            self.mensagem = "Criando a pasta do cliente no Drive…"
            pai = projeto.get("pai") or pj._pasta_raiz(drive, projeto.get("empresa", "duraes"))
            pasta = drive.criar_pasta(projeto["nome"], pai)
            link = drive.compartilhar_com_link(pasta)
            projeto = pj._atualizar(self.pid, drive_pasta=pasta, link=link, enviadas=[])
        elif not projeto.get("link"):   # pasta que já existia no Drive: o link sai ao enviar
            projeto = pj._atualizar(self.pid, link=drive.compartilhar_com_link(projeto["drive_pasta"]))
        fotos = fotos_da_pasta(projeto["pasta"])
        ja = set(projeto.get("enviadas", []))
        # o que já está na pasta do Drive (com o mesmo nome) não sobe de novo
        no_drive = {i["name"] for i in drive.listar(projeto["drive_pasta"])}
        faltam = [f for f in fotos if os.path.relpath(f, projeto["pasta"]) not in ja
                  and os.path.basename(f) not in no_drive]
        self.total = len(fotos)
        self.feitas = self.total - len(faltam)
        pj._atualizar(self.pid, total=self.total)
        self.mensagem = "Enviando fotos e vídeos para o Drive…"

        def enviar_uma(caminho: str):
            if self.cancelar.is_set():
                return caminho, "cancelado"
            try:
                atual = pj.obter(self.pid)
                if eh_video(caminho):   # vídeo vai como está, lido do disco em partes
                    drive.enviar_arquivo(os.path.basename(caminho), atual["drive_pasta"],
                                         atual["permitir_download"], caminho=caminho)
                else:
                    dados = bytes_para_envio(caminho, atual["tamanho"])
                    drive.enviar_foto(os.path.basename(caminho), dados, atual["drive_pasta"],
                                      atual["permitir_download"])
                return caminho, None
            except (ErroDrive, OSError) as erro:
                return caminho, str(erro)

        with ThreadPoolExecutor(max_workers=self.processos) as executor:
            for futuro in as_completed([executor.submit(enviar_uma, f) for f in faltam]):
                caminho, erro = futuro.result()
                if erro == "cancelado":
                    continue
                if erro:
                    self.erros.append(f"{os.path.basename(caminho)}: {erro}")
                    continue
                with pj._trava:
                    atual = pj.obter(self.pid)
                    pj._atualizar(self.pid, enviadas=atual["enviadas"] + [os.path.relpath(caminho, projeto["pasta"])])
                self.feitas += 1
        if self.cancelar.is_set():
            self.estado, self.mensagem = "cancelado", f"Envio pausado: {self.feitas} de {self.total}. Clique em Enviar para continuar."
        elif self.erros:
            self.estado, self.mensagem = "erro", f"{len(self.erros)} arquivos não foram enviados. Clique em Enviar para tentar de novo."
        else:
            self.estado, self.mensagem = "concluido", f"{self.total} arquivos (fotos e vídeos) no Drive. Link pronto para o cliente."
