// BENCHMARK — aprende padrões de viral de perfis de referência (público, grátis).
//
// Usa a Graph API business_discovery (só dá legenda/tipo/likes/comments de contas
// business — sem media_url, então é análise de TEXTO+engajamento, não multimodal).
// Extrai padrões transferíveis (gancho/formato/tema) e grava um BondInsight.
import { prisma } from '../db'
import { callAI } from '../hermes'
import { getInstagramBusinessDiscovery } from '../social/instagram'
import { REFERENCIAS, type Referencia } from './referencias'

type PostRef = { handle: string; grupo: string; caption: string; tipo: string; likes: number; comentarios: number; engRate: number; permalink?: string }

async function topPostsDe(igId: string, ref: Referencia): Promise<PostRef[]> {
  const bd = await getInstagramBusinessDiscovery(igId, ref.handle, 12).catch(() => null)
  if (!bd?.media?.data?.length || !bd.followers_count) return []
  const seg = bd.followers_count
  return bd.media.data
    .map((m: { caption?: string; media_type?: string; like_count?: number; comments_count?: number; permalink?: string }) => ({
      handle: ref.handle,
      grupo: ref.grupo,
      caption: (m.caption || '').slice(0, 200),
      tipo: m.media_type || 'IMAGE',
      likes: m.like_count || 0,
      comentarios: m.comments_count || 0,
      engRate: ((m.like_count || 0) + (m.comments_count || 0)) / seg,
      permalink: m.permalink,
    }))
    .sort((a: PostRef, b: PostRef) => b.engRate - a.engRate)
    .slice(0, 3)
}

/**
 * Varre os perfis de referência, pega os posts mais engajados de cada um e extrai
 * padrões transferíveis ao nicho do deputado. Grava um BondInsight. 100% grátis.
 */
export async function analisarReferencias() {
  const igId = process.env.INSTAGRAM_BUSINESS_ID
  if (!igId) return { ok: false, erro: 'INSTAGRAM_BUSINESS_ID ausente' }

  const lotes = await Promise.all(REFERENCIAS.map((r) => topPostsDe(igId, r)))
  const tops = lotes.flat()
  if (!tops.length) return { ok: false, erro: 'nenhum perfil de referência resolveu (contas não-business ou token sem permissão)' }

  const lista = tops
    .map((p) => `@${p.handle} [${p.grupo}/${p.tipo}] eng=${(p.engRate * 100).toFixed(1)}% ❤${p.likes} 💬${p.comentarios}: "${p.caption}"`)
    .join('\n')

  const prompt = `Você é estrategista de conteúdo de um deputado estadual (RJ, fiscalização/controle externo).
Abaixo, os posts MAIS ENGAJADOS de perfis de referência (políticos e de outras áreas). Extraia PADRÕES TRANSFERÍVEIS ao nicho político — o que faz viralizar e como aplicar ao mandato, sem perder a pauta. Responda em português, sem markdown com asteriscos, no formato:

GANCHOS QUE FUNCIONAM:
- [2-4 padrões de abertura/gancho observados]

FORMATOS E RITMO:
- [o que os formatos campeões têm em comum]

TEMAS/EMOÇÕES:
- [emoções e temas que puxam engajamento]

COMO APLICAR AO DEPUTADO (3 ideias concretas):
- [3 ideias acionáveis para os próximos posts, ligando viral à pauta de fiscalização]

POSTS DE REFERÊNCIA:
${lista.slice(0, 2200)}`

  const padroes = await callAI([{ role: 'user', content: prompt }], 900)

  await prisma.bondInsight.create({
    data: {
      titulo: `🎯 Benchmark de referências — ${new Date().toLocaleDateString('pt-BR')}`,
      descricao: padroes,
      tipo: 'conteudo',
      plataforma: 'instagram',
      dados: JSON.stringify({ perfis: Array.from(new Set(tops.map((t) => t.handle))), nPosts: tops.length }),
    },
  })

  return { ok: true, perfis: Array.from(new Set(tops.map((t) => t.handle))), nPosts: tops.length, padroes }
}
