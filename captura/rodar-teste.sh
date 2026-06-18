#!/bin/bash
# TESTE — motor nodriver. (Captura só no desktop; NUNCA na VM.)
export IG_ENGINE=nodriver IG_TARGET_USER="${1:?uso: rodar-teste.sh <perfil_alvo>}"
python3 captura/capture_nodriver.py
