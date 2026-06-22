#!/usr/bin/env python3
# POLLER da captura (DESKTOP, destacado). Vigia o comando que o Hermes escreve e executa
# o ciclo de captura quando comandado. Desacopla o Hermes (que COMANDA, sem abrir browser —
# o cron do Hermes bloqueia subprocess) do browser real (que o POLLER abre). Desktop-only.
import os, sys, json, time, subprocess, datetime

if os.name != "nt":
    print("⛔ poller de captura é EXCLUSIVO do desktop (anti-ban).", file=sys.stderr); sys.exit(9)

BOND   = r"C:\jfn\bond"
PY     = r"C:\Users\socah\AppData\Local\Programs\Python\Python312\python.exe"  # tem nodriver
RUNNER = os.path.join(BOND, "captura", "capturar_producao.py")
OUT    = os.environ.get("LIKERS_OUT_DIR") or os.path.join(BOND, "likers-sync")
CMD    = os.path.join(OUT, "captura-comando.json")
STATUS = os.path.join(OUT, "captura-status.json")
LOG    = os.path.join(OUT, "poller.log")
INTERVALO = 15  # segundos entre checagens

os.makedirs(OUT, exist_ok=True)
def log(m):
    linha = f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {m}"
    print(linha, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f: f.write(linha + "\n")
    except Exception: pass

def ler():
    try: return json.load(open(CMD, encoding="utf-8"))
    except Exception: return None
def grava(path, obj):
    try: json.dump(obj, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    except Exception as e: log(f"erro gravando {path}: {e}")

log("poller de captura NO AR — vigiando comando do Hermes em " + CMD)
while True:
    c = ler()
    if c and c.get("acao") == "capturar" and not c.get("feito"):
        ts0 = c.get("ts")
        log(f"comando recebido (origem={c.get('origem')}, ts={ts0}) — iniciando ciclo")
        env = dict(os.environ)
        env["IG_TARGET_USER"] = env.get("IG_TARGET_USER", "depjorgefelippeneto")
        env["IG_PROFILE_DIR"] = env.get("IG_PROFILE_DIR", r"C:\jfn\ig-profile")
        env["IG_UM_CICLO"] = "1"
        env.setdefault("IG_TESTE", str(c.get("teste", "1")))
        env["PYTHONUTF8"] = "1"
        if c.get("codes"): env["IG_CODES"] = c["codes"]
        t0 = time.time()
        try:
            rc = subprocess.run([PY, RUNNER], cwd=BOND, env=env).returncode
        except Exception as e:
            rc = -1; log(f"erro ao rodar runner: {e}")
        # marca feito SÓ se ninguém reescreveu o comando durante o ciclo (evita clobber)
        atual = ler()
        if atual and atual.get("ts") == ts0:
            atual["feito"] = True; atual["rc"] = rc; atual["quando_feito"] = datetime.datetime.now().isoformat()
            grava(CMD, atual)
        grava(STATUS, {"ts": datetime.datetime.now().isoformat(), "comando_ts": ts0, "rc": rc, "dur_s": round(time.time() - t0)})
        log(f"ciclo concluído rc={rc} ({round(time.time()-t0)}s)")
    time.sleep(INTERVALO)
