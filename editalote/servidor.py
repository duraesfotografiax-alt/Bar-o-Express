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
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, abort, jsonify, request, send_file, send_from_directory
from PIL import Image

from . import estilo_ia, nuvem
from .drive import ErroDrive, Login
from .projetos import EMPRESAS, Projetos
from .lightroom import aprender, presets_instalados
from .lote import OPCOES_PADRAO, Trabalho, resumo_pasta
from .metadados import EXTENSOES
from .processamento import AJUSTES_PADRAO, previa_jpeg

from . import caminhos

caminhos.preparar()
RAIZ = caminhos.PROGRAMA            # pasta do programa (log)
DADOS = caminhos.DADOS              # configurações, projetos e estilos (não somem ao atualizar)
PASTA_ESTATICA = caminhos.PASTA_ESTATICA
PASTA_PRESETS = caminhos.PASTA_PRESETS

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
            if self.modo == "tipos":
                self.resultado = self._todos_os_tipos()
                self.estado = "concluido"
                return
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

    def _todos_os_tipos(self) -> dict:
        """Um preset de IA para cada subpasta (Casamento, Aniversário, Ensaio...)."""
        tipos = estilo_ia.tipos_de_evento(self.pasta)
        if not tipos:
            raise ValueError("Não achei subpastas com fotos JPEG. Escolha a pasta principal, que tem "
                             "uma subpasta para cada tipo de evento (ex.: Casamento, Aniversário, Ensaio).")
        criados, falhas = [], []
        for i, (nome, caminho) in enumerate(tipos):
            def progresso(feitas, total, i=i):
                self.progresso(i * 100 + int(100 * feitas / max(total, 1)), len(tipos) * 100)
            nome_preset = f"{self.nome} · {nome}" if self.nome else nome
            try:
                r = estilo_ia.treinar_e_salvar(caminho, nome_preset, PASTA_PRESETS,
                                               _nome_arquivo(nome_preset, "estilo"), progresso,
                                               modo="referencia")
                criados.append({"nome": nome_preset, "arquivo": r["arquivo"], "fotos": r["fotos"]})
            except ValueError as erro:
                falhas.append(f"{nome}: {erro}")
        if not criados:
            raise ValueError("Nenhum tipo de evento pôde ser aprendido. " + " ".join(falhas))
        resumo = "; ".join(f"{c['nome']} ({c['fotos']} fotos)" for c in criados)
        return {"arquivo": criados[0]["arquivo"], "fotos": sum(c["fotos"] for c in criados),
                "modo": "tipos", "criados": criados, "precisao": {}, "ignorados": [],
                "diagnostico": f"Criei {len(criados)} presets: {resumo}." +
                               (f" Não deu em: {'; '.join(falhas)}" if falhas else "")}

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
    modo = dados.get("modo") if dados.get("modo") in ("lightroom", "pares", "tipos") else "referencia"
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
    from .geometria import orientar

    with Image.open(caminho) as img:
        img.draft("RGB", (lado, lado))
        img = orientar(img).convert("RGB")
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
                                          int(dados.get("lado", 1400)),
                                          so_geometria=bool(dados.get("so_geometria")),
                                          sem_corte=bool(dados.get("sem_corte")))
    except Exception as erro:
        return jsonify({"erro": str(erro)}), 400
    resposta = send_file(io.BytesIO(conteudo), mimetype="image/jpeg")
    resposta.headers["X-Ajuste-IA"] = json.dumps(ajuste_ia)
    return resposta


@app.post("/api/auto-endireitar")
def auto_endireitar():
    """Ângulo automático para a foto, medido depois do giro/espelho/perspectiva já escolhidos."""
    from .geometria import aplicar_geometria, angulo_automatico
    from .processamento import carregar_reduzida

    dados = request.json or {}
    caminho = _jpeg_valido(dados.get("caminho"))
    a = dados.get("ajustes") or {}
    base = {k: a.get(k, 0) for k in ("girar", "espelhar", "perspectiva_v", "perspectiva_h")}
    img = aplicar_geometria(carregar_reduzida(caminho, 1200), base, sem_corte=True)
    return jsonify({"endireitar": angulo_automatico(img)})


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

projetos = Projetos(DADOS)
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


def _empresa() -> str:
    e = request.args.get("empresa") or (request.get_json(silent=True) or {}).get("empresa") or "duraes"
    return e if e in EMPRESAS else "duraes"


@app.get("/api/projetos")
def projetos_listar():
    return jsonify(projetos.listar_empresa(_empresa()))


# ------------------------------------------------------------- aba Drive (navegar nas pastas)
PASTA_MIME = "application/vnd.google-apps.folder"
_miniaturas: dict = {}


def _item(i: dict) -> dict:
    mime = i.get("mimeType", "")
    alvo = (i.get("shortcutDetails") or {})
    return {"id": alvo.get("targetId") or i["id"], "nome": i.get("name", ""), "mime": alvo.get("targetMimeType") or mime,
            "pasta": (alvo.get("targetMimeType") or mime) == PASTA_MIME, "tamanho": int(i.get("size") or 0),
            "video": mime.startswith("video/"), "imagem": mime.startswith("image/"),
            "miniatura": bool(i.get("thumbnailLink")), "modificado": i.get("modifiedTime", ""),
            "link": i.get("webViewLink", "")}


@app.get("/api/pastas")
def pastas_listar():
    """Conteúdo de uma pasta do Drive. Sem id: a pasta principal da empresa (criada se preciso)."""
    try:
        drive = projetos.drive()
        empresa = _empresa()
        raiz = projetos._pasta_raiz(drive, empresa)
        pasta = request.args.get("id") or raiz
        meu_drive = pasta == "root"
        itens = drive.itens(pasta)
        for i in itens:
            if i.get("thumbnailLink"):
                _miniaturas[i["id"]] = i["thumbnailLink"]
        caminho = [{"id": "root", "name": "Meu Drive"}] if meu_drive else drive.caminho(pasta)
        if caminho and caminho[0]["id"] != "root" and caminho[0].get("name") in ("Meu Drive", "My Drive"):
            caminho[0] = {"id": "root", "name": "Meu Drive"}
        projeto = None if meu_drive else projetos.projeto_da_pasta(pasta)
        return jsonify({"pasta": caminho[-1] if caminho else {"id": pasta, "name": ""}, "caminho": caminho,
                        "raiz": raiz, "meu_drive": meu_drive, "itens": [_item(i) for i in itens],
                        "link": drive.link_publico(pasta) if pasta not in (raiz, "root") else None,
                        "projeto": projeto, "link_album": projetos.link_album(projeto) if projeto else ""})
    except ErroDrive as erro:
        return _erro(erro)


@app.get("/api/pastas/miniatura/<arquivo_id>")
def pastas_miniatura(arquivo_id):
    url = _miniaturas.get(arquivo_id)
    if not url:
        abort(404)
    tamanho = request.args.get("t", "400")
    url = re.sub(r"=s\d+$", f"=s{int(tamanho)}", url)
    try:
        dados, tipo = projetos.drive().baixar_miniatura(url)
    except ErroDrive:
        abort(404)
    resposta = send_file(io.BytesIO(dados), mimetype=tipo)
    resposta.headers["Cache-Control"] = "private, max-age=3000"
    return resposta


@app.post("/api/pastas")
def pastas_criar():
    dados = request.json or {}
    nome = (dados.get("nome") or "").strip()
    if not nome:
        return jsonify({"erro": "Dê um nome para a pasta"}), 400
    try:
        drive = projetos.drive()
        pai = dados.get("pai") or projetos._pasta_raiz(drive, _empresa())
        return jsonify({"id": drive.criar_pasta(nome, pai)})
    except ErroDrive as erro:
        return _erro(erro)


@app.post("/api/pastas/<pasta_id>/link")
def pastas_link(pasta_id):
    try:
        drive = projetos.drive()
        link = drive.compartilhar_com_link(pasta_id)
        projeto = projetos.projeto_da_pasta(pasta_id)
        if projeto:
            projetos._atualizar(projeto["id"], link=link)
        return jsonify({"link": link})
    except ErroDrive as erro:
        return _erro(erro)


@app.delete("/api/pastas/<pasta_id>/link")
def pastas_tirar_link(pasta_id):
    try:
        projetos.drive().tirar_link(pasta_id)
        return jsonify({"ok": True})
    except ErroDrive as erro:
        return _erro(erro)


@app.post("/api/pastas/<pasta_id>/download")
def pastas_download(pasta_id):
    """Liga/desliga o download para o cliente (vale para cada arquivo da pasta)."""
    permitir = bool((request.json or {}).get("permitir"))
    try:
        drive = projetos.drive()
        itens = [i for i in drive.itens(pasta_id) if i.get("mimeType") != PASTA_MIME]
        with ThreadPoolExecutor(max_workers=4) as ex:
            list(ex.map(lambda i: drive.permitir_download(i["id"], permitir), itens))
        projeto = projetos.projeto_da_pasta(pasta_id)
        if projeto:
            projetos._atualizar(projeto["id"], permitir_download=permitir)
        return jsonify({"ok": True, "arquivos": len(itens)})
    except ErroDrive as erro:
        return _erro(erro)


@app.post("/api/pastas/<pasta_id>/renomear")
def pastas_renomear(pasta_id):
    nome = ((request.json or {}).get("nome") or "").strip()
    if not nome:
        return jsonify({"erro": "Nome vazio"}), 400
    try:
        projetos.drive().renomear(pasta_id, nome)
        projeto = projetos.projeto_da_pasta(pasta_id)
        if projeto:
            projetos._atualizar(projeto["id"], nome=nome)
        return jsonify({"ok": True})
    except ErroDrive as erro:
        return _erro(erro)


@app.delete("/api/pastas/<pasta_id>")
def pastas_lixeira(pasta_id):
    try:
        if pasta_id == projetos.raiz_empresa(_empresa()):
            return jsonify({"erro": "Essa é a pasta principal da empresa"}), 400
        projetos.drive().mover_para_lixeira(pasta_id)
        return jsonify({"ok": True})
    except ErroDrive as erro:
        return _erro(erro)


@app.post("/api/pastas/<pasta_id>/enviar")
def pastas_enviar(pasta_id):
    """Envia fotos e vídeos de uma pasta do computador para esta pasta do Drive."""
    dados = request.json or {}
    try:
        projetos.enviar_para_pasta(pasta_id, dados.get("nome") or "Cliente", _empresa(),
                                   dados.get("pasta_local", ""), dados.get("tamanho", "original"),
                                   bool(dados.get("permitir_download")))
        return jsonify({"ok": True, "projeto": projetos.projeto_da_pasta(pasta_id)})
    except (ValueError, ErroDrive) as erro:
        return _erro(erro)


@app.post("/api/pastas/<pasta_id>/principal")
def pastas_principal(pasta_id):
    projetos.definir_raiz(_empresa(), pasta_id)
    return jsonify({"ok": True})


@app.post("/api/pastas/<pasta_id>/album")
def pastas_album(pasta_id):
    """Libera a seleção do álbum para uma pasta do Drive (cria o projeto se preciso)."""
    dados = request.json or {}
    try:
        projeto = projetos.vincular(pasta_id, dados.get("nome") or "Cliente", _empresa())
        projeto = projetos.ativar_album(projeto["id"], dados.get("limite", 0))
        return jsonify({"projeto": projeto, "link": projetos.link_album(projeto)})
    except (ValueError, ErroDrive) as erro:
        return _erro(erro)


@app.post("/api/projetos")
def projetos_criar():
    dados = request.json or {}
    try:
        projeto = projetos.criar(dados.get("nome", ""), dados.get("pasta", ""),
                                 dados.get("tamanho", "original"), bool(dados.get("permitir_download")),
                                 empresa=_empresa(), pai=dados.get("pai", ""))
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


# ---------------------------------------------------------------------- álbum
@app.get("/api/album/config")
def album_config():
    return jsonify({"url": projetos.url_seletor()})


@app.post("/api/album/config")
def album_config_salvar():
    try:
        projetos.configurar_seletor((request.json or {}).get("url", ""))
    except ValueError as erro:
        return jsonify({"erro": str(erro)}), 400
    return jsonify({"ok": True})


@app.get("/api/album/script")
def album_script():
    with open(os.path.join(os.path.dirname(__file__), "estatico", "seletor_album.gs"), encoding="utf-8") as f:
        return jsonify({"codigo": f.read()})


def _resposta_album(pid: str, acao):
    try:
        resultado = acao()
        projeto = projetos.obter(pid)
        return jsonify({**(resultado if isinstance(resultado, dict) else {}),
                        "link": projetos.link_album(projeto), "projeto": projeto})
    except (ValueError, ErroDrive, OSError) as erro:
        return jsonify({"erro": str(erro)}), 400
    except KeyError:
        return jsonify({"erro": "Projeto não encontrado"}), 404


@app.post("/api/projetos/<pid>/album")
def album_ativar(pid):
    return _resposta_album(pid, lambda: projetos.ativar_album(pid, (request.json or {}).get("limite", 0)) and {})


@app.get("/api/projetos/<pid>/album")
def album_selecao(pid):
    return _resposta_album(pid, lambda: {"selecao": projetos.selecao_album(pid)})


@app.post("/api/projetos/<pid>/album/reabrir")
def album_reabrir(pid):
    return _resposta_album(pid, lambda: {"selecao": projetos.reabrir_album(pid)})


@app.post("/api/projetos/<pid>/album/separar")
def album_separar(pid):
    nomes = (request.json or {}).get("nomes")
    pasta_local = (request.json or {}).get("pasta_local", "")
    if isinstance(nomes, str):   # lista colada (WhatsApp): um nome por linha, vírgula ou espaço
        import re

        nomes = [n for n in re.split(r"[\s,;]+", nomes) if n]
    return _resposta_album(pid, lambda: projetos.separar_album(pid, nomes, pasta_local))


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
