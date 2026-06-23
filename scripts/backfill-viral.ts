// Backfill único: analisa os últimos 100 posts do IG ainda sem BondViralScore.
// Idempotente (pula os já feitos) e paceado p/ respeitar o free tier do Gemini.
// Uso: npx tsx scripts/backfill-viral.ts [limite]
import { analisarPostsPendentes } from '../src/lib/viral/analista'

const limite = parseInt(process.argv[2] || '100', 10)

analisarPostsPendentes(limite)
  .then((r) => {
    console.log(`[backfill-viral] analisados ${r.analisados}/${r.pendentesTotal} pendentes`)
    for (const x of r.resultados) console.log(`  ${x.postId}: ${x.erro ? 'ERRO ' + x.erro : 'score ' + x.score}`)
    process.exit(0)
  })
  .catch((e) => {
    console.error('[backfill-viral] erro:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
