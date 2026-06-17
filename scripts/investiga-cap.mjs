// Investiga o teto de ~104: abre os curtidores de 1 post da business (logado na
// 2a conta) e inspeciona a resposta GraphQL — count total, edges, has_next_page.
import 'dotenv/config'
import { chromium } from 'playwright'
const CODE = process.argv[2] || 'DZqbPq9sxWT'
const PROFILE = 'C:\\jfn\\ig-profile-2'
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, locale: 'pt-BR', viewport: { width: 1280, height: 900 } })
const page = ctx.pages()[0] || await ctx.newPage()

const caps = []
page.on('response', async (r) => {
  if (!/graphql\/query/.test(r.url())) return
  const ct = r.headers()['content-type'] || ''
  if (!ct.includes('json')) return
  let j; try { j = await r.json() } catch { return }
  const s = JSON.stringify(j)
  if (!/"username"/.test(s)) return
  // procura page_info e count em qualquer lugar do json
  const usernames = (s.match(/"username"/g) || []).length
  const hasNext = /"has_next_page":true/.test(s)
  const endCursor = (s.match(/"end_cursor":"([^"]{0,30})/) || [])[1] || null
  const count = (s.match(/"count":(\d+)/) || [])[1] || null
  const pd = r.request().postData() || ''
  const doc = (pd.match(/doc_id=(\d+)/) || [])[1] || null
  const fn = decodeURIComponent((pd.match(/fb_api_req_friendly_name=([^&]+)/) || [])[1] || '')
  let vars = ''; try { vars = decodeURIComponent((pd.match(/variables=([^&]+)/) || [])[1] || '') } catch {}
  caps.push({ usernames, hasNext, endCursor, count, doc, fn, vars: vars.slice(0, 220) })
})

await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.goto(`https://www.instagram.com/p/${CODE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const link = await page.$('a[href*="liked_by"]')
if (link) await link.click().catch(() => {})
else await page.goto(`https://www.instagram.com/p/${CODE}/liked_by/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

// rola AGRESSIVO (30x) contando usernames unicos no DOM do modal
const vistos = new Set()
for (let i = 0; i < 30; i++) {
  const us = await page.evaluate(() => {
    const dlg = document.querySelector('div[role="dialog"]'); if (!dlg) return []
    return [...dlg.querySelectorAll('a[href^="/"]')].map((a) => (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9._]+)\/$/)).filter(Boolean).map((m) => m[1])
  }).catch(() => [])
  us.forEach((u) => vistos.add(u))
  await page.evaluate(() => { const d = document.querySelector('div[role="dialog"]'); const sc = d && [...d.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 60); if (sc) sc.scrollTop = sc.scrollHeight }).catch(() => {})
  await page.waitForTimeout(1200)
  if (i % 6 === 5) console.log(`  scroll ${i + 1}: DOM unicos=${vistos.size}`)
}
console.log('=== DOM final: usuarios unicos no modal =', vistos.size)
console.log('=== respostas GraphQL de curtidores ===')
caps.forEach((c, i) => {
  console.log(`  resp${i + 1}: usernames=${c.usernames} has_next=${c.hasNext} count=${c.count} cursor=${c.endCursor ? 'sim' : 'nao'}`)
  console.log(`    fn=${c.fn} doc=${c.doc}`)
  console.log(`    vars=${c.vars}`)
})
await ctx.close()
console.log('fim')
process.exit(0)
