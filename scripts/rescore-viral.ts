// Re-analisa TODOS os posts IG já pontuados, agora em camada B (insights reais).
// forcar=true → reprocessa mesmo quem já tem score. Paceado p/ free tier do Gemini.
// Uso: npx tsx scripts/rescore-viral.ts [limite]
import { prisma } from '../src/lib/db'
import { analisarPostViral } from '../src/lib/viral/analista'

const limite = parseInt(process.argv[2] || '200', 10)

;(async () => {
  const postsComScore = await prisma.bondViralScore.findMany({ select: { postId: true }, orderBy: { criadoEm: 'desc' }, take: limite })
  let b = 0, a = 0, erros = 0
  for (const { postId } of postsComScore) {
    try {
      const r = await analisarPostViral(postId, true) as { camada?: string }
      if (r.camada === 'B') b++; else a++
    } catch { erros++ }
    await new Promise((res) => setTimeout(res, 4000))
  }
  console.log(`[rescore-viral] concluído: ${b} em camada B, ${a} em camada A, ${erros} erros (de ${postsComScore.length})`)
  process.exit(0)
})().catch((e) => { console.error('[rescore-viral] erro:', e instanceof Error ? e.message : e); process.exit(1) })
