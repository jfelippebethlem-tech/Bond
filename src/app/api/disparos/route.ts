import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { dispararCampanha } from '@/lib/disparo'

const CANAIS_VALIDOS = ['whatsapp', 'sms']

export function validarCorpoDisparo(body: unknown): { ok: boolean; erro?: string; valor?: { titulo: string; mensagem: string; canais: Array<'whatsapp'|'sms'>; audiencia: string[] } } {
  const b = (body || {}) as Record<string, unknown>
  const titulo = typeof b.titulo === 'string' ? b.titulo.trim() : ''
  const mensagem = typeof b.mensagem === 'string' ? b.mensagem.trim() : ''
  const canais = Array.isArray(b.canais) ? (b.canais as string[]) : []
  const audiencia = Array.isArray(b.audiencia) && b.audiencia.length ? (b.audiencia as string[]) : ['apoiador', 'coordenador']
  if (!titulo) return { ok: false, erro: 'titulo obrigatório' }
  if (!mensagem) return { ok: false, erro: 'mensagem obrigatória' }
  if (!canais.length) return { ok: false, erro: 'selecione ao menos um canal' }
  if (!canais.every((c) => CANAIS_VALIDOS.includes(c))) return { ok: false, erro: 'canal inválido' }
  return { ok: true, valor: { titulo, mensagem, canais: canais as Array<'whatsapp'|'sms'>, audiencia } }
}

export async function GET() {
  const [campanhas, numeros] = await Promise.all([
    prisma.disparo.findMany({ orderBy: { criadoEm: 'desc' }, take: 30 }),
    prisma.whatsappNumero.findMany({ orderBy: { criadoEm: 'asc' } }),
  ])
  return NextResponse.json({ campanhas, numeros })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const v = validarCorpoDisparo(body)
  if (!v.ok || !v.valor) return NextResponse.json({ erro: v.erro }, { status: 400 })
  const r = await dispararCampanha(v.valor)
  return NextResponse.json(r)
}
