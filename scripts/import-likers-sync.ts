// Importador da VM: lê o likers.json que o DESKTOP escreveu na pasta sincronizada
// (Syncthing) e grava no monitor (BondFa). Roda na VM, a cada 5 min via cron.
// NÃO toca no Instagram — só ingere o arquivo que o Syncthing trouxe.
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
// Resolve o likers.json de forma ROBUSTA: o desktop escreve em LIKERS_OUT_DIR
// (ex.: C:\jfn\bond\likers-sync) e o Syncthing pode aninhar isso dentro da raiz
// sincronizada -> o arquivo cai em ~/likers-sync/likers-sync/likers.json, não em
// ~/likers-sync/likers.json. Antes o importador olhava só o caminho raso e nunca
// achava (bug "site não foi alimentado"). Agora: env explícito -> senão varre
// ~/likers-sync e pega a likers.json MAIS RECENTE (ignora node_modules/.stversions).
function acharMaisRecente(nome: string, envOverride?: string): string {
  if (envOverride && process.env[envOverride]) return process.env[envOverride] as string
  const base = path.join(os.homedir(), 'likers-sync')
  const achados: string[] = []
  const ignorar = new Set(['node_modules', '.stversions', '.git', '.next'])
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (ignorar.has(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.name === nome) achados.push(p)
    }
  }
  walk(base, 0)
  if (!achados.length) return path.join(base, nome)
  achados.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return achados[0]
}
const ARQ = acharMaisRecente('likers.json', 'LIKERS_SYNC_FILE')
const MARCA = path.join(os.homedir(), '.likers_imported') // fora da pasta sincronizada (receiveonly)
// STATUS tambem pelo walker (Licao 10: estava em caminho raso fixo -> nunca achava o aninhado -> aviso Telegram nao disparava)
const STATUS = acharMaisRecente('likers-status.json')
const STATUS_MARCA = path.join(os.homedir(), '.likers_status_avisado')

// Lê o status da captura (escrito pelo desktop) e AVISA no Telegram se precisar logar.
async function checarStatusEAvisar() {
  if (!fs.existsSync(STATUS)) return
  let st: { ok?: boolean; erro?: string; quando?: string }
  try { st = JSON.parse(fs.readFileSync(STATUS, 'utf8')) } catch { return }
  if (st.ok) return
  const chave = `${st.quando}|${st.erro}`
  const ultimo = fs.existsSync(STATUS_MARCA) ? fs.readFileSync(STATUS_MARCA, 'utf8').trim() : ''
  if (chave === ultimo) return // já avisei desse evento
  const tok = process.env.TELEGRAM_BOT_TOKEN, owner = process.env.TELEGRAM_OWNER_ID
  if (!tok || !owner) return
  const msg = st.erro === 'precisa_login' || st.erro === 'sem_posts_ou_sessao_invalida'
    ? '⚠️ A captura de curtidores precisa que você LOGUE de novo no Instagram (no perfil dedicado do desktop). Abra C:\\jfn\\bond e rode bond-likers.ps1 — a janela abre, você loga (2FA) e pronto. Depois disso volta a rodar sozinho toda sexta.'
    : `⚠️ A captura de curtidores teve um problema: ${st.erro}. Confira o desktop (bond-likers-log.txt).`
  try {
    await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: owner, text: msg }) })
    fs.writeFileSync(STATUS_MARCA, chave)
    console.log(`[${new Date().toISOString()}] avisei no Telegram: ${st.erro}`)
  } catch { /* rede */ }
}

async function main() {
  await checarStatusEAvisar()
  if (!fs.existsSync(ARQ)) { return }
  const mtime = fs.statSync(ARQ).mtimeMs.toString()
  const ultimo = fs.existsSync(MARCA) ? fs.readFileSync(MARCA, 'utf8').trim() : ''
  if (mtime === ultimo) { return } // nada novo

  let j: any
  try { j = JSON.parse(fs.readFileSync(ARQ, 'utf8')) } catch (e) { console.error('JSON inválido:', String(e)); return }
  // Normaliza: nosso formato simples OU export/localStorage do Leaderboard.
  let arr: any[] = []
  if (Array.isArray(j)) arr = j
  else if (j?.likerMap && typeof j.likerMap === 'object') arr = Object.values(j.likerMap)
  else if (Array.isArray(j?.followingLeaderboard) || Array.isArray(j?.notFollowingLeaderboard)) arr = [...(j.followingLeaderboard || []), ...(j.notFollowingLeaderboard || [])]
  const norm = new Map<string, number>()
  for (const o of arr) {
    const u = String((o?.user && o.user.username) ?? o?.username ?? '').replace(/^@/, '').trim()
    if (!u) continue
    const n = Math.max(0, Math.round(Number(o?.likesCount ?? o?.curtidas ?? o?.likes ?? o?.count ?? 0) || 0))
    norm.set(u, Math.max(norm.get(u) ?? 0, n))
  }
  const itens = Array.from(norm.entries()).map(([username, curtidas]) => ({ username, curtidas }))
  if (!itens.length) { return }

  let ok = 0
  for (const it of itens) {
    const u = (it.username || '').trim().replace(/^@/, '')
    if (!u) continue
    const n = Math.max(0, Math.round(Number(it.curtidas) || 0))
    await prisma.bondFa.upsert({
      where: { plataforma_externalId: { plataforma: 'instagram', externalId: u } },
      update: { username: u, nome: u, totalLikes: n, ultimaInter: new Date() },
      create: { plataforma: 'instagram', externalId: u, username: u, nome: u, totalLikes: n, ultimaInter: new Date() },
    })
    ok++
  }
  fs.writeFileSync(MARCA, mtime)
  console.log(`[${new Date().toISOString()}] importados ${ok} curtidores de ${ARQ}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
