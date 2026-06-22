#!/usr/bin/env python3
# VALIDACAO: captura deduplicada de curtidores vs like_count da Meta API, num post <99
# (sem o cap do fake interferir). Rola com gesto CDP em background e UNE os usernames do
# DOM a cada passo (lista virtualizada -> tem que coletar durante a rolagem, nao so no fim).
# Sem JS injetado: select_all = CDP DOM.querySelectorAll, passivo. So leitura.
import os, re, json, sys, time, asyncio, hashlib, struct
import nodriver as uc

def garantir_somente_desktop():
    # Captura de likers é EXCLUSIVA do desktop residencial (anti-ban). VM (Linux) não captura.
    if os.environ.get("IG_CAPTURE_DISABLED") == "1" or os.name != "nt":
        m = "IG_CAPTURE_DISABLED=1" if os.environ.get("IG_CAPTURE_DISABLED") == "1" else f"SO '{os.name}' não é Windows"
        print(f"⛔ ABORTADO: captura é EXCLUSIVA do desktop residencial (anti-ban). Motivo: {m}", file=sys.stderr)
        sys.exit(9)

HERE = os.path.dirname(os.path.abspath(__file__))
CODE = sys.argv[1] if len(sys.argv) > 1 else "DWrerwnj6yP"
PROFILE = os.environ.get("IG_PROFILE_DIR", r"C:\jfn\ig-profile")
IDX = os.path.join(HERE, "posts-index.json")

api_like = None
try:
    for p in json.load(open(IDX, encoding="utf-8"))["posts"]:
        if p["code"] == CODE: api_like = p["like_count"]; break
except Exception: pass

# usernames que NAO sao curtidores (UI do modal)
SKIP = {"", "explore", "reels", "direct", "p", "accounts", "emails", "challenge"}

async def colher(tab):
    us = set()
    try:
        els = await tab.select_all('div[role="dialog"] a[href^="/"]') or []
        for e in els:
            href = (e.attrs.get("href") or "").strip("/")
            if "/" in href: continue                 # so /username/ (1 segmento)
            if href and href not in SKIP: us.add(href)
    except Exception: pass
    return us

async def main():
    print(f"== validar {CODE} | API like_count = {api_like} ==", flush=True)
    b = await uc.start(user_data_dir=PROFILE, headless=False)
    tab = await b.get("https://www.instagram.com/"); await asyncio.sleep(4)
    await tab.get(f"https://www.instagram.com/p/{CODE}/"); await asyncio.sleep(4)
    link = await tab.select('a[href*="liked_by"]', timeout=6)
    if not link:
        print("NAO achei o link de curtidores (liked_by). Logado? Post existe?", flush=True); b.stop(); return
    try: await link.click()
    except Exception: pass
    await asyncio.sleep(3)
    # viewport center p/ o gesto
    p1 = os.path.join(HERE, "_val_0.png"); await tab.save_screenshot(p1, format="png")
    try:
        with open(p1, "rb") as f: hdr = f.read(26)
        vw, vh = struct.unpack(">II", hdr[16:24])
    except Exception: vw, vh = 1280, 800
    cx, cy = vw/2.0, vh*0.55
    async def gesto(dist):
        try: await tab.send(uc.cdp.input_.synthesize_scroll_gesture(x=float(cx), y=float(cy), x_distance=0.0, y_distance=float(-dist), speed=800, gesture_source_type=uc.cdp.input_.GestureSourceType.MOUSE))
        except Exception:
            try: await tab.send(uc.cdp.input_.synthesize_scroll_gesture(x=float(cx), y=float(cy), x_distance=0.0, y_distance=float(-dist)))
            except Exception: pass
    todos = set(await colher(tab)); estavel = 0; n = 0
    while n < 200:
        n += 1
        antes = len(todos)
        await gesto(220); await asyncio.sleep(1.6)
        todos |= await colher(tab)
        novos = len(todos) - antes
        if n % 3 == 0 or novos: print(f"  passo {n}: +{novos} novos | total unico = {len(todos)}", flush=True)
        estavel = estavel + 1 if novos == 0 else 0
        if estavel >= 4: print(f"  fim no passo {n} (4 passos sem novos)", flush=True); break
    print(f"\n== RESULTADO {CODE} ==", flush=True)
    print(f"   curtidores unicos capturados: {len(todos)}", flush=True)
    print(f"   like_count da Meta API:       {api_like}", flush=True)
    if api_like is not None:
        diff = len(todos) - api_like
        if diff == 0: print("   VEREDITO: BATE EXATO — sem pular ninguem. [OK]", flush=True)
        elif abs(diff) <= 2: print(f"   VEREDITO: quase ({diff:+d}) — provavel curtida removida/conta desativada", flush=True)
        else: print(f"   VEREDITO: diverge ({diff:+d}) — investigar (cap? skip? bots removidos?)", flush=True)
    json.dump(sorted(todos), open(os.path.join(HERE, f"_val_{CODE}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    await asyncio.sleep(1); b.stop()

garantir_somente_desktop()
uc.loop().run_until_complete(main())
