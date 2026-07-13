import { prisma } from './db'
import { normalizarTelefone } from './whatsapp'
import { estaOptOut } from './optout'

type GatewayCfg = { url: string; user: string; pass: string }

export function montarRequisicaoGateway(telefone: string, texto: string, cfg: GatewayCfg) {
  const e164 = telefone.startsWith('+') ? telefone : '+' + telefone
  const auth = Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64')
  return {
    url: `${cfg.url.replace(/\/$/, '')}/message`,
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` } as Record<string, string>,
    body: JSON.stringify({ textMessage: { text: texto }, phoneNumbers: [e164] }),
  }
}

function cfgDoAmbiente(): GatewayCfg | null {
  const url = process.env.SMS_GATEWAY_URL
  const user = process.env.SMS_GATEWAY_USER
  const pass = process.env.SMS_GATEWAY_PASS
  if (!url || !user || !pass) return null
  return { url, user, pass }
}

export async function enviarViaGateway(telefone: string, texto: string): Promise<boolean> {
  const cfg = cfgDoAmbiente()
  if (!cfg) { console.error('[SMS] gateway não configurado (.env)'); return false }
  const req = montarRequisicaoGateway(telefone, texto, cfg)
  try {
    const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body })
    return res.ok
  } catch (e) { console.error('[SMS] erro no gateway:', e); return false }
}

export async function enfileirarSms(opts: { telefone: string; mensagem: string; tipo?: string; pessoaId?: string; referencia?: string; agendadoPara?: Date }) {
  const tel = normalizarTelefone(opts.telefone)
  if (!tel) return { ok: false as const, motivo: 'telefone inválido' }
  if (await estaOptOut(tel)) return { ok: false as const, motivo: 'opt-out' }
  await prisma.smsFila.create({
    data: { telefone: tel, mensagem: opts.mensagem, tipo: opts.tipo ?? 'notificacao', pessoaId: opts.pessoaId, referencia: opts.referencia, agendadoPara: opts.agendadoPara },
  })
  return { ok: true as const, telefone: tel }
}

export async function enfileirarBroadcastSms(mensagem: string, tipo = 'broadcast', campanhaId?: string, audiencia: string[] = ['apoiador', 'coordenador']) {
  const apoiadores = await prisma.pessoa.findMany({
    where: { tipo: { in: audiencia }, ativo: true, telefone: { not: null } },
    select: { id: true, telefone: true },
  })
  let enfileirados = 0
  for (const p of apoiadores) {
    const r = await enfileirarSms({ telefone: p.telefone!, mensagem, tipo, pessoaId: p.id, referencia: campanhaId })
    if (r.ok) enfileirados++
  }
  return { enfileirados, totalApoiadores: apoiadores.length }
}
