#!/usr/bin/env python3
# LOGIN helper (nodriver) — loga UMA vez e persiste a sessão no user_data_dir.
# EXCLUSIVO do desktop residencial: login no IG a partir de IP de datacenter (VM) é
# risco alto de ban. A VM NÃO loga nem captura — só ingere o que o Syncthing traz.
# (Antes este helper era usado na VM headless sob Xvfb; isso foi PROIBIDO por anti-ban.)
# Lê IG_USERNAME / IG_PASSWORD do .env. Trata diálogos (cookies / salvar login /
# notificações) e detecta 2FA/checkpoint, reportando sem inventar.
import os, sys, asyncio, re, datetime
try:
    import nodriver as uc
except Exception:
    print("⛔ nodriver não instalado.", file=sys.stderr); sys.exit(2)

def garantir_somente_desktop():
    # Login/captura do IG é EXCLUSIVO do desktop residencial (anti-ban). VM (Linux) jamais.
    if os.environ.get("IG_CAPTURE_DISABLED") == "1" or os.name != "nt":
        m = "IG_CAPTURE_DISABLED=1" if os.environ.get("IG_CAPTURE_DISABLED") == "1" else f"SO '{os.name}' não é Windows (provável VM/servidor)"
        print(f"⛔ ABORTADO: login/captura do IG é EXCLUSIVO do desktop residencial (anti-ban). Esta máquina NÃO loga no IG. Motivo: {m}", file=sys.stderr)
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

USER = (env("IG_USERNAME") or "").strip()
PWD  = (env("IG_PASSWORD") or "").strip()
PROFILE = env("IG_PROFILE_DIR_VM") or os.path.join(HERE, "..", "ig-profile")
SHOT = os.path.join(HERE, "shots", "_login")

import random
def rand(a, b): return a + random.random() * (b - a)
async def sleep(s): await asyncio.sleep(max(0, s))

async def click_texto(tab, textos):
    for t in textos:
        try:
            el = await tab.find(t, best_match=True)
            if el:
                await el.click(); await sleep(2); return t
        except Exception: pass
    return None

async def logado(tab):
    # sem campo de username e com algum indício de app logado
    try:
        u = await tab.select('input[name="username"]', timeout=2)
        if u: return False
    except Exception: pass
    return True

async def main():
    if not USER or not PWD:
        print("⛔ IG_USERNAME/IG_PASSWORD ausentes no .env"); return 2
    os.makedirs(PROFILE, exist_ok=True); os.makedirs(SHOT, exist_ok=True)
    kw = {"user_data_dir": PROFILE,
          "headless": (env("IG_HEADLESS", "false") or "").lower() in ("1","true","yes","sim")}
    chrome = (env("IG_CHROME") or "").strip()
    if chrome: kw["browser_executable_path"] = chrome
    args = [a for a in (env("IG_CHROME_ARGS","") or "").split() if a]
    if args: kw["browser_args"] = args
    browser = await uc.start(**kw)
    try:
        tab = await browser.get("https://www.instagram.com/accounts/login/")
        await sleep(8)
        await tab.save_screenshot(os.path.join(SHOT, "1_inicio.png"), format="png")
        # cookies (se houver banner)
        await click_texto(tab, ["Allow all cookies","Permitir todos os cookies","Only allow essential cookies","Permitir cookies essenciais"])
        await sleep(1)
        # localizar campo username (timeout generoso + fallbacks); só consideramos
        # "já logado" se o form NÃO aparecer mesmo após espera.
        u = p = None
        for sel in ['input[name="username"]', 'input[aria-label*="user" i]', 'input[autocomplete="username"]', 'input[type="text"]']:
            try:
                u = await tab.select(sel, timeout=8)
                if u: break
            except Exception: u = None
        if not u:
            print("✅ form de login ausente — provavelmente já logado.")
            await tab.save_screenshot(os.path.join(SHOT, "9_ok.png"), format="png"); return 0
        try:
            p = await tab.select('input[name="password"]', timeout=8) or await tab.select('input[type="password"]', timeout=4)
        except Exception:
            print("⛔ achei username mas não a senha."); await tab.save_screenshot(os.path.join(SHOT,"err_sem_senha.png"),format="png"); return 3
        await u.send_keys(USER); await sleep(1)
        await p.send_keys(PWD);  await sleep(1)
        await tab.save_screenshot(os.path.join(SHOT, "2_preenchido.png"), format="png")
        # submit
        clic = await click_texto(tab, ["Log in","Entrar"])
        if not clic:
            try:
                btn = await tab.select('button[type="submit"]', timeout=4)
                if btn: await btn.click()
            except Exception: pass
        await sleep(9)
        await tab.save_screenshot(os.path.join(SHOT, "3_pos_submit.png"), format="png")
        # reCAPTCHA "I'm not a robot": tenta clicar o checkbox (passa no clique simples
        # se a reputação do IP estiver ok). O checkbox fica ~30px da borda esq. do iframe.
        for tent in range(2):
            try:
                fr = await tab.select('iframe[title*="recaptcha" i]', timeout=3) or await tab.select('iframe[src*="recaptcha"]', timeout=3)
            except Exception: fr = None
            if not fr: break
            print(f"🤖 reCAPTCHA detectado — clicando checkbox (tent {tent+1})", flush=True)
            try:
                pos = await fr.get_position()
                ax = getattr(pos, "abs_x", None) or getattr(pos, "x", 0)
                ay = getattr(pos, "abs_y", None) or getattr(pos, "y", 0)
                h = getattr(pos, "height", 78) or 78
                cx, cy = float(ax) + 30.0, float(ay) + float(h) / 2.0
                await tab.send(uc.cdp.input_.dispatch_mouse_event(type_="mouseMoved", x=cx, y=cy))
                await sleep(rand(0.2, 0.6))
                await tab.send(uc.cdp.input_.dispatch_mouse_event(type_="mousePressed", x=cx, y=cy, button=uc.cdp.input_.MouseButton.LEFT, click_count=1))
                await sleep(rand(0.05, 0.15))
                await tab.send(uc.cdp.input_.dispatch_mouse_event(type_="mouseReleased", x=cx, y=cy, button=uc.cdp.input_.MouseButton.LEFT, click_count=1))
            except Exception as e:
                print("   erro clique recaptcha:", str(e)[:80], flush=True)
            await sleep(rand(4, 7))
            await tab.save_screenshot(os.path.join(SHOT, f"3b_pos_captcha_{tent}.png"), format="png")
            # se sumiu o iframe e há sessão, segue
            try:
                ainda = await tab.select('iframe[title*="recaptcha" i]', timeout=2)
            except Exception: ainda = None
            if not ainda:
                # tenta confirmar/continuar se houver botão
                await click_texto(tab, ["Confirm","Continuar","Continue","Next"])
                await sleep(4)
                break
        # erros/checkpoint conhecidos
        body = ""
        try: body = (await tab.evaluate("document.body.innerText") or "").lower()
        except Exception: pass
        for sinal, msg in [
            ("incorrect", "senha/usuario incorretos"),
            ("was incorrect", "senha incorreta"),
            ("try again later", "rate-limit / try again later"),
            ("wait a few minutes", "rate-limit (espere alguns minutos)"),
            ("suspended", "conta suspensa"),
            ("we detected", "checkpoint de seguranca (detectamos atividade incomum)"),
            ("confirm it", "checkpoint: confirme que e voce"),
            ("security code", "2FA: codigo de seguranca exigido"),
            ("enter the code", "2FA: digite o codigo"),
            ("verification code", "2FA: codigo de verificacao"),
        ]:
            if sinal in body:
                print(f"⛔ LOGIN BLOQUEADO: {msg}")
                await tab.save_screenshot(os.path.join(SHOT, "block.png"), format="png")
                return 4
        # diálogos pós-login
        await click_texto(tab, ["Not now","Agora não","Not Now"])  # salvar login
        await sleep(2)
        await click_texto(tab, ["Not Now","Agora não","Not now"])  # notificações
        await sleep(2)
        tab2 = await browser.get("https://www.instagram.com/")
        await sleep(7)
        await tab2.save_screenshot(os.path.join(SHOT, "4_home.png"), format="png")
        # confirma por COOKIE de sessão (sinal real), não por DOM
        tem_sessao = False
        try:
            cks = await browser.cookies.get_all()
            tem_sessao = any(getattr(c, "name", "") == "sessionid" and "instagram" in (getattr(c, "domain", "") or "") for c in cks)
        except Exception: pass
        if tem_sessao or await logado(tab2):
            print("✅ LOGADO — sessionid=%s — sessão persistida em %s" % (tem_sessao, PROFILE))
            return 0
        print("⚠️ não confirmei login (ver shots em", SHOT, ")")
        return 5
    finally:
        try: browser.stop()
        except Exception: pass

if __name__ == "__main__":
    garantir_somente_desktop()
    sys.exit(uc.loop().run_until_complete(main()) or 0)
