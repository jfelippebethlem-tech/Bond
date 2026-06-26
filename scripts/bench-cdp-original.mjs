// Injeta e RODA o script ORIGINAL (copy-code de sagargupta.online) na aba do IG
// no Chrome real (CDP 9222), e captura o que ele faz no passo de likers.
import { chromium } from 'playwright'
import fs from 'fs'
const scriptText = fs.readFileSync('original-script.js', 'utf8')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
let page = ctx.pages().find((p) => p.url().includes('instagram')) || ctx.pages()[0] || await ctx.newPage()
await page.bringToFront().catch(() => {})

const logs = []
page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text().slice(0, 180)))
page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e).slice(0, 180)))
const net = []
page.on('response', (r) => { if (/\/likers\//.test(r.url())) net.push(r.status() + ' ' + (r.headers()['content-type'] || '').split(';')[0]) })

await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(2500)
console.log('injetando o script ORIGINAL (igual ao Copy Code + paste no console)...')
try { await page.evaluate(scriptText) } catch (e) { console.log('  (retorno nao serializavel — script rodou):', e.message.slice(0, 50)) }
await page.waitForTimeout(2500)
await page.screenshot({ path: 'scripts/_original-ui.png' }).catch(() => {})

const botoes = await page.$$eval('button', (bs) => bs.map((b) => (b.textContent || '').trim()).filter(Boolean)).catch(() => [])
console.log('botoes visiveis:', JSON.stringify(botoes).slice(0, 300))
// tenta clicar RUN/SCAN/START
for (const b of await page.$$('button')) {
  const t = ((await b.textContent().catch(() => '')) || '').trim().toUpperCase()
  if (t === 'RUN' || t.includes('RUN') || t.includes('SCAN') || t.includes('START') || t.includes('INICIAR')) { await b.click().catch(() => {}); console.log('cliquei no botao:', t); break }
}
await page.waitForTimeout(14000) // deixa Step 1 (posts) e Step 2 (likers) rodarem
await page.screenshot({ path: 'scripts/_original-run.png' }).catch(() => {})

console.log('=== requisicoes /likers/ que o ORIGINAL fez ===')
if (!net.length) console.log('  (nenhuma ainda)'); else net.slice(0, 6).forEach((x) => console.log('  ' + x))
console.log('=== console/erros relevantes do ORIGINAL ===')
logs.filter((l) => /error|DOCTYPE|<|json|likers|step|fetch|fail|unexpected/i.test(l)).slice(0, 18).forEach((l) => console.log('  ' + l))
console.log('=== fim (janela aberta) ===')
process.exit(0)
