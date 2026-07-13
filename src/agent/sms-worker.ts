/**
 * SMS Worker — drena SmsFila e envia via Android SMS Gateway (capcom6, modo Local Server).
 * Execute: npm run sms
 * Config em .env: SMS_GATEWAY_URL, SMS_GATEWAY_USER, SMS_GATEWAY_PASS.
 */
import { prisma } from '../lib/db'
import { enviarViaGateway } from '../lib/sms'
import { estaOptOut } from '../lib/optout'

const INTERVALO_FILA = 15_000
const MAX_TENTATIVAS = 3

function jitterMs(): number {
  const min = 3_000, max = 10_000
  return min + Math.floor(Math.random() * (max - min))
}

async function drenarFila() {
  const pendentes = await prisma.smsFila.findMany({
    where: {
      status: 'pendente',
      tentativas: { lt: MAX_TENTATIVAS },
      OR: [{ agendadoPara: null }, { agendadoPara: { lte: new Date() } }],
    },
    orderBy: { criadoEm: 'asc' },
    take: 50,
  })
  for (const msg of pendentes) {
    if (await estaOptOut(msg.telefone)) {
      await prisma.smsFila.update({ where: { id: msg.id }, data: { status: 'cancelado' } })
      continue
    }
    const ok = await enviarViaGateway(msg.telefone, msg.mensagem)
    if (ok) {
      await prisma.smsFila.update({ where: { id: msg.id }, data: { status: 'enviado', enviadoEm: new Date() } })
      console.log(`[SMS] ✓ ${msg.telefone}`)
    } else {
      const tentativas = msg.tentativas + 1
      await prisma.smsFila.update({ where: { id: msg.id }, data: { tentativas, status: tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente', erro: 'falha no gateway' } })
    }
    await new Promise((r) => setTimeout(r, jitterMs()))
  }
}

async function main() {
  console.log('📲 SMS Worker iniciando (Android Gateway)...')
  setInterval(() => { drenarFila().catch((e) => console.error('[SMS] erro fila:', e)) }, INTERVALO_FILA)
  console.log('[SMS] ✓ Rodando. Fila a cada 15s.\n')
}

main().catch((err) => { console.error('[SMS] Erro fatal:', err); process.exit(1) })
