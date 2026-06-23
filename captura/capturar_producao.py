#!/usr/bin/env python3
# RUNNER DE PRODUÇÃO — captura de curtidores no DESKTOP (anti-ban), método exato (DOM-union).
# Agenda (confirmada pelo dono):
#   - roda todo dia, início aleatório 05:30–05:45, ciclos de ~1h (jitter ±10min), 5 posts/ciclo
#   - ciclo 1: 2 dos 10 mais recentes (rotativo) + 3 antigos aleatórios
#   - ciclo 2+: backlog antigo (mais antigos primeiro), sem repetir (ledger), até completar todos
#   - Seg/Qui: prioridade aos 10 mais recentes (ciclos 1-2 cobrem os 10)
#   - re-passe: só re-captura post cujo like_count (API) mudou desde a última vez
#   - timing humano: abrir site, navegar, CADA scroll → aleatório 1–12s
#   - escreve os 3 arquivos do contrato (likers.json / posts-curtidores.json / posts-meta.json)
#     no OUT (Syncthing) + ledger. VM só ingere; captura é exclusiva daqui.
# Uso teste (conta itsbernardof, isolado, até amanhã 08:00):
#   IG_TESTE=1 IG_ATE="2026-06-23 08:00" python captura/capturar_producao.py
import os, sys, json, re, time, random, asyncio, datetime, struct, hashlib, base64
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # console Windows é cp1252
except Exception: pass

def garantir_somente_desktop():
    if os.environ.get("IG_CAPTURE_DISABLED") == "1" or os.name != "nt":
        m = "IG_CAPTURE_DISABLED=1" if os.environ.get("IG_CAPTURE_DISABLED") == "1" else f"SO '{os.name}' não é Windows"
        print(f"⛔ ABORTADO: captura é EXCLUSIVA do desktop residencial (anti-ban). Motivo: {m}", file=sys.stderr)
        sys.exit(9)

try:
    import nodriver as uc
except Exception:
    print("⛔ nodriver não instalado. No desktop: pip install nodriver", file=sys.stderr); sys.exit(2)

HERE = os.path.dirname(os.path.abspath(__file__))
def env(k, d=None): return os.environ.get(k, d)

TARGET   = env("IG_TARGET_USER") or env("IG_PERFIL") or "depjorgefelippeneto"
PROFILE  = env("IG_PROFILE_DIR", r"C:\jfn\ig-profile-dono")   # conta DONA (vê TODOS; sem teto ~100)
OWNER_ID = env("IG_OWNER_ID", "1985223190")                   # @depjorgefelippeneto
TESTE    = env("IG_TESTE") == "1"
CODES    = [c.strip() for c in (env("IG_CODES") or "").split(",") if c.strip()]  # posts específicos
UM_CICLO = env("IG_UM_CICLO") == "1" or bool(CODES)                              # 1 ciclo e sai (p/ cron/Hermes)
IDX      = os.path.join(HERE, "posts-index.json")
OUT_BASE = env("LIKERS_OUT_DIR") or os.path.join(HERE, "..", "likers-sync")
# Saída em PRODUÇÃO por padrão (alimenta o politimonitor). Isole só se LIKERS_OUT_SUB setado.
OUT      = os.path.join(OUT_BASE, env("LIKERS_OUT_SUB")) if env("LIKERS_OUT_SUB") else OUT_BASE
LEDGER   = os.path.join(OUT, "captura-ledger.jsonl")
LOG      = os.path.join(OUT, "runner.log")
POR_POST = os.path.join(OUT, "posts-curtidores.json")
# tempo-limite (para o teste). Sem isso, roda "para sempre" (produção).
ATE = None
if env("IG_ATE"):
    try: ATE = datetime.datetime.strptime(env("IG_ATE"), "%Y-%m-%d %H:%M")
    except Exception: ATE = None
PAUSE_FILES = [os.path.join(d, ".pause_captura") for d in (OUT, HERE, OUT_BASE)]
COOLDOWN_FILE = os.path.join(OUT, ".cooldown_until")   # kill-switch: descansa a conta 24h após bloqueio

os.makedirs(OUT, exist_ok=True)
def rand(a, b): return random.uniform(a, b)
def humano(): return rand(1, 12)             # timing humano 1–12s (scroll/abrir/navegar)
def now(): return datetime.datetime.now()
def log(msg):
    linha = f"{now():%Y-%m-%d %H:%M:%S} {msg}"
    print(linha, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f: f.write(linha + "\n")
    except Exception: pass

def pausado():
    return any(os.path.exists(p) for p in PAUSE_FILES)

def em_cooldown():
    # True se estamos no descanso de 24h pós-bloqueio. Auto-expira (apaga o arquivo).
    try:
        if not os.path.exists(COOLDOWN_FILE): return False
        until = datetime.datetime.fromisoformat(open(COOLDOWN_FILE, encoding="utf-8").read().strip())
        if now() < until: return True
        os.remove(COOLDOWN_FILE)   # passou as 24h -> libera
        return False
    except Exception:
        return False

def ativar_cooldown(horas=24):
    # kill-switch: ao menor sinal de bloqueio, trava TUDO por `horas` (default 24h).
    until = now() + datetime.timedelta(hours=horas)
    try:
        with open(COOLDOWN_FILE, "w", encoding="utf-8") as f: f.write(until.isoformat())
    except Exception: pass
    log(f"🧊 COOLDOWN ATIVADO até {until:%Y-%m-%d %H:%M} ({horas}h) — sinal de bloqueio; conta descansando.")
    return until

# ---------- índice + ledger ----------
def carregar_index():
    d = json.load(open(IDX, encoding="utf-8"))
    posts = d.get("posts", [])
    posts.sort(key=lambda p: p.get("timestamp") or "", reverse=True)   # mais recente primeiro
    return posts

def carregar_ledger():
    # {code: {capturadoEm, like_count, unicos}}  — última captura por post
    led = {}
    if os.path.exists(LEDGER):
        for ln in open(LEDGER, encoding="utf-8", errors="replace"):
            try:
                r = json.loads(ln); led[r["code"]] = r
            except Exception: pass
    return led

def registrar_ledger(rec):
    rec["quando"] = now().isoformat()
    with open(LEDGER, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

def precisa_capturar(post, led):
    # re-passe por delta: pula se já capturado e like_count não mudou
    r = led.get(post["code"])
    if not r: return True
    return r.get("like_count") != post.get("like_count")

# ---------- seleção do ciclo (cadência do dono) ----------
# Cada disparo do cron = 1 run = 6–10 posts (aleatório), SEMPRE >=1 dos últimos 10 dias.
# 6 runs/dia (1/h, 05h→10h). Seg/Qui: as 2 PRIMEIRAS runs focam recentes; as 4 restantes
# aleatórias. A run se localiza pelo RELÓGIO (hora 5,6,7,8,9,10 -> índice 1..6).
RUN_POR_HORA = {5: 1, 6: 2, 7: 3, 8: 4, 9: 5, 10: 6}
def _ts_post(p):
    s = p.get("timestamp") or ""
    try: return datetime.datetime.fromisoformat(s.replace("+0000", "+00:00")).replace(tzinfo=None)
    except Exception: return datetime.datetime.min

def selecionar(posts, led, agora):
    n = random.randint(int(env("IG_MIN_POSTS", "6")), int(env("IG_MAX_POSTS", "10")))
    run_idx = RUN_POR_HORA.get(agora.hour, 0)                  # 0 = fora da janela (disparo manual)
    # janela 05h–10h é toda no mesmo dia → bloco = hoje
    bloco = agora.date()
    seg_qui = bloco.weekday() in (0, 3)                        # Seg=0, Qui=3
    recent_run = seg_qui and run_idx in (1, 2)                 # Seg/Qui: 2 primeiras runs = recentes
    limite = agora - datetime.timedelta(days=10)               # "últimos 10 dias"
    recentes = [p for p in posts if _ts_post(p) >= limite]
    antigos  = [p for p in posts if _ts_post(p) <  limite]
    def rot(lst):                                             # menos-recentemente-capturado primeiro
        return sorted(lst, key=lambda p: (led.get(p["code"], {}).get("quando") or ""))
    sel = []
    if recent_run:                                           # foco nos recentes
        sel = rot(recentes)[:n]
        if len(sel) < n:                                     # completa com antigos se faltar
            sel += [p for p in rot(antigos) if p not in sel][:n - len(sel)]
    else:                                                    # run aleatória: SEMPRE 1 recente + resto aleatório
        if recentes: sel.append(rot(recentes)[0])
        pool = antigos[:]; random.shuffle(pool)
        sel += [p for p in pool if p not in sel][:max(0, n - len(sel))]
        if len(sel) < n:                                     # backlog acabou -> completa com recentes
            sel += [p for p in rot(recentes) if p not in sel][:n - len(sel)]
    return sel[:n]

# ---------- captura de 1 post — MÉTODO DONO (página /liked_by/, lista COMPLETA) ----------
# Logado como o dono, /p/<code>/liked_by/ é uma PÁGINA que lista TODOS (sem teto ~100 de
# não-dono). Rola humano (gesto CDP) + une usernames da lista (DOM por scroll) + escuta
# GraphQL passiva (rede de segurança p/ posts grandes). 100% humano: nada de fetch in-page.
SKIP = {"", "explore", "reels", "reel", "direct", "p", "accounts", "emails", "challenge",
        "stories", "about", "legal", "privacy", "tv", "api", TARGET}

_api = {}; _pend = {}; _escutando = False
def _coletar(j):
    pilha = [j]
    while pilha:
        n = pilha.pop()
        if isinstance(n, dict):
            un = n.get("username")
            if isinstance(un, str) and un and un not in SKIP: _api[un] = True
            for v in n.values():
                if isinstance(v, (dict, list)): pilha.append(v)
        elif isinstance(n, list):
            pilha.extend(x for x in n if isinstance(x, (dict, list)))
def _interessa(u): return bool(re.search(r"graphql/query|/likers\b|liked_by", u or "", re.I))
async def _on_response(evt, conn=None):
    if not _escutando: return
    try:
        if _interessa(evt.response.url): _pend[evt.request_id] = 1
    except Exception: pass
async def _on_finished(evt, conn=None):
    rid = getattr(evt, "request_id", None)
    if rid is None or rid not in _pend or conn is None: return
    _pend.pop(rid, None)
    try:
        body, b64 = await conn.send(uc.cdp.network.get_response_body(rid))
        if b64: body = base64.b64decode(body).decode("utf-8", "replace")
        _coletar(json.loads(body))
    except Exception: pass

def _coerce(r):
    # nodriver às vezes embrulha o retorno do evaluate; primitivos (string) vêm direto.
    if isinstance(r, str): return r
    if isinstance(r, dict): return r.get("value", r)
    return r

async def ler_pagina(tab):
    # UMA chamada in-page: coleta os usernames da lista E o estado do scroll de uma vez.
    # Evita select_all O(n) (1 chamada CDP por elemento) que TRAVA em posts grandes (1000+).
    # retorna (set_usernames, scrollHeight, scrollTop, clientHeight, spinner)
    try:
        s = await tab.evaluate(r"""(()=>{
            const se=document.scrollingElement||document.documentElement;
            const sp=document.querySelector('[role="progressbar"], [data-visualcompletion="loading-state"]');
            const re=/^\/[A-Za-z0-9._]+\/$/; const us=[];
            for(const a of document.querySelectorAll('a[href^="/"]')){const h=a.getAttribute('href')||''; if(re.test(h)) us.push(h.slice(1,-1));}
            return JSON.stringify({u:us, sh:se.scrollHeight, st:se.scrollTop, ch:se.clientHeight, sp:sp?1:0});
        })()""")
        d = json.loads(_coerce(s))
        users = {x for x in d.get("u", []) if x and x not in SKIP}
        return users, int(d.get("sh", 0)), int(d.get("st", 0)), int(d.get("ch", 0)), int(d.get("sp", 0))
    except Exception:
        return set(), 0, 0, 0, 0

def passo_sleep():
    # ritmo humano entre scrolls; tunável p/ testes (default produção 1–12s)
    return rand(float(env("IG_SCROLL_MIN", "1")), float(env("IG_SCROLL_MAX", "12")))

async def ds_user_id(tab):
    try:
        cks = await tab.send(uc.cdp.network.get_cookies(urls=["https://www.instagram.com/"]))
        for c in (cks or []):
            if getattr(c, "name", "") == "ds_user_id": return getattr(c, "value", "") or ""
    except Exception: pass
    return ""

async def esperar_dono(tab):
    # exige a conta ATIVA = dono. Login persiste no perfil (normalmente já está). Sem isso,
    # capturaria como não-dono (teto ~100). Espera curta p/ rodadas não-assistidas.
    uid = await ds_user_id(tab)
    if uid == OWNER_ID:
        log(f"[OK] logado como o dono (id {uid})."); return True
    log(f"AGUARDANDO: conta ATIVA precisa ser @{TARGET} (id {OWNER_ID}).")
    ultimo = None
    for i in range(60):   # ~5 min
        uid = await ds_user_id(tab)
        if uid == OWNER_ID: break
        if uid and uid != ultimo:
            log(f"  conta ativa={uid} NÃO é o dono — troque p/ @{TARGET}."); ultimo = uid
        await asyncio.sleep(5)
    if uid != OWNER_ID:
        log("ABORTA: conta dona não ficou ativa."); return False
    log("[OK] dono ativo — 30s p/ diálogos de login (manter logado/notificações).")
    await asyncio.sleep(30)
    return True

async def capturar_post(tab, code):
    globals()["_escutando"] = True; _api.clear()
    try:
        await tab.get(f"https://www.instagram.com/p/{code}/liked_by/"); await asyncio.sleep(humano())
        vp = await tab.evaluate("[innerWidth, innerHeight]")
        try: iw, ih = int(vp[0]), int(vp[1])
        except Exception: iw, ih = 1280, 800
        cx, cy = iw/2.0, ih*0.5
        # ESPERA a lista RENDERIZAR e a ALTURA ESTABILIZAR (reflow concluído) antes de medir.
        # Senão sh=viewport e faltam=0 dispara o "fundo" cedo, gravando lixo (bug: total=1).
        nomes0 = set(); sh0 = st0 = ch0 = 0; _psh = -1; _estab = 0
        for _ in range(60):                              # até ~36s p/ a lista montar
            nomes0, sh0, st0, ch0, _sp = await ler_pagina(tab)
            if sh0 == _psh and (sh0 > ch0 + 80 or len(nomes0) > 0):
                _estab += 1
            else:
                _estab = 0
            _psh = sh0
            if _estab >= 2: break                        # altura estável 2x = reflow concluído
            await asyncio.sleep(0.6)
        # PLANO POR POST (conta simples): passo = ~1 tela com sobreposição (15%) p/ NÃO pular
        # linhas; nº de passos ≈ scrollHeight/passo; ETA = passos × ritmo (com folga).
        todos = set(_api) | nomes0
        step = max(200, int((ch0 or 700) * 0.85))        # sobreposição de 15% (cobre toda linha)
        est = ((max(0, sh0 - ch0) + step - 1) // step) if step else 0
        ritmo = (float(env("IG_SCROLL_MIN", "1")) + float(env("IG_SCROLL_MAX", "12"))) / 2 + 1.0  # s/passo (+overhead)
        eta_min = round(est * ritmo / 60, 1)
        log(f"      {code}: altura={sh0}px viewport={ch0}px passo={step}px ~{est} passos | ETA ~{eta_min}min (paciência: só fecha no fundo real)")
        prev_st = -1; sem_avanco = 0; estavel_fundo = 0; passos = 0; motivo = "max"
        sh, st, ch = sh0, st0, ch0
        while passos < 2000:
            passos += 1
            try:
                await tab.send(uc.cdp.input_.synthesize_scroll_gesture(x=float(cx), y=float(cy), x_distance=0.0, y_distance=float(-step), speed=900, gesture_source_type=uc.cdp.input_.GestureSourceType.MOUSE))
            except Exception: pass
            await asyncio.sleep(passo_sleep())           # ritmo humano entre passos
            novos, sh, st, ch, spin = await ler_pagina(tab)
            todos |= novos; todos |= set(_api)
            faltam = max(0, sh - (st + ch)); pct = int(100*(st+ch)/sh) if sh else 0
            at_bottom = faltam <= 16
            if (passos % 3 == 0) or at_bottom:
                # domNow = nomes visíveis no DOM AGORA (revela virtualização: se «domNow« total, é virtual)
                log(f"      scroll p{passos}/~{est}: total={len(todos)} domNow={len(novos)} pos={st+ch}/{sh} faltam={faltam}px ({pct}%)")
            # FIM determinístico: no fundo de verdade, sem spinner, estável por 3 leituras
            estavel_fundo = estavel_fundo + 1 if (at_bottom and not spin) else 0
            sem_avanco = sem_avanco + 1 if st <= prev_st else 0
            prev_st = st
            if estavel_fundo >= 3 and len(todos) > 0:
                motivo = "fundo_atingido"; break
            if sem_avanco >= 12:                         # gesto não move o scroll (travou/topo = throttle)
                motivo = "scroll_nao_avanca"; break
            if pausado(): return sorted(todos), "pausado", motivo
        faltam = max(0, sh - (st + ch))
        log(f"      -> fim: {len(todos)} curtidores | motivo={motivo} | faltam={faltam}px | passos={passos}")
        return sorted(todos), "ok", motivo
    finally:
        globals()["_escutando"] = False

# ---------- escrita dos 3 arquivos do contrato ----------
def reescrever_contrato(posts_idx):
    # por_post -> likers.json (ranking) + posts-meta.json
    por_post = json.load(open(POR_POST, encoding="utf-8")) if os.path.exists(POR_POST) else {}
    cont = {}
    for code, users in por_post.items():
        for u in users: cont[u] = cont.get(u, 0) + 1
    ranking = sorted([{"username": u, "curtidas": c} for u, c in cont.items()], key=lambda x: -x["curtidas"])
    json.dump(ranking, open(os.path.join(OUT, "likers.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    by_code = {p["code"]: p for p in posts_idx}
    metas = []
    for code in por_post:
        p = by_code.get(code, {})
        ts = p.get("timestamp")
        taken = int(datetime.datetime.fromisoformat(ts.replace("+0000", "+00:00")).timestamp()) if ts else 0
        metas.append({"code": code, "url": p.get("permalink", f"https://www.instagram.com/p/{code}/"),
                      "taken_at": taken, "like_count_api": p.get("like_count"), "curtidores_capturados": len(por_post[code])})
    metas.sort(key=lambda m: -(m["taken_at"] or 0))
    json.dump(metas, open(os.path.join(OUT, "posts-meta.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def salvar_por_post(code, users):
    por_post = json.load(open(POR_POST, encoding="utf-8")) if os.path.exists(POR_POST) else {}
    por_post[code] = users
    json.dump(por_post, open(POR_POST, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# ---------- loop principal ----------
async def rodar():
    posts = carregar_index()
    by_code = {p["code"]: p for p in posts}
    log(f"START runner | alvo=@{TARGET} | teste={TESTE} | OUT={OUT} | até={ATE} | {len(posts)} posts no índice")
    ciclo = 0
    while True:
        if ATE and now() >= ATE:
            log(f"FIM: atingiu o limite {ATE}"); break
        if pausado():
            log("⏸️ .pause_captura presente — abortando a noite."); break
        if em_cooldown():
            until = open(COOLDOWN_FILE, encoding="utf-8").read().strip()
            log(f"🧊 EM COOLDOWN (até {until}) — conta descansando 24h pós-bloqueio. Sem captura."); break
        led = carregar_ledger()
        if CODES and ciclo == 0:
            sel = [by_code[c] for c in CODES if c in by_code]
        else:
            sel = selecionar(posts, led, now())
        sel = [p for p in sel if p]
        log(f"--- ciclo {ciclo} ({now():%a %H:%M}) | {len(sel)} posts: {[p['code'] for p in sel]} ---")
        if not sel:
            log("nada pendente neste ciclo.");
        else:
            browser = await uc.start(user_data_dir=PROFILE, headless=False)
            try:
                tab = await browser.get("https://www.instagram.com/"); await asyncio.sleep(humano())
                await tab.send(uc.cdp.network.enable())
                tab.add_handler(uc.cdp.network.ResponseReceived, _on_response)
                tab.add_handler(uc.cdp.network.LoadingFinished, _on_finished)
                dono_ok = await esperar_dono(tab)
                if not dono_ok: log("ciclo abortado: conta dona não ativa (sem captura p/ não regredir ao teto ~100).")
                throttle = 0                              # nº de capturas degradadas seguidas (abort-on-bloqueio)
                for post in (sel if dono_ok else []):
                    if ATE and now() >= ATE: break
                    if pausado(): log("⏸️ pausa detectada no meio do ciclo."); break
                    code = post["code"]; apilike = post.get("like_count")
                    try:
                        users, status, motivo = await capturar_post(tab, code)
                    except Exception as e:
                        users, status, motivo = None, f"erro:{str(e)[:60]}", "erro"
                    n = len(users) if users else 0
                    prev_n = (led.get(code) or {}).get("unicos")
                    # GUARD anti-throttle: NÃO salvar captura degradada (senão corrompe o bom valor).
                    # Degradado = scroll travou, OU n minúsculo p/ post com curtidas, OU colapso vs último.
                    degradado = (status == "pausado" or motivo == "scroll_nao_avanca"
                                 or (n <= 15 and (apilike or 0) > 30)
                                 or (prev_n and prev_n > 40 and n < prev_n * 0.5))
                    if users is None or degradado:
                        log(f"   {code}: DESCARTADO (n={n} motivo={motivo} status={status} prev={prev_n}) — NÃO salvo (preserva o bom)")
                        registrar_ledger({"code": code, "ok": False, "status": ("degradado" if degradado else status), "n": n, "like_count": apilike, "target": TARGET})
                        if status != "pausado":
                            throttle += 1
                            if throttle >= 2:
                                log("🛑 BLOQUEIO: 2 capturas degradadas seguidas = conta throttled.")
                                ativar_cooldown(24)   # kill-switch: descansa 24h
                                break
                        else:
                            break
                    else:
                        throttle = 0
                        nota = " ✓EXATO" if apilike == n else f" (api={apilike})"
                        log(f"   {code}: {n} curtidores{nota} | status={status}")
                        salvar_por_post(code, users)
                        reescrever_contrato(posts)
                        registrar_ledger({"code": code, "ok": True, "status": status, "unicos": n, "like_count": apilike, "target": TARGET})
                    await asyncio.sleep(humano())          # pausa humana entre posts
            finally:
                try: browser.stop()
                except Exception: pass
        ciclo += 1
        if UM_CICLO:
            log("modo um-ciclo (IG_UM_CICLO/IG_CODES) — encerrando após 1 ciclo."); break
        if ATE and now() >= ATE: break
        # próxima rodada em ~1h com jitter ±10min (mas não passa do limite)
        espera = max(60, 3600 + random.uniform(-600, 600))
        prox = now() + datetime.timedelta(seconds=espera)
        if ATE and prox >= ATE:
            log(f"próximo ciclo ({prox:%H:%M}) passaria do limite — encerrando."); break
        log(f"⏳ próximo ciclo ~{prox:%H:%M} (dormindo {espera/60:.0f} min)")
        # dorme em fatias, checando pausa
        fim = time.time() + espera
        while time.time() < fim:
            if pausado(): log("⏸️ pausa durante o intervalo."); return
            time.sleep(min(30, fim - time.time()))
    log("runner encerrado.")

if __name__ == "__main__":
    garantir_somente_desktop()
    uc.loop().run_until_complete(rodar())
