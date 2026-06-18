#!/bin/bash
# TESTE — motor CDP cru. (Captura só no desktop; NUNCA na VM.)
export IG_ENGINE=cdp IG_TARGET_USER="${1:?uso: rodar-teste.sh <perfil_alvo>}" IG_CDP_URL="http://127.0.0.1:9222"
node captura/capture.mjs
