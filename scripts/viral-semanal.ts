// Consolidação semanal do Analista de Redes: captura tendências, roda o benchmark
// de referências e gera a recomendação dos próximos posts. Tudo grátis.
// Uso: npx tsx scripts/viral-semanal.ts   (chamado por run-viral-semanal.sh no cron)
import { capturarTendencias } from '../src/lib/viral/tendencias'
import { analisarReferencias } from '../src/lib/viral/benchmark'
import { aprenderPadroesVirais } from '../src/lib/viral/aprendizado'
import { gerarRecomendacaoSemanal } from '../src/lib/viral/recomendador'

;(async () => {
  console.log('[viral-semanal] capturando tendências...')
  const t = await capturarTendencias()
  console.log('  ', JSON.stringify(t))

  console.log('[viral-semanal] benchmark de referências...')
  const b = await analisarReferencias()
  console.log('  ', b.ok ? `ok — ${b.nPosts} posts de ${b.perfis?.length} perfis` : `pulado: ${b.erro}`)

  console.log('[viral-semanal] aprendendo padrões (inteligência progressiva)...')
  const ap = await aprenderPadroesVirais()
  console.log('  ', ap.ok ? `aprendeu de ${ap.n} posts (calibração ${ap.calibracao})` : `pulado: ${ap.erro}`)

  console.log('[viral-semanal] gerando recomendação...')
  const r = await gerarRecomendacaoSemanal()
  console.log('  ', JSON.stringify(r))

  console.log('[viral-semanal] concluído.')
  process.exit(0)
})().catch((e) => {
  console.error('[viral-semanal] erro:', e instanceof Error ? e.message : e)
  process.exit(1)
})
