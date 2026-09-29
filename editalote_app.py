"""Ponto de entrada do EditaLote.exe (PyInstaller)."""

import multiprocessing
import sys

if __name__ == "__main__":
    multiprocessing.freeze_support()  # necessário para o processamento paralelo no .exe
    from editalote.__main__ import main

    sys.exit(main())
