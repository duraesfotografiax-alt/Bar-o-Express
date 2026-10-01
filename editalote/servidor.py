"""Servidor local: a tela abre no navegador, mas tudo roda no seu computador."""

from __future__ import annotations

import io
import json
import os
import re
import logging
import subprocess
import sys
import tempfile
import threading
import unicodedata
import webbrowser

from flask import Flask, abort, jsonify, request, send_file, send_from_directory
from PIL import Image

from . import estilo_ia, nuvem
from .drive import ErroDrive, Login
from .projetos import Projetos
from .lightroom import aprender, presets_instalados
from .lote import OPCOES_PADRAO, Trabalho, resumo_pasta
from .metadados import EXTENSOES
from .processamento import AJUSTES_PADRAO, previa_jpeg

if getattr(sys, "frozen", False):
    # DuraesApp.exe: presets ficam ao lado do .exe (dá para editar e salvar novos)
    RAIZ = os.path.dirname(sys.executable)
    PASTA_ESTATICA = os.path.join(sys._MEIPASS, "editalote", "estatico")  # type: ignore[attr-defined]
else:
    RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    PASTA_ESTATICA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "estatico")
PASTA_PRESETS = os.path.join(RAIZ, "presets")

app = Flask(__name__, static_folder=None)
log = logging.getLogger("editalote")
_trabalho: Trabalho | None = None
_trava = threading.Lock()


def _jpeg_valido(caminho: str | None) -> str:
    if not caminho or os.path.splitext(caminho)[1].lower() not in EXTENSOES or not os.path.isfile(caminho):
        abort(404)
    return caminho


def _nome_arquivo(nome: str, padrao: str) -> str:
    """ "Estilo Durães" -> "estilo-duraes" (sem acento, seguro no Windows)."""
    sem_acento = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", sem_acento.lower()).strip("-") or padrao


def _resolver_estilo(ajustes: dict) -> dict:
    """O preset guarda "estilos/nome.json"; o processamento precisa do caminho completo."""
    estilo = ajustes.get("estilo_ia")
    if estilo and not os.path.isabs(estilo):
        ajustes = {**ajustes, "estilo_ia": os.path.join(PASTA_PRESETS, estilo)}
    return ajustes


class Treino:
    """Treino da IA em segundo plano (pode levar alguns minutos com milhares de fotos)."""

    def __init__(self, pasta: str, nome: str, modo: str = "referencia", pasta_finais: str = ""):
        self.pasta, self.nome, self.modo, self.pasta_finais = pasta, nome, modo, pasta_finais
        self.estado, self.feitas, self.total = "lendo", 0, 0
        self.resultado: dict | None = None
        self.erro = ""

    def progresso(self, feitas: int, total: int):
        self.estado, self.feitas, self.total = "treinando", feitas, total

    def executar(self):
        try:
            self.resultado = estilo_ia.treinar_e_salvar(
                self.pasta, self.nome, PASTA_PRESETS, _nome_arquivo(self.nome, "estilo"), self.progresso,
                modo=self.modo, pasta_finais=self.pasta_finais)
            self.estado = "concluido"
        except ValueError as erro:  # explicação para o usuário (ex.: não achou edições)
            log.warning("treino: %s", erro)
            self.estado, self.erro = "erro", str(erro)
        except Exception as erro:
            log.exception("treino falhou")
            self.estado, self.erro = "erro", f"Erro inesperado no treino: {erro}. Detalhes em duraesapp.log."

    def status(self) -> dict:
        return {"estado": self.estado, "feitas": self.feitas, "total": self.total,
                "resultado": self.resultado, "erro": self.erro}


_treino: Treino | None = None


@app.post("/api/estilo/treinar")
def treinar_estilo():
    global _treino
    dados = request.json or {}
    if not os.path.isdir(dados.get("pasta", "")):
        return jsonify({"erro": "Pasta não encontrada"}), 400
    if _treino and _treino.estado in ("lendo", "treinando"):
        return jsonify({"erro": "Já tem um treino em andamento"}), 409
    modo = dados.get("modo") if dados.get("modo") in ("lightroom", "pares") else "referencia"
    if modo == "pares" and not os.path.isdir(dados.get("pasta_finais", "")):
        return jsonify({"erro": "Pasta das fotos finais não encontrada"}), 400
    _treino = Treino(dados["pasta"], (dados.get("nome") or "Meu estilo").strip(), modo,
                     dados.get("pasta_finais", ""))
    threading.Thread(target=_treino.executar, daemon=True).start()
    return jsonify({"ok": True})


@app.get("/api/estilo/status")
def status_treino():
    return jsonify(_treino.status() if _treino else {"estado": "parado"})


@app.get("/")
def inicio():
    return send_from_directory(PASTA_ESTATICA, "index.html")


@app.get("/estatico/<path:arquivo>")
def estatico(arquivo):
    return send_from_directory(PASTA_ESTATICA, arquivo)


@app.get("/api/padroes")
def padroes():
    return jsonify({"ajustes": AJUSTES_PADRAO, "opcoes": OPCOES_PADRAO})


@app.post("/api/escolher")
def escolher():
    """Abre a janela nativa de escolher pasta/arquivo (num processo à parte)."""
    tipo = (request.json or {}).get("tipo", "pasta")
    if tipo not in ("pasta", "lut", "lightroom", "json"):
        tipo = "pasta"
    descritor, resposta = tempfile.mkstemp(prefix="duraesapp-", suffix=".txt")
    os.close(descritor)
    if getattr(sys, "frozen", False):  # DuraesApp.exe
        comando = [sys.executable, "_escolher", tipo, "--saida", resposta]
    else:
        comando = [sys.executable, "-m", "editalote", "_escolher", tipo, "--saida", resposta]
    try:
        subprocess.run(comando, timeout=600, cwd=RAIZ,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        with open(resposta, encoding="utf-8") as f:
            caminho = f.read().strip()
        return jsonify({"caminho": os.path.normpath(caminho) if caminho else ""})
    except Exception as erro:
        log.exception("janela de escolher falhou")
        return jsonify({"caminho": "", "erro": f"Não consegui abrir a janela ({erro}). Digite o caminho."})
    finally:
        try:
            os.remove(resposta)
        except OSError:
            pass


@app.post("/api/lightroom")
def importar_lightroom():
    caminho = (request.json or {}).get("caminho", "")
    if not os.path.exists(caminho):
        return jsonify({"erro": "Arquivo ou pasta não encontrado"}), 400
    try:
        return jsonify(aprender(caminho))
    except ValueError as erro:
        return jsonify({"erro": str(erro)}), 400


@app.get("/api/lightroom/presets")
def presets_lightroom():
    return jsonify(presets_instalados())


@app.get("/api/nuvem")
def pastas_nuvem():
    return jsonify(nuvem.detectar_nuvens())


@app.post("/api/nuvem/entrega")
def pasta_entrega():
    dados = request.json or {}
    if not os.path.isdir(dados.get("nuvem", "")):
        return jsonify({"erro": "Escolha primeiro a pasta da nuvem"}), 400
    return jsonify({"caminho": nuvem.pasta_entrega(dados["nuvem"], dados.get("evento") or "Evento")})


@app.post("/api/escanear")
def escanear():
    dados = request.json or {}
    pasta = dados.get("pasta", "")
    if not os.path.isdir(pasta):
        return jsonify({"erro": "Pasta não encontrada"}), 400
    amostras = max(1, min(int(dados.get("amostras") or 12), 20000))
    return jsonify(resumo_pasta(pasta, ignorar=dados.get("saida") or None, amostras=amostras))


@app.get("/api/miniatura")
def miniatura():
    caminho = _jpeg_valido(request.args.get("caminho"))
    lado = min(int(request.args.get("lado", 400)), 1600)
    with Image.open(caminho) as img:
        img.draft("RGB", (lado, lado))
        img = img.convert("RGB")
        img.thumbnail((lado, lado))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=85)
    buf.seek(0)
    return send_file(buf, mimetype="image/jpeg")


@app.post("/api/previa")
def previa():
    dados = request.json or {}
    caminho = _jpeg_valido(dados.get("caminho"))
    try:
        conteudo, ajuste_ia = previa_jpeg(caminho, _resolver_estilo(dados.get("ajustes") or {}),
                                          int(dados.get("lado", 1400)))
    except Exception as erro:
        return jsonify({"erro": str(erro)}), 400
    resposta = send_file(io.BytesIO(conteudo), mimetype="image/jpeg")
    resposta.headers["X-Ajuste-IA"] = json.dumps(ajuste_ia)
    return resposta


@app.get("/api/presets")
def listar_presets():
    presets = []
    os.makedirs(PASTA_PRESETS, exist_ok=True)
    for nome in sorted(os.listdir(PASTA_PRESETS)):
        if nome.endswith(".json"):
            with open(os.path.join(PASTA_PRESETS, nome), encoding="utf-8") as f:
                presets.append({"arquivo": nome, **json.load(f)})
    return jsonify(presets)


@app.post("/api/presets")
def salvar_preset():
    ajustes = request.json or {}
    nome = (ajustes.get("nome") or "").strip()
    if not nome:
        return jsonify({"erro": "Dê um nome ao preset"}), 400
    arquivo = _nome_arquivo(nome, "preset")
    os.makedirs(PASTA_PRESETS, exist_ok=True)
    caminho = os.path.join(PASTA_PRESETS, f"{arquivo}.json")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(ajustes, f, ensure_ascii=False, indent=2)
    return jsonify({"arquivo": f"{arquivo}.json"})


@app.post("/api/processar")
def processar():
    global _trabalho
    dados = request.json or {}
    with _trava:
        if _trabalho and _trabalho.estado in ("preparando", "processando", "finalizando"):
            return jsonify({"erro": "Já tem um lote sendo processado"}), 409
        if not os.path.isdir(dados.get("entrada", "")):
            return jsonify({"erro": "Pasta das fotos não encontrada"}), 400
        if not dados.get("saida"):
            return jsonify({"erro": "Escolha a pasta de saída"}), 400
        _trabalho = Trabalho(dados["entrada"], dados["saida"],
                             _resolver_estilo(dados.get("ajustes") or {}), dados.get("opcoes") or {})
        threading.Thread(target=_trabalho.executar, daemon=True).start()
    return jsonify({"ok": True})


@app.get("/api/status")
def status():
    return jsonify(_trabalho.status() if _trabalho else {"estado": "parado"})


@app.post("/api/cancelar")
def cancelar():
    if _trabalho:
        _trabalho.cancelar()
    return jsonify({"ok": True})


# ------------------------------------------------ entrega para clientes (Google Drive)

projetos = Projetos(RAIZ)
_login: Login | None = None


def _erro(erro: Exception, codigo: int = 400):
    return jsonify({"erro": str(erro)}), codigo


@app.get("/api/drive/estado")
def drive_estado():
    return jsonify(projetos.conexao())


@app.post("/api/drive/configurar")
def drive_configurar():
    caminho = (request.json or {}).get("caminho", "")
    try:
        projetos.configurar_cliente(caminho)
    except (ErroDrive, OSError, ValueError) as erro:
        return _erro(erro)
    return jsonify(projetos.conexao())


@app.post("/api/drive/entrar")
def drive_entrar():
    """Abre o login do Google no navegador; o Google devolve para /api/drive/retorno."""
    global _login
    try:
        cliente = projetos.cliente()
    except (ErroDrive, OSError, ValueError) as erro:
        return _erro(erro)
    if not cliente:
        return _erro(ErroDrive("Configure o Google Drive primeiro (arquivo do ID do cliente)."))
    porta = request.host.rsplit(":", 1)[-1]
    _login = Login(cliente, f"http://127.0.0.1:{porta}/api/drive/retorno")
    webbrowser.open(_login.url())
    return jsonify({"ok": True})


PAGINA_RETORNO = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Durães APP</title>
<style>body{{background:#070707;color:#f5f5f5;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0}}
div{{text-align:center;max-width:460px}}h1{{color:{cor};font-weight:600}}</style></head>
<body><div><h1>{titulo}</h1><p>{texto}</p></div></body></html>"""


@app.get("/api/drive/retorno")
def drive_retorno():
    if request.args.get("error"):
        return PAGINA_RETORNO.format(cor="#ff6b5b", titulo="Login cancelado",
                                     texto="Volte ao Durães APP e clique em Entrar com Google de novo.")
    try:
        if not _login:
            raise ErroDrive("Login expirado. Clique em Entrar com Google de novo no Durães APP.")
        token = _login.trocar_codigo(request.args.get("code", ""), request.args.get("state", ""))
        projetos.salvar_token(token)
        projetos.lembrar_conta(projetos.drive().conta())
    except ErroDrive as erro:
        log.warning("login Google: %s", erro)
        return PAGINA_RETORNO.format(cor="#ff6b5b", titulo="Não deu certo", texto=str(erro))
    return PAGINA_RETORNO.format(cor="#f4ba59", titulo="Pronto! Google Drive conectado",
                                 texto="Pode fechar esta aba e voltar ao Durães APP.")


@app.post("/api/drive/sair")
def drive_sair():
    projetos.sair()
    projetos.lembrar_conta("")
    return jsonify(projetos.conexao())


@app.get("/api/projetos")
def projetos_listar():
    return jsonify(projetos.listar())


@app.post("/api/projetos")
def projetos_criar():
    dados = request.json or {}
    try:
        projeto = projetos.criar(dados.get("nome", ""), dados.get("pasta", ""),
                                 dados.get("tamanho", "original"), bool(dados.get("permitir_download")))
        if dados.get("enviar", True):
            projetos.enviar(projeto["id"])
    except (ValueError, ErroDrive) as erro:
        return _erro(erro)
    return jsonify(projeto)


@app.post("/api/projetos/<pid>/enviar")
def projetos_enviar(pid):
    try:
        projetos.enviar(pid)
    except (ValueError, ErroDrive, KeyError) as erro:
        return _erro(erro)
    return jsonify({"ok": True})


@app.post("/api/projetos/<pid>/download")
def projetos_download(pid):
    try:
        return jsonify(projetos.alterar_download(pid, bool((request.json or {}).get("permitir"))))
    except (ErroDrive, KeyError) as erro:
        return _erro(erro)


@app.delete("/api/projetos/<pid>")
def projetos_excluir(pid):
    try:
        projetos.excluir(pid, request.args.get("drive") == "1")
    except (ValueError, ErroDrive, KeyError) as erro:
        return _erro(erro)
    return jsonify({"ok": True})


@app.get("/api/projetos/envio")
def projetos_envio():
    return jsonify(projetos.status_envio())


@app.post("/api/projetos/envio/cancelar")
def projetos_cancelar():
    projetos.cancelar_envio()
    return jsonify({"ok": True})


@app.post("/api/abrir-link")
def abrir_link():
    """Abre no navegador do computador só links de entrega (Drive e WhatsApp)."""
    url = (request.json or {}).get("url", "")
    if url.startswith(("https://drive.google.com/", "https://wa.me/")):
        webbrowser.open(url)
        return jsonify({"ok": True})
    return _erro(ValueError("Link não permitido"))


@app.post("/api/abrir-pasta")
def abrir_pasta():
    pasta = (request.json or {}).get("pasta", "")
    if os.path.isdir(pasta):
        if sys.platform.startswith("win"):
            os.startfile(pasta)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", pasta])
        else:
            subprocess.Popen(["xdg-open", pasta])
    return jsonify({"ok": True})


def iniciar(porta: int = 8765, abrir_navegador: bool = True):
    url = f"http://127.0.0.1:{porta}"
    print(f"\n  Durães APP rodando em {url}\n  (deixe esta janela aberta; feche para encerrar)\n")
    if abrir_navegador:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=porta, debug=False, threaded=True)
