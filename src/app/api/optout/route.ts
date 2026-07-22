import { NextResponse } from 'next/server'
import { verificarHashOptOut, registrarOptOutEmail } from '@/lib/optout'
import { normalizarEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

function pagina(titulo: string, msg: string, status = 200) {
  const html = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:64px auto;padding:24px;color:#222;text-align:center">
<h2 style="font-weight:600">${titulo}</h2><p style="color:#555">${msg}</p></body></html>`
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const email = normalizarEmail(url.searchParams.get('e'))
  const h = url.searchParams.get('h') || ''
  if (!email || !verificarHashOptOut(email, h)) {
    return pagina('Link inválido', 'Este link de descadastro é inválido ou expirou.', 400)
  }
  await registrarOptOutEmail(email, 'link de descadastro')
  return pagina('Você foi descadastrado', 'Pronto — você não receberá mais nossos emails. 👋')
}
