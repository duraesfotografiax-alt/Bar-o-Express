import os

import numpy as np
from PIL import Image

from editalote import estilo_pares as ep
from editalote.auto_tom import aplicar_auto, calcular
from editalote.estilo_ia import _carregar, ajustes_da_foto, treinar_e_salvar
from editalote.processamento import aplicar, completar_ajustes
from tests.test_estilo_referencia import cena_final


def editar(img):
    """A "edição do estúdio": mais contraste (curva em S), um pouco mais claro e mais quente."""
    v = np.asarray(img, dtype=float) / 255
    v = np.clip(v * 1.08, 0, 1)
    v = v + 0.35 * (v - 0.5) * (1 - np.abs(2 * v - 1))                    # S
    v = v * np.array([1.04, 1.0, 0.93])
    return Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8))


def lavar(img):
    """Original "esbranquiçada": pretos levantados e pouco contraste."""
    v = np.asarray(img, dtype=float) / 255
    return Image.fromarray(((0.18 + v * 0.7) * 255).astype(np.uint8))


def criar_pares(tmp_path, n=10, renomear=False):
    orig, fin = tmp_path / "originais", tmp_path / "finais"
    orig.mkdir(); fin.mkdir()
    for i in range(n):
        o = cena_final(i)
        o.save(orig / f"IMG_{i:04d}.jpg", quality=95)
        editar(o).save(fin / (f"Casamento-{i}.jpg" if renomear else f"IMG_{i:04d}.jpg"), quality=95)
    return str(orig), str(fin)


def test_pareia_pelo_nome(tmp_path):
    orig, fin = criar_pares(tmp_path, 6)
    pares, contagem = ep.parear(orig, fin)
    assert contagem["pares"] == 6 and contagem["sem_par"] == 0
    assert all(os.path.basename(o) == os.path.basename(f) for o, f in pares)


def test_curva_do_par_aprende_contraste():
    rng = np.random.default_rng(1)
    o = rng.random((50, 50, 3))
    f = np.clip(0.5 + (o - 0.5) * 1.4, 0, 1)
    curvas = ep.curvas_do_par(o, f)
    meio = len(ep.PONTOS) // 2
    assert abs(curvas[0, meio] - 0.5) < 0.05
    assert curvas[0, 8] < ep.PONTOS[8] and curvas[0, 24] > ep.PONTOS[24]   # sombras descem, luzes sobem


def test_treina_e_repete_a_edicao(tmp_path):
    orig, fin = criar_pares(tmp_path, 10)
    presets = tmp_path / "presets"
    presets.mkdir()
    r = treinar_e_salvar(orig, "Durães", str(presets), "duraes", modo="pares", pasta_finais=fin)
    _carregar.cache_clear()
    preset = completar_ajustes({"estilo_ia": str(presets / "estilos" / "duraes.json"), "ia_forca": 100})
    nova = cena_final(99)
    caminho = tmp_path / "nova.jpg"
    nova.save(caminho, quality=95)
    ajustes, dif = ajustes_da_foto(preset, str(caminho))
    assert ajustes.get("curva_par_r")
    saida = np.asarray(aplicar(nova, ajustes, None), dtype=float)
    alvo = np.asarray(editar(nova), dtype=float)
    antes = np.abs(np.asarray(nova, dtype=float) - alvo).mean()
    depois = np.abs(saida - alvo).mean()
    assert depois < antes * 0.5, (antes, depois)


def test_auto_tira_o_aspecto_lavado(tmp_path):
    lavada = lavar(cena_final(3))
    caminho = tmp_path / "lavada.jpg"
    lavada.save(caminho, quality=95)
    ajustes, dif = aplicar_auto(completar_ajustes({"auto_tom": 100}), str(caminho))
    assert ajustes["curva_ref"] and ajustes["auto_exposicao"] == 0
    antes = np.asarray(lavada, dtype=float) / 255
    depois = np.asarray(aplicar(lavada, ajustes, None), dtype=float) / 255
    assert np.percentile(depois, 1) < np.percentile(antes, 1) - 0.08      # pretos de verdade
    assert depois.std() > antes.std() * 1.2                                # mais contraste


def test_auto_desligado_ou_com_ia_nao_mexe(tmp_path):
    caminho = tmp_path / "f.jpg"
    cena_final(1).save(caminho)
    base = completar_ajustes({})
    assert aplicar_auto(base, str(caminho)) == (base, {})
    com_ia = {**base, "auto_tom": 100, "estilo_ia": "estilos/x.json"}
    assert aplicar_auto(com_ia, str(caminho))[1] == {}
    assert "curva_ref" in calcular(np.asarray(cena_final(1), dtype=float) / 255)


def test_auto_segue_o_alvo_das_fotos_prontas(tmp_path):
    from editalote.auto_tom import medir_estilo

    escura = Image.fromarray((np.asarray(cena_final(5), dtype=float) * 0.45).astype(np.uint8))
    caminho = tmp_path / "escura.jpg"
    escura.save(caminho, quality=95)
    clara = medir_estilo([np.asarray(cena_final(i), dtype=float) / 255 for i in range(3)])
    clara["meio"] = 0.6
    ajustes, _ = aplicar_auto(completar_ajustes({"auto_tom": 100, "auto_alvo": clara}), str(caminho))
    saida = np.asarray(aplicar(escura, ajustes, None), dtype=float) / 255
    assert np.median(saida @ [0.2126, 0.7152, 0.0722]) > 0.45


def test_realce_pessoas_clareia_quem_esta_na_foto():
    from editalote.assunto import luz_das_pessoas, pele

    rgb = np.full((200, 150, 3), 0.12)
    rgb[50:110, 50:100] = [0.42, 0.30, 0.24]           # um "rosto" na sombra, no centro
    assert pele(rgb)[80, 75] > 0.5 and pele(rgb)[5, 5] == 0
    img = Image.fromarray((rgb * 255).astype(np.uint8))
    base = completar_ajustes({"auto_exposicao": 0, "auto_balanco_branco": 0})
    sem = np.asarray(aplicar(img, base, None), dtype=float) / 255
    com = np.asarray(aplicar(img, {**base, "realce_pessoas": 80}, None), dtype=float) / 255
    assert luz_das_pessoas(com) > luz_das_pessoas(sem) + 0.03
    assert com[5, 5].mean() >= sem[5, 5].mean()         # cenário: no máximo um pouco mais claro


def test_ajuste_so_desta_foto_vale_so_para_ela(tmp_path):
    from editalote.processamento import ajustes_individuais, chave_foto

    a, b = str(tmp_path / "a.jpg"), str(tmp_path / "b.jpg")
    ajustes = completar_ajustes({"exposicao": 0.2, "por_foto": {chave_foto(a): {"exposicao": 0.5, "contraste": 10}}})
    so_a = ajustes_individuais(ajustes, a)
    assert so_a["exposicao"] == 0.7 and so_a["contraste"] == 10 and "por_foto" not in so_a
    assert ajustes_individuais(ajustes, b)["exposicao"] == 0.2


def test_lote_aplica_o_ajuste_individual(tmp_path):
    from editalote.lote import Trabalho
    from editalote.processamento import chave_foto

    entrada, saida = tmp_path / "fotos", tmp_path / "saida"
    entrada.mkdir()
    cinza = Image.fromarray(np.full((120, 160, 3), 110, np.uint8))
    for nome in ("a.jpg", "b.jpg"):
        cinza.save(entrada / nome, quality=95)
    ajustes = {"auto_exposicao": 0, "auto_balanco_branco": 0,
               "por_foto": {chave_foto(str(entrada / "a.jpg")): {"exposicao": 1.0}}}
    t = Trabalho(str(entrada), str(saida), ajustes, {"renomear": False})
    t.executar(processos=1)
    assert t.estado == "concluido", t.mensagem
    media = lambda n: np.asarray(Image.open(saida / n), dtype=float).mean()
    assert media("a.jpg") > media("b.jpg") + 25


def test_melhorar_qualidade_tira_ruido():
    from editalote.qualidade import melhorar, medir_ruido

    rng = np.random.default_rng(3)
    limpa = np.asarray(cena_final(2).resize((800, 1200)), dtype=float) * 0.5
    ruidosa = Image.fromarray(np.clip(limpa + rng.normal(0, 9, limpa.shape), 0, 255).astype(np.uint8))
    assert medir_ruido(ruidosa) > 3
    melhor = np.asarray(melhorar(ruidosa, 0.8), dtype=float)
    assert np.abs(melhor - limpa).mean() < np.abs(np.asarray(ruidosa, dtype=float) - limpa).mean() * 0.75


def test_aprende_um_preset_por_tipo_de_evento(tmp_path, monkeypatch):
    import json

    from editalote import servidor
    from editalote.estilo_ia import amostra_de_eventos

    raiz = tmp_path / "Entregas"
    for tipo, fator, eventos in (("Casamento", 0.8, 3), ("Aniversário", 1.15, 2), ("Ensaio", 1.0, 1)):
        for e in range(eventos):
            pasta = raiz / tipo / f"Evento {e}"
            (pasta / "web").mkdir(parents=True)
            for i in range(6):
                img = np.clip(np.asarray(cena_final(e * 10 + i), dtype=float) * fator, 0, 255)
                Image.fromarray(img.astype(np.uint8)).save(pasta / f"F_{i}.jpg", quality=90)
            cena_final(0).save(pasta / "web" / "ignorar.jpg")
    (raiz / "Vazia").mkdir()
    amostra = amostra_de_eventos(str(raiz / "Casamento"), 9)
    assert len(amostra) == 9 and len({os.path.dirname(a) for a in amostra}) == 3   # 3 de cada evento
    assert not any(os.sep + "web" + os.sep in a for a in amostra_de_eventos(str(raiz), 500))

    monkeypatch.setattr(servidor, "PASTA_PRESETS", str(tmp_path / "presets"))
    treino = servidor.Treino(str(raiz), "Durães", "tipos")
    treino.executar()
    assert treino.estado == "concluido", treino.erro
    nomes = {c["nome"] for c in treino.resultado["criados"]}
    assert nomes == {"Durães · Casamento", "Durães · Aniversário", "Durães · Ensaio"}
    alvos = {}
    for c in treino.resultado["criados"]:
        preset = json.loads((tmp_path / "presets" / c["arquivo"]).read_text(encoding="utf-8"))
        assert preset["auto_tom"] == 100
        alvos[c["nome"]] = preset["auto_alvo"]["meio"]
    assert alvos["Durães · Aniversário"] > alvos["Durães · Casamento"]   # aprendeu que é mais claro


def test_ia_mira_no_jeito_das_cenas_parecidas(tmp_path):
    """Fotos prontas de festa (escuras, com luzes) e de externa (claras): a IA não pode usar uma
    média só. Foto nova de festa mira no jeito das festas; de externa, no das externas."""
    from editalote.auto_tom import ALVO_DURAES, alvo_da_cena, medir_cenas, medir_estilo

    rng = np.random.default_rng(5)

    def festa(semente, brilho):
        r = np.random.default_rng(semente)
        v = np.full((300, 200, 3), 0.45 * brilho / 0.45) + r.normal(0, 0.01, (300, 200, 3))
        v[120:260, 60:140] = np.array([0.55, 0.38, 0.30]) * brilho / 0.45   # pessoas no centro
        for _ in range(8):                                                   # luzes no alto
            y, x = r.integers(5, 60), r.integers(5, 190)
            v[y:y + 6, x:x + 6] = 1.0
        return np.clip(v * np.array([1.0, 0.9, 0.75]), 0, 1)

    def externa(semente, brilho):
        r = np.random.default_rng(semente)
        v = np.zeros((200, 300, 3))
        v[:80] = [0.45, 0.65, 0.95]                                          # céu
        v[80:] = [0.35, 0.6, 0.25]                                           # grama
        v[60:180, 120:180] = [0.75, 0.6, 0.5]
        v = v * brilho / 0.6 * 1.25 + r.normal(0, 0.02, v.shape)
        return np.clip(v, 0, 1)

    prontas = [festa(i, 0.45) for i in range(10)] + [externa(i, 0.7) for i in range(10)]
    geral = {**ALVO_DURAES, **medir_estilo(prontas)}
    cenas = medir_cenas(prontas)
    alvo_festa = alvo_da_cena(festa(99, 0.2), geral, cenas)      # original de festa, mais escura
    alvo_externa = alvo_da_cena(externa(99, 0.5), geral, cenas)
    assert alvo_festa["meio"] < geral["meio"] - 0.02 < alvo_externa["meio"] - 0.04
