import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

async function getChecklistParaPost(plataforma: string, externalPostId: string) {
  const interacoes = await prisma.bondInteracao.findMany({
    where: { postId: externalPostId, plataforma },
  })

  const interacaoPorFa = new Map<string, string[]>()
  for (const inter of interacoes) {
    const existing = interacaoPorFa.get(inter.externalId) ?? []
    existing.push(inter.tipo)
    interacaoPorFa.set(inter.externalId, existing)
  }

  const apoiadores = await prisma.pessoa.findMany({
    where: { tipo: { in: ['apoiador', 'coordenador'] }, ativo: true },
    include: {
      bondFas: {
        where: { plataforma },
        select: { externalId: true },
      },
    },
  })

  return apoiadores.map(p => {
    const fa = p.bondFas[0]
    const tipos = fa ? (interacaoPorFa.get(fa.externalId) ?? []) : []
    return {
      pessoaId: p.id,
      nome: p.nome,
      tipo: p.tipo,
      cargo: p.cargo,
      instagram: p.instagram,
      twitter: p.twitter,
      facebook: p.facebook,
      vinculado: !!fa,
      externalId: fa?.externalId ?? null,
      tipos,
      curtiu: tipos.includes('like'),
      comentou: tipos.includes('comment'),
      compartilhou: tipos.includes('share'),
      interagiu: tipos.length > 0,
    }
  }).sort((a, b) => {
    if (!a.interagiu && b.interagiu) return -1
    if (a.interagiu && !b.interagiu) return 1
    return a.nome.localeCompare(b.nome)
  })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tipo = searchParams.get('tipo')
  const postId = searchParams.get('postId')

  if (tipo === 'posts' || (!tipo && !postId)) {
    const posts = await prisma.bondPost.findMany({
      orderBy: { publicadoEm: 'desc' },
      take: 30,
    })

    const result = await Promise.all(posts.map(async post => {
      const uniqInteracoes = await prisma.bondInteracao.findMany({
        where: { postId: post.postId, plataforma: post.plataforma },
        select: { externalId: true },
        distinct: ['externalId'],
      })

      let apoiadoresEngajados = 0
      if (uniqInteracoes.length > 0) {
        const externalIds = uniqInteracoes.map(i => i.externalId)
        apoiadoresEngajados = await prisma.bondFa.count({
          where: {
            plataforma: post.plataforma,
            externalId: { in: externalIds },
            pessoa: { tipo: { in: ['apoiador', 'coordenador'] }, ativo: true },
          },
        })
      }

      const relatorio = await prisma.bondInsight.findFirst({
        where: { tipo: 'relatorio_post', dados: { contains: post.id } },
        select: { criadoEm: true },
      })

      const horasDesdePost = (Date.now() - new Date(post.publicadoEm).getTime()) / 3600000

      return {
        id: post.id,
        postId: post.postId,
        plataforma: post.plataforma,
        conteudo: post.conteudo,
        tipo: post.tipo,
        url: post.url,
        imagemUrl: post.imagemUrl,
        likes: post.likes,
        comentarios: post.comentarios,
        compartilhos: post.compartilhos,
        publicadoEm: post.publicadoEm,
        horasDesdePost: Math.floor(horasDesdePost),
        apoiadoresEngajados,
        relatorioGerado: !!relatorio,
        relatorioEm: relatorio?.criadoEm ?? null,
      }
    }))

    return NextResponse.json(result)
  }

  if (postId) {
    const post = await prisma.bondPost.findFirst({
      where: { OR: [{ id: postId }, { postId }] },
    })
    if (!post) return NextResponse.json({ error: 'Post não encontrado' }, { status: 404 })

    const checklist = await getChecklistParaPost(post.plataforma, post.postId)

    const relatorio = await prisma.bondInsight.findFirst({
      where: { tipo: 'relatorio_post', dados: { contains: post.id } },
      orderBy: { criadoEm: 'desc' },
    })

    const horasDesdePost = (Date.now() - new Date(post.publicadoEm).getTime()) / 3600000

    return NextResponse.json({
      post: { ...post, horasDesdePost: Math.floor(horasDesdePost) },
      checklist,
      totalApoiadores: checklist.length,
      interagiram: checklist.filter(c => c.interagiu).length,
      naoInteragiram: checklist.filter(c => !c.interagiu).length,
      relatorioGerado: !!relatorio,
      relatorioEm: relatorio?.criadoEm ?? null,
    })
  }

  return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 })
}
