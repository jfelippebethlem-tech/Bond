#!/usr/bin/env python3
# SEMI-MANUAL (conta oficial): eu abro o post; VOCÊ clica nas curtidas; o script detecta o
# modal aberto e captura os curtidores do IG (rolagem MODERADA, sem pular). Fim pelo próprio
# modal (parou de carregar = screenshot estável) — NÃO pelo like_count (que inclui Facebook).
import os, sys, asyncio, struct, hashlib, random, json
import nodriver as uc
if os.name != "nt": sys.exit(9)
PROFILE = os.environ.get("IG_PROFILE_DIR", r"C:\jfn\ig-profile-2")
TARGET = "depjorgefelippeneto"
CODE = sys.argv[1] if len(sys.argv) > 1 else "DZ2m4eEOpE1"
HERE = os.path.dirname(os.path.abspath(__file__))
api = {}
try:
    for p in json.load(open(os.path.join(HERE,"posts-index.json"),encoding="utf-8"))["posts"]: api[p["code"]]=p["like_count"]
except Exception: pass
SKIP = {"", "explore", "reels", "direct", "p", "accounts", "emails", "challenge", TARGET}
async def colher(tab):
    us = set()
    try:
        for e in (await tab.select_all('div[role="dialog"] a[href^="/"]') or []):
            h=(e.attrs.get("href") or "").strip("/")
            if "/" not in h and h and h not in SKIP: us.add(h)
    except Exception: pass
    return us
async def main():
    b = await uc.start(user_data_dir=PROFILE, headless=False)
    tab = await b.get("https://www.instagram.com/"); await asyncio.sleep(4)
    await tab.get(f"https://www.instagram.com/p/{CODE}/"); await asyncio.sleep(5)
    a = api.get(CODE, "?")
    print(f"\n>>> POST {CODE} aberto (API like_count={a}, inclui Facebook).")
    print(">>> AGORA CLIQUE NAS CURTIDAS na janela do Chrome. Esperando o modal abrir (ate 180s)...\n", flush=True)
    # espera o modal com lista de usernames aparecer (voce clica)
    achou = False
    for _ in range(90):
        us = await colher(tab)
        if len(us) >= 5:   # modal de curtidores abriu
            achou = True; break
        await asyncio.sleep(2)
    if not achou:
        print("Nao detectei o modal de curtidores. Abortando."); b.stop(); return
    print(">>> modal detectado! capturando (moderado)...", flush=True)
    p1=os.path.join(HERE,"_sm.png"); await tab.save_screenshot(p1,format="png")
    try:
        with open(p1,"rb") as f: hdr=f.read(26); mw,mh=struct.unpack(">II",hdr[16:24])
    except Exception: mw,mh=1280,800
    cx,cy = mw/2.0, mh*0.55
    todos=set(await colher(tab)); passo=0; last=None; estshot=0
    print(f"inicio: {len(todos)} curtidores no modal")
    while passo < 300:
        passo+=1
        try: await tab.send(uc.cdp.input_.synthesize_scroll_gesture(x=float(cx),y=float(cy),x_distance=0.0,y_distance=-330.0,speed=700,gesture_source_type=uc.cdp.input_.GestureSourceType.MOUSE))
        except Exception: pass
        await asyncio.sleep(random.uniform(1.5,3))
        todos |= await colher(tab)
        p2=os.path.join(HERE,"_sm.png"); await tab.save_screenshot(p2,format="png")
        h=hashlib.md5(open(p2,"rb").read()).hexdigest()[:8]
        estshot = estshot+1 if h==last else 0
        last=h
        if passo%4==0 or estshot: print(f"  passo {passo}: {len(todos)} unicos (shot_estavel={estshot})", flush=True)
        if estshot >= 6: print("  >> fim do modal (screenshot estavel 6x)"); break
    n=len(todos)
    fb = (a-n) if isinstance(a,int) else "?"
    print(f"\n=== RESULTADO {CODE} ===")
    print(f"  curtidores IG capturados: {n}")
    print(f"  like_count API (IG+Facebook): {a}")
    print(f"  diferenca (provavel Facebook): {fb}")
    json.dump(sorted(todos), open(os.path.join(HERE, f"_sm_{CODE}.json"),"w",encoding="utf-8"), ensure_ascii=False, indent=1)
    await asyncio.sleep(2); b.stop()
uc.loop().run_until_complete(main())
