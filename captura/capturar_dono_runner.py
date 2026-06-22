#!/usr/bin/env python3
# RUNNER DO DONO — captura os curtidores COMPLETOS (logado como @depjorgefelippeneto)
# pela página /p/<code>/liked_by/ e grava no CONTRATO de produção (likers-sync ->
# Syncthing -> VM -> politimonitor). Reusa as funções de contrato do capturar_producao.py.
# 100% humano: você loga 1x na janela; o script só navega e rola (gesto CDP), lendo a
# lista (DOM-union por scroll) + escuta GraphQL passiva. Sem fetch in-page, sem token.
#
# Uso (10 mais recentes):   python captura/capturar_dono_runner.py
#   IG_N=10        quantos posts recentes (default 10)
#   IG_CODES=a,b   posts específicos (sobrepõe IG_N)
#   IG_OWNER_ID    id do dono (default 1985223190)
import os, sys, re, asyncio, random, json, base64

if os.name != "nt":
    print("ABORTADO: captura é exclusiva do desktop (anti-ban).", file=sys.stderr); sys.exit(9)
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

# perfil do DONO antes de importar o módulo de produção (ele lê env no import)
os.environ.setdefault("IG_PROFILE_DIR", r"C:\jfn\ig-profile-dono")
PROFILE  = os.environ["IG_PROFILE_DIR"]
OWNER_ID = os.environ.get("IG_OWNER_ID", "1985223190")
TARGET   = "depjorgefelippeneto"
N        = int(os.environ.get("IG_N", "10"))
CODES    = [c.strip() for c in (os.environ.get("IG_CODES") or "").split(",") if c.strip()]

import nodriver as uc
import capturar_producao as P   # reusa OUT, POR_POST, carregar_index, salvar_por_post,
                                # reescrever_contrato, registrar_ledger, log, humano

SKIP = {"", "explore", "reels", "reel", "direct", "p", "accounts", "emails", "challenge",
        "stories", "about", "legal", "privacy", "tv", "api", TARGET}

# ---- escuta GraphQL passiva (rede de segurança p/ posts grandes) ----
api_users = {}; pend = {}; escutando = False
def coletar(j):
    pilha=[j]
    while pilha:
        n=pilha.pop()
        if isinstance(n,dict):
            un=n.get("username")
            if isinstance(un,str) and un and un not in SKIP: api_users[un]=True
            for v in n.values():
                if isinstance(v,(dict,list)): pilha.append(v)
        elif isinstance(n,list):
            pilha.extend(x for x in n if isinstance(x,(dict,list)))
def interessa(u): return bool(re.search(r"graphql/query|/likers\b|liked_by", u or "", re.I))
async def on_response(evt, conn=None):
    if not escutando: return
    try:
        if interessa(evt.response.url): pend[evt.request_id]=1
    except Exception: pass
async def on_finished(evt, conn=None):
    rid=getattr(evt,"request_id",None)
    if rid is None or rid not in pend or conn is None: return
    pend.pop(rid,None)
    try:
        body,b64=await conn.send(uc.cdp.network.get_response_body(rid))
        if b64: body=base64.b64decode(body).decode("utf-8","replace")
        coletar(json.loads(body))
    except Exception: pass

async def colher_pagina(tab):
    us=set()
    try:
        for e in (await tab.select_all('a[href^="/"]') or []):
            m=re.match(r'^/([A-Za-z0-9._]+)/$', e.attrs.get("href") or "")
            if m and m.group(1) not in SKIP: us.add(m.group(1))
    except Exception: pass
    return us

async def ds_user_id(tab):
    try:
        cks=await tab.send(uc.cdp.network.get_cookies(urls=["https://www.instagram.com/"]))
        for c in (cks or []):
            if getattr(c,"name","")=="ds_user_id": return getattr(c,"value","") or ""
    except Exception: pass
    return ""

async def esperar_dono(tab):
    uid=await ds_user_id(tab)
    if uid==OWNER_ID:
        P.log(f"[OK] já logado como o dono (id {uid})."); return True
    P.log(f"AGUARDANDO LOGIN: deixe @{TARGET} (id {OWNER_ID}) como conta ATIVA na janela.")
    ultimo=None
    for i in range(180):  # ~15 min
        uid=await ds_user_id(tab)
        if uid==OWNER_ID: break
        if uid and uid!=ultimo:
            P.log(f"  conta ativa={uid} NÃO é o dono — troque p/ @{TARGET}."); ultimo=uid
        elif not uid and i%4==0:
            P.log(f"  ...esperando login ({i*5}s)")
        await asyncio.sleep(5)
    if uid!=OWNER_ID:
        P.log("TIMEOUT: dono não ficou ativo."); return False
    P.log("[OK] dono ativo — aguardando 30s p/ você terminar diálogos (manter logado/notif).")
    await asyncio.sleep(30)
    return True

async def capturar_dono(tab, code):
    """Navega /liked_by/ e captura TODOS (DOM-union por scroll + GraphQL passivo)."""
    await tab.get(f"https://www.instagram.com/p/{code}/liked_by/")
    await asyncio.sleep(P.humano())
    vp=await tab.evaluate("[innerWidth, innerHeight]")
    try: iw,ih=int(vp[0]),int(vp[1])
    except Exception: iw,ih=1280,800
    cx,cy=iw/2.0, ih*0.5
    todos=set(await colher_pagina(tab)) | set(api_users)
    prev=len(todos); estavel=0
    for _ in range(400):
        try:
            await tab.send(uc.cdp.input_.synthesize_scroll_gesture(
                x=float(cx),y=float(cy),x_distance=0.0,y_distance=-380.0,speed=800,
                gesture_source_type=uc.cdp.input_.GestureSourceType.MOUSE))
        except Exception: pass
        await asyncio.sleep(random.uniform(1.3, 3.2))   # scroll humano
        todos |= await colher_pagina(tab)
        todos |= set(api_users)
        tot=len(todos)
        estavel = estavel+1 if tot==prev else 0
        prev = tot
        if estavel>=8 and tot>0: break
        if P.pausado(): return sorted(todos), "pausado"
    return sorted(todos), "ok"

async def rodar():
    posts = P.carregar_index()
    by_code = {p["code"]: p for p in posts}
    if CODES:
        sel = [by_code[c] for c in CODES if c in by_code]
    else:
        sel = posts[:N]
    P.log(f"START runner-dono | OUT={P.OUT} | {len(sel)} posts: {[p['code'] for p in sel]}")

    b=await uc.start(user_data_dir=PROFILE, headless=False)
    try:
        tab=await b.get("https://www.instagram.com/"); await asyncio.sleep(3)
        await tab.send(uc.cdp.network.enable())
        tab.add_handler(uc.cdp.network.ResponseReceived, on_response)
        tab.add_handler(uc.cdp.network.LoadingFinished, on_finished)
        if not await esperar_dono(tab):
            return
        global escutando
        for post in sel:
            if P.pausado(): P.log("pausa detectada — parando."); break
            code=post["code"]; apilike=post.get("like_count")
            api_users.clear(); escutando=True
            try:
                users, status = await capturar_dono(tab, code)
            except Exception as e:
                users, status = None, f"erro:{str(e)[:60]}"
            escutando=False
            if not users:
                P.log(f"   {code}: FALHOU ({status}) | api_like={apilike}")
                P.registrar_ledger({"code":code,"ok":False,"status":status,"like_count":apilike,"target":TARGET})
            else:
                n=len(users); nota=" ✓EXATO" if apilike==n else f" (api_like={apilike})"
                P.log(f"   {code}: {n} curtidores{nota} | status={status}")
                P.salvar_por_post(code, users)
                P.reescrever_contrato(posts)
                P.registrar_ledger({"code":code,"ok":True,"status":status,"unicos":n,"like_count":apilike,"target":TARGET})
            await asyncio.sleep(random.uniform(8, 25))   # pausa humana entre posts
    finally:
        try: b.stop()
        except Exception: pass
    P.log("runner-dono encerrado.")

if __name__ == "__main__":
    uc.loop().run_until_complete(rodar())
