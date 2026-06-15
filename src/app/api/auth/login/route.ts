import { NextRequest, NextResponse } from 'next/server'
import { signToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { password } = await req.json()
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

  if (password !== adminPassword) {
    return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
  }

  const token = await signToken({ role: 'admin', ts: Date.now() })
  const response = NextResponse.json({ ok: true })

  response.cookies.set('pm_session', token, {
    httpOnly: true,
    // secure só quando servido por HTTPS — ative COOKIE_SECURE=true junto com nginx+TLS.
    // Em HTTP puro (acesso direto :3000), secure:true faria o navegador DESCARTAR o cookie
    // e o login "voltaria" pra tela de login. Default false p/ funcionar em HTTP.
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  return response
}
