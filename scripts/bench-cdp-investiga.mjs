// Investigacao no Chrome real (CDP 9222): replica o fluxo que funciona
// (abre post -> clica nas curtidas) e captura QUALQUER resposta com usernames.
import { chromium } from 'playwright'
const CODE = process.argv[2] || 'DYnZkhHlvNV'
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
let page = ctx.pages().find((p) => p.url().includes('instagram')) || ctx.pages()[0] || await ctx.newPage()
await page.bringToFront().catch(() => {})

const achados = []
let escutando = false
page.on('response', async (resp) => {
  if (!escutando) return
  const u = resp.url()
  const ct = resp.headers()['content-type'] || ''
  if (!ct.includes('json')) return
  let s
  try { s = JSON.stringify(await resp.json()) } catch { return }
  const n = (s.match(/"username"/g) || []).length
  if (!n) return
  const pd = resp.request().postData() || ''
  achados.push({
    url: u.slice(0, 90),
    doc: (pd.match(/doc_id=(\d+)/) || [])[1] || (u.match(/doc_id=(\d+)/) || [])[1] || null,
    fn: decodeURIComponent((pd.match(/fb_api_req_friendly_name=([^&]+)/) || [])[1] || ''),
    vars: (() => { try { return decodeURIComponent((pd.match(/variables=([^&]+)/) || [])[1] || '').slice(0, 200) } catch { return '' } })(),
    n,
  })
})

console.log('1) abrindo o post', CODE)
await page.goto(`https://www.instagram.com/p/${CODE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(3500)
escutando = true
console.log('2) procurando link de curtidas (liked_by)...')
let abriu = false
try {
  const link = await page.$('a[href*="liked_by"]')
  if (link) { await link.click().catch(() => {}); abriu = true; console.log('   cliquei no link liked_by') }
} catch {}
if (!abriu) { console.log('   sem link liked_by; tentando goto direto'); await page.goto(`https://www.instagram.com/p/${CODE}/liked_by/`, { waitUntil: 'domcontentloaded' }).catch(() => {}) }
await page.waitForTimeout(5000)

console.log('=== respostas JSON com usernames ===')
for (const a of achados) console.log(`  [${a.n}] ${a.url} | doc=${a.doc} | fn=${a.fn} | vars=${a.vars}`)
if (!achados.length) console.log('  (nenhuma)')

try { await page.screenshot({ path: 'scripts/_investiga.png' }); console.log('screenshot: scripts/_investiga.png') } catch (e) { console.log('screenshot falhou:', e.message) }
console.log('=== janela mantida aberta ===')
process.exit(0)
