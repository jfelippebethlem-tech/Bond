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
import os, sys, json, time, random, asyncio, datetime, re, hashlib, struct

try:
    import nodriver as uc
except Exception:
    print("⛔ nodriver não instalado. No desktop:  pip install nodriver", file=sys.stderr); sys.exit(2)
# Scroll do modal: CDP synthesizeScrollGesture (background, sem mouse real, sem foco,
# sem JS). pyautogui foi descartado por sequestrar o mouse do dono.

def garantir_somente_desktop():
    # Captura de likers é EXCLUSIVA do desktop residencial (IP residencial, anti-ban).
    # A VM (Linux, IP de datacenter) NUNCA captura — só ingere o que o Syncthing traz.
    # Guard por SO (os.name) porque .env/arquivos SINCRONIZAM pra VM e não são confiáveis;
    # o SO não sincroniza. Kill-switch extra: IG_CAPTURE_DISABLED=1.
    motivo = None
    if os.environ.get("IG_CAPTURE_DISABLED") == "1":
        motivo = "IG_CAPTURE_DISABLED=1"
    elif os.name != "nt":
        motivo = f"SO '{os.name}' não é Windows (provável VM/servidor)"
    if motivo:
        print(f"⛔ ABORTADO: captura de likers é EXCLUSIVA do desktop residencial "
              f"(proteção anti-ban). Esta máquina NÃO captura — só o desktop. Motivo: {motivo}",
              file=sys.stderr)
        sys.exit(9)

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
FORCE    = (env("IG_FORCE", "false") or "").strip().lower() in ("1", "true", "yes", "sim")
DEBUG    = (env("IG_DEBUG", "false") or "").strip().lower() in ("1", "true", "yes", "sim")
SCROLL   = (env("IG_SCROLL", "teclado") or "teclado").strip().lower()  # teclado | scrollview
POOL     = NUM_POSTS if FORCE else NUM_POSTS * 4  # com dedup, junta mais codes p/ sobrar NUM_POSTS novos
LEDGER   = os.path.join(OUT, "captura-ledger.jsonl")  # referencia p/ dedup + sweeps

def ledger_codes():
    # codes ja capturados COM SUCESSO (modal abriu) — pra nao recapturar nos sweeps
    feitos = set()
    try:
        for ln in open(LEDGER, encoding="utf-8"):
            try:
                j = json.loads(ln)
                if j.get("modalAbriu"): feitos.add(j.get("code"))
            except Exception: pass
    except Exception: pass
    return feitos

def registrar_ledger(rec):
    try:
        os.makedirs(OUT, exist_ok=True)
        with open(LEDGER, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception: pass

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
    # roda de verdade no ponto (evento trusted via CDP) — rola o que está sob o cursor.
    # CRÍTICO: mover o cursor (mouseMoved) ANTES da roda; sem isso o Chrome não sabe
    # sobre qual elemento aplicar o scroll e a lista do modal NÃO rola.
    try:
        await tab.send(uc.cdp.input_.dispatch_mouse_event(
            type_="mouseMoved", x=float(cx), y=float(cy)))
        await tab.send(uc.cdp.input_.dispatch_mouse_event(
            type_="mouseWheel", x=float(cx), y=float(cy), delta_x=0.0, delta_y=float(dy)))
    except Exception:
        try: await tab.scroll_down(max(1, int(dy / 8)))
        except Exception: pass

async def tecla(tab, key, vk):
    # tecla REAL via CDP (Input.dispatchKeyEvent) — input de usuario, sem JS.
    try:
        await tab.send(uc.cdp.input_.dispatch_key_event(type_="keyDown", key=key, code=key,
            windows_virtual_key_code=vk, native_virtual_key_code=vk))
        await sleep(rand(0.03, 0.13))
        await tab.send(uc.cdp.input_.dispatch_key_event(type_="keyUp", key=key, code=key,
            windows_virtual_key_code=vk, native_virtual_key_code=vk))
    except Exception: pass

async def rolar(tab, cx, cy, passos):
    for _ in range(passos):
        await wheel(tab, cx, cy, rand(200, 450)); await sleep(rand(0.18, 0.72))
        if chance(0.18): await sleep(rand(0.9, 2.6))
        if chance(0.08): await wheel(tab, cx, cy, -rand(60, 180));

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
    for _ in range(80):
        if len(codes) >= POOL or estavel >= 5: break
        antes = len(vistos)
        for c in await grid_codes(tab):
            if c not in vistos: vistos.add(c); codes.append(c)
        estavel = estavel + 1 if len(vistos) == antes else 0
        await rolar(tab, 683, 400, randint(2, 4)); await sleep(rand(0.5, 1.4))
    return codes[:POOL]

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
        registrar_ledger({"code": code, "url": url, "target": TARGET, "capturadoEm": man["capturadoEm"], "modalAbriu": False, "shots": len(man["likeShots"]), "via": "liked_by_url" if man.get("viaLikedByUrl") else "clique"})
        return {"code": code, "modalAbriu": False}
    man["modalAbriu"] = True; man["scroll"] = "cdp-scroll-gesture"; await sleep(rand(0.7, 1.8))

    # SCROLL via CDP synthesizeScrollGesture (gesto de roda hit-tested, source=mouse) no
    # CENTRO REAL do viewport. Roda em BACKGROUND: NAO toca no mouse real, NAO precisa de
    # foco -> o dono trabalha normal. Sem JS injetado, sem scrollTop. O bug antigo era so
    # COORDENADA (o get_position do modal dava caixa bogus 600x520; o certo e o centro do
    # viewport, do tamanho do 1o screenshot, DPR=1). Passo pequeno -> overlap (ninguem
    # pulado). Sem mouse real -> sem hover card. FIM por SCREENSHOT (tela parou de mudar).
    shot1 = "likes_0001.png"; p1 = os.path.join(d, shot1)
    await tab.save_screenshot(p1, format="png"); man["likeShots"].append(shot1)
    try:
        with open(p1, "rb") as f: hdr = f.read(26)
        vw, vh = struct.unpack(">II", hdr[16:24])
    except Exception: vw, vh = 1280, 800
    cx = vw / 2.0; cy = vh * 0.55
    if DEBUG: print(f"   {code} viewport {vw}x{vh} gesto=({cx:.0f},{cy:.0f})", flush=True)
    async def gesto(dist):
        try:
            await tab.send(uc.cdp.input_.synthesize_scroll_gesture(x=float(cx), y=float(cy),
                x_distance=0.0, y_distance=float(-dist), speed=800, gesture_source_type=uc.cdp.input_.GestureSourceType.MOUSE))
        except Exception:
            try: await tab.send(uc.cdp.input_.synthesize_scroll_gesture(x=float(cx), y=float(cy), x_distance=0.0, y_distance=float(-dist)))
            except Exception: pass
    try: last_hash = hashlib.md5(open(p1, "rb").read()).hexdigest()
    except Exception: last_hash = None
    parado = 0; n = 1
    while n < MAX_SHOTS:
        n += 1
        await gesto(rand(170, 300))                          # gesto PEQUENO -> overlap (ninguem pulado)
        await sleep(rand(1.0, 5.0))                          # pausa humana aleatoria (1-5s)
        shot = f"likes_{n:04d}.png"; path = os.path.join(d, shot)
        await tab.save_screenshot(path, format="png"); man["likeShots"].append(shot)
        try: hsh = hashlib.md5(open(path, "rb").read()).hexdigest()
        except Exception: hsh = str(n)
        if DEBUG:
            cnt = -1
            try: cnt = len(await tab.select_all('div[role="dialog"] a[href^="/"]') or [])
            except Exception: pass
            print(f"   {code} shot {n}: {cnt} no DOM | hash {hsh[:6]}", flush=True)
        parado = parado + 1 if (hsh == last_hash) else 0
        last_hash = hsh
        if parado >= 3:
            if DEBUG: print(f"   {code}: fim no print {n} (tela estavel)", flush=True)
            break

    await sleep(rand(0.4, 1.5))
    try: await tab.send(uc.cdp.input_.dispatch_key_event(type_="keyDown", key="Escape", windows_virtual_key_code=27)); \
         await tab.send(uc.cdp.input_.dispatch_key_event(type_="keyUp", key="Escape", windows_virtual_key_code=27))
    except Exception: pass
    man["shots"] = len(man["postShots"]) + len(man["likeShots"])
    json.dump(man, open(os.path.join(d, "manifest.json"), "w"), indent=2, ensure_ascii=False)
    registrar_ledger({"code": code, "url": url, "target": TARGET, "capturadoEm": man["capturadoEm"], "modalAbriu": True, "shots": man["shots"], "via": "liked_by_url" if man.get("viaLikedByUrl") else "clique"})
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
        pool = await descobrir_posts(tab)
        if not FORCE:
            feitos = ledger_codes()
            novos = [c for c in pool if c not in feitos]
            print(f"   grade: {len(pool)} codes, {len(feitos)} ja no ledger -> {len(novos)} novos", flush=True)
            fila = novos[:NUM_POSTS]
        else:
            fila = pool[:NUM_POSTS]
        if not fila: print("nada novo (dedup pelo ledger)" if not FORCE else "nada novo"); status(True, "nada_novo"); return
        print(f"   vou capturar {len(fila)} posts: {', '.join(fila)}", flush=True)
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
    garantir_somente_desktop()
    uc.loop().run_until_complete(main())
