// COREOGRAFIA HUMANA compartilhada — roda IGUAL nos 3 motores (driver injetado).
// O `driver` abstrai o low-level (mover/clicar/rolar/print/navegar/ler-DOM-via-CDP).
// Aqui fica só o "comportamento de gente": ordem, tempos aleatórios, pausas, prints.
//
// Contrato do driver (tudo async, exceto info/viewport):
//   info()            -> { nome }
//   viewport()        -> { width, height }
//   goto(url)         -> navega (Page.navigate / page.goto) — navegação não é "injeção"
//   screenshot(abs)   -> grava PNG do VIEWPORT (o que um humano vê) em disco
//   boxOf(selectors[])-> primeira caixa {x,y,width,height} que casar, ou null  (via CDP DOM/locator)
//   gridCodes()       -> [code...] dos posts visíveis na grade (lê href via DOM, sem rodar JS da página)
//   moveMouse(x,y)    -> 1 passo de movimento do cursor
//   click(x,y)        -> down+up trusted no ponto
//   wheel(x,y,dy)     -> evento de RODA real no ponto (dy>0 desce)
//   keyEscape()       -> ESC (fecha modal)
//   close()
import fs from 'fs'
import path from 'path'
import {
  sleep, rand, randInt, chance, caminhoMouse, planoDeRolagem, tempoDoPostMs,
  pastaDoPost, nomeShot, escreverManifest,
} from './util.mjs'

// ---- gestos humanos (independentes do motor) ----
let _mx = 640, _my = 400 // posição corrente do cursor (espelho local)

async function moverPara(driver, x, y) {
  const passos = randInt(10, 26)
  for (const [px, py] of caminhoMouse(_mx, _my, x, y, passos)) {
    await driver.moveMouse(px, py)
    await sleep(rand(6, 22))
  }
  _mx = x; _my = y
}

async function clicarHumano(driver, box) {
  const x = box.x + box.width * rand(0.3, 0.7)
  const y = box.y + box.height * rand(0.3, 0.7)
  await moverPara(driver, x, y)
  await sleep(rand(120, 520)) // tempo de reação antes do clique
  await driver.click(x, y)
}

async function rolarComRoda(driver, box, passos) {
  const cx = box.x + box.width * rand(0.4, 0.6)
  const cy = box.y + box.height * rand(0.3, 0.7)
  await moverPara(driver, cx, cy)
  for (const passo of planoDeRolagem(passos)) {
    if (passo.delta) await driver.wheel(cx, cy, passo.delta)
    await sleep(passo.pausa)
  }
}

async function pausaLeitura(min = 2000, max = 6000) { await sleep(rand(min, max)) }
async function microPausa(min = 350, max = 1600) { await sleep(rand(min, max)) }

// espera o modal de curtidores aparecer (poll na caixa do dialog)
async function esperarDialog(driver, timeoutMs = 7000) {
  const fim = Date.now() + timeoutMs
  while (Date.now() < fim) {
    const b = await driver.boxOf(['div[role="dialog"]'])
    if (b && b.width > 100 && b.height > 100) return b
    await sleep(rand(250, 600))
  }
  return null
}

const SEL_CURTIDAS = [
  'a[href$="/liked_by/"]',
  'section a[href*="/liked_by/"]',
  'a[href*="liked_by"]',
]

// ---- captura de UM post: entra, grava URL+data(print), abre curtidas, rola+printa ----
async function capturarPost(driver, opts, code, idx, total) {
  const url = `https://www.instagram.com/p/${code}/`
  const dir = pastaDoPost(opts.shotsDir, opts.target, code)
  const manifest = {
    target: opts.target, code, url, engine: driver.info().nome,
    capturadoEm: new Date().toISOString(), postShots: [], likeShots: [], modalAbriu: false,
  }

  await driver.goto(url)
  await pausaLeitura()                         // "olhando o post"
  // print do POST: captura autor, DATA, legenda e a contagem de curtidas (o parser lê a data daqui)
  const postShot = nomeShot('post', 1)
  await driver.screenshot(path.join(dir, postShot))
  manifest.postShots.push(postShot)
  // às vezes a pessoa rola o próprio post um tiquinho antes
  if (chance(0.5)) { await rolarComRoda(driver, { x: 0, y: 0, ...driver.viewport() }, randInt(1, 2)); await microPausa() }

  // abrir os curtidores (clique no link "curtidas")
  let alvo = await driver.boxOf(SEL_CURTIDAS)
  if (!alvo && driver.boxOfText) alvo = await driver.boxOfText(/curtida|curtir|like|gostei/i)
  if (!alvo) { escreverManifest(dir, manifest); return { code, modalAbriu: false, shots: 1 } }

  await clicarHumano(driver, alvo)
  const dialog = await esperarDialog(driver)
  if (!dialog) { escreverManifest(dir, manifest); return { code, modalAbriu: false, shots: 1 } }
  manifest.modalAbriu = true
  await microPausa(700, 1800)

  // LOOP: rola o modal com a roda e tira print a cada passo, até esgotar o
  // TEMPO ALEATÓRIO do post (15-200s). Overlap entre prints é OK — o parser
  // deduplica. Teto de prints p/ não explodir disco em posts gigantes.
  const tempoMs = tempoDoPostMs(opts.minS, opts.maxS)
  const fim = Date.now() + tempoMs
  const maxShots = opts.maxShots
  let n = 0
  while (Date.now() < fim && n < maxShots) {
    // re-localiza o dialog (ele pode re-renderizar)
    const dlg = (await driver.boxOf(['div[role="dialog"]'])) || dialog
    const shot = nomeShot('likes', ++n)
    await driver.screenshot(path.join(dir, shot))
    manifest.likeShots.push(shot)
    await rolarComRoda(driver, dlg, randInt(1, 2))
    await sleep(rand(400, 1100))
  }
  // se sobrou tempo (lista curta, atingiu estabilidade visual cedo), fica "lendo" parado
  while (Date.now() < fim) { await sleep(rand(1500, 4000)); if (chance(0.3)) { const dlg = (await driver.boxOf(['div[role="dialog"]'])) || dialog; await rolarComRoda(driver, dlg, 1) } }

  // fecha o modal como humano, com atraso
  await microPausa(400, 1500)
  await driver.keyEscape()
  await microPausa(500, 1500)

  manifest.shots = manifest.postShots.length + manifest.likeShots.length
  escreverManifest(dir, manifest)
  return { code, modalAbriu: true, shots: manifest.shots, tempoMs }
}

// ---- descoberta de posts pela GRADE do perfil (rolando com a roda) ----
async function descobrirPosts(driver, opts) {
  await driver.goto(`https://www.instagram.com/${opts.target}/`)
  await pausaLeitura(2500, 6500)
  const codes = []
  const vistos = new Set()
  const vp = driver.viewport()
  let estavel = 0
  for (let i = 0; i < 50 && codes.length < opts.numPosts && estavel < 5; i++) {
    let novos = []
    try { novos = await driver.gridCodes() } catch {}
    const antes = vistos.size
    for (const c of novos) if (c && !vistos.has(c)) { vistos.add(c); codes.push(c) }
    if (vistos.size === antes) estavel++; else estavel = 0
    await rolarComRoda(driver, { x: 0, y: 0, width: vp.width, height: vp.height }, randInt(2, 4))
    await sleep(rand(500, 1400))
  }
  return codes.slice(0, opts.numPosts)
}

// ---- orquestração geral ----
export async function rodarCaptura(driver, opts) {
  const ledger = carregarLedger(opts.ledgerFile)
  await driver.goto('https://www.instagram.com/')
  await pausaLeitura(3000, 7000)
  // warm-up: rola o feed um pouco como quem abriu o app
  const vp = driver.viewport()
  await rolarComRoda(driver, { x: 0, y: 0, width: vp.width, height: vp.height }, randInt(2, 5))
  await microPausa(800, 2500)

  let fila = await descobrirPosts(driver, opts)
  if (!opts.force) fila = fila.filter((c, i) => i < opts.recent || !ledger.done[c]) // recentes sempre; resto só se novo
  if (!fila.length) { return { posts: 0, motivo: 'nada_novo' } }

  const resultados = []
  let falhasSeguidas = 0
  let desdeDescanso = 0
  let loteAlvo = randInt(3, 7)
  for (let i = 0; i < fila.length; i++) {
    const code = fila[i]
    let r
    try { r = await capturarPost(driver, opts, code, i + 1, fila.length) }
    catch (e) { r = { code, modalAbriu: false, erro: String(e && e.message || e) } }
    resultados.push(r)
    if (r.modalAbriu) { falhasSeguidas = 0; ledger.done[code] = Math.floor(Date.now() / 1000); salvarLedger(opts.ledgerFile, ledger) }
    else {
      falhasSeguidas++
      // ABORT-ON-BLOQUEIO (regra #1): modal não abriu em N posts seguidos = sinal
      // de bloqueio. PARA na hora — não martela (martelar transforma bloqueio
      // curto em ban). O print do post ainda fica salvo p/ auditar visualmente.
      if (falhasSeguidas >= opts.maxFalhas) {
        return { posts: resultados.length, resultados, abortado: true, motivo: 'modal_nao_abriu_possivel_bloqueio' }
      }
    }
    if (i < fila.length - 1) {
      // pequena transição entre posts (o tempo grande já foi gasto DENTRO do post)
      await sleep(rand(2000, 8000))
      // distração ocasional: volta pro feed e rola (como gente faz)
      if (chance(0.15)) { await driver.goto('https://www.instagram.com/'); await pausaLeitura(); await rolarComRoda(driver, { x: 0, y: 0, width: vp.width, height: vp.height }, randInt(1, 3)) }
      // descanso longo a cada 3-7 posts ("largou o celular")
      if (++desdeDescanso >= loteAlvo) { desdeDescanso = 0; loteAlvo = randInt(3, 7); await sleep(rand(45000, 150000)) }
    }
  }
  return { posts: resultados.length, resultados, abortado: false }
}

function carregarLedger(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return { done: {} } } }
function salvarLedger(f, l) { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(l)) } catch {} }
