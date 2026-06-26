#!/usr/bin/env python3
# RUN MÍNIMO na conta OFICIAL (@depjorgefelippeneto, ig-profile-2). Fluxo 100% humano:
# home → próprio perfil → rola o grid → CLICA no post (não URL direta) → abre curtidores →
# captura DOM-union (exato) → compara com a API. Owner vê tudo (sem cap). Abort-on-block.
# Exposição mínima: IG_OFICIAL_N posts (default 1). NÃO interrompe nada da conta teste.
import os, sys, json, time, random, asyncio, struct, datetime
import nodriver as uc

if os.name != "nt" or os.environ.get("IG_CAPTURE_DISABLED") == "1":
    print("⛔ captura/login é EXCLUSIVO do desktop.", file=sys.stderr); sys.exit(9)

HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.environ.get("IG_PROFILE_DIR", r"C:\jfn\ig-profile-2")
TARGET  = "depjorgefelippeneto"
N = int(os.environ.get("IG_OFICIAL_N", "1"))
OUT = os.environ.get("LIKERS_OUT_DIR") or os.path.join(HERE, "..", "likers-sync")
POR_POST = os.path.join(OUT, "posts-curtidores.json")
LOG = os.path.join(OUT, "oficial-min.log")
IDX = os.path.join(HERE, "posts-index.json")
PAUSE = [os.path.join(d, ".pause_captura") for d in (OUT, HERE)]
os.makedirs(OUT, exist_ok=True)

api = {}
try:
    for p in json.load(open(IDX, encoding="utf-8"))["posts"]: api[p["code"]] = p["like_count"]
except Exception: pass
def rand(a,b): return random.uniform(a,b)
def humano(): return rand(1, 12)
def pausado(): return any(os.path.exists(p) for p in PAUSE)
def log(m):
    linha = f"{datetime.datetime.now():%H:%M:%S} {m}"; print(linha, flush=True)
    try: open(LOG,"a",encoding="utf-8").write(linha+"\n")
    except Exception: pass
SKIP = {"", "explore", "reels", "direct", "p", "accounts", "emails", "challenge"}

async def colher(tab):
    us = set()
    try:
        els = await tab.select_all('div[role="dialog"] a[href^="/"]') or []
    except Exception:
        return us                      # nó stale (modal trocando) — não crasha, devolve o que tem
    for e in els:
        try: h = (e.attrs.get("href") or "").strip("/")
        except Exception: continue
        if "/" not in h and h and h not in SKIP: us.add(h)
    return us

async def main():
    if pausado(): log("⏸️ .pause_captura presente — abortando."); return
    log(f"== RUN OFICIAL MÍNIMO | perfil={PROFILE} | alvo=@{TARGET} | N={N} ==")
    b = await uc.start(user_data_dir=PROFILE, headless=False)
    try:
        tab = await b.get("https://www.instagram.com/"); await asyncio.sleep(rand(5, 8))  # deixa a home assentar
        async def safe_one(sel, timeout=5):
            for _ in range(3):
                try: return await tab.select(sel, timeout=timeout)
                except Exception: await asyncio.sleep(1.5)   # nó stale durante navegação — re-tenta, não crasha
            return None
        async def safe_all(sel):
            for _ in range(3):
                try: return await tab.select_all(sel) or []
                except Exception: await asyncio.sleep(1.5)
            return []
        # checagem de login wall (resiliente: erro transitório != login wall)
        if await safe_one('input[name="username"]', timeout=3):
            log("⛔ TELA DE LOGIN — sessão caiu. Abortando (não logar automaticamente)."); return
        log("home ok (sessão viva). Indo ao próprio perfil...")
        await tab.get(f"https://www.instagram.com/{TARGET}/"); await asyncio.sleep(rand(4, 7))
        vw, vh = 1280, 800
        try:
            p0 = os.path.join(OUT, "_of.png"); await tab.save_screenshot(p0, format="png")
            with open(p0,"rb") as f: hdr=f.read(26); vw,vh=struct.unpack(">II",hdr[16:24])
        except Exception: pass
        async def gesto(dist, y):
            try: await tab.send(uc.cdp.input_.synthesize_scroll_gesture(x=float(vw/2),y=float(y),x_distance=0.0,y_distance=float(-dist),speed=700,gesture_source_type=uc.cdp.input_.GestureSourceType.MOUSE))
            except Exception: pass
        # coleta posts do grid com RETRY (tiles carregam preguiçosamente) + rolagem humana
        import re as _re
        codes = []
        for tent in range(8):
            for sel in ('a[href^="/p/"]', 'a[href^="/reel/"]'):
                for e in (await safe_all(sel)):
                    m = _re.search(r'/(?:p|reel)/([^/]+)/', e.attrs.get("href") or "")
                    if m and m.group(1) not in codes: codes.append(m.group(1))
            log(f"grid tentativa {tent+1}: {len(codes)} posts visíveis")
            if len(codes) >= max(N, 3): break
            await gesto(450, vh*0.5); await asyncio.sleep(rand(2, 5))   # rola pra carregar mais
        if not codes:
            log("⛔ nenhum post no grid após várias tentativas — abortando (NÃO é bloqueio; sessão estava viva)."); return
        log(f"vou capturar os {N} primeiros: {codes[:N]}")

        por_post = json.load(open(POR_POST, encoding="utf-8")) if os.path.exists(POR_POST) else {}
        for code in codes[:N]:
            if pausado(): log("⏸️ pausa — parando."); break
            a = api.get(code, "?")
            log(f"--- post {code} (API like_count={a}) — CLICANDO no grid (fluxo humano) ---")
            # clica no tile do grid (não URL direta)
            tile = await safe_one(f'a[href^="/p/{code}/"]', 5)
            if tile:
                try: await tile.click()
                except Exception: await tab.get(f"https://www.instagram.com/p/{code}/")
            else:
                await tab.get(f"https://www.instagram.com/p/{code}/")
            await asyncio.sleep(humano())
            link = await safe_one('a[href*="liked_by"]', 6)
            if not link:
                log(f"   {code}: SEM link de curtidores (pode ser bloqueio ou layout). Pulando.");
                try: await tab.send(uc.cdp.input_.dispatch_key_event(type_="keyDown", key="Escape", windows_virtual_key_code=27)); await tab.send(uc.cdp.input_.dispatch_key_event(type_="keyUp", key="Escape", windows_virtual_key_code=27))
                except Exception: pass
                continue
            try: await link.click()
            except Exception: pass
            await asyncio.sleep(humano())
            # centro do modal p/ gesto
            p1 = os.path.join(OUT, "_of.png"); await tab.save_screenshot(p1, format="png")
            try:
                with open(p1,"rb") as f: hdr=f.read(26); mw,mh=struct.unpack(">II",hdr[16:24])
            except Exception: mw,mh=vw,vh
            cx, cy = mw/2.0, mh*0.55
            todos = set(await colher(tab)); estavel=0; passo=0
            while passo < 800:
                passo += 1; antes=len(todos)
                try: await tab.send(uc.cdp.input_.synthesize_scroll_gesture(x=float(cx),y=float(cy),x_distance=0.0,y_distance=-220.0,speed=800,gesture_source_type=uc.cdp.input_.GestureSourceType.MOUSE))
                except Exception: pass
                await asyncio.sleep(humano())
                todos |= await colher(tab)
                estavel = estavel+1 if len(todos)==antes else 0
                if passo % 10 == 0: log(f"   ...{len(todos)} curtidores até agora")
                if estavel >= 5: break
                if pausado(): break
            n = len(todos)
            # abort-on-block: modal abriu mas quase nada vs API alto = suspeito
            if isinstance(a, int) and a >= 30 and n < min(20, a*0.3):
                log(f"   ⚠️ {code}: só {n} de ~{a} — SUSPEITO DE BLOQUEIO. Criando .pause_captura e abortando.")
                open(os.path.join(OUT, ".pause_captura"), "w").write("auto: undercount suspeito no run oficial\n")
                break
            por_post[code] = sorted(todos)
            json.dump(por_post, open(POR_POST,"w",encoding="utf-8"), ensure_ascii=False, indent=2)
            falta = (a - n) if isinstance(a, int) else "?"
            verd = "EXATO" if falta == 0 else (f"-{falta} (fantasmas?)" if isinstance(falta,int) else "?")
            log(f"   ✅ {code}: {n} curtidores | API={a} | {verd} | gravado na produção")
            try: await tab.send(uc.cdp.input_.dispatch_key_event(type_="keyDown", key="Escape", windows_virtual_key_code=27)); await tab.send(uc.cdp.input_.dispatch_key_event(type_="keyUp", key="Escape", windows_virtual_key_code=27))
            except Exception: pass
            await asyncio.sleep(humano())
        log("== run oficial mínimo concluído ==")
    finally:
        try: b.stop()
        except Exception: pass
uc.loop().run_until_complete(main())
