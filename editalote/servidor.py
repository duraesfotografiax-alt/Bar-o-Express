"""Servidor local: a tela abre no navegador, mas tudo roda no seu computador."""

from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import threading
import webbrowser

from flask import Flask, abort, jsonify, request, send_file, send_from_directory
from PIL import Image

from .lightroom import aprender
from .lote import OPCOES_PADRAO, Trabalho, resumo_pasta
from .metadados import EXTENSOES
from .processamento import AJUSTES_PADRAO, previa_jpeg

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTA_PRESETS = os.path.join(RAIZ, "presets")
PASTA_ESTATICA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "estatico")

app = Flask(__name__, static_folder=None)
_trabalho: Trabalho | None = None
_trava = threading.Lock()


def _jpeg_valido(caminho: str | None) -> str:
    if not caminho or os.path.splitext(caminho)[1].lower() not in EXTENSOES or not os.path.isfile(caminho):
        abort(404)
    return caminho


@app.get("/")
def inicio():
    return send_from_directory(PASTA_ESTATICA, "index.html")


@app.get("/api/padroes")
def padroes():
    return jsonify({"ajustes": AJUSTES_PADRAO, "opcoes": OPCOES_PADRAO})


@app.post("/api/escolher")
def escolher():
    """Abre a janela nativa de escolher pasta/arquivo (num processo à parte)."""
    tipo = (request.json or {}).get("tipo", "pasta")
    filtros = {
        "lut": "[('LUT', '*.cube')]",
        "lightroom": "[('Preset ou foto do Lightroom', '*.xmp *.jpg *.jpeg *.JPG *.JPEG')]",
    }
    if tipo in filtros:
        codigo = ("import tkinter as t, tkinter.filedialog as f; r=t.Tk(); r.withdraw(); "
                  "r.attributes('-topmost', True); "
                  f"print(f.askopenfilename(filetypes={filtros[tipo]}) or '')")
    else:
        codigo = ("import tkinter as t, tkinter.filedialog as f; r=t.Tk(); r.withdraw(); "
                  "r.attributes('-topmost', True); print(f.askdirectory() or '')")
    try:
        saida = subprocess.run([sys.executable, "-c", codigo], capture_output=True,
                               text=True, timeout=600)
        return jsonify({"caminho": os.path.normpath(saida.stdout.strip()) if saida.stdout.strip() else ""})
    except Exception as erro:
        return jsonify({"caminho": "", "erro": f"Não consegui abrir a janela ({erro}). Digite o caminho."})


@app.post("/api/lightroom")
def importar_lightroom():
    caminho = (request.json or {}).get("caminho", "")
    if not os.path.exists(caminho):
        return jsonify({"erro": "Arquivo ou pasta não encontrado"}), 400
    try:
        return jsonify(aprender(caminho))
    except ValueError as erro:
        return jsonify({"erro": str(erro)}), 400


@app.post("/api/escanear")
def escanear():
    dados = request.json or {}
    pasta = dados.get("pasta", "")
    if not os.path.isdir(pasta):
        return jsonify({"erro": "Pasta não encontrada"}), 400
    return jsonify(resumo_pasta(pasta, ignorar=dados.get("saida") or None))


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
        conteudo = previa_jpeg(caminho, dados.get("ajustes") or {}, int(dados.get("lado", 1400)))
    except Exception as erro:
        return jsonify({"erro": str(erro)}), 400
    return send_file(io.BytesIO(conteudo), mimetype="image/jpeg")


@app.get("/api/presets")
def listar_presets():
    presets = []
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
    arquivo = re.sub(r"[^a-z0-9]+", "-", nome.lower()).strip("-") or "preset"
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
        _trabalho = Trabalho(dados["entrada"], dados["saida"], dados.get("ajustes") or {},
                             dados.get("opcoes") or {})
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
    print(f"\n  EditaLote rodando em {url}\n  (deixe esta janela aberta; feche para encerrar)\n")
    if abrir_navegador:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=porta, debug=False, threaded=True)
