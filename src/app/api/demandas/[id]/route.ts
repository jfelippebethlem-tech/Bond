import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const demanda = await prisma.demanda.findUnique({
    where: { id: params.id },
    include: { pessoa: true, passos: { orderBy: { ordem: 'asc' } } },
  })

  if (!demanda) {
    return NextResponse.json({ error: 'Não encontrada' }, { status: 404 })
  }

  return NextResponse.json(demanda)
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()
  // ao mudar para "resolvida", carimba resolvidoEm (e limpa quando reabre)
  const virouResolvida = body.status === 'resolvida'

  const demanda = await prisma.demanda.update({
    where: { id: params.id },
    data: {
      ...(body.titulo !== undefined ? { titulo: body.titulo } : {}),
      ...(body.descricao !== undefined ? { descricao: body.descricao } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.prioridade !== undefined ? { prioridade: body.prioridade } : {}),
      ...(body.origem !== undefined ? { origem: body.origem || null } : {}),
      ...(body.responsavel !== undefined ? { responsavel: body.responsavel || null } : {}),
      ...(body.prazo !== undefined ? { prazo: body.prazo ? new Date(body.prazo) : null } : {}),
      ...(body.pessoaId !== undefined ? { pessoaId: body.pessoaId || null } : {}),
      ...(body.resposta !== undefined ? { resposta: body.resposta || null } : {}),
      ...(body.status !== undefined ? { resolvidoEm: virouResolvida ? new Date() : null } : {}),
    },
    include: { pessoa: true, passos: { orderBy: { ordem: 'asc' } } },
  })

  return NextResponse.json(demanda)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.demanda.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
