import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { checkFacebookToken } from '@/lib/social/facebook'
import { filtroPeriodo } from '@/lib/interacoes'
import { handlesExcluidos, normUser } from '@/lib/filtros'
import { normalizar } from '@/lib/texto'
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
      select: { id: true, postId: true, plataforma: true, tipo: true, conteudo: true, url: true, imagemUrl: true, likes: true, comentarios: true, alcance: true, engajamento: true, publicadoEm: true },
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
    const excl = await handlesExcluidos()
    const itens = (await prisma.bondFa.findMany({
      where: { plataforma: 'instagram', totalLikes: { gt: 0 } },
      orderBy: { totalLikes: 'desc' },
      take: 1100,
      select: { username: true, nome: true, totalLikes: true, totalComents: true },
    })).filter((f) => !excl.has(normUser(f.username))).slice(0, 1000)
    return NextResponse.json({ total: itens.length, data: itens })
  }

  // Engajadores REAIS sugeridos p/ virar apoiador/cabo (BondFa por score, ainda não vinculados a Pessoa).
  if (tipo === 'engajadores_sugeridos') {
    const excl = await handlesExcluidos()
    const fas = await prisma.bondFa.findMany({
      where: { pessoaId: null },
      orderBy: [{ totalLikes: 'desc' }, { totalComents: 'desc' }],
      take: 400,
      select: { externalId: true, username: true, nome: true, plataforma: true, totalLikes: true, totalComents: true, totalShares: true },
    })
    const data = fas
      .filter((f) => !excl.has(normUser(f.username)) && !excl.has(normUser(f.externalId)))
      .map((f) => ({ ...f, score: f.totalLikes + f.totalComents * 2 + f.totalShares * 3 }))
      .filter((f) => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
    return NextResponse.json({ total: data.length, data })
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

  if (tipo === 'viral') {
    const scores = await prisma.bondViralScore.findMany({ orderBy: { scoreTotal: 'desc' }, take: 100 })
    const posts = await prisma.bondPost.findMany({
      where: { postId: { in: scores.map((s) => s.postId) } },
      select: { postId: true, conteudo: true, url: true, publicadoEm: true, likes: true, comentarios: true },
    })
    const byId = new Map(posts.map((p) => [p.postId, p]))
    return NextResponse.json(scores.map((s) => ({ ...s, post: byId.get(s.postId) ?? null })))
  }

  if (tipo === 'playbook') {
    const pb = await prisma.hermesMemoria.findUnique({ where: { tipo_chave: { tipo: 'viral', chave: 'playbook' } } }).catch(() => null)
    const meta = await prisma.hermesMemoria.findUnique({ where: { tipo_chave: { tipo: 'viral', chave: 'playbook_meta' } } }).catch(() => null)
    return NextResponse.json({ playbook: pb?.conteudo || '', meta: meta?.conteudo ? JSON.parse(meta.conteudo) : null, atualizadoEm: pb?.atualizadoEm ?? null })
  }

  if (tipo === 'relatorios') {
    const rels = await prisma.bondRelatorio.findMany({ orderBy: { criadoEm: 'desc' }, take: 40, select: { id: true, tipo: true, titulo: true, periodo: true, criadoEm: true } })
    return NextResponse.json(rels)
  }

  if (tipo === 'relatorio') {
    const id = searchParams.get('id') || ''
    const rel = await prisma.bondRelatorio.findUnique({ where: { id } })
    return NextResponse.json(rel ? { ...rel, dados: rel.dados ? JSON.parse(rel.dados) : null } : null)
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
    // Busca de pessoa insensível a CAIXA e ACENTO (normalizar, o mesmo de Pessoas/Demandas): o
    // contains do SQLite é sensível a acento, então "vila uniao" não achava "Vila União". O match
    // roda em memória — e por isso, com busca ativa, as queries abaixo vêm SEM teto (carregarTudo).
    const pessoa = normalizar(searchParams.get('pessoa') || '')
    const de = searchParams.get('de')
    const ate = searchParams.get('ate')
    const agrupar = searchParams.get('agrupar') // 'pessoa' | null
    const formato = searchParams.get('formato') // 'csv' | null
    const dateW: { gte?: Date; lte?: Date } = {}
    if (de) dateW.gte = new Date(de + 'T00:00:00')
    if (ate) dateW.lte = new Date(ate + 'T23:59:59')
    const hasDate = !!(de || ate)
    // Filtra pela data REAL (publicadoEm). Linhas sem data caem na data do POST, nunca no
    // criadoEm (hora do ingest) — ver src/lib/interacoes.ts. Corrige o vazamento em que um
    // lote importado num dia aparecia inteiro no filtro daquela semana (bug 06-16).
    const dataFiltro = await filtroPeriodo(de, ate)
    // Sem teto quando: agrupa por pessoa (precisa de TODAS as linhas — teto de 8000 sumia com gente
    // que os cards exatos mostravam) OU há busca de pessoa (o match acento-insensível roda em
    // memória DEPOIS da query; com teto, a busca via JS perdia linhas antigas — card 528 × lista 1).
    const carregarTudo = agrupar === 'pessoa' || !!pessoa

    type Item = { id: string; tipo: string; plataforma: string; pessoa: string; texto: string | null; postId: string; data: Date; dataReal?: boolean; postUrl?: string | null; postLegenda?: string | null }
    const items: Item[] = []

    // Comentários (têm autor + texto + post)
    if (!tipoInt || tipoInt === 'comment') {
      const cs = await prisma.bondComentario.findMany({
        where: {
          ...(plataforma ? { plataforma } : {}),
          ...(dataFiltro ?? {}),
        },
        // Lista plana: os 500 mais recentes pela data REAL do comentário — não pelo criadoEm, que
        // é a hora do INGEST (o re-import deixa todos iguais e a ordem virava loteria).
        orderBy: { publicadoEm: { sort: 'desc', nulls: 'last' } }, take: carregarTudo ? undefined : 500,
      })
      // data exibida/ordenada = data REAL do comentário; sem ela, a data do post (resolvida no join
      // abaixo); só em último caso o ingest. Antes mostrava sempre o criadoEm (ingest) — data errada na lista.
      for (const c of cs) {
        if (pessoa && !normalizar(c.autor || c.autorId).includes(pessoa)) continue
        items.push({ id: c.id, tipo: 'comment', plataforma: c.plataforma, pessoa: c.autor || c.autorId || '?', texto: c.texto, postId: c.postId, data: c.publicadoEm ?? c.criadoEm, dataReal: !!c.publicadoEm })
      }
    }
    // Likes/shares (BondInteracao; resolve a pessoa via externalId -> BondFa)
    if (!tipoInt || tipoInt === 'like' || tipoInt === 'share') {
      const is = await prisma.bondInteracao.findMany({
        where: {
          ...(plataforma ? { plataforma } : {}),
          tipo: tipoInt && tipoInt !== 'comment' ? tipoInt : { in: ['like', 'share'] },
          ...(dataFiltro ?? {}),
        },
        orderBy: { publicadoEm: { sort: 'desc', nulls: 'last' } }, take: carregarTudo ? undefined : 2000,
      })
      const exts = Array.from(new Set(is.map((i) => i.externalId)))
      const fas = exts.length ? await prisma.bondFa.findMany({ where: { externalId: { in: exts } } }) : []
      const nameOf = new Map(fas.map((f) => [f.externalId, f.nome || f.username || f.externalId]))
      for (const i of is) {
        const nome = String(nameOf.get(i.externalId) || i.externalId)
        if (pessoa && !normalizar(nome).includes(pessoa) && !normalizar(i.externalId).includes(pessoa)) continue
        items.push({ id: i.id, tipo: i.tipo, plataforma: i.plataforma, pessoa: nome, texto: null, postId: i.postId, data: i.publicadoEm ?? i.criadoEm })
      }
    }
    // Liga cada comentário ao POST em que foi feito (em qual post a pessoa comentou) — join por postId
    // (= BondPost.postId, o id da plataforma; NÃO o cuid). Anexa legenda curta + link clicável.
    const comPostIds = Array.from(new Set(items.filter((i) => i.tipo === 'comment' && i.postId).map((i) => i.postId)))
    if (comPostIds.length) {
      const ps = await prisma.bondPost.findMany({ where: { postId: { in: comPostIds } }, select: { postId: true, url: true, conteudo: true, publicadoEm: true } })
      const pmap = new Map(ps.map((p) => [p.postId, p]))
      for (const it of items) {
        if (it.tipo !== 'comment') continue
        const p = pmap.get(it.postId)
        if (p) {
          it.postUrl = p.url; it.postLegenda = (p.conteudo || '').replace(/\s+/g, ' ').trim().slice(0, 80)
          // comentário sem data real → usa a data do post (período correto, não o ingest)
          if (!it.dataReal && p.publicadoEm) it.data = p.publicadoEm
        }
      }
    }
    // Likes de IG guardam o SHORTCODE do post (coletor do desktop); BondPost.postId é o media ID
    // da Graph API — o join direto nunca casa. Casa pela URL do post (…/p|reel|tv/<shortcode>/),
    // que o BondPost sempre tem. São ~centenas de posts: carregar todos é barato.
    if (items.some((i) => i.tipo !== 'comment' && i.postId)) {
      const ps = await prisma.bondPost.findMany({ where: { plataforma: 'instagram' }, select: { postId: true, url: true, conteudo: true } })
      const byCode = new Map<string, (typeof ps)[number]>()
      for (const p of ps) { const m = (p.url || '').match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/); if (m) byCode.set(m[1], p) }
      for (const it of items) {
        if (it.tipo === 'comment') continue
        const p = byCode.get(it.postId)
        if (p) { it.postUrl = p.url; it.postLegenda = (p.conteudo || '').replace(/\s+/g, ' ').trim().slice(0, 80) }
      }
    }
    items.sort((a, b) => +new Date(b.data) - +new Date(a.data))

    // Stats PRECISOS. Sem busca: count() exato no banco. Com busca de pessoa: conta os items — que
    // vieram SEM teto (carregarTudo) e filtrados com normalizar(), o único jeito de o card bater
    // com a tabela sendo insensível a acento (o contains do SQLite não é).
    let nComment = 0, nLike = 0, nShare = 0
    if (pessoa) {
      for (const it of items) { if (it.tipo === 'comment') nComment++; else if (it.tipo === 'like') nLike++; else nShare++ }
    } else {
      const comW = { ...(plataforma ? { plataforma } : {}), ...(dataFiltro ?? {}) }
      const intW = (t: string) => ({ ...(plataforma ? { plataforma } : {}), tipo: t, ...(dataFiltro ?? {}) })
      ;[nComment, nLike, nShare] = await Promise.all([
        !tipoInt || tipoInt === 'comment' ? prisma.bondComentario.count({ where: comW }) : Promise.resolve(0),
        !tipoInt || tipoInt === 'like' ? prisma.bondInteracao.count({ where: intW('like') }) : Promise.resolve(0),
        !tipoInt || tipoInt === 'share' ? prisma.bondInteracao.count({ where: intW('share') }) : Promise.resolve(0),
      ])
    }
    // Totais AGREGADOS dos posts (verdade da Meta): IG não revela QUEM curtiu/comentou em parte dos
    // casos, mas o post traz o nº oficial (like_count / comments_count). Mesmo padrão p/ comentário:
    // o card mostra o total real da Meta; o por-pessoa segue com os comentários IDENTIFICADOS (autor).
    // Corrige a subcontagem de BondComentario (só grava se há texto/autor → ~14k Meta vs ~13,2k aqui).
    const [aggPost, aggLike] = await Promise.all([
      prisma.bondPost.aggregate({
        _sum: { likes: true, comentarios: true },
        where: { ...(plataforma ? { plataforma } : {}), ...(hasDate ? { publicadoEm: dateW } : {}) },
      }),
      // Data do post mais novo COM curtidores capturados — mostra na tela até quando a captura do
      // desktop chegou (parada = filtros recentes zerados por falta de dado, não por bug).
      prisma.bondInteracao.aggregate({ _max: { publicadoEm: true }, where: { tipo: 'like', plataforma: 'instagram' } }),
    ])
    const curtidasPostagens = aggPost._sum.likes ?? 0
    const comentariosPostagens = aggPost._sum.comentarios ?? 0
    const stats = { total: nComment + nLike + nShare, comment: nComment, like: nLike, share: nShare, curtidasPostagens, comentariosPostagens, ultimaCapturaLike: aggLike._max.publicadoEm }

    if (agrupar === 'pessoa') {
      // Exclui contas do PRÓPRIO mandato + contas-sistema do IG (notifications etc.) — ver src/lib/filtros.ts
      const excl = await handlesExcluidos()
      const byP = new Map<string, { pessoa: string; total: number; like: number; likeIG: number; likeFB: number; comment: number; share: number; plataformas: Set<string>; posts: Set<string>; ultima: Date }>()
      for (const it of items) {
        if (excl.has(normUser(it.pessoa))) continue
        const e = byP.get(it.pessoa) || { pessoa: it.pessoa, total: 0, like: 0, likeIG: 0, likeFB: 0, comment: 0, share: 0, plataformas: new Set<string>(), posts: new Set<string>(), ultima: it.data }
        e.total++
        if (it.tipo === 'like') { e.like++; if (it.plataforma === 'facebook') e.likeFB++; else if (it.plataforma === 'instagram') e.likeIG++ }
        else if (it.tipo === 'comment') e.comment++; else if (it.tipo === 'share') e.share++
        e.plataformas.add(it.plataforma); e.posts.add(it.postId)
        if (it.data > e.ultima) e.ultima = it.data
        byP.set(it.pessoa, e)
      }
      // IG "quem curtiu cada post" vem do coletor PER-POST (posts-curtidores.json + posts-meta.json ->
      // BondInteracao com publicadoEm = data do post; ver scripts/import-curtidores-por-post.ts). Logo os
      // likes de IG já entram no loop acima como interação DATADA (likeIG++), e o filtro por período
      // recorta certo (curtidores dos posts da janela). Sem o agregado cumulativo de BondFa.totalLikes,
      // que era o erro (mostrava o total acumulado mesmo filtrando por data).
      const pessoas = Array.from(byP.values())
        .map((e) => ({ pessoa: e.pessoa, total: e.total, like: e.like, likeIG: e.likeIG, likeFB: e.likeFB, comment: e.comment, share: e.share, plataformas: Array.from(e.plataformas), nPosts: e.posts.size, posts: Array.from(e.posts), ultima: e.ultima }))
        .sort((a, b) => b.total - a.total)
      if (formato === 'csv') {
        const head = ['posicao', 'pessoa', 'total', 'comentarios', 'curtidas_ig', 'curtidas_fb', 'shares', 'plataformas', 'posts_distintos', 'ultima_interacao']
        const linhas = pessoas.map((p, i) => [i + 1, p.pessoa, p.total, p.comment, p.likeIG, p.likeFB, p.share, p.plataformas.join(' '), p.nPosts, new Date(p.ultima).toISOString()])
        return csvResp([head, ...linhas], `ranking-interacoes`)
      }
      return NextResponse.json({ stats, data: pessoas.slice(0, 2000) })
    }
    if (formato === 'csv') {
      const head = ['data', 'pessoa', 'tipo', 'plataforma', 'post', 'post_url', 'post_legenda', 'texto']
      const linhas = items.map((it) => [new Date(it.data).toISOString(), it.pessoa, it.tipo, it.plataforma, it.postId, it.postUrl ?? '', it.postLegenda ?? '', it.texto ?? ''])
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
    // getFacebookPosts agora lança em token expirado (#190) em vez de devolver [] mudo;
    // captura aqui p/ devolver o motivo no body (em vez de 500) — honestidade sem mascarar.
    else if (plat === 'facebook') result = await syncFacebook().catch((e) => ({ synced: 0, error: String(e instanceof Error ? e.message : e) }))
    else if (plat === 'instagram') result = await syncInstagram()
    else result = await syncAll()
    return NextResponse.json(result)
  }

  // O PolitiMonitor "assiste" o vídeo/reel ou "vê" o carrossel e avalia o conteúdo (gancho/ritmo/CTA).
  if (acao === 'analisar_midia') {
    const mediaId = String(body.mediaId || body.postId || '').trim()
    if (!mediaId) return NextResponse.json({ ok: false, erro: 'mediaId obrigatório' }, { status: 400 })
    const { getInstagramMedia, analisarMidiaPost } = await import('@/lib/social/midia')
    const media = await getInstagramMedia(mediaId)
    if (!media) return NextResponse.json({ ok: false, erro: 'mídia não encontrada (verifique o token do Instagram)' })
    const analise = await analisarMidiaPost(media)
    // devolve também o link do post que gerou o insight (permalink do IG, ou o url do post no DB)
    const post = await prisma.bondPost.findFirst({ where: { postId: mediaId }, select: { url: true } })
    return NextResponse.json({ ...analise, permalink: media.permalink || post?.url || null })
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

  if (acao === 'analisar_viral') {
    const { analisarPostsPendentes } = await import('@/lib/viral/analista')
    const r = await analisarPostsPendentes(body.limite ?? 100)
    return NextResponse.json(r)
  }

  if (acao === 'gerar_relatorio') {
    const { gerarRelatorio } = await import('@/lib/viral/relatorio')
    const r = await gerarRelatorio(body.periodoTipo, body.ref)
    return NextResponse.json(r)
  }

  if (acao === 'aprender_viral') {
    const { aprenderPadroesVirais } = await import('@/lib/viral/aprendizado')
    return NextResponse.json(await aprenderPadroesVirais())
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
