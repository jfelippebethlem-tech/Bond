// CAPTURA "QUEM CURTIU" — RODA SÓ NO DESKTOP (IP residencial). NUNCA na VM.
//
// Usa um PERFIL DE NAVEGADOR DEDICADO (IG_PROFILE_DIR): voce loga no Instagram
// UMA vez nele e a sessao fica salva + se renova sozinha. Sem copiar cookie.
// Metodo de captura: in-page (API interna do IG) = ban-safe. RESUMÍVEL.
//
// Status: escreve likers-status.json na pasta sincronizada -> a VM le e te AVISA
// no Telegram se precisar logar de novo.
//
// .env LOCAL (desktop): IG_CAPTURE_LOCAL=true, IG_NUM_POSTS=30,
//   LIKERS_OUT_DIR=C:\jfn\likers-sync, IG_PROFILE_DIR=C:\jfn\ig-profile,
//   IG_INTERACTIVE=true (quando rodado por voce, pra poder logar)
//
// REPLICA O InstagramLikesLeaderboard (adaptado p/ desktop/Playwright):
//   - leaderboard com % de engajamento (curtidas/total posts) + rank
//   - abas: quem voce segue x quem nao segue (following / not_following)
//   - atribuicao por post (quem curtiu QUAL post) + perfis ricos
//   - followers + following + analise: dont_follow_back / not_following_back /
//     mutual / ghost (seguidores que nunca curtiram)
// Flags opcionais no .env:
//   IG_COLLECT_FOLLOWERS=false  -> nao coleta seguidores (menos chamadas)
//   IG_COLLECT_FOLLOWING=false  -> nao coleta quem voce segue
//   IG_FOLLOW_LIMIT=2000        -> teto de seguidores/seguindo (0 = todos)
// Saidas em LIKERS_OUT_DIR: likers.json (compat), likers.csv, leaderboard.csv,
//   likers-detalhado.json, posts-curtidores.json, followers.json, following.json,
//   leaderboard-seguindo.json, leaderboard-nao-seguindo.json, follower-analysis.json
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'

if (process.env.IG_CAPTURE_LOCAL !== 'true') {
  console.error('⛔ Recusado. IG_CAPTURE_LOCAL=true so no .env do DESKTOP. NUNCA na VM (IP datacenter = ban).')
  process.exit(1)
}
const NUM_POSTS = Math.max(1, parseInt(process.env.IG_NUM_POSTS || '30', 10))
const OUT = process.env.LIKERS_OUT_DIR || '.'
const PROFILE = process.env.IG_PROFILE_DIR || path.join(process.cwd(), 'ig-profile')
const INTERATIVO = process.env.IG_INTERACTIVE === 'true'
const STATE_FILE = path.join(process.cwd(), 'likers-state.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = (a, b) => a + Math.random() * (b - a)
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return null } }
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s))

function escreverStatus(ok, erro) {
  try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'likers-status.json'), JSON.stringify({ ok, erro: erro || null, quando: new Date().toISOString() })) } catch {}
}
// Escreve TODAS as saidas a partir do state, replicando o InstagramLikesLeaderboard:
// leaderboard com % de engajamento + rank, abas following/nao-seguindo, e a
// analise de seguidores (dont_follow_back / not_following_back / mutual / ghost).
// likers.json/.csv mantem o formato antigo (compat com o importador da VM).
function gravarTudo(state) {
  fs.mkdirSync(OUT, { recursive: true })
  const contagem = state.contagem || {}
  const perfis = state.perfis || {}
  const followers = state.followers || []
  const following = state.following || []
  const porPost = state.porPost || {}
  const totalPosts = (state.done || []).length || Object.keys(porPost).length || 0

  // mapa unificado de perfis (curtidores + followers + following)
  const prof = {}
  const merge = (u) => { if (u && u.username) prof[u.username] = { ...(prof[u.username] || {}), ...u } }
  for (const un of Object.keys(perfis)) merge({ username: un, ...perfis[un] })
  for (const u of followers) merge(u)
  for (const u of following) merge(u)
  const P = (un) => prof[un] || { username: un }

  const followerSet = new Set(followers.map((u) => u.username))
  const followingSet = new Set(following.map((u) => u.username))
  const likerSet = new Set(Object.keys(contagem))

  // 1) compat: ranking simples [{username,curtidas}] (importador da VM)
  const ranking = Object.entries(contagem).map(([username, curtidas]) => ({ username, curtidas })).sort((a, b) => b.curtidas - a.curtidas)
  fs.writeFileSync(path.join(OUT, 'likers.json'), JSON.stringify(ranking, null, 2))
  fs.writeFileSync(path.join(OUT, 'likers.csv'), 'username,curtidas\n' + ranking.map((r) => `${r.username},${r.curtidas}`).join('\n'))

  // 2) atribuicao por post + inverso (user -> posts)
  fs.writeFileSync(path.join(OUT, 'posts-curtidores.json'), JSON.stringify(porPost, null, 2))
  const userPosts = {}
  for (const [code, us] of Object.entries(porPost)) for (const u of us) (userPosts[u] = userPosts[u] || []).push(code)

  // 3) leaderboard detalhado (igual ao original: % engajamento + rank)
  const pct = (c) => totalPosts ? Math.round((c / totalPosts) * 1000) / 10 : 0
  const mkEntry = (username, likesCount) => {
    const p = P(username)
    return { rank: 0, username, full_name: p.full_name || '', is_verified: !!p.is_verified, is_private: !!p.is_private, pk: p.pk || '', likesCount, totalPosts, percentage: pct(likesCount), te_segue: followerSet.has(username), voce_segue: followingSet.has(username), posts_curtidos: userPosts[username] || [] }
  }
  const detalhado = ranking.map((r) => mkEntry(r.username, r.curtidas))
  detalhado.forEach((e, i) => { e.rank = i + 1 })
  fs.writeFileSync(path.join(OUT, 'likers-detalhado.json'), JSON.stringify(detalhado, null, 2))

  // 4) listas brutas
  if (state.followers) fs.writeFileSync(path.join(OUT, 'followers.json'), JSON.stringify(followers, null, 2))
  if (state.following) fs.writeFileSync(path.join(OUT, 'following.json'), JSON.stringify(following, null, 2))

  // 5) abas do leaderboard + analise de seguidores (so com as listas)
  if (state.followers || state.following) {
    // aba "following": quem voce segue (inclui os que NUNCA curtiram = 0 likes)
    const seguindoTab = following.map((u) => mkEntry(u.username, contagem[u.username] || 0)).sort((a, b) => b.likesCount - a.likesCount)
    seguindoTab.forEach((e, i) => { e.rank = i + 1 })
    // aba "nao seguindo": curtidores que voce NAO segue
    const naoSeguindoTab = detalhado.filter((e) => !followingSet.has(e.username))
    naoSeguindoTab.forEach((e, i) => { e.rank = i + 1 })
    fs.writeFileSync(path.join(OUT, 'leaderboard-seguindo.json'), JSON.stringify(seguindoTab, null, 2))
    fs.writeFileSync(path.join(OUT, 'leaderboard-nao-seguindo.json'), JSON.stringify(naoSeguindoTab, null, 2))

    // analise de seguidores — 4 categorias EXATAS do original
    const lst = (uns) => uns.map((un) => P(un))
    const analise = {
      gerado_em: new Date().toISOString(),
      dont_follow_back: lst(following.map((u) => u.username).filter((un) => !followerSet.has(un))),   // vc segue, nao te seguem
      not_following_back: lst(followers.map((u) => u.username).filter((un) => !followingSet.has(un))), // te seguem, vc nao segue
      mutual: lst(following.map((u) => u.username).filter((un) => followerSet.has(un))),               // mutuo
      ghost: lst(followers.map((u) => u.username).filter((un) => !likerSet.has(un))),                  // te seguem, nunca curtiram
    }
    fs.writeFileSync(path.join(OUT, 'follower-analysis.json'), JSON.stringify(analise, null, 2))

    // CSV rico (colunas do original + relacao)
    const esc = (s) => `"${String(s || '').replace(/"/g, '""')}"`
    const csv = 'Rank,Username,Full Name,Likes,Total Posts,Percentage,Voce_segue,Te_segue\n' +
      detalhado.map((e) => `${e.rank},${esc(e.username)},${esc(e.full_name)},${e.likesCount},${e.totalPosts},${e.percentage}%,${e.voce_segue},${e.te_segue}`).join('\n')
    fs.writeFileSync(path.join(OUT, 'leaderboard.csv'), csv)
  }
  return ranking
}
async function dsUserIdDo(ctx) {
  const cookies = await ctx.cookies('https://www.instagram.com')
  return (cookies.find((c) => c.name === 'ds_user_id') || {}).value
}
// Logado = NÃO tem formulário de login E tem cookie de sessão.
async function estaLogado(page) {
  try {
    const form = await page.$('input[name="username"], input[name="password"]')
    if (form) return false
    const c = await page.context().cookies('https://www.instagram.com')
    return !!(c.find((x) => x.name === 'sessionid' && x.value) && c.find((x) => x.name === 'ds_user_id' && x.value))
  } catch { return false }
}

// Chamadas via context.request (HTTP com a sessao do perfil) — robusto, sem
// depender da pagina (evita "Execution context destroyed" quando o IG navega).
async function igHeaders(ctx) {
  const c = await ctx.cookies('https://www.instagram.com')
  const csrf = (c.find((x) => x.name === 'csrftoken') || {}).value || ''
  return { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest', 'x-csrftoken': csrf }
}
async function getPostIds(ctx, dsUserId, numPosts) {
  const headers = await igHeaders(ctx)
  const ids = []; let maxId = null
  while (ids.length < numPosts) {
    let url = `https://www.instagram.com/api/v1/feed/user/${dsUserId}/?count=33`
    if (maxId) url += `&max_id=${maxId}`
    const r = await ctx.request.get(url, { headers })
    if (!r.ok()) break
    const d = await r.json()
    for (const it of (d.items || [])) ids.push({ pk: String(it.pk || it.id), code: it.code || null, taken_at: it.taken_at || 0 })
    if (!d.more_available || !d.next_max_id) break
    maxId = d.next_max_id
    await sleep(rand(2000, 4000))
  }
  return ids.slice(0, numPosts)
}
// Likers: fetch DENTRO da pagina (autenticado, com Referer/sec-fetch same-origin
// que o IG exige nesse endpoint). O ctx.request cai no roteador HTML do app.
// A pagina fica parada numa URL estavel (nunca damos page.goto durante o loop),
// entao nao ha "Execution context destroyed".
// Metodo ORIGINAL (ctx.request) — mantido pra comparacao lado a lado.
async function likersViaRequest(ctx, pid) {
  const headers = await igHeaders(ctx)
  const r = await ctx.request.get(`https://www.instagram.com/api/v1/media/${pid}/likers/`, { headers })
  const ct = r.headers()['content-type'] || ''
  return { status: r.status(), ct, ok: ct.includes('json') }
}
async function getLikers(page, pid) {
  if (process.env.IG_COMPARE === 'true') {
    const viaReq = await likersViaRequest(page.context(), pid)
    console.log('  [COMPARA] ctx.request -> status', viaReq.status, 'ct', viaReq.ct, viaReq.ok ? 'JSON✅' : 'HTML/erro❌')
  }
  const out = await page.evaluate(async (pid) => {
    try {
      const resp = await fetch(`https://www.instagram.com/api/v1/media/${pid}/likers/`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' },
      })
      const ct = resp.headers.get('content-type') || ''
      const text = await resp.text()
      return { status: resp.status, ct, text }
    } catch (e) {
      return { status: -1, ct: '', text: String(e && e.message || e) }
    }
  }, pid)
  if (out.status === 429) return { rateLimited: true }
  if (process.env.IG_DEBUG === 'true' || process.env.IG_COMPARE === 'true') {
    console.log('  [COMPARA] in-page fetch -> status', out.status, 'ct', out.ct, out.ct.includes('json') ? 'JSON✅' : 'HTML/erro❌')
  }
  if (out.status !== 200 || !out.ct.includes('json')) return { error: out.status + '_' + (out.ct || 'nohdr').split(';')[0] }
  try {
    const d = JSON.parse(out.text)
    return { users: (d.users || []).map((u) => u.username).filter(Boolean) }
  } catch { return { error: 'parse' } }
}

// MÉTODO ROBUSTO: a propria pagina (autenticada) dispara o /graphql/query de
// curtidores quando abrimos o modal "liked_by" — nos ESCUTAMOS a resposta JSON
// e lemos os usernames. Fallback: scrape do DOM do modal. Imune a endpoint REST
// morto e nao precisa forjar tokens (fb_dtsg/lsd) do GraphQL.
const NAO_USER = new Set(['explore', 'reels', 'reel', 'direct', 'accounts', 'p', 'stories', 'about', 'legal', 'privacy', 'tv', 'emails'])
// Caminha o JSON e coleta PERFIS ricos (nao so username): full_name, verificado,
// privado, pk. Alimenta um Map username->perfil (mescla campos quando reaparece).
function coletarUsuarios(json, mapa) {
  const pilha = [json]
  while (pilha.length) {
    const n = pilha.pop()
    if (n && typeof n === 'object') {
      if (typeof n.username === 'string' && n.username && !NAO_USER.has(n.username)) {
        const p = mapa.get(n.username) || { username: n.username }
        if (n.full_name != null) p.full_name = n.full_name
        if (n.is_verified != null) p.is_verified = !!n.is_verified
        if (n.is_private != null) p.is_private = !!n.is_private
        if (n.pk != null || n.id != null) p.pk = String(n.pk || n.id)
        mapa.set(n.username, p)
      }
      for (const k in n) { const v = n[k]; if (v && typeof v === 'object') pilha.push(v) }
    }
  }
}
async function getLikersDOM(page, code) {
  if (!code) return { error: 'sem_code' }
  const apiMap = new Map() // username -> perfil rico (vindo do /graphql/query)
  let capturas = 0
  let escutandoLikers = false // so coleta DEPOIS de abrir o modal (evita comentaristas)
  const onResp = async (resp) => {
    if (!escutandoLikers) return
    const u = resp.url()
    if (!/graphql\/query|\/likers\b|liked_by/i.test(u)) return
    const ct = resp.headers()['content-type'] || ''
    if (!ct.includes('json')) return
    try { const j = await resp.json(); capturas++; coletarUsuarios(j, apiMap) } catch {}
  }
  // 1) Listener anexado ANTES do goto (como no sniffer #3, que capturou o GraphQL).
  //    Na #5 o listener foi anexado depois do goto e nao capturou nada.
  page.on('response', onResp)
  await page.goto(`https://www.instagram.com/p/${code}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(rand(2500, 4000))
  // 2) Liga a coleta e abre os curtidores (clique no link de curtidas, como no sniffer)
  escutandoLikers = true
  let abriu = false
  try {
    const link = await page.$('a[href*="liked_by"]')
    if (link) { await link.click().catch(() => {}); abriu = true }
  } catch {}
  if (!abriu) { try { await page.goto(`https://www.instagram.com/p/${code}/liked_by/`, { waitUntil: 'domcontentloaded' }) } catch {} }
  await page.waitForTimeout(rand(2500, 3800))
  // 3) rola o modal/lista pra paginar (dispara mais /graphql/query) e coleta DOM.
  //    Persistente: o jump-to-bottom sozinho as vezes nao dispara o lazy-load, entao
  //    tambem damos scrollIntoView no ultimo item + evento scroll. Paciencia maior
  //    (estavel<8) pra nao cortar listas grandes (posts com milhares de curtidas).
  const viaDom = new Set()
  let prev = -1, estavel = 0
  const MAX_IT = Math.max(20, parseInt(process.env.IG_SCROLL_MAX || '200', 10))
  for (let i = 0; i < MAX_IT && estavel < 8; i++) {
    // SO raspa dentro do modal (role=dialog) — nunca a pagina inteira (evita
    // pegar dono/comentaristas). Se nao ha modal, viaDom fica vazio e usamos a API.
    const domU = await page.evaluate(() => {
      const dlg = document.querySelector('div[role="dialog"]')
      if (!dlg) return []
      const out = []
      for (const a of dlg.querySelectorAll('a[href^="/"]')) {
        const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9._]+)\/$/)
        if (m) out.push(m[1])
      }
      return out
    }).catch(() => [])
    domU.forEach((x) => { if (!NAO_USER.has(x)) viaDom.add(x) })
    await page.evaluate(() => {
      const dlg = document.querySelector('div[role="dialog"]')
      if (!dlg) return
      const sc = [...dlg.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 60)
      if (sc) { sc.scrollTop = sc.scrollHeight; sc.dispatchEvent(new Event('scroll', { bubbles: true })) }
      const links = dlg.querySelectorAll('a[href^="/"]')
      if (links.length) links[links.length - 1].scrollIntoView({ block: 'end' })
    }).catch(() => {})
    await page.waitForTimeout(rand(1200, 2200))
    const tot = apiMap.size + viaDom.size
    if (tot === prev) estavel++; else { estavel = 0; prev = tot }
  }
  page.off('response', onResp)
  // Uniao das duas fontes: DOM do modal (limpo) + API (perfis ricos). Cada
  // username vira um perfil; quando a API tem dados, usa-os; senao, so o nome.
  const todos = new Set([...viaDom, ...apiMap.keys()])
  NAO_USER.forEach((x) => todos.delete(x))
  if (process.env.IG_DEBUG === 'true') console.log(`    [DOM=${viaDom.size} API=${apiMap.size} graphqlCaps=${capturas}]`)
  if (!todos.size) return { error: 'sem_dialog' }
  const users = [...todos].map((un) => apiMap.get(un) || { username: un })
  return { users }
}

// METODO RAPIDO (igual ao original): 1 fetch REST /media/<pk>/likers/ DENTRO da
// pagina (autenticado). Volta todos os curtidores em JSON na hora, SEM navegar.
// Funciona com a conta saudavel; se vier HTML (throttle), caimos no modal.
async function likersREST(page, pid) {
  const out = await page.evaluate(async (pid) => {
    try {
      const r = await fetch(`https://www.instagram.com/api/v1/media/${pid}/likers/`, { credentials: 'include', headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' } })
      return { status: r.status, ct: r.headers.get('content-type') || '', text: await r.text() }
    } catch (e) { return { status: -1, ct: '', text: String(e && e.message || e) } }
  }, pid)
  if (out.status === 429) return { rateLimited: true }
  if (out.status !== 200 || !out.ct.includes('json')) return { html: true, status: out.status }
  try {
    const d = JSON.parse(out.text)
    const users = (d.users || []).filter((u) => u.username && !NAO_USER.has(u.username)).map((u) => ({ username: u.username, full_name: u.full_name || '', is_verified: !!u.is_verified, is_private: !!u.is_private, pk: String(u.pk || '') }))
    return { users }
  } catch { return { html: true } }
}
// Orquestra: REST rapido primeiro; modal (lento) so se REST falhar. Sinaliza
// restHtml quando o REST devolve HTML (sinal de bloqueio da Meta).
async function capturarLikers(page, pid, code) {
  const rest = await likersREST(page, pid)
  if (rest.rateLimited) return { rateLimited: true }
  if (rest.users) return { users: rest.users, fonte: 'rest' }
  const dom = await getLikersDOM(page, code) // caminho vivo (GraphQL/modal)
  if (dom.users && dom.users.length) return { users: dom.users, fonte: 'dom' }
  return { users: dom.users || [], error: dom.error || 'html', restHtml: !!rest.html, fonte: 'erro' }
}

// FOLLOWERS / FOLLOWING: fetch DENTRO da pagina (autenticado), endpoint
// /friendships/<id>/{followers|following}/?count=200, paginado por next_max_id.
// limite=0 => todos. reqCounter compartilhado pro cooldown global anti-ban.
async function coletarLista(page, dsUserId, tipo, limite, reqCounter) {
  const users = new Map()
  let maxId = null, pag = 0
  while (true) {
    let url = `https://www.instagram.com/api/v1/friendships/${dsUserId}/${tipo}/?count=200`
    if (maxId) url += `&max_id=${encodeURIComponent(maxId)}`
    const out = await page.evaluate(async (url) => {
      try {
        const resp = await fetch(url, { credentials: 'include', headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' } })
        const ct = resp.headers.get('content-type') || ''
        return { status: resp.status, ct, text: await resp.text() }
      } catch (e) { return { status: -1, ct: '', text: String(e && e.message || e) } }
    }, url)
    reqCounter.n++
    if (out.status === 429) { console.log(`  429 em ${tipo} — pausa 60s (estado salvo).`); await sleep(60000); continue }
    if (out.status !== 200 || !out.ct.includes('json')) { console.log(`  ${tipo}: resposta nao-JSON (${out.status} ${out.ct.split(';')[0]}) — parando aqui.`); break }
    let d; try { d = JSON.parse(out.text) } catch { break }
    for (const u of (d.users || [])) {
      if (!u.username || NAO_USER.has(u.username)) continue
      users.set(u.username, { username: u.username, full_name: u.full_name || '', is_verified: !!u.is_verified, is_private: !!u.is_private, pk: String(u.pk || '') })
    }
    pag++
    console.log(`  ${tipo}: ${users.size} coletados (pag ${pag})`)
    if (limite && users.size >= limite) break
    maxId = d.next_max_id
    if (!maxId) break
    await sleep(rand(3000, 8000)) // ritmo humano entre paginas
    // descanso longo aleatorio a cada ~10-15 paginas (varia)
    if (pag % (10 + Math.floor(rand(0, 6))) === 0) { const d = rand(30000, 80000); console.log(`  💤 descanso ${Math.round(d / 1000)}s (anti-bloqueio)...`); await sleep(d) }
  }
  return [...users.values()]
}

async function main() {
  fs.mkdirSync(PROFILE, { recursive: true })
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, locale: 'pt-BR', viewport: { width: 1280, height: 820 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  // Login: usa o perfil salvo; se preciso e interativo, espera voce logar.
  if (!(await estaLogado(page))) {
    if (INTERATIVO) {
      console.log('🔑 FACA LOGIN no Instagram na janela que abriu (usuario + senha + 2FA). Aguardando ate 5 min...')
      for (let i = 0; i < 30 && !(await estaLogado(page)); i++) await page.waitForTimeout(10000)
    }
    if (!(await estaLogado(page))) {
      console.log('⛔ Nao logado. Avisando pelo Telegram (a VM manda) e saindo.')
      escreverStatus(false, 'precisa_login') // a VM le isso e te avisa no Telegram
      await ctx.close(); process.exit(2)
    }
    console.log('✅ Login detectado! Seguindo com a captura...')
  }
  const dsUserId = await dsUserIdDo(ctx)
  if (!dsUserId) { escreverStatus(false, 'sem_ds_user_id'); await ctx.close(); process.exit(2) }

  // MODO SNIFFER: abre 1 post, abre o modal de curtidores e captura a requisicao
  // REAL (GraphQL/doc_id) que o app web usa. Acao de usuario normal = baixo risco.
  if (process.env.IG_SNIFF === 'true') {
    const headers = await igHeaders(ctx)
    const fr = await ctx.request.get(`https://www.instagram.com/api/v1/feed/user/${dsUserId}/?count=3`, { headers })
    const fd = await fr.json()
    const item = (fd.items || [])[0]
    const code = item && (item.code || item.pk)
    console.log('  [SNIFF] post code=', code, 'pk=', item && item.pk)
    const captura = []
    page.on('response', async (resp) => {
      const u = resp.url()
      if (/likers|liked_by|graphql/i.test(u)) {
        const ct = resp.headers()['content-type'] || ''
        let req = resp.request()
        let pd = null; try { pd = req.postData() } catch {}
        captura.push({ url: u.slice(0, 220), status: resp.status(), ct: ct.split(';')[0], docId: (pd && (pd.match(/doc_id=(\d+)/) || [])[1]) || (u.match(/doc_id=(\d+)/) || [])[1] || null, postData: pd ? pd.slice(0, 300) : null })
        console.log('  [SNIFF resp]', resp.status(), ct.split(';')[0], u.slice(0, 160))
      }
    })
    await page.goto(`https://www.instagram.com/p/${code}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    // tenta abrir os curtidores: link "liked_by" ou o botao de curtidas
    try {
      const link = await page.$(`a[href*="liked_by"]`)
      if (link) { await link.click() } else { await page.goto(`https://www.instagram.com/p/${code}/liked_by/`, { waitUntil: 'domcontentloaded' }) }
    } catch {}
    await page.waitForTimeout(5000)
    console.log('  [SNIFF] === requisicoes capturadas ===')
    console.log(JSON.stringify(captura, null, 2))
    fs.writeFileSync(path.join(process.cwd(), 'sniff-likers.json'), JSON.stringify(captura, null, 2))
    // Testa TAMBEM o scraper de DOM no mesmo post (prova que extrai usernames).
    console.log('  [SNIFF] === testando scraper de DOM ===')
    const dom = await getLikersDOM(page, code)
    console.log('  [SNIFF DOM] resultado:', dom.users ? `${dom.users.length} curtidores: ${dom.users.slice(0, 15).join(', ')}` : 'erro ' + dom.error)
    await ctx.close(); process.exit(0)
  }

  // Retoma ou inicia
  let state = loadState()
  if (state && Array.isArray(state.pending) && state.pending.length) {
    console.log(`↺ Retomando: ${state.done.length} feitos, ${state.pending.length} restantes.`)
  } else {
    // ALVO: por padrao a propria conta logada; mas IG_TARGET_USER permite mirar
    // OUTRA conta (ex.: logar numa 2a conta que ENXERGA os likers da business e
    // ler os curtidores dos posts dela, contornando bloqueio do owner).
    const TARGET = (process.env.IG_TARGET_USER || dsUserId).toString().trim()
    if (TARGET !== dsUserId) console.log(`🎯 Conta-alvo dos posts/likers: ${TARGET} (logado como ${dsUserId})`)
    console.log(`▶ Nova captura dos ${NUM_POSTS} posts recentes...`)
    let ids = await getPostIds(ctx, TARGET, NUM_POSTS)
    if (!ids.length) { escreverStatus(false, 'sem_posts_ou_sessao_invalida'); await ctx.close(); process.exit(2) }
    // Filtro "dessa semana": IG_DAYS=7 => so posts dos ultimos 7 dias.
    const DIAS = Math.max(0, parseInt(process.env.IG_DAYS || '0', 10))
    if (DIAS > 0) {
      const corte = Math.floor(Date.now() / 1000) - DIAS * 86400
      const antes = ids.length
      ids = ids.filter((p) => (p.taken_at || 0) >= corte)
      console.log(`  filtro ${DIAS}d: ${ids.length}/${antes} posts dentro da janela.`)
    }
    if (!ids.length) { console.log('  Nenhum post na janela de data.'); escreverStatus(true, null); await ctx.close(); process.exit(0) }
    state = { contagem: {}, perfis: {}, porPost: {}, done: [], pending: ids, followers: null, following: null }; saveState(state)
    console.log(`  ${ids.length} posts na fila.`)
  }
  // saneia state retomado de versoes antigas
  state.perfis = state.perfis || {}; state.porPost = state.porPost || {}

  const reqCounter = { n: 0 }
  const FOLLOW_LIMIT = Math.max(0, parseInt(process.env.IG_FOLLOW_LIMIT || '0', 10)) // 0 = todos

  // RITMO HUMANO (tempos aleatorios, sem pressa, pra Meta nao pegar padrao).
  // Defaults conservadores; ajustaveis no .env. Variancia ALTA = parece gente.
  const PAUSA_MIN = Math.max(1000, parseInt(process.env.IG_PAUSA_MIN || '6000', 10))   // entre posts
  const PAUSA_MAX = Math.max(PAUSA_MIN + 1000, parseInt(process.env.IG_PAUSA_MAX || '20000', 10))
  const DESCANSO_MIN = Math.max(10000, parseInt(process.env.IG_DESCANSO_MIN || '45000', 10)) // descanso longo
  const DESCANSO_MAX = Math.max(DESCANSO_MIN + 5000, parseInt(process.env.IG_DESCANSO_MAX || '150000', 10))
  const novoLote = () => Math.floor(rand(3, 7))  // qtde de posts antes de um descanso longo
  // warmup inicial (chega devagar, como quem abriu o app)
  await sleep(rand(2000, 6000))

  // FASE 1: curtidores por post (com atribuicao e perfis ricos)
  const total = state.done.length + state.pending.length
  let desdeUltimaPausa = 0
  let loteAlvo = novoLote()
  let falhasSeguidas = 0          // detector de BLOQUEIO (HTML/modal vazio)
  const MAX_FALHAS = Math.max(2, parseInt(process.env.IG_MAX_FALHAS || '3', 10))
  let likersBloqueado = false
  while (state.pending.length) {
    const post = state.pending[0]
    let res = await capturarLikers(page, post.pk, post.code)
    // 1 retry em caso de hiccup (0 curtidores / falha pontual)
    if (!res.rateLimited && (!res.users || !res.users.length) && res.error) {
      await sleep(rand(2000, 4000))
      res = await capturarLikers(page, post.pk, post.code)
    }
    if (res.rateLimited) { console.log('  429 — pausa 60s (estado salvo).'); saveState(state); await sleep(60000); continue }
    // ABORT-ON-BLOQUEIO: ao contrario do original (que retenta 5x e MARTELA o
    // endpoint bloqueado, aprofundando o bloqueio), se varios posts seguidos
    // falham (REST=HTML + modal vazio), PARAMOS a fase de likers na hora.
    if (!res.users || !res.users.length) {
      if (res.error) {
        falhasSeguidas++
        if (falhasSeguidas >= MAX_FALHAS) {
          likersBloqueado = true
          console.log(`  ⛔ ${falhasSeguidas} posts seguidos sem curtidores (REST=HTML/modal vazio) = BLOQUEIO da Meta em likers.`)
          console.log('     ABORTANDO a fase de likers pra NAO martelar (evita aprofundar o bloqueio). Esfrie e tente depois.')
          break
        }
      }
    } else {
      falhasSeguidas = 0
    }
    const nomes = []
    if (res.users) for (const u of res.users) {
      const un = typeof u === 'string' ? u : u && u.username
      if (!un) continue
      nomes.push(un)
      state.contagem[un] = (state.contagem[un] || 0) + 1
      if (u && typeof u === 'object') state.perfis[un] = { ...(state.perfis[un] || {}), ...u }
    }
    state.porPost[post.code || post.pk] = nomes
    state.done.push(post.pk); state.pending.shift(); saveState(state); gravarTudo(state)
    reqCounter.n++
    console.log(`  [${state.done.length}/${total}] ${post.code || post.pk} -> ${res.users ? nomes.length + ' curtidores' : 'erro ' + res.error} (${res.fonte})`)
    // pausa humana entre posts: aleatoria e com folga (varia muito)
    const p = rand(PAUSA_MIN, PAUSA_MAX)
    console.log(`  ⏳ pausa ${Math.round(p / 1000)}s...`)
    await sleep(p)
    // de vez em quando, um descanso LONGO (como quem largou o celular um tempo)
    if (++desdeUltimaPausa >= loteAlvo) {
      desdeUltimaPausa = 0; loteAlvo = novoLote()
      const d = rand(DESCANSO_MIN, DESCANSO_MAX)
      console.log(`  💤 descanso longo ${Math.round(d / 1000)}s (anti-bloqueio)...`)
      await sleep(d)
    }
  }

  // Se likers bloqueado: para tudo (nao puxa followers/following = nao adiciona
  // carga numa conta ja estrangulada). Salva o que tem e sai pedindo cooldown.
  if (likersBloqueado) {
    gravarTudo(state)
    escreverStatus(false, 'likers_bloqueado_cooldown')
    console.log(`⛔ Parado por bloqueio de likers. ${state.done.length} posts processados antes. Esfrie a conta (horas) e rode de novo.`)
    await ctx.close(); process.exit(3)
  }

  // Em modo conta-alvo (IG_TARGET_USER) nao coletamos followers/following — sao
  // da conta logada (viewer), nao da business; e a business nao expoe a lista.
  const modoAlvo = !!process.env.IG_TARGET_USER
  // FASE 2: following (quem VOCE segue) — opcional via IG_COLLECT_FOLLOWING
  if (!modoAlvo && process.env.IG_COLLECT_FOLLOWING !== 'false' && !state.following) {
    console.log('▶ Coletando following (quem voce segue)...')
    try { state.following = await coletarLista(page, dsUserId, 'following', FOLLOW_LIMIT, reqCounter) } catch (e) { console.log('  following falhou:', e.message) }
    saveState(state); gravarTudo(state)
  }
  // FASE 3: followers (quem te segue) — opcional via IG_COLLECT_FOLLOWERS
  if (!modoAlvo && process.env.IG_COLLECT_FOLLOWERS !== 'false' && !state.followers) {
    console.log('▶ Coletando followers (quem te segue)...')
    try { state.followers = await coletarLista(page, dsUserId, 'followers', FOLLOW_LIMIT, reqCounter) } catch (e) { console.log('  followers falhou:', e.message) }
    saveState(state); gravarTudo(state)
  }

  await ctx.close()
  const ranking = gravarTudo(state)
  escreverStatus(true, null)
  try { fs.unlinkSync(STATE_FILE) } catch {}
  console.log(`✅ Completo. ${ranking.length} curtidores | ${state.followers ? state.followers.length : '-'} followers | ${state.following ? state.following.length : '-'} following | ${state.done.length} posts`)
  console.log(`   Saidas em ${OUT}: likers.json, leaderboard.csv, likers-detalhado.json, posts-curtidores.json, leaderboard-seguindo.json, leaderboard-nao-seguindo.json, follower-analysis.json, followers.json, following.json`)
  console.log('Top 10:', ranking.slice(0, 10).map((r) => `${r.username}(${r.curtidas})`).join(', '))
}
main().catch((e) => { console.error(e); escreverStatus(false, 'erro: ' + (e.message || e)); process.exit(1) })
