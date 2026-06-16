// Resumo semanal -> Telegram: top posts da semana (data + começo da legenda +
// métricas) + totais. Roda na VM via cron (sexta à noite).
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const inicio = (t: string, n = 70) => { const s = (t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : (s || '(sem legenda)') }
const dBR = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

async function main() {
  const tok = process.env.TELEGRAM_BOT_TOKEN, owner = process.env.TELEGRAM_OWNER_ID
  if (!tok || !owner) { console.log('sem telegram no .env'); return }
  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const posts = await prisma.bondPost.findMany({ where: { publicadoEm: { gte: desde } }, orderBy: { likes: 'desc' } })
  const totLikes = posts.reduce((s, p) => s + (p.likes || 0), 0)
  const totCom = posts.reduce((s, p) => s + (p.comentarios || 0), 0)
  // curtidores importados (do desktop) — quantos no total
  const curtidores = await prisma.bondFa.count({ where: { plataforma: 'instagram', totalLikes: { gt: 0 } } })

  const top = posts.slice(0, 5)
  const linhasTop = top.length
    ? top.map((p, i) => `${i + 1}. <b>${(p.likes || 0).toLocaleString('pt-BR')}❤️ ${(p.comentarios || 0)}💬</b> (${dBR(new Date(p.publicadoEm))})\n   <i>${inicio(p.conteudo)}</i>`).join('\n')
    : '(nenhum post novo nos últimos 7 dias)'

  const msg = [
    '📊 <b>RESUMO DA SEMANA</b>',
    '',
    `Posts (7 dias): <b>${posts.length}</b>  ·  ❤️ <b>${totLikes.toLocaleString('pt-BR')}</b>  ·  💬 <b>${totCom.toLocaleString('pt-BR')}</b>`,
    curtidores ? `Curtidores no ranking: <b>${curtidores.toLocaleString('pt-BR')}</b>` : '',
    '',
    '🏆 <b>Top posts da semana:</b>',
    linhasTop,
    '',
    'Detalhes em /posts e /curtidores no painel.',
  ].filter(Boolean).join('\n')

  await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: owner, parse_mode: 'HTML', disable_web_page_preview: true, text: msg }),
  })
  console.log(`[${new Date().toISOString()}] resumo semanal enviado (${posts.length} posts).`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
