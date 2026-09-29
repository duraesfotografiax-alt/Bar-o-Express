@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Python nao encontrado. Instale em https://www.python.org/downloads/
  echo  IMPORTANTE: marque a opcao "Add Python to PATH" na instalacao.
  echo.
  pause
  exit /b 1
)
if not exist .venv (
  echo Preparando o EditaLote pela primeira vez, aguarde...
  python -m venv .venv
  .venv\Scripts\python -m pip install --upgrade pip >nul
  .venv\Scripts\python -m pip install -r requirements.txt
)
.venv\Scripts\python -m editalote
pause
