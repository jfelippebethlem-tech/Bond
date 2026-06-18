#!/bin/bash
# Depura os screenshots na VM (NÃO toca o IG) e gera likers.json p/ o importador.
# Lê chaves do polimonitor/.env (GEMINI_API_KEY/OPENROUTER_API_KEY) automaticamente.
cd "$(dirname "$0")/.." || exit 1
export LIKERS_SHOTS_DIR="${LIKERS_SHOTS_DIR:-$HOME/likers-sync/captura/shots}"
export LIKERS_OUT_DIR="${LIKERS_OUT_DIR:-$HOME/likers-sync/likers-sync}"
python3 parse/parse_likers.py
