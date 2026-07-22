import crypto from 'crypto'

import { prisma } from './db'

const PALAVRAS = ['sair', 'parar', 'pare', 'stop', 'descadastrar', 'cancelar']

/** Normaliza (sem acento, minúsculo, trim) e testa se é um comando de opt-out. */
export function isPalavraOptOut(texto: string): boolean {
  const t = (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
  return PALAVRAS.includes(t)
}

export async function estaOptOut(telefone: string): Promise<boolean> {
  const o = await prisma.optOut.findUnique({ where: { telefone } })
  return !!o
}

export async function registrarOptOut(telefone: string, canal = 'todos', origem?: string): Promise<void> {
  await prisma.optOut.upsert({
    where: { telefone },
    update: { canal, origem },
    create: { telefone, canal, origem },
  })
}

export async function estaOptOutEmail(email: string): Promise<boolean> {
  const o = await prisma.optOut.findUnique({ where: { email } })
  return !!o
}

export async function registrarOptOutEmail(email: string, origem?: string): Promise<void> {
  await prisma.optOut.upsert({
    where: { email },
    update: { canal: 'email', origem },
    create: { email, canal: 'email', origem },
  })
}

/** Link de descadastro assinado — HMAC-SHA256 do email normalizado, truncado a 32 hex. */
export function hashEmailOptOut(email: string): string {
  const secret = process.env.EMAIL_OPTOUT_SECRET || process.env.JWT_SECRET || 'dev-secret'
  return crypto.createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex').slice(0, 32)
}

export function verificarHashOptOut(email: string, h: string): boolean {
  const esperado = hashEmailOptOut(email)
  if (!h || h.length !== esperado.length) return false
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(esperado))
}
