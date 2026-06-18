#!/usr/bin/env python3
# DEPURAÇÃO OFFLINE — roda na VM, NÃO toca o Instagram.
# Lê os SCREENSHOTS que o desktop tirou (Syncthing trouxe), manda pro Gemini
# (visão) e extrai os @usernames de quem curtiu — FORA da página do IG, sem pedir
# nada ao site. Gera likers.json + posts-meta.json no LIKERS_OUT_DIR, que o
# importador (scripts/import-likers-sync.ts) já lê e joga no site.
#
# Provider plugável (GEMINI_PROVIDER):
#   apikey     (default) -> generativelanguage + ?key=GEMINI_API_KEY, modelo gemini-2.5-flash (free tier cobre o volume)
#   oauth                -> Authorization: Bearer (assinatura Gemini Plus via OAuth/Code Assist), modelo gemini-2.5-pro
#   openrouter           -> fallback automático se o Gemini falhar (chave OPENROUTER_API_KEY)
#
# Uso:  LIKERS_SHOTS_DIR=~/likers-sync/captura/shots python3 parse/parse_likers.py
import os, sys, json, re, base64, time, glob, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
def load_env(p):
    try:
        for ln in open(p, encoding="utf-8"):
            m = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$', ln, re.I)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    except Exception: pass
for p in ["/home/ubuntu/polimonitor/.env", os.path.join(HERE, "..", ".env"), os.path.join(HERE, "..", "likers-sync", ".env")]:
    load_env(p)

SHOTS = os.path.expanduser(os.environ.get("LIKERS_SHOTS_DIR") or os.path.join(HERE, "..", "captura", "shots"))
OUT   = os.path.expanduser(os.environ.get("LIKERS_OUT_DIR") or os.path.join(HERE, "..", "likers-sync"))
PROVIDER = (os.environ.get("GEMINI_PROVIDER") or "apikey").lower()
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
OAUTH = os.environ.get("GEMINI_OAUTH_TOKEN") or (open(os.environ["GEMINI_OAUTH_TOKEN_FILE"]).read().strip() if os.environ.get("GEMINI_OAUTH_TOKEN_FILE") and os.path.exists(os.environ.get("GEMINI_OAUTH_TOKEN_FILE","")) else "")
OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY", "")
MODEL = os.environ.get("GEMINI_MODEL") or ("gemini-2.5-pro" if PROVIDER == "oauth" else "gemini-2.5-flash")
ENDPOINT = os.environ.get("GEMINI_ENDPOINT") or "https://generativelanguage.googleapis.com/v1beta"
BATCH = max(1, int(os.environ.get("PARSE_BATCH", "4")))  # imagens por requisição

NAO_USER = {"explore","reels","reel","direct","accounts","p","stories","about","legal","privacy","tv","emails","instagram"}

PROMPT_LIKERS = (
 "Estas são capturas de tela da lista de CURTIDORES (pessoas que curtiram um post) do Instagram. "
 "Extraia TODOS os nomes de usuário DISTINTOS visíveis — o @handle (identificador em negrito, minúsculo, "
 "pode ter ponto e underscore), NÃO o nome de exibição. IGNORE: o cabeçalho da conta logada, o título do modal "
 "('Curtidas'/'Likes'), e os botões 'Seguir'/'Seguindo'/'Following'. "
 'Responda SÓ JSON: {"usernames": ["user_um","user_dois"]}'
)
_HOJE = time.strftime("%Y-%m-%d")
PROMPT_META = (
 "Captura de tela de um post do Instagram. Extraia os metadados do post. "
 'Responda SÓ JSON: {"author":"@perfil","date_iso":"YYYY-MM-DD","caption":"texto","like_count_text":"123 curtidas"}. '
 f"HOJE é {_HOJE}. O Instagram mostra a data de forma RELATIVA ('há 2 dias', '3 sem', 'ontem', '5 d'); "
 f"CALCULE a data absoluta a partir de HOJE ({_HOJE}) e devolva em date_iso (YYYY-MM-DD). Se nao houver data visivel, date_iso vazio."
)

def b64(path):
    with open(path, "rb") as f: return base64.b64encode(f.read()).decode()

def _json_do_texto(txt):
    # Extracao ROBUSTA: tira cerca ```json, tenta json.loads; se falhar (o fallback
    # OpenRouter costuma vir com prosa antes/depois), pega o primeiro bloco {...}.
    s = re.sub(r'^```(?:json)?|```$', '', (txt or "").strip(), flags=re.M).strip()
    try:
        return json.loads(s)
    except Exception:
        m = re.search(r'\{.*\}', s, re.S)
        if not m: raise
        return json.loads(m.group(0))

def http_json(url, body, headers, tries=3):
    data = json.dumps(body).encode()
    last = None
    for t in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **headers})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode()[:200]}"
            if e.code in (429, 500, 503): time.sleep(2 ** t + 1); continue
            break
        except Exception as e:
            last = str(e); time.sleep(2 ** t); continue
    raise RuntimeError(last or "falha http")

def gemini_vision(prompt, image_paths):
    parts = [{"text": prompt}] + [{"inline_data": {"mime_type": "image/png", "data": b64(p)}} for p in image_paths]
    body = {"contents": [{"parts": parts}], "generationConfig": {"response_mime_type": "application/json", "temperature": 0}}
    if PROVIDER == "oauth" and OAUTH:
        url = f"{ENDPOINT}/models/{MODEL}:generateContent"
        headers = {"Authorization": f"Bearer {OAUTH}"}
    else:
        url = f"{ENDPOINT}/models/{MODEL}:generateContent?key={GEMINI_KEY}"
        headers = {}
    resp = http_json(url, body, headers)
    txt = resp["candidates"][0]["content"]["parts"][0]["text"]
    return _json_do_texto(txt)

def openrouter_vision(prompt, image_paths):
    content = [{"type": "text", "text": prompt}]
    for p in image_paths:
        content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64(p)}"}})
    body = {"model": os.environ.get("OPENROUTER_VISION_MODEL", "qwen/qwen2.5-vl-72b-instruct:free"),
            "messages": [{"role": "user", "content": content}], "temperature": 0}
    resp = http_json("https://openrouter.ai/api/v1/chat/completions", body,
                     {"Authorization": f"Bearer {OPENROUTER_KEY}"})
    txt = resp["choices"][0]["message"]["content"]
    return _json_do_texto(txt)

def visao(prompt, image_paths):
    try:
        return gemini_vision(prompt, image_paths)
    except Exception as e:
        print(f"   ⚠️ Gemini falhou ({str(e)[:120]})", file=sys.stderr)
        if OPENROUTER_KEY:
            print("   ↳ fallback OpenRouter visão (grátis)", file=sys.stderr)
            return openrouter_vision(prompt, image_paths)
        raise

def limpa_user(u):
    u = (u or "").strip().lstrip("@").strip().lower()
    return u if re.match(r'^[a-z0-9._]{1,30}$', u) and u not in NAO_USER else None

def primeiras_palavras(t, n=5):
    palavras = " ".join((t or "").split()).split(" ")
    return " ".join([p for p in palavras if p][:n])

def main():
    if not os.path.isdir(SHOTS): print(f"⛔ sem pasta de prints: {SHOTS}"); return
    contagem, por_post, post_meta = {}, {}, {}
    suspeitas = []
    for target in sorted(os.listdir(SHOTS)):
        tdir = os.path.join(SHOTS, target)
        if not os.path.isdir(tdir): continue
        for code in sorted(os.listdir(tdir)):
            d = os.path.join(tdir, code)
            man_p = os.path.join(d, "manifest.json")
            if not os.path.exists(man_p): continue
            man = json.load(open(man_p))
            like_shots = sorted(glob.glob(os.path.join(d, "likes_*.png")))
            post_shots = sorted(glob.glob(os.path.join(d, "post_*.png")))
            print(f"• @{target}/{code}: {len(like_shots)} prints de curtidas, {len(post_shots)} do post")

            # 1) usernames (em lotes p/ não estourar payload)
            users = set()
            for i in range(0, len(like_shots), BATCH):
                lote = like_shots[i:i+BATCH]
                try:
                    r = visao(PROMPT_LIKERS, lote)
                    for u in (r.get("usernames") or []):
                        cu = limpa_user(u)
                        if cu: users.add(cu)
                except Exception as e:
                    print(f"   ⚠️ lote {i//BATCH} falhou: {str(e)[:120]}", file=sys.stderr)
            # 2) metadados do post
            meta = {}
            if post_shots:
                try: meta = visao(PROMPT_META, post_shots[:1])
                except Exception: meta = {}
            taken_at = 0
            if meta.get("date_iso"):
                try: taken_at = int(time.mktime(time.strptime(meta["date_iso"][:10], "%Y-%m-%d")))
                except Exception: taken_at = 0

            # bloqueio? modal abriu mas 0 usernames = provável "0 curtidores" falso (sinal de bloqueio)
            if man.get("modalAbriu") and not users:
                suspeitas.append(code)
                print(f"   ⚠️ modal abriu mas 0 usernames — possível BLOQUEIO/print vazio (auditar {d}/)")

            por_post[code] = sorted(users)
            for u in users: contagem[u] = contagem.get(u, 0) + 1
            post_meta[code] = {
                "code": code, "url": man.get("url", f"https://www.instagram.com/p/{code}/"),
                "legenda": primeiras_palavras(meta.get("caption", "")), "taken_at": taken_at,
                "curtidas": len(users), "engine": man.get("engine"),
                "suspeita_bloqueio": man.get("modalAbriu") and not users,
            }

    ranking = sorted([{"username": u, "curtidas": c} for u, c in contagem.items()], key=lambda x: -x["curtidas"])
    os.makedirs(OUT, exist_ok=True)
    json.dump(ranking, open(os.path.join(OUT, "likers.json"), "w"), indent=2, ensure_ascii=False)
    _cell = lambda s: '"' + str(s).replace('"', '""') + '"'
    open(os.path.join(OUT, "likers.csv"), "w").write("username,curtidas\n" + "\n".join(f"{_cell(r['username'])},{r['curtidas']}" for r in ranking))
    json.dump(sorted(post_meta.values(), key=lambda m: -(m["taken_at"] or 0)), open(os.path.join(OUT, "posts-meta.json"), "w"), indent=2, ensure_ascii=False)
    json.dump(por_post, open(os.path.join(OUT, "posts-curtidores.json"), "w"), indent=2, ensure_ascii=False)
    print(f"\n✅ {len(ranking)} curtidores distintos · {len(post_meta)} posts · provider={PROVIDER}/{MODEL}")
    if suspeitas: print(f"⚠️ {len(suspeitas)} post(s) com modal aberto e 0 curtidores (possível bloqueio): {', '.join(suspeitas[:10])}")
    print(f"   gravado em {OUT}/likers.json → o cron de import joga no site em ≤5min")

if __name__ == "__main__":
    main()
