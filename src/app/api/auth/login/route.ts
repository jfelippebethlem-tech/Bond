import { NextRequest, NextResponse } from 'next/server'
import { signToken } from '@/lib/auth'

// Rate limit simples em memória: 5 tentativas por IP a cada 15 min (anti-brute-force).
// Em memória basta p/ instância única; com múltiplas instâncias, trocar por store compartilhado.
const JANELA_MS = 15 * 60 * 1000
const MAX_TENTATIVAS = 5
const tentativas = new Map<string, { n: number; reset: number }>()

function ipDe(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  return (fwd ? fwd.split(',')[0].trim() : '') || req.headers.get('x-real-ip') || 'desconhecido'
}

export async function POST(req: NextRequest) {
  const ip = ipDe(req)
  const agora = Date.now()
  const reg = tentativas.get(ip)
  if (reg && agora < reg.reset && reg.n >= MAX_TENTATIVAS) {
    return NextResponse.json(
      { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
      { status: 429 },
    )
  }

  const { password } = await req.json()
  const adminPassword = process.env.ADMIN_PASSWORD
  // Falha fechada: sem ADMIN_PASSWORD configurado, nenhum login é aceito (sem default inseguro).
  if (!adminPassword) {
    return NextResponse.json({ error: 'Servidor sem ADMIN_PASSWORD configurado' }, { status: 500 })
  }

  if (password !== adminPassword) {
    const prox = reg && agora < reg.reset ? { n: reg.n + 1, reset: reg.reset } : { n: 1, reset: agora + JANELA_MS }
    tentativas.set(ip, prox)
    return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
  }

  tentativas.delete(ip) // sucesso zera o contador do IP

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
