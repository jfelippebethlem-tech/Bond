// CAPTURA "QUEM CURTIU" — RODA SÓ NO DESKTOP (IP residencial). NUNCA na VM.
//
// Método: igual ao InstagramLikesLeaderboard — busca IN-PAGE pela API interna do
// IG (com o cookie da sessao + header x-ig-app-id). Parece a navegacao normal do
// app -> ban-safe. Roda dentro da pagina via Playwright (headless:false).
//
// .env LOCAL (desktop):
//   IG_CAPTURE_LOCAL=true
//   IG_SESSIONID=...  IG_DS_USER_ID=...  IG_CSRFTOKEN=...
//   IG_NUM_POSTS=30           (quantos posts recentes; pode crescer com calma)
//   LIKERS_OUT_DIR=C:\jfn\likers-sync   (pasta do Syncthing -> VM)
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'

if (process.env.IG_CAPTURE_LOCAL !== 'true') {
  console.error('⛔ Recusado. IG_CAPTURE_LOCAL=true so deve existir no .env do DESKTOP. NUNCA na VM (IP de datacenter = ban).')
  process.exit(1)
}
const { IG_SESSIONID, IG_DS_USER_ID, IG_CSRFTOKEN } = process.env
if (!IG_SESSIONID || !IG_DS_USER_ID || !IG_CSRFTOKEN) {
  console.error('⛔ Faltam cookies: IG_SESSIONID, IG_DS_USER_ID, IG_CSRFTOKEN.')
  process.exit(1)
}
const NUM_POSTS = Math.max(1, parseInt(process.env.IG_NUM_POSTS || '30', 10))
const OUT = process.env.LIKERS_OUT_DIR || '.'

async function main() {
  console.log(`▶ Capturando curtidores dos ${NUM_POSTS} posts recentes (metodo in-page, com pausas)...`)
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 820 } })
  await ctx.addCookies([
    { name: 'sessionid', value: IG_SESSIONID, domain: '.instagram.com', path: '/' },
    { name: 'ds_user_id', value: IG_DS_USER_ID, domain: '.instagram.com', path: '/' },
    { name: 'csrftoken', value: IG_CSRFTOKEN, domain: '.instagram.com', path: '/' },
  ])
  const page = await ctx.newPage()
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  // Toda a captura roda DENTRO da pagina (mesmas requisicoes do app).
  const dados = await page.evaluate(async ({ dsUserId, numPosts }) => {
    const APP_ID = '936619743392459'
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const rand = (a, b) => a + Math.random() * (b - a)
    const csrftoken = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || ''
    const headers = { 'x-ig-app-id': APP_ID, 'x-csrftoken': csrftoken }
    const log = []

    // Fase 1: posts recentes (paginado por next_max_id)
    const postIds = []
    let maxId = null
    while (postIds.length < numPosts) {
      let url = `https://www.instagram.com/api/v1/feed/user/${dsUserId}/?count=12`
      if (maxId) url += `&max_id=${maxId}`
      const r = await fetch(url, { headers, credentials: 'include' })
      if (!r.ok) { log.push(`feed HTTP ${r.status}`); break }
      const d = await r.json()
      for (const it of (d.items || [])) postIds.push(String(it.pk || it.id))
      if (!d.more_available || !d.next_max_id) break
      maxId = d.next_max_id
      await sleep(rand(2000, 4000))
    }
    const alvos = postIds.slice(0, numPosts)
    log.push(`posts coletados: ${alvos.length}`)

    // Fase 2: quem curtiu cada post
    const contagem = {}
    let feitos = 0
    for (const pid of alvos) {
      const r = await fetch(`https://www.instagram.com/api/v1/media/${pid}/likers/`, { headers, credentials: 'include' })
      if (r.status === 429) { log.push('429 - pausando 60s'); await sleep(60000); continue }
      if (!r.ok) { log.push(`likers ${pid} HTTP ${r.status}`); await sleep(rand(3000, 6000)); continue }
      const d = await r.json()
      for (const u of (d.users || [])) {
        if (u.username) contagem[u.username] = (contagem[u.username] || 0) + 1
      }
      feitos++
      await sleep(rand(3000, 7000)) // pausa humana entre posts
    }
    log.push(`posts processados: ${feitos}`)
    return { contagem, log }
  }, { dsUserId: IG_DS_USER_ID, numPosts: NUM_POSTS })

  await browser.close()
  dados.log.forEach((l) => console.log('  ' + l))

  const ranking = Object.entries(dados.contagem)
    .map(([username, curtidas]) => ({ username, curtidas }))
    .sort((a, b) => b.curtidas - a.curtidas)

  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'likers.json'), JSON.stringify(ranking, null, 2))
  fs.writeFileSync(path.join(OUT, 'likers.csv'), 'username,curtidas\n' + ranking.map((r) => `${r.username},${r.curtidas}`).join('\n'))
  console.log(`✅ ${ranking.length} curtidores. Salvo em ${OUT}/likers.json (Syncthing leva pra VM).`)
  console.log('Top 10:', ranking.slice(0, 10).map((r) => `${r.username}(${r.curtidas})`).join(', '))
  if (!ranking.length) console.log('⚠️ 0 curtidores — provavel cookie expirado. Pegue um sessionid novo (F12>Application>Cookies).')
}
main().catch((e) => { console.error(e); process.exit(1) })
