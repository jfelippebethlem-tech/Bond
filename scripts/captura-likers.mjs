// CAPTURA "QUEM CURTIU" — RODA SÓ NO DESKTOP (IP residencial). NUNCA na VM.
//
// Usa um PERFIL DE NAVEGADOR DEDICADO (IG_PROFILE_DIR): voce loga no Instagram
// UMA vez nele e a sessao fica salva + se renova sozinha. Sem copiar cookie.
// Metodo de captura: in-page (API interna do IG) = ban-safe. RESUMÍVEL.
//
// Status: escreve likers-status.json na pasta sincronizada -> a VM le e te AVISA
// no Telegram se precisar logar de novo.
//
// .env LOCAL (desktop): IG_CAPTURE_LOCAL=true, IG_NUM_POSTS=30,
//   LIKERS_OUT_DIR=C:\jfn\likers-sync, IG_PROFILE_DIR=C:\jfn\ig-profile,
//   IG_INTERACTIVE=true (quando rodado por voce, pra poder logar)
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'

if (process.env.IG_CAPTURE_LOCAL !== 'true') {
  console.error('⛔ Recusado. IG_CAPTURE_LOCAL=true so no .env do DESKTOP. NUNCA na VM (IP datacenter = ban).')
  process.exit(1)
}
const NUM_POSTS = Math.max(1, parseInt(process.env.IG_NUM_POSTS || '30', 10))
const OUT = process.env.LIKERS_OUT_DIR || '.'
const PROFILE = process.env.IG_PROFILE_DIR || path.join(process.cwd(), 'ig-profile')
const INTERATIVO = process.env.IG_INTERACTIVE === 'true'
const STATE_FILE = path.join(process.cwd(), 'likers-state.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = (a, b) => a + Math.random() * (b - a)
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return null } }
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s))

function escreverStatus(ok, erro) {
  try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'likers-status.json'), JSON.stringify({ ok, erro: erro || null, quando: new Date().toISOString() })) } catch {}
}
function gravarSaida(contagem) {
  const ranking = Object.entries(contagem).map(([username, curtidas]) => ({ username, curtidas })).sort((a, b) => b.curtidas - a.curtidas)
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'likers.json'), JSON.stringify(ranking, null, 2))
  fs.writeFileSync(path.join(OUT, 'likers.csv'), 'username,curtidas\n' + ranking.map((r) => `${r.username},${r.curtidas}`).join('\n'))
  return ranking
}
async function dsUserIdDo(ctx) {
  const cookies = await ctx.cookies('https://www.instagram.com')
  return (cookies.find((c) => c.name === 'ds_user_id') || {}).value
}
const estaLogado = (page) => !page.url().includes('/accounts/login')

async function getPostIds(page, dsUserId, numPosts) {
  return page.evaluate(async ({ dsUserId, numPosts }) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || ''
    const headers = { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrf }
    const ids = []; let maxId = null
    while (ids.length < numPosts) {
      let url = `https://www.instagram.com/api/v1/feed/user/${dsUserId}/?count=12`
      if (maxId) url += `&max_id=${maxId}`
      const r = await fetch(url, { headers, credentials: 'include' })
      if (!r.ok) break
      const d = await r.json()
      for (const it of (d.items || [])) ids.push(String(it.pk || it.id))
      if (!d.more_available || !d.next_max_id) break
      maxId = d.next_max_id
      await new Promise((x) => setTimeout(x, 2000 + Math.random() * 2000))
    }
    return ids.slice(0, numPosts)
  }, { dsUserId, numPosts })
}
async function getLikers(page, pid) {
  return page.evaluate(async ({ pid }) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || ''
    const headers = { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrf }
    const r = await fetch(`https://www.instagram.com/api/v1/media/${pid}/likers/`, { headers, credentials: 'include' })
    if (r.status === 429) return { rateLimited: true }
    if (!r.ok) return { error: r.status }
    const d = await r.json()
    return { users: (d.users || []).map((u) => u.username).filter(Boolean) }
  }, { pid })
}

async function main() {
  fs.mkdirSync(PROFILE, { recursive: true })
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, locale: 'pt-BR', viewport: { width: 1280, height: 820 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  // Login: usa o perfil salvo; se preciso e interativo, espera voce logar.
  if (!estaLogado(page)) {
    if (INTERATIVO) {
      console.log('🔑 Faca login no Instagram na janela que abriu (com 2FA). Aguardando ate 3 min...')
      for (let i = 0; i < 18 && !estaLogado(page); i++) await page.waitForTimeout(10000)
    }
    if (!estaLogado(page)) {
      console.log('⛔ Nao logado. Avisando pelo Telegram (a VM manda) e saindo.')
      escreverStatus(false, 'precisa_login') // a VM le isso e te avisa no Telegram
      await ctx.close(); process.exit(2)
    }
  }
  const dsUserId = await dsUserIdDo(ctx)
  if (!dsUserId) { escreverStatus(false, 'sem_ds_user_id'); await ctx.close(); process.exit(2) }

  // Retoma ou inicia
  let state = loadState()
  if (state && Array.isArray(state.pending) && state.pending.length) {
    console.log(`↺ Retomando: ${state.done.length} feitos, ${state.pending.length} restantes.`)
  } else {
    console.log(`▶ Nova captura dos ${NUM_POSTS} posts recentes...`)
    const ids = await getPostIds(page, dsUserId, NUM_POSTS)
    if (!ids.length) { escreverStatus(false, 'sem_posts_ou_sessao_invalida'); await ctx.close(); process.exit(2) }
    state = { contagem: {}, done: [], pending: ids }; saveState(state)
    console.log(`  ${ids.length} posts na fila.`)
  }

  const total = state.done.length + state.pending.length
  while (state.pending.length) {
    const pid = state.pending[0]
    const res = await getLikers(page, pid)
    if (res.rateLimited) { console.log('  429 — pausa 60s (estado salvo).'); saveState(state); await sleep(60000); continue }
    if (res.users) for (const u of res.users) state.contagem[u] = (state.contagem[u] || 0) + 1
    state.done.push(pid); state.pending.shift(); saveState(state); gravarSaida(state.contagem)
    console.log(`  [${state.done.length}/${total}] ${pid} -> ${res.users ? res.users.length : 'erro ' + res.error}`)
    await sleep(rand(3000, 7000))
  }

  await ctx.close()
  const ranking = gravarSaida(state.contagem)
  escreverStatus(true, null)
  try { fs.unlinkSync(STATE_FILE) } catch {}
  console.log(`✅ Completo. ${ranking.length} curtidores em ${OUT}/likers.json`)
  console.log('Top 10:', ranking.slice(0, 10).map((r) => `${r.username}(${r.curtidas})`).join(', '))
}
main().catch((e) => { console.error(e); escreverStatus(false, 'erro: ' + (e.message || e)); process.exit(1) })
