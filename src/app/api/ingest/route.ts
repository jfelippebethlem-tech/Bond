import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Endpoint que RECEBE os curtidores capturados no DESKTOP (IP residencial).
// Protegido por token (header x-ingest-token === INGEST_TOKEN do .env).
// NÃO faz nenhuma chamada ao Instagram — só ingere os dados que o desktop empurrar.
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-ingest-token') || ''
  const esperado = process.env.INGEST_TOKEN || ''
  if (!esperado || token !== esperado) {
    return NextResponse.json({ error: 'token inválido' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const itens: { username?: string; curtidas?: number }[] = Array.isArray(body.curtidores) ? body.curtidores : []
  if (!itens.length) return NextResponse.json({ ok: 0, error: 'sem curtidores no corpo' })

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
  return NextResponse.json({ ok, total: itens.length, recebidoEm: new Date().toISOString() })
}
