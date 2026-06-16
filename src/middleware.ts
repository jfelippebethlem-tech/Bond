import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'

// /guia-*, /privacidade, /termos são páginas públicas (instrução/legais, sem dado sensível) —
// abertas sem login. Privacidade/Termos são exigidas pelo Facebook Login (URLs públicas).
// /api/ingest tem auth própria (token x-ingest-token), por isso fora da sessão.
const publicPaths = ['/login', '/api/auth/login', '/guia-', '/privacidade', '/termos', '/exclusao-dados', '/guia-permissoes', '/api/ingest']

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  if (publicPaths.some((p) => path.startsWith(p))) {
    return NextResponse.next()
  }

  if (path.startsWith('/api/')) {
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }
    return NextResponse.next()
  }

  const session = await getSessionFromRequest(req)
  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
