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
function gravarSaida(contagem) {
  const ranking = Object.entries(contagem).map(([username, curtidas]) => ({ username, curtidas })).sort((a, b) => b.curtidas - a.curtidas)
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'likers.json'), JSON.stringify(ranking, null, 2))
  fs.writeFileSync(path.join(OUT, 'likers.csv'), 'username,curtidas\n' + ranking.map((r) => `${r.username},${r.curtidas}`).join('\n'))
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
    for (const it of (d.items || [])) ids.push({ pk: String(it.pk || it.id), code: it.code || null })
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
function coletarUsernames(json, sink) {
  const pilha = [json]
  while (pilha.length) {
    const n = pilha.pop()
    if (n && typeof n === 'object') {
      if (typeof n.username === 'string' && n.username) sink.add(n.username)
      for (const k in n) { const v = n[k]; if (v && typeof v === 'object') pilha.push(v) }
    }
  }
}
async function getLikersDOM(page, code) {
  if (!code) return { error: 'sem_code' }
  const viaApi = new Set()
  let capturas = 0
  const onResp = async (resp) => {
    const u = resp.url()
    if (!/graphql\/query|\/likers\b|liked_by/i.test(u)) return
    const ct = resp.headers()['content-type'] || ''
    if (!ct.includes('json')) return
    try { const j = await resp.json(); capturas++; coletarUsernames(j, viaApi) } catch {}
  }
  // 1) carrega o post e deixa os requests do post (comentarios etc) acontecerem
  //    ANTES de comecar a escutar — assim o que capturamos depois e dos curtidores.
  await page.goto(`https://www.instagram.com/p/${code}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(rand(2500, 4000))
  // 2) AGORA escuta e abre os curtidores (clique no link de curtidas, como no sniffer)
  page.on('response', onResp)
  let abriu = false
  try {
    const link = await page.$('a[href*="liked_by"]')
    if (link) { await link.click().catch(() => {}); abriu = true }
  } catch {}
  if (!abriu) { try { await page.goto(`https://www.instagram.com/p/${code}/liked_by/`, { waitUntil: 'domcontentloaded' }) } catch {} }
  await page.waitForTimeout(rand(2500, 3800))
  // 3) rola o modal/lista pra paginar (dispara mais /graphql/query) e coleta DOM
  const viaDom = new Set()
  let prev = -1, estavel = 0
  for (let i = 0; i < 80 && estavel < 4; i++) {
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
      const sc = dlg && [...dlg.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 60)
      if (sc) sc.scrollTop = sc.scrollHeight
    }).catch(() => {})
    await page.waitForTimeout(rand(1100, 2100))
    const tot = viaApi.size + viaDom.size
    if (tot === prev) estavel++; else { estavel = 0; prev = tot }
  }
  page.off('response', onResp)
  // Prioriza o modal (limpo). So cai pra API (escutada APOS abrir os curtidores)
  // se o modal nao renderizou.
  let fonte = 'dom', base = viaDom
  if (!viaDom.size && viaApi.size) { fonte = 'api', base = viaApi }
  const todos = new Set(base); NAO_USER.forEach((x) => todos.delete(x))
  if (process.env.IG_DEBUG === 'true') console.log(`    [fonte=${fonte} DOM=${viaDom.size} API=${viaApi.size} graphqlCaps=${capturas}]`)
  if (!todos.size) return { error: 'sem_dialog' }
  return { users: [...todos] }
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
    console.log(`▶ Nova captura dos ${NUM_POSTS} posts recentes...`)
    const ids = await getPostIds(ctx, dsUserId, NUM_POSTS)
    if (!ids.length) { escreverStatus(false, 'sem_posts_ou_sessao_invalida'); await ctx.close(); process.exit(2) }
    state = { contagem: {}, done: [], pending: ids }; saveState(state)
    console.log(`  ${ids.length} posts na fila.`)
  }

  const total = state.done.length + state.pending.length
  let desdeUltimaPausa = 0
  while (state.pending.length) {
    const post = state.pending[0]
    const res = await getLikersDOM(page, post.code)
    if (res.rateLimited) { console.log('  429 — pausa 60s (estado salvo).'); saveState(state); await sleep(60000); continue }
    if (res.users) for (const u of res.users) state.contagem[u] = (state.contagem[u] || 0) + 1
    state.done.push(post.pk); state.pending.shift(); saveState(state); gravarSaida(state.contagem)
    console.log(`  [${state.done.length}/${total}] ${post.code || post.pk} -> ${res.users ? res.users.length + ' curtidores' : 'erro ' + res.error}`)
    await sleep(rand(4000, 9000)) // pausa humana entre posts (4-9s)
    // Trava anti-ban: a cada 6 posts, pausa longa (igual ao Leaderboard).
    if (++desdeUltimaPausa >= 6) { desdeUltimaPausa = 0; console.log('  💤 pausa de 20s (anti-ban)...'); await sleep(20000) }
  }

  await ctx.close()
  const ranking = gravarSaida(state.contagem)
  escreverStatus(true, null)
  try { fs.unlinkSync(STATE_FILE) } catch {}
  console.log(`✅ Completo. ${ranking.length} curtidores em ${OUT}/likers.json`)
  console.log('Top 10:', ranking.slice(0, 10).map((r) => `${r.username}(${r.curtidas})`).join(', '))
}
main().catch((e) => { console.error(e); escreverStatus(false, 'erro: ' + (e.message || e)); process.exit(1) })
