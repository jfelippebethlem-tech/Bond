import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { dispararCampanha, validarCorpoDisparo } from '@/lib/disparo'

export async function GET() {
  const [campanhas, numeros] = await Promise.all([
    prisma.disparo.findMany({ orderBy: { criadoEm: 'desc' }, take: 30 }),
    prisma.whatsappNumero.findMany({ orderBy: { criadoEm: 'asc' } }),
  ])
  // Estado de conexão + QR por chip (o worker grava em Configuracao whatsapp_status_/qr_<id>)
  const chaves = numeros.flatMap((n) => [`whatsapp_status_${n.id}`, `whatsapp_qr_${n.id}`])
  const configs = chaves.length ? await prisma.configuracao.findMany({ where: { chave: { in: chaves } } }) : []
  const cfg = Object.fromEntries(configs.map((c) => [c.chave, c.valor]))
  const numerosComConexao = numeros.map((n) => ({
    ...n,
    conexao: cfg[`whatsapp_status_${n.id}`] || 'aguardando worker',
    qr: cfg[`whatsapp_qr_${n.id}`] || null,
  }))
  return NextResponse.json({ campanhas, numeros: numerosComConexao })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const v = validarCorpoDisparo(body)
  if (!v.ok || !v.valor) return NextResponse.json({ erro: v.erro }, { status: 400 })
  const r = await dispararCampanha(v.valor)
  return NextResponse.json(r)
}
