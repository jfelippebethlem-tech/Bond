import { prisma } from './db'
import { enfileirarBroadcast } from './whatsapp'
import { enfileirarBroadcastSms } from './sms'
import { enfileirarBroadcastEmail } from './email'
import { enfileirarBroadcastTelegram } from './telegram-broadcast'

const CANAIS_VALIDOS = ['whatsapp', 'sms', 'email', 'telegram']

// Valida o corpo de um disparo vindo da API. Fica aqui (não no route.ts) porque
// route handlers do App Router só podem exportar GET/POST/etc.
export function validarCorpoDisparo(body: unknown): { ok: boolean; erro?: string; valor?: { titulo: string; mensagem: string; assunto: string; canais: Array<'whatsapp'|'sms'|'email'|'telegram'>; audiencia: string[] } } {
  const b = (body || {}) as Record<string, unknown>
  const titulo = typeof b.titulo === 'string' ? b.titulo.trim() : ''
  const mensagem = typeof b.mensagem === 'string' ? b.mensagem.trim() : ''
  const assuntoRaw = typeof b.assunto === 'string' ? b.assunto.trim() : ''
  const canais = Array.isArray(b.canais) ? (b.canais as string[]) : []
  const audiencia = Array.isArray(b.audiencia) && b.audiencia.length ? (b.audiencia as string[]) : ['apoiador', 'coordenador']
  if (!titulo) return { ok: false, erro: 'titulo obrigatório' }
  if (!mensagem) return { ok: false, erro: 'mensagem obrigatória' }
  if (!canais.length) return { ok: false, erro: 'selecione ao menos um canal' }
  if (!canais.every((c) => CANAIS_VALIDOS.includes(c))) return { ok: false, erro: 'canal inválido' }
  return { ok: true, valor: { titulo, mensagem, assunto: assuntoRaw || titulo, canais: canais as Array<'whatsapp'|'sms'|'email'>, audiencia } }
}

export async function dispararCampanha(opts: {
  titulo: string
  mensagem: string
  audiencia: string[]
  canais: Array<'whatsapp' | 'sms' | 'email' | 'telegram'>
  assunto?: string
}): Promise<{ disparoId: string; whatsapp: number; sms: number; email: number; telegram: number; totalAlvo: number }> {
  const totalAlvo = await prisma.pessoa.count({
    where: { tipo: { in: opts.audiencia }, ativo: true, telefone: { not: null } },
  })
  const disparo = await prisma.disparo.create({
    data: { titulo: opts.titulo, mensagem: opts.mensagem, canais: opts.canais.join(','), audiencia: opts.audiencia.join(','), totalAlvo },
  })

  let whatsapp = 0
  let sms = 0
  let email = 0
  let telegram = 0
  if (opts.canais.includes('whatsapp')) {
    const r = await enfileirarBroadcast(opts.mensagem, 'broadcast', undefined, disparo.id, opts.audiencia)
    whatsapp = r.enfileirados
  }
  if (opts.canais.includes('sms')) {
    const r = await enfileirarBroadcastSms(opts.mensagem, 'broadcast', disparo.id, opts.audiencia)
    sms = r.enfileirados
  }
  if (opts.canais.includes('email')) {
    const r = await enfileirarBroadcastEmail(opts.assunto || opts.titulo, opts.mensagem, 'broadcast', disparo.id, opts.audiencia)
    email = r.enfileirados
  }
  if (opts.canais.includes('telegram')) {
    const r = await enfileirarBroadcastTelegram(opts.mensagem, 'broadcast', disparo.id)
    telegram = r.enfileirados
  }
  await prisma.disparo.update({ where: { id: disparo.id }, data: { enfileirados: whatsapp + sms + email + telegram } })
  return { disparoId: disparo.id, whatsapp, sms, email, telegram, totalAlvo }
}
