import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { checkFacebookToken } from '@/lib/social/facebook'
import {
  syncAll, syncTwitter, syncFacebook, syncInstagram,
  gerarSugestaoConteudo, chatComBond, analisarTopPosts, analisarAudiencia, analiseProfunda,
  gerarRankingGeral, gerarRankingSemanal, gerarRankingCabos,
  buscarComentariosPendentes, sugerirResposta, aprovarResposta, rejeitarComentario,
} from '@/lib/bond'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tipo = searchParams.get('tipo')

  if (tipo === 'posts') {
    const plataforma = searchParams.get('plataforma')
    const posts = await prisma.bondPost.findMany({
      where: plataforma ? { plataforma } : undefined,
      orderBy: [{ publicadoEm: 'desc' }],
      take: 50,
      include: { perfil: true },
    })
    return NextResponse.json(posts)
  }

  if (tipo === 'fas') {
    const plataforma = searchParams.get('plataforma')
    const fas = await prisma.bondFa.findMany({
      where: plataforma ? { plataforma } : undefined,
      orderBy: [{ totalLikes: 'desc' }, { totalComents: 'desc' }],
      take: 50,
      include: { pessoa: { select: { id: true, nome: true, tipo: true } } },
    })
    return NextResponse.json(fas)
  }

  if (tipo === 'ranking_geral') {
    return NextResponse.json(await gerarRankingGeral())
  }

  if (tipo === 'ranking_semanal') {
    return NextResponse.json(await gerarRankingSemanal())
  }

  if (tipo === 'ranking_cabos') {
    return NextResponse.json(await gerarRankingCabos())
  }

  if (tipo === 'comentarios') {
    return NextResponse.json(await buscarComentariosPendentes())
  }

  if (tipo === 'insights') {
    const insights = await prisma.bondInsight.findMany({
      orderBy: { criadoEm: 'desc' },
      take: 20,
    })
    return NextResponse.json(insights)
  }

  if (tipo === 'rascunhos') {
    const rascunhos = await prisma.bondRascunho.findMany({
      orderBy: { criadoEm: 'desc' },
    })
    return NextResponse.json(rascunhos)
  }

  if (tipo === 'token_status') {
    const [fb, perfil] = await Promise.all([
      checkFacebookToken(),
      prisma.bondPerfil.findFirst({ where: { plataforma: 'instagram' }, orderBy: { ultimaSync: 'desc' }, select: { ultimaSync: true } }),
    ])
    return NextResponse.json({ facebook: fb, ultimaSync: perfil?.ultimaSync ?? null })
  }

  if (tipo === 'interacoes') {
    const plataforma = searchParams.get('plataforma') || undefined
    const tipoInt = searchParams.get('tipoInteracao') || undefined // comment | like | share
    const pessoa = (searchParams.get('pessoa') || '').trim().toLowerCase()
    const de = searchParams.get('de')
    const ate = searchParams.get('ate')
    const agrupar = searchParams.get('agrupar') // 'pessoa' | null
    const dateW: { gte?: Date; lte?: Date } = {}
    if (de) dateW.gte = new Date(de + 'T00:00:00')
    if (ate) dateW.lte = new Date(ate + 'T23:59:59')
    const hasDate = !!(de || ate)

    type Item = { id: string; tipo: string; plataforma: string; pessoa: string; texto: string | null; postId: string; data: Date }
    const items: Item[] = []

    // Comentários (têm autor + texto + post)
    if (!tipoInt || tipoInt === 'comment') {
      const cs = await prisma.bondComentario.findMany({
        where: {
          ...(plataforma ? { plataforma } : {}),
          ...(hasDate ? { criadoEm: dateW } : {}),
          ...(pessoa ? { autor: { contains: pessoa } } : {}),
        },
        orderBy: { criadoEm: 'desc' }, take: agrupar === 'pessoa' ? 8000 : 500,
      })
      for (const c of cs) items.push({ id: c.id, tipo: 'comment', plataforma: c.plataforma, pessoa: c.autor || c.autorId || '?', texto: c.texto, postId: c.postId, data: c.criadoEm })
    }
    // Likes/shares (BondInteracao; resolve a pessoa via externalId -> BondFa)
    if (!tipoInt || tipoInt === 'like' || tipoInt === 'share') {
      const is = await prisma.bondInteracao.findMany({
        where: {
          ...(plataforma ? { plataforma } : {}),
          tipo: tipoInt && tipoInt !== 'comment' ? tipoInt : { in: ['like', 'share'] },
          ...(hasDate ? { criadoEm: dateW } : {}),
        },
        orderBy: { criadoEm: 'desc' }, take: agrupar === 'pessoa' ? 8000 : 2000,
      })
      const exts = Array.from(new Set(is.map((i) => i.externalId)))
      const fas = exts.length ? await prisma.bondFa.findMany({ where: { externalId: { in: exts } } }) : []
      const nameOf = new Map(fas.map((f) => [f.externalId, f.nome || f.username || f.externalId]))
      for (const i of is) {
        const nome = String(nameOf.get(i.externalId) || i.externalId)
        if (pessoa && !nome.toLowerCase().includes(pessoa)) continue
        items.push({ id: i.id, tipo: i.tipo, plataforma: i.plataforma, pessoa: nome, texto: null, postId: i.postId, data: i.criadoEm })
      }
    }
    items.sort((a, b) => +new Date(b.data) - +new Date(a.data))

    // Stats PRECISOS (contagem real, não limitada pelo take das listas acima)
    const comW = { ...(plataforma ? { plataforma } : {}), ...(hasDate ? { criadoEm: dateW } : {}), ...(pessoa ? { autor: { contains: pessoa } } : {}) }
    const intW = (t: string) => ({ ...(plataforma ? { plataforma } : {}), tipo: t, ...(hasDate ? { criadoEm: dateW } : {}) })
    const [nComment, nLike, nShare] = await Promise.all([
      !tipoInt || tipoInt === 'comment' ? prisma.bondComentario.count({ where: comW }) : Promise.resolve(0),
      !tipoInt || tipoInt === 'like' ? prisma.bondInteracao.count({ where: intW('like') }) : Promise.resolve(0),
      !tipoInt || tipoInt === 'share' ? prisma.bondInteracao.count({ where: intW('share') }) : Promise.resolve(0),
    ])
    const stats = { total: nComment + nLike + nShare, comment: nComment, like: nLike, share: nShare }

    if (agrupar === 'pessoa') {
      const byP = new Map<string, { pessoa: string; total: number; like: number; comment: number; share: number; plataformas: Set<string>; posts: Set<string>; ultima: Date }>()
      for (const it of items) {
        const e = byP.get(it.pessoa) || { pessoa: it.pessoa, total: 0, like: 0, comment: 0, share: 0, plataformas: new Set<string>(), posts: new Set<string>(), ultima: it.data }
        e.total++
        if (it.tipo === 'like') e.like++; else if (it.tipo === 'comment') e.comment++; else if (it.tipo === 'share') e.share++
        e.plataformas.add(it.plataforma); e.posts.add(it.postId)
        if (it.data > e.ultima) e.ultima = it.data
        byP.set(it.pessoa, e)
      }
      const pessoas = Array.from(byP.values())
        .map((e) => ({ pessoa: e.pessoa, total: e.total, like: e.like, comment: e.comment, share: e.share, plataformas: Array.from(e.plataformas), nPosts: e.posts.size, posts: Array.from(e.posts), ultima: e.ultima }))
        .sort((a, b) => b.total - a.total)
      return NextResponse.json({ stats, data: pessoas.slice(0, 2000) })
    }
    return NextResponse.json({ stats, data: items.slice(0, 500) })
  }

  // Default: overview
  const [perfis, totalPosts, totalFas, insightsNaoLidos, comentariosPendentes, stats] = await Promise.all([
    prisma.bondPerfil.findMany({ where: { ativo: true } }),
    prisma.bondPost.count(),
    prisma.bondFa.count(),
    prisma.bondInsight.count({ where: { lido: false } }),
    prisma.bondComentario.count({ where: { respondido: false } }),
    prisma.bondPost.aggregate({
      _sum: { likes: true, comentarios: true, compartilhos: true, alcance: true },
      _avg: { engajamento: true },
    }),
  ])

  return NextResponse.json({ perfis, totalPosts, totalFas, insightsNaoLidos, comentariosPendentes, stats })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { acao } = body

  if (acao === 'sync') {
    const plat = body.plataforma
    let result
    if (plat === 'twitter') result = await syncTwitter()
    else if (plat === 'facebook') result = await syncFacebook()
    else if (plat === 'instagram') result = await syncInstagram()
    else result = await syncAll()
    return NextResponse.json(result)
  }

  if (acao === 'chat') {
    const { mensagem, historico = [] } = body
    const resposta = await chatComBond(mensagem, historico)
    return NextResponse.json({ resposta })
  }

  if (acao === 'analise_profunda') {
    const analise = await analiseProfunda()
    return NextResponse.json({ analise })
  }

  if (acao === 'analisar_top') {
    return NextResponse.json({ analise: await analisarTopPosts() })
  }

  if (acao === 'analisar_audiencia') {
    return NextResponse.json({ analise: await analisarAudiencia() })
  }

  if (acao === 'sugerir_conteudo') {
    const { tema, plataforma } = body
    const sugestao = await gerarSugestaoConteudo(tema, plataforma)
    return NextResponse.json({ sugestao })
  }

  if (acao === 'analisar') {
    const [posts, audiencia] = await Promise.allSettled([analisarTopPosts(), analisarAudiencia()])
    return NextResponse.json({
      posts: posts.status === 'fulfilled' ? posts.value : null,
      audiencia: audiencia.status === 'fulfilled' ? audiencia.value : null,
    })
  }

  if (acao === 'sugerir_resposta') {
    const { comentarioId, plataforma } = body
    const sugestao = await sugerirResposta(comentarioId, plataforma)
    return NextResponse.json({ sugestao })
  }

  if (acao === 'aprovar_resposta') {
    const { comentarioId, plataforma, texto } = body
    await aprovarResposta(comentarioId, plataforma, texto)
    return NextResponse.json({ ok: true })
  }

  if (acao === 'rejeitar_comentario') {
    const { comentarioId, plataforma } = body
    await rejeitarComentario(comentarioId, plataforma)
    return NextResponse.json({ ok: true })
  }

  if (acao === 'salvar_rascunho') {
    const { titulo, texto, plataformas, tipo, hashtags } = body
    const r = await prisma.bondRascunho.create({
      data: { titulo, texto, plataformas: plataformas ?? 'todas', tipo: tipo ?? 'post', hashtags },
    })
    return NextResponse.json(r)
  }

  if (acao === 'marcar_insight_lido') {
    await prisma.bondInsight.update({ where: { id: body.id }, data: { lido: true } })
    return NextResponse.json({ ok: true })
  }

  if (acao === 'deletar_rascunho') {
    await prisma.bondRascunho.delete({ where: { id: body.id } })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
}
