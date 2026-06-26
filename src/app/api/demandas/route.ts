import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { casaBusca } from '@/lib/texto'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const status = searchParams.get('status') ?? ''
  const prioridade = searchParams.get('prioridade') ?? ''
  const search = searchParams.get('search') ?? ''

  const demandas = await prisma.demanda.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(prioridade ? { prioridade } : {}),
    },
    include: { pessoa: true, passos: { orderBy: { ordem: 'asc' } } },
    orderBy: { criadoEm: 'desc' },
  })

  // Busca por título insensível a acento/caixa ("orcamento" acha "Orçamento") — ver src/lib/texto.ts
  const filtradas = search ? demandas.filter((d) => casaBusca(d.titulo, search)) : demandas
  return NextResponse.json(filtradas)
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  const demanda = await prisma.demanda.create({
    data: {
      titulo: body.titulo,
      descricao: body.descricao,
      status: body.status ?? 'aberta',
      prioridade: body.prioridade ?? 'media',
      origem: body.origem || null,
      responsavel: body.responsavel || null,
      prazo: body.prazo ? new Date(body.prazo) : null,
      pessoaId: body.pessoaId || null,
    },
    include: { pessoa: true, passos: true },
  })

  return NextResponse.json(demanda, { status: 201 })
}
