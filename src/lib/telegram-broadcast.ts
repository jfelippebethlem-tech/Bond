/**
 * Canal Telegram GRATUITO — broadcast num canal do bot via Bot API HTTP.
 * NÃO reusa a instância de polling de bot/telegram.ts (conflitaria).
 * Envio real drenado por telegram-worker.ts → telegramDrain.ts.
 */
import { prisma } from './db'

export async function enviarTelegramMensagem(destino: string, texto: string): Promise<{ ok: boolean; id?: string; erro?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, erro: 'TELEGRAM_BOT_TOKEN não configurado' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: destino, text: texto, disable_web_page_preview: true }),
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number }; description?: string }
    if (!res.ok || !j.ok) return { ok: false, erro: j.description || `telegram ${res.status}` }
    return { ok: true, id: j.result?.message_id ? String(j.result.message_id) : undefined }
  } catch (e) {
    return { ok: false, erro: String(e) }
  }
}

export async function enfileirarBroadcastTelegram(mensagem: string, tipo = 'broadcast', campanhaId?: string): Promise<{ enfileirados: number; destino: string | null }> {
  const destino = (process.env.TELEGRAM_CANAL || '').trim() || null
  if (!destino) return { enfileirados: 0, destino: null }
  await prisma.telegramFila.create({ data: { destino, modo: 'canal', mensagem, tipo, campanhaId } })
  return { enfileirados: 1, destino }
}
