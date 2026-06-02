import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { enqueueJob, chatComHermes, criarInsight, buscarMemoria } from '@/lib/hermes'

export async function GET() {
  const [insights, jobs, memorias, stats] = await Promise.all([
    prisma.hermesInsight.findMany({
      orderBy: { criadoEm: 'desc' },
      take: 20,
    }),
    prisma.hermesJob.findMany({
      orderBy: { criadoEm: 'desc' },
      take: 10,
    }),
    prisma.hermesMemoria.findMany({
      orderBy: [{ relevancia: 'desc' }, { atualizadoEm: 'desc' }],
      take: 30,
    }),
    prisma.hermesJob.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
  ])

  return NextResponse.json({ insights, jobs, memorias, stats })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { acao } = body

  if (acao === 'chat') {
    const { mensagem, historico = [] } = body
    if (!mensagem) return NextResponse.json({ error: 'mensagem obrigatória' }, { status: 400 })

    const resposta = await chatComHermes(mensagem, historico)
    return NextResponse.json({ resposta })
  }

  if (acao === 'enqueue') {
    const { tipo, payload } = body
    const job = await enqueueJob(tipo, payload)
    return NextResponse.json({ job })
  }

  if (acao === 'resumo') {
    const job = await enqueueJob('resumo_diario', { timestamp: new Date().toISOString() })
    return NextResponse.json({ job })
  }

  if (acao === 'marcar_lido') {
    const { id } = body
    await prisma.hermesInsight.update({ where: { id }, data: { lido: true } })
    return NextResponse.json({ ok: true })
  }

  if (acao === 'marcar_todos_lidos') {
    await prisma.hermesInsight.updateMany({ where: { lido: false }, data: { lido: true } })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'ação inválida' }, { status: 400 })
}
