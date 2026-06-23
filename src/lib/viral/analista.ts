// ANALISTA DE REDES — orquestra a análise de viralização de UM post.
//
// Fluxo: (1) Gemini assiste a mídia (reusa social/midia.ts) → leitura de conteúdo;
// (2) callAI (Cerebras grátis) estrutura notas + casa com tendências + diagnóstico;
// (3) algoritmo.ts pontua (camada A/B); (4) grava BondViralScore + um BondInsight
// (que já aparece nas abas de Insights existentes). Idempotente por postId.
import { prisma } from '../db'
import { callAI } from '../hermes'
import { getInstagramMedia, analisarMidiaPost } from '../social/midia'
import { getInstagramPostInsights } from '../social/instagram'
import { pontuarViral, superficieDeTipo, type SinaisViral } from './algoritmo'
import { tendenciasParaPrompt } from './tendencias'
import { playbookAtual } from './aprendizado'

type Estruturado = {
  ganchoNota?: number
  ritmoNota?: number
  qualidadeNota?: number
  temWatermarkTiktok?: boolean
  ehRepost?: boolean
  engagementBait?: boolean
  temaEmAlta?: boolean
  temaCasado?: string | null
  diagnostico?: string
}

// Extrai o 1º objeto JSON balanceado (tolera ```json fences e texto/raciocínio em volta).
function extrairJson(txt: string): Estruturado {
  const limpo = txt.replace(/```json/gi, '').replace(/```/g, '')
  const ini = limpo.indexOf('{')
  if (ini < 0) return {}
  let nivel = 0, emString = false, escape = false
  for (let i = ini; i < limpo.length; i++) {
    const ch = limpo[i]
    if (emString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') emString = false
      continue
    }
    if (ch === '"') emString = true
    else if (ch === '{') nivel++
    else if (ch === '}' && --nivel === 0) {
      try { return JSON.parse(limpo.slice(ini, i + 1)) } catch { return {} }
    }
  }
  return {}
}

const clampNota = (n: unknown): number | null => {
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : null
}

/**
 * Analisa um post (por postId do IG). Reanalisa só se forcar=true (senão pula os já feitos).
 * Retorna o resultado ou null se não há nada a analisar.
 */
export async function analisarPostViral(postId: string, forcar = false) {
  const post = await prisma.bondPost.findFirst({ where: { postId }, include: { perfil: true } })
  if (!post) return { ok: false, erro: `post ${postId} não encontrado` }
  if (post.plataforma !== 'instagram') return { ok: false, erro: 'só Instagram na v1' }

  if (!forcar) {
    const existe = await prisma.bondViralScore.findUnique({ where: { postId } })
    if (existe) return { ok: true, pulado: true, score: existe.scoreTotal }
  }

  const seguidores = post.perfil?.seguidores || 0
  const superficie = superficieDeTipo(post.tipo)

  // (1) Gemini assiste a mídia (degrada para legenda se a mídia não vier).
  let leituraConteudo = ''
  const media = await getInstagramMedia(postId).catch(() => null)
  if (media) {
    const r = await analisarMidiaPost(media)
    if (r.ok && r.analise) leituraConteudo = r.analise
  }
  if (!leituraConteudo) leituraConteudo = `(mídia indisponível — análise pela legenda) Legenda: ${(post.conteudo || '').slice(0, 600)}`

  // Insights reais do IG (reach/saved/shares) — liga a camada B. Null se sem permissão.
  const insights = await getInstagramPostInsights(postId).catch(() => null) as { reach?: number; saved?: number; shares?: number; views?: number } | null

  // (2) Estrutura notas + casa com tendências + diagnóstico (texto grátis: Cerebras).
  const tendencias = await tendenciasParaPrompt(72)
  const playbook = await playbookAtual()
  const prompt = `Você é um analista de viralização de Instagram para um deputado estadual (RJ).${playbook ? `\n\nPLAYBOOK APRENDIDO DESTE PERFIL (o que comprovadamente espalha aqui — use como referência no diagnóstico):\n${playbook.slice(0, 1100)}\n` : ''}
Com base na ANÁLISE DE CONTEÚDO abaixo (feita assistindo a mídia), nas MÉTRICAS PÚBLICAS e nas TENDÊNCIAS atuais, devolva APENAS um JSON válido (sem texto antes/depois) no formato:
{"ganchoNota":0-10,"ritmoNota":0-10,"qualidadeNota":0-10,"temWatermarkTiktok":bool,"ehRepost":bool,"engagementBait":bool,"temaEmAlta":bool,"temaCasado":"termo da tendência que casou ou null","diagnostico":"3-5 frases honestas, em português: por que (não) viralizou; CITE palavras/frases concretas da legenda que ajudaram ou atrapalharam (e sugira a reescrita do gancho/abertura); o que mudar no próximo"}

ANÁLISE DE CONTEÚDO:
${leituraConteudo.slice(0, 2500)}

MÉTRICAS PÚBLICAS: likes=${post.likes} comentarios=${post.comentarios} compartilhos=${post.compartilhos} seguidores=${seguidores} tipo=${post.tipo}

TENDÊNCIAS ATUAIS (BR/RJ):
${tendencias.slice(0, 1200)}

Regra: temaEmAlta=true só se o tema do post realmente casar com alguma tendência listada. Seja honesto.`

  const resp = await callAI([{ role: 'user', content: prompt }], 900)
  const e = extrairJson(resp)

  // (3) Score determinístico via algoritmo.ts.
  const sinais: SinaisViral = {
    ganchoNota: clampNota(e.ganchoNota),
    ritmoNota: clampNota(e.ritmoNota),
    qualidadeNota: clampNota(e.qualidadeNota),
    likes: post.likes,
    comentarios: post.comentarios,
    compartilhos: post.compartilhos,
    seguidores,
    temaEmAlta: !!e.temaEmAlta,
    // camada B — insights reais do IG (reach/saves/sends). Null se a conta ainda não tiver permissão.
    reach: insights?.reach ?? (post.alcance || null),
    saves: insights?.saved ?? null,
    sends: insights?.shares ?? (post.compartilhos || null),
    videoViews: insights?.views ?? null,
    temWatermarkTiktok: !!e.temWatermarkTiktok,
    ehRepost: !!e.ehRepost,
    engagementBait: !!e.engagementBait,
  }
  const res = pontuarViral(superficie, sinais)

  // (4) Diagnóstico final = qualitativo do LLM + nota objetiva + honestidade de camada.
  const notaCega = res.camada === 'A'
    ? ` (Análise camada A: sem read_insights, não enxergo sends/saves/alcance — os sinais que mais explicam viral. Libere read_insights no app Meta para precisão.)`
    : ''
  const diagnostico = `${(e.diagnostico || 'Sem diagnóstico.').trim()} [score ${res.scoreTotal}/100, ${superficie}]${notaCega}`

  await prisma.bondViralScore.upsert({
    where: { postId },
    create: {
      postId, superficie, scoreTotal: res.scoreTotal, diagnostico,
      sinais: JSON.stringify({ breakdown: res.breakdown, gates: res.gatesAplicados }),
      ganchoNota: sinais.ganchoNota, temaEmAlta: !!e.temaEmAlta, temaCasado: e.temaCasado || null,
      camada: res.camada, conteudoResumo: leituraConteudo.slice(0, 800),
    },
    update: {
      superficie, scoreTotal: res.scoreTotal, diagnostico,
      sinais: JSON.stringify({ breakdown: res.breakdown, gates: res.gatesAplicados }),
      ganchoNota: sinais.ganchoNota, temaEmAlta: !!e.temaEmAlta, temaCasado: e.temaCasado || null,
      camada: res.camada, conteudoResumo: leituraConteudo.slice(0, 800),
    },
  })

  // Insight legível → aparece nas abas de Insights existentes (/hermes, /analise).
  await prisma.bondInsight.create({
    data: {
      titulo: `📊 Viral ${res.scoreTotal}/100 — ${superficie} de ${new Date(post.publicadoEm).toLocaleDateString('pt-BR')}`,
      descricao: diagnostico,
      tipo: 'conteudo',
      plataforma: 'instagram',
      dados: JSON.stringify({ postId, score: res.scoreTotal, camada: res.camada, url: post.url }),
    },
  })

  return { ok: true, postId, score: res.scoreTotal, camada: res.camada, superficie, diagnostico }
}

/**
 * Analisa os posts ainda sem BondViralScore (event-driven / backfill).
 * Pace simples para respeitar o free tier do Gemini (pausa entre posts).
 */
export async function analisarPostsPendentes(limite = 100, pausaMs = 4000) {
  const jaFeitos = new Set((await prisma.bondViralScore.findMany({ select: { postId: true } })).map((x) => x.postId))
  const posts = await prisma.bondPost.findMany({
    where: { plataforma: 'instagram' },
    orderBy: { publicadoEm: 'desc' },
    take: limite,
    select: { postId: true },
  })
  const pendentes = posts.filter((p) => !jaFeitos.has(p.postId))
  const resultados: { postId: string; score?: number; erro?: string }[] = []
  for (const p of pendentes) {
    try {
      const r = await analisarPostViral(p.postId)
      resultados.push({ postId: p.postId, score: (r as { score?: number }).score })
    } catch (err) {
      resultados.push({ postId: p.postId, erro: err instanceof Error ? err.message : String(err) })
    }
    if (pausaMs) await new Promise((r) => setTimeout(r, pausaMs))
  }
  return { analisados: resultados.length, pendentesTotal: pendentes.length, resultados }
}
