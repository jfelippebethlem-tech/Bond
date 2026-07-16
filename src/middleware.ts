import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'

// /guia-*, /privacidade, /termos são páginas públicas (instrução/legais, sem dado sensível) —
// abertas sem login. Privacidade/Termos são exigidas pelo Facebook Login (URLs públicas).
// /api/ingest tem auth própria (token x-ingest-token), por isso fora da sessão.
const publicPaths = ['/login', '/api/auth/login', '/guia-', '/privacidade', '/termos', '/exclusao-dados', '/guia-permissoes', '/api/ingest']

// Headers de segurança aplicados a todas as respostas. CSP NAO incluida aqui de proposito:
// uma policy errada quebra a app Next (estilos/scripts inline) — adicionar depois, testada.
function comHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (process.env.COOKIE_SECURE === 'true') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  return res
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  if (publicPaths.some((p) => path.startsWith(p))) {
    return comHeaders(NextResponse.next())
  }

  if (path.startsWith('/api/')) {
    const session = await getSessionFromRequest(req)
    if (!session) {
      return comHeaders(NextResponse.json({ error: 'Não autorizado' }, { status: 401 }))
    }
    return comHeaders(NextResponse.next())
  }

  const session = await getSessionFromRequest(req)
  if (!session) {
    return comHeaders(NextResponse.redirect(new URL('/login', req.url)))
  }

  return comHeaders(NextResponse.next())
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
