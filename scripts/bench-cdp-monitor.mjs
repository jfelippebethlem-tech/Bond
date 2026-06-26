// Monitora o ORIGINAL ja rodando no Chrome real: captura as respostas /likers/
// (status + content-type) e erros, pra ver se o Step 2 (Likes) funciona.
import { chromium } from 'playwright'
const SEGUNDOS = parseInt(process.argv[2] || '40', 10)
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
let page = ctx.pages().find((p) => p.url().includes('instagram')) || ctx.pages()[0]
const likers = []
const erros = []
page.on('response', (r) => {
  if (/\/likers\//.test(r.url())) likers.push({ s: r.status(), ct: (r.headers()['content-type'] || '').split(';')[0] })
})
page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text().slice(0, 140)) })
page.on('pageerror', (e) => erros.push(String(e).slice(0, 140)))

console.log(`monitorando ${SEGUNDOS}s...`)
const fim = Date.now() + SEGUNDOS * 1000
let ultimo = ''
while (Date.now() < fim) {
  await page.waitForTimeout(2500)
  // le o estado visivel da UI (passo + progresso)
  const txt = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ')).catch(() => '')
  const m = txt.match(/(Fetching|Checking|Getting|Likes|Likers|posts|following|followers)[^.]{0,40}\d+[%/]\d*|\d+%/i)
  const snap = (m && m[0]) || txt.slice(0, 60)
  if (snap !== ultimo) { console.log('  UI:', snap); ultimo = snap }
  if (likers.length >= 6) break
}
console.log('=== respostas /likers/ (primeiras 8) ===')
if (!likers.length) console.log('  (nenhuma ainda)')
likers.slice(0, 8).forEach((x) => console.log(`  ${x.s} ${x.ct}`))
const json = likers.filter((x) => x.ct.includes('json')).length
const html = likers.filter((x) => x.ct.includes('html')).length
console.log(`  RESUMO: ${json} JSON, ${html} HTML (de ${likers.length})`)
console.log('=== erros (3) ==='); erros.slice(0, 3).forEach((e) => console.log('  ' + e))
await page.screenshot({ path: 'scripts/_original-step2.png' }).catch(() => {})
console.log('screenshot: scripts/_original-step2.png  (janela aberta)')
process.exit(0)
