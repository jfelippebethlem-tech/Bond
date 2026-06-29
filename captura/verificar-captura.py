#!/usr/bin/env python3
# AUTO-CHECK da captura de curtidores (Hermes cron, --no-agent --script).
# Ideia (regra do dono): guardar o nº de curtidores/posts e, a cada dia DEPOIS da janela de
# captura (05-10h), comparar com o snapshot anterior. Se NADA mudou, a captura NÃO funcionou
# (tela não acordou / janela oculta / conta throttled / poller caiu) -> ALERTA.
# NÃO abre browser, só LÊ o contrato. Roda em qualquer SO. Exit 2 no alerta (Hermes marca falho).
import os, json, datetime

OUT     = os.environ.get("LIKERS_OUT_DIR") or r"C:\jfn\bond\likers-sync"
LIKERS  = os.path.join(OUT, "likers.json")
PORPOST = os.path.join(OUT, "posts-curtidores.json")
LEDGER  = os.path.join(OUT, "captura-ledger.jsonl")
INDEX   = r"C:\jfn\bond\captura\posts-index.json"          # total de posts (p/ saber se há backlog)
ESTADO  = os.path.join(OUT, ".verif-estado.json")          # snapshot anterior (interno)
STATUS  = os.path.join(OUT, "captura-verificacao.json")    # veredito (sincroniza p/ VM/site)
ESPERADO_DIA = int(os.environ.get("IG_ESPERADO_DIA", "80"))  # meta de posts/dia (p/ flag de parcial)

def _carrega(p, d):
    try: return json.load(open(p, encoding="utf-8"))
    except Exception: return d

def metricas():
    likers  = _carrega(LIKERS, [])
    porpost = _carrega(PORPOST, {})
    n_likers = len(likers) if isinstance(likers, list) else 0
    soma = sum(int(x.get("curtidas", 0)) for x in likers if isinstance(x, dict)) if isinstance(likers, list) else 0
    n_posts = len(porpost) if isinstance(porpost, dict) else 0
    return {"n_likers": n_likers, "soma_curtidas": soma, "n_posts": n_posts}

def total_index():
    idx = _carrega(INDEX, {})
    if isinstance(idx, dict):
        return int(idx.get("total") or len(idx.get("posts", [])))
    return len(idx) if isinstance(idx, list) else 0

def ledger_recente(horas=14):
    """conta ok/freeze/degradado nas últimas N horas (diagnóstico do PORQUÊ falhou)."""
    corte = datetime.datetime.now() - datetime.timedelta(hours=horas)
    ok = fz = dg = 0
    try:
        for ln in open(LEDGER, encoding="utf-8"):
            ln = ln.strip()
            if not ln: continue
            try: e = json.loads(ln)
            except Exception: continue
            try: q = datetime.datetime.fromisoformat(e.get("quando", ""))
            except Exception: continue
            if q < corte: continue
            if e.get("ok"): ok += 1
            elif e.get("status") == "freeze_local": fz += 1
            else: dg += 1
    except Exception: pass
    return {"ok": ok, "freeze_local": fz, "degradado": dg}

def main():
    agora = datetime.datetime.now()
    atual = metricas()
    prev  = _carrega(ESTADO, None)
    led   = ledger_recente(14)
    total = total_index()
    backlog = max(0, total - atual["n_posts"])

    if not prev:
        v = {"ok": True, "estado": "baseline",
             "msg": f"baseline criado: {atual['n_likers']} curtidores, {atual['n_posts']} posts "
                    f"(backlog {backlog}). Sem snapshot anterior p/ comparar ainda.",
             "atual": atual, "ledger_14h": led, "quando": agora.isoformat()}
    else:
        d_posts  = atual["n_posts"]  - prev.get("n_posts", 0)
        d_likers = atual["n_likers"] - prev.get("n_likers", 0)
        mudou = (atual["n_posts"] != prev.get("n_posts")
                 or atual["n_likers"] != prev.get("n_likers")
                 or atual["soma_curtidas"] != prev.get("soma_curtidas"))
        if not mudou:
            v = {"ok": False, "estado": "NAO_FUNCIONOU",
                 "msg": f"⚠️ ALERTA: NADA novo desde {prev.get('quando')} — a captura NÃO funcionou. "
                        f"Ledger 14h: {led['ok']} ok / {led['freeze_local']} freeze / {led['degradado']} degradado. "
                        f"Provável: tela não acordou, janela oculta, conta throttled, ou poller caiu.",
                 "delta": {"posts": d_posts, "likers": d_likers},
                 "atual": atual, "anterior": prev, "ledger_14h": led, "quando": agora.isoformat()}
        else:
            parcial = (backlog > 100 and d_posts < ESPERADO_DIA * 0.4)   # backlog sobrando mas capturou pouco
            estado  = "parcial" if parcial else "funcionando"
            extra   = (f" ⚠️ PARCIAL: só +{d_posts} posts (meta ~{ESPERADO_DIA}/dia, backlog {backlog})."
                       if parcial else "")
            v = {"ok": True, "estado": estado,
                 "msg": f"captura OK: +{d_posts} posts, +{d_likers} curtidores desde {prev.get('quando')} "
                        f"(total {atual['n_posts']} posts / {atual['n_likers']} curtidores, backlog {backlog}).{extra}",
                 "delta": {"posts": d_posts, "likers": d_likers},
                 "atual": atual, "anterior": prev, "ledger_14h": led, "quando": agora.isoformat()}

    try: json.dump(v, open(STATUS, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    except Exception as e: print(f"[verificar-captura] erro gravando status: {e}")
    snap = dict(atual); snap["quando"] = agora.isoformat()
    try: json.dump(snap, open(ESTADO, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    except Exception as e: print(f"[verificar-captura] erro gravando estado: {e}")

    print("[verificar-captura] " + v["msg"])
    raise SystemExit(0 if v["ok"] else 2)

if __name__ == "__main__":
    main()
