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

    def __init__(self, pasta: str, nome: str, modo: str = "referencia"):
        self.pasta, self.nome, self.modo = pasta, nome, modo
        self.estado, self.feitas, self.total = "lendo", 0, 0
        self.resultado: dict | None = None
        self.erro = ""

    def progresso(self, feitas: int, total: int):
        self.estado, self.feitas, self.total = "treinando", feitas, total

    def executar(self):
        try:
            self.resultado = estilo_ia.treinar_e_salvar(
                self.pasta, self.nome, PASTA_PRESETS, _nome_arquivo(self.nome, "estilo"), self.progresso,
                modo=self.modo)
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
    modo = "lightroom" if dados.get("modo") == "lightroom" else "referencia"
    _treino = Treino(dados["pasta"], (dados.get("nome") or "Meu estilo").strip(), modo)
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
    if tipo not in ("pasta", "lut", "lightroom"):
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
    amostras = max(1, min(int(dados.get("amostras") or 12), 60))
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
