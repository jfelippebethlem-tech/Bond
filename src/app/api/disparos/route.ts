import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { dispararCampanha, validarCorpoDisparo } from '@/lib/disparo'

export async function GET() {
  const [campanhas, numeros] = await Promise.all([
    prisma.disparo.findMany({ orderBy: { criadoEm: 'desc' }, take: 30 }),
    prisma.whatsappNumero.findMany({ orderBy: { criadoEm: 'asc' } }),
  ])
  return NextResponse.json({ campanhas, numeros })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const v = validarCorpoDisparo(body)
  if (!v.ok || !v.valor) return NextResponse.json({ erro: v.erro }, { status: 400 })
  const r = await dispararCampanha(v.valor)
  return NextResponse.json(r)
}
