/**
 * Núcleo TESTÁVEL do drain de Email — separado do worker. Usa a API Brevo real por
 * padrão; nos testes recebe um `enviar` injetado. Respeita o teto diário do provedor.
 */
import { prisma } from './db'
import { enviarViaBrevo, montarHtmlEmail } from './email'
import { estaOptOutEmail } from './optout'
import { personalizar } from './whatsapp'

const MAX_TENTATIVAS = 3

async function lerTetoDia(): Promise<number> {
  const c = await prisma.configuracao.findUnique({ where: { chave: 'email_teto_dia' } })
  const n = c ? parseInt(c.valor, 10) : NaN
  return Number.isFinite(n) && n >= 0 ? n : 300
}

export async function drenarFilaEmail(deps?: {
  enviar?: (email: string, assunto: string, html: string, texto: string) => Promise<{ ok: boolean; id?: string; erro?: string }>
  agora?: () => Date
  esperar?: (ms: number) => Promise<void>
  appUrl?: string
  tetoDia?: number
}): Promise<{ enviados: number; cancelados: number; falhas: number; tetoAtingido: boolean }> {
  const enviar = deps?.enviar ?? enviarViaBrevo
  const agora = deps?.agora ?? (() => new Date())
  const esperar = deps?.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const appUrl = deps?.appUrl ?? (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
  const tetoDia = deps?.tetoDia ?? (await lerTetoDia())

  const inicioHoje = agora()
  inicioHoje.setHours(0, 0, 0, 0)
  const enviadosHoje = await prisma.emailFila.count({ where: { status: 'enviado', enviadoEm: { gte: inicioHoje } } })
  const orcamento = Math.max(0, tetoDia - enviadosHoje)
  if (orcamento === 0) return { enviados: 0, cancelados: 0, falhas: 0, tetoAtingido: true }

  const pendentes = await prisma.emailFila.findMany({
    where: {
      status: 'pendente',
      tentativas: { lt: MAX_TENTATIVAS },
      OR: [{ agendadoPara: null }, { agendadoPara: { lte: agora() } }],
    },
    orderBy: { criadoEm: 'asc' },
    take: Math.min(orcamento, 50),
  })

  let enviados = 0, cancelados = 0, falhas = 0
  for (const msg of pendentes) {
    if (await estaOptOutEmail(msg.email)) {
      await prisma.emailFila.update({ where: { id: msg.id }, data: { status: 'cancelado' } })
      cancelados++
      continue
    }
    const pessoa = msg.pessoaId ? await prisma.pessoa.findUnique({ where: { id: msg.pessoaId }, select: { nome: true } }) : null
    const texto = personalizar(msg.corpo, pessoa?.nome)
    const html = montarHtmlEmail(texto, msg.email, appUrl)
    const r = await enviar(msg.email, msg.assunto, html, texto)
    if (r.ok) {
      await prisma.emailFila.update({ where: { id: msg.id }, data: { status: 'enviado', enviadoEm: agora(), provedorId: r.id, erro: null } })
      enviados++
    } else {
      const tentativas = msg.tentativas + 1
      await prisma.emailFila.update({ where: { id: msg.id }, data: { tentativas, status: tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente', erro: r.erro ?? 'falha no envio' } })
      falhas++
    }
    await esperar(200)
  }
  return { enviados, cancelados, falhas, tetoAtingido: false }
}
