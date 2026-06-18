// MOTOR C — Playwright. Menor mudança / reaproveita o ecossistema.
// Conecta no CHROME REAL via CDP (IG_CDP_URL, ex.: http://127.0.0.1:9222) quando
// disponível — o que dá fingerprint/canvas/WebGL reais. Sem CDP_URL, cai no
// launchPersistentContext (Chromium do Playwright) com o perfil dedicado.
// RISCO RESIDUAL conhecido (ver pesquisa no runbook): o Playwright expõe globals
// (__pwInitScripts/__playwright__binding__) que a Meta PODE sondar. Por isso este
// motor existe p/ COMPARAR — os motores CDP-cru e nodriver não têm esse rastro.
// Mesmo aqui: só mouse/teclado/screenshot — nada de fetch nem scrollTop.
import { chromium } from 'playwright'
import { sleep, rand, codeDaUrl } from './util.mjs'

export async function criarDriverPlaywright(cfg) {
  let browser, context, page, lancado = false
  if (cfg.cdpUrl) {
    browser = await chromium.connectOverCDP(cfg.cdpUrl)
    context = browser.contexts()[0] || (await browser.newContext())
    page = context.pages()[0] || (await context.newPage())
  } else {
    context = await chromium.launchPersistentContext(cfg.profileDir, {
      headless: false,
      channel: cfg.channel || undefined,            // 'chrome' usa o Chrome real instalado
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      viewport: { width: cfg.width, height: cfg.height },
      args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check'],
    })
    page = context.pages()[0] || (await context.newPage())
    lancado = true
  }

  let vp = { width: cfg.width, height: cfg.height }
  try { const v = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })); if (v && v.width) vp = v } catch {}

  return {
    info: () => ({ nome: 'playwright' }),
    page, context,
    viewport: () => vp,
    async goto(url) { await page.goto(url, { waitUntil: 'domcontentloaded' }); await sleep(rand(1200, 2600)) },
    async screenshot(abs) { await page.screenshot({ path: abs }) },
    async boxOf(selectors) {
      for (const sel of selectors) {
        try { const b = await page.locator(sel).first().boundingBox({ timeout: 800 }); if (b) return b } catch {}
      }
      return null
    },
    async boxOfText(regex) {
      try {
        const loc = page.locator('a, button, div[role="button"], span').filter({ hasText: regex }).first()
        const b = await loc.boundingBox({ timeout: 800 }); if (b) return b
      } catch {}
      return null
    },
    async gridCodes() {
      try {
        const hrefs = await page.locator('a[href*="/p/"], a[href*="/reel/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
        const out = []; for (const h of hrefs) { const c = codeDaUrl(h); if (c) out.push(c) }
        return out
      } catch { return [] }
    },
    async moveMouse(x, y) { await page.mouse.move(x, y) },
    async click(x, y) { await page.mouse.move(x, y); await page.mouse.down(); await sleep(rand(40, 130)); await page.mouse.up() },
    async wheel(x, y, dy) { await page.mouse.move(x, y); await page.mouse.wheel(0, dy) },
    async keyEscape() { await page.keyboard.press('Escape') },
    async close() { try { if (lancado) await context.close(); else await browser.close() } catch {} },
  }
}
