// No Chrome real (CDP 9222): abre o liked_by de 1 post e captura a requisicao
// GraphQL EXATA dos curtidores (friendly_name, doc_id, variables) + nº de users.
// Objetivo: replicar essa chamada DIRETO (rapido) em vez do modal lento.
import { chromium } from 'playwright'
const CODE = process.argv[2] || 'DYnZkhHlvNV'
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
let page = ctx.pages().find((p) => p.url().includes('instagram')) || ctx.pages()[0] || await ctx.newPage()
await page.bringToFront().catch(() => {})

const achados = []
page.on('response', async (resp) => {
  const u = resp.url()
  if (!/graphql\/query/.test(u)) return
  const ct = resp.headers()['content-type'] || ''
  if (!ct.includes('json')) return
  let s
  try { s = JSON.stringify(await resp.json()) } catch { return }
  const n = (s.match(/"username"/g) || []).length
  if (!n) return // so as respostas que tem usernames (curtidores)
  const pd = resp.request().postData() || ''
  const doc = (pd.match(/doc_id=(\d+)/) || [])[1] || (u.match(/doc_id=(\d+)/) || [])[1]
  const fn = decodeURIComponent((pd.match(/fb_api_req_friendly_name=([^&]+)/) || [])[1] || '')
  let vars = ''; try { vars = decodeURIComponent((pd.match(/variables=([^&]+)/) || [])[1] || '') } catch {}
  achados.push({ fn, doc, vars: vars.slice(0, 300), n })
})

console.log('navegando pro liked_by de', CODE, '...')
await page.goto(`https://www.instagram.com/p/${CODE}/liked_by/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(6000)
console.log('=== requisicoes GraphQL com curtidores ===')
for (const a of achados) {
  console.log(`  friendly_name: ${a.fn}`)
  console.log(`  doc_id: ${a.doc} | users_na_resposta: ${a.n}`)
  console.log(`  variables: ${a.vars}`)
  console.log('  ---')
}
if (!achados.length) console.log('  (nenhuma — o modal pode nao ter carregado)')
console.log('=== janela mantida aberta ===')
process.exit(0)
