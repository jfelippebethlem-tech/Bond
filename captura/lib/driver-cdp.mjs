// MOTOR B — CDP CRU (sem Playwright). Dirige o CHROME REAL pelo DevTools Protocol.
// Por que é o mais "limpo" contra detecção (ver pesquisa no runbook):
//   - NÃO usa Playwright -> sem globals __pwInitScripts/__playwright__binding__.
//   - NÃO habilita Runtime nem chama Runtime.evaluate -> não roda JS na página
//     (evita o vetor "script injetando código" + o leak de Runtime.enable).
//   - Coordenadas via DOM domain (DOM.getBoxModel) = inspeção do DOM já parseado,
//     SEM executar JS da página. Mouse/roda via Input.dispatchMouseEvent (eventos
//     isTrusted=true). Prints via Page.captureScreenshot.
// Pré-req: Chrome REAL aberto com --remote-debugging-port=9222 e o perfil logado.
import fs from 'fs'
import WebSocket from 'ws'
import { sleep, rand, codeDaUrl } from './util.mjs'

async function alvoPagina(base) {
  const r = await fetch(`${base}/json`)
  const lista = await r.json()
  const pg = lista.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || lista[0]
  if (!pg || !pg.webSocketDebuggerUrl) throw new Error('nenhum target "page" no Chrome (abriu com --remote-debugging-port?)')
  return pg.webSocketDebuggerUrl
}

export async function criarDriverCDP(cfg) {
  const base = cfg.cdpUrl || 'http://127.0.0.1:9222'
  const wsUrl = await alvoPagina(base)
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })

  let _id = 0
  const pendentes = new Map()
  const ouvintes = new Map() // method -> [resolve...]
  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data.toString()) } catch { return }
    if (msg.id && pendentes.has(msg.id)) {
      const { resolve, reject } = pendentes.get(msg.id); pendentes.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error))); else resolve(msg.result)
    } else if (msg.method && ouvintes.has(msg.method)) {
      const fns = ouvintes.get(msg.method); ouvintes.set(msg.method, [])
      for (const fn of fns) fn(msg.params)
    }
  })
  const cmd = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++_id; pendentes.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { if (pendentes.has(id)) { pendentes.delete(id); reject(new Error('timeout ' + method)) } }, 20000)
  })
  const esperarEvento = (method, timeout = 12000) => new Promise((resolve) => {
    const arr = ouvintes.get(method) || []; arr.push(resolve); ouvintes.set(method, arr)
    setTimeout(() => resolve(null), timeout)
  })

  // só Page (navegação/print) + DOM (coordenadas). NUNCA Runtime.
  await cmd('Page.enable')
  await cmd('DOM.enable')

  async function viewport() {
    try { const m = await cmd('Page.getLayoutMetrics'); const v = m.cssVisualViewport || m.visualViewport; return { width: Math.round(v.clientWidth), height: Math.round(v.clientHeight) } }
    catch { return { width: cfg.width, height: cfg.height } }
  }
  // box do 1º seletor que casar, via DOM domain (sem JS de página)
  async function boxOf(selectors) {
    let rootId
    try { rootId = (await cmd('DOM.getDocument', { depth: 0 })).root.nodeId } catch { return null }
    for (const sel of selectors) {
      try {
        const { nodeId } = await cmd('DOM.querySelector', { nodeId: rootId, selector: sel })
        if (!nodeId) continue
        const { model } = await cmd('DOM.getBoxModel', { nodeId })
        const q = model.content // [x1,y1,x2,y2,x3,y3,x4,y4]
        const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]]
        const x = Math.min(...xs), y = Math.min(...ys)
        return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
      } catch {}
    }
    return null
  }
  async function gridCodes() {
    let rootId
    try { rootId = (await cmd('DOM.getDocument', { depth: 0 })).root.nodeId } catch { return [] }
    const out = []
    for (const sel of ['a[href*="/p/"]', 'a[href*="/reel/"]']) {
      try {
        const { nodeIds } = await cmd('DOM.querySelectorAll', { nodeId: rootId, selector: sel })
        for (const id of (nodeIds || [])) {
          try {
            const { attributes } = await cmd('DOM.getAttributes', { nodeId: id })
            const i = attributes.indexOf('href'); const href = i >= 0 ? attributes[i + 1] : null
            const c = codeDaUrl(href); if (c) out.push(c)
          } catch {}
        }
      } catch {}
    }
    return out
  }
  const moveMouse = (x, y) => cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  async function click(x, y) {
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await sleep(rand(40, 130))
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 })
  }
  const wheel = (x, y, dy) => cmd('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy })
  async function keyEscape() {
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  }

  return {
    info: () => ({ nome: 'cdp' }),
    viewport: () => viewport._cache || { width: cfg.width, height: cfg.height },
    async _refreshVp() { viewport._cache = await viewport() },
    async goto(url) {
      const ev = esperarEvento('Page.loadEventFired')
      await cmd('Page.navigate', { url })
      await ev
      await sleep(rand(1200, 2600))
      viewport._cache = await viewport()
    },
    async screenshot(abs) {
      const { data } = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      fs.writeFileSync(abs, Buffer.from(data, 'base64'))
    },
    boxOf, gridCodes, moveMouse, click, wheel, keyEscape,
    async close() { try { ws.close() } catch {} },
  }
}
