import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'

// Cadastra um chip novo no pool. O QR aparece depois na config whatsapp_qr_<id> (worker).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const rotulo = typeof body?.rotulo === 'string' ? body.rotulo.trim() : ''
  if (!rotulo) return NextResponse.json({ erro: 'rotulo obrigatório' }, { status: 400 })
  const id = randomUUID()
  const n = await prisma.whatsappNumero.create({ data: { id, rotulo, sessionPath: `.whatsapp-auth/${id}` } })
  return NextResponse.json({ id: n.id, rotulo, aviso: 'O QR de pareamento aparece nesta página em até 1 minuto.' })
}
