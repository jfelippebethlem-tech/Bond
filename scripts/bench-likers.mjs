// Benchmark: metodo EXATO do InstagramLikesLeaderboard (igFetch, com x-csrftoken)
// vs o nosso (sem csrftoken), nos MESMOS posts, na MESMA sessao, cronometrado.
// So leitura, baixo volume (3 posts). Roda no perfil logado.
import 'dotenv/config'
import { chromium } from 'playwright'
const PROFILE = process.env.IG_PROFILE_DIR || 'C:\\jfn\\ig-profile'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, locale: 'pt-BR', viewport: { width: 1280, height: 820 } })
const page = ctx.pages()[0] || await ctx.newPage()
await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
const cookies = await ctx.cookies('https://www.instagram.com')
const ds = (cookies.find((c) => c.name === 'ds_user_id') || {}).value
console.log('ds_user_id:', ds)

const feed = await page.evaluate(async (ds) => {
  const r = await fetch(`https://www.instagram.com/api/v1/feed/user/${ds}/?count=5`, { credentials: 'include', headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' } })
  const ct = r.headers.get('content-type') || ''
  if (!ct.includes('json')) return { err: 'feed nao json', ct, head: (await r.text()).slice(0, 80) }
  const d = await r.json()
  return { items: (d.items || []).map((it) => ({ pk: String(it.pk || it.id), code: it.code })) }
}, ds)
console.log('feed:', JSON.stringify(feed).slice(0, 220))

// metodo EXATO do original (igFetch): com x-csrftoken do cookie
const ORIG = async (pid) => page.evaluate(async (pid) => {
  const t0 = performance.now()
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || ''
  const r = await fetch(`https://www.instagram.com/api/v1/media/${pid}/likers/`, { headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest', 'x-csrftoken': csrf }, credentials: 'include' })
  const ct = r.headers.get('content-type') || ''
  const txt = await r.text()
  let n = null; try { n = (JSON.parse(txt).users || []).length } catch {}
  return { ms: Math.round(performance.now() - t0), status: r.status, ct: ct.split(';')[0], n, head: txt.slice(0, 90) }
}, pid)

// metodo NOSSO: sem csrftoken
const NOSSO = async (pid) => page.evaluate(async (pid) => {
  const t0 = performance.now()
  const r = await fetch(`https://www.instagram.com/api/v1/media/${pid}/likers/`, { headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' }, credentials: 'include' })
  const ct = r.headers.get('content-type') || ''
  const txt = await r.text()
  let n = null; try { n = (JSON.parse(txt).users || []).length } catch {}
  return { ms: Math.round(performance.now() - t0), status: r.status, ct: ct.split(';')[0], n, head: txt.slice(0, 90) }
}, pid)

for (const it of (feed.items || []).slice(0, 3)) {
  const o = await ORIG(it.pk); await sleep(1500)
  const nn = await NOSSO(it.pk); await sleep(1500)
  console.log(`\npost ${it.code} (${it.pk}):`)
  console.log(`  ORIGINAL(csrf): ${o.status} ${o.ct} users=${o.n} ${o.ms}ms`)
  console.log(`  NOSSO(no-csrf): ${nn.status} ${nn.ct} users=${nn.n} ${nn.ms}ms`)
  if (o.ct !== 'application/json') console.log('    ORIG head:', o.head)
  if (nn.ct !== 'application/json') console.log('    NOSSO head:', nn.head)
}
await ctx.close()
console.log('\n=== fim do benchmark ===')
