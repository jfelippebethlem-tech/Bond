/**
 * Telegram Worker — drena TelegramFila e envia via Bot API (grátis).
 * Execute: npm run telegram
 * Config em .env: TELEGRAM_BOT_TOKEN, TELEGRAM_CANAL.
 * A lógica de drain vive em src/lib/telegramDrain.ts (testável).
 */
import { drenarFilaTelegram } from '../lib/telegramDrain'

const INTERVALO_FILA = 20_000

let drenando = false

async function drenarFila() {
  if (drenando) return
  drenando = true
  try {
    const r = await drenarFilaTelegram()
    if (r.enviados || r.falhas) console.log(`[Telegram] enviados=${r.enviados} falhas=${r.falhas}`)
  } finally {
    drenando = false
  }
}

async function main() {
  console.log('✈️  Telegram Worker iniciando (Bot API)...')
  setInterval(() => { drenarFila().catch((e) => console.error('[Telegram] erro fila:', e)) }, INTERVALO_FILA)
  console.log('[Telegram] ✓ Rodando. Fila a cada 20s.\n')
}

main().catch((err) => { console.error('[Telegram] Erro fatal:', err); process.exit(1) })
