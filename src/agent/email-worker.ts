/**
 * Email Worker — drena EmailFila e envia via Brevo (grátis 300/dia).
 * Execute: npm run email
 * Config em .env: BREVO_API_KEY, EMAIL_REMETENTE_NOME, EMAIL_REMETENTE_ENDERECO.
 * A lógica de drain vive em src/lib/emailDrain.ts (testável).
 */
import { drenarFilaEmail } from '../lib/emailDrain'

const INTERVALO_FILA = 30_000

let drenando = false

async function drenarFila() {
  if (drenando) return
  drenando = true
  try {
    const r = await drenarFilaEmail()
    if (r.enviados || r.cancelados || r.falhas) console.log(`[Email] enviados=${r.enviados} cancelados=${r.cancelados} falhas=${r.falhas}${r.tetoAtingido ? ' (teto do dia atingido)' : ''}`)
  } finally {
    drenando = false
  }
}

async function main() {
  console.log('📧 Email Worker iniciando (Brevo)...')
  setInterval(() => { drenarFila().catch((e) => console.error('[Email] erro fila:', e)) }, INTERVALO_FILA)
  console.log('[Email] ✓ Rodando. Fila a cada 30s.\n')
}

main().catch((err) => { console.error('[Email] Erro fatal:', err); process.exit(1) })
