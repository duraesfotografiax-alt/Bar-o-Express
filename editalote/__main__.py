"""Uso:
    python -m editalote                      -> abre a tela no navegador
    python -m editalote processar ENTRADA SAIDA [--preset arquivo.json] [--prefixo Nome]
"""

import argparse
import json
import sys
import threading
import time


def main(argv=None):
    parser = argparse.ArgumentParser(prog="editalote", description="Edição de fotos em lote")
    sub = parser.add_subparsers(dest="comando")
    tela = sub.add_parser("tela", help="abre a interface no navegador (padrão)")
    tela.add_argument("--porta", type=int, default=8765)
    tela.add_argument("--sem-navegador", action="store_true")
    proc = sub.add_parser("processar", help="processa uma pasta direto pelo terminal")
    proc.add_argument("entrada")
    proc.add_argument("saida")
    proc.add_argument("--preset", help="arquivo .json de preset")
    proc.add_argument("--prefixo", default="Evento")
    proc.add_argument("--qualidade", type=int, default=95)
    proc.add_argument("--manter-nomes", action="store_true")
    proc.add_argument("--web", action="store_true", help="gera também versão 2048 px")
    proc.add_argument("--processos", type=int)
    args = parser.parse_args(argv)

    if args.comando == "processar":
        from .lote import Trabalho

        ajustes = {}
        if args.preset:
            with open(args.preset, encoding="utf-8") as f:
                ajustes = json.load(f)
        opcoes = {"prefixo": args.prefixo, "qualidade": args.qualidade,
                  "renomear": not args.manter_nomes, "versao_web": args.web}
        trabalho = Trabalho(args.entrada, args.saida, ajustes, opcoes)
        t = threading.Thread(target=trabalho.executar, kwargs={"processos": args.processos})
        t.start()
        while t.is_alive():
            s = trabalho.status()
            print(f"\r{s['mensagem']} {s['feitas']}/{s['total']}   ", end="", flush=True)
            time.sleep(0.5)
        s = trabalho.status()
        print(f"\r{s['mensagem']} em {s['decorrido']} s. Desfocadas: {s['desfocadas']}. "
              f"Erros: {s['qtd_erros']}")
        for erro in s["erros"]:
            print("  -", erro)
        return 0 if s["estado"] == "concluido" else 1

    from .servidor import iniciar

    porta = getattr(args, "porta", 8765)
    iniciar(porta, not getattr(args, "sem_navegador", False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
