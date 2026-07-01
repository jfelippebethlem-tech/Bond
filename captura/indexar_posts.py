#!/usr/bin/env python3
# Indexa TODOS os posts do Instagram Business via Graph API (Meta): permalink, like_count,
# timestamp, caption. Pagina ate o fim. Saida: posts-index.json + resumo (incl. candidatos
# <99 curtidas p/ validar a captura, e os posts das ultimas 2 semanas).
import os, re, json, ssl, urllib.request, urllib.error, datetime

ENV = os.environ.get("HERMES_KEYS_ENV", r"C:\Users\socah\jfn\hermes-migracao\TODAS-as-chaves.env")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "posts-index.json")
GRAPH = "https://graph.facebook.com/v21.0"
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"

def load_env(p):
    d = {}
    for ln in open(p, encoding="utf-8", errors="replace"):
        m = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$', ln)
        if m: d[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return d
E = load_env(ENV) if os.path.exists(ENV) else {}
# Aceita as chaves do ARQUIVO ou do AMBIENTE (o poller já injeta o env com os tokens) — assim o
# reindex automático roda mesmo se o caminho do arquivo mudar de máquina. Falha honesta se faltar.
TOKEN = E.get("FACEBOOK_PAGE_TOKEN") or os.environ.get("FACEBOOK_PAGE_TOKEN")
IGID  = E.get("INSTAGRAM_BUSINESS_ID") or os.environ.get("INSTAGRAM_BUSINESS_ID")
if not TOKEN or not IGID:
    raise SystemExit("indexar_posts: faltam FACEBOOK_PAGE_TOKEN / INSTAGRAM_BUSINESS_ID (arquivo de chaves ou env)")

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=40, context=CTX) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return {"error": json.loads(e.read().decode("utf-8", "replace")).get("error", {})}

fields = "id,permalink,timestamp,like_count,comments_count,media_type,caption"
url = f"{GRAPH}/{IGID}/media?fields={fields}&limit=100&access_token={TOKEN}"
posts = []; pages = 0
while url:
    d = get(url)
    if "error" in d and d["error"]:
        print("ERRO Graph API:", d["error"].get("message", d["error"])); break
    for p in d.get("data", []):
        code = ""
        m = re.search(r'/(?:p|reel|tv)/([^/]+)/', p.get("permalink", ""))
        if m: code = m.group(1)
        cap = (p.get("caption") or "").replace("\n", " ")
        posts.append({
            "code": code, "id": p.get("id"), "permalink": p.get("permalink"),
            "timestamp": p.get("timestamp"), "like_count": p.get("like_count", 0),
            "comments_count": p.get("comments_count", 0), "media_type": p.get("media_type"),
            "caption_inicio": cap[:80],
        })
    pages += 1
    url = d.get("paging", {}).get("next")
    if pages > 50: break  # guarda

posts.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
json.dump({"ig_id": IGID, "total": len(posts), "posts": posts}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print(f"=== INDICE: {len(posts)} posts em {pages} pagina(s) -> {OUT} ===")
if posts:
    ts = [p["timestamp"] for p in posts if p["timestamp"]]
    print(f"range: {ts[-1]} (mais antigo)  ->  {ts[0]} (mais recente)")
    likes = [p["like_count"] for p in posts]
    print(f"like_count: min={min(likes)} max={max(likes)} media={sum(likes)//len(likes)}")
    sub99 = [p for p in posts if p["like_count"] < 99]
    print(f"posts com <99 curtidas (candidatos a validacao exata): {len(sub99)}")
    for p in sub99[:8]:
        print(f"   {p['code']:<14} {p['like_count']:>4} curt  {p['timestamp'][:10]}  {p['caption_inicio'][:40]}")
    # ultimas 2 semanas
    hoje = datetime.datetime.now(datetime.timezone.utc)
    lim = hoje - datetime.timedelta(days=14)
    rec = [p for p in posts if p["timestamp"] and datetime.datetime.fromisoformat(p["timestamp"].replace("+0000","+00:00")) >= lim]
    print(f"\nposts das ultimas 2 semanas: {len(rec)}")
    for p in rec:
        print(f"   {p['code']:<14} {p['like_count']:>5} curt  {p['timestamp'][:10]}  {p['caption_inicio'][:45]}")
