// Backfill LEVE de sendWorthy + gatilhos nos posts já analisados.
// Reusa o conteudoResumo já salvo (NÃO re-assiste a mídia). Só 1 chamada de texto (Cerebras, grátis) por post.
// Uso: npx tsx scripts/backfill-sendworthy.ts
import { prisma } from '../src/lib/db'
import { callAI } from '../src/lib/hermes'
import { playbookParaAnalise } from '../src/lib/viral/aprendizado'

// extrator string-aware (chave dentro de string não fecha cedo)
function extrair(txt: string): { sendWorthy?: number; gatilhos?: string[] } {
  const limpo = txt.replace(/```json/gi, '').replace(/```/g, '')
  const ini = limpo.indexOf('{')
  if (ini < 0) return {}
  let nivel = 0, emStr = false, esc = false
  for (let i = ini; i < limpo.length; i++) {
    const c = limpo[i]
    if (emStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') emStr = false; continue }
    if (c === '"') emStr = true
    else if (c === '{') nivel++
    else if (c === '}' && --nivel === 0) { try { return JSON.parse(limpo.slice(ini, i + 1)) } catch { return {} } }
  }
  return {}
}

;(async () => {
  const psico = await playbookParaAnalise()
  const scores = await prisma.bondViralScore.findMany()
  let feitos = 0, pulados = 0
  for (const s of scores) {
    let sin: Record<string, unknown> = {}
    try { sin = JSON.parse(s.sinais || '{}') } catch { /* */ }
    if (sin.sendWorthy != null) { pulados++; continue } // já tem
    const post = await prisma.bondPost.findFirst({ where: { postId: s.postId }, select: { conteudo: true, likes: true, comentarios: true } })
    const prompt = `Você é analista de viralização de Instagram (deputado RJ).\n${psico}\n\nCom base na ANÁLISE e na LEGENDA, devolva APENAS um JSON: {"sendWorthy":0-10,"gatilhos":["gatilhos mentais usados"]}. sendWorthy = quantos dos 10 itens do CHECKLIST SEND-WORTHY o post tem.\n\nANÁLISE DA MÍDIA:\n${(s.conteudoResumo || '').slice(0, 1500)}\nLEGENDA: ${(post?.conteudo || '').slice(0, 300)}\nMÉTRICAS: likes ${post?.likes ?? 0}, comentários ${post?.comentarios ?? 0}.`
    try {
      const e = extrair(await callAI([{ role: 'user', content: prompt }], 1600))
      sin.sendWorthy = typeof e.sendWorthy === 'number' ? Math.max(0, Math.min(10, e.sendWorthy)) : null
      sin.gatilhos = Array.isArray(e.gatilhos) ? e.gatilhos.slice(0, 8) : []
      await prisma.bondViralScore.update({ where: { postId: s.postId }, data: { sinais: JSON.stringify(sin) } })
      feitos++
    } catch { /* pula o que falhar */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log(`[backfill-sendworthy] preenchidos ${feitos}, já tinham ${pulados} (de ${scores.length})`)
  process.exit(0)
})().catch((e) => { console.error('erro:', e instanceof Error ? e.message : e); process.exit(1) })
