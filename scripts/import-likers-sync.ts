// Importador da VM: lê o likers.json que o DESKTOP escreveu na pasta sincronizada
// (Syncthing) e grava no monitor (BondFa). Roda na VM, a cada 5 min via cron.
// NÃO toca no Instagram — só ingere o arquivo que o Syncthing trouxe.
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const ARQ = process.env.LIKERS_SYNC_FILE || path.join(os.homedir(), 'likers-sync', 'likers.json')
const MARCA = path.join(os.homedir(), '.likers_imported') // fora da pasta sincronizada (receiveonly)

async function main() {
  if (!fs.existsSync(ARQ)) { console.log(`[${new Date().toISOString()}] sem ${ARQ} ainda`); return }
  const mtime = fs.statSync(ARQ).mtimeMs.toString()
  const ultimo = fs.existsSync(MARCA) ? fs.readFileSync(MARCA, 'utf8').trim() : ''
  if (mtime === ultimo) { return } // nada novo

  let itens: { username?: string; curtidas?: number }[] = []
  try { itens = JSON.parse(fs.readFileSync(ARQ, 'utf8')) } catch (e) { console.error('JSON inválido:', String(e)); return }
  if (!Array.isArray(itens)) { console.error('esperava um array'); return }

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
