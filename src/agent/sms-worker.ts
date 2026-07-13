/**
 * SMS Worker — drena SmsFila e envia via Android SMS Gateway (capcom6, modo Local Server).
 * Execute: npm run sms
 * Config em .env: SMS_GATEWAY_URL, SMS_GATEWAY_USER, SMS_GATEWAY_PASS.
 * A lógica de drain vive em src/lib/smsDrain.ts (testável).
 */
import { drenarFilaSms } from '../lib/smsDrain'

const INTERVALO_FILA = 15_000

let drenando = false

async function drenarFila() {
  if (drenando) return
  drenando = true
  try {
    await drenarFilaSms()
  } finally {
    drenando = false
  }
}

async function main() {
  console.log('📲 SMS Worker iniciando (Android Gateway)...')
  setInterval(() => { drenarFila().catch((e) => console.error('[SMS] erro fila:', e)) }, INTERVALO_FILA)
  console.log('[SMS] ✓ Rodando. Fila a cada 15s.\n')
}

main().catch((err) => { console.error('[SMS] Erro fatal:', err); process.exit(1) })
