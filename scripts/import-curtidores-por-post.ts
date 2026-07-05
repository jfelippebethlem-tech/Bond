// Importador PER-POST dos curtidores do Instagram (habilita filtro por DATA na aba /interações).
//
// O desktop captura, por post, QUEM curtiu — e escreve na pasta sincronizada:
//   posts-curtidores.json  -> { "<post_code>": ["user1", "user2", ...] }   (quem curtiu cada post)
//   posts-meta.json        -> [ { "code", "taken_at" (epoch s), ... } ]      (a DATA de cada post)
// O import-likers-sync.ts só ingere o agregado (likers.json -> BondFa.totalLikes), perdendo a
// dimensão temporal. Aqui gravamos cada par (curtidor × post) DATADO em BondInteracao
// (tipo='like', plataforma='instagram', postId=code, publicadoEm = data do post), que é o que a
// query de /interações filtra por período. Assim "curtidores nos últimos 7 dias" = quem curtiu os
// posts publicados na janela — corretamente, não o acumulado.
//
// NÃO toca no Instagram nem ESCREVE na pasta sincronizada (só lê). Roda na VM via cron, logo após
// o import-likers-sync. Idempotente: re-sincroniza os likes dos posts capturados a cada execução.
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Mesma busca robusta do import-likers-sync: acha o arquivo MAIS RECENTE na pasta sincronizada
// (o Syncthing pode aninhar ~/likers-sync/likers-sync/...). Env override opcional.
function acharMaisRecente(nome: string, envOverride?: string): string {
  if (envOverride && process.env[envOverride]) return process.env[envOverride] as string
  const base = path.join(os.homedir(), 'likers-sync')
  const achados: string[] = []
  const ignorar = new Set(['node_modules', '.stversions', '.git', '.next', '_backup'])
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (ignorar.has(e.name) || e.name.startsWith('_backup')) continue
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

const ARQ_CURT = acharMaisRecente('posts-curtidores.json', 'POSTS_CURTIDORES_FILE')
const ARQ_META = acharMaisRecente('posts-meta.json', 'POSTS_META_FILE')
const MARCA = path.join(os.homedir(), '.curtidores_post_marca')

async function main() {
  const stamp = new Date().toISOString()
  if (!fs.existsSync(ARQ_CURT)) {
    console.log(`[${stamp}] posts-curtidores.json ausente — pulei (${ARQ_CURT})`)
    return
  }
  // Mesmo guard de mtime do import-likers-sync: só re-sincroniza quando o arquivo MUDOU. Sem isso
  // o cron de 5min apagava+reinseria ~98k linhas idênticas a cada run — criadoEm ficava igual em
  // tudo (qualquer orderBy por criadoEm virava loteria) e o SQLite sofria escrita contínua à toa.
  const mtimes = `${fs.statSync(ARQ_CURT).mtimeMs}|${fs.existsSync(ARQ_META) ? fs.statSync(ARQ_META).mtimeMs : 0}`
  const ultimo = fs.existsSync(MARCA) ? fs.readFileSync(MARCA, 'utf8').trim() : ''
  if (mtimes === ultimo) return // nada novo
  let curt: Record<string, string[]>
  try { curt = JSON.parse(fs.readFileSync(ARQ_CURT, 'utf8')) } catch { console.log(`[${stamp}] posts-curtidores.json inválido — pulei`); return }

  // mapa code -> data do post (taken_at em segundos). Sem meta, publicadoEm fica null (cai no criadoEm no filtro).
  const dataDe = new Map<string, Date | null>()
  if (fs.existsSync(ARQ_META)) {
    try {
      const meta: { code?: string; taken_at?: number }[] = JSON.parse(fs.readFileSync(ARQ_META, 'utf8'))
      for (const m of meta) if (m.code) dataDe.set(m.code, m.taken_at ? new Date(m.taken_at * 1000) : null)
    } catch { /* segue sem datas */ }
  }

  const codes = Object.keys(curt)
  const rows: { plataforma: string; externalId: string; tipo: string; postId: string; publicadoEm: Date | null }[] = []
  for (const code of codes) {
    const dt = dataDe.get(code) ?? null
    for (const uRaw of (curt[code] || [])) {
      const u = String(uRaw || '').trim().replace(/^@/, '')
      if (!u) continue
      rows.push({ plataforma: 'instagram', externalId: u, tipo: 'like', postId: code, publicadoEm: dt })
    }
  }

  // Re-sincroniza de forma idempotente: apaga os likes de IG dos posts capturados e reinsere o set atual
  // (reflete des-curtidas e datas atualizadas). Tudo numa transação. createMany em lotes (limite do SQLite).
  const LOTE = 1000
  const ops: any[] = [
    prisma.bondInteracao.deleteMany({ where: { plataforma: 'instagram', tipo: 'like', postId: { in: codes } } }),
  ]
  for (let i = 0; i < rows.length; i += LOTE) {
    ops.push(prisma.bondInteracao.createMany({ data: rows.slice(i, i + LOTE) }))
  }
  await prisma.$transaction(ops)
  fs.writeFileSync(MARCA, mtimes)

  console.log(`[${stamp}] curtidores-por-post: ${rows.length} likes DATADOS em ${codes.length} posts (arq ${path.basename(ARQ_CURT)})`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
