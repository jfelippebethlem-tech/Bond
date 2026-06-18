#!/usr/bin/env python3
# MOTOR A — nodriver (CDP-nativo, padrão-ouro anti-detecção).
# Por que é o mais seguro (ver pesquisa no runbook): nodriver NÃO injeta JS de
# automação, NÃO seta navigator.webdriver, NÃO deixa os globals do Playwright, e
# dirige o Chrome REAL. Aqui também: SÓ mouse/roda/teclado + SCREENSHOT. Os
# usernames saem DEPOIS, fora do IG (parse/parse_likers.py).
#
# Mesma SAÍDA dos motores Node: <SHOTS>/<target>/<code>/{post_1.png,likes_NNNN.png,manifest.json}
#
# Pré-req no desktop:  pip install nodriver   (+ Chrome instalado)
# Uso (Hermes):        IG_TARGET_USER=<perfil> IG_ENGINE=nodriver python capture/capture_nodriver.py
import os, sys, json, time, random, asyncio, datetime, re

try:
    import nodriver as uc
except Exception:
    print("⛔ nodriver não instalado. No desktop:  pip install nodriver", file=sys.stderr); sys.exit(2)

HERE = os.path.dirname(os.path.abspath(__file__))

def env(k, d=None): return os.environ.get(k, d)
def load_env(path):
    try:
        for ln in open(path, encoding="utf-8"):
            m = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$', ln, re.I)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    except Exception: pass
load_env(os.path.join(HERE, ".env")); load_env(os.path.join(HERE, "..", ".env"))

TARGET   = (env("IG_TARGET_USER") or env("IG_PERFIL") or "").lstrip("@").strip()
SHOTS    = env("LIKERS_SHOTS_DIR") or os.path.join(HERE, "shots")
OUT      = env("LIKERS_OUT_DIR") or os.path.join(HERE, "..", "likers-sync")
PROFILE  = env("IG_PROFILE_DIR") or os.path.join(HERE, "..", "ig-profile")
NUM_POSTS= max(1, int(env("IG_NUM_POSTS", "12")))
MIN_S    = max(5, int(env("IG_TEMPO_MIN", "15")))
MAX_S    = max(20, int(env("IG_TEMPO_MAX", "200")))
MAX_SHOTS= max(3, int(env("IG_MAX_SHOTS", "30")))
MAX_FALHAS = max(2, int(env("IG_MAX_FALHAS", "3")))

def rand(a, b): return a + random.random() * (b - a)
def randint(a, b): return random.randint(a, b)
def chance(p): return random.random() < p
async def sleep(s): await asyncio.sleep(max(0, s))
def tempo_post_ms():
    u = (random.random() + random.random() + random.random()) / 3
    return int((MIN_S + u * (MAX_S - MIN_S)) * 1000)
def sane(s): return re.sub(r'[^A-Za-z0-9._-]', '_', str(s or "x"))[:80]
def code_da_url(u):
    m = re.search(r'/(?:p|reel)/([A-Za-z0-9_-]+)', str(u or "")); return m.group(1) if m else None

def status(ok, erro=None):
    try:
        os.makedirs(OUT, exist_ok=True)
        json.dump({"ok": ok, "erro": erro, "quando": datetime.datetime.utcnow().isoformat() + "Z"},
                  open(os.path.join(OUT, "likers-status.json"), "w"))
    except Exception: pass

def pausado():
    for p in [os.path.join(HERE, "..", ".pause_captura"), os.path.join(OUT, ".pause_captura"), os.path.join(SHOTS, ".pause_captura")]:
        if os.path.exists(p): return p
    return None

async def wheel(tab, cx, cy, dy):
    # roda de verdade no ponto (evento trusted via CDP) — rola o que está sob o cursor
    try:
        await tab.send(uc.cdp.input_.dispatch_mouse_event(
            type_="mouseWheel", x=float(cx), y=float(cy), delta_x=0.0, delta_y=float(dy)))
    except Exception:
        try: await tab.scroll_down(max(1, int(dy / 8)))
        except Exception: pass

async def rolar(tab, cx, cy, passos):
    for _ in range(passos):
        await wheel(tab, cx, cy, rand(90, 320)); await sleep(rand(0.18, 0.72))
        if chance(0.18): await sleep(rand(0.9, 2.6))
        if chance(0.08): await wheel(tab, cx, cy, -rand(40, 140));

async def centro_do(tab, selector):
    try:
        el = await tab.select(selector, timeout=2)
        if not el: return None
        p = await el.get_position()
        if not p: return None
        # nodriver Position expoe .abs_x/.abs_y (viewport absoluto = o que o CDP Input
        # quer). Checar is-not-None (nao truthiness): abs_x==0 e coordenada legitima.
        # .left/.top sao relativos ao box e NAO servem de coordenada de clique.
        ax = getattr(p, "abs_x", None); ay = getattr(p, "abs_y", None)
        x = ax if ax is not None else getattr(p, "x", None)
        y = ay if ay is not None else getattr(p, "y", None)
        if x is None or y is None: return None
        w = getattr(p, "width", None) or 120; h = getattr(p, "height", None) or 80
        return (x + w * rand(0.4, 0.6), y + h * rand(0.3, 0.7), w, h, el)
    except Exception:
        return None

async def grid_codes(tab):
    out = []
    for sel in ['a[href*="/p/"]', 'a[href*="/reel/"]']:
        try:
            els = await tab.select_all(sel)
            for el in (els or []):
                c = code_da_url((el.attrs or {}).get("href"))
                if c: out.append(c)
        except Exception: pass
    return out

async def descobrir_posts(tab):
    await tab.get(f"https://www.instagram.com/{TARGET}/"); await sleep(rand(2.5, 6.5))
    codes, vistos, estavel = [], set(), 0
    for _ in range(50):
        if len(codes) >= NUM_POSTS or estavel >= 5: break
        antes = len(vistos)
        for c in await grid_codes(tab):
            if c not in vistos: vistos.add(c); codes.append(c)
        estavel = estavel + 1 if len(vistos) == antes else 0
        await rolar(tab, 683, 400, randint(2, 4)); await sleep(rand(0.5, 1.4))
    return codes[:NUM_POSTS]

async def capturar_post(tab, code):
    url = f"https://www.instagram.com/p/{code}/"
    d = os.path.join(SHOTS, sane(TARGET), sane(code)); os.makedirs(d, exist_ok=True)
    man = {"target": TARGET, "code": code, "url": url, "engine": "nodriver",
           "capturadoEm": datetime.datetime.utcnow().isoformat() + "Z",
           "postShots": [], "likeShots": [], "modalAbriu": False}
    await tab.get(url); await sleep(rand(2, 6))
    # format="png" é OBRIGATÓRIO: o default do nodriver é jpeg (salvaria JPEG num .png)
    await tab.save_screenshot(os.path.join(d, "post_1.png"), format="png"); man["postShots"].append("post_1.png")

    async def esperar_dialog():
        for _ in range(14):
            # exige dialog COM links de perfil (curtidores) — evita falso-positivo
            # de banner cookie/notificacao e distingue de pagina/bloqueio.
            dc = await centro_do(tab, 'div[role="dialog"]:has(a[href^="/"])')
            if dc and dc[2] > 100 and dc[3] > 100: return dc
            await sleep(rand(0.25, 0.6))
        return None

    # abrir curtidas: 1º clique humano no link; senão FALLBACK navegando pra /liked_by/
    dlg = None
    alvo = await centro_do(tab, 'a[href$="/liked_by/"]') or await centro_do(tab, 'a[href*="liked_by"]')
    if alvo:
        try:
            await alvo[4].mouse_move(); await sleep(rand(0.12, 0.5)); await alvo[4].click()
            dlg = await esperar_dialog()
        except Exception: dlg = None
    if not dlg:
        man["viaLikedByUrl"] = True
        try: await tab.get(f"https://www.instagram.com/p/{code}/liked_by/"); await sleep(rand(1.5, 3))
        except Exception: pass
        dlg = await esperar_dialog()
    if not dlg:
        json.dump(man, open(os.path.join(d, "manifest.json"), "w"), indent=2, ensure_ascii=False)
        return {"code": code, "modalAbriu": False}
    man["modalAbriu"] = True; await sleep(rand(0.7, 1.8))

    fim = time.time() + tempo_post_ms() / 1000.0; n = 0
    while time.time() < fim and n < MAX_SHOTS:
        n += 1; shot = f"likes_{n:04d}.png"
        await tab.save_screenshot(os.path.join(d, shot), format="png"); man["likeShots"].append(shot)
        dc = await centro_do(tab, 'div[role="dialog"]') or dlg
        await rolar(tab, dc[0], dc[1], randint(1, 2)); await sleep(rand(0.4, 1.1))
    while time.time() < fim:
        await sleep(rand(1.5, 4.0))
        if chance(0.3):
            dc = await centro_do(tab, 'div[role="dialog"]') or dlg
            await rolar(tab, dc[0], dc[1], 1)

    await sleep(rand(0.4, 1.5))
    try: await tab.send(uc.cdp.input_.dispatch_key_event(type_="keyDown", key="Escape", windows_virtual_key_code=27)); \
         await tab.send(uc.cdp.input_.dispatch_key_event(type_="keyUp", key="Escape", windows_virtual_key_code=27))
    except Exception: pass
    man["shots"] = len(man["postShots"]) + len(man["likeShots"])
    json.dump(man, open(os.path.join(d, "manifest.json"), "w"), indent=2, ensure_ascii=False)
    return {"code": code, "modalAbriu": True, "shots": man["shots"]}

async def main():
    if not TARGET: print("⛔ Defina IG_TARGET_USER.", file=sys.stderr); status(False, "sem_target"); return
    tr = pausado()
    if tr: print(f"⏸️ PAUSADO ({tr}) — não vou tocar no IG."); status(True, "pausado"); return
    print(f"▶ motor=nodriver alvo=@{TARGET} posts={NUM_POSTS} tempo/post={MIN_S}-{MAX_S}s")
    await sleep(rand(1.5, 5))
    browser = await uc.start(user_data_dir=PROFILE, headless=False)
    try:
        tab = await browser.get("https://www.instagram.com/"); await sleep(rand(3, 7))
        # LOGIN: espera você logar na conta-teste se a tela de login aparecer (até ~5 min).
        for i in range(30):
            try: form = await tab.select('input[name="username"]', timeout=2)
            except Exception: form = None
            if not form: break
            if i == 0: print("🔑 NAO logado. Faca login na CONTA-TESTE na janela (usuario+senha+2FA). Aguardando ate 5 min...")
            await sleep(rand(8, 12))
        await rolar(tab, 683, 400, randint(2, 5)); await sleep(rand(0.8, 2.5))
        fila = await descobrir_posts(tab)
        if not fila: print("nada novo"); status(True, "nada_novo"); return
        falhas, desde, lote, res = 0, 0, randint(3, 7), []
        for i, code in enumerate(fila):
            try: r = await capturar_post(tab, code)
            except Exception as e: r = {"code": code, "modalAbriu": False, "erro": str(e)}
            res.append(r)
            if r.get("modalAbriu"): falhas = 0
            else:
                falhas += 1
                if falhas >= MAX_FALHAS:
                    print(f"⛔ ABORTADO: modal não abriu em {falhas} posts seguidos (possível bloqueio).")
                    status(False, "modal_nao_abriu_possivel_bloqueio"); break
            print(f"   {code}: {'ok ' + str(r.get('shots')) + ' prints' if r.get('modalAbriu') else 'modal NÃO abriu'}")
            if i < len(fila) - 1:
                await sleep(rand(2, 8))
                if chance(0.15):
                    await tab.get("https://www.instagram.com/"); await sleep(rand(2, 6)); await rolar(tab, 683, 400, randint(1, 3))
                desde += 1
                if desde >= lote: desde, lote = 0, randint(3, 7); await sleep(rand(45, 150))
        else:
            status(True, None)
        print(f"✅ prints em {SHOTS}/{TARGET}/<code>/  → depure na VM com parse/parse_likers.py")
    finally:
        try: browser.stop()
        except Exception: pass

if __name__ == "__main__":
    uc.loop().run_until_complete(main())
