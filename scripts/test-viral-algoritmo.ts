// Teste do núcleo de scoring (sem framework — roda com: npx tsx scripts/test-viral-algoritmo.ts)
import assert from 'node:assert'
import { pontuarViral, superficieDeTipo } from '../src/lib/viral/algoritmo'

let ok = 0
const t = (nome: string, fn: () => void) => { fn(); ok++; console.log('  ✓', nome) }

console.log('algoritmo.ts:')

t('camada A: conteúdo forte + tema em alta → score alto', () => {
  const r = pontuarViral('reel', { ganchoNota: 9, ritmoNota: 8, qualidadeNota: 8, likes: 500, comentarios: 40, compartilhos: 30, seguidores: 10000, temaEmAlta: true })
  assert.strictEqual(r.camada, 'A')
  assert.ok(r.scoreTotal >= 60, `esperava >=60, veio ${r.scoreTotal}`)
})

t('camada A: conteúdo fraco → score baixo', () => {
  const r = pontuarViral('reel', { ganchoNota: 2, ritmoNota: 2, qualidadeNota: 3, likes: 10, comentarios: 0, compartilhos: 0, seguidores: 10000, temaEmAlta: false })
  assert.ok(r.scoreTotal <= 30, `esperava <=30, veio ${r.scoreTotal}`)
})

t('camada B: reach real presente → usa modo algoritmo', () => {
  const r = pontuarViral('reel', { reach: 20000, sends: 300, saves: 500, completionPct: 65, likes: 800, comentarios: 50, alcanceNaoSeguidores: 14000 })
  assert.strictEqual(r.camada, 'B')
  assert.ok(r.scoreTotal > 0)
  assert.strictEqual(r.sinaisFaltando.length, 0, 'camada B não deveria reportar cegueira')
})

t('camada A reporta cegueira de sends/saves/reach', () => {
  const r = pontuarViral('reel', { ganchoNota: 7, seguidores: 10000, likes: 100 })
  assert.ok(r.sinaisFaltando.some((s) => s.includes('sends')))
})

t('gate watermark TikTok derruba ~0.35×', () => {
  const base = pontuarViral('reel', { ganchoNota: 9, ritmoNota: 9, qualidadeNota: 9, seguidores: 10000, likes: 500, comentarios: 40, compartilhos: 30, temaEmAlta: true })
  const comGate = pontuarViral('reel', { ganchoNota: 9, ritmoNota: 9, qualidadeNota: 9, seguidores: 10000, likes: 500, comentarios: 40, compartilhos: 30, temaEmAlta: true, temWatermarkTiktok: true })
  assert.ok(comGate.scoreTotal < base.scoreTotal)
  assert.strictEqual(comGate.gatesAplicados[0].fator, 0.35)
})

t('gate baixa qualidade zera o score', () => {
  const r = pontuarViral('reel', { ganchoNota: 9, seguidores: 10000, likes: 500, baixaQualidade: true })
  assert.strictEqual(r.scoreTotal, 0)
})

t('superficieDeTipo mapeia corretamente', () => {
  assert.strictEqual(superficieDeTipo('video', 'VIDEO'), 'reel')
  assert.strictEqual(superficieDeTipo(null, 'CAROUSEL_ALBUM'), 'carrossel')
  assert.strictEqual(superficieDeTipo('foto', 'IMAGE'), 'foto')
})

console.log(`\n✅ ${ok} testes passaram`)
