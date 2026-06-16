// CAPTURA "QUEM CURTIU" — RODA SÓ NO DESKTOP (IP residencial). NUNCA na VM.
//
// A VM tem IP de datacenter -> o Instagram bane na hora. Por isso este script
// EXIGE a flag IG_CAPTURE_LOCAL=true (que só deve existir no .env do desktop).
//
// Pré-requisitos no desktop:
//   npm i playwright dotenv  &&  npx playwright install chromium
//   .env (LOCAL, do desktop) com:
//     IG_CAPTURE_LOCAL=true
//     IG_SESSIONID=...
//     IG_DS_USER_ID=...
//     IG_CSRFTOKEN=...
//     IG_PERFIL=depjorgefelippeneto
//     BOND_INGEST_URL=http://159.112.188.8:3000/api/ingest
//     INGEST_TOKEN=...            (o mesmo da VM)
//     IG_NUM_POSTS=12             (opcional; comece pequeno)
//
// Uso:  node scripts/captura-likers.mjs
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'

// ── Travas de segurança ──────────────────────────────────────────────
if (process.env.IG_CAPTURE_LOCAL !== 'true') {
  console.error('⛔ Recusado. Defina IG_CAPTURE_LOCAL=true no .env do DESKTOP. NUNCA rode na VM (IP de datacenter = ban).')
  process.exit(1)
}
const { IG_SESSIONID, IG_DS_USER_ID, IG_CSRFTOKEN } = process.env
if (!IG_SESSIONID || !IG_DS_USER_ID || !IG_CSRFTOKEN) {
  console.error('⛔ Faltam cookies no .env: IG_SESSIONID, IG_DS_USER_ID, IG_CSRFTOKEN.')
  process.exit(1)
}
const PERFIL = process.env.IG_PERFIL || 'depjorgefelippeneto'
const NUM_POSTS = Math.max(1, Math.min(40, parseInt(process.env.IG_NUM_POSTS || '12', 10)))
const INGEST_URL = process.env.BOND_INGEST_URL
const INGEST_TOKEN = process.env.INGEST_TOKEN

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = (a, b) => Math.floor(a + Math.random() * (b - a))

// Detecta bloqueio/desafio do Instagram na página atual.
async function bloqueado(page) {
  const txt = (await page.content()).toLowerCase()
  return /try again later|tente novamente mais tarde|ação bloqueada|action blocked|challenge_required|desafio de seguran/.test(txt)
}

async function main() {
  console.log(`▶ Capturando os ${NUM_POSTS} posts mais recentes de @${PERFIL} (somente leitura, com pausas humanas)…`)
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 820 } })
  await ctx.addCookies([
    { name: 'sessionid', value: IG_SESSIONID, domain: '.instagram.com', path: '/' },
    { name: 'ds_user_id', value: IG_DS_USER_ID, domain: '.instagram.com', path: '/' },
    { name: 'csrftoken', value: IG_CSRFTOKEN, domain: '.instagram.com', path: '/' },
  ])
  const page = await ctx.newPage()

  // 1) Coleta links dos posts/reels mais recentes
  await page.goto(`https://www.instagram.com/${PERFIL}/`, { waitUntil: 'domcontentloaded' })
  await sleep(rand(2500, 4500))
  if (await bloqueado(page)) { console.error('⛔ Instagram bloqueou já no perfil. PARE e tente mais tarde.'); await browser.close(); process.exit(2) }
  const links = await page.evaluate(() => {
    const set = new Set()
    document.querySelectorAll('a[href*="/p/"],a[href*="/reel/"]').forEach((a) => {
      const m = a.getAttribute('href').match(/\/(p|reel)\/[^/]+\//)
      if (m) set.add(m[0])
    })
    return Array.from(set)
  })
  const alvos = links.slice(0, NUM_POSTS)
  console.log(`  encontrei ${links.length} posts; vou processar ${alvos.length}.`)

  // 2) Para cada post, abre liked_by e coleta os usernames
  const contagem = new Map() // username -> nº de posts curtidos
  let processados = 0
  for (const rel of alvos) {
    const url = `https://www.instagram.com${rel}liked_by/`
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await sleep(rand(1500, 3000))
    if (await bloqueado(page)) { console.error('⛔ Bloqueio detectado. PARANDO agora.'); break }
    try {
      await page.waitForSelector('div[role="dialog"]', { timeout: 8000 })
    } catch { console.log(`  (sem modal de curtidas em ${rel} — pulando)`); continue }

    const vistos = new Set()
    let estavel = 0
    for (let i = 0; i < 40 && estavel < 3; i++) {
      const novos = await page.evaluate(() => {
        const out = []
        document.querySelectorAll('div[role="dialog"] a[href^="/"]').forEach((a) => {
          const h = a.getAttribute('href')
          const m = h && h.match(/^\/([A-Za-z0-9._]+)\/$/)
          if (m) out.push(m[1])
        })
        return out
      })
      const antes = vistos.size
      novos.forEach((u) => vistos.add(u))
      await page.evaluate(() => {
        const d = document.querySelector('div[role="dialog"]')
        const sc = d && d.querySelector('div[style*="overflow"], ul, div')
        ;(sc || d)?.scrollBy(0, 600)
      })
      await sleep(rand(900, 1800))
      estavel = vistos.size === antes ? estavel + 1 : 0
    }
    vistos.forEach((u) => contagem.set(u, (contagem.get(u) || 0) + 1))
    processados++
    console.log(`  [${processados}/${alvos.length}] ${rel} → ${vistos.size} curtidores`)
    await sleep(rand(4000, 9000)) // pausa humana entre posts
  }

  await browser.close()

  // 3) Monta ranking e salva
  const ranking = Array.from(contagem.entries())
    .map(([username, curtidas]) => ({ username, curtidas }))
    .sort((a, b) => b.curtidas - a.curtidas)
  // Escreve na pasta SINCRONIZADA (Syncthing) se LIKERS_OUT_DIR estiver setado.
  const OUT = process.env.LIKERS_OUT_DIR || '.'
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'likers.json'), JSON.stringify(ranking, null, 2))
  fs.writeFileSync(path.join(OUT, 'likers.csv'), 'username,curtidas\n' + ranking.map((r) => `${r.username},${r.curtidas}`).join('\n'))
  console.log(`✅ ${processados} posts, ${ranking.length} curtidores únicos. Salvo em: ${OUT}/likers.json (Syncthing leva pra VM)`)
  console.log('Top 10:', ranking.slice(0, 10).map((r) => `${r.username}(${r.curtidas})`).join(', '))

  // 4) Empurra pra VM (se configurado)
  if (INGEST_URL && INGEST_TOKEN && ranking.length) {
    try {
      const res = await fetch(INGEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ingest-token': INGEST_TOKEN },
        body: JSON.stringify({ curtidores: ranking }),
      })
      const d = await res.json()
      console.log('↑ Enviado pra VM:', JSON.stringify(d))
    } catch (e) {
      console.error('Falha ao enviar pra VM (mas o likers.json está salvo):', String(e))
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
