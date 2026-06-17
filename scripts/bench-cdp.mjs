// Conecta no Chrome REAL (porta 9222, sem flags de automacao) e testa o likers
// REST (metodo do original) la dentro. NAO fecha o Chrome (janela fica aberta).
import { chromium } from 'playwright'
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
let page = ctx.pages().find((p) => p.url().includes('instagram')) || ctx.pages()[0] || await ctx.newPage()
await page.bringToFront().catch(() => {})
if (!page.url().includes('instagram')) await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(2500)
const cookies = await ctx.cookies('https://www.instagram.com')
const ds = (cookies.find((c) => c.name === 'ds_user_id') || {}).value
const logged = !!(cookies.find((c) => c.name === 'sessionid' && c.value) && ds)
console.log('CHROME REAL | logado:', logged, '| ds_user_id:', ds)
if (!logged) { console.log('>> NAO logado neste Chrome. Faca login na janela aberta e me avise.'); process.exit(0) }

const feed = await page.evaluate(async (ds) => {
  const r = await fetch(`https://www.instagram.com/api/v1/feed/user/${ds}/?count=5`, { credentials: 'include', headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' } })
  const ct = r.headers.get('content-type') || ''
  if (!ct.includes('json')) return { err: 'feed nao json', ct }
  const d = await r.json()
  return { items: (d.items || []).map((it) => ({ pk: String(it.pk || it.id), code: it.code })) }
}, ds)
console.log('feed:', JSON.stringify(feed).slice(0, 200))

for (const it of (feed.items || []).slice(0, 3)) {
  const o = await page.evaluate(async (pid) => {
    const t0 = performance.now()
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || ''
    const r = await fetch(`https://www.instagram.com/api/v1/media/${pid}/likers/`, { headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest', 'x-csrftoken': csrf }, credentials: 'include' })
    const ct = r.headers.get('content-type') || ''
    const txt = await r.text()
    let n = null; try { n = (JSON.parse(txt).users || []).length } catch {}
    return { ms: Math.round(performance.now() - t0), status: r.status, ct: ct.split(';')[0], n, head: txt.slice(0, 80) }
  }, it.pk)
  console.log(`post ${it.code}: ${o.status} ${o.ct} users=${o.n} ${o.ms}ms${o.ct !== 'application/json' ? ' | head: ' + o.head : ''}`)
  await new Promise((r) => setTimeout(r, 1500))
}
console.log('=== janela mantida aberta para investigacao ===')
process.exit(0)
