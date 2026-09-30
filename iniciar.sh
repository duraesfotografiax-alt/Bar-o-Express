#!/usr/bin/env bash
# Mac / Linux: dê dois cliques ou rode ./iniciar.sh no terminal
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Preparando o Durães APP pela primeira vez, aguarde..."
  python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt
fi
exec .venv/bin/python -m editalote
