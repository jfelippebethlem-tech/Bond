#!/bin/bash
# VALIDAÇÃO (VM) — depura os prints da captura-teste e diz se deu certo. NÃO toca o IG.
cd "$(dirname "$0")/.." || exit 1
export LIKERS_SHOTS_DIR="${LIKERS_SHOTS_DIR:-$HOME/likers-sync/captura/shots}"
export LIKERS_OUT_DIR="${LIKERS_OUT_DIR:-$HOME/likers-sync/likers-sync}"
echo "▶ depurando prints em $LIKERS_SHOTS_DIR (Gemini visão; sem tocar o IG)..."
python3 parse/parse_likers.py
echo
echo "===== RESULTADO POR POST ====="
python3 - <<'PY'
import json, os
out = os.path.expanduser(os.environ.get("LIKERS_OUT_DIR"))
try: meta = json.load(open(os.path.join(out, "posts-meta.json")))
except Exception as e: print("  sem posts-meta.json:", e); raise SystemExit
if not meta: print("  (nenhum post depurado)"); raise SystemExit
ok = 0
for m in meta:
    n = m.get("curtidas", 0)
    if m.get("suspeita_bloqueio"): flag = "⚠️  SUSPEITA DE BLOQUEIO (modal abriu, 0 nomes)"
    elif n: flag = "✅ OK"; ok += 1
    else: flag = "—  0 (post sem curtidas? confira o print)"
    print(f"  {m['code']}: {n} curtidores  {flag}")
print()
print(f"  → {ok}/{len(meta)} post(s) com curtidores extraídos." + ("  PIPELINE VALIDADO ✅" if ok else "  revise os prints ❌"))
PY
