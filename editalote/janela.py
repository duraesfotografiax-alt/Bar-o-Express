"""Durães APP como programa de PC: janela própria (motor do Edge/WebView2 no Windows).

O servidor local continua existindo por baixo, mas o usuário só vê a janela do programa.
Se a janela nativa não puder abrir (ex.: Windows sem WebView2), cai para o navegador.
"""

from __future__ import annotations

import logging
import os
import socket
import sys
import threading
import webbrowser

log = logging.getLogger("editalote")

TITULO = "Durães APP · Edição em lote com IA"


def _porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def configurar_log(pasta: str) -> str:
    """Programa sem console: tudo que seria impresso vai para duraesapp.log."""
    caminho = os.path.join(pasta, "duraesapp.log")
    try:
        manipulador = logging.FileHandler(caminho, encoding="utf-8")
    except OSError:
        return ""
    logging.basicConfig(level=logging.INFO, handlers=[manipulador],
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    arquivo = manipulador.stream
    if sys.stdout is None:
        sys.stdout = arquivo
    if sys.stderr is None:
        sys.stderr = arquivo
    return caminho


class Api:
    """Funções que a tela chama direto (pywebview.api.*), sem passar pelo navegador.

    Atenção: o pywebview publica para a tela todo atributo público deste objeto. A janela fica
    em "_janela" (com sublinhado) para NÃO ser publicada; publicar a janela inteira quebra a API.
    """

    def __init__(self):
        self._janela = None

    def escolher(self, tipo: str = "pasta") -> str:
        import webview

        tipos = {
            "lut": ("LUT (*.cube)",),
            "lightroom": ("Preset ou foto do Lightroom (*.xmp;*.jpg;*.jpeg)",),
            "json": ("ID do cliente Google (*.json)",),
        }
        if tipo in tipos:
            escolhido = self._janela.create_file_dialog(webview.FileDialog.OPEN, file_types=tipos[tipo])
        else:
            escolhido = self._janela.create_file_dialog(webview.FileDialog.FOLDER)
        if not escolhido:
            return ""
        return escolhido[0] if isinstance(escolhido, (list, tuple)) else str(escolhido)


def _iniciar_servidor(porta: int):
    from werkzeug.serving import make_server

    from .servidor import app

    servidor = make_server("127.0.0.1", porta, app, threaded=True)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    return servidor


def _janela_de_reserva(url: str):
    """Sem janela nativa: abre no navegador e mostra uma janelinha para encerrar o programa."""
    webbrowser.open(url)
    try:
        import tkinter

        raiz = tkinter.Tk()
        raiz.title(TITULO)
        raiz.configure(bg="#0a0a0a")
        tkinter.Label(raiz, text="O Durães APP está aberto no navegador.\nFeche esta janela para encerrar.",
                      bg="#0a0a0a", fg="#f5f5f5", padx=24, pady=16).pack()
        tkinter.Button(raiz, text="Abrir de novo", command=lambda: webbrowser.open(url)).pack(pady=(0, 16))
        raiz.mainloop()
    except Exception:
        log.exception("sem tkinter; o servidor segue rodando até o processo ser encerrado")
        threading.Event().wait()


def _autoteste(janela):
    """Confere, dentro da janela de verdade, se a tela enxerga a API (usado no teste do GitHub)."""
    import time

    resultado = "sem resposta"
    try:
        janela.events.loaded.wait(30)
        for _ in range(40):
            resultado = janela.evaluate_js(
                "window.pywebview && window.pywebview.api ? typeof window.pywebview.api.escolher : 'ausente'")
            if resultado == "function":
                break
            time.sleep(0.5)
    except Exception as erro:
        resultado = f"erro: {erro}"
    log.info("autoteste api.escolher=%s", resultado)
    janela.destroy()


def abrir(porta: int | None = None, pasta_log: str | None = None, autoteste: bool = False) -> int:
    if pasta_log:
        configurar_log(pasta_log)
    porta = porta or _porta_livre()
    servidor = _iniciar_servidor(porta)
    url = f"http://127.0.0.1:{porta}"
    log.info("Durães APP em %s", url)
    try:
        import webview

        api = Api()
        api._janela = webview.create_window(TITULO, url, js_api=api, width=1480, height=920,
                                            min_size=(1100, 720), background_color="#0a0a0a")
        if autoteste:
            threading.Thread(target=_autoteste, args=(api._janela,), daemon=True).start()
        webview.start(gui="edgechromium" if sys.platform.startswith("win") else None)
    except Exception:
        log.exception("janela nativa indisponível; abrindo no navegador")
        if autoteste:  # no teste automático não há ninguém para fechar a janela de reserva
            servidor.shutdown()
            return 1
        _janela_de_reserva(url)
    servidor.shutdown()
    return 0
