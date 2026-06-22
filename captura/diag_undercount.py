#!/usr/bin/env python3
# DIAGNOSTICO do -1 a -5: re-captura posts antigos com fim MUITO paciente, logando a
# contagem nos marcos estavel=4 (onde o runner para), 6, 8, 12. Se cresce depois do 4 →
# parada-cedo (corrigir end-detection). Se trava no mesmo nº < API → fantasmas (desativados).
import os, sys, json, asyncio, struct
import nodriver as uc

if os.name != "nt": print("desktop-only"); sys.exit(9)
HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.environ.get("IG_PROFILE_DIR", r"C:\jfn\ig-profile")
CODES = sys.argv[1:] or ["2Kmq7ksd-N", "1x8b0dMd4a"]
IDX = os.path.join(HERE, "posts-index.json")
api = {}
try:
    for p in json.load(open(IDX, encoding="utf-8"))["posts"]: api[p["code"]] = p["like_count"]
except Exception: pass
SKIP = {"", "explore", "reels", "direct", "p", "accounts", "emails", "challenge"}

async def colher(tab):
    us = set()
    try:
        for e in (await tab.select_all('div[role="dialog"] a[href^="/"]') or []):
            h = (e.attrs.get("href") or "").strip("/")
            if "/" not in h and h and h not in SKIP: us.add(h)
    except Exception: pass
    return us

async def cap(tab, code):
    await tab.get(f"https://www.instagram.com/p/{code}/"); await asyncio.sleep(4)
    link = await tab.select('a[href*="liked_by"]', timeout=8)
    if not link: print(f"  {code}: sem link liked_by"); return
    try: await link.click()
    except Exception: pass
    await asyncio.sleep(3)
    p1 = os.path.join(HERE, "_du.png"); await tab.save_screenshot(p1, format="png")
    try:
        with open(p1,"rb") as f: hdr=f.read(26); vw,vh=struct.unpack(">II",hdr[16:24])
    except Exception: vw,vh=1280,800
    cx, cy = vw/2.0, vh*0.55
    async def gesto(d):
        try: await tab.send(uc.cdp.input_.synthesize_scroll_gesture(x=float(cx),y=float(cy),x_distance=0.0,y_distance=float(-d),speed=800,gesture_source_type=uc.cdp.input_.GestureSourceType.MOUSE))
        except Exception: pass
    todos = set(await colher(tab)); estavel = 0; marcos = {}
    for passo in range(600):
        antes = len(todos)
        await gesto(220); await asyncio.sleep(2.5)   # mais paciente que o runner
        todos |= await colher(tab)
        estavel = estavel + 1 if len(todos) == antes else 0
        for m in (4, 6, 8, 12):
            if estavel == m and m not in marcos: marcos[m] = len(todos)
        if estavel >= 14: break
    a = api.get(code, "?")
    linha = " | ".join(f"estavel{m}={marcos.get(m,'-')}" for m in (4,6,8,12))
    cresceu = (marcos.get(12, len(todos)) - marcos.get(4, 0)) if 4 in marcos else 0
    print(f"  {code}: API={a} | final={len(todos)} | {linha} | cresceu apos estavel4: +{cresceu}")

async def main():
    b = await uc.start(user_data_dir=PROFILE, headless=False)
    tab = await b.get("https://www.instagram.com/"); await asyncio.sleep(4)
    for c in CODES:
        try: await cap(tab, c)
        except Exception as e: print(f"  {c}: erro {str(e)[:60]}")
    await asyncio.sleep(1); b.stop()
uc.loop().run_until_complete(main())
