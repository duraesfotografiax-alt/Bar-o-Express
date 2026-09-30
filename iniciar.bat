@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Prefere o lançador "py" (vem com o instalador do python.org) e evita o atalho da Microsoft Store
set PY=
py -3 --version >nul 2>nul && set PY=py -3
if not defined PY (
  python -c "import sys" >nul 2>nul && set PY=python
)
if not defined PY (
  echo.
  echo  Python nao encontrado.
  echo  Instale em https://www.python.org/downloads/ e marque "Add Python to PATH".
  echo  Ou use o DuraesApp.exe, que nao precisa de Python.
  echo.
  pause
  exit /b 1
)
if not exist .venv\Scripts\python.exe (
  echo Preparando o Duraes APP pela primeira vez, aguarde...
  %PY% -m venv .venv || goto erro
  .venv\Scripts\python -m pip install --upgrade pip >nul
  .venv\Scripts\python -m pip install -r requirements.txt || goto erro
)
.venv\Scripts\python -m editalote
pause
exit /b 0
:erro
echo.
echo  Algo deu errado na instalacao. Apague a pasta .venv e tente de novo.
pause
exit /b 1
