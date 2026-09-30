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
from .metadados import EXTENSOES

log = logging.getLogger("editalote.projetos")

PASTA_RAIZ_DRIVE = "Durães APP · Clientes"
LADO_LEVE = 3000
IGNORAR_PASTAS = {"_revisar_desfocadas", "web"}


def _ler(caminho: str, padrao):
    import json

    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return padrao


def fotos_da_pasta(pasta: str) -> list[str]:
    """Fotos para entregar: as da pasta (e subpastas), menos as de revisão e a versão web."""
    fotos = []
    for raiz, dirs, nomes in os.walk(pasta):
        dirs[:] = sorted(d for d in dirs if d not in IGNORAR_PASTAS)
        fotos += [os.path.join(raiz, n) for n in sorted(nomes)
                  if os.path.splitext(n)[1].lower() in EXTENSOES and not n.startswith(".")]
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
        return {"configurado": configurado, "conectado": conectado, "conta": dados.get("conta", "")}

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

    def criar(self, nome: str, pasta: str, tamanho: str = "original", permitir: bool = False) -> dict:
        nome = nome.strip()
        if not nome:
            raise ValueError("Dê um nome ao projeto (ex.: Casamento Ana e João)")
        if not os.path.isdir(pasta):
            raise ValueError("Pasta das fotos não encontrada")
        if not fotos_da_pasta(pasta):
            raise ValueError("Não há fotos JPEG nessa pasta")
        projeto = {
            "id": secrets.token_hex(4), "nome": nome, "pasta": pasta,
            "tamanho": "leve" if tamanho == "leve" else "original",
            "permitir_download": bool(permitir), "criado": datetime.now().strftime("%d/%m/%Y %H:%M"),
            "drive_pasta": "", "link": "", "enviadas": [], "total": len(fotos_da_pasta(pasta)),
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

    # ---------------------------------------------------------------- envio
    def _pasta_raiz(self, drive: Drive) -> str:
        with self._trava:
            dados = self._dados()
            raiz = dados.get("drive_raiz")
        if raiz and drive.existe(raiz):
            return raiz
        raiz = drive.criar_pasta(PASTA_RAIZ_DRIVE)
        with self._trava:
            dados = self._dados()
            dados["drive_raiz"] = raiz
            self._gravar(dados)
        return raiz

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
            pasta = drive.criar_pasta(projeto["nome"], pj._pasta_raiz(drive))
            link = drive.compartilhar_com_link(pasta)
            projeto = pj._atualizar(self.pid, drive_pasta=pasta, link=link, enviadas=[])
        fotos = fotos_da_pasta(projeto["pasta"])
        ja = set(projeto.get("enviadas", []))
        faltam = [f for f in fotos if os.path.relpath(f, projeto["pasta"]) not in ja]
        self.total = len(fotos)
        self.feitas = self.total - len(faltam)
        pj._atualizar(self.pid, total=self.total)
        self.mensagem = "Enviando fotos para o Drive…"

        def enviar_uma(caminho: str):
            if self.cancelar.is_set():
                return caminho, "cancelado"
            try:
                atual = pj.obter(self.pid)
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
            self.estado, self.mensagem = "erro", f"{len(self.erros)} fotos não foram enviadas. Clique em Enviar para tentar de novo."
        else:
            self.estado, self.mensagem = "concluido", f"{self.total} fotos no Drive. Link pronto para o cliente."
