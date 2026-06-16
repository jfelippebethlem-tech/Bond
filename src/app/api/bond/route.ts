import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { checkFacebookToken } from '@/lib/social/facebook'
import {
  syncAll, syncTwitter, syncFacebook, syncInstagram,
  gerarSugestaoConteudo, chatComBond, analisarTopPosts, analisarAudiencia, analiseProfunda,
  gerarRankingGeral, gerarRankingSemanal, gerarRankingCabos,
  buscarComentariosPendentes, sugerirResposta, aprovarResposta, rejeitarComentario,
} from '@/lib/bond'

// Monta um CSV (UTF-8 com BOM p/ o Excel abrir acentos certo) a partir de uma matriz.
function csvResp(rows: (string | number)[][], nome: string) {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nome}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tipo = searchParams.get('tipo')

  if (tipo === 'posts') {
    const plataforma = searchParams.get('plataforma')
    const ordenar = searchParams.get('ordenar') // 'likes' | 'comentarios' | null(recentes)
    const de = searchParams.get('de'), ate = searchParams.get('ate')
    const dateW: { gte?: Date; lte?: Date } = {}
    if (de) dateW.gte = new Date(de + 'T00:00:00')
    if (ate) dateW.lte = new Date(ate + 'T23:59:59')
    const orderBy = ordenar === 'likes' ? [{ likes: 'desc' as const }] : ordenar === 'comentarios' ? [{ comentarios: 'desc' as const }] : [{ publicadoEm: 'desc' as const }]
    const posts = await prisma.bondPost.findMany({
      where: { ...(plataforma ? { plataforma } : {}), ...((de || ate) ? { publicadoEm: dateW } : {}) },
      orderBy,
      take: 300,
      select: { id: true, plataforma: true, tipo: true, conteudo: true, url: true, imagemUrl: true, likes: true, comentarios: true, alcance: true, engajamento: true, publicadoEm: true },
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

  // Ranking de curtidores (importado do desktop). totalLikes vem do export do Leaderboard.
  if (tipo === 'curtidores') {
    const itens = await prisma.bondFa.findMany({
      where: { plataforma: 'instagram', totalLikes: { gt: 0 } },
      orderBy: { totalLikes: 'desc' },
      take: 1000,
      select: { username: true, nome: true, totalLikes: true, totalComents: true },
    })
    return NextResponse.json({ total: itens.length, data: itens })
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
    const formato = searchParams.get('formato') // 'csv' | null
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
    // Curtidas AGREGADAS dos posts: o IG não revela QUEM curtiu, mas dá o total por post.
    const aggLikes = await prisma.bondPost.aggregate({
      _sum: { likes: true },
      where: { ...(plataforma ? { plataforma } : {}), ...(hasDate ? { publicadoEm: dateW } : {}) },
    })
    const curtidasPostagens = aggLikes._sum.likes ?? 0
    const stats = { total: nComment + nLike + nShare, comment: nComment, like: nLike, share: nShare, curtidasPostagens }

    if (agrupar === 'pessoa') {
      // Exclui as contas do PRÓPRIO mandato (respostas do dono não são "interação de apoiador").
      const perfisDono = await prisma.bondPerfil.findMany({ select: { handle: true } })
      const donoHandles = new Set(perfisDono.map((p) => (p.handle || '').toLowerCase()).filter(Boolean))
      const byP = new Map<string, { pessoa: string; total: number; like: number; comment: number; share: number; plataformas: Set<string>; posts: Set<string>; ultima: Date }>()
      for (const it of items) {
        if (donoHandles.has((it.pessoa || '').toLowerCase())) continue
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
      if (formato === 'csv') {
        const head = ['posicao', 'pessoa', 'total', 'comentarios', 'likes', 'shares', 'plataformas', 'posts_distintos', 'ultima_interacao']
        const linhas = pessoas.map((p, i) => [i + 1, p.pessoa, p.total, p.comment, p.like, p.share, p.plataformas.join(' '), p.nPosts, new Date(p.ultima).toISOString()])
        return csvResp([head, ...linhas], `ranking-interacoes`)
      }
      return NextResponse.json({ stats, data: pessoas.slice(0, 2000) })
    }
    if (formato === 'csv') {
      const head = ['data', 'pessoa', 'tipo', 'plataforma', 'post', 'texto']
      const linhas = items.map((it) => [new Date(it.data).toISOString(), it.pessoa, it.tipo, it.plataforma, it.postId, it.texto ?? ''])
      return csvResp([head, ...linhas], `interacoes`)
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

  // Importa o ranking de CURTIDORES exportado no DESKTOP (InstagramLikesLeaderboard).
  // NÃO faz nenhuma chamada ao Instagram — só ingere os dados que o dono trouxer.
  if (acao === 'importar_curtidores') {
    const itens: { username?: string; curtidas?: number; percentual?: number }[] = Array.isArray(body.itens) ? body.itens : []
    let ok = 0
    for (const it of itens) {
      const u = (it.username || '').trim().replace(/^@/, '')
      if (!u) continue
      const n = Math.max(0, Math.round(Number(it.curtidas) || 0))
      await prisma.bondFa.upsert({
        where: { plataforma_externalId: { plataforma: 'instagram', externalId: u } },
        update: { username: u, nome: u, totalLikes: n, ultimaInter: new Date() },
        create: { plataforma: 'instagram', externalId: u, username: u, nome: u, totalLikes: n, ultimaInter: new Date() },
      })
      ok++
    }
    return NextResponse.json({ ok, total: itens.length })
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
