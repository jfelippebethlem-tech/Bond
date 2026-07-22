/**
 * Canal Email GRATUITO via Brevo (API HTTP, free tier 300/dia).
 * Este módulo cuida da FILA (enfileirar/broadcast) e do cliente HTTP da Brevo.
 * O envio real é drenado por email-worker.ts → emailDrain.ts.
 */
import { prisma } from './db'
import { estaOptOutEmail, hashEmailOptOut } from './optout'

export function normalizarEmail(email?: string | null): string | null {
  if (!email) return null
  const e = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return null
  return e
}

/** Monta o HTML final: corpo (texto escapado, quebras viram <br>) + rodapé de descadastro assinado. */
export function montarHtmlEmail(corpoTexto: string, email: string, appUrl: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const corpo = esc(corpoTexto).replace(/\n/g, '<br>')
  const h = hashEmailOptOut(email)
  const link = `${appUrl.replace(/\/$/, '')}/api/optout?e=${encodeURIComponent(email)}&h=${h}`
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px;margin:0 auto;padding:16px">
<div>${corpo}</div>
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
<p style="font-size:12px;color:#888">Você recebe este email porque autorizou receber nossas comunicações. <a href="${link}" style="color:#888">Descadastrar</a>.</p>
</body></html>`
}

export async function enviarViaBrevo(email: string, assunto: string, html: string, texto: string): Promise<{ ok: boolean; id?: string; erro?: string }> {
  const key = process.env.BREVO_API_KEY
  if (!key) return { ok: false, erro: 'BREVO_API_KEY não configurada' }
  const sender = {
    name: process.env.EMAIL_REMETENTE_NOME || 'Gabinete',
    email: process.env.EMAIL_REMETENTE_ENDERECO || '',
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender, to: [{ email }], subject: assunto, htmlContent: html, textContent: texto }),
    })
    if (!res.ok) return { ok: false, erro: `brevo ${res.status}` }
    const j = (await res.json().catch(() => ({}))) as { messageId?: string }
    return { ok: true, id: j.messageId }
  } catch (e) {
    return { ok: false, erro: String(e) }
  }
}

export async function enfileirarEmail(opts: {
  email: string; assunto: string; corpo: string; tipo?: string; pessoaId?: string; campanhaId?: string; referencia?: string; agendadoPara?: Date
}): Promise<{ ok: true; email: string } | { ok: false; motivo: string }> {
  const email = normalizarEmail(opts.email)
  if (!email) return { ok: false, motivo: 'email inválido' }
  if (await estaOptOutEmail(email)) return { ok: false, motivo: 'opt-out' }
  await prisma.emailFila.create({
    data: {
      email, assunto: opts.assunto, corpo: opts.corpo, tipo: opts.tipo ?? 'newsletter',
      pessoaId: opts.pessoaId, campanhaId: opts.campanhaId, referencia: opts.referencia, agendadoPara: opts.agendadoPara,
    },
  })
  return { ok: true, email }
}

export async function enfileirarBroadcastEmail(
  assunto: string, corpo: string, tipo = 'broadcast', campanhaId?: string, audiencia: string[] = ['apoiador', 'coordenador'],
): Promise<{ enfileirados: number; totalAlvo: number }> {
  const pessoas = await prisma.pessoa.findMany({
    where: { tipo: { in: audiencia }, ativo: true, email: { not: null } },
    select: { id: true, email: true },
  })
  let enfileirados = 0
  for (const p of pessoas) {
    const r = await enfileirarEmail({ email: p.email!, assunto, corpo, tipo, pessoaId: p.id, campanhaId })
    if (r.ok) enfileirados++
  }
  return { enfileirados, totalAlvo: pessoas.length }
}
