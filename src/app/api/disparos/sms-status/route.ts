import { NextResponse } from 'next/server'

// Status vivo do gateway: sempre reavaliar em runtime (senão o build congela o valor).
export const dynamic = 'force-dynamic'

export async function GET() {
  const url = process.env.SMS_GATEWAY_URL
  if (!url) return NextResponse.json({ configurado: false, online: false })
  try {
    const res = await fetch(url, { method: 'GET' })
    return NextResponse.json({ configurado: true, online: res.ok || res.status === 401 }) // 401 = servidor vivo, só exige auth
  } catch {
    return NextResponse.json({ configurado: true, online: false })
  }
}
