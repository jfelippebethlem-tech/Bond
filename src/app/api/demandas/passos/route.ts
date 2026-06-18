import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Passos de execução de uma demanda (colaborativo). Cada passo tem descrição, responsável e check.

// Criar passo: { demandaId, descricao, responsavel? }
export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.demandaId || !body.descricao?.trim()) {
    return NextResponse.json({ error: 'demandaId e descricao são obrigatórios' }, { status: 400 })
  }
  const ordem = await prisma.demandaPasso.count({ where: { demandaId: body.demandaId } })
  const passo = await prisma.demandaPasso.create({
    data: {
      demandaId: body.demandaId,
      descricao: body.descricao.trim(),
      responsavel: body.responsavel?.trim() || null,
      ordem,
    },
  })
  return NextResponse.json(passo, { status: 201 })
}

// Atualizar passo: { passoId, feito? , descricao?, responsavel? }
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  if (!body.passoId) return NextResponse.json({ error: 'passoId obrigatório' }, { status: 400 })
  const passo = await prisma.demandaPasso.update({
    where: { id: body.passoId },
    data: {
      ...(body.descricao !== undefined ? { descricao: body.descricao } : {}),
      ...(body.responsavel !== undefined ? { responsavel: body.responsavel || null } : {}),
      ...(body.feito !== undefined ? { feito: !!body.feito, feitoEm: body.feito ? new Date() : null } : {}),
    },
  })
  return NextResponse.json(passo)
}

// Excluir passo: ?passoId=...
export async function DELETE(req: NextRequest) {
  const passoId = req.nextUrl.searchParams.get('passoId')
  if (!passoId) return NextResponse.json({ error: 'passoId obrigatório' }, { status: 400 })
  await prisma.demandaPasso.delete({ where: { id: passoId } })
  return NextResponse.json({ ok: true })
}
