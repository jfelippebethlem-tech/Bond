// CAPTURA "QUEM CURTIU" — RODA SÓ NO DESKTOP (IP residencial). NUNCA na VM.
//
// Método seguro do InstagramLikesLeaderboard: busca IN-PAGE pela API interna do
// IG (cookie da sessao + x-ig-app-id), dentro da pagina via Playwright.
//
// RESUMÍVEL: salva o estado a cada post (likers-state.json). Se travar/bloquear,
// na proxima execucao CONTINUA de onde parou (nao recomeca do zero).
//
// .env LOCAL (desktop): IG_CAPTURE_LOCAL=true, IG_SESSIONID, IG_DS_USER_ID,
//   IG_CSRFTOKEN, IG_NUM_POSTS=30, LIKERS_OUT_DIR=C:\jfn\likers-sync
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'

if (process.env.IG_CAPTURE_LOCAL !== 'true') {
  console.error('⛔ Recusado. IG_CAPTURE_LOCAL=true so no .env do DESKTOP. NUNCA na VM (IP datacenter = ban).')
  process.exit(1)
}
const { IG_SESSIONID, IG_DS_USER_ID, IG_CSRFTOKEN } = process.env
if (!IG_SESSIONID || !IG_DS_USER_ID || !IG_CSRFTOKEN) {
  console.error('⛔ Faltam cookies: IG_SESSIONID, IG_DS_USER_ID, IG_CSRFTOKEN.')
  process.exit(1)
}
const NUM_POSTS = Math.max(1, parseInt(process.env.IG_NUM_POSTS || '30', 10))
const OUT = process.env.LIKERS_OUT_DIR || '.'
const STATE_FILE = path.join(process.cwd(), 'likers-state.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = (a, b) => a + Math.random() * (b - a)
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return null } }
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s))

// --- funcoes que rodam DENTRO da pagina do IG (in-page fetch) ---
async function getPostIds(page, dsUserId, numPosts) {
  return page.evaluate(async ({ dsUserId, numPosts }) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || ''
    const headers = { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrf }
    const ids = []
    let maxId = null
    while (ids.length < numPosts) {
      let url = `https://www.instagram.com/api/v1/feed/user/${dsUserId}/?count=12`
      if (maxId) url += `&max_id=${maxId}`
      const r = await fetch(url, { headers, credentials: 'include' })
      if (!r.ok) break
      const d = await r.json()
      for (const it of (d.items || [])) ids.push(String(it.pk || it.id))
      if (!d.more_available || !d.next_max_id) break
      maxId = d.next_max_id
      await new Promise((x) => setTimeout(x, 2000 + Math.random() * 2000))
    }
    return ids.slice(0, numPosts)
  }, { dsUserId, numPosts })
}
async function getLikers(page, pid) {
  return page.evaluate(async ({ pid }) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || ''
    const headers = { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrf }
    const r = await fetch(`https://www.instagram.com/api/v1/media/${pid}/likers/`, { headers, credentials: 'include' })
    if (r.status === 429) return { rateLimited: true }
    if (!r.ok) return { error: r.status }
    const d = await r.json()
    return { users: (d.users || []).map((u) => u.username).filter(Boolean) }
  }, { pid })
}

// Salva o cookie RENOVADO de volta no .env (o IG estende a sessao a cada visita).
// Assim as rodadas semanais mantem o login vivo sozinhas.
async function atualizarEnvCookies(ctx) {
  try {
    const cookies = await ctx.cookies('https://www.instagram.com')
    const get = (n) => (cookies.find((c) => c.name === n) || {}).value
    const sid = get('sessionid'), csrf = get('csrftoken'), ds = get('ds_user_id')
    const envPath = path.join(process.cwd(), '.env')
    if (!sid || !fs.existsSync(envPath)) return
    let txt = fs.readFileSync(envPath, 'utf8')
    const set = (k, v) => { if (!v) return; const re = new RegExp(`^${k}=.*$`, 'm'); const line = `${k}="${v}"`; txt = re.test(txt) ? txt.replace(re, line) : (txt.trimEnd() + `\n${line}\n`) }
    set('IG_SESSIONID', sid); set('IG_CSRFTOKEN', csrf); set('IG_DS_USER_ID', ds)
    fs.writeFileSync(envPath, txt)
    console.log('🔄 Cookie renovado salvo no .env (sessao mantida viva).')
  } catch { /* nao critico */ }
}

function gravarSaida(contagem) {
  const ranking = Object.entries(contagem).map(([username, curtidas]) => ({ username, curtidas })).sort((a, b) => b.curtidas - a.curtidas)
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'likers.json'), JSON.stringify(ranking, null, 2))
  fs.writeFileSync(path.join(OUT, 'likers.csv'), 'username,curtidas\n' + ranking.map((r) => `${r.username},${r.curtidas}`).join('\n'))
  return ranking
}

async function main() {
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 820 } })
  await ctx.addCookies([
    { name: 'sessionid', value: IG_SESSIONID, domain: '.instagram.com', path: '/' },
    { name: 'ds_user_id', value: IG_DS_USER_ID, domain: '.instagram.com', path: '/' },
    { name: 'csrftoken', value: IG_CSRFTOKEN, domain: '.instagram.com', path: '/' },
  ])
  const page = await ctx.newPage()
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  // Retoma se houver estado pendente; senao, comeca uma rodada nova.
  let state = loadState()
  if (state && Array.isArray(state.pending) && state.pending.length) {
    console.log(`↺ Retomando: ${state.done.length} feitos, ${state.pending.length} restantes.`)
  } else {
    console.log(`▶ Nova captura dos ${NUM_POSTS} posts recentes...`)
    const ids = await getPostIds(page, IG_DS_USER_ID, NUM_POSTS)
    if (!ids.length) { console.log('⚠️ 0 posts — cookie provavelmente expirou (pegue novo no F12).'); await browser.close(); process.exit(2) }
    state = { contagem: {}, done: [], pending: ids }
    saveState(state)
    console.log(`  ${ids.length} posts na fila.`)
  }

  // Fase 2: por post, salvando o estado a cada um (resumível).
  const total = state.done.length + state.pending.length
  while (state.pending.length) {
    const pid = state.pending[0]
    const res = await getLikers(page, pid)
    if (res.rateLimited) { console.log('  429 — pausa 60s (estado salvo, pode fechar e retomar depois).'); saveState(state); await sleep(60000); continue }
    if (res.users) for (const u of res.users) state.contagem[u] = (state.contagem[u] || 0) + 1
    state.done.push(pid); state.pending.shift()
    saveState(state)
    gravarSaida(state.contagem) // atualiza a saida parcial a cada post
    console.log(`  [${state.done.length}/${total}] post ${pid} -> ${res.users ? res.users.length : 'erro ' + res.error} curtidores`)
    await sleep(rand(3000, 7000))
  }

  await atualizarEnvCookies(ctx) // renova o cookie no .env antes de fechar
  await browser.close()
  const ranking = gravarSaida(state.contagem)
  try { fs.unlinkSync(STATE_FILE) } catch {} // rodada completa -> limpa o estado
  console.log(`✅ Completo. ${ranking.length} curtidores. Salvo em ${OUT}/likers.json`)
  console.log('Top 10:', ranking.slice(0, 10).map((r) => `${r.username}(${r.curtidas})`).join(', '))
}
main().catch((e) => { console.error(e); process.exit(1) })
