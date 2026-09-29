"""Processamento de um evento inteiro (1.000–3.000 fotos) em paralelo."""

from __future__ import annotations

import csv
import os
import shutil
import statistics
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import timedelta

from PIL import Image

from .metadados import InfoFoto, ler_info, listar_jpegs
from .processamento import (
    aplicar,
    ajustes_para_camera,
    analisar,
    carregar_lut,
    carregar_reduzida,
    completar_ajustes,
)

OPCOES_PADRAO = {
    "qualidade": 95,            # JPEG 95 com 4:4:4 = visualmente idêntico ao original
    "renomear": True,
    "prefixo": "Evento",
    "ajuste_horario": {},       # {camera: segundos a somar}
    "versao_web": False,        # cópia extra 2048 px para WhatsApp/Instagram
    "lado_web": 2048,
    "separar_desfocadas": True,
    "limite_desfoque": 0.35,    # fração da nitidez mediana da mesma câmera
}

PASTA_REVISAR = "_revisar_desfocadas"
PASTA_WEB = "web"


# ------------------------------------------------------------- planejamento

@dataclass
class ItemPlano:
    info: InfoFoto
    horario: object  # datetime | None, já com o ajuste da câmera
    nome_saida: str


def resumo_pasta(pasta: str, ignorar: str | None = None, amostras: int = 12) -> dict:
    arquivos = listar_jpegs(pasta, ignorar)
    infos = [ler_info(p) for p in arquivos]
    cameras: dict[str, dict] = {}
    for info in infos:
        c = cameras.setdefault(info.camera, {"id": info.camera, "nome": info.nome_camera,
                                             "fotos": 0, "inicio": None, "fim": None})
        c["fotos"] += 1
        if info.data:
            txt = info.data.strftime("%d/%m %H:%M:%S")
            if c["inicio"] is None or info.data < c["_i"]:
                c["inicio"], c["_i"] = txt, info.data
            if c["fim"] is None or info.data > c["_f"]:
                c["fim"], c["_f"] = txt, info.data
    for c in cameras.values():
        c.pop("_i", None)
        c.pop("_f", None)
    passo = max(1, len(arquivos) // amostras) if arquivos else 1
    return {
        "total": len(arquivos),
        "cameras": sorted(cameras.values(), key=lambda c: -c["fotos"]),
        "amostras": [
            {"caminho": i.caminho, "nome": os.path.basename(i.caminho), "camera": i.nome_camera}
            for i in infos[::passo][:amostras]
        ],
    }


def planejar(arquivos: list[str], opcoes: dict) -> list[ItemPlano]:
    ajuste = opcoes.get("ajuste_horario") or {}
    itens = []
    for caminho in arquivos:
        info = ler_info(caminho)
        horario = info.data + timedelta(seconds=float(ajuste.get(info.camera, 0) or 0)) if info.data else None
        itens.append(ItemPlano(info, horario, ""))
    # Fotos de todas as câmeras intercaladas pela hora real do evento
    itens.sort(key=lambda i: (i.horario is None, i.horario or 0, i.info.caminho))

    usados: Counter = Counter()
    digitos = max(4, len(str(len(itens))))
    for n, item in enumerate(itens, 1):
        if opcoes.get("renomear", True):
            prefixo = _limpar_nome(opcoes.get("prefixo") or "Evento")
            nome = f"{prefixo}_{n:0{digitos}d}.jpg"
        else:
            base = os.path.splitext(os.path.basename(item.info.caminho))[0]
            usados[base.lower()] += 1
            extra = f"_{usados[base.lower()]}" if usados[base.lower()] > 1 else ""
            nome = f"{base}{extra}.jpg"
        item.nome_saida = nome
    return itens


def _limpar_nome(texto: str) -> str:
    proibidos = '<>:"/\\|?*'
    return "".join("_" if ch in proibidos else ch for ch in texto).strip().replace(" ", "_") or "Evento"


# ----------------------------------------------------------------- trabalho

def processar_foto(origem: str, destino: str, ajustes: dict, opcoes: dict,
                   destino_web: str | None = None) -> dict:
    """Edita uma foto mantendo resolução, EXIF, perfil de cor e orientação."""
    analise = analisar(carregar_reduzida(origem))
    with Image.open(origem) as img:
        extras = {}
        if img.info.get("exif"):
            extras["exif"] = img.info["exif"]
        if img.info.get("icc_profile"):
            extras["icc_profile"] = img.info["icc_profile"]
        if img.info.get("dpi"):
            extras["dpi"] = img.info["dpi"]
        editada = aplicar(img.convert("RGB"), ajustes, analise, carregar_lut(ajustes))

    temporario = destino + ".parcial"
    editada.save(temporario, "JPEG", quality=int(opcoes.get("qualidade", 95)),
                 subsampling=0, **extras)
    os.replace(temporario, destino)

    if destino_web:
        lado = int(opcoes.get("lado_web", 2048))
        editada.thumbnail((lado, lado), Image.Resampling.LANCZOS)
        editada.save(destino_web, "JPEG", quality=88, optimize=True, **extras)

    return {"ev_auto": round(analise.ev_auto, 2), "nitidez": round(analise.nitidez, 1),
            "estourada": round(analise.estourada, 4)}


def _tarefa(args) -> dict:
    origem, destino, ajustes, opcoes, destino_web = args
    try:
        return {"ok": True, **processar_foto(origem, destino, ajustes, opcoes, destino_web)}
    except Exception as erro:  # uma foto corrompida não pode parar o evento inteiro
        return {"ok": False, "erro": f"{type(erro).__name__}: {erro}"}


@dataclass
class Trabalho:
    entrada: str
    saida: str
    ajustes: dict
    opcoes: dict
    total: int = 0
    feitas: int = 0
    erros: list = field(default_factory=list)
    estado: str = "parado"   # parado | preparando | processando | finalizando | concluido | cancelado | erro
    mensagem: str = ""
    inicio: float = 0.0
    fim: float = 0.0
    desfocadas: int = 0
    _cancelar: threading.Event = field(default_factory=threading.Event)

    def status(self) -> dict:
        decorrido = (self.fim or time.time()) - self.inicio if self.inicio else 0
        restante = (decorrido / self.feitas) * (self.total - self.feitas) if self.feitas else None
        return {
            "estado": self.estado, "mensagem": self.mensagem, "total": self.total,
            "feitas": self.feitas, "erros": self.erros[-20:], "qtd_erros": len(self.erros),
            "decorrido": round(decorrido), "restante": round(restante) if restante else None,
            "desfocadas": self.desfocadas, "saida": self.saida,
        }

    def cancelar(self):
        self._cancelar.set()

    def executar(self, processos: int | None = None):
        try:
            self._executar(processos)
        except Exception as erro:
            self.estado, self.mensagem = "erro", f"{type(erro).__name__}: {erro}"
        finally:
            self.fim = time.time()

    def _executar(self, processos: int | None):
        self.inicio = time.time()
        self.estado, self.mensagem = "preparando", "Lendo as fotos e organizando por horário…"
        entrada, saida = os.path.abspath(self.entrada), os.path.abspath(self.saida)
        if entrada == saida:
            raise ValueError("A pasta de saída precisa ser diferente da pasta das fotos originais")
        opcoes = {**OPCOES_PADRAO, **(self.opcoes or {})}
        ajustes = completar_ajustes(self.ajustes)
        if ajustes.get("lut") and not os.path.isfile(ajustes["lut"]):
            raise FileNotFoundError(f"LUT não encontrada: {ajustes['lut']}")

        plano = planejar(listar_jpegs(entrada, ignorar=saida), opcoes)
        self.total = len(plano)
        if not plano:
            raise ValueError("Nenhuma foto JPEG encontrada na pasta")
        os.makedirs(saida, exist_ok=True)
        pasta_web = os.path.join(saida, PASTA_WEB) if opcoes.get("versao_web") else None
        if pasta_web:
            os.makedirs(pasta_web, exist_ok=True)

        tarefas = []
        for item in plano:
            ajustes_cam = ajustes_para_camera(ajustes, item.info.camera)
            web = os.path.join(pasta_web, item.nome_saida) if pasta_web else None
            tarefas.append((item.info.caminho, os.path.join(saida, item.nome_saida),
                            ajustes_cam, opcoes, web))

        self.estado, self.mensagem = "processando", "Editando…"
        resultados: dict[int, dict] = {}
        # cada processo usa ~300 MB com fotos de 24 MP; 8 é seguro num PC de 8 GB
        processos = processos or min(8, max(1, (os.cpu_count() or 2) - 1))
        with ProcessPoolExecutor(max_workers=processos) as executor:
            # janela limitada de tarefas em voo: cancela rápido e não enche a memória
            pendentes = {}
            proxima = 0
            while proxima < len(tarefas) or pendentes:
                while proxima < len(tarefas) and len(pendentes) < processos * 2 \
                        and not self._cancelar.is_set():
                    pendentes[executor.submit(_tarefa, tarefas[proxima])] = proxima
                    proxima += 1
                if not pendentes:
                    break
                prontos, _ = wait(pendentes, return_when=FIRST_COMPLETED)
                for futuro in prontos:
                    indice = pendentes.pop(futuro)
                    resultado = futuro.result()
                    resultados[indice] = resultado
                    self.feitas += 1
                    if not resultado["ok"]:
                        self.erros.append(f"{os.path.basename(tarefas[indice][0])}: {resultado['erro']}")
                if self._cancelar.is_set() and not pendentes:
                    break

        if self._cancelar.is_set():
            self.estado, self.mensagem = "cancelado", f"Cancelado depois de {self.feitas} fotos"
            return

        self.estado, self.mensagem = "finalizando", "Conferindo fotos desfocadas e gerando relatório…"
        suspeitas = _marcar_desfocadas(plano, resultados, float(opcoes["limite_desfoque"]))
        self.desfocadas = len(suspeitas)
        if opcoes.get("separar_desfocadas") and suspeitas:
            revisar = os.path.join(saida, PASTA_REVISAR)
            os.makedirs(revisar, exist_ok=True)
            for i in suspeitas:
                nome = plano[i].nome_saida
                origem = os.path.join(saida, nome)
                if os.path.exists(origem):
                    shutil.move(origem, os.path.join(revisar, nome))
                if pasta_web and os.path.exists(os.path.join(pasta_web, nome)):
                    os.remove(os.path.join(pasta_web, nome))
        _escrever_relatorio(saida, plano, resultados, suspeitas)
        self.estado = "concluido"
        self.mensagem = f"{self.feitas - len(self.erros)} fotos prontas"


def _marcar_desfocadas(plano, resultados, limite: float) -> set[int]:
    """Compara cada foto com a mediana da mesma câmera (lentes e sensores diferem)."""
    por_camera: dict[str, list[int]] = defaultdict(list)
    for i, item in enumerate(plano):
        if resultados.get(i, {}).get("ok"):
            por_camera[item.info.camera].append(i)
    suspeitas = set()
    for indices in por_camera.values():
        if len(indices) < 10:
            continue
        mediana = statistics.median(resultados[i]["nitidez"] for i in indices)
        for i in indices:
            if resultados[i]["nitidez"] < mediana * limite:
                suspeitas.add(i)
    return suspeitas


def _escrever_relatorio(saida, plano, resultados, suspeitas):
    caminho = os.path.join(saida, "relatorio.csv")
    # ';' e BOM para abrir direto no Excel em português
    with open(caminho, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["arquivo", "original", "camera", "horario", "exposicao_auto_ev",
                    "nitidez", "situacao"])
        for i, item in enumerate(plano):
            r = resultados.get(i, {})
            if not r.get("ok"):
                situacao = "ERRO: " + r.get("erro", "não processada")
            elif i in suspeitas:
                situacao = "revisar: possivelmente desfocada"
            else:
                situacao = "ok"
            w.writerow([
                item.nome_saida, item.info.caminho, item.info.nome_camera,
                item.horario.strftime("%d/%m/%Y %H:%M:%S") if item.horario else "",
                str(r.get("ev_auto", "")).replace(".", ","),
                str(r.get("nitidez", "")).replace(".", ","), situacao,
            ])
