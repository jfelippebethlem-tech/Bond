import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { casaBusca } from '@/lib/texto'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const search = searchParams.get('search') ?? ''
  const tipo = searchParams.get('tipo') ?? ''

  const pessoas = await prisma.pessoa.findMany({
    where: { ativo: true, ...(tipo ? { tipo } : {}) },
    orderBy: { nome: 'asc' },
  })

  // Busca por nome insensível a acento/caixa ("Jose" acha "José") — ver src/lib/texto.ts
  const filtradas = search ? pessoas.filter((p) => casaBusca(p.nome, search)) : pessoas
  return NextResponse.json(filtradas)
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  const pessoa = await prisma.pessoa.create({
    data: {
      nome: body.nome,
      tipo: body.tipo,
      cargo: body.cargo || null,
      email: body.email || null,
      telefone: body.telefone || null,
      twitter: body.twitter || null,
      instagram: body.instagram || null,
      telegramUser: body.telegramUser || null,
      observacoes: body.observacoes || null,
    },
  })

  return NextResponse.json(pessoa, { status: 201 })
}
