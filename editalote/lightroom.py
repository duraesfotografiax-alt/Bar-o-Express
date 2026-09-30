"""Importa ajustes do Lightroom (presets .xmp ou fotos com a edição salva no XMP).

O Lightroom guarda a revelação em campos "crs:" (Camera Raw Settings). Aqui eles são
convertidos para os ajustes equivalentes do Durães APP. Ferramentas que o Durães APP
ainda não tem (Claridade, HSL, máscaras…) são listadas como ignoradas.
"""

from __future__ import annotations

import os
import statistics
import xml.etree.ElementTree as ET

import numpy as np

from .metadados import EXTENSOES

CRS = "{http://ns.adobe.com/camera-raw-settings/1.0/}"
RDF = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}"

# campo do Lightroom -> (campo do Durães APP, fator)
MAPA = {
    "Exposure2012": ("exposicao", 1.0),
    "Contrast2012": ("contraste", 1.0),
    "Highlights2012": ("realces", 1.0),
    "Shadows2012": ("sombras", 1.0),
    "Whites2012": ("brancos", 1.0),
    "Blacks2012": ("pretos", 1.0),
    "IncrementalTemperature": ("temperatura", 1.0),  # JPEG: -100..100
    "IncrementalTint": ("matiz", 1.0),
    "Vibrance": ("vibracao", 1.0),
    "Saturation": ("saturacao", 1.0),
    "Sharpness": ("nitidez", 1 / 1.5),
    "Clarity2012": ("claridade", 1.0),
    "Texture": ("textura", 1.0),
    "ParametricShadows": ("curva_sombras", 1.0),
    "ParametricDarks": ("curva_escuros", 1.0),
    "ParametricLights": ("curva_claros", 1.0),
    "ParametricHighlights": ("curva_realces", 1.0),
}

CORES_LR = {"Red": "vermelho", "Orange": "laranja", "Yellow": "amarelo", "Green": "verde",
            "Aqua": "aqua", "Blue": "azul", "Purple": "roxo", "Magenta": "magenta"}
for _lr, _nosso in CORES_LR.items():
    MAPA[f"HueAdjustment{_lr}"] = (f"hsl_matiz_{_nosso}", 1.0)
    MAPA[f"SaturationAdjustment{_lr}"] = (f"hsl_sat_{_nosso}", 1.0)
    MAPA[f"LuminanceAdjustment{_lr}"] = (f"hsl_lum_{_nosso}", 1.0)

CURVAS = {
    "ToneCurvePV2012": "curva",
    "ToneCurvePV2012Red": "curva_r",
    "ToneCurvePV2012Green": "curva_g",
    "ToneCurvePV2012Blue": "curva_b",
}

# Ferramentas ainda não suportadas: aviso quando estiverem em uso
NAO_SUPORTADOS = {
    "Dehaze": "Remover névoa",
    "PostCropVignetteAmount": "Vinheta",
    "GrainAmount": "Granulação",
    "LuminanceSmoothing": "Redução de ruído",
}
PREFIXOS_NAO_SUPORTADOS = {
    "ColorGrade": "Gradação de cor",
    "SplitToning": "Tonalização dividida",
}


def _numero(texto: str) -> float | None:
    try:
        return float(str(texto).strip().replace(",", "."))
    except ValueError:
        return None


def extrair_xmp(dados: bytes) -> bytes | None:
    inicio = dados.find(b"<x:xmpmeta")
    fim = dados.find(b"</x:xmpmeta>")
    if inicio < 0 or fim < 0:
        return None
    return dados[inicio:fim + len(b"</x:xmpmeta>")]


XMP_PRINCIPAL = b"http://ns.adobe.com/xap/1.0/\x00"
XMP_ESTENDIDO = b"http://ns.adobe.com/xmp/extension/\x00"


def pacotes_xmp_jpeg(dados: bytes) -> list[bytes]:
    """XMP de um JPEG, inclusive o "XMP estendido".

    Quando a edição é grande (máscaras, muitos ajustes), o Lightroom não cabe num bloco só do
    JPEG (limite de 64 KB) e grava o resto em blocos "estendidos", que precisam ser remontados.
    """
    if dados[:2] != b"\xff\xd8":
        return []
    pos, principal, estendidos = 2, None, {}
    while pos + 4 <= len(dados) and dados[pos] == 0xFF:
        marcador = dados[pos + 1]
        if marcador == 0xFF:
            pos += 1
            continue
        if marcador in (0xD8, 0x01) or 0xD0 <= marcador <= 0xD7:
            pos += 2
            continue
        if marcador == 0xDA:  # começo da imagem: acabaram os metadados
            break
        tamanho = int.from_bytes(dados[pos + 2:pos + 4], "big")
        corpo = dados[pos + 4:pos + 2 + tamanho]
        if marcador == 0xE1 and corpo.startswith(XMP_PRINCIPAL):
            principal = corpo[len(XMP_PRINCIPAL):]
        elif marcador == 0xE1 and corpo.startswith(XMP_ESTENDIDO):
            resto = corpo[len(XMP_ESTENDIDO):]
            guid, deslocamento = resto[:32], int.from_bytes(resto[36:40], "big")
            estendidos.setdefault(guid, {})[deslocamento] = resto[40:]
        pos += 2 + tamanho
    pacotes = [principal] if principal else []
    for partes in estendidos.values():
        pacotes.append(b"".join(partes[k] for k in sorted(partes)))
    return pacotes


def _crs_do_pacote(pacote: bytes) -> dict:
    inicio = min((i for i in (pacote.find(b"<x:xmpmeta"), pacote.find(b"<rdf:RDF")) if i >= 0), default=-1)
    if inicio < 0:
        return {}
    fim_meta, fim_rdf = pacote.rfind(b"</x:xmpmeta>"), pacote.rfind(b"</rdf:RDF>")
    fim = fim_meta + len(b"</x:xmpmeta>") if fim_meta >= 0 else fim_rdf + len(b"</rdf:RDF>")
    try:
        raiz = ET.fromstring(pacote[inicio:fim])
    except ET.ParseError:
        return {}
    rdf = raiz if raiz.tag == f"{RDF}RDF" else raiz.find(f"{RDF}RDF")
    if rdf is None:
        return {}
    campos: dict = {}
    # Só a descrição principal: dentro de "Look" (perfil criativo) e das máscaras há outros
    # crs: com valores próprios que não são os ajustes da foto
    for descricao in rdf.findall(f"{RDF}Description"):
        for chave, valor in descricao.attrib.items():
            if chave.startswith(CRS):
                campos[chave[len(CRS):]] = valor
        for filho in descricao:
            if not filho.tag.startswith(CRS):
                continue
            nome = filho.tag[len(CRS):]
            if nome == "Look":
                continue
            itens = [li.text or "" for li in filho.iter(f"{RDF}li")]
            if itens:
                campos[nome] = itens
            elif filho.text and filho.text.strip():
                campos[nome] = filho.text.strip()
    return campos


def ler_crs(caminho: str) -> dict:
    """Lê os campos crs: de um .xmp (preset ou sidecar) ou de um JPEG com XMP embutido."""
    with open(caminho, "rb") as f:
        dados = f.read() if caminho.lower().endswith(".xmp") else f.read(4 * 1024 * 1024)
    pacotes = pacotes_xmp_jpeg(dados)
    if not pacotes:
        xmp = extrair_xmp(dados)
        pacotes = [xmp] if xmp else []
    campos: dict = {}
    for pacote in pacotes:
        campos.update(_crs_do_pacote(pacote))
    return campos


def ja_aplicada(crs: dict) -> bool:
    """JPEG exportado já com a edição aplicada nos pixels (não é o original)."""
    return str(crs.get("AlreadyApplied", "")).lower() == "true"


def _curva(itens) -> list[list[int]] | None:
    if not isinstance(itens, list):
        return None
    pontos = []
    for item in itens:
        partes = [p for p in item.replace(";", ",").split(",") if p.strip()]
        if len(partes) == 2:
            x, y = _numero(partes[0]), _numero(partes[1])
            if x is not None and y is not None:
                pontos.append([int(round(x)), int(round(y))])
    pontos.sort()
    if len(pontos) < 2 or pontos == [[0, 0], [255, 255]]:
        return None
    return pontos


def converter(crs: dict) -> tuple[dict, list[str]]:
    """Converte campos crs: em ajustes do Durães APP. Retorna (ajustes, ignorados)."""
    ajustes: dict = {}
    for campo, (destino, fator) in MAPA.items():
        if campo in crs:
            valor = _numero(crs[campo])
            if valor is not None:
                ajustes[destino] = round(valor * fator, 2)
    if "nitidez" in ajustes:
        ajustes["nitidez"] = min(100, ajustes["nitidez"])
    for campo, destino in CURVAS.items():
        curva = _curva(crs.get(campo))
        if curva:
            ajustes[destino] = curva
    if str(crs.get("AutoTone", "")).lower() == "true":
        ajustes["auto_exposicao"] = 0.8

    ignorados = []
    for campo, nome in NAO_SUPORTADOS.items():
        if (_numero(crs.get(campo, "0")) or 0) != 0:
            ignorados.append(nome)
    for prefixo, nome in PREFIXOS_NAO_SUPORTADOS.items():
        if any(k.startswith(prefixo) and (_numero(v) or 0) != 0
               for k, v in crs.items() if isinstance(v, str)):
            ignorados.append(nome)
    if any(k.startswith("MaskGroupBasedCorrections") or k in ("GradientBasedCorrections",
                                                            "PaintBasedCorrections")
           for k in crs):
        ignorados.append("Máscaras / ajustes locais")
    if "Temperature" in crs and "IncrementalTemperature" not in crs:
        ignorados.append("Temperatura em Kelvin (use o ajuste de temperatura)")
    return ajustes, sorted(set(ignorados))


def _curva_mediana(curvas: list[list[list[int]]]) -> list[list[int]]:
    from .processamento import avaliar_curva

    xs = np.linspace(0, 255, 9)
    amostras = np.array([avaliar_curva(c, xs / 255.0) * 255.0 for c in curvas])
    ys = np.median(amostras, axis=0)
    return [[int(round(x)), int(round(y))] for x, y in zip(xs, ys)]


def aprender(caminho: str, limite: int = 400) -> dict:
    """Importa de um arquivo, ou tira a mediana das edições de todas as fotos de uma pasta."""
    if os.path.isfile(caminho):
        arquivos = [caminho]
    else:
        arquivos = []
        for raiz, _, nomes in os.walk(caminho):
            for nome in sorted(nomes):
                ext = os.path.splitext(nome)[1].lower()
                if ext in EXTENSOES or ext == ".xmp":
                    arquivos.append(os.path.join(raiz, nome))
        arquivos = arquivos[:limite * 3]

    edicoes, ignorados = [], set()
    for arquivo in arquivos:
        crs = ler_crs(arquivo)
        if not crs:
            continue
        ajustes, ign = converter(crs)
        if ajustes:
            edicoes.append(ajustes)
            ignorados.update(ign)
        if len(edicoes) >= limite:
            break
    if not edicoes:
        raise ValueError(
            "Não encontrei edições do Lightroom nessa pasta. No Lightroom (nuvem): selecione as "
            "fotos editadas > Exportar > tipo \"Original + configurações\" e escolha a pasta "
            "exportada aqui. No Lightroom Classic: Metadados > Salvar metadados no arquivo (Ctrl+S)."
        )

    final: dict = {}
    chaves = {k for e in edicoes for k in e}
    for chave in chaves:
        valores = [e[chave] for e in edicoes if chave in e]
        if chave.startswith("curva") and isinstance(valores[0], list):
            final[chave] = valores[0] if len(valores) == 1 else _curva_mediana(valores)
        elif chave == "auto_exposicao":
            if len(valores) * 2 > len(edicoes):
                final[chave] = valores[0]
        else:
            # campo ausente numa foto = 0 naquela foto
            todos = [e.get(chave, 0) for e in edicoes]
            final[chave] = round(statistics.median(todos), 2)
    return {"ajustes": final, "fotos": len(edicoes), "ignorados": sorted(ignorados)}


def pastas_presets_lightroom() -> list[str]:
    """Onde o Lightroom (nuvem e Classic) guarda os presets neste computador."""
    pastas = []
    if os.environ.get("APPDATA"):  # Windows
        pastas.append(os.path.join(os.environ["APPDATA"], "Adobe", "CameraRaw", "Settings"))
    pastas.append(os.path.expanduser("~/Library/Application Support/Adobe/CameraRaw/Settings"))
    return [p for p in pastas if os.path.isdir(p)]


def presets_instalados(pastas: list[str] | None = None) -> list[dict]:
    """Lista os presets .xmp do Lightroom que têm ajustes que o Durães APP entende."""
    encontrados = []
    for pasta in pastas if pastas is not None else pastas_presets_lightroom():
        for raiz, _, nomes in os.walk(pasta):
            for nome in sorted(nomes):
                if not nome.lower().endswith(".xmp"):
                    continue
                caminho = os.path.join(raiz, nome)
                try:
                    crs = ler_crs(caminho)
                except OSError:
                    continue
                if not crs or not converter(crs)[0]:
                    continue
                titulo = crs.get("Name")
                titulo = titulo[0] if isinstance(titulo, list) and titulo else os.path.splitext(nome)[0]
                grupo = crs.get("Group")
                grupo = grupo[0] if isinstance(grupo, list) and grupo else os.path.basename(raiz)
                encontrados.append({"nome": titulo, "grupo": grupo, "caminho": caminho})
    encontrados.sort(key=lambda p: (p["grupo"].lower(), p["nome"].lower()))
    return encontrados
